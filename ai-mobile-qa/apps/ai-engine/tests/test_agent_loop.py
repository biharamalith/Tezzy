"""The single-agent loop, end to end through the API, with a scripted model (no network)."""
import json
from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient

from app.agent import observation as obs
from app.api import agent as agent_api
from app.main import create_app
from app.schemas.agent import UiElementIn

TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


def el(text="", cls="android.widget.Button", bounds="[0,0][100,100]", clickable=True, rid="", desc=""):
	return {"class": cls.rsplit(".", 1)[-1], "class_full": cls, "text": text, "content_desc": desc,
			"resource_id": rid, "clickable": clickable, "enabled": True, "scrollable": False,
			"checkable": False, "checked": False, "bounds": bounds, "center_x": 0, "center_y": 0, "depth": 1}


LOGIN = [
	el("Email", "android.widget.EditText", "[100,400][980,520]", rid="app:id/email"),
	el("Password", "android.widget.EditText", "[100,560][980,680]", rid="app:id/password"),
	el("Sign in", bounds="[100,800][980,940]", rid="app:id/sign_in"),
]
HOME = [
	el("Welcome", "android.widget.TextView", "[0,100][1080,200]", clickable=False),
	el("Settings", bounds="[0,2200][540,2340]", rid="app:id/tab_settings"),
	el("", "android.widget.ImageButton", "[960,100][1040,180]", rid="app:id/menu"),
]


def call(name: str, **args) -> Dict[str, Any]:
	return {"id": f"call_{name}_{len(json.dumps(args))}", "name": name, "arguments": json.dumps(args)}


class ScriptedModel:
	"""Returns the next scripted assistant message on each call and keeps what it was sent."""

	def __init__(self, script: List[Dict[str, Any]]):
		self.script = list(script)
		self.calls: List[Dict[str, Any]] = []

	async def __call__(self, messages, tools, tool_choice):
		self.calls.append({"messages": json.loads(json.dumps(messages)), "tool_choice": tool_choice,
						   "tools": [t["function"]["name"] for t in tools]})
		if not self.script:
			return {"content": None, "tool_calls": [call("finish", summary="Out of script.", goal_reached="no",
														 score=1, opinion="")], "usage": {}}
		turn = self.script.pop(0)
		return {"content": turn.get("content"), "tool_calls": turn.get("tool_calls", []),
				"usage": {"prompt_tokens": 100, "completion_tokens": 10}}


@pytest.fixture
def client():
	yield TestClient(create_app())
	agent_api._completion_override = None
	agent_api._sessions.clear()


def start(client, model, **cfg):
	agent_api._completion_override = model
	body = {"app_name": "Demo", "goal": "Sign in and open Settings", "max_actions": 10,
			"screen_width": 1080, "screen_height": 2400, "density_dpi": 420,
			"credentials": {"email": "qa@example.com", "password": "s3cret!"}, **cfg}
	r = client.post("/v1/agent/start", json=body)
	assert r.status_code == 200, r.text
	return r.json()["run_id"]


def step(client, run_id, n, elements, result=None, crash=None):
	r = client.post("/v1/agent/step", json={"run_id": run_id, "step": n, "screenshot_b64": TINY_PNG,
											"elements": elements, "crash_log": crash or [],
											"last_action_result": result})
	assert r.status_code == 200, r.text
	return r.json()


