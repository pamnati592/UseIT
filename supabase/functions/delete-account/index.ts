import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Apple guideline 5.1.1v / spec 5.2 GDPR right to deletion. Doesn't actually
// delete the profiles row -- profiles.id cascades from auth.users, which
// cascades further into conversations/messages/items/reviews/purchases/
// ratings/disputes, so a real delete would silently wipe a counterparty's
// shared history along with it. Anonymize in place instead (keeps every FK'd
// relationship intact), hide their listings, and permanently ban the auth
// user (blocks login without touching the row). Needs the service role for
// the auth admin ban call -- not reachable from a plain RPC.
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

    const { error: profileError } = await admin.from('profiles').update({
      full_name: 'Deleted User',
      avatar_url: null,
      phone: null,
      city: null,
      location: null,
      interests: [],
      is_deleted: true,
    }).eq('id', user.id);
    if (profileError) throw profileError;

    const { error: itemsError } = await admin.from('items').update({ is_hidden: true }).eq('owner_id', user.id);
    if (itemsError) throw itemsError;

    // Supabase's own documented convention for an effectively-permanent ban
    // (no literal "forever" value exists) -- 100 years.
    const { error: banError } = await admin.auth.admin.updateUserById(user.id, { ban_duration: '876000h' });
    if (banError) throw banError;

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? 'Could not delete account' }), { status: 500, headers: corsHeaders });
  }
});
