# TV app contract (Day 3)

The TV app shows what the MCP server says the screen is. It polls `GET {API}/api/state` and draws
one of four screens from `state.screen`. The remote (D-pad) sends a few actions back.

`API` default: `http://127.0.0.1:8000` on web, `http://10.0.2.2:8000` on the Vega Virtual Device.
A real sample is in `briefs/tv-state-sample.json`. Source of truth: `services/mcp/src/popcorn_mcp/service.py`.

## Types (put these in `apps/tv/packages/shared-ui/src/popcorn/types.ts`, owned by ajan1)

```ts
export type Screen = 'couch' | 'duel' | 'recommendations' | 'details' | 'rating';

export interface Member {
  name: string;
  age: number | null;
  kid: boolean;
  loves: string[]; likes: string[]; dislikes: string[]; never: string[];
  watched: string[];
  notes: string[];
  new: boolean;            // no taste memory yet
}

export interface MovieCard {
  id: number;
  title: string;
  year: string;            // "2026" or ""
  genres: string[];
  genre_ids: number[];
  rating: number;          // TMDB vote average, 0-10
  overview: string;
  poster: string | null;   // TMDB w342 URL, load at runtime, never save
  match?: number;          // 40-99, recommendations only
  why?: string;            // "Bedirhan loves science fiction · Ayse loves comedy"
}

export interface Duel {
  name: string;            // whose duel
  round: number;           // 0-based, rounds already done
  total: number;
  pair: [MovieCard, MovieCard] | [];   // left, right
  profile: string; shown: number[];    // internal, ignore
}

export interface Details extends MovieCard {
  tagline: string;
  runtime_minutes: number | null;
  certification_us: string | null;     // "PG-13"
  ok_for_this_couch: boolean;
  director: string | null;
  cast: string[];
  backdrop: string | null;             // TMDB w1280 URL, load at runtime, never save
  providers: Provider[];               // where to watch in `providers_region`, max 4, may be []
  providers_region: string;            // "US"
  providers_link: string | null;       // TMDB watch page for the region
}

export interface Provider {
  id: number;                          // TMDB provider_id
  name: string;                        // "Prime Video"
  logo: string | null;                 // TMDB w92 logo URL, load at runtime, never save
  kind: 'stream' | 'rent' | 'buy';     // flatrate -> stream; one entry per provider, stream > rent > buy
}

export interface Watching {
  movie_id: number;
  title: string;
  provider: string;                    // provider name the family chose
  started_at: number;                  // unix seconds
}

export type Reaction = 'loved' | 'liked' | 'meh' | 'disliked' | 'hated';

export interface RatingAnswer {
  reaction: Reaction | null;           // null when skipped
  quote: string;                       // what they said, "" for hand ratings and skips
  skipped: boolean;
  by: 'voice' | 'hand' | 'skip';
}

export interface Rating {
  movie: { id: number; title: string; year: string; poster: string | null; genres: string[] };
  people: string[];                    // display names, couch order at start
  asking: string | null;               // whose turn; null when done
  answers: Record<string, RatingAnswer>;  // keyed by display name, only people already answered or skipped
  live: string;                        // words heard so far for `asking`, "" when nobody is talking
  done: boolean;                       // true after everything is saved
}

export interface TVState {
  version: number;         // goes up on every change; re-render only when it changes
  updated_at: number;
  members: Member[];       // on the couch tonight
  household: Member[];     // every known person, on the couch or not, in the order they were added
  screen: Screen;
  message: string;         // short status line, e.g. "Saved: Inception"
  recommendations: MovieCard[];
  boost: string[];         // tonight's mood genres
  duel: Duel | null;
  details: Details | null;
  watching: Watching | null;   // set while the family is away watching; shown on the details screen
  rating: Rating | null;       // set on screen 'rating'
  focus: { movie_id: number; at: number } | null;   // film the reel settled on (voice page reads it)
}
```

Kid-safe: the couch is kid-safe when any member has `kid: true` or `age < 17`
(under 13 -> PG, under 17 -> PG-13). Show a "PG kid-safe" / "PG-13 kid-safe" badge.

## Actions (put these in `apps/tv/packages/shared-ui/src/popcorn/api.ts`, owned by ajan1)

| Function | HTTP | Body | Use |
|---|---|---|---|
| `pickDuel(side)` | `POST /api/duel` | `{"pick": "left" \| "right"}` | D-pad pick in a duel |
| `addToCouch(name, age?)` | `POST /api/couch` | `{"add": name, "age"?: n}` | not needed on TV now |
| `removeFromCouch(name)` | `POST /api/couch` | `{"remove": name}` | select a member avatar -> remove |
| `refreshPicks()` | `POST /api/recommend` | none | "Show picks" button on the couch screen |
| `openDetails(movieId)` | `POST /api/details` | `{"movie_id": n}` | OK on a film in the reel -> screen `details` |
| `goTo(screen)` | `POST /api/screen` | `{"screen": "recommendations" \| "couch"}` | Back; clears `details`, `watching`, `rating` |
| `settleFocus(movieId)` | `POST /api/focus` | `{"movie_id": n}` | reel `onFilmSettled`; sets `focus` (no screen change) |
| `startWatching(movieId, provider)` | `POST /api/watch` | `{"movie_id": n, "provider": "Prime Video"}` | OK on a provider pill; sets `watching` |
| `startRating()` | `POST /api/rating/start` | none | "We're back"; uses `watching` (or `details`) -> screen `rating` |
| `rateByHand(name, reaction)` | `POST /api/rating/answer` | `{"name": s, "reaction": Reaction}` | hand-rating pill |
| `skipTurn(name?)` | `POST /api/rating/skip` | `{"name"?: s}` (default `asking`) | Skip pill |
| `finishRating()` | `POST /api/rating/finish` | none | Back on the rating screen: save what is answered |
| (voice page only) | `POST /api/rating/live` | `{"text": s}` | interim words for `asking`; no `version` bump spam: at most 4/s |

Rating rules (server): `people` = couch at start. `asking` = first person in `people` without an answer.
Each answer or skip moves `asking` on. When nobody is left (or on `finish`), the server calls
`mark_watched(movie, reactions, who=people)` with the non-null reactions, sets `done: true`,
`asking: null`, message `Saved: <title>`. `goTo('couch')` then clears `rating`.
The MCP tools for the voice side are `start_rating(movie?)` and
`record_reaction(name, reaction | null, quote)` (null = skip); they share this logic.

Errors come back as `{"error": "..."}` with status 400 or 503. Show the text in a small toast.

## Screen components (owned by ajan3)

Folder: `apps/tv/packages/shared-ui/src/popcorn/screens/` and `.../popcorn/components/`.
Each screen is a default-exported React component with these props. React 18 and React Native
core primitives only (it must run on Vega: React 18.2, RN 0.72). Focus with
`SpatialNavigationFocusableView` / `DefaultFocus` from `react-tv-space-navigation`.

```ts
CouchScreen({ state, onRemoveMember, onShowPicks })
DuelScreen({ state, onPick })                 // onPick('left' | 'right')
RecommendationsScreen({ state })              // grid; selecting a card does nothing on Day 3
DetailsScreen({ state, onWatch, onWereBack, onBack })   // onWatch(provider name)
RatingScreen({ state, onRate, onSkip, onFinish, onDone }) // onRate(name, reaction), onDone = back to couch
```
RecommendationsScreen also gets `onOpen(movieId)` (OK on the focused film) and `onFilmSettled(movieId)`.

Every screen shows the couch bar (member avatars, kid badge) and `state.message` at the top.
When `version` changes and a recommended movie is gone (kid joined), it fades out, not jumps.
