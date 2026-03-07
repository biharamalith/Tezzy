## Week 1: Tezzy foundations

### Module responsibilities

- `core/process.rs`: Safe process runner with an executable allowlist, async capture for short commands, and streaming skeleton for long-lived processes.
- `core/events.rs`: Event payload types and emit helpers for `tezzy:log` and `tezzy:device_state`.
- `drivers/adb.rs`: adb integration (version check, device listing, parsing, validation) plus tests using fixtures.
- `commands/devices.rs`: Tauri commands that coordinate adb calls, emit events, and store active device state.
- React UI: device selector, live preview placeholder, and terminal log panel with bounded memory.

### Security decisions

- No shell usage: commands run via `std::process::Command` with explicit arguments.
- Executable allowlist: only `adb` is permitted in Week 1.
- Device serial validation: only alphanumeric and `_ - . :` are allowed.
- Log safety: messages are truncated before emission to avoid unbounded growth.

### Complexity and memory notes

- adb parsing is O(n) over output lines.
- Log panel keeps only the last 2000 entries in memory.
- Streaming process skeleton emits lines as they arrive to avoid buffering large outputs.

---

## Week 3: Managed Appium + Persistent Sessions + Manual Primitives

### Module responsibilities

- `core/downloader.rs`: Secure HTTP download with SHA-256 integrity verification.
  - `download_to_file()`: Streams content to disk via `reqwest` (300 s timeout). After download, computes SHA-256 over file bytes and compares against expected digest. Aborts and deletes the file on mismatch.
  - Streams to avoid loading large bundles (>200 MB) into memory.
  - Emits `tezzy:log` progress events during download.

- `core/zip_extract.rs`: Secure ZIP extraction with path-traversal prevention.
  - `extract_zip_safely()`: Opens archive, canonicalizes destination, then for every entry rejects: absolute paths, entries containing `..`, entries whose resolved output path escapes the destination directory.
  - Refused entries are skipped and logged; extraction continues for safe entries.
  - After extraction emits a completion log event.

- `core/events.rs` (extended): Added two new event types and helpers.
  - `AppiumStateEvent`: `status` (`"installing"` | `"ready"` | `"running"` | `"stopped"` | `"error"`), `message: String`, `port: Option<u16>`.
  - `SessionStateEvent`: `status` (`"creating"` | `"active"` | `"destroyed"` | `"error"`), `session_id: Option<String>`, `device_serial: Option<String>`.
  - `emit_appium_state()` / `emit_session_state()` helpers follow same pattern as existing emitters.

- `core/storage.rs` (extended): Added `ActiveSession` persistent in-process state.
  - `ActiveSession { session_id: String, device_serial: String, capabilities: serde_json::Value }`.
  - `ACTIVE_SESSION: OnceLock<Mutex<Option<ActiveSession>>>` — single session slot.
  - `get_active_session()` / `set_active_session()` — thread-safe accessors.
  - Rationale: session ID must survive across multiple Tauri commands without being re-passed from the frontend.

- `drivers/appium_server.rs`: Appium server lifecycle manager.
  - `ensure_appium_installed()`: Checks for existing Appium bundle at `~/.tezzy/appium/`. If absent, calls `downloader` to fetch bundle, verifies SHA-256, then calls `zip_extract` to unpack. Emits `installing` / `ready` events.
  - `start_appium_server()`: Spawns bundled Node.js with Appium entry point. Binds to `127.0.0.1` only (not `0.0.0.0`). Stores child handle in `APPIUM_PROCESS`. Emits `running` event on success.
  - `stop_appium_server()`: Kills child process, clears handle. Emits `stopped` event.
  - `health_check()`: HTTP GET `/status` on Appium port. Returns `true` if server responds with `ready: true`.

- `drivers/appium_client.rs`: Minimal WebDriver HTTP client.
  - `create_session()`: POST `/session` with UiAutomator2 capabilities (device serial, `app` capability). Parses `sessionId` from response. Stores ID in `storage::set_active_session()`.
  - `delete_session()`: DELETE `/session/{id}`. Clears active session from storage.
  - `tap_xy(x, y)`: W3C Actions API — pointer down + up at coordinates.
  - `back()`: POST `/session/{id}/back` — Android hardware back button.
  - `swipe(start_x, start_y, end_x, end_y, duration_ms)`: W3C pointer move sequence.
  - `input_text(text)`: POST `/session/{id}/element/active/value` — types into focused element.
  - `screenshot()`: GET `/session/{id}/screenshot` — returns base64 PNG, decoded to `Vec<u8>` and saved to run artifacts folder.
  - All calls use a 30 s `reqwest::Client` timeout.

