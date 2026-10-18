# ajan5 report: v2 agent service (Day 6)

## Summary

- Done: household session store (DynamoDB or in memory), static system prompt with a context line per turn, speech posted to the TV after each turn, `/event` and `/session/new`, the v2 flow prompt, and a tool-call limit plus a 60 s timeout per turn.
- Tests: 41 offline tests pass.
- DynamoDB: the store works against the real table, tested only with `v2-test:` keys, which I deleted afterwards.
- **Live test with the real MCP server and OpenRouter: not run.** ajan2's MCP server never came up on `127.0.0.1:8010` (I checked every 10 s for 10 minutes), so there is no live transcript and no per-turn timings. As the brief says, I did not start it myself.
- Nothing deployed. No git state changed. Only `services/agent/` and this report were touched.

## Per-file changes (`services/agent/`)

- `src/popcorn_agent/store.py` (rewritten)
  - Key-value layer: `MemoryKeyValue` and `DynamoKeyValue`, with the same schema as the MCP store (`pk`, `doc` JSON string, `expires_at`).
  - `SessionStore(kv, household)` keeps the session in `<household>:session` as `{"id", "messages", "last_active"}`, with a TTL of 1 day.
  - `load()` returns a fresh session when the doc is missing or idle for more than 3 h. `new()` stores a fresh session right away. `save()` trims, then writes.
  - A `conversation_id` that does not match the household session id is kept as a side doc under `<household>:session:<id>`, so the old voice page still works.
  - Size rule (`trim`, 300 KB, measured as UTF-8 JSON):
    1. Replace the content of the oldest `find_candidates` / `duel_candidates` results with `"[old list omitted]"` (and drop `structuredContent`), never in the newest turn.
    2. Then drop the oldest whole turns. The newest turn always stays, and so does the newest turn that loaded each current couch member's memory. The couch comes from `/api/state` `members`, or is replayed from the couch tool calls when the state is down.
- `src/popcorn_agent/prompts.py`
  - Static `SYSTEM_PROMPT` (v2 flow, full text below).
  - `context_line` / `with_context` build `[speaker: X] [tv: screen=..., asking=..., people=...]` and leave out unknown parts.
  - `event_sentence` gives the exact contract sentences. `build_system_prompt` and the rating dynamics are removed.
- `src/popcorn_agent/agent.py` (rewritten)
  - One `turn()` async generator drives both `/chat` and `/chat/stream`.
  - Per turn: load the session, read `GET {MCP}/api/state` (3 s, a failure is ignored), prepend the context line, run the Strands Agent with `NullConversationManager` so the session store owns trimming, save, then speak.
  - `_TurnHook` collects steps, streams tool events, and enforces the limits:
    - Tool calls past `MAX_TOOL_CALLS` (12) are cancelled with "Tool limit reached... reply now".
    - Past limit+3 model calls, the model call itself is cancelled and the reply becomes the apology.
  - The turn timeout (`TURN_TIMEOUT`, 60 s) cancels the task.
  - A failed or timed-out turn does not save the session.
  - `speak()`:
    - non-empty reply and no `start_rating` / `record_reaction` in the turn: `POST /api/speech` with the reply (cut to 600 chars);
    - otherwise: `POST /api/voice {"state":"idle"}`;
    - on failure: the apology "Sorry, I didn't catch that. Try again?";
    - never raises, falls back to an idle voice post.
  - Empty assistant messages (silent rating turns) are dropped before saving, because Chat Completions gets an assistant message with no content otherwise.
  - An asyncio lock serializes turns in one process.
  - `prompt_cache_key=popcorn-<household>` is sent to OpenRouter. Not checked live, see open questions.
  - `unwrap_nullable` is kept.
- `src/popcorn_agent/server.py`
  - Builds `SessionStore` from settings: DynamoDB when `POPCORN_TABLE` is set, memory otherwise.
  - New `POST /event` (400 for an unknown event or a missing name on `duel_done`, 502 on a turn failure) and `POST /session/new` -> `{"id"}`.
  - `/chat`, `/chat/stream`, `/speak` and `/health` are kept. CORS is unchanged.
- `src/popcorn_agent/config.py`: new settings `popcorn_table`, `popcorn_household` (default `demo`), `turn_timeout`, `max_tool_calls`.
- `tests/`
  - `fakes.py`: a scripted Strands `Model`, fake tools with the MCP names, and a fake MCP HTTP server built on `httpx.MockTransport`.
  - New `test_agent.py`; rewritten `test_store.py` and `test_prompts.py`; `test_server.py` gains `/event`, `/session/new` and CORS tests.
- `README.md`: session, prompt, speech and limits; new endpoints; local run command.

## How to run

```bash
cd services/agent
uv run pytest
# local, in-memory session, against ajan2's MCP server:
POPCORN_TABLE= PORT=8110 MCP_URL=http://127.0.0.1:8010/mcp uv run popcorn-agent
```
`POPCORN_TABLE=` (empty) is needed locally because the repo `.env` sets `POPCORN_TABLE` and env values win over `.env`.

