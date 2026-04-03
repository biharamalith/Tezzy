"""
Tests for success criteria evaluation logic.

This test suite validates that success criteria are correctly evaluated
against screen state and Phase B output.

Requirements: 11.1, 11.2, 11.3, 11.4, 11.7
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from app.evaluators.success_criteria import (
    evaluate_criterion,
    evaluate_all_criteria,
    _is_screen_type_criterion,
    _is_element_presence_criterion,
    _evaluate_screen_type_criterion,
    _evaluate_element_presence_criterion,
)
from app.evaluators import success_criteria


@pytest.fixture
def mock_llm_client():
    """Mock LLM client for testing natural language evaluation."""
    client = MagicMock()
    client.chat_json = AsyncMock()
    return client


@pytest.fixture
def sample_screen_state():
    """Sample screen state with UI elements."""
    return {
        "screen_hash": "abc123",
        "ui_elements": [
            {
                "resource_id": "user_profile_icon",
                "text": "Profile",
                "content_desc": "User profile",
                "class": "ImageView",
                "center_x": 100,
                "center_y": 100,
            },
            {
                "resource_id": "settings_button",
                "text": "Settings",
                "content_desc": "Open settings",
                "class": "Button",
                "center_x": 200,
                "center_y": 200,
            },
            {
                "resource_id": "notification_icon",
                "text": "",
                "content_desc": "Notifications",
                "class": "ImageView",
                "center_x": 300,
                "center_y": 100,
            },
        ],
    }


@pytest.fixture
def sample_phase_b_output():
    """Sample Phase B output."""
    return {
        "screen_type": "home",
        "confidence": 0.9,
        "candidate_targets": ["user_profile_icon", "settings_button"],
        "blocker_flags": [],
        "reasoning_short": "Home screen with navigation options",
    }


# Test screen_type criterion evaluation
def test_screen_type_criterion_reach_home_screen(sample_screen_state, sample_phase_b_output):
    """Test screen_type criterion: 'Reach home screen'."""
    criterion = "Reach home screen"
    result = evaluate_criterion(criterion, sample_screen_state, sample_phase_b_output)
    assert result is True


def test_screen_type_criterion_screen_type_is_settings(sample_screen_state, sample_phase_b_output):
    """Test screen_type criterion: 'Screen type is settings'."""
    criterion = "Screen type is 'settings'"
    result = evaluate_criterion(criterion, sample_screen_state, sample_phase_b_output)
    assert result is False  # Phase B output says 'home', not 'settings'


def test_screen_type_criterion_on_login_screen(sample_screen_state):
    """Test screen_type criterion: 'On login screen'."""
    phase_b_output = {"screen_type": "login", "confidence": 0.95}
    criterion = "On login screen"
    result = evaluate_criterion(criterion, sample_screen_state, phase_b_output)
    assert result is True


def test_screen_type_criterion_navigate_to_settings(sample_screen_state):
    """Test screen_type criterion: 'Navigate to settings screen'."""
    phase_b_output = {"screen_type": "settings", "confidence": 0.9}
    criterion = "Navigate to settings screen"
    result = evaluate_criterion(criterion, sample_screen_state, phase_b_output)
    assert result is True


# Test element presence criterion evaluation
def test_element_presence_criterion_user_profile_visible(sample_screen_state, sample_phase_b_output):
    """Test element presence criterion: 'User profile visible'."""
    criterion = "User profile visible"
    result = evaluate_criterion(criterion, sample_screen_state, sample_phase_b_output)
    assert result is True


def test_element_presence_criterion_settings_button_present(sample_screen_state, sample_phase_b_output):
    """Test element presence criterion: 'Settings button present'."""
    criterion = "Settings button present"
    result = evaluate_criterion(criterion, sample_screen_state, sample_phase_b_output)
    assert result is True


def test_element_presence_criterion_notification_icon_displayed(sample_screen_state, sample_phase_b_output):
    """Test element presence criterion: 'Notification icon displayed'."""
    criterion = "Notification icon displayed"
    result = evaluate_criterion(criterion, sample_screen_state, sample_phase_b_output)
    assert result is True


def test_element_presence_criterion_not_found(sample_screen_state, sample_phase_b_output):
    """Test element presence criterion when element doesn't exist."""
    criterion = "Logout button visible"
    result = evaluate_criterion(criterion, sample_screen_state, sample_phase_b_output)
    assert result is False


