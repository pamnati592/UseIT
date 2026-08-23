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

// Called when the app's deep link (swipeandrent://connect-return) fires
// after the user finishes (or abandons) the Stripe-hosted onboarding flow.
// Re-fetches the real status from Stripe rather than trusting the redirect
// happened — the user can background the app mid-flow and come back later,
// or Stripe can still be reviewing the submission.
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

    if (!profile?.stripe_connect_account_id) {
      return new Response(
        JSON.stringify({ charges_enabled: false, details_submitted: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const account = await stripe.accounts.retrieve(profile.stripe_connect_account_id);

    await admin.from('profiles').update({
      stripe_connect_charges_enabled: account.charges_enabled,
      stripe_connect_details_submitted: account.details_submitted,
    }).eq('id', user.id);

    return new Response(
      JSON.stringify({ charges_enabled: account.charges_enabled, details_submitted: account.details_submitted }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? 'Could not refresh payout status' }), { status: 500, headers: corsHeaders });
  }
});
