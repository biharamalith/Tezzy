import asyncio
import logging
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.graphs.session_manager import get_session_manager_graph
from app.graphs.screen_analyst import get_screen_analyst_graph
from app.graphs.planner import get_planner_graph
from app.graphs.critic_gate import get_critic_gate_graph
from app.graphs.issue_triage import get_issue_triage_graph
from app.graphs.improvement_advisor import get_improvement_advisor_graph
from app.graphs.final_report import get_final_report_graph
from app.graphs.run_step import assemble_run_step_output, get_run_step_graph
from app.graphs.vision_analyst import get_vision_analyst_graph
from app.schemas.session_bootstrap import SessionBootstrapInput, SessionBootstrapOutput, Scenario
from app.schemas.screen_understanding import (
    ScreenUnderstandingInput,
    ScreenUnderstandingOutput,
)
from app.schemas.planner import PlannerInput, PlannerOutput
from app.schemas.critic_gate import CriticGateInput, CriticGateOutput
from app.schemas.issue_triage import IssueTriageInput, IssueTriageOutput
from app.schemas.improvement_suggestions import (
    ImprovementSuggestionInput,
    ImprovementSuggestionOutput,
)
from app.schemas.final_report import FinalReportInput, FinalReportOutput
from app.schemas.run_step import RunStepInput, RunStepOutput
from app.schemas.vision import VisionAnalysisInput, VisionAnalysisOutput
from app.executors.scenario_executor import ScenarioExecutor


router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory storage for active scenario runs
# In production, this would be Redis or a database
active_runs: Dict[str, Dict[str, Any]] = {}


@router.get("/health")
async def health() -> dict:
    return {"ok": True}


@router.post("/session/bootstrap", response_model=SessionBootstrapOutput)
async def session_bootstrap(payload: SessionBootstrapInput) -> SessionBootstrapOutput:
    graph = get_session_manager_graph()
    result = await graph.ainvoke({"input": payload})
    return result["output"]


@router.post("/screen/analyze", response_model=ScreenUnderstandingOutput)
async def screen_analyze(payload: ScreenUnderstandingInput) -> ScreenUnderstandingOutput:
    graph = get_screen_analyst_graph()
    result = await graph.ainvoke({"input": payload})
    return result["output"]


@router.post("/plan/next_action", response_model=PlannerOutput)
async def plan_next_action(payload: PlannerInput) -> PlannerOutput:
    graph = get_planner_graph()
    result = await graph.ainvoke({"input": payload})
    return result["output"]


@router.post("/critic/gate_action", response_model=CriticGateOutput)
async def critic_gate_action(payload: CriticGateInput) -> CriticGateOutput:
    graph = get_critic_gate_graph()
    result = await graph.ainvoke({"input": payload})
    return result["output"]


@router.post("/issues/triage", response_model=IssueTriageOutput)
async def issues_triage(payload: IssueTriageInput) -> IssueTriageOutput:
    graph = get_issue_triage_graph()
    result = await graph.ainvoke({"input": payload})
    return result["output"]


@router.post("/improvements/suggest", response_model=ImprovementSuggestionOutput)
async def improvements_suggest(
    payload: ImprovementSuggestionInput,
) -> ImprovementSuggestionOutput:
    graph = get_improvement_advisor_graph()
    result = await graph.ainvoke({"input": payload})
    return result["output"]


@router.post("/report/finalize", response_model=FinalReportOutput)
async def report_finalize(payload: FinalReportInput) -> FinalReportOutput:
    graph = get_final_report_graph()
    result = await graph.ainvoke({"input": payload})
    return result["output"]


@router.post("/vision/analyze", response_model=VisionAnalysisOutput)
async def vision_analyze(payload: VisionAnalysisInput) -> VisionAnalysisOutput:
    """Analyze a base64 screenshot with GPT-4o vision and return structured UI defect findings."""
    graph = get_vision_analyst_graph()
    result = await graph.ainvoke({"input": payload})
    return result["output"]


