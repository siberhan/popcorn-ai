# ajanB: v3 TV (apps/tv/packages/shared-ui)

Read first: `briefs/v3-contract.md` (binding), `briefs/rules.md` (hard rules 2, 3, 6, 7 apply),
`briefs/tv-contract.md` (for the old shapes). Read all of `apps/tv/packages/shared-ui/src/popcorn/` and
`src/theme/console.ts`. Keep the console visual language (tokens and existing components); read
`.claude/skills/impeccable/reference/craft-floor.md` before UI work. Every action must work by remote
(D-pad + OK + Back) alone.

## Do

1. `types.ts`, `api.ts`, `config*.ts`: the contract's Member, state fields (`genres`, `genres_for`,
   `picks_loading`, `shown_tonight`), routes (`getGenres`, `saveGenres`, `recommend(more)`). Remove
   `AGENT_URL`, `newSession`, `sendEvent`, `markSeen`, duel skip; `phoneUrl` has no agent param.
2. AddMemberForm: name + age only (remove anything else it asks).
3. New `GenresScreen`: multi-select grid of `/api/genres`, focus ring, selected state, "Continue" disabled
   until 1+ selected; whose genres in the header. Also reachable from the profile edit view (prefilled,
   saves and returns there).
4. DuelScreen: remove the Skip pill and any skip path.
5. Couch "Show picks" and reel "New picks" call `recommend(false/true)`; show a loading state while
   `picks_loading` or the call runs. Reel cards: drop the match pill; keep the why narration.
6. DetailsScreen: remove "Already seen".
7. RatingScreen cleanup: show only the film (poster, title), whose turn, the 5 written buttons
   (labels from the contract), Skip, a clear QR with one line "Scan to say what you thought", and the live
   words / spoken summary when there is one. Remove every other line of text on that screen.
8. Remove the agent wiring in `PopcornRoot.tsx` (session, events, "Thinking..." from agent calls). The
   VoiceBar stays only for speech captions and rating listening. Remove the couch/first-run "Talk to
   Popcorn" QR (voice is only in the rating now).

## Boundaries

- Edit only `apps/tv/packages/shared-ui/**` and your report `briefs/reports/ajanB-v3-tv.md`.
  No git commands. Do not touch the Vega Virtual Device or `vega device` commands (the user tests on device).
- No new dependencies. Match the surrounding code style and comment density.
- Something in the contract impossible: stop and write it in the report.

## Verify

`apps/tv/packages/shared-ui/node_modules/.bin/tsc --noEmit` in `apps/tv/packages/shared-ui` must pass.
If a web preview exists (`yarn` scripts in `apps/tv`), take 1920x1080 screenshots of genres, duel, reel,
rating with mocked `/api/state` into `briefs/reports/ajanB-v3-shots/` and look at each once.
Report: changed files, decisions, tsc output, shots, anything not done. End with DONE.
