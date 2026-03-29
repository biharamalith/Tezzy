# TEZZY_CONTEXT.md
> Full codebase inspection — March 2026

---

## 1. Project Overview

### What Tezzy Is
Tezzy is a **local-first autonomous AI agent for mobile QA testing**. It connects to a real Android device, installs an APK, and then autonomously navigates the app screen by screen — tapping, swiping, filling forms, and detecting visual bugs (especially Flutter `RenderFlex` overflow errors). It produces a structured QA report at the end.

### Full Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 1.x (Rust + WebView) |
| Frontend UI | React 18 + TypeScript (Vite) |
| Device automation | Appium 2 (WebDriver) + ADB |
| Screen mirroring | scrcpy |
| AI backend | Python 3.12, FastAPI, LangGraph |
| LLM | OpenAI GPT-4.1-mini (text), GPT-4o (vision) |
| Agent orchestration | LangGraph `StateGraph` |

### How the Rust Frontend Connects to the Python AI Backend

The Tauri Rust backend exposes Tauri commands to the React UI. Two of those commands (`ai_run_step_cmd`, `ai_session_bootstrap_cmd`) make HTTP POST requests to the Python FastAPI server running locally at `http://127.0.0.1:8010/v1`. The URL is configurable via `TEZZY_AI_ENGINE_URL` env var. The Rust side serialises the payload as JSON, POSTs it, and deserialises the response. Vision analysis (`ai_vision_screenshot_cmd`) takes a screenshot via Appium, base64-encodes it, and POSTs to `/v1/vision/analyze`.

The AI test loop itself runs entirely in the React component `SmokeCheckPanel.tsx` (`handleStartAi`), which calls `aiRunStep()` (TypeScript) → Tauri invoke → Rust `ai_run_step_cmd` → HTTP POST → Python `/v1/run/step`.


---

## 2. Current Agent Pipeline

The pipeline is defined in `run_step.py` as a LangGraph `StateGraph`. Each `/v1/run/step` call executes all phases in sequence for one step.

### Phase A — Session Bootstrap
- **File**: `app/graphs/session_manager.py` + `app/schemas/session_bootstrap.py`
- **Route**: `POST /v1/session/bootstrap`
- **What it does**: Initialises a run. Takes app name, credentials, home markers, flow hints, constraints. Produces a run goal, mode (`reach_home` or `explore`), success criteria, stop conditions, and risk rules.
- **Input**: `SessionBootstrapInput` — app_name, platform, max_steps, credentials (email/password), home_markers, flow_hints, constraints
- **Output**: `SessionBootstrapOutput` — run_goal, mode, success_criteria, stop_conditions, risk_rules
- **Called by**: `SmokeCheckPanel.tsx` does NOT call this. It is only called if the user explicitly calls `aiSessionBootstrap()` from `aiEngine.ts`. The AI test loop in `handleStartAi` hardcodes `mode: "explore"` and passes `credentials: null` — Phase A output is never used in the loop.

### Phase B — Screen Analyst (Screen Understanding)
- **File**: `app/graphs/screen_analyst.py` + `app/schemas/screen_understanding.py`
- **Route**: `POST /v1/screen/analyze`
- **What it does**: Classifies the current screen type (login, home, list, detail, dialog, permission, unknown), identifies blockers, and lists candidate interaction targets in priority order.
- **Input**: `ScreenUnderstandingInput` — step, screen_hash, ui_elements, screenshot_summary, last_action, last_result, memory_snapshot (seen_hash_counts, seen_element_keys)
- **Output**: `ScreenUnderstandingOutput` — screen_type, confidence, candidate_targets (ordered list of strings), blocker_flags, reasoning_short
- **Called by**: `_screen_understanding()` node in `run_step.py`

### Phase C — Planner
- **File**: `app/graphs/planner.py` + `app/schemas/planner.py`
- **Route**: `POST /v1/plan/next_action`
- **What it does**: Proposes exactly one next action based on the screen analysis. Has a LOGIN SCREEN RULE in the system prompt. Outputs a structured action with intent and fallback.
- **Input**: `PlannerInput` — mode, analysis (Phase B output), memory_snapshot, screen_size, credentials, attempt_counters
- **Output**: `PlannerOutput` — action (type + params), intent, expected_outcome, fallback_if_fail
- **Called by**: `_plan_next_action()` node in `run_step.py`

### Phase D — Critic Gate
- **File**: `app/graphs/critic_gate.py` + `app/schemas/critic_gate.py`
- **Route**: `POST /v1/critic/gate_action`
- **What it does**: Validates the planner's proposed action. Can approve or reject it. If rejected, provides a safer alternative. Tags recovery type (loop_recovery, blocker_recovery, normal).
- **Input**: `CriticGateInput` — proposed_action, screen_hash, seen_hash_counts, recent_actions (last 10), failure_streak, mode
- **Output**: `CriticGateOutput` — decision, final_action, rejection_reason_or_null, recovery_tag
- **Called by**: `_critic_gate()` node in `run_step.py`

