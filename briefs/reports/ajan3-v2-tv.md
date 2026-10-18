# ajan3 v2: TV voice layer, speech player, QR, duel skip, remote parity

Brief: `briefs/ajan3-v2-tv.md`. Contract: `briefs/v2-contract.md`, including the "Remote parity" section added later. I changed files only under `apps/tv/`, plus this report and its shots folder.

## Per-file changes (all under `apps/tv/`)

| File | Change |
|---|---|
| `apps/vega/package.json` | Added `@amazon-devices/react-native-w3cmedia: ~2.1.80`, which resolved to 2.1.99. |
| `yarn.lock` | Updated by the install (about 4400 lines; see Friction). |
| `apps/vega/babel.config.js` | Applied the w3cmedia setup: the preset now has `useTransformReactJSXExperimental: true`, and `@babel/plugin-transform-react-jsx` (`runtime: 'automatic'`) is added. The reanimated plugin stays last. |
| `apps/vega/manifest.toml` | No change. It already had every audio and media `wants` entry and the `needs` entry `com.amazon.media.w3cmedia_2@IW3cmedia_1`. |
| `shared-ui/src/declarations.d.ts` | Added an ambient module for `@amazon-devices/react-native-w3cmedia` (AudioPlayer, AudioContentType, AudioUsageType) so shared-ui typechecks without the package. |
| `shared-ui/src/index.ts` | Exports `newSession`, `sendEvent` and `AGENT_URL`. `refreshPicks` is gone. |
| `popcorn/types.ts` | `Member` gains `role?`, `gender?` and `named?`. `MovieCard` gains `why_audio?`. New types `Speech {id,text,audio}` and `Voice {state,text,speaker,at}`. `TVState` gains `speech?` and `voice?`. |
| `popcorn/config.ts`, `config.vega.ts` | Added `AGENT_URL` (the agent Lambda URL; locally it is port 8100). |
| `popcorn/api.ts` | `pickDuel` accepts `'skip'`. New: `markSeen(movieId)` (POST `/api/seen`), `newSession()` (POST `{AGENT}/session/new`), `sendEvent(event, name?, skipped?)` (POST `{AGENT}/event`). New helpers: `serverUrl()`, `phoneUrl()` (`{API}/phone/?agent=<AGENT>`) and `phoneQrUrl()` (`{API}/api/qr.png?url=...`). Removed `refreshPicks`. |
| `popcorn/speech/clipPlayer.ts` | New. Web player built on one reused HTML `Audio` element. It uses a play token, ended/error handlers, a catch on the `play()` promise and a 60 s watchdog. |
| `popcorn/speech/clipPlayer.vega.ts` | New. Vega player built on w3cmedia `AudioPlayer`; details below. |
| `popcorn/speech/useSpeech.ts` | New. Plays the speech queue in id order and handles narration; details below. |
| `popcorn/components/VoiceBar.tsx` | New. Overlay pill at the bottom of every screen. It has three modes: listening ("Ahmet · Listening..." with animated bars and live words), thinking ("Thinking..." with dots and the quoted text) and speaking (the caption). |
| `popcorn/components/PhoneQr.tsx` | New. Large mode: a 360 px code in a white frame, "Scan to talk to Popcorn" and a short sub line. Small mode: a 132 px code with "Talk to Popcorn". If the image fails, the text "QR code unavailable" shows instead. |
| `popcorn/components/index.ts` | Exports VoiceBar and PhoneQr. |
| `theme/console.ts` | New tokens: `consoleVoice*`, `consoleQr*`, `consoleReel.headerPillHeight` and `consoleReelMotion.narrateMs = 1500`. |
| `screens/CouchScreen.tsx` | With no people, shows the large QR and an empty-state line that mentions scanning. Once people exist, shows the small QR at top right. |
| `screens/DuelScreen.tsx` | "Skip the duel" pill in the header next to the round badge. Up from a poster reaches it. The left poster keeps default focus. The hint text ends with "Up: skip." |
| `screens/RecommendationsScreen.tsx` | Focusable header with a "New picks" pill, a couch chip (avatars and names) and the clock. Back opens the couch screen. Narration runs after the reel settles. The hints change with focus. |
| `screens/DetailsScreen.tsx` | "Already seen" pill after the provider pills, or next to "We're back" when there are no providers. The focused pill also gets a border. The key hints changed. |
| `popcorn/PopcornRoot.tsx` | Calls `newSession()` once per app start (module-level flag). Wires `useSpeech`. `runEvent` keeps a waiting counter that drives the local "Thinking...". Duel `done` sends `duel_done` (with `skipped` set when the duel was skipped). Also wires `show_picks`, `markSeen` and the VoiceBar overlay. |

