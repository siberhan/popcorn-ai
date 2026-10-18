# ajan3 report: Details (backdrop hero) and family rating (voice spotlight)

Scope: `apps/tv/` only, plus this report and its shots folder. No changes to services/, git, AWS, FRICTION_LOG.md or the Vega device.

## Per-file changes (all under `apps/tv/packages/shared-ui/src/`)

- `popcorn/types.ts`
  - `Screen` now includes `'rating'`.
  - `Details` gains `backdrop`, `providers`, `providers_region` and `providers_link`.
  - New types: `Provider`, `Watching`, `Reaction`, `RatingAnswer` and `Rating`.
  - `TVState` gains `watching`, `rating` and `focus`. All of these match tv-contract.md.
- `popcorn/api.ts`
  - New private `post()` helper, in the same fetch style as the existing calls (throws `data.error` on non-2xx).
  - New actions, one per table row:
    - `openDetails` -> /api/details
    - `goTo` -> /api/screen
    - `settleFocus` -> /api/focus
    - `startWatching` -> /api/watch
    - `startRating` -> /api/rating/start
    - `rateByHand` -> /api/rating/answer
    - `skipTurn` -> /api/rating/skip (sends `{}` when no name is given)
    - `finishRating` -> /api/rating/finish
  - The existing calls are unchanged.
- `theme/console.ts`
  - New token groups: `consoleDetails*` (layout, scrim stops and strips, pills, type, colours, motion) and `consoleRating*` (layout, bars, progress row, type, colours, motion).
  - Screens contain no literal sizes or colours.
- `popcorn/components/ConsoleHeader.tsx` (new)
  - The reel screen's header (brand, couch discs, names and clock), extracted verbatim.
  - Optional `right` slot.
  - Exports `householdOrder`, `discColorIn` and `nameSlug`, so disc colours match the couch screen.
- `popcorn/components/useBackKey.ts` (new): see Back handling below.
- `popcorn/components/ConsoleBackdrop.tsx`: new `spotlight` layout and an optional `fieldOpacity` prop.
- `popcorn/components/CouchBar.tsx`: label for `rating`, needed for the `Record<Screen>` type.
- `popcorn/components/index.ts`: exports for the new pieces.
- `popcorn/screens/RecommendationsScreen.tsx`
  - The header now uses `ConsoleHeader`.
  - New props `onOpen` and `onFilmSettled`.
  - OK on the focused film calls `onOpen(movie.id)`.
  - The existing 1 s settle timer also calls `onFilmSettled(movie.id)`.
  - The reel is otherwise untouched.
- `popcorn/screens/DetailsScreen.tsx` (rewritten as the backdrop hero)
  - Backdrop:
    - Hot-linked TMDB backdrop on the right 1280 px.
    - Side, top and bottom scrims built from stacked strips (RN has no gradients).
    - Genre-tinted `ConsoleBackdrop` fallback when there is no backdrop or the image fails to load.
  - Info column:
    - Title on up to 2 lines.
    - Meta line: year, genres, runtime and certificate.
    - Chips: match, TMDB score and couch fit.
    - Overview: 4 lines, or 3 for long titles.
    - Credits line.
  - Provider pills: hot-linked logo with a letter fallback, name, and kind (Included / Rent / Buy).
  - Handoff panel ("Enjoy it on X" / "Come back when it's over" / "We're back").
  - No-providers line "Not streaming in the {region} right now" plus "We're back".
  - Footer: "Streaming data by JustWatch".
- `popcorn/screens/RatingScreen.tsx` (new voice spotlight)
  - Top to bottom:
    - Big disc in the household colour.
    - Popcorn's question.
    - Live transcript: 3-line fixed box; the last 3 words are dimmed while talking.
    - Voice bars.
    - "Rate by hand" and "Skip" pills.
    - Progress row: discs, result chips, "N of M".
  - The hand panel holds 5 pills (loved, liked, meh, disliked, hated).
  - Saved view: 112 px discs with chips, "Saved for ..." title, and "Back to the couch".
- `popcorn/PopcornRoot.tsx`
  - Routes `rating`.
  - Wires every new handler through a `run()` helper that shows the same error toast as the existing calls.
  - `settleFocus` is fire and forget (`.catch(() => {})`).

## Focus wiring

