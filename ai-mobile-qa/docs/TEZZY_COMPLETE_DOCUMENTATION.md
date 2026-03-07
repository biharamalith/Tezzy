# Tezzy - Complete Technical Documentation

> **Enterprise-grade QA, powered by AI automation**

This document provides comprehensive documentation for the Tezzy application, covering architecture, file-by-file explanations, technology stack, security measures, and troubleshooting guides.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Architecture Overview](#architecture-overview)
5. [File-by-File Documentation](#file-by-file-documentation)
   - [Rust Backend (Tauri)](#rust-backend-tauri)
   - [React Frontend](#react-frontend)
   - [AI Engine (Python)](#ai-engine-python)
   - [Shared Schemas](#shared-schemas)
6. [Security Measures](#security-measures)
7. [Data Flow](#data-flow)
8. [Installation & Setup](#installation--setup)
9. [Troubleshooting Guide](#troubleshooting-guide)
10. [Future Roadmap](#future-roadmap)

---

## Project Overview

**Tezzy** is an AI-powered mobile QA automation tool built as a desktop application. It provides:

- **Device Management**: Connect and manage Android devices via ADB
- **Live Preview**: Mirror device screens using scrcpy
- **APK Installation**: Drag-and-drop APK install with automatic app launch
- **Run Artifacts**: Automatic logging and metadata storage for each test run
- **Real-time Logging**: System log panel showing all operations

### What Was Built (2-Week Development Summary)

#### Week 1: Foundation
- Process runner with executable allowlist
- ADB integration (device listing, version check)
- Event system for UI communication
- Device selector component
- Terminal log panel with bounded memory

#### Week 2: Preview & Install
- scrcpy integration for device mirroring
- APK installation pipeline with package detection
- Run artifacts storage system
- Live preview panel with drag-and-drop
- Full frontend integration

---

## Technology Stack

### Desktop App (Frontend)

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 18.2.0 | UI framework |
| **TypeScript** | 5.3.3 | Type safety |
| **Vite** | 5.0.10 | Build tool & dev server |
| **Tauri API** | 1.6.0 | Rust-JS bridge |

### Desktop App (Backend)

| Technology | Version | Purpose |
|------------|---------|---------|
| **Rust** | 2021 Edition | System programming |
| **Tauri** | 1.5 | Desktop app framework |
| **Serde** | 1.x | Serialization |
| **serde_json** | 1.x | JSON handling |

### External Dependencies

| Tool | Purpose | Installation |
|------|---------|--------------|
| **ADB** | Android Debug Bridge | Android SDK Platform Tools |
| **scrcpy** | Device screen mirroring | `choco install scrcpy` or manual |

### AI Engine (Planned)

| Technology | Purpose |
|------------|---------|
| **Python** | AI model integration |
| **FastAPI** | REST API server |
| **LangChain** | LLM orchestration |

---

## Project Structure

```
ai-mobile-qa/
├── apps/
│   ├── ai-engine/                    # Python AI backend (planned)
│   │   ├── app/
│   │   │   ├── main.py               # FastAPI entry point
│   │   │   ├── agents/               # AI agents
│   │   │   │   ├── planner.py        # Test planning agent
│   │   │   │   ├── critic.py         # Test evaluation agent
│   │   │   │   └── memory.py         # Agent memory system
│   │   │   ├── api/
│   │   │   │   └── v1.py             # API routes
│   │   │   ├── llm/
│   │   │   │   ├── client.py         # LLM client wrapper
│   │   │   │   └── json_mode.py      # JSON output handling
│   │   │   ├── prompts/              # System prompts
│   │   │   └── schemas/              # Pydantic schemas
│   │   └── requirements.txt
│   │
│   └── desktop/                      # Tauri desktop app
│       ├── src/                      # React frontend
│       │   ├── main.tsx              # React entry point
│       │   ├── app/
│       │   │   └── layout.tsx        # Main layout component
│       │   ├── features/
│       │   │   ├── devices/
│       │   │   │   └── DeviceSelector.tsx
│       │   │   ├── logs/
│       │   │   │   └── TerminalLogPanel.tsx
│       │   │   └── preview/
│       │   │       └── LivePreviewPanel.tsx
│       │   └── lib/
│       │       └── tauri.ts          # Tauri invoke wrappers
│       ├── src-tauri/                # Rust backend
│       │   ├── src/
│       │   │   ├── main.rs           # Tauri entry point
│       │   │   ├── core/             # Core utilities
│       │   │   │   ├── mod.rs
│       │   │   │   ├── process.rs    # Safe process runner
│       │   │   │   ├── events.rs     # Event emitters
│       │   │   │   ├── storage.rs    # State & file storage
│       │   │   │   └── config.rs     # Configuration
│       │   │   ├── drivers/          # External tool drivers
│       │   │   │   ├── mod.rs
│       │   │   │   ├── adb.rs        # ADB integration
│       │   │   │   ├── apk.rs        # APK operations
│       │   │   │   └── scrcpy.rs     # scrcpy management
│       │   │   └── commands/         # Tauri commands
│       │   │       ├── mod.rs
│       │   │       ├── devices.rs    # Device commands
│       │   │       ├── apk.rs        # APK commands
│       │   │       └── scrcpy.rs     # scrcpy commands
│       │   ├── icons/                # App icons
│       │   ├── Cargo.toml            # Rust dependencies
│       │   └── tauri.conf.json       # Tauri configuration
│       ├── package.json
│       └── vite.config.ts
│
├── docs/                             # Documentation
│   ├── architecture.md               # Architecture details
│   └── prompt-contracts.md           # AI prompt contracts
│
├── packages/
│   └── shared-schemas/               # JSON schemas
│       ├── action.schema.json        # Action definitions
│       ├── run.schema.json           # Run metadata
│       └── ui.schema.json            # UI element schema
│
├── reports/                          # Generated test reports
│   └── tezzy-run-<timestamp>/        # Per-run artifacts
│       ├── meta.json
│       └── logs/
│
└── tools/
    └── fixtures/                     # Test fixtures
        ├── adb_devices_basic.txt
        └── adb_devices_missing_fields.txt
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        TEZZY DESKTOP APP                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   REACT FRONTEND                        │   │
│  │  ┌───────────────┬─────────────────┬────────────────┐  │   │
│  │  │ DeviceSelector│ LivePreviewPanel│ TerminalLogPanel│  │   │
│  │  └───────────────┴─────────────────┴────────────────┘  │   │
│  │                         │                               │   │
│  │                   ┌─────▼─────┐                         │   │
│  │                   │ tauri.ts  │ (Invoke wrappers)       │   │
│  │                   └─────┬─────┘                         │   │
│  └─────────────────────────┼───────────────────────────────┘   │
│                            │ Tauri IPC                          │
│  ┌─────────────────────────▼───────────────────────────────┐   │
│  │                   RUST BACKEND                          │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │                  COMMANDS                        │   │   │
│  │  │  ┌──────────┬──────────┬──────────┐            │   │   │
│  │  │  │ devices  │  scrcpy  │   apk    │            │   │   │
│  │  │  └────┬─────┴────┬─────┴────┬─────┘            │   │   │
│  │  └───────┼──────────┼──────────┼──────────────────┘   │   │
│  │          │          │          │                       │   │
│  │  ┌───────▼──────────▼──────────▼──────────────────┐   │   │
│  │  │                  DRIVERS                        │   │   │
│  │  │  ┌──────────┬──────────┬──────────┐            │   │   │
│  │  │  │  adb.rs  │scrcpy.rs │  apk.rs  │            │   │   │
│  │  │  └────┬─────┴────┬─────┴────┬─────┘            │   │   │
│  │  └───────┼──────────┼──────────┼──────────────────┘   │   │
│  │          │          │          │                       │   │
│  │  ┌───────▼──────────▼──────────▼──────────────────┐   │   │
│  │  │                   CORE                          │   │   │
│  │  │  ┌──────────┬──────────┬──────────┐            │   │   │
│  │  │  │process.rs│ events.rs│storage.rs│            │   │   │
│  │  │  └──────────┴──────────┴──────────┘            │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
└────────────────────────────┼────────────────────────────────────┘
                             │ Process spawn
              ┌──────────────▼──────────────┐
              │    EXTERNAL PROCESSES       │
              │  ┌────────┐  ┌────────┐     │
              │  │  ADB   │  │ scrcpy │     │
              │  └────────┘  └────────┘     │
              └─────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │     ANDROID DEVICE          │
              └─────────────────────────────┘
```

---

## File-by-File Documentation

### Rust Backend (Tauri)

#### `src-tauri/src/main.rs`
**Entry point for the Tauri application.**

```rust
// Key responsibilities:
// 1. Registers all Tauri commands
// 2. Starts the Tauri application
// 3. Configures window subsystem (hides console on Windows release builds)

// Commands registered:
// - env_check         → Check ADB availability
// - list_devices      → List connected devices
// - set_active_device → Select active device
// - start_scrcpy_preview → Start device mirroring
// - stop_scrcpy_preview  → Stop device mirroring
// - get_scrcpy_preview_status → Get mirror status
// - install_and_launch_apk → Install and launch APK
```

**When to modify:**
- Adding new Tauri commands (register in `generate_handler![]`)
- Changing app startup behavior

---

#### `src-tauri/src/core/process.rs`
**Secure process execution with allowlist enforcement.**

```rust
// Key components:
// - ProcessRunner: Main struct for running commands
// - CapturedOutput: Holds stdout, stderr, exit code
// - ProcessHandle: Handle to spawned processes

// Security features:
// - Executable allowlist (only "adb" and "scrcpy" allowed)
// - No shell invocation
// - Path traversal prevention (bare names only)
// - Log truncation (max 4096 chars per line)

// Methods:
// - run_capture()     → Run short command, capture output
// - spawn_streaming() → Run long process, stream output
```

**When to modify:**
- Adding new allowed executables (update `allowlist.insert()`)
- Changing output truncation limits
- Adding new process execution patterns

**Potential bugs:**
- Timeout issues: Commands may hang without timeout
- Fix: Add timeout parameter to `run_capture()`

---

#### `src-tauri/src/core/events.rs`
**Event system for Rust→JS communication.**

```rust
// Event types:
// - tezzy:log         → Log messages with level/timestamp
// - tezzy:device_state → Device list + active serial
// - tezzy:scrcpy_state → scrcpy status updates

// Payload structs:
// - LogEvent: { level, message, ts }
// - DeviceStateEvent: { active_serial, devices }
// - ScrcpyStateEvent: { status, message, device_serial }

// Helper functions:
// - emit_log()          → Send log to UI
// - emit_device_state() → Send device update
// - emit_scrcpy_state() → Send scrcpy status
```

**When to modify:**
- Adding new event types
- Changing payload structures
- Modifying log truncation

**Potential bugs:**
- Event not reaching UI: Check listener is registered before emit

---

#### `src-tauri/src/core/storage.rs`
**In-memory state and file artifact storage.**

```rust
// In-memory storage:
// - ACTIVE_DEVICE: Currently selected device serial

// File storage:
// - RunContext: Holds run ID and path
// - RunMetadata: Metadata written to meta.json

// Functions:
// - get_active_device()   → Read active device
// - set_active_device()   → Update active device
// - create_run_folder()   → Create reports/tezzy-run-<ts>/
// - write_run_log()       → Write to run logs/ folder
```

**When to modify:**
- Adding new in-memory state
- Changing artifact folder structure
- Adding new metadata fields

**Potential bugs:**
- Mutex deadlock: Storage lock held too long
- Fix: Keep lock scope minimal

---

#### `src-tauri/src/drivers/adb.rs`
**Android Debug Bridge integration.**

```rust
// Types:
// - Device: { serial, state, model, product, transport_id }

// Functions:
// - is_valid_serial()  → Validate serial format (alphanumeric + _-.:)
// - adb_version()      → Get ADB version string
// - list_devices()     → Get connected devices
// - parse_devices()    → Parse "adb devices -l" output

// Tests:
// - Tests using fixtures in tools/fixtures/
```

**When to modify:**
- Adding new ADB commands
- Changing serial validation rules
- Supporting new device properties

**Potential bugs:**
- Parse failure: Unexpected ADB output format
- Fix: Check fixture tests match actual output

---

#### `src-tauri/src/drivers/scrcpy.rs`
**scrcpy process lifecycle management.**

```rust
// Types:
// - ScrcpyOptions: { serial, bitrate, max_size }
// - ScrcpyStatus: { running, device_serial }

// State:
// - SCRCPY_CHILD: Static storage for child process handle

// Functions:
// - start_scrcpy() → Spawn scrcpy with options
// - stop_scrcpy()  → Kill scrcpy process
// - is_scrcpy_running() → Check if active
// - get_scrcpy_status() → Get status for UI

// scrcpy lookup paths:
// 1. C:\scrcpy-win64-v2.7\scrcpy.exe
// 2. C:\scrcpy\scrcpy.exe
// 3. PATH (fallback)
```

**When to modify:**
- Adding scrcpy options (recording, crop, etc.)
- Changing lookup paths
- Adding macOS/Linux support

**Potential bugs:**
- scrcpy not found: Check installation paths
- Process leak: Ensure stop_scrcpy() is called on app exit

---

#### `src-tauri/src/drivers/apk.rs`
**APK installation and app launching.**

```rust
// Types:
// - InstallResult: { success, message, package_name, stdout, stderr }

// Functions:
// - validate_apk_path()           → Check file exists, is .apk
// - install_apk()                 → Run "adb install -r"
// - list_installed_packages()     → Get third-party packages
// - detect_package_name_fallback()→ Before/after diff method
// - launch_package()              → Start app with monkey

// Package detection limitation:
// - Fails on reinstalls (no new package detected)
// - Future: Add aapt2 integration for reliable detection
```

**When to modify:**
- Adding aapt2 package detection
- Supporting installation options (-t, -g, etc.)
- Adding uninstall functionality

**Potential bugs:**
- Install timeout: Large APKs may timeout
- Fix: Add configurable timeout

---

#### `src-tauri/src/commands/devices.rs`
**Tauri commands for device management.**

```rust
// Commands:
// - env_check       → Check ADB availability
// - list_devices    → Refresh and return device list
// - set_active_device → Set active device after validation

// All commands emit events to UI via event bus
```

**When to modify:**
- Adding device-related commands
- Changing device state management

---

#### `src-tauri/src/commands/scrcpy.rs`
**Tauri commands for scrcpy preview.**

```rust
// Commands:
// - start_scrcpy_preview → Start for active device
// - stop_scrcpy_preview  → Stop active session
// - get_scrcpy_preview_status → Get current status

// Default options:
// - bitrate: 8Mbps
// - max_size: 1080px
```

**When to modify:**
- Adding preview options (quality settings)
- Supporting multiple simultaneous previews

---

#### `src-tauri/src/commands/apk.rs`
**Tauri commands for APK operations.**

```rust
// Commands:
// - install_and_launch_apk → Full install/detect/launch pipeline

// Pipeline steps:
// 1. Get active device
// 2. List packages (before)
// 3. Install APK
// 4. Detect package (diff)
// 5. Launch app
// 6. Save artifacts
```

**When to modify:**
- Adding APK analysis
- Supporting batch installs
- Adding pre-install validation

---

### React Frontend

#### `src/main.tsx`
**React application entry point.**

Renders the root Layout component into the DOM.

---

#### `src/app/layout.tsx`
**Main application layout with three-panel design.**

```tsx
// Structure:
// - Header: App title, ADB status, active device
// - Left panel: DeviceSelector
// - Center panel: LivePreviewPanel
// - Right panel: TerminalLogPanel

// State:
// - devices: Array of connected devices
// - activeSerial: Currently selected device
// - adbStatus: ADB availability status
// - adbAvailable: Boolean flag

// Event listeners:
// - Listens to tezzy:device_state for updates
```

**When to modify:**
- Adding new panels
- Changing layout structure
- Adding header items

---

#### `src/features/devices/DeviceSelector.tsx`
**Device selection dropdown component.**

```tsx
// Props:
// - devices: Device[]
// - activeSerial: string | null
// - onRefresh: () => void
// - onSelect: (serial: string) => void

// Features:
// - Refresh button to rescan devices
// - Dropdown showing serial + state
// - Device count display
```

**When to modify:**
- Adding device details display
- Supporting device filtering
- Adding device actions menu

---

#### `src/features/preview/LivePreviewPanel.tsx`
**Live device preview with APK drag-and-drop.**

```tsx
// State:
// - scrcpyRunning: Boolean
// - scrcpyMessage: Status message
// - isDragging: Drag overlay state
// - installing: APK install in progress

// Event listeners:
// - Listens to tezzy:scrcpy_state

// Features:
// - Start/Stop preview buttons
// - Drag-and-drop APK files
// - Status indicator
// - Install progress feedback
```

**When to modify:**
- Adding embedded preview (vs external window)
- Supporting multiple file drops
- Adding preview options UI

---

#### `src/features/logs/TerminalLogPanel.tsx`
**System log display with bounded memory.**

```tsx
// Constants:
// - MAX_LINES: 2000 (memory bound)

// Features:
// - Real-time log streaming
// - Color-coded log levels (info/warn/error)
// - Timestamp display
// - Auto-scroll to newest

// Event listeners:
// - Listens to tezzy:log
```

**When to modify:**
- Adding log filtering
- Supporting log export
- Adding search functionality

---

#### `src/lib/tauri.ts`
**Type-safe Tauri IPC wrappers.**

```typescript
// Types exported:
// - LogLevel, LogEvent
// - Device, DeviceStateEvent, DeviceState
// - EnvStatus
// - ScrcpyStateEvent, ScrcpyStatus
// - InstallResult

// Invoke functions:
// - invokeEnvCheck()
// - invokeListDevices()
// - invokeSetActiveDevice()
// - invokeStartScrcpy()
// - invokeStopScrcpy()
// - invokeGetScrcpyStatus()
// - invokeInstallAndLaunchApk()

// Listen functions:
// - listenLog()
// - listenDeviceState()
// - listenScrcpyState()
```

**When to modify:**
- Adding new Tauri commands
- Updating type definitions
- Adding new event listeners

---

### AI Engine (Python)

> **Note:** These files are placeholders for future implementation.

#### `app/main.py`
FastAPI application entry point. Will expose REST endpoints for AI operations.

#### `app/agents/planner.py`
Test planning agent. Will generate test sequences from UI analysis.

#### `app/agents/critic.py`
Test evaluation agent. Will assess test results and suggest improvements.

#### `app/agents/memory.py`
Agent memory system. Will store and retrieve context across sessions.

---

### Shared Schemas

#### `packages/shared-schemas/action.schema.json`
JSON schema for test actions (tap, swipe, input, assert).

#### `packages/shared-schemas/ui.schema.json`
JSON schema for UI element representation.

#### `packages/shared-schemas/run.schema.json`
JSON schema for test run metadata.

---

## Security Measures

### 1. Executable Allowlist

**Location:** `src-tauri/src/core/process.rs`

```rust
allowlist.insert("adb".to_string());
allowlist.insert("scrcpy".to_string());
```

**Protection:** Only whitelisted executables can be spawned. Prevents arbitrary command execution.

---

### 2. No Shell Invocation

**Implementation:** All commands use `std::process::Command` with explicit arguments.

```rust
Command::new("adb")
    .args(["-s", serial, "install", "-r", apk_path])
    .spawn()
```

**Protection:** Prevents shell injection attacks. No `cmd /c` or `sh -c` usage.

---

### 3. Device Serial Validation

**Location:** `src-tauri/src/drivers/adb.rs`

```rust
pub fn is_valid_serial(serial: &str) -> bool {
    !serial.is_empty()
        && serial.chars().all(|ch| 
            ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':')
        )
}
```

**Protection:** Prevents command injection via malicious serial strings.

---

### 4. APK Path Validation

**Location:** `src-tauri/src/drivers/apk.rs`

```rust
fn validate_apk_path(apk_path: &str) -> Result<(), String> {
    let path = Path::new(apk_path);
    if !path.exists() { return Err(...); }
    if !path.is_file() { return Err(...); }
    if extension != "apk" { return Err(...); }
}
```

**Protection:** Prevents directory traversal and non-APK file injection.

---

### 5. Package Name Validation

**Location:** `src-tauri/src/drivers/apk.rs`

```rust
if package.contains('/') || package.contains('\\') {
    return Err("Invalid package name");
}
```

**Protection:** Prevents path injection in package names.

---

### 6. Log Truncation

**Location:** `src-tauri/src/core/events.rs`

```rust
const MAX_LOG_LEN: usize = 4096;
```

**Protection:** Prevents unbounded memory growth from large outputs.

---

### 7. Frontend Memory Bounds

**Location:** `src/features/logs/TerminalLogPanel.tsx`

```typescript
const MAX_LINES = 2000;
```

**Protection:** Prevents UI memory exhaustion from log accumulation.

---

## Data Flow

### Device Selection Flow

```
User clicks "Refresh"
    ↓
Layout.refreshDevices()
    ↓
invokeListDevices() [JS]
    ↓
list_devices command [Rust]
    ↓
adb::list_devices()
    ↓
ProcessRunner.run_capture("adb", ["devices", "-l"])
    ↓
Parse output → Vec<Device>
    ↓
emit_device_state() [Event]
    ↓
listenDeviceState callback [JS]
    ↓
setDevices() → UI updates
```

### APK Install Flow

```
User drops .apk file
    ↓
LivePreviewPanel.handleDrop()
    ↓
invokeInstallAndLaunchApk(path) [JS]
    ↓
install_and_launch_apk command [Rust]
    ↓
1. get_active_device()
2. list_installed_packages()
3. install_apk() → "adb install -r"
4. detect_package_name_fallback() → before/after diff
5. launch_package() → "adb shell monkey"
6. create_run_folder() → reports/tezzy-run-<ts>/
7. write_run_log()
    ↓
InstallResult returned
    ↓
setScrcpyMessage() → UI feedback
```

---

## Installation & Setup

### Prerequisites

1. **Node.js** (v18+)
2. **Rust** (stable, 2021 edition)
3. **Android SDK Platform Tools** (for ADB)
4. **scrcpy** (for device mirroring)

### Install scrcpy

**Windows (Chocolatey):**
```powershell
choco install scrcpy
```

**Windows (Manual):**
1. Download from https://github.com/Genymobile/scrcpy/releases
2. Extract to `C:\scrcpy-win64-v2.7\` or `C:\scrcpy\`
3. Or add to PATH

**Verify:**
```powershell
scrcpy --version
```

### Build & Run

```powershell
# Navigate to desktop app
cd apps/desktop

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

### Connect Android Device

1. Enable **Developer Options** on device
2. Enable **USB Debugging**
3. Connect via USB
4. Accept debugging prompt on device
5. Click "Refresh devices" in Tezzy

---

## Troubleshooting Guide

### Issue: "adb missing" in UI

**Cause:** ADB not installed or not in PATH.

**Fix:**
1. Install Android SDK Platform Tools
2. Add to PATH: `C:\Android\platform-tools`
3. Verify: `adb version`

---

### Issue: "No devices detected"

**Cause:** Device not connected or USB debugging disabled.

**Fix:**
1. Enable USB Debugging on device
2. Use proper USB cable (data-capable)
3. Accept USB debugging prompt
4. Try: `adb devices` in terminal
5. Click "Refresh devices"

---

### Issue: scrcpy fails to start

**Cause:** scrcpy not installed or wrong path.

**Fix:**
1. Install scrcpy
2. Ensure at one of these paths:
   - `C:\scrcpy-win64-v2.7\scrcpy.exe`
   - `C:\scrcpy\scrcpy.exe`
   - On PATH
3. Verify: `scrcpy --version`

**Log location:** Check System Log panel for error details.

---

### Issue: APK install fails

**Cause:** Various (signature mismatch, space, permissions).

**Fix:**
1. Check System Log for specific error
2. Common errors:
   - `INSTALL_FAILED_ALREADY_EXISTS` → App already installed with different signature
   - `INSTALL_FAILED_INSUFFICIENT_STORAGE` → Free up device space
   - `INSTALL_FAILED_VERIFICATION_FAILURE` → Disable Play Protect temporarily

---

### Issue: Package name not detected

**Cause:** Using `-r` flag on reinstall (no new package appears).

**Fix:**
1. This is a known limitation
2. App will still install and run, just won't show package name
3. Future: aapt2 integration will fix this

---

### Issue: scrcpy window opens but freezes

**Cause:** USB bandwidth or device compatibility.

**Fix:**
1. Try lower bitrate: modify `ScrcpyOptions.bitrate` in `scrcpy.rs`
2. Try lower resolution: modify `max_size`
3. Use USB 3.0 port

---

### Issue: Logs not appearing

**Cause:** Event listener not registered.

**Fix:**
1. Ensure `listenLog()` is called in `useEffect`
2. Check for errors in browser console
3. Verify Rust `emit_log()` is being called

---

### Issue: Build errors after code changes

**Where to check:**
1. **Rust errors:** `cargo check` in `src-tauri/`
2. **TypeScript errors:** Check VS Code Problems panel
3. **Runtime errors:** Browser DevTools console

---

## Future Roadmap

### Week 3+

- [ ] **aapt2 Integration** - Reliable package name detection
- [ ] **Screenshot Capture** - Save screenshots to run artifacts
- [ ] **Appium Server Management** - Start/stop Appium
- [ ] **UI Element Inspector** - Visualize accessibility tree
- [ ] **Test Recording** - Record user interactions
- [ ] **Test Playback** - Replay recorded tests

### AI Features (Planned)

- [ ] **AI Exploration** - Autonomous app exploration
- [ ] **Bug Detection** - Automatic anomaly detection
- [ ] **Test Generation** - Generate test cases from exploration
- [ ] **Natural Language Commands** - "Test the login flow"
- [ ] **Visual Regression** - Screenshot comparison

### Platform Support

- [ ] **macOS Support** - Update scrcpy paths
- [ ] **Linux Support** - Update scrcpy paths
- [ ] **iOS Support** - WebDriverAgent integration

---

## Configuration Reference

### tauri.conf.json

```json
{
  "bundle": {
    "identifier": "com.tezzy.app",       // App identifier
    "icon": ["icons/Tezzy-Logo.ico"]     // App icon
  },
  "windows": [{
    "title": "Tezzy",                    // Window title
    "width": 1200,                       // Default width
    "height": 800,                       // Default height
    "resizable": true
  }]
}
```

### Cargo.toml

```toml
[dependencies]
tauri = { version = "1.5", features = ["api-all"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### package.json

```json
{
  "dependencies": {
    "@tauri-apps/api": "^1.6.0",
    "react": "^18.2.0"
  }
}
```

---

## Contact & Support

For bugs or questions about this codebase, refer to:

1. **This document** - File-by-file explanations and troubleshooting
2. **System Log panel** - Runtime errors and debug info
3. **reports/ folder** - Run artifacts and logs

---

*Document generated: February 2026*
*Tezzy v0.0.0*