def test_full_run_taps_types_reports_and_finishes(client):
	model = ScriptedModel([
		{"content": "Login screen. Tap the email field.", "tool_calls": [call("tap_element", index=0, why="focus email")]},
		{"tool_calls": [call("type_text", text="{{email}}", clear_first=True, submit=False, why="enter email")]},
		{"tool_calls": [
			call("report_issue", title="Menu button has no label", severity="minor", category="accessibility",
				 screen="Home", steps_to_reproduce="Sign in", expected="A label", actual="None", screenshots=[3]),
			call("tap_element", index=2, why="open settings"),
		]},
		{"tool_calls": [call("finish", summary="Signed in, opened Settings.", goal_reached="yes", score=8,
							 opinion="Easy enough.")]},
	])
	run_id = start(client, model)

	out = step(client, run_id, 1, LOGIN)
	assert out["status"] == "action"
	assert out["action"]["type"] == "tap" and (out["action"]["x"], out["action"]["y"]) == (540, 460)
	assert out["thought"] == "Login screen. Tap the email field."
	assert out["new_screen"] is True and out["screen_id"] == "S1"

	out = step(client, run_id, 2, LOGIN, result="ok")
	action = out["action"]
	assert action["type"] == "type_text" and action["text"] == "qa@example.com"
	assert "qa@example.com" not in action["label"], "credentials must not reach labels or logs"
	assert out["screen_id"] == "S1" and out["new_screen"] is False

	out = step(client, run_id, 3, HOME, result="ok")
	assert out["action"]["label"] == 'tap [2] button "Settings"'
	assert out["findings_count"] == 1 and out["screen_id"] == "S2"

	out = step(client, run_id, 4, HOME, result="ok")
	assert out["status"] == "done"

	report = client.post("/v1/agent/finish", json={"run_id": run_id, "reason": "finished"}).json()
	assert report["final"]["goal_reached"] == "yes" and report["final"]["score"] == 8
	assert report["final"]["end_reason"] == "finished"
	assert report["actions_taken"] == 3 and report["screens_reached"] == 2
	assert report["findings"][0]["title"] == "Menu button has no label"
	assert report["steps"][0]["result"] == "ok"
	md = report["markdown"]
	assert "Menu button has no label" in md and "[03](03.png)" in md and "s3cret" not in md
	# The session is freed after finish.
	assert client.post("/v1/agent/step", json={"run_id": run_id, "step": 5}).status_code == 404


def test_conversation_is_valid_and_old_screenshots_are_dropped(client):
	model = ScriptedModel([{"tool_calls": [call("press_back", why=f"go back {i}")]} for i in range(5)])
	run_id = start(client, model)
	for n in range(1, 6):
		step(client, run_id, n, HOME if n % 2 else LOGIN, result=None if n == 1 else "ok")

	sent = model.calls[-1]["messages"]
	# Every tool call is answered before the next user message (the API rejects anything else).
	open_calls = set()
	for m in sent:
		if m["role"] == "assistant":
			assert not open_calls
			open_calls = {c["id"] for c in m.get("tool_calls", [])}
		elif m["role"] == "tool":
			open_calls.discard(m["tool_call_id"])
		elif m["role"] == "user":
			assert not open_calls, "a tool call was left unanswered"
	images = [m for m in sent if m["role"] == "user" and isinstance(m["content"], list)]
	assert len(images) == 2, "only the last screenshots stay as images"
	assert any("Earlier observation, step 1" in str(m["content"]) for m in sent)


def test_bad_index_is_returned_to_the_model_not_the_device(client):
	model = ScriptedModel([
		{"tool_calls": [call("tap_element", index=42, why="oops")]},
		{"tool_calls": [call("tap_element", index=2, why="sign in")]},
	])
	run_id = start(client, model)
	out = step(client, run_id, 1, LOGIN)
	assert out["action"]["label"] == 'tap [2] button "Sign in"'
	tool_msgs = [m for m in model.calls[-1]["messages"] if m["role"] == "tool"]
	assert "no element [42]" in tool_msgs[0]["content"]


def test_only_one_device_action_per_turn(client):
	model = ScriptedModel([{"tool_calls": [call("tap_element", index=0, why="a"), call("press_back", why="b")]}])
	run_id = start(client, model)
	out = step(client, run_id, 1, LOGIN)
	assert out["action"]["type"] == "tap"
	step(client, run_id, 2, LOGIN, result="ok")
	tool_msgs = [m["content"] for m in model.calls[-1]["messages"] if m["role"] == "tool"]
	assert any("one device action per turn" in t for t in tool_msgs)
	assert any(t.startswith("Executed. Result: ok") for t in tool_msgs)