## Test output

```
$ uv run pytest -q
.........................................                                [100%]
41 passed in 1.68s
```
What the tests cover:
- session reuse across turns, with the same static system prompt each time;
- `/session/new` and the idle reset after 3 h;
- size trimming: lists omitted first, then turns dropped, couch memory kept, memory of someone who left can go;
- the exact context line, and a turn that still works with the state down;
- speech rules: normal turn, rating turn, empty reply, speech post failing (`/chat` still 200), apology on failure, session not saved on failure;
- the timeout and the tool-call limit;
- the four event sentences; the SSE shape; the HTTP endpoints.

DynamoDB store, live against the real table (household `v2-test`):
```
load (missing) s_99e816ee5073 0 1883 ms      (first call includes the boto3 client setup)
save 438 ms
load again True 2
new True 0
item keys ['doc', 'expires_at', 'pk'] ttl in s 86400
after delete None
```
Only the key `v2-test:session` was used, and it is deleted.

Server smoke test on port 8110 (in-memory store, MCP down):
```
GET  /health          {"ok":true,"model":"openai/gpt-6-luna","mcp":"http://127.0.0.1:8010/mcp","voice":"Brian"}
POST /session/new     {"id":"s_5b7298299c44"}
POST /event {"event":"duel_done"}   {"error":"name is required for duel_done"}
POST /chat {"text":"hi"}            502 {"error":"Failed to process conversation with language model."} in ~0.1 s
```
The MCP-down failure logged "Could not post the speech to the TV: ConnectError" and nothing else, so it fails cleanly without hanging.

## Live transcript

**Not run: ajan2's MCP server was not up on `127.0.0.1:8010`** (I checked for 10 min). The script is ready at
`/private/tmp/claude-501/-Users-bedirhan-Documents-Projects-popcorn-ai/a2e524fe-8472-4f19-81d8-dfb3245a4b88/scratchpad/live.py`. It runs these steps:
1. starts a new session;
2. "I'm Ahmet, the dad, 43, and my son is here too, he's 10.", then "Don't save his name.";
3. starts the duel, picks 5 times through `/api/duel`, then sends the `duel_done` event;
4. "Something fun and adventurous tonight.", then prints each card's title, match and `why`, the speech queue, and the timings of every turn.

To run it: start the agent with the command above, then `uv run --project services/agent python <script>`.

## Final system prompt (full text)

```
You are Popcorn, a warm movie-night helper for a family living room. You talk out loud; the TV shows the details.

How messages look:
- Each message starts with one context line, e.g. [speaker: Ahmet] [tv: screen=couch, people=Ahmet,Leyla]. speaker is who is talking ("I", "me", "my" mean them). tv is what the TV shows now; people are the people on the couch (in the rating round: the people being asked). Parts can be missing.
- "[event] ..." messages come from the TV buttons, not from a person.
- What you know about a person comes only from tool results (memory). Use the newest one. Never invent people, films, or tastes.

Replies:
- English. 1 or 2 short spoken sentences. No lists, no markdown, no emojis, no URLs, no ids, no match numbers.
- If a tool returns an error, say simply what went wrong and what to try next.

People:
- When someone says who is watching, call set_couch (whole couch) or add_to_couch / remove_from_couch. Pass age, kid, role ("dad", "mom", "older son", "grandma"), gender ("male"/"female") when they were said or are clear from words like dad, son, mom.
- If a name is missing ("my son is here too"), ask once for it. If they do not want to give it ("don't save his name"), use a label such as "Ahmet's son" with named false. Never ask twice.
- Collect age, role and gender only when offered. Never interrogate; at most one short question per reply.
- If a label person later gives a name, call rename_person.
- A person under 13 is a kid. Kid safety is done by the tools; never argue with it or work around it.

Taste notes:
- When someone tells you about their taste, call update_taste. Use loves/likes/dislikes/hates for genres, and note for one short sentence in their own spirit, e.g. "Loves superhero films, even more mixed with horror". One idea per note, under 140 characters.

Poster duel (for new people, memory "new": true):
- Offer the duel to new people one at a time ("Leyla, want a quick poster duel to learn your taste?"). If they agree, call duel_candidates for that person, then start_duel with exactly 5 pairs of ids from that pool: pairs 1 and 2 are maximally different films (genre, tone, era); pairs 3 to 5 probe tone inside their likely taste (e.g. grounded vs spectacle sci-fi, cozy vs dark comedy). Use each film once. Then say briefly that the duel is on the TV.
- If someone says skip or no, respect it and move on.
- After "[event] <name> finished the poster duel.", call get_profiles for that person, read their duel history ("picked X over Y"), and call update_taste with 1 to 3 short notes (one call per note) about what the picks show. Then move on: offer the duel to the next new person on the couch, or ask what mood or genre they want tonight.
- After "[event] <name> skipped the poster duel.", move on the same way.

Picks:
- When they want picks, give a mood or genre, or press Show picks ("[event] The family pressed Show picks on the TV."), call find_candidates. Build its arguments from the mood and feedback (genres, without_genres, keywords like "time travel" or "heist", year range) and from the couch members' notes. With no hints, call it without arguments.
- Then call show_picks with 6 picks from that pool (4 to 8 if the pool is small). For each pick:
  - why: one spoken sentence for the people on the couch, specific to this film and to them (their notes, duel picks, the mood asked for). No spoilers. Never the template "X loves <genre>". Use names. Under 200 characters.
  - match: an honest number from 50 to 99 for how well it fits the whole couch.
- Then reply in one sentence, e.g. name one or two picks. Do not read all the reasons aloud; the TV plays them.
- Feedback ("too many superhero films", "something lighter", "more grounded sci-fi"): call find_candidates again with new arguments and exclude_ids = every film id already shown tonight, then show_picks again.
- "I've seen it" / "we saw the first two": call mark_seen with those people's names (the speaker if "I", the couch if "we") and the movie ids from the cards on screen. Then a short acknowledgement.
- When the couch changes, the tools handle the cards; offer new picks if it helps.
- Film questions ("what is it about", "tell me more about X"): call get_movie_details.

Rating round (after the film):
- When the family says they are back or finished the film, call start_rating (no movie needed). Reply with an empty message; the TV asks each person.
- While tv screen=rating, the message is the answer of the person in "asking". Map it to ONE reaction: loved (loved it, amazing, favorite), liked (good, nice, enjoyed), meh (okay, fine, so-so, mixed), disliked (not great, boring), hated (awful, terrible). Mixed answers count by the final verdict: "a bit long but I loved it" -> loved.
- Call record_reaction with name = the asking person, reaction, and quote = their own words, at most 120 characters. "skip", "pass", "no comment", "I don't know" -> record_reaction with reaction null.
- During the rating round always reply with an empty message; the TV speaks the next question and the thanks.
- Outside the rating round, "we watched X, I loved it" -> mark_watched with reactions for each person who gave an opinion ({"<speaker>": "loved"}), or reactions null if nobody did.
```

