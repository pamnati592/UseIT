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

// Spec 4.8/4.10 cancellation policy, keyed off time remaining until start_date.
function refundPercentage(startDate: string): number {
  const hoursUntilStart = (new Date(startDate).getTime() - Date.now()) / 3_600_000;
  if (hoursUntilStart >= 24) return 100;
  if (hoursUntilStart >= 4) return 75;
  return 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
    }

    const { transaction_id, reason } = await req.json();
    if (!transaction_id || (reason !== 'lender_cancelled' && reason !== 'declined_at_pickup')) {
      return new Response(JSON.stringify({ error: 'transaction_id and a valid reason are required' }), { status: 400, headers: corsHeaders });
    }

    const { data: tx, error: txError } = await supabase
      .from('transactions')
      .select('id, renter_id, lender_id, start_date, total_price, status, stripe_payment_intent_id')
      .eq('id', transaction_id)
      .single();

    if (txError || !tx) {
      return new Response(JSON.stringify({ error: 'Transaction not found' }), { status: 404, headers: corsHeaders });
    }

    // Reason gates who may trigger this and matches the two client entry points:
    // the lender's Cancel button, and the renter's Decline Item at pickup.
    if (reason === 'lender_cancelled' && user.id !== tx.lender_id) {
      return new Response(JSON.stringify({ error: 'Only the lender can cancel this rental' }), { status: 403, headers: corsHeaders });
    }
    if (reason === 'declined_at_pickup' && user.id !== tx.renter_id) {
      return new Response(JSON.stringify({ error: 'Only the renter can decline at pickup' }), { status: 403, headers: corsHeaders });
    }
    if (tx.status !== 'cancelled') {
      return new Response(JSON.stringify({ error: 'Transaction must already be cancelled before refunding' }), { status: 400, headers: corsHeaders });
    }
    if (!tx.stripe_payment_intent_id) {
      return new Response(JSON.stringify({ error: 'No payment was taken for this rental' }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Idempotency: a retry (flaky network, double-tap) must not refund twice.
    // refunds.transaction_id is also unique at the DB level as a second line of defense.
    const { data: existing } = await admin
      .from('refunds')
      .select('percentage, amount')
      .eq('transaction_id', transaction_id)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify(existing), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // The renter never took the item, so timing doesn't apply — this isn't a
    // cancellation penalty case, it's a failed handoff.
    const percentage = reason === 'declined_at_pickup' ? 100 : refundPercentage(tx.start_date);
    const amount = Math.round(tx.total_price * (percentage / 100) * 100); // agorot

    let stripeRefundId: string | null = null;
    if (percentage > 0) {
      const refund = await stripe.refunds.create({
        payment_intent: tx.stripe_payment_intent_id,
        amount,
      });
      stripeRefundId = refund.id;
    }

    const { error: insertError } = await admin.from('refunds').insert({
      transaction_id,
      stripe_refund_id: stripeRefundId,
      amount: amount / 100,
      percentage,
      reason,
    });
    if (insertError) {
      // The Stripe refund (if any) already happened and cannot be un-refunded from
      // here — better to have the money genuinely returned with a missing audit row
      // than to double-refund on retry. Surface the error so it gets noticed.
      return new Response(
        JSON.stringify({ error: 'Refund processed but could not be recorded: ' + insertError.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ percentage, amount: amount / 100 }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