- `commands/appium.rs`: 11 Tauri commands bridging frontend to Appium subsystem.
  - `ensure_appium` → `ensure_appium_installed()`
  - `start_appium` → `start_appium_server()`
  - `stop_appium` → `stop_appium_server()`
  - `get_appium_status` → `health_check()`
  - `create_appium_session` → `create_session()`
  - `destroy_appium_session` → `delete_session()`
  - `action_tap` → `tap_xy()`
  - `action_back` → `back()`
  - `action_swipe` → `swipe()`
  - `action_input` → `input_text()`
  - `action_screenshot` → `screenshot()`
  - Every command emits events for UI feedback before returning `Ok`.

- `features/sessions/SessionPanel.tsx`: React UI for Appium lifecycle and manual automation.
  - **Appium Server section**: Install button (triggers `ensure_appium`), Start/Stop buttons, status badge reflecting `AppiumStateEvent`.
  - **Session section**: Create session button (uses active device serial), Destroy button, session ID badge reflecting `SessionStateEvent`.
  - **Manual Actions section**: Tap (x/y number inputs), Back button, Swipe Up/Down buttons, Text input field, Screenshot button.
  - All buttons fire `invoke*` wrappers from `lib/tauri.ts`. Responses show in TerminalLogPanel via `tezzy:log` events.

### Why Appium binds to localhost only

Appium's WebDriver endpoint is an **unauthenticated HTTP server**. Binding to `0.0.0.0` would expose it to any process or user on the local network. Tezzy always passes `--address 127.0.0.1` when spawning Appium so the port is only reachable from within the same machine. If remote device testing is added in future, a TLS-authenticated relay layer must be introduced first.

### Session lifecycle and persistent session design

```
Frontend                 Rust commands             Appium server
   │                          │                         │
   │── create_appium_session ─►│                         │
   │                          │── POST /session ────────►│
   │                          │◄── { sessionId } ───────│
   │                          │  store in ACTIVE_SESSION │
   │◄── Ok(session_id) ───────│                         │
   │                          │                         │
   │── action_tap(x, y) ──────►│                         │
   │                          │  read ACTIVE_SESSION    │
   │                          │── POST /session/{id}/actions ►│
   │◄── Ok ───────────────────│                         │
```

`ACTIVE_SESSION` is a `Mutex<Option<ActiveSession>>` stored in a `OnceLock` so it is initialized once and shared across all command invocations without requiring the frontend to pass a session token on every call. This prevents a class of UI bugs where a stale or missing token causes silent failures.

### Download + checksum + safe extraction pipeline

1. **Check cache**: If `~/.tezzy/appium/appium-<version>/` exists and SHA-256 of the bundle file matches, skip download.
2. **Download**: Stream from HTTPS URL to `~/.tezzy/appium/appium-<version>.zip` via `reqwest`. Log progress.
3. **Verify**: SHA-256 of downloaded file must match hard-coded expected digest. If mismatch → delete file, emit `error` event, return `Err`.
4. **Extract**: Call `extract_zip_safely()`. Path traversal attacks in ZIP are blocked.
5. **Emit `ready`**: Server is now installable.

### Manual primitives and their limitations

| Primitive | Implementation | Limitation |
|-----------|---------------|------------|
| `tap_xy` | W3C Actions pointer down+up | Requires coordinates — no element lookup |
| `back` | `/session/{id}/back` | Android only; no iOS support in Week 3 |
| `swipe` | W3C pointer move sequence | Fixed duration; no velocity control |
| `input_text` | `/element/active/value` | Requires element to already be focused |
| `screenshot` | `/session/{id}/screenshot` base64 | Full-screen only; no element-crop |

### Security considerations

- **SHA-256 verification**: Prevents a tampered Appium bundle (supply chain attack) from being installed.
- **Path traversal prevention**: ZIP entries with `..` or absolute paths are rejected before any file is written.
- **Localhost-only binding**: Appium port not reachable from network.
- **No shell invocation**: Appium spawned via `std::process::Command` with explicit argument list.
- **Executable allowlist**: Bundled Node.js binary is the only new executable permitted in Week 3.
- **Base64 decoding on Rust side**: Screenshot bytes decoded in Rust before being written; frontend never receives raw base64 payloads from Appium directly.

