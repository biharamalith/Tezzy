"""
Tests for scenario executor orchestration layer.

This test suite validates the ScenarioExecutor class that orchestrates
scenario-based test execution by coordinating the multi-agent system
with goal progress tracking and constraint enforcement.

Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9
"""

import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.executors.scenario_executor import ScenarioExecutor


@pytest.fixture
def sample_single_goal_scenario():
    """Sample scenario with a single goal."""
    return {
        "id": "test-scenario-1",
        "name": "Single Goal Test",
        "description": "Test scenario with one goal",
        "app_name": "TestApp",
        "goals": [
            {
                "id": "goal-1",
                "description": "Reach home screen",
                "type": "navigate",
                "success_criteria": ["Screen type is 'home'"],
            }
        ],
        "constraints": {
            "max_steps_per_goal": 10,
            "timeout_seconds": 60,
            "stop_on_first_failure": True,
        },
    }


@pytest.fixture
def sample_multi_goal_scenario():
    """Sample scenario with multiple goals."""
    return {
        "id": "test-scenario-2",
        "name": "Multi Goal Test",
        "description": "Test scenario with multiple goals",
        "app_name": "TestApp",
        "credentials": {
            "email": "test@example.com",
            "password": "Test123!",
        },
        "goals": [
            {
                "id": "goal-1",
                "description": "Login",
                "type": "login",
                "success_criteria": ["Screen type is 'home'"],
            },
            {
                "id": "goal-2",
                "description": "Navigate to settings",
                "type": "navigate",
                "success_criteria": ["Screen type is 'settings'"],
            },
        ],
        "constraints": {
            "max_steps_per_goal": 10,
            "stop_on_first_failure": False,
        },
    }


@pytest.fixture
def sample_device_info():
    """Sample device information."""
    return {
        "serial": "emulator-5554",
        "screen_size": {"width": 1080, "height": 1920},
    }


@pytest.fixture
def mock_ui_snapshot():
    """Mock UI snapshot."""
    return {
        "screen_hash": "abc123",
        "ui_elements": [
            {
                "resource_id": "home_icon",
                "text": "Home",
                "content_desc": "Home screen",
                "class": "ImageView",
            }
        ],
        "screenshot_summary": "Home screen with navigation",
    }


@pytest.fixture
def mock_phase_b_output():
    """Mock Phase B output."""
    return {
        "screen_type": "home",
        "confidence": 0.9,
        "candidate_targets": ["home_icon"],
        "blocker_flags": [],
        "reasoning_short": "Home screen",
    }


@pytest.fixture
def mock_phase_c_output():
    """Mock Phase C output."""
    return {
        "action": {"type": "tap", "params": {"element_key": "home_icon"}},
        "intent": "navigate_home",
        "expected_outcome": "reach home screen",
        "fallback_if_fail": "back",
    }


@pytest.fixture
def mock_phase_d_output():
    """Mock Phase D output."""
    return {
        "decision": "approve",
        "final_action": {"type": "tap", "params": {"element_key": "home_icon"}},
        "rejection_reason_or_null": None,
        "recovery_tag": "normal",
    }


# Test 7.1: Create scenario executor module
@patch("app.executors.scenario_executor.LLMClient")
def test_scenario_executor_initialization(mock_llm_client):
    """Test ScenarioExecutor can be initialized."""
    executor = ScenarioExecutor()
    assert executor is not None
    assert executor.llm_client is not None