### Phase E — Vision Analyst
- **File**: `app/graphs/vision_analyst.py` + `app/schemas/vision.py`
- **Route**: `POST /v1/vision/analyze`
- **What it does**: Sends a base64 screenshot to GPT-4o vision. Detects overflow, clipping, truncation, misalignment, off_screen, and other rendering defects.
- **Input**: `VisionAnalysisInput` — screenshot_b64, step, screen_hash
- **Output**: `VisionAnalysisOutput` — issues (list of VisionIssue), has_issues, summary
- **Called by**: Two separate paths:
  1. `_vision_previous_step()` node in `run_step.py` — runs if `screenshot_b64` is present in the RunStepInput
  2. `ai_vision_screenshot_cmd` Rust command — called directly from `SmokeCheckPanel.tsx` via `invokeAiVisionScreenshot()` before each `aiRunStep()` call

### Phase F — Issue Triage
- **File**: `app/graphs/issue_triage.py` + `app/schemas/issue_triage.py`
- **Route**: `POST /v1/issues/triage`
- **What it does**: Combines runtime signals (loop, dead_tap, crash_hint, no_elements, overflow_vision) with vision findings. Deduplicates and assigns severity. Decides whether to continue.
- **Input**: `IssueTriageInput` — runtime_signals, overflow_detection, step_context, prior_findings
- **Output**: `IssueTriageOutput` — new_findings, deduped_findings, severity_summary, should_continue
- **Called by**: `_triage_previous_step()` node in `run_step.py`. Skipped entirely if `runtime_signals` and `overflow_detection` are both empty.

### Phase G — Improvement Advisor
- **File**: `app/graphs/improvement_advisor.py` + `app/schemas/improvement_suggestions.py`
- **Route**: `POST /v1/improvements/suggest`
- **What it does**: Generates product and QA automation improvement recommendations from final findings.
- **Input**: `ImprovementSuggestionInput` — final_findings, flow_coverage_stats, repeated_fail_patterns, overflow_instances
- **Output**: `ImprovementSuggestionOutput` — product_improvements, qa_automation_improvements, priority_order, quick_wins_24h
- **Called by**: NOT called anywhere in the current AI test loop. Only exposed as a standalone REST endpoint.

### Phase H — Final Report
- **File**: `app/graphs/final_report.py` + `app/schemas/final_report.py`
- **Route**: `POST /v1/report/finalize`
- **What it does**: Produces a developer-friendly markdown QA report with executive summary and pass/fail status.
- **Input**: `FinalReportInput` — run_metadata, steps_log, findings, improvements, screenshots_index
- **Output**: `FinalReportOutput` — markdown_report, executive_summary, pass_fail_status
- **Called by**: NOT called anywhere in the current AI test loop. Only exposed as a standalone REST endpoint.


---

## 3. What Is Currently Working

The following are confirmed working based on code inspection:

1. **ADB device detection** — `devices.rs` + `adb.rs` correctly lists connected devices, validates serials, and emits state events to the UI.

2. **Appium server lifecycle** — `appium_server.rs` can install, start, stop, and check Appium. Session creation/destruction with auto-recovery on stale sessions is implemented in `appium.rs`.

3. **Session auto-recovery** — `get_or_recover_session()` in `appium.rs` detects dead sessions and recreates them transparently before tap/swipe/input/screenshot actions.

4. **ADB fallback for input_text** — When Appium `input_text` fails, `appium.rs` falls back to `adb shell input text` with proper space encoding.

5. **scrcpy screen mirroring** — `scrcpy.rs` + `LivePreviewPanel.tsx` can start/stop screen mirroring with state events.

6. **APK install and launch** — `apk.rs` + `apk.rs` command installs an APK, detects the package name via before/after diff, launches it, and saves run artifacts.

7. **UI hierarchy dump** — `uihierarchy.rs` implements a fast Appium page source path and an ADB fallback with proper timeouts (8s per attempt, 25s total). XML parsing is UTF-8 safe.

8. **UI snapshot** — `get_ui_snapshot` in `explorer.rs` returns elements + screen hash + screen size in one call.

9. **Heuristic smoke check** — `agent_loop.rs` implements a working 4-pass heuristic tap loop with loop detection, dead tap detection, crash detection, and vision analysis per step.

10. **Vision analyst** — `vision_analyst.py` correctly calls GPT-4o with a base64 image and returns structured defect findings. `chat_vision_json()` in `client.py` is implemented and working.

11. **AI run step pipeline (Phases B→D + E→F)** — `run_step.py` correctly chains Vision → Triage → Screen Analyst → Planner → Critic in a LangGraph graph. The `/v1/run/step` endpoint is wired and returns a `RunStepOutput`.

12. **Vision called in run_step** — `_vision_previous_step()` IS called as the first node in `run_step.py` when `screenshot_b64` is provided in the input.

13. **Vision called from Rust** — `ai_vision_screenshot_cmd` in `ai_engine.rs` takes a screenshot, base64-encodes it, and calls `/v1/vision/analyze` before each AI step in the `SmokeCheckPanel` AI loop.

14. **Overflow detection (dual path)** — Flutter overflow is detected both via UI element text scanning (`detectFlutterOverflowFromElements` in `SmokeCheckPanel.tsx`) and via GPT-4o vision. Both paths feed into `erroredScreens` and `findings`.

15. **Critic gate coercion** — `critic_gate.py` has robust `_coerce_action_obj()` that normalises various LLM output shapes into the strict `{type, params}` format.

16. **Fallback on run_step error** — The `/v1/run/step` endpoint catches all exceptions and returns a safe fallback swipe action instead of a 500, keeping the client loop alive.

