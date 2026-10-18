import { API_BASE_URL, AGENT_URL } from './config';
import type { Reaction } from './types';

export interface ApiErrorResponse {
  error: string;
}

/**
 * Send D-pad pick in a poster duel, or 'skip' to end it. The answer has `done: true` when the duel is over.
 */
export async function pickDuel(side: 'left' | 'right' | 'skip', baseUrl: string = API_BASE_URL): Promise<any> {
  const res = await fetch(`${baseUrl}/api/duel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pick: side }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/**
 * Add a member to the couch.
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
 * OK on a film in the reel: show its details screen.
 */
export async function openDetails(movieId: number, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/details', { movie_id: movieId }, baseUrl);
}

/**
 * Back: go to tonight's picks or the couch. Clears details, watching and rating.
 */
export async function goTo(screen: 'recommendations' | 'couch', baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/screen', { screen }, baseUrl);
}

/**
 * The reel settled on a film (no screen change; the voice page reads `focus`).
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
 * A hand-rating pill for one person.
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

/**
 * "Already seen" on the details screen: watched, no reaction, for everyone on the couch.
 */
export async function markSeen(movieId: number, baseUrl: string = API_BASE_URL): Promise<any> {
  return post('/api/seen', { movie_id: movieId }, baseUrl);
}

// ---- Voice agent ---------------------------------------------------------------------------

export type AgentEvent = 'duel_done' | 'show_picks' | 'app_opened';

/**
 * Start a fresh household conversation (the TV calls this once when the app starts).
 */
export async function newSession(agentUrl: string = AGENT_URL): Promise<{ id: string }> {
  return post('/session/new', {}, agentUrl);
}

/**
 * Tell the agent something happened on the TV; it runs one turn and speaks through the TV.
 */
export async function sendEvent(
  event: AgentEvent,
  name?: string,
  skipped?: boolean,
  agentUrl: string = AGENT_URL,
): Promise<any> {
  const body: { event: AgentEvent; name?: string; skipped?: boolean } = { event };
  if (name !== undefined) body.name = name;
  if (skipped !== undefined) body.skipped = skipped;
  return post('/event', body, agentUrl);
}

// ---- URLs ----------------------------------------------------------------------------------

/** A server path such as "/api/voice/<sha1>.mp3" as a full URL (full URLs pass through). */
export function serverUrl(path: string, baseUrl: string = API_BASE_URL): string {
  return /^https?:\/\//.test(path) ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** The phone microphone page, pointed at the agent. */
export function phoneUrl(baseUrl: string = API_BASE_URL, agentUrl: string = AGENT_URL): string {
  return `${baseUrl}/phone/?agent=${encodeURIComponent(agentUrl)}`;
}

/** PNG QR code for the phone page. */
export function phoneQrUrl(baseUrl: string = API_BASE_URL, agentUrl: string = AGENT_URL): string {
  return `${baseUrl}/api/qr.png?url=${encodeURIComponent(phoneUrl(baseUrl, agentUrl))}`;
}
