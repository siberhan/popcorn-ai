# ajan3: v2 TV (voice on the TV: speech playback, captions, QR, first run, duel skip), Day 6

Read `briefs/rules.md`, `briefs/v2-contract.md` (binding), `briefs/tv-contract.md`.
Hard rules 1-8 apply; your folder is `apps/tv/`. Report: `briefs/reports/ajan3-v2-tv.md`.
Keep the console visual language (`theme/console.ts` tokens, existing components); read
`.claude/skills/impeccable/reference/craft-floor.md` before UI work.

## Work

1. **types.ts / api.ts / config:** new state fields, `AGENT_URL` (deployed agent:
   `https://5h3jfj5ivg6nddn5lgygk4y4fm0rsnho.lambda-url.eu-north-1.on.aws`), agent calls
   (`newSession`, `sendEvent`), duel skip.
2. **Speech player:** a hook/module that plays `speech` items in id order, never replays old ids
   (on first state load, mark everything present as already played), one at a time. Web: HTML audio.
   Vega: `@amazon-devices/react-native-w3cmedia` in a `.vega.ts(x)` file: add the package at the
   version the docs pin (`~2.1.80`, check what resolves), the babel/manifest steps from
   https://developer.amazon.com/docs/vega/0.24/media-player-setup.html (audio services in
   `manifest.toml` `[wants]`). Expose "is playing" so the reel can wait.
3. **Voice bar:** bottom caption while speaking (the text), "Listening..." with animated bars + the
   live words, "Thinking..." with dots; hidden when idle and nothing plays. All screens.
4. **Reel narration:** settle 1.5 s and nothing playing -> play `why_audio`; focus move stops it.
5. **First run:** household empty -> welcome view with "+" (AddMemberForm) and a large QR image
   from `{API}/api/qr.png?url=...`, line "Scan to talk to Popcorn". Couch screen with people: small QR
   + "Talk to Popcorn".
6. **Duel:** Skip pill (D-pad reachable, not default focus). After a `done` response ->
   `sendEvent('duel_done', name, skipped)`. "Show picks" -> `sendEvent('show_picks')`.
   App start -> `newSession()` once.

## Verify

- Web preview on :8082 with Playwright: mock `/api/state`, `/api/voice/*.mp3` (any short MP3 you generate
  outside the repo), `/api/qr.png`,
  and the agent URLs; check requests and play order (log `audio.play` calls). Shots 1920x1080 into
  `briefs/reports/ajan3-v2-tv-shots/`: first run with QR, couch with small QR, listening bar with live
  text, thinking, caption while speaking, duel with Skip focused. Open every PNG once.
- `yarn typecheck` in `apps/tv` (only the known DuelScreen errors), and `yarn build:vega` must
  succeed with w3cmedia. **Do not touch the Vega Virtual Device or `vega device` / `vega virtual-device`.**

Report: per-file changes, how play order and the Vega player work, what you could not verify on
Vega, shot list, friction. End with `DONE`.
