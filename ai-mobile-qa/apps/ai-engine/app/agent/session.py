"""One agent, one conversation, one run.

Each /agent/step call adds the new observation (screenshot + element list + signals)
to the same conversation and asks the model for its next tool call. report_issue is
handled here and the model keeps going; the first device tool ends the turn and is
returned to the desktop app, whose result arrives with the next observation.

Memory is the conversation itself. To bound its size, only the last few screenshots
stay as images; older observations shrink to one line each.
"""
import asyncio
import json
import logging
import os
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional

from app.agent import observation as obs
from app.agent.brief import DEVICE_TOOLS, SYSTEM_BRIEF, TOOLS, run_context, tool_named
from app.schemas.agent import (
	AgentFinal,
	AgentFinding,
	AgentStartInput,
	AgentStepInput,
	AgentStepOutput,
	DeviceAction,
)

logger = logging.getLogger(__name__)

# (messages, tools, tool_choice) -> {"content", "tool_calls": [{"id","name","arguments"}], "usage": {...}}
Completion = Callable[[List[Dict[str, Any]], List[Dict[str, Any]], Any], Awaitable[Dict[str, Any]]]

KEEP_IMAGES = max(1, int(os.getenv("TEZZY_AGENT_KEEP_IMAGES", "2")))
MAX_INNER_CALLS = 6
FINAL_CALLS = 3
SEVERITY_ORDER = {"blocker": 0, "major": 1, "minor": 2, "cosmetic": 3}


