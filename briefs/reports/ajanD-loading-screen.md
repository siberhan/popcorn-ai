# ajanD report: the start loading screen in the console style

The loading view shown before the first `/api/state` answer now uses the same ground, backdrop, type
size and colours as every other screen. Nothing else changed.

## Changed files

All under `apps/tv/packages/shared-ui/src/`.

| File | Change |
|---|---|
| `popcorn/PopcornRoot.tsx` | The `if (!state)` block adds `<ConsoleBackdrop tint={consoleColors.fieldTeal} />` as the first child; the spinner colour is `consoleColors.text` (white); `styles.container` is `consoleColors.ground`; `styles.connectingText` is `consoleColors.secondary`, `scaledPixels(consoleType.secondary)` (26), weight `medium`, `marginTop: scaledPixels(24)` — the same shape as the secondary lines on the couch, ask and genres screens. The old `theme` import (`colors`, `typography`, `spacing`) is replaced by `scaledPixels` from `hooks/useScale` and `consoleColors`/`consoleType` from `theme/console`. |

No unused style entries were left behind: the three styles in the file (`container`,
`centerContainer`, `connectingText`) are all still used, only retinted. `colors.ts`, `spacing.ts` and
`typography.ts` are still used by other components, so nothing was removed from them.

## What it looks like now

- The console ground `#0B0D12` with the drifting teal `#2C5C78` and rust `#96582E` blob backdrop, the
  same one the couch screen starts on.
- A white spinner in the middle of the screen, then one line: "Connecting to Popcorn AI..." in
  `#B4BCCB` at 26 px, weight 500.
- The `OfflineBanner` is unchanged, as the brief asked. It still uses the old theme (`status.errorBg`
  fill, `status.error` border and dot, `text.primary` label); that is not a one-line fix because it
  changes the fill, the border, the dot and the text colour, and the banner is shared by every screen.
  In the screenshot it appears at the top because the backend is unreachable, which is also what keeps
  the loading view up.
- `Toast` is unchanged (no toast in this state).

## Screenshot

`briefs/reports/loading-shots/01-loading.png` — Expo web at `localhost:8082`, 1920x1080, Playwright
(`/opt/homebrew/opt/python@3.11/bin/python3.11`), with every `**/api/**` request aborted so the first
`/api/state` never answers and the loading view stays. The only console errors were the aborted
requests (`net::ERR_FAILED`).

## Not done

- **No Vega splash check beyond the manifest.** `apps/tv/apps/vega/manifest.toml` and
  `apps/tv/apps/vega/app.json` declare no splash image and no splash colour, and nothing in `src/`
  mentions one. There is a native splash to report only in the sense that there is none configured:
  the Vega app's own start screen is the platform default until `PopcornRoot` mounts. Not changed.
  (The Expo app is the same: `app.json` has no `splash` entry; `expo-splash-screen` is only used to
  hold the default splash until the font loads.)
- **No device check.** Verified on web only. The backdrop, the tint and the spinner are all patterns
  the other console screens already use on the Vega device.
- **No header on the loading view.** The brief asked for the backdrop, a spinner and one line, so the
  `ConsoleHeader` (brand, couch discs, clock) is not drawn before there is state to draw it from.

## Verify

- `cd apps/tv/packages/shared-ui && npx tsc --noEmit --noUnusedLocals` → exit 0, no output.

DONE
