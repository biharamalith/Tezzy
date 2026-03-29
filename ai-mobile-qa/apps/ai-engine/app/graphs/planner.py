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
    "You are Tezzy Planner. Propose exactly one next action.\n\n"
    "CREDENTIALS & LOGIN RULE: If credentials is not null and analysis.screen_type is 'login', "
    "follow login_step strictly:\n"
    "  login_step=0 → use input_text to fill the email/username field with credentials.email.\n"
    "  login_step=1 → use input_text to fill the password field with credentials.password.\n"
    "  login_step=2 → tap the login/submit button.\n"
    "  login_step=3 → login submitted; do NOT interact with the login screen again.\n"
    "Do NOT skip steps or explore other elements until login_step reaches 3.\n\n"
    "FORM FILLING RULE: If analysis.candidate_targets contains any entry prefixed with 'fill:', "
    "you MUST use input_text to fill that field BEFORE tapping any button. "
    "Fill all unfilled form fields before submitting.\n\n"
    "ONBOARDING SCREEN RULE: If analysis.screen_type is 'onboarding', "
    "you MUST tap a navigation button by its exact position from candidate_targets. "
    "Look for elements with text 'Next', 'Skip', 'Continue', or 'Get Started' in ui_elements and use their exact center_x/center_y coordinates. "
    "Do NOT tap the center of the screen or any random coordinate. "
    "Do NOT use 'back' on an onboarding screen — it will exit the app entirely.\n\n"
    "MODE SWITCH RULE: If mode is 'reach_home' and analysis.screen_type is 'home', "
    "switch mode to 'explore' in your intent. Do not navigate back to home.\n\n"
    "STUCK SCREEN RULE: If memory_snapshot.seen_hash_counts for the current screen_hash is greater than 3, "
    "you MUST navigate away. Do NOT tap any element on this screen. "
    "Choose one: tap a bottom tab, tap the menu/drawer icon, or use the back action.\n\n"
    "SCREEN COMPLETION RULE: If memory_snapshot.completed_screens contains the current screen_hash, "
    "navigate away immediately using a tab, drawer, or back action.\n\n"
    "Expand coverage across unvisited flows by interacting with visible elements.\n"
    "Prefer tapping visible buttons, tabs, drawer/menu entries, and list items before using swipe.\n"
    "Do not output more than one swipe in a row unless no actionable element is visible.\n"
    "Do not repeat low-value actions. Respect safety constraints.\n"
    "Return strict JSON only."
)


