export type Screen = 'couch' | 'genres' | 'favorites' | 'ask' | 'recommendations' | 'details' | 'rating';

export type Reaction = 'loved' | 'liked' | 'meh' | 'disliked' | 'hated';

/** One TMDB movie genre (`GET /api/genres`), "TV Movie" excluded. */
export interface Genre {
  id: number;
  name: string; // "Science Fiction"
}

/** One film a person rated. A new review for the same film replaces the old one (moved to the end). */
export interface Review {
  title: string;
  year: string; // "2020" or ""
  reaction: Reaction;
  summary: string; // their opinion in one line (the LLM summary for a spoken answer)
}

export interface Member {
  name: string;
  age: number | null;
  kid: boolean; // age < 13, computed by the server
  genres: string[]; // exact TMDB genre names, chosen by the person
  favorites: string[]; // "Inception (2010)", all of them
  favorites_done: boolean;
  reviews: Review[]; // last 10, newest last
  new: boolean; // genres empty or favorites not done: the TV must finish genres/favorites first
}

export interface FavCard {
  id: number;
  title: string;
  year: string;
  poster: string;
  rating: number;
  genres: string[];
}

export interface FavoritesState {
  name: string; // whose page it is
  picked: FavCard[]; // pick order
  query: string; // "" = no search
  results: FavCard[]; // search results for `query` (max 20), [] when no search
  min: 5;
  max: 25;
}

export interface MovieCard {
  id: number;
  title: string;
  year: string; // "2026" or ""
  genres: string[];
  genre_ids: number[];
  rating: number; // TMDB vote average, 0-10
  overview: string;
  poster: string | null; // TMDB w342 URL, load at runtime, never save
  why?: string; // one spoiler-free sentence on why this group will enjoy it
  why_audio?: string | null; // "/api/voice/<sha1>.mp3", recommendations only
}

export interface Details extends MovieCard {
  tagline: string;
  runtime_minutes: number | null;
  certification_us: string | null; // "PG-13"
  ok_for_this_couch: boolean;
  director: string | null;
  cast: string[];
  backdrop: string | null; // TMDB w1280 URL, load at runtime, never save
  providers: Provider[]; // where to watch in `providers_region`, max 4, may be []
  providers_region: string; // "US"
  providers_link: string | null; // TMDB watch page for the region
}

export interface Provider {
  id: number; // TMDB provider_id
  name: string; // "Prime Video"
  logo: string | null; // TMDB w92 logo URL, load at runtime, never save
  kind: 'stream' | 'rent' | 'buy'; // flatrate -> stream; one entry per provider, stream > rent > buy
}

export interface Watching {
  movie_id: number;
  title: string;
  provider: string; // provider name the family chose
  started_at: number; // unix seconds
}

export interface RatingAnswer {
  reaction: Reaction | null; // null when skipped
  quote: string; // the LLM summary of a spoken answer, "" for button answers and skips
  skipped: boolean;
  by: 'voice' | 'hand' | 'skip';
}

export interface Rating {
  movie: { id: number; title: string; year: string; poster: string | null; genres: string[] };
  people: string[]; // display names, couch order at start
  asking: string | null; // whose turn; null when done
  answers: Record<string, RatingAnswer>; // keyed by display name, only people already answered or skipped
  live: string; // words heard so far for `asking`, "" when nobody is talking
  done: boolean; // true after everything is saved
}

/** One spoken line from the server; the TV plays every id above the last one it played, in order. */
export interface Speech {
  id: number;
  text: string;
  audio: string | null; // "/api/voice/<sha1>.mp3"; null if Polly failed
}

/** What the phone microphone is doing right now (the rating is the only voice input). */
export interface Voice {
  state: 'idle' | 'listening' | 'thinking';
  text: string; // live words while listening, the final text while thinking
  speaker: string | null;
  at: number;
}

/** A film shown this evening; "New picks" asks the server not to suggest these again. */
export interface ShownTitle {
  id: number;
  title: string;
  year: string;
}

export interface TVState {
  version: number; // goes up on every change; re-render only when it changes
  updated_at: number;
  members: Member[]; // on the couch tonight
  household: Member[]; // every known person, on the couch or not, in the order they were added
  screen: Screen;
  message: string; // short status line, e.g. "Saved: Inception"
  recommendations: MovieCard[]; // 10
  genres_for: string | null; // whose genres are being picked on screen 'genres'
  picks_loading: boolean; // true while a recommend call runs
  shown_tonight: ShownTitle[]; // reset by a couch change
  request: string; // what they feel like tonight, "" when skipped; reset by a couch change
  ask_reply: string; // the "sorry" line on screen 'ask' after a wish the picks cannot use, else ""
  favorites: FavoritesState | null;
  details: Details | null;
  watching: Watching | null; // set while the family is away watching; shown on the details screen
  rating: Rating | null; // set on screen 'rating'
  focus: { movie_id: number; at: number } | null; // film the reel settled on
  speech?: Speech[]; // last 6, ids go up
  voice?: Voice;
}
