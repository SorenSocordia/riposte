"""The Inspect scorer on a stub task: a PASS, a FAIL and an INSUFFICIENT_DATA sample (test/fixtures/sarif), plus an output that is not a
document. The decision comes from the real engine (bin/riposte-score.mjs); Inspect is the contract fake in fake_inspect.py
unless the real inspect_ai is installed (then it is used as is). No network, no model.
"""
import importlib
import json
import math
import os
import shutil
import sys
from pathlib import Path

import pytest

import fake_inspect

USING_FAKE = fake_inspect.install()
FIX = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "sarif"

from riposte_adapters import scoring  # noqa: E402
from riposte_adapters.scoring import NodeScorer, default_score_cli, inspect_fields  # noqa: E402

HAVE_SCORE_BIN = shutil.which("node") is not None and default_score_cli().exists()
needs_score_bin = pytest.mark.skipif(not HAVE_SCORE_BIN, reason=f"needs node and {default_score_cli()} (npm run build)")
# The stub task drives the fake's scorer objects; with the real inspect_ai installed, test_real_inspect.py runs eval() instead.
stub_task = pytest.mark.skipif(not USING_FAKE, reason="the real inspect_ai is installed: see test_real_inspect.py")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch, tmp_path):
    for k in list(os.environ):
        if k.startswith("RIPOSTE_") or k.startswith("RECEIPTS_"):
            monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))


