from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.llm.client import LLMClient
from app.llm.json_mode import ensure_keys_exact
from app.schemas.session_bootstrap import (
    PHASE_A_ALLOWED_KEYS,
    SessionBootstrapInput,
    SessionBootstrapOutput,
)


class SessionManagerState(TypedDict):
    input: SessionBootstrapInput
    output: SessionBootstrapOutput


_SYSTEM_PROMPT = (
    "You are Tezzy Session Manager. Your job is to initialize one mobile QA run.\n"
    "You must produce a clear run plan with two objectives:\n"
    "reach home screen from current screen,\n"
    "explore major app flows and detect potential UI/UX issues, especially Flutter overflow indicators.\n\n"
    "SCENARIO MODE: If a scenario is provided, extract:\n"
    "- credentials from scenario.credentials\n"
    "- home_markers from first goal's expected_screens\n"
    "- flow_hints from all goals' descriptions\n"
    "- Set mode to 'reach_home' if first goal type is 'login', otherwise 'explore'\n"
    "- Set run_goal to: 'Execute scenario: {scenario.name} - {scenario.description}'\n\n"
    "MODE SELECTION RULE: If the current screen does not match any string in home_markers "
    "(i.e. none of the home_markers appear in the visible UI element text or resource IDs), "
    "set mode to 'reach_home'. Otherwise set mode to 'explore'.\n\n"
    "HOME SCREEN DEFINITION: A screen is the home screen when at least one home_markers string "
    "is present in the visible UI. Do not assume the first screen is home.\n\n"
    "FLOW HINTS RULE: For each entry in flow_hints, add a corresponding item to success_criteria "
    "describing the specific flow to test (e.g. 'Navigate to Settings and verify all options are visible'). "
    "If flow_hints is empty, derive success_criteria from common app flows (login, browse, detail view).\n\n"
    "Always return strict JSON only."
)


def build_phase_a_user_messages(payload: SessionBootstrapInput) -> list[str]:
    # Extract scenario context if provided
    if payload.scenario:
        scenario = payload.scenario
        
        # Extract credentials from scenario
        if scenario.credentials:
            credentials_str = json.dumps({
                "email": scenario.credentials.email,
                "password": scenario.credentials.password,
                "optional_otp_note": None
            }, ensure_ascii=False)
        else:
            credentials_str = json.dumps(payload.credentials.model_dump(), ensure_ascii=False)
        
        # Extract home_markers from first goal's expected_screens (if present)
        home_markers = []
        if scenario.goals and scenario.goals[0].hints and scenario.goals[0].hints.expected_screens:
            home_markers = scenario.goals[0].hints.expected_screens
        else:
            home_markers = payload.home_markers
        home_markers_str = json.dumps(home_markers, ensure_ascii=False)
        
        # Extract flow_hints from all goals' descriptions
        flow_hints = [goal.description for goal in scenario.goals]
        flow_hints_str = json.dumps(flow_hints, ensure_ascii=False)
        
        # Set run_goal based on scenario
        run_goal_hint = f"Execute scenario: {scenario.name} - {scenario.description}"
        
        # Determine initial mode based on first goal type
        first_goal_type = scenario.goals[0].type if scenario.goals else "custom"
        mode_hint = "reach_home" if first_goal_type == "login" else "explore"
        
        prompt = (
            "Input:\n\n"
            f"app_name: {payload.app_name}\n"
            f"platform: {payload.platform}\n"
            f"max_steps: {payload.max_steps}\n"
            f"credentials: {credentials_str}\n"
            f"home_markers: {home_markers_str}\n"
            f"flow_hints: {flow_hints_str}\n"
            f"constraints: {json.dumps(payload.constraints, ensure_ascii=False)}\n\n"
            f"SCENARIO MODE: This is a scenario-based run.\n"
            f"Scenario: {scenario.name}\n"
            f"Description: {scenario.description}\n"
            f"First goal type: {first_goal_type}\n"
            f"Suggested mode: {mode_hint}\n"
            f"Suggested run_goal: {run_goal_hint}\n\n"
            "Return:\n\n"
            "run_goal\n"
            "mode (reach_home or explore)\n"
            "success_criteria\n"
            "stop_conditions\n"
            "risk_rules"
        )
    else:
        # Autonomous mode (no scenario)
        credentials_str = json.dumps(payload.credentials.model_dump(), ensure_ascii=False)
        home_markers_str = json.dumps(payload.home_markers, ensure_ascii=False)
        flow_hints_str = json.dumps(payload.flow_hints or [], ensure_ascii=False)
        constraints_str = json.dumps(payload.constraints, ensure_ascii=False)

        prompt = (
            "Input:\n\n"
            f"app_name: {payload.app_name}\n"
            f"platform: {payload.platform}\n"
            f"max_steps: {payload.max_steps}\n"
            f"credentials: {credentials_str}\n"
            f"home_markers: {home_markers_str}\n"
            f"flow_hints: {flow_hints_str}\n"
            f"constraints: {constraints_str}\n"
            "Return:\n\n"
            "run_goal\n"
            "mode (reach_home or explore)\n"
            "success_criteria\n"
            "stop_conditions\n"
            "risk_rules"
        )
    
    return [prompt]


async def _phase_a_session_bootstrap(state: SessionManagerState) -> Dict[str, Any]:
    payload = state["input"]

    llm = LLMClient()
    user_messages = build_phase_a_user_messages(payload)
    raw = await llm.chat_json_messages(
        system_prompt=_SYSTEM_PROMPT,
        user_messages=user_messages,
        temperature=0.0,
    )

    ensure_keys_exact(raw, allowed_keys=PHASE_A_ALLOWED_KEYS)
    output = SessionBootstrapOutput.model_validate(raw)
    return {"output": output}


def build_session_manager_graph():
    graph = StateGraph(SessionManagerState)
    graph.add_node("phase_a_bootstrap", _phase_a_session_bootstrap)
    graph.set_entry_point("phase_a_bootstrap")
    graph.add_edge("phase_a_bootstrap", END)
    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_session_manager_graph():
    return build_session_manager_graph()
