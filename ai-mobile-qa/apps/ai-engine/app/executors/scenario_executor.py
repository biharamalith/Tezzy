"""
Scenario Executor - Orchestration layer for scenario-based testing.

This module implements the core execution engine that runs scenarios end-to-end
by coordinating the multi-agent system (Phases A-H) with goal progress tracking,
success criteria evaluation, and constraint enforcement.

Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 11.1, 11.5, 11.6, 30.1, 30.2, 30.5
"""

import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from app.evaluators.success_criteria import evaluate_all_criteria
from app.graphs.screen_analyst import get_screen_analyst_graph
from app.graphs.planner import get_planner_graph
from app.graphs.critic_gate import get_critic_gate_graph
from app.graphs.final_report import get_final_report_graph
from app.llm.client import LLMClient
from app.schemas.screen_understanding import ScreenUnderstandingInput, MemorySnapshot
from app.schemas.planner import PlannerInput, ScreenSize, AttemptCounters
from app.schemas.critic_gate import CriticGateInput
from app.schemas.final_report import FinalReportInput

logger = logging.getLogger(__name__)


class ScenarioExecutor:
    """
    Orchestrates scenario execution by coordinating the multi-agent system
    with goal progress tracking and constraint enforcement.
    
    Requirements: 10.1, 10.7
    """
    
    def __init__(self):
        """Initialize the scenario executor."""
        self.llm_client = LLMClient()
        
    async def execute(
        self,
        scenario: Dict[str, Any],
        device_info: Dict[str, Any],
        ui_snapshot_callback: Any,  # Callable that returns UI snapshot
        execute_action_callback: Any,  # Callable that executes an action
        progress_callback: Optional[Any] = None,  # Optional callback for progress updates
    ) -> Dict[str, Any]:
        """
        Execute a complete scenario end-to-end.
        
        Args:
            scenario: The scenario definition (SmokeScenario)
            device_info: Device information (serial, screen_size, etc.)
            ui_snapshot_callback: Async function to get current UI snapshot
            execute_action_callback: Async function to execute an action
            progress_callback: Optional async function to emit progress events
            
        Returns:
            ScenarioResult with run_id, status, goal_results, findings, etc.
            
        Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
        """
        # Initialize execution state
        run_id = str(uuid.uuid4())
        started_at = int(time.time() * 1000)  # milliseconds
        
        execution_state = self._initialize_execution_state(
            run_id=run_id,
            scenario=scenario,
            started_at=started_at,
        )
        
        logger.info(
            f"Starting scenario execution: run_id={run_id}, "
            f"scenario={scenario['name']}, goals={len(scenario['goals'])}"
        )
        
        # Validate scenario
        validation_result = self._validate_scenario(scenario)
        if not validation_result["valid"]:
            logger.error(f"Scenario validation failed: {validation_result['errors']}")
            return self._create_failure_result(
                run_id=run_id,
                scenario=scenario,
                execution_state=execution_state,
                error_message=f"Scenario validation failed: {validation_result['errors']}",
            )
        
        # Execute goals in order (Requirement 10.2)
        constraints = scenario.get("constraints", {})
        stop_on_first_failure = constraints.get("stop_on_first_failure", False)
        
        for goal_index, goal in enumerate(scenario["goals"]):
            execution_state["current_goal_index"] = goal_index
            
            logger.info(
                f"Starting goal {goal_index + 1}/{len(scenario['goals'])}: "
                f"{goal['description']}"
            )
            
            # Execute goal
            goal_progress = await self.execute_goal(
                goal=goal,
                state=execution_state,
                device_info=device_info,
                ui_snapshot_callback=ui_snapshot_callback,
                execute_action_callback=execute_action_callback,
                progress_callback=progress_callback,
            )
            
            # Store goal progress
            execution_state["goal_progress"][goal["id"]] = goal_progress
            
            # Update counters
            if goal_progress["status"] == "completed":
                execution_state["goals_completed"] += 1
                logger.info(f"Goal {goal_index + 1} completed successfully")
            elif goal_progress["status"] == "failed":
                execution_state["goals_failed"] += 1
                logger.warning(f"Goal {goal_index + 1} failed")
                
                # Check stop_on_first_failure (Requirements 10.4, 10.5)
                if stop_on_first_failure:
                    logger.info("stop_on_first_failure=true, halting execution")
                    break
            
            # Emit progress event
            if progress_callback:
                await progress_callback({
                    "run_id": run_id,
                    "current_goal_index": goal_index,
                    "goal_progress": goal_progress,
                    "goals_completed": execution_state["goals_completed"],
                    "goals_failed": execution_state["goals_failed"],
                })
        
        # Generate final report (Requirement 10.6)
        completed_at = int(time.time() * 1000)
        execution_state["completed_at"] = completed_at
        
        final_report = await self._generate_final_report(
            scenario=scenario,
            execution_state=execution_state,
        )
        
        # Create result
        result = self._create_scenario_result(
            run_id=run_id,
            scenario=scenario,
            execution_state=execution_state,
            final_report=final_report,
        )
        
        logger.info(
            f"Scenario execution complete: run_id={run_id}, "
            f"status={result['status']}, goals_completed={execution_state['goals_completed']}, "
            f"goals_failed={execution_state['goals_failed']}"
        )
        
        return result
    
    async def execute_goal(
        self,
        goal: Dict[str, Any],
        state: Dict[str, Any],
        device_info: Dict[str, Any],
        ui_snapshot_callback: Any,
        execute_action_callback: Any,
        progress_callback: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Execute a single goal until completion or failure.
        
        Args:
            goal: The goal definition (ScenarioGoal)
            state: Current execution state
            device_info: Device information
            ui_snapshot_callback: Function to get UI snapshot
            execute_action_callback: Function to execute action
            progress_callback: Optional progress callback
            
        Returns:
            GoalProgress with status, steps_taken, criteria_met, etc.
            
        Requirements: 10.2, 10.7, 10.8, 10.9, 11.1, 11.5, 11.6
        """
        # Initialize goal progress (Requirement 10.2)
        goal_progress = {
            "goal_id": goal["id"],
            "status": "in_progress",
            "steps_taken": 0,
            "success_criteria_met": [],
            "success_criteria_pending": goal["success_criteria"].copy(),
            "findings": [],
            "screenshots": [],
            "actions_log": [],
            "started_at": int(time.time() * 1000),
        }
        
        # Get constraints
        scenario = state["scenario"]
        constraints = scenario.get("constraints", {})
        max_steps_per_goal = constraints.get("max_steps_per_goal", 50)
        timeout_seconds = constraints.get("timeout_seconds", 300)
        
        goal_start_time = time.time()
        
        # Goal execution loop (Requirement 10.2)
        while True:
            # Check timeout (Requirement 10.9)
            elapsed_seconds = time.time() - goal_start_time
            if elapsed_seconds >= timeout_seconds:
                logger.warning(
                    f"Goal {goal['id']} timeout exceeded: "
                    f"{elapsed_seconds:.1f}s >= {timeout_seconds}s"
                )
                goal_progress["status"] = "failed"
                goal_progress["completed_at"] = int(time.time() * 1000)
                break
            
            # Check max_steps_per_goal (Requirement 10.8)
            if goal_progress["steps_taken"] >= max_steps_per_goal:
                logger.warning(
                    f"Goal {goal['id']} max steps exceeded: "
                    f"{goal_progress['steps_taken']} >= {max_steps_per_goal}"
                )
                goal_progress["status"] = "failed"
                goal_progress["completed_at"] = int(time.time() * 1000)
                break
            
            # Get UI snapshot
            try:
                ui_snapshot = await ui_snapshot_callback()
            except Exception as e:
                logger.error(f"Failed to get UI snapshot: {e}", exc_info=True)
                goal_progress["status"] = "failed"
                goal_progress["completed_at"] = int(time.time() * 1000)
                break
            
            # Call Phase B (Screen Analyst)
            phase_b_output = await self._call_phase_b(
                ui_snapshot=ui_snapshot,
                state=state,
                goal_progress=goal_progress,
            )
            
            # Evaluate success criteria (Requirements 11.1, 11.5, 11.6)
            criteria_met, criteria_still_pending = evaluate_all_criteria(
                criteria_pending=goal_progress["success_criteria_pending"],
                screen_state=ui_snapshot,
                phase_b_output=phase_b_output,
                llm_client=self.llm_client,
            )
            
            # Update goal progress
            for criterion in criteria_met:
                if criterion not in goal_progress["success_criteria_met"]:
                    goal_progress["success_criteria_met"].append(criterion)
                    logger.info(f"✓ Criterion satisfied: {criterion}")
            
            goal_progress["success_criteria_pending"] = criteria_still_pending
            
            # Check if all criteria met (Requirement 10.2)
            if len(criteria_still_pending) == 0:
                logger.info(f"Goal {goal['id']} completed: all criteria met")
                goal_progress["status"] = "completed"
                goal_progress["completed_at"] = int(time.time() * 1000)
                break
            
            # Call Phase C (Planner) with goal context
            phase_c_output = await self._call_phase_c(
                ui_snapshot=ui_snapshot,
                phase_b_output=phase_b_output,
                goal=goal,
                goal_progress=goal_progress,
                state=state,
                device_info=device_info,
            )
            
            # Call Phase D (Critic) with constraints
            phase_d_output = await self._call_phase_d(
                proposed_action=phase_c_output.get("action", {}),
                goal=goal,
                goal_progress=goal_progress,
                state=state,
                ui_snapshot=ui_snapshot,
            )
            
            # Get final action
            final_action = phase_d_output.get("final_action", {})
            
            # Execute action
            try:
                action_result = await execute_action_callback(final_action)
                result_status = action_result.get("result", "ok")
            except Exception as e:
                logger.error(f"Action execution failed: {e}", exc_info=True)
                result_status = "failed"
                state["failure_streak"] += 1
            else:
                if result_status == "ok":
                    state["failure_streak"] = 0
                else:
                    state["failure_streak"] += 1
            
            # Record action
            action_record = {
                "step": goal_progress["steps_taken"],
                "action": final_action,
                "screen_hash": ui_snapshot.get("screen_hash", ""),
                "result": result_status,
                "contributed_to_goal": len(criteria_met) > 0,
            }
            goal_progress["actions_log"].append(action_record)
            state["recent_actions"].append(action_record)
            if len(state["recent_actions"]) > 10:
                state["recent_actions"] = state["recent_actions"][-10:]
            
            # Increment steps
            goal_progress["steps_taken"] += 1
            
            # Update state management
            self._update_state_management(state, ui_snapshot, final_action)
            
            # Persist execution state (Requirement 30.1, 30.2)
            # Note: This would call executionStatePersistence.saveExecutionState()
            # For now, we log that state should be persisted
            logger.debug(f"State persistence point: run_id={state['run_id']}, step={goal_progress['steps_taken']}")
            
            # Check for critical errors
            if state["failure_streak"] >= 5:
                logger.error(f"Goal {goal['id']} failed: failure_streak >= 5")
                goal_progress["status"] = "failed"
                goal_progress["completed_at"] = int(time.time() * 1000)
                break
            
            # Emit progress
            if progress_callback:
                await progress_callback({
                    "goal_id": goal["id"],
                    "steps_taken": goal_progress["steps_taken"],
                    "criteria_met": goal_progress["success_criteria_met"],
                    "criteria_pending": goal_progress["success_criteria_pending"],
                })
        
        return goal_progress
    
    def _initialize_execution_state(
        self,
        run_id: str,
        scenario: Dict[str, Any],
        started_at: int,
    ) -> Dict[str, Any]:
        """
        Initialize execution state for a scenario run.
        
        Requirements: 10.1, 10.7
        """
        return {
            "run_id": run_id,
            "scenario": scenario,
            "current_goal_index": 0,
            "goal_progress": {},
            
            # Enhanced memory tracking
            "seen_element_keys": set(),
            "seen_hash_counts": {},
            "completed_screens": set(),
            "loop_count": 0,
            "no_element_count": 0,
            
            # Action history
            "recent_actions": [],
            "failure_streak": 0,
            
            # Scenario-specific tracking
            "goals_completed": 0,
            "goals_failed": 0,
            "total_findings": [],
            
            # Mode tracking
            "mode": "goal_directed",
            "login_step": 0,
            
            # Timestamps
            "started_at": started_at,
        }
    
    def _validate_scenario(self, scenario: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate scenario definition.
        
        Returns:
            Validation result with valid (bool), errors (list), warnings (list),
            estimated_steps (int), and estimated_duration_seconds (int)
        """
        errors = []
        warnings = []
        
        # Check required fields
        if not scenario.get("id"):
            errors.append("Missing scenario id")
        if not scenario.get("name"):
            errors.append("Missing scenario name")
        if not scenario.get("goals"):
            errors.append("Missing scenario goals")
        elif not isinstance(scenario["goals"], list) or len(scenario["goals"]) == 0:
            errors.append("Scenario must have at least one goal")
        
        # Validate goals
        for i, goal in enumerate(scenario.get("goals", [])):
            goal_num = i + 1
            if not goal.get("id"):
                errors.append(f"Goal {goal_num} missing id")
            if not goal.get("description"):
                errors.append(f"Goal {goal_num} missing description")
            if not goal.get("success_criteria"):
                errors.append(f"Goal {goal_num} missing success_criteria")
            elif not isinstance(goal["success_criteria"], list) or len(goal["success_criteria"]) == 0:
                errors.append(f"Goal {goal_num} must have at least one success criterion")
            
            # Validate goal-specific requirements
            goal_type = goal.get("type", "custom")
            
            # Login goals require credentials
            if goal_type == "login" and not scenario.get("credentials"):
                errors.append(f"Goal {goal_num} (type: login) requires scenario credentials")
            
            # Form_fill goals require form_data
            if goal_type == "form_fill" and not goal.get("form_data"):
                errors.append(f"Goal {goal_num} (type: form_fill) requires form_data")
        
        # Calculate estimates
        estimated_steps = self._estimate_steps(scenario)
        estimated_duration_seconds = estimated_steps * 2  # 2 seconds per step
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "estimated_steps": estimated_steps,
            "estimated_duration_seconds": estimated_duration_seconds,
        }
    
    def _estimate_steps(self, scenario: Dict[str, Any]) -> int:
        """
        Estimate total steps for a scenario based on goal types.
        
        Estimation logic:
        - login: 5-10 steps (average 7)
        - navigate: 3-8 steps (average 5)
        - form_fill: 5-15 steps (average 10)
        - verify: 2-5 steps (average 3)
        - explore_section: 10-20 steps (average 15)
        - custom: 5-10 steps (average 7)
        """
        step_estimates = {
            "login": 7,
            "navigate": 5,
            "form_fill": 10,
            "verify": 3,
            "explore_section": 15,
            "custom": 7,
        }
        
        total_steps = 0
        for goal in scenario.get("goals", []):
            goal_type = goal.get("type", "custom")
            total_steps += step_estimates.get(goal_type, 7)
        
        return total_steps
    
    async def _call_phase_b(
        self,
        ui_snapshot: Dict[str, Any],
        state: Dict[str, Any],
        goal_progress: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Call Phase B (Screen Analyst) to analyze current screen."""
        try:
            graph = get_screen_analyst_graph()
            
            memory_snapshot = MemorySnapshot(
                seen_hash_counts=state["seen_hash_counts"],
                seen_element_keys=list(state["seen_element_keys"]),
            )
            
            input_data = ScreenUnderstandingInput(
                step=goal_progress["steps_taken"],
                screen_hash=ui_snapshot.get("screen_hash", ""),
                ui_elements=ui_snapshot.get("ui_elements", []),
                screenshot_summary=ui_snapshot.get("screenshot_summary", ""),
                last_action=None,
                last_result=None,
                memory_snapshot=memory_snapshot,
            )
            
            result = await graph.ainvoke({"input": input_data})
            return result["output"].model_dump()
            
        except Exception as e:
            logger.error(f"Phase B failed: {e}", exc_info=True)
            return {
                "screen_type": "unknown",
                "confidence": 0.0,
                "candidate_targets": [],
                "blocker_flags": [],
                "reasoning_short": f"Phase B error: {str(e)}",
            }
    
    async def _call_phase_c(
        self,
        ui_snapshot: Dict[str, Any],
        phase_b_output: Dict[str, Any],
        goal: Dict[str, Any],
        goal_progress: Dict[str, Any],
        state: Dict[str, Any],
        device_info: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Call Phase C (Planner) with goal context."""
        try:
            graph = get_planner_graph()
            
            screen_size = ScreenSize(
                w=device_info.get("screen_size", {}).get("width", 1080),
                h=device_info.get("screen_size", {}).get("height", 1920),
            )
            
            attempt_counters = AttemptCounters(
                loop_count=state["loop_count"],
                no_element_count=state["no_element_count"],
            )
            
            # Build current_goal context
            current_goal = {
                "description": goal["description"],
                "type": goal.get("type", "custom"),
                "success_criteria": goal["success_criteria"],
                "hints": goal.get("hints", {}),
                "form_data": goal.get("form_data", {}),
            }
            
            # Build goal_progress context
            goal_progress_context = {
                "steps_taken": goal_progress["steps_taken"],
                "criteria_met": goal_progress["success_criteria_met"],
                "criteria_pending": goal_progress["success_criteria_pending"],
            }
            
            input_data = PlannerInput(
                mode=state["mode"],
                analysis=phase_b_output,
                memory_snapshot={
                    "seen_hash_counts": state["seen_hash_counts"],
                    "seen_element_keys": list(state["seen_element_keys"]),
                    "recent_actions": state["recent_actions"][-10:],
                },
                screen_size=screen_size,
                credentials=state["scenario"].get("credentials"),
                attempt_counters=attempt_counters,
                current_goal=current_goal,
                goal_progress=goal_progress_context,
            )
            
            result = await graph.ainvoke({"input": input_data})
            return result["output"].model_dump()
            
        except Exception as e:
            logger.error(f"Phase C failed: {e}", exc_info=True)
            return {
                "action": {"type": "back", "params": {}},
                "intent": "fallback_after_error",
                "expected_outcome": "recover",
                "fallback_if_fail": "screenshot",
            }
    
    async def _call_phase_d(
        self,
        proposed_action: Dict[str, Any],
        goal: Dict[str, Any],
        goal_progress: Dict[str, Any],
        state: Dict[str, Any],
        ui_snapshot: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Call Phase D (Critic) with goal constraints."""
        try:
            graph = get_critic_gate_graph()
            
            # Build goal_constraints
            goal_constraints = {
                "avoid_actions": goal.get("hints", {}).get("avoid_actions", []),
                "required_screens": goal.get("hints", {}).get("expected_screens", []),
                "max_steps": state["scenario"].get("constraints", {}).get("max_steps_per_goal", 50),
                "steps_taken": goal_progress["steps_taken"],
            }
            
            input_data = CriticGateInput(
                proposed_action=proposed_action,
                screen_hash=ui_snapshot.get("screen_hash", ""),
                seen_hash_counts=state["seen_hash_counts"],
                recent_actions=state["recent_actions"][-10:],
                failure_streak=state["failure_streak"],
                mode=state["mode"],
                goal_constraints=goal_constraints,
            )
            
            result = await graph.ainvoke({"input": input_data})
            return result["output"].model_dump()
            
        except Exception as e:
            logger.error(f"Phase D failed: {e}", exc_info=True)
            return {
                "decision": "approve",
                "final_action": proposed_action,
                "rejection_reason_or_null": None,
            }
    
    def _update_state_management(
        self,
        state: Dict[str, Any],
        ui_snapshot: Dict[str, Any],
        action: Dict[str, Any],
    ) -> None:
        """
        Update state management after action execution.
        
        Updates seen_element_keys, seen_hash_counts, loop_count, etc.
        """
        screen_hash = ui_snapshot.get("screen_hash", "")
        ui_elements = ui_snapshot.get("ui_elements", [])
        
        # Update seen_hash_counts
        if screen_hash:
            state["seen_hash_counts"][screen_hash] = state["seen_hash_counts"].get(screen_hash, 0) + 1
            
            # Update loop_count
            if state["seen_hash_counts"][screen_hash] > 1:
                state["loop_count"] += 1
            else:
                state["loop_count"] = 0
        
        # Update no_element_count
        if len(ui_elements) == 0:
            state["no_element_count"] += 1
        else:
            state["no_element_count"] = 0
        
        # Update seen_element_keys
        if action.get("type") == "tap" and action.get("params", {}).get("element_key"):
            element_key = action["params"]["element_key"]
            state["seen_element_keys"].add(element_key)
    
    async def _generate_final_report(
        self,
        scenario: Dict[str, Any],
        execution_state: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Generate final report using Phase H.
        
        Requirement: 10.6
        """
        try:
            graph = get_final_report_graph()
            
            # Build goal_results
            goal_results = []
            for goal in scenario["goals"]:
                goal_id = goal["id"]
                progress = execution_state["goal_progress"].get(goal_id, {})
                
                goal_results.append({
                    "goal_id": goal_id,
                    "description": goal["description"],
                    "status": progress.get("status", "not_started"),
                    "steps_taken": progress.get("steps_taken", 0),
                    "criteria_met": progress.get("success_criteria_met", []),
                    "criteria_failed": progress.get("success_criteria_pending", []),
                    "findings": progress.get("findings", []),
                    "screenshots": progress.get("screenshots", []),
                })
            
            input_data = FinalReportInput(
                run_metadata={
                    "run_id": execution_state["run_id"],
                    "started_at": execution_state["started_at"],
                    "completed_at": execution_state.get("completed_at", int(time.time() * 1000)),
                },
                steps_log=[],
                findings=execution_state["total_findings"],
                improvements={},
                screenshots_index={},
                scenario={
                    "id": scenario["id"],
                    "name": scenario["name"],
                    "description": scenario.get("description", ""),
                },
                goal_results=goal_results,
            )
            
            result = await graph.ainvoke({"input": input_data})
            return result["output"].model_dump()
            
        except Exception as e:
            logger.error(f"Phase H failed: {e}", exc_info=True)
            return {
                "markdown_report": f"# Report Generation Failed\n\nError: {str(e)}",
                "executive_summary": "Report generation failed",
                "pass_fail_status": "fail",
            }
    
    def _create_scenario_result(
        self,
        run_id: str,
        scenario: Dict[str, Any],
        execution_state: Dict[str, Any],
        final_report: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Create final scenario execution result."""
        total_goals = len(scenario["goals"])
        goals_completed = execution_state["goals_completed"]
        goals_failed = execution_state["goals_failed"]
        
        # Determine overall status
        if goals_completed == total_goals:
            status = "pass"
        elif goals_failed > 0:
            status = "fail"
        else:
            status = "partial"
        
        # Calculate coverage
        coverage_percentage = (goals_completed / total_goals * 100) if total_goals > 0 else 0
        
        # Calculate duration
        started_at = execution_state["started_at"]
        completed_at = execution_state.get("completed_at", int(time.time() * 1000))
        total_duration_seconds = (completed_at - started_at) / 1000
        
        # Build goal_results
        goal_results = []
        for goal in scenario["goals"]:
            goal_id = goal["id"]
            progress = execution_state["goal_progress"].get(goal_id)
            # Only include goals that were actually executed
            if progress:
                goal_results.append(progress)
        
        return {
            "run_id": run_id,
            "scenario": scenario,
            "status": status,
            "goal_results": goal_results,
            "total_steps": sum(g.get("steps_taken", 0) for g in goal_results),
            "total_duration_seconds": total_duration_seconds,
            "findings": execution_state["total_findings"],
            "coverage_percentage": coverage_percentage,
            "started_at": started_at,
            "completed_at": completed_at,
            "final_report": final_report,
        }
    
    def _create_failure_result(
        self,
        run_id: str,
        scenario: Dict[str, Any],
        execution_state: Dict[str, Any],
        error_message: str,
    ) -> Dict[str, Any]:
        """Create failure result when scenario cannot be executed."""
        return {
            "run_id": run_id,
            "scenario": scenario,
            "status": "fail",
            "goal_results": [],
            "total_steps": 0,
            "total_duration_seconds": 0,
            "findings": [{
                "severity": "error",
                "message": error_message,
                "step": 0,
            }],
            "coverage_percentage": 0,
            "started_at": execution_state["started_at"],
            "completed_at": int(time.time() * 1000),
            "final_report": {
                "markdown_report": f"# Scenario Execution Failed\n\n{error_message}",
                "executive_summary": error_message,
                "pass_fail_status": "fail",
            },
        }
