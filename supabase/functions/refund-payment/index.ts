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

// Rentals run by the day, not the hour — start_date/end_date are stored as
// midnight-of-day. Cancel before the start day: full refund. Cancel on (or
// after) the start day: 25% refund (75% charged).
function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function refundPercentage(startDate: string): number {
  return dayKey(startDate) <= dayKey(new Date().toISOString()) ? 25 : 100;
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
    const validReasons = ['lender_cancelled', 'declined_at_pickup', 'admin_dispute_resolved'];
    if (!transaction_id || !validReasons.includes(reason)) {
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

    // Reason gates who may trigger this and matches the client entry points:
    // the lender's Cancel button, the renter's Decline Item at pickup, and
    // the admin console's dispute resolution.
    if (reason === 'lender_cancelled' && user.id !== tx.lender_id) {
      return new Response(JSON.stringify({ error: 'Only the lender can cancel this rental' }), { status: 403, headers: corsHeaders });
    }
    if (reason === 'declined_at_pickup' && user.id !== tx.renter_id) {
      return new Response(JSON.stringify({ error: 'Only the renter can decline at pickup' }), { status: 403, headers: corsHeaders });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (reason === 'admin_dispute_resolved') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).single();
      if (!profile?.is_admin) {
        return new Response(JSON.stringify({ error: 'Admin only' }), { status: 403, headers: corsHeaders });
      }
    }

    // admin_dispute_resolved can land on 'completed' rather than 'cancelled'
    // when the dispute was opened after the rental had already completed —
    // admin_resolve_dispute preserves that instead of wrongly marking a
    // rental that genuinely happened as cancelled. The other two reasons
    // (lender_cancelled, declined_at_pickup) always transition through
    // 'cancelled', so they're unaffected.
    const acceptableStatuses = reason === 'admin_dispute_resolved' ? ['cancelled', 'completed'] : ['cancelled'];
    if (!acceptableStatuses.includes(tx.status)) {
      return new Response(JSON.stringify({ error: 'Transaction must already be cancelled before refunding' }), { status: 400, headers: corsHeaders });
    }
    if (!tx.stripe_payment_intent_id) {
      return new Response(JSON.stringify({ error: 'No payment was taken for this rental' }), { status: 400, headers: corsHeaders });
    }

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

    // declined_at_pickup: the renter never took the item, so timing doesn't
    // apply. admin_dispute_resolved: an admin ruled in the renter's favor —
    // also not a cancellation-timing case.
    const percentage = (reason === 'declined_at_pickup' || reason === 'admin_dispute_resolved')
      ? 100
      : refundPercentage(tx.start_date);
    const amount = Math.round(tx.total_price * (percentage / 100) * 100); // agorot

    let stripeRefundId: string | null = null;
    if (percentage > 0) {
      // reverse_transfer/refund_application_fee only matter for a payment that
      // actually used Connect (transfer_data.destination) — harmless no-ops on
      // an older payment intent with no associated transfer. Without these, a
      // "full refund" would still leave the lender's already-transferred share
      // and the platform's fee both unrecovered, i.e. not actually a full refund.
      const refund = await stripe.refunds.create({
        payment_intent: tx.stripe_payment_intent_id,
        amount,
        reverse_transfer: true,
        refund_application_fee: true,
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
