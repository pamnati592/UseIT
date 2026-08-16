# Next Suggested Step — For Nati 👋

## ✅ Backlog O — Chats tab split by role (2026-08-16)
`ChatsScreen` now has two sub-tabs, **Renting** and **Lending**, matching the backlog spec exactly: a conversation is Renting if `conversations.renter_id = auth.uid()`, Lending if `conversations.lender_id = auth.uid()` (no join needed — `lender_id` already mirrors `items.owner_id` at conversation-creation time, same field `ChatRoomScreen` already keys `isLender` off). Each sub-tab shows its own unread count as a badge on the tab pill; the bottom tab bar's overall unread badge is untouched since `useUnreadCount` was already role-agnostic (sums both `renter_id` and `lender_id` conversations). Per-tab empty states differ ("No rentals yet" vs "No listings rented out yet"). `ChatRoomScreen` itself wasn't touched — only the list leading into it was split (SAS). **Not yet tested on a real device.**

## ✅ Meeting Point test data (2026-08-16)
Set `pickup_location = 'Dizengoff Center, Tel Aviv-Yafo'` on **PlayStation 5 + 2 Controllers** (`53c77124...`, owned by Ori) purely so there's a live `paid` rental (Sep 16–19, Nati renting) to test the Meeting Point screen against. Not real listing data.

## ✅ Provisioning profile expiry — fixed manually this session (2026-08-16)
`npx expo run:ios --device` failed with "No profiles for 'com.swipeandrentapp' were found" — the expected 7-day free-account signature expiry. Fixed by running `xcodebuild ... -allowProvisioningUpdates` directly (Xcode minted a fresh profile non-interactively) and installing via `xcrun devicectl device install app`. One step still needed **manual, on-device action**: iOS refused to launch the freshly-signed app until the developer certificate was trusted at **Settings → General → VPN & Device Management → Trust**. That trust step can't be automated — it needs a human tapping the device.

## ✅ Dispute photo made optional (2026-08-13)
User feedback: the dispute Submit button required both a photo *and* a description before it would enable. Not every dispute is about a damaged item (no-show, wrong item, payment issue, etc.), so requiring a photo for all of them was wrong. Now only the description is required to submit — the photo picker stays, with copy nudging the user to add one specifically when something is damaged, but it no longer blocks submission. `confirmDispute()` already handled a null photo gracefully (uploads only `if (disputePhotoAsset?.base64)`), so this was a UI-gating-only change.

**Reminder:** the iPhone build will expire again ~7 days after the last `npx expo run:ios --device` (free Apple personal team signing limit) — "X Is No Longer Available" on the home screen means it's time to re-run that command with the phone on USB.

## ✅ Self-unread-badge bug fixed (2026-08-13)

User report: approving a rental lit up their *own* unread badge as if a new message had arrived, and briefly showed a phantom "waiting" indicator in Chat after leaving Deal Board. Root cause: `send()` (typed chat messages) always re-marks the sender's own `*_last_read_at` after bumping `conversations.last_message_at` — but `insertSystemMessage()` (used by every status-change action: approve/reject/pay/cancel/decline/dispute) never did, so the actor's own last-read timestamp fell behind their own action's timestamp. Same gap existed in `handleApprovePurchase`/`handleRejectPurchase`, whose RPCs bump the conversation preview server-side. Fixed by calling `markAsRead(currentUserId)` + `chatBus.notify()` in all three places, mirroring `send()`. **Not yet tested on a real device** — verify next: approve/pay/cancel a rental and confirm no self-badge appears, then check the Chats list right after leaving Deal Board.

## Resume here

**Context:** DB access is via the Supabase MCP. The access token was rotated on **2026-08-13** and now lives in the `env` block (`SUPABASE_ACCESS_TOKEN`) of the `supabase` entry in `~/.claude.json`, not as a `--access-token` flag. If MCP calls return `Unauthorized`, the token has expired again — regenerate at https://supabase.com/dashboard/account/tokens and re-add with `claude mcp add supabase -s user -e SUPABASE_ACCESS_TOKEN=... -- npx -y @supabase/mcp-server-supabase@latest`, then **restart Claude Code** (MCP servers only read config at startup).

## ✅ Backlog Z step 1 is closed — PaymentIntent persistence proven on both paths (2026-08-13)

One real rental payment and one real purchase payment were made on the iPhone and verified in the table, not the UI:

```
transactions: id 304273bf-... · status paid · stripe_payment_intent_id pi_3U3uZwHZSeCIslMV0MjlWzqB
purchases:    id 5d760f74-... · status paid · stripe_payment_intent_id pi_3U3uxaHZSeCIslMV0FW8i3OU
```

**Next: step 2, the `refund-payment` edge function**, calling `stripe.refunds.create`, then the 24h/4h tier calculation from spec 4.10, then a refund record for auditability. Existing pre-2026-08-13 rows are still unrecoverable (no intent id was ever captured for them) — that's unchanged.

