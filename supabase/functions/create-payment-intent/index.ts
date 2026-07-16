import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Authenticate the caller
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
    }

    const { transaction_id, purchase_id } = await req.json();
    if (!transaction_id && !purchase_id) {
      return new Response(JSON.stringify({ error: 'transaction_id or purchase_id required' }), { status: 400, headers: corsHeaders });
    }

    let amount: number;
    let description: string;
    let metadata: Record<string, string>;

    if (transaction_id) {
      // Fetch transaction and verify the caller is the renter
      const { data: tx, error: txError } = await supabase
        .from('transactions')
        .select('id, renter_id, total_price, status, items(title)')
        .eq('id', transaction_id)
        .single();

      if (txError || !tx) {
        return new Response(JSON.stringify({ error: 'Transaction not found' }), { status: 404, headers: corsHeaders });
      }
      if (tx.renter_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: corsHeaders });
      }
      if (tx.status !== 'approved') {
        return new Response(JSON.stringify({ error: 'Transaction is not approved' }), { status: 400, headers: corsHeaders });
      }
      amount = Math.round(tx.total_price * 100);
      metadata = { transaction_id, renter_id: user.id };
      description = `SwipeAndRent: ${(tx as any).items?.title ?? 'Item rental'}`;
    } else {
      // Fetch purchase and verify the caller is the buyer
      const { data: purchase, error: pError } = await supabase
        .from('purchases')
        .select('id, buyer_id, price, status, items(title)')
        .eq('id', purchase_id)
        .single();

      if (pError || !purchase) {
        return new Response(JSON.stringify({ error: 'Purchase not found' }), { status: 404, headers: corsHeaders });
      }
      if (purchase.buyer_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: corsHeaders });
      }
      if (purchase.status !== 'pending') {
        return new Response(JSON.stringify({ error: 'Purchase is not pending' }), { status: 400, headers: corsHeaders });
      }
      amount = Math.round(purchase.price * 100);
      metadata = { purchase_id, buyer_id: user.id };
      description = `SwipeAndRent: ${(purchase as any).items?.title ?? 'Item purchase'} (purchase)`;
    }

    // Create Stripe PaymentIntent — amount in agorot (1/100 of shekel)
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'ils',
      metadata,
      description,
    });

    return new Response(
      JSON.stringify({ client_secret: paymentIntent.client_secret }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
