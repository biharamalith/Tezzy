from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.llm.client import LLMClient
from app.llm.json_mode import ensure_keys_exact
from app.schemas.improvement_suggestions import (
    PHASE_G_ALLOWED_KEYS,
    ImprovementSuggestionInput,
    ImprovementSuggestionOutput,
)


class ImprovementAdvisorState(TypedDict):
    input: ImprovementSuggestionInput
    output: ImprovementSuggestionOutput


_SYSTEM_PROMPT = (
    "You are Tezzy QA Improvement Advisor.\n"
    "Generate practical improvements for developers and QA teams.\n"
    "Focus on high impact, low ambiguity recommendations.\n"
    "Return strict JSON only."
)


_USER_PROMPT_TEMPLATE = (
    "Based on the QA run data above, generate specific, actionable improvements. "
    "Return product_improvements, qa_automation_improvements, priority_order, and quick_wins_24h."
)


def build_phase_g_user_messages(payload: ImprovementSuggestionInput) -> list[str]:
    input_obj = {
        "final_findings": payload.final_findings,
        "flow_coverage_stats": payload.flow_coverage_stats,
        "repeated_fail_patterns": payload.repeated_fail_patterns,
        "overflow_instances": payload.overflow_instances,
    }
    return [json.dumps(input_obj, ensure_ascii=False), _USER_PROMPT_TEMPLATE]


async def _phase_g_improvement_suggestions(state: ImprovementAdvisorState) -> Dict[str, Any]:
    payload = state["input"]

    llm = LLMClient()
    user_messages = build_phase_g_user_messages(payload)
    raw = await llm.chat_json_messages(
        system_prompt=_SYSTEM_PROMPT,
        user_messages=user_messages,
        temperature=0.0,
    )

    ensure_keys_exact(raw, allowed_keys=PHASE_G_ALLOWED_KEYS)
    output = ImprovementSuggestionOutput.model_validate(raw)
    return {"output": output}


def build_improvement_advisor_graph():
    graph = StateGraph(ImprovementAdvisorState)
    graph.add_node("phase_g_suggest", _phase_g_improvement_suggestions)
    graph.set_entry_point("phase_g_suggest")
    graph.add_edge("phase_g_suggest", END)
    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_improvement_advisor_graph():
    return build_improvement_advisor_graph()
