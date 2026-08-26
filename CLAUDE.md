# CLAUDE.md – UseIT Project

## ⚠️ MANDATORY – Read Before Every Response
**At the start of every conversation and before every answer, read the product spec file:**
`product-spec.pdf` (repo root)
This is the single source of truth for the project. Never rely on prior memory — always verify against this file.

## ⚠️ MANDATORY – Before Starting Work & After Any Long Break
**Before starting any work session and after any prolonged break, always:**
1. Run `git pull` to fetch the latest changes from the repository
2. Run `git log --oneline -10` to review recent commits and understand what has changed
3. Run `git status` to check for any uncommitted local changes
4. Review any modified files relevant to the current task before making changes
This ensures you are always working on the most up-to-date version of the codebase and are aware of your teammates' recent changes.

## ⚠️ MANDATORY – After Every GitHub Push
**Every time you push changes to GitHub, end your response with a clearly marked section:**

```
## Next Suggested Step
[1–3 sentences describing the most logical next task to continue from where we left off]
```

This must appear after every push — it is the handoff note for the next session so work can resume immediately without re-explaining context.

---

## Figma Project
**Wireframes & UI Design (Figma Make):**
https://www.figma.com/make/RbE6DxiKS51wtRikFVI4kN/Marketplace-App-Wireframes

> Always open this file before building any screen or UI component to verify the design.

---

## Product Spec

`product-spec.pdf` (repo root) is the source of truth for product requirements — read it directly rather than relying on a copy here, so this file can't drift out of sync with it the way it previously did.

**Known deviations from the spec, decided during development:**
- **AI Agent runs on Groq, not Gemini** (spec 4.6/5.4).
- **Backend is Supabase edge functions (TypeScript/Deno), not Python + FastAPI** (spec 5.4) — there is no Python in this repo.
- **RTL / Hebrew UI is explicitly out of scope** (spec 4.3) — superseded by the 2026-08-19 decision to build for real public release rather than the original course-demo target; see `NEXT_STEP.md`.

Check `NEXT_STEP.md` for the current backlog and any other gaps between the spec and what's actually shipped.

---

## App Design Vocabulary

These named patterns must be respected in every feature built.

### Single Action Source (SAS)
Every action in the app has **one canonical screen** where it executes. All other entry points are navigation shortcuts that route to that screen — they never duplicate the action logic.

- **Example:** Approve / Decline / Cancel a rental → always happens inside `ChatRoomScreen` (Rental tab). `ManageItemScreen`, `MyRentalsScreen`, and any future screen that shows a transaction status never implement their own action buttons — they navigate to the chat instead.
- **Rule:** Before adding a button that performs an action, ask: "Is there already a canonical screen for this action?" If yes, navigate there. Never copy the logic.
- **Why:** Prevents divergence — if the flow changes (e.g. a new confirmation step), it only needs updating in one place.

### Badge Jump
The UX flow triggered when a user taps an unread badge: the app auto-navigates to the correct tab, scrolls to the relevant message, and flashes it with a blue glow for 1.2 seconds.

- **Entry points:** Chats tab badge, conversation green dot, any `highlightAfterTimestamp` + `targetTransactionId` param passed to `ChatRoomScreen`.
- **Rule:** Any new notification or status-change that the user needs to act on must be wired into the Badge Jump flow — never just open the Chats tab root.

---

## Role
You are a Senior Product Manager and Full-Stack Software Architect with expertise in P2P Marketplaces and mobile applications.

For a guided, teaching-style walkthrough of a change (one snippet at a time, Hebrew explanations, comprehension checks), invoke `/senior-dev-mentor` explicitly — it is opt-in, not the default mode for this project.
