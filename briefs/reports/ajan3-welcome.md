# ajan3 report: "Who's watching?" welcome screen

Brief: `briefs/ajan3-welcome-screen.md`. Date: 2026-10-18.

## Files changed

All under `apps/tv/packages/shared-ui/src/popcorn/`:

| File | Change |
| --- | --- |
| `screens/CouchScreen.tsx` | Rewritten. Peacock-style picker: a "+" tile, then one round avatar per household person, then the Popcorn button. Optimistic toggles. The add form swaps in place of the row. The old cards, the two-press remove and the confirm banner are gone. |
| `components/ProfileAvatar.tsx` (new) | `ProfileAvatar`: initials on the person's color, with focus growth, a green ring and check badge when on the couch, a KID badge, and a hint line. `AddProfileTile`: the "+" tile. Both share one `RoundTile`. |
| `components/AddMemberForm.tsx` (new) | Name (required) and age (optional, digits only) fields, plus Add and Cancel. Every control is reachable with the D-pad. |
| `components/PopcornButton.tsx` (new) | `PopcornButton` (when disabled it is dimmed, still focusable, and does nothing) and `PopcornMark` (a popcorn bucket drawn with Views; no image assets). |
| `components/index.ts` | Adds exports for the new components and their prop types. |
| `PopcornRoot.tsx` | Adds a new `handleAddMember(name, age?)` that calls `addToCouch`; on failure it shows the toast "Failed to add member to couch". `handleRemoveMember` now returns true/false. Both `CouchScreen` usages pass `onAddMember`. No other changes. |

I did not touch `api.ts`, `types.ts`, `useTVState.ts`, `config*.ts`, the theme or anything outside `popcorn/`. `types.ts`, `briefs/tv-contract.md` and `services/mcp/*` already showed as modified in git before I started; those changes are not mine.

## How it works with the remote

- **Row:** "+" sits far left, then the household (`state.household`; when that is missing, `state.members`). Anyone on the couch who is missing from the household is added. People just added on this screen show up right away.
  - The row is centered and the name sits under each avatar.
  - With 7 or more people the avatars switch to a compact size, so the row still fits inside the safe area.
- **Default focus:** the first person on the couch, else the first avatar, else "+".
- **Left/Right:** moves along the row.
  - The focused avatar grows from 156px to 232px over 160ms (`Animated.timing`, no end callback), and its neighbours move aside.
  - It also gets a soft cream glow, a bigger bold name, and a hint line ("OK to join the couch" / "OK to leave the couch" / "OK to add someone").
- **OK on an avatar:** toggles that person.
  - Calls `addToCouch(name)` when they are off the couch and `removeFromCouch(name)` when they are on it.
  - The ring, the check badge and the CouchBar chips update at once (optimistic).
  - When the request succeeds, the screen follows `state.members` again from the next `state.version` on.
  - When it fails, the change is undone and PopcornRoot shows the error in the toast.
  - Each toggle has a request id, so a late answer to an older press cannot overwrite a newer one.
- **Couch members:** green ring (`colors.status.success`) with a green check badge at the top right. Kids keep the KID badge at the bottom of the circle.
- **Down:** goes to the Popcorn button. Up comes back to the row.
  - With nobody on the couch the button is dimmed (opacity 0.4, or 0.6 with a cream border when focused) and shows "Pick someone for the couch first". OK does nothing.
  - With people on the couch, OK first waits for any couch request still in flight, then calls `refreshPicks()` through `onShowPicks`.
- **OK on "+":** the form replaces the row and focus goes to the Name field.
  - A focused field shows "OK to type". OK focuses the real `TextInput`, which opens the keyboard on Vega.
  - While typing, spatial navigation is locked (`useLockSpatialNavigation`), so arrows and Enter go to the input.
  - Submitting the name moves focus to Age. Submitting the age moves focus to Add. Blur, submit or the keyboard closing (`keyboardDidHide`) unlocks navigation again.
  - The unlock waits one tick (`setTimeout(…, 0)`), so the Enter that submits the field does not also reopen it.
  - Age accepts digits only: anything else is stripped as you type, `maxLength` is 3 and the value must be 0–120. An empty name shows "Type a name first."
  - **Add:** the form closes, the new person appears in the row with the green ring, focus goes to them, and `addToCouch(name, age)` runs. On failure the person and the ring are removed again and the toast shows the error.
  - **Cancel:** the form closes and focus goes back to "+".
