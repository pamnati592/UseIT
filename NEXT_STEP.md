# Next Suggested Step — For Nati 👋

## ✅ Admin Mode — a real separate persona, not a menu item (2026-08-19)
Two-step design that landed in this order the same day:

**Step 1 (superseded by step 2, keeping for context):** found live that Nati messaged UseIT support and Ori had no way to see it or get notified — `AdminDisputesScreen`/`AdminOverdueScreen` only surface support threads tied to a disputed or overdue transaction, but "Contact UseIT → Message UseIT" is reachable on any paid/active rental. First fix was a standalone `AdminSupportInboxScreen`, reached via a shield icon in the Chats tab header.

**Step 2 — Ori's own follow-up, reframed the whole thing:** admin shouldn't be a nested screen at all — it should be a genuinely separate app-wide persona you step into and back out of. "He's not doing anything as Ori" while in this mode. Rebuilt as:
- New `AdminModeContext` (`isAdmin`, `adminModeActive`, persisted in AsyncStorage so it survives app restarts, re-checked on every `onAuthStateChange` — critical since this app's "Switch User" feature swaps sessions without a fresh launch, so switching to a non-admin test account must immediately drop out of admin mode).
- A persistent banner in `MainTabNavigator`, above every tab regardless of which is focused, with an Exit button — the "never ambiguous which persona you're in" signal Ori asked for.
- **The old `AdminSupportInboxScreen` was deleted** — its logic moved directly into `ChatsScreen`: while Admin Mode is active, the Chats tab itself transforms (title, tab labels, and content all swap to the platform-wide support inbox, split Renters/Lenders) instead of navigating to a separate screen. The shield icon in the header now toggles the mode instead of navigating away.
- Tapping "Admin Console" in the Profile menu now calls `enterAdminMode()` before navigating to `AdminHome`, so entering admin functionality always also enters the persona.
- **Confirmed scope**: Home / AI Planner / Add Item are deliberately untouched — Admin Mode only changes what the Chats tab shows and adds the banner, it doesn't wall off the rest of the app (you can still test the renter/lender flows while "in" admin mode).
- The multi-admin sender-identity fix from step 1 is unchanged: `SupportThreadScreen` still shows real names for admin viewers only, never for a regular user's own view of their thread.

Typecheck clean, `admin_list_support_threads()` RPC verified against real data. **Not yet seen on device.**

## 🎯 Goal (set 2026-08-19): real App Store / Play Store release, not a demo
Ori's direction: stop building for "demo," build for **real public release** — real users downloading it, real feedback. Shortcuts that were fine for a course demo no longer are.

- **RTL / Hebrew UI is explicitly OUT of scope** — product-spec.pdf section 4.3 still says "Primary language: Hebrew, RTL layout on all screens," but that's superseded by this direct decision. Don't build it, don't flag its absence as a gap.
- Read the rest of the spec through a "real users, real money, real app-store review" lens.

**Gap analysis (2026-08-19), confirmed by grepping the actual codebase:**
1. **No biometric auth (FaceID/TouchID)** — spec 4.2 requires it for full access.
2. **No Stripe Connect / payouts** — money flows renter → platform Stripe account, refunded on cancel/dispute, but nothing ever pays a lender their share. **In progress, see below.**
3. **Trust Score fee discount computed but never applied** — shows on Profile, never actually charged (spec 4.10/4.12). Being wired in together with Connect (below), since both touch `create-payment-intent`.
4. **No account deletion in-app** — Apple hard-rejects without this (guideline 5.1.1v).
5. **No Sign in with Apple** — Apple requires it since Google login exists (guideline 4.8).
6. **No GDPR data export/deletion, no login rate-limiting** (spec 5.2).
7. **`AddItemScreen`'s "Go Live (Testing Only)" button skips admin moderation entirely** — fine for dev, can't ship.
8. **Free Apple developer account** (7-day build expiry, no push entitlement) — App Store distribution needs a paid Apple Developer Program membership ($99/yr) and Google Play Developer account ($25 one-time). **Ori's own accounts to create — not buildable from here.**
9. Backlog **AA** (block/report user) and **AB** (verification photo in a public bucket) matter more now — real user-safety gaps for a public app.

## ✅ Stripe Connect payouts + fee discount, first version shipped (2026-08-19)
Real Express-account payouts for lenders via destination charges, plus the Trust Score fee discount (spec 4.12) applied for the first time — both land in `create-payment-intent` together since they share the same math.

- `profiles.stripe_connect_account_id` / `stripe_connect_charges_enabled` / `stripe_connect_details_submitted`. `connect-onboarding` creates/reuses an Express account (capability: `transfers` only — card acceptance stays on the platform's own PaymentIntent) and returns a Stripe-hosted Account Link. `refresh-connect-status` re-fetches real status on the app's own deep-link return (`swipeandrent://connect-return`, via `expo-web-browser`'s `openAuthSessionAsync` — no app-wide Linking listener needed) rather than a webhook, since no signing secret is configured in the Stripe dashboard. **Trade-off:** a status change the user causes entirely outside the app won't be caught until they reopen it.
- `create-payment-intent` (rental branch) now **blocks payment entirely** if the lender hasn't finished onboarding (`stripe_connect_charges_enabled` false) — a real, deliberate behavior change: **no rental payment will succeed until its lender has set up payouts.** `ProfileScreen` has the new "Set Up Payouts" card for this.
- Fee math: `BASE_FEE_PERCENT = 5` per side (10% combined at zero discount) — **a placeholder, spec 4.12 never states a base rate**, worth real business input before this handles real money. Each side's own trust tier discounts their own share (renter's `renter_score`, lender's `lender_score`) — a renter pays `base_price + their_fee`; the lender's fee comes out of their transfer; both captured in one `application_fee_amount` (Stripe's only lever for this on a destination charge). The response includes a `fee_breakdown` object — **not yet surfaced in any payment-screen UI**, spec 4.10 wants it shown before confirmation.
- `refund-payment` now passes `reverse_transfer: true` + `refund_application_fee: true` so a refund actually claws back the transferred lender share and the platform's fee too, not just what's left in the platform's own balance. Harmless no-op on older payment intents with no associated transfer.
- **Scope note:** only rentals go through Connect right now, not purchases (the Buy flow) — a purchase's seller has the identical never-gets-paid problem, just not fixed in this pass.
- **Not yet tested against the real Stripe API** — same standing constraint as always, no way to mint a real authenticated session from here. **Both Ori and Nati need to complete "Set Up Payouts" from their Profile before any more rental payments can be tested** — this is the first real thing to try.

## ⚠️ Testing owed on everything from 2026-08-19 (nothing below confirmed on device except where noted)
- Dispute resolution's pick-a-side → review → publish redesign (`AdminDisputesScreen`)
- Reviews screens (`ReviewsListScreen` — item reviews + profile reviews-by-role) and the two reputation-scoring bug fixes (role-mixing in `recompute_lender_score`/`recompute_renter_score`; third-party visibility via `list_role_reviews`)
- Overdue card simplification (Late Return pill + ⓘ, merged "Contact UseIT" button) and the matching Resolved-dispute pill + ⓘ
- Support-thread notifications in the Chats list (unread badges, "UseIT Support" rows)
- **Confirmed fixed today**: Android keyboard covering Publish Ruling/Charge Penalty in `AdminDisputesScreen`/`AdminOverdueScreen` (both had no `KeyboardAvoidingView` — built after the original Aug 9 keyboard sweep, so they never got it). Admin-charge reopen-on-refund-failure logic also confirmed working live (a refund correctly failed on a synthetic no-payment transaction, auto-reopened the dispute, retried as Favor Lender, resolved cleanly).

## 🚧 Backlog S in progress — AI auto-fill from the item's own photo
Single-item auto-fill only (Q, the bulk multi-item photo scan, is still separate and not started).
- `analyze-item-photo` edge function sends the cover photo to Groq's vision model (`qwen/qwen3.6-27b` — **re-check this model name first** if it starts failing, Groq's vision lineup shifts often and I can't self-test an authenticated edge function), asks for `{title, category, description, daily_price}` as strict JSON, clamps `category` to the real list.
- `AddItemScreen` shows an "Auto-fill with AI" button once a photo is added — fills the form, stays fully editable, doesn't touch the Save path (SAS).
- **Completely unverified against the real Groq API** — needs an on-device test: add an item, photo something recognizable, tap Auto-fill, check if the result is sane.

---

# Backlog

### R. Real Impact Score formula
- Confirmed wanted eventually, explicitly not now. `QRDisplayScreen`/`QRScanScreen` show a hardcoded fake "Impact Score" — should show the real Trust Score instead (cheap swap, gap analysis above) as a stopgap; a real CO2 formula is out of MVP scope per CLAUDE.md section 6.

### Q. Bulk photo scan — auto-fill multiple items from one photo
- Distinct from **S** (now in progress) — one photo of a *pile* of objects → a review sheet of multiple detected items, each submitted through the same existing per-item Save path. Not started.

### V. Gate QR handoff to the rental dates
- Explicitly deferred while testing wants always-available QR buttons. Final version: enforce server-side in `ensure_qr_token`/`scan_qr_handoff` that pickup is only reachable on/after `start_date` and return on/after `end_date` — hiding the button alone isn't enough, the RPC must be the authority.

### AA. Block/Report user is not persisted anywhere ⚠️
- No `reports` table, no client-facing report/block button anywhere (confirmed via `information_schema.tables`). Needs a `reports` table, a "Report User" action (likely `PublicProfileScreen`), and an admin queue. Separate from `admin_set_user_banned` (the enforcement action already built) — this is the missing intake.

### AB. Verification photo lives in the public storage bucket
- `AddItemScreen` uploads `verification_image_url` to the public `item-images` bucket; spec 4.7 says admin-only. Real fix: move to a private bucket (`handoff-evidence` pattern), switch to `signedUrlFor` at display time, migrate existing uploads.

### Y. Proximity check — GPS accuracy (root cause fixed, refinement still open)
- Root cause found and fixed 2026-08-11: `Location.Accuracy.Balanced` (~100m error) was being compared against a 50m threshold. Both QR screens now use `Location.Accuracy.High` (~10m). **Still open:** consider refusing a handoff when reported `accuracy` is worse than ~30m, or widening the effective limit by the two reported accuracy radii instead of a flat 50m. Don't tighten the 50m constant without this — it's the only thing absorbing normal GPS error.

### L. Google Cloud account hardening (operational, not code)
- Before Free Trial expiry: Hard Quotas (1000/day) on Places + Geocoding APIs, a $1 Budget Alert (50/90/100%), activate full billing only after both are in place.

---

## Dev environment notes (so this isn't re-derived)
- **Two-device rig**: iPhone = Ori/lender, Galaxy = Nati/renter. **Keep the Galaxy on USB** — `adb reverse` tunnels Metro over the cable; unplugged, it silently runs a stale bundle while still looking like it works. Android toolchain is Zulu JDK 17 + command-line tools only, no Android Studio (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`).
- **iPhone builds expire after 7 days** (free Apple personal team). Re-run `npx expo run:ios --device` on USB to refresh, then trust the new certificate on-device at Settings → General → VPN & Device Management (can't be automated). After any `expo prebuild`, re-run `plutil -remove aps-environment ios/SwipeAndRent/SwipeAndRent.entitlements` — prebuild re-adds a push entitlement the free team can't sign (app only uses local notifications).
- **Migrations are tracked in `supabase/migrations/`** as of this session (previously several were live-DB-only; that gap is closed — every schema change from 2026-08-13 onward has a corresponding file in the repo).
- Supabase MCP access token lives in `~/.claude.json`'s `supabase` entry env block. If MCP calls return `Unauthorized`, regenerate at supabase.com/dashboard/account/tokens, re-add with `claude mcp add supabase -s user -e SUPABASE_ACCESS_TOKEN=... -- npx -y @supabase/mcp-server-supabase@latest`, restart Claude Code.

## ⚠️ CRITICAL — Read this before writing any code: SAS Design Principle
This codebase follows **Single Action Source (SAS)**, mandatory for every feature: every action has **one canonical screen** where it executes; every other entry point is a navigation shortcut into that screen, never a duplicate of the logic.

**Examples already in the codebase:**
- Approve / Decline / Cancel / Pay a rental → always inside `ChatRoomScreen`. `ManageItemScreen`/`MyRentalsScreen`/`MyItemsScreen` show status but navigate there for any action.
- Edit / Delete an item → always `EditItemScreen`.
- City selection → always the `CityPicker` component.
- Report a problem / message UseIT → always the shared dispute-disclaimer modal in `ChatRoomScreen`.

Before adding any button that performs an action: "Is there already a canonical screen for this?" If yes, navigate there — don't copy the logic. This is why a flow change (e.g. adding a step) only needs updating in one place.

## Also good to know: Badge Jump
A status-changing action (approval, payment, cancellation, admin ruling) inserts a system message into the chat, which triggers an unread badge. Tapping the badge auto-navigates to the right chat/tab and flashes the relevant card with a blue glow. Any new status-change must route through `insertSystemMessage()` (or the shared `src/services/chatMessages.ts` helper) so this happens automatically.

## ⚠️ Lesson worth keeping: verify in the database, not the UI
Multiple real bugs this project were **invisible from the app** — the screen showed success while an RLS-blocked update silently affected zero rows (supabase-js reports no error for this), or a double-tap raced past an in-flight guard. None were findable by tapping through the app. After any flow that writes data, query the table directly.

---

## Done
- **Two-device dev setup** — iPhone 12 Pro + Galaxy S20 FE both on one Metro server; `app.json` fixes for real-device builds (Apple Pay/push entitlements stripped, `android.package` added).
- **Realtime + chat plumbing** — `transactions`/`purchases` publishing fixed (statuses were only propagating as a side effect of message inserts); short role-neutral chat-list previews; QR scan reordered to scan → checklist → photo → confirm with proximity checked at scan time; duplicate-rating and duplicate-dispute guards; Android tab-bar/keyboard-avoidance fixes (`LoginScreen`, `AIPlannerScreen`, `ChatRoomScreen`, `PhoneVerificationScreen`, `OnboardingScreen`, `RatingScreen`, and — 2026-08-19 — `AdminDisputesScreen`/`AdminOverdueScreen`).
- **H.** QR handoff — `qr_token`/`return_qr_token`, `confirm_condition`/`ensure_qr_token`/`scan_qr_handoff` RPCs, role flip fixed (pickup: lender displays/renter scans; return: renter displays/lender scans), `MeetingPointScreen` using a real `items.pickup_location` field. Verified end-to-end on two real devices.
- **Demo/theater mode fully removed** — deleted `DemoContext`/`DemoOverlay`/seed scripts/`DEMO_SCRIPT.md`; every screen runs its normal user-driven flow only.
- **A** AI Planner date-availability filtering · **B** Wishlist · **F** unified Profile redesign · **G** GPS/location feed (`profiles.location`, `get_feed` radius+distance, `CityPicker`, radius chips) · Edit/Delete item · Badge Jump (all 4 rental steps) · profile picture upload.
- **M** Rating persistence (`ratings` table, recomputes scores) · **item reviews** (`item_reviews` table, `avg_rating`/`review_count` rollup) · ChatRoomScreen Rental-tab redesign (status board, not chat bubbles) · Meeting Point using real pickup location.
- **C** Buy flow / Deal Board — separate `purchases` table + RPCs, buyer pays in person at pickup, not remotely.
- **Backlog T** — all three dispute paths (chat, QRDisplay, QRScan) collect photo + description through one canonical modal; duplicate-dispute DB constraint + idempotent `report_issue`.
- **Backlog Z** — `stripe_payment_intent_id` persisted on both rental and purchase payments; `refund-payment` edge function with day-based refund tiers (full before start day, 25% on/after), auditable `refunds` table, idempotent. Purchase approval parity with rentals (seller must approve before payment). Sale/rental double-commit guard on `approve_purchase`.
- **Backlog O** Chats split into Renting/Lending tabs · **P** all three unread signals (red/yellow/green) unified into one `ConversationsContext`, fixing a real race condition and two missed-resync bugs · Stripe payment sheet saves cards between payments.
- **Backlog K** History screen (Renting/Lending, merges transactions + sold purchases) · **N** reputation scoring v1 (weighted-recency + behavioral blend, later found to mix lender/renter ratings — fixed 2026-08-19) · **E** weighted feed ranking (distance/lender-score/interest/recency) · **U** admin console (dispute queue, item moderation, user ban/unban, `is_admin()`-gated RPCs).
- **Dispute resolution notifies both parties** (system message + Badge Jump on ruling) — later redesigned 2026-08-19 into pick-a-side → review → publish, with the ruling shown behind a status-pill ⓘ instead of a permanent paragraph.
- **Damage charges + late-return penalties** (2026-08-16) — mandatory off-session Stripe auth on rental payments, shared `admin_charges` off-session-charge primitive, automatic per-day late fee on return scan, admin-set 2-week cliff penalty (`AdminOverdueScreen`), damage charge folded into dispute resolution. Found and fixed: `admin_resolve_dispute` + the refund/charge step aren't atomic — a failed refund used to leave a dispute silently "resolved" with no money moved and invisible in the queue forever; now auto-reopens instead.
- **UseIT support chat** (2026-08-16/17) — per-rental 1:1 threads (renter↔admin, lender↔admin, not a 3-way room), later folded into the same unified unread/notification system real conversations use (own row in Chats, badges, Badge Jump) instead of requiring the user to stumble into it from the rental card.
- **`get_feed` fixed** (2026-08-17) — `RETURNS TABLE(id uuid, ...)` shadowed `profiles.id`, silently breaking the feed for every authenticated user since backlog E shipped; the one prior "verified live" test must have run unauthenticated.
- **Written reviews surfaced + 2 reputation bugs fixed** (2026-08-19) — `ReviewsListScreen` (item reviews + profile reviews-by-role); fixed lender/renter score inputs being mixed (no role check against the transaction) and profile review counts silently undercounting for third-party viewers (`transactions` RLS scoped to its own parties — new `list_role_reviews` RPC returns only review fields, works for anyone).
