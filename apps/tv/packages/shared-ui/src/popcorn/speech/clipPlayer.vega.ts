// Vega: clips play through the w3cmedia AudioPlayer (URL mode, MP3), one player per clip.
// Setup: https://developer.amazon.com/docs/vega/0.24/media-player-setup.html
import { AudioPlayer, AudioContentType, AudioUsageType } from '@amazon-devices/react-native-w3cmedia';

/** Plays one audio clip at a time. `onDone(ok)` runs once per clip unless `stop()` came first. */
export interface ClipPlayer {
  play(url: string, onDone: (ok: boolean) => void): void;
  stop(): void;
  dispose(): void;
}

const MAX_CLIP_MS = 60000; // a clip that never reports its end is treated as finished
const START_MS = 10000; // no "playing" event this long after play(): give up on the clip

const log = (msg: string) => {
  if (__DEV__) console.log(`[speech] ${msg}`);
};

export function createClipPlayer(): ClipPlayer {
  let token = 0;
  let current: AudioPlayer | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  // Native work (initialize, deinitialize) runs one step at a time, in call order, so there is
  // never more than one native player.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (step: () => Promise<void>) => {
    queue = queue.then(step).catch((err: any) => log(`player step failed: ${err?.message || err}`));
  };

  const shutdown = async (player: AudioPlayer) => {
    try {
      player.pause();
    } catch {
      // not started
    }
    try {
      await player.deinitialize();
    } catch (err: any) {
      log(`deinitialize failed: ${err?.message || err}`);
    }
  };

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const release = () => {
    const player = current;
    current = null;
    clearTimers();
    if (!player) return;
    enqueue(() => shutdown(player));
  };

  const stop = () => {
    token += 1;
    release();
  };

  return {
    play(url, onDone) {
      stop();
      const mine = token;
      let finished = false;
      const finish = (ok: boolean) => {
        if (finished || mine !== token) return;
        finished = true;
        release();
        onDone(ok);
      };

      enqueue(async () => {
        if (mine !== token) return;
        try {
          const player = new AudioPlayer(AudioContentType.CONTENT_TYPE_SPEECH, AudioUsageType.USAGE_MEDIA);
          await player.initialize();
          if (mine !== token) {
            await shutdown(player); // stopped while initializing
            return;
          }
          current = player;
          let started = false;
          const markStarted = () => {
            started = true;
          };
          // Any of these means sound is coming out ("playbackstarted" is Vega's own event).
          ['playing', 'timeupdate', 'playbackstarted'].forEach((type) => player.addEventListener(type, markStarted));
          player.addEventListener('ended', () => finish(true));
          player.addEventListener('error', () => {
            log(`error ${url}`);
            finish(false);
          });
          timers.push(setTimeout(() => finish(false), MAX_CLIP_MS));
          timers.push(
            setTimeout(() => {
              if (!started) finish(false);
            }, START_MS),
          );
          player.autoplay = false;
          player.src = url;
          log(`play ${url}`);
          player.play();
        } catch (err: any) {
          log(`player failed: ${err?.message || err}`);
          finish(false);
        }
      });
    },
    stop,
    dispose() {
      stop();
    },
  };
}
