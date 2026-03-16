from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field


class FinalReportInput(BaseModel):
    run_metadata: Dict[str, Any] = Field(default_factory=dict)
    steps_log: List[Dict[str, Any]] = Field(default_factory=list)
    findings: List[Dict[str, Any]] = Field(default_factory=list)
    improvements: Dict[str, Any] = Field(default_factory=dict)
    screenshots_index: Dict[str, Any] = Field(default_factory=dict)


class FinalReportOutput(BaseModel):
    markdown_report: str
    executive_summary: str
    pass_fail_status: str


PHASE_H_ALLOWED_KEYS = [
    "markdown_report",
    "executive_summary",
    "pass_fail_status",
]
