# ajanD: start loading screen in the new style (apps/tv)

YAGNI. Do not overcomplicate. This is a small visual fix, not a new feature.

## Problem

When the TV app starts, before the first `/api/state` answer, `PopcornRoot.tsx` (the `if (!state)` block,
about lines 229-242, and its `styles.container`, `styles.centerContainer`, `styles.connectingText`)
shows a spinner and "Connecting to Popcorn AI..." with the OLD theme (`colors` from `theme/colors.ts`).
Every other screen uses the new console style (`theme/console.ts`: `consoleColors`, `consoleType`,
`consoleLayout`, and components like `ConsoleBackdrop`, `ConsoleHeader`).

## Do

- Make the start loading view look like the other screens: the same ground color, backdrop, font sizes and
  text colors from `theme/console.ts`. Look at `screens/AskScreen.tsx` or `screens/CouchScreen.tsx` for how.
- Keep it simple: the backdrop, a spinner (or the same loading look the app already uses elsewhere in the
  console style, if there is one), and one short line of text. No animation work, no new component library,
  no new assets.
- If the `OfflineBanner` or `Toast` on that view use old colors, leave them as they are unless it is a
  one-line fix.
- If old style entries become unused after the change, remove them. Do not refactor anything else.
- If the Vega app has its own native splash image or color (manifest), only report what it is; do not change it.

## Boundaries

- Edit only files in `apps/tv/packages/shared-ui/src/`. No git commands. No backend changes.
- Do not drive the Vega simulator.

## Verify / report

- `cd apps/tv/packages/shared-ui && npx tsc --noEmit --noUnusedLocals` passes.
- One screenshot of the loading view from the web preview (Expo web, `localhost:8082`; with the backend
  unreachable, the loading view stays). Playwright: `/opt/homebrew/opt/python@3.11/bin/python3.11`.
  Save it to `briefs/reports/loading-shots/`.
- Report in `briefs/reports/ajanD-loading-screen.md`: changed files, what it looks like now, the
  screenshot path, anything not done. End with DONE.
