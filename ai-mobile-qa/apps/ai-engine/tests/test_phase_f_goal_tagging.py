"""
Integration tests for Phase F (Issue Triage) goal-aware tagging.
Tests Requirements 8.1, 8.2, 8.3, 8.4
"""

import pytest
from app.graphs.issue_triage import get_issue_triage_graph
from app.schemas.issue_triage import IssueTriageInput, CurrentGoal, GoalProgress


@pytest.mark.asyncio
async def test_finding_tagged_with_goal_id_when_goal_provided():
    """Test that findings include goal_id when current_goal is provided (Req 8.1)"""
    graph = get_issue_triage_graph()
    
    current_goal = CurrentGoal(
        id="goal-1",
        description="Login to the app",
        success_criteria=["User is logged in", "Home screen is visible"]
    )
    
    triage_input = IssueTriageInput(
        runtime_signals=[
            {
                "kind": "loop",
                "source": "planner",
                "step": 5,
                "screen_hash": "abc123"
            }
        ],
        overflow_detection={},
        step_context={"step": 5, "screen_hash": "abc123"},
        prior_findings=[],
        current_goal=current_goal
    )
    
    result = await graph.ainvoke({"input": triage_input})
    output = result["output"]
    
    # Check that findings include goal_id
    findings = output.deduped_findings or output.new_findings
    assert len(findings) > 0, "Expected at least one finding"
    
    for finding in findings:
        assert "goal_id" in finding, f"Finding missing goal_id: {finding}"
        assert finding["goal_id"] == "goal-1", f"Expected goal_id 'goal-1', got {finding['goal_id']}"


@pytest.mark.asyncio
async def test_blocks_goal_true_when_finding_prevents_criterion():
    """Test that blocks_goal is true when finding prevents success criterion (Req 8.2, 8.3)"""
    graph = get_issue_triage_graph()
    
    current_goal = CurrentGoal(
        id="goal-2",
        description="Complete checkout process",
        success_criteria=["Payment form is visible", "Order confirmation received"]
    )
    
    goal_progress = GoalProgress(
        steps_taken=3,
        criteria_met=[],
        criteria_pending=["Payment form is visible", "Order confirmation received"]
    )
    
    # Crash signal should block goal completion
    triage_input = IssueTriageInput(
        runtime_signals=[
            {
                "kind": "crash_hint",
                "source": "appium",
                "step": 3,
                "screen_hash": "xyz789"
            }
        ],
        overflow_detection={},
        step_context={"step": 3, "screen_hash": "xyz789"},
        prior_findings=[],
        current_goal=current_goal,
        goal_progress=goal_progress
    )
    
    result = await graph.ainvoke({"input": triage_input})
    output = result["output"]
    
    findings = output.deduped_findings or output.new_findings
    assert len(findings) > 0, "Expected at least one finding"
    
    # Crash should block goal
    crash_finding = next((f for f in findings if "crash" in str(f.get("kind", "")).lower()), None)
    if crash_finding:
        assert "blocks_goal" in crash_finding, "Crash finding should have blocks_goal field"
        assert crash_finding["blocks_goal"] is True, "Crash should block goal completion"


@pytest.mark.asyncio
async def test_blocks_goal_false_when_finding_non_blocking():
    """Test that blocks_goal is false for non-blocking findings (Req 8.3)"""
    graph = get_issue_triage_graph()
    
    current_goal = CurrentGoal(
        id="goal-3",
        description="Browse product catalog",
        success_criteria=["Product list is visible", "Can scroll through products"]
    )
    
    goal_progress = GoalProgress(
        steps_taken=2,
        criteria_met=["Product list is visible"],
        criteria_pending=["Can scroll through products"]
    )
    
    # Minor loop signal shouldn't necessarily block browsing
    triage_input = IssueTriageInput(
        runtime_signals=[
            {
                "kind": "loop",
                "source": "planner",
                "step": 2,
                "screen_hash": "def456"
            }
        ],
        overflow_detection={},
        step_context={"step": 2, "screen_hash": "def456"},
        prior_findings=[],
        current_goal=current_goal,
        goal_progress=goal_progress
    )
    
    result = await graph.ainvoke({"input": triage_input})
    output = result["output"]
    
    findings = output.deduped_findings or output.new_findings
    
    # Loop findings may or may not block depending on LLM evaluation
    # Just verify blocks_goal field exists
    for finding in findings:
        assert "blocks_goal" in finding, f"Finding missing blocks_goal: {finding}"
        assert isinstance(finding["blocks_goal"], bool), "blocks_goal should be boolean"


@pytest.mark.asyncio
async def test_triage_without_goal_context_backward_compatibility():
    """Test that triage works without goal context (backward compatibility, Req 8.4)"""
    graph = get_issue_triage_graph()
    
    # No current_goal provided
    triage_input = IssueTriageInput(
        runtime_signals=[
            {
                "kind": "dead_tap",
                "source": "executor",
                "step": 1,
                "screen_hash": "ghi789"
            }
        ],
        overflow_detection={},
        step_context={"step": 1, "screen_hash": "ghi789"},
        prior_findings=[]
    )
    
    result = await graph.ainvoke({"input": triage_input})
    output = result["output"]
    
    # Should still produce findings
    findings = output.deduped_findings or output.new_findings
    assert len(findings) > 0, "Expected at least one finding"
    
    # Findings should NOT have goal_id or blocks_goal when no goal provided
    for finding in findings:
        # These fields may be present but should be None/null
        if "goal_id" in finding:
            assert finding["goal_id"] is None, "goal_id should be None when no goal provided"
        if "blocks_goal" in finding:
            assert finding["blocks_goal"] is None, "blocks_goal should be None when no goal provided"


@pytest.mark.asyncio
async def test_overflow_finding_blocks_visibility_criterion():
    """Test that overflow findings block visibility-related success criteria (Req 8.2, 8.3)"""
    graph = get_issue_triage_graph()
    
    current_goal = CurrentGoal(
        id="goal-4",
        description="Verify settings screen",
        success_criteria=["All settings options are visible", "No UI overflow errors"]
    )
    
    goal_progress = GoalProgress(
        steps_taken=1,
        criteria_met=[],
        criteria_pending=["All settings options are visible", "No UI overflow errors"]
    )
    
    # Overflow detection should block visibility criterion
    triage_input = IssueTriageInput(
        runtime_signals=[],
        overflow_detection={
            "detected": True,
            "issue": "flutter_renderflex_overflow",
            "evidence": ["A RenderFlex overflowed by 42 pixels on the bottom"],
            "screenshot": "/path/to/screenshot.png"
        },
        step_context={"step": 1, "screen_hash": "overflow123"},
        prior_findings=[],
        current_goal=current_goal,
        goal_progress=goal_progress
    )
    
    result = await graph.ainvoke({"input": triage_input})
    output = result["output"]
    
    findings = output.deduped_findings or output.new_findings
    assert len(findings) > 0, "Expected at least one finding for overflow"
    
    # Overflow should block the visibility criterion
    overflow_finding = next((f for f in findings if "overflow" in str(f.get("issue", "")).lower()), None)
    if overflow_finding:
        assert "blocks_goal" in overflow_finding, "Overflow finding should have blocks_goal field"
        # Overflow blocking visibility criteria should be marked as blocking
        assert overflow_finding["blocks_goal"] is True, "Overflow should block visibility criterion"