## Play order and the players

`useSpeech(state.speech)`:
- On the first `speech` list it receives, every id present is marked as played, so a fresh app does not replay history. If ids go backwards (for example after a new session), the list is reset the same way.
- Only ids above the highest seen id are queued, sorted ascending. Items play one at a time with a 250 ms gap.
- An item with `audio: null` shows only the caption, for a reading time of 2.5 to 9 s, and the queue moves on.
- The caption is set for the duration of each item. The hook exposes `speaking`.
- Narration (`why_audio` on the reel) runs only when nothing else is playing. A new speech item stops narration; narration never interrupts speech.

Web (`clipPlayer.ts`): one `Audio` element. Each `play(url, onDone)` gets a token, so a late `ended` from an old clip is ignored. `stop()` pauses and clears `src`.

Vega (`clipPlayer.vega.ts`):
- Creates one `AudioPlayer(CONTENT_TYPE_SPEECH, USAGE_MEDIA)` per clip.
- Every native step (`initialize`, `src = url`, `play`, `deinitialize`) goes through one promise chain, so at most one native player exists at a time.
- If `stop()` arrives during initialize, that step shuts down inline.
- `playing`, `timeupdate` or `playbackstarted` marks the clip as started; a clip that has not started after 10 s counts as failed. `ended` and `error` finish it.
- Hard maximum of 60 s per clip.

## Remote parity (v2-contract.md)

- **Reel header is focusable.** Up from the top film reaches the header: "New picks", then the couch chip, then the clock. On the couch chip, OK sends `POST /api/screen {"screen":"couch"}`. While the header has focus, the poster ring dims so only one thing looks focused.
- **Back on the reel** sends `/api/screen couch`.
- **"New picks"** sends the agent `{"event":"show_picks"}`. The VoiceBar shows "Thinking..." until the call returns.
- **"Already seen" on details** sends `POST /api/seen {"movie_id"}`.
- **Focus states.** Every new focusable (Skip, New picks, couch chip, Already seen) shows a white fill with dark text, matching the existing pills. Details pills also get a border.
- **Hints name the keys:**
  - Reel, film focused: "Up/Down: change film · OK: details · Up from the top: couch · Back: couch".
  - Header: "OK: ask Popcorn for new picks · Down: back to the films" or "OK: change who's watching · ...".
  - Details: "Left/Right: choose · OK: watch there or mark as seen · Back: tonight's picks".
  - Duel: "... Up: skip."
- Shots 07a, 07 and 08 show these.

## Verification

Playwright 1.57 (Python) drove the Expo web preview on :8082 at 1920x1080. API and agent were mocked, and the mocked state changed between steps. Request log from the run:

```
 4.16 AGENT POST /session/new {}                        (once)
12.23 MP3   tone330  (speech id 8)    id 7 already present at start: not played
16.76 MP3   tone550  (speech id 9)    id 10 caption-only shown after it
26.23 API   POST /api/duel {"pick":"skip"}
26.23 AGENT POST /event {"event":"duel_done","name":"Leyla","skipped":true}
29.86 MP3   tone440  narration film 1 (about 1.5 s after the reel loaded)
33.59 API   focus film 3 (a quick move past film 2 did not narrate it)
34.11 MP3   tone660  narration film 3
37.50 API   POST /api/screen {"screen":"couch"}         (couch chip OK)
38.74 AGENT POST /event {"event":"show_picks"}          (New picks)
40.57 API   POST /api/screen {"screen":"couch"}         (Back on reel)
45.06 API   POST /api/seen {"movie_id":1327819}         (Already seen)
48.79 AGENT POST /event {"event":"show_picks"}          (couch Popcorn button)
audio.play order: tone330, tone550, tone440, tone660, tone440
```

The last `tone440` came from the mock: it does not switch screens on Back, so the reel stayed and narrated film 1 again. Narration stopped when the screen switched to details. No page errors were logged.

- `yarn typecheck`: only the known `DuelScreen.tsx` errors remain ("Type 'MovieCard | undefined'...", now at lines 242 and 257 after prettier).
- `yarn build:vega`: exit 0. A release vpkg was built for armv7, x86_64 and aarch64, and manifest validation reported 0 errors. `index.bundle` contains the Vega clip player (`CONTENT_TYPE_SPEECH`, `playbackstarted`).
- `yarn lint`: not run; it is known broken (see earlier reports).

## Not verified on Vega

