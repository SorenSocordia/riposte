"""Riposte hold adapters for Python agent hosts (LangGraph / LangChain v1, OpenAI Agents SDK).

The engine decides (``riposte-action --check``); these adapters deliver: record and advise SURFACE a FAIL or ABSTAIN, gate
and autonomy HOLD it until a person resolves it. No host library is imported until an adapter needs it.
"""
from .core import DISPOSITIONS, NO_RETRY, Check, Checker, HoldMemory, NodeChecker, RiposteError, default_cli, hold_message, safe_check
from .langgraph import RiposteToolMiddleware
from .openai_agents import riposte_needs_approval, riposte_tool_input_guardrail

__all__ = [
    "DISPOSITIONS", "NO_RETRY", "Check", "Checker", "HoldMemory", "NodeChecker", "RiposteError", "default_cli", "hold_message",
    "safe_check", "RiposteToolMiddleware", "riposte_needs_approval", "riposte_tool_input_guardrail",
]
__version__ = "0.0.1"
