import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { chargeOffSession } from '../_shared/offSessionCharge.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Called by QRScanScreen right after a return scan completes. Computes how
// many days late the return was against the agreed end_date, and — per spec
// 4.8's late-return penalty (requested 2026-08-16, confirmed: a per-day fee
// applies even for a short overrun, separate from the 2-week cliff fine an
// admin manually assesses via AdminOverdueScreen) — charges the renter's
// saved card daily_price × late_days. A no-op if the return was on time.
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

    const { transaction_id } = await req.json();
    if (!transaction_id) {
      return new Response(JSON.stringify({ error: 'transaction_id required' }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: tx, error: txError } = await admin
      .from('transactions')
      .select('id, renter_id, lender_id, end_date, returned_at, status, conversation_id, items(daily_price, title)')
      .eq('id', transaction_id)
      .single();

    if (txError || !tx) {
      return new Response(JSON.stringify({ error: 'Transaction not found' }), { status: 404, headers: corsHeaders });
    }
    if (user.id !== tx.renter_id && user.id !== tx.lender_id) {
      return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: corsHeaders });
    }
    if (tx.status !== 'completed' || !tx.returned_at) {
      return new Response(JSON.stringify({ error: 'Rental has not been returned yet' }), { status: 400, headers: corsHeaders });
    }

    const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
    const lateDays = Math.max(0, Math.round(
      (new Date(dayKey(tx.returned_at)).getTime() - new Date(dayKey(tx.end_date)).getTime()) / 86400000
    ));

    if (lateDays <= 0) {
      return new Response(JSON.stringify({ charged: false, lateDays: 0 }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Idempotent: the return-scan flow could retry, or both parties' clients
    // could both call this after the same scan resolves.
    const { data: existing } = await admin
      .from('admin_charges')
      .select('id')
      .eq('transaction_id', transaction_id)
      .eq('reason', 'late_fee_daily')
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ charged: false, already: true, lateDays }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const dailyPrice = (tx as any).items?.daily_price ?? 0;
    const itemTitle = (tx as any).items?.title ?? 'Item rental';
    const amount = dailyPrice * lateDays;
    const amountAgorot = Math.round(amount * 100);

    const { data: profile } = await admin.from('profiles').select('stripe_customer_id').eq('id', tx.renter_id).single();

    let content: string;
    let preview: string;
    let status: 'succeeded' | 'failed';
    let stripePaymentIntentId: string | null = null;
    let note: string | null = null;

    if (!profile?.stripe_customer_id) {
      status = 'failed';
      note = 'No Stripe customer on file for renter.';
      content = `⏰ Returned ${lateDays} day(s) late (₪${amount} owed) — no card on file to auto-charge. Please arrange payment directly, or via "Message UseIT About This".`;
      preview = `⏰ Late return · ₪${amount} owed`;
    } else {
      const result = await chargeOffSession(
        stripe, profile.stripe_customer_id, amountAgorot,
        `UseIT: late fee — ${itemTitle}`,
        { transaction_id, reason: 'late_fee_daily' }
      );
      if (result.ok) {
        status = 'succeeded';
        stripePaymentIntentId = result.paymentIntentId;
        content = `⏰ Returned ${lateDays} day(s) late — ₪${amount} late fee automatically charged.`;
        preview = `⏰ Late fee charged · ₪${amount}`;
      } else {
        status = 'failed';
        note = result.error;
        content = `⏰ Returned ${lateDays} day(s) late (₪${amount} owed) — automatic charge failed (${result.error}). Please arrange payment directly, or via "Message UseIT About This".`;
        preview = `⏰ Late return · charge failed`;
      }
    }

    await admin.from('admin_charges').insert({
      transaction_id, reason: 'late_fee_daily', amount, status,
      charged_by: null, stripe_payment_intent_id: stripePaymentIntentId, note,
    });

    if (tx.conversation_id) {
      const isLender = user.id === tx.lender_id;
      const readField = isLender ? 'lender_last_read_at' : 'renter_last_read_at';
      const now = new Date().toISOString();
      await admin.from('conversations').update({ last_message: preview, last_message_at: now, [readField]: now }).eq('id', tx.conversation_id);
      await admin.from('messages').insert({ conversation_id: tx.conversation_id, sender_id: user.id, content, transaction_id });
    }

    return new Response(
      JSON.stringify({ charged: status === 'succeeded', lateDays, amount }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
