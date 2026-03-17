from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.llm.client import LLMClient
from app.schemas.vision import (
    VISION_ALLOWED_KEYS,
    VisionAnalysisInput,
    VisionAnalysisOutput,
    VisionIssue,
)


class VisionAnalystState(TypedDict):
    input: VisionAnalysisInput
    output: VisionAnalysisOutput


_SYSTEM_PROMPT = (
    "You are Tezzy Vision Analyst. You inspect Android app screenshots for UI rendering defects.\n"
    "Detect ALL of the following defect types if present:\n"
    "  - overflow: Flutter yellow/black striped 'RenderFlex overflowed' ribbon on any edge\n"
    "  - clipping: widgets cut off at screen edges or parent boundaries\n"
    "  - truncation: text that is visibly cut with ellipsis or clipped mid-character\n"
    "  - misalignment: buttons, labels, or icons that are visibly off-center or misaligned\n"
    "  - off_screen: interactive elements partially or fully outside the visible area\n"
    "  - other: any other obvious rendering defect\n"
    "Be precise. Only flag real visible defects — do not flag intentional design choices.\n"
    "Respond with json only."
)

_USER_PROMPT_TEMPLATE = (
    "Inspect this screenshot carefully for UI rendering defects.\n\n"
    "step: {step}\n"
    "screen_hash: {screen_hash}\n\n"
    "Return a JSON object with exactly these keys:\n"
    "  issues: array of issue objects, each with: type, description, severity, region\n"
    "  has_issues: boolean — true if any issues were found\n"
    "  summary: one-sentence plain-English summary of what you found\n\n"
    "Each issue object must have:\n"
    "  type: one of overflow | clipping | truncation | misalignment | off_screen | other\n"
    "  description: concise description of the issue\n"
    "  severity: one of error | warn | info\n"
    "  region: optional region label e.g. 'top-right', 'bottom nav', null if unknown\n\n"
    "If no issues are found, return: {{\"issues\": [], \"has_issues\": false, \"summary\": \"No visual defects detected.\"}}"
)


async def _vision_analysis(state: VisionAnalystState) -> Dict[str, Any]:
    payload = state["input"]

    prompt = _USER_PROMPT_TEMPLATE.format(
        step=payload.step,
        screen_hash=payload.screen_hash,
    )

    llm = LLMClient()
    raw = await llm.chat_vision_json(
        system_prompt=_SYSTEM_PROMPT,
        text_prompt=prompt,
        image_b64=payload.screenshot_b64,
        temperature=0.0,
    )

    # Normalise: ensure required keys are present
    if "issues" not in raw:
        raw["issues"] = []
    if "has_issues" not in raw:
        raw["has_issues"] = bool(raw["issues"])
    if "summary" not in raw:
        raw["summary"] = "No summary provided."

    # Strip any extra keys the model may have added
    cleaned = {k: raw[k] for k in VISION_ALLOWED_KEYS if k in raw}

    output = VisionAnalysisOutput.model_validate(cleaned)
    return {"output": output}


def build_vision_analyst_graph():
    graph = StateGraph(VisionAnalystState)
    graph.add_node("vision_analysis", _vision_analysis)
    graph.set_entry_point("vision_analysis")
    graph.add_edge("vision_analysis", END)
    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_vision_analyst_graph():
    return build_vision_analyst_graph()
