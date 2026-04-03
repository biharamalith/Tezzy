"""
Tests for scenario validation API endpoint.

Requirements: 17.1, 17.2, 17.3, 17.4
"""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client():
    """Create test client"""
    app = create_app()
    return TestClient(app)


@pytest.fixture
def valid_scenario():
    """Valid test scenario with all required fields"""
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
def invalid_scenario_missing_fields():
    """Invalid scenario missing required fields"""
    return {
        "name": "Invalid Scenario",
        "description": "Missing id and goals"
    }


@pytest.fixture
def scenario_login_without_credentials():
    """Scenario with login goal but no credentials"""
    return {
        "id": "test-login-no-creds",
        "name": "Login Without Credentials",
        "description": "Login goal without credentials",
        "goals": [
            {
                "id": "goal-1",
                "description": "Login with valid credentials",
                "type": "login",
                "success_criteria": ["Reach home screen"]
            }
        ]
    }


@pytest.fixture
def scenario_form_fill_without_data():
    """Scenario with form_fill goal but no form_data"""
    return {
        "id": "test-form-no-data",
        "name": "Form Fill Without Data",
        "description": "Form fill goal without form_data",
        "goals": [
            {
                "id": "goal-1",
                "description": "Fill registration form",
                "type": "form_fill",
                "success_criteria": ["Form submitted successfully"]
            }
        ],
        "credentials": {
            "email": "test@example.com",
            "password": "Test123!"
        }
    }


@pytest.fixture
def multi_goal_scenario():
    """Valid scenario with multiple goals of different types"""
    return {
        "id": "test-multi-goal",
        "name": "Multi-Goal Scenario",
        "description": "Test multiple goal types",
        "goals": [
            {
                "id": "goal-1",
                "description": "Login",
                "type": "login",
                "success_criteria": ["Reach home screen"]
            },
            {
                "id": "goal-2",
                "description": "Navigate to settings",
                "type": "navigate",
                "success_criteria": ["Settings screen visible"]
            },
            {
                "id": "goal-3",
                "description": "Update profile",
                "type": "form_fill",
                "success_criteria": ["Profile updated"],
                "form_data": {
                    "name": "Test User",
                    "bio": "Test bio"
                }
            },
            {
                "id": "goal-4",
                "description": "Verify settings",
                "type": "verify",
                "success_criteria": ["All settings visible"]
            },
            {
                "id": "goal-5",
                "description": "Explore catalog",
                "type": "explore_section",
                "success_criteria": ["Visited 3 products"]
            }
        ],
        "credentials": {
            "email": "test@example.com",
            "password": "Test123!"
        }
    }


