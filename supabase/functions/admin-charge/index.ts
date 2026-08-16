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

// Admin-triggered off-session charge against the renter's saved card — the
// two manually-assessed cases from spec 4.8/4.10 (requested 2026-08-16):
// damage found on return, and the 2-week-overdue penalty (the daily late fee
// itself is automatic, see charge-late-fee — this is only the escalated
// cliff fine, whose amount the admin sets after optionally consulting the
// lender, not a formula).
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

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: adminProfile } = await admin.from('profiles').select('is_admin').eq('id', user.id).single();
    if (!adminProfile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Admin only' }), { status: 403, headers: corsHeaders });
    }

    const { transaction_id, amount, reason, note } = await req.json();
    if (!transaction_id || !amount || amount <= 0 || !['damage', 'late_fee_cliff'].includes(reason)) {
      return new Response(JSON.stringify({ error: 'transaction_id, a positive amount, and a valid reason are required' }), { status: 400, headers: corsHeaders });
    }

    const { data: tx, error: txError } = await admin
      .from('transactions')
      .select('id, renter_id, lender_id, conversation_id, items(title)')
      .eq('id', transaction_id)
      .single();

    if (txError || !tx) {
      return new Response(JSON.stringify({ error: 'Transaction not found' }), { status: 404, headers: corsHeaders });
    }

    const { data: profile } = await admin.from('profiles').select('stripe_customer_id').eq('id', tx.renter_id).single();
    const itemTitle = (tx as any).items?.title ?? 'Item rental';
    const amountAgorot = Math.round(amount * 100);

    const label = reason === 'damage' ? 'damage' : 'a late-return penalty (2+ weeks overdue)';
    let content: string;
    let preview: string;
    let status: 'succeeded' | 'failed';
    let stripePaymentIntentId: string | null = null;
    let failNote: string | null = null;

    if (!profile?.stripe_customer_id) {
      status = 'failed';
      failNote = 'No Stripe customer on file for renter.';
      content = `UseIT assessed ₪${amount} for ${label}, but the renter has no card on file to auto-charge. Please arrange payment directly.${note ? ' ' + note : ''}`;
      preview = `⚠️ ₪${amount} assessed · no card on file`;
    } else {
      const result = await chargeOffSession(
        stripe, profile.stripe_customer_id, amountAgorot,
        `SwipeAndRent: ${reason === 'damage' ? 'damage' : 'late-return penalty'} — ${itemTitle}`,
        { transaction_id, reason }
      );
      if (result.ok) {
        status = 'succeeded';
        stripePaymentIntentId = result.paymentIntentId;
        content = reason === 'damage'
          ? `💥 UseIT charged ₪${amount} to the renter for damage assessed on return.${note ? ' ' + note : ''}`
          : `⏰ This rental is 2+ weeks overdue. UseIT charged ₪${amount} to the renter as a late-return penalty.${note ? ' ' + note : ''}`;
        preview = reason === 'damage' ? `💥 Damage charged · ₪${amount}` : `⏰ Overdue penalty · ₪${amount}`;
      } else {
        status = 'failed';
        failNote = result.error;
        content = `UseIT assessed ₪${amount} for ${label}, but the automatic charge failed (${result.error}). Please arrange payment directly.${note ? ' ' + note : ''}`;
        preview = `⚠️ ₪${amount} assessed · charge failed`;
      }
    }

    await admin.from('admin_charges').insert({
      transaction_id, reason, amount, status,
      charged_by: user.id, stripe_payment_intent_id: stripePaymentIntentId, note: failNote ?? note ?? null,
    });

    // No participant's last_read_at is touched — the admin isn't a party to
    // the conversation, same precedent as admin_resolve_dispute — so this
    // reads as new to both renter and lender (Badge Jump fires for both).
    if (tx.conversation_id) {
      await admin.from('conversations').update({ last_message: preview, last_message_at: new Date().toISOString() }).eq('id', tx.conversation_id);
      await admin.from('messages').insert({ conversation_id: tx.conversation_id, sender_id: user.id, content, transaction_id });
    }

    return new Response(
      JSON.stringify({ ok: status === 'succeeded', status }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
