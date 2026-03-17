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
    "likely screen type (login, home, list, detail, dialog, permission, unknown),\n"
    "blockers,\n"
    "best candidate interactions.\n"
    "Crucially, look for layout overflows. Specifically detect Flutter's signature yellow and black striped 'A RenderFlex overflowed...' warning boxes or ribbons on the edges of the screen. Flag these as 'overflow' in blocker_flags.\n"
    "Prefer deterministic reasoning from UI elements. If elements are sparse, use screenshot cues."
)


_USER_PROMPT_TEMPLATE = (
    "Input:\n\n"
    "step: {step}\n"
    "screen_hash: {screen_hash}\n"
    "ui_elements: {elements}\n"
    "screenshot_summary: {optional short OCR/vision notes}\n"
    "last_action: {last_action}\n"
    "last_result: {last_result}\n"
    "memory_snapshot: {seen_hash_counts, seen_element_keys}\n"
    "Return:\n\n"
    "screen_type\n"
    "confidence\n"
    "candidate_targets (ordered)\n"
    "blocker_flags\n"
    "reasoning_short"
)


def build_phase_b_user_messages(payload: ScreenUnderstandingInput) -> list[str]:
    input_obj = {
        "step": payload.step,
        "screen_hash": payload.screen_hash,
        "ui_elements": payload.ui_elements,
        "screenshot_summary": payload.screenshot_summary,
        "last_action": payload.last_action,
        "last_result": payload.last_result,
        "memory_snapshot": payload.memory_snapshot.model_dump(),
    }
    return [json.dumps(input_obj, ensure_ascii=False), _USER_PROMPT_TEMPLATE]


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
