"""
Tests for Phase H (Final Report) scenario-based reporting.

Tests Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
"""

import pytest
from unittest.mock import AsyncMock, patch
from app.schemas.final_report import (
    FinalReportInput,
    FinalReportOutput,
    GoalProgress,
    ScenarioSummary,
)
from app.graphs.final_report import get_final_report_graph


@pytest.mark.asyncio
@patch('app.graphs.final_report.LLMClient')
async def test_scenario_report_all_goals_passed(mock_llm_client):
    """
    Test Phase H generates scenario report with pass_fail_status='pass' when all goals completed.
    Requirements: 9.1, 9.2, 9.3, 9.4
    """
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "markdown_report": "# Test Report\n\nAll goals passed successfully.",
        "executive_summary": "Login and navigation test completed successfully with all goals met.",
        "pass_fail_status": "pass",
        "scenario_summary": {
            "total_goals": 2,
            "goals_passed": 2,
            "goals_failed": 0,
            "goals_partial": 0,
            "coverage_percentage": 100.0,
            "pass_fail_status": "pass"
        }
    })
    mock_llm_client.return_value = mock_instance
    
    # Arrange
    scenario = {
        "id": "test-scenario-1",
        "name": "Login and Navigate Test",
        "description": "Test login flow and navigation to settings",
    }
    
    goal_results = [
        GoalProgress(
            goal_id="goal-1",
            description="Login with valid credentials",
            status="completed",
            steps_taken=5,
            criteria_met=["User logged in", "Home screen visible"],
            criteria_failed=[],
            findings=[],
            screenshots=["screenshot1.png"],
        ),
        GoalProgress(
            goal_id="goal-2",
            description="Navigate to settings",
            status="completed",
            steps_taken=3,
            criteria_met=["Settings screen visible"],
            criteria_failed=[],
            findings=[],
            screenshots=["screenshot2.png"],
        ),
    ]
    
    report_input = FinalReportInput(
        run_metadata={"app_name": "TestApp", "duration": 120},
        steps_log=[{"step": 1, "action": "tap", "result": "success"}],
        findings=[],
        improvements={},
        screenshots_index={},
        scenario=scenario,
        goal_results=goal_results,
    )
    
    # Act
    graph = get_final_report_graph()
    result = await graph.ainvoke({"input": report_input})
    output: FinalReportOutput = result["output"]
    
    # Assert
    assert output.markdown_report is not None
    assert len(output.markdown_report) > 0
    assert output.executive_summary is not None
    assert len(output.executive_summary) > 0
    assert output.pass_fail_status in ["pass", "fail", "partial"]
    
    # Verify scenario_summary is present
    assert output.scenario_summary is not None
    assert output.scenario_summary.total_goals == 2
    assert output.scenario_summary.goals_passed == 2
    assert output.scenario_summary.goals_failed == 0
    assert output.scenario_summary.goals_partial == 0
    assert output.scenario_summary.coverage_percentage == 100.0
    assert output.scenario_summary.pass_fail_status == "pass"


