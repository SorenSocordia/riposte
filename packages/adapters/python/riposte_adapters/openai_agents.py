"""OpenAI Agents SDK: ``@tool_input_guardrail`` (and ``needs_approval`` for an in-run hold).

Host contract (cited from source and docs, openai-agents 0.22.3, fetched 2026-09-28):
  - ``src/agents/tool_guardrails.py``: ``tool_input_guardrail(func=None, *, name=None)``; the guardrail function receives
    ``ToolInputGuardrailData`` (``.context: ToolContext``, ``.agent``) and returns ``ToolGuardrailFunctionOutput`` built with
    ``.allow(output_info)``, ``.reject_content(message, output_info)`` ("Reject the tool call/output but continue execution
    with a message to the model") or ``.raise_exception(output_info)`` ("Halt execution by raising a
    ToolGuardrailTripwireTriggered exception").
  - ``src/agents/tool_context.py``: ``ToolContext.tool_name``, ``.tool_call_id``, ``.tool_arguments`` ("The raw arguments
    string of the tool call").
  - ``docs/guardrails.md``: tool guardrails wrap FunctionTool instances only (not hosted tools, not handoffs); "If a function
    tool requires approval, input tool guardrails normally run after approval and immediately before execution."
  - ``docs/human_in_the_loop.md``: ``needs_approval`` may be "an async function that decides per call. The callable receives
    the run context, parsed tool parameters, and the tool call ID"; the run then pauses with an interruption a person
    approves or rejects.

Two ways to deliver a hold (use ONE per tool; see enforce=False to combine):
  1. ``riposte_needs_approval(checker, "tool_name")`` as the tool's ``needs_approval``: hold/review → the run pauses for a
     person (``state.approve`` / ``state.reject``). This is "held until a person resolves it", in-run.
  2. ``riposte_tool_input_guardrail(checker)`` in ``tool_input_guardrails``: hold/review → ``raise_exception`` (default: the
     run halts; nothing executes; the app hands ``exc.output.output_info`` to a person) or ``reject_content`` (the call is
     skipped and the model is told, with a no-retry note; a repeat gets a firmer refusal).
  Because guardrails run AFTER approval, a tool using (1) should carry the guardrail with ``enforce=False`` (record and
  annotate only), or a person's approval would be overridden.

surface → allow, with the notice in ``output_info`` and ``on_notice(check)`` (this API cannot message the model on allow).
record, proceed, pass-through → allow. A failed check → allow (fail open) and ``on_error``.
"""
from __future__ import annotations

import asyncio
import importlib
import json
from typing import Any, Callable, Optional

from .core import Check, Checker, HoldMemory, _warn, default_on_notice, hold_message, safe_check


def _agents() -> Any:
    return importlib.import_module("agents")


def riposte_tool_input_guardrail(
    checker: Checker,
    *,
    on_hold: str = "raise_exception",
    on_review: str = "raise_exception",
    enforce: bool = True,
    name: str = "riposte_hold",
    on_notice: Callable[[Check], None] = default_on_notice,
    on_error: Callable[[BaseException], None] = _warn,
    memory: Optional[HoldMemory] = None,
    agents_module: Any = None,
) -> Any:
    """A ``ToolInputGuardrail`` that delivers Riposte's disposition for each call of the tool it is attached to."""
    for v in (on_hold, on_review):
        if v not in ("raise_exception", "reject_content"):
            raise ValueError('on_hold / on_review must be "raise_exception" or "reject_content"')
    sdk = agents_module or _agents()
    out = sdk.ToolGuardrailFunctionOutput
    mem = memory or HoldMemory()

    def riposte_hold(data: Any) -> Any:
        ctx = data.context
        tool = str(getattr(ctx, "tool_name", ""))
        try:
            args = json.loads(getattr(ctx, "tool_arguments", None) or "{}")
            if not isinstance(args, dict):
                raise ValueError("tool arguments are not a JSON object")
        except ValueError as e:
            on_error(e)
            return out.allow(output_info={"riposte": "error", "error": str(e)})
        check = safe_check(checker, tool, args, on_error)
        if check is None:
            return out.allow(output_info={"riposte": "error"})
        info = check.info()
        if check.disposition in ("pass-through", "proceed"):
            return out.allow(output_info=info)
        on_notice(check)
        if check.disposition in ("record", "surface") or not enforce:
            return out.allow(output_info=info)
        behavior = on_hold if check.disposition == "hold" else on_review
        if behavior == "raise_exception":
            return out.raise_exception(output_info=info)
        repeat = mem.seen(check.call_hash) > 0
        mem.mark(check.call_hash)
        return out.reject_content(message=hold_message(check, repeat=repeat), output_info=info)

    return sdk.tool_input_guardrail(name=name)(riposte_hold)


def riposte_needs_approval(
    checker: Checker,
    tool_name: str,
    *,
    on_error: Callable[[BaseException], None] = _warn,
    on_notice: Callable[[Check], None] = default_on_notice,
) -> Callable[[Any, Any, Any], Any]:
    """An async ``needs_approval`` rule: True (pause for a person) exactly when Riposte's disposition is hold or review."""

    async def needs_approval(_ctx: Any, params: Any, _call_id: Any) -> bool:
        args = params if isinstance(params, dict) else {}
        check = await asyncio.to_thread(safe_check, checker, tool_name, args, on_error)
        if check is None:
            return False  # fail open: the SDK's own approval rules still apply
        if check.disposition not in ("pass-through", "proceed"):
            on_notice(check)
        return check.holds

    return needs_approval
