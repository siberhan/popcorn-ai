# ajan3 — TV screens (Day 3)

Read first: `briefs/rules.md`, `briefs/tv-contract.md`, `briefs/tv-research.md`, and your own
`apps/alexa-web/design/`. Your voice page work was accepted, thank you: the design is strong.

## Goal

The four TV screens of Popcorn AI for a 10-foot living-room TV (1920x1080, D-pad remote),
in the same "Cinema at Home" look. This is the screen the demo video is about: make it beautiful.

## You own

- `apps/alexa-web/design/TV.md` (new): the 10-foot rules (safe area 5%, min text size, focus style,
  layouts of the four screens). Write this first, short.
- `apps/tv/packages/shared-ui/src/popcorn/screens/` and `apps/tv/packages/shared-ui/src/popcorn/components/`.
  Nothing else in `apps/tv/` (ajan1 owns the shell, types, api, theme). Ask the orchestrator if you need a
  change there: write it in your report.

## Timing

ajan1 is creating `apps/tv/` now. Do `TV.md` first. Then wait until
`briefs/reports/ajan1-scaffold-ready.md` exists (check every minute), then build the screens.
If ajan1 left placeholder stubs with your file names, overwrite them.

## Screens (props in `tv-contract.md`)

1. **CouchScreen**: who is on the couch, big avatars (initials + your deterministic colors), KID badge,
   "new" members marked "No taste memory yet", each member's top loves. A focusable "Show picks"
   button (`onShowPicks`); selecting an avatar asks to remove that person (`onRemoveMember`).
2. **DuelScreen**: "<name>, pick a poster", round x of total, two big posters side by side, D-pad
   left/right focuses, select calls `onPick`. Focused poster scales up with a warm glow.
3. **RecommendationsScreen**: poster grid with match % and the "why" line, mood chips from `boost`,
   kid-safe badge. When a movie disappears after a version change (a kid joined), fade it out.
4. **DetailsScreen**: big poster, title, year, certification, runtime, director, cast, overview,
   and a clear "Not OK for this couch" warning when `ok_for_this_couch` is false.

Shared components: couch bar, poster card (with your typographic fallback when `poster` is null or
fails to load), match pill, kid badge, message line.

## Rules

- React 18 + React Native core primitives only (Vega runs React 18.2 / RN 0.72). No React 19 APIs,
  no web-only CSS, no new npm packages without writing why in your report.
- Animations with RN `Animated` only.
- Fonts: system fonts on Vega; Fraunces / Plus Jakarta Sans only on web if ajan1's shell loads them.
- Posters: TMDB URLs at runtime only; never save poster images. No Alexa / Amazon logos, no cyan ring.

## Done when

- With ajan1's `yarn dev:web` and the MCP server on 8000, all four screens render real state.
  Drive them with the voice page (`apps/alexa-web`, live mode) or with curl on `/api/*`.
- Screenshots at 1920x1080 of all four screens + the kid-joins fade in `briefs/reports/ajan3-tv-shots/`.
- Report in `briefs/reports/ajan3-tv.md`; last line `TV SCREENS DONE`.
