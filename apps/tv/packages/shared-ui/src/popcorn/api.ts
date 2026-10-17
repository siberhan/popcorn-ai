import { API_BASE_URL } from './config';

export interface ApiErrorResponse {
  error: string;
}

/**
 * Send D-pad pick in a poster duel.
 */
export async function pickDuel(side: 'left' | 'right', baseUrl: string = API_BASE_URL): Promise<any> {
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

/**
 * Refresh recommendations for the current couch.
 */
export async function refreshPicks(baseUrl: string = API_BASE_URL): Promise<any> {
  const res = await fetch(`${baseUrl}/api/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
