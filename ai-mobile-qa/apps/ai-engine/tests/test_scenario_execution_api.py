"""
Tests for scenario execution API endpoints.

Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock, MagicMock

from app.main import create_app


@pytest.fixture
def client():
    """Create test client"""
    app = create_app()
    return TestClient(app)


@pytest.fixture
def valid_scenario():
    """Valid test scenario"""
    return {
        "id": "test-login",
        "name": "Test Login",
        "description": "Test login flow",
        "goals": [
            {
                "id": "goal-1",
                "description": "Login with valid credentials",
                "type": "login",
                "success_criteria": ["Reach home screen"],
                "hints": {
                    "expected_screens": ["login", "home"]
                }
            }
        ],
        "credentials": {
            "email": "test@example.com",
            "password": "Test123!"
        }
    }


@pytest.fixture
def invalid_scenario():
    """Invalid test scenario (missing required fields)"""
    return {
        "name": "Invalid Scenario",
        "description": "Missing id and goals"
    }


@pytest.fixture
def device_info():
    """Test device info"""
    return {
        "serial": "test-device",
        "screen_size": {
            "width": 1080,
            "height": 1920
        }
    }


def test_scenario_execute_with_valid_scenario(client, valid_scenario, device_info):
    """
    Test POST /v1/scenario/execute with valid scenario.
    
    Requirements: 16.1, 16.2, 16.3
    """
    response = client.post(
        "/v1/scenario/execute",
        json={
            "scenario": valid_scenario,
            "device_info": device_info
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify run_id returned
    assert "run_id" in data
    assert data["run_id"] is not None
    assert len(data["run_id"]) > 0
    
    # Verify initial status
    assert data["status"] == "running"
    assert data["current_goal_index"] == 0
    assert data["goal_results"] == []


def test_scenario_execute_with_invalid_scenario(client, invalid_scenario, device_info):
    """
    Test POST /v1/scenario/execute with invalid scenario.
    
    Requirements: 16.4
    """
    response = client.post(
        "/v1/scenario/execute",
        json={
            "scenario": invalid_scenario,
            "device_info": device_info
        }
    )
    
    # Should return validation error (422 for Pydantic validation)
    assert response.status_code == 422
    data = response.json()
    
    assert "detail" in data


def test_scenario_status_endpoint(client, valid_scenario, device_info):
    """
    Test GET /v1/scenario/execute/{run_id}/status.
    
    Requirements: 16.5
    """
    # First, start a scenario execution
    execute_response = client.post(
        "/v1/scenario/execute",
        json={
            "scenario": valid_scenario,
            "device_info": device_info
        }
    )
    
    assert execute_response.status_code == 200
    run_id = execute_response.json()["run_id"]
    
    # Now check status
    status_response = client.get(f"/v1/scenario/execute/{run_id}/status")
    
    assert status_response.status_code == 200
    data = status_response.json()
    
    # Verify status response structure
    assert data["run_id"] == run_id
    assert "status" in data
    assert "current_goal_index" in data
    assert "goal_results" in data
    assert "findings_count" in data
    assert isinstance(data["goal_results"], list)
    assert isinstance(data["findings_count"], int)


def test_scenario_status_not_found(client):
    """
    Test GET /v1/scenario/execute/{run_id}/status with non-existent run_id.
    
    Requirements: 16.5
    """
    response = client.get("/v1/scenario/execute/non-existent-run-id/status")
    
    assert response.status_code == 404
    data = response.json()
    assert "detail" in data


@patch("app.api.v1.ScenarioExecutor")
def test_scenario_execute_validation_error(mock_executor_class, client, valid_scenario, device_info):
    """
    Test scenario execution with validation error.
    
    Requirements: 16.4
    """
    # Mock executor to return validation error
    mock_executor = MagicMock()
    mock_executor._validate_scenario.return_value = {
        "valid": False,
        "errors": ["Missing required field: id"]
    }
    mock_executor_class.return_value = mock_executor
    
    response = client.post(
        "/v1/scenario/execute",
        json={
            "scenario": valid_scenario,
            "device_info": device_info
        }
    )
    
    assert response.status_code == 400
    data = response.json()
    assert "detail" in data
    assert "errors" in data["detail"]


def test_scenario_execute_returns_immediately(client, valid_scenario, device_info):
    """
    Test that scenario execution returns immediately without waiting for completion.
    
    Requirements: 16.2, 16.3
    """
    import time
    
    start_time = time.time()
    response = client.post(
        "/v1/scenario/execute",
        json={
            "scenario": valid_scenario,
            "device_info": device_info
        }
    )
    elapsed_time = time.time() - start_time
    
    # Should return quickly (< 2 seconds, allowing for async task creation)
    assert elapsed_time < 2.0
    assert response.status_code == 200
    
    # Should have run_id and running status
    data = response.json()
    assert data["status"] == "running"
    assert "run_id" in data


def test_scenario_status_includes_final_report_when_complete(client):
    """
    Test that status endpoint includes final report when execution is complete.
    
    Requirements: 16.5
    """
    # This test would need to wait for execution to complete
    # For now, we'll test the structure by manually setting up the state
    from app.api.v1 import active_runs
    
    test_run_id = "test-complete-run"
    active_runs[test_run_id] = {
        "run_id": test_run_id,
        "status": "pass",
        "current_goal_index": 1,
        "goal_results": [
            {
                "goal_id": "goal-1",
                "status": "completed",
                "steps_taken": 5,
                "success_criteria_met": ["Reach home screen"],
                "success_criteria_pending": []
            }
        ],
        "findings_count": 0,
        "final_report": {
            "markdown_report": "# Test Report",
            "executive_summary": "All goals passed",
            "pass_fail_status": "pass"
        }
    }
    
    response = client.get(f"/v1/scenario/execute/{test_run_id}/status")
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify final report is included
    assert data["final_report"] is not None
    assert "markdown_report" in data["final_report"]
    assert "executive_summary" in data["final_report"]
    assert "pass_fail_status" in data["final_report"]
    
    # Clean up
    del active_runs[test_run_id]


def test_scenario_status_no_final_report_when_running(client, valid_scenario, device_info):
    """
    Test that status endpoint does not include final report when still running.
    
    Requirements: 16.5
    """
    # Start execution
    execute_response = client.post(
        "/v1/scenario/execute",
        json={
            "scenario": valid_scenario,
            "device_info": device_info
        }
    )
    
    run_id = execute_response.json()["run_id"]
    
    # Check status immediately (should still be running)
    status_response = client.get(f"/v1/scenario/execute/{run_id}/status")
    
    assert status_response.status_code == 200
    data = status_response.json()
    
    # Final report should be None when running
    if data["status"] == "running":
        assert data["final_report"] is None