### Complexity and memory notes

- **Download**: O(n) disk write, O(1) memory (streaming). SHA-256 computed in a single pass.
- **ZIP extraction**: O(n) disk, O(entry) memory per file.
- **Session storage**: O(1) — single slot.
- **WebDriver calls**: O(1) Rust heap; responses parsed and discarded. Screenshot: O(image_size) once during decode then written to disk.

---
## Week 2: scrcpy preview + APK install/launch

### Module responsibilities

- `drivers/scrcpy.rs`: Manages scrcpy child process lifecycle (start/stop). Stores process handle in static OnceLock<Mutex<Option<Child>>>. Validates device serial before spawning. Emits lifecycle events via event bus.
- `drivers/apk.rs`: APK installation and app launching.
  - `install_apk()`: Runs `adb install -r <apk>` with path validation (must exist, must be .apk file).
  - `list_installed_packages()`: Lists third-party packages for before/after detection.
  - `detect_package_name_fallback()`: Best-effort package detection via before/after diff of `pm list packages -3`.
  - `launch_package()`: Uses `adb shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1` to launch app.
- `core/storage.rs` (extended): 
  - `create_run_folder()`: Creates `reports/tezzy-run-<timestamp>/` with `logs/` and `meta.json`.
  - `write_run_log()`: Writes adb install/launch output to log files in run folder.
- `core/events.rs` (extended): Added `tezzy:scrcpy_state` event with status ("running"|"stopped"|"error"), message, and device serial.
- `commands/scrcpy.rs`: Tauri commands for `start_scrcpy_preview`, `stop_scrcpy_preview`, `get_scrcpy_preview_status`. Coordinates with active device storage.
- `commands/apk.rs`: Tauri command `install_and_launch_apk` orchestrates full pipeline:
  1. Get active device
  2. List installed packages (before)
  3. Install APK
  4. Detect package via diff (fallback)
  5. Launch app
  6. Save artifacts (logs + metadata)
- React: `features/preview/LivePreviewPanel.tsx` with Start/Stop buttons, APK drag-and-drop overlay, and scrcpy state display.

### scrcpy lifecycle design

scrcpy runs in its own window (native GUI app). Tezzy spawns it as a child process and tracks the handle. When stopped, Tezzy kills the child process. scrcpy does not require stdout/stderr streaming for Week 2 since it manages its own UI.

**Process management:**
- Single scrcpy instance at a time (enforced by storage mutex).
- Cleanup on stop command or app shutdown.
- Logs emitted to UI via event bus.

### APK install/launch pipeline

1. **Path validation**: APK must exist, be a file, and have `.apk` extension (case-insensitive).
2. **Before snapshot**: List installed third-party packages (`adb shell pm list packages -3`).
3. **Install**: Run `adb -s <serial> install -r <apk>`. Check stdout for "Success".
4. **Package detection**:
   - **Preferred (Week 3+)**: Parse APK manifest using `aapt2 dump badging` if available.
   - **Fallback (Week 2)**: Compare before/after package lists to detect new package.
   - **Limitation**: Fallback fails on reinstalls (no new package appears).
5. **Launch**: Run `adb shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1`. Check for "Events injected" in output.
6. **Artifacts**: Create `reports/tezzy-run-<timestamp>/` with `meta.json` (device, APK filename, package, timestamp) and `logs/adb_install.txt`, `logs/adb_launch.txt`.

### Package detection strategy

**aapt2 approach (not implemented in Week 2):**
- Most reliable: parses APK manifest to extract package name.
- Requires aapt2 to be installed and on PATH.
- Plan: Check for aapt2 availability, fallback to diff if unavailable.

**Diff fallback (Week 2 implementation):**
- Take snapshot of installed packages before install.
- After install, list packages again and find diff.
- **Pros**: No external dependencies beyond adb.
- **Cons**: 
  - Fails on reinstalls (package already exists).
  - Fails if multiple apps installed simultaneously.
  - Requires parseable `pm list packages` output.

### Security considerations and known limitations

**Security:**
- Executable allowlist extended to include `scrcpy` (Week 2).
- Device serial validation (alphanumeric + `_-.:`) prevents command injection.
- APK path validation prevents directory traversal and non-APK files.
- No shell invocation: all commands use direct `std::process::Command` with explicit arguments.
- Package name validation: must not contain path separators.

