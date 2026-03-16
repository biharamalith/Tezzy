from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field


class IssueTriageInput(BaseModel):
    runtime_signals: List[Dict[str, Any]] = Field(default_factory=list)
    overflow_detection: Dict[str, Any] = Field(default_factory=dict)
    step_context: Dict[str, Any] = Field(default_factory=dict)
    prior_findings: List[Dict[str, Any]] = Field(default_factory=list)


class IssueTriageOutput(BaseModel):
    new_findings: List[Dict[str, Any]] = Field(default_factory=list)
    deduped_findings: List[Dict[str, Any]] = Field(default_factory=list)
    severity_summary: Dict[str, Any] = Field(default_factory=dict)
    should_continue: bool


PHASE_F_ALLOWED_KEYS = [
    "new_findings",
    "deduped_findings",
    "severity_summary",
    "should_continue",
]
