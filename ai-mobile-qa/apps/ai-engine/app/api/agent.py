"""Single-agent test loop: /v1/agent/start, /v1/agent/step, /v1/agent/finish.

The desktop app calls start once, then step after every observation until it gets
status "done" (or the user stops), then finish to get the report. Sessions live in
memory: this engine is a local, single-user service bound to 127.0.0.1.
"""
import logging
import time
from collections import OrderedDict
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.agent.report import render_markdown
from app.agent.session import AgentSession, Completion
from app.llm.client import LLMClient
from app.schemas.agent import (
	AgentFinishInput,
	AgentReport,
	AgentStartInput,
	AgentStartOutput,
	AgentStepInput,
	AgentStepOutput,
)

router = APIRouter(prefix="/agent", tags=["agent"])
logger = logging.getLogger(__name__)

MAX_SESSIONS = 8
IDLE_TTL_S = 2 * 60 * 60

_sessions: "OrderedDict[str, tuple[AgentSession, float]]" = OrderedDict()

# Tests replace this to run the loop without a model.
_completion_override: Optional[Completion] = None
_model_override: Optional[str] = None


def _new_session(cfg: AgentStartInput) -> AgentSession:
	if _completion_override is not None:
		return AgentSession(cfg, _completion_override, _model_override or "test-model")
	llm = LLMClient()
	return AgentSession(cfg, llm.chat_tools, llm.agent_model)


def _prune() -> None:
	now = time.monotonic()
	for rid in [r for r, (_, t) in _sessions.items() if now - t > IDLE_TTL_S]:
		_sessions.pop(rid, None)
	while len(_sessions) >= MAX_SESSIONS:
		_sessions.popitem(last=False)


def _get(run_id: str) -> AgentSession:
	entry = _sessions.get(run_id)
	if entry is None:
		raise HTTPException(status_code=404, detail="unknown_run: start a new agent run")
	_sessions[run_id] = (entry[0], time.monotonic())
	_sessions.move_to_end(run_id)
	return entry[0]


@router.post("/start", response_model=AgentStartOutput)
async def agent_start(payload: AgentStartInput) -> AgentStartOutput:
	_prune()
	try:
		session = _new_session(payload)
	except Exception:
		logger.exception("agent start failed")
		raise HTTPException(status_code=500, detail="agent_start_failed: check the AI engine log and API key")
	_sessions[session.run_id] = (session, time.monotonic())
	logger.info("agent %s started (model %s, %d actions)", session.run_id, session.model, payload.max_actions)
	return AgentStartOutput(run_id=session.run_id, model=session.model)


@router.post("/step", response_model=AgentStepOutput)
async def agent_step(payload: AgentStepInput) -> AgentStepOutput:
	session = _get(payload.run_id)
	async with session.lock:
		try:
			return await session.step(payload)
		except HTTPException:
			raise
		except Exception:
			# Provider errors can carry keys or local paths: log them, return a stable code.
			logger.exception("agent %s: step %d failed", payload.run_id, payload.step)
			raise HTTPException(status_code=502, detail="model_call_failed: see the AI engine log")


@router.post("/finish", response_model=AgentReport)
async def agent_finish(payload: AgentFinishInput) -> AgentReport:
	session = _get(payload.run_id)
	async with session.lock:
		final = await session.finalize(payload.reason)
		report = AgentReport(
			run_id=session.run_id,
			model=session.model,
			final=final,
			findings=session.sorted_findings(),
			actions_taken=session.actions_taken,
			screens_reached=len(session.screens.screens),
			steps=session.steps,
			usage=session.usage,
			markdown=render_markdown(session),
		)
	_sessions.pop(payload.run_id, None)
	return report
