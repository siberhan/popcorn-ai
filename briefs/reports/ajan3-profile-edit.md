# ajan3: couch screen edit/delete bubbles (TV)

Brief: `briefs/ajan3-profile-edit.md`. Files changed only under `apps/tv/packages/shared-ui/src/popcorn/`.

## Changes
- `api.ts`: `editPerson(name, {name?, age?})`, `deletePerson(name)`, `startDuel(name)` (shapes from ajan2's brief).
- `components/ProfileAvatar.tsx`: labels are the plain name ("Can"); KID badge unchanged. New pencil and X bubbles above the disc (absolute, the row does not shift). Dim (60%) while the avatar is focused, bright with white ring when the bubble itself is focused, hidden otherwise. Not on the Add tile.
- `components/AddMemberForm.tsx`: optional `initialName`, `initialAge`, `submitLabel` (edit mode, "Save"); `FormButton` exported; `formIsTyping()` so Back while typing does not close the form.
- `components/ConfirmDelete.tsx` (new): memory note plus Delete / Cancel, Cancel focused first. Title above reads "Delete Can?".
- `screens/CouchScreen.tsx`: modes add / edit / delete, optimistic edit (rename, age) and delete with undo on error, Back closes a form or confirm and refocuses the avatar. `PhoneQr` and the first-run QR and voice hint text removed (empty hint is "Press + to add someone.").
- `screens/RecommendationsScreen.tsx`: small `PhoneQr` bottom right, above the key hints (overlaps nothing).
- `PopcornRoot.tsx`: `handleEditMember`, `handleDeleteMember`; `handleAddMember` calls `POST /api/duel/start {name}` when `new_people` contains the added name (existing profiles: no duel). Errors go to the existing toast.

## Remote paths
- Avatar focused: Up goes to the pencil, Left/Right pencil <-> X, Down back to the avatar, Back on a bubble returns to the avatar.
- OK on pencil: "Edit <name>" form prefilled; Save sends `{"edit": old, "name", "age"}`, empty age sends `null`. Back or Cancel returns to the avatar.
- OK on X: "Delete <name>?" confirm, Cancel focused; Delete sends `{"delete": name}`, focus moves to the previous avatar. Back = Cancel.

## Verification
- `yarn build:vega` equivalent (`npm run build:release` in `apps/vega`, because `corepack`/yarn 4 is not on this machine's PATH): succeeded. Nothing installed or launched.
- shared-ui `tsc`: only pre-existing DuelScreen errors (not mine).
- Web preview at 1920x1080, Playwright with mocked API and agent. Request log: `edit {Can, age null}`, `delete Deniz`, `couch add Mira age 8` followed by `duel/start Mira`. No page errors.

## Screenshots (`briefs/reports/ajan3-profile-edit-shots/`)
00-start-plain-labels, 01-avatar-focused-bubbles, 02-pencil-focused, 02b-x-focused, 03-edit-form-prefilled, 03b-back-from-form-avatar-focused, 04-delete-confirm, 04b-back-from-confirm, 05-age-cleared-in-form, 06-after-save, 07-delete-confirm-deniz, 08-after-delete, 09-add-form-filled, 10-after-add-duel-or-not (mock keeps screen on couch), 11-reel-with-qr (stub QR image, posters empty).

## Open issues
- The lib only uses `DefaultFocus` at start, so arriving at an avatar from a neighbour first lands on a bubble and is redirected to the avatar in the next tick (no visible flicker in web; check on Fire TV).
- Left/Right past the end of the two bubbles moves on to the neighbouring avatar.
- Delete button is the white primary pill (no red variant).
- Vega on-screen keyboard Back handling relies on `formIsTyping()` grace of 600 ms; untested on device.

## Fix: bubbles overlapped the title
`consoleLayout.titleTop` in `apps/tv/packages/shared-ui/src/theme/console.ts` changed 250 -> 170 (only CouchScreen uses it). Row top (390) and bubble offsets are unchanged. At 1920x1080 the title's descenders end near y=240 and the bubbles start near y=296 (focused avatar scaled), about 56 px clear. The title also moves up in the add/edit/delete views. `tsc` clean; shot `01-avatar-focused-bubbles.png` overwritten.
