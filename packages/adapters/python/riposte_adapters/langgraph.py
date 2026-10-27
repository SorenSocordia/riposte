"""LangGraph / LangChain v1 agents: ``AgentMiddleware.wrap_tool_call``.

Host contract (cited from source, fetched 2026-09-28):
  - ``langchain/agents/middleware/types.py`` (langchain 1.4.2): ``AgentMiddleware.wrap_tool_call(self, request:
    ToolCallRequest, handler: Callable[[ToolCallRequest], ToolMessage | Command]) -> ToolMessage | Command`` and the async
    ``awrap_tool_call``. The custom-middleware docs: "You decide if the handler is called zero times (short-circuit),
    once (normal flow), or multiple times (retry logic)."
  - ``langgraph/prebuilt/tool_node.py``: ``ToolCallRequest.tool_call`` is the "Tool call dict with name, args, and id".
  - LangGraph interrupts docs: ``interrupt(value)`` pauses the graph (a checkpointer is required); ``Command(resume=...)``
    becomes interrupt's return value, and "the node restarts from the beginning of the node where the interrupt was called".

Delivery of the disposition:
  hold / review  → ``hold="interrupt"`` (default): ``langgraph.types.interrupt(payload)`` pauses the run: the call is
                   literally "held until a person resolves it". Resume with ``Command(resume={"type": "approve"})`` to run it,
                   anything else to decline it (the agent gets an error ToolMessage with the facts and a no-retry note).
                   ``hold="reject"``: no pause; the call is short-circuited with that error ToolMessage (for graphs without a
                   checkpointer). A repeat of an identical held call gets a firm refusal instead of a second pause.
  surface        → the tool runs; ``on_notice(check)`` is called and, with ``surface_to_agent``, the notice is appended to a
                   string ToolMessage's content so the agent sees it in-flow.
  record, proceed, pass-through → the handler runs untouched (record also calls ``on_notice``).
  a failed check → the safest rung (core.safe_check): a consequential call is refused at once with the degraded check's
                   text (no interrupt: it is held until the setup is fixed, not until a person approves it); any other
                   call runs. ``on_error`` is called either way.
"""
from __future__ import annotations

import asyncio
from typing import Any, Callable, Mapping, Optional

from .core import Check, Checker, HoldMemory, default_on_notice, hold_message, safe_check, _warn

try:  # the real base class when LangChain v1 is installed; a plain object otherwise (the adapter is duck-typed)
    from langchain.agents.middleware import AgentMiddleware as _Base  # type: ignore
except Exception:  # noqa: BLE001
    _Base = object  # type: ignore[assignment,misc]


def _approved(decision: Any) -> bool:
    if decision is True:
        return True
    if isinstance(decision, str):
        return decision.lower() == "approve"
    if isinstance(decision, Mapping):
        return str(decision.get("type", "")).lower() == "approve"
    return False


