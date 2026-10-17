# ajan1 — TV app shell (Day 3)

Read first: `briefs/rules.md`, `briefs/tv-contract.md`, your own `briefs/tv-research.md`.

## Goal

A working `apps/tv/` TV app, based on Amazon's `react-native-multi-tv-app-sample` (MIT-0), that
polls the MCP server and shows the screen it is told to. ajan3 builds the four screens in parallel;
you build everything around them.

## You own

Everything in `apps/tv/` EXCEPT `apps/tv/packages/shared-ui/src/popcorn/screens/` and
`apps/tv/packages/shared-ui/src/popcorn/components/` (those are ajan3's). Do not edit their files.

## Steps

1. Copy the sample from
   `/private/tmp/claude-501/-Users-bedirhan-Documents-Projects-popcorn-ai/047f9d42-0d0e-4226-934b-0be89bf43b7f/scratchpad/mtv/`
   into `apps/tv/` WITHOUT `node_modules`, `.git`, build outputs, `tvdemo.gif`. Keep its `LICENSE`.
   Remove the video player, the drawer/stack navigation, mock catalog data, explore/settings screens.
   Rename the app: title "Popcorn AI", package id `com.popcornai.tv` / component `com.popcornai.tv.main`.
2. Create `src/popcorn/types.ts` and `src/popcorn/api.ts` exactly as in `tv-contract.md`.
   `API` base URL in one config file; web default `http://127.0.0.1:8000`, Vega default `http://10.0.2.2:8000`.
3. `useTVState(url, 1000)`: recursive `setTimeout` + `AbortController`, re-render only when
   `version` changes, keep the last good state on network errors and expose `online: boolean`.
4. `PopcornRoot`: a single component that picks the screen from `state.screen` and passes the props
   from the contract. Until ajan3's files exist, create them ONLY if missing as tiny placeholder
   stubs that render the screen name (ajan3 will overwrite them; tell ajan3 nothing, the orchestrator does).
5. Theme: map `apps/alexa-web/design/tokens.json` into the shared-ui theme (colors, spacing, radii,
   font sizes x1.5 for 10-foot). Read only; do not edit ajan3's design files.
6. Offline banner when `online` is false; a small toast for API errors.
7. Web target: `yarn install` and `yarn dev:web`. Check with the running MCP server on 8000
   (household `dev`, do NOT start another one): the page shows the current screen and updates
   within 2 s when the state changes. You may change state for testing with
   `curl -X POST 127.0.0.1:8000/api/couch -H 'content-type: application/json' -d '{"add":"Test"}'`
   and remove it again afterwards.
8. Vega smoke test (important, it answers an open question): `yarn build:vega`, start the Vega
   Virtual Device, install and launch with `vega device launch-app --appName com.popcornai.tv.main`
   (NOT `vega run-app`, it fails, see FRICTION_LOG entry 1). Check if the app can fetch
   `http://10.0.2.2:8000/api/state` and load one TMDB poster. Copy the EXACT log lines
   (`vega device` logs / console) into your report. Do not guess: if you could not run it, say so.

## Done when

- `yarn dev:web` shows live state from port 8000; D-pad arrows move focus (once ajan3's screens land).
- Vega result written with real output (works / blocked + exact error).
- Report in `briefs/reports/ajan1-tv-shell.md`: what you built, exact commands, real output,
  what does not work, friction (exact error text only). Last line: `TV SHELL DONE`.
- When step 1-4 are done and `yarn dev:web` starts, ALSO write `briefs/reports/ajan1-scaffold-ready.md`
  with one line: the run command. ajan3 waits for this file.
