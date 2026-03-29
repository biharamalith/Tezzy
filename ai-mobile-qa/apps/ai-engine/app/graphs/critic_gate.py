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
    "You are Tezzy Critic. Validate the planner's proposed action before execution.\n"
    "If rejected, provide exactly one safer alternative action.\n\n"
    "REJECTION RULES — reject if ANY of the following are true:\n"
    "  (1) The action is tap_xy and the same coordinates appear in recent_actions more than twice.\n"
    "  (2) failure_streak > 3 and the action type is not 'back' or 'swipe'.\n"
    "  (3) seen_hash_counts for the current screen_hash is greater than 5 "
    "and the action does not navigate to a new screen (i.e. is not back, swipe, or a tab tap).\n"
    "  (4) The action type is 'wait_ms' or 'screenshot' (these are low-value and waste steps).\n\n"
    "SCENARIO CONSTRAINT RULES: If goal_constraints is provided:\n"
    "  (5) REJECT if proposed action type is in avoid_actions.\n"
    "  (6) REJECT if action would navigate away from required_screens before goal completion.\n"
    "  (7) REJECT if steps_taken >= max_steps for current goal.\n\n"
    "ALWAYS APPROVE: Never reject an 'input_text' action — form filling must always proceed.\n\n"
    "When rejecting, set decision='reject', explain in rejection_reason_or_null, "
    "and provide a concrete alternative in final_action (prefer back, swipe, or a different tap target).\n"
    "Return strict JSON only."
)


def build_phase_d_user_messages(payload: CriticGateInput) -> list[str]:
    proposed_str = json.dumps(payload.proposed_action, ensure_ascii=False)
    seen_str = json.dumps(payload.seen_hash_counts, ensure_ascii=False)
    recent_str = json.dumps(payload.recent_actions, ensure_ascii=False)

    prompt = (
        "Input:\n\n"
        f"proposed_action: {proposed_str}\n"
        f"screen_hash: {payload.screen_hash}\n"
        f"seen_hash_counts: {seen_str}\n"
        f"recent_actions: {recent_str}\n"
        f"failure_streak: {payload.failure_streak}\n"
        f"mode: {payload.mode}\n"
    )
    
    # Add goal constraints if provided
    if payload.goal_constraints:
        constraints_dict = {
            "avoid_actions": payload.goal_constraints.avoid_actions,
            "required_screens": payload.goal_constraints.required_screens,
            "max_steps": payload.goal_constraints.max_steps,
            "steps_taken": payload.goal_constraints.steps_taken,
        }
        constraints_str = json.dumps(constraints_dict, ensure_ascii=False)
        prompt += f"goal_constraints: {constraints_str}\n"
    
    prompt += (
        "Return:\n\n"
        "decision (approve or reject)\n"
        "final_action\n"
        "rejection_reason_or_null\n"
        "recovery_tag (loop_recovery, blocker_recovery, normal)"
    )
    return [prompt]


async def _phase_d_gate_action(state: CriticGateState) -> Dict[str, Any]:
    payload = state["input"]
    
    # Programmatic constraint validation (before LLM call for efficiency)
    if payload.goal_constraints:
        constraints = payload.goal_constraints
        proposed_action = payload.proposed_action
        action_type = proposed_action.get("type", "")
        
        # Check avoid_actions constraint
        if constraints.avoid_actions and action_type in constraints.avoid_actions:
            output = CriticGateOutput(
                decision="reject",
                final_action={"type": "wait_ms", "params": {"ms": 500}},
                rejection_reason_or_null=f"Goal constraint violation: action type '{action_type}' is in avoid_actions list",
                recovery_tag="normal"
            )
            return {"output": output}
        
        # Check max_steps constraint
        if constraints.max_steps is not None and constraints.steps_taken >= constraints.max_steps:
            output = CriticGateOutput(
                decision="reject",
                final_action={"type": "stop", "params": {}},
                rejection_reason_or_null=f"Goal constraint violation: max_steps ({constraints.max_steps}) reached (steps_taken: {constraints.steps_taken})",
                recovery_tag="normal"
            )
            return {"output": output}
        
        # Check required_screens constraint (reject navigation away actions)
        if constraints.required_screens:
            # Navigation actions that could leave required screens
            navigation_actions = ["back", "swipe"]
            if action_type in navigation_actions:
                output = CriticGateOutput(
                    decision="reject",
                    final_action={"type": "wait_ms", "params": {"ms": 500}},
                    rejection_reason_or_null=f"Goal constraint violation: action '{action_type}' would navigate away from required_screens before goal completion",
                    recovery_tag="normal"
                )
                return {"output": output}

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
