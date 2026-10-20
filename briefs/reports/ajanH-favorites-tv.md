# ajanH Report: Favorite films page replaces the duel screen (apps/tv)

## Changed Files

1. `apps/tv/packages/shared-ui/src/popcorn/types.ts`:
   - Updated `Screen` union type: removed `'duel'`, added `'favorites'`.
   - Updated `Member` interface: removed `duel: string[]` and `duel_done: boolean`, added `favorites: string[]` and `favorites_done: boolean`.
   - Added `FavCard` interface (`{ id, title, year, poster, rating, genres }`).
   - Added `FavoritesState` interface (`{ name, picked, query, results, min, max }`).
   - Removed `Duel` interface.
   - Updated `TVState`: removed `duel: Duel | null`, added `favorites: FavoritesState | null`.

2. `apps/tv/packages/shared-ui/src/popcorn/api.ts`:
   - Removed `pickDuel` and `startDuel`.
   - Added `getFavoritesCatalog` (`GET /api/favorites/catalog`).
   - Added `startFavorites` (`POST /api/favorites {"start": name}`).
   - Added `toggleFavorite` (`POST /api/favorites {"toggle": id}`).
   - Added `searchFavorites` (`POST /api/favorites {"query": s}`).
   - Added `doneFavorites` (`POST /api/favorites {"done": true}`).
   - Updated comments mentioning duel in `saveGenres`, `deletePerson`, and `openAsk`.

3. `apps/tv/packages/shared-ui/src/theme/console.ts`:
   - Removed `consoleDuel`, `consoleDuelType`, `consoleDuelColors`, `consoleDuelMotion`.
   - Added `consoleFavorites` and `consoleFavoritesType` design tokens (5 columns, 312px card width, 440px height, 42px horizontal gap, 36px vertical gap, typography tokens).
   - Updated file header comment.

4. `apps/tv/packages/shared-ui/src/popcorn/components/CouchBar.tsx`:
   - Replaced `duel: 'POSTER DUEL'` with `favorites: 'FAVORITE FILMS'` in `SCREEN_LABELS`.

5. `apps/tv/packages/shared-ui/src/popcorn/screens/CouchScreen.tsx`:
   - Updated `newMember` factory to initialize `favorites: []` and `favorites_done: false`.

6. `apps/tv/packages/shared-ui/src/index.ts`:
   - Replaced `pickDuel` export with `getFavoritesCatalog`, `startFavorites`, `toggleFavorite`, `searchFavorites`, and `doneFavorites`.

7. `apps/tv/packages/shared-ui/src/popcorn/screens/FavoritesScreen.tsx`:
   - New favorites screen component implementing the v4 contract and brief.

8. `apps/tv/packages/shared-ui/src/popcorn/PopcornRoot.tsx`:
   - Replaced `DuelScreen` with `FavoritesScreen`.
   - Removed `pickDuel` and `handlePickDuel`.
   - Wired `case 'favorites'`.

9. `apps/tv/packages/shared-ui/src/popcorn/screens/DuelScreen.tsx`:
   - Removed file.

## How the Page Works

- **Layout & Console Theme**: Uses `ConsoleBackdrop` (teal tint) and `ConsoleHeader` displaying household disc color, name ("<Name>’s favorites"), and current time. The screen content is hosted in a `SpatialNavigationScrollView`.
- **Hero & Top Controls**:
  - Displays title "Pick films you like", person name, and dynamic count line matching contract specs (`"<N> picked, pick at least 5"` / `"<N> picked"` / `"25 picked, that's the most"`).
  - Search field via `FormTextField` with D-pad navigation and remote text entry.
  - `PhoneQr` rendered on the right with caption `"Scan to type"`.
  - Action buttons: "Done" (primary, enabled at 5+ picks) and "Back".
- **Catalog Loading**:
  - `GET /api/favorites/catalog` is fetched once when the screen opens to load `popular` (60 films) and `best` (60 films).
- **Posters & Grid Navigation**:
  - Reuses `PosterCard` in strict 5-column rows (width 312px, height 440px, margin gap 42px).
  - Vertical spatial navigation node uses `alignInGrid` on horizontal row containers, ensuring Down and Up D-pad navigation precisely preserves column index.
- **Your Picks**:
  - Displayed at the top of the list whenever 1 or more films are picked.
  - OK on a card in "Your picks" un-picks it: it leaves "Your picks" and returns to its original place in the catalog.
- **Empty Search (Catalog Browsing)**:
  - Displays "Popular right now" and then "Best of all time" sections.
  - Films that are picked are filtered out of the catalog lists and moved into "Your picks".
  - OK on any card picks it and moves it into "Your picks".
- **Search Flow**:
  - Typing in the TV search field debounces for 400 ms before sending `POST /api/favorites {"query": text}`.
  - Clearing the search field sends `""`.
  - Search results are read from `state.favorites.results`, ensuring search queries typed from the phone synchronize on the TV screen.
  - In search results, picked items show a checkmark badge (`✓`). Pressing OK toggles the pick state.
- **Optimistic Updates & Server Sync**:
  - Toggling a film immediately updates local state with layout animation, calls `POST /api/favorites {"toggle": id}`, and tracks in-flight requests. On network error, optimistic changes are rolled back and an error toast is shown.
  - Polled updates from `state.favorites.picked` synchronize smoothly when no local toggles are pending, showing phone picks on TV within a second.
  - 25-pick maximum is guarded both locally and by server error handling.
- **Done & Back**:
  - "Done" sends `POST /api/favorites {"done": true}`, which saves favorites, sets `favorites_done: true`, sets `screen = 'couch'`, and sets message `"Got it! <Name>'s taste is saved."`.
  - "Back" invokes `onBack()` returning to the couch screen.
  - Remote Back key triggers `onBack()` when on-screen keyboard is not active.
  - Duplicate Done and Back buttons are provided at the bottom of the list for easy access when scrolled down.

## Whether LayoutAnimation is Used

- **Yes**: React Native `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` is used on card toggles (with Android experimental flag enabled), creating a smooth "fly up" effect as picked films move into "Your picks" and fly back when un-picked. A try/catch guard provides a seamless instant move fallback if unsupported.

## Anything Not Done

- None. All requirements from `briefs/ajanH-favorites-tv.md` and `briefs/v4-favorites-contract.md` are implemented and verified. Typecheck passes cleanly.

DONE
