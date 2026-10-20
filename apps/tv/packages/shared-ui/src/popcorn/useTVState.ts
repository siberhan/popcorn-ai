import { useState, useEffect, useRef, useCallback } from 'react';
import { TVState } from './types';
import { API_BASE_URL } from './config';

export interface UseTVStateResult {
  state: TVState | null;
  online: boolean;
  error: string | null;
  /** Fetch now instead of waiting for the next poll (after a POST that changed the screen). */
  refresh: () => void;
}

/**
 * Poll the TV state from the MCP server.
 * Uses recursive setTimeout + AbortController.
 * Only re-renders when version changes.
 * Keeps the last good state on network errors and exposes online: boolean.
 * refresh() restarts the loop with an immediate poll, so a POST's screen shows without waiting a tick.
 */
export function useTVState(
  url: string = `${API_BASE_URL}/api/state`,
  intervalMs: number = 1000
): UseTVStateResult {
  const [state, setState] = useState<TVState | null>(null);
  const [online, setOnline] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const stateRef = useRef<TVState | null>(null);
  stateRef.current = state;
  const onlineRef = useRef<boolean>(true);
  onlineRef.current = online;

  // Bumping `tick` restarts the effect below: it aborts the request in flight and polls at once.
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let currentController: AbortController | null = null;

    async function poll() {
      if (!mounted) return;

      currentController = new AbortController();
      try {
        const response = await fetch(url, {
          signal: currentController.signal,
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data: TVState = await response.json();

        if (mounted) {
          if (!onlineRef.current) {
            setOnline(true);
          }
          setError(null);

          // Re-render only when version changes (or initial state)
          if (!stateRef.current || stateRef.current.version !== data.version) {
            setState(data);
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return;
        }
        if (mounted) {
          if (onlineRef.current) {
            setOnline(false);
          }
          setError(err?.message || 'Connection failed');
          // Preserve stateRef.current (last good state)
        }
      } finally {
        if (mounted) {
          timeoutId = setTimeout(poll, intervalMs);
        }
      }
    }

    poll();

    return () => {
      mounted = false;
      if (currentController) {
        currentController.abort();
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [url, intervalMs, tick]);

  return { state, online, error, refresh };
}
