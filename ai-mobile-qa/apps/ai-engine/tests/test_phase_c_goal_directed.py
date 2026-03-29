"""
Tests for Phase C (Planner) goal-directed planning with scenario context.

This test suite validates that Phase C makes appropriate action proposals
when provided with goal context (current_goal and goal_progress).
"""

import pytest
from app.schemas.planner import (
    PlannerInput,
    CurrentGoal,
    GoalHints,
    GoalProgress,
    ScreenSize,
    AttemptCounters,
)
from app.graphs.planner import build_phase_c_user_messages


@pytest.fixture
def base_planner_input():
    """Base planner input with minimal required fields."""
    return {
        "mode": "explore",
        "analysis": {
            "screen_type": "unknown",
            "candidate_targets": [],
            "ui_elements": [],
        },
        "memory_snapshot": {
            "seen_element_keys": [],
            "seen_hash_counts": {},
            "completed_screens": [],
        },
        "screen_size": {"w": 1080, "h": 1920},
        "credentials": None,
        "attempt_counters": {"loop_count": 0, "no_element_count": 0},
        "login_step": 0,
    }


def test_login_goal_includes_context_in_prompt(base_planner_input):
    """Test that Phase C includes login goal context in the prompt."""
    # Setup: login screen with email and password fields
    base_planner_input["analysis"] = {
        "screen_type": "login",
        "candidate_targets": [
            "fill:email_field",
            "fill:password_field",
            "login_button",
        ],
        "ui_elements": [
            {"resource_id": "email_field", "text": "", "center_x": 540, "center_y": 800},
            {"resource_id": "password_field", "text": "", "center_x": 540, "center_y": 900},
            {"resource_id": "login_button", "text": "Login", "center_x": 540, "center_y": 1000},
        ],
    }
    base_planner_input["credentials"] = {
        "email": "test@example.com",
        "password": "Test123!",
    }
    
    # Add login goal context
    base_planner_input["current_goal"] = {
        "description": "Complete login flow and reach home screen",
        "type": "login",
        "success_criteria": [
            "Reach home screen",
            "User profile icon visible",
        ],
        "hints": {
            "expected_screens": ["login", "home"],
            "required_actions": ["input_text:email", "input_text:password", "tap:login_button"],
        },
    }
    base_planner_input["goal_progress"] = {
        "steps_taken": 0,
        "criteria_met": [],
        "criteria_pending": ["Reach home screen", "User profile icon visible"],
    }
    
    # Execute Phase C prompt generation
    planner_input = PlannerInput(**base_planner_input)
    messages = build_phase_c_user_messages(planner_input)
    prompt = messages[0]
    
    # Verify: prompt should include goal context
    assert "GOAL-DIRECTED MODE" in prompt
    assert "Complete login flow and reach home screen" in prompt
    assert "GOAL TYPE: LOGIN" in prompt
    assert "Reach home screen" in prompt
    assert "User profile icon visible" in prompt
    assert "Follow the LOGIN SCREEN RULE strictly" in prompt


def test_form_fill_goal_includes_form_data_in_prompt(base_planner_input):
    """Test that Phase C includes form_fill goal context in the prompt."""
    # Setup: form screen with name and bio fields
    base_planner_input["analysis"] = {
        "screen_type": "form",
        "candidate_targets": [
            "fill:name_field",
            "fill:bio_field",
            "submit_button",
        ],
        "ui_elements": [
            {"resource_id": "name_field", "text": "", "center_x": 540, "center_y": 700},
            {"resource_id": "bio_field", "text": "", "center_x": 540, "center_y": 900},
            {"resource_id": "submit_button", "text": "Save", "center_x": 540, "center_y": 1100},
        ],
    }
    
    # Add form_fill goal context
    base_planner_input["current_goal"] = {
        "description": "Update profile fields",
        "type": "form_fill",
        "success_criteria": [
            "All fields filled successfully",
            "Save button is enabled",
        ],
        "form_data": {
            "name_field": "Test User",
            "bio_field": "QA automation test user",
        },
    }
    base_planner_input["goal_progress"] = {
        "steps_taken": 0,
        "criteria_met": [],
        "criteria_pending": ["All fields filled successfully", "Save button is enabled"],
    }
    
    # Execute Phase C prompt generation
    planner_input = PlannerInput(**base_planner_input)
    messages = build_phase_c_user_messages(planner_input)
    prompt = messages[0]
    
    # Verify: prompt should include form_fill goal context
    assert "GOAL-DIRECTED MODE" in prompt
    assert "Update profile fields" in prompt
    assert "GOAL TYPE: FORM_FILL" in prompt
    assert "name_field: Test User" in prompt
    assert "bio_field: QA automation test user" in prompt
    assert "Fill ALL form fields before tapping submit" in prompt


