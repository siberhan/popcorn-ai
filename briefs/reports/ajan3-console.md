# ajan3 report: console redesign of the couch screen

The behaviour is the same as before: optimistic seat/unseat, household ordering, DefaultFocus rules, the add-form flow and its spatial-navigation lock, compact mode at 7+ people, and the Popcorn button waiting for in-flight requests. Only the render tree and styles changed.

## Changes per file

All paths are under `apps/tv/packages/shared-ui/src/`.

| File | Change |
|---|---|
| `theme/console.ts` (new) | The new tokens, used only by the couch screen and its components. **Colours:** ground `#0B0D12`, text white, secondary `#B4BCCB`, placeholder, on-light near-black, ring, CTA, add disc, field `#1C2230`, outline, danger, and the backdrop teal and rust. **Discs:** the 8 disc colours. **Type scale:** 60 title, 40 info, 30 names, 28 header, 26 secondary, 20 credit, 18 chip; weights 500/600. **Also:** layout sizes and motion timings. `colors.ts` and `typography.ts` are untouched. |
| `assets/images/backdrop-blob.png` (new) | A procedural 512x512 white radial blob. Its provenance is embedded as a png tEXt chunk with `impeccable embed-prompt`. |
| `popcorn/components/ConsoleBackdrop.tsx` (new) | The backdrop. How it works is described below. |
| `popcorn/components/avatarUtils.ts` | The name hash is now a shared private `nameHash()`. The new `consoleDiscColorForName()` uses the same hash to index the console palette. `avatarColorForName()` behaves as before. |
| `popcorn/components/ProfileAvatar.tsx` | Rewritten as round console tiles. **Focus:** scale 1.22 on a 160 ms native-driver `Animated` timing, a 6 px white ring, and a soft black drop shadow; the name moves down with the lift. **Seated:** a white check badge at the bottom right plus a white name. **Unseated:** the name is in the secondary colour. **Kids:** the label reads "Can, 9", with a "KID" outline chip under the disc. **Initials:** one letter, or the first and last initials for names with several words. The "+" tile is drawn as a translucent white disc. |
| `popcorn/components/PopcornButton.tsx` | A white pill, 88 tall, with a near-black "Popcorn" label and a redrawn near-black popcorn mark (a striped box with a kernel cloud, built from Views). When focused, a white ring with a gap appears and the pill scales to 1.06. With nobody seated it shows at 40% opacity, stays focusable, and does nothing on Enter. The old note under the button is removed. |
| `popcorn/components/AddMemberForm.tsx` | Same logic and focus order, restyled. **Fields:** dark `#1C2230`, 80 tall, with a 2 px white focus ring and a slightly lighter fill while editing. **Buttons:** a white "Add" pill and an outline "Cancel" pill, each with a focus ring. **Removed:** the card and the form's own title; the screen heading covers that now. |
| `popcorn/components/index.ts` | Exports `ConsoleBackdrop`, `consoleDiscColorForName` and the `PopcornMarkProps` type. |
| `popcorn/screens/CouchScreen.tsx` | The render tree and styles are rewritten; the logic is untouched. **Layers:** `ConsoleBackdrop` sits behind everything, and the console header replaces `CouchBar` on this screen only ("Popcorn AI" top left, an HH:MM 24 h clock top right refreshed every 30 s). **Heading:** "Who's watching?", which becomes "Add someone new" while the form is open. **Bottom left, the info block:** the count line at 40/600, then a 26 px secondary line, then the TMDB credit at 20 px. **Bottom right:** the Popcorn button. Focusing a person crossfades the backdrop to their disc colour, and focusing "+" returns it to teal. |

`CouchBar.tsx`, `colors.ts`, `typography.ts`, `PopcornRoot.tsx` and `theme/index.ts` are unchanged.

### The secondary line in the info block