def test_element_presence_criterion_empty_ui_elements(sample_phase_b_output):
    """Test element presence criterion with empty UI elements."""
    screen_state = {"ui_elements": []}
    criterion = "User profile visible"
    result = evaluate_criterion(criterion, screen_state, sample_phase_b_output)
    assert result is False


# Test natural language criterion evaluation
@pytest.mark.asyncio
async def test_natural_language_criterion_all_settings_present(
    sample_screen_state, sample_phase_b_output, mock_llm_client
):
    """Test natural language criterion: 'All settings options present'."""
    mock_llm_client.chat_json.return_value = {
        "satisfied": True,
        "reasoning": "All expected settings options are visible in the UI elements"
    }
    
    criterion = "All settings options present"
    result = await success_criteria._evaluate_natural_language_criterion(
        criterion, sample_screen_state, sample_phase_b_output, mock_llm_client
    )
    assert result is True
    
    # Verify LLM was called with appropriate context
    mock_llm_client.chat_json.assert_called_once()
    call_args = mock_llm_client.chat_json.call_args
    assert criterion in call_args.kwargs["user_prompt"]
    assert "home" in call_args.kwargs["user_prompt"]  # screen_type


@pytest.mark.asyncio
async def test_natural_language_criterion_not_satisfied(
    sample_screen_state, sample_phase_b_output, mock_llm_client
):
    """Test natural language criterion that is not satisfied."""
    mock_llm_client.chat_json.return_value = {
        "satisfied": False,
        "reasoning": "Privacy settings option is not visible"
    }
    
    criterion = "All privacy options are configured correctly"
    result = await success_criteria._evaluate_natural_language_criterion(
        criterion, sample_screen_state, sample_phase_b_output, mock_llm_client
    )
    assert result is False


@pytest.mark.asyncio
async def test_natural_language_criterion_llm_error(
    sample_screen_state, sample_phase_b_output, mock_llm_client
):
    """Test natural language criterion when LLM call fails."""
    mock_llm_client.chat_json.side_effect = Exception("LLM API error")
    
    criterion = "All settings options present"
    result = await success_criteria._evaluate_natural_language_criterion(
        criterion, sample_screen_state, sample_phase_b_output, mock_llm_client
    )
    assert result is False  # Should gracefully handle error


# Test evaluation with missing screen state
def test_evaluation_with_missing_screen_state(sample_phase_b_output):
    """Test evaluation with missing screen state, verify graceful handling."""
    screen_state = {}  # Missing ui_elements
    criterion = "User profile visible"
    result = evaluate_criterion(criterion, screen_state, sample_phase_b_output)
    assert result is False  # Should handle gracefully


def test_evaluation_with_none_ui_elements(sample_phase_b_output):
    """Test evaluation when ui_elements is None."""
    screen_state = {"ui_elements": None}
    criterion = "User profile visible"
    # Should handle gracefully without crashing
    result = evaluate_criterion(criterion, screen_state, sample_phase_b_output)
    assert result is False


# Test evaluation with invalid criterion format
def test_evaluation_with_invalid_criterion_format(sample_screen_state, sample_phase_b_output):
    """Test evaluation with invalid criterion format, verify error handling."""
    criterion = ""  # Empty criterion
    result = evaluate_criterion(criterion, sample_screen_state, sample_phase_b_output)
    assert result is False  # Should handle gracefully


def test_evaluation_with_malformed_criterion(sample_screen_state, sample_phase_b_output):
    """Test evaluation with malformed criterion."""
    criterion = "!@#$%^&*()"  # Invalid characters
    result = evaluate_criterion(criterion, sample_screen_state, sample_phase_b_output)
    assert result is False  # Should handle gracefully


