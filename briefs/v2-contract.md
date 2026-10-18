# v2 contract: voice in the TV, stateful agent, LLM picks (Day 6)

Binding for ajan2 (MCP), ajan5 (agent service), ajan3 (TV), ajan4 (phone). Older contracts
(`api-contract.md`, `tv-contract.md`) still hold where this file does not change them.
Do not change this contract on your own; write gaps in your report.

## The flow (what the family experiences)

1. First launch: no profiles. The TV shows "Who's watching?", a "+" tile, and a QR code:
   "Scan to talk to Popcorn". The phone page is only a microphone; everything else is on the TV.
2. "I'm Ahmet, the dad, 43, and my son is here too, he's 10." The agent creates profiles by
   conversation, asks once for a missing name, accepts "don't save his name" (it then uses a label
   such as "Ahmet's son"). Its spoken replies play on the TV, with a caption.
3. New people take the poster duel (skippable). The agent chooses the pairs from a pool of
   well-known films and sees each pick as "picked <title> over <title>", then writes short taste notes.
4. "Any genre or mood tonight?" The code builds a candidate pool (only films on a streaming service
   in the region, kid-safe for the couch, nothing anyone on the couch has watched). The agent picks
   4-8 films and writes one spoken, spoiler-free sentence per film for the people on the couch.
   Each sentence is synthesized up front; the TV plays it when the reel settles on that film.
5. Spoken feedback ("too many superhero films, more grounded sci-fi") -> new pool -> new picks.
   "I've seen the first two" -> saved as watched, cards fade out.
6. Details, watching, family rating: as built on Day 5. The TV now speaks the rating questions.
7. Memory: one JSON document per person. Only couch members are loaded into the agent, at the
   bottom of the conversation (tool results), never into the system prompt.

## Person memory (MCP, DynamoDB key `<household>:profile:<id>`)

Existing fields stay (`id`, `name`, `age`, `kid`, `genres` weights, `liked`, `disliked`, `watched`,
`notes`, `duel_rounds`). New fields, default when missing in old documents:

```json
{
  "role": "dad",                  // free text, short: "dad", "mom", "older son", "grandma"; null if unknown
  "gender": "male",               // "male" | "female" | null
  "named": true,                  // false when `name` is a label like "Ahmet's son" (the person chose not to give a name)
  "notes": ["Loves superhero films, and even more when they mix with horror"],   // max 12, newest last, each <= 140 chars
  "duel_history": [               // newest last, max 30
    {"picked": {"id": 157336, "title": "Interstellar", "year": "2014", "genres": ["Adventure", "Drama", "Science Fiction"]},
     "over":   {"id": 116149, "title": "Paddington", "year": "2014", "genres": ["Comedy", "Family"]}, "at": 1760800000}
  ],
  "duel_skipped": false,          // true if the person skipped the whole duel
  "watched": [{"id": 1, "title": "...", "year": "2014", "reaction": "loved" | null, "quote": "", "at": 1760800000}]
}
```

`memory(profile)` = what the agent sees for a person (compact, no ids except films):

```json
{"name": "Ahmet", "named": true, "age": 43, "role": "dad", "gender": "male", "kid": false,
 "loves": ["Action"], "likes": ["Horror"], "dislikes": [], "never": [],          // TMDB genre names, from weights
 "notes": ["..."],
 "duel": ["picked Interstellar (2014) over Paddington (2014)", "..."],            // last 10
 "duel_skipped": false,
 "watched": ["Inception (2010): loved", "Coco (2017)"],                            // last 30
 "new": true}                                                                      // no weights, no notes, no duel yet
```

## MCP tools (ajan2). Changed or new; others unchanged

