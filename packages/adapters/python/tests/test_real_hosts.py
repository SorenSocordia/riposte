"""Full runs against the REAL host libraries (skipped when they are not installed).

Verified 2026-09-28 with langchain 1.4.2 / langgraph 1.2.12 / langchain-core 1.6.5 and openai-agents 0.22.3 in a throwaway
venv. No network and no model API: each host gets a scripted fake model that proposes one `transfer` tool call, then
finishes. The decision always comes from the real engine (NodeChecker → riposte-action --check).
"""
import asyncio
import json

import pytest

from conftest import needs_engine
from riposte_adapters import NodeChecker, RiposteToolMiddleware, riposte_needs_approval, riposte_tool_input_guardrail

WRONG = {"to_account": ["220-000-1111"], "amount": [500]}
GROUNDED = {"to_account": ["110-234-5678"], "amount": [500]}
ARGS = {"to_account": "110-234-5678", "amount": 500}


# ── LangGraph / LangChain v1: create_agent + AgentMiddleware.wrap_tool_call + interrupt ─────────────────────────────────
def _lc_agent(policy, hold="interrupt"):
    pytest.importorskip("langchain.agents")
    from langchain.agents import create_agent
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.tools import tool
    from langgraph.checkpoint.memory import InMemorySaver

    sent = []

    @tool
    def transfer(to_account: str, amount: float) -> str:
        """Send money."""
        sent.append((to_account, amount))
        return f"sent {amount} to {to_account}"

    class ToolCallingFake(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # the fake has no tool binding; the script already names the tool
            return self

    model = ToolCallingFake(messages=iter([
        AIMessage(content="", tool_calls=[{"name": "transfer", "args": ARGS, "id": "call_1"}]),
        AIMessage(content="done"),
    ]))
    mw = RiposteToolMiddleware(NodeChecker(policy), hold=hold, on_notice=lambda c: None)
    agent = create_agent(model, tools=[transfer], middleware=[mw], checkpointer=InMemorySaver() if hold == "interrupt" else None)
    return agent, sent


@needs_engine
def test_langgraph_hold_pauses_the_run_and_a_decline_never_sends(policy_file):
    Command = pytest.importorskip("langgraph.types").Command

    agent, sent = _lc_agent(policy_file("gate", WRONG, tool="transfer"))
    cfg = {"configurable": {"thread_id": "t-decline"}}
    first = agent.invoke({"messages": [("user", "pay the invoice")]}, cfg)
    intr = first["__interrupt__"]
    assert len(intr) == 1 and intr[0].value["riposte"] == "hold" and sent == []
    assert "Held for a person: tool transfer, outcome FAIL" in intr[0].value["text"]
    final = agent.invoke(Command(resume={"type": "reject", "message": "not our vendor"}), cfg)
    tool_msgs = [m for m in final["messages"] if m.type == "tool"]
    assert sent == [] and tool_msgs[0].status == "error" and "not our vendor" in tool_msgs[0].content
    assert final["messages"][-1].content == "done"


@needs_engine
def test_langgraph_hold_approved_by_a_person_runs_once(policy_file):
    Command = pytest.importorskip("langgraph.types").Command

    agent, sent = _lc_agent(policy_file("gate", WRONG, tool="transfer"))
    cfg = {"configurable": {"thread_id": "t-approve"}}
    agent.invoke({"messages": [("user", "pay the invoice")]}, cfg)
    agent.invoke(Command(resume={"type": "approve"}), cfg)
    assert sent == [("110-234-5678", 500)]


@needs_engine
def test_langgraph_autonomy_pass_runs_without_a_pause(policy_file):
    agent, sent = _lc_agent(policy_file("autonomy", GROUNDED, tool="transfer"))
    out = agent.invoke({"messages": [("user", "pay")]}, {"configurable": {"thread_id": "t-pass"}})
    assert "__interrupt__" not in out and sent == [("110-234-5678", 500)]


@needs_engine
def test_langgraph_reject_strategy_needs_no_checkpointer(policy_file):
    agent, sent = _lc_agent(policy_file("autonomy", WRONG, tool="transfer"), hold="reject")
    out = agent.invoke({"messages": [("user", "pay")]})
    tool_msgs = [m for m in out["messages"] if m.type == "tool"]
    assert sent == [] and tool_msgs[0].status == "error" and "Do not retry it" in tool_msgs[0].content


# ── OpenAI Agents SDK: Runner + tool_input_guardrail / needs_approval ─────────────────────────────────────────────────
def _oa_setup():
    agents = pytest.importorskip("agents")
    from agents.items import ModelResponse
    from agents.models.interface import Model
    from agents.usage import Usage
    from openai.types.responses import ResponseFunctionToolCall, ResponseOutputMessage, ResponseOutputText

    agents.set_tracing_disabled(True)

    class ScriptedModel(Model):
        def __init__(self):
            self.turn = 0

        async def get_response(self, *a, **k):
            self.turn += 1
            if self.turn == 1:
                out = [ResponseFunctionToolCall(arguments=json.dumps(ARGS), call_id="call_1", name="transfer", type="function_call", id="fc_1", status="completed")]
            else:
                out = [ResponseOutputMessage(id="msg_1", content=[ResponseOutputText(text="done", type="output_text", annotations=[])], role="assistant", status="completed", type="message")]
            return ModelResponse(output=out, usage=Usage(), response_id=None)

        async def stream_response(self, *a, **k):  # pragma: no cover - not used
            raise NotImplementedError
            yield

    return agents, ScriptedModel


def _oa_agent(agents, model, **tool_kw):
    sent = []

    @agents.function_tool(**tool_kw)
    def transfer(to_account: str, amount: float) -> str:
        """Send money."""
        sent.append((to_account, amount))
        return f"sent {amount} to {to_account}"

    return agents.Agent(name="payer", instructions="pay", model=model, tools=[transfer]), sent


@needs_engine
def test_openai_guardrail_halts_a_held_call_before_it_runs(policy_file):
    agents, ScriptedModel = _oa_setup()
    g = riposte_tool_input_guardrail(NodeChecker(policy_file("autonomy", WRONG, tool="transfer")), on_notice=lambda c: None)
    agent, sent = _oa_agent(agents, ScriptedModel(), tool_input_guardrails=[g])
    with pytest.raises(agents.ToolInputGuardrailTripwireTriggered) as exc:
        asyncio.run(agents.Runner.run(agent, "pay the invoice"))
    assert sent == []
    info = exc.value.output.output_info
    assert info["riposte"] == "hold" and info["outcome"] == "FAIL" and "Held for a person" in info["text"]


@needs_engine
def test_openai_guardrail_reject_content_tells_the_model_and_the_run_continues(policy_file):
    agents, ScriptedModel = _oa_setup()
    g = riposte_tool_input_guardrail(NodeChecker(policy_file("gate", WRONG, tool="transfer")), on_hold="reject_content", on_notice=lambda c: None)
    agent, sent = _oa_agent(agents, ScriptedModel(), tool_input_guardrails=[g])
    result = asyncio.run(agents.Runner.run(agent, "pay the invoice"))
    assert sent == [] and result.final_output == "done"


@needs_engine
def test_openai_guardrail_lets_a_grounded_autonomy_call_run(policy_file):
    agents, ScriptedModel = _oa_setup()
    g = riposte_tool_input_guardrail(NodeChecker(policy_file("autonomy", GROUNDED, tool="transfer")), on_notice=lambda c: None)
    agent, sent = _oa_agent(agents, ScriptedModel(), tool_input_guardrails=[g])
    assert asyncio.run(agents.Runner.run(agent, "pay")).final_output == "done" and sent == [("110-234-5678", 500)]


@needs_engine
def test_openai_needs_approval_pauses_for_a_person_and_a_rejection_never_sends(policy_file):
    agents, ScriptedModel = _oa_setup()
    checker = NodeChecker(policy_file("gate", WRONG, tool="transfer"))
    model = ScriptedModel()
    agent, sent = _oa_agent(agents, model, needs_approval=riposte_needs_approval(checker, "transfer", on_notice=lambda c: None),
                            tool_input_guardrails=[riposte_tool_input_guardrail(checker, enforce=False, on_notice=lambda c: None)])

    async def go():
        first = await agents.Runner.run(agent, "pay the invoice")
        assert len(first.interruptions) == 1 and sent == []
        state = first.to_state()
        state.reject(first.interruptions[0])
        return await agents.Runner.run(agent, state)

    final = asyncio.run(go())
    assert sent == [] and final.final_output == "done"


@needs_engine
def test_openai_needs_approval_approved_runs_once_even_with_the_guardrail_attached(policy_file):
    agents, ScriptedModel = _oa_setup()
    checker = NodeChecker(policy_file("gate", WRONG, tool="transfer"))
    agent, sent = _oa_agent(agents, ScriptedModel(), needs_approval=riposte_needs_approval(checker, "transfer", on_notice=lambda c: None),
                            tool_input_guardrails=[riposte_tool_input_guardrail(checker, enforce=False, on_notice=lambda c: None)])

    async def go():
        first = await agents.Runner.run(agent, "pay the invoice")
        state = first.to_state()
        state.approve(first.interruptions[0])
        return await agents.Runner.run(agent, state)

    assert asyncio.run(go()).final_output == "done" and sent == [("110-234-5678", 500)]
