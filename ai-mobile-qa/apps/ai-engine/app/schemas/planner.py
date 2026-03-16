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


class PlannerAction(BaseModel):
    type: ActionType
    params: Dict[str, Any] = Field(default_factory=dict)


class AttemptCounters(BaseModel):
    loop_count: int = Field(ge=0, default=0)
    no_element_count: int = Field(ge=0, default=0)


class ScreenSize(BaseModel):
    w: int = Field(ge=1)
    h: int = Field(ge=1)


class PlannerInput(BaseModel):
    mode: PlannerMode
    analysis: Dict[str, Any]
    memory_snapshot: Dict[str, Any] = Field(default_factory=dict)
    screen_size: ScreenSize
    credentials: Optional[Dict[str, Any]] = None
    attempt_counters: AttemptCounters = Field(default_factory=AttemptCounters)


class PlannerOutput(BaseModel):
    action: PlannerAction
    intent: str
    expected_outcome: str
    fallback_if_fail: str


PHASE_C_ALLOWED_KEYS = [
    "action",
    "intent",
    "expected_outcome",
    "fallback_if_fail",
]

PHASE_C_ACTION_ALLOWED_KEYS = [
    "type",
    "params",
]