def test_navigate_goal_includes_hints_in_prompt(base_planner_input):
    """Test that Phase C includes navigate goal context in the prompt."""
    # Setup: home screen with menu and settings options
    base_planner_input["analysis"] = {
        "screen_type": "home",
        "candidate_targets": [
            "menu_icon",
            "search_icon",
            "profile_icon",
        ],
        "ui_elements": [
            {"resource_id": "menu_icon", "text": "Menu", "center_x": 100, "center_y": 100},
            {"resource_id": "search_icon", "text": "Search", "center_x": 540, "center_y": 100},
            {"resource_id": "profile_icon", "text": "Profile", "center_x": 980, "center_y": 100},
        ],
    }
    
    # Add navigate goal context
    base_planner_input["current_goal"] = {
        "description": "Navigate to Settings screen",
        "type": "navigate",
        "success_criteria": [
            "Settings screen visible",
            "All settings options present",
        ],
        "hints": {
            "expected_screens": ["home", "menu", "settings"],
            "required_actions": ["tap:menu", "tap:settings"],
        },
    }
    base_planner_input["goal_progress"] = {
        "steps_taken": 0,
        "criteria_met": [],
        "criteria_pending": ["Settings screen visible", "All settings options present"],
    }
    
    # Execute Phase C prompt generation
    planner_input = PlannerInput(**base_planner_input)
    messages = build_phase_c_user_messages(planner_input)
    prompt = messages[0]
    
    # Verify: prompt should include navigate goal context
    assert "GOAL-DIRECTED MODE" in prompt
    assert "Navigate to Settings screen" in prompt
    assert "GOAL TYPE: NAVIGATE" in prompt
    assert "home, menu, settings" in prompt
    assert "tap:menu" in prompt
    assert "tap:settings" in prompt


def test_verify_goal_shows_met_and_pending_criteria(base_planner_input):
    """Test that Phase C includes verify goal context in the prompt."""
    # Setup: settings screen with some options visible
    base_planner_input["analysis"] = {
        "screen_type": "settings",
        "candidate_targets": [
            "account_option",
            "notifications_option",
            "scroll_down",
        ],
        "ui_elements": [
            {"resource_id": "account_option", "text": "Account", "center_x": 540, "center_y": 400},
            {"resource_id": "notifications_option", "text": "Notifications", "center_x": 540, "center_y": 600},
        ],
    }
    
    # Add verify goal context
    base_planner_input["current_goal"] = {
        "description": "Verify all settings options are present",
        "type": "verify",
        "success_criteria": [
            "Account settings option visible",
            "Notification settings option visible",
            "Privacy settings option visible",
        ],
    }
    base_planner_input["goal_progress"] = {
        "steps_taken": 0,
        "criteria_met": ["Account settings option visible", "Notification settings option visible"],
        "criteria_pending": ["Privacy settings option visible"],
    }
    
    # Execute Phase C prompt generation
    planner_input = PlannerInput(**base_planner_input)
    messages = build_phase_c_user_messages(planner_input)
    prompt = messages[0]
    
    # Verify: prompt should include verify goal context
    assert "GOAL-DIRECTED MODE" in prompt
    assert "Verify all settings options are present" in prompt
    assert "GOAL TYPE: VERIFY" in prompt
    assert "Privacy settings option visible" in prompt
    assert "✓ Account settings option visible" in prompt
    assert "✓ Notification settings option visible" in prompt


