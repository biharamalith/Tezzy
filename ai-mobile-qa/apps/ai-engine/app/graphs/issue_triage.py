from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.llm.client import LLMClient
from app.llm.json_mode import ensure_keys_exact
from app.schemas.issue_triage import (
    PHASE_F_ALLOWED_KEYS,
    IssueTriageInput,
    IssueTriageOutput,
)


class IssueTriageState(TypedDict):
    input: IssueTriageInput
    output: IssueTriageOutput


_SYSTEM_PROMPT = (
    "You are Tezzy Issue Triage Agent.\n"
    "Combine runtime signals and vision findings into normalized findings.\n"
    "Sources: loop, dead_tap, crash_hint, no_elements, overflow_vision.\n"
    "Deduplicate and assign severity.\n"
    "Return strict JSON only."
)


_USER_PROMPT_TEMPLATE = (
    "Input:\n\n"
    "runtime_signals: {signals}\n"
    "overflow_detection: {phase E output}\n"
    "step_context: {step, action, screen_hash}\n"
    "prior_findings: {findings_so_far}\n"
    "Return:\n\n"
    "new_findings\n"
    "deduped_findings\n"
    "severity_summary\n"
    "should_continue (true or false)"
)


def build_phase_f_user_messages(payload: IssueTriageInput) -> list[str]:
    input_obj = {
        "runtime_signals": payload.runtime_signals,
        "overflow_detection": payload.overflow_detection,
        "step_context": payload.step_context,
        "prior_findings": payload.prior_findings,
    }
    return [json.dumps(input_obj, ensure_ascii=False), _USER_PROMPT_TEMPLATE]


async def _phase_f_issue_triage(state: IssueTriageState) -> Dict[str, Any]:
    payload = state["input"]

    llm = LLMClient()
    user_messages = build_phase_f_user_messages(payload)
    raw = await llm.chat_json_messages(
        system_prompt=_SYSTEM_PROMPT,
        user_messages=user_messages,
        temperature=0.0,
    )

    ensure_keys_exact(raw, allowed_keys=PHASE_F_ALLOWED_KEYS)
    output = IssueTriageOutput.model_validate(raw)
    return {"output": output}


def build_issue_triage_graph():
    graph = StateGraph(IssueTriageState)
    graph.add_node("phase_f_triage", _phase_f_issue_triage)
    graph.set_entry_point("phase_f_triage")
    graph.add_edge("phase_f_triage", END)
    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_issue_triage_graph():
    return build_issue_triage_graph()
