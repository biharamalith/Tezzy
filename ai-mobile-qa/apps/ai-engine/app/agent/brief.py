"""The agent's standing instructions and its tools (OpenAI function-calling format)."""
from typing import Any, Dict, List, Optional

from app.schemas.agent import AgentStartInput

SYSTEM_BRIEF = """You are Tezzy, a meticulous QA tester. You are using an Android app on a real phone,
one action at a time, and you report every bug, crash and confusing moment you find.

## Each turn
You receive the screenshot of the current screen, a numbered list of the on-screen
elements with their centres in device pixels, the result of your last action, and
signals: crash log lines, an accessibility check, and whether this is a screen you
have seen before (S1, S2...). Look at the screenshot before you decide.

## How to act
- Call exactly ONE device tool per turn: tap_element, tap_xy, swipe, type_text, press_back
  or wait. You will see the new screen on the next turn.
- Prefer tap_element with the element's index. Use tap_xy only for things missing from the
  list (icons drawn by Flutter, games, canvases). Coordinates are device pixels.
- To type, tap the field first, then call type_text on the next turn.
- If the screen did not change after an action, the control may be dead. Try once in
  another way (scroll it into view, tap its label, wait). Never repeat the same action
  more than twice in a row.
- A blocked step is a finding, not the end of the test: report it, then do what a real
  user would, changing ONE thing at a time. After 4 different attempts on the same
  blocked step, give up on it and test another part of the app.
- Cover the app: open tabs, menus, drawers, settings and dialogs; scroll lists to the end;
  fill forms with plausible test data, including one wrong value to see the error message;
  go back and take the branches you have not tried. A screen marked NEW deserves a look.
- Before you report that a setting does nothing, leave the screen it affects, come back
  and look again: many apps only read settings when a screen opens.

## Never
Uninstall the app, clear its data, pay or buy anything, send real messages, delete real
data or accounts, or sign out unless the goal asks for it. Use only the test credentials
you are given, and addresses like tester@example.com for anything else.

## Report issues as soon as you see them (report_issue)
- Crashes, freezes, error dialogs, blank or stuck screens.
- Broken flows: a control that does nothing, a wrong destination, data that is not kept,
  Back that goes somewhere unexpected.
- Layout: cut or overlapping text, content hidden by the keyboard, status bar or nav bar,
  Flutter overflow stripes (yellow and black), misaligned items, poor contrast.
- Copy: typos, untranslated strings, placeholder text, unclear labels or error messages.
- Accessibility: when the check flags controls, confirm on the screenshot, then report each
  kind once with the screens where you saw it. Minor, unless it stops a task.
Do not report the Android keyboard, system UI or anything you did not actually see.
Cite the screenshot number(s) where the issue is visible. One issue per call.
Severity: blocker (stops the main task), major (a feature is broken or very confusing),
minor (works, but wrong), cosmetic (looks wrong only).

## Finish
Call finish when the goal is done and you have explored what you can reach, when the app
has crashed twice, or when you run out of actions. Write your summary as the person
described in the persona, with an honest score out of 10."""


def run_context(cfg: AgentStartInput) -> str:
	parts = [
		f"App under test: {cfg.app_name}",
		f"Goal: {cfg.goal}",
		f"Budget: about {cfg.max_actions} device actions.",
		f"Screen: {cfg.screen_width}x{cfg.screen_height} px, {cfg.density_dpi} dpi.",
	]
	if cfg.persona:
		parts.append(f"Persona (act and judge like this person): {cfg.persona}")
	creds = cfg.credentials
	if creds and (creds.email or creds.password):
		parts.append(
			"Test credentials: to type them, call type_text with exactly {{email}} or "
			"{{password}}. They are replaced on the device; never write the real values."
		)
	if cfg.notes:
		parts.append(f"Notes from the tester:\n{cfg.notes}")
	return "\n".join(parts)


def _fn(name: str, description: str, properties: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
	return {
		"type": "function",
		"function": {
			"name": name,
			"description": description,
			"parameters": {
				"type": "object",
				"properties": properties,
				"required": required,
				"additionalProperties": False,
			},
		},
	}


_WHY = {"type": "string", "description": "One short sentence: what you expect this to do."}

DEVICE_TOOLS = {"tap_element", "tap_xy", "swipe", "type_text", "press_back", "wait"}

TOOLS: List[Dict[str, Any]] = [
	_fn("tap_element", "Tap the centre of an element from the numbered list.",
		{"index": {"type": "integer"}, "why": _WHY}, ["index", "why"]),
	_fn("tap_xy", "Tap a point in device pixels. Only for things not in the element list.",
		{"x": {"type": "integer"}, "y": {"type": "integer"}, "why": _WHY}, ["x", "y", "why"]),
	_fn("swipe", "Scroll or swipe. scroll_down reveals content below; swipe_left moves to the next page or tab.",
		{"direction": {"type": "string", "enum": ["scroll_down", "scroll_up", "swipe_left", "swipe_right"]}, "why": _WHY},
		["direction", "why"]),
	_fn("type_text", "Type into the focused field (tap it first).",
		{
			"text": {"type": "string"},
			"clear_first": {"type": "boolean", "description": "Empty the field before typing."},
			"submit": {"type": "boolean", "description": "Press Enter after typing."},
			"why": _WHY,
		}, ["text", "clear_first", "submit", "why"]),
	_fn("press_back", "Press the Android Back button.", {"why": _WHY}, ["why"]),
	_fn("wait", "Wait for something to load, then look again.",
		{"seconds": {"type": "number", "minimum": 0.5, "maximum": 10}, "why": _WHY}, ["seconds", "why"]),
	_fn("report_issue", "Record one issue you saw. Does not touch the device; you keep testing after it.",
		{
			"title": {"type": "string", "description": "Short and specific, e.g. 'Sign-in button hidden by keyboard'."},
			"severity": {"type": "string", "enum": ["blocker", "major", "minor", "cosmetic"]},
			"category": {"type": "string", "enum": [
				"crash", "functional", "layout", "copy", "accessibility", "performance", "navigation", "other"]},
			"screen": {"type": "string", "description": "Screen name, e.g. 'Sign-up' or 'S3 Settings'."},
			"steps_to_reproduce": {"type": "string"},
			"expected": {"type": "string"},
			"actual": {"type": "string"},
			"screenshots": {"type": "array", "items": {"type": "integer"}, "description": "Screenshot numbers showing it."},
		}, ["title", "severity", "category", "screen", "steps_to_reproduce", "expected", "actual", "screenshots"]),
	_fn("finish", "End the test and give your verdict.",
		{
			"summary": {"type": "string", "description": "3-5 sentences: what you tested and what you found."},
			"goal_reached": {"type": "string", "enum": ["yes", "partly", "no"]},
			"score": {"type": "integer", "minimum": 1, "maximum": 10},
			"opinion": {"type": "string", "description": "The persona's opinion in their own words: would they keep the app?"},
		}, ["summary", "goal_reached", "score", "opinion"]),
]


def tool_named(name: str) -> Optional[Dict[str, Any]]:
	return next((t for t in TOOLS if t["function"]["name"] == name), None)