17. **Screenshot panel** — `ScreenshotPanel.tsx` listens for `tezzy:screenshot_taken` events and displays thumbnails in real time.

18. **UI Inspector** — `InspectorPanel.tsx` can dump and display the UI hierarchy with tap-from-inspector support.

19. **LLM JSON mode** — `client.py` correctly uses `response_format={"type": "json_object"}` and prepends a `"Respond with json only."` guard message to satisfy OpenAI's requirement.

20. **Screen hash** — `scoring.rs` produces a stable hash from element text/resource-ids/bounds for loop detection.


---

## 4. What Is Currently Broken or Missing

### 4.1 Session Bootstrap (Phase A) Is Never Used in the AI Loop
**File**: `SmokeCheckPanel.tsx` — `handleStartAi()`

The AI test loop hardcodes `mode: "explore"` and `credentials: null` on every step call. `aiSessionBootstrap()` is defined in `aiEngine.ts` but is never called from `handleStartAi`. This means:
- The agent never enters `reach_home` mode
- Credentials are never passed to the Planner
- The run goal, stop conditions, and risk rules from Phase A are never used

### 4.2 Credentials Are Never Passed to the Planner
**File**: `SmokeCheckPanel.tsx` line: `credentials: null`

Even though `PlannerInput` has a `credentials` field and the Planner system prompt has a LOGIN SCREEN RULE, credentials are always `null`. The Planner cannot fill in login fields because it never receives the email or password.

### 4.3 Phase G (Improvement Advisor) and Phase H (Final Report) Are Never Called
**Files**: `improvement_advisor.py`, `final_report.py`

Both are implemented and have REST endpoints, but `handleStartAi` in `SmokeCheckPanel.tsx` never calls them. The run ends with a local `SmokeCheckResult` object. No AI-generated report is produced.

### 4.4 The `_USER_PROMPT_TEMPLATE` in `final_report.py` Contains Execution Order Notes Instead of Real Data
**File**: `app/graphs/final_report.py`

`_USER_PROMPT_TEMPLATE` contains literal text like `"Execution order in graph\n\nSession Bootstrap\nLoop per step:\n..."` — this is documentation/notes that was accidentally left in the user prompt. The LLM receives this as if it were instructions, which is confusing and wastes tokens.

### 4.5 The `_USER_PROMPT_TEMPLATE` in `improvement_advisor.py` Uses Placeholder Labels, Not Real Data
**File**: `app/graphs/improvement_advisor.py`

`build_phase_g_user_messages()` sends the real data as a JSON string in the first message, then sends `_USER_PROMPT_TEMPLATE` as a second message containing only field names (`"final_findings\nflow_coverage_stats\n..."`). The template is a label list, not a real prompt. The LLM has to guess what to do with it.

### 4.6 `seen_element_keys` Is Always an Empty List
**File**: `SmokeCheckPanel.tsx` line: `seen_element_keys: []`

The `RunStepInput` field `seen_element_keys` is hardcoded to `[]` on every step. The Screen Analyst and Planner receive no memory of which specific elements have already been interacted with. This is a key reason the agent revisits the same elements.

### 4.7 `loop_count` Is Always 0
**File**: `SmokeCheckPanel.tsx` line: `loop_count: 0`

`loop_count` is hardcoded to `0` on every step. The Planner's `AttemptCounters` never reflects actual loop state, so the Planner cannot escalate recovery behaviour when stuck.

### 4.8 The Planner Has No Concept of "Screen Completion"
**File**: `app/graphs/planner.py`

There is no mechanism to mark a screen as "fully explored" and move on. The Planner only sees the last 10 recent actions and the current screen analysis. It has no persistent list of completed screens, so it can return to already-explored screens indefinitely.

### 4.9 The Planner LOGIN SCREEN RULE Has No Step Tracking
**File**: `app/graphs/planner.py` — `_SYSTEM_PROMPT`

The LOGIN SCREEN RULE says to enter credentials in order (email → password → submit), but there is no state tracking for which login step has been completed. If the Planner is called again on the same login screen (e.g., after a failed tap), it may restart the sequence or skip steps.

### 4.10 `screenshot_b64` Is Passed to `run_step` but Vision Runs on the Previous Step's Screenshot
**File**: `run_step.py` — `_vision_previous_step()`

The vision node analyses `inp.screenshot_b64`, which is the screenshot taken at the START of the current step (before any action). This is correct by design (analyse what you see before acting), but the `SmokeCheckPanel` calls `invokeAiVisionScreenshot` before `aiRunStep` and passes the b64 in. This means vision runs twice on the same screenshot — once in Rust (`ai_vision_screenshot_cmd`) and once inside `run_step.py`. The results are partially merged via `_merge_overflow_detection()` but the duplication wastes tokens and latency.

### 4.11 The Heuristic Smoke Check (`policies.rs`) Has No Login Awareness
**File**: `app/desktop/src-tauri/src/explorer/policies.rs`

`PRIORITY_LABELS` includes "login", "log in", "sign in" but the heuristic has no concept of filling in form fields. It will tap the login button without entering credentials, causing the login to fail silently.

### 4.12 `no_element_count` Is Computed Incorrectly
**File**: `SmokeCheckPanel.tsx` line: `no_element_count: snap.ui_elements.length === 0 ? 1 : 0`