- The CouchBar and the title "Who's watching tonight?" stay. The CouchBar is fed the effective couch, so its chips match the rings.

## Test output (real)

All commands were run in `apps/tv`. Global yarn is 1.22, but the repo needs yarn 4.5, so I ran yarn through `npx -y corepack@0.31.0 yarn …` (no global change).

**`yarn typecheck`** fails, but only on errors that were already there before my change:

```
src/popcorn/screens/DuelScreen.tsx(219,...): error TS2322: Type 'MovieCard | undefined' is not assignable to type 'MovieCard'.
src/popcorn/screens/DuelScreen.tsx(234,...): error TS2322: Type 'MovieCard | undefined' is not assignable to type 'MovieCard'.
The command failed for workspaces that are depended upon by other workspaces; can't satisfy the dependency graph
```

None of these are in my files. I left `DuelScreen.tsx` alone because it is outside this task.

**`yarn lint:all`** also fails, and it failed the same way before my change:

```
command not found: eslint
```

To lint anyway, I used the Vega app's own eslint 8.57.1 with a scratch config that mirrors the repo rules (minus the prettier plugin) plus `react-hooks`. Result for `CouchScreen.tsx`, `ProfileAvatar.tsx`, `AddMemberForm.tsx`, `PopcornButton.tsx` and `PopcornRoot.tsx`: clean, 0 problems. The repo `eslint.config.js` itself cannot load ("Cannot find module 'eslint-plugin-prettier'"). I ran prettier on the new files. I did not run it on `PopcornRoot.tsx`, which already failed prettier at HEAD.

**Extra Vega type check:** TypeScript 4.8.4 against the Vega app's RN 0.72 Kepler types, using a scratch tsconfig. My files are clean. The only errors are unrelated ones (`window` / `KeyboardEvent` in `RemoteControlManager.ts`, and a pixel-perfect declaration).

**`expo-multi-tv` typecheck:** 45 errors in every shared-ui file. Almost all are "Cannot find module 'react-native'" / "'react-tv-space-navigation'" and an implicit `any` on `isFocused`, which is a module resolution problem that was already there. The rest are the DuelScreen errors. My files show only the same kinds of error.

**Live flow:** Playwright 1.57 drove headless Chromium at 1920x1080 against the live Lambda API, using only arrow keys and Enter:

1. Popcorn pressed while disabled → nothing happened (version unchanged).
2. Bedirhan joined, then Can joined.
3. Ayse joined and then left.
4. "+" opened the form. I typed "Deniz", then age "7x"; the "x" was filtered, so the server stored Deniz with age 7 and kid = true.
5. Add → Deniz showed up selected right away, and the server confirmed.
6. Popcorn → the server switched to recommendations and picks loaded (screenshot 12).
7. Cleanup removed everyone.
   - Final live state: `v31 screen=couch couch=[] household=[Bedirhan, Ayse, Can(9), Deniz(7)]`.
   - The couch is empty. Deniz is a profile I created and stays.

There were 2 console errors: the `/hot` and `/message` WebSocket 404s, which happen because a static dev export has no dev server. They are harmless.

## Screenshots

All are in `briefs/reports/ajan3-welcome-shots/`, at 1920x1080:

| File | Shows |
| --- | --- |
| `01-initial-default-focus.png` | Couch empty, default focus on the first avatar (Bedirhan), Popcorn disabled with its note |
| `02-popcorn-disabled-focused.png` | **Disabled Popcorn button** focused (dimmed, cream border, note) |
| `03-optimistic-ring.png` | Bedirhan's ring and check drawn right after OK (optimistic) |
| `04-some-selected-one-focused.png` | **Several people, some selected, one focused**: Bedirhan and Can on the couch, Ayse focused and enlarged |
| `05-add-tile-focused.png` | "+" focused |
| `06-add-form.png` | **Add form**, Name field focused ("OK to type") |
| `07-add-form-typing.png` | Typing a name (field in editing state) |
| `08-add-form-filled.png` | Name and age filled ("7x" stored as 7), Add focused |
| `09-added-optimistic.png` | Deniz appears selected and focused right after Add |
| `10-added-confirmed.png` | Same after the server confirmed |
| `11-popcorn-enabled-focused.png` | Popcorn enabled and focused (gold) |
| `12-after-popcorn.png` | Recommendations after Popcorn (posters load from the API; none are saved in the repo) |
| `13-after-cleanup.png` | Back on the couch screen after everyone was removed |
| `14-empty-household.png` | **Empty household**: only "+", focused by default, with the empty text and disabled Popcorn. This one is simulated: Playwright intercepted `/api/state` and set `household` and `members` to `[]`, because the live household cannot be emptied. |

