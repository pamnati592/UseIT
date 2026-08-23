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

// Spec 4.12's Trust Score fee tiers, finally actually applied here — until
// now lender_score/renter_score computed and displayed a discount that was
// never charged. BASE_FEE_PERCENT is a placeholder: the spec says the fee
// is "dynamically reduced" but never states a base rate, so this is a
// deliberate guess (5% per side, so 10% combined at zero discount) worth
// revisiting with real business input before this goes live for money.
const BASE_FEE_PERCENT = 5;

function feeDiscountFor(score: number): number {
  if (score >= 4.5) return 0.30;
  if (score >= 4.0) return 0.20;
  if (score >= 3.0) return 0.10;
  return 0;
}

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

    // Service role from here on: profile/transaction/purchase writes below are
    // server bookkeeping, not user actions gated by RLS.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Attach a persistent Stripe Customer to the user (created once, reused after)
    // so the payment sheet can offer to save a card and skip re-entering it next
    // time — a bare PaymentIntent with no customer can't have a saved payment method.
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    let customerId = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({ metadata: { supabase_user_id: user.id } });
      customerId = customer.id;
      await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: '2023-10-16' }
    );

    const { transaction_id, purchase_id } = await req.json();
    if (!transaction_id && !purchase_id) {
      return new Response(JSON.stringify({ error: 'transaction_id or purchase_id required' }), { status: 400, headers: corsHeaders });
    }

    let amount: number;
    let description: string;
    let metadata: Record<string, string>;
    let isRental = false;
    let connectAccountId: string | null = null;
    let applicationFeeAgorot = 0;
    let feeBreakdown: Record<string, number> | null = null;

    if (transaction_id) {
      // Fetch transaction and verify the caller is the renter
      const { data: tx, error: txError } = await supabase
        .from('transactions')
        .select('id, renter_id, lender_id, total_price, status, items(title)')
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

      // Service role: bookkeeping reads across both parties' profiles, not a
      // user action gated by the caller's own RLS.
      const [{ data: renterProfile }, { data: lenderProfile }] = await Promise.all([
        admin.from('profiles').select('renter_score').eq('id', tx.renter_id).single(),
        admin.from('profiles').select('lender_score, stripe_connect_account_id, stripe_connect_charges_enabled').eq('id', tx.lender_id).single(),
      ]);

      if (!lenderProfile?.stripe_connect_charges_enabled || !lenderProfile.stripe_connect_account_id) {
        return new Response(
          JSON.stringify({ error: "This item's lender hasn't finished setting up payouts yet. Ask them to complete Stripe onboarding in their Profile before you pay." }),
          { status: 400, headers: corsHeaders }
        );
      }

      const renterDiscount = feeDiscountFor(renterProfile?.renter_score ?? 0);
      const lenderDiscount = feeDiscountFor(lenderProfile.lender_score ?? 0);
      const renterFeePercent = BASE_FEE_PERCENT * (1 - renterDiscount);
      const lenderFeePercent = BASE_FEE_PERCENT * (1 - lenderDiscount);

      const basePriceAgorot = Math.round(tx.total_price * 100);
      const renterFeeAgorot = Math.round(basePriceAgorot * renterFeePercent / 100);
      const lenderFeeAgorot = Math.round(basePriceAgorot * lenderFeePercent / 100);

      // The renter pays the rental price plus their own (trust-discounted) share
      // of the platform fee; the lender's share comes out of their transfer —
      // both captured in one application_fee_amount below, Stripe's only lever
      // for "platform keeps X, connected account gets the rest" on one charge.
      amount = basePriceAgorot + renterFeeAgorot;
      connectAccountId = lenderProfile.stripe_connect_account_id;
      applicationFeeAgorot = renterFeeAgorot + lenderFeeAgorot;
      feeBreakdown = {
        base_price: tx.total_price,
        renter_fee: renterFeeAgorot / 100,
        lender_fee: lenderFeeAgorot / 100,
        renter_fee_percent: renterFeePercent,
        lender_fee_percent: lenderFeePercent,
      };

      metadata = { transaction_id, renter_id: user.id };
      description = `SwipeAndRent: ${(tx as any).items?.title ?? 'Item rental'}`;
      isRental = true;
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

    // Create Stripe PaymentIntent — amount in agorot (1/100 of shekel). Attached to
    // the customer so the sheet can offer "save this card" and show it saved next time.
    //
    // Rentals mandatorily save the payment method for off-session use (not an opt-in
    // checkbox) — spec 4.10's damage/late-fee charges only work if UseIT can charge the
    // renter after the fact, without them present to re-authenticate. This is disclosed
    // to the renter on the payment screen before they confirm. Purchases are a one-time
    // sale with no ongoing custody risk, so they don't need this.
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'ils',
      customer: customerId,
      metadata,
      description,
      ...(isRental ? { setup_future_usage: 'off_session' as const } : {}),
      ...(connectAccountId ? {
        application_fee_amount: applicationFeeAgorot,
        transfer_data: { destination: connectAccountId },
      } : {}),
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
      JSON.stringify({
        client_secret: paymentIntent.client_secret,
        customer_id: customerId,
        ephemeral_key: ephemeralKey.secret,
        ...(feeBreakdown ? { fee_breakdown: feeBreakdown } : {}),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
