from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.graphs.critic_gate import get_critic_gate_graph
from app.graphs.issue_triage import get_issue_triage_graph
from app.graphs.planner import get_planner_graph
from app.graphs.screen_analyst import get_screen_analyst_graph
from app.schemas.critic_gate import CriticGateInput
from app.schemas.issue_triage import IssueTriageInput
from app.schemas.planner import AttemptCounters, PlannerInput, ScreenSize
from app.schemas.run_step import RunStepInput, RunStepOutput
from app.schemas.screen_understanding import MemorySnapshot, ScreenUnderstandingInput


class RunStepState(TypedDict, total=False):
    input: RunStepInput

    triage: Dict[str, Any] | None
    should_continue: bool
    findings: list[Dict[str, Any]]

    analysis: Dict[str, Any]
    plan: Dict[str, Any]
    critic: Dict[str, Any]
    next_action: Dict[str, Any]


def _screen_size_from_input(inp: RunStepInput) -> ScreenSize:
    raw = inp.screen_size or {}
    w = raw.get("w") if isinstance(raw, dict) else None
    h = raw.get("h") if isinstance(raw, dict) else None
    if w is None and isinstance(raw, dict):
        w = raw.get("width")
    if h is None and isinstance(raw, dict):
        h = raw.get("height")
    if not isinstance(w, int) or not isinstance(h, int) or w <= 0 or h <= 0:
        raise ValueError("screen_size must contain positive ints: {w,h} or {width,height}")
    return ScreenSize(w=w, h=h)


def _memory_snapshot_from_input(inp: RunStepInput) -> MemorySnapshot:
    return MemorySnapshot(
        seen_hash_counts=inp.seen_hash_counts,
        seen_element_keys=inp.seen_element_keys,
    )


async def _triage_previous_step(state: RunStepState) -> Dict[str, Any]:
    inp = state["input"]

    # Triage is meaningful only if we have any signals/vision/context.
    if not inp.runtime_signals and not inp.overflow_detection:
        return {"triage": None, "should_continue": True, "findings": inp.prior_findings}

    triage_graph = get_issue_triage_graph()
    triage_input = IssueTriageInput(
        runtime_signals=inp.runtime_signals,
        overflow_detection=inp.overflow_detection,
        step_context={
            "step": inp.step,
            "action": inp.last_action,
            "screen_hash": inp.screen_hash,
        },
        prior_findings=inp.prior_findings,
    )
    triage_res = await triage_graph.ainvoke({"input": triage_input})
    triage_out = triage_res["output"].model_dump()

    # prefer deduped_findings if present
    findings = triage_out.get("deduped_findings") or triage_out.get("new_findings") or inp.prior_findings
    should_continue = bool(triage_out.get("should_continue", True))

    return {"triage": triage_out, "should_continue": should_continue, "findings": findings}


async def _screen_understanding(state: RunStepState) -> Dict[str, Any]:
    inp = state["input"]
    graph = get_screen_analyst_graph()

    analysis_input = ScreenUnderstandingInput(
        step=inp.step,
        screen_hash=inp.screen_hash,
        ui_elements=inp.ui_elements,
        screenshot_summary=inp.screenshot_summary,
        last_action=None if inp.last_action is None else json.dumps(inp.last_action, ensure_ascii=False),
        last_result=inp.last_result,
        memory_snapshot=_memory_snapshot_from_input(inp),
    )

    res = await graph.ainvoke({"input": analysis_input})
    return {"analysis": res["output"].model_dump()}


async def _plan_next_action(state: RunStepState) -> Dict[str, Any]:
    inp = state["input"]
    analysis = state.get("analysis") or {}

    graph = get_planner_graph()
    screen_size = _screen_size_from_input(inp)
    attempt_counters = AttemptCounters(loop_count=inp.loop_count, no_element_count=inp.no_element_count)
    plan_input = PlannerInput(
        mode=inp.mode,
        analysis=analysis,
        memory_snapshot={
            "seen_hash_counts": inp.seen_hash_counts,
            "seen_element_keys": inp.seen_element_keys,
            "recent_actions": inp.recent_actions[-10:],
        },
        screen_size=screen_size,
        credentials=inp.credentials,
        attempt_counters=attempt_counters,
    )
    res = await graph.ainvoke({"input": plan_input})
    return {"plan": res["output"].model_dump()}


async def _critic_gate(state: RunStepState) -> Dict[str, Any]:
    inp = state["input"]
    plan = state.get("plan") or {}
    proposed_action = plan.get("action") or {}

    graph = get_critic_gate_graph()
    gate_input = CriticGateInput(
        proposed_action=proposed_action,
        screen_hash=inp.screen_hash,
        seen_hash_counts=inp.seen_hash_counts,
        recent_actions=inp.recent_actions[-10:],
        failure_streak=inp.failure_streak,
        mode=inp.mode,
    )
    res = await graph.ainvoke({"input": gate_input})
    critic = res["output"].model_dump()

    next_action = critic.get("final_action") or proposed_action
    return {"critic": critic, "next_action": next_action}


def build_run_step_graph():
    graph = StateGraph(RunStepState)

    # Execution order per the spec (excluding external execution + overflow vision):
    # Issue Triage -> Screen Understanding -> Planner -> Critic
    graph.add_node("triage", _triage_previous_step)
    graph.add_node("analyze", _screen_understanding)
    graph.add_node("plan", _plan_next_action)
    graph.add_node("critic", _critic_gate)

    graph.set_entry_point("triage")
    graph.add_edge("triage", "analyze")
    graph.add_edge("analyze", "plan")
    graph.add_edge("plan", "critic")
    graph.add_edge("critic", END)

    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_run_step_graph():
    return build_run_step_graph()


def assemble_run_step_output(state: Dict[str, Any]) -> RunStepOutput:
    should_continue = bool(state.get("should_continue", True))
    return RunStepOutput(
        triage=state.get("triage"),
        analysis=state.get("analysis") or {},
        plan=state.get("plan") or {},
        critic=state.get("critic") or {},
        next_action=state.get("next_action") or {},
        should_continue=should_continue,
    )
