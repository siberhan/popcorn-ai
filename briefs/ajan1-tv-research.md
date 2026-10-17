# ajan1, task 2: Research for the TV app (Day 3)

Read `briefs/rules.md` again (same rules). You change no project code. Tomorrow we build the TV app
`apps/tv/` from Amazon's sample `AmazonAppDev/react-native-multi-tv-app-sample`. Your job: learn the
sample so the builder can start fast. Write `briefs/tv-research.md`, then a short `briefs/reports/ajan1-tv.md`.

A built copy of the sample (with node_modules) is at
`/private/tmp/claude-501/-Users-bedirhan-Documents-Projects-popcorn-ai/047f9d42-0d0e-4226-934b-0be89bf43b7f/scratchpad/mtv/`.
Read it there; do not change it, do not copy it into the repo.

Node: `eval "$(fnm env)"; fnm use 24`. Vega SDK: `source ~/vega/env`.

## Questions (answer each with file paths + line numbers from the sample, and short code excerpts)

1. **Structure:** monorepo layout (apps/, packages/), which package holds the shared UI, how the web
   target and the Vega target are built and run (exact commands), and the Node/Yarn/React Native versions.
2. **Screens and navigation:** how screens are defined and how you navigate between them. What is the
   smallest way to replace the sample's screens with our own (couch, poster duel, recommendations grid,
   movie details)? What can be deleted safely?
3. **D-pad focus:** which library/pattern handles TV focus (spatial navigation) on web and on Vega;
   how to make a custom focusable card, set initial focus, and handle select/back keys. Show a minimal
   focusable component in the sample's style.
4. **Data:** how the sample fetches remote data and shows remote images; anything special for Vega
   (allowed hosts, permissions, manifest/`manifest.toml` entries for network access, http vs https).
   Our backend will be `http://10.0.2.2:8000` from the Vega Virtual Device (plain HTTP, local) and later
   an https Lambda URL. Will plain HTTP work on Vega?
5. **Polling:** the TV must poll `GET /api/state` every ~1 s and re-render when `version` changes.
   Recommend the simplest pattern that works on both targets (hooks, timers, AbortController support).
6. **Styling and animation:** how styles/themes are done; is `Animated` / Reanimated available on Vega
   for small transitions (cards fading out when a kid joins)? Can it load Google Fonts on web and custom
   fonts on Vega? Our design tokens will come from `apps/alexa-web/design/tokens.json` (ajan3 is making them).
7. **Gotchas:** anything in the sample README, issues, or Vega docs about known problems (we already know
   `vega run-app` fails to launch; launch with `vega device launch-app --appName <id>.main`).

Friction: problems with Vega CLI/SDK, the sample, or Amazon docs go into your report (rule 8), exact error text.