This is always either 0 or 1 — it never accumulates across steps. The Planner's `AttemptCounters.no_element_count` is always reset to 0 or 1, so it cannot detect a streak of empty screens.

### 4.13 `failure_streak` Resets to 0 on Any Success, But Never Carries Semantic Context
**File**: `SmokeCheckPanel.tsx`

`failureStreak` is tracked locally but only counts consecutive action execution failures (Appium errors). It does not count semantic failures like "tapped but screen didn't change" (dead taps). The Critic Gate receives a `failure_streak` that understates the real stuck-ness of the agent.

### 4.14 The `exploration_system.txt` and `exploration_user.txt` Prompt Files Are Empty
**Files**: `app/prompts/exploration_system.txt`, `app/prompts/exploration_user.txt`

Both prompt files exist on disk but are empty. They are not referenced anywhere in the codebase. Dead files.

### 4.15 `ui_schema.py` and `action_schema.py` Are Empty
**Files**: `app/schemas/ui_schema.py`, `app/schemas/action_schema.py`

Both schema files exist but are empty. Likely stubs that were never implemented.

### 4.16 The AI Report Is Only Written After 20+ Steps
**File**: `SmokeCheckPanel.tsx`

```typescript
if (stepsDone >= 20) {
    reportPath = await invokeWriteAiErroredScreensReport(...)
}
```
Short runs (< 20 steps) produce no report at all.


---

## 5. Multi-Agent System Analysis

### 5.1 The Agent Taps Randomly Instead of Going Screen by Screen

**Root cause — prompt level**: The Planner system prompt says "Expand coverage across unvisited flows by interacting with visible elements" but gives no definition of what "coverage" means or how to track it. There is no instruction to complete all interactions on the current screen before moving to the next.

**Root cause — graph level**: `seen_element_keys` is always `[]` (hardcoded in `SmokeCheckPanel.tsx`). The Planner's `memory_snapshot` contains `seen_element_keys: []` on every call. The Planner has no way to know which elements on the current screen it has already tapped. It picks based on the Screen Analyst's `candidate_targets` (a list of strings, not coordinates), which changes every step as the LLM re-evaluates the screen.

**Root cause — state level**: There is no "current screen completion" flag. The agent can leave a screen after one tap and return to it later, re-tapping the same elements.

### 5.2 The Agent Does Not Complete a Full Login Flow Before Exploring

**Root cause — prompt level**: The Planner has a LOGIN SCREEN RULE in its system prompt, but `credentials` is always `null` in the input (hardcoded in `SmokeCheckPanel.tsx`). The Planner receives `"credentials": null` and cannot fill in the email or password fields even if it wants to.

**Root cause — graph level**: Phase A (Session Bootstrap) is never called from the AI loop. The bootstrap would set `mode: "reach_home"` and provide credentials, but since it's never invoked, the loop always runs in `explore` mode with no credentials.

**Root cause — state level**: Even if credentials were passed, there is no login step counter. The Planner might tap the email field, then on the next step (after re-analysing the screen) decide to tap something else instead of the password field, because `recent_actions` only shows the last 10 raw action objects — not a semantic "I am in the middle of a login flow" state.

### 5.3 The Agent Does Not Fill Every Form Field It Encounters

**Root cause — prompt level**: The Planner prompt says "tap-first exploration" and "avoid consecutive swipes". There is no rule that says "when you see an EditText/TextField, always fill it before moving on". The Screen Analyst's `candidate_targets` is a list of strings (element labels), not typed targets. The Planner has to guess from the analysis whether a field needs filling.

**Root cause — graph level**: The Screen Analyst (`screen_analyst.py`) classifies screen type and lists `candidate_targets` as strings. It does not produce a structured list of "unfilled form fields". The Planner receives `analysis.candidate_targets` as a list like `["email field", "password field", "login button"]` but has no way to know which are already filled.

**Root cause — state level**: `seen_element_keys` is always empty, so the Planner cannot distinguish "I already filled this field" from "I haven't touched this field yet".

### 5.4 The Agent Does Not Remember Which Screens It Has Fully Completed

**Root cause — prompt level**: There is no concept of "screen completion" in any prompt. The Planner is told to "expand coverage" but not to track which screens are done.

**Root cause — graph level**: The `memory_snapshot` passed to the Planner contains `seen_hash_counts` (how many times each screen hash was seen) and `seen_element_keys` (always empty). `seen_hash_counts` tells the Planner "I've been on this screen 3 times" but not "I've tapped all the interactive elements on this screen". There is no per-screen completion record.

**Root cause — state level**: The `RunStepInput` has no field for "completed_screens" or "screen_coverage_map". This would need to be added to the state and maintained by the orchestrator loop in `SmokeCheckPanel.tsx`.

### 5.5 The Agent Misses Many Overflow Issues Because Vision Is Not Called Consistently

**Root cause — code level**: Vision IS called on every step in `handleStartAi` via `invokeAiVisionScreenshot`. However, the vision call happens BEFORE the action is executed. This means:
- The screenshot analysed is the state BEFORE the tap
- After the tap, a new screen may appear with overflow issues
- That new screen is only analysed on the NEXT step's vision call
- If the agent moves away from that screen before the next step, the overflow is missed

