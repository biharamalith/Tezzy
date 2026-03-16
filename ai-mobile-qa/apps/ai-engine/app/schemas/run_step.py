from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


PlannerMode = Literal["reach_home", "explore"]


class RunStepInput(BaseModel):
    # Current UI snapshot (for Phase B)
    step: int = Field(ge=1)
    screen_hash: str
    ui_elements: List[Dict[str, Any]] = Field(default_factory=list)
    screenshot_summary: Optional[str] = None

    # Result of the last executed action (for Phase F + for Phase B context)
    last_action: Optional[Dict[str, Any]] = None
    last_result: Optional[str] = None

    # Rolling summaries (compact state)
    mode: PlannerMode
    seen_hash_counts: Dict[str, int] = Field(default_factory=dict)
    seen_element_keys: List[str] = Field(default_factory=list)
    recent_actions: List[Dict[str, Any]] = Field(default_factory=list)
    failure_streak: int = Field(ge=0, default=0)
    loop_count: int = Field(ge=0, default=0)
    no_element_count: int = Field(ge=0, default=0)

    # Planner context
    screen_size: Dict[str, int]
    credentials: Optional[Dict[str, Any]] = None

    # Optional signals from execution/vision (triage happens before planning next action)
    runtime_signals: List[Dict[str, Any]] = Field(default_factory=list)
    overflow_detection: Dict[str, Any] = Field(default_factory=dict)
    prior_findings: List[Dict[str, Any]] = Field(default_factory=list)


class RunStepOutput(BaseModel):
    # Optional triage result for the just-executed action
    triage: Optional[Dict[str, Any]] = None

    # Next-step decision artifacts
    analysis: Dict[str, Any]
    plan: Dict[str, Any]
    critic: Dict[str, Any]

    # Convenience: action the client should execute next
    next_action: Dict[str, Any]

    # Whether the server recommends stopping before executing next_action
    should_continue: bool
