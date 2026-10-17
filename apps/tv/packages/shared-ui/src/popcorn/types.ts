export type Screen = 'couch' | 'duel' | 'recommendations' | 'details';

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
}

export interface TVState {
  version: number; // goes up on every change; re-render only when it changes
  updated_at: number;
  members: Member[];
  screen: Screen;
  message: string; // short status line, e.g. "Saved: Inception"
  recommendations: MovieCard[];
  boost: string[]; // tonight's mood genres
  duel: Duel | null;
  details: Details | null;
}