**Root cause — graph level**: Inside `run_step.py`, `_vision_previous_step()` also runs on the `screenshot_b64` passed in — which is the same pre-action screenshot already analysed by the Rust command. This is redundant and does not add post-action coverage.

**Root cause — missing post-action screenshot**: There is no post-action screenshot + vision call. After executing an action, the loop immediately calls `invokeGetUiSnapshot()` for the next step, but does NOT take a screenshot of the resulting screen before calling `aiRunStep`. The `screenshotB64` passed to the next `aiRunStep` is the screenshot from the CURRENT step's pre-action state, not the post-action state of the previous step.

**Concrete gap**: Step N takes screenshot → runs vision → executes action → Step N+1 takes screenshot → runs vision. The screenshot at step N+1 is taken AFTER the action from step N. So vision does see the result of each action — but only on the next iteration. If `should_continue` becomes false and the loop stops, the last screen is never vision-analysed.


---

## 6. Recommended Fixes in Priority Order

### P1 — Pass Credentials to the Planner (Highest Impact)
**Why**: Without credentials, the login flow can never complete. Every other exploration is blocked.
**File**: `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx`
**Change**: Add a credentials input to the UI (or read from a config). Pass `credentials: { email, password }` instead of `credentials: null` in the `aiRunStep` call inside `handleStartAi`.
**Also**: In `run_step.py` → `_plan_next_action()`, the credentials are already forwarded to `PlannerInput`. No Python changes needed.

### P2 — Call Session Bootstrap (Phase A) at the Start of the AI Loop
**Why**: Phase A sets the mode to `reach_home` first (to get past login), then `explore`. Without it, the agent always explores randomly from step 1.
**File**: `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx`
**Change**: Before the step loop in `handleStartAi`, call `aiSessionBootstrap({ app_name, credentials, home_markers, flow_hints, max_steps })`. Use the returned `mode` as the initial mode for the loop. Switch to `explore` once `reach_home` succeeds (i.e., screen_type === "home").

### P3 — Track `seen_element_keys` Across Steps
**Why**: Without this, the Planner has no memory of which elements it has already interacted with. It will re-tap the same elements indefinitely.
**File**: `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx`
**Change**: Maintain a `seenElementKeys: string[]` array in the loop. After each successful action, add the key of the tapped element (e.g., `resource_id::bounds`) to the array. Pass it as `seen_element_keys` in each `aiRunStep` call.

### P4 — Add a "Screen Completion" Mechanism
**Why**: The agent needs to know when it has exhausted all interactions on a screen before moving on.
**File**: `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx` + `app/graphs/planner.py`
**Change**: Track a `completedScreenHashes: Set<string>`. When `seenHashCounts[hash] >= N` AND no new elements have been tapped in the last M steps on that screen, mark it complete. Pass `completed_screens` in the memory snapshot. Add a rule to the Planner prompt: "If the current screen hash is in completed_screens, navigate away using back, a tab, or a menu item."

### P5 — Fix `loop_count` and `no_element_count` to Accumulate Correctly
**Why**: The Planner's `AttemptCounters` are always 0 or 1. The Planner cannot escalate recovery.
**File**: `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx`
**Change**: Track `loopCount` and `noElementCount` as persistent variables in the loop. Increment `loopCount` when `seenHashCounts[hash] > 1`. Increment `noElementCount` when `snap.ui_elements.length === 0`. Reset both when the screen hash changes.

### P6 — Add a Post-Action Screenshot + Vision Call
**Why**: The current vision call is pre-action. A post-action screenshot would catch overflow issues that appear immediately after a tap (e.g., a dialog opening with overflow).
**File**: `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx`
**Change**: After `executeAiAction()` and the `sleep(delayMs)`, call `invokeAiVisionScreenshot(step, newHash)` on the resulting screen. Feed the result into the next step's `overflow_detection` and `runtime_signals`.

### P7 — Fix the `final_report.py` User Prompt Template
**Why**: The template contains execution order documentation instead of real data instructions.
**File**: `ai-mobile-qa/apps/ai-engine/app/graphs/final_report.py`
**Change**: Replace `_USER_PROMPT_TEMPLATE` with a proper instruction: "Analyse the run data above and produce a QA report. Return markdown_report, executive_summary, and pass_fail_status."

### P8 — Wire Phase G and Phase H at the End of the AI Loop
**Why**: The AI loop produces no final report. Phases G and H are implemented but never called.
**File**: `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx`
**Change**: After the step loop ends, call `aiImprovementSuggest(findings, flowStats)` then `aiFinalReport(metadata, stepsLog, findings, improvements)`. Display the markdown report in the UI.

### P9 — Add Login Step State to the Planner
**Why**: The LOGIN SCREEN RULE has no step tracking. The Planner may restart the login sequence on each call.
**File**: `ai-mobile-qa/apps/ai-engine/app/graphs/planner.py` + `app/schemas/planner.py`
**Change**: Add a `login_step` field to `PlannerInput` (0=not started, 1=email entered, 2=password entered, 3=submitted). Pass it from the orchestrator. Add a rule: "If login_step=1, your ONLY action is to tap the password field and input the password."

### P10 — Remove the Report Threshold (Always Write Report)
**Why**: Runs under 20 steps produce no report.
**File**: `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx`
**Change**: Remove the `if (stepsDone >= 20)` guard. Always write the report.

