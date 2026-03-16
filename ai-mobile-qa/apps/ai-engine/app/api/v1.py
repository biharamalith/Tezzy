import logging

from fastapi import APIRouter

from app.graphs.session_manager import get_session_manager_graph
from app.graphs.screen_analyst import get_screen_analyst_graph
from app.graphs.planner import get_planner_graph
from app.graphs.critic_gate import get_critic_gate_graph
from app.graphs.issue_triage import get_issue_triage_graph
from app.graphs.improvement_advisor import get_improvement_advisor_graph
from app.graphs.final_report import get_final_report_graph
from app.graphs.run_step import assemble_run_step_output, get_run_step_graph
from app.schemas.session_bootstrap import SessionBootstrapInput, SessionBootstrapOutput
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


router = APIRouter()
logger = logging.getLogger(__name__)


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