# Test 7.5: Test single-goal scenario execution
@pytest.mark.asyncio
@patch("app.executors.scenario_executor.LLMClient")
async def test_single_goal_scenario_execution(
    mock_llm_client,
    sample_single_goal_scenario,
    sample_device_info,
    mock_ui_snapshot,
    mock_phase_b_output,
    mock_phase_c_output,
    mock_phase_d_output,
):
    """Test single-goal scenario execution, verify goal completes."""
    executor = ScenarioExecutor()
    
    # Mock callbacks
    ui_snapshot_callback = AsyncMock(return_value=mock_ui_snapshot)
    execute_action_callback = AsyncMock(return_value={"result": "ok"})
    progress_callback = AsyncMock()
    
    # Mock Phase B, C, D
    with patch.object(executor, "_call_phase_b", new=AsyncMock(return_value=mock_phase_b_output)), \
         patch.object(executor, "_call_phase_c", new=AsyncMock(return_value=mock_phase_c_output)), \
         patch.object(executor, "_call_phase_d", new=AsyncMock(return_value=mock_phase_d_output)), \
         patch.object(executor, "_generate_final_report", new=AsyncMock(return_value={"markdown_report": "# Report", "pass_fail_status": "pass"})):
        
        result = await executor.execute(
            scenario=sample_single_goal_scenario,
            device_info=sample_device_info,
            ui_snapshot_callback=ui_snapshot_callback,
            execute_action_callback=execute_action_callback,
            progress_callback=progress_callback,
        )
    
    # Verify result
    assert result["status"] == "pass"
    assert len(result["goal_results"]) == 1
    assert result["goal_results"][0]["status"] == "completed"
    assert result["coverage_percentage"] == 100.0


# Test 7.5: Test multi-goal scenario execution
@pytest.mark.asyncio
@patch("app.executors.scenario_executor.LLMClient")
async def test_multi_goal_scenario_execution(
    mock_llm_client,
    sample_multi_goal_scenario,
    sample_device_info,
):
    """Test multi-goal scenario execution, verify goals execute in order."""
    executor = ScenarioExecutor()
    
    # Track which goals were executed
    executed_goals = []
    
    async def mock_execute_goal(goal, state, device_info, ui_snapshot_callback, execute_action_callback, progress_callback):
        executed_goals.append(goal["id"])
        return {
            "goal_id": goal["id"],
            "status": "completed",
            "steps_taken": 5,
            "success_criteria_met": goal["success_criteria"],
            "success_criteria_pending": [],
            "findings": [],
            "screenshots": [],
            "actions_log": [],
            "started_at": int(time.time() * 1000),
            "completed_at": int(time.time() * 1000),
        }
    
    ui_snapshot_callback = AsyncMock()
    execute_action_callback = AsyncMock()
    
    with patch.object(executor, "execute_goal", new=mock_execute_goal), \
         patch.object(executor, "_generate_final_report", new=AsyncMock(return_value={"markdown_report": "# Report", "pass_fail_status": "pass"})):
        
        result = await executor.execute(
            scenario=sample_multi_goal_scenario,
            device_info=sample_device_info,
            ui_snapshot_callback=ui_snapshot_callback,
            execute_action_callback=execute_action_callback,
        )
    
    # Verify goals executed in order
    assert executed_goals == ["goal-1", "goal-2"]
    assert result["status"] == "pass"
    assert len(result["goal_results"]) == 2
    assert result["coverage_percentage"] == 100.0


