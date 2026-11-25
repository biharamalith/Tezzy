from __future__ import annotations

import functools
import json
from typing import Any, Dict, TypedDict

from langgraph.graph import END, StateGraph

from app.llm.client import LLMClient
from app.llm.json_mode import ensure_keys_exact
from app.schemas.planner import (
    PHASE_C_ACTION_ALLOWED_KEYS,
    PHASE_C_ALLOWED_KEYS,
    PlannerInput,
    PlannerOutput,
)

# ─────────────────────────────────────────────────────────────────
#  MASTER SYSTEM PROMPT
#  Every rule here is load-bearing. Do not summarise or shorten.
# ─────────────────────────────────────────────────────────────────
_SYSTEM_PROMPT = """
You are Tezzy Planner — the action-decision brain of a mobile QA agent.
You receive a full picture of the current device state and propose EXACTLY ONE next action.

════════════════════════════════════════════════════════
GROUND TRUTH PRIORITY ORDER
════════════════════════════════════════════════════════
When reasoning about what is on screen, trust sources in this order:

  1. hierarchy_xml   — ADB UI dump. This is ground truth.
                       Use element resourceId, text, contentDesc, class,
                       bounds, enabled, focusable, clickable to decide.
  2. activity_name   — The running Android activity. Tells you EXACTLY which
                       screen you are on. More reliable than screen_type.
  3. field_inventory — Pre-computed list of all input fields with their
                       current values. Use this for ALL form_fill decisions.
  4. analysis        — Vision model output. Use ONLY when hierarchy is empty
                       or a criterion requires visual confirmation unavailable
                       in the hierarchy (e.g. image rendering quality).
  5. screenshot      — Raw pixels. Last resort only.

NEVER guess a screen type from screenshots alone when hierarchy_xml is present.

════════════════════════════════════════════════════════
RULE 0 — PRE-GOAL SATISFACTION (pipeline enforces this, but you must honour it)
════════════════════════════════════════════════════════
If goal_progress.already_satisfied == true:
  Return action.type = "noop" with intent = "Goal already satisfied before execution".
  Do NOT interact with the screen.

════════════════════════════════════════════════════════
RULE 1 — SCREEN ARRIVAL CONFIRMATION
════════════════════════════════════════════════════════
Before executing any goal action, the pipeline checks screen_confirmed.
If screen_confirmed == false, your ONLY job is to navigate to the target screen.

  Navigation priority order:
  a) Tap the bottom nav tab matching start_nav_tap_label (exact label match from hierarchy)
  b) Open the drawer/hamburger menu then tap the matching item
  c) Use the back action if you are deeper than the target screen
  d) Tap any visible element that matches expected_screens keywords

  STOP navigating the moment activity_name or hierarchy text matches
  expected_screens. Set screen_confirmed = true in your intent.

  Max navigation attempts: 8 steps. If not arrived after 8, return:
  action.type = "fail" with intent = "Could not reach target screen in 8 steps".

════════════════════════════════════════════════════════
RULE 2 — LOGIN GOAL
════════════════════════════════════════════════════════
Only applies when current_goal.type == "login" AND screen_confirmed == true.

  login_step=0 → input_text into the email/username field
                 (find by resourceId containing "email","user","phone","login"
                  OR contentDesc containing same keywords
                  OR first focusable EditText on screen)
  login_step=1 → input_text into the password field
                 (find by resourceId/contentDesc containing "pass","pwd","secret"
                  OR second focusable EditText)
  login_step=2 → tap the login/submit button
                 (find by text "Login","Sign in","Submit","Continue" OR
                  resourceId containing "login","submit","btn_login")
  login_step=3 → login submitted. Do NOT interact with login screen again.
                 If screen_type is still "login", wait_ms 1500 then screenshot.

  NEVER skip login_step order.
  NEVER interact with other elements until login_step reaches 3.

════════════════════════════════════════════════════════
RULE 3 — FORM_FILL GOAL  ← THIS IS THE CRITICAL FIX
════════════════════════════════════════════════════════
Only applies when current_goal.type == "form_fill" AND screen_confirmed == true.

You receive field_inventory — a list like:
  [
    {"node_id": "...", "label": "Phone", "resource_id": "...",
     "current_value": "0771234567", "bounds": [x1,y1,x2,y2], "filled": true},
    {"node_id": "...", "label": "Name", "resource_id": "...",
     "current_value": "", "bounds": [x1,y1,x2,y2], "filled": false}
  ]

FORM FILL RULES — follow in exact order:
  a) Read field_inventory. Fields where filled=false need to be filled.
     Fields where filled=true and current_value matches form_data → SKIP.
     Fields where filled=true but current_value does NOT match form_data → CLEAR then fill.

  b) Fill ONE field per action cycle. Pick the topmost unfilled field by
     vertical position (lowest y1 value = topmost on screen).

  c) Use tap_xy on the field center (from bounds) to focus it, THEN
     use input_text with the correct value from form_data.
     The frontend will clear the field before typing — do not send
     extra clear/select-all actions.

  d) After ALL fields in field_inventory are filled, tap the submit/save button.
     Find it by: text contains "Save","Update","Submit","Done","Confirm"
     OR resourceId contains "save","submit","update","btn_confirm".

  e) DO NOT press back. DO NOT navigate away. DO NOT tap random buttons.
     Your entire job is: fill empty fields top-to-bottom, then submit.

  f) If a field is NOT in form_data but IS in field_inventory → ignore it.
     Only fill fields that have a matching key in form_data.

════════════════════════════════════════════════════════
RULE 4 — NAVIGATE GOAL
════════════════════════════════════════════════════════
Your job is to reach a screen matching expected_screens.
Use hierarchy to find nav elements. Prefer:
  - Bottom navigation tabs (class="android.widget.BottomNavigationView" children)
  - Drawer items (after opening hamburger/menu icon)
  - Prominent buttons with matching text

Do NOT use back unless completely stuck (no nav elements visible).

════════════════════════════════════════════════════════
RULE 5 — VERIFY GOAL
════════════════════════════════════════════════════════
Stay on the current screen. Your job is to confirm criteria are visible.
Use swipe only to reveal more content. Do NOT navigate away.
Prefer reading hierarchy_xml for text presence over tapping anything.

════════════════════════════════════════════════════════
RULE 6 — LOGOUT (usually part of navigate or custom goal)
════════════════════════════════════════════════════════
Logout is almost always in the sidebar/drawer or profile menu. Steps:
  a) Look in hierarchy for: hamburger icon (contentDesc "Open navigation",
     "Menu", "Drawer") OR a profile avatar at top-right.
  b) Tap it to open drawer/sheet.
  c) Look for text "Logout", "Log out", "Sign out" in the newly visible hierarchy.
  d) Tap it.
  e) Confirm by checking activity_name returns to login/splash screen.

NEVER assume logout is in the bottom nav. It is almost always behind a menu.

════════════════════════════════════════════════════════
RULE 7 — STUCK DETECTION (autonomous mode only)
════════════════════════════════════════════════════════
Only applies when current_goal is null (autonomous exploration).
If memory_snapshot.seen_hash_counts[screen_hash] > 3:
  Navigate away using a tab, drawer, or back action.
  Do NOT tap any element on this screen.

This rule is SUSPENDED when current_goal is set.

════════════════════════════════════════════════════════
RULE 8 — ONBOARDING SCREENS
════════════════════════════════════════════════════════
If analysis.screen_type == "onboarding":
  Find "Next", "Skip", "Continue", "Get Started" in hierarchy by text.
  Tap its exact center from bounds. Do NOT tap screen center.
  Do NOT use back — it exits the app.

════════════════════════════════════════════════════════
HARD CONSTRAINTS — NEVER VIOLATE
════════════════════════════════════════════════════════
- Propose EXACTLY ONE action per response.
- NEVER tap an element whose resource_id and bounds match an entry in memory_snapshot.seen_element_keys, as you have already tried it.
- When current_goal is set: NEVER press back to exit a goal screen,
  NEVER tap bottom nav tabs mid-form, NEVER navigate to home mid-goal.
- When filling forms: NEVER overwrite a field that already has correct content.
- When on the correct goal screen: NEVER navigate away until goal is complete.
- Return strict JSON only. No prose. No markdown.

════════════════════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════════════════════
{
  "action": {
    "type": "tap_xy | input_text | swipe | back | wait_ms | screenshot | stop | noop | fail",
    "params": { ... }
  },
  "intent": "one sentence describing what you are doing and why",
  "expected_outcome": "what should be true after this action",
  "fallback_if_fail": "one sentence describing what to try if this fails"
}
"""