@pytest.mark.asyncio
@patch('app.graphs.final_report.LLMClient')
async def test_scenario_report_one_goal_failed(mock_llm_client):
    """
    Test Phase H generates scenario report with pass_fail_status='fail' when any goal failed.
    Requirements: 9.1, 9.2, 9.3, 9.4
    """
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "markdown_report": "# Test Report\n\nLogin failed. Test incomplete.",
        "executive_summary": "Login test failed due to unresponsive login button.",
        "pass_fail_status": "fail",
        "scenario_summary": {
            "total_goals": 2,
            "goals_passed": 0,
            "goals_failed": 1,
            "goals_partial": 0,
            "coverage_percentage": 0.0,
            "pass_fail_status": "fail"
        }
    })
    mock_llm_client.return_value = mock_instance
    
    # Arrange
    scenario = {
        "id": "test-scenario-2",
        "name": "Login Test with Failure",
        "description": "Test login flow that fails",
    }
    
    goal_results = [
        GoalProgress(
            goal_id="goal-1",
            description="Login with valid credentials",
            status="failed",
            steps_taken=10,
            criteria_met=["Login screen visible"],
            criteria_failed=["User logged in", "Home screen visible"],
            findings=[
                {
                    "type": "error",
                    "message": "Login button not responding",
                    "severity": "high",
                }
            ],
            screenshots=["screenshot1.png"],
        ),
        GoalProgress(
            goal_id="goal-2",
            description="Navigate to settings",
            status="not_started",
            steps_taken=0,
            criteria_met=[],
            criteria_failed=[],
            findings=[],
            screenshots=[],
        ),
    ]
    
    report_input = FinalReportInput(
        run_metadata={"app_name": "TestApp", "duration": 60},
        steps_log=[{"step": 1, "action": "tap", "result": "failed"}],
        findings=[{"type": "error", "message": "Login button not responding"}],
        improvements={},
        screenshots_index={},
        scenario=scenario,
        goal_results=goal_results,
    )
    
    # Act
    graph = get_final_report_graph()
    result = await graph.ainvoke({"input": report_input})
    output: FinalReportOutput = result["output"]
    
    # Assert
    assert output.scenario_summary is not None
    assert output.scenario_summary.total_goals == 2
    assert output.scenario_summary.goals_passed == 0
    assert output.scenario_summary.goals_failed == 1
    assert output.scenario_summary.pass_fail_status == "fail"
    
    # Verify report contains failure information
    assert "failed" in output.markdown_report.lower() or "error" in output.markdown_report.lower()


@pytest.mark.asyncio
@patch('app.graphs.final_report.LLMClient')
async def test_scenario_report_partial_completion(mock_llm_client):
    """
    Test Phase H generates scenario report with pass_fail_status='partial' when some goals completed.
    Requirements: 9.1, 9.2, 9.3, 9.4
    """
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "markdown_report": "# Test Report\n\nPartial completion: 1 of 3 goals completed.",
        "executive_summary": "Test partially completed with 1 goal passed and 1 in progress.",
        "pass_fail_status": "partial",
        "scenario_summary": {
            "total_goals": 3,
            "goals_passed": 1,
            "goals_failed": 0,
            "goals_partial": 1,
            "coverage_percentage": 33.33,
            "pass_fail_status": "partial"
        }
    })
    mock_llm_client.return_value = mock_instance
    
    # Arrange
    scenario = {
        "id": "test-scenario-3",
        "name": "Partial Completion Test",
        "description": "Test with partial goal completion",
    }
    
    goal_results = [
        GoalProgress(
            goal_id="goal-1",
            description="Login with valid credentials",
            status="completed",
            steps_taken=5,
            criteria_met=["User logged in", "Home screen visible"],
            criteria_failed=[],
            findings=[],
            screenshots=["screenshot1.png"],
        ),
        GoalProgress(
            goal_id="goal-2",
            description="Navigate to settings",
            status="in_progress",
            steps_taken=8,
            criteria_met=["Settings button visible"],
            criteria_failed=[],
            findings=[],
            screenshots=["screenshot2.png"],
        ),
        GoalProgress(
            goal_id="goal-3",
            description="Verify settings options",
            status="not_started",
            steps_taken=0,
            criteria_met=[],
            criteria_failed=[],
            findings=[],
            screenshots=[],
        ),
    ]
    
    report_input = FinalReportInput(
        run_metadata={"app_name": "TestApp", "duration": 90},
        steps_log=[{"step": 1, "action": "tap", "result": "success"}],
        findings=[],
        improvements={},
        screenshots_index={},
        scenario=scenario,
        goal_results=goal_results,
    )
    
    # Act
    graph = get_final_report_graph()
    result = await graph.ainvoke({"input": report_input})
    output: FinalReportOutput = result["output"]
    
    # Assert
    assert output.scenario_summary is not None
    assert output.scenario_summary.total_goals == 3
    assert output.scenario_summary.goals_passed == 1
    assert output.scenario_summary.goals_partial == 1
    assert output.scenario_summary.pass_fail_status == "partial"
    
    # Coverage should be 33.33% (1 out of 3 goals passed)
    assert 30.0 <= output.scenario_summary.coverage_percentage <= 35.0


