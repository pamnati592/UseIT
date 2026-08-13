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
      if (purchase.status !== 'approved') {
        return new Response(JSON.stringify({ error: 'Purchase is not approved yet' }), { status: 400, headers: corsHeaders });
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

    // Record which Stripe payment belongs to this rental/purchase. Without it there
    // is no link between the two, and a refund becomes impossible — not just from the
    // app, but even by hand in the Stripe dashboard. The columns already existed and
    // were simply never written, leaving 21 unrefundable transactions behind.
    //
    // Uses the service role rather than the request-scoped client above: that one is
    // subject to RLS, and "transactions: renter updates own" only permits status IN
    // ('pending','approved') — the same kind of policy that has already silently
    // swallowed a write in this project. This is server bookkeeping, not a user
    // action, so it should not depend on the caller's policy surface.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { error: linkError } = transaction_id
      ? await admin.from('transactions').update({ stripe_payment_intent_id: paymentIntent.id }).eq('id', transaction_id)
      : await admin.from('purchases').update({ stripe_payment_intent_id: paymentIntent.id }).eq('id', purchase_id);

    if (linkError) {
      // Fail the payment rather than take money we could never refund. Nothing has
      // been charged yet — the intent is still awaiting a payment method — so
      // cancelling it here is clean and the user simply retries.
      await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
      return new Response(
        JSON.stringify({ error: 'Could not record the payment. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ client_secret: paymentIntent.client_secret }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
