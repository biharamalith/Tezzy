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
    "Combine runtime signals and vision findings into a normalized, deduplicated findings list.\n"
    "Sources: loop, dead_tap, crash_hint, no_elements, overflow_vision.\n\n"
    "SEVERITY RULES:\n"
    "  error   → crash_hint signal present, OR overflow_vision issue detected\n"
    "  warn    → loop signal present, OR dead_tap signal present\n"
    "  info    → no_elements signal present, OR any other minor anomaly\n\n"
    "DEDUPLICATION RULES: Two findings are duplicates if they share the same signal type "
    "AND the same screen_hash. Keep only the highest-severity copy. "
    "Do not add a finding that already exists in prior_findings with the same type and screen_hash.\n\n"
    "SHOULD CONTINUE RULES — set should_continue=false if ANY of the following are true:\n"
    "  (1) A crash_hint signal is present in runtime_signals.\n"
    "  (2) More than 3 overflow errors are found on the same screen_hash.\n"
    "  (3) step_context.step indicates failure_streak > 5 (check step_context for this).\n"
    "Otherwise set should_continue=true.\n\n"
    "GOAL CONTEXT RULES (when current_goal is provided):\n"
    "  - Add goal_id to each finding\n"
    "  - Evaluate whether the finding blocks goal completion:\n"
    "    * Set blocks_goal=true if the finding prevents any success criterion from being met\n"
    "    * Consider goal_progress.criteria_pending when evaluating blocking impact\n"
    "    * Examples of blocking: crash (blocks all criteria), overflow on required screen (blocks visibility criteria)\n"
    "    * Examples of non-blocking: minor UI issues that don't prevent goal completion\n"
    "  - When evaluating blocks_goal, consider:\n"
    "    * Does this finding prevent user interaction needed for success criteria?\n"
    "    * Does this finding make required UI elements inaccessible?\n"
    "    * Does this finding cause the app to crash or become unresponsive?\n"
    "  - When no current_goal is provided, omit goal_id and blocks_goal fields\n\n"
    "Return strict JSON only."
)


def build_phase_f_user_messages(payload: IssueTriageInput) -> list[str]:
    signals_str = json.dumps(payload.runtime_signals, ensure_ascii=False)
    overflow_str = json.dumps(payload.overflow_detection, ensure_ascii=False)
    context_str = json.dumps(payload.step_context, ensure_ascii=False)
    findings_str = json.dumps(payload.prior_findings, ensure_ascii=False)

    prompt = (
        "Input:\n\n"
        f"runtime_signals: {signals_str}\n"
        f"overflow_detection: {overflow_str}\n"
        f"step_context: {context_str}\n"
        f"prior_findings: {findings_str}\n"
    )
    
    # Add goal context if provided
    if payload.current_goal:
        goal_data = {
            "id": payload.current_goal.id,
            "description": payload.current_goal.description,
            "success_criteria": payload.current_goal.success_criteria,
        }
        
        # Add goal progress if provided
        if payload.goal_progress:
            goal_data["progress"] = {
                "steps_taken": payload.goal_progress.steps_taken,
                "criteria_met": payload.goal_progress.criteria_met,
                "criteria_pending": payload.goal_progress.criteria_pending,
            }
        
        goal_str = json.dumps(goal_data, ensure_ascii=False)
        prompt += f"current_goal: {goal_str}\n"
    
    prompt += (
        "Return:\n\n"
        "new_findings\n"
        "deduped_findings\n"
        "severity_summary\n"
        "should_continue (true or false)"
    )
    
    if payload.current_goal:
        prompt += "\n\nFor each finding, include goal_id and blocks_goal fields."
    
    return [prompt]


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