### P11 — Eliminate Duplicate Vision Analysis
**Why**: Vision runs twice on the same screenshot (once in Rust, once in Python `run_step.py`).
**File**: `ai-mobile-qa/apps/ai-engine/app/graphs/run_step.py`
**Change**: If `screenshot_b64` is already provided AND `overflow_detection` already contains vision results (i.e., the Rust side already ran vision), skip `_vision_previous_step()` in the graph. Add a check: if `inp.overflow_detection.get("vision")` is already populated, return it directly without calling the vision graph again.

### P12 — Fix `improvement_advisor.py` User Prompt Template
**Why**: The template is just a list of field names, not a real instruction.
**File**: `ai-mobile-qa/apps/ai-engine/app/graphs/improvement_advisor.py`
**Change**: Replace `_USER_PROMPT_TEMPLATE` with: "Based on the QA run data above, generate specific, actionable improvements. Return product_improvements, qa_automation_improvements, priority_order, and quick_wins_24h."


---

## 7. Prompt Quality Assessment

### Phase A — Session Manager (`session_manager.py`)

**System Prompt**:
```
You are Tezzy Session Manager. Your job is to initialize one mobile QA run.
You must produce a clear run plan with two objectives:
reach home screen from current screen,
explore major app flows and detect potential UI/UX issues, especially Flutter overflow indicators.
Always return strict JSON only.
```
**Grade: C+**
- Missing: No instruction on HOW to determine the initial mode (reach_home vs explore). The LLM has to guess.
- Missing: No guidance on what constitutes a "home screen" beyond the `home_markers` list.
- Missing: No instruction on how to use `flow_hints` to shape the run plan.
- Improvement: Add "If the current screen is not the home screen (not matching home_markers), set mode to reach_home. Otherwise set mode to explore. Use flow_hints to populate success_criteria with specific flows to test."

**User Prompt**: Passes all fields correctly. Adequate.

---

### Phase B — Screen Analyst (`screen_analyst.py`)

**System Prompt**:
```
You are Tezzy Screen Analyst. Read current UI state and classify the screen.
You must detect: likely screen type, blockers, best candidate interactions.
Crucially, look for layout overflows...
```
**Grade: B**
- Good: Overflow detection instruction is specific and mentions Flutter's yellow/black striped ribbon.
- Missing: No instruction on how to ORDER `candidate_targets`. The schema says "ordered" but the prompt doesn't say ordered by what (priority? likelihood of progress?).
- Missing: No instruction to distinguish between "elements I should tap" vs "elements I should fill with text". The Planner needs to know which candidates are form fields.
- Missing: No instruction on what to put in `blocker_flags` beyond overflow. Should include: "permission dialog blocking", "loading spinner", "keyboard open", "modal dialog".
- Improvement: Add "Order candidate_targets by: (1) form fields that need filling, (2) primary action buttons, (3) navigation elements, (4) secondary actions. For each form field, prefix with 'fill:' e.g. 'fill:email_field'."

**User Prompt**: Passes all fields. Adequate but `screenshot_summary` is often `null` (no screenshot description), reducing the LLM's ability to classify the screen.

---

### Phase C — Planner (`planner.py`)

**System Prompt**:
```
You are Tezzy Planner. Propose exactly one next action.
Priority:
LOGIN SCREEN RULE: If analysis.screen_type is 'login', enter credentials in strict order...
Expand coverage across unvisited flows...
Prefer tapping visible buttons, tabs, drawer/menu entries...
Do not output more than one swipe in a row...
Do not repeat low-value actions...
```
**Grade: B-**
- Good: LOGIN SCREEN RULE is present and specific about the 3-step sequence.
- Critical gap: The rule says "enter credentials in strict order" but credentials are always null. The rule is dead code.
- Missing: No rule for "if you see an unfilled form field (EditText), fill it before tapping any button".
- Missing: No rule for "if screen_type is 'home' and mode is 'reach_home', switch mode to 'explore'".
- Missing: No rule for "if seen_hash_counts[current_hash] > 3, you MUST navigate away — tap a tab, back, or menu item".
- Missing: No rule for "do not tap the same element twice" (relies on seen_element_keys which is always empty).
- Improvement: Add explicit rules for form filling, mode switching, and stuck-screen recovery. Add "If credentials is not null and screen_type is login, you MUST use input_text actions to fill the email and password fields before tapping submit."

**User Prompt**: Passes analysis, memory, screen_size, credentials, attempt_counters. The `memory_snapshot.seen_element_keys` is always `[]` which makes the memory useless.

---

### Phase D — Critic Gate (`critic_gate.py`)

**System Prompt**:
```
You are Tezzy Critic. Validate planner action before execution.
Reject actions that are repetitive, unsafe, or unlikely to progress.
If rejected, provide one safer alternative action.
Return strict JSON only.
```
**Grade: C**
- Too vague. "Repetitive, unsafe, or unlikely to progress" gives the LLM no concrete rules.
- Missing: No definition of what "repetitive" means (same action type? same coordinates? same element?).
- Missing: No rule for "if failure_streak > 3, reject any tap and suggest back or swipe".
- Missing: No rule for "if seen_hash_counts[screen_hash] > 5, reject any tap on the same screen and force navigation".
- Missing: No rule for "never reject an input_text action on a login screen".
- Improvement: Add concrete rejection criteria: "Reject if: (1) proposed action is tap_xy and the same coordinates appear in recent_actions more than twice, (2) failure_streak > 3 and action is not back/swipe, (3) action is wait_ms or screenshot (low value). Always approve input_text actions."

