from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


PlannerMode = Literal["reach_home", "explore"]


ActionType = Literal[
    "tap_xy",
    "input_text",
    "swipe",
    "back",
    "wait_ms",
    "screenshot",
    "stop",
]


class CriticAction(BaseModel):
    type: ActionType
    params: Dict[str, Any] = Field(default_factory=dict)


class GoalConstraints(BaseModel):
    """Optional constraints for goal-directed validation."""
    avoid_actions: Optional[List[str]] = None
    required_screens: Optional[List[str]] = None
    max_steps: Optional[int] = None
    steps_taken: int = 0


class CriticGateInput(BaseModel):
    proposed_action: Dict[str, Any]
    screen_hash: str
    seen_hash_counts: Dict[str, int] = Field(default_factory=dict)
    recent_actions: List[Dict[str, Any]] = Field(default_factory=list)
    failure_streak: int = Field(ge=0, default=0)
    mode: PlannerMode
    goal_constraints: Optional[GoalConstraints] = None


Decision = Literal["approve", "reject"]
RecoveryTag = Literal["loop_recovery", "blocker_recovery", "normal"]


class CriticGateOutput(BaseModel):
    decision: Decision
    final_action: CriticAction
    rejection_reason_or_null: Optional[str] = None
    recovery_tag: RecoveryTag


PHASE_D_ALLOWED_KEYS = [
    "decision",
    "final_action",
    "rejection_reason_or_null",
    "recovery_tag",
]

PHASE_D_ACTION_ALLOWED_KEYS = [
    "type",
    "params",
]