class RiposteToolMiddleware(_Base):  # type: ignore[misc,valid-type]
    """Riposte's hold adapter for LangChain v1 ``create_agent(..., middleware=[RiposteToolMiddleware(checker)])``."""

    def __init__(
        self,
        checker: Checker,
        *,
        hold: str = "interrupt",
        surface_to_agent: bool = True,
        on_notice: Callable[[Check], None] = default_on_notice,
        on_error: Callable[[BaseException], None] = _warn,
        memory: Optional[HoldMemory] = None,
        interrupt_fn: Optional[Callable[[Any], Any]] = None,
        tool_message_cls: Optional[type] = None,
    ) -> None:
        if hold not in ("interrupt", "reject"):
            raise ValueError('hold must be "interrupt" or "reject"')
        self.checker = checker
        self.hold = hold
        self.surface_to_agent = surface_to_agent
        self.on_notice = on_notice
        self.on_error = on_error
        self.memory = memory or HoldMemory()
        self._interrupt = interrupt_fn
        self._tool_message_cls = tool_message_cls

    # ── host plumbing (lazy, injectable for tests) ─────────────────────────────────────────────────────────────────
    def _interrupt_fn(self) -> Callable[[Any], Any]:
        if self._interrupt is None:
            from langgraph.types import interrupt  # type: ignore

            self._interrupt = interrupt
        return self._interrupt

    def _tm(self) -> type:
        if self._tool_message_cls is None:
            from langchain_core.messages import ToolMessage  # type: ignore

            self._tool_message_cls = ToolMessage
        return self._tool_message_cls

    @staticmethod
    def _call(request: Any) -> tuple[str, Mapping[str, Any], Optional[str]]:
        tc = request.tool_call
        return str(tc.get("name", "")), dict(tc.get("args") or {}), tc.get("id")

    def _refusal(self, check: Check, call_id: Optional[str], name: str, text: str) -> Any:
        return self._tm()(content=text, tool_call_id=call_id, name=name, status="error")

    def _annotate(self, result: Any, check: Check) -> Any:
        if not self.surface_to_agent or not isinstance(getattr(result, "content", None), str):
            return result
        content = f"{result.content}\n\n[riposte: {check.disposition}, not held]\n{check.text}"
        try:
            return result.model_copy(update={"content": content})
        except Exception:  # noqa: BLE001 - never let the annotation break the tool result
            return result

    def _payload(self, check: Check, call_id: Optional[str]) -> dict:
        return {
            "riposte": check.disposition,
            "tool": check.tool,
            "tool_call_id": call_id,
            "verdict_id": check.verdict_id,
            "facts_hash": check.facts_hash,
            "text": check.text,
            "resume": {"approve": {"type": "approve"}, "decline": {"type": "reject", "message": "why (optional)"}},
        }

    def _decide(self, request: Any) -> tuple[Optional[Check], str, Optional[str]]:
        name, args, call_id = self._call(request)
        return safe_check(self.checker, name, args, self.on_error), name, call_id

    def _held(self, check: Check, name: str, call_id: Optional[str]) -> tuple[bool, Any]:
        """(run_it, refusal_or_None) for a hold/review disposition."""
        if check.degraded:  # the check could not run: held until the setup is fixed, not for a person's approval
            return False, self._refusal(check, call_id, name, check.text)
        key = check.call_hash
        if self.memory.seen(key) > 0:
            return False, self._refusal(check, call_id, name, hold_message(check, repeat=True))
        if self.hold == "interrupt":
            decision = self._interrupt_fn()(self._payload(check, call_id))
            if _approved(decision):
                return True, None
            self.memory.mark(key)
            reason = decision.get("message") if isinstance(decision, Mapping) else None
            return False, self._refusal(check, call_id, name, hold_message(check, repeat=False, rejected_by_person=True, reason=reason))
        self.memory.mark(key)
        return False, self._refusal(check, call_id, name, hold_message(check, repeat=False))

    # ── AgentMiddleware hooks ─────────────────────────────────────────────────────────────────────────────────────
    def wrap_tool_call(self, request: Any, handler: Callable[[Any], Any]) -> Any:
        check, name, call_id = self._decide(request)
        if check is None or check.disposition in ("pass-through", "proceed"):
            return handler(request)
        if check.disposition == "record":
            self.on_notice(check)
            return handler(request)
        if check.disposition == "surface":
            self.on_notice(check)
            return self._annotate(handler(request), check)
        self.on_notice(check)
        run, refusal = self._held(check, name, call_id)
        return handler(request) if run else refusal

    async def awrap_tool_call(self, request: Any, handler: Callable[[Any], Any]) -> Any:
        name, args, call_id = self._call(request)
        check = await asyncio.to_thread(safe_check, self.checker, name, args, self.on_error)
        if check is None or check.disposition in ("pass-through", "proceed"):
            return await handler(request)
        self.on_notice(check)
        if check.disposition == "record":
            return await handler(request)
        if check.disposition == "surface":
            return self._annotate(await handler(request), check)
        run, refusal = self._held(check, name, call_id)
        return (await handler(request)) if run else refusal
