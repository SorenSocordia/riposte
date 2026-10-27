"""Riposte hold adapters for Python agent hosts (LangGraph / LangChain v1, OpenAI Agents SDK), and the Inspect scorer
(``riposte_adapters.inspect_scorer``, imported only when you import it).

The engine decides (``riposte-action --check``); these adapters deliver: record and advise SURFACE a FAIL or INSUFFICIENT_DATA, gate
and autonomy HOLD it until a person resolves it. No host library is imported until an adapter needs it.
"""
from .core import DISPOSITIONS, NO_RETRY, Check, Checker, HoldMemory, NodeChecker, RiposteError, default_cli, hold_message, safe_check
from .core import CONSEQUENTIAL_WORDS, classify_call, degraded_check
from .langgraph import RiposteToolMiddleware
from .openai_agents import riposte_needs_approval, riposte_tool_input_guardrail
from .scoring import NodeScorer, default_score_cli, inspect_fields, load_ruleset

__all__ = [
    "DISPOSITIONS", "NO_RETRY", "Check", "Checker", "HoldMemory", "NodeChecker", "RiposteError", "default_cli", "hold_message",
    "safe_check", "CONSEQUENTIAL_WORDS", "classify_call", "degraded_check", "RiposteToolMiddleware", "riposte_needs_approval", "riposte_tool_input_guardrail",
    "NodeScorer", "default_score_cli", "inspect_fields", "load_ruleset",
]
__version__ = "0.0.1"