# Test 7.5: Test scenario with stop_on_first_failure=true
@pytest.mark.asyncio
@patch("app.executors.scenario_executor.LLMClient")
async def test_scenario_stop_on_first_failure_true(mock_llm_client, sample_device_info):
    """Test scenario with stop_on_first_failure=true, verify halts on first failure."""
    scenario = {
        "id": "test-scenario-3",
        "name": "Stop on Failure Test",
        "description": "Test stop_on_first_failure=true",
        "app_name": "TestApp",
        "goals": [
            {
                "id": "goal-1",
                "description": "First goal (will fail)",
                "type": "navigate",
                "success_criteria": ["Screen type is 'home'"],
            },
            {
                "id": "goal-2",
                "description": "Second goal (should not execute)",
                "type": "navigate",
                "success_criteria": ["Screen type is 'settings'"],
            },
        ],
        "constraints": {
            "stop_on_first_failure": True,
        },
    }
    
    executor = ScenarioExecutor()
    executed_goals = []
    
    async def mock_execute_goal(goal, state, device_info, ui_snapshot_callback, execute_action_callback, progress_callback):
        executed_goals.append(goal["id"])
        # First goal fails
        if goal["id"] == "goal-1":
            return {
                "goal_id": goal["id"],
                "status": "failed",
                "steps_taken": 10,
                "success_criteria_met": [],
                "success_criteria_pending": goal["success_criteria"],
                "findings": [],
                "screenshots": [],
                "actions_log": [],
                "started_at": int(time.time() * 1000),
                "completed_at": int(time.time() * 1000),
            }
        # Second goal should not be reached
        return {
            "goal_id": goal["id"],
            "status": "completed",
            "steps_taken": 5,
            "success_criteria_met": goal["success_criteria"],
            "success_criteria_pending": [],
            "findings": [],
            "screenshots": [],
            "actions_log": [],
            "started_at": int(time.time() * 1000),
            "completed_at": int(time.time() * 1000),
        }
    
    ui_snapshot_callback = AsyncMock()
    execute_action_callback = AsyncMock()
    
    with patch.object(executor, "execute_goal", new=mock_execute_goal), \
         patch.object(executor, "_generate_final_report", new=AsyncMock(return_value={"markdown_report": "# Report", "pass_fail_status": "fail"})):
        
        result = await executor.execute(
            scenario=scenario,
            device_info=sample_device_info,
            ui_snapshot_callback=ui_snapshot_callback,
            execute_action_callback=execute_action_callback,
        )
    
    # Verify only first goal executed
    assert executed_goals == ["goal-1"]
    assert result["status"] == "fail"
    # Check goal results instead of top-level counters
    assert len(result["goal_results"]) == 1
    assert result["goal_results"][0]["status"] == "failed"


# Test 7.5: Test scenario with stop_on_first_failure=false
@pytest.mark.asyncio
@patch("app.executors.scenario_executor.LLMClient")
async def test_scenario_stop_on_first_failure_false(mock_llm_client, sample_device_info):
    """Test scenario with stop_on_first_failure=false, verify continues after failure."""
    scenario = {
        "id": "test-scenario-4",
        "name": "Continue on Failure Test",
        "description": "Test stop_on_first_failure=false",
        "app_name": "TestApp",
        "goals": [
            {
                "id": "goal-1",
                "description": "First goal (will fail)",
                "type": "navigate",
                "success_criteria": ["Screen type is 'home'"],
            },
            {
                "id": "goal-2",
                "description": "Second goal (should execute)",
                "type": "navigate",
                "success_criteria": ["Screen type is 'settings'"],
            },
        ],
        "constraints": {
            "stop_on_first_failure": False,
        },
    }
    
    executor = ScenarioExecutor()
    executed_goals = []
    
    async def mock_execute_goal(goal, state, device_info, ui_snapshot_callback, execute_action_callback, progress_callback):
        executed_goals.append(goal["id"])
        # First goal fails, second succeeds
        if goal["id"] == "goal-1":
            return {
                "goal_id": goal["id"],
                "status": "failed",
                "steps_taken": 10,
                "success_criteria_met": [],
                "success_criteria_pending": goal["success_criteria"],
                "findings": [],
                "screenshots": [],
                "actions_log": [],
                "started_at": int(time.time() * 1000),
                "completed_at": int(time.time() * 1000),
            }
        return {
            "goal_id": goal["id"],
            "status": "completed",
            "steps_taken": 5,
            "success_criteria_met": goal["success_criteria"],
            "success_criteria_pending": [],
            "findings": [],
            "screenshots": [],
            "actions_log": [],
            "started_at": int(time.time() * 1000),
            "completed_at": int(time.time() * 1000),
        }
    
    ui_snapshot_callback = AsyncMock()
    execute_action_callback = AsyncMock()
    
    with patch.object(executor, "execute_goal", new=mock_execute_goal), \
         patch.object(executor, "_generate_final_report", new=AsyncMock(return_value={"markdown_report": "# Report", "pass_fail_status": "partial"})):
        
        result = await executor.execute(
            scenario=scenario,
            device_info=sample_device_info,
            ui_snapshot_callback=ui_snapshot_callback,
            execute_action_callback=execute_action_callback,
        )
    
    # Verify both goals executed
    assert executed_goals == ["goal-1", "goal-2"]
    # When any goal fails, status is "fail" not "partial"
    assert result["status"] == "fail"
    # Check goal results
    assert len(result["goal_results"]) == 2
    assert result["goal_results"][0]["status"] == "failed"
    assert result["goal_results"][1]["status"] == "completed"