I did not touch the device or the VVD (testing on device is the user's job). Please check:
- w3cmedia playback on a device: the event names and order (`playing` / `timeupdate` / `playbackstarted` / `ended`), URL-mode `src` for MP3, and whether `deinitialize` between clips leaves a gap or a pop.
- The babel change (JSX automatic runtime) affects the whole Vega app. The build is clean, but I have not seen it on screen.
- The manifest entries were already present, so I made no manifest change; whether they are enough is unconfirmed.
- QR `Image` loading from `/api/qr.png` on Vega.
- `Animated` loops in the VoiceBar (listening bars and thinking dots) and how they perform on device.

## Shots (`briefs/reports/ajan3-v2-tv-shots/`, all opened)

1. `01-first-run-qr.png`: empty couch, large QR, "Scan to talk to Popcorn".
2. `02-couch-small-qr.png`: people exist, small QR with "Talk to Popcorn" at top right.
3. `03-listening-live.png`: "Ahmet · Listening..." with bars and live words.
4. `04-thinking.png`: "Thinking..." with dots and the quoted text.
5. `05-caption-speaking.png`: speech caption while a clip plays.
6. `06-duel-skip-focused.png`: "Skip the duel" focused.
7. `07a-reel-header-new-picks.png`: reel header, "New picks" focused.
8. `07-reel-header-couch-focused.png`: reel header, couch avatars focused, with the hint.
9. `08-details-already-seen-focused.png`: details, "Already seen" focused.

## Decisions

- The VoiceBar hides listening mode on the rating screen while that screen asks its own question, so the two prompts do not show at once.
- "Thinking..." also shows locally while a TV-sent event is in flight, even before the agent sets `voice`.
- Narration waits for speech to end and never interrupts it. Moving focus stops narration.
- Staleness timeouts: a stuck `listening` hides after 15 s and a stuck `thinking` after 60 s, so a crashed phone or agent cannot leave the bar up.
- The VoiceBar sits at bottom 96 px. On details it can overlap the provider pills while a caption shows. It is short-lived, so I left it.
- The small QR is 132 px. It may be hard to scan from the couch; the large QR is the main path.
- `refreshPicks` was removed; the Popcorn and New picks buttons now go through the agent `show_picks` event.
- Couch screen: after people are added while the screen is mounted, default focus stays on "+".

## For other agents

- MCP (ajan2) needs to provide:
  - `POST /api/seen {"movie_id"}`
  - `speech` and `voice` in `/api/state`
  - `/api/duel {"pick":"skip"}` returning `done: true` when the duel ends, because the TV sends `duel_done` only on `done`
  - `GET /api/qr.png?url=`
  - `why_audio` on cards
- Agent (ajan5) needs CORS that allows the TV origin for `POST /session/new` and `POST /event` (web preview; Vega does not need CORS).

## Friction

1. **w3cmedia version.**
   - Tool: yarn 4 through `npx -y corepack@0.31.0 yarn`.
   - Tried: adding `@amazon-devices/react-native-w3cmedia@~2.1.80`, as the Vega audio docs give.
   - Expected 2.1.80; got 2.1.99, since `~` allows patch upgrades.
   - Error text: none.
   - Workaround: none; it builds. Noted in case the docs pin matters.
2. **Lockfile growth.**
   - Tool: same yarn.
   - Tried: adding w3cmedia.
   - Expected a small lock change; got about 4400 lines, mostly `react-native-tscodegen` and babel dependencies.
   - Error text: none.
   - Workaround: none; kept as is.
3. **Deprecated build command.**
   - Tool: Vega CLI plugin through `yarn build:vega`.
   - Tried: building with the project's existing build script.
   - Expected a clean build; got this warning: "This command is deprecated and will be removed in a future version of the Vega CLI plugin. Please replace usage with 'build-vega' instead." (about `build-kepler`).
   - Workaround: none; the build still succeeds. The script should move to `build-vega` at some point.
4. **No audio-only sample.**
   - Docs: Vega w3cmedia docs.
   - Tried: finding an `AudioPlayer` URL-mode example for a plain MP3.
   - Expected an audio-only sample; the samples are video- or MSE-oriented.
   - Error text: none.
   - Workaround: wrote the player from the type definitions; it is unverified on device (see above).
5. **Undeclared babel plugin.**
   - Tool: Vega babel and metro.
   - Tried: the documented babel setup, which needs `@babel/plugin-transform-react-jsx`.
   - Expected it to be a declared dependency; it is not. It only resolves transitively from vega's `node_modules`.
   - Error text: none.
   - Workaround: left as is (the build succeeds). It could break if the transitive dependency moves.

DONE
