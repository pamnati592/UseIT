# Next Suggested Step — For Nati 👋

## Where things stand (2026-08-26 end of session)
Another huge session, all pushed to `main` (which — heads up — is now `github.com/pamnati592/UseIT`, not `SwipeAndRent`): Demo Day + code review prep planned and largely executed (Supabase generated types, `any` cleanup 55→41, cross-screen duplication extracted into `src/utils/format.ts`/`src/hooks/useAdminList.ts`, `ChatRoomScreen.tsx` cut from 1913→1567 lines, a real SAS bug fixed and verified end-to-end), a demo account created, the Google Maps key fixed, database test-profanity cleaned up, and a full rename from SwipeAndRent to **UseIT** — including the risky part (bundle identifier, scheme, slug) once Ori explicitly signed off on it. See the "🔍 Code review prep" and the two rebrand sections below for the full detail — this paragraph is just the index.

**Next suggested step, in order:**
1. **Native rebuild on both devices** — the bundle identifier changed (`com.swipeandrentapp` → `com.useitapp`), so both the iPhone and Galaxy currently have an orphaned old app installed, not an upgradable one. See the rebrand section below for exact steps (uninstall-then-reinstall on Android; fresh provisioning-trust on iOS).
2. **Quick on-device eyeball of the last terminology batch** — not verified live this session since the Galaxy disconnected mid-batch. Three easy spots: Item Detail's wishlist heart (should say "Wishlisted" once tapped), the Get Help → "Report a Problem" flow, Admin Items' "Decline" button.
3. **Check Supabase Dashboard → Authentication → URL Configuration** for a `swipeandrent://` entry in the redirect-URL allowlist (used by Google sign-in) — add a `useit://` counterpart if one exists. Not checked this session, no MCP tool exposed it for a direct read.
4. Everything from the 2026-08-24 session that was still pending: the Reports queue end-to-end, account deletion (careful, it's real), GDPR export's Share sheet — see "Testing owed" below for the full list, still accurate.

## ✅ NEW (2026-08-26) — DB profanity cleanup + full SwipeAndRent → UseIT rebrand

**Database cleanup**: swept `items`, `messages`, `disputes` for test-data profanity Ori had typed in while testing (English and Hebrew) — 6 rows fixed (2 item descriptions, 2 messages, 2 dispute descriptions), verified clean with a final broad regex sweep across `items`/`messages`/`disputes`/`support_messages`/`reports`. Nothing customer-facing should surface this on Demo Day now.

**Rebrand — now fully done, including the identifiers.** Ori wants zero trace of "SwipeAndRent" anywhere reviewers/Demo Day attendees see, and explicitly confirmed he wants the bundle identifier/scheme changed too despite the risk below. "UseIT" is already the platform's own established in-universe brand for support/arbitration throughout the app (Contact UseIT, Message UseIT, "UseIT reviewed this dispute...", `admin_ensure_support_thread`) — the outer app name had just never been aligned with it.

- ✅ **Text-only rebrand** (first pass): app.json's display `"name"` and all 5 permission-prompt strings; in-app UI text (onboarding, GDPR export Share sheet title, Stripe payment sheet `merchantDisplayName`); 4 edge functions' user-visible strings; README; `package.json`'s internal `"name"` field; CLAUDE.md/AGENTS.md headers.
- ✅ **Identifiers rebrand** (second pass, once Ori confirmed): app.json's `slug` (`swipeandrent`→`useit`), `scheme` (`swipeandrent`→`useit`), `ios.bundleIdentifier` and `android.package` (`com.swipeandrentapp`→`com.useitapp`). Also fixed every place that hardcoded the old scheme string, which the identifier change alone wouldn't have caught: `src/services/auth.service.ts`'s `AuthSession.makeRedirectUri` (Google OAuth redirect), `src/screens/ProfileScreen.tsx`'s `WebBrowser.openAuthSessionAsync` call (Stripe Connect onboarding return), and `supabase/functions/connect-return`'s hardcoded deep-link construction (**redeployed live**, verify_jwt unchanged) — missing any one of these would have silently broken that specific flow instead of erroring loudly. Also renamed `App.tsx`'s Stripe `merchantIdentifier` (`merchant.com.useitapp`) for consistency — cosmetic unless Apple Pay is ever actually activated (currently isn't, per the stripped Apple Pay/push entitlements noted below), in which case the *real* merchant ID registered with Apple/Stripe must be updated to match this string exactly. Synced `package-lock.json`'s `name` field via `npm install` (no dependency changes). GitHub repo itself: **already renamed to `UseIT` by Ori** outside this session — `git remote -v` confirmed pointed at `github.com/pamnati592/UseIT.git` when this was checked, README's clone URL updated to match. Merged `cleanup/pre-review` into `main` and pushed.
- ⚠️ **Real consequence, not yet done — needs a native rebuild on both devices before this is actually live.** Changing `bundleIdentifier`/`android.package` means both devices' *existing, currently-working* installs are now a different, orphaned app as far as iOS/Android are concerned:
  - **iPhone**: the old app can stay installed harmlessly or be deleted; either way, the new bundle ID needs a fresh `npx expo run:ios --device <UDID>` build and a brand-new provisioning-trust flow (Settings → General → VPN & Device Management) — this is the same dance as the existing 7-day cert refresh, just against a new identity instead of a renewal.
  - **Galaxy**: uninstall the old `com.swipeandrentapp` app first (Android treats the new `com.useitapp` as an unrelated app, won't upgrade in place), then `npx expo run:android --device <model>`.
  - **Before either rebuild**: double-check Supabase Dashboard → Authentication → URL Configuration's redirect-URL allowlist for any explicit `swipeandrent://` entry (used by the Google OAuth callback) — if one exists, add the `useit://` equivalent or the sign-in redirect will be rejected even though the app code is already updated. Not verified this session — no MCP tool exposed this config for a direct check.
- **Still says "SwipeAndRent" and deliberately left alone**: `product-spec.pdf` (the official course deliverable, not something to silently rewrite).

## ✅ Admin architecture rebuilt again — the 2026-08-19 "Admin Mode persona" is gone
The shield-icon toggle + global banner + Chats-tab-transforms-in-place design from last session is **fully removed**, per direct request: switching into anything admin-related should never be an implicit side effect of tapping an icon in a regular user's own Chats tab — it should only happen by deliberately entering the Admin Console from Profile.
- `AdminModeContext` now just exposes a fixed `isAdmin` flag — no more `adminModeActive`/enter/exit, no AsyncStorage persistence of a "mode."
- Chats is 100% the personal Chats/UseIT split for every user, admin included, always — no admin-awareness in that screen at all anymore.
- The platform-wide Support Inbox is a real screen again (`AdminSupportInboxScreen`, restored from before the Aug 19 rebuild), reachable only via a "Support Inbox" tile in the Admin Console.
- **New, real bug fixed twice**: the sole admin account is also a real test party on real transactions, so both `ensure_support_thread` (Contact UseIT) and `admin_ensure_support_thread` (Message Renter/Lender from the Dispute Queue) let the admin open a support thread with *themselves*. Both RPCs now reject that server-side (SAS — the DB is the single enforcement point, not a UI hide); `AdminDisputesScreen` also hides the button client-side so nothing dead-ends in an error.
- **New**: admin can open a dispute themselves from inside a support conversation (covers a user contacting UseIT without going through their own "Report a Problem" flow) — a persistent "Open a dispute" card pinned under the thread's title (not a header icon, doesn't scroll away), navigates straight to the Dispute Queue on success. New `admin_open_dispute` RPC mirrors `report_issue` exactly, admin-gated with the reporter named explicitly.

## ✅ Stripe Connect payouts — confirmed working with a real payment
Backlog from 2026-08-19 ("not yet tested against the real Stripe API") is now resolved. Three real bugs found and fixed along the way, all from *first real use* of code that had never been exercised:
1. **`error.message` from `supabase.functions.invoke` is always the generic "Edge Function returned a non-2xx status code"** — the function's actual `{error: "..."}` body only lives in `error.context`. This masked every real error below; fixed in `AddItemScreen`, `ProfileScreen` (and matches the pattern to use anywhere else edge functions are invoked).
2. **Stripe rejects custom app URL schemes** (`swipeandrent://...`) for Account Link `refresh_url`/`return_url` outright — "Not a valid URL," only `http(s)` accepted. New `connect-return` edge function (unauthenticated) serves a tiny HTML page that immediately redirects into the real deep link; `connect-onboarding` points at that instead.
3. Stripe Connect had to be enabled as a product on Ori's Stripe account (one-time Dashboard step, done).

Confirmed live in the DB: Ori completed Express onboarding (test-mode values — `0000` SSN, etc.), and a real rental (Nati renting the Nintendo Switch OLED, ₪225) reached `status: paid` with a genuine `stripe_payment_intent_id` — `create-payment-intent`'s "block until lender's Connect is enabled" check passed for real. **Not yet tested**: the actual payout transfer completing after a full pickup→return QR handoff cycle on this transaction.

## ✅ AI auto-fill (backlog S) — fixed, confirmed working end-to-end
Was "completely unverified" as of 2026-08-19. First real test hit `failed_generation - failed to validate json` from Groq: Qwen's thinking mode is on by default, and `reasoning_format: 'hidden'` (tried first) only hides reasoning from the response — it still burns tokens producing it, so the whole `max_tokens` budget went to invisible thinking and left an empty completion. `reasoning_effort: 'none'` actually disables reasoning. Confirmed working after that fix: real photo in, sane title/category/description/price out. Model name `qwen/qwen3.6-27b` re-checked against current Groq docs — still valid, not stale.

## ✅ Full pre-launch backlog swept (2026-08-24)
Everything from the 2026-08-19 gap analysis, plus R/AA/AB from the old backlog list below — all in one session, all pushed:

- **Real bug found while doing this**: "Submit for Review" was permanently disabled with no `onPress` at all — "Go Live (Testing Only)" was, in practice, the *only* way to actually list an item, skipping admin moderation on every single listing. Fixed the real button, removed the testing bypass.
- **Backlog AB** — verification photos moved to a private `verification-photos` bucket (were public). One pre-existing real upload wasn't migrated (a test item, "Koksinel") — re-submit its verification photo through the app if it matters.
- **Backlog AA** — block/report user. New `reports` table (RLS-locked, RPC-only access matching the disputes/support_threads convention), a Flag icon on `PublicProfileScreen` (hidden on your own profile), reason picker, and an admin Reports queue that deep-links into `AdminUsersScreen` (now takes an `initialSearch` param) to actually ban — SAS, banning stays the one canonical action there.
- **Account deletion + GDPR export** — new `delete-account` edge function. Doesn't hard-delete the profile (it cascades from `auth.users`, which cascades further into conversations/messages/items/reviews/purchases/ratings/disputes — would silently wipe a counterparty's shared history too); anonymizes in place instead, hides listings, permanently bans the auth user (Supabase's documented ~forever convention, `876000h`). Export is pure client-side reads through each table's existing RLS, handed to the native Share sheet.
- **Biometric gate (spec 4.2)** — `expo-local-authentication`, checked once per session right after login. Browsing stays fully usable without it (spec says read-only, not locked out) — a persistent banner shows when verification failed/was skipped, tap to retry. Enforcement covers the two core marketplace-write actions (Add Item submit, rental request + Buy) as a real demonstration, **not every mutation in the app** — there's no existing single choke point for all writes, so full coverage would mean touching most screens individually. **Confirmed working on both devices** (fingerprint on Galaxy, Face ID pending explicit iPhone confirmation) after a full native rebuild of both.
- **Login lockout (spec 5.2)** — Supabase Auth's own password verification isn't interceptable from app code. Built against the real hook point: the "Password Verification Attempt" Auth Hook. `hook_password_verification_attempt` tracks failures per user, locks 15 minutes at 5 failures. Fully wired DB-side but **does nothing until enabled in the Dashboard** — see "Needs Ori" below.
- **Sign in with Apple (guideline 4.8)** — full client flow built and ready (`expo-apple-authentication`, native sign-in sheet, SHA-256 nonce, `signInWithIdToken`) but **not functional** — needs a paid Apple Developer Program account to configure Supabase's Apple OAuth provider. Same native-rebuild requirement as biometric, already done.
- **Backlog R (real Impact Score)** — was a hash of the item's own id (format.ts) plus two separately hardcoded numbers in the QR pickup/return screens. Real formula now: per-category baseline (rough relative estimate, not measured data) + 0.1 per completed rental, capped at 5.0. `items.completed_rental_count` rolls up in `scan_qr_handoff` on every real return scan.
- **New: single source of truth for categories** — `src/constants/categories.ts`. Was duplicated across 6 files and already drifting (onboarding's "sports" had a different icon than everywhere else). Adding a category is now one edit; everything else derives from it. One unavoidable exception: `analyze-item-photo` is a separate Deno deployment that can't import from `src/`, keeps its own copy of just the keys, called out at its definition site.
- **New category: Clothing & Fashion** — first real test of the registry above.

## ⚠️ Needs Ori's action before these actually work
- **Login lockout**: Dashboard → Authentication → Hooks → Password Verification Attempt → select `public.hook_password_verification_attempt`. One click, not done yet.
- **Sign in with Apple**: needs a paid Apple Developer Program account ($99/yr) — the free personal team can't enable the capability at all. Not buildable from here.
- **Google Cloud hardening** (see backlog L below) — still outstanding, unrelated to this session.

## ⚠️ Testing owed (nothing below confirmed on device except where noted)
- Reports queue end-to-end: report a user from `PublicProfileScreen` → confirm it shows in Admin Console → Reports → Dismiss / Manage User navigates to `AdminUsersScreen` with the name pre-filled.
- Account deletion — **use a throwaway account**, it's real: anonymizes the profile and permanently bans the auth user, confirmed via a direct DB check that this actually works, but not yet exercised from the UI end to end.
- GDPR export's Share sheet on both platforms.
- The new "Open a dispute" card in `SupportThreadScreen` (admin escalating a conversation that never went through the user's own Report a Problem flow).
- Stripe Connect: the actual payout transfer completing after a full pickup→return QR cycle on the Nintendo Switch OLED transaction (or a fresh one).
- Biometric gate on iPhone specifically (confirmed on Galaxy via fingerprint).
- Everything from the 2026-08-19 session that was already pending: dispute resolution's pick-a-side → review → publish redesign, `ReviewsListScreen`, overdue card simplification, support-thread notifications in Chats.

---

## 🎪 NEW (2026-08-26): Demo Day prep

### ✅ Generic demo user — created and ready
No signup needed — anyone can log in immediately with:
- **Email:** `demo@example.com`
- **Password:** `1111111`

Used `demo@example.com` rather than the literally-suggested `example@gmail.com` — `gmail.com` is a real, live mailbox domain, so that exact address could belong to a real person; `example.com` is the IANA-reserved documentation domain, guaranteed to have no real inbox behind it. Created via the real `supabase.auth.signup` endpoint (not a raw DB insert, so the password hash is genuine GoTrue output), user id `8dbd96a1-f444-45f5-91df-ce9a148dbc6a`. This project already has "Confirm email" **disabled**, so it was usable instantly with no manual confirmation step. Its `profiles` row was pre-filled so it skips all first-run friction and drops straight into the Home feed:
- `phone_verified = true`, `onboarding_complete = true` (skips `PhoneVerificationScreen` and `OnboardingScreen` entirely)
- `role = 'both'`, `city = 'Tel Aviv'`, `interests = [photography, camping, gaming, sports]` — matches where `demo_seed.sql` clusters items, and `'both'` means it can browse/rent *and* list an item (so Add Item + AI auto-fill are demoable on it too).
- It's a normal 4th account, distinct from Ori/Nati — it can rent or buy their seeded items (GoPro, drone, guitar, surfboard, Switch, hammock, Polaroid) without owner/renter conflicts.

**Caveat carried over from the codebase, not fixed by this account:** the biometric gate (`BiometricContext`) degrades to read-only if the demo visitor's *own* phone has no Face ID/fingerprint enrolled — this is a per-device check, unrelated to which account is logged in. Most personal phones have this enabled already; if a demo device doesn't, "Add Item" and "rental request / Buy" will show the read-only banner instead of failing silently.

### ✅ CRITICAL, partially fixed (2026-08-26) — before building any distributable demo binary
`ProfileScreen.tsx`'s **"Switch User"** feature (`src/screens/ProfileScreen.tsx:473`, modal at line 523) was rendering unconditionally in the profile menu, reading real credentials from `src/config/testAccounts.ts` — gitignored (never reaches GitHub) but **does exist on Ori's machine**, and Metro bundles whatever's on disk at build time regardless of git tracking. Two independent fixes were needed:
1. ✅ **Done** — the menu item is now wrapped in `if (__DEV__)`, so it can't render or be tapped in a release/preview build.
2. ⚠️ **Still needs doing by hand at build time** — the `__DEV__` gate hides the UI, but the top-level `import { TEST_ACCOUNTS } from '../config/testAccounts'` still executes unconditionally, so the real strings still land in the JS bundle if the file is present on disk. Don't build the demo binary from a checkout that has `testAccounts.ts` present — `rm`/rename it (or build from a clean clone) right before running `eas build` for anything meant to leave Ori's machine.

### ✅ RESOLVED (2026-08-26) — Google Maps API key was missing, broke city picker
Caught live on the Galaxy: "Choose city" → "Use my current location" failed with `Could not detect city / Maps API key missing`. Root cause was in `src/services/places.ts` — `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` wasn't set in `.env` at all. Ori created a key in Google Cloud Console (project `swipeandrent-494508`), restricted it to Places API + Geocoding API, and confirmed both show "API Enabled." Key added to `.env` (gitignored) and `.env.example` got a placeholder line added since it was missing this var entirely despite the README listing it as required. First retry after enabling the APIs still threw the same "not activated" error — that was just Google's own propagation delay, not a real problem; a retry ~1 minute later succeeded and correctly resolved "Tel Aviv-Yafo" from GPS. Confirmed working end-to-end on the Galaxy.

**Still outstanding from this same thread:** the quota cap + budget alert from backlog item L below — worth confirming those actually got set while Ori was in the console for this, since without them the newly-live key has no spending ceiling. Also still true: `autocompleteCities` (typing a city name instead of using GPS) **fails silently** on a missing/misconfigured key — it just returns `[]` (`places.ts:27`) with no visible error. Not urgent now that the key works, but worth tightening so a future regression (e.g. key gets revoked, quota exhausted) doesn't hide the same way.

### Demo flow (solo walkthrough, ~4–5 min)
1. **Open on the demo account** → land straight on the Home feed (Tel Aviv-clustered seeded items, no login friction) — narrate the swipe-to-browse UX and GPS-distance ranking (`useUserLocation`).
2. **Tap an item** → `ItemDetailScreen`: real Impact Score (per-category baseline + completed-rental history, not a placeholder), reviews, availability calendar.
3. **AI Planner** (`AIPlannerScreen`) — ask for something like "camping this weekend," show it filtering by real availability windows.
4. **Add Item with AI auto-fill** — take a photo of any object, show Groq vision suggesting title/category/description/price live (this is the single most "wow" moment — confirmed working end-to-end 2026-08-24).
5. **Send a rental request** on one of Ori's/Nati's seeded items → **needs a second phone logged in as Ori or Nati, kept nearby, to approve live** inside `ChatRoomScreen` (SAS — that's the only place approval happens). Without a second device this step is narrated, not demoed live.
6. **QR pickup/return** — if the second device approved, walk through `QRDisplayScreen`/`QRScanScreen` (proximity-checked, ~10m GPS accuracy) to show the handoff mechanic. Two physical phones required for this step.
7. **Wishlist / Buy flow** as a quick aside — distinct from renting, buyer pays in person at pickup.
8. Optional, judges/reviewers only (not the public flow): a 60-second detour into the Admin Console (dispute queue, Stripe Connect payout confirmed live 2026-08-24, reports queue) to show operational depth beyond the swipe UI.

### Distribution: how people try it without an app store
Two blockers rule most "obvious" options out: (a) this app is **not Expo-Go-compatible** — `expo-camera`'s custom plugin config, `@stripe/stripe-react-native`, `expo-local-authentication`, and `expo-apple-authentication` all need a real native build; (b) there is **no paid Apple Developer account** ($99/yr — same blocker already noted for Sign in with Apple), which rules out TestFlight and ad-hoc iOS distribution outright, since both require Apple's device/app signing program.

| Option | iOS | Android | Verdict |
|---|---|---|---|
| **TestFlight** | Needs paid Apple Dev account enrolled (not done) | N/A | Best iOS UX (real install link, no cert warnings) **if** the account gets enrolled before demo day — internal testing skips App Review, is near-instant once enrolled |
| **EAS Build, `internal` distribution → direct APK link** | N/A | Works today, $0, no account needed | **Recommended for Android** — `eas build -p android --profile preview`, share the resulting URL or a QR code to it; installer just needs "install unknown apps" allowed once |
| **Ad-hoc iOS build (.ipa link)** | Still needs a paid account to register device UDIDs for signing | N/A | No cheaper than TestFlight — same account requirement, worse UX. Skip. |
| **PWA (web build)** | N/A | N/A | **Not viable** — QR handoff (camera) and payments (Stripe native SDK) are core features with no web equivalent in this stack; a web build would only show a crippled fraction of the app. Don't invest time here. |
| **Loaner physical phones, pre-installed via USB** | $0, works today (existing `expo run:ios --device` workflow, cert already trusted) | $0, works today | **Recommended fallback for iOS** — bring the existing dev iPhone(s)/Galaxy pre-built, let visitors try it hands-on at the table instead of installing on their own phone |

**Recommendation given the time left before demo day:** build the Android APK now (zero blockers) and lead with it as the "take it home" link; for iOS, decide this week whether the $99 Apple Developer enrollment is worth it for TestFlight — if not, rely on loaner devices at the booth. `eas.json`/EAS project setup doesn't exist yet in this repo — needs a first-time `eas build:configure` before the Android build can run.

---

## 🔍 Code review prep — architecture/type-safety pass complete (2026-08-26)

A professional review of this codebase is coming. The full plan (see `/Users/perelmaister/.claude/plans/sleepy-hugging-crystal.md` for the original phased writeup) is done, on branch `cleanup/pre-review` — **needs merging into `main` before the review**. Summary of what shipped:

### ✅ Done
- **Supabase generated types wired in.** `src/types/database.ts` (via `supabase gen types typescript`) + `createClient<Database>(...)` in `supabase.ts`. Fixed the ~23 compile errors this surfaced (null->undefined on optional RPC args, typed dynamic-key conversation updates, a couple of small local types for RPCs that `returns json` in Postgres) — zero behavior change, `tsc --noEmit` clean throughout.
- **`any` cleanup**: 55 -> 41, all remaining are `catch (e: any)` blocks (deliberately deferred, see below). Fixed: `auth.service.ts`'s `Session` type, `ReviewsListScreen`/`SupportThreadScreen`'s nav prop type, and every Supabase query-result `any` (most just type-checked for free once the generated types existed).
- **Cross-screen duplication extracted**: `formatShortDate`/`formatDateRange`/`formatPrice` added to `src/utils/format.ts` (was hand-rolled in 3+13 files respectively — including 3 template-literal sites the first JSX-only grep pass missed); `src/hooks/useAdminList.ts` (second hook in the codebase) replaces the identical "RPC call + loading + error Alert + setData" boilerplate across all 6 admin screens, flexible enough via an optional `transform` to cover the 2 screens that mint signed photo URLs and the 1 that takes a dynamic search param — a bug in its first draft (an option object in a `useCallback` dependency array, which would've re-fetched on every render instead of just on focus) was caught and fixed before it shipped.
- **Real bug fixed, not just a refactor**: `PublicProfileScreen`'s rental approve/reject shortcut was calling `supabase.from('transactions').update(...)` directly instead of routing through `ChatRoomScreen`'s canonical `handleApprove`/`handleReject` — silently skipping the chat system-message and unread-badge side effects, contradicting this project's own mandatory SAS rule. Fixed via the same route-param pattern already used for `declineTransactionId`/`reportIssueTransactionId`. **Verified end-to-end on the Galaxy**: created a real pending rental request, approved it via "View profile," confirmed in the database that the system message fired correctly. Caught and fixed one bug during that verification too (wrong navigator name, `'ChatsStack'` vs the actual `'Chats'`) — the failed nav left the transaction correctly untouched, confirming no partial state was ever written.
- **`ChatRoomScreen.tsx`: 1913 -> 1567 lines.** Extracted the module-level constants/types, 8 pure formatting helpers, and the styles factory into `ChatRoomScreen.constants.ts`/`.helpers.ts`/`.styles.ts` — all zero-closure content, moved verbatim (the helpers explicitly byte-for-byte, per their own comments warning they must agree with server-side day-math in `charge-late-fee`/`refund-payment`). Verified pixel-identical rendering on-device before/after.
- **Terminology fixes**: unified QRDisplayScreen/QRScanScreen's handoff screen titles ("Pickup Handoff"/"Return Handoff", was inconsistent "Pickup"/"Return" vs "Hand Off"/"Complete Return"); "Fine amount" -> "Penalty amount" in AdminOverdueScreen (matching every other label on that card); RatingScreen's "Submit Rating" -> "Submit Review" (matching its own "Leave a review" field and how output is shown downstream); "Contact UseIT" -> "Get Help" per Ori's explicit call (was a near-homonym for "Message UseIT," one specific option inside that same modal that does something different) — also fixed AdminHomeScreen's Support Inbox description to match AdminSupportInboxScreen's own copy.
- **The two ✅ items already logged above**: Switch User gated behind `__DEV__`, Google Maps API key working.

### Architecture — the honest remaining picture
**Good, worth pointing out to reviewers proactively:** every table has RLS enabled (except `public.spatial_ref_sys`, a PostGIS reference table with no user data); all cross-cutting rules (SAS actions, security-sensitive checks) are enforced in Postgres RPCs, not just the UI; migrations are fully tracked; the categories single-source-of-truth is a real, recent fix.

**What's still true, deliberately not fully solved this pass:** `src/screens/` is still the large majority of the codebase by line count, and `ChatRoomScreen.tsx` (still ~1,567 lines) is still by far the largest single file — the rental-card render branch (~225 lines, largest prop surface in the file), the rental action handlers (wired into the SAS route-param mechanism), and the data-load+realtime-subscribe effect (a documented "cannot add postgres_changes after subscribe()" failure mode) were all explicitly left alone. This repo has **zero test coverage**, so touching those without a test suite to catch a regression was judged not worth the risk this close to Demo Day and the review — flag this reasoning directly to reviewers if asked "why didn't you refactor further."

### Code standards — remaining gaps
- **No tests at all** — no test files, no test runner, no CI. Will very likely be the first thing reviewers flag. Not fixed — a handful of tests around `src/services/*`, the Impact Score calc, or refund tiering would at least show intent.
- **41 occurrences of `catch (e: any)`** — deliberately deferred (see the "explicitly out of scope" note in the original plan): cosmetic only, ~20-file diff surface, no functional upside since nothing downstream depends on the caught value's type. If ever done: one `getErrorMessage(e: unknown)` helper in `src/utils/errors.ts`, applied in small verified batches, not before Demo Day.
- **Prettier still not set up** — lower priority than lint (already done), no formatting-drift symptom yet.
- ✅ **The 4 terminology items — resolved (2026-08-26).** Ori confirmed all 4 should be unified; done and pushed:
  1. Dispute-flow entry points ("Report an issue," "Report Damage Instead," already "Report a Problem") all now say **"Report a Problem"**; the final submit button renamed "Submit Dispute" → **"Submit Report"** to match.
  2. "Item not as described" was reused for two unrelated things (reporting a user vs. declining a rental at pickup) — this one's the reverse pattern, so it was fixed by *differentiating* instead of unifying: the user-report reason is now **"Misleading listings"**, the pickup-decline button's wording left alone since its own screen context already makes it clear.
  3. Listing moderation's "Reject"/"Rejected" unified to **"Decline"/"Declined"**, matching the term already dominant for rental-request moderation everywhere else. Identifiers (`rejectingId`, `admin_reject_item`, `rejection_reason` column) deliberately left alone — copy-only.
  4. Wishlist toggle's "Saved" → **"Wishlisted"**, matching the noun used everywhere else in the feature.
  - `tsc`/lint clean throughout. **Not yet verified on-device** — the Galaxy disconnected mid-session for this last batch; worth a quick visual check next session (Item Detail's wishlist heart, the Get Help → Report a Problem flow, and Admin Items' Decline button are the 3 easiest spots to eyeball).
- **Duplicate `messageParty` in `AdminOverdueScreen`/`AdminDisputesScreen`** — still open, tracked in the Backlog section below, small and easy to knock out if there's time.

---

# Backlog

### Q. Bulk photo scan — auto-fill multiple items from one photo
- Distinct from S (done) — one photo of a *pile* of objects → a review sheet of multiple detected items, each submitted through the same existing per-item Save path. Not started.

### V. Gate QR handoff to the rental dates
- Explicitly deferred while testing wants always-available QR buttons. Final version: enforce server-side in `ensure_qr_token`/`scan_qr_handoff` that pickup is only reachable on/after `start_date` and return on/after `end_date` — hiding the button alone isn't enough, the RPC must be the authority.

### Y. Proximity check — GPS accuracy (root cause fixed, refinement still open)
- Root cause found and fixed 2026-08-11: `Location.Accuracy.Balanced` (~100m error) was being compared against a 50m threshold. Both QR screens now use `Location.Accuracy.High` (~10m). **Still open:** consider refusing a handoff when reported `accuracy` is worse than ~30m, or widening the effective limit by the two reported accuracy radii instead of a flat 50m. Don't tighten the 50m constant without this — it's the only thing absorbing normal GPS error.

### L. Google Cloud account hardening (operational, not code)
- Before Free Trial expiry: Hard Quotas (1000/day) on Places + Geocoding APIs, a $1 Budget Alert (50/90/100%), activate full billing only after both are in place.

### New: extend biometric read-only enforcement beyond the two core actions
- Currently gated: Add Item submit, rental request, Buy. Not gated: chat messages, ratings, wishlist, reviews, reports, and everything else that writes data. No existing single choke point for all writes — would mean touching most screens individually. Not urgent, but a real gap between what the spec implies ("read-only mode") and what's actually enforced.

### New: `AdminOverdueScreen`/`AdminDisputesScreen` duplicate `messageParty`
- Noticed in passing, not fixed: identical client-side function copy-pasted in both screens (both correctly delegate to the shared `admin_ensure_support_thread` RPC, so no behavioral bug — just avoidable duplication).

---

## Dev environment notes (so this isn't re-derived)
- **Two-device rig**: iPhone = Ori/lender, Galaxy = Nati/renter. **Keep the Galaxy on USB** — `adb reverse` tunnels Metro over the cable; unplugged, it silently runs a stale bundle while still looking like it works. Android toolchain is Zulu JDK 17 + command-line tools only, no Android Studio — `ANDROID_HOME` isn't set by default in a fresh shell, export it explicitly: `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.
- **`npx expo run:ios/run:android --device` needs an exact device identifier, and it's not the adb serial.** For iOS, use the UDID from `xcrun xctrace list devices` (e.g. `00008101-00195CAA0CE9003A`), not the friendly name. For Android, use the `model:` field from `adb devices -l` (this session's Galaxy: `SM_G781B`) — the adb serial (`RFCNC0B0PEW`), the raw hostname (`ORI's Galaxy S20 FE 5G`), and a bare `--device` with no value (still prompts interactively) all fail with `Could not find device`.
- **iPhone builds expire after 7 days** (free Apple personal team). Re-run `npx expo run:ios --device <UDID>` on USB to refresh, then trust the new certificate on-device at Settings → General → VPN & Device Management (can't be automated). After any `expo prebuild`, re-run `plutil -remove aps-environment <ios-folder>/<target>/<target>.entitlements` — prebuild re-adds a push entitlement the free team can't sign (app only uses local notifications). **Note (2026-08-26):** app.json's `bundleIdentifier`/`android.package`/`slug`/`scheme` were all renamed SwipeAndRent → UseIT (`com.swipeandrentapp`→`com.useitapp`, see the rebrand entry above) — the next `expo prebuild` will regenerate the iOS project folder under the new name (`ios/UseIT/UseIT.entitlements` or similar, not the old `ios/SwipeAndRent/...` path this command used to reference) — check the actual generated path rather than assuming.
- **New native modules added 2026-08-24** (`expo-local-authentication`, `expo-apple-authentication`) required a fresh native rebuild on both devices — same command as above, just needed again since these can't be picked up by a JS-only Metro reload. Confirmed both rebuilds succeeded live.
- **Migrations are tracked in `supabase/migrations/`** — every schema change has a corresponding file in the repo.
- Supabase MCP access token lives in `~/.claude.json`'s `supabase` entry env block. If MCP calls return `Unauthorized`, regenerate at supabase.com/dashboard/account/tokens, re-add with `claude mcp add supabase -s user -e SUPABASE_ACCESS_TOKEN=... -- npx -y @supabase/mcp-server-supabase@latest`, restart Claude Code.
- **Pulling a screenshot directly off the Galaxy**: `adb shell "ls -t /sdcard/DCIM/Screenshots | head -3"` then `adb pull /sdcard/DCIM/Screenshots/<name> <local path>` — faster than asking Ori to send it manually. Needs the device authorized for USB debugging first (`adb devices -l` shows `unauthorized` until the on-device prompt is accepted).

## ⚠️ CRITICAL — Read this before writing any code: SAS Design Principle
This codebase follows **Single Action Source (SAS)**, mandatory for every feature: every action has **one canonical screen** where it executes; every other entry point is a navigation shortcut into that screen, never a duplicate of the logic.

**Examples already in the codebase:**
- Approve / Decline / Cancel / Pay a rental → always inside `ChatRoomScreen`. `ManageItemScreen`/`MyRentalsScreen`/`MyItemsScreen` show status but navigate there for any action.
- Edit / Delete an item → always `EditItemScreen`.
- City selection → always the `CityPicker` component.
- Report a problem / message UseIT → always the shared dispute-disclaimer modal in `ChatRoomScreen`.
- Ban/unban a user → always `AdminUsersScreen`; the Reports queue navigates there rather than implementing its own ban button.
- Security rules that must never be bypassable belong in the database (an RPC or RLS policy), not just hidden in the UI — see the admin-can't-message-themselves fix above for why: a UI-only guard is one missed button away from a real bug.

Before adding any button that performs an action: "Is there already a canonical screen for this?" If yes, navigate there — don't copy the logic. This is why a flow change (e.g. adding a step) only needs updating in one place.

## Also good to know: Badge Jump
A status-changing action (approval, payment, cancellation, admin ruling) inserts a system message into the chat, which triggers an unread badge. Tapping the badge auto-navigates to the right chat/tab and flashes the relevant card with a blue glow. Any new status-change must route through `insertSystemMessage()` (or the shared `src/services/chatMessages.ts` helper) so this happens automatically.

## ⚠️ Lesson worth keeping: verify in the database, not the UI
Multiple real bugs this project were **invisible from the app** — the screen showed success while an RLS-blocked update silently affected zero rows (supabase-js reports no error for this), or a double-tap raced past an in-flight guard. None were findable by tapping through the app. After any flow that writes data, query the table directly.

## Also good to know: `error.message` from `supabase.functions.invoke` lies
supabase-js's `FunctionsHttpError.message` is always the generic "Edge Function returned a non-2xx status code," regardless of what the function actually failed on. The real reason is in `error.context` (a `Response` object) — read it with `await error.context?.json?.()` before showing the user (or yourself) an error. Cost real debugging time twice in this session (`analyze-item-photo`, `connect-onboarding`) before being fixed at the source.

---

## Done
- **2026-08-24**: see the six ✅ sections above (admin architecture rebuild, Stripe Connect confirmed working, AI auto-fill confirmed working, full backlog sweep, real Impact Score, categories single source of truth) — the whole session, compressed here for future reference once the next session's fresh work lands on top.
- **Two-device dev setup** — iPhone 12 Pro + Galaxy S20 FE both on one Metro server; `app.json` fixes for real-device builds (Apple Pay/push entitlements stripped, `android.package` added).
- **Realtime + chat plumbing** — `transactions`/`purchases` publishing fixed (statuses were only propagating as a side effect of message inserts); short role-neutral chat-list previews; QR scan reordered to scan → checklist → photo → confirm with proximity checked at scan time; duplicate-rating and duplicate-dispute guards; Android tab-bar/keyboard-avoidance fixes across most screens.
- **H.** QR handoff — `qr_token`/`return_qr_token`, `confirm_condition`/`ensure_qr_token`/`scan_qr_handoff` RPCs, role flip fixed (pickup: lender displays/renter scans; return: renter displays/lender scans), `MeetingPointScreen` using a real `items.pickup_location` field. Verified end-to-end on two real devices.
- **Demo/theater mode fully removed** — deleted `DemoContext`/`DemoOverlay`/seed scripts/`DEMO_SCRIPT.md`; every screen runs its normal user-driven flow only.
- **A** AI Planner date-availability filtering · **B** Wishlist · **F** unified Profile redesign · **G** GPS/location feed · Edit/Delete item · Badge Jump (all 4 rental steps) · profile picture upload.
- **M** Rating persistence · item reviews (`item_reviews`, `avg_rating`/`review_count` rollup) · ChatRoomScreen Rental-tab redesign · Meeting Point using real pickup location.
- **C** Buy flow / Deal Board — separate `purchases` table + RPCs, buyer pays in person at pickup, not remotely.
- **T** all three dispute paths collect photo + description through one canonical modal; duplicate-dispute DB constraint + idempotent `report_issue`.
- **Z** `stripe_payment_intent_id` persisted on both rental and purchase payments; `refund-payment` edge function with day-based refund tiers, auditable `refunds` table, idempotent. Purchase approval parity with rentals. Sale/rental double-commit guard.
- **O** Chats split into Renting/Lending tabs · **P** all three unread signals unified into one `ConversationsContext` · Stripe payment sheet saves cards between payments.
- **K** History screen · **N** reputation scoring v1 (later fixed for role-mixing) · **E** weighted feed ranking · **U** admin console (dispute queue, item moderation, user ban/unban).
- **Dispute resolution notifies both parties**, later redesigned into pick-a-side → review → publish.
- **Damage charges + late-return penalties** — mandatory off-session Stripe auth, shared `admin_charges` primitive, automatic per-day late fee, admin-set 2-week cliff penalty, damage charge folded into dispute resolution. `admin_resolve_dispute` refund/charge atomicity fixed (auto-reopens on failure instead of vanishing).
- **UseIT support chat** — per-rental 1:1 threads, folded into the unified unread/notification system.
- **`get_feed` fixed** — a column-shadowing bug that silently broke the feed for every authenticated user.
- **Written reviews surfaced + 2 reputation bugs fixed** — role-mixing in score inputs, undercounted third-party review visibility.
- **Stripe Connect payouts + Trust Score fee discount, first version** — Express accounts, destination charges, fee math with per-side trust-tier discounts, `refund-payment` claws back transfers on refund. (Confirmed working with a real payment 2026-08-24, see above.)
- **AI auto-fill from item photo (backlog S)** — Groq vision model suggests title/category/description/price. (Confirmed working 2026-08-24, see above.)
