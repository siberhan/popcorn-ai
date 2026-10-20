# ajanB v3: the TV, remote only

Brief: `briefs/ajanB-v3-tv.md`, against `briefs/v3-contract.md` and `briefs/tv-contract.md`.
I changed files only under `apps/tv/packages/shared-ui/src/` (plus one deleted component), and added this report and `briefs/reports/ajanB-v3-shots/`. No git commands, no new dependencies, nothing outside the TV app touched.

The console language is unchanged: same ground, fields and rings, `scaledPixels` sizes, `ConsoleHeader`/`ConsoleBackdrop`, three-dot ellipsis and typographic apostrophes in prose.

## Per-file changes

| File | Change |
|---|---|
| `popcorn/types.ts` | `Screen` is `couch \| genres \| duel \| recommendations \| details \| rating`. New `Genre {id,name}`, `Review {title,year,reaction,summary}`, `ShownTitle {id,title,year}`. `Member` is now `{name, age, kid, genres, duel, duel_done, reviews, new}`. `MovieCard` loses `match` and keeps `why`/`why_audio`. `RatingAnswer.quote` is documented as the LLM summary of what was said. `TVState` gains `genres_for`, `picks_loading`, `shown_tonight`; `boost` is gone. |
| `popcorn/api.ts` | Removed `newSession`, `sendEvent`, `markSeen`, `AgentEvent`, the `AGENT_URL` import and the duel `'skip'` argument. `pickDuel(side)` takes only left/right. New `getGenres()` (GET `/api/genres`), `saveGenres(name, genres)` (POST `/api/person`), `recommend(more)` (POST `/api/recommend`). `phoneUrl(base)` is `${base}/phone/`, no agent parameter; `phoneQrUrl` still asks the server for the PNG. |
| `popcorn/config.ts`, `popcorn/config.vega.ts` | `AGENT_URL` removed; only `API_BASE_URL` remains. |
| `src/index.ts` | Exports `pickDuel`, `addToCouch`, `removeFromCouch`, `getGenres`, `saveGenres`, `recommend` and `API_BASE_URL`; no agent symbols. |
| `theme/console.ts` | New `consoleGenres`/`consoleGenresType` for the grid. `consoleRating`/`consoleRatingType`/`consoleRatingMotion` rewritten for the slimmer screen. `consoleQr` reduced to the rating-size code. Duel skip and rating handoff tokens removed. |
| `popcorn/components/AddMemberForm.tsx` | Still name + age only. `FormButton` gains `disabled` (dimmed, still focusable, inert on OK) and the form gains an optional third button `secondaryAction` — used as "Edit genres" in the edit view. |
| `popcorn/components/PhoneQr.tsx` | Rating only: a 300 px code in a white frame and exactly one caption line. Failed state is "QR code unavailable". |
| `popcorn/components/VoiceBar.tsx` | The `waiting` ("Thinking...") mode is gone; speech captions and rating listening only. |
| `popcorn/components/MatchPill.tsx` | Deleted (no match percentage in v3). |
| `popcorn/components/index.ts`, `popcorn/components/CouchBar.tsx` | Export list updated; `CouchBar`'s screen-label map gained `genres` so it still typechecks. |
| `popcorn/screens/GenresScreen.tsx` | New. |
| `popcorn/screens/CouchScreen.tsx` | New `{kind:'genres'}` mode renders the grid full screen and returns to the edit form on save. Edit form gets "Edit genres". "Show picks" and the Popcorn button are blocked while `picks_loading`. |
| `popcorn/screens/DuelScreen.tsx` | Skip pill, its focus path, its hint and its tokens are gone; every round starts on the left poster. |
| `popcorn/screens/RecommendationsScreen.tsx` | Match pill removed (TMDB score stays); header says "Picking..." and the status "Popcorn is picking new films..." while a picks call runs. New-picks pill is inert while picking. Empty state explains both cases. Why narration untouched. |
| `popcorn/screens/DetailsScreen.tsx` | "Already seen" pill and its state are gone; footer is "Left/Right: choose · OK: watch there · Back: tonight's picks". |
| `popcorn/screens/RatingScreen.tsx` | Rewritten (see below). |
| `popcorn/PopcornRoot.tsx` | Session start, `sendEvent`, `runEvent`, `waiting` removed. `recommend(false/true)` behind one `picking` flag, combined with `state.picks_loading` and passed to the couch and the reel. `handleSaveGenres` for the grid. `case 'genres'` renders the grid with **no** `onBack` (Back is inert there). |

## The genre grid

`GenresScreen({state, name, selected, onSave, onBack})`:

- Multi-select grid of `/api/genres`, five columns, cells sized so the last column lines up with the Continue button's right edge. Ring and ground gap sit inside the cell, so a focused chip scales without shifting the grid. Chosen chips are white with a dark label and a drawn check; a focused unselected chip uses the same `fieldEditing` tint as the form fields.
- Header right: disc, "`Name`'s genres", clock. Title "What does `Name` love?" with one line under it.
- Bottom bar: "Pick at least one genre" / "1 genre picked" / "n genres picked", and Continue, disabled (dimmed) until one is chosen, "Saving..." while the POST runs.
- Focus starts on a genre the person already has, else the first one; the backdrop tint follows the focused genre.
- Loading line, and any fetch failure (or an empty list) shows the message plus "Try again" — no dead ends.
- Back calls `onBack` when there is one. From the edit form that returns to the form (unsaved name/age edits are lost — see Decisions).

