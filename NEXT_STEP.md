# Next Suggested Step

Durable build/device knowledge lives in `DEV_SETUP.md`, not here — this file is just: where we left off, where to continue, and backlog ideas.

## Where we left off (2026-09-01)
Full testing pass, everything confirmed working end-to-end (UI + direct DB checks): GDPR export's Share sheet, account deletion, the admin "Open a dispute" card in a support thread, and a full Stripe Connect rental cycle (payment → pickup → return → payout landing in the lender's Connect balance).

Real finding along the way: Supabase Auth has **no SMS/phone provider configured**, so phone verification fails for every real user with "Unsupported phone provider" — not just untested, actually broken. Decision: don't invest in a real SMS provider for a concept build that isn't viable in Israel today anyway (Stripe dependency) — skip phone verification instead. Added a `PHONE_VERIFICATION_REQUIRED = false` flag in `RootNavigator.tsx`; `PhoneVerificationScreen` and its OTP logic are untouched so it can be flipped back on later. Committed and pushed.

## Where to continue next
1. iOS was disconnected this whole session — once it's back, re-verify everything that was only confirmed on the Galaxy: chat media (photo/video/voice), the mic-permission crash fix, and double-tap-to-reset-tab.
2. Two dashboard toggles only Ori can do (not reachable via API/MCP):
   - Supabase Dashboard → Authentication → Hooks → Password Verification Attempt → select `public.hook_password_verification_attempt` (enables the login-lockout feature, already built).
   - Confirm Google Cloud's Hard Quota + budget alert are actually set on the Places/Geocoding APIs (free, no billing risk either way).
3. Older pending features, still not started: dispute resolution's pick-a-side → review → publish redesign, `ReviewsListScreen`, overdue-card simplification, support-thread notifications surfaced in Chats.

## Backlog (ideas not yet implemented)
- **Bulk photo scan** — one photo of a pile of objects → a review sheet of multiple detected items, each going through the existing per-item AI auto-fill Save path.
- **Gate QR handoff to rental dates server-side** — `ensure_qr_token`/`scan_qr_handoff` should enforce pickup only on/after `start_date` and return only on/after `end_date`; hiding the button client-side isn't enough.
- **Proximity check refinement** — consider refusing a handoff when reported GPS `accuracy` is worse than ~30m, or widening the effective limit by both parties' reported accuracy instead of a flat 50m constant.
- **Real KYC (Stripe Identity)** — deliberately deferred: ~$1.50/verification, needs a new edge function, a DB migration, a native SDK + rebuild, and upload-flow UI. Discuss cost/timing with Ori before starting.
- **Sign in with Apple** — client code already built and harmless to leave in place; needs a paid Apple Developer account ($99/yr) to actually enable, which Ori has decided against for now.
- **41 occurrences of `catch (e: any)`** — cosmetic cleanup, deferred; one `getErrorMessage(e: unknown)` helper in `src/utils/errors.ts` would cover it if ever prioritized.
- **No test suite at all** — no test files, runner, or CI. First thing a code reviewer will flag.
