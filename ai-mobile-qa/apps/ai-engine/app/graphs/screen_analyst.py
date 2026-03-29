from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.llm.client import LLMClient
from app.llm.json_mode import ensure_keys_exact
from app.schemas.screen_understanding import (
    PHASE_B_ALLOWED_KEYS,
    ScreenUnderstandingInput,
    ScreenUnderstandingOutput,
)


class ScreenAnalystState(TypedDict):
    input: ScreenUnderstandingInput
    output: ScreenUnderstandingOutput


_SYSTEM_PROMPT = (
    "You are Tezzy Screen Analyst. Read current UI state and classify the screen.\n"
    "You must detect:\n"
    "likely screen type (login, home, list, detail, dialog, permission, onboarding, unknown),\n"
    "blockers,\n"
    "best candidate interactions.\n\n"
    "ONBOARDING RULE: If the screen shows an intro/tutorial/splash slide with illustrative images "
    "and navigation buttons such as 'Next', 'Skip', 'Continue', or 'Get Started', "
    "classify screen_type as 'onboarding'. "
    "In candidate_targets, list only those navigation buttons — do NOT include the image or background as a target. "
    "Prefix each with 'fill:' only if it is a text input; otherwise list them plainly e.g. 'next_button', 'skip_button'.\n\n"
    "OVERFLOW DETECTION: Look for Flutter's signature yellow and black striped "
    "'A RenderFlex overflowed...' warning ribbon on any screen edge. Flag as 'overflow' in blocker_flags.\n\n"
    "BLOCKER FLAGS: Include any of these when present: 'overflow', 'permission_dialog', "
    "'loading_spinner', 'keyboard_open', 'modal_dialog'. Only flag what is visibly blocking interaction.\n\n"
    "CANDIDATE TARGETS ORDERING: Order candidate_targets strictly by this priority:\n"
    "  (1) Form fields that need filling — prefix with 'fill:' e.g. 'fill:email_field', 'fill:password_field'\n"
    "  (2) Primary action buttons (login, submit, confirm, continue)\n"
    "  (3) Navigation elements (tabs, drawer/menu icon, back)\n"
    "  (4) Secondary actions (links, toggles, secondary buttons)\n"
    "Never mix form fields and buttons at the same priority level.\n\n"
    "Prefer deterministic reasoning from UI elements. If elements are sparse, use screenshot cues."
)


_USER_PROMPT_TEMPLATE = (
    "Input:\n\n"
    "step: {step}\n"
    "screen_hash: {screen_hash}\n"
    "ui_elements: {ui_elements}\n"
    "screenshot_summary: {screenshot_summary}\n"
    "last_action: {last_action}\n"
    "last_result: {last_result}\n"
    "memory_snapshot: {memory_snapshot}\n"
    "Return:\n\n"
    "screen_type\n"
    "confidence\n"
    "candidate_targets (ordered)\n"
    "blocker_flags\n"
    "reasoning_short"
)


def build_phase_b_user_messages(payload: ScreenUnderstandingInput) -> list[str]:
    ui_str = json.dumps(payload.ui_elements, ensure_ascii=False)
    memory_str = json.dumps(payload.memory_snapshot.model_dump(), ensure_ascii=False)

    prompt = (
        "Input:\n\n"
        f"step: {payload.step}\n"
        f"screen_hash: {payload.screen_hash}\n"
        f"ui_elements: {ui_str}\n"
        f"screenshot_summary: {payload.screenshot_summary}\n"
        f"last_action: {payload.last_action}\n"
        f"last_result: {payload.last_result}\n"
        f"memory_snapshot: {memory_str}\n"
        "Return:\n\n"
        "screen_type\n"
        "confidence\n"
        "candidate_targets (ordered)\n"
        "blocker_flags\n"
        "reasoning_short"
    )
    return [prompt]


async def _phase_b_screen_understanding(state: ScreenAnalystState) -> Dict[str, Any]:
    payload = state["input"]

    llm = LLMClient()
    user_messages = build_phase_b_user_messages(payload)
    raw = await llm.chat_json_messages(
        system_prompt=_SYSTEM_PROMPT,
        user_messages=user_messages,
        temperature=0.0,
    )

    ensure_keys_exact(raw, allowed_keys=PHASE_B_ALLOWED_KEYS)
    output = ScreenUnderstandingOutput.model_validate(raw)
    return {"output": output}


def build_screen_analyst_graph():
    graph = StateGraph(ScreenAnalystState)
    graph.add_node("phase_b_screen_understanding", _phase_b_screen_understanding)
    graph.set_entry_point("phase_b_screen_understanding")
    graph.add_edge("phase_b_screen_understanding", END)
    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_screen_analyst_graph():
    return build_screen_analyst_graph()
