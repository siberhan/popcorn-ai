import { useState, useEffect, useRef } from 'react';
import { TVState } from './types';
import { API_BASE_URL } from './config';

export interface UseTVStateResult {
  state: TVState | null;
  online: boolean;
  error: string | null;
}

/**
 * Poll the TV state from the MCP server.
 * Uses recursive setTimeout + AbortController.
 * Only re-renders when version changes.
 * Keeps the last good state on network errors and exposes online: boolean.
 */
export function useTVState(
  url: string = `${API_BASE_URL}/api/state`,
  intervalMs: number = 1000
): UseTVStateResult {
  const [state, setState] = useState<TVState | null>(null);
  const [online, setOnline] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef<TVState | null>(null);
  stateRef.current = state;
  const onlineRef = useRef<boolean>(true);
  onlineRef.current = online;

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
  }, [url, intervalMs]);

  return { state, online, error };
}
