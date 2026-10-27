"""Riposte as a UK AISI Inspect scorer: the deterministic verdict inside an Inspect eval.

    from riposte_adapters.inspect_scorer import riposte_scorer
    Task(dataset=..., solver=generate(), scorer=riposte_scorer("invoice"))

The scorer runs the check on the sample's output (``state.output.completion``: the extracted document, or its JSON text) and
returns a Score:

    PASS     CORRECT
    FAIL     INCORRECT
    INSUFFICIENT_DATA  NOANSWER, reason "insufficient_data" (can't tell); or, with abstain="unscored", Score.unscored() (left
                       out of every metric). Written ABSTAIN, reason "abstain", before 2026-10-06.
    refused            the same as INSUFFICIENT_DATA, reason "invalid_response_format" (the output was not a document; there
                       is no verdict)

``explanation`` names the verdict id and the replay command; ``metadata["riposte"]`` holds the proof (verdict id, findings,
remedies, the replay command, and the replay bundle unless ``inline_proof=False``). The target is not used: the check is
against the document's own arithmetic and the references you supply in the sample's metadata.

Its metrics never count a can't tell (INSUFFICIENT_DATA) as a 0. Inspect's own ``accuracy()`` maps NOANSWER to 0 (scorer/_metric.py,
``value_to_float``), so do not add it here; use abstain="unscored" if you must combine this scorer with metrics that read
NOANSWER as 0. The metrics declare ``scores="unreduced"`` where Inspect supports it, so an epoch reducer cannot turn NOANSWER
into 0 before they see it.
"""
from __future__ import annotations

import math
from typing import Any, Mapping, Optional, Union

from inspect_ai.scorer import CORRECT, INCORRECT, NOANSWER, Score, Target, metric, scorer
from inspect_ai.solver import TaskState

from .scoring import ABSTAIN_MODES, NodeScorer, inspect_fields, load_ruleset


def _metric(fn):
    """Register with ``scores="unreduced"`` when this Inspect has it (the label survives epochs), else as a plain metric."""
    try:
        return metric(scores="unreduced")(fn)
    except TypeError:
        return metric(fn)


def _value(s: Any) -> Any:
    return s.score.value


def _unscored_mode(scores: list) -> bool:
    return any((s.score.metadata or {}).get("riposte_abstain_mode") == "unscored" for s in scores)


@_metric
def decided_pass_rate():
    """PASS over PASS + FAIL: INSUFFICIENT_DATA is not in the denominator. NaN when nothing was decided."""

    def compute(scores: list) -> float:
        decided = [_value(s) for s in scores if _value(s) in (CORRECT, INCORRECT)]
        return sum(1 for v in decided if v == CORRECT) / len(decided) if decided else math.nan

    return compute


@_metric
def abstain_rate():
    """The share of samples no check could decide (INSUFFICIENT_DATA; the metric keeps its name). Under abstain="unscored" Inspect keeps those samples away from every
    metric, so this reads NaN there: count them from the log's ``unscored_samples`` instead."""

    def compute(scores: list) -> float:
        if not scores or _unscored_mode(scores):
            return math.nan
        return sum(1 for s in scores if _value(s) == NOANSWER) / len(scores)

    return compute


@_metric
def fail_rate():
    """The share of samples where a check ran and did not hold (FAIL). INSUFFICIENT_DATA is never counted as a FAIL."""

    def compute(scores: list) -> float:
        return sum(1 for s in scores if _value(s) == INCORRECT) / len(scores) if scores else math.nan

    return compute


async def _in_thread(fn, *args, **kwargs):
    try:
        import anyio.to_thread  # Inspect's own async runtime
        from functools import partial

        return await anyio.to_thread.run_sync(partial(fn, *args, **kwargs))
    except ImportError:  # pragma: no cover - anyio ships with Inspect
        import asyncio

        return await asyncio.to_thread(fn, *args, **kwargs)


@scorer(metrics=[decided_pass_rate(), abstain_rate(), fail_rate()], name="riposte")
def riposte_scorer(
    ruleset: Union[str, Mapping[str, Any]] = "invoice",
    *,
    references_key: Optional[str] = "riposte_references",
    source: Optional[str] = None,
    abstain: str = "noanswer",
    inline_proof: bool = True,
    cli: Optional[str] = None,
    timeout: float = 30.0,
):
    """Riposte's verdict on each sample's output.

    Args:
        ruleset: ``invoice``, ``pay-app``, a declarative ruleset object, or its file.
        references_key: the sample metadata key holding ``{"contract", "evidence", "history"}``; None for none.
        source: ``"input"`` checks values and quotes against the sample's input text; None (default) skips the source checks.
        abstain: ``"noanswer"`` (NOANSWER, kept in the log with its label) or ``"unscored"`` (Score.unscored()).
        inline_proof: put the replay bundle in the score's metadata.
        cli: the riposte-score bundle (default: ``RIPOSTE_SCORE_CLI``, else bin/riposte-score.mjs beside this package).
    """
    if abstain not in ABSTAIN_MODES:
        raise ValueError(f"abstain is one of {ABSTAIN_MODES}, not {abstain!r}")
    if source not in (None, "input"):
        raise ValueError(f'source is "input" or None, not {source!r}')
    rs = load_ruleset(ruleset)
    checker = NodeScorer(cli=cli, timeout=timeout)

    async def score(state: TaskState, target: Target) -> Score:
        refs = (state.metadata or {}).get(references_key) if references_key else None
        text = state.input_text if source == "input" else None
        result = await _in_thread(checker.check, state.output.completion, ruleset=rs, references=refs, source=text, inline_proof=inline_proof)
        f = inspect_fields(result, abstain=abstain, correct=CORRECT, incorrect=INCORRECT, noanswer=NOANSWER)
        if f["unscored"]:
            if not hasattr(Score, "unscored"):
                raise RuntimeError('abstain="unscored" needs an Inspect with Score.unscored(); use abstain="noanswer"')
            return Score.unscored(reason=f["reason"], answer=f["answer"], explanation=f["explanation"], metadata=f["metadata"])
        extra = {"reason": f["reason"]} if f["reason"] else {}
        return Score(value=f["value"], answer=f["answer"], explanation=f["explanation"], metadata=f["metadata"], **extra)

    return score