## Open questions and decisions I made

1. **Live check still to do.** I could not confirm against the real MCP server that:
   - ajan2's tool names and arguments match the contract;
   - OpenRouter accepts `prompt_cache_key` (if it rejects it, delete that one param in `agent.py`);
   - the model really sends an empty reply during the rating round.
2. **`people=` outside the rating round.** It is the couch members from `/api/state` `members`; the contract example only shows the rating case. Only names go in, never memory.
3. **`app_opened` sentence.** The contract gives no example, so I used "[event] The family opened Popcorn on the TV."
4. **Events carry no speaker.** They get only the `[tv: ...]` part of the context line.
5. **Couch-memory protection.** The size rule keeps the newest turn that loaded each couch member's memory, not every such turn; otherwise the session could never shrink. Trimming old lists rewrites older messages, which breaks the provider's prefix cache once when it happens; this only matters above 300 KB.
6. **Speaking is awaited before `/chat` returns** (Lambda may freeze background work after the response). This adds the MCP's Polly time, about a few hundred ms, to the reply.
7. **Turns are serialized by an asyncio lock inside one process.** Two Lambda instances could still race on the same household session; last write wins.
8. **`conversation_id` handling.** One that matches the household session id uses it; any other value gets its own side doc, which keeps the old voice page working.
9. **Duel notes after `duel_done`.** The prompt has the model call `get_profiles` to read the "picked X over Y" history, then `update_taste` once per note. That works if `get_profiles` returns `memory(p)` with `duel`, as the contract says.

## Friction (rule 8)

- **Strands Agents 1.61.1, `SlidingWindowConversationManager` is on by default.**
  - Tried: building an `Agent(messages=...)` per turn from a stored session.
  - Expected: the history comes back untouched. Actual: the default `window_size=40` trims it after each invocation, without saying so.
  - Workaround: pass `conversation_manager=NullConversationManager()` and trim in our own store.
- **Strands Agents 1.61.1, `OpenAIModel` with an empty assistant reply.**
  - Tried: letting the model end a turn with no text.
  - Actual: `_format_regular_messages` emits `{"role": "assistant"}` with neither `content` nor `tool_calls` (source, `strands/models/openai.py`) when such a message is replayed on the next turn.
  - Workaround: drop empty assistant messages before saving the session.
- **Strands Agents 1.61.1, `MCPClient` when the server is down.**
  - Tried: a turn with the MCP server stopped.
  - Actual: a vague error, `ValueError('Failed to load tool <strands.tools.mcp.mcp_client.MCPClient object at 0x...>: Failed to start MCP client: the client initialization failed: unhandled errors in a TaskGroup (1 sub-exception)')`. The real cause (connection refused) is hidden inside the exception group.
  - Workaround: none needed; the turn fails cleanly with 502 and the apology.

DONE
