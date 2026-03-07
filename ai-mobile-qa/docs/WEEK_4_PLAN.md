# Tezzy — Week 4 Plan

## Status snapshot (carried over from Week 3)

| Feature | Status | Notes |
|---------|--------|-------|
| Appium server management (install / start / stop / health) | ✅ Complete | `drivers/appium_server.rs`, `commands/appium.rs` |
| Persistent Appium session | ✅ Complete | `core/storage.rs` `ACTIVE_SESSION` |
| Manual automation primitives (tap, back, swipe, input) | ✅ Complete | `drivers/appium_client.rs` |
| Screenshot capture (save to run artifacts) | ✅ Complete | `action_screenshot` command writes PNG to `reports/` |
| Session UI panel | ✅ Complete | `features/sessions/SessionPanel.tsx` |
| Layout integration | ✅ Complete | `SessionPanel` rendered below `LivePreviewPanel` |

---

## Week 4 objectives

### 1. aapt2 Integration — Reliable package name detection

**Goal**: Replace the fragile before/after package-list diff with deterministic APK manifest parsing.

**Why it matters**: The Week 2 fallback fails on reinstalls (package already exists in the list), fails if another app is installed concurrently, and requires correct `pm list packages` output. `aapt2` reads the APK binary directly and is authoritative.

**Planned implementation**:
- `drivers/apk.rs` — add `detect_package_name_aapt2(apk_path)`:
  1. Check `aapt2` availability via `env_check` command. If absent, fall back to Week 2 diff.
  2. Run `aapt2 dump badging <apk>`.
  3. Parse `package: name='<pkg>'` from output.
  4. Return `Ok(package_name)`.
- `commands/apk.rs` — update `install_and_launch_apk` to try aapt2 first.
- `lib/tauri.ts` — expose `aapt2Available: bool` on `EnvStatus` type.

**Security**: aapt2 added to executable allowlist. APK path validated before passing (existing check is sufficient).

**Test plan**: Fixture file `tools/fixtures/aapt2_badging_basic.txt` with known output; unit test `detect_package_name_aapt2` against fixture.

---

### 2. UI Element Inspector — Visualize accessibility tree

**Goal**: Fetch the live XML accessibility tree from the connected device and render it as a collapsible tree in the desktop UI, with tap-to-focus functionality.

**Why it matters**: Manual tap coordinates are brittle. Knowing element bounds and resource IDs allows users to identify and target elements reliably.

**Planned implementation**:

**Rust side**:
- `drivers/uihierarchy.rs` (already stubbed) — finalize:
  - `dump_ui_hierarchy(serial)`: Run `adb shell uiautomator dump /sdcard/ui.xml`, then `adb pull /sdcard/ui.xml`, parse XML.
  - Return `Vec<UiNode>` flattened from the XML tree.
  - `UiNode` fields: `class`, `resource_id`, `text`, `content_desc`, `bounds` (x1,y1,x2,y2), `clickable`, `depth`.
- `commands/explorer.rs` — add `get_ui_tree` command, returns `Vec<UiNode>` as JSON.

**React side**:
- `features/explorer/UiTreePanel.tsx`:
  - Collapsible tree rows (`<details>/<summary>` or recursive component).
  - Click on a node → pre-fill x/y inputs in `SessionPanel` with node center coordinates.
  - Highlight node bounds overlay on `LivePreviewPanel` (SVG rect overlay).
- `lib/tauri.ts` — add `UiNode` type and `invokeGetUiTree()`.

**Performance**: XML dump is O(element count). Elements typically < 500 on most screens. Parsed once per request.

---

### 3. Test Recording — Record user interactions

**Goal**: Let users perform manual actions (tap, swipe, input, back) while Tezzy records each action as a structured step. Save the recording to a JSON file in the run artifacts folder.

**Planned implementation**:

**Rust side**:
- `core/storage.rs` — add `RecordingState { steps: Vec<RecordedStep>, is_recording: bool }`.
- `RecordedStep` enum variants: `Tap { x, y }`, `Swipe { x1, y1, x2, y2, duration_ms }`, `Input { text }`, `Back`, `Screenshot { filename }`.
- Every `action_*` command checks `is_recording` flag; if true, appends a step.
- `commands/appium.rs` — add `start_recording` and `stop_recording` commands. `stop_recording` serializes steps to `reports/<run>/recording.json`.
- Recording JSON follows `packages/shared-schemas/run.schema.json` extension (add `steps` array field).

**React side**:
- `features/sessions/SessionPanel.tsx` — add **Record** / **Stop** toggle button at the top of Manual Actions section.
- Recording badge (red dot) visible while recording.

---

### 4. Test Playback — Replay recorded tests

**Goal**: Load a `recording.json` file and replay each step against a connected device with configurable inter-step delay.

**Planned implementation**:

**Rust side**:
- `commands/appium.rs` — add `play_recording(path, delay_ms)` command:
  1. Read and deserialize `recording.json`.
  2. Validate session is active.
  3. For each step: call corresponding `action_*` driver function, sleep `delay_ms`, emit progress event.
  4. Return pass/fail summary.
- Emit `tezzy:playback_progress { step_index, total_steps, status }` event per step.

**React side**:
- `features/reports/PlaybackPanel.tsx`:
  - File picker for `recording.json`.
  - Delay slider (100 ms – 5000 ms).
  - Play button triggers `invokePlayRecording()`.
  - Progress bar driven by `tezzy:playback_progress` events.
  - Pass/fail summary at end.
- `lib/tauri.ts` — add `PlaybackProgressEvent` type and `listenPlaybackProgress()`.

---

## Milestone checklist

```
Week 4 — Target completion
────────────────────────────────────────────────────
[ ] aapt2 availability check in env_check command
[ ] detect_package_name_aapt2() in drivers/apk.rs
[ ] aapt2 fixture + unit test
[ ] dump_ui_hierarchy() returning Vec<UiNode>
[ ] get_ui_tree Tauri command
[ ] UiTreePanel React component with tap-to-fill
[ ] SVG bounds overlay on LivePreviewPanel
[ ] RecordingState in storage
[ ] start_recording / stop_recording commands
[ ] Action commands append to recording when active
[ ] Recording JSON saved to run artifacts
[ ] Record/Stop UI in SessionPanel
[ ] play_recording Tauri command
[ ] PlaybackPanel React component with progress bar
[ ] WEEK_4_SUMMARY.md (created at end of week)
```

---

## Architecture notes for Week 4

### aapt2 executable allowlist entry
Add `"aapt2"` to `ALLOWED_EXECUTABLES` in `core/process.rs`. aapt2 is typically bundled with Android SDK Build Tools; document the expected PATH setup in `README.md`.

### UI hierarchy XML parsing
`uiautomator dump` produces `hierarchy` → `node*` XML. Use `quick-xml` (Rust crate) for streaming parse to avoid loading large hierarchies. Add `quick-xml = "0.31"` to `Cargo.toml`.

### Recording schema extension
Extend `packages/shared-schemas/run.schema.json` with:
```json
"steps": {
  "type": "array",
  "items": {
    "oneOf": [
      { "type": "object", "properties": { "type": { "const": "tap" }, "x": { "type": "number" }, "y": { "type": "number" } }, "required": ["type","x","y"] },
      { "type": "object", "properties": { "type": { "const": "back" } }, "required": ["type"] },
      { "type": "object", "properties": { "type": { "const": "input" }, "text": { "type": "string" } }, "required": ["type","text"] },
      { "type": "object", "properties": { "type": { "const": "swipe" }, "x1": {}, "y1": {}, "x2": {}, "y2": {}, "duration_ms": {} }, "required": ["type","x1","y1","x2","y2"] }
    ]
  }
}
```

### Playback error handling
If a step fails (Appium returns non-2xx), emit error event, increment fail count, continue remaining steps (do not abort by default). Add `abort_on_failure: bool` parameter to `play_recording`.

---

## Dependencies to add in Week 4

| Crate | Version | Purpose |
|-------|---------|---------|
| `quick-xml` | `0.31` | Stream-parse `uiautomator` XML hierarchy |

No new npm packages required for Week 4 React features.
