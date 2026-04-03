from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CurrentGoal(BaseModel):
    """Goal context for tagging findings"""
    id: str
    description: str
    success_criteria: List[str] = Field(default_factory=list)


class Finding(BaseModel):
    """Individual finding with optional goal context"""
    kind: str
    severity: str
    issue: str
    evidence: List[str] = Field(default_factory=list)
    screen_hash: Optional[str] = None
    goal_id: Optional[str] = None
    blocks_goal: Optional[bool] = None


class GoalProgress(BaseModel):
    """Goal progress context for triage"""
    steps_taken: int = 0
    criteria_met: List[str] = Field(default_factory=list)
    criteria_pending: List[str] = Field(default_factory=list)


class IssueTriageInput(BaseModel):
    runtime_signals: List[Dict[str, Any]] = Field(default_factory=list)
    overflow_detection: Dict[str, Any] = Field(default_factory=dict)
    step_context: Dict[str, Any] = Field(default_factory=dict)
    prior_findings: List[Dict[str, Any]] = Field(default_factory=list)
    current_goal: Optional[CurrentGoal] = None
    goal_progress: Optional[GoalProgress] = None


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

# Additional keys allowed in findings
FINDING_ALLOWED_KEYS = [
    "kind",
    "severity",
    "issue",
    "evidence",
    "screen_hash",
    "goal_id",
    "blocks_goal",
]