# Test 7.5: Test scenario with max_steps_per_goal constraint
@pytest.mark.asyncio
@patch("app.executors.scenario_executor.LLMClient")
async def test_scenario_max_steps_per_goal_constraint(
    mock_llm_client,
    sample_device_info,
    mock_ui_snapshot,
    mock_phase_b_output,
    mock_phase_c_output,
    mock_phase_d_output,
):
    """Test scenario with max_steps_per_goal constraint, verify enforced."""
    scenario = {
        "id": "test-scenario-5",
        "name": "Max Steps Test",
        "description": "Test max_steps_per_goal constraint",
        "app_name": "TestApp",
        "goals": [
            {
                "id": "goal-1",
                "description": "Reach home screen",
                "type": "navigate",
                "success_criteria": ["Screen type is 'home'"],  # Will never be met
            }
        ],
        "constraints": {
            "max_steps_per_goal": 3,  # Very low limit
        },
    }
    
    executor = ScenarioExecutor()
    
    # Mock callbacks
    ui_snapshot_callback = AsyncMock(return_value=mock_ui_snapshot)
    execute_action_callback = AsyncMock(return_value={"result": "ok"})
    
    # Mock Phase B to return non-home screen
    mock_phase_b_not_home = {**mock_phase_b_output, "screen_type": "login"}
    
    with patch.object(executor, "_call_phase_b", new=AsyncMock(return_value=mock_phase_b_not_home)), \
         patch.object(executor, "_call_phase_c", new=AsyncMock(return_value=mock_phase_c_output)), \
         patch.object(executor, "_call_phase_d", new=AsyncMock(return_value=mock_phase_d_output)), \
         patch.object(executor, "_generate_final_report", new=AsyncMock(return_value={"markdown_report": "# Report", "pass_fail_status": "fail"})):
        
        result = await executor.execute(
            scenario=scenario,
            device_info=sample_device_info,
            ui_snapshot_callback=ui_snapshot_callback,
            execute_action_callback=execute_action_callback,
        )
    
    # Verify goal failed due to max_steps
    assert result["status"] == "fail"
    assert result["goal_results"][0]["status"] == "failed"
    assert result["goal_results"][0]["steps_taken"] == 3  # Hit the limit


