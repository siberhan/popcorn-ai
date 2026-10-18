# ajan3: Details (backdrop hero) and family rating (voice spotlight), TV, Day 5

Read `briefs/rules.md` and `briefs/tv-contract.md` first (types, actions table, rating rules: binding).
Hard rules 1-8 apply. Only `apps/tv/` and your report.

## Contracts (binding)

- `apps/tv/packages/shared-ui/.impeccable/surfaces/src-popcorn-screens-detailsscreen-tsx.md`,
  sketch `.impeccable/mocks/decision/details-backdrop.html`.
- `apps/tv/packages/shared-ui/.impeccable/surfaces/src-popcorn-screens-ratingscreen-tsx.md`,
  sketch `.impeccable/mocks/decision/rating-voice-spotlight.html`. **The contract wins over the sketch**:
  the user added a visible **Skip** pill on every person's turn (next to "Rate by hand"), Back is
  "finish and save", and the right-arrow hint is gone.
- Read `.claude/skills/impeccable/reference/craft-floor.md`. Never copy contract text into source.

## Work

1. **types.ts / api.ts:** the new types and every TV action from the table (same fetch style).
2. **RecommendationsScreen:** OK on the focused film calls `onOpen(movie.id)`. `onFilmSettled` calls
   `settleFocus(movie.id)` (fire and forget, errors ignored). Do not change the reel otherwise.
3. **DetailsScreen.tsx:** rebuild as the backdrop hero. Console header like the reel screen (reuse its
   header pieces; extract a shared component if that is clean). Provider pills with logos
   (`Image`, hot-linked). OK on a pill -> `startWatching`; when `state.watching` is set, the pills area
   shows the handoff panel with a focused "We're back" -> `startRating`. Back on the handoff only
   hides it locally (no request; the panel shows again when `watching` changes); Back on the pills ->
   `goTo('recommendations')`. Wire Back with the remote's back
   key the way the app already handles keys (check `configureRemoteControl`). No providers: the line
   from the contract plus "We're back". Footer attribution "Streaming data by JustWatch".
4. **RatingScreen.tsx (new):** the voice spotlight. Disc colour = household index colour like the
   couch screen. Voice bars animate (native driver) only while `rating.live` changed in the last
   ~1.2 s. "Rate by hand" opens the 5 pills (Loved it, Liked it, It was fine, Didn't like it,
   Hated it -> loved, liked, meh, disliked, hated) -> `rateByHand(asking, r)`; Back closes them.
   "Skip" -> `skipTurn()`. Back otherwise -> `finishRating()`. `done` -> saved view, "Back to the
   couch" -> `goTo('couch')`. Hand-off animation per the contract, timers own swaps.
5. **PopcornRoot:** route `rating`, pass the new handlers, toast errors like the others.
6. Tokens only in `theme/console.ts`.

## Verify (web preview only)

Expo web on http://localhost:8082 (if down, start it: `cd apps/tv/apps/expo-multi-tv && eval "$(fnm env)"
&& fnm use 24 && BROWSER=none npx expo start --web --port 8082`). The deployed server does not have
the new endpoints yet: **mock `/api/state` and every new POST in Playwright** (route interception) and
check the requests your UI sends. Do not change server state. **Do not touch the Vega Virtual Device
or the `vega` CLI.**

Shots at 1920x1080, D-pad keys only, into `briefs/reports/ajan3-details-rating-shots/`: details with a
real TMDB backdrop and 3 providers, a long title, no backdrop, no providers, handoff panel; rating:
first person with live text arriving, mid hand-off, hand panel open, after a skip, 4 people, saved
view. Open every PNG once. `yarn typecheck` in `apps/tv` (only the known DuelScreen 219/234 errors).

Report: `briefs/reports/ajan3-details-rating.md` (per-file changes, focus wiring, Back handling,
timings, what you could not do, shot list, friction). End with `DONE`.
