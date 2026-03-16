from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.llm.client import LLMClient
from app.llm.json_mode import ensure_keys_exact
from app.schemas.critic_gate import (
    PHASE_D_ACTION_ALLOWED_KEYS,
    PHASE_D_ALLOWED_KEYS,
    CriticGateInput,
    CriticGateOutput,
)


class CriticGateState(TypedDict):
    input: CriticGateInput
    output: CriticGateOutput


_SYSTEM_PROMPT = (
    "You are Tezzy Critic. Validate planner action before execution.\n"
    "Reject actions that are repetitive, unsafe, or unlikely to progress.\n"
    "If rejected, provide one safer alternative action.\n"
    "Return strict JSON only."
)


_USER_PROMPT_TEMPLATE = (
    "Input:\n\n"
    "proposed_action\n"
    "screen_hash\n"
    "seen_hash_counts\n"
    "recent_actions\n"
    "failure_streak\n"
    "mode\n"
    "Return:\n\n"
    "decision (approve or reject)\n"
    "final_action\n"
    "rejection_reason_or_null\n"
    "recovery_tag (loop_recovery, blocker_recovery, normal)"
)


def build_phase_d_user_prompt(payload: CriticGateInput) -> str:
    # Deprecated: kept for compatibility if referenced elsewhere.
    return _USER_PROMPT_TEMPLATE


def build_phase_d_user_messages(payload: CriticGateInput) -> list[str]:
    # Message 1: pure JSON input values (deterministic and machine-readable)
    input_obj = {
        "proposed_action": payload.proposed_action,
        "screen_hash": payload.screen_hash,
        "seen_hash_counts": payload.seen_hash_counts,
        "recent_actions": payload.recent_actions,
        "failure_streak": payload.failure_streak,
        "mode": payload.mode,
    }
    return [json.dumps(input_obj, ensure_ascii=False), _USER_PROMPT_TEMPLATE]


async def _phase_d_gate_action(state: CriticGateState) -> Dict[str, Any]:
    payload = state["input"]

    llm = LLMClient()
    user_messages = build_phase_d_user_messages(payload)
    raw = await llm.chat_json_messages(
        system_prompt=_SYSTEM_PROMPT,
        user_messages=user_messages,
        temperature=0.0,
    )

    ensure_keys_exact(raw, allowed_keys=PHASE_D_ALLOWED_KEYS)

    def _coerce_action_obj(value: Any, *, fallback: Dict[str, Any]) -> Dict[str, Any]:
        """Coerce various model shapes into the strict {type, params} action object."""
        if isinstance(value, dict) and "action" in value:
            return _coerce_action_obj(value.get("action"), fallback=fallback)
        if isinstance(value, dict) and "type" in value:
            a_type = value.get("type")
            params = value.get("params")
            if not isinstance(params, dict):
                params = {}
            if a_type in {"tap_xy", "input_text", "swipe", "back", "wait_ms", "screenshot", "stop"}:
                return {"type": a_type, "params": params}
        # fallback path
        fb_type = fallback.get("type")
        fb_params = fallback.get("params")
        if not isinstance(fb_params, dict):
            fb_params = {}
        if fb_type in {"tap_xy", "input_text", "swipe", "back", "wait_ms", "screenshot", "stop"}:
            return {"type": fb_type, "params": fb_params}
        return {"type": "wait_ms", "params": {"ms": 500}}

    proposed = payload.proposed_action if isinstance(payload.proposed_action, dict) else {}
    raw["final_action"] = _coerce_action_obj(raw.get("final_action"), fallback=proposed)
    ensure_keys_exact(raw["final_action"], allowed_keys=PHASE_D_ACTION_ALLOWED_KEYS)

    output = CriticGateOutput.model_validate(raw)
    return {"output": output}


def build_critic_gate_graph():
    graph = StateGraph(CriticGateState)
    graph.add_node("phase_d_gate", _phase_d_gate_action)
    graph.set_entry_point("phase_d_gate")
    graph.add_edge("phase_d_gate", END)
    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_critic_gate_graph():
    return build_critic_gate_graph()
