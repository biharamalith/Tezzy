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
    "explore major app flows and detect potential UI/UX issues, especially Flutter overflow indicators.\n"
    "Always return strict JSON only."
)


_USER_PROMPT_TEMPLATE = (
    "Input:\n\n"
    "app_name: {app_name}\n"
    "platform: android\n"
    "max_steps: {max_steps}\n"
    "credentials: {email, password, optional_otp_note}\n"
    "home_markers: {list of text/resource-id patterns that indicate home}\n"
    "flow_hints: {optional list like profile, settings, checkout, history}\n"
    "constraints: {timeouts, action limits, no destructive actions}\n"
    "Return:\n\n"
    "run_goal\n"
    "mode (reach_home or explore)\n"
    "success_criteria\n"
    "stop_conditions\n"
    "risk_rules"
)


def build_phase_a_user_messages(payload: SessionBootstrapInput) -> list[str]:
    input_obj: Dict[str, Any] = {
        "app_name": payload.app_name,
        "platform": payload.platform,
        "max_steps": payload.max_steps,
        "credentials": payload.credentials.model_dump(),
        "home_markers": payload.home_markers,
        "flow_hints": payload.flow_hints or [],
        "constraints": payload.constraints,
    }
    return [json.dumps(input_obj, ensure_ascii=False), _USER_PROMPT_TEMPLATE]


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
