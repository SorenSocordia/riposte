"""RiposteToolMiddleware against fakes shaped like the cited LangGraph/LangChain v1 API.

``request.tool_call`` is a dict with name/args/id (langgraph/prebuilt/tool_node.py ToolCallRequest); the handler returns a
ToolMessage; ``interrupt(payload)`` returns the resume value. The fakes below mirror exactly those shapes.
"""
import asyncio
from types import SimpleNamespace

import pytest

from conftest import FakeChecker, needs_engine
from riposte_adapters import NodeChecker, RiposteToolMiddleware


class FakeToolMessage:
    def __init__(self, content, tool_call_id=None, name=None, status="success"):
        self.content, self.tool_call_id, self.name, self.status = content, tool_call_id, name, status

    def model_copy(self, update):
        d = {"content": self.content, "tool_call_id": self.tool_call_id, "name": self.name, "status": self.status}
        d.update(update)
        return FakeToolMessage(**d)


def request(name="mcp__bank__transfer", args=None, call_id="call_1"):
    return SimpleNamespace(tool_call={"name": name, "args": args if args is not None else {"to_account": "110-234-5678", "amount": 500}, "id": call_id})


class Handler:
    def __init__(self):
        self.calls = 0

    def __call__(self, req):
        self.calls += 1
        return FakeToolMessage("transfer sent", tool_call_id=req.tool_call["id"], name=req.tool_call["name"])


def mw(checker, resume=None, **kw):
    interrupts = []

    def interrupt(payload):
        interrupts.append(payload)
        return resume

    m = RiposteToolMiddleware(checker, interrupt_fn=interrupt, tool_message_cls=FakeToolMessage, on_notice=lambda c: None, **kw)
    return m, interrupts


@pytest.mark.parametrize("disposition", ["pass-through", "proceed", "record"])
def test_not_held_dispositions_run_the_tool_untouched(disposition):
    m, ints = mw(FakeChecker(disposition))
    h = Handler()
    out = m.wrap_tool_call(request(), h)
    assert h.calls == 1 and out.content == "transfer sent" and ints == []


def test_surface_runs_the_tool_and_tells_the_agent():
    notices = []
    m = RiposteToolMiddleware(FakeChecker("surface"), tool_message_cls=FakeToolMessage, on_notice=notices.append)
    h = Handler()
    out = m.wrap_tool_call(request(), h)
    assert h.calls == 1
    assert out.content.startswith("transfer sent") and "[riposte: surface, not held]" in out.content
    assert len(notices) == 1


def test_hold_interrupts_and_a_persons_approval_runs_it():
    m, ints = mw(FakeChecker("hold"), resume={"type": "approve"})
    h = Handler()
    out = m.wrap_tool_call(request(), h)
    assert h.calls == 1 and out.content == "transfer sent"
    assert ints[0]["riposte"] == "hold" and ints[0]["tool_call_id"] == "call_1" and "notice" in ints[0]["text"]


def test_hold_interrupt_declined_does_not_run_and_tells_the_agent_not_to_retry():
    m, ints = mw(FakeChecker("hold"), resume={"type": "reject", "message": "wrong vendor"})
    h = Handler()
    out = m.wrap_tool_call(request(), h)
    assert h.calls == 0
    assert out.status == "error" and out.tool_call_id == "call_1"
    assert "A person declined" in out.content and "wrong vendor" in out.content and "Do not retry it" in out.content


def test_never_loops_a_repeat_of_a_declined_call_is_refused_without_a_second_pause():
    m, ints = mw(FakeChecker("hold"), resume={"type": "reject"})
    h = Handler()
    m.wrap_tool_call(request(), h)
    out = m.wrap_tool_call(request(), h)
    assert len(ints) == 1 and h.calls == 0
    assert out.content.startswith("Already held once")


def test_review_at_gate_pauses_for_a_person_too():
    m, ints = mw(FakeChecker("review"), resume="approve")
    h = Handler()
    m.wrap_tool_call(request(), h)
    assert ints[0]["riposte"] == "review" and h.calls == 1


def test_hold_reject_strategy_short_circuits_without_a_checkpointer():
    m, ints = mw(FakeChecker("hold"), hold="reject")
    h = Handler()
    out = m.wrap_tool_call(request(), h)
    assert ints == [] and h.calls == 0 and out.status == "error"
    assert "it did not run" in out.content


def test_fails_open_when_the_check_errors():
    errors = []
    m = RiposteToolMiddleware(FakeChecker(error=RuntimeError("engine down")), on_error=errors.append, tool_message_cls=FakeToolMessage)
    h = Handler()
    assert m.wrap_tool_call(request(), h).content == "transfer sent"
    assert h.calls == 1 and str(errors[0]) == "engine down"


def test_async_hook_holds_and_proceeds():
    async def ahandler(req):
        return FakeToolMessage("ok", tool_call_id=req.tool_call["id"])

    m, _ = mw(FakeChecker("hold"), hold="reject")
    assert asyncio.run(m.awrap_tool_call(request(), ahandler)).status == "error"
    m2, _ = mw(FakeChecker("proceed"))
    assert asyncio.run(m2.awrap_tool_call(request(), ahandler)).content == "ok"


def test_rejects_an_unknown_hold_strategy():
    with pytest.raises(ValueError):
        RiposteToolMiddleware(FakeChecker(), hold="shrug")


@needs_engine
def test_end_to_end_through_the_engine(policy_file):
    m, ints = mw(NodeChecker(policy_file("gate", {"to_account": ["220-000-1111"], "amount": [500]})), resume={"type": "reject"})
    h = Handler()
    out = m.wrap_tool_call(request(), h)
    assert h.calls == 0 and out.status == "error"
    assert "Held for a person: tool mcp__bank__transfer, outcome FAIL" in ints[0]["text"]
    assert "arg.to_account" in out.content
    m2, ints2 = mw(NodeChecker(policy_file("autonomy", {"to_account": ["110-234-5678"], "amount": [500]})))
    assert m2.wrap_tool_call(request(), h).content == "transfer sent" and ints2 == []
