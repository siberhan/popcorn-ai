"""Tests for the static prompt, the per-turn context line and event sentences."""

import pytest

from popcorn_agent.prompts import SYSTEM_PROMPT, context_line, event_sentence, with_context


def test_prompt_is_static_and_covers_the_flow():
    for word in ("set_couch", "named false", "update_taste", "duel_candidates", "start_duel", "find_candidates",
                 "show_picks", "exclude_ids", "mark_seen", "start_rating", "record_reaction", "rename_person"):
        assert word in SYSTEM_PROMPT
    assert "{" not in SYSTEM_PROMPT.replace('{"<speaker>": "loved"}', "")


def test_context_line_full_and_partial():
    state = {"screen": "rating", "rating": {"asking": "Leyla", "people": ["Ahmet", "Leyla"], "done": False}}
    assert context_line("Ahmet", state) == "[speaker: Ahmet] [tv: screen=rating, asking=Leyla, people=Ahmet,Leyla]"
    assert context_line(None, {"screen": "couch", "members": [{"name": "Ahmet"}]}) == "[tv: screen=couch, people=Ahmet]"
    assert context_line("Ahmet", None) == "[speaker: Ahmet]"
    assert context_line(None, None) == ""
    assert with_context("hi", None, None) == "hi"


def test_finished_rating_shows_couch_people():
    state = {"screen": "rating", "members": [{"name": "A"}], "rating": {"asking": None, "people": ["A"], "done": True}}
    assert context_line(None, state) == "[tv: screen=rating, people=A]"


def test_event_sentences():
    assert event_sentence("duel_done", "Leyla") == "[event] Leyla finished the poster duel."
    assert event_sentence("duel_done", "Leyla", True) == "[event] Leyla skipped the poster duel."
    assert event_sentence("show_picks") == "[event] The family pressed Show picks on the TV."
    with pytest.raises(ValueError):
        event_sentence("duel_done")
