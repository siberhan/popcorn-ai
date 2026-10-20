import { API_BASE_URL } from './config';
import type { FavCard, Genre, Reaction } from './types';

export interface ApiErrorResponse {
  error: string;
}

export interface FavCatalog {
  for_you: { genre: string; films: FavCard[] }[]; // one list per genre of the person
  popular: FavCard[];
  best: FavCard[];
}

/**
 * Catalog for the favorites page: a list per genre of the person, popular films and best of all time.
 */
export async function getFavoritesCatalog(baseUrl: string = API_BASE_URL): Promise<FavCatalog> {
  const res = await fetch(`${baseUrl}/api/favorites/catalog`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return {
    for_you: Array.isArray(data.for_you) ? data.for_you : [],
    popular: Array.isArray(data.popular) ? data.popular : [],
    best: Array.isArray(data.best) ? data.best : [],
  };
}

/**
 * Open the favorites page for a person (screen 'favorites').
 */
export async function startFavorites(name: string, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/favorites', { start: name }, baseUrl);
}

/**
 * Pick / un-pick a film by id.
 */
export async function toggleFavorite(id: number, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/favorites', { toggle: id }, baseUrl);
}

/**
 * Search films on the favorites screen. "" clears.
 */
export async function searchFavorites(query: string, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/favorites', { query }, baseUrl);
}

/**
 * Finish picking favorites (min 5). Saves favorites and returns to couch.
 */
export async function doneFavorites(baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/favorites', { done: true }, baseUrl);
}

/**
 * Add a member to the couch. A new profile comes back on screen 'genres'.
 */
export async function addToCouch(name: string, age?: number, baseUrl: string = API_BASE_URL): Promise<any> {
  const body: { add: string; age?: number } = { add: name };
  if (age !== undefined) {
    body.age = age;
  }
  const res = await fetch(`${baseUrl}/api/couch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/**
 * Remove a member from the couch.
 */
export async function removeFromCouch(name: string, baseUrl: string = API_BASE_URL): Promise<any> {
  const res = await fetch(`${baseUrl}/api/couch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remove: name }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/** Every TMDB movie genre except "TV Movie" (the genre grid). */
export async function getGenres(baseUrl: string = API_BASE_URL): Promise<Genre[]> {
  const res = await fetch(`${baseUrl}/api/genres`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return Array.isArray(data.genres) ? data.genres : [];
}

/** POST a JSON body (or none) and throw the server's `error` text on a non-2xx status. */
async function post(path: string, body: object | undefined, baseUrl: string): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/**
 * Edit a profile: a new name and/or age. `age: null` clears the age; leaving `age` out keeps it.
 */
export async function editPerson(
  name: string,
  changes: { name?: string; age?: number | null },
  baseUrl: string = API_BASE_URL,
): Promise<any> {
  return post('/api/person', { edit: name, ...changes }, baseUrl);
}

/**
 * Save the genres a person picked (1+ TMDB genre names). A person who has not finished their favorites
 * yet gets them started, so the server may move the TV to screen 'favorites'.
 */
export async function saveGenres(name: string, genres: string[], baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/person', { name, genres }, baseUrl);
}

/**
 * Delete a profile for good (genres, favorites history and reviews included).
 */
export async function deletePerson(name: string, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/person', { delete: name }, baseUrl);
}

/**
 * Ask for tonight's picks: `more` asks again without the films already shown this evening.
 * `request` sets tonight's wish ("" = Skip); left out keeps it. One LLM call, up to 10 cards;
 * the server sets screen 'recommendations'.
 */
export async function recommend(more: boolean, request?: string, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/recommend', request === undefined ? { more } : { more, request }, baseUrl);
}

/**
 * The Popcorn button: screen 'ask' ("what do you feel like tonight?"). Someone with unfinished genres
 * or favorites is sent there first instead.
 */
export async function openAsk(baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/ask', {}, baseUrl);
}

/**
 * Tonight's wish. `{ok: true}`: the picks are on screen. `{ok: false, reply}`: a wish it cannot help
 * with; the TV stays on 'ask' and shows `reply`.
 */
export async function askTonight(text: string, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/ask', { text }, baseUrl);
}

/**
 * OK on a film in the reel: show its details screen.
 */
export async function openDetails(movieId: number, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/details', { movie_id: movieId }, baseUrl);
}

/**
 * Back: go to tonight's picks, the ask screen or the couch. Clears details, watching and rating.
 */
export async function goTo(screen: 'recommendations' | 'ask' | 'couch', baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/screen', { screen }, baseUrl);
}

/**
 * The reel settled on a film (no screen change; `focus` records the last one watched).
 */
export async function settleFocus(movieId: number, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/focus', { movie_id: movieId }, baseUrl);
}

/**
 * OK on a provider pill: the family is off watching the film there.
 */
export async function startWatching(movieId: number, provider: string, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/watch', { movie_id: movieId, provider }, baseUrl);
}

/**
 * "We're back": start the family rating (screen `rating`).
 */
export async function startRating(baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/rating/start', undefined, baseUrl);
}

/**
 * A written-rating pill for one person.
 */
export async function rateByHand(name: string, reaction: Reaction, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/rating/answer', { name, reaction }, baseUrl);
}

/**
 * Skip a person's turn (default: whoever is being asked).
 */
export async function skipTurn(name?: string, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/rating/skip', name === undefined ? {} : { name }, baseUrl);
}

/**
 * Back on the rating screen: save what is answered so far.
 */
export async function finishRating(baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/rating/finish', undefined, baseUrl);
}

// ---- URLs ----------------------------------------------------------------------------------

/** A server path such as "/api/voice/<sha1>.mp3" as a full URL (full URLs pass through). */
export function serverUrl(path: string, baseUrl: string = API_BASE_URL): string {
  return /^https?:\/\//.test(path) ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** The phone page: speaking a rating is the only thing it does. */
export function phoneUrl(baseUrl: string = API_BASE_URL): string {
  return `${baseUrl}/phone/`;
}

/** PNG QR code for the phone page. */
export function phoneQrUrl(baseUrl: string = API_BASE_URL): string {
  return `${baseUrl}/api/qr.png?url=${encodeURIComponent(phoneUrl(baseUrl))}`;
}
