use std::process::Child;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::AppHandle;

use crate::core::android_env::android_env_vars;
use crate::core::events::{emit_log, LogLevel};
use crate::core::process::{ProcessError, ProcessRunner};
use crate::drivers::adb::is_valid_serial;

/// scrcpy configuration options for the mirroring session.
#[derive(Debug, Clone)]
pub struct ScrcpyOptions {
	/// Device serial to mirror.
	pub serial: String,
	/// Display bitrate (default: 8Mbps).
	pub bitrate: Option<String>,
	/// Max size (longest edge in pixels).
	pub max_size: Option<u32>,
}

/// Stores the active scrcpy child process.
static SCRCPY_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn scrcpy_storage() -> &'static Mutex<Option<Child>> {
	SCRCPY_CHILD.get_or_init(|| Mutex::new(None))
}

/// Starts a scrcpy mirroring session for the given device serial.
///
/// **What**: Spawns scrcpy with validated serial and options. Stores child process handle for later cleanup.
/// **Security**: Device serial is validated using the same conservative regex from adb.rs. Only 'scrcpy' executable (allowlisted) is invoked.
/// **Complexity**: O(1) spawn operation. Streaming stdout/stderr prevents unbounded memory growth.
pub async fn start_scrcpy(
	app: &AppHandle,
	opts: ScrcpyOptions,
) -> Result<String, ProcessError> {
	// Validate serial to prevent injection
	if !is_valid_serial(&opts.serial) {
		return Err(ProcessError {
			message: format!("Invalid device serial: {}", opts.serial),
		});
	}

	// Check if scrcpy is already running — but also flush any zombie child that
	// already exited silently (the watchdog takes up to 1.5 s to notice).
	{
		let mut guard = scrcpy_storage().lock().unwrap();
		if let Some(ref mut child) = *guard {
			match child.try_wait() {
				// Process already exited — clear the stale handle and allow a fresh start
				Ok(Some(status)) => {
					emit_log(app, LogLevel::Warn, format!("[scrcpy] Previous process already exited ({}); clearing handle — allowing restart", status)).ok();
					*guard = None;
				}
				// Actually still running
				Ok(None) => {
					emit_log(app, LogLevel::Warn, "[scrcpy] Already running").ok();
					return Err(ProcessError {
						message: "scrcpy is already running".to_string(),
					});
				}
				// Error checking — clear and allow retry
				Err(e) => {
					emit_log(app, LogLevel::Warn, format!("[scrcpy] Error checking previous process: {} — clearing handle", e)).ok();
					*guard = None;
				}
			}
		}
	}

	emit_log(
		app,
		LogLevel::Info,
		format!("[scrcpy] Starting for device: {}", opts.serial),
	)
	.ok();

	let mut args = vec!["-s".to_string(), opts.serial.clone()];

	// Disable audio to avoid MediaCodec encoder crashes on many devices
	args.push("--no-audio".to_string());

	// Keep the screen on while scrcpy is connected.
	// --turn-screen-on was removed in scrcpy v2.0, so only --stay-awake is used here.
	args.push("--stay-awake".to_string());

	// Give the window a stable title for scripting / debugging
	args.push("--window-title".to_string());
	args.push(format!("Tezzy Mirror — {}", opts.serial));

	if let Some(bitrate) = opts.bitrate {
		args.push("-b".to_string());
		args.push(bitrate);
	}

	if let Some(max_size) = opts.max_size {
		args.push("-m".to_string());
		args.push(max_size.to_string());
	}

	// Spawn scrcpy process
	let _runner = ProcessRunner::new();
	let app_handle = app.clone();

	// Try to find scrcpy executable in common locations
	let scrcpy_exe = if std::path::Path::new("C:\\scrcpy-win64-v2.7\\scrcpy.exe").exists() {
		"C:\\scrcpy-win64-v2.7\\scrcpy.exe"
	} else if std::path::Path::new("C:\\scrcpy\\scrcpy.exe").exists() {
		"C:\\scrcpy\\scrcpy.exe"
	} else {
		// Fallback to PATH
		"scrcpy"
	};

	emit_log(
		&app_handle,
		LogLevel::Info,
		format!("[scrcpy] Using executable: {}", scrcpy_exe),
	)
	.ok();

	// Build environment: Android SDK vars + scrcpy's own directory in PATH
	// (scrcpy bundles its own adb.exe in the same folder — it must be in PATH)
	let scrcpy_dir = std::path::Path::new(scrcpy_exe)
		.parent()
		.map(|p| p.to_string_lossy().to_string())
		.unwrap_or_default();

	let mut env_vars = android_env_vars();
	// Prepend scrcpy dir to PATH so its bundled adb.exe is discovered
	if !scrcpy_dir.is_empty() {
		let sep = if cfg!(windows) { ";" } else { ":" };
		if let Some(pos) = env_vars.iter().position(|(k, _)| k == "PATH") {
			env_vars[pos].1 = format!("{}{}{}", scrcpy_dir, sep, env_vars[pos].1);
		} else {
			let existing = std::env::var("PATH").unwrap_or_default();
			env_vars.push(("PATH".to_string(), format!("{}{}{}", scrcpy_dir, sep, existing)));
		}
	}

	emit_log(&app_handle, LogLevel::Info, format!("[scrcpy] ADB path prepend: {}", scrcpy_dir)).ok();

	let mut scrcpy_cmd = std::process::Command::new(scrcpy_exe);
	scrcpy_cmd.args(&args);
	for (k, v) in env_vars {
		scrcpy_cmd.env(k, v);
	}
	// Pipe stderr so failures are captured and logged
	scrcpy_cmd.stderr(std::process::Stdio::piped());

	let mut child = scrcpy_cmd.spawn()
		.map_err(|err| ProcessError {
			message: format!("Failed to spawn scrcpy: {}. Ensure scrcpy is at C:\\scrcpy-win64-v2.7\\", err),
		})?;

	// Spawn a thread to drain stderr and forward to system log
	if let Some(stderr) = child.stderr.take() {
		let app2 = app_handle.clone();
		std::thread::spawn(move || {
			use std::io::{BufRead, BufReader};
			for line in BufReader::new(stderr).lines().map_while(Result::ok) {
				if !line.trim().is_empty() {
					emit_log(&app2, LogLevel::Info, format!("[scrcpy-err] {}", line)).ok();
				}
			}
		});
	}

	let child_id = child.id();

	// Store child process
	{
		let mut guard = scrcpy_storage().lock().unwrap();
		*guard = Some(child);
	}

	emit_log(
		&app_handle,
		LogLevel::Info,
		format!("[scrcpy] Started with PID: {}", child_id),
	)
	.ok();

	// Spawn a watchdog thread: if scrcpy exits on its own (crash / device disconnect),
	// clean up the stored child handle and notify the frontend.
	{
		let app3 = app_handle.clone();
		std::thread::spawn(move || {
			loop {
				std::thread::sleep(std::time::Duration::from_millis(500));  // was 1500ms — faster crash detection
				let mut guard = scrcpy_storage().lock().unwrap();
				if let Some(ref mut child) = *guard {
					match child.try_wait() {
						Ok(Some(status)) => {
							emit_log(&app3, LogLevel::Warn, format!("[scrcpy] Process exited with: {}", status)).ok();
							crate::core::events::emit_scrcpy_state(&app3, "stopped", Some(format!("scrcpy exited ({})", status)), None).ok();
							*guard = None;
							return;
						}
						Ok(None) => { /* still running */ }
						Err(e) => {
							emit_log(&app3, LogLevel::Warn, format!("[scrcpy] Error checking status: {}", e)).ok();
							*guard = None;
							return;
						}
					}
				} else {
					// Stopped externally (e.g. user pressed Stop)
					return;
				}
			}
		});
	}

	Ok(format!("scrcpy started for device: {}", opts.serial))
}

