from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class GoalProgress(BaseModel):
    goal_id: str
    description: str
    status: str  # "not_started", "in_progress", "completed", "failed"
    steps_taken: int = 0
    criteria_met: List[str] = Field(default_factory=list)
    criteria_failed: List[str] = Field(default_factory=list)
    findings: List[Dict[str, Any]] = Field(default_factory=list)
    screenshots: List[str] = Field(default_factory=list)


class ScenarioSummary(BaseModel):
    total_goals: int
    goals_passed: int
    goals_failed: int
    goals_partial: int
    coverage_percentage: float
    pass_fail_status: str  # "pass", "fail", "partial"


class FinalReportInput(BaseModel):
    run_metadata: Dict[str, Any] = Field(default_factory=dict)
    steps_log: List[Dict[str, Any]] = Field(default_factory=list)
    findings: List[Dict[str, Any]] = Field(default_factory=list)
    improvements: Dict[str, Any] = Field(default_factory=dict)
    screenshots_index: Dict[str, Any] = Field(default_factory=dict)
    # Scenario-based fields (optional for backward compatibility)
    scenario: Optional[Dict[str, Any]] = None  # id, name, description
    goal_results: Optional[List[GoalProgress]] = None


class FinalReportOutput(BaseModel):
    markdown_report: str
    executive_summary: str
    pass_fail_status: str
    # Scenario-based summary (optional for backward compatibility)
    scenario_summary: Optional[ScenarioSummary] = None


PHASE_H_ALLOWED_KEYS = [
    "markdown_report",
    "executive_summary",
    "pass_fail_status",
    "scenario_summary",
]