- **Reel:** unchanged; OK is on the slot's `onSelect`.
- **Details:**
  - Provider pills sit in a horizontal node, with `DefaultFocus` on the first pill.
  - When `watching` appears, a focusTarget effect calls `ref.focus()` on "We're back".
  - When the handoff is hidden with Back, focus returns to the provider that was chosen.
- **Rating:**
  - "Rate by hand" has `DefaultFocus`.
  - Opening the panel focuses "Loved it". Picking a pill or pressing Back closes the panel and refocuses "Rate by hand".
  - The panel lives inside a stable vertical node, so D-pad order survives mount and unmount.
  - The saved view focuses "Back to the couch".

## Back handling

- `useBackKey` listens on `RemoteControlManager` (`SupportedKeys.Back`, the same path `configureRemoteControl` uses; Backspace on web). It also registers a `BackHandler` `hardwareBackPress` listener that returns true, because Vega's BackHandler otherwise exits the app.
- The two listeners are deduped within 400 ms, and the handler is held in a ref.
- Details:
  - On the handoff, Back hides the panel locally with no request. The panel shows again when `watching` changes.
  - Otherwise Back calls `goTo('recommendations')`.
- Rating:
  - With the hand panel open, Back closes it (no request).
  - With the saved view showing, or no rating, Back calls `goTo('couch')`.
  - Otherwise Back calls `finishRating()`.

## Timings (all in console.ts motion tokens; native driver; setTimeout owns every state swap)

- Details:
  - Backdrop fades in over 600 ms while scaling from 1.04 to 1.
  - Info blocks rise 24 px over 520 ms, with an 80 ms stagger.
- Live window: the bars animate only while `rating.live` changed in the last 1200 ms; otherwise they rest at 8/50 scale and 0.5 opacity.
- Hand-off:
  - Slot geometry is read at 40 ms.
  - The text fades out and swaps at 150 ms.
  - The discs fly over 500 ms.
  - The flight is cleared at 570 ms.
  - The outgoing disc shrinks into its progress slot while the incoming one grows from its slot.
- Saved view fades in over 400 ms.

## Request log (Playwright mocks, D-pad only)

| Action | Request sent |
|---|---|
| Reel settle | `/api/focus {movie_id}` |
| OK on film | `/api/details {movie_id}` |
| Back on pills | `/api/screen {"screen":"recommendations"}` |
| OK on pill | `/api/watch {movie_id, provider:"Amazon Prime Video"}` |
| Back on handoff | none |
| We're back | `/api/rating/start` |
| Back on hand panel | none |
| It was fine | `/api/rating/answer {name:"Ayse", reaction:"meh"}` |
| Skip | `/api/rating/skip {}` |
| Back | `/api/rating/finish` |
| Back to the couch | `/api/screen {"screen":"couch"}` |

There were no console errors or page errors.

`yarn typecheck`: only the known DuelScreen(219,15) and (234,13) errors remain.

## What I could not do / caveats

- The new endpoints were tested only against Playwright mocks, because the deployed server does not have them yet.
- Not tested on Vega. The user tests on the device; check Back on the details and rating screens there.
- The handoff panel appears after the next state poll (about 1 s). It is not optimistic.
- The focused provider pill's 1.06 scale reaches about 15 px past the left safe edge.
- Copy I chose where the contract was silent:
  - "Say it out loud, or rate by hand" when the transcript is empty.
  - "No answer" on the saved view.
  - Saved-view title variants.
  - The `state.message` line on details.
  - The footer hint changes to "Back: where to watch" on the handoff.
  - "Rate by hand" toggles the panel open and closed.

## Shots (`briefs/reports/ajan3-details-rating-shots/`, 1920x1080, each opened once)

- 00-recommendations-after-back
- 01-details-backdrop-3-providers (real TMDB data: Project Hail Mary)
- 02-details-long-title (Harry Potter and the Deathly Hallows: Part 2)
- 03-details-no-backdrop
- 04-details-no-providers
- 05-details-handoff
- 05b-details-handoff-hidden-by-back
- 06-rating-first-person-live
- 07-rating-mid-handoff
- 08-rating-hand-panel
- 09-rating-after-skip
- 10-rating-4-people (live text)
- 11-rating-saved

## Friction

- No Amazon or AWS tool friction; no AWS tools were used.
- Non-AWS:
  - Playwright's default headless shell build was missing. Fixed by pointing `executable_path` at the installed Chromium 1234.
  - On RN web, children fire `onLayout` before their parent, so the first hand-off read slot y positions before the row's y was known. Fixed by storing slot y relative to the row.

DONE
