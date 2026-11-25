"""Markdown report for one agent run. Screenshots are linked as NN.png, next to report.md."""
from typing import List

from app.agent.session import AgentSession
from app.schemas.agent import AgentFinding

SEVERITY_ICON = {"blocker": "🟥", "major": "🟧", "minor": "🟨", "cosmetic": "⬜"}


def _cell(text: str) -> str:
	return " ".join((text or "").split()).replace("|", "\\|")


def _shots(f: AgentFinding) -> str:
	return ", ".join(f"[{n:02d}]({n:02d}.png)" for n in f.screenshots) or "-"


def render_markdown(s: AgentSession) -> str:
	final = s.final
	findings = s.sorted_findings()
	counts = {sev: sum(1 for f in findings if f.severity == sev) for sev in SEVERITY_ICON}
	out: List[str] = [
		f"# Tezzy agent run `{s.run_id}`",
		"",
		f"- **App:** {_cell(s.cfg.app_name)}",
		f"- **Goal:** {_cell(s.cfg.goal)}",
	]
	if s.cfg.persona:
		out.append(f"- **Persona:** {_cell(s.cfg.persona)}")
	out += [
		f"- **Model:** {s.model}",
		f"- **Ended:** {final.end_reason if final else 'unknown'}",
		f"- **Actions:** {s.actions_taken} of {s.cfg.max_actions} · **Screens reached:** {len(s.screens.screens)}"
		f" · **Model calls:** {s.usage['model_calls']}"
		f" ({s.usage['prompt_tokens']:,} input / {s.usage['completion_tokens']:,} output tokens)",
		"",
		"## Verdict",
		"",
	]
	if final:
		score = f"{final.score}/10" if final.score is not None else "no score"
		out += [
			f"**Goal reached:** {final.goal_reached} · **Score:** {score}",
			"",
			final.summary or "_No summary._",
			"",
		]
		if final.opinion:
			out += [f"> {_cell(final.opinion)}", ""]

	out += [
		f"## Issues ({len(findings)})",
		"",
		" · ".join(f"{SEVERITY_ICON[k]} {k}: {v}" for k, v in counts.items()),
		"",
	]
	if findings:
		out += ["| # | Severity | Issue | Screen | Screenshots |", "|---|---|---|---|---|"]
		for f in findings:
			src = " _(logcat)_" if f.source == "logcat" else ""
			out.append(
				f"| {f.id} | {SEVERITY_ICON.get(f.severity, '')} {f.severity} | {_cell(f.title)}{src} "
				f"| {_cell(f.screen)} | {_shots(f)} |"
			)
		out.append("")
		for f in findings:
			out += [
				f"### {f.id}. {f.title}",
				"",
				f"**Severity:** {f.severity} · **Category:** {f.category} · **Screen:** {f.screen} · **Screenshots:** {_shots(f)}",
				"",
			]
			if f.steps_to_reproduce:
				out += ["**Steps to reproduce**", "", f.steps_to_reproduce, ""]
			if f.source == "logcat":
				out += ["**Log**", "", "```", f.actual, "```", ""]
			else:
				if f.actual:
					out.append(f"**Actual:** {f.actual}  ")
				if f.expected:
					out.append(f"**Expected:** {f.expected}")
				out.append("")
	else:
		out += ["_No issues reported._", ""]

	out += ["## Screens reached", "", "| Screen | First seen | Visits | Shows |", "|---|---|---|---|"]
	for sid, step, title, visits in s.screens.titles():
		out.append(f"| {sid} | [step {step:02d}]({step:02d}.png) | {visits} | {_cell(title)} |")
	out += ["", "## Steps", "", "| Step | Screen | Action | Why | Result |", "|---|---|---|---|---|"]
	for st in s.steps:
		out.append(
			f"| [{st['step']:02d}]({st['step']:02d}.png) | {st['screen']} | {_cell(st['action'])} "
			f"| {_cell(st['why'])} | {_cell(st.get('result') or '')} |"
		)
	out += [
		"",
		"---",
		"_Findings come from an AI agent reading screenshots. Open the screenshots of each issue before you file it._",
		"",
	]
	return "\n".join(out)
