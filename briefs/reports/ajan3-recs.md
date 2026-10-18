# ajan3 report: console reel for the recommendations screen

The recommendations screen now uses the console world from the couch screen. Instead of the 3x2 grid, it shows one film in a band. The previous film shows as a faded ghost row above the band and the next film as a ghost row below it. Up and Down move through the films. The live kid filter works as before: removed films fade out in place, and the new list swaps in on a timer.

## Changes per file

All paths are under `apps/tv/packages/shared-ui/src/`.

| File | Change |
|---|---|
| `popcorn/screens/RecommendationsScreen.tsx` | Rewritten. **Layers:** `ConsoleBackdrop` (`layout="reel"`), then up to 6 reel rows, then invisible focus slots, then the position rail, the hint, and the console header. **Unchanged:** the props (`{ state }`), and selecting a film still does nothing. **No-poster tile:** drawn locally in `ReelPoster`. It uses the film's genre tint as the background, with the title at 40/600 and the year in white, bottom-left. While a poster is loading, only the tint shows. **Voice hook:** `onFilmSettled(movie)` is a module-level no-op. Its only action is a `__DEV__` console log, used to verify the timing. |
| `popcorn/components/ConsoleBackdrop.tsx` | New prop `layout?: 'couch' \| 'reel'`, default `'couch'`, which is unchanged. In `'reel'`, the main field sits low and centred behind the band (1680x1060 at 180/220), the rust field pools lower right (1000x820 at 1180/560), and there is no scrim or shade. The drift and the tint crossfade are the same as before. |
| `theme/console.ts` | **New:** `consoleReel` (sizes, ghost opacity 0.16, row tops, ring, pills, rail, voice bars), `consoleReelType` (60 / 44 / 32 / 26 / 24 / 22 / 20 / 40), `consoleReelMotion` (slide 450 ms, settle 1000 ms, kept line 4000 ms), `consoleReelColors` (pill outline, rail dot) and `consoleGenreTints`. The header comment now names both screens. `colors.ts` and `typography.ts` are untouched. |
| `popcorn/components/useClock.ts` (new) | The HH:MM clock hook, moved out of `CouchScreen.tsx` so that both screens use it. |
| `popcorn/components/avatarUtils.ts` | New `discInitialsForName()`, moved from `ProfileAvatar.tsx` and unchanged. |
| `popcorn/components/ProfileAvatar.tsx` | Imports `discInitialsForName` instead of its private copy. No behaviour change. |
| `popcorn/screens/CouchScreen.tsx` | Imports `useClock` from `../components` instead of defining it. No other change. I checked the couch screen with a regression shot. |
| `popcorn/components/index.ts` | Also exports `useClock`, `discInitialsForName` and the `ConsoleBackdropLayout` type. |

`CouchBar.tsx`, `PosterCard.tsx`, `colors.ts`, `typography.ts` and `PopcornRoot.tsx` are untouched. `PosterCard` is no longer used by this screen.

## How the reel is wired to spatial navigation

- **The focus slots.** One `SpatialNavigationNode orientation="vertical"` holds one `SpatialNavigationFocusableView` per film. Each slot renders an empty 0x0 View, and the reel itself is drawn separately.
  - **Keys:** the slots are keyed by position (`slot-0` to `slot-5`), not by film. When the list changes, slots are only added or removed at the end, so the order in LRUD stays correct.
  - **Entry:** only slot 0 is wrapped in `DefaultFocus enable`, so the first film has focus when the screen opens.
- **Moving.** Up and Down go to the neighbouring slot. LRUD does not wrap, so both ends clamp. The node has no horizontal neighbours, so Left and Right do nothing. I verified all of this with Playwright:
  - Up on pick 1 stays on "1 of 6".
  - Right then Left on pick 3 stays on "3 of 6".
  - A fifth Down from pick 2 stays on "6 of 6".
- **Following focus.** A slot's `onFocus` calls `moveTo(i)`. That sets `index` and runs one `Animated.timing` on a single `pos` value (450 ms, `Easing.out(cubic)`, `useNativeDriver: true`). Nothing uses `.start()` callbacks.
- **Focus after a list swap.** `placeAt(i)` sets `pos` with `setValue`, then grabs focus on `slotRefs[i]` in an effect that runs after the slots have re-registered. This is the same pattern as the couch screen.

## The slide

