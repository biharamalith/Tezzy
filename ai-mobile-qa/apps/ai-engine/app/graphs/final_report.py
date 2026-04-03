from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.llm.client import LLMClient
from app.llm.json_mode import ensure_keys_exact
from app.schemas.final_report import (
    PHASE_H_ALLOWED_KEYS,
    FinalReportInput,
    FinalReportOutput,
)


class FinalReportState(TypedDict):
    input: FinalReportInput
    output: FinalReportOutput


_SYSTEM_PROMPT = (
    "You are Tezzy Report Writer.\n"
    "Produce a developer-friendly QA report in markdown.\n"
    "Must include:\n"
    "objective and outcome,\n"
    "whether home was reached,\n"
    "explored flows,\n"
    "overflow findings with evidence,\n"
    "prioritized improvements.\n"
    "Keep factual and concise."
)


# Keep the Phase H template text exactly as provided.
_USER_PROMPT_TEMPLATE = (
    "Analyse the run data above and produce a comprehensive QA report.\n"
    "If scenario and goal_results are provided, generate a scenario-based report with:\n"
    "  - Executive summary mentioning scenario name and overall outcome\n"
    "  - Goal-by-goal results section showing each goal's description, status, steps_taken, criteria_met, criteria_failed, and findings\n"
    "  - Overall findings section summarizing all issues found\n"
    "  - Recommendations section with prioritized improvements\n"
    "  - scenario_summary object with: total_goals, goals_passed (status='completed'), goals_failed (status='failed'), goals_partial (status='in_progress'), coverage_percentage (goals_passed/total_goals * 100), pass_fail_status ('pass' if all completed, 'fail' if any failed, 'partial' if some completed)\n"
    "If scenario is not provided, generate a standard autonomous exploration report.\n"
    "Return exactly these keys:\n"
    "  markdown_report: full markdown report including objective, outcome, explored flows, "
    "overflow findings with evidence, and prioritized recommendations\n"
    "  executive_summary: 2-3 sentence plain-English summary of the run result\n"
    "  pass_fail_status: one of 'pass', 'fail', or 'partial'\n"
    "  scenario_summary: (only if scenario provided) object with total_goals, goals_passed, goals_failed, goals_partial, coverage_percentage, pass_fail_status\n"
)


def build_phase_h_user_messages(payload: FinalReportInput) -> list[str]:
    # Compact, structured values; do not embed them into the template.
    input_obj = {
        "run_metadata": payload.run_metadata,
        "steps_log": payload.steps_log,
        "findings": payload.findings,
        "improvements": payload.improvements,
        "screenshots_index": payload.screenshots_index,
    }
    
    # Add scenario context if provided
    if payload.scenario:
        input_obj["scenario"] = payload.scenario
    
    if payload.goal_results:
        input_obj["goal_results"] = [
            {
                "goal_id": gr.goal_id,
                "description": gr.description,
                "status": gr.status,
                "steps_taken": gr.steps_taken,
                "criteria_met": gr.criteria_met,
                "criteria_failed": gr.criteria_failed,
                "findings": gr.findings,
                "screenshots": gr.screenshots,
            }
            for gr in payload.goal_results
        ]
    
    return [json.dumps(input_obj, ensure_ascii=False), _USER_PROMPT_TEMPLATE]


async def _phase_h_final_report(state: FinalReportState) -> Dict[str, Any]:
    payload = state["input"]

    llm = LLMClient()
    user_messages = build_phase_h_user_messages(payload)
    raw = await llm.chat_json_messages(
        system_prompt=_SYSTEM_PROMPT,
        user_messages=user_messages,
        temperature=0.0,
    )

    # Validate required keys (scenario_summary is optional)
    required_keys = ["markdown_report", "executive_summary", "pass_fail_status"]
    missing = set(required_keys) - set(raw.keys())
    if missing:
        raise ValueError(f"Missing required keys: {sorted(missing)}")
    
    # Check for unexpected keys
    allowed_keys = set(PHASE_H_ALLOWED_KEYS)
    extra = set(raw.keys()) - allowed_keys
    if extra:
        raise ValueError(f"Unexpected keys in JSON: {sorted(extra)}")
    
    # Handle scenario_summary if present
    if "scenario_summary" in raw and raw["scenario_summary"] is not None:
        # Validate scenario_summary structure
        from app.schemas.final_report import ScenarioSummary
        raw["scenario_summary"] = ScenarioSummary.model_validate(raw["scenario_summary"])
    
    output = FinalReportOutput.model_validate(raw)
    return {"output": output}


def build_final_report_graph():
    graph = StateGraph(FinalReportState)
    graph.add_node("phase_h_report", _phase_h_final_report)
    graph.set_entry_point("phase_h_report")
    graph.add_edge("phase_h_report", END)
    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_final_report_graph():
    return build_final_report_graph()
