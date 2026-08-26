import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Stripe's Account Link refresh_url/return_url only accept http(s) URLs —
// a custom app scheme like useit:// is rejected outright with "Not
// a valid URL" (confirmed against stripe-react-native#1188). This is the
// standard workaround: a real HTTPS page Stripe is happy to redirect to,
// which immediately bounces into the app's actual deep link. No auth
// required — Stripe's browser navigates here with no Supabase session.
serve((req) => {
  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === 'true';
  const deepLink = `useit://connect-return${refresh ? '?refresh=true' : ''}`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0;url=${deepLink}" />
  <script>window.location.replace(${JSON.stringify(deepLink)});</script>
</head>
<body>
  <p>Returning to UseIT… if nothing happens, <a href="${deepLink}">tap here</a>.</p>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
