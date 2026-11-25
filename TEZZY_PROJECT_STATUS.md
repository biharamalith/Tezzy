# Tezzy — Project Status and Technical Handover

**Reviewed:** 17 October 2026  
**Repository:** `ai-mobile-qa/`  
**Status:** Functional prototype / active development. The device-automation foundation is implemented, but autonomous AI smoke testing is **not yet reliable**: it may navigate only one or two screens and does not comprehensively test an application. The newly added scenario system is also not connected to real device execution.

## 1. What Tezzy is

Tezzy is a local desktop tool for Android mobile QA. It helps a tester connect an Android device, install and launch an APK, inspect the accessibility tree, perform Appium actions, run automated smoke checks, and generate local evidence (screenshots and Markdown reports).

The project is moving beyond deterministic smoke testing toward **AI-assisted, goal-based test scenarios**. A scenario describes what the app should achieve; an AI service analyzes the current screen, plans an action, applies safety/quality checks, and feeds an action back to the desktop application.

## 2. Current architecture

```text
React + TypeScript desktop UI
          │ Tauri invoke/events
          ▼
Rust / Tauri backend
  ├─ ADB: device discovery, UI hierarchy, APK install/launch
  ├─ scrcpy: separate live-device preview window
  ├─ Appium: session management and touch/keyboard actions
  ├─ Explorer: deterministic smoke-check loop and reports
  └─ AI bridge: starts/calls local Python service
          │ HTTP on 127.0.0.1:8010
          ▼
Python FastAPI AI engine
  ├─ LangGraph workflow nodes
  ├─ OpenAI/OpenRouter-compatible LLM client
  ├─ planning, critic, vision, triage and reporting endpoints
  └─ scenario validation/templates/execution API
```

The desktop app owns the real Android tools and artifact files. The AI engine is intended to make decisions; it should not directly control a device.

## 3. Technologies in use

| Area | Technologies |
|---|---|
| Desktop application | Tauri 1.x, Rust 2021, Cargo |
| UI | React 18, TypeScript, Vite 8 |
| Android integration | Android Debug Bridge (`adb`), Appium / UiAutomator2, scrcpy, `uiautomator` |
| AI service | Python, FastAPI, Uvicorn, Pydantic 2, LangGraph, OpenAI SDK, python-dotenv |
| Networking/security | `reqwest`, localhost HTTP service, SHA-256 (`sha2`), safe ZIP extraction (`zip`) |
| Tests | Vitest + jsdom (frontend), pytest test suite present for AI service |
| Data/contracts | JSON schemas and Pydantic models; local JSON scenario files |

## 4. Completed implementation

### Device and desktop foundation

- Detects ADB availability and lists Android devices.
- Validates device serials and stores an active device.
- Streams bounded application logs to the UI through Tauri events.
- Uses direct process execution with an executable allowlist instead of shell commands.

### APK and visual preview

- Starts/stops a `scrcpy` preview window for the active device.
- Installs an APK, attempts package detection, launches it, and writes install/launch artifacts.
- Creates local run folders with metadata and logs.

### Appium automation

- Installs/starts/stops a local Appium server and performs a health check.
- Creates and retains one active UiAutomator2 session.
- Supports tap, back, swipe, text entry, and screenshot capture.
- Keeps Appium bound to `127.0.0.1`, avoiding network exposure.

### Inspector and early smoke-check prototype

- Reads and parses the Android UI hierarchy into labelled/clickable elements.
- Allows an inspector item to prefill a manual tap action.
- Contains a bounded, heuristic smoke explorer (maximum 50 steps), but it is not a full autonomous tester.
- Detects dead taps, repeated-screen loops, likely crashes, and no-interactive-element states.
- Captures screenshots and writes Markdown smoke reports for the screens it does reach.

### AI-assisted flow and scenario authoring (latest, uncommitted work)