def test_autonomous_mode_without_goal_context(base_planner_input):
    """Test that Phase C uses autonomous mode when no goal is provided."""
    # Setup: generic screen with some interactive elements
    base_planner_input["analysis"] = {
        "screen_type": "unknown",
        "candidate_targets": [
            "button_1",
            "button_2",
            "list_item",
        ],
        "ui_elements": [
            {"resource_id": "button_1", "text": "Action 1", "center_x": 540, "center_y": 500},
            {"resource_id": "button_2", "text": "Action 2", "center_x": 540, "center_y": 700},
            {"resource_id": "list_item", "text": "Item", "center_x": 540, "center_y": 900},
        ],
    }
    
    # No goal context provided (autonomous mode)
    base_planner_input["current_goal"] = None
    base_planner_input["goal_progress"] = None
    
    # Execute Phase C prompt generation
    planner_input = PlannerInput(**base_planner_input)
    messages = build_phase_c_user_messages(planner_input)
    prompt = messages[0]
    
    # Verify: prompt should NOT include goal context
    assert "GOAL-DIRECTED MODE" not in prompt
    assert "GOAL TYPE:" not in prompt
    # Should still have basic instructions
    assert "mode: explore" in prompt
    assert "tap-first exploration" in prompt


def test_explore_section_goal_includes_avoid_actions(base_planner_input):
    """Test that Phase C includes avoid_actions hint for explore_section goals."""
    # Setup: product list screen
    base_planner_input["analysis"] = {
        "screen_type": "product_list",
        "candidate_targets": [
            "product_1",
            "product_2",
            "back_button",
        ],
        "ui_elements": [
            {"resource_id": "product_1", "text": "Product 1", "center_x": 540, "center_y": 500},
            {"resource_id": "product_2", "text": "Product 2", "center_x": 540, "center_y": 700},
            {"resource_id": "back_button", "text": "Back", "center_x": 100, "center_y": 100},
        ],
    }
    
    # Add explore_section goal with avoid_actions
    base_planner_input["current_goal"] = {
        "description": "Explore product catalog section",
        "type": "explore_section",
        "success_criteria": [
            "Visit at least 3 product detail screens",
            "No overflow errors detected",
        ],
        "hints": {
            "expected_screens": ["product_list", "product_detail"],
            "avoid_actions": ["back"],
        },
    }
    base_planner_input["goal_progress"] = {
        "steps_taken": 2,
        "criteria_met": [],
        "criteria_pending": ["Visit at least 3 product detail screens", "No overflow errors detected"],
    }
    
    # Execute Phase C prompt generation
    planner_input = PlannerInput(**base_planner_input)
    messages = build_phase_c_user_messages(planner_input)
    prompt = messages[0]
    
    # Verify: prompt should include explore_section goal context with avoid_actions
    assert "GOAL-DIRECTED MODE" in prompt
    assert "Explore product catalog section" in prompt
    assert "GOAL TYPE: EXPLORE_SECTION" in prompt
    assert "AVOID these action types" in prompt
    assert "- back" in prompt
    assert "Actions to avoid: back" in prompt


def test_goal_progress_shows_steps_taken(base_planner_input):
    """Test that goal progress (met and pending criteria) is included in the prompt."""
    # Setup: settings screen
    base_planner_input["analysis"] = {
        "screen_type": "settings",
        "candidate_targets": ["privacy_option"],
        "ui_elements": [
            {"resource_id": "privacy_option", "text": "Privacy", "center_x": 540, "center_y": 800},
        ],
    }
    
    # Add goal with some criteria already met
    base_planner_input["current_goal"] = {
        "description": "Verify all settings options",
        "type": "verify",
        "success_criteria": [
            "Account settings visible",
            "Notifications settings visible",
            "Privacy settings visible",
        ],
    }
    base_planner_input["goal_progress"] = {
        "steps_taken": 5,
        "criteria_met": ["Account settings visible", "Notifications settings visible"],
        "criteria_pending": ["Privacy settings visible"],
    }
    
    # Execute Phase C prompt generation
    planner_input = PlannerInput(**base_planner_input)
    messages = build_phase_c_user_messages(planner_input)
    prompt = messages[0]
    
    # Verify: prompt should show both met and pending criteria
    assert "Success criteria still pending:" in prompt
    assert "- Privacy settings visible" in prompt
    assert "Success criteria already met:" in prompt
    assert "✓ Account settings visible" in prompt
    assert "✓ Notifications settings visible" in prompt
    assert "Steps taken for this goal: 5" in prompt