# Test 7.5: Test scenario with timeout constraint
@pytest.mark.asyncio
@patch("app.executors.scenario_executor.LLMClient")
async def test_scenario_timeout_constraint(
    mock_llm_client,
    sample_device_info,
    mock_ui_snapshot,
    mock_phase_b_output,
    mock_phase_c_output,
    mock_phase_d_output,
):
    """Test scenario with timeout constraint, verify enforced."""
    scenario = {
        "id": "test-scenario-6",
        "name": "Timeout Test",
        "description": "Test timeout constraint",
        "app_name": "TestApp",
        "goals": [
            {
                "id": "goal-1",
                "description": "Reach home screen",
                "type": "navigate",
                "success_criteria": ["Screen type is 'home'"],
            }
        ],
        "constraints": {
            "timeout_seconds": 1,  # Very short timeout
        },
    }
    
    executor = ScenarioExecutor()
    
    # Mock callbacks with delay
    async def slow_ui_snapshot():
        import asyncio
        await asyncio.sleep(0.5)  # Each call takes 0.5s
        return mock_ui_snapshot
    
    ui_snapshot_callback = slow_ui_snapshot
    execute_action_callback = AsyncMock(return_value={"result": "ok"})
    
    # Mock Phase B to return non-home screen
    mock_phase_b_not_home = {**mock_phase_b_output, "screen_type": "login"}
    
    with patch.object(executor, "_call_phase_b", new=AsyncMock(return_value=mock_phase_b_not_home)), \
         patch.object(executor, "_call_phase_c", new=AsyncMock(return_value=mock_phase_c_output)), \
         patch.object(executor, "_call_phase_d", new=AsyncMock(return_value=mock_phase_d_output)), \
         patch.object(executor, "_generate_final_report", new=AsyncMock(return_value={"markdown_report": "# Report", "pass_fail_status": "fail"})):
        
        result = await executor.execute(
            scenario=scenario,
            device_info=sample_device_info,
            ui_snapshot_callback=ui_snapshot_callback,
            execute_action_callback=execute_action_callback,
        )
    
    # Verify goal failed due to timeout
    assert result["status"] == "fail"
    assert result["goal_results"][0]["status"] == "failed"


# Test 7.5: Test execution state persistence
@pytest.mark.asyncio
@patch("app.executors.scenario_executor.LLMClient")
async def test_execution_state_persistence(
    mock_llm_client,
    sample_single_goal_scenario,
    sample_device_info,
    mock_ui_snapshot,
    mock_phase_b_output,
    mock_phase_c_output,
    mock_phase_d_output,
):
    """Test execution state persistence, verify state saved after each action."""
    executor = ScenarioExecutor()
    
    # Track state persistence calls
    persistence_calls = []
    
    async def mock_execute_goal_with_persistence(goal, state, device_info, ui_snapshot_callback, execute_action_callback, progress_callback):
        # Simulate 3 steps
        for step in range(3):
            persistence_calls.append({
                "run_id": state["run_id"],
                "step": step,
                "goal_id": goal["id"],
            })
        
        return {
            "goal_id": goal["id"],
            "status": "completed",
            "steps_taken": 3,
            "success_criteria_met": goal["success_criteria"],
            "success_criteria_pending": [],
            "findings": [],
            "screenshots": [],
            "actions_log": [],
            "started_at": int(time.time() * 1000),
            "completed_at": int(time.time() * 1000),
        }
    
    ui_snapshot_callback = AsyncMock()
    execute_action_callback = AsyncMock()
    
    with patch.object(executor, "execute_goal", new=mock_execute_goal_with_persistence), \
         patch.object(executor, "_generate_final_report", new=AsyncMock(return_value={"markdown_report": "# Report", "pass_fail_status": "pass"})):
        
        result = await executor.execute(
            scenario=sample_single_goal_scenario,
            device_info=sample_device_info,
            ui_snapshot_callback=ui_snapshot_callback,
            execute_action_callback=execute_action_callback,
        )
    
    # Verify state was persisted during execution
    assert len(persistence_calls) == 3
    assert all(call["run_id"] == result["run_id"] for call in persistence_calls)


# Test scenario validation
@patch("app.executors.scenario_executor.LLMClient")
def test_validate_scenario_valid(mock_llm_client):
    """Test scenario validation with valid scenario."""
    executor = ScenarioExecutor()
    
    scenario = {
        "id": "test-1",
        "name": "Test Scenario",
        "goals": [
            {
                "id": "goal-1",
                "description": "Test goal",
                "success_criteria": ["Criterion 1"],
            }
        ],
    }
    
    result = executor._validate_scenario(scenario)
    assert result["valid"] is True
    assert len(result["errors"]) == 0


@patch("app.executors.scenario_executor.LLMClient")
def test_validate_scenario_missing_id(mock_llm_client):
    """Test scenario validation with missing id."""
    executor = ScenarioExecutor()
    
    scenario = {
        "name": "Test Scenario",
        "goals": [],
    }
    
    result = executor._validate_scenario(scenario)
    assert result["valid"] is False
    assert "Missing scenario id" in result["errors"]