- Local AI engine can be launched automatically by the Rust backend and is health-checked before use.
- AI endpoints exist for session bootstrap, screen analysis, next-action planning, critic gate, issue triage, improvement suggestions, final reports, one-step orchestration, and screenshot/vision analysis.
- AI provider settings support OpenAI and an OpenRouter-compatible base URL through environment variables.
- The UI includes a Scenario Builder, templates, JSON import/export/storage helpers, goal constraints, and a scenario-to-smoke-check handoff.
- The smoke-check UI has been expanded with AI guidance and vision evidence, but this path requires real-device validation and currently cannot guarantee broad screen coverage.

## 5. What is verified

| Check | Result |
|---|---|
| Rust backend | `cargo check` passes (29 warnings) |
| Frontend tests | `npm test -- --run` passes: 2 files, 79 tests |
| Python tests | Not run: the checked-in root `.venv` does not have `pytest` installed |
| Real Android/Appium/AI E2E run | Not verified in this review; requires a device/emulator, Android tooling, Appium, Python dependencies, and an API key |

The frontend test runner initially required an unrestricted child-process permission in this environment; after permission was granted, all 79 tests passed.

## 6. Important remaining work / fixes

### Highest priority: make autonomous smoke testing actually explore the application

The reported behaviour—stopping after one or two screens—is consistent with the present design. The Rust smoke loop is fundamentally a simple one-element-at-a-time heuristic:

- it chooses the first unseen enabled/clickable UI element, prioritizing a short hard-coded list such as `Next`, `Allow`, `Login`, and `Continue`;
- it marks an element as permanently seen before confirming that it caused useful navigation;
- it treats the same UI-tree hash three times as a loop and stops; and
- it has only a generic upward-swipe fallback when no candidate is found.

This cannot understand application purpose, login data requirements, nested navigation, tabs, drawers, forms, permissions, scrolling lists, or stateful flows. Vision analysis currently records findings after a screenshot; it does not by itself guarantee an improved next navigation action.

To meet the intended behaviour (visit screens, press relevant controls, and check each screen), implement a goal-directed exploration engine that:

1. builds a graph of visited screen states and every attempted transition;
2. ranks actions using the scenario goal, accessibility labels, element roles, and AI analysis—not the first eligible control;
3. retries failed actions safely and uses alternative actions (back, tabs, drawer, scroll, dismiss permissions) before declaring a loop;
4. tracks scroll positions and dynamically loaded list content so one screen can be explored more than once;
5. identifies destructive/risky actions and requires an explicit allowlist or user confirmation;
6. defines test oracles for each screen (visible errors, broken layout, expected destination, success criteria); and
7. reports coverage: unique screens reached, controls tried, controls skipped, and the reason for every termination.

Until this exists and is tested on representative apps, label the feature **experimental autonomous exploration**, not an AI smoke test that checks everything.

### Next highest priority: connect scenarios to the real device

`POST /v1/scenario/execute` currently starts the `ScenarioExecutor` using `mock_ui_snapshot_callback` and `mock_execute_action_callback`. It validates and exercises the control flow, but it does **not** obtain a real screen or execute actions on Android. Replace these mock callbacks with a desktop-to-engine bridge (or move the orchestration into Rust) that can:

1. collect the current UI hierarchy, screenshot, and screen hash;
2. execute an approved action through the active Appium session;
3. return action results and artifacts to the scenario executor; and
4. report real-time progress safely to the UI.

### High priority: make the runtime setup reliable

- Add an AI-engine setup script or documented command that creates `apps/ai-engine/.venv` and installs `requirements.txt` **plus test dependencies such as `pytest`**.
- Confirm that the Python executable discovery works on a clean machine. The Rust launcher checks `apps/ai-engine/.venv` and then a literal `python` path; the latter may not resolve through `PATH` because it checks `Path::exists()` first.
- Add a preflight screen that checks `adb`, `scrcpy`, Appium/Node, Python, Python packages, and `OPENAI_API_KEY` before a run.
- Pin dependency versions or use lock files for Python to ensure reproducible installs.

### High priority: harden persistence and APIs

