# ajanE: duel prefers films that match more of the person's genres

## Diff in short

`services/mcp/src/popcorn_mcp/service.py`, `Popcorn._duel_pool` only:

- docstring, one line: "Kid-safe cards from the person's genres, the ones sharing more of them first, topped up from the rest."
- after the existing `random.shuffle(pool)`, one line:

```python
pool.sort(key=lambda card: -len(wanted & set(card["genre_ids"])))  # the more of their genres, the better
```

Shuffle first, then a stable sort by score, so order stays random inside the same score. The `rest`
top-up is unchanged and still comes after. `_duel_pairs` and the catalog are untouched; one chosen
genre behaves exactly as before (every `own` card scores 1, only the shuffle decides).

`briefs/v3-contract.md`, step 3 (Poster duel), one added line:
"With several genres, films that have more of them are shown first."

## New test

`services/mcp/tests/test_service.py`, next to the other duel tests:

```python
def test_a_duel_with_two_genres_starts_with_films_that_have_both():
    async def scenario():
        p = make()
        await p.seed_duel_catalog()
        await p.set_couch([{"name": "Ayse"}])
        await p.save_genres("Ayse", ["Comedy", "Family"])
        return await p.get_state()

    state = run(scenario())
    first = state["duel"]["pairs"][0]
    assert {c["title"] for c in first} == {"Toon Town", "Puppy Parade"}  # the only two in both genres
```

The fake catalog has many Comedy-only and Family-only films and exactly two with both, so the first
pair is those two (in either order). Checked it fails without the sort, and it is stable over 20 runs.

## Test result

`cd services/mcp && .venv/bin/python -m pytest -q` -> `64 passed in 0.84s`.

DONE
