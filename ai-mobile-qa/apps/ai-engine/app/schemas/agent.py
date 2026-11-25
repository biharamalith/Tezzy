"""Contracts for the single-agent test loop (/v1/agent/*).

The desktop app owns the device: it sends an observation (screenshot, UI elements,
crash log, result of the last action) and gets back exactly one action to execute.
The engine owns the agent: one conversation per run, kept between steps.
"""
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class AgentCredentials(BaseModel):
	email: Optional[str] = None
	password: Optional[str] = None


class AgentStartInput(BaseModel):
	app_name: str = Field(default="the app", max_length=200)
	goal: str = Field(
		default="Use the app like a new user: reach its main features and visit as many screens as you can.",
		max_length=2000,
	)
	persona: Optional[str] = Field(default=None, max_length=1000)
	notes: Optional[str] = Field(default=None, max_length=4000)
	credentials: Optional[AgentCredentials] = None
	max_actions: int = Field(default=30, ge=1, le=200)
	screen_width: int = Field(default=1080, ge=1)
	screen_height: int = Field(default=1920, ge=1)
	density_dpi: int = Field(default=420, ge=80, le=1000)


class AgentStartOutput(BaseModel):
	run_id: str
	model: str


class UiElementIn(BaseModel):
	"""One element of the Android UI tree, as the desktop app's UiElement serialises it."""

	model_config = ConfigDict(extra="ignore", populate_by_name=True)

	class_name: str = Field(default="", alias="class")
	class_full: str = ""
	text: str = ""
	content_desc: str = ""
	resource_id: str = ""
	clickable: bool = False
	enabled: bool = True
	scrollable: bool = False
	checkable: bool = False
	checked: bool = False
	bounds: str = ""
	center_x: int = 0
	center_y: int = 0
	depth: int = 0


class AgentStepInput(BaseModel):
	run_id: str
	step: int = Field(ge=1)
	screenshot_b64: Optional[str] = None
	elements: List[UiElementIn] = Field(default_factory=list)
	crash_log: List[str] = Field(default_factory=list)
	last_action_result: Optional[str] = Field(default=None, max_length=2000)


ActionType = Literal["tap", "swipe", "type_text", "back", "wait"]


class DeviceAction(BaseModel):
	"""A concrete action for the desktop app. Coordinates are device pixels."""

	type: ActionType
	x: Optional[int] = None
	y: Optional[int] = None
	x2: Optional[int] = None
	y2: Optional[int] = None
	duration_ms: Optional[int] = None
	text: Optional[str] = None
	clear_first: bool = False
	submit: bool = False
	# Human-readable, with credentials redacted. Safe to log and show.
	label: str


class AgentStepOutput(BaseModel):
	status: Literal["action", "done"]
	action: Optional[DeviceAction] = None
	thought: Optional[str] = None
	actions_taken: int
	findings_count: int
	screen_id: Optional[str] = None
	new_screen: bool = False


Severity = Literal["blocker", "major", "minor", "cosmetic"]


class AgentFinding(BaseModel):
	id: int
	title: str
	severity: Severity
	category: str
	screen: str = ""
	steps_to_reproduce: str = ""
	expected: str = ""
	actual: str = ""
	screenshots: List[int] = Field(default_factory=list)
	source: Literal["agent", "logcat"] = "agent"


class AgentFinal(BaseModel):
	summary: str
	goal_reached: Literal["yes", "partly", "no"]
	score: Optional[int] = None
	opinion: str = ""
	end_reason: str


class AgentFinishInput(BaseModel):
	run_id: str
	reason: str = Field(default="finished", max_length=200)


class AgentReport(BaseModel):
	run_id: str
	model: str
	final: AgentFinal
	findings: List[AgentFinding]
	actions_taken: int
	screens_reached: int
	steps: List[dict]
	usage: dict
	markdown: str
