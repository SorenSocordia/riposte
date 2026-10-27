"""riposte_tool_input_guardrail / riposte_needs_approval against a fake ``agents`` module shaped like the cited SDK source.

The fake mirrors src/agents/tool_guardrails.py: ToolGuardrailFunctionOutput.allow / reject_content / raise_exception build
``behavior`` dicts {"type": ...}; tool_input_guardrail(name=...) returns a decorator producing an object whose
``guardrail_function`` is called with ToolInputGuardrailData (``.context.tool_name`` / ``.tool_arguments``).
"""
import asyncio
import json
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest

from conftest import FakeChecker, needs_engine
from riposte_adapters import NodeChecker, riposte_needs_approval, riposte_tool_input_guardrail


@dataclass
class TGFO:
    output_info: Any
    behavior: dict = field(default_factory=lambda: {"type": "allow"})

    @classmethod
    def allow(cls, output_info=None):
        return cls(output_info=output_info, behavior={"type": "allow"})

    @classmethod
    def reject_content(cls, message, output_info=None):
        return cls(output_info=output_info, behavior={"type": "reject_content", "message": message})

    @classmethod
    def raise_exception(cls, output_info=None):
        return cls(output_info=output_info, behavior={"type": "raise_exception"})


@dataclass
class FakeToolInputGuardrail:
    guardrail_function: Any
    name: str | None = None


def tool_input_guardrail(func=None, *, name=None):
    def decorator(f):
        return FakeToolInputGuardrail(guardrail_function=f, name=name or f.__name__)

    return decorator(func) if func is not None else decorator


SDK = SimpleNamespace(ToolGuardrailFunctionOutput=TGFO, tool_input_guardrail=tool_input_guardrail)


def data(tool="mcp__bank__transfer", args='{"to_account": "110-234-5678", "amount": 500}'):
    return SimpleNamespace(context=SimpleNamespace(tool_name=tool, tool_call_id="call_1", tool_arguments=args), agent=None)


def guard(checker, **kw):
    return riposte_tool_input_guardrail(checker, agents_module=SDK, on_notice=lambda c: None, **kw)


def test_it_is_a_named_tool_input_guardrail():
    g = guard(FakeChecker("hold"))
    assert isinstance(g, FakeToolInputGuardrail) and g.name == "riposte_hold"


@pytest.mark.parametrize("disposition", ["pass-through", "proceed", "record", "surface"])
def test_not_held_dispositions_allow(disposition):
    r = guard(FakeChecker(disposition)).guardrail_function(data())
    assert r.behavior == {"type": "allow"}
    if disposition != "pass-through":
        assert r.output_info["riposte"] == disposition


@pytest.mark.parametrize("disposition", ["hold", "review"])
def test_hold_and_review_halt_the_run_by_default(disposition):
    r = guard(FakeChecker(disposition)).guardrail_function(data())
    assert r.behavior == {"type": "raise_exception"}
    assert r.output_info["riposte"] == disposition and len(r.output_info["verdict_id"]) == 32


def test_reject_content_tells_the_model_and_never_loops():
    g = guard(FakeChecker("hold"), on_hold="reject_content")
    first = g.guardrail_function(data())
    second = g.guardrail_function(data())
    assert first.behavior["type"] == "reject_content" and "Do not retry it" in first.behavior["message"]
    assert second.behavior["message"].startswith("Already held once")


def test_enforce_false_never_blocks_for_use_alongside_needs_approval():
    for d in ("hold", "review"):
        assert guard(FakeChecker(d), enforce=False).guardrail_function(data()).behavior == {"type": "allow"}


def test_bad_arguments_and_a_check_error_take_the_safest_rung(monkeypatch):
    monkeypatch.delenv("RIPOSTE_ACTION_ON_ERROR", raising=False)
    errors = []
    g = riposte_tool_input_guardrail(FakeChecker("hold"), agents_module=SDK, on_error=errors.append)
    assert g.guardrail_function(data(args="not json")).behavior == {"type": "raise_exception"}  # a transfer: held
    assert g.guardrail_function(data(args="[1, 2]")).behavior == {"type": "raise_exception"}
    assert g.guardrail_function(data(tool="Read", args="not json")).behavior == {"type": "allow"}  # not consequential
    g2 = riposte_tool_input_guardrail(FakeChecker(error=RuntimeError("down")), agents_module=SDK, on_error=errors.append)
    r = g2.guardrail_function(data())
    assert r.behavior == {"type": "raise_exception"} and "governance degraded" in r.output_info["text"]
    assert g2.guardrail_function(data(tool="Read")).behavior == {"type": "allow"}
    assert len(errors) == 5
    monkeypatch.setenv("RIPOSTE_ACTION_ON_ERROR", "open")  # the opt-out: the old fail-open
    assert g2.guardrail_function(data()).behavior == {"type": "allow"}


def test_rejects_an_unknown_behavior():
    with pytest.raises(ValueError):
        guard(FakeChecker(), on_hold="shrug")


@pytest.mark.parametrize("disposition,want", [("hold", True), ("review", True), ("surface", False), ("record", False), ("proceed", False), ("pass-through", False)])
def test_needs_approval_pauses_exactly_on_hold_and_review(disposition, want):
    rule = riposte_needs_approval(FakeChecker(disposition), "mcp__bank__transfer", on_notice=lambda c: None)
    assert asyncio.run(rule(None, {"to_account": "x", "amount": 1}, "call_1")) is want


def test_needs_approval_on_a_failed_check_pauses_only_a_consequential_call(monkeypatch):
    monkeypatch.delenv("RIPOSTE_ACTION_ON_ERROR", raising=False)
    rule = riposte_needs_approval(FakeChecker(error=RuntimeError("down")), "t", on_error=lambda e: None)
    assert asyncio.run(rule(None, {}, "c")) is False
    held = riposte_needs_approval(FakeChecker(error=RuntimeError("down")), "mcp__bank__transfer", on_error=lambda e: None, on_notice=lambda c: None)
    assert asyncio.run(held(None, {}, "c")) is True


@needs_engine
def test_end_to_end_through_the_engine(policy_file):
    c = NodeChecker(policy_file("autonomy", {"to_account": ["220-000-1111"], "amount": [500]}))
    r = guard(c).guardrail_function(data())
    assert r.behavior == {"type": "raise_exception"} and r.output_info["outcome"] == "FAIL"
    assert "Held for a person" in r.output_info["text"]
    ok = guard(NodeChecker(policy_file("autonomy", {"to_account": ["110-234-5678"], "amount": [500]}))).guardrail_function(data())
    assert ok.behavior == {"type": "allow"} and ok.output_info["riposte"] == "proceed"
    assert asyncio.run(riposte_needs_approval(c, "mcp__bank__transfer", on_notice=lambda c: None)(None, json.loads(data().context.tool_arguments), "call_1")) is True
