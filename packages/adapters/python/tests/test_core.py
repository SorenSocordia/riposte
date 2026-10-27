import json
import re
from pathlib import Path

import pytest

from conftest import needs_engine
from riposte_adapters import CONSEQUENTIAL_WORDS, Check, HoldMemory, NodeChecker, RiposteError, classify_call, hold_message, safe_check

GROUNDED = {"to_account": ["110-234-5678"], "amount": [500]}
WRONG = {"to_account": ["220-000-1111"], "amount": [500]}
CALL = {"to_account": "110-234-5678", "amount": 500}


def test_check_refuses_an_unknown_disposition():
    with pytest.raises(RiposteError):
        Check.from_json({"matched": True, "tool": "t", "disposition": "maybe"})


def test_safe_check_a_failed_check_takes_the_safest_rung_and_reports(monkeypatch):
    seen = []

    class Boom:
        def check(self, tool, arguments):
            raise OSError("no node")

    monkeypatch.delenv("RIPOSTE_ACTION_ON_ERROR", raising=False)
    # not consequential: proceeds (None), the error reported
    assert safe_check(Boom(), "t", {}, seen.append) is None
    assert isinstance(seen[0], OSError)
    # consequential by name: a degraded hold that names the problem
    held = safe_check(Boom(), "mcp__bank__transfer", {}, seen.append)
    assert held.disposition == "hold" and held.holds and held.degraded["class"] == "consequential"
    assert "governance degraded" in held.text and "no node" in held.text
    # the opt-out restores fail-open, loudly
    assert safe_check(Boom(), "mcp__bank__transfer", {}, seen.append, on_policy_error="open") is None
    monkeypatch.setenv("RIPOSTE_ACTION_ON_ERROR", "open")
    assert safe_check(Boom(), "mcp__bank__transfer", {}, seen.append) is None


def test_classify_call_reads_the_policy_rule_first(tmp_path):
    p = tmp_path / "p.json"
    p.write_text(json.dumps({"policy_version": "riposte-action-policy-v0", "actions": [
        {"tool": "mcp__ops__go", "level": "gate", "tier": "severe"}, {"tool": "mcp__bank__transfer", "level": "advise", "tier": "low"}]}))
    assert classify_call("mcp__ops__go", str(p))[0] == "consequential"
    assert classify_call("mcp__bank__transfer", str(p))[0] == "record-advise"  # the rule wins over the name
    assert classify_call("Bash", str(p))[0] == "pass-through"
    assert classify_call("mcp__bank__transfer", str(tmp_path / "missing.json"))[0] == "consequential"
    assert classify_call("read_file")[0] == "record-advise" and classify_call("file_claim")[0] == "consequential"


def test_consequential_words_are_the_hook_s_list():
    src = (Path(__file__).resolve().parents[2] / "src" / "degraded.ts").read_text(encoding="utf-8")
    block = re.search(r"CONSEQUENTIAL_WORDS: readonly string\[\] = \[(.*?)\]", src, re.S).group(1)
    assert tuple(re.findall(r"'([^']+)'", block)) == CONSEQUENTIAL_WORDS


def test_hold_memory_and_message():
    m = HoldMemory()
    assert m.seen("k") == 0
    m.mark("k")
    assert m.seen("k") == 1 and m.seen("other") == 0
    c = Check(matched=True, tool="t", disposition="hold", raw={"delivery": {"text": "FACTS\n"}})
    assert hold_message(c, repeat=True).startswith("Already held once")
    msg = hold_message(c, repeat=False)
    assert "FACTS" in msg and "Do not retry it" in msg


def test_node_checker_reports_a_missing_cli_as_an_error_not_a_verdict(tmp_path):
    with pytest.raises(RiposteError):
        NodeChecker(tmp_path / "p.json", cli=tmp_path / "missing.mjs").check("t", {})


@needs_engine
@pytest.mark.parametrize(
    "level,allowed,want",
    [
        ("record", WRONG, "record"),
        ("advise", WRONG, "surface"),
        ("gate", WRONG, "hold"),
        ("autonomy", WRONG, "hold"),
        ("gate", None, "hold"),  # no declared source at all: INSUFFICIENT_DATA holds at gate
        ("gate", {"amount": [500]}, "hold"),  # partially grounded: the guard holds it (verify's notice alone said PASS)
        ("autonomy", {"amount": [500]}, "hold"),
        ("gate", GROUNDED, "review"),
        ("autonomy", GROUNDED, "proceed"),
        ("advise", GROUNDED, "proceed"),
    ],
)
def test_the_engine_decides_the_disposition(policy_file, level, allowed, want):
    c = NodeChecker(policy_file(level, allowed)).check("mcp__bank__transfer", CALL)
    assert c.matched and c.disposition == want
    assert c.level == level
    assert len(c.verdict_id) == 32 and len(c.facts_hash) == 64
    if want == "hold":
        assert "Held for a person" in c.text


@needs_engine
def test_the_engine_passes_through_an_undeclared_tool(policy_file):
    c = NodeChecker(policy_file("gate", WRONG)).check("Bash", {"command": "ls"})
    assert (c.matched, c.disposition) == (False, "pass-through")


@needs_engine
def test_same_call_same_facts_any_audience(policy_file):
    p = policy_file("gate", WRONG)
    solo = NodeChecker(p).check("mcp__bank__transfer", CALL)
    aud = NodeChecker(p, audience="auditor").check("mcp__bank__transfer", CALL)
    assert solo.facts == aud.facts and solo.facts_hash == aud.facts_hash
    assert solo.text != aud.text and aud.text.startswith("RIPOSTE NOTICE")


@needs_engine
def test_a_broken_policy_is_an_error(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text('{"policy_version":"nope","actions":[]}', encoding="utf-8")
    with pytest.raises(RiposteError, match="invalid"):
        NodeChecker(bad).check("t", {})
