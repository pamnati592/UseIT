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

// First real step of paying lenders (spec 4.10) rather than just capturing
// their renter's money into the platform's own Stripe account forever.
// Express account: the lender only needs `transfers` — actual card
// acceptance stays on the platform's own PaymentIntent (destination
// charges), the connected account is purely the payout destination.
//
// No webhook here deliberately — refresh-connect-status re-syncs on the
// app's own deep-link return from the hosted onboarding flow instead. A
// webhook would need a signing secret configured in the Stripe dashboard,
// which isn't something this session can set up; this keeps the RPC/edge
// function as the authority, matching the pattern used everywhere else in
// this codebase, at the cost of not catching status changes the user
// causes entirely outside the app (rare for onboarding).
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

    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_connect_account_id')
      .eq('id', user.id)
      .single();

    let accountId = profile?.stripe_connect_account_id ?? null;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email ?? undefined,
        capabilities: { transfers: { requested: true } },
      });
      accountId = account.id;
      await admin.from('profiles').update({ stripe_connect_account_id: accountId }).eq('id', user.id);
    }

    // Stripe rejects custom app schemes here outright ("Not a valid URL") —
    // only http(s) is accepted. connect-return is a tiny hosted page that
    // immediately redirects into the real swipeandrent:// deep link.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${supabaseUrl}/functions/v1/connect-return?refresh=true`,
      return_url: `${supabaseUrl}/functions/v1/connect-return`,
      type: 'account_onboarding',
    });

    return new Response(
      JSON.stringify({ url: accountLink.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? 'Could not start payout setup' }), { status: 500, headers: corsHeaders });
  }
});
