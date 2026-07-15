# Next Suggested Step — For Nati 👋

## Resume here

**Context:** DB access via Supabase MCP is confirmed live (verified 2026-07-13, project `ACTIVE_HEALTHY`) — no need to re-verify at the start of a session.

**⚠️ Not yet tested end-to-end: the QR handoff role-flip (2026-07-15).** We changed who displays vs. scans the QR at each phase (see "Done" below), plus condition-checklist gating. This has **not been tested on two real devices yet** — the simulator can't validate two independent GPS positions + two independent logins interacting with each other, and the proximity check (50m) plus the phase-dependent RPC permission checks (`ensure_qr_token` / `scan_qr_handoff`) are exactly the kind of thing that looks right in code but needs a live two-party test to be sure. Plan: build dev clients on an iPhone and an old Galaxy Android device (`npx expo run:ios --device` / `npx expo run:android --device`, both on the same Wi-Fi as Metro), log in as two different test accounts, run a rental through pending → approved → paid → pickup QR → active → return QR → completed, and confirm the right party sees "show QR" vs "scan QR" at each phase.

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

### C. Buy option
- Toggle on item upload: "Also available for purchase" + sale price
- "Buy" button on swipe panel + Item Detail (currently a no-op placeholder)

### E. Feed ranking algorithm (beyond distance)
- Current `get_feed` ranks by distance only. Extend the weighted formula with: lender score, interest match (intersect `profiles.interests` with `items.category`/tags), recency.
- Likely a new `p_user_id` parameter or just use `auth.uid()` internally as it already does for the owner filter.

### I. Back navigation audit
- Every `navigation.goBack()` call needs a `canGoBack()` guard
- Cross-tab navigations should have a valid back destination

### J. Tab bar redesign
- AI Planner tab → move into Home feed as a button/banner (it's the same destination)
- "+" (Add Item) is low-frequency — consider de-emphasizing (plain tab or header button)
- Final layout decision: 4 tabs (Home / Add / Chats / Profile) or 3 tabs (Home / Chats / Profile with + in header)

### K. History screen
- `HistoryScreen` placeholder exists — needs full implementation
- Show all past completed/cancelled/disputed rentals for both sides (as renter and as lender)
- Group by role or chronological order TBD

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

### L. Google Cloud account hardening (operational, not code)
- Before Free Trial expiry: set Hard Quotas (1000/day) on Places API + Geocoding API in Google Cloud Console
- Add a Budget Alert of $1 with email notifications at 50% / 90% / 100%
- Activate full account only after the above is in place

---

## Done

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