@router.post("/run/step", response_model=RunStepOutput)
async def run_step(payload: RunStepInput) -> RunStepOutput:
    graph = get_run_step_graph()
    try:
        state = await graph.ainvoke({"input": payload})
        return assemble_run_step_output(state)
    except Exception as exc:
        logger.exception("/v1/run/step failed at step=%s screen_hash=%s", payload.step, payload.screen_hash)

        # Keep the client loop alive with a deterministic fallback instead of 500.
        # This avoids hard-stopping the desktop orchestrator on transient LLM/schema errors.
        fallback_action = {
            "type": "swipe",
            "params": {
                "direction": "up",
                "duration_ms": 280,
            },
        }

        return RunStepOutput(
            triage={
                "error": "run_step_internal_error",
                "detail": str(exc),
            },
            analysis={
                "screen_type": "unknown",
                "confidence": 0.0,
                "candidate_targets": [],
                "blocker_flags": ["run_step_internal_error"],
                "reasoning_short": "Fallback analysis after internal error.",
            },
            plan={
                "action": fallback_action,
                "intent": "recover_from_internal_error",
                "expected_outcome": "continue exploration without crashing loop",
                "fallback_if_fail": "try back then screenshot",
            },
            critic={
                "decision": "approve",
                "final_action": fallback_action,
                "rejection_reason_or_null": None,
                "recovery_tag": "blocker_recovery",
            },
            next_action=fallback_action,
            should_continue=True,
        )


# Scenario execution schemas
class ScenarioExecuteRequest(BaseModel):
    """Request to execute a scenario"""
    scenario: Scenario
    device_info: Dict[str, Any]


class GoalResult(BaseModel):
    """Result of a single goal execution"""
    goal_id: str
    status: str
    steps_taken: int
    success_criteria_met: list
    success_criteria_pending: list
    findings: list = []
    screenshots: list = []


class ScenarioExecuteResponse(BaseModel):
    """Response from scenario execution start"""
    run_id: str
    status: str
    current_goal_index: int
    goal_results: list = []


class ScenarioStatusResponse(BaseModel):
    """Response from scenario status check"""
    run_id: str
    status: str
    current_goal_index: int
    goal_results: list
    findings_count: int
    final_report: Optional[Dict[str, Any]] = None


# Mock callbacks for scenario executor
# In production, these would interact with the device bridge
async def mock_ui_snapshot_callback():
    """Mock UI snapshot callback for testing"""
    return {
        "screen_hash": "mock_hash",
        "ui_elements": [],
        "screenshot_summary": "Mock screen",
    }


async def mock_execute_action_callback(action):
    """Mock action execution callback for testing"""
    return {"result": "ok"}


async def mock_progress_callback(progress):
    """Mock progress callback for testing"""
    logger.info(f"Progress update: {progress}")


@router.post("/scenario/execute", response_model=ScenarioExecuteResponse)
async def scenario_execute(payload: ScenarioExecuteRequest) -> ScenarioExecuteResponse:
    """
    Execute a scenario asynchronously.
    
    Requirements: 16.1, 16.2, 16.3, 16.4
    """
    # Validate scenario
    executor = ScenarioExecutor()
    scenario_dict = payload.scenario.model_dump()
    validation_result = executor._validate_scenario(scenario_dict)
    
    if not validation_result["valid"]:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Scenario validation failed",
                "errors": validation_result["errors"]
            }
        )
    
    # Generate run_id
    run_id = str(uuid.uuid4())
    
    # Initialize run status
    active_runs[run_id] = {
        "run_id": run_id,
        "status": "running",
        "current_goal_index": 0,
        "goal_results": [],
        "findings_count": 0,
        "final_report": None,
        "scenario": scenario_dict,
        "device_info": payload.device_info,
    }
    
    # Start async execution
    asyncio.create_task(execute_scenario_background(run_id, scenario_dict, payload.device_info))
    
    # Return immediately with run_id
    return ScenarioExecuteResponse(
        run_id=run_id,
        status="running",
        current_goal_index=0,
        goal_results=[],
    )


async def execute_scenario_background(run_id: str, scenario: Dict[str, Any], device_info: Dict[str, Any]):
    """
    Execute scenario in background and update active_runs.
    
    This is a simplified implementation that uses mock callbacks.
    In production, this would use real device bridge callbacks.
    """
    try:
        executor = ScenarioExecutor()
        
        # Execute scenario with mock callbacks
        result = await executor.execute(
            scenario=scenario,
            device_info=device_info,
            ui_snapshot_callback=mock_ui_snapshot_callback,
            execute_action_callback=mock_execute_action_callback,
            progress_callback=lambda progress: update_run_progress(run_id, progress),
        )
        
        # Update run status with final result
        if run_id in active_runs:
            active_runs[run_id]["status"] = result["status"]
            active_runs[run_id]["goal_results"] = result["goal_results"]
            active_runs[run_id]["findings_count"] = len(result.get("findings", []))
            active_runs[run_id]["final_report"] = result.get("final_report")
            
        logger.info(f"Scenario execution completed: run_id={run_id}, status={result['status']}")
        
    except Exception as e:
        logger.error(f"Scenario execution failed: run_id={run_id}, error={e}", exc_info=True)
        if run_id in active_runs:
            active_runs[run_id]["status"] = "failed"
            active_runs[run_id]["error"] = str(e)


