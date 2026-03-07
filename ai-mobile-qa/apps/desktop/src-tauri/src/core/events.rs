use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::drivers::adb::Device;

/// Log severity levels sent to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
	Info,
	Warn,
	Error,
	Debug,
}

/// Log payload emitted over the Tauri event bus.
#[derive(Debug, Clone, Serialize)]
pub struct LogEvent {
	pub level: LogLevel,
	pub message: String,
	pub ts: u64,
}

/// Device state payload emitted after device refresh/selection.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceStateEvent {
	pub active_serial: Option<String>,
	pub devices: Vec<Device>,
}

/// scrcpy state payload emitted when preview starts/stops.
#[derive(Debug, Clone, Serialize)]
pub struct ScrcpyStateEvent {
	pub status: String, // "running" | "stopped" | "error"
	pub message: Option<String>,
	pub device_serial: Option<String>,
}

/// Appium server state payload.
#[derive(Debug, Clone, Serialize)]
pub struct AppiumStateEvent {
	pub status: String, // "not_installed" | "installing" | "ready" | "starting" | "running" | "stopped" | "error"
	pub message: Option<String>,
	pub port: Option<u16>,
}

/// Appium session state payload.
#[derive(Debug, Clone, Serialize)]
pub struct SessionStateEvent {
	pub status: String, // "none" | "creating" | "active" | "error"
	pub session_id: Option<String>,
	pub device_serial: Option<String>,
	pub message: Option<String>,
}

/// Screenshot taken payload.
#[derive(Debug, Clone, Serialize)]
pub struct ScreenshotTakenEvent {
	pub path: String,   // absolute file path
	pub ts: u64,
}

/// Smoke check / auto-explore progress event.
/// Emitted once per step and once at completion.
#[derive(Debug, Clone, Serialize)]
pub struct RunProgressEvent {
	/// Current step index (1-based).
	pub step: u32,
	/// Total steps configured for this run.
	pub total: u32,
	/// Human-readable description of the step action, e.g. "tap:OK" or "dead_tap".
	pub action: String,
	/// One of: "running" | "warn" | "error" | "done" | "stopped"
	pub status: String,
	/// Optional path to the screenshot taken at this step.
	pub screenshot: Option<String>,
}

const LOG_EVENT: &str = "tezzy:log";
const DEVICE_STATE_EVENT: &str = "tezzy:device_state";
const SCRCPY_STATE_EVENT: &str = "tezzy:scrcpy_state";
const APPIUM_STATE_EVENT: &str = "tezzy:appium_state";
const SESSION_STATE_EVENT: &str = "tezzy:session_state";
const SCREENSHOT_TAKEN_EVENT: &str = "tezzy:screenshot_taken";
const RUN_PROGRESS_EVENT: &str = "tezzy:run_progress";
const MAX_LOG_LEN: usize = 4096;

fn now_millis() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_millis() as u64)
		.unwrap_or(0)
}

fn truncate_log(message: &str) -> String {
	if message.len() <= MAX_LOG_LEN {
		return message.to_string();
	}

	let mut truncated = message[..MAX_LOG_LEN].to_string();
	truncated.push_str("...");
	truncated
}

/// Emit a bounded log line for UI consumption.
pub fn emit_log(app: &AppHandle, level: LogLevel, message: impl AsRef<str>) -> Result<(), String> {
	let payload = LogEvent {
		level,
		message: truncate_log(message.as_ref()),
		ts: now_millis(),
	};

	app.emit_all(LOG_EVENT, payload)
		.map_err(|err| format!("Failed to emit log: {err}"))
}

/// Emit the active device plus the latest known device list.
pub fn emit_device_state(
	app: &AppHandle,
	active_serial: Option<String>,
	devices: Vec<Device>,
) -> Result<(), String> {
	let payload = DeviceStateEvent {
		active_serial,
		devices,
	};

	app.emit_all(DEVICE_STATE_EVENT, payload)
		.map_err(|err| format!("Failed to emit device state: {err}"))
}

/// Emit scrcpy preview state change.
pub fn emit_scrcpy_state(
	app: &AppHandle,
	status: &str,
	message: Option<String>,
	device_serial: Option<String>,
) -> Result<(), String> {
	let payload = ScrcpyStateEvent {
		status: status.to_string(),
		message,
		device_serial,
	};

	app.emit_all(SCRCPY_STATE_EVENT, payload)
		.map_err(|err| format!("Failed to emit scrcpy state: {err}"))
}

/// Emit Appium server state change.
pub fn emit_appium_state(
	app: &AppHandle,
	status: &str,
	message: Option<String>,
	port: Option<u16>,
) -> Result<(), String> {
	let payload = AppiumStateEvent {
		status: status.to_string(),
		message,
		port,
	};

	app.emit_all(APPIUM_STATE_EVENT, payload)
		.map_err(|err| format!("Failed to emit appium state: {err}"))
}

/// Emit Appium session state change.
pub fn emit_session_state(
	app: &AppHandle,
	status: &str,
	session_id: Option<String>,
	device_serial: Option<String>,
	message: Option<String>,
) -> Result<(), String> {
	let payload = SessionStateEvent {
		status: status.to_string(),
		session_id,
		device_serial,
		message,
	};

	app.emit_all(SESSION_STATE_EVENT, payload)
		.map_err(|err| format!("Failed to emit session state: {err}"))
}

/// Emit screenshot taken — notifies UI of a new screenshot file path.
pub fn emit_screenshot_taken(app: &AppHandle, path: &str) -> Result<(), String> {
	let payload = ScreenshotTakenEvent {
		path: path.to_string(),
		ts: now_millis(),
	};
	app.emit_all(SCREENSHOT_TAKEN_EVENT, payload)
		.map_err(|err| format!("Failed to emit screenshot_taken: {err}"))
}

/// Emit a smoke-check / auto-explore step progress event.
///
/// **What**: Broadcasts `tezzy:run_progress` with step index, total steps,
/// action description, status, and optional screenshot path.
/// **Security**: `action` and `status` are produced internally — no user input.
/// **Complexity**: O(1).
pub fn emit_run_progress(
	app: &AppHandle,
	step: u32,
	total: u32,
	action: &str,
	status: &str,
	screenshot: Option<String>,
) -> Result<(), String> {
	let payload = RunProgressEvent {
		step,
		total,
		action: action.to_string(),
		status: status.to_string(),
		screenshot,
	};
	app.emit_all(RUN_PROGRESS_EVENT, payload)
		.map_err(|err| format!("Failed to emit run_progress: {err}"))
}
