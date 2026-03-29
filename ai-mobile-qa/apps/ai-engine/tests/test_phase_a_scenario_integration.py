"""
Tests for Phase A (Session Bootstrap) scenario integration.

This module tests the enhanced Phase A functionality that consumes scenario context
and extracts credentials, mode, home_markers, and flow_hints from scenarios.

Requirements tested:
- 5.1: Extract credentials from scenario.credentials
- 5.2: Set mode to "reach_home" for login goals
- 5.3: Set mode to "explore" for non-login goals
- 5.7: Initialize in autonomous mode when no scenario provided
"""

import pytest
from app.schemas.session_bootstrap import (
    Credentials,
    GoalHints,
    Scenario,
    ScenarioCredentials,
    ScenarioGoal,
    SessionBootstrapInput,
)
from app.graphs.session_manager import build_phase_a_user_messages


class TestPhaseAScenarioIntegration:
    """Test Phase A scenario integration"""

    def test_scenario_with_login_goal_extracts_credentials(self):
        """Test that Phase A extracts credentials from scenario.credentials"""
        # Arrange
        scenario = Scenario(
            id="test-login",
            name="Login Test",
            description="Test login flow",
            goals=[
                ScenarioGoal(
                    id="goal-1",
                    description="Complete login",
                    type="login",
                    success_criteria=["Reach home screen"],
                    hints=GoalHints(expected_screens=["login", "home"]),
                )
            ],
            credentials=ScenarioCredentials(
                email="test@example.com",
                password="Test123!"
            ),
        )
        
        input_data = SessionBootstrapInput(
            app_name="TestApp",
            platform="android",
            max_steps=100,
            credentials=Credentials(
                email="fallback@example.com",
                password="Fallback123!"
            ),
            home_markers=["Home", "Dashboard"],
            scenario=scenario,
        )

        # Act
        messages = build_phase_a_user_messages(input_data)
        prompt = messages[0]

        # Assert
        assert "test@example.com" in prompt
        assert "Test123!" in prompt
        assert "fallback@example.com" not in prompt  # Should use scenario credentials
        assert "SCENARIO MODE" in prompt
        assert "Login Test" in prompt

    def test_scenario_with_login_goal_sets_reach_home_mode(self):
        """Test that Phase A sets mode to 'reach_home' for login goals"""
        # Arrange
        scenario = Scenario(
            id="test-login",
            name="Login Test",
            description="Test login flow",
            goals=[
                ScenarioGoal(
                    id="goal-1",
                    description="Complete login",
                    type="login",
                    success_criteria=["Reach home screen"],
                )
            ],
            credentials=ScenarioCredentials(
                email="test@example.com",
                password="Test123!"
            ),
        )
        
        input_data = SessionBootstrapInput(
            app_name="TestApp",
            platform="android",
            max_steps=100,
            credentials=Credentials(
                email="test@example.com",
                password="Test123!"
            ),
            home_markers=["Home"],
            scenario=scenario,
        )

        # Act
        messages = build_phase_a_user_messages(input_data)
        prompt = messages[0]

        # Assert
        assert "First goal type: login" in prompt
        assert "Suggested mode: reach_home" in prompt

    def test_scenario_with_navigate_goal_sets_explore_mode(self):
        """Test that Phase A sets mode to 'explore' for non-login goals"""
        # Arrange
        scenario = Scenario(
            id="test-navigate",
            name="Navigate Test",
            description="Test navigation flow",
            goals=[
                ScenarioGoal(
                    id="goal-1",
                    description="Navigate to Settings",
                    type="navigate",
                    success_criteria=["Settings screen visible"],
                    hints=GoalHints(expected_screens=["home", "settings"]),
                )
            ],
        )
        
        input_data = SessionBootstrapInput(
            app_name="TestApp",
            platform="android",
            max_steps=100,
            credentials=Credentials(
                email="test@example.com",
                password="Test123!"
            ),
            home_markers=["Home"],
            scenario=scenario,
        )

        # Act
        messages = build_phase_a_user_messages(input_data)
        prompt = messages[0]

        # Assert
        assert "First goal type: navigate" in prompt
        assert "Suggested mode: explore" in prompt

    def test_scenario_extracts_home_markers_from_first_goal_hints(self):
        """Test that Phase A extracts home_markers from first goal's expected_screens"""
        # Arrange
        scenario = Scenario(
            id="test-scenario",
            name="Test Scenario",
            description="Test scenario",
            goals=[
                ScenarioGoal(
                    id="goal-1",
                    description="Complete login",
                    type="login",
                    success_criteria=["Reach home screen"],
                    hints=GoalHints(expected_screens=["login", "home", "dashboard"]),
                )
            ],
            credentials=ScenarioCredentials(
                email="test@example.com",
                password="Test123!"
            ),
        )
        
        input_data = SessionBootstrapInput(
            app_name="TestApp",
            platform="android",
            max_steps=100,
            credentials=Credentials(
                email="test@example.com",
                password="Test123!"
            ),
            home_markers=["FallbackHome"],
            scenario=scenario,
        )

        # Act
        messages = build_phase_a_user_messages(input_data)
        prompt = messages[0]

        # Assert
        assert '["login", "home", "dashboard"]' in prompt
        assert "FallbackHome" not in prompt  # Should use scenario home_markers

    def test_scenario_extracts_flow_hints_from_all_goals(self):
        """Test that Phase A extracts flow_hints from all goals' descriptions"""
        # Arrange
        scenario = Scenario(
            id="test-multi-goal",
            name="Multi-Goal Test",
            description="Test multiple goals",
            goals=[
                ScenarioGoal(
                    id="goal-1",
                    description="Complete login",
                    type="login",
                    success_criteria=["Reach home screen"],
                ),
                ScenarioGoal(
                    id="goal-2",
                    description="Navigate to Settings",
                    type="navigate",
                    success_criteria=["Settings screen visible"],
                ),
                ScenarioGoal(
                    id="goal-3",
                    description="Verify all options present",
                    type="verify",
                    success_criteria=["All settings options visible"],
                ),
            ],
            credentials=ScenarioCredentials(
                email="test@example.com",
                password="Test123!"
            ),
        )
        
        input_data = SessionBootstrapInput(
            app_name="TestApp",
            platform="android",
            max_steps=100,
            credentials=Credentials(
                email="test@example.com",
                password="Test123!"
            ),
            home_markers=["Home"],
            scenario=scenario,
        )

        # Act
        messages = build_phase_a_user_messages(input_data)
        prompt = messages[0]

        # Assert
        assert "Complete login" in prompt
        assert "Navigate to Settings" in prompt
        assert "Verify all options present" in prompt

    def test_scenario_sets_run_goal_from_scenario_name_and_description(self):
        """Test that Phase A sets run_goal from scenario name and description"""
        # Arrange
        scenario = Scenario(
            id="test-scenario",
            name="Login and Settings",
            description="Verify login flow and settings access",
            goals=[
                ScenarioGoal(
                    id="goal-1",
                    description="Complete login",
                    type="login",
                    success_criteria=["Reach home screen"],
                )
            ],
            credentials=ScenarioCredentials(
                email="test@example.com",
                password="Test123!"
            ),
        )
        
        input_data = SessionBootstrapInput(
            app_name="TestApp",
            platform="android",
            max_steps=100,
            credentials=Credentials(
                email="test@example.com",
                password="Test123!"
            ),
            home_markers=["Home"],
            scenario=scenario,
        )

        # Act
        messages = build_phase_a_user_messages(input_data)
        prompt = messages[0]

        # Assert
        assert "Execute scenario: Login and Settings - Verify login flow and settings access" in prompt

    def test_no_scenario_maintains_autonomous_mode(self):
        """Test that Phase A maintains autonomous mode when no scenario provided"""
        # Arrange
        input_data = SessionBootstrapInput(
            app_name="TestApp",
            platform="android",
            max_steps=100,
            credentials=Credentials(
                email="test@example.com",
                password="Test123!"
            ),
            home_markers=["Home", "Dashboard"],
            flow_hints=["Login flow", "Browse products"],
        )

        # Act
        messages = build_phase_a_user_messages(input_data)
        prompt = messages[0]

        # Assert
        assert "SCENARIO MODE" not in prompt
        assert "test@example.com" in prompt
        assert '["Home", "Dashboard"]' in prompt
        assert '["Login flow", "Browse products"]' in prompt

    def test_scenario_without_credentials_uses_fallback(self):
        """Test that Phase A uses fallback credentials when scenario has no credentials"""
        # Arrange
        scenario = Scenario(
            id="test-scenario",
            name="Navigate Test",
            description="Test navigation without login",
            goals=[
                ScenarioGoal(
                    id="goal-1",
                    description="Navigate to Settings",
                    type="navigate",
                    success_criteria=["Settings screen visible"],
                )
            ],
            # No credentials provided
        )
        
        input_data = SessionBootstrapInput(
            app_name="TestApp",
            platform="android",
            max_steps=100,
            credentials=Credentials(
                email="fallback@example.com",
                password="Fallback123!"
            ),
            home_markers=["Home"],
            scenario=scenario,
        )

        # Act
        messages = build_phase_a_user_messages(input_data)
        prompt = messages[0]

        # Assert
        assert "fallback@example.com" in prompt
        assert "Fallback123!" in prompt

    def test_scenario_without_hints_uses_fallback_home_markers(self):
        """Test that Phase A uses fallback home_markers when first goal has no hints"""
        # Arrange
        scenario = Scenario(
            id="test-scenario",
            name="Test Scenario",
            description="Test scenario",
            goals=[
                ScenarioGoal(
                    id="goal-1",
                    description="Complete login",
                    type="login",
                    success_criteria=["Reach home screen"],
                    # No hints provided
                )
            ],
            credentials=ScenarioCredentials(
                email="test@example.com",
                password="Test123!"
            ),
        )
        
        input_data = SessionBootstrapInput(
            app_name="TestApp",
            platform="android",
            max_steps=100,
            credentials=Credentials(
                email="test@example.com",
                password="Test123!"
            ),
            home_markers=["FallbackHome", "FallbackDashboard"],
            scenario=scenario,
        )

        # Act
        messages = build_phase_a_user_messages(input_data)
        prompt = messages[0]

        # Assert
        assert '["FallbackHome", "FallbackDashboard"]' in prompt


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