- **One value drives everything.** Every row, and the rail, interpolates from the single `pos` value. Each row is laid out at band size (380x570) and positioned at `top: 0`. Its values come from `pos` over `[i-2, i-1, i, i+1, i+2]`:

  | Value | Two below | Below | Band | Above | Two above |
  |---|---|---|---|---|---|
  | `translateY` | 1650 | 950 | 250 | -150 | -550 |
  | Row opacity | 0 | 0.16 | 1 | 0.16 | 0 |
  | Poster `scale` | 0.579 | 0.579 | 1 | 0.579 | 0.579 |

  220/380 is 0.579, so 220x330 grows to 380x570. RN 0.72 has no `transformOrigin`, so the poster also gets `translateX`/`translateY` of `-(1-s)·W/2` and `-(1-s)·H/2`. That makes it scale from its top-left corner. These offsets use the same breakpoints, so they stay exact throughout the slide.
- **Ring and drop shadow.** These are one layer inside the scaled poster box, and its opacity is 1 only at the band.
- **Text.**
  - The band text (title, meta, chips, why) is visible only within ±0.4 of a step from the band and slides in 160 px from the ghost text position.
  - The ghost text (title 44/600 and one meta line) is visible beyond ±0.6. It sits at the bottom of the poster when the row is above the band and at the top when the row is below, so it stays on the visible part of the poster.
- **Rail.** The white bar has `translateY = pos·24`. Each dot `i` moves up by 32 px as `pos` passes from `i-1` to `i`, which makes room for the 42 px bar.
- **Backdrop.** The tint comes from the focused film's genre and uses the backdrop's existing 600 ms crossfade.

## The kid-filter fade

The code path is the same as before (`displayItems` became `items`; `fadingOut` and `FADE_MS = 1800` are kept). The rows now live in refs and timers that do not reset on re-render.

1. **A new `state.version` drops films.** The previous list stays on screen. Removed films are flagged `fadingOut`, and their rows multiply their opacity by `fade`, a native 1800 ms timing from 1 to 0. Any row type can fade, band or ghost.
   - **Band:** the why line is replaced by "Not for this couch" in secondary, and the voice bars are hidden.
   - **Ghost:** the meta line reads "Not for this couch".
2. **The swap.** `setTimeout(swapIn, FADE_MS + 100)` swaps the new list in. It never uses an Animated end callback.
3. **Where focus lands.** If the focused film survived, focus stays on it at its new position. Otherwise focus goes to the same index, clamped to the new length. `pos` jumps with `setValue`, so the focused row does not move on screen.
4. **The kept line.** If a kid rule is active when films are removed, the header shows "Kept N kid-safe picks" (N is `incoming.length`) for 4000 ms from the change. It is joined to `state.message` with " · ".
5. **A newer version during the fade.** If it removes nothing, it replaces the pending list and does not cut the fade short. If it removes more films, a new fade starts.

Verified: focus on pick 2, Avatar. Then Can (9) joins and Hail Mary and Avatar are dropped. Mid-fade the screen shows both films fading, plus "Can joined · Kept 4 kid-safe picks" and "Picks stay PG". After the swap it shows "2 of 4" on Hoppers. The kept line was gone at 5.6 s.

## Voice hook timing (Playwright, timestamps taken in the page)

```
key ArrowDown at 4728 ms
key ArrowDown at 4932 ms
key ArrowDown at 5128 ms
key ArrowUp at 5374 ms
[reel] onFilmSettled 698687 Transformers One at 6390 ms, 1016 ms after the last key
key ArrowDown at 8150 ms
[reel] onFilmSettled 1327819 Hoppers at 9175 ms, 1025 ms after the last key
```

The quick moves fired nothing. Each stop fired once, about 1 s later. The timer is cleared on every move and on unmount, and it does not fire for a film that is fading out.

## Genre tint map (`consoleGenreTints`)

The first genre of the film that has an entry wins. Anything else uses the couch teal `#2C5C78`. The same colour is the background of the no-poster tile, so I checked white text on each one (WCAG).

| Genre | Colour | Hex | White on it |
|---|---|---|---|
| Science Fiction | deep teal | `#1F5F6B` | 7.22:1 |
| Animation | blue | `#2C5A96` | 6.98:1 |
| Action | rust | `#8A4526` | 7.09:1 |
| Drama | plum-brown | `#5E3B4C` | 9.52:1 |
| Comedy | ochre | `#80601F` | 5.82:1 |
| Horror | red-brown | `#5E2A22` | 11.47:1 |
| Fantasy | violet | `#4B4278` | 8.94:1 |
| Family | green | `#2F6650` | 6.69:1 |
| Thriller | slate | `#3D4C63` | 8.71:1 |
| Romance | rose-brown | `#7A3D4F` | 8.05:1 |
| Adventure | forest | `#3F6146` | 6.98:1 |

Measured on the screenshots:
- The dim `#8F98AB` hint and the "N of M" line on the real backdrop: 5.5:1 or better.
- Secondary text on the field: 8.3:1 or better.

