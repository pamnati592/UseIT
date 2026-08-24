# Next Suggested Step — For Nati 👋

## Where things stand (2026-08-24 end of session)
Huge session — docs cleanup, admin architecture rebuilt a second time (and simplified), Stripe Connect payouts confirmed working with a **real payment**, and the entire remaining pre-launch backlog swept in one pass (account deletion, GDPR export, block/report, private verification photos, biometric gate, login lockout, Sign in with Apple scaffolding, a real Impact Score, a new Clothing category). 23 commits, all pushed.

**Next suggested step:** test the stuff that still has no device confirmation — the Reports queue end-to-end (report a user → admin dismisses/manages), account deletion (careful, it's real — use a throwaway test account), and GDPR export's Share sheet. See "Testing owed" below for the full list.

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
- **iPhone builds expire after 7 days** (free Apple personal team). Re-run `npx expo run:ios --device <UDID>` on USB to refresh, then trust the new certificate on-device at Settings → General → VPN & Device Management (can't be automated). After any `expo prebuild`, re-run `plutil -remove aps-environment ios/SwipeAndRent/SwipeAndRent.entitlements` — prebuild re-adds a push entitlement the free team can't sign (app only uses local notifications).
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
