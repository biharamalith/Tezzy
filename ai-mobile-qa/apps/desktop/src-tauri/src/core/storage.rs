use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

/// In-memory active device storage for Week 1.
static ACTIVE_DEVICE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

/// In-memory active Appium session storage for Week 3.
static ACTIVE_SESSION: OnceLock<Mutex<Option<ActiveSession>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub struct ActiveSession {
	pub session_id: String,
	pub device_serial: String,
	pub capabilities: serde_json::Value,
}

fn device_store() -> &'static Mutex<Option<String>> {
	ACTIVE_DEVICE.get_or_init(|| Mutex::new(None))
}

fn session_store() -> &'static Mutex<Option<ActiveSession>> {
	ACTIVE_SESSION.get_or_init(|| Mutex::new(None))
}

/// Reads the currently selected device, if any.
pub fn get_active_device() -> Option<String> {
	device_store()
		.lock()
		.ok()
		.and_then(|guard| guard.clone())
}

/// Updates the active device serial in memory.
pub fn set_active_device(serial: Option<String>) -> Result<(), String> {
	let mut guard = device_store()
		.lock()
		.map_err(|_| "Active device storage is unavailable".to_string())?;
	*guard = serial;
	Ok(())
}

/// Context for a test run, including unique ID and artifact folder.
#[derive(Debug, Clone, Serialize)]
pub struct RunContext {
	pub run_id: String,
	pub path: PathBuf,
}

/// Metadata written to meta.json in each run folder.
#[derive(Debug, Clone, Serialize)]
pub struct RunMetadata {
	pub run_id: String,
	pub timestamp: u64,
	pub device_serial: Option<String>,
	pub apk_filename: Option<String>,
	pub package_name: Option<String>,
}

fn now_millis() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_millis() as u64)
		.unwrap_or(0)
}

/// Creates a new run artifacts folder under reports/.
///
/// **What**: Creates reports/tezzy-run-<timestamp>/ with logs/ subfolder and meta.json.
/// **Security**: Uses controlled folder names (timestamp-based), no user input in paths.
/// **Complexity**: O(1) file system operations.
pub fn create_run_folder(
	prefix: &str,
	device_serial: Option<String>,
	apk_filename: Option<String>,
	package_name: Option<String>,
) -> Result<RunContext, String> {
	let timestamp = now_millis();
	let run_id = format!("{}-{}", prefix, timestamp);

	// Create reports/<run_id>/logs/
	let run_path = PathBuf::from("reports").join(&run_id);
	let logs_path = run_path.join("logs");

	fs::create_dir_all(&logs_path)
		.map_err(|err| format!("Failed to create run folder: {}", err))?;

	// Write meta.json
	let metadata = RunMetadata {
		run_id: run_id.clone(),
		timestamp,
		device_serial,
		apk_filename,
		package_name,
	};

	let meta_json = serde_json::to_string_pretty(&metadata)
		.map_err(|err| format!("Failed to serialize metadata: {}", err))?;

	let meta_path = run_path.join("meta.json");
	fs::write(&meta_path, meta_json)
		.map_err(|err| format!("Failed to write meta.json: {}", err))?;

	Ok(RunContext { run_id, path: run_path })
}

/// Writes a log file into the run's logs/ folder.
pub fn write_run_log(run_context: &RunContext, filename: &str, content: &str) -> Result<(), String> {
	let log_path = run_context.path.join("logs").join(filename);
	fs::write(&log_path, content)
		.map_err(|err| format!("Failed to write log {}: {}", filename, err))
}

/// Gets the currently active Appium session, if any.
pub fn get_active_session() -> Option<ActiveSession> {
	session_store()
		.lock()
		.ok()
		.and_then(|guard| guard.clone())
}

/// Sets the active Appium session.
pub fn set_active_session(session: Option<ActiveSession>) -> Result<(), String> {
	let mut guard = session_store()
		.lock()
		.map_err(|_| "Active session storage is unavailable".to_string())?;
	*guard = session;
	Ok(())
}

// ── Smoke-check stop flag ──────────────────────────────────────────────────

/// Atomic flag set when the user requests early termination of a smoke run.
static SMOKE_STOP_REQUESTED: OnceLock<AtomicBool> = OnceLock::new();

fn smoke_stop_flag() -> &'static AtomicBool {
	SMOKE_STOP_REQUESTED.get_or_init(|| AtomicBool::new(false))
}

/// Signals the running smoke check to stop after the current step.
pub fn request_smoke_stop() {
	smoke_stop_flag().store(true, Ordering::Relaxed);
}

/// Clears the stop flag — must be called before starting a new smoke run.
pub fn clear_smoke_stop() {
	smoke_stop_flag().store(false, Ordering::Relaxed);
}

/// Returns true if the smoke check should abort.
pub fn is_smoke_stop_requested() -> bool {
	smoke_stop_flag().load(Ordering::Relaxed)
}