**Limitations:**
- **scrcpy availability**: User must install scrcpy separately and have it on PATH.
- **Package detection**: Fallback method fails on reinstalls and requires guessing. Future: add aapt2 support.
- **No streaming for scrcpy**: Stdout/stderr not captured since scrcpy manages its own window. Future: consider logging for debugging.
- **Run artifacts**: Stored locally only. No cloud sync or retention policy in Week 2.
- **APK size**: Large APKs (>500MB) may timeout if network is slow. Consider adding timeout configuration.

### Complexity and memory notes

**scrcpy:**
- Start/stop: O(1) process spawn/kill.
- Single child process tracked; no unbounded memory growth.

**APK operations:**
- Install: O(n) where n = APK size (adb transfer time). APK not loaded into Tezzy memory.
- Package list: O(m) where m = number of installed packages (typically <100 for third-party).
- Diff: O(m) comparison.
- Launch: O(1) monkey command.

**Artifacts:**
- Each run creates one folder with fixed number of files.
- Logs are written once (no streaming/accumulation).
- No automatic cleanup; user must manage `reports/` folder.

---
## Week 4: UI Inspector + Auto Smoke Check

### Module responsibilities

- `drivers/uihierarchy.rs` (completed): Dumps the live accessibility tree from the connected device and parses it into a flat `Vec<UiElement>`.
  - **Primary path**: `adb -s <serial> shell uiautomator dump /dev/stdout` — no temp file written to device.
  - **Fallback path**: dump to `/sdcard/tezzy_ui.xml`, `adb pull` to system temp dir, read and delete.
  - **Parser**: custom O(n) state-machine traversal over raw XML bytes; no external parser crate required for the flat-list format. Filters out nodes with no useful info and disabled nodes.
  - `UiElement` fields: `class`, `class_full`, `text`, `content_desc`, `resource_id`, `clickable`, `enabled`, `scrollable`, `checkable`, `checked`, `bounds`, `center_x`, `center_y`, `depth`.

- `commands/explorer.rs`: Tauri commands bridging frontend to `uihierarchy.rs`.
  - `get_ui_hierarchy` → `dump_hierarchy()` against active device.
  - `get_device_screen_size` → `get_screen_size()` via `adb shell wm size`.

- `explorer/policies.rs`: Heuristic candidate selection for the smoke check.
  - `select_candidate(elements, seen_ids)`: Three-pass O(n) algorithm:
    1. Prefer clickable nodes whose label matches a hard-coded priority keyword set (e.g. "OK", "Allow", "Next").
    2. Else: first clickable node with non-empty text/desc not yet seen.
    3. Else: first clickable node not yet seen.
  - `elem_key(el)`: Produces a stable deduplication key (`resource-id::bounds`) for each element.

- `explorer/scoring.rs`: Screen-state hashing for dead-tap and loop detection.
  - `screen_hash(elements)`: SHA-256 over concatenated class + text + resource_id + bounds per element (NUL-delimited). O(n), streaming — no buffering of element data.

