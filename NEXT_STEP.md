# Session Summary — AI Planner (Groq / Llama 3.3)

## What was built this session

### Edge Function: `supabase/functions/ai-search`
- Authenticates the caller via JWT (anon key + user JWT)
- Uses **service role key** to fetch all live, non-hidden items (bypasses RLS)
- Calls **Groq API** (`llama-3.3-70b-versatile`) with a structured prompt
- Returns up to 10 ranked results, each with `item_id`, `reason` (AI sentence), `score`
- Falls back to keyword + category-alias scoring if Groq fails

### Screen: `src/screens/AIPlannerScreen.tsx`
- Free-text query input (multiline)
- Optional date range picker — period calendar modal (react-native-calendars)
- "Search with AI" button → calls edge function, shows spinner
- Results list: photo/emoji fallback, title, city, price, purple italic AI reason
- Tapping a card navigates to ItemDetailScreen via `HomeStack`

### Debugging path taken
1. RLS was blocking the items query → fixed by switching to service role key
2. Gemini 2.0-flash quota was 0 (account billing issue) → tried gemini-1.5-flash (wrong endpoint) → switched to **Groq** which is free with no billing required
3. Keyword fallback added as safety net — auto-activates if Groq fails

---

## Next Session — AI Planner improvements (priority)

### A. Date-based availability filtering
- When user picks a date range in the AI Planner, the edge function should exclude items that already have approved/active transactions overlapping those dates
- Query: join `items` with `transactions` where `status IN ('approved', 'active')` and dates overlap `[start_date, end_date]`
- Also check `item_blocked_dates` table for owner-blocked ranges
- Pass only truly available items to Groq so it never suggests unavailable items

### B. AI Planner checklist / todo mode
After results are shown, each card should have a checkbox the user can tick manually. Rules:
- **Manual tick** — user taps the checkbox to mark an item as "not relevant" or "done"
- **Auto-tick (requested)** — if the user taps through to the item, opens the calendar, and sends a rental request → that item auto-ticks as ✅ Requested
- **Auto-tick (wishlisted)** — if the user adds the item to their wishlist from the detail screen → item auto-ticks as ❤️ Saved
- Ticked items drop to the bottom of the list with a visual dimming
- State persists for the session (no need to save to DB — resets when user does a new search)

---

## Post-Production / Scale (deferred — requires budget)

### Vector Search for AI Planner
Currently the edge function fetches **all** live items and sends them to Groq in one prompt. This is a deliberate MVP compromise — it works fine for hundreds of items but will break at scale (context window limits, slow, expensive).

**Future solution (when item count grows):**
1. Store a `embedding vector(1536)` column on each item (generated at upload time via OpenAI/Groq embeddings)
2. On search: embed the user's query → run `pgvector` cosine similarity search → retrieve top ~100 semantically similar items
3. Filter those 100 for date availability
4. Send only the filtered shortlist to Groq for final ranking

**Stack:** Supabase `pgvector` extension (already available), any embeddings API. Estimated: 1 day of work once item volume justifies it.

---

## Backlog — Back Navigation Audit

### Back Navigation UX — needs a full pass
Back navigation across the app is inconsistent and in some cases unexpected. Known issues encountered so far:
- Navigating from **AI Planner → ItemDetail** leaves ItemDetail as the stack root with no screen behind it (fixed with `canGoBack()` guard, but the root cause is cross-tab navigation pushing screens without a proper back destination)
- The **rental calendar modal** closing behaviour: pressing the system back gesture closes the modal but the user lands on ItemDetail rather than being taken back to the AI Planner — may feel counterintuitive depending on the flow they came from
- General audit needed: every screen that uses `navigation.goBack()` should be checked — ensure there is always a valid back destination and that the user ends up where they intuitively expect

**Suggested fix approach:**
- Audit all `navigation.goBack()` calls and add `canGoBack()` guards where missing
- For cross-tab navigations that push screens (AI Planner → HomeStack/ItemDetail), consider using a modal presentation style or a dedicated shared stack so back always returns to the originating tab
- Consider adding a bottom sheet or swipe-down gesture on the rental calendar instead of a full modal, which would feel more natural as a "dismiss" rather than a "back"

---

## Backlog (unchanged from previous session)

### C. My Items — "Manage Item" calendar view
Replace the current separate "🚫 Blocked dates" button with a single **"Manage Item"** button that opens a full-screen calendar showing the item's complete date picture in one place:

**Calendar markings (color-coded):**
- 🔴 **Rented** — dates covered by approved or active transactions (from `transactions` table where `status IN ('approved', 'active')`)
- 🟠 **Blocked** — dates manually blocked by the owner (from `item_blocked_dates` table)
- A small caption label under each marked period: "Rented" / "Blocked"

**Actions from this screen:**
- Owner can tap any unmarked date range to add a blocked period (same logic as current blocked-dates editor)
- Owner can tap an existing blocked range to delete it
- Rented ranges are read-only (can't be deleted from here — only cancellation flow removes them)

**Implementation notes:**
- Use `react-native-calendars` with `markingType='custom'` or `'period'` and dot markers for captions
- Fetch both `transactions` (start_date/end_date where status is approved/active) and `item_blocked_dates` in a single screen load
- Replace the existing `BlockedDatesModal` — this new screen supersedes it entirely

### D. Wishlist page
- Add a dedicated Wishlist screen under the Profile tab
- Needs a `wishlist` table (user_id, item_id) in Supabase
- Screen lists saved items as tappable cards

### D. Buy option
- Toggle on item upload: "Also available for purchase" + sale price
- "Buy" button appears on swipe action panel + Item Detail only if for sale

### E. Lender score penalty for cancellations
When a lender cancels a rental, their lender reputation score should take a hit. This discourages abuse (accepting many requests and then cancelling at 49h to game availability).

**Suggested approach:**
- Add a `lender_cancellations` integer counter on the `profiles` table
- On each lender-initiated cancellation, increment the counter and deduct from `lender_score`
- Show a warning badge on the lender's public profile if cancellations > threshold (e.g. 3)
- Admins can reset the counter after reviewing a dispute

### F. Feed ranking algorithm based on reputation + distance
Currently the home feed returns items in `created_at` order. A proper ranking should factor in:
- **Lender score** — higher-reputation lenders rank higher
- **Distance** — closer items rank higher (requires PostGIS location on items + user's current GPS)
- **Interest match** — items matching the user's selected categories rank higher
- **Recency** — newer listings get a small boost

**Suggested implementation:**
- Supabase RPC `get_feed(user_id, lat, lng)` that returns a ranked list using a weighted formula
- Add `location GEOGRAPHY(Point)` column to `items` (set at upload time)
- Add distance badge on swipe cards ("2.3 km away")
- Requires GPS location permission on the AddItem and HomeScreen flows

### F. Profile redesign — Account Hub + Public Profile
- Profile Tab = private account hub (My Items, My Rentals, Wishlist, Settings)
- Public Profile = read-only screen (navigated to from Item Detail / chat)

### G. GPS / Location-based feed
- AddItemScreen: request location permission + store `ST_Point(lng, lat)`
- HomeScreen: order items by `ST_Distance` using Supabase RPC

### H. QR code transfer & return
- After payment → generate `qr_token` (UUID) on transaction
- Renter shows QR → lender scans → status → active
- Return: new QR → lender scans → status → completed