## Decisions I made on my own, and what I could not do

- **"Tonight's picks · 1 of 6" is not above the title.** The contract places it there, but the craft floor bans a label above a heading without exception, and the brief said not to do anything the floor bans. So the position count sits under the rail as "1 of 6" (24, dim), and the words "Tonight's picks" are dropped. If you want the contract version back, it is one `Text` above `styles.title`.
- **Kid rule wording.** `getKidFilterLabel` is reused and rendered as "Picks stay PG" or "Picks stay PG-13", the first word of the label.
- **Ghost blur.** The sketch blurs the ghost rows (3 px). RN 0.72 has no view blur, so the ghosts are opacity only.
- **Runtime in the meta line.** The sketch's meta line has a runtime, but `MovieCard` has no runtime field. The meta is year · up to three genres.
- **When the kept line appears.** It shows whenever films are removed while a kid rule is active. It is not tied to the kid label changing in the same version: the server can send the couch change and the new list in separate versions, and the old check missed that case.
- **Rail and hint with one pick.** Both are hidden when there is only one pick.
- **Contract FINISH step not done.** The contract's FINISH line asks for a finish review, `DESIGN.md` and provenance. These were not in my brief, so I did not do them.
- **No device check.** I did not touch the Vega Virtual Device or the vega CLI. These need a check on Fire TV:
  - the native-driver slide with interpolated `pos`,
  - `Animated.multiply` for the fade,
  - the shadow on the ring gap.
- **Web-only warnings.** These are the same as on the couch screen (react-native-web 0.19.13): `shadow*`, `pointerEvents` and `useNativeDriver`.

## Verification

- **Live state.** Recorded before I started: v45, `screen` "recommendations", `members` [Bedirhan, Ayse]. Every capture intercepted `/api/state` in Playwright, and nothing was written to the server. Afterwards it was still v45, recommendations, [Bedirhan, Ayse]. Nothing needed restoring.
- **Preview.** The running preview on :8082 picked up my edits (it served the new bundle). No other server was started.
- **`yarn typecheck` (apps/tv).** It fails only on `DuelScreen.tsx(219,15)` and `(234,13)`, the known allowed errors.
- **Vega TS 4.8 check** (Vega `react-native-kepler` types, react-tv-space-navigation 5.2.0). I ran it on `RecommendationsScreen`, `CouchScreen`, `ConsoleBackdrop`, `ProfileAvatar`, `useClock` and `avatarUtils`. It reported only the old `useScale.ts` TS7016 error (react-native-pixel-perfect has no types).
- **Console.** The Playwright runs logged no console errors and no page errors.
- **Couch screen regression.** A regression shot of the couch screen looks the same as before. It is in the scratch directory, not in the repo.
- **Design hook.** It reported no issues on `RecommendationsScreen.tsx`.

## Screenshots

All are in `briefs/reports/ajan3-recs-shots/` at 1920x1080, captured with arrow keys only, and I opened each one once.

1. `01-pick-1-no-ghost-above.png`: pick 1 of 6, ghost below only (taken after an Up press that did nothing).
2. `02-pick-3-both-ghosts.png`: pick 3, Avatar ghost above and Hoppers ghost below, after Right/Left did nothing.
3. `03-last-pick-no-ghost-below.png`: 6 of 6, ghost above only, after an extra Down.
4. `04-mid-slide-200ms.png`: 200 ms after Down from pick 1. The poster is growing, the old film is rising and fading, and the rail bar is between dots.
5. `05-no-poster.png`: picks 1 and 2 without posters; the band shows the teal title tile.
6. `06-long-title.png`: a very long title capped at 2 lines and a why capped at 3 lines; all of it is on screen.
7. `07-kid-fade-in-progress.png`: Can joined. Avatar in the band and Hail Mary above both fade with "Not for this couch"; the header shows the kept line.
8. `08-kid-fade-after.png`: after the swap, Hoppers at "2 of 4", with the kept line still showing.
9. `09-empty.png`: "No picks yet" with the sub line, left-aligned at the band position.
10. `10-couch-4-mood-message.png`: 4 people on the couch, the message, "Picks stay PG" and the Comedy and Family mood chips.

## Friction (for the orchestrator to log)

- **Python Playwright delivers console events late.** In the sync API, console events are only delivered during Playwright calls, not during `time.sleep()`. My first timing check put a log at the wrong time (−0.85 s). I fixed it by recording `performance.now()` for keydowns and `onFilmSettled` logs inside the page and using `page.wait_for_timeout()`.
- **No Amazon or AWS tool friction this round.** I used no AWS tools.
