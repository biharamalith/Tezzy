from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator


ScreenType = Literal[
    "login",
    "home",
    "list",
    "detail",
    "dialog",
    "permission",
    "unknown",
]


class MemorySnapshot(BaseModel):
    seen_hash_counts: Dict[str, int] = Field(default_factory=dict)
    seen_element_keys: List[str] = Field(default_factory=list)


class ScreenUnderstandingInput(BaseModel):
    step: int = Field(ge=1)
    screen_hash: str
    ui_elements: List[Dict[str, Any]] = Field(default_factory=list)
    screenshot_summary: Optional[str] = None
    last_action: Optional[str] = None
    last_result: Optional[str] = None
    memory_snapshot: MemorySnapshot = Field(default_factory=MemorySnapshot)


class ScreenUnderstandingOutput(BaseModel):
    screen_type: ScreenType
    confidence: float = Field(ge=0.0, le=1.0)
    candidate_targets: List[str] = Field(default_factory=list)
    blocker_flags: List[str] = Field(default_factory=list)
    reasoning_short: str

    @field_validator("candidate_targets", "blocker_flags", mode="before")
    @classmethod
    def _coerce_str_or_list(cls, v: Union[str, List[str]]) -> List[str]:
        if v is None:
            return []
        if isinstance(v, str):
            stripped = v.strip()
            return [stripped] if stripped else []
        if isinstance(v, list):
            return [str(item).strip() for item in v if str(item).strip()]
        return [str(v).strip()]


PHASE_B_ALLOWED_KEYS = [
    "screen_type",
    "confidence",
    "candidate_targets",
    "blocker_flags",
    "reasoning_short",
]
