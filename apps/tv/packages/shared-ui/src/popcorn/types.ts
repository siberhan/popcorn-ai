export type Screen = 'couch' | 'duel' | 'recommendations' | 'details' | 'rating';

export interface Member {
  name: string;
  age: number | null;
  kid: boolean;
  loves: string[];
  likes: string[];
  dislikes: string[];
  never: string[];
  watched: string[];
  notes: string[];
  new: boolean; // no taste memory yet
  role?: string | null; // "dad", "older son"; null if unknown (v2)
  gender?: 'male' | 'female' | null; // (v2)
  named?: boolean; // false when `name` is a label such as "Ahmet's son" (v2)
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
  match?: number; // 40-99, recommendations only
  why?: string; // "Bedirhan loves science fiction · Ayse loves comedy"
  why_audio?: string | null; // "/api/voice/<sha1>.mp3", recommendations only (v2)
}

export interface Duel {
  name: string; // whose duel
  round: number; // 0-based, rounds already done
  total: number;
  pair: [MovieCard, MovieCard] | []; // left, right
  profile: string;
  shown: number[]; // internal, ignore
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

export type Reaction = 'loved' | 'liked' | 'meh' | 'disliked' | 'hated';

export interface RatingAnswer {
  reaction: Reaction | null; // null when skipped
  quote: string; // what they said, "" for hand ratings and skips
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

/** What the phone microphone is doing right now. */
export interface Voice {
  state: 'idle' | 'listening' | 'thinking';
  text: string; // live words while listening, the final text while thinking
  speaker: string | null;
  at: number;
}

export interface TVState {
  version: number; // goes up on every change; re-render only when it changes
  updated_at: number;
  members: Member[]; // on the couch tonight
  household: Member[]; // every known person, on the couch or not, in the order they were added
  screen: Screen;
  message: string; // short status line, e.g. "Saved: Inception"
  recommendations: MovieCard[];
  boost: string[]; // tonight's mood genres
  duel: Duel | null;
  details: Details | null;
  watching: Watching | null; // set while the family is away watching; shown on the details screen
  rating: Rating | null; // set on screen 'rating'
  focus: { movie_id: number; at: number } | null; // film the reel settled on (voice page reads it)
  speech?: Speech[]; // last 6, ids go up (v2; missing on older servers)
  voice?: Voice; // (v2; missing on older servers)
}