- **Someone under 17 on the couch:** the kid rule, taken from the youngest kid. For example "Can is 9, so picks stay PG", or "Zeynep is 15, so picks stay PG-13". PG always wins over PG-13, and a kid without an age counts as the youngest.
- **Empty household:** "Press + to add someone, or say who is watching."
- **People on the couch, none of them kids:** nothing.
- **Nobody seated:** "Press OK on a name to join the couch."

## Disc colours: contrast of white initials (WCAG)

| Index | Colour | Hex | Contrast with white |
|---|---|---|---|
| 0 | ochre | `#8A5A12` | 5.91:1 |
| 1 | slate | `#4A5A72` | 7.01:1 |
| 2 | rose | `#A3415F` | 6.04:1 |
| 3 | blue | `#2B5EAE` | 6.33:1 |
| 4 | plum-brown | `#6B3F4E` | 8.58:1 |
| 5 | deep teal | `#1F6475` | 6.69:1 |
| 6 | green | `#226B55` | 6.36:1 |
| 7 | brick | `#8E4A2E` | 6.63:1 |

All 8 are at least 5.9:1, above the 4.5:1 minimum.

Other text pairs:
- Secondary `#B4BCCB` on the ground colour: 10.2:1.
- Secondary on a field: 8.3:1.
- Placeholder `#8F98AB` on a field: 5.5:1.
- Error `#F28B82` on the ground colour: 8.1:1.

## How the backdrop is drawn and animated

### The blob image

- A 512x512 RGBA image. RGB is pure white.
- Alpha is `0.94 * (0.5 + 0.5 cos(pi r))^2`. It peaks at 240 in the centre and is exactly 0 at the edge.
- A +-1 LSB triangular dither (seed 7) is applied before quantising.
- It peaks at 240 rather than 255 because a fully opaque centre showed up as a hard disc through the web tint filter.
- The generator and the provenance text are in the scratch directory, not in the repo.

### Image layers

There are 3 image layers, under the limit of 4. All are `Image` with `resizeMode="stretch"` and the `tintColor` prop.

| Layer | Placement | Opacity | Tint |
|---|---|---|---|
| Rust field | Lower right, 1100x1000 | 0.35 | `#96582E` |
| Main field, slot A | Upper right two thirds, 1640x1360 | 0.55 × fade A | The current tint |
| Main field, slot B | Same as slot A | 0.55 × fade B | The current tint |

### Scrim

- A near-solid ground-colour block (0.94) covers x 0–560.
- Next come 28 abutting ground-colour strips. Their opacity follows a smoothstep down to clear at x 1400.
- A bottom shade of 20 horizontal strips starts at y 640 and rises to 0.85. It keeps the info block and the button readable.
- Strip edges are rounded to whole pixels, so there are no overlap lines.

### Drift

- One `Animated.loop` over a single linear `Animated.timing`, value 0→1 over 26 s, with `useNativeDriver: true`.
- translateX, translateY and scale are interpolated through 13 samples of a sine wave, so the end of the cycle equals its start and the loop has no jump.
- The rust layer moves on its own phase and in the opposite direction.
- I used a single timing, not a sequence, so the native loop runs without JS end callbacks.
- The loop is stopped on unmount.

### Tint crossfade

- When `tint` changes, the inactive slot gets the new colour.
- Two independent 600 ms native-driver timings then fade that slot in and the other slot out.
- The active slot is tracked in a ref that changes when the fade starts. No `.start()` callback is used, so a missing end callback on Vega cannot get it stuck.
- `tintColor` itself is never animated.

## What I could not do

- **No device check.** I did not use the Vega Virtual Device or the CLI. These parts are only verified on web:
  - the `tintColor` prop on Images,
  - the native-driver loop,
  - shadows.

  Please check on the Fire TV that the backdrop is tinted, not white, and that it drifts.