# Test evaluate_all_criteria orchestration
def test_evaluate_all_criteria_mixed_results(sample_screen_state, sample_phase_b_output):
    """Test evaluate_all_criteria with mixed met and pending criteria."""
    criteria_pending = [
        "Reach home screen",  # Should be met (screen_type is 'home')
        "User profile visible",  # Should be met (element exists)
        "Logout button visible",  # Should NOT be met (element doesn't exist)
        "Navigate to settings screen",  # Should NOT be met (screen_type is 'home', not 'settings')
    ]
    
    criteria_met, criteria_still_pending = evaluate_all_criteria(
        criteria_pending, sample_screen_state, sample_phase_b_output
    )
    
    assert len(criteria_met) == 2
    assert "Reach home screen" in criteria_met
    assert "User profile visible" in criteria_met
    
    assert len(criteria_still_pending) == 2
    assert "Logout button visible" in criteria_still_pending
    assert "Navigate to settings screen" in criteria_still_pending


def test_evaluate_all_criteria_all_met(sample_screen_state, sample_phase_b_output):
    """Test evaluate_all_criteria when all criteria are met."""
    criteria_pending = [
        "Reach home screen",
        "User profile visible",
        "Settings button present",
    ]
    
    criteria_met, criteria_still_pending = evaluate_all_criteria(
        criteria_pending, sample_screen_state, sample_phase_b_output
    )
    
    assert len(criteria_met) == 3
    assert len(criteria_still_pending) == 0


def test_evaluate_all_criteria_none_met(sample_screen_state):
    """Test evaluate_all_criteria when no criteria are met."""
    phase_b_output = {"screen_type": "login", "confidence": 0.9}
    criteria_pending = [
        "Reach home screen",  # screen_type is 'login', not 'home'
        "Logout button visible",  # Element doesn't exist
    ]
    
    criteria_met, criteria_still_pending = evaluate_all_criteria(
        criteria_pending, sample_screen_state, phase_b_output
    )
    
    assert len(criteria_met) == 0
    assert len(criteria_still_pending) == 2


def test_evaluate_all_criteria_empty_list(sample_screen_state, sample_phase_b_output):
    """Test evaluate_all_criteria with empty criteria list."""
    criteria_pending = []
    
    criteria_met, criteria_still_pending = evaluate_all_criteria(
        criteria_pending, sample_screen_state, sample_phase_b_output
    )
    
    assert len(criteria_met) == 0
    assert len(criteria_still_pending) == 0


def test_evaluate_all_criteria_handles_errors_gracefully(sample_screen_state):
    """Test evaluate_all_criteria handles evaluation errors gracefully."""
    # Phase B output with missing screen_type
    phase_b_output = {}
    
    criteria_pending = [
        "Reach home screen",
        "User profile visible",
    ]
    
    # Should not crash, should treat errors as not met
    criteria_met, criteria_still_pending = evaluate_all_criteria(
        criteria_pending, sample_screen_state, phase_b_output
    )
    
    # Element presence should still work
    assert "User profile visible" in criteria_met
    # Screen type criterion should fail gracefully
    assert "Reach home screen" in criteria_still_pending


# Test helper functions
def test_is_screen_type_criterion():
    """Test screen type criterion detection."""
    assert _is_screen_type_criterion("reach home screen") is True
    assert _is_screen_type_criterion("screen type is 'settings'") is True
    assert _is_screen_type_criterion("on login screen") is True
    assert _is_screen_type_criterion("navigate to settings screen") is True
    assert _is_screen_type_criterion("user profile visible") is False
    assert _is_screen_type_criterion("all settings options present") is False


def test_is_element_presence_criterion():
    """Test element presence criterion detection."""
    assert _is_element_presence_criterion("user profile visible") is True
    assert _is_element_presence_criterion("login button present") is True
    assert _is_element_presence_criterion("settings option displayed") is True
    assert _is_element_presence_criterion("notification icon shown") is True
    assert _is_element_presence_criterion("menu appears") is True
    assert _is_element_presence_criterion("logout button exists") is True
    assert _is_element_presence_criterion("see user name") is True
    assert _is_element_presence_criterion("contains privacy option") is True
    assert _is_element_presence_criterion("reach home screen") is False


