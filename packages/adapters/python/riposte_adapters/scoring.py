"""Riposte verdicts as eval scores, the Python side.

``NodeScorer`` runs the bundled engine (``riposte-score``, built from ``products/adapters/src/scorers`` by ``npm run build``)
and returns its result verbatim: ``{"kind": "verdict", "proof": {...}}`` or ``{"kind": "refused", "reason": "..."}``. The
verdict is never re-derived in Python; the functions here only render it for a platform.

    PASS     every check that ran held
    FAIL     a check ran and did not hold
    INSUFFICIENT_DATA  can't tell: no check could decide (an input was missing or not supplied): never rendered as a 0 or as a
                       fail (written ABSTAIN before 2026-10-06; an older result that says so is still read)
    refused  the output was not a document at all, so there is no verdict and no verdict id

Every rendering carries the verdict id and the replay command (``riposte-verify replay <proof file>``); the proof bundle
itself travels in the metadata unless ``inline_proof=False``.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Union

from .core import RiposteError

BUILTIN_RULESETS = ("invoice", "pay-app")
ABSTAIN_MODES = ("noanswer", "unscored")


def default_score_cli() -> Path:
    """``RIPOSTE_SCORE_CLI``, else the bundle beside this package (bin/riposte-score.mjs)."""
    env = os.environ.get("RIPOSTE_SCORE_CLI")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "bin" / "riposte-score.mjs"


def load_ruleset(ruleset: Union[str, Mapping[str, Any], os.PathLike]) -> Union[str, Dict[str, Any]]:
    """A built-in name as is, a declarative ruleset object as is, or a declarative ruleset file read from disk."""
    if isinstance(ruleset, Mapping):
        return dict(ruleset)
    if isinstance(ruleset, str) and ruleset in BUILTIN_RULESETS:
        return ruleset
    path = Path(ruleset)
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    raise ValueError(f"ruleset {ruleset!r}: use {' or '.join(BUILTIN_RULESETS)}, a declarative ruleset object, or its file")


class NodeScorer:
    """One check by running ``node riposte-score.mjs`` (the engine, not a re-implementation)."""

    def __init__(self, *, cli: Union[str, os.PathLike, None] = None, node: str = "node", timeout: float = 30.0) -> None:
        self.cli = str(cli) if cli is not None else str(default_score_cli())
        self.node = node
        self.timeout = timeout

    def check(
        self,
        output: Any,
        *,
        ruleset: Union[str, Mapping[str, Any]] = "invoice",
        references: Optional[Mapping[str, Any]] = None,
        source: Optional[str] = None,
        inline_proof: bool = True,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"output": output, "ruleset": ruleset, "inline_proof": inline_proof}
        if references:
            payload["references"] = dict(references)
        if source:
            payload["source"] = source
        try:
            p = subprocess.run(
                [self.node, self.cli], input=json.dumps(payload, default=str), capture_output=True, text=True, encoding="utf-8",
                timeout=self.timeout,
            )
        except (OSError, subprocess.SubprocessError) as e:
            raise RiposteError(f"riposte-score could not run: {e}") from e
        if p.returncode != 0:
            raise RiposteError(f"riposte-score exited {p.returncode}: {p.stderr.strip()}")
        try:
            result = json.loads(p.stdout)
        except ValueError as e:
            raise RiposteError(f"riposte-score printed something that is not a result: {e}") from e
        if result.get("kind") not in ("verdict", "refused"):
            raise RiposteError(f"riposte-score printed an unknown result kind {result.get('kind')!r}")
        return result


def explanation_of(result: Mapping[str, Any]) -> str:
    """The proof's sentence, the verdict id and the command that re-performs it (or why nothing was checked)."""
    if result.get("kind") == "refused":
        return f"Not checked: {result.get('reason')}. There is no verdict for an output that is not a document."
    p = result["proof"]
    return f"{p['summary']} Verdict {p['verdict_id']}. Re-run: {p['replay']}"


def inspect_fields(
    result: Mapping[str, Any],
    *,
    abstain: str = "noanswer",
    correct: Any = "C",
    incorrect: Any = "I",
    noanswer: Any = "N",
) -> Dict[str, Any]:
    """The Inspect Score fields for one result.

    PASS → ``correct``, FAIL → ``incorrect``. INSUFFICIENT_DATA (can't tell; an older result's ABSTAIN reads the same) →
    ``noanswer`` with reason ``insufficient_data`` (``abstain="noanswer"``, the option keeps its name), or an
    unscored Score (``abstain="unscored"``: Inspect leaves it out of every metric). A refused output is treated the same way
    with reason ``invalid_response_format``. ``unscored`` says which constructor to use.
    """
    if abstain not in ABSTAIN_MODES:
        raise ValueError(f"abstain is one of {ABSTAIN_MODES}, not {abstain!r}")
    mode = {"riposte_abstain_mode": abstain}
    if result.get("kind") == "refused":
        return {
            "value": noanswer, "answer": None, "explanation": explanation_of(result), "reason": "invalid_response_format",
            "metadata": {"riposte": {"answer": None, "refused": result.get("reason")}, **mode}, "unscored": abstain == "unscored",
        }
    p = result["proof"]
    answer = "INSUFFICIENT_DATA" if p["answer"] == "ABSTAIN" else p["answer"]  # an older bundle's word for can't tell
    value = {"PASS": correct, "FAIL": incorrect, "INSUFFICIENT_DATA": noanswer}[answer]
    cant_tell = answer == "INSUFFICIENT_DATA"
    return {
        "value": value, "answer": answer, "explanation": explanation_of(result), "reason": "insufficient_data" if cant_tell else None,
        "metadata": {"riposte": {**dict(p), "answer": answer}, **mode}, "unscored": cant_tell and abstain == "unscored",
    }
