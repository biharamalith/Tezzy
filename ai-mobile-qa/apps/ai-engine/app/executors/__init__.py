"""
Scenario execution orchestration layer.

This module provides the ScenarioExecutor class that orchestrates
scenario-based test execution by coordinating the multi-agent system
(Phases A-H) with goal progress tracking and constraint enforcement.
"""

from app.executors.scenario_executor import ScenarioExecutor

__all__ = ["ScenarioExecutor"]
