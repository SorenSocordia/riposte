"""A contract fake of the slice of ``inspect_ai`` the Riposte scorer touches, installed only when the real package is absent.

Written from Inspect's own source and docs (fetched 2026-10-03):
- ``inspect_ai/scorer/_metric.py``: ``CORRECT = "C"``, ``INCORRECT = "I"``, ``NOANSWER = "N"``; ``Score`` (value, answer,
  explanation, reason, metadata); ``Score.unscored(*, reason, answer, explanation, metadata)`` sets value to NaN;
  ``metric(name=None, *, scores="auto")`` used bare or with arguments; ``SampleScore`` (score, sample_id).
- ``inspect_ai/_eval/task/results.py``: NaN-valued (unscored) scores are left out before metrics run.
- custom-scorers docs: ``async def score(state: TaskState, target: Target) -> Score``, ``state.output.completion``,
  ``state.input_text``, ``target.text``.
``run_task`` is the stub task: it scores each sample and computes the scorer's metrics the way the results code does.
"""
from __future__ import annotations

import asyncio
import math
import sys
import types
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

CORRECT, INCORRECT, NOANSWER = "C", "I", "N"


@dataclass
class Score:
    value: Any
    answer: Optional[str] = None
    explanation: Optional[str] = None
    reason: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    @classmethod
    def unscored(cls, *, reason=None, answer=None, explanation=None, metadata=None) -> "Score":
        return cls(value=float("nan"), reason=reason, answer=answer, explanation=explanation, metadata=metadata)


@dataclass
class SampleScore:
    score: Score
    sample_id: Any = None


@dataclass
class Target:
    target: List[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "".join(self.target)


@dataclass
class ModelOutput:
    completion: str


@dataclass
class TaskState:
    input_text: str
    output: ModelOutput
    metadata: Dict[str, Any] = field(default_factory=dict)


def metric(name=None, *, scores: str = "auto"):
    def register(fn, mode=scores):
        def factory(*a, **kw):
            m = fn(*a, **kw)
            m.metric_name, m.scores_mode = fn.__name__, mode
            return m

        factory.__name__ = fn.__name__
        return factory

    if callable(name):  # bare @metric
        return register(name)
    return register


def scorer(metrics, name: Optional[str] = None):
    def deco(fn):
        def factory(*a, **kw):
            s = fn(*a, **kw)
            s.metrics, s.scorer_name = metrics, name or fn.__name__
            return s

        factory.__name__ = fn.__name__
        return factory

    return deco


def install() -> bool:
    """Put the fake in sys.modules unless the real inspect_ai imports. True when the fake is in use."""
    try:
        import inspect_ai.scorer  # noqa: F401
        return False
    except ImportError:
        pass
    root = types.ModuleType("inspect_ai")
    sc = types.ModuleType("inspect_ai.scorer")
    so = types.ModuleType("inspect_ai.solver")
    for k, v in dict(CORRECT=CORRECT, INCORRECT=INCORRECT, NOANSWER=NOANSWER, Score=Score, SampleScore=SampleScore, Target=Target,
                     metric=metric, scorer=scorer).items():
        setattr(sc, k, v)
    so.TaskState = TaskState
    root.scorer, root.solver = sc, so
    sys.modules.update({"inspect_ai": root, "inspect_ai.scorer": sc, "inspect_ai.solver": so})
    return True


def run_task(score_fn, samples: List[TaskState]):
    """The stub task: score every sample, drop unscored (NaN) values as Inspect's results code does, run each metric."""
    scores = [asyncio.run(score_fn(s, Target())) for s in samples]
    kept = [SampleScore(score=s, sample_id=i) for i, s in enumerate(scores) if not (isinstance(s.value, float) and math.isnan(s.value))]
    metrics = {m.metric_name: m(kept) for m in score_fn.metrics}
    return scores, metrics, len(scores) - len(kept)
