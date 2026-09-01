# Next Suggested Step

Durable build/device knowledge lives in `DEV_SETUP.md`, not here — this file is just: where we left off, where to continue, and backlog ideas.

## Where we left off (2026-09-01)
Full testing pass done, everything confirmed working end-to-end (UI + direct DB checks): GDPR export's Share sheet, account deletion, the admin "Open a dispute" card in a support thread, and a full Stripe Connect rental cycle (payment → pickup → return → payout landing in the lender's Connect balance). Phone verification was found to be fully broken (no SMS provider configured in Supabase Auth at all) — decided not to invest in one for a concept build, so it's now bypassed via a `PHONE_VERIFICATION_REQUIRED = false` flag in `RootNavigator.tsx` (the screen/OTP logic itself is untouched, just skipped).

Also shipped: rebalanced item pages so Ratings are the dominant trust signal instead of Impact Score — Impact Score shrunk to a single quiet line (was a big green card) on the item detail screen and both pickup/return "Rental Complete!" screens, Ratings promoted to a proper card with a 5-star row. Also fixed the Home feed's category filter bar — `Other` was landing before four interest-only filter chips (Biking/Cooking/Art/Film) instead of after them; now it's the true rightmost chip.

## Where to continue next
Two dashboard toggles only Ori can do (not reachable via API/MCP):
- Supabase Dashboard → Authentication → Hooks → Password Verification Attempt → select `public.hook_password_verification_attempt` (enables the login-lockout feature, already built).
- Confirm Google Cloud's Hard Quota + budget alert are actually set on the Places/Geocoding APIs (free, no billing risk either way).

## Backlog (ideas not yet implemented)
- **No test suite at all** — no test files, runner, or CI. First thing a code reviewer will flag.
- **Real KYC (Stripe Identity)** — deliberately deferred: ~$1.50/verification, needs a new edge function, a DB migration, a native SDK + rebuild, and upload-flow UI. Discuss cost/timing with Ori before starting.
- **Sign in with Apple** — client code already built and harmless to leave in place; needs a paid Apple Developer account ($99/yr) to actually enable, which Ori has decided against for now.
- **41 occurrences of `catch (e: any)`** — cosmetic cleanup, deferred; one `getErrorMessage(e: unknown)` helper in `src/utils/errors.ts` would cover it if ever prioritized.