# ─────────────────────────────────────────────────────────────────
#  USER MESSAGE BUILDER — now includes hierarchy_xml + field_inventory
# ─────────────────────────────────────────────────────────────────
def build_phase_c_user_messages(payload: PlannerInput) -> list[str]:
    analysis_str    = json.dumps(payload.analysis,          ensure_ascii=False)
    memory_str      = json.dumps(payload.memory_snapshot,   ensure_ascii=False)
    screen_size_str = json.dumps(payload.screen_size.model_dump(), ensure_ascii=False)
    credentials_str = json.dumps(payload.credentials,       ensure_ascii=False)
    counters_str    = json.dumps(payload.attempt_counters.model_dump(), ensure_ascii=False)

    # ── Core state block ──────────────────────────────────────────
    parts = [
        "=== CURRENT DEVICE STATE ===\n\n",
        f"mode:           {payload.mode}\n",
        f"login_step:     {payload.login_step}\n",
        f"activity_name:  {getattr(payload, 'activity_name', 'unknown')}\n",
        f"screen_type:    {payload.analysis.get('screen_type', 'unknown')} "
        f"(vision estimate — trust activity_name over this)\n",
        f"screen_confirmed: {getattr(payload, 'screen_confirmed', False)}\n\n",
        f"analysis:       {analysis_str}\n",
        f"memory_snapshot:{memory_str}\n",
        f"screen_size:    {screen_size_str}\n",
        f"credentials:    {credentials_str}\n",
        f"attempt_counters:{counters_str}\n\n",
    ]

    # ── UI Hierarchy (ground truth) ───────────────────────────────
    hierarchy_xml = getattr(payload, "hierarchy_xml", None)
    if hierarchy_xml:
        # Truncate to 8000 chars to stay within token budget
        truncated = hierarchy_xml[:8000]
        if len(hierarchy_xml) > 8000:
            truncated += "\n... [truncated — hierarchy too large]"
        parts.append("=== UI HIERARCHY (ADB DUMP — GROUND TRUTH) ===\n")
        parts.append(truncated)
        parts.append("\n\n")
    else:
        parts.append("=== UI HIERARCHY ===\nNot available — use vision analysis only.\n\n")

    # ── Field Inventory (pre-computed for form fills) ─────────────
    field_inventory = getattr(payload, "field_inventory", None)
    if field_inventory:
        parts.append("=== FIELD INVENTORY (pre-computed input fields) ===\n")
        parts.append(json.dumps(field_inventory, ensure_ascii=False, indent=2))
        parts.append("\n\n")

    # ── Goal context ──────────────────────────────────────────────
    if payload.current_goal is not None:
        goal_dict   = payload.current_goal.model_dump()
        progress    = payload.goal_progress

        parts.append("=== ACTIVE GOAL ===\n")
        parts.append(json.dumps(goal_dict, ensure_ascii=False, indent=2))
        parts.append("\n\n")

        # Pre-satisfaction flag
        already_satisfied = getattr(progress, "already_satisfied", False) if progress else False
        parts.append(f"already_satisfied: {already_satisfied}\n")
        if already_satisfied:
            parts.append("⚡ GOAL IS ALREADY DONE — return noop immediately.\n\n")
            return ["".join(parts)]

        # Progress
        if progress:
            parts.append(f"steps_taken: {progress.steps_taken}\n")
            if progress.criteria_met:
                parts.append("criteria already met:\n")
                for c in progress.criteria_met:
                    parts.append(f"  ✓ {c}\n")
            if progress.criteria_pending:
                parts.append("criteria still pending:\n")
                for c in progress.criteria_pending:
                    parts.append(f"  ○ {c}\n")
            parts.append("\n")

        # Screen confirmation status
        screen_confirmed = getattr(payload, "screen_confirmed", False)
        parts.append(f"screen_confirmed: {screen_confirmed}\n")
        if not screen_confirmed:
            parts.append(
                "\n⚠ YOU ARE NOT ON THE CORRECT SCREEN YET.\n"
                "Apply RULE 1 — Screen Arrival Confirmation.\n"
                "Your ONLY job right now is to navigate to the target screen.\n"
                f"Target: {payload.current_goal.hints.expected_screens if payload.current_goal.hints else 'see goal description'}\n"
                f"Nav label: {getattr(payload.current_goal, 'start_nav_tap_label', 'not specified')}\n"
                f"Keywords: {getattr(payload.current_goal, 'start_screen_keywords', [])}\n\n"
            )
        else:
            parts.append("✓ You are on the correct screen. Execute goal actions now.\n\n")

        # Goal-type specific guidance
        goal_type = payload.current_goal.type
        parts.append(f"=== GOAL TYPE RULES: {goal_type.upper()} ===\n")

        if goal_type == "login":
            parts.append(
                "Apply RULE 2. Use login_step to sequence your actions.\n"
                f"Email: {payload.credentials.get('email', '') if payload.credentials else ''}\n"
                f"Password: [present]\n\n"
            )

        elif goal_type == "form_fill":
            parts.append("Apply RULE 3. Use field_inventory above — do NOT guess field positions.\n")
            if payload.current_goal.form_data:
                parts.append("form_data to fill:\n")
                for k, v in payload.current_goal.form_data.items():
                    parts.append(f"  {k}: \"{v}\"\n")
            parts.append(
                "\nCRITICAL: Only fill fields where filled=false OR current_value "
                "does not match form_data. Do NOT touch fields already correct.\n\n"
            )

        elif goal_type == "navigate":
            parts.append("Apply RULE 4. Use hierarchy to find nav elements.\n")
            if payload.current_goal.hints and payload.current_goal.hints.expected_screens:
                screens = ", ".join(payload.current_goal.hints.expected_screens)
                parts.append(f"Target screens: {screens}\n")
            parts.append("\n")

        elif goal_type == "verify":
            parts.append("Apply RULE 5. Read hierarchy for criterion text. Do not navigate.\n\n")

        elif goal_type in ("explore_section", "custom"):
            parts.append(
                "Stay on this screen. Interact with visible elements. "
                "Do NOT press back or switch tabs.\n\n"
            )

        # Hints
        if payload.current_goal.hints:
            h = payload.current_goal.hints
            if h.required_actions:
                parts.append(f"Suggested actions: {', '.join(h.required_actions)}\n")
            if h.avoid_actions:
                parts.append(f"Avoid: {', '.join(h.avoid_actions)}\n")
            parts.append("\n")

        parts.append("=== END GOAL CONTEXT ===\n\n")

    else:
        # Autonomous mode
        parts.append(
            "=== AUTONOMOUS EXPLORATION MODE ===\n"
            "No active goal. Explore unvisited screens and elements.\n"
            "Apply RULE 7 if stuck. Prefer tapping nav tabs, drawer items, list items.\n\n"
        )

    parts.append(
        "Now propose your single next action as strict JSON.\n"
        "Use hierarchy_xml node bounds for coordinates — do NOT guess positions.\n"
    )

    return ["".join(parts)]


