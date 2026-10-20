# ajan3 — couch screen: edit/delete bubbles, plain names, no QR here, duel after Add (TV)

Repo: apps/tv (shared-ui, popcorn). Read `briefs/v2-contract.md` (incl. "Remote parity") and
`briefs/ajan2-profile-edit.md` (routes you call; another agent builds them in parallel — code against the
shapes, test with a local stub or mocked fetch). Do not commit or deploy. Never save movie posters in the repo.

## User feedback (screenshot: couch screen, avatars "Can, 9", "Deniz, 7", KID badges, QR top right)
1. **Labels**: show only the name ("Can"), never ", 9". The KID badge already says kid.
2. **Edit / delete**: when an avatar is focused, two small round bubbles appear on top of it, side by side above the
   circle: a pencil (edit) and an X (delete). Not on the Add tile.
   - Remote path: focused avatar → D-pad Up moves focus into the bubbles (pencil first), Left/Right between them,
     Down back to the avatar. OK on pencil → edit form; OK on X → delete confirm. Back closes / returns to the avatar.
   - Bubbles are visible (dimmer) whenever the avatar is focused, bright with a focus ring when the bubble itself is focused.
     Hide them when nothing in that avatar's group has focus. Must not shift the row layout.
   - Edit: reuse `AddMemberForm` prefilled (name, age), title "Edit <name>", Save → `POST /api/person {"edit": old, "name", "age"}`.
     Clearing the age field sends `"age": null`.
   - Delete: a small confirm ("Delete <name>? Their taste memory goes too." — Delete / Cancel, Cancel focused first)
     → `POST /api/person {"delete": name}`.
   - Optimistic UI is fine; errors show in the existing message style.
3. **No "Talk to Popcorn" / QR on this screen** (first-run large QR and the small couch QR both go). The first screen
   is only creating profiles and then the taste test for new profiles. Move the small `PhoneQr` to the
   recommendations (reel) screen in a corner where it overlaps nothing; first-run hint text about voice goes too.
4. **Duel after Add**: when the TV Add form creates a *new* profile (`/api/couch` add response has `new_people`
   containing them), call `POST /api/duel/start {"name"}` so the duel screen opens. Existing profiles: no duel.

Check web build (and that Vega typechecks/builds: `yarn build:vega` in apps/tv). Screenshots of: focused avatar with
bubbles, pencil focused, edit form prefilled, delete confirm, plain labels, reel with QR, into
`briefs/reports/ajan3-profile-edit-shots/`. Do not drive the Fire TV / VVD.

## Report
`briefs/reports/ajan3-profile-edit.md`: changes, remote paths, screenshots list, open issues. Short.
