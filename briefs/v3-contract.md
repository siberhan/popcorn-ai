Duel replaced by favorites: see v4-favorites-contract.md

# v3 contract (binding for ajanA backend and ajanB TV)

v3 drops the conversational agent. The TV drives everything with the remote; the only voice input is the
phone page during the rating. Old stored data is wiped at deploy, so no migration code is needed.

## Flow

1. **Couch.** The household shows. People are picked for tonight. "+" adds a person: **name + age** only
   (kid = age < 13, computed on the server as today). No role, gender, "named" label, voice add.
2. **Genres (new person only, cannot be skipped).** Right after the add the TV shows a multi-select genre
   grid; at least 1 genre is required to continue. Saved to the profile. Existing people edit their genres
   later in the profile edit view.
3. **Poster duel (cannot be skipped).** 5 rounds. The films come only from the person's chosen genres,
   from the stored duel catalog (no TMDB call at duel time). Kid filter: only the
   person's own age (the rest of the couch does not matter).
   With several genres, films that have more of them are shown first.
4. **Ask (added after v3).** Popcorn on the couch -> screen `ask`: "What do you feel like watching tonight?"
   Typed with the remote or said on the phone (QR). One LLM check with no profiles (`ASK_SYSTEM`): `ok` ->
   the wish goes into the picks prompt; `recent` (last two years, new releases, in cinemas) or `no` ->
   stays on `ask` with a fixed line (`ASK_RECENT` / `ASK_SORRY`, "Sorry, I can't help with that."). Skip ->
   picks without a wish. Someone with unfinished genres/duel is sent there first (Back left it).
5. **Picks.** One LLM call -> 10 cards. "New picks" on the reel asks again without the films already shown
   this evening, with the same wish.
6. **Details / watch.** As today, minus "Already seen".
7. **Rating (the key moment).** One person at a time. Each answers with one of 5 written buttons or by
   speaking on the phone (QR on the rating screen). Spoken answers are summarized by the LLM. Saved to
   the person's `reviews`, which feed the next picks.

**Back everywhere.** Every screen but the couch has a visible Back button and the remote Back key:
genres/duel/ask -> couch, reel -> ask, details -> reel, rating -> finish and save.

## Removed everywhere

Strands agent calls (`newSession`, `sendEvent`, `AGENT_URL`), mood/boost, `find_candidates`/`show_picks`,
the watched/seen feature (`watched`, `liked`, `disliked`, `/api/seen`, `mark_seen`, "Already seen", any
"skip films they saw" filtering), genre weights and `taste.nudge`/`vetoed`, `notes`, `role`, `gender`,
`named`, duel skip, shared duel pools + `warm_duel_pools`/`refresh_duel_pools`/`/api/duel/warm`, the
match score. `services/agent/` and the scheduler are removed later by ajanC; do not touch them.

## Profile (stored)

```json
{"id": "deniz", "name": "Deniz", "age": 34, "kid": false,
 "genres": ["Mystery", "Thriller"],               // exact TMDB genre names, chosen by the person
 "duel_history": [{"picked": {"id","title","year","genres"}, "over": {...}, "at": 0}],   // max 30
 "duel_done": false,                               // true after the 5 rounds
 "reviews": [{"id": 1, "title": "Tenet", "year": "2020", "reaction": "disliked",
              "summary": "Too confusing, could not follow the time jumps", "at": 0}]}   // max 30, newest last
```

A new review for the same film replaces the old one (moved to the end).

## `Member` (in `/api/state` `members` and `household`)

```ts
interface Member {
  name: string; age: number | null; kid: boolean;
  genres: string[];
  duel: string[];        // "picked Gone Girl (2014) over Up (2009)", last 10
  duel_done: boolean;
  reviews: { title: string; year: string; reaction: Reaction; summary: string }[];  // last 10
  new: boolean;          // genres empty or duel not done: the TV must finish genres/duel first
}
```

## TV state changes

