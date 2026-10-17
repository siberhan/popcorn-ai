# TV app contract (Day 3)

The TV app shows what the MCP server says the screen is. It polls `GET {API}/api/state` and draws
one of four screens from `state.screen`. The remote (D-pad) sends a few actions back.

`API` default: `http://127.0.0.1:8000` on web, `http://10.0.2.2:8000` on the Vega Virtual Device.
A real sample is in `briefs/tv-state-sample.json`. Source of truth: `services/mcp/src/popcorn_mcp/service.py`.

## Types (put these in `apps/tv/packages/shared-ui/src/popcorn/types.ts`, owned by ajan1)

```ts
export type Screen = 'couch' | 'duel' | 'recommendations' | 'details';

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
}

export interface TVState {
  version: number;         // goes up on every change; re-render only when it changes
  updated_at: number;
  members: Member[];
  screen: Screen;
  message: string;         // short status line, e.g. "Saved: Inception"
  recommendations: MovieCard[];
  boost: string[];         // tonight's mood genres
  duel: Duel | null;
  details: Details | null;
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
DetailsScreen({ state })
```

Every screen shows the couch bar (member avatars, kid badge) and `state.message` at the top.
When `version` changes and a recommended movie is gone (kid joined), it fades out, not jumps.