async def update_run_progress(run_id: str, progress: Dict[str, Any]):
    """Update run progress in active_runs"""
    if run_id in active_runs:
        if "current_goal_index" in progress:
            active_runs[run_id]["current_goal_index"] = progress["current_goal_index"]
        if "goal_progress" in progress:
            # Update goal results
            goal_results = active_runs[run_id].get("goal_results", [])
            goal_progress = progress["goal_progress"]
            
            # Find and update or append
            found = False
            for i, gr in enumerate(goal_results):
                if gr.get("goal_id") == goal_progress.get("goal_id"):
                    goal_results[i] = goal_progress
                    found = True
                    break
            
            if not found:
                goal_results.append(goal_progress)
            
            active_runs[run_id]["goal_results"] = goal_results


@router.get("/scenario/execute/{run_id}/status", response_model=ScenarioStatusResponse)
async def scenario_status(run_id: str) -> ScenarioStatusResponse:
    """
    Get current execution status for a scenario run.
    
    Requirements: 16.5
    """
    if run_id not in active_runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    
    run_data = active_runs[run_id]
    
    return ScenarioStatusResponse(
        run_id=run_id,
        status=run_data["status"],
        current_goal_index=run_data["current_goal_index"],
        goal_results=run_data["goal_results"],
        findings_count=run_data["findings_count"],
        final_report=run_data.get("final_report") if run_data["status"] in ["pass", "fail", "partial"] else None,
    )


class ScenarioValidateRequest(BaseModel):
    """Request to validate a scenario"""
    scenario: Scenario


class ScenarioValidateResponse(BaseModel):
    """Response from scenario validation"""
    valid: bool
    errors: list = []
    warnings: list = []
    estimated_steps: int
    estimated_duration_seconds: int


@router.post("/scenario/validate", response_model=ScenarioValidateResponse)
async def scenario_validate(payload: ScenarioValidateRequest) -> ScenarioValidateResponse:
    """
    Validate a scenario definition before execution.
    
    Requirements: 17.1, 17.2, 17.3, 17.4
    """
    # Create executor and validate
    executor = ScenarioExecutor()
    scenario_dict = payload.scenario.model_dump()
    validation_result = executor._validate_scenario(scenario_dict)
    
    return ScenarioValidateResponse(
        valid=validation_result["valid"],
        errors=validation_result["errors"],
        warnings=validation_result["warnings"],
        estimated_steps=validation_result["estimated_steps"],
        estimated_duration_seconds=validation_result["estimated_duration_seconds"],
    )


class ScenarioTemplate(BaseModel):
    """Scenario template definition"""
    id: str
    name: str
    description: str
    goal_types: list
    estimated_steps: int


class ScenarioTemplatesResponse(BaseModel):
    """Response from templates endpoint"""
    templates: list


@router.get("/scenario/templates", response_model=ScenarioTemplatesResponse)
async def scenario_templates() -> ScenarioTemplatesResponse:
    """
    Get available scenario templates.
    
    Requirements: 18.1, 18.2, 18.3
    """
    import json
    import os
    
    # Load templates from scenarios.json
    templates_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "templates",
        "scenarios.json"
    )
    
    try:
        with open(templates_path, "r") as f:
            templates_data = json.load(f)
        
        # Extract goal_types from each template
        templates = []
        for template in templates_data.get("templates", []):
            goal_types = [goal.get("type", "custom") for goal in template.get("goals", [])]
            
            templates.append({
                "id": template["id"],
                "name": template["name"],
                "description": template["description"],
                "goal_types": goal_types,
                "estimated_steps": template["estimated_steps"],
            })
        
        return ScenarioTemplatesResponse(templates=templates)
        
    except FileNotFoundError:
        logger.error(f"Templates file not found: {templates_path}")
        raise HTTPException(
            status_code=500,
            detail="Scenario templates file not found"
        )
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse templates file: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to parse scenario templates"
        )
    except Exception as e:
        logger.error(f"Error loading templates: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error loading scenario templates: {str(e)}"
        )
