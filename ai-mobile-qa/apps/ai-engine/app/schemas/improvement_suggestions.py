from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field


class ImprovementSuggestionInput(BaseModel):
    final_findings: List[Dict[str, Any]] = Field(default_factory=list)
    flow_coverage_stats: Dict[str, Any] = Field(default_factory=dict)
    repeated_fail_patterns: List[Dict[str, Any]] = Field(default_factory=list)
    overflow_instances: List[Dict[str, Any]] = Field(default_factory=list)


class ImprovementSuggestionOutput(BaseModel):
    product_improvements: List[str] = Field(default_factory=list)
    qa_automation_improvements: List[str] = Field(default_factory=list)
    priority_order: List[str] = Field(default_factory=list)
    quick_wins_24h: List[str] = Field(default_factory=list)


PHASE_G_ALLOWED_KEYS = [
    "product_improvements",
    "qa_automation_improvements",
    "priority_order",
    "quick_wins_24h",
]
