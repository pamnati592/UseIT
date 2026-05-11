# Next Suggested Step — For Nati 👋

## What to build next: GPS logic (G) + QR screens (H)

### G. GPS / Location-based feed
- In `AddItemScreen` and `EditItemScreen`: request the device's GPS location when the user saves an item and store it as `ST_Point(lng, lat)` in the `items.location` column (column already exists in the schema with a PostGIS index).
- In `HomeScreen`: replace the current flat `.select()` query with a Supabase RPC call `get_feed(user_id, lat, lng)` that orders results by `ST_Distance`. You'll need to create this RPC as a migration.
- Show a small distance badge (e.g. "3 km") on each swipe card.

### H. QR code transfer & return
- After payment succeeds (status → `active`), generate a `qr_token` (UUID) and store it on the transaction.
- **Transfer flow**: Renter opens a screen showing their QR code → Lender scans it → transaction status → `active` (item handed over).
- **Return flow**: New QR generated → Lender scans → status → `completed`.
- Both screens live inside the rental flow (accessible from `ChatRoomScreen` Rental tab and `MyRentalsScreen`).

---

## ⚠️ CRITICAL — Read this before writing any code: SAS Design Principle

This codebase follows the **Single Action Source (SAS)** pattern. It is mandatory for every feature.

**The rule:** Every action in the app has **one canonical screen** where it executes. All other entry points are navigation shortcuts that route to that screen — they never duplicate the action logic.

**Examples already in the codebase:**
- Approve / Decline / Cancel / Pay a rental → always happens inside `ChatRoomScreen` (Rental tab). `ManageItemScreen`, `MyRentalsScreen`, and `MyItemsScreen` show status but never have their own action buttons — they navigate to the chat instead.
- Edit / Delete an item → always happens in `EditItemScreen`. `MyItemsScreen` has an Edit button that navigates there — it doesn't inline any edit logic itself.

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

### C. Buy option
- Toggle on item upload: "Also available for purchase" + sale price
- "Buy" button on swipe panel + Item Detail (currently a no-op placeholder)

### D. Rating system
- After a rental is marked Completed, both parties are prompted to rate each other (1–5 stars + optional comment)
- Ratings feed into `lender_score` and `renter_score` on `profiles` (fields exist, currently 0)
- Lender score factors: item condition accuracy, response speed, cancellation history
- Renter score factors: return time, item care
- `lender_cancellations` counter on `profiles` → deduct from lender score, show warning badge on public profile after threshold
- Ratings stored in a new `ratings` table: `(id, reviewer_id, reviewee_id, transaction_id, score, comment, created_at)`

### E. Feed ranking algorithm
- Supabase RPC `get_feed(user_id, lat, lng)` with weighted formula
- Factors: lender score, distance, interest match, recency
- Distance badge on swipe cards

### G. GPS / Location-based feed
- AddItemScreen: request location + store `ST_Point(lng, lat)`
- HomeScreen: order by `ST_Distance` via Supabase RPC

### H. QR code transfer & return
- After payment → generate `qr_token` on transaction
- Renter shows QR → lender scans → status → active
- Return: new QR → lender scans → status → completed

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

---

## Done

- **A.** Date-based availability filtering in AI Planner — edge function filters by transactions + blocked dates
- **B.** Wishlist — `wishlist` table, WishlistScreen, ❤️ button wired in ItemDetail + HomeScreen swipe panel
- **F.** Profile redesign — unified layout (own + public), score badges, hamburger menu with My Items / My Rentals / Wishlist / History / Switch User / Log out
- **Edit & Delete Item** — EditItemScreen (pre-filled form, photo handling), delete blocked if active/pending rental, ✏️ Edit button in MyItemsScreen
- **Badge Jump** — all 4 rental steps covered (request → approval → payment → cancellation); fixed null last_read bug for first-time conversations
- **Item tap in My Items** — tapping card header navigates to ItemDetailScreen within ProfileStack
- **Profile picture** — tap avatar in own profile to set/change photo; stored in `profiles.avatar_url`
