import { useCallback, useEffect, useRef, useState } from 'react';
import type { Speech } from '../types';
import { serverUrl } from '../api';
import { createClipPlayer, ClipPlayer } from './clipPlayer';

export interface SpeechController {
  /** Text of the speech item playing now (the caption), null when none. */
  caption: string | null;
  /** A speech item is playing or waiting. Reel narration waits for this to be false. */
  speaking: boolean;
  /** URL of the reel narration clip playing now, null when none. */
  narrating: string | null;
  /** Play a reel narration clip (a `why_audio` path) if nothing else plays. Returns false if busy. */
  narrate: (path: string) => boolean;
  /** Stop the reel narration (focus moved). Speech items are not touched. */
  stopNarration: () => void;
}

type Mode = 'idle' | 'speech' | 'narration';

/** How long a caption stays up when its audio is missing (Polly failed). */
function readingMs(text: string): number {
  return Math.min(9000, Math.max(2500, (text || '').length * 60));
}

const GAP_MS = 250; // breath between two speech items

/**
 * Plays `state.speech` items in id order, one at a time, through one clip player.
 * On the first state load every id already there counts as played (no replay after a restart).
 * New items stop a running reel narration; narration never interrupts speech.
 */
export function useSpeech(speech: Speech[] | undefined | null): SpeechController {
  const player = useRef<ClipPlayer | null>(null);
  const getPlayer = () => {
    if (!player.current) player.current = createClipPlayer();
    return player.current;
  };

  const lastId = useRef<number | null>(null); // highest id queued so far; null until the first list
  const queue = useRef<Speech[]>([]);
  const mode = useRef<Mode>('idle');
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [caption, setCaption] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [narrating, setNarrating] = useState<string | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const pumpRef = useRef<() => void>(() => {});
  pumpRef.current = () => {
    if (mode.current !== 'idle') return;
    const next = queue.current.shift();
    if (!next) {
      setSpeaking(false);
      setCaption(null);
      return;
    }
    mode.current = 'speech';
    setSpeaking(true);
    setCaption(next.text || null);
    const mine = ++token.current;
    const done = () => {
      if (token.current !== mine) return;
      clearTimer();
      mode.current = 'idle';
      if (queue.current.length === 0) {
        pumpRef.current();
        return;
      }
      timer.current = setTimeout(() => pumpRef.current(), GAP_MS);
    };
    if (__DEV__) console.log(`[speech] item ${next.id} ${next.audio ? 'audio' : 'caption only'}`);
    if (next.audio) {
      getPlayer().play(serverUrl(next.audio), done);
    } else {
      timer.current = setTimeout(done, readingMs(next.text));
    }
  };

  const ids = Array.isArray(speech) ? speech.map((s) => s && s.id).join(',') : null;

  useEffect(() => {
    if (ids === null || !Array.isArray(speech)) return; // no state yet, or an older server
    const list = speech.filter((s) => s && typeof s.id === 'number').sort((a, b) => a.id - b.id);
    const top = list.length > 0 ? list[list.length - 1].id : 0;
    if (lastId.current === null || top < lastId.current) {
      // First load (or the server's ids started over): everything present counts as played.
      lastId.current = top;
      return;
    }
    const fresh = list.filter((s) => s.id > (lastId.current as number));
    if (fresh.length === 0) return;
    lastId.current = top;
    queue.current.push(...fresh);
    setSpeaking(true);
    if (mode.current === 'narration') {
      token.current += 1;
      getPlayer().stop();
      mode.current = 'idle';
      setNarrating(null);
    }
    pumpRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids only
  }, [ids]);

  const narrate = useCallback((path: string) => {
    if (!path || mode.current !== 'idle' || queue.current.length > 0) return false;
    const url = serverUrl(path);
    mode.current = 'narration';
    setNarrating(url);
    const mine = ++token.current;
    getPlayer().play(url, () => {
      if (token.current !== mine) return;
      mode.current = 'idle';
      setNarrating(null);
      pumpRef.current();
    });
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs only
  }, []);

  const stopNarration = useCallback(() => {
    if (mode.current !== 'narration') return;
    token.current += 1;
    getPlayer().stop();
    mode.current = 'idle';
    setNarrating(null);
    pumpRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs only
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      token.current += 1;
      player.current?.dispose();
      player.current = null;
    },
    [],
  );

  return { caption, speaking, narrating, narrate, stopNarration };
}
