# Dev Environment & Build Reference

Durable operational knowledge, split out of `NEXT_STEP.md` (2026-09-01) so that file can stay a short session-to-session handoff note. Nothing here is time-sensitive to a specific session — update in place when a fact changes, don't append dated entries.

## Two-device rig
- **iPhone = Ori/lender, Galaxy = Nati/renter.**
- **Keep the Galaxy on USB** — `adb reverse tcp:8081 tcp:8081` tunnels Metro over the cable. If it drops, the app silently runs a stale bundle while still looking like it works; re-run the reverse command and reload.
- Android toolchain: Zulu JDK 17 + command-line tools only, no Android Studio. `ANDROID_HOME` isn't set by default in a fresh shell: `export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.

## Device identifiers for `expo run:ios`/`run:android --device`
- **iOS**: use the UDID from `xcrun xctrace list devices` (e.g. `00008101-00195CAA0CE9003A`) — not the friendly name.
- **Android**: use the `model:` field from `adb devices -l` (this rig's Galaxy: `SM_G781B`) — the adb serial, the raw hostname, and a bare `--device` with no value all fail with `Could not find device`.

## iOS build recipe (no Xcode GUI needed)
iPhone builds expire after 7 days (free Apple personal team). Full rebuild recipe:
```
npx expo prebuild --clean
/usr/libexec/PlistBuddy -c "Delete :aps-environment" ios/UseIT/UseIT.entitlements
/usr/libexec/PlistBuddy -c "Delete :com.apple.developer.applesignin" ios/UseIT/UseIT.entitlements
cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install && cd ..
xcodebuild -workspace ios/UseIT.xcworkspace -configuration Debug -scheme UseIT \
  -destination id=<UDID> -allowProvisioningUpdates DEVELOPMENT_TEAM=C2DG54HCLY
xcrun devicectl device install app --device <UDID> <path to UseIT.app in DerivedData>
xcrun devicectl device process launch --terminate-existing --device <UDID> com.useitapp.app
```
Notes:
- `expo-apple-authentication`'s config plugin re-adds the Sign-In-with-Apple entitlement on every prebuild regardless of `app.json`'s flag — a free/personal team can't sign that, so it must be stripped every time (`plutil -remove` doesn't work here, it treats the dot as a path separator — use `PlistBuddy` with a `:`-prefixed key).
- `expo prebuild --clean` doesn't preserve `DEVELOPMENT_TEAM` in `project.pbxproj` — pass it explicitly on the CLI (`C2DG54HCLY`, Ori's personal team) or open Xcode once and pick it via the GUI.
- CocoaPods crashes with a Ruby `UnicodeNormalize` error unless `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` is set for `pod install`.
- After any rebuild, trust the new cert on-device: Settings → General → VPN & Device Management → Trust (can't be automated).

## Android build
`adb uninstall com.useitapp.app` (if reinstalling over a differently-signed build) then `npx expo run:android --device SM_G781B` — no equivalent gotchas to iOS.

**Distributable APK** (EAS, no Play Store, $0, no paid account needed):
- `eas.json` already has a `preview` profile (`internal` distribution, `apk` build type).
- The four `EXPO_PUBLIC_*` client vars (Supabase URL/anon key, Stripe publishable key, Google Maps key) must be pushed to EAS's own env store separately from `.env` — `eas env:set preview` — a cloud build never sees your local `.env`.
- Build from a checkout with `src/config/testAccounts.ts` present but empty (its tracked default) — never build from a checkout with real test credentials in that file, since Metro bundles whatever's on disk regardless of `__DEV__` gating on the UI.
- Run `eas build --profile preview --platform android` to get a fresh build; the resulting `.apk` download link is build-specific and needs regenerating each time.

## No paid Apple Developer account (Ori's call, standing decision)
TestFlight, ad-hoc iOS distribution, and Sign in with Apple are all blocked on this — a $99/yr recurring charge Ori doesn't want right now. Until that changes, iOS demoing is loaner-device-only (pre-built via USB, same recipe as above). Don't spend session time chasing Apple-account-gated work without checking if this has changed.

## Test/demo accounts
- **Generic demo account** (no signup needed): `demo@example.com` / `1111111` — pre-filled profile (`phone_verified`, `onboarding_complete`, role `both`, Tel Aviv), drops straight into the Home feed.
- **Ori/Nati dev accounts**: real credentials live in the gitignored `.env`'s `EXPO_PUBLIC_TEST_ACCOUNTS_JSON`, surfaced in-app via the `__DEV__`-gated "Switch User" menu item (Profile → ☰ → Switch User) — never printed to logs or chat.
- Bypassing onboarding gates for a throwaway test account: update `public.profiles` directly (`phone_verified`, `onboarding_complete`, `role`, `city`) via the Supabase MCP `execute_sql` tool — same technique used to set up the demo account.

## Misc
- **Migrations are tracked in `supabase/migrations/`** — every schema change has a corresponding file in the repo.
- **Supabase MCP access token** lives in `~/.claude.json`'s `supabase` entry env block. If MCP calls return `Unauthorized`, regenerate at supabase.com/dashboard/account/tokens, re-add with `claude mcp add supabase -s user -e SUPABASE_ACCESS_TOKEN=... -- npx -y @supabase/mcp-server-supabase@latest`, restart Claude Code.
- **Pulling a screenshot directly off the Galaxy**: `adb shell "ls -t /sdcard/DCIM/Screenshots | head -3"` then `adb pull /sdcard/DCIM/Screenshots/<name> <local path>`. Needs the device authorized for USB debugging first (`adb devices -l` shows `unauthorized` until accepted on-device).

## Lessons worth keeping
- **Verify in the database, not the UI.** Multiple real bugs were invisible from the app — an RLS-blocked update silently affecting zero rows (supabase-js reports no error for this), or a double-tap racing past an in-flight guard. After any flow that writes data, query the table directly before trusting the UI's success state.
- **`error.message` from `supabase.functions.invoke` lies.** It's always the generic "Edge Function returned a non-2xx status code" regardless of the real cause. The actual `{error: "..."}` body is in `error.context` — read it with `await error.context?.json?.()` before showing the user (or yourself) an error.