**User Prompt**: Passes proposed_action, screen_hash, seen_hash_counts, recent_actions, failure_streak, mode. Adequate.

---

### Phase E — Vision Analyst (`vision_analyst.py`)

**System Prompt**:
```
You are Tezzy Vision Analyst. You inspect Android app screenshots for UI rendering defects.
Detect ALL of the following defect types if present: overflow, clipping, truncation, misalignment, off_screen, other.
Be precise. Only flag real visible defects...
```
**Grade: A-**
- Good: Defect types are well-defined and specific.
- Good: "Only flag real visible defects — do not flag intentional design choices" is a good guard against false positives.
- Minor gap: No instruction on confidence threshold. The LLM may flag very minor truncations as errors.
- Minor gap: No instruction to describe the region precisely (e.g., "bottom navigation bar, right side" vs just "bottom").
- Improvement: Add "For overflow defects, describe the exact pixel region and the text of the overflow message if visible."

**User Prompt**: Well-structured. Passes step, screen_hash, and the image. Return format is clearly specified with examples. Grade: A.

---

### Phase F — Issue Triage (`issue_triage.py`)

**System Prompt**:
```
You are Tezzy Issue Triage Agent.
Combine runtime signals and vision findings into normalized findings.
Sources: loop, dead_tap, crash_hint, no_elements, overflow_vision.
Deduplicate and assign severity.
Return strict JSON only.
```
**Grade: C+**
- Missing: No severity assignment rules. What makes something "error" vs "warn" vs "info"?
- Missing: No deduplication rules. How should the LLM decide two findings are the same?
- Missing: No rule for when `should_continue` should be false. The LLM has to guess.
- Improvement: Add "Set should_continue=false if: (1) a crash_hint signal is present, (2) more than 3 overflow errors on the same screen_hash, (3) failure_streak > 5. Severity: error=crash or overflow, warn=loop or dead_tap, info=no_elements."

**User Prompt**: Passes all fields. Adequate.

---

### Phase G — Improvement Advisor (`improvement_advisor.py`)

**System Prompt**: Adequate — clear and focused.
**Grade: B**

**User Prompt Template**:
```
Input:
final_findings
flow_coverage_stats
repeated_fail_patterns
overflow_instances
Return:
product_improvements
...
```
**Grade: D** — This is just a list of field names. The LLM receives the actual data as a separate JSON message, then this template as a second message. The template adds no instruction value. It should be replaced with a real instruction like "Based on the QA findings above, generate specific developer-actionable improvements."

---

### Phase H — Final Report (`final_report.py`)

**System Prompt**: Good — specifies what the report must include.
**Grade: B+**

**User Prompt Template**:
```
Input:
run_metadata
steps_log
...
Execution order in graph

Session Bootstrap
Loop per step:
Screen Understanding
...
```
**Grade: F** — The template contains internal implementation notes ("Execution order in graph", "Important implementation rule", "Keep prompts separated exactly by phase..."). This is developer documentation accidentally left in the user prompt. The LLM receives this as instructions and may try to follow them. Remove everything after "Return:" that is not a field name.


---

## 8. Efficiency Improvements

### 8.1 Eliminate Duplicate Vision Calls (Save ~1 GPT-4o call per step)
**Current**: Vision runs twice per step — once in Rust (`ai_vision_screenshot_cmd`) and once inside `run_step.py` (`_vision_previous_step`). Both analyse the same base64 image.
**Fix**: In `run_step.py`, check if `inp.overflow_detection` already contains a `"vision"` key (populated by the Rust side). If yes, skip the `_vision_previous_step` node entirely. This saves one GPT-4o call per step — the most expensive call in the pipeline.

### 8.2 Batch Screen Analyst + Planner Into One LLM Call (Save 1 GPT-4.1-mini call per step)
**Current**: Phase B (Screen Analyst) and Phase C (Planner) are separate LLM calls. The Planner receives the Screen Analyst's output as its input. They could be merged.
**Fix**: Create a combined `ScreenAnalystPlanner` agent that returns both the analysis AND the proposed action in one call. This reduces the per-step LLM calls from 4 (Vision + Triage + Analyst + Planner + Critic) to 3.
**Trade-off**: Loses the ability to independently test/debug each phase. Only do this after the system is working correctly.

### 8.3 Skip Triage When There Are No Signals (Already Partially Implemented)
**Current**: `_triage_previous_step()` already skips if `runtime_signals` and `overflow_detection` are both empty. Good.
**Enhancement**: Also skip triage if `prior_findings` is empty and `failure_streak == 0`. This avoids a triage LLM call on clean steps.

### 8.4 Use a Smaller Model for Triage and Critic
**Current**: All text phases use `gpt-4.1-mini` (default). Triage and Critic are simple classification tasks.
**Fix**: Use `gpt-4.1-nano` or `gpt-3.5-turbo` for Phase D (Critic) and Phase F (Triage). These are binary decision tasks that don't need a large model. Set `model="gpt-3.5-turbo"` in the `llm.chat_json_messages()` calls for those phases.

