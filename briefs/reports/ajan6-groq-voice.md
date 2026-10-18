# ajan6: Groq speech-to-text and text-to-speech

## Files (all in services/mcp/)
- New `src/popcorn_mcp/groq_tts.py`: `GroqTTS` (`POST https://api.groq.com/openai/v1/audio/speech`), sentence splitter, WAV joiner.
- New `src/popcorn_mcp/groq_stt.py`: `GroqSTT` (`POST /audio/transcriptions`), noise filter.
- Removed `polly.py` (no fallback kept; without `GROQ_API_KEY` the speaker is None, the TV shows captions only; STT route answers 502).
- `config.py`: `groq_api_key`, `tts_model` (`GROQ_TTS_MODEL`), `tts_voice` (`GROQ_TTS_VOICE`); Polly settings removed.
- `server.py`: builds GroqTTS; `GET /api/voice/<sha1>.wav` (`audio/wav`, `.mp3` still maps to `audio/mpeg` for old links); new `POST /api/transcribe`; `create_app(..., transcriber=)` for tests.
- `service.py`: `speak()` returns `/api/voice/<sha1>.wav`; audio stored in pieces (see friction); `voice_mp3` renamed `voice_audio`.
- `static/phone/app.js`: Web Speech replaced by MediaRecorder; `index.html`/`styles.css` unchanged.
- `tests/test_service.py`: updated to wav, plus 5 new tests (fake Groq with httpx.MockTransport). 33 pass (`cd services/mcp && uv run pytest -q`).

## Final request shapes
- TTS: `POST /audio/speech` JSON `{"model":"canopylabs/orpheus-v1-english","input":<=200 chars,"voice":"autumn","response_format":"wav"}`, `Authorization: Bearer`. The docs say wav is the only format and 200 characters the input maximum, so text is split on sentence ends (then commas, spaces), pieces are merged up to 200 chars, called in parallel, and the PCM data is joined into one WAV header (same format checked). The 600-char `/api/speech` cap is unchanged (at most about 4 calls).
- STT: `POST /api/transcribe[?speaker=]`, raw body, any browser Content-Type, max 10 MB (400 above). Sends multipart `file` (name `speech.<ext>` from the type), `model=whisper-large-v3`, `temperature=0`, `response_format=verbose_json`, `language=en`. Segments with `no_speech_prob >= 0.6` are dropped. Returns `{"text"}`; empty/noise gives `{"text":""}`; Groq or network failure gives `{"error"}` 502 in plain words (Groq 400 says "I couldn't read that recording").
- Phone page: tap start (mime `audio/webm;codecs=opus`, else `audio/mp4`, else default), tap stop, auto stop 1.5 s after last speech (AnalyserNode RMS > 0.015), 5 s if nothing is said, 30 s max. `POST /api/voice listening` once on start, `thinking` on stop, upload, show text, then `POST {AGENT}/chat` as before. Empty text: voice idle and "I didn't catch that. Tap and try again". Text-box fallback shows only if MediaRecorder or getUserMedia is missing. Not tested in a real browser or on iOS Safari.

## Live check (local, port 8010, household v2-test, DynamoDB)
- TTS 143-char sentence via `/api/speech`: 200 in 6.85 s (two Groq calls in parallel, first try 5.34 s); WAV 499,270 bytes, `audio/wav`.
- STT of that WAV: 2.50 s. Text: "I would love a funny movie tonight. Something the whole family can enjoy. My son is 10 years old, and he likes space adventures and robots." (matches apart from punctuation and "ten" -> "10").
- 1 s of silent WAV: `{"text":""}` in 0.71 s. Zero bytes: `{"text":""}`. 20 KB of zeros as WAV: 502 "I couldn't read that recording. Try again."
- v2-test keys deleted (3 items). The 8010 server is stopped.
- Note: I ran `pkill -f popcorn-mcp` by mistake, which took down the orchestrator's port 8000 server; I restarted it with `POPCORN_HOUSEHOLD=dev uv run popcorn-mcp` (now running the new Groq code, and GROQ_API_KEY is in .env).

## For the orchestrator
- Add `GROQ_API_KEY` (and optional `GROQ_TTS_MODEL`, `GROQ_TTS_VOICE`) to the MCP Lambda env. `infra/deploy.py` lines ~225-254 still grant `polly:SynthesizeSpeech` and set `POLLY_*` env; harmless, can be dropped. Lambda timeout for the MCP function should be at least 30 s (TTS of 600 chars can take about 10 s).
- `services/agent` still has its own Polly module (`polly.py`, `POLLY_*` config, used by its own server); I did not touch it. Agent replies go through MCP `/api/speech`, so they use Groq already.
- The TV must handle `.wav` audio paths (it prefixes `API_BASE_URL`; previous code may assume mp3).
- Update `briefs/v2-contract.md` "Speech and voice": audio is `/api/voice/<sha1>.wav`, `audio/wav`.

## Friction
- Groq docs: the main TTS page lists voices troy/hannah/austin only; `autumn` and the 200-char input limit appear only on the separate Orpheus page (`/docs/text-to-speech/orpheus`). The speech-to-text page has no raw HTTP multipart example and its comment on `timestamp_granularities` contradicts its table (json vs verbose_json).
- Orpheus WAV is ~48 KB/s (24 kHz 16-bit mono), so a 10 s line is ~500 KB, over the DynamoDB 400 KB item limit. First live call failed with `ValidationException ... Item size has exceeded the maximum allowed size` (logged, audio None). Fix: audio is stored as 200 KB pieces (`<key>`, `<key>#1`, ...), head item holds `parts`. This is not an AWS tool bug, just a DynamoDB limit worth knowing; S3 would suit audio better.
- Orpheus latency is 5-7 s per line, noticeable for spoken replies; pieces are fetched in parallel to keep it down.