@patch("app.executors.scenario_executor.LLMClient")
def test_validate_scenario_missing_goals(mock_llm_client):
    """Test scenario validation with missing goals."""
    executor = ScenarioExecutor()
    
    scenario = {
        "id": "test-1",
        "name": "Test Scenario",
    }
    
    result = executor._validate_scenario(scenario)
    assert result["valid"] is False
    assert "Missing scenario goals" in result["errors"]


@patch("app.executors.scenario_executor.LLMClient")
def test_validate_scenario_empty_goals(mock_llm_client):
    """Test scenario validation with empty goals array."""
    executor = ScenarioExecutor()
    
    scenario = {
        "id": "test-1",
        "name": "Test Scenario",
        "goals": [],
    }
    
    result = executor._validate_scenario(scenario)
    assert result["valid"] is False
    # The error message is "Missing scenario goals" not "Scenario must have at least one goal"
    assert "Missing scenario goals" in result["errors"]


@patch("app.executors.scenario_executor.LLMClient")
def test_validate_scenario_goal_missing_success_criteria(mock_llm_client):
    """Test scenario validation with goal missing success_criteria."""
    executor = ScenarioExecutor()
    
    scenario = {
        "id": "test-1",
        "name": "Test Scenario",
        "goals": [
            {
                "id": "goal-1",
                "description": "Test goal",
                # Missing success_criteria
            }
        ],
    }
    
    result = executor._validate_scenario(scenario)
    assert result["valid"] is False
    assert any("success_criteria" in error for error in result["errors"])


# Test state initialization
@patch("app.executors.scenario_executor.LLMClient")
def test_initialize_execution_state(mock_llm_client):
    """Test execution state initialization."""
    executor = ScenarioExecutor()
    
    scenario = {
        "id": "test-1",
        "name": "Test Scenario",
        "goals": [],
    }
    
    run_id = "test-run-1"
    started_at = 1234567890
    
    state = executor._initialize_execution_state(run_id, scenario, started_at)
    
    assert state["run_id"] == run_id
    assert state["scenario"] == scenario
    assert state["current_goal_index"] == 0
    assert state["goal_progress"] == {}
    assert isinstance(state["seen_element_keys"], set)
    assert len(state["seen_element_keys"]) == 0
    assert state["seen_hash_counts"] == {}
    assert isinstance(state["completed_screens"], set)
    assert state["loop_count"] == 0
    assert state["no_element_count"] == 0
    assert state["recent_actions"] == []
    assert state["failure_streak"] == 0
    assert state["goals_completed"] == 0
    assert state["goals_failed"] == 0
    assert state["started_at"] == started_at


# Test state management updates
@patch("app.executors.scenario_executor.LLMClient")
def test_update_state_management(mock_llm_client):
    """Test state management updates after action execution."""
    executor = ScenarioExecutor()
    
    state = {
        "seen_element_keys": set(),
        "seen_hash_counts": {},
        "loop_count": 0,
        "no_element_count": 0,
        "completed_screens": set(),
    }
    
    ui_snapshot = {
        "screen_hash": "abc123",
        "ui_elements": [{"resource_id": "button1"}],
    }
    
    action = {
        "type": "tap",
        "params": {"element_key": "button1::100,200"},
    }
    
    # First visit to screen
    executor._update_state_management(state, ui_snapshot, action)
    
    assert "button1::100,200" in state["seen_element_keys"]
    assert state["seen_hash_counts"]["abc123"] == 1
    assert state["loop_count"] == 0  # First visit
    assert state["no_element_count"] == 0  # Has elements
    
    # Second visit to same screen
    executor._update_state_management(state, ui_snapshot, action)
    
    assert state["seen_hash_counts"]["abc123"] == 2
    assert state["loop_count"] == 1  # Revisit detected