### 🆕 Purchases now require seller approval before payment (2026-08-13, unplanned but requested mid-session)
Found while doing the Z verification: purchases had **no approval step at all** — `create_purchase` went straight to a payable "pending" state, unlike rentals which need an explicit lender approval first. User asked for parity. Added:
- `purchase_status` enum gained `approved` / `rejected` (migration `purchase_approval_enum.sql` — enum values had to land in their own transaction before anything could reference them, per Postgres rules).
- New RPCs `approve_purchase` / `reject_purchase` (seller-only, mirrors `cancel_purchase`'s SECURITY DEFINER pattern) in `purchase_approval_rpcs.sql`. `mark_purchase_paid` now requires `status = 'approved'` (was `'pending'`); `cancel_purchase` now allows either `pending` or `approved`.
- `ChatRoomScreen.tsx`: seller sees Approve/Decline on a pending purchase (same styling as the rental Approve/Decline buttons); buyer sees a waiting message until approved, then the existing "I Have the Item — Pay Now" button.

**Two real bugs found and fixed while testing this end-to-end:**
1. **Purchase payment always failed with "Purchase is not pending"** — `create-payment-intent/index.ts` still gated the purchase branch on `status !== 'pending'`, never updated to match the new `'approved'` gate. This was the actual blocker, not a stale client bundle (that was my wrong first guess — cost a round trip). Fixed and redeployed, **now version 8**.
2. **Duplicate Buy requests** — tapping Buy twice on the same item created two separate purchase rows with no dedup, unlike rentals. `create_purchase` (migration `purchase_dedupe_request.sql`) now checks for an existing `pending`/`approved` purchase from the same buyer on the same item first and returns that one instead of inserting a duplicate — the client already just navigates wherever the RPC points it, so no client change was needed.
3. **Side finding, same session:** `create_purchase`'s "wants to buy" message (and the new approve/reject messages) were being inserted into `public.messages` with `transaction_id = null`. `messages.transaction_id` has a hard FK to `transactions(id)` — it can never point at a `purchases` row — so these rows were indistinguishable from real chat and leaked into the plain Chat tab. Fixed (migration `purchase_events_no_chat_leak.sql`): purchase lifecycle events now only update `conversations.last_message`/`last_message_at` for the preview/badge; the Deal Board card doesn't need a message row since it already has its own realtime subscription directly on `purchases`.

**Test data note:** `items.sale_price` was `null` on every single item — nothing was buyable. `cc000000-0000-0000-0000-000000000004` (Bosch Power Drill Set, owned by Nati) was given `sale_price = 350` directly via SQL purely so the purchase flow had something to test against. It's since gone through two test purchase cycles and is now `paid`/`is_hidden = true` (sold). Not a real listing — don't treat its price as product data.

## ✅ Backlog Z step 2 is done — `refund-payment` edge function shipped (2026-08-13)

- New `refunds` table (transaction_id unique, amount, percentage, reason, stripe_refund_id, RLS-scoped to the two parties) — every refund is now auditable, not just a Stripe API call nobody can trace back.
- New edge function `refund-payment` (v2): computes the refund tier from `start_date`, calls `stripe.refunds.create`, records the row. Idempotent — a retry returns the existing refund instead of double-refunding (also enforced at the DB level: `refunds.transaction_id` is `unique`).
- **Policy revised mid-session (2026-08-13):** the original hour-based tiers (24h/4h from spec 4.8) don't fit day-granularity rentals — `start_date`/`end_date` are stored as midnight-of-day, not exact instants. Replaced with a day-based policy: cancel before the rental's start day → full refund; cancel on (or after) the start day → 25% refund (75% charged). Both `refund-payment` and the client's confirmation-dialog preview (`refundTierLabel`) now compare calendar-day strings (`dayKey()`), not millisecond timestamps.
- Three real bugs fixed on the way, found because the refund feature made them visible:
  1. `canCancelTx` was **blocking Cancel entirely** under 48h before `start_date` — contradicted the policy, which expects cancellation to always be possible, just at a shrinking refund %.
  2. `handleCancel`'s `isPaid` check tested `tx.status === 'active'`, but money is taken at `'paid'` — and there's no Cancel button once a rental reaches `'active'` (confirmed: cancellation is only ever meaningful pre-pickup, once the item is physically handed over it's dispute territory, not cancellation). Fixed to check `'paid'`.
  3. **After the day-based rewrite**, `canCancelTx`'s first pass (`end_date > Date.now()`) broke same-day rentals specifically: a rental with `start_date = end_date = today at 00:00 UTC` already looks "in the past" by any time later that same day, since midnight is the *start* of the day, not the end. This hid the Cancel button entirely for the lender on same-day bookings. Fixed by comparing day-keys (`todayKey <= endKey`) instead of raw timestamps.
- Wired into both real cancellation paths: `handleCancel` (lender cancels a paid rental, tiered refund) and `confirmDeclineAtPickup` (renter declines at pickup — always 100%, since they never took the item; this isn't a timing case).
- **✅ Tested end-to-end on the two-device rig (2026-08-13):** same-day lender cancel → `refunds` row with `percentage=25`, real Stripe refund `re_3U3vOJHZSeCIslMV1wRybTx0`, ₪13.75. Decline-at-pickup → `percentage=100`, real Stripe refund `re_3U3vWtHZSeCIslMV0ZAeuuiT`, ₪90. Retry-safety (double-tapping Cancel) was **not manually tested** — Ori found it impractical to race (the cancel completes before a second tap registers) — but double-refund is still structurally blocked by the `unique` constraint on `refunds.transaction_id`, not just app-level idempotency.

### ✅ Sale/rental conflict guard on purchase approval (2026-08-13, tested)
Requested: a seller shouldn't be able to approve a sale on an item that's already committed to a future rental (double-committing the physical item). `approve_purchase` now checks for any `approved`/`paid`/`active` rental on the item with `end_date > now()` before approving, and raises a clear error naming the conflicting dates if one exists — the seller must resolve the rental first. (Item-hiding-on-sale was already correct and needed no fix: `mark_purchase_paid` already sets `is_hidden = true`, and `get_feed` already filters `is_hidden = false` — verified against the test purchase.)

**Tested on the two-device rig:** `PlayStation 5 + 2 Controllers` (Ori's item) already had a `paid` future rental to Nati (16–19 Sep 2026). Nati requested to buy it too; Ori's approval attempt was correctly blocked — the purchase row stayed `pending`, never advanced to `approved`. Also tested plain `reject_purchase` (Decline) on a separate item (`Trek Mountain Bike`) — confirmed `status = 'rejected'`.

### ✅ Legacy system messages leaking into the Chat tab (2026-08-13, tested)
User caught this from a screenshot: old rental status messages ("✅ Request approved...", "❌ Request declined...", "💳 Payment completed...") were showing up in the plain Chat tab, mixed in with real typed messages. Root cause: 12 demo/seed messages had `transaction_id = null` — the Chat tab only excludes messages that *have* a `transaction_id`, and a prior migration (`20260510_backfill_message_transaction_id.sql`) meant to backfill exactly this had missed them (likely seeded with fabricated past `created_at` timestamps *after* that migration ran). Re-ran the same match-by-date logic (migration `20260813_backfill_message_transaction_id_v2.sql`) — all 12 matched cleanly to a real transaction, no orphans needed deleting. Current code (`insertSystemMessage`) already tags every new system message correctly, so this was pure historical cleanup, not a live bug — same root-cause class as the purchase-message leak fixed earlier this session, just on the rental side and pre-existing rather than newly introduced. **Confirmed fixed** on the old Professional Camera Kit conversation from the screenshot — Chat tab now shows only user-typed messages.

## ✅ All three dispute paths now collect evidence (2026-08-13)

Previously only `QRScanScreen`'s return-flow dispute collected a photo + description; `ChatRoomScreen.tsx`'s `confirmDispute()` and `QRDisplayScreen.tsx`'s `reportIssue()` called the evidence-less 1-arg `report_issue(p_tx)`, so a dispute raised from either reached "under review" with nothing for an admin to look at. Fixed by making **ChatRoomScreen the one canonical dispute-reporting screen** (SAS), matching how it already owns Approve/Decline/Cancel/Pay:

- `ChatRoomScreen`'s dispute modal gained a step 3 (photo + description, same UI/upload logic QRScanScreen used to have) and now always calls the 3-arg `report_issue(p_tx, p_description, p_photo_url)`.
- `QRDisplayScreen.reportIssue()` no longer runs its own Alert+RPC — it navigates back to `ChatRoomScreen` via a new `reportIssueTransactionId` param (same pattern as the existing `declineTransactionId` for pickup-decline).
- `QRScanScreen`'s return-flow "Report Damage Instead" button now does the same — its entire local dispute modal, state, and evidence-upload logic were removed (~115 lines), since it's no longer the only place evidence gets collected.
- **DB migration `20260813_drop_report_issue_no_evidence_overload.sql`**: dropped the 1-arg `report_issue(uuid)` overload entirely — nothing calls it anymore, and this closes the door on the omission silently reappearing (a future call site accidentally using the wrong overload now fails to compile against nothing, i.e. can't happen).
- **Not yet tested on a real device** — verify next: raise a dispute from all three entry points (chat's Report Issue link, QRDisplayScreen's Report button, QRScanScreen's return-flow Report Damage) and confirm each lands a `disputes` row with photo + description, not just a status flip.

Orphaned storage object `handoff-evidence/d9d6fea4-.../dispute-1786553617536.jpg` (2.7 MB) still needs manual deletion via the Storage dashboard — Postgres can't delete storage objects directly and no service-role key is available locally.

**None of this touched migrations before 2026-08-13** — the enum/RPC/edge-function changes are additive to the purchases flow only.

### ✅ Backlog X duplicate-dispute guard is done and verified (2026-08-13)

- Duplicate row `0a761f3d` deleted (the later of the two on `d9d6fea4`; both photos were byte-identical at 2,716,537 bytes). One row remains, original evidence intact.
- Partial unique index `disputes_one_open_per_transaction on disputes (transaction_id) where status = 'open'` applied. Partial deliberately — a *new* dispute after an earlier one is resolved is legitimate and must stay possible.
- `report_issue(p_tx, p_description, p_photo_url)` rewritten to be **idempotent**: the index would otherwise throw a raw Postgres unique-violation at the user on the exact retry it was added to stop. A second report while a case is open now returns the existing dispute id. **Tested** by calling the RPC a second time with `request.jwt.claims` set to the reporter — it returned the existing id `6c51df41`, inserted no row, and did not overwrite the original description or photo.
- Both changes are checked in as `supabase/migrations/20260813_disputes_one_open_case.sql`.

### ✅ Found while doing the above, fixed later same session: two dispute paths captured zero evidence

Backlog **T** was recorded as complete, but only the `QRScanScreen` path collected a photo + description; `ChatRoomScreen.tsx:560`'s `confirmDispute()` and `QRDisplayScreen.tsx:134`'s `reportIssue()` called the evidence-less 1-arg `report_issue(p_tx)`. **See "All three dispute paths now collect evidence" above** for the fix — all three routes now go through one canonical evidence-collecting screen.

**Leftover:** the orphaned storage object `handoff-evidence/d9d6fea4-.../dispute-1786553617536.jpg` (2.7 MB) could not be removed — Postgres blocks direct `delete from storage.objects` (`storage.protect_delete()`), and no service-role key is present locally. Delete it via the Storage API or the dashboard.

### ✅ Backlog T is complete and verified end-to-end (2026-08-12)

Handoff and dispute evidence is now stored and retrievable. Verified by querying the DB and fetching the files, **not** by watching the UI:

| Evidence | Verified |
|---|---|
| Pickup condition photo | `pickup_photo_url` set on `5af6ad8d`; file fetched, 238 KB real JPEG 1816×4032 |
| Return condition photo | `return_photo_url` set on 2 transactions |
| Dispute photo + description | `disputes` row with both; file fetched, 2.7 MB JPEG 3024×4032 with camera EXIF |
| Storage RLS | A party can mint a signed URL for their own evidence |
| Decline at pickup + reason | 2 records, reason captured, min-length gate works |

### ✅ The QR handoff is verified on two real devices (2026-08-09)

A full rental (`Bosch Power Drill Set`, Nati → Ori) ran the whole lifecycle on an iPhone 12 Pro + Galaxy S20 FE with two separate logins: **request → approve → pay → pickup QR → active → return QR → completed → both parties rated.** The role flip is correct in both phases, and the 50m proximity check was proven to genuinely reject, not merely pass by default.

**After the edge function is deployed, the next real piece of work is U (admin console)** — now genuinely unblocked, since disputes finally carry evidence to adjudicate. Note it starts with a role column and an RLS rewrite, not a screen: every policy today is scoped to `auth.uid()` being a party, so an admin literally cannot read anyone else's rows.

## ⚠️ Lesson worth keeping: verify in the database, not the UI

Two bugs this week were **invisible from the app** — the screen showed success while the data was being discarded:

1. **The pickup photo** uploaded to storage but never linked to its transaction. `transactions: renter updates own` only permits status `pending`/`approved`, but a pickup happens at `paid`, so the UPDATE matched zero rows. **An RLS-blocked update returns no error in supabase-js** — it just affects nothing. Fixed by moving the write into `confirm_condition` (SECURITY DEFINER).
2. **Duplicate disputes** — two rows 0.6s apart with two separate photo uploads, because the Submit button had no in-flight guard while the photo uploaded.

Neither was findable by tapping through the app. After any flow that writes data, query the table.

**Two-device setup notes (so this isn't re-derived):**
- Android toolchain is Zulu JDK 17 + Android command-line tools — **no Android Studio needed**. `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.
- **Keep the Galaxy on USB while testing.** `adb reverse` tunnels Metro over the cable. Unplugged, it silently runs a stale bundle while still *looking* like it works — this cost a full debugging round on 2026-08-09, where a proximity check appeared broken but was only running old code.
- The iPhone reaches Metro over Wi-Fi only; USB is for installing. Free Apple personal team ⇒ **the build expires after 7 days**, re-run `npx expo run:ios --device` to refresh.
- After any `npx expo prebuild`, re-run `plutil -remove aps-environment ios/SwipeAndRent/SwipeAndRent.entitlements` — prebuild re-adds a push entitlement a free team cannot sign, and the app only uses local notifications.

**⚠️ Seven migrations are already applied to the live project and are NOT in the repo as files.** Anyone running this code against a *different* Supabase project must recreate them, or realtime updates, photo evidence and the decline flow will all silently fail:

| Migration | Date |
|---|---|
| `add_transactions_purchases_to_realtime` | 2026-08-09 |
| `submit_rating_reject_duplicate` | 2026-08-09 |
| `handoff_evidence_bucket` | 2026-08-11 |
| `handoff_photos_and_disputes` | 2026-08-11 |
| `report_issue_with_evidence` | 2026-08-11 |
| `decline_at_pickup` | 2026-08-11 |
| `confirm_condition_records_photo` | 2026-08-12 |

Worth considering: dumping these into `supabase/migrations/` so the schema is reproducible from the repo alone. Right now the live DB is the only source of truth for them.

---

## ⚠️ CRITICAL — Read this before writing any code: SAS Design Principle

This codebase follows the **Single Action Source (SAS)** pattern. It is mandatory for every feature.

**The rule:** Every action in the app has **one canonical screen** where it executes. All other entry points are navigation shortcuts that route to that screen — they never duplicate the action logic.

**Examples already in the codebase:**
- Approve / Decline / Cancel / Pay a rental → always happens inside `ChatRoomScreen` (Rental tab). `ManageItemScreen`, `MyRentalsScreen`, and `MyItemsScreen` show status but never have their own action buttons — they navigate to the chat instead.
- Edit / Delete an item → always happens in `EditItemScreen`. `MyItemsScreen` has an Edit button that navigates there — it doesn't inline any edit logic itself.
- City selection → always goes through the `CityPicker` component. Onboarding / AddItem / EditItem all use it; never roll a new picker.

**How to apply it to QR screens:**
- There should be ONE canonical screen for "show my QR to hand over the item" and ONE for "scan the lender's QR".
- `ChatRoomScreen`, `MyRentalsScreen`, and any other screen that references the transaction should navigate to these QR screens — they should not each implement their own QR logic.
- Ask yourself before adding any button: "Is there already a canonical screen for this action?" If yes, navigate there.

**Why it matters:** If the flow changes (e.g. you add a condition checklist before the QR scan), you update it in one place and it works everywhere automatically.

---

## Also good to know: Badge Jump

The codebase has a pattern called **Badge Jump**: when a status-changing action happens (approval, payment, cancellation), a system message is inserted into the chat. This triggers an unread badge on the Chats tab. When the other user taps the badge, the app auto-navigates to the correct chat, switches to the Rental tab, and flashes the relevant message with a blue glow.

When you build the QR flow, wire any status change (item handed over, item returned) through `insertSystemMessage()` in `ChatRoomScreen` so the other party gets a Badge Jump notification automatically.

---

# Backlog

### R. Real Impact Score formula
- User confirmed (2026-07-14): they want a genuine formula eventually, not the hardcoded placeholder — but explicitly said not to build it now, just track it here.
- Context: `QRDisplayScreen`/`QRScanScreen` currently show a hardcoded "Impact Score" (0–5 number + CO₂ stat) on the return-done screen — conflates the real Trust Score (now live via M's `lender_score`/`renter_score`) with an undefined environmental metric.
- Discussed direction (not yet decided): short-term swap those screens to show the real trust score instead of the fake number (cheap, reuses M); a real CO2-based formula would need a category → emissions-avoided data table and is explicitly listed as Out of Scope for MVP in CLAUDE.md section 6 ("Impact Score — deferred to future version after market feedback") — worth a deliberate product decision before building.

### N. Retroactive rental scoring (reputation bootstrap)
- Both sides (lender and renter) have a history of past rentals. After each `completed` transaction, the system should look back at the full history for both parties and recompute their scores (weighted recency — more recent rentals count more).
- For lenders: factors are item condition accuracy, response time to requests, cancellation rate.
- For renters: factors are on-time return, item care (no disputes), cancellation rate.
- This should run as a Supabase DB function / RPC triggered on every rating insert, so scores stay live without a separate cron job.
- Display the score badge and total-review count on `PublicProfileScreen` (already shown, just needs real data).
- `lender_cancellations` counter on `profiles` → deduct from lender score, show warning badge on public profile after threshold (not yet scoped anywhere else — fold in here).

### E. Feed ranking algorithm (beyond distance)
- Current `get_feed` ranks by distance only. Extend the weighted formula with: lender score, interest match (intersect `profiles.interests` with `items.category`/tags), recency.
- Likely a new `p_user_id` parameter or just use `auth.uid()` internally as it already does for the owner filter.

### I. Back navigation audit
- Every `navigation.goBack()` call needs a `canGoBack()` guard
- Cross-tab navigations should have a valid back destination

### K. History screen
- `HistoryScreen` placeholder exists — needs full implementation
- Show all past completed/cancelled/disputed rentals for both sides (as renter and as lender)
- Group by role or chronological order TBD
- **Must also show sold items (2026-07-16)**: when a purchase completes (`mark_purchase_paid` RPC), the item is set `is_hidden = true` and dropped from the feed — per user request, "sold" is deliberately **not** shown publicly, only to the seller, and History is where that should surface (join `purchases` where `seller_id = auth.uid() and status = 'paid'`).
- **Known gap to fix alongside this**: `MyItemsScreen`'s Hide/Show toggle (`toggleHidden`) is a plain generic switch — it can't currently tell "manually hidden" apart from "auto-hidden because it sold." A seller could tap "Show" on a sold item and accidentally re-list something that's already gone. Fix once History (or a `purchases` check) can distinguish the two.

### O. Split Chats tab by role (Renter / Lender)
- Currently all conversations are mixed in a single list — hard to tell which hat you're wearing in each thread
- Split `ChatsScreen` into two tabs: **Renting** (conversations where the current user is the renter) and **Lending** (conversations where the current user is the item owner)
- A conversation belongs to "Lending" if `items.owner_id = auth.uid()`, and to "Renting" if the renter is `auth.uid()`
- Unread badge on the Chats tab should still reflect total unread across both tabs
- Each sub-tab gets its own unread count shown on the tab pill
- SAS rule: `ChatRoomScreen` itself doesn't change — only the list that leads into it is split

### Q. Bulk photo scan — auto-fill multiple items from one photo
- In `AddItemScreen`, add a "Scan Items" button (camera icon) above the manual form.
- User takes one photo of a group of objects (e.g. a pile of camping gear, a table of tools).
- Photo is sent to a vision model (Gemini Vision or Groq-compatible endpoint) with a prompt that returns a structured JSON array: each element contains `name`, `category`, `description`, and a suggested `daily_price`.
- App renders a review sheet listing all detected items — user can edit any field, remove a row, or add a blank row before confirming.
- On confirm → each row is submitted as a separate `AddItem` call (reuse the existing item-creation logic; do not duplicate it).
- The original photo is attached as the first item photo for each detected item, or left empty if the user prefers individual photos per item.
- SAS rule: the actual item-save logic must go through the same path as the existing "Save" button in `AddItemScreen` — no parallel write path.
- Edge cases to handle: model returns no items (show error toast), model times out after 5s (fall back to manual form), user denies camera permission (standard permission flow already used by AddItemScreen).

### S. AI auto-fill single item fields from photo
- User request (2026-07-14): when adding a single item in `AddItemScreen`, let AI analyze the photo just taken/picked and auto-fill the form fields (name, category, description, suggested daily price) instead of the user typing them manually.
- Distinct from **Q** above: Q is "one photo of a pile of objects → multiple detected items"; this is the normal one-item-at-a-time add flow — take/pick the item's own photo(s), AI suggests the fields for that one item, user reviews/edits before saving.
- Likely shares the same vision-model call as Q (same prompt style, single-item case just uses the first/only detected object) — worth designing them together so the extraction logic isn't duplicated.
- SAS rule: still saves through the same existing "Save" path in `AddItemScreen` — AI only pre-fills form fields, it doesn't introduce a second save/write path.

### P. Refactor chatBus into a single Supabase realtime listener
- Currently: `useUnreadCount` and `ChatRoomScreen` each have their own independent Supabase listeners, and `chatBus` is only used to signal "marked as read"
- Goal: move the Supabase realtime connection into `chatBus` so it becomes the single listener for all incoming messages
- `useUnreadCount` and `ChatRoomScreen` both subscribe to `chatBus` instead of Supabase directly
- Clean flow: Supabase → chatBus → (useUnreadCount updates badge, ChatRoomScreen appends message)

### T. Condition & dispute photos are collected but never stored ⚠️
- Found during the two-device test (2026-08-09). **Every photo the app asks for during a handoff is discarded.**
- `QRScanScreen` requires a condition photo before the handoff can be confirmed (`photoUri`) — it is only ever rendered as a local preview. There is no upload, no bucket, no DB column.
- Worse: the **dispute** modal collects a damage photo (`disputePhotoUri`) **and** a description (`disputeText`), then calls `report_issue(p_tx)` which takes neither argument. Both are silently dropped, so a dispute reaches "Case Under Review" with zero evidence attached.
- Spec 4.9 explicitly allows "both parties can photograph item condition during transfer/return", and 4.10 says disputes are held "until Admin decision" — an admin can't decide anything without the evidence.
- Needs: a Storage bucket (private, per-transaction path), an upload step, columns to hold the URLs (probably `transactions.pickup_photo_url` / `return_photo_url`, and a `disputes` table for photo + text + status), and an extended `report_issue` RPC that accepts them.
- Open design questions before building: is one photo per handoff enough or should both parties photograph? Who can view them — parties only, or admin too? Are they retained after the rental completes, and for how long (GDPR — spec 5.2 grants a right to deletion)?
- Blocks **U** below: the admin dispute console is not useful until disputes actually carry evidence.

### U. Admin role — dispute queue & moderation console
- Requested 2026-08-09. Spec section 2 already defines an **Admin** user type ("content management, bans, verification approval, dispute resolution") and 5.2 requires RBAC, but nothing of it exists in the app today.
- Needed pieces:
  - **Role storage** — an `is_admin` / `role` column on `profiles`, plus RLS policies that let admins read across all rows. Every current policy is scoped to `auth.uid()` being a party, so an admin currently cannot see anyone else's data.
  - **Dispute queue** — list every transaction with `status = 'disputed'`, with the evidence from **T**, and actions to resolve in favour of either party (which must drive the escrow release described in spec 4.10).
  - **User management** — ban / unban, view a user's rentals and scores, act on reports (spec 4.11 has "Block or Report another user" — check whether reports are even persisted anywhere today).
  - **Item moderation** — items are created as `Pending` per spec 4.7 and need manual/AI verification; there is currently no screen where an admin approves them, and `verification_image_url` (admin-only per spec) has no viewer.
- Open question: separate admin app/screen inside the same build, gated by role, or a web dashboard? A gated screen in-app is far cheaper for the project timeline.

### V. Gate QR handoff to the rental dates
- Requested 2026-08-09, explicitly **not now** — the current always-available behaviour is wanted for testing.
- In the final version, "Show Pickup QR" / "Scan to Receive" should only be reachable on the rental **start date** (and the return QR on/after the end date), rather than as soon as the transaction is `paid`.
- Enforce server-side in `ensure_qr_token` / `scan_qr_handoff` (date check against `start_date` / `end_date`), not just by hiding the button — hiding alone is bypassable and violates the pattern used elsewhere, where the RPC is the authority.
- Decide the grace window: exactly the start date, or from the evening before? Late returns also need a rule — the return QR presumably must stay available after `end_date`, not expire on it.

### W. Keyboard avoidance — remaining screens
- Partly fixed 2026-08-09 (see Done). `behavior` was `undefined` on Android in every broken screen, which makes `KeyboardAvoidingView` completely inert; `'height'` works and is what `AddItemScreen`/`EditItemScreen` already used.
- **Still unfixed** — these have a `TextInput` and no `KeyboardAvoidingView` at all: `OnboardingScreen`, `RatingScreen`, `QRScanScreen` (the dispute modal's description field), `HomeScreen` (search bar — lowest risk, it sits at the top of the screen).
- Worth doing as one sweep, and worth considering a shared `<KeyboardAwareScreen>` wrapper so new screens get it by default instead of each one re-deciding.

### X. Small cleanups found during the 2026-08-09 device test
- **`notificationService.ts` — `sound: 'default'`** in two places (the Android channel at line ~20, the notification content at line ~33). Newer `expo-notifications` reads a *string* `sound` as a custom filename, so it logs `Custom sound 'default' not found in native app` on every launch. Use `sound: true` for the content and omit the key on the channel.
- **Dead item photo** — `Surfboard 7ft Funboard + Leash & Fins` (`dd000000-0000-0000-0000-000000000004`) points at a Pexels URL that now 404s, which throws an uncaught promise rejection into the LogBox on the feed. All 11 other seeded Pexels URLs still resolve. Replace or clear it.
- **11 stale June transactions** — duplicate `Canon EOS R5` requests from 2026-06-11, all left `approved`, all Ori→Nati. They clutter the Deal Board and make real test transactions hard to find. Cancel the pre-August ones.
- **QR handoff writes no system message** — `QRScanScreen` never calls `insertSystemMessage`, so pickup and return produce **no Badge Jump** and leave the chat-list preview stuck on the previous status. `NEXT_STEP.md` already called for this ("wire any status change (item handed over, item returned) through `insertSystemMessage()`"); it was never implemented. Suggested previews: `📦 Item handed over · Rental active`, `✅ Item returned · Rental complete`.
- **`submit_item_review` may allow duplicates** — `submit_rating` was hardened on 2026-08-09 to reject a second rating, but `submit_item_review` was not inspected. Check whether it upserts the same way and needs the same guard.
- ~~**Duplicate disputes need a DB-level guard**~~ — ✅ **Done 2026-08-13.** Partial unique index applied, duplicate row deleted, and `report_issue` made idempotent so the constraint doesn't surface a raw Postgres error. See the verified section at the top. (For the record: `disputes` has only a SELECT policy, so the deletion had to go through the service role — via MCP, which runs as `postgres`.)

### Y. Proximity check — GPS accuracy (root cause found & fixed 2026-08-11)
- **Root cause:** `getCurrentLocationOnce` requested `Location.Accuracy.Balanced`, which expo-location documents as *"accurate to within one hundred meters"* — Wi-Fi/network derived, not a real GPS fix. The proximity threshold is **50m**, so the error budget was **double the limit being enforced**. Two phones touching each other could read anywhere from 0m to 150m apart. The ~19m measured on 2026-08-09 was luck, and on 2026-08-11 the same two phones side by side failed the check outright.
- **Fixed:** both QR screens now pass `Location.Accuracy.High` (~10m). `CityPicker` deliberately keeps Balanced — it only reverse-geocodes to a city name, where 100m is irrelevant and the battery saving is worth having. `getCurrentLocationOnce` also now returns the reported `accuracy` radius, and the "Too far apart" alert shows it, so a bad fix is distinguishable from genuine distance.
- `metersBetween` was checked and is correct — `**` binds tighter than `*`, so the haversine terms group properly. The maths was never the problem.
- **Still open:** even at High accuracy, indoors with no sky view a fix can be poor. Consider refusing to complete a handoff when `accuracy` is worse than some threshold (say 30m) rather than comparing a distance that is mostly noise, and consider widening the effective limit by the two reported accuracy radii instead of using a flat 50m.
- Consequence: of the 50m allowed by spec 4.9, roughly 19m is receiver error, leaving ~30m of real signal. Near the threshold the result is effectively a coin flip — two people genuinely 40m apart might measure 21m or 59m depending on which way each device's error points.
- Worth considering: read `coords.accuracy` (expo-location already returns it) and either require a fix better than some threshold before allowing the scan, or widen the limit by the combined reported accuracy of both fixes rather than using a flat 50m.
- Also note the payload's lat/lng is captured when the **QR is generated**, not when it is scanned — if the displayer opens the QR screen and then walks somewhere before the scan, the check compares against a stale position. Probably fine for a handoff, but it is an assumption worth writing down.
- Do **not** tighten the 50m constant without doing the above first — it is currently the only thing absorbing normal GPS error.

### Z. Refunds are promised in the UI but never actually issued ⚠️
- Found 2026-08-11 while building the pickup decline flow. **There is no refund logic anywhere in the project.** The only two matches for "refund" in the whole codebase are UI strings in `ChatRoomScreen` (lines ~422 and ~444) that tell the user "you will receive a full refund". There are exactly two edge functions — `ai-search` and `create-payment-intent` — and neither refunds anything.
- So today: the lender cancels a paid rental → the renter is told they are getting their money back → nothing happens. Same for the new **Decline Item** action.
- Spec 4.10 defines a full refund policy (24h+ = 100%, 4–24h = 75%, <4h = 0%) and spec 4.8 repeats it. None of it is enforced anywhere; `handleCancel` only flips `status` and posts a message.
- **Step one is not the refund function — it is capturing the PaymentIntent id.** `transactions.stripe_payment_intent_id` already exists as a column, but `create-payment-intent/index.ts` creates the PaymentIntent (line ~83) and returns only `client_secret` (line ~91) without ever writing the id back. Verified 2026-08-11: **21 paid/active/completed transactions, 0 with an intent id**. So no existing transaction can be refunded even manually from the Stripe dashboard-to-app direction — there is no link between a rental and its payment.
- Order of work: (1) persist `stripe_payment_intent_id` when the intent is created, (2) a `refund-payment` edge function calling `stripe.refunds.create`, (3) the 24h/4h tier calculation from spec 4.10, (4) a refund record so partial refunds are auditable.
- Existing rows are unrecoverable — they will need either manual reconciliation in Stripe or writing off, since nothing ties them to a payment.
- Until then, avoid writing UI copy that claims money has moved. The **Decline Item** message deliberately says the rental was cancelled and the dates freed, and says nothing about a refund, for exactly this reason.

### L. Google Cloud account hardening (operational, not code)
- Before Free Trial expiry: set Hard Quotas (1000/day) on Places API + Geocoding API in Google Cloud Console
- Add a Budget Alert of $1 with email notifications at 50% / 90% / 100%
- Activate full account only after the above is in place

---

## Done

- **Two-device dev setup (2026-08-09)** — iPhone 12 Pro + Galaxy S20 FE 5G (Android 13) both running dev clients against one Metro server. Android toolchain installed locally (Zulu JDK 17 + Android command-line tools, no Android Studio); `adb` over USB gives Metro a cable tunnel via `adb reverse`. Two `app.json` fixes were needed to build to real devices: added `android.package`, and removed the Stripe plugin's `merchantIdentifier` — it injected an Apple Pay entitlement that a free Apple personal team cannot sign, despite Apple Pay being unused anywhere in `src/`. Same for the `aps-environment` push entitlement, stripped post-prebuild (the app only uses **local** notifications, which need no entitlement). **Note:** `expo prebuild` regenerates that entitlement, so re-run `plutil -remove aps-environment ios/SwipeAndRent/SwipeAndRent.entitlements` after any prebuild.
- **Live status updates in ChatRoomScreen (2026-08-09)** — approving or paying on one device left the other stale until the user backed out of the chat and re-entered. Root cause: the `supabase_realtime` publication contained only `conversations` and `messages`, so `transactions`/`purchases` changes were never pushed — the existing `purchases` listener was dead code that could never fire, and status only propagated as a side effect of the accompanying system-message INSERT. Fixed by publishing both tables with `REPLICA IDENTITY FULL` (migration `add_transactions_purchases_to_realtime`), adding a real `transactions` listener, and adding a `useFocusEffect` re-sync as a safety net for dropped events.
- **Short chat-list previews (2026-08-09)** — `conversations.last_message` was being set to the full status banner, so the Chats list showed a paragraph. `insertSystemMessage` now takes an optional `preview`: `✅ Approved · Payment due`, `💳 Paid · Ready for pickup`, `❌ Request declined`, `⚠️ Rental cancelled`, `⚠️ Issue escalated · Under review`. Kept role-neutral deliberately — both parties read the same string.
- **QR scan order (2026-08-09)** — "Scan to Receive" opened a checklist instead of the camera. Reordered to scan → checklist → photo → confirm: the scanned token is held in state and `confirm_condition` + `scan_qr_handoff` fire together at the end, so the server's "confirm the item condition first" rule is still satisfied without a server change. Proximity is now verified at scan time rather than at the final confirm, so "too far apart" surfaces before the user fills in a checklist that would be rejected. Added a "QR code expired → Rescan" path for when the displayer regenerates their token mid-flow, and the previously-dead `scannedFlash` overlay now actually fires.
- **Duplicate ratings (2026-08-09)** — the rating form was offered again after submitting, because `submitted` was local component state and `submit_rating` upserted (`on conflict do update`), silently replacing the previous score and recomputing `lender_score`/`renter_score` from it. `RatingScreen` now looks up an existing rating on mount, and the RPC rejects a second attempt (migration `submit_rating_reject_duplicate`).
- **Android layout fixes (2026-08-09)** — the tab bar hardcoded `height: 72` with no safe-area inset, so with `edgeToEdgeEnabled` it drew underneath Android's navigation bar; now `72 + insets.bottom`. Keyboard avoidance was inert on Android in `LoginScreen`, `AIPlannerScreen`, `ChatRoomScreen` and `PhoneVerificationScreen` (`behavior={undefined}`) — all now use `'height'`, and `LoginScreen` gained a ScrollView so the form can be scrolled clear of the keyboard. Remaining screens tracked as **W**.
- **H.** QR code transfer & return — `qr_token`/`return_qr_token` on transactions, `confirm_condition`/`ensure_qr_token`/`scan_qr_handoff` RPCs, `QRDisplayScreen` + `QRScanScreen` (checklist → photo → QR → proximity-checked scan), `MeetingPointScreen` for coordinating handoff location. Reachable only from `ChatRoomScreen` Rental tab (SAS).
- **Demo/theater mode removed** — deleted `DemoContext`/`DemoOverlay`/`TapFlash`, the demo-conductor/seed/start scripts, `DEMO_SCRIPT.md`, and staged demo photos. Stripped all `demoMode`/`theaterMode`/`altEnding`/`onlyTransactionId` branches from `ChatRoomScreen`, `HomeScreen`, `ItemDetailScreen`, `PublicProfileScreen`, `QRDisplayScreen`, `QRScanScreen`, `RatingScreen` — they now run only their normal, user-driven flows.
- **A.** Date-based availability filtering in AI Planner — edge function filters by transactions + blocked dates
- **B.** Wishlist — `wishlist` table, WishlistScreen, ❤️ button wired in ItemDetail + HomeScreen swipe panel
- **F.** Profile redesign — unified layout (own + public), score badges, hamburger menu with My Items / My Rentals / Wishlist / History / Switch User / Log out
- **G.** GPS / location-based feed:
  - `profiles.location` (PostGIS geography) added via migration
  - `get_feed` RPC accepts `p_lat`, `p_lng`, `p_radius_km`; falls back to caller's `profiles.location` when device coords are null; excludes items without GPS from radius queries; orders by ST_Distance
  - `CityPicker` component (Google Places autocomplete + "Use my current location" reverse geocode) — single source for city selection across Onboarding / Add / Edit
  - HomeScreen radius selector chips (1 / 5 / 25 / 100 km / All) + wired search bar (title / description / category, client-side)
  - `useUserLocation` upgraded from one-shot to continuous `watchPositionAsync` (50m / 10s threshold)
  - Legacy data backfilled: 8 items + 3 profiles normalized to `Tel Aviv-Yafo` with GPS
  - Empty-state UX: radius bar stays visible so the user can switch to "All" instead of being stuck
- **Edit & Delete Item** — EditItemScreen (pre-filled form, photo handling), delete blocked if active/pending rental, ✏️ Edit button in MyItemsScreen
- **Badge Jump** — all 4 rental steps covered (request → approval → payment → cancellation); fixed null last_read bug for first-time conversations
- **Item tap in My Items** — tapping card header navigates to ItemDetailScreen within ProfileStack
- **Profile picture** — tap avatar in own profile to set/change photo; stored in `profiles.avatar_url`
- **M. Post-rental rating persistence (2026-07-14)** — `ratings` table + `submit_rating` RPC (recomputes reviewee's `lender_score`/`renter_score`); `RatingScreen` Submit button now actually writes instead of being a local no-op.
- **Item reviews (2026-07-14)** — new `item_reviews` table + `submit_item_review` RPC (renter-only, requires completed transaction) + `items.avg_rating`/`review_count` rollup. `RatingScreen` shows a second star row ("How was the {item}?") for the renter only, submits both in one action. `ItemDetailScreen` shows a small `★ 4.5 · 3 reviews` line once an item has reviews.
- **ChatRoomScreen Rental tab redesign (2026-07-14/15)**:
  - Status-change system messages (approve/pay/cancel/etc.) no longer render as separate chat bubbles — only the rental-request card per transaction shows, now styled as a status board (date/price header + colored status pill) instead of a chat bubble, with a plain-language role-aware caption per status (e.g. lender sees "Approved — waiting for {renter} to pay", renter sees "Approved — pay within 24 hours").
  - Item photo avatar added next to the other party's name in the chat header (falls back to category icon).
  - Badge Jump fixed to highlight/scroll to the status card (not a hidden message) when a status-change badge is tapped.
  - Fixed a pre-existing navigation bug: 3 spots used `getParent()?.getParent()?.navigate(...)` which overshot past the Tab Navigator to the root auth stack (which doesn't have `HomeStack`/`Profile`) — root cause was `RootNavigator` wrapping the tab navigator in a `Stack.Screen name="MainApp"`, so only **one** `getParent()` is needed. Also fixed the same wrong-tab-name bug (`'Home'` → `'HomeStack'`) in `WishlistScreen`.
- **QR handoff role flip (2026-07-15)** — whoever currently holds the item now displays the QR; whoever is receiving it scans + verifies condition. Pickup: lender displays / renter scans (was backwards before — renter always displayed, lender always scanned, regardless of phase). Return: renter displays / lender scans (unchanged, was already correct). `ensure_qr_token`/`scan_qr_handoff` RPCs now enforce phase-dependent roles server-side. Condition checklist simplified to scanner-only (`QRDisplayScreen` no longer has a checklist/photo step — displayer just shows the QR). **Not yet tested on two real devices** (see "Resume here" above).
- **Meeting Point redesign (2026-07-15)** — replaced the fully-fake `MeetingPointScreen` (hardcoded "Dizengoff Square", drawn fake map, fake confirm flow) with a real `items.pickup_location` field the lender sets in Add/Edit Item, shown on `ItemDetailScreen` and as a read-only card + "Get Directions" button in `MeetingPointScreen`. Parties can still arrange a different spot via chat — no in-app negotiation mechanism.
- **C. Buy flow — "Deal Board" (2026-07-16)** — tapping Buy no longer pays instantly. New `purchases` table (separate from `transactions` — no approval step, no rental state machine) + `create_purchase`/`mark_purchase_paid`/`cancel_purchase` RPCs. Tapping **Buy** on `ItemDetailScreen` creates a pending purchase and opens the chat's second tab (renamed **Chat / Deal Board**, was "Rental" — it's the live status board for both rentals and purchases in one merged, chronologically-sorted list). The purchase card explicitly does **not** say "Pay Now" — payment happens in person at pickup, so the buyer's button reads **"I Have the Item — Pay Now"**, tied to the physical handoff moment rather than a remote pay-anytime action. Seller can cancel a still-pending purchase (assumed reasonable, not explicitly requested — flag if unwanted). On payment: `create-payment-intent` edge function extended to accept `purchase_id` alongside `transaction_id`; `mark_purchase_paid` marks the item `is_hidden = true` (sold — deliberately **not** shown publicly, see K above) and auto-cancels any other pending purchase requests for the same item.
