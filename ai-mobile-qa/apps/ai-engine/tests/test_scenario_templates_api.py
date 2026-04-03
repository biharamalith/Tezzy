"""
Tests for scenario templates API endpoint.

Requirements: 18.1, 18.2, 18.3
"""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client():
    """Create test client"""
    app = create_app()
    return TestClient(app)


def test_get_scenario_templates(client):
    """
    Test GET /v1/scenario/templates returns at least 8 templates.
    
    Requirements: 18.1, 18.2, 18.3
    """
    response = client.get("/v1/scenario/templates")
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify response structure
    assert "templates" in data
    assert isinstance(data["templates"], list)
    
    # Verify at least 8 templates (Requirement 18.3)
    assert len(data["templates"]) >= 8


def test_template_has_required_fields(client):
    """
    Test that each template has all required fields.
    
    Requirements: 18.1, 18.2
    """
    response = client.get("/v1/scenario/templates")
    
    assert response.status_code == 200
    data = response.json()
    
    templates = data["templates"]
    assert len(templates) > 0
    
    # Check each template has required fields
    for template in templates:
        assert "id" in template
        assert "name" in template
        assert "description" in template
        assert "goal_types" in template
        assert "estimated_steps" in template
        
        # Verify field types
        assert isinstance(template["id"], str)
        assert isinstance(template["name"], str)
        assert isinstance(template["description"], str)
        assert isinstance(template["goal_types"], list)
        assert isinstance(template["estimated_steps"], int)
        
        # Verify non-empty values
        assert len(template["id"]) > 0
        assert len(template["name"]) > 0
        assert len(template["description"]) > 0
        assert len(template["goal_types"]) > 0
        assert template["estimated_steps"] > 0


def test_templates_are_valid_scenarios(client):
    """
    Test that templates can be validated as valid scenarios.
    
    Requirements: 18.3
    """
    # Get templates
    templates_response = client.get("/v1/scenario/templates")
    assert templates_response.status_code == 200
    templates_data = templates_response.json()
    
    # Load full template data from file to validate
    import json
    import os
    
    templates_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "app",
        "templates",
        "scenarios.json"
    )
    
    with open(templates_path, "r") as f:
        full_templates = json.load(f)
    
    # Validate each template
    for template in full_templates["templates"]:
        # Build a complete scenario from the template
        scenario = {
            "id": template["id"],
            "name": template["name"],
            "description": template["description"],
            "goals": template["goals"],
        }
        
        # Add credentials if any goal is login type
        has_login = any(g.get("type") == "login" for g in template["goals"])
        if has_login:
            scenario["credentials"] = {
                "email": "test@example.com",
                "password": "Test123!"
            }
        
        # Validate the scenario
        validation_response = client.post(
            "/v1/scenario/validate",
            json={"scenario": scenario}
        )
        
        assert validation_response.status_code == 200
        validation_data = validation_response.json()
        
        # Template should be valid
        assert validation_data["valid"] is True, \
            f"Template {template['id']} is not valid: {validation_data.get('errors', [])}"


def test_template_goal_types_extracted_correctly(client):
    """
    Test that goal_types are correctly extracted from template goals.
    
    Requirements: 18.2
    """
    response = client.get("/v1/scenario/templates")
    
    assert response.status_code == 200
    data = response.json()
    
    templates = data["templates"]
    
    # Find specific templates and verify their goal types
    basic_login = next((t for t in templates if t["id"] == "basic-login"), None)
    assert basic_login is not None
    assert basic_login["goal_types"] == ["login"]
    
    login_logout = next((t for t in templates if t["id"] == "login-logout"), None)
    assert login_logout is not None
    assert login_logout["goal_types"] == ["login", "navigate"]
    
    form_submission = next((t for t in templates if t["id"] == "form-submission"), None)
    assert form_submission is not None
    assert form_submission["goal_types"] == ["navigate", "form_fill"]
    
    navigation_tour = next((t for t in templates if t["id"] == "navigation-tour"), None)
    assert navigation_tour is not None
    assert navigation_tour["goal_types"] == ["navigate", "navigate", "navigate", "navigate"]


def test_template_estimated_steps_present(client):
    """
    Test that each template has estimated_steps field.
    
    Requirements: 18.2
    """
    response = client.get("/v1/scenario/templates")
    
    assert response.status_code == 200
    data = response.json()
    
    templates = data["templates"]
    
    for template in templates:
        assert "estimated_steps" in template
        assert isinstance(template["estimated_steps"], int)
        assert template["estimated_steps"] > 0


def test_all_expected_templates_present(client):
    """
    Test that all 8 expected templates are present.
    
    Requirements: 18.3
    """
    response = client.get("/v1/scenario/templates")
    
    assert response.status_code == 200
    data = response.json()
    
    templates = data["templates"]
    template_ids = [t["id"] for t in templates]
    
    # Verify all expected templates are present
    expected_templates = [
        "basic-login",
        "login-logout",
        "form-submission",
        "navigation-tour",
        "settings-verification",
        "search-flow",
        "cart-checkout",
        "profile-update"
    ]
    
    for expected_id in expected_templates:
        assert expected_id in template_ids, f"Template {expected_id} not found"


def test_template_names_are_descriptive(client):
    """
    Test that template names match expected patterns.
    
    Requirements: 18.2
    """
    response = client.get("/v1/scenario/templates")
    
    assert response.status_code == 200
    data = response.json()
    
    templates = data["templates"]
    
    # Verify specific template names
    template_names = {t["id"]: t["name"] for t in templates}
    
    assert template_names["basic-login"] == "Basic Login"
    assert template_names["login-logout"] == "Login + Logout"
    assert template_names["form-submission"] == "Form Submission"
    assert template_names["navigation-tour"] == "Navigation Tour"
    assert template_names["settings-verification"] == "Settings Verification"
    assert template_names["search-flow"] == "Search Flow"
    assert template_names["cart-checkout"] == "Cart Checkout"
    assert template_names["profile-update"] == "Profile Update"


def test_template_descriptions_are_present(client):
    """
    Test that all templates have non-empty descriptions.
    
    Requirements: 18.2
    """
    response = client.get("/v1/scenario/templates")
    
    assert response.status_code == 200
    data = response.json()
    
    templates = data["templates"]
    
    for template in templates:
        assert "description" in template
        assert isinstance(template["description"], str)
        assert len(template["description"]) > 0
        # Description should be reasonably descriptive (at least 20 chars)
        assert len(template["description"]) >= 20


def test_templates_cover_common_patterns(client):
    """
    Test that templates cover common mobile testing patterns.
    
    Requirements: 18.3
    """
    response = client.get("/v1/scenario/templates")
    
    assert response.status_code == 200
    data = response.json()
    
    templates = data["templates"]
    all_goal_types = []
    
    for template in templates:
        all_goal_types.extend(template["goal_types"])
    
    # Verify common goal types are covered
    assert "login" in all_goal_types
    assert "navigate" in all_goal_types
    assert "form_fill" in all_goal_types
    assert "verify" in all_goal_types
    
    # Verify we have templates with different complexities
    single_goal_templates = [t for t in templates if len(t["goal_types"]) == 1]
    multi_goal_templates = [t for t in templates if len(t["goal_types"]) > 1]
    
    assert len(single_goal_templates) > 0, "Should have at least one single-goal template"
    assert len(multi_goal_templates) > 0, "Should have at least one multi-goal template"
