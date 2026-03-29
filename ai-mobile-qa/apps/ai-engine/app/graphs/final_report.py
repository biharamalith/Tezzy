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
    "Return exactly these keys:\n"
    "  markdown_report: full markdown report including objective, outcome, explored flows, "
    "overflow findings with evidence, and prioritized recommendations\n"
    "  executive_summary: 2-3 sentence plain-English summary of the run result\n"
    "  pass_fail_status: one of 'pass', 'fail', or 'partial'\n"
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

    ensure_keys_exact(raw, allowed_keys=PHASE_H_ALLOWED_KEYS)
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
