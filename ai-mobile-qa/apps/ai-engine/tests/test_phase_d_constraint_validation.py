"""
Tests for Phase D (Critic Gate) constraint validation with goal constraints.

This test suite validates that Phase D properly validates actions against
goal constraints (avoid_actions, max_steps, required_screens).
"""

import pytest
from unittest.mock import AsyncMock, patch
from app.schemas.critic_gate import CriticGateInput, GoalConstraints, CriticGateOutput
from app.graphs.critic_gate import get_critic_gate_graph


@pytest.fixture
def base_critic_input():
    """Base critic input with minimal required fields."""
    return {
        "proposed_action": {"type": "tap_xy", "params": {"x": 540, "y": 800}},
        "screen_hash": "abc123",
        "seen_hash_counts": {"abc123": 1},
        "recent_actions": [],
        "failure_streak": 0,
        "mode": "explore",
    }


@pytest.mark.asyncio
async def test_avoid_actions_constraint_rejects_action(base_critic_input):
    """Test that Phase D rejects actions in avoid_actions list."""
    # Setup: propose a 'back' action with avoid_actions constraint
    base_critic_input["proposed_action"] = {"type": "back", "params": {}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": ["back", "swipe"],
        "required_screens": None,
        "max_steps": None,
        "steps_taken": 2,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: action should be rejected
    assert output.decision == "reject"
    assert "avoid_actions" in output.rejection_reason_or_null
    assert "back" in output.rejection_reason_or_null
    # Alternative action should be provided
    assert output.final_action.type in ["wait_ms"]


@pytest.mark.asyncio
@patch('app.graphs.critic_gate.LLMClient')
async def test_avoid_actions_constraint_approves_allowed_action(mock_llm_client, base_critic_input):
    """Test that Phase D approves actions not in avoid_actions list."""
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "decision": "approve",
        "final_action": {"type": "tap_xy", "params": {"x": 540, "y": 800}},
        "rejection_reason_or_null": None,
        "recovery_tag": "normal"
    })
    mock_llm_client.return_value = mock_instance
    
    # Setup: propose a 'tap_xy' action with avoid_actions constraint
    base_critic_input["proposed_action"] = {"type": "tap_xy", "params": {"x": 540, "y": 800}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": ["back", "swipe"],
        "required_screens": None,
        "max_steps": None,
        "steps_taken": 2,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: action should be approved (tap_xy not in avoid_actions)
    assert output.decision == "approve"
    assert output.final_action.type == "tap_xy"


@pytest.mark.asyncio
async def test_max_steps_constraint_rejects_when_limit_reached(base_critic_input):
    """Test that Phase D rejects actions when max_steps limit is reached."""
    # Setup: steps_taken >= max_steps
    base_critic_input["proposed_action"] = {"type": "tap_xy", "params": {"x": 540, "y": 800}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": None,
        "required_screens": None,
        "max_steps": 5,
        "steps_taken": 5,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: action should be rejected
    assert output.decision == "reject"
    assert "max_steps" in output.rejection_reason_or_null
    assert "5" in output.rejection_reason_or_null
    # Should suggest stopping
    assert output.final_action.type == "stop"


@pytest.mark.asyncio
@patch('app.graphs.critic_gate.LLMClient')
async def test_max_steps_constraint_approves_when_under_limit(mock_llm_client, base_critic_input):
    """Test that Phase D approves actions when under max_steps limit."""
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "decision": "approve",
        "final_action": {"type": "tap_xy", "params": {"x": 540, "y": 800}},
        "rejection_reason_or_null": None,
        "recovery_tag": "normal"
    })
    mock_llm_client.return_value = mock_instance
    
    # Setup: steps_taken < max_steps
    base_critic_input["proposed_action"] = {"type": "tap_xy", "params": {"x": 540, "y": 800}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": None,
        "required_screens": None,
        "max_steps": 10,
        "steps_taken": 5,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: action should be approved
    assert output.decision == "approve"
    assert output.final_action.type == "tap_xy"


@pytest.mark.asyncio
async def test_required_screens_constraint_rejects_navigation_away(base_critic_input):
    """Test that Phase D rejects navigation actions when required_screens is set."""
    # Setup: propose a 'back' action with required_screens constraint
    base_critic_input["proposed_action"] = {"type": "back", "params": {}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": None,
        "required_screens": ["settings", "account"],
        "max_steps": None,
        "steps_taken": 3,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: action should be rejected
    assert output.decision == "reject"
    assert "required_screens" in output.rejection_reason_or_null
    assert "navigate away" in output.rejection_reason_or_null.lower()


@pytest.mark.asyncio
async def test_required_screens_constraint_rejects_swipe_action(base_critic_input):
    """Test that Phase D rejects swipe actions when required_screens is set."""
    # Setup: propose a 'swipe' action with required_screens constraint
    base_critic_input["proposed_action"] = {"type": "swipe", "params": {"direction": "up"}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": None,
        "required_screens": ["settings"],
        "max_steps": None,
        "steps_taken": 2,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: action should be rejected
    assert output.decision == "reject"
    assert "required_screens" in output.rejection_reason_or_null


@pytest.mark.asyncio
@patch('app.graphs.critic_gate.LLMClient')
async def test_required_screens_constraint_approves_tap_action(mock_llm_client, base_critic_input):
    """Test that Phase D approves tap actions when required_screens is set."""
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "decision": "approve",
        "final_action": {"type": "tap_xy", "params": {"x": 540, "y": 800}},
        "rejection_reason_or_null": None,
        "recovery_tag": "normal"
    })
    mock_llm_client.return_value = mock_instance
    
    # Setup: propose a 'tap_xy' action with required_screens constraint
    base_critic_input["proposed_action"] = {"type": "tap_xy", "params": {"x": 540, "y": 800}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": None,
        "required_screens": ["settings"],
        "max_steps": None,
        "steps_taken": 2,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: action should be approved (tap_xy doesn't navigate away)
    assert output.decision == "approve"
    assert output.final_action.type == "tap_xy"


@pytest.mark.asyncio
@patch('app.graphs.critic_gate.LLMClient')
async def test_no_constraints_uses_existing_rules_only(mock_llm_client, base_critic_input):
    """Test that Phase D uses existing rules when no goal_constraints provided."""
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "decision": "approve",
        "final_action": {"type": "tap_xy", "params": {"x": 540, "y": 800}},
        "rejection_reason_or_null": None,
        "recovery_tag": "normal"
    })
    mock_llm_client.return_value = mock_instance
    
    # Setup: no goal_constraints
    base_critic_input["proposed_action"] = {"type": "tap_xy", "params": {"x": 540, "y": 800}}
    base_critic_input["goal_constraints"] = None
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: action should be approved (no constraint violations)
    assert output.decision == "approve"
    assert output.final_action.type == "tap_xy"


@pytest.mark.asyncio
async def test_rejection_message_includes_constraint_details(base_critic_input):
    """Test that rejection messages include specific constraint violation details."""
    # Setup: multiple constraints, violate avoid_actions
    base_critic_input["proposed_action"] = {"type": "swipe", "params": {"direction": "up"}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": ["swipe", "back"],
        "required_screens": ["home"],
        "max_steps": 10,
        "steps_taken": 3,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: rejection message should be specific
    assert output.decision == "reject"
    assert output.rejection_reason_or_null is not None
    assert "swipe" in output.rejection_reason_or_null
    assert "avoid_actions" in output.rejection_reason_or_null


@pytest.mark.asyncio
async def test_multiple_constraints_first_violation_wins(base_critic_input):
    """Test that when multiple constraints are violated, the first check wins."""
    # Setup: violate both avoid_actions and max_steps
    base_critic_input["proposed_action"] = {"type": "back", "params": {}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": ["back"],
        "required_screens": None,
        "max_steps": 5,
        "steps_taken": 5,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: should reject with avoid_actions reason (checked first)
    assert output.decision == "reject"
    assert "avoid_actions" in output.rejection_reason_or_null


@pytest.mark.asyncio
@patch('app.graphs.critic_gate.LLMClient')
async def test_input_text_not_rejected_by_constraints(mock_llm_client, base_critic_input):
    """Test that input_text actions pass constraint checks (form filling must proceed)."""
    # Mock LLM response
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "decision": "approve",
        "final_action": {"type": "input_text", "params": {"text": "test"}},
        "rejection_reason_or_null": None,
        "recovery_tag": "normal"
    })
    mock_llm_client.return_value = mock_instance
    
    # Setup: input_text action - even with constraints, input_text should not be in avoid_actions
    # because form filling must always proceed
    base_critic_input["proposed_action"] = {"type": "input_text", "params": {"text": "test"}}
    base_critic_input["goal_constraints"] = {
        "avoid_actions": ["back", "swipe"],  # input_text not in avoid list
        "required_screens": None,
        "max_steps": 10,
        "steps_taken": 2,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: input_text should be approved (not in avoid_actions, passes constraint checks)
    assert output.decision == "approve"
    assert output.final_action.type == "input_text"


@pytest.mark.asyncio
@patch('app.graphs.critic_gate.LLMClient')
async def test_constraint_validation_with_existing_rejection_rules(mock_llm_client, base_critic_input):
    """Test that constraint validation works alongside existing rejection rules."""
    # Mock LLM response - LLM should reject repeated tap
    mock_instance = AsyncMock()
    mock_instance.chat_json_messages = AsyncMock(return_value={
        "decision": "reject",
        "final_action": {"type": "back", "params": {}},
        "rejection_reason_or_null": "Repeated tap detected at same coordinates",
        "recovery_tag": "loop_recovery"
    })
    mock_llm_client.return_value = mock_instance
    
    # Setup: action that would be rejected by existing rules (repeated tap)
    base_critic_input["proposed_action"] = {"type": "tap_xy", "params": {"x": 540, "y": 800}}
    base_critic_input["recent_actions"] = [
        {"action": {"type": "tap_xy", "params": {"x": 540, "y": 800}}},
        {"action": {"type": "tap_xy", "params": {"x": 540, "y": 800}}},
        {"action": {"type": "tap_xy", "params": {"x": 540, "y": 800}}},
    ]
    base_critic_input["goal_constraints"] = {
        "avoid_actions": None,
        "required_screens": None,
        "max_steps": 10,
        "steps_taken": 3,
    }
    
    # Execute Phase D
    critic_input = CriticGateInput(**base_critic_input)
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": critic_input})
    output = result["output"]
    
    # Verify: should be rejected by existing rule (repeated tap)
    assert output.decision == "reject"
    # Rejection reason should mention the repeated tap, not constraints
    assert output.rejection_reason_or_null is not None