| Tool | Args | Result / effect |
|---|---|---|
| `set_couch` | `people: [{name, age?, kid?, role?, gender?, named?}]` | as now, plus `memory: [memory(p)]` for every couch member |
| `add_to_couch` | `name, age?, kid?, role?, gender?, named?` | as now, plus `memory: memory(p)`; on screen `recommendations` cards that no longer fit fade out (no replacement), `removed_from_screen` lists them |
| `update_taste` | `name, loves?, likes?, dislikes?, hates?, note?, role?, gender?, age?` | as now; `note` appended to `notes` (dedupe, trim); returns `memory(p)` |
| `rename_person` | `name, new_name` | renames, `named: true`; error if `new_name` exists |
| `find_candidates` | `genres?: [TMDB genre names] (any of)`, `without_genres?`, `keywords?: [plain words]`, `without_keywords?`, `year_from?`, `year_to?`, `exclude_ids?: [int]` | `{"kid_filter": "PG"\|"PG-13"\|null, "candidates": [{id, title, year, genres, rating, votes, overview (<= 160 chars)}]}` max 40 |
| `show_picks` | `picks: [{movie_id, why, match}]` 4-8 | validates every id is in the last pool built for the current couch (else error naming the id), builds cards, synthesizes each `why`, sets screen `recommendations` |
| `mark_seen` | `names: [str]`, `movie_ids: [int]` | adds to `watched` (reaction null) for those people; those cards fade out |
| `duel_candidates` | `name` | `{"kid_filter", "candidates": [...]}` 50 well-known films (same item shape), spread across genres, kid-safe for that person and the couch, nothing they watched or already saw in a duel |
| `start_duel` | `name, pairs: [[left_id, right_id], ...]` 3-6 | ids must come from that person's last `duel_candidates` pool; screen `duel` |
| `record_duel_choice` | `pick: "left"\|"right"\|"skip"` | as now, plus history; `skip` ends the duel (`duel_skipped: true` when no round was done). Returns `{"done", "picked"?, "memory"?}` |
| `recommend_for_couch` | removed (the TV "Show picks" button now asks the agent, see events) |
| `get_profiles` | unchanged, but returns `memory(p)` items |

Pool rules (`find_candidates`): TMDB discover with `watch_region=<POPCORN_WATCH_REGION>` and
`with_watch_monetization_types=flatrate`, `certification.lte` from the couch (kid rule unchanged),
`vote_count.gte` 150. Without `genres`, query the couch's top positive genres (one query each) plus
one query with no genre, merge by popularity. `keywords` resolve through TMDB `/search/keyword`
(first match). Exclude: anyone on the couch watched or disliked it, `exclude_ids`, vetoed genres
(`never`) of anyone on the couch. Store the pool ids and the couch kid filter in the state
(`pool: {ids, kid_filter}`), so `show_picks` can check them.

Duel pool rules (`duel_candidates`): `sort_by=vote_count.desc`, pages 1-3, several genre groups so
the list is varied, `certification.lte` for the strictest of (this person, couch). Poster required.

Cards from `show_picks`: existing `MovieCard` with `why` = the agent sentence (<= 220 chars),
`match` = the agent number clamped 50-99, plus `why_audio` (see speech).

## Speech and voice (MCP routes, ajan2)

Polly lives in the MCP server now (voice `Brian`, engine `standard`, MP3; env `POLLY_VOICE`,
`POLLY_ENGINE`). Audio is cached in the store under `<household>:voice:<sha1 of voice+text>`
(base64, TTL 2 days) and served at `GET /api/voice/<sha1>.mp3` (`audio/mpeg`, OpenRouter `elevenlabs/eleven-flash-v2.5` voice `sarah`, one call per reply; `/api/transcribe` uses OpenRouter `openai/whisper-large-v3-turbo`; cache 1 day, 404 if gone).
Audio URLs in the state are paths (`/api/voice/<sha1>.mp3`); the TV prefixes `API_BASE_URL`.

| Route | Body | Effect |
|---|---|---|
| `POST /api/speech` | `{"text": s}` (<= 600 chars) | synthesize, push onto `speech`, set `voice.state = "idle"` |
| `POST /api/voice` | `{"state": "listening"\|"thinking"\|"idle", "text"?: s, "speaker"?: s}` | sets `voice`; on screen `rating` the text is also copied to `rating.live` (no extra version bumps beyond 4/s) |
| `GET /api/voice/<sha1>.mp3` | | the MP3 |
| `GET /api/qr.png?url=<url>` | | PNG QR code (`segno`, dark on white, quiet zone 2) for an `http(s)://` URL <= 300 chars |
| `GET /phone/` and `/phone/<file>` | | the phone page files from `static/phone/` (index.html, app.js, styles.css) |
| `POST /api/duel` | `{"pick": "left"\|"right"\|"skip"}` | as `record_duel_choice` |

The rating round speaks by itself (no agent text): `start_rating` pushes "How was <title>?
<first>, what did you think?"; each answer or skip pushes "<ack>. <next>, what about you?" where ack
is "Loved it, noted" / "Liked it, noted" / "Okay, noted" / "Not a fan, noted" / "Hated it, noted" /
"Skipped" (no ack for a skip by hand); the end pushes "Saved, thanks everyone."

TV state additions:

```ts
export interface Speech { id: number; text: string; audio: string | null }   // audio null if Polly failed
export interface Voice { state: 'idle' | 'listening' | 'thinking'; text: string; speaker: string | null; at: number }
// TVState gains:
speech: Speech[];          // last 6, ids go up; the TV plays every id above the last one it played, in order
voice: Voice;
// MovieCard gains (recommendations only):
why_audio?: string | null;
// Member (household/members items) gains: role, gender, named (from memory)
```

## Agent service (ajan5)