### 8.5 Reduce UI Element Payload Size
**Current**: The full `ui_elements` array (potentially 200+ elements) is serialised and sent to the AI engine on every step. Each element has 13 fields.
**Fix**: Before sending to `aiRunStep`, filter `ui_elements` to only include interactive elements (clickable, scrollable, checkable) plus elements with non-empty text. Strip `class_full`, `depth`, `bounds` (keep only `center_x`, `center_y`). This can reduce the payload by 60-70%.

### 8.6 Use Rolling Summary Instead of Full `recent_actions`
**Current**: `recentActions` grows unbounded in the loop and the last 10 are sent every step.
**Fix**: After every 5 steps, summarise `recentActions` into a compact string like "tapped login button, entered email, entered password, tapped submit, navigated to home" and pass that as a `session_summary` field instead of the raw action array. This reduces token usage as the run progresses.

### 8.7 Cache Screen Analyst Results for Repeated Screens
**Current**: If the agent returns to a screen it has seen before (same `screen_hash`), the Screen Analyst runs again and produces the same output.
**Fix**: In `run_step.py`, maintain an in-memory cache `Dict[screen_hash, ScreenUnderstandingOutput]`. If the hash is in the cache, skip Phase B and use the cached result. Only re-run Phase B if the hash is new.
**Note**: This requires the cache to be stored in the LangGraph state or passed through the API, which adds complexity. A simpler approach is to cache in the Rust/TypeScript orchestrator.

### 8.8 Increase Step Delay Adaptively
**Current**: Step delay is fixed (default 1500ms). This is conservative.
**Fix**: Start with 800ms delay. If the last 3 steps all had `result_status: "ok"` and the screen hash changed each time, reduce delay to 500ms. If a dead_tap or loop is detected, increase to 2000ms to let the app settle. This reduces total run time by 30-40% on fast devices.

### 8.9 Parallelise Vision and UI Snapshot
**Current**: The loop calls `invokeAiVisionScreenshot` (takes screenshot + runs vision) then `invokeGetUiSnapshot` (dumps UI hierarchy) sequentially.
**Fix**: These can run in parallel since they are independent. Call both simultaneously with `Promise.all([invokeAiVisionScreenshot(...), invokeGetUiSnapshot()])`. This saves 1-3 seconds per step (the UI dump time).
**Caveat**: The screenshot and UI dump must be of the same screen state. Add a small delay after the action before both calls to ensure the screen has settled.


---

## Summary: 3 Most Critical Fixes Right Now

### Fix 1 — Pass Credentials + Call Session Bootstrap
**Files**: `SmokeCheckPanel.tsx`

This is the single highest-impact fix. Without credentials, the login flow can never complete. Without Session Bootstrap, the agent always starts in `explore` mode and never tries to reach the home screen first. These two changes together will make the agent behave like a structured QA tester that logs in before exploring.

**Exact changes needed**:
1. Add a credentials state (email, password) to `SmokeCheckPanel` or read from a config.
2. At the start of `handleStartAi`, call `aiSessionBootstrap({ app_name, credentials, home_markers: ["home", "dashboard", "main"], max_steps })`.
3. Use the returned `mode` as the initial loop mode.
4. Pass `credentials` in every `aiRunStep` call instead of `null`.
5. Switch mode from `reach_home` to `explore` when `aiOut.analysis.screen_type === "home"`.

---

### Fix 2 — Track `seen_element_keys` and `loop_count` Across Steps
**Files**: `SmokeCheckPanel.tsx`

Without element memory, the agent re-taps the same elements on every visit to a screen. This is why it appears to "tap randomly". Tracking which elements have been interacted with gives the Planner the information it needs to make progress.

**Exact changes needed**:
1. Add `const seenElementKeys: string[] = []` before the loop.
2. After each successful `executeAiAction` for a `tap_xy` action, find the element at those coordinates in `snap.ui_elements` and push `${el.resource_id}::${el.bounds}` to `seenElementKeys`.
3. Pass `seen_element_keys: seenElementKeys` in each `aiRunStep` call.
4. Track `let loopCount = 0` — increment when `seenHashCounts[hash] > 1`, reset when hash changes.
5. Pass `loop_count: loopCount` in each `aiRunStep` call.

---

### Fix 3 — Fix the Final Report Prompt and Wire Phase H
**Files**: `app/graphs/final_report.py`, `SmokeCheckPanel.tsx`

The final report prompt contains developer notes instead of instructions (grade: F). And Phase H is never called, so the AI run produces no AI-generated report. Fixing the prompt and calling Phase H at the end of the loop will give users a proper QA report.

**Exact changes needed**:
1. In `final_report.py`, replace `_USER_PROMPT_TEMPLATE` with: `"Analyse the run data provided and produce a comprehensive QA report. Return markdown_report (full markdown), executive_summary (2-3 sentences), and pass_fail_status ('pass', 'fail', or 'partial')."`
2. In `SmokeCheckPanel.tsx`, after the loop ends, call the `/v1/report/finalize` endpoint (add `aiFinalReport()` to `aiEngine.ts`) with the accumulated `findings`, `steps`, and run metadata.
3. Display the returned `markdown_report` in the UI (a simple pre-formatted text block is sufficient).