def test_validate_valid_scenario(client, valid_scenario):
    """
    Test POST /v1/scenario/validate with valid scenario.
    Verify valid=true and estimates returned.
    
    Requirements: 17.1, 17.2, 17.3
    """
    response = client.post(
        "/v1/scenario/validate",
        json={"scenario": valid_scenario}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify validation passed
    assert data["valid"] is True
    assert data["errors"] == []
    
    # Verify estimates returned
    assert "estimated_steps" in data
    assert "estimated_duration_seconds" in data
    assert data["estimated_steps"] > 0
    assert data["estimated_duration_seconds"] > 0
    
    # For a single login goal, expect ~7 steps
    assert data["estimated_steps"] == 7
    # Duration should be steps * 2 seconds
    assert data["estimated_duration_seconds"] == 14


def test_validate_invalid_scenario_missing_fields(client, invalid_scenario_missing_fields):
    """
    Test POST /v1/scenario/validate with invalid scenario (missing required fields).
    Verify errors returned.
    
    Requirements: 17.2, 17.4
    """
    response = client.post(
        "/v1/scenario/validate",
        json={"scenario": invalid_scenario_missing_fields}
    )
    
    # Pydantic validation will catch this before our custom validation
    # So we expect 422 (Unprocessable Entity) for schema validation errors
    assert response.status_code == 422
    data = response.json()
    
    # Verify error details are present
    assert "detail" in data


def test_validate_login_goal_without_credentials(client, scenario_login_without_credentials):
    """
    Test POST /v1/scenario/validate with login goal but no credentials.
    Verify validation error.
    
    Requirements: 17.2, 17.4
    """
    response = client.post(
        "/v1/scenario/validate",
        json={"scenario": scenario_login_without_credentials}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify validation failed
    assert data["valid"] is False
    assert len(data["errors"]) > 0
    
    # Check for credential-related error
    errors_str = " ".join(data["errors"])
    assert "credential" in errors_str.lower() or "login" in errors_str.lower()


def test_validate_form_fill_goal_without_form_data(client, scenario_form_fill_without_data):
    """
    Test POST /v1/scenario/validate with form_fill goal but no form_data.
    Verify validation error.
    
    Requirements: 17.2, 17.4
    """
    response = client.post(
        "/v1/scenario/validate",
        json={"scenario": scenario_form_fill_without_data}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify validation failed
    assert data["valid"] is False
    assert len(data["errors"]) > 0
    
    # Check for form_data-related error
    errors_str = " ".join(data["errors"])
    assert "form_data" in errors_str.lower() or "form_fill" in errors_str.lower()


def test_validate_multi_goal_scenario_estimates(client, multi_goal_scenario):
    """
    Test POST /v1/scenario/validate with multiple goals.
    Verify estimates are calculated correctly based on goal types.
    
    Requirements: 17.3
    """
    response = client.post(
        "/v1/scenario/validate",
        json={"scenario": multi_goal_scenario}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify validation passed
    assert data["valid"] is True
    assert data["errors"] == []
    
    # Calculate expected steps:
    # login: 7, navigate: 5, form_fill: 10, verify: 3, explore_section: 15
    # Total: 7 + 5 + 10 + 3 + 15 = 40
    expected_steps = 40
    expected_duration = expected_steps * 2
    
    assert data["estimated_steps"] == expected_steps
    assert data["estimated_duration_seconds"] == expected_duration


def test_validate_scenario_missing_goal_id(client):
    """
    Test validation with goal missing id field.
    
    Requirements: 17.2, 17.4
    """
    scenario = {
        "id": "test-scenario",
        "name": "Test Scenario",
        "description": "Test",
        "goals": [
            {
                # Missing "id" field
                "description": "Test goal",
                "type": "custom",
                "success_criteria": ["Complete"]
            }
        ]
    }
    
    response = client.post(
        "/v1/scenario/validate",
        json={"scenario": scenario}
    )
    
    # Pydantic validation will catch this before our custom validation
    assert response.status_code == 422
    data = response.json()
    
    assert "detail" in data


def test_validate_scenario_missing_success_criteria(client):
    """
    Test validation with goal missing success_criteria.
    
    Requirements: 17.2, 17.4
    """
    scenario = {
        "id": "test-scenario",
        "name": "Test Scenario",
        "description": "Test",
        "goals": [
            {
                "id": "goal-1",
                "description": "Test goal",
                "type": "custom",
                # Missing "success_criteria" field
            }
        ]
    }
    
    response = client.post(
        "/v1/scenario/validate",
        json={"scenario": scenario}
    )
    
    # Pydantic validation will catch this before our custom validation
    assert response.status_code == 422
    data = response.json()
    
    assert "detail" in data


def test_validate_scenario_empty_success_criteria(client):
    """
    Test validation with goal having empty success_criteria array.
    
    Requirements: 17.2, 17.4
    """
    scenario = {
        "id": "test-scenario",
        "name": "Test Scenario",
        "description": "Test",
        "goals": [
            {
                "id": "goal-1",
                "description": "Test goal",
                "type": "custom",
                "success_criteria": []  # Empty array
            }
        ]
    }
    
    response = client.post(
        "/v1/scenario/validate",
        json={"scenario": scenario}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["valid"] is False
    assert len(data["errors"]) > 0
    assert any("success" in error.lower() for error in data["errors"])


def test_validate_scenario_with_warnings(client, valid_scenario):
    """
    Test that warnings field is included in response.
    
    Requirements: 17.3
    """
    response = client.post(
        "/v1/scenario/validate",
        json={"scenario": valid_scenario}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify warnings field exists (even if empty)
    assert "warnings" in data
    assert isinstance(data["warnings"], list)


def test_validate_scenario_estimates_for_different_goal_types(client):
    """
    Test that different goal types produce different step estimates.
    
    Requirements: 17.3
    """
    # Test each goal type individually
    goal_types_and_estimates = [
        ("login", 7),
        ("navigate", 5),
        ("form_fill", 10),
        ("verify", 3),
        ("explore_section", 15),
        ("custom", 7),
    ]
    
    for goal_type, expected_steps in goal_types_and_estimates:
        scenario = {
            "id": f"test-{goal_type}",
            "name": f"Test {goal_type}",
            "description": f"Test {goal_type} goal",
            "goals": [
                {
                    "id": "goal-1",
                    "description": f"Test {goal_type}",
                    "type": goal_type,
                    "success_criteria": ["Complete"],
                }
            ]
        }
        
        # Add required fields for specific goal types
        if goal_type == "login":
            scenario["credentials"] = {
                "email": "test@example.com",
                "password": "Test123!"
            }
        elif goal_type == "form_fill":
            scenario["goals"][0]["form_data"] = {"field": "value"}
        
        response = client.post(
            "/v1/scenario/validate",
            json={"scenario": scenario}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["valid"] is True
        assert data["estimated_steps"] == expected_steps
        assert data["estimated_duration_seconds"] == expected_steps * 2