- One running conversation per household, stored in DynamoDB (`<household>:session`, TTL 1 day):
  `{"id", "messages", "last_active"}`. `POST /session/new` starts a fresh one (the TV calls it once
  when the app starts). A session idle for more than 3 hours starts fresh too.
  `conversation_id` in requests is ignored if absent: the household session is used.
- The system prompt is static (no names, no TV state), so the provider can cache it. Per-turn
  context goes in front of the user text as one line:
  `[speaker: Ahmet] [tv: screen=rating, asking=Leyla, people=Ahmet,Leyla]` (omit what is unknown).
- Person memory reaches the model only through tool results (set_couch / add_to_couch /
  update_taste / get_profiles). Never re-inject it. The next session loads it fresh.
- After every turn: if the reply is not empty and the turn did not call `start_rating` or
  `record_reaction`, `POST {MCP}/api/speech {"text": reply}`. If the turn failed, speak
  "Sorry, I didn't catch that. Try again?". Always leave `voice.state` idle at the end.
- Endpoints (CORS as now):
  - `POST /chat` `{"text", "speaker"?}` -> as now (phone uses it).
  - `POST /event` `{"event": "duel_done" | "show_picks" | "app_opened", "name"?: s, "skipped"?: bool}`
    -> runs one turn with a user message `[event] <plain sentence>`, e.g. "[event] Leyla finished the
    poster duel." / "[event] Leyla skipped the poster duel." / "[event] The family pressed Show picks
    on the TV." Returns like `/chat`.
  - `POST /session/new` -> `{"id"}`.
  - Keep `/chat/stream`, `/speak`, `/health`.
- Storage size: keep the session doc under 300 KB: when over, replace the content of the oldest
  `find_candidates` / `duel_candidates` tool results with `"[old list omitted]"`, then drop the
  oldest whole turns (never the turn that loaded a couch member's memory while they are still on the couch).
- Prompt: the flow above, in short rules. English only. Replies 1-2 short spoken sentences.

## TV (ajan3)

- Plays `speech` items in order (one audio element / player; a new item waits for the current one).
  Web: HTML audio. Vega: `@amazon-devices/react-native-w3cmedia` (platform file `.vega.ts`).
- Caption bar (bottom, above hints) while speech plays; `voice` state shows "Listening..." with
  bars and the live text, "Thinking..." with dots.
- Reel: when focus settles on a film for 1.5 s and nothing else is playing, play its `why_audio`;
  moving focus stops it.
- First run (household empty): welcome with "+" (existing AddMemberForm) and the QR
  (`{API}/api/qr.png?url=<encoded phone url>`), phone url = `{API}/phone/?agent=<encoded AGENT_URL>`.
  Small QR with "Talk to Popcorn" on the couch screen when people exist.
- Duel: Skip pill -> `POST /api/duel {"pick":"skip"}`. When a duel response says `done`, call
  `POST {AGENT}/event {"event":"duel_done","name","skipped"}` (fire and forget).
- "Show picks" -> `POST {AGENT}/event {"event":"show_picks"}` instead of `/api/recommend`.
- App start -> `POST {AGENT}/session/new` once.
- `AGENT_URL` in `config.ts` / `config.vega.ts`.

## Phone page (ajan4)

`services/mcp/src/popcorn_mcp/static/phone/`: one big round talk button (tap to start, tap to stop,
also stops on silence), Web Speech API `en-US` with interim results, "Who's talking?" chips from
`GET {API}/api/state` `household` (optional, remembered in localStorage), a one-line status.
Interim text -> `POST {API}/api/voice {"state":"listening","text","speaker"}` (max 4/s).
Final text -> `POST {API}/api/voice {"state":"thinking","text"}` then `POST {AGENT}/chat {"text","speaker"}`.
Agent URL from `?agent=` in the page URL; API = the page's own origin. No audio on the phone.
Mobile Safari and Chrome on Android. No Alexa wording or branding.

## Remote parity (added by the user's request)

Every user must be able to do everything with the remote alone; voice is a shortcut, not the
only path. Minimum:

- Reel: the couch avatars in the header are focusable (Up from the reel reaches them) and open the
  couch screen; Back on the reel also goes to the couch screen. A "New picks" pill in the header row
  sends `POST {AGENT}/event {"event":"show_picks"}`.
- Couch screen: add (AddMemberForm), remove, and "Show picks" by remote (already there; keep it).
- Details: an "Already seen" pill next to the provider pills -> `POST /api/seen {"movie_id"}` (MCP:
  marks it watched with no reaction for everyone on the couch, removes the card, back to the reel).
- Duel: Skip; Rating: hand pills and Skip (already there).
- Every focusable has a visible focus state; hints at the bottom name the keys.