## The rating screen

Only what the contract asks for: the film (poster and title), whose turn, the five written answers with the contract's labels (`Loved it`, `Liked it`, `It was okay`, `Didn't like it`, `Hated it`), Skip, one clear QR with the single line "Scan to say what you thought", and the live words / last spoken summary when there is one. No brand, clock, progress row, flight animation, rate-by-hand toggle or "Thinking...".

- Live words sit in one fixed-height quote box, so nothing jumps when the phone starts or stops. While words keep arriving the last three are dimmed and the small bars next to "`Name`, what did you think?" move; 1.2 s of silence fades the bars out and the line goes solid.
- With no live words, the box shows the last spoken answer's summary: `Deniz said "…"`.
- When everyone has answered, the same screen says "Saved to everyone's taste" (or "Saved for X and Y") and offers one solid "Back to the couch". The only other text is one hint line: "Back: finish and save".

## Decisions

1. **One line of text outside the contract on the rating screen** (the Back hint). Without it the remote user has no way to learn that Back saves. Everything else the brief listed as removable is gone.
2. **Back is inert on the enforced genres step.** `PopcornRoot` renders the grid without `onBack`, so the only ways forward are choosing a genre and pressing Continue.
3. **Editing genres swaps the whole screen.** So coming back from the grid restores the form from the server copy; a name or age typed but not saved is dropped. The alternative (an overlay) would fight the focus tree for little gain.
4. **"Edit genres" is the third button** after Save and Cancel, so the destructive/dismissive action is not between the two live ones.
5. **Loading is one flag.** `picking || state.picks_loading` disables the couch Popcorn button, dims the reel's "New picks" pill and switches both status lines. That covers this TV's call and any other TV's, without a second source of truth.
6. **Small copy choices**: "Their picks start from these." (no internal jargon on the genres screen), "Popcorn is picking tonight's films..." / "Popcorn is picking new films...", and the reel's empty state names the two ways to get picks.
7. **Match is gone but the TMDB score pill stays** — it is a fact about the film, not a match claim.
8. **`CouchBar`, `PosterCard`, `KidBadge`, `MessageLine` are untouched.** They were already unused; deleting them is outside this brief. `MatchPill` was deleted because the brief removes the concept itself.

## Checks

- `cd apps/tv/packages/shared-ui && node_modules/.bin/tsc --noEmit` → no output, exit 0.
- Expo web preview at 1920×1080 with `/api/state`, `/api/genres` and `/api/qr.png` mocked in Playwright (real TMDB posters hot-linked at runtime, the QR fulfilled from a real PNG of the deployed endpoint). Each shot below was looked at once.
- Remote-only proof: the same run pressed keys and the server received
  `POST /api/person {"name":"Leyla","genres":["Adventure","Animation"]}` (Continue on the grid),
  `POST /api/recommend {"more":true}` (New picks from the reel header),
  `POST /api/rating/answer {"name":"Can","reaction":"loved"}` (first written answer), plus the reel's focus settle `POST /api/focus`.
  No page errors during any scenario.

| Shot | What it shows |
|---|---|
| `01-genres.png` | Fresh grid, first chip focused, Continue disabled, count line "Pick at least one genre". |
| `02-genres-selected.png` | Two genres chosen (white, check), focus on a chosen chip, Continue live. |
| `03-duel.png` | Duel with no Skip pill, left poster focused, pick strip at the bottom. |
| `04-reel.png` | Reel: no match pill, TMDB score only, "New picks" in the header, why narration line, no QR. |
| `05-reel-picking.png` | Same reel while a picks call runs: "Picking..." pill, "Popcorn is picking new films...". |
| `06-couch-picking.png` | Couch while picking: info line and a dimmed Popcorn button. |
| `07-details.png` | Details without "Already seen"; TMDB and "Not for this couch" only; new footer. |
| `08-rating-live.png` | Rating with the film, Can's turn, live words (unfinished tail dimmed) and the moving bars. |
| `09-rating-summary.png` | Same screen with the spoken summary line after Deniz answered by voice. |
| `10-rating-done.png` | Everyone answered: "Saved to everyone's taste" and one way out. |
| `11-edit-form.png` | Profile edit: name, age, Save / Cancel / Edit genres. |
| `11a-edit-form-genres-button.png` | "Edit genres" focused. |
| `12-genres-from-edit.png` | The grid opened from the edit form, prefilled with Mystery and Thriller. |

## Not done / outside this folder

- The server side of v3 (`/api/genres`, `/api/recommend {more}`, `shown_tonight`, the genre → duel sequencing, the phone page writing `rating.live` and `RatingAnswer.quote`) is another agent's brief; this TV only consumes it. The mock states above follow the contract's shape.
- No Vega device run this time; the shots are from the Expo web preview. The D-pad path (focus order, Back, focus return into the grid and the form) was exercised through the same spatial-navigation code, but a real remote pass on the device is still worth doing.
- `serve`/voice: the VoiceBar still plays speech captions and rating listening exactly as before; narration on the reel was not re-tested against a live server.

DONE