def fixture(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def sample(name, *, as_text=True):
    doc = fixture(name)
    extraction = doc.get("extraction", doc)
    meta = {"riposte_references": doc["references"]} if "references" in doc else {}
    completion = json.dumps(extraction) if as_text else extraction
    return fake_inspect.TaskState(input_text="(the source document)", output=fake_inspect.ModelOutput(completion=completion), metadata=meta)


def scorer_module():
    mod = importlib.import_module("riposte_adapters.inspect_scorer")
    return importlib.reload(mod)


# ── the mapping alone (no engine) ──────────────────────────────────────────────────────────────────────────────────────
def proof(answer):
    return {"kind": "verdict", "proof": {"answer": answer, "verdict_id": "a" * 32, "summary": f"{answer}: …", "replay": "riposte-verify replay riposte-proof-x.json"}}


def test_mapping_pass_fail_abstain_and_refused():
    assert [inspect_fields(proof(a))["value"] for a in ("PASS", "FAIL", "INSUFFICIENT_DATA")] == ["C", "I", "N"]
    ab = inspect_fields(proof("INSUFFICIENT_DATA"))
    assert (ab["answer"], ab["reason"], ab["unscored"]) == ("INSUFFICIENT_DATA", "insufficient_data", False)
    assert inspect_fields(proof("INSUFFICIENT_DATA"), abstain="unscored")["unscored"] is True
    old = inspect_fields(proof("ABSTAIN"))  # an older bundle's word is still read, and rendered in today's
    assert (old["value"], old["answer"], old["reason"], old["metadata"]["riposte"]["answer"]) == ("N", "INSUFFICIENT_DATA", "insufficient_data", "INSUFFICIENT_DATA")
    assert inspect_fields(proof("FAIL"), abstain="unscored")["unscored"] is False
    for a in ("PASS", "FAIL", "INSUFFICIENT_DATA"):
        f = inspect_fields(proof(a))
        assert "a" * 32 in f["explanation"] and "riposte-verify replay" in f["explanation"]
        assert f["metadata"]["riposte"]["verdict_id"] == "a" * 32
    r = inspect_fields({"kind": "refused", "reason": "the output is not JSON"})
    assert (r["value"], r["reason"], r["metadata"]["riposte"]) == ("N", "invalid_response_format", {"answer": None, "refused": "the output is not JSON"})
    with pytest.raises(ValueError):
        inspect_fields(proof("PASS"), abstain="zero")


def test_load_ruleset(tmp_path):
    assert scoring.load_ruleset("invoice") == "invoice"
    assert scoring.load_ruleset({"a": 1}) == {"a": 1}
    p = tmp_path / "rs.json"
    p.write_text('{"ruleset_id": "x"}', encoding="utf-8")
    assert scoring.load_ruleset(p) == {"ruleset_id": "x"}
    with pytest.raises(ValueError):
        scoring.load_ruleset("ap-threeway")


# ── the scorer on a stub task, the real engine deciding ────────────────────────────────────────────────────────────────
@needs_score_bin
@stub_task
def test_stub_task_pass_fail_abstain_and_not_a_document():
    mod = scorer_module()
    score_fn = mod.riposte_scorer("invoice")
    samples = [sample("clean-invoice.json"), sample("invoice-over-contract.json"), sample("invoice-missing-totals.json"),
               fake_inspect.TaskState(input_text="x", output=fake_inspect.ModelOutput(completion="I could not read the invoice."))]
    scores, metrics, unscored = fake_inspect.run_task(score_fn, samples)
    assert [s.value for s in scores] == ["C", "I", "N", "N"]
    assert [s.answer for s in scores] == ["PASS", "FAIL", "INSUFFICIENT_DATA", None]
    assert [s.reason for s in scores] == [None, None, "insufficient_data", "invalid_response_format"]
    for s in scores[:3]:
        r = s.metadata["riposte"]
        assert len(r["verdict_id"]) == 32 and r["replay"] == f"riposte-verify replay riposte-proof-{r['verdict_id']}.json"
        assert r["verdict_id"] in s.explanation and r["replay"] in s.explanation
        assert r["proof"]["verdict"]["verdict_id"] == r["verdict_id"]
    assert "RATE_SUP" in [f["rule_id"] for f in scores[1].metadata["riposte"]["findings"]]
    # INSUFFICIENT_DATA is never a 0: one PASS over two decided samples, not one over four
    assert metrics["decided_pass_rate"] == 0.5
    assert metrics["abstain_rate"] == 0.5
    assert metrics["fail_rate"] == 0.25
    assert unscored == 0
    if USING_FAKE:
        assert [m.scores_mode for m in score_fn.metrics] == ["unreduced"] * 3
        assert score_fn.scorer_name == "riposte"


@needs_score_bin
@stub_task
def test_unscored_mode_leaves_abstain_out_of_every_metric():
    mod = scorer_module()
    score_fn = mod.riposte_scorer("invoice", abstain="unscored")
    scores, metrics, unscored = fake_inspect.run_task(score_fn, [sample("clean-invoice.json"), sample("invoice-over-contract.json"), sample("invoice-missing-totals.json")])
    assert scores[0].value == "C" and scores[1].value == "I" and math.isnan(scores[2].value)
    assert scores[2].reason == "insufficient_data" and scores[2].metadata["riposte"]["answer"] == "INSUFFICIENT_DATA"
    assert unscored == 1
    assert metrics["decided_pass_rate"] == 0.5
    assert math.isnan(metrics["abstain_rate"])  # not 0: the abstentions are counted by Inspect's unscored_samples


@needs_score_bin
@stub_task
def test_references_from_metadata_and_source_from_input():
    mod = scorer_module()
    without_refs = fake_inspect.run_task(mod.riposte_scorer("invoice", references_key=None), [sample("invoice-over-contract.json")])[0][0]
    with_refs = fake_inspect.run_task(mod.riposte_scorer("invoice"), [sample("invoice-over-contract.json")])[0][0]
    assert with_refs.value == "I"
    assert without_refs.metadata["riposte"]["verdict_id"] != with_refs.metadata["riposte"]["verdict_id"]
    payapp = fake_inspect.run_task(mod.riposte_scorer("pay-app"), [sample("payapp-retainage.json")])[0][0]
    assert payapp.value == "I" and payapp.metadata["riposte"]["ruleset"].startswith("pay-app@")
    with pytest.raises(ValueError):
        mod.riposte_scorer("invoice", source="target")


@stub_task
def test_a_broken_engine_is_a_scoring_error_not_an_abstain(tmp_path):
    mod = scorer_module()
    score_fn = mod.riposte_scorer("invoice", cli=str(tmp_path / "missing.mjs"))
    with pytest.raises(Exception) as e:
        fake_inspect.run_task(score_fn, [sample("clean-invoice.json")])
    assert "riposte-score" in str(e.value)


@needs_score_bin
def test_node_scorer_refuses_an_unknown_ruleset_loudly():
    with pytest.raises(Exception) as e:
        NodeScorer().check({"a": 1}, ruleset="nope")
    assert "unknown ruleset" in str(e.value)
