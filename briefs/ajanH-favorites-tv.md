# ajanH: favorite films page replaces the duel screen (apps/tv)

YAGNI. Do not overcomplicate. Read `briefs/v4-favorites-contract.md` first: it is binding. ajanG builds the
backend and the phone page at the same time from the same contract, so use its names and shapes exactly.

## Do

- New `apps/tv/packages/shared-ui/src/popcorn/screens/FavoritesScreen.tsx` as in the contract's Flow:
  header + count line, search field (`FormTextField`, like `AskScreen.tsx`) + `PhoneQr` ("Scan to type"),
  Your picks, Popular right now / Best of all time (or the search results), Done + Back.
- Posters: reuse `PosterCard`. **5 columns**, rows as many as needed, inside a vertical spatial-nav scroll
  view. Use `alignInGrid` on the row containers (see `GenresScreen.tsx`) so Down keeps the column.
- Pick on OK: the film moves from its list to Your picks; OK again in Your picks (or in the list, for a
  search result) un-picks it and it goes back to its place. Do it at once on the TV (local optimistic
  list), send `POST /api/favorites {"toggle": id}`, and follow `state.favorites.picked` from the poll,
  so phone picks show on the TV within a second. On an error, undo and show the toast.
- The move should look like it flies up: use React Native `LayoutAnimation` (or a short `Animated`
  fade/slide) if it works on Vega; if not, an instant move is fine. No animation library.
- Search: typing on the TV sends `{"query": text}` after about 400 ms without typing; the results come
  from `state.favorites.results`, so a search typed on the phone also shows on the TV. Clearing the field
  sends `""`.
- Catalog: `GET /api/favorites/catalog` once when the page opens (`api.ts`).
- Wire it in `PopcornRoot.tsx` (`case 'favorites'`), `api.ts`, `types.ts` (`favorites`, `FavCard`,
  `Member.favorites/favorites_done`, remove `duel`). Remove `DuelScreen.tsx`, `pickDuel` and every
  other duel use (`CouchBar` label, Member `duel` texts in the couch/profile views, etc.).
- Same console theme as the other screens (`theme/console.ts`, `ConsoleBackdrop`, `ConsoleHeader`).
- Remote parity: every action works by the remote alone.

## Boundaries

- Edit only `apps/tv/packages/shared-ui/src/**` and your report. No backend changes. No git commands.
- Do not drive the Vega simulator. No screenshot needed (the backend is not ready yet).

## Verify / report

- `cd apps/tv/packages/shared-ui && npx tsc --noEmit --noUnusedLocals` passes.
- Report in `briefs/reports/ajanH-favorites-tv.md`: changed files, how the page works, whether
  LayoutAnimation is used, anything not done. End with DONE.