@pytest.mark.asyncio
@patch('app.graphs.final_report.LLMClient')
async def test_scenario_report_goal_by_goal_results(mock_llm_client):
    """
    Test Phase H includes goal-by-goal results section with all required fields.
    Requirements: 9.2, 9.3, 9.5
    """
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "markdown_report": "# Test Report\n\n## Goal Results\n\n### Goal 1: Complete login flow\n- Status: completed\n- Steps: 7\n- Criteria met: Login successful, Home screen reached\n- Findings: Slow login response (warning)",
        "executive_summary": "Login flow completed successfully with minor performance warning.",
        "pass_fail_status": "pass",
        "scenario_summary": {
            "total_goals": 1,
            "goals_passed": 1,
            "goals_failed": 0,
            "goals_partial": 0,
            "coverage_percentage": 100.0,
            "pass_fail_status": "pass"
        }
    })
    mock_llm_client.return_value = mock_instance
    
    # Arrange
    scenario = {
        "id": "test-scenario-4",
        "name": "Detailed Results Test",
        "description": "Test detailed goal results",
    }
    
    goal_results = [
        GoalProgress(
            goal_id="goal-1",
            description="Complete login flow",
            status="completed",
            steps_taken=7,
            criteria_met=["Login successful", "Home screen reached"],
            criteria_failed=[],
            findings=[
                {
                    "type": "warning",
                    "message": "Slow login response",
                    "severity": "low",
                }
            ],
            screenshots=["login1.png", "login2.png"],
        ),
    ]
    
    report_input = FinalReportInput(
        run_metadata={"app_name": "TestApp"},
        steps_log=[],
        findings=[],
        improvements={},
        screenshots_index={},
        scenario=scenario,
        goal_results=goal_results,
    )
    
    # Act
    graph = get_final_report_graph()
    result = await graph.ainvoke({"input": report_input})
    output: FinalReportOutput = result["output"]
    
    # Assert - verify report contains goal details
    report = output.markdown_report.lower()
    assert "goal" in report
    assert "complete login flow" in report or "login" in report
    assert "completed" in report or "success" in report
    
    # Verify criteria information is present
    assert "criteria" in report or "login successful" in report.lower()


@pytest.mark.asyncio
@patch('app.graphs.final_report.LLMClient')
async def test_scenario_report_coverage_percentage(mock_llm_client):
    """
    Test Phase H calculates coverage_percentage correctly.
    Requirements: 9.3, 9.6
    """
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "markdown_report": "# Test Report\n\n2 of 5 goals completed (40% coverage).",
        "executive_summary": "Test achieved 40% coverage with 2 goals passed.",
        "pass_fail_status": "partial",
        "scenario_summary": {
            "total_goals": 5,
            "goals_passed": 2,
            "goals_failed": 1,
            "goals_partial": 1,
            "coverage_percentage": 40.0,
            "pass_fail_status": "partial"
        }
    })
    mock_llm_client.return_value = mock_instance
    
    # Arrange
    scenario = {
        "id": "test-scenario-5",
        "name": "Coverage Test",
        "description": "Test coverage calculation",
    }
    
    # 2 out of 5 goals completed = 40% coverage
    goal_results = [
        GoalProgress(goal_id="g1", description="Goal 1", status="completed", steps_taken=5),
        GoalProgress(goal_id="g2", description="Goal 2", status="completed", steps_taken=3),
        GoalProgress(goal_id="g3", description="Goal 3", status="failed", steps_taken=10),
        GoalProgress(goal_id="g4", description="Goal 4", status="in_progress", steps_taken=2),
        GoalProgress(goal_id="g5", description="Goal 5", status="not_started", steps_taken=0),
    ]
    
    report_input = FinalReportInput(
        run_metadata={},
        steps_log=[],
        findings=[],
        improvements={},
        screenshots_index={},
        scenario=scenario,
        goal_results=goal_results,
    )
    
    # Act
    graph = get_final_report_graph()
    result = await graph.ainvoke({"input": report_input})
    output: FinalReportOutput = result["output"]
    
    # Assert
    assert output.scenario_summary is not None
    assert output.scenario_summary.total_goals == 5
    assert output.scenario_summary.goals_passed == 2
    assert output.scenario_summary.goals_failed == 1
    assert output.scenario_summary.goals_partial == 1
    
    # Coverage should be 40% (2 out of 5 goals passed)
    assert 38.0 <= output.scenario_summary.coverage_percentage <= 42.0