def build_phase_c_user_messages(payload: PlannerInput) -> list[str]:
    analysis_str = json.dumps(payload.analysis, ensure_ascii=False)
    memory_str = json.dumps(payload.memory_snapshot, ensure_ascii=False)
    screen_size_str = json.dumps(payload.screen_size.model_dump(), ensure_ascii=False)
    credentials_str = json.dumps(payload.credentials, ensure_ascii=False)
    counters_str = json.dumps(payload.attempt_counters.model_dump(), ensure_ascii=False)

    prompt_parts = [
        "Input:\n\n"
        f"mode: {payload.mode}\n"
        f"login_step: {payload.login_step}\n"
        f"analysis: {analysis_str}\n"
        f"memory_snapshot: {memory_str}\n"
        f"screen_size: {screen_size_str}\n"
        f"credentials: {credentials_str}\n"
        f"attempt_counters: {counters_str}\n"
    ]

    # Add goal context if provided
    if payload.current_goal is not None:
        goal_dict = payload.current_goal.model_dump()
        goal_str = json.dumps(goal_dict, ensure_ascii=False)
        prompt_parts.append(f"current_goal: {goal_str}\n")
        
        if payload.goal_progress is not None:
            progress_dict = payload.goal_progress.model_dump()
            progress_str = json.dumps(progress_dict, ensure_ascii=False)
            prompt_parts.append(f"goal_progress: {progress_str}\n")
        
        # Add goal-specific guidance
        prompt_parts.append("\n=== GOAL-DIRECTED MODE ===\n")
        prompt_parts.append(f"Your action MUST advance toward the current goal: {payload.current_goal.description}\n\n")
        
        # Show pending success criteria
        if payload.goal_progress and payload.goal_progress.criteria_pending:
            prompt_parts.append("Success criteria still pending:\n")
            for criterion in payload.goal_progress.criteria_pending:
                prompt_parts.append(f"  - {criterion}\n")
            prompt_parts.append("\n")
        
        # Show met criteria
        if payload.goal_progress and payload.goal_progress.criteria_met:
            prompt_parts.append("Success criteria already met:\n")
            for criterion in payload.goal_progress.criteria_met:
                prompt_parts.append(f"  ✓ {criterion}\n")
            prompt_parts.append("\n")
        
        # Add goal type-specific rules
        goal_type = payload.current_goal.type
        
        if goal_type == "login":
            prompt_parts.append("GOAL TYPE: LOGIN\n")
            prompt_parts.append("- Follow the LOGIN SCREEN RULE strictly (use login_step)\n")
            prompt_parts.append("- Fill email, then password, then tap login button\n")
            prompt_parts.append("- Do NOT explore other elements until login completes\n\n")
        
        elif goal_type == "form_fill":
            prompt_parts.append("GOAL TYPE: FORM_FILL\n")
            if payload.current_goal.form_data:
                prompt_parts.append("- Fill ALL form fields before tapping submit\n")
                prompt_parts.append("- Form data to fill:\n")
                for field_name, field_value in payload.current_goal.form_data.items():
                    prompt_parts.append(f"    {field_name}: {field_value}\n")
                prompt_parts.append("- Prioritize input_text actions for unfilled fields\n")
                prompt_parts.append("- Only tap submit after all fields are filled\n\n")
        
        elif goal_type == "navigate":
            prompt_parts.append("GOAL TYPE: NAVIGATE\n")
            if payload.current_goal.hints and payload.current_goal.hints.expected_screens:
                prompt_parts.append("- Navigate toward these screens:\n")
                for screen in payload.current_goal.hints.expected_screens:
                    prompt_parts.append(f"    - {screen}\n")
            prompt_parts.append("- Prioritize actions that move toward the target screen\n")
            if payload.current_goal.hints and payload.current_goal.hints.required_actions:
                prompt_parts.append("- Suggested actions:\n")
                for action in payload.current_goal.hints.required_actions:
                    prompt_parts.append(f"    - {action}\n")
            prompt_parts.append("\n")
        
        elif goal_type == "verify":
            prompt_parts.append("GOAL TYPE: VERIFY\n")
            prompt_parts.append("- Prioritize actions that reveal UI elements for validation\n")
            prompt_parts.append("- Avoid navigating away until all criteria are checked\n")
            prompt_parts.append("- Use scroll/swipe to reveal hidden elements if needed\n\n")
        
        elif goal_type == "explore_section":
            prompt_parts.append("GOAL TYPE: EXPLORE_SECTION\n")
            if payload.current_goal.hints and payload.current_goal.hints.avoid_actions:
                prompt_parts.append("- AVOID these action types:\n")
                for action in payload.current_goal.hints.avoid_actions:
                    prompt_parts.append(f"    - {action}\n")
            prompt_parts.append("- Stay within the current section\n")
            prompt_parts.append("- Explore visible elements but respect boundaries\n\n")
        
        # Add hints if provided
        if payload.current_goal.hints:
            if payload.current_goal.hints.expected_screens:
                prompt_parts.append(f"Expected screens: {', '.join(payload.current_goal.hints.expected_screens)}\n")
            if payload.current_goal.hints.required_actions:
                prompt_parts.append(f"Required actions: {', '.join(payload.current_goal.hints.required_actions)}\n")
            if payload.current_goal.hints.avoid_actions:
                prompt_parts.append(f"Actions to avoid: {', '.join(payload.current_goal.hints.avoid_actions)}\n")
            prompt_parts.append("\n")
        
        prompt_parts.append(f"Steps taken for this goal: {payload.goal_progress.steps_taken if payload.goal_progress else 0}\n")
        prompt_parts.append("=== END GOAL CONTEXT ===\n\n")

    prompt_parts.append(
        "Rules: tap-first exploration, avoid consecutive swipes, use swipe only to reveal new controls.\n"
        "IMPORTANT: If memory_snapshot.completed_screens contains the current screen hash, navigate away — do NOT tap anything on this screen.\n"
        "Return:\n\n"
        "action.type (tap_xy, input_text, swipe, back, wait_ms, screenshot, stop)\n"
        "action.params\n"
        "intent\n"
        "expected_outcome\n"
        "fallback_if_fail"
    )
    
    return ["".join(prompt_parts)]


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