def test_evaluate_screen_type_criterion_variations():
    """Test screen type criterion evaluation with various phrasings."""
    phase_b_output = {"screen_type": "settings", "confidence": 0.9}
    
    # All these should match 'settings'
    assert _evaluate_screen_type_criterion("reach settings screen", phase_b_output) is True
    assert _evaluate_screen_type_criterion("screen type is 'settings'", phase_b_output) is True
    assert _evaluate_screen_type_criterion("on settings screen", phase_b_output) is True
    assert _evaluate_screen_type_criterion("navigate to settings screen", phase_b_output) is True
    
    # This should not match
    assert _evaluate_screen_type_criterion("reach home screen", phase_b_output) is False


def test_evaluate_element_presence_criterion_fuzzy_matching():
    """Test element presence criterion with fuzzy keyword matching."""
    screen_state = {
        "ui_elements": [
            {
                "resource_id": "btn_user_account_settings",
                "text": "Account",
                "content_desc": "User account settings",
                "class": "Button",
            },
        ],
    }
    
    # All these should match the element
    assert _evaluate_element_presence_criterion("user account visible", screen_state) is True
    assert _evaluate_element_presence_criterion("account settings present", screen_state) is True
    assert _evaluate_element_presence_criterion("user settings displayed", screen_state) is True
    
    # This should not match
    assert _evaluate_element_presence_criterion("logout button visible", screen_state) is False


def test_evaluate_element_presence_criterion_partial_keyword_match():
    """Test element presence criterion requires all keywords to match."""
    screen_state = {
        "ui_elements": [
            {"resource_id": "profile_icon", "text": "Profile", "content_desc": ""},
        ],
    }
    
    # Should match (single keyword)
    assert _evaluate_element_presence_criterion("profile visible", screen_state) is True
    
    # Should NOT match (requires both 'profile' and 'settings')
    assert _evaluate_element_presence_criterion("profile settings visible", screen_state) is False


def test_evaluate_all_criteria_integration(sample_screen_state, sample_phase_b_output):
    """Integration test for evaluate_all_criteria with various criterion types."""
    criteria_pending = [
        "Reach home screen",  # Screen type - should be met
        "User profile visible",  # Element presence - should be met
        "Settings button present",  # Element presence - should be met
        "Reach login screen",  # Screen type - should NOT be met
        "Logout button visible",  # Element presence - should NOT be met
    ]
    
    criteria_met, criteria_still_pending = evaluate_all_criteria(
        criteria_pending, sample_screen_state, sample_phase_b_output
    )
    
    # Verify correct classification
    assert len(criteria_met) == 3
    assert "Reach home screen" in criteria_met
    assert "User profile visible" in criteria_met
    assert "Settings button present" in criteria_met
    
    assert len(criteria_still_pending) == 2
    assert "Reach login screen" in criteria_still_pending
    assert "Logout button visible" in criteria_still_pending


def test_evaluate_criterion_with_missing_phase_b_output(sample_screen_state):
    """Test evaluation with missing phase_b_output fields."""
    phase_b_output = {}  # Missing screen_type
    criterion = "Reach home screen"
    
    # Should handle gracefully
    result = evaluate_criterion(criterion, sample_screen_state, phase_b_output)
    assert result is False


def test_evaluate_criterion_with_none_values(sample_phase_b_output):
    """Test evaluation with None values in screen_state."""
    screen_state = {"ui_elements": None}
    criterion = "User profile visible"
    
    # Should handle gracefully
    result = evaluate_criterion(criterion, screen_state, sample_phase_b_output)
    assert result is False


def test_evaluate_all_criteria_with_evaluation_errors():
    """Test evaluate_all_criteria handles individual criterion errors gracefully."""
    # Malformed inputs that might cause errors
    screen_state = {"ui_elements": "not_a_list"}  # Invalid type
    phase_b_output = {"screen_type": None}  # Invalid type
    
    criteria_pending = [
        "Reach home screen",
        "User profile visible",
    ]
    
    # Should not crash, should treat errors as not met
    criteria_met, criteria_still_pending = evaluate_all_criteria(
        criteria_pending, screen_state, phase_b_output
    )
    
    # All should be treated as not met due to errors
    assert len(criteria_met) == 0
    assert len(criteria_still_pending) == 2
