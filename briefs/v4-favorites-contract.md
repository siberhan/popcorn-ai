# v4 contract: favorite films replace the poster duel (binding for ajanG backend+phone and ajanH TV)

YAGNI. The duel goes away completely. In its place: a page where a new person picks the films they like
(min 5, max 25) from two lists and from search. The TV and the phone show the same page at the same time.
Everything in `v3-contract.md` not named here stays as it is.

## Flow

1. Couch -> "+" -> name + age -> **Genres** (as today).
2. **Favorites (cannot be skipped, replaces the duel).** Saving genres for a person with
   `favorites_done: false` opens screen `favorites` for them. The page shows:
   - a header: "Pick films you like", the person's name, a count line ("3 picked, pick at least 5" /
     "7 picked" / "25 picked, that's the most").
   - a search field (typed with the remote) and a QR (`PhoneQr`, caption "Scan to type") for the phone.
   - **Your picks** (only when 1+ picked): the picked films, in pick order, at the top.
   - With an empty search: one list per genre of the person (title = the genre, e.g. **Comedy**: the 20
     best-known films of that genre, most TMDB votes first; 60 films), then **Popular right now** and **Best of all time**
     (both keep only films of the person's genres), 5 columns, as many rows as
     the lists need (scroll). With a search: **Results for "<query>"** instead of the two lists.
   - A picked film leaves its list and shows in Your picks; un-picked, it goes back to its place in its list.
   - Buttons: **Done** (works at 5+ picks) and **Back** (-> couch; Popcorn brings them back here).
3. Done -> profile saved, screen `couch`, message "Got it! <Name>'s taste is saved."
4. Ask / picks / rating as today. The recommender gets the favorite films instead of duel picks.

## Profile (stored)

`duel_history` and `duel_done` are removed. New:
```json
"favorites": [{"id": 27205, "title": "Inception", "year": "2010", "genres": ["Action", "Science Fiction"]}],  // max 25, pick order
"favorites_done": false
```
Old profiles without these keys get the defaults (`[]`, `false`), so they are asked once.

## `Member`

`duel` and `duel_done` are removed. New: `favorites: string[]` ("Inception (2010)", all of them),
`favorites_done: boolean`. `new` = genres empty or `favorites_done` false.

## TV state

`duel` and `Screen 'duel'` are removed. `Screen` gains `'favorites'`. New field:
```ts
favorites: null | {
  name: string;            // whose page it is
  picked: FavCard[];       // pick order
  query: string;           // "" = no search
  results: FavCard[];      // search results for `query` (max 20), [] when no search
  min: 5; max: 25;
}
interface FavCard { id: number; title: string; year: string; poster: string; rating: number; genres: string[] }
```

## HTTP API

| Route | Body | Does |
|---|---|---|
| `GET /api/favorites/catalog` | - | `{"for_you": [{"genre", "films": FavCard[]}], "popular": FavCard[], "best": FavCard[]}` (no film twice) for the person in `state.favorites`, kid-filtered by their own age (`cert_allowed`). 400 when no favorites page is open. The TV and phone fetch it once per page open. |
| `POST /api/favorites` | `{"start": name}` | open the page for that person (screen `favorites`); keeps their earlier picks if the same person's page was left with Back. |
| | `{"toggle": id}` | pick / un-pick. The id must be in the catalog or in `results` (no TMDB call). 26th pick -> 400 "You can pick up to 25 films". |
| | `{"query": s}` | TMDB search (`tmdb.search`), films with a poster, kid-filtered (certification checks only for kids), max 20 -> `results`. `""` clears. |
| | `{"done": true}` | fewer than 5 -> 400 "Pick at least 5 films". Else save `favorites` + `favorites_done: true`, `favorites: null`, screen `couch`. |
| `POST /api/person` | `{"genres": [...], "name": s}` | as today, but opens `favorites` (not a duel) when `favorites_done` is false. |
| `POST /api/ask` `{}` | | unfinished genres -> genres; unfinished favorites -> `favorites` (was: duel). |
| `POST /api/screen` | `{"screen": "couch"}` | Back from favorites; `state.favorites` stays so Popcorn can bring it back. |
| removed | | `/api/duel`, `/api/duel/start`. |
| `POST /events` | `{"popcorn": "seed_catalog"}` | builds the favorites catalog (replaces `seed_duel_catalog`). |

Every POST bumps the state `version`, so the other screen (TV or phone) sees the change with its next poll.

## Favorites catalog

One stored doc, key `favcat` -> `{"popular": [card + "cert"], "best": [card + "cert"], "built_at"}`.
- `popular`: TMDB `/trending/movie/week`, pages 1.. until 60 films.
- `best`: TMDB discover `sort_by=vote_average.desc`, `vote_count.gte=5000`, pages 1.. until 60 films.
  "Best" uses the TMDB score (`vote_average`); the IMDb score is not in TMDB, so no IMDb.
- Only films with a poster; a film already in `popular` is not repeated in `best`. Each film gets its US
  certification (`tmdb.certification`, existing semaphore); a failed check drops the film.
- `genres`: `{genre name: [card + "cert"]}`, one list built on first need (discover `with_genres`,
  `sort_by=vote_count.desc`, `vote_count.gte=1000`, 60 films, 3 pages), emptied when the doc is rebuilt.
- Seed: built when missing or older than 1 day; one seed call builds the whole doc (it must fit the
  Lambda timeout). The `duelcat:*` docs and all duel catalog code are removed.

## Recommender

User message line "Duel picks: ..." becomes "Favorite films: Inception (2010); ..." (all of them).

## Phone page

When `state.screen == "favorites"` the phone page shows the same page as the TV: header + count, a search
box (typing sends `{"query"}` after 400 ms without typing), Your picks, the two lists or the results,
tap = toggle, Done, in one column of 3 posters per row. It polls `/api/state` every second, so a pick on
the TV shows on the phone and a pick on the phone shows on the TV. Rating and ask modes stay as today.
The whole phone page uses the TV console theme (`apps/tv/packages/shared-ui/src/theme/console.ts`):
ground `#0B0D12`, field `#1C2230`, text `#FFFFFF`, secondary `#B4BCCB`, white pill buttons with
`#0B0D12` text, danger `#F28B82`, white focus/selected ring.