- **Web-only banding in the backdrop.** Faint concentric steps are visible in web screenshots (red-channel steps of 2–3). react-native-web 0.19.13 tints through an SVG filter that composites in linearRGB on 8-bit premultiplied values. I could not fix this without touching `node_modules`, and it should not happen with native tinting.
- **The :8082 preview was stale.** It runs with `CI=1`, so Metro does not watch files and never picked up my edits. I did not restart it. Instead, for the screenshots I made a static dev export (`npx expo export --platform web --dev`) into the scratch directory and served it on 127.0.0.1:8093. That server is now stopped.
- **The drift was not paused for captures.** I waited about 1.1 s after each key press instead. The backdrop position differs slightly between shots.
- **Server messages are hidden on this screen.** With `CouchBar` replaced on the couch screen, the server's `state.message` (for example "Ayse joined") is no longer shown there. Other screens still show it.
- **Two shared disc colours.** The palette has 8 colours and the hash is unchanged, so Ayse and Ela both land on rose.
- **Long names are cut off in compact mode.** At 7+ people, a long name ends with an ellipsis ("Zeynep ..."), which also hides the age.
- **Web-only warnings.** These come from react-native-web, with no alternative in RN 0.72:
  - "shadow* style props are deprecated",
  - "props.pointerEvents is deprecated",
  - "useNativeDriver is not supported" (it falls back to JS).

## Verification

- **Live state.** Before the capture, the state was v40 with the couch [Bedirhan, Ela, Ayse]. The run seated Can (v41) and then unseated him (v42). The state is now v42 with the couch [Bedirhan, Ela, Ayse], so it is restored. I typed into the add form ("Mira", 12) and then cancelled it, so no profile was created.
- **Capture method.** Playwright at 1920x1080, using only arrow keys and Enter. The empty household (shot 13), the 8-person compact row (shot 14) and the kid on the couch (shot 10) used an intercepted `/api/state`. The only console errors were the export's dev WebSocket 404s.
- **`yarn typecheck` (apps/tv).** It fails only on `DuelScreen.tsx(219,15)` and `(234,13)`, the known allowed failures.
- **Vega TS 4.8 check.** I ran it on the 5 couch files. It reported only the pre-existing `useScale.ts` TS7016 error (react-native-pixel-perfect has no types).
- **Design hook.** It reported no deterministic issues after any of my edits.

## Screenshots

All are in `briefs/reports/ajan3-console-shots/`, and I opened each one once.

1. `01-default-view.png`: the default view.
2. `02-focus-moved.png`: focus on Deniz, with the backdrop crossfaded to green.
3. `03-seated-can-kid-rule.png`: Can seated, with a check badge and white name; the info line reads "4 people on the couch / Can is 9, so picks stay PG".
4. `04-unseated-can.png`: Can unseated again.
5. `05-add-tile-focused.png`: the "+" tile focused, with the backdrop back to teal.
6. `06-add-form-empty.png`: the add form, empty, with the Name field focused.
7. `07-add-form-filled.png`: the form filled in ("Mira", 12) with "Add" focused.
8. `08-add-form-cancel-focused.png`: "Cancel" focused.
9. `09-popcorn-focused.png`: the Popcorn button focused and enabled.
10. `10-kid-on-couch.png`: a kid on the couch (intercepted).
11. `11-nobody-seated.png`: nobody seated.
12. `12-popcorn-disabled-focused.png`: the Popcorn button focused while disabled, at 40% with its ring.
13. `13-empty-household.png`: the empty household, with only "+" and the empty-state info (intercepted).
14. `14-compact-8-people.png`: compact mode with 8 people, 3 seated and focus moved (intercepted).

## Friction (for the orchestrator to log)

- **The shared :8082 preview runs with `CI=1`.** Metro does not watch files, so agents' edits never reach it. A static `expo export --platform web --dev` served separately works as a workaround but takes about 40 s per rebuild. Running the preview without `CI=1` would let agents see their edits live.
- **react-native-web 0.19.13 tints Images through an SVG filter that composites in linearRGB,** with no `color-interpolation-filters="sRGB"`. Soft tinted gradients show faint banding on web that native does not have.
- **React Native Web warns about `shadow*`, `pointerEvents` and `useNativeDriver`** on every screen that uses the RN 0.72 forms of these props. This is console noise that hides real warnings.