/// Stops the active scrcpy session if one is running.
///
/// **What**: Kills the scrcpy child process and clears the stored handle.
/// **Security**: Only operates on our own spawned child process.
/// **Complexity**: O(1) process termination.
pub fn stop_scrcpy(app: &AppHandle) -> Result<String, ProcessError> {
	let mut guard = scrcpy_storage().lock().unwrap();

	match guard.take() {
		Some(mut child) => {
			emit_log(app, LogLevel::Info, "[scrcpy] Stopping...").ok();

			child.kill().map_err(|err| ProcessError {
				message: format!("Failed to kill scrcpy process: {err}"),
			})?;

			emit_log(app, LogLevel::Info, "[scrcpy] Stopped").ok();
			Ok("scrcpy stopped".to_string())
		}
		None => {
			emit_log(app, LogLevel::Warn, "[scrcpy] Not running").ok();
			Err(ProcessError {
				message: "scrcpy is not running".to_string(),
			})
		}
	}
}

/// Returns true if scrcpy is currently running.
pub fn is_scrcpy_running() -> bool {
	let guard = scrcpy_storage().lock().unwrap();
	guard.is_some()
}

/// Scrcpy status for UI consumption.
#[derive(Debug, Clone, Serialize)]
pub struct ScrcpyStatus {
	pub running: bool,
	pub device_serial: Option<String>,
}

pub fn get_scrcpy_status() -> ScrcpyStatus {
	ScrcpyStatus {
		running: is_scrcpy_running(),
		device_serial: None, // Week 2: we don't track the serial in status yet
	}
}