@pytest.mark.asyncio
@patch('app.graphs.final_report.LLMClient')
async def test_autonomous_report_without_scenario(mock_llm_client):
    """
    Test Phase H generates standard autonomous report when no scenario provided.
    Requirements: 9.6, 22.1, 22.3
    """
    # Mock LLM response - autonomous mode without scenario_summary
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "markdown_report": "# Autonomous Exploration Report\n\nExplored 2 screens, found 1 warning.",
        "executive_summary": "Autonomous exploration completed with minor performance issue detected.",
        "pass_fail_status": "partial"
    })
    mock_llm_client.return_value = mock_instance
    
    # Arrange - no scenario or goal_results
    report_input = FinalReportInput(
        run_metadata={"app_name": "TestApp", "mode": "autonomous"},
        steps_log=[
            {"step": 1, "action": "tap", "element": "button1", "result": "success"},
            {"step": 2, "action": "swipe", "direction": "up", "result": "success"},
        ],
        findings=[
            {"type": "warning", "message": "Slow screen load", "severity": "medium"}
        ],
        improvements={"suggestions": ["Optimize loading time"]},
        screenshots_index={"screen1": "screenshot1.png"},
    )
    
    # Act
    graph = get_final_report_graph()
    result = await graph.ainvoke({"input": report_input})
    output: FinalReportOutput = result["output"]
    
    # Assert
    assert output.markdown_report is not None
    assert len(output.markdown_report) > 0
    assert output.executive_summary is not None
    assert output.pass_fail_status in ["pass", "fail", "partial"]
    
    # Verify scenario_summary is NOT present for autonomous mode
    assert output.scenario_summary is None
    
    # Verify report contains autonomous exploration information
    report = output.markdown_report.lower()
    assert "explored" in report or "findings" in report or "autonomous" in report


@pytest.mark.asyncio
@patch('app.graphs.final_report.LLMClient')
async def test_scenario_report_with_empty_goal_results(mock_llm_client):
    """
    Test Phase H handles scenario with empty goal_results gracefully.
    Requirements: 9.1, 9.6
    """
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "markdown_report": "# Test Report\n\nNo goals defined for this scenario.",
        "executive_summary": "Scenario executed with no goals defined.",
        "pass_fail_status": "partial",
        "scenario_summary": {
            "total_goals": 0,
            "goals_passed": 0,
            "goals_failed": 0,
            "goals_partial": 0,
            "coverage_percentage": 0.0,
            "pass_fail_status": "partial"
        }
    })
    mock_llm_client.return_value = mock_instance
    
    # Arrange
    scenario = {
        "id": "test-scenario-6",
        "name": "Empty Goals Test",
        "description": "Test with no goals",
    }
    
    report_input = FinalReportInput(
        run_metadata={"app_name": "TestApp"},
        steps_log=[],
        findings=[],
        improvements={},
        screenshots_index={},
        scenario=scenario,
        goal_results=[],  # Empty list
    )
    
    # Act
    graph = get_final_report_graph()
    result = await graph.ainvoke({"input": report_input})
    output: FinalReportOutput = result["output"]
    
    # Assert
    assert output.markdown_report is not None
    assert output.scenario_summary is not None
    assert output.scenario_summary.total_goals == 0
    assert output.scenario_summary.goals_passed == 0
    assert output.scenario_summary.goals_failed == 0
    assert output.scenario_summary.coverage_percentage == 0.0
