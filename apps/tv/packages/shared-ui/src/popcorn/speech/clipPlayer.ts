// Web: one HTML audio element plays one clip at a time. The Vega build uses clipPlayer.vega.ts.

/** Plays one audio clip at a time. `onDone(ok)` runs once per clip unless `stop()` came first. */
export interface ClipPlayer {
  play(url: string, onDone: (ok: boolean) => void): void;
  stop(): void;
  dispose(): void;
}

const MAX_CLIP_MS = 60000; // a clip that never reports its end is treated as finished

export function createClipPlayer(): ClipPlayer {
  let audio: HTMLAudioElement | null = null;
  let token = 0;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const element = (): HTMLAudioElement | null => {
    if (audio) return audio;
    if (typeof Audio === 'undefined') return null;
    audio = new Audio();
    audio.preload = 'auto';
    return audio;
  };

  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };

  const stop = () => {
    token += 1;
    clearWatchdog();
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      // nothing playing
    }
  };

  return {
    play(url, onDone) {
      stop();
      const el = element();
      const mine = token;
      let finished = false;
      const finish = (ok: boolean) => {
        if (finished || mine !== token) return;
        finished = true;
        clearWatchdog();
        onDone(ok);
      };
      if (!el) {
        setTimeout(() => finish(false), 0);
        return;
      }
      el.onended = () => finish(true);
      el.onerror = () => finish(false);
      watchdog = setTimeout(() => finish(false), MAX_CLIP_MS);
      el.src = url;
      if (__DEV__) console.log(`[speech] play ${url}`);
      const started = el.play();
      if (started && typeof started.catch === 'function') {
        // Autoplay blocked or the file failed: count the clip as done.
        started.catch(() => finish(false));
      }
    },
    stop,
    dispose() {
      stop();
      audio = null;
    },
  };
}
