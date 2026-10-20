# ajan3b report: taste test (poster duel) in the console world

Files changed (all under `apps/tv/packages/shared-ui/src/`): `popcorn/screens/DuelScreen.tsx` (rewritten, same props `state`, `onPick`), `theme/console.ts` (new `consoleDuel`, `consoleDuelType`, `consoleDuelColors`, `consoleDuelMotion`), `popcorn/types.ts` (`Duel.pairs?`, `Duel.picked?`). No new component file.

## What it does
- Console world: ConsoleBackdrop (reel layout, teal and rust), ConsoleHeader with the clock on the right, disc in the household colour, 44/600 question, outline Skip pill ("Skip the test", fills white when focused).
- Two 360x540 posters, 6 px white ring with ground gap and shadow, 1.04 scale, unfocused at 0.8 opacity, title 30/600 and "year · up to three genres" 22 under each, "or" between. No voice hint text anywhere.
- Pick strip bottom left: `total` slots 48x72; done slots show the picked poster, current slot a white 2 px outline, later slots 25% white; "Round N of M" 22 dim.
- Remote: left poster focused first; Left/Right between posters, OK picks, Up reaches Skip, Down returns. Back is unchanged (the old screen had no Back handler either).
- Pick drop: on OK the picked poster fades and drops into its strip slot (opacity and transform, 300 ms) while the next pair fades in (260 ms). Nothing waits on an Animated end callback. Focus returns to the left poster each round (unless Skip is focused).
- Round advance is optimistic when the server sent `pairs`: the next pair shows at once and the strip fills before the next poll. Without `pairs` it waits for the server state. A second OK on the same round within 2.5 s is ignored.
- Preload: current pair first, then all other `pairs` posters in order, one at a time with `Image.prefetch` (8 s timeout per poster so one slow image never stalls the queue). Module-level set of URLs, so a poster is never fetched twice.
- Empty state: "No taste test is running right now." in the console style.

## Verify
- `tsc --noEmit` in shared-ui: clean.
- Vega: `react-native build-kepler --build-type Release` in `apps/tv/apps/vega` succeeded (exit 0, "build-kepler completed"). I ran it directly because global yarn is 1.22 and corepack is not installed, so `yarn build:vega` itself would not start.
- Web screenshots at 1920x1080 against the running Expo web dev server, with mocked `/api/state` and `/api/duel` (Playwright, D-pad keys only). Posters are generated gradient SVGs served from a mock route, no real posters saved. No page errors.
- Not driven: Fire TV and VVD (not touched).

## Screenshots (`briefs/reports/ajan3-duel-shots/`)
- 01-round1-left-focused, 01b-round1-right-focused
- 02a-pick-drop-mid (thumbnail dropping into slot 1, round 2 fading in), 02b-round2-after-pick, 02c-round3-two-picked
- 03-round3-skip-focused, 03b-down-returns-to-poster
- 04-kid-long-titles (Deniz, round 2, long titles ellipsized on one line)
- 05-empty

## Deviations from the contract
- Captions are 440 px wide (poster 360) so long titles fit; they still sit centred under their poster and stay one line.
- Header uses `ConsoleHeader` with only the clock on the right (no couch discs), per the contract's "clock 24 secondary right".
- Empty state is one line, no sub-line.
- The old screen's roundDots, TMDB rating, genre pills and CouchBar are gone (replaced by the strip and header).
- Poster fallback (no image or load error) is a genre-tinted tile with the title, same idea as the reel's.

## Caveats
- Not tested on a real device; the user tests on the Fire TV. Check that `Image.prefetch` and the drop animation behave on Vega.
- The finish steps in the contract (finish review, DESIGN.md, raster provenance) were not part of this brief and are not done.