- `explorer/agent_loop.rs`: Auto smoke check orchestration.
  - `run_smoke_check(app, max_steps, per_step_delay_ms, screenshots_dir, run_id)`:
    1. Pre-flight: get active device + session from `storage`.
    2. Clear `SMOKE_STOP_REQUESTED` flag.
    3. Per step (up to `max_steps`, default 20, max 50):
       - Check stop flag → emit `stopped` and break.
       - Dump UI hierarchy via `uihierarchy::dump_hierarchy`. Failure → record `crash`, break.
       - Compute `screen_hash`. Hash seen ≥ 3 times → record `loop`, break.
       - `select_candidate` → no candidate → record `no_elements`, break.
       - Mark candidate key in `seen_ids`.
       - Tap center coords via `appium_client::tap_xy`. Failure → record `crash`, break.
       - Sleep `per_step_delay_ms` (clamped to ≥ 500 ms).
       - Take screenshot via `appium_client::screenshot`.
       - Re-dump UI and compare hash → unchanged → record `dead_tap` finding.
       - Emit `tezzy:run_progress` event.
    4. Write markdown report via `reporting::markdown::write_smoke_report`.
    5. Return `SmokeCheckResult`.
  - **Crash detection heuristic**: `dump_hierarchy` failure after a tap (UIAutomator can't contact the app) OR Appium `tap_xy` returning a session error both indicate a possible crash. No logcat parsing required.

- `reporting/markdown.rs`: Generates markdown from `SmokeCheckResult`.
  - Tables: header metadata, findings bullet list with severity icons, per-step table with action / result / screenshot link.
  - Output: `smoke_report.md` in the run's screenshot subfolder.

- `reporting/artifacts.rs`: Path helper (`smoke_run_folder`).

- `commands/reports.rs`: Tauri commands for smoke check.
  - `run_smoke_check_cmd(max_steps?, per_step_delay_ms?)` → async, returns `SmokeCheckResult`.
  - `stop_smoke_check_cmd()` → sync, sets `SMOKE_STOP_REQUESTED` flag.

- `core/storage.rs` (extended): Smoke-stop atomic flag.
  - `SMOKE_STOP_REQUESTED: OnceLock<AtomicBool>` — efficient, no mutex needed for a boolean.
  - `request_smoke_stop()` / `clear_smoke_stop()` / `is_smoke_stop_requested()`.

- `core/events.rs` (extended): Added `RunProgressEvent` and `emit_run_progress()`.
  - Fields: `step`, `total`, `action`, `status`, `screenshot`.
  - Event name: `tezzy:run_progress`.

- React `features/explorer/InspectorPanel.tsx` (complete): UI element tree panel.
  - Calls `get_ui_hierarchy`, renders with indent reflecting element depth.
  - "Interactive" / "All" filter.
  - Per-element "Tap" button → calls `action_tap(center_x, center_y)`.

- React `features/sessions/SmokeCheckPanel.tsx` (new): Smoke check runner UI.
  - Config controls: steps (1–50), per-step delay (0.5–3 s).
  - "Run" / "Stop" buttons.
  - Progress bar driven by `tezzy:run_progress` events.
  - Step feed: scrollable list of each step's action and outcome icon.
  - Findings summary: severity-coloured bullets.
  - Report link: shows filename + "Open folder" button (Tauri `shell.open`).

### UI Inspector design

The inspector operates in a **pull model**: the user clicks "Dump UI" to request a fresh hierarchy snapshot. There is no live subscription to element changes (that would require polling the device, which is expensive). After dumping, elements are rendered in a flat list with visual indentation to convey the tree structure.

The `InspectorPanel` is hosted in the right-panel "UI Inspector" tab. Tapping an element from the panel calls the same `action_tap` command used by manual action, ensuring consistent session handling.

### Smoke Check heuristics

The agent is deliberately simple and deterministic, requiring no LLM:

| Signal | Detection method |
|--------|-----------------|
| Dead tap | `screenHash` identical before and after tap |
| Loop | Same `screenHash` seen ≥ 3 times within one run |
| Crash | `dump_hierarchy` or `tap_xy` returns an error |
| Stuck / no elements | `select_candidate` returns `None` |

The priority keyword list in `explorer/policies.rs` is hard-coded to common Android permission and navigation strings. Adding new keywords only requires editing that const array.

### Complexity analysis (Week 4)

| Operation | Complexity | Notes |
|-----------|------------|-------|
| `dump_hierarchy` | O(n) XML parse | n = element count, typically < 500 |
| `screen_hash` | O(n) | SHA-256 streaming, O(1) memory |
| `select_candidate` | O(n) | Three passes, all O(n) |
| `run_smoke_check` | O(S × n) | S = max_steps (≤ 50); total ≤ 25 000 ops |
| Markdown report | O(S + F) | F = findings count |

Total worst-case per run: **50 × 500 = 25 000 string comparisons + 50 HTTP calls**. Negligible for interactive demo use.

### Security decisions (Week 4)

- **No shell invocation**: `uiautomator dump` is invoked via `ProcessRunner` (allowlisted `adb`). No new executables added in Week 4.
- **Fixed device paths**: The uiautomator dump path `/sdcard/tezzy_ui.xml` is a hard-coded string literal — no user input reaches the `adb pull` destination argument.
- **Screenshot paths**: Built entirely from `app_local_data_dir` + constant prefix + numeric timestamp. No user-supplied path components.
- **Report output**: Written to the same controlled directory. Path logged to UI but not traversable.
- **Stop flag**: `AtomicBool` — no lock, no starvation risk. The smoke loop checks it at the start of each step, so the maximum extra delay after stop is one full step duration.
- **Max steps cap**: Enforced server-side at 50. The frontend allows up to 50; the command clamps any value above that.