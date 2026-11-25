"""Turns a raw UI tree into what the agent reads each turn.

- A numbered element list (the agent taps by index, so it never guesses pixels).
- A deterministic accessibility check: controls with no name, touch targets under 48 dp.
- Screen identity: two observations are the same screen when they share at least
  60% of their element signatures. Exact hashes break on clocks, counters and
  loading lists; overlap does not.
"""
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

from app.schemas.agent import UiElementIn

SAME_SCREEN = 0.6
MIN_TARGET_DP = 48
MAX_LISTED = 90
MAX_NAME = 70

_BOUNDS = re.compile(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")


@dataclass
class Element:
	index: int
	kind: str  # field | button | toggle | list | text
	name: str
	resource_id: str
	x1: int
	y1: int
	x2: int
	y2: int
	clickable: bool
	checked: Optional[bool]

	@property
	def cx(self) -> int:
		return (self.x1 + self.x2) // 2

	@property
	def cy(self) -> int:
		return (self.y1 + self.y2) // 2

	def contains(self, other: "Element") -> bool:
		return (
			self.x1 <= other.x1 and self.y1 <= other.y1
			and self.x2 >= other.x2 and self.y2 >= other.y2
			and self is not other
		)

	def describe(self) -> str:
		label = f'"{self.name}"' if self.name else "(no name)"
		extra = []
		if self.resource_id:
			extra.append(f"id={self.resource_id}")
		if self.checked is not None:
			extra.append("on" if self.checked else "off")
		tail = f" {' '.join(extra)}" if extra else ""
		return f"[{self.index}] {self.kind} {label} at ({self.cx},{self.cy}){tail}"


def _short_id(resource_id: str) -> str:
	return resource_id.split("/", 1)[-1] if resource_id else ""


def _kind(el: UiElementIn) -> str:
	cls = el.class_full or el.class_name
	if cls.endswith("EditText") or "TextField" in cls:
		return "field"
	if el.checkable:
		return "toggle"
	if el.clickable:
		return "button"
	if el.scrollable:
		return "list"
	return "text"


def parse_elements(raw: Sequence[UiElementIn]) -> List[Element]:
	"""Keeps the elements worth showing, numbered in screen order."""
	out: List[Element] = []
	for el in raw:
		if not el.enabled:
			continue
		m = _BOUNDS.search(el.bounds or "")
		if not m:
			continue
		x1, y1, x2, y2 = map(int, m.groups())
		if x2 - x1 <= 1 or y2 - y1 <= 1:
			continue
		name = " ".join((el.text or el.content_desc or "").split())[:MAX_NAME]
		kind = _kind(el)
		if not name and kind == "text" and not el.resource_id:
			continue
		out.append(Element(
			index=0, kind=kind, name=name, resource_id=_short_id(el.resource_id),
			x1=x1, y1=y1, x2=x2, y2=y2, clickable=el.clickable or el.checkable,
			checked=el.checked if el.checkable else None,
		))
	out.sort(key=lambda e: (e.y1, e.x1))
	for i, e in enumerate(out):
		e.index = i
	return out


def accessibility_notes(elements: List[Element], density_dpi: int) -> List[str]:
	"""Deterministic checks. The agent confirms them on the screenshot before reporting."""
	unnamed, small = [], []
	named = [e for e in elements if e.name]
	scale = 160.0 / max(density_dpi, 80)
	for e in elements:
		if not (e.clickable or e.kind == "field"):
			continue
		if not e.name and not any(e.contains(n) for n in named):
			unnamed.append(e.index)
		w_dp, h_dp = (e.x2 - e.x1) * scale, (e.y2 - e.y1) * scale
		if e.clickable and min(w_dp, h_dp) < MIN_TARGET_DP:
			small.append(f"[{e.index}] {round(w_dp)}x{round(h_dp)}dp")
	notes = []
	if unnamed:
		notes.append(f"{len(unnamed)} control(s) with no accessible name: " + ", ".join(f"[{i}]" for i in unnamed[:8]))
	if small:
		notes.append(f"{len(small)} touch target(s) under {MIN_TARGET_DP}dp: " + ", ".join(small[:8]))
	return notes


def signature(elements: List[Element]) -> Set[str]:
	"""What identifies a screen: its controls and ids, not their positions or counters."""
	sig = set()
	for e in elements:
		if e.resource_id:
			sig.add(f"id:{e.resource_id}")
		if e.clickable or e.kind == "field":
			sig.add(f"{e.kind}:{re.sub(r'[0-9]+', '#', e.name.lower())}")
	return sig


def similarity(a: Set[str], b: Set[str]) -> float:
	if not a and not b:
		return 1.0
	return len(a & b) / max(len(a | b), 1)


@dataclass
class ScreenMap:
	"""Distinct screens seen during a run, in the order they were first reached."""

	screens: List[Tuple[str, Set[str], int, str]] = field(default_factory=list)  # id, sig, first step, title
	visits: Dict[str, int] = field(default_factory=dict)

	def locate(self, sig: Set[str], step: int, title: str) -> Tuple[str, bool]:
		best_id, best = None, 0.0
		for sid, s, _, _ in self.screens:
			score = similarity(sig, s)
			if score > best:
				best_id, best = sid, score
		if best_id is not None and best >= SAME_SCREEN:
			self.visits[best_id] = self.visits.get(best_id, 0) + 1
			return best_id, False
		sid = f"S{len(self.screens) + 1}"
		self.screens.append((sid, sig, step, title))
		self.visits[sid] = 1
		return sid, True

	def first_step(self, sid: str) -> int:
		return next((s for i, _, s, _ in self.screens if i == sid), 0)

	def titles(self) -> List[Tuple[str, int, str, int]]:
		return [(sid, step, title, self.visits.get(sid, 0)) for sid, _, step, title in self.screens]


def screen_title(elements: List[Element]) -> str:
	"""A short human label for a screen: its first few visible names."""
	names = [e.name for e in elements if e.name][:4]
	return " / ".join(names)[:90] or "(no text)"


def format_elements(elements: List[Element]) -> str:
	if not elements:
		return "(the UI tree is empty: the app may draw everything itself, e.g. a game or a canvas. Use tap_xy on what you see in the screenshot.)"
	lines = [e.describe() for e in elements[:MAX_LISTED]]
	if len(elements) > MAX_LISTED:
		lines.append(f"... {len(elements) - MAX_LISTED} more elements below; scroll or use tap_xy.")
	return "\n".join(lines)


def crash_lines(lines: Sequence[str]) -> List[str]:
	"""The meaningful part of a logcat crash buffer: the exception and its first frames."""
	keep = [l.rstrip() for l in lines if l.strip() and not l.startswith("-----")]
	return keep[-20:]


def is_fatal(lines: Sequence[str]) -> bool:
	text = "\n".join(lines)
	return "FATAL EXCEPTION" in text or "ANR in" in text or "Fatal signal" in text
