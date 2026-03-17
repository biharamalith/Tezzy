from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


VisionIssueSeverity = Literal["error", "warn", "info"]

VisionIssueType = Literal[
    "overflow",
    "clipping",
    "truncation",
    "misalignment",
    "off_screen",
    "other",
]


class VisionIssue(BaseModel):
    type: VisionIssueType
    description: str
    severity: VisionIssueSeverity
    # Optional rough region label, e.g. "top-right", "bottom nav bar"
    region: Optional[str] = None


class VisionAnalysisInput(BaseModel):
    # Base64-encoded PNG screenshot (no data-URL prefix needed)
    screenshot_b64: str
    step: int = Field(ge=1)
    screen_hash: str


class VisionAnalysisOutput(BaseModel):
    issues: List[VisionIssue] = Field(default_factory=list)
    has_issues: bool = False
    summary: str = ""


VISION_ALLOWED_KEYS = [
    "issues",
    "has_issues",
    "summary",
]