I did not copy the Peacock reference image into the repo.

## What I could not check

- **Vega `TextInput` on a real device or the simulator.** I could not check:
  - that `.focus()` opens the on-screen keyboard;
  - that `onSubmitEditing` and `keyboardDidHide` fire as expected;
  - that `underlineColorKepler="transparent"` hides the underline;
  - that `keyboardType="number-pad"` gives a number keyboard.
- **Whether TVEventHandler / `react-tv-space-navigation` still gets D-pad events while the Vega IME is open.** I lock spatial navigation while typing for this reason. If the IME eats Back without firing `keyboardDidHide`, the lock is released only on blur or unmount.
- **Animation performance on Vega.** The grow animation uses `useNativeDriver: false` (width and height cannot use the native driver), so it should be checked on the device.
- **Everything else:** I only tested on the web export, not on Vega hardware.

## Decisions I made myself

1. **The CouchBar shows the optimistic couch**, the same as the rings, so the top bar and the row never disagree.
2. **There is always a hint line under the focused tile**, with opacity 0 when the tile is not focused, so the layout does not jump.
3. **Popcorn waits for couch requests still in flight** before it calls `refreshPicks()`, so picks are made for the couch the user sees.
4. **Text entry is two-step:** focus the field, then press OK to type ("OK to type"). Submitting a field moves focus forward (Name → Age → Add).
5. **The form keeps the Popcorn button visible** below it, and Popcorn is enabled when someone is already on the couch.
6. **Compact avatar size from 7 people up** (120→184 instead of 156→232).
7. **A soft spotlight ellipse** (`colors.bg.spotlight`) sits behind the title and row, as a nod to the Peacock stage.
8. **New-person age:** under 13 shows the KID badge right away; the server's answer takes over on the next version.
9. **I left the existing `DuelScreen.tsx` typecheck errors alone**, because that file is outside this task.

## Notes for the orchestrator

- **The Expo preview on :8082 served a stale bundle.** It did not have `AddMemberForm` or `handleAddMember`, even though watchman saw the files.
  - I did not restart it, as instructed.
  - Instead I tested a fresh `CI=1 expo export --platform web --dev` from my scratchpad, served on `127.0.0.1:8093`. That server is stopped now.
  - Restart the :8082 preview to see the new screen.
- **`yarn lint:all` is broken repo-wide:** eslint is not installed in `apps/tv`, and `eslint-plugin-prettier` is missing for the root config.
- **`yarn typecheck` fails on the existing DuelScreen errors** (`MovieCard | undefined`).

## Friction log entries

**1. Amazon buildertools MCP needs `set_project_context` before every other tool**

- Tool and version: Amazon buildertools MCP v1.0.17, run through npx. The install printed several npm deprecation warnings.
- What I tried: calling the documentation search tool to look up Vega `TextInput` and the keyboard.
- Expected: search results.
- Actual: every tool call returned
  `{"error":"PROJECT_CONTEXT_REQUIRED","message":"You must call set_project_context before using any other tool..."}`
- Workaround: calling `set_project_context({config:{}})` first. After that the search worked.

**2. No Vega doc on TextInput together with D-pad focus libraries**

- Tool and version: Vega developer docs, searched through buildertools MCP v1.0.17.
- What I tried: finding out whether TVEventHandler / `react-tv-space-navigation` keeps getting D-pad events while the on-screen keyboard is visible, and how a focusable wrapper should hand focus to a `TextInput`.
- Expected: guidance on TextInput focus and the keyboard on TV.
- Actual: the docs cover `TextInput`, `Keyboard` events and `underlineColorKepler`, but nothing about TVEventHandler or spatial navigation while the IME is open. I found no error text; the information simply was not there.
- Workaround: lock spatial navigation while a field is being edited, and unlock it on submit, blur, `keyboardDidHide` or unmount. This still needs a check on a real device.
