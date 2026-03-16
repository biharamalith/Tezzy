from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator


class Credentials(BaseModel):
    email: str
    password: str
    optional_otp_note: Optional[str] = None


class SessionBootstrapInput(BaseModel):
    app_name: str
    platform: Literal["android"] = "android"
    max_steps: int = Field(ge=1, le=500)
    credentials: Credentials
    home_markers: List[str]
    flow_hints: Optional[List[str]] = None
    constraints: Dict[str, Any] = Field(default_factory=dict)


class SessionBootstrapOutput(BaseModel):
    run_goal: str
    mode: Literal["reach_home", "explore"]
    success_criteria: List[str]
    stop_conditions: List[str]
    risk_rules: List[str]

    @field_validator("success_criteria", "stop_conditions", "risk_rules", mode="before")
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


PHASE_A_ALLOWED_KEYS = [
    "run_goal",
    "mode",
    "success_criteria",
    "stop_conditions",
    "risk_rules",
]
