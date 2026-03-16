from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.llm.client import LLMClient
from app.llm.json_mode import ensure_keys_exact
from app.schemas.planner import (
    PHASE_C_ACTION_ALLOWED_KEYS,
    PHASE_C_ALLOWED_KEYS,
    PlannerInput,
    PlannerOutput,
)


class PlannerState(TypedDict):
    input: PlannerInput
    output: PlannerOutput


_SYSTEM_PROMPT = (
    "You are Tezzy Planner. Propose exactly one next action.\n"
    "Priority:\n"
    "Expand coverage across unvisited flows by interacting with visible elements.\n"
    "Prefer tapping visible buttons, tabs, drawer/menu entries, and list items before using swipe.\n"
    "Do not output more than one swipe in a row unless no actionable element is visible.\n"
    "Do not repeat low-value actions. Respect safety constraints.\n"
    "Return strict JSON only."
)


_USER_PROMPT_TEMPLATE = (
    "Input:\n\n"
    "mode: {reach_home or explore}\n"
    "analysis: {output from Phase B}\n"
    "memory_snapshot: {seen hashes and targets}\n"
    "screen_size: {w, h}\n"
    "credentials: {email/password or null}\n"
    "attempt_counters: {loop_count, no_element_count}\n"
    "Rules: tap-first exploration, avoid consecutive swipes, use swipe only to reveal new controls.\n"
    "Return:\n\n"
    "action.type (tap_xy, input_text, swipe, back, wait_ms, screenshot, stop)\n"
    "action.params\n"
    "intent\n"
    "expected_outcome\n"
    "fallback_if_fail"
)


def build_phase_c_user_messages(payload: PlannerInput) -> list[str]:
    input_obj = {
        "mode": payload.mode,
        "analysis": payload.analysis,
        "memory_snapshot": payload.memory_snapshot,
        "screen_size": payload.screen_size.model_dump(),
        "credentials": payload.credentials,
        "attempt_counters": payload.attempt_counters.model_dump(),
    }
    return [json.dumps(input_obj, ensure_ascii=False), _USER_PROMPT_TEMPLATE]


async def _phase_c_plan_one_action(state: PlannerState) -> Dict[str, Any]:
    payload = state["input"]

    llm = LLMClient()
    user_messages = build_phase_c_user_messages(payload)
    raw = await llm.chat_json_messages(
        system_prompt=_SYSTEM_PROMPT,
        user_messages=user_messages,
        temperature=0.0,
    )

    ensure_keys_exact(raw, allowed_keys=PHASE_C_ALLOWED_KEYS)

    action_obj = raw.get("action")
    if not isinstance(action_obj, dict):
        raise ValueError("Expected 'action' to be an object")
    ensure_keys_exact(action_obj, allowed_keys=PHASE_C_ACTION_ALLOWED_KEYS)

    # The prompt contract expects a string, but models sometimes return a structured
    # object (e.g., {"action": {...}, "note": "..."}). Normalize to a string so the
    # API stays stable.
    fallback = raw.get("fallback_if_fail")
    if isinstance(fallback, dict):
        note = fallback.get("note") or fallback.get("reason") or ""
        action = fallback.get("action")
        if action is not None:
            action_str = json.dumps(action, ensure_ascii=False)
            raw["fallback_if_fail"] = (f"{note} Fallback action: {action_str}").strip()
        else:
            raw["fallback_if_fail"] = str(note).strip() or json.dumps(fallback, ensure_ascii=False)
    elif fallback is None:
        raw["fallback_if_fail"] = ""
    elif not isinstance(fallback, str):
        raw["fallback_if_fail"] = str(fallback)

    output = PlannerOutput.model_validate(raw)
    return {"output": output}


def build_planner_graph():
    graph = StateGraph(PlannerState)
    graph.add_node("phase_c_plan", _phase_c_plan_one_action)
    graph.set_entry_point("phase_c_plan")
    graph.add_edge("phase_c_plan", END)
    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_planner_graph():
    return build_planner_graph()