# ─────────────────────────────────────────────────────────────────
#  GRAPH NODE
# ─────────────────────────────────────────────────────────────────
async def _phase_c_plan_one_action(state: "PlannerState") -> Dict[str, Any]:
    payload = state["input"]

    llm          = LLMClient()
    user_messages = build_phase_c_user_messages(payload)
    raw          = await llm.chat_json_messages(
        system_prompt=_SYSTEM_PROMPT,
        user_messages=user_messages,
        temperature=0.0,
    )

    ensure_keys_exact(raw, allowed_keys=PHASE_C_ALLOWED_KEYS)

    action_obj = raw.get("action")
    if not isinstance(action_obj, dict):
        raise ValueError("Expected 'action' to be a dict")
    ensure_keys_exact(action_obj, allowed_keys=PHASE_C_ACTION_ALLOWED_KEYS)

    # Normalise fallback_if_fail
    fallback = raw.get("fallback_if_fail")
    if isinstance(fallback, dict):
        note   = fallback.get("note") or fallback.get("reason") or ""
        action = fallback.get("action")
        raw["fallback_if_fail"] = (
            f"{note} Fallback action: {json.dumps(action, ensure_ascii=False)}".strip()
            if action else str(note).strip() or json.dumps(fallback, ensure_ascii=False)
        )
    elif fallback is None:
        raw["fallback_if_fail"] = ""
    elif not isinstance(fallback, str):
        raw["fallback_if_fail"] = str(fallback)

    output = PlannerOutput.model_validate(raw)
    return {"output": output}


# ─────────────────────────────────────────────────────────────────
#  GRAPH
# ─────────────────────────────────────────────────────────────────
class PlannerState(TypedDict):
    input:  PlannerInput
    output: PlannerOutput


def build_planner_graph():
    graph = StateGraph(PlannerState)
    graph.add_node("phase_c_plan", _phase_c_plan_one_action)
    graph.set_entry_point("phase_c_plan")
    graph.add_edge("phase_c_plan", END)
    return graph.compile()


@functools.lru_cache(maxsize=1)
def get_planner_graph():
    return build_planner_graph()