- `Screen` gains `'genres'`. New field `genres_for: string | null` (whose genres are being picked).
- `Screen` gains `'ask'`. New fields `request: string` (tonight's wish, reset by a couch change) and
  `ask_reply: string` (the sorry line on `ask`, else "").
- `recommendations: MovieCard[]` (10). `MovieCard` drops `match`; keeps `why` and `why_audio`.
- New field `picks_loading: boolean` (true while a recommend call runs, so a second TV poll shows it).
- `boost` removed. `duel` keeps its shape. `rating` keeps its shape; `RatingAnswer.quote` now holds the
  LLM summary of a spoken answer ("" for button answers).
- Keep `speech`, `voice`, `focus`, `details`, `watching` as today.

## HTTP API (MCP server)

| Route | Body | Does |
|---|---|---|
| `GET /api/genres` | - | `{"genres": [{"id": 28, "name": "Action"}, ...]}` TMDB movie genres minus "TV Movie" |
| `POST /api/couch` | `{"add": s, "age": n}` / `{"remove": s}` | as today. A **new** profile goes to `screen: "genres"`, `genres_for: name` (no auto duel). |
| `POST /api/person` | `{"genres": [s,...], "name": s}` | save genres (1+ known names, else 400). If the person has `duel_done: false` and no duel ran, start their duel (screen `duel`). Otherwise stay on the current screen. `edit`/`delete` as today (edit: name and age only). |
| `POST /api/duel` | `{"pick": "left"\|"right"}` | as today minus skip. Last round -> `duel_done: true`, screen `couch`. |
| `POST /api/duel/start` | `{"name": s}` | restart a duel by hand (kept). |
| `POST /api/ask` | `{}` / `{"text": s}` | `{}`: screen `ask` (or the unfinished genres/duel). With text: check it -> `{"ok": true, "request", "recommendations"}` or `{"ok": false, "reply"}` (state `ask_reply`). |
| `POST /api/recommend` | `{"more": bool, "request"?: s}` | see Recommender. `request` sets tonight's wish unchecked (`""` = Skip), left out keeps it. Returns `{"recommendations": [...]}` and sets screen `recommendations`. |
| `POST /api/rating/answer` | `{"name": s, "reaction": Reaction}` | button answer, as today |
| `POST /api/rating/voice` | `{"text": s, "name"?: s}` | spoken answer for `name` (default: whose turn). LLM -> reaction + summary, saved like an answer with `by: "voice"`. Empty/garbage text -> 400 "I didn't catch that". |
| others | | `/api/rating/start|skip|live|finish`, `/api/transcribe`, `/api/voice`, `/api/details`, `/api/screen` (`recommendations`/`ask`/`couch`), `/api/focus`, `/api/watch`, `/api/qr.png`, `/phone/` as today |
| `POST /events` | `{"popcorn": "seed_duel_catalog"}` | see Duel catalog. Replaces the refresh payload. |
| removed | | `/api/seen`, `/api/duel/warm` (`/api/recommend` comes back, no more 410) |

Reactions and their button labels (TV): `loved` "Loved it", `liked` "Liked it", `meh` "It was okay",
`disliked` "Didn't like it", `hated` "Hated it".

## Recommender (`POST /api/recommend`)

- One OpenRouter chat call: model `POPCORN_REC_MODEL` (default `openai/gpt-oss-120b:nitro`),
  `"provider": {"only": ["cerebras/fp16"], "allow_fallbacks": false}`, `"reasoning": {"effort": "low"}`,
  `temperature` 0.5, `usage: {include: true}` (log the cost). Key: `OPENROUTER_API_KEY`.
- System message (static, cache-friendly): recommend **12** films for these viewers to watch together,
  best first; answer only JSON `{"picks": [{"title": "<original English title>", "year": <int>,
  "why": "<one spoiler-free sentence on why this group will enjoy it>"}]}`. Do NOT tell it to use names.
- User message: one block per couch member: name, age, chosen genres, duel picks, reviews
  (`title (year): reaction - summary`). If `more`: "Do not suggest these again: <titles shown this evening>".
- If anyone is a kid (`taste.max_certification` not None): add a rule line: "<Name> is <age>. Only films
  rated US <cert> or lower that suit that age: no horror, strong violence, sexual content or strong
  language." (youngest kid decides).
- Then in code: TMDB search each title (with year, then without), first hit -> `tmdb.movie(id)`;
  drop not-found, no poster, duplicates (by id), and **cert check** `cert_allowed(us_certification, max_cert)`
  (kept as the safety net). Keep the first 10. Attach `why` to the card by id (never by position).
  TTS each `why` in parallel (`speak`). Save to state. Fewer than 4 cards -> one retry, then a 502 error.
- "This evening's shown titles" live in the TV state (`shown_tonight: [{"id","title","year"}]`, reset by
  `set_couch`/couch change). Couch change on the reel no longer filters cards (no seen data).

## Rating voice summary

One call, same model and provider: input = film title + the person's words; output JSON
`{"reaction": one of the 5, "summary": "<their opinion in at most 15 words, English, no spoilers>"}`.
Invalid JSON or reaction -> 400 "I didn't catch that, try again or use the buttons".

## Duel catalog

- For every genre in `/api/genres`: up to 200 different films from two TMDB discover sorts,
  `sort_by=popularity.desc` and `sort_by=vote_count.desc`, both with `vote_count.gte=300` and a poster,
  plus the US certification of each film. Stored per genre:
  key `duelcat:<genre_id>` -> `{"genre": "Action", "cards": [card + {"cert": "PG-13"|null}], "built_at"}`.
- Built once by `seed_duel_catalog`: only genres that are missing; stops before ~20 s of work and
  returns `{"built": [...], "remaining": [...]}` so the deploy calls it again until `remaining` is empty.
  Never refreshed by a schedule.
- Duel: union of the person's genres' cards, cert filtered by the person's own age (`cert_allowed(card.cert, max_cert)`),
  shuffled; 5 pairs, the two posters of a pair from different genres when possible. No TMDB calls.
  Fewer than 10 films after the filter -> fill from other genres' kid-safe cards.

## Phone page

For the rating and the ask screen (state `screen == "ask"`: the talk button sends the words to `/api/ask`). QR URL: `{API}/phone/` (no agent param). Shows whose turn it is (from `/api/state`
`rating.asking`), one big talk button, records -> `/api/transcribe` -> `/api/rating/voice`. Uses
`/api/voice` for listening/thinking/idle so the TV shows the live words. When no rating runs: "Open the
rating on the TV to talk". No speaker chips.