@patch("app.executors.scenario_executor.LLMClient")
def test_update_state_management_no_elements(mock_llm_client):
    """Test state management with no UI elements."""
    executor = ScenarioExecutor()
    
    state = {
        "seen_element_keys": set(),
        "seen_hash_counts": {},
        "loop_count": 0,
        "no_element_count": 0,
        "completed_screens": set(),
    }
    
    ui_snapshot = {
        "screen_hash": "empty123",
        "ui_elements": [],  # No elements
    }
    
    action = {"type": "wait_ms", "params": {}}
    
    executor._update_state_management(state, ui_snapshot, action)
    
    assert state["no_element_count"] == 1
    
    # Second call
    executor._update_state_management(state, ui_snapshot, action)
    assert state["no_element_count"] == 2


# Test result creation
@patch("app.executors.scenario_executor.LLMClient")
def test_create_scenario_result_all_pass(mock_llm_client):
    """Test scenario result creation when all goals pass."""
    executor = ScenarioExecutor()
    
    scenario = {
        "id": "test-1",
        "name": "Test Scenario",
        "goals": [
            {"id": "goal-1", "description": "Goal 1"},
            {"id": "goal-2", "description": "Goal 2"},
        ],
    }
    
    execution_state = {
        "run_id": "run-1",
        "scenario": scenario,
        "goals_completed": 2,
        "goals_failed": 0,
        "total_findings": [],
        "started_at": 1000,
        "completed_at": 2000,
        "goal_progress": {
            "goal-1": {"steps_taken": 5, "status": "completed"},
            "goal-2": {"steps_taken": 3, "status": "completed"},
        },
    }
    
    final_report = {
        "markdown_report": "# Report",
        "pass_fail_status": "pass",
    }
    
    result = executor._create_scenario_result(
        run_id="run-1",
        scenario=scenario,
        execution_state=execution_state,
        final_report=final_report,
    )
    
    assert result["status"] == "pass"
    assert result["coverage_percentage"] == 100.0
    assert result["total_steps"] == 8  # 5 + 3


@patch("app.executors.scenario_executor.LLMClient")
def test_create_scenario_result_partial(mock_llm_client):
    """Test scenario result creation with partial completion."""
    executor = ScenarioExecutor()
    
    scenario = {
        "id": "test-1",
        "name": "Test Scenario",
        "goals": [
            {"id": "goal-1", "description": "Goal 1"},
            {"id": "goal-2", "description": "Goal 2"},
        ],
    }
    
    execution_state = {
        "run_id": "run-1",
        "scenario": scenario,
        "goals_completed": 1,
        "goals_failed": 1,
        "total_findings": [],
        "started_at": 1000,
        "completed_at": 2000,
        "goal_progress": {
            "goal-1": {"steps_taken": 5, "status": "completed"},
            "goal-2": {"steps_taken": 10, "status": "failed"},
        },
    }
    
    final_report = {
        "markdown_report": "# Report",
        "pass_fail_status": "partial",
    }
    
    result = executor._create_scenario_result(
        run_id="run-1",
        scenario=scenario,
        execution_state=execution_state,
        final_report=final_report,
    )
    
    assert result["status"] == "fail"  # Any failure = fail
    assert result["coverage_percentage"] == 50.0


# Test failure result creation
@patch("app.executors.scenario_executor.LLMClient")
def test_create_failure_result(mock_llm_client):
    """Test failure result creation."""
    executor = ScenarioExecutor()
    
    scenario = {"id": "test-1", "name": "Test Scenario", "goals": []}
    execution_state = {"started_at": 1000}
    
    result = executor._create_failure_result(
        run_id="run-1",
        scenario=scenario,
        execution_state=execution_state,
        error_message="Validation failed",
    )
    
    assert result["status"] == "fail"
    assert result["coverage_percentage"] == 0
    assert len(result["findings"]) == 1
    assert result["findings"][0]["message"] == "Validation failed"