- `active_runs` is in-memory only. Runs disappear on an AI-engine restart, are not cleaned up, and have no concurrency/retention policy. Use persistent storage or clearly limit this to single-user prototype usage.
- Avoid returning raw exception text from `/vision/analyze` or `/run/step` to the UI; it can reveal local implementation details or provider errors. Log the detail server-side and return a stable error code/message.
- Add authentication or keep the AI engine strictly localhost. Its current intended use is local-only, but this boundary should be enforced/documented.
- Review scenario file commands for path validation and scope. File-oriented commands should only access a controlled scenario directory, not arbitrary user-provided paths.

### Medium priority: improve automation reliability

- Replace the APK package-name before/after package-list diff with `aapt2 dump badging`. The current fallback cannot reliably identify an app on reinstall.
- Add Appium startup/install integration testing. The bundled-Appium download flow and managed-server lifecycle are compiled but were not exercised here.
- Add tests against a real emulator for APK install, session lifecycle, UI hierarchy parsing, screenshot capture, smoke-report creation, and multi-screen autonomous exploration.
- Scrcpy output is not collected, which makes preview failures harder to diagnose.
- Add artifact retention/cleanup settings so local reports and screenshots do not grow indefinitely.

### Medium priority: code quality and test coverage

- Resolve the 29 `cargo check` warnings. Most urgent are ignored `emit_log(...)` `Result`s in `src-tauri/src/commands/scenarios.rs`; explicitly handle or intentionally discard them with `let _ =`.
- Remove unused imports and dead/obsolete scaffolding after confirming whether it is still planned (`get_ai_engine_base_url`, downloader/ZIP helpers, process streaming types, unused server port field).
- Add automated Python test setup and run the existing pytest tests in CI.
- Add tests for the new Rust AI-engine launcher, scenario file commands, and AI/smoke-check integration. Existing frontend tests cover scenario validation/storage helpers but do not prove a full device run.
- Add CI for `npm test`, frontend build, `cargo check`/`cargo test`, and `pytest`.

### Product gaps still planned or worth deciding

- Test recording and playback are planned in older documentation but are not implemented as a complete feature.
- The UI hierarchy inspector is implemented as a pull/manual snapshot, not a continuously synchronized live overlay.
- AI results need clear user controls: cost/model selection, timeout/retry limits, redaction of screenshots/credentials, and confirmation for risky actions.
- Decide how much of the AI decision trace and evidence should be persisted in the final report.

## 7. Repository layout

```text
ai-mobile-qa/
├─ apps/
│  ├─ desktop/                 React UI + Tauri application
│  │  ├─ src/                  UI panels, client helpers, scenario types
│  │  └─ src-tauri/src/        Rust commands, drivers, core, explorer, reporting
│  └─ ai-engine/               Python FastAPI/LangGraph service
│     ├─ app/api/              HTTP routes
│     ├─ app/graphs/           AI workflow nodes
│     ├─ app/schemas/          Pydantic contracts
│     ├─ app/executors/        Scenario execution logic
│     └─ tests/                AI-service tests
├─ packages/shared-schemas/    JSON schemas shared by the system
├─ docs/                       Earlier architecture and weekly planning notes
└─ tools/fixtures/             ADB parsing fixtures
```

## 8. Current working-tree note

The repository has uncommitted changes for the scenario/AI enhancement (20 modified/new implementation files) and an untracked root `package-lock.json`. Review and commit this work as a coherent change before further feature work. This status file is intentionally separate from those changes.

## 9. Recommended next milestone

First, make exploration reliable on one representative app with at least five screens, a scrollable list, and a back/navigation path. Capture a coverage report showing the visited screens and attempted controls. Then make one goal-based scenario work end to end on a physical Android device or emulator:

1. create a reproducible Python environment and configure the AI key;
2. connect scenario executor callbacks to the Rust/Appium device layer;
3. run a small login/navigation scenario with screenshots and a final report;
4. add an integration test or scripted emulator demo for that path; and
5. fix warnings and establish CI before adding further scenario features.

This will turn the current prototype into a demonstrable, reliable QA workflow.