class AgentSession:
	def __init__(self, cfg: AgentStartInput, complete: Completion, model: str) -> None:
		self.run_id = f"agent-{uuid.uuid4().hex[:12]}"
		self.cfg = cfg
		self.model = model
		self._complete = complete
		self.lock = asyncio.Lock()

		self.messages: List[Dict[str, Any]] = [
			{"role": "system", "content": SYSTEM_BRIEF},
			{"role": "user", "content": run_context(cfg)},
		]
		self._obs_slots: List[int] = []  # message indices of observations
		self._obs_short: Dict[int, str] = {}
		self._pending_call_id: Optional[str] = None

		self.actions_taken = 0
		self.findings: List[AgentFinding] = []
		self.steps: List[Dict[str, Any]] = []
		self.screens = obs.ScreenMap()
		self.final: Optional[AgentFinal] = None
		self.usage = {"model_calls": 0, "prompt_tokens": 0, "completion_tokens": 0}

		self._elements: List[obs.Element] = []
		self._prev_sig: Optional[set] = None
		self._unchanged_streak = 0
		self._seen_crashes: set = set()
		self.last_step = 0

	# ── public ────────────────────────────────────────────────────────────

	async def step(self, payload: AgentStepInput) -> AgentStepOutput:
		if self.final is not None:
			return self._out("done")

		if self.steps and payload.last_action_result is not None:
			self.steps[-1]["result"] = payload.last_action_result[:300]

		self._answer_pending(payload.last_action_result or "done")
		screen_id, is_new = self._observe(payload)

		if self.actions_taken >= self.cfg.max_actions:
			return self._out("done", screen_id=screen_id, new_screen=is_new)

		for _ in range(MAX_INNER_CALLS):
			msg = await self._call(TOOLS, "required")
			action, thought = self._handle(msg, payload.step, screen_id)
			if self.final is not None:
				return self._out("done", thought=thought, screen_id=screen_id, new_screen=is_new)
			if action is not None:
				self.actions_taken += 1
				return self._out("action", action=action, thought=thought, screen_id=screen_id, new_screen=is_new)

		# The model kept reporting or erring without choosing an action: look again.
		action = DeviceAction(type="wait", duration_ms=1000, label="wait 1s (no action chosen)")
		return self._out("action", action=action, screen_id=screen_id, new_screen=is_new)

	async def finalize(self, reason: str) -> AgentFinal:
		"""Ends the run. If the model has not called finish yet, it is asked to now."""
		if self.final is not None:
			return self.final
		self._answer_pending(f"Not executed: the run ended ({reason}).")
		self.messages.append({
			"role": "user",
			"content": (
				f"The run has ended ({reason}). First report any issue you saw and have not reported "
				"yet, then call finish with your summary, whether the goal was reached and a score."
			),
		})
		allowed = [tool_named("report_issue"), tool_named("finish")]
		try:
			for i in range(FINAL_CALLS):
				choice: Any = "required" if i < FINAL_CALLS - 1 else {"type": "function", "function": {"name": "finish"}}
				msg = await self._call(allowed, choice)
				self._handle(msg, step=self.last_step, screen_id="", device_allowed=False)
				if self.final is not None:
					break
		except Exception:  # the report must still be written
			logger.exception("agent %s: final model call failed", self.run_id)
		if self.final is None:
			self.final = AgentFinal(
				summary="The agent did not write a summary before the run ended.",
				goal_reached="no", score=None, opinion="", end_reason=reason,
			)
		else:
			self.final.end_reason = reason if reason != "finished" else self.final.end_reason
		return self.final

	def sorted_findings(self) -> List[AgentFinding]:
		return sorted(self.findings, key=lambda f: (SEVERITY_ORDER.get(f.severity, 9), f.id))

	# ── observation ───────────────────────────────────────────────────────

	def _observe(self, p: AgentStepInput):
		self.last_step = p.step
		elements = obs.parse_elements(p.elements)
		self._elements = elements
		sig = obs.signature(elements)
		title = obs.screen_title(elements)
		screen_id, is_new = self.screens.locate(sig, p.step, title)

		unchanged = self._prev_sig is not None and sig == self._prev_sig and bool(self.steps)
		self._unchanged_streak = self._unchanged_streak + 1 if unchanged else 0
		self._prev_sig = sig

		crash = obs.crash_lines(p.crash_log)
		if crash and obs.is_fatal(crash):
			self._record_crash(crash, p.step, screen_id)

		lines = [f"Step {p.step} - screenshot {p.step:02d}."]
		if p.last_action_result is not None and self.steps:
			lines.append(f"Result of your last action ({self.steps[-1]['action']}): {p.last_action_result[:300]}")
		where = (f"NEW screen {screen_id}" if is_new
			else f"screen {screen_id}, first seen at step {self.screens.first_step(screen_id)}")
		lines.append(f"This is {where}. Screens reached so far: {len(self.screens.screens)}.")
		if unchanged:
			lines.append("The UI tree did not change after your last action.")
		if self._unchanged_streak >= 2:
			lines.append("Nothing has changed for several actions: stop repeating, try something different.")
		lines.append(f"Actions used: {self.actions_taken} of about {self.cfg.max_actions}.")
		lines.append("\nElements (tap by index; centres in device pixels):")
		lines.append(obs.format_elements(elements))
		a11y = obs.accessibility_notes(elements, self.cfg.density_dpi)
		if a11y:
			lines.append("\nAccessibility check (confirm on the screenshot):\n- " + "\n- ".join(a11y))
		if crash:
			lines.append("\nCRASH LOG SINCE YOUR LAST ACTION:\n" + "\n".join(crash))
		text = "\n".join(lines)

		content: List[Dict[str, Any]] = [{"type": "text", "text": text}]
		if p.screenshot_b64:
			content.append({
				"type": "image_url",
				"image_url": {"url": f"data:image/png;base64,{p.screenshot_b64}", "detail": "high"},
			})
		else:
			content[0]["text"] += "\n(No screenshot could be taken this step.)"

		self.messages.append({"role": "user", "content": content})
		slot = len(self.messages) - 1
		self._obs_slots.append(slot)
		self._obs_short[slot] = (
			f"[Earlier observation, step {p.step}: {screen_id} \"{title}\"; screenshot no longer shown]"
		)
		self._compact()
		return screen_id, is_new

	def _compact(self) -> None:
		for slot in self._obs_slots[:-KEEP_IMAGES]:
			if isinstance(self.messages[slot]["content"], list):
				self.messages[slot]["content"] = self._obs_short[slot]

	def _record_crash(self, crash: List[str], step: int, screen_id: str) -> None:
		head = next((l for l in crash if "Exception" in l or "Error" in l or "ANR" in l), crash[0])
		key = head.split(":", 1)[-1].strip()[:160]
		if key in self._seen_crashes:
			return
		self._seen_crashes.add(key)
		self.findings.append(AgentFinding(
			id=len(self.findings) + 1,
			title=f"App crash logged by Android: {key[:100]}",
			severity="blocker", category="crash", screen=screen_id,
			steps_to_reproduce="See the steps log before this screenshot.",
			expected="The app keeps running.", actual="\n".join(crash[:8]),
			screenshots=[step], source="logcat",
		))

	# ── model turn ────────────────────────────────────────────────────────

	async def _call(self, tools: List[Dict[str, Any]], tool_choice: Any) -> Dict[str, Any]:
		msg = await self._complete(self.messages, tools, tool_choice)
		self.usage["model_calls"] += 1
		usage = msg.get("usage") or {}
		self.usage["prompt_tokens"] += int(usage.get("prompt_tokens") or 0)
		self.usage["completion_tokens"] += int(usage.get("completion_tokens") or 0)
		return msg

	def _handle(self, msg: Dict[str, Any], step: int, screen_id: str, device_allowed: bool = True):
		"""Applies the model's tool calls. Returns (device action or None, thought)."""
		content = (msg.get("content") or "").strip() or None
		calls = msg.get("tool_calls") or []
		assistant: Dict[str, Any] = {"role": "assistant", "content": content}
		if calls:
			assistant["tool_calls"] = [
				{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c.get("arguments") or "{}"}}
				for c in calls
			]
		self.messages.append(assistant)
		if not calls:
			self.messages.append({"role": "user", "content": "Call exactly one tool."})
			return None, content

		chosen: Optional[DeviceAction] = None
		thought = content
		for c in calls:
			name = c["name"]
			try:
				args = json.loads(c.get("arguments") or "{}")
				if not isinstance(args, dict):
					raise ValueError("arguments must be an object")
			except (ValueError, TypeError) as e:
				self._tool_result(c["id"], f"Error: invalid arguments ({e}). Call the tool again.")
				continue

			if name == "report_issue":
				self._tool_result(c["id"], self._add_finding(args, step, screen_id))
			elif name == "finish":
				self.final = AgentFinal(
					summary=str(args.get("summary") or "")[:3000],
					goal_reached=args.get("goal_reached") if args.get("goal_reached") in ("yes", "partly", "no") else "no",
					score=_score(args.get("score")),
					opinion=str(args.get("opinion") or "")[:2000],
					end_reason="finished",
				)
				self._tool_result(c["id"], "Run finished.")
			elif name in DEVICE_TOOLS:
				if not device_allowed or chosen is not None or self.final is not None:
					self._tool_result(c["id"], "Skipped: one device action per turn. Look at the next screen first.")
					continue
				action, error = self._to_action(name, args)
				if error:
					self._tool_result(c["id"], f"Error: {error}")
					continue
				chosen = action
				thought = thought or str(args.get("why") or "")[:300] or None
				self._pending_call_id = c["id"]  # answered with the next observation
				self.steps.append({
					"step": step, "screen": screen_id, "action": action.label,
					"why": str(args.get("why") or "")[:300], "result": None,
				})
			else:
				self._tool_result(c["id"], f"Error: unknown tool {name}.")
		return chosen, thought

	def _tool_result(self, call_id: str, text: str) -> None:
		self.messages.append({"role": "tool", "tool_call_id": call_id, "content": text})

	def _answer_pending(self, result: str) -> None:
		if self._pending_call_id:
			self._tool_result(self._pending_call_id, f"Executed. Result: {result[:300]}. The new screen follows.")
			self._pending_call_id = None

	def _add_finding(self, args: Dict[str, Any], step: int, screen_id: str) -> str:
		sev = args.get("severity") if args.get("severity") in SEVERITY_ORDER else "minor"
		shots = [int(s) for s in (args.get("screenshots") or []) if isinstance(s, (int, float)) and 0 < int(s) <= step]
		finding = AgentFinding(
			id=len(self.findings) + 1,
			title=str(args.get("title") or "Untitled issue")[:200],
			severity=sev,
			category=str(args.get("category") or "other")[:40],
			screen=str(args.get("screen") or screen_id)[:120],
			steps_to_reproduce=str(args.get("steps_to_reproduce") or "")[:2000],
			expected=str(args.get("expected") or "")[:1000],
			actual=str(args.get("actual") or "")[:1000],
			screenshots=shots or ([step] if step else []),
		)
		self.findings.append(finding)
		return f"Recorded as issue #{finding.id}. Keep testing."

	def _to_action(self, name: str, a: Dict[str, Any]):
		w, h = self.cfg.screen_width, self.cfg.screen_height
		if name == "tap_element":
			idx = a.get("index")
			if not isinstance(idx, int) or not (0 <= idx < len(self._elements)):
				return None, f"no element [{idx}] on this screen (0 to {len(self._elements) - 1}). Use the list or tap_xy."
			e = self._elements[idx]
			label = f'tap [{idx}] {e.kind} "{e.name}"' if e.name else f"tap [{idx}] {e.kind}"
			return DeviceAction(type="tap", x=e.cx, y=e.cy, label=label[:120]), None
		if name == "tap_xy":
			x, y = a.get("x"), a.get("y")
			if not isinstance(x, int) or not isinstance(y, int) or not (0 <= x < w and 0 <= y < h):
				return None, f"({x},{y}) is outside the {w}x{h} screen."
			return DeviceAction(type="tap", x=x, y=y, label=f"tap at ({x},{y})"), None
		if name == "swipe":
			d = a.get("direction")
			cx, cy = w // 2, h // 2
			spans = {
				"scroll_down": (cx, int(h * 0.72), cx, int(h * 0.30)),
				"scroll_up": (cx, int(h * 0.30), cx, int(h * 0.72)),
				"swipe_left": (int(w * 0.85), cy, int(w * 0.15), cy),
				"swipe_right": (int(w * 0.15), cy, int(w * 0.85), cy),
			}
			if d not in spans:
				return None, "direction must be scroll_down, scroll_up, swipe_left or swipe_right."
			x1, y1, x2, y2 = spans[d]
			return DeviceAction(type="swipe", x=x1, y=y1, x2=x2, y2=y2, duration_ms=400, label=d), None
		if name == "type_text":
			raw = str(a.get("text") or "")
			if len(raw) > 500:
				return None, "text is too long (500 characters at most)."
			label = raw if len(raw) <= 40 else raw[:37] + "..."
			return DeviceAction(
				type="type_text", text=self._fill_credentials(raw),
				clear_first=bool(a.get("clear_first")), submit=bool(a.get("submit")),
				label=f'type "{label}"' + (" + enter" if a.get("submit") else ""),
			), None
		if name == "press_back":
			return DeviceAction(type="back", label="back"), None
		if name == "wait":
			try:
				secs = min(max(float(a.get("seconds") or 1), 0.5), 10.0)
			except (TypeError, ValueError):
				secs = 1.0
			return DeviceAction(type="wait", duration_ms=int(secs * 1000), label=f"wait {secs:g}s"), None
		return None, f"unknown tool {name}"

	def _fill_credentials(self, text: str) -> str:
		creds = self.cfg.credentials
		if creds:
			if creds.email:
				text = text.replace("{{email}}", creds.email)
			if creds.password:
				text = text.replace("{{password}}", creds.password)
		return text

	def _out(self, status: str, action: Optional[DeviceAction] = None, thought: Optional[str] = None,
			 screen_id: Optional[str] = None, new_screen: bool = False) -> AgentStepOutput:
		return AgentStepOutput(
			status=status, action=action, thought=thought,
			actions_taken=self.actions_taken, findings_count=len(self.findings),
			screen_id=screen_id, new_screen=new_screen,
		)


def _score(value: Any) -> Optional[int]:
	try:
		return min(max(int(value), 1), 10)
	except (TypeError, ValueError):
		return None