def test_budget_ends_the_run_and_finish_is_forced(client):
	model = ScriptedModel([{"tool_calls": [call("swipe", direction="scroll_down", why="see more")]}] * 2 + [
		{"tool_calls": [call("finish", summary="Ran out.", goal_reached="partly", score=5, opinion="Meh.")]}])
	run_id = start(client, model, max_actions=2)
	assert step(client, run_id, 1, HOME)["action"]["type"] == "swipe"
	assert step(client, run_id, 2, HOME, result="ok")["status"] == "action"
	assert step(client, run_id, 3, HOME, result="ok")["status"] == "done"
	report = client.post("/v1/agent/finish", json={"run_id": run_id, "reason": "budget"}).json()
	assert report["final"]["end_reason"] == "budget" and report["final"]["goal_reached"] == "partly"
	assert set(model.calls[-1]["tools"]) == {"report_issue", "finish"}


def test_fatal_crash_in_logcat_becomes_a_blocker(client):
	model = ScriptedModel([{"tool_calls": [call("press_back", why="x")]}] * 3)
	run_id = start(client, model)
	crash = ["--------- beginning of crash", "E AndroidRuntime: FATAL EXCEPTION: main",
			 "E AndroidRuntime: java.lang.NullPointerException: name was null", "E AndroidRuntime: at a.b.C(C.kt:12)"]
	out = step(client, run_id, 1, HOME, crash=crash)
	assert out["findings_count"] == 1
	out = step(client, run_id, 2, HOME, result="ok", crash=crash)
	assert out["findings_count"] == 1, "the same crash is recorded once"
	report = client.post("/v1/agent/finish", json={"run_id": run_id, "reason": "stopped"}).json()
	assert report["findings"][0]["severity"] == "blocker" and report["findings"][0]["source"] == "logcat"


def test_model_failure_returns_a_stable_error(client):
	async def broken(messages, tools, tool_choice):
		raise RuntimeError("provider said: invalid key sk-123")
	run_id = start(client, broken)
	r = client.post("/v1/agent/step", json={"run_id": run_id, "step": 1, "elements": LOGIN})
	assert r.status_code == 502 and "sk-123" not in r.text
	report = client.post("/v1/agent/finish", json={"run_id": run_id, "reason": "error"}).json()
	assert report["final"]["end_reason"] == "error"


# ── observation helpers ─────────────────────────────────────────────────────

def parsed(rows):
	return obs.parse_elements([UiElementIn.model_validate(r) for r in rows])


def test_accessibility_check_flags_unnamed_and_small_controls():
	rows = HOME + [el("OK", bounds="[0,500][60,560]")]  # 60 px at 420 dpi = 23 dp
	notes = obs.accessibility_notes(parsed(rows), 420)
	assert any("no accessible name" in n for n in notes)
	assert any("under 48dp" in n and '23x23dp' in n for n in notes)


def test_a_button_whose_label_is_a_child_is_named():
	rows = [el("", bounds="[0,0][1080,200]"), el("Continue", "android.widget.TextView", "[100,50][500,150]", clickable=False)]
	assert not any("no accessible name" in n for n in obs.accessibility_notes(parsed(rows), 420))


def test_screen_identity_ignores_counters_and_positions():
	a = obs.signature(parsed([el("Inbox (3)", rid="app:id/inbox"), el("Compose", rid="app:id/compose")]))
	b = obs.signature(parsed([el("Inbox (12)", bounds="[0,10][100,110]", rid="app:id/inbox"), el("Compose", rid="app:id/compose")]))
	assert obs.similarity(a, b) == 1.0
	screens = obs.ScreenMap()
	assert screens.locate(a, 1, "Inbox") == ("S1", True)
	assert screens.locate(b, 2, "Inbox") == ("S1", False)
	assert screens.locate(obs.signature(parsed(LOGIN)), 3, "Login") == ("S2", True)
