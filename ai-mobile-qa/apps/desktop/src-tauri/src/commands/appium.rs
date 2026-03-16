use std::path::PathBuf;

use tauri::AppHandle;

use crate::core::events::{emit_log, emit_screenshot_taken, emit_session_state, LogLevel};
use crate::core::storage::{get_active_device, get_active_session, set_active_session, ActiveSession};
use crate::drivers::appium_client;
use crate::drivers::appium_server::{
	ensure_appium_installed, get_appium_server_status, start_appium_server, stop_appium_server,
	AppiumInstallInfo, AppiumServerStatus,
};

fn is_invalid_session_error(err: &str) -> bool {
	let lower = err.to_lowercase();
	lower.contains("invalid session id")
		|| lower.contains("session is either terminated or not started")
		|| lower.contains("nosuchdrivererror")
}

async fn recover_session(app: &AppHandle, serial: &str) -> Result<ActiveSession, String> {
	emit_log(
		app,
		LogLevel::Warn,
		format!("[appium-client] Recovering Appium session for device {}", serial),
	)
	.ok();
	emit_session_state(
		app,
		"creating",
		None,
		Some(serial.to_string()),
		Some("Recovering stale session...".to_string()),
	)
	.ok();

	let session_response = appium_client::create_session(app, serial, None, None)
		.await
		.map_err(|e| format!("Session recovery failed: {}", e))?;

	let recovered = ActiveSession {
		session_id: session_response.session_id.clone(),
		device_serial: serial.to_string(),
		capabilities: session_response.capabilities,
	};
	set_active_session(Some(recovered.clone()))?;

	emit_session_state(
		app,
		"active",
		Some(recovered.session_id.clone()),
		Some(serial.to_string()),
		Some("Session recovered".to_string()),
	)
	.ok();

	Ok(recovered)
}

async fn get_or_recover_session(app: &AppHandle) -> Result<ActiveSession, String> {
	let Some(session) = get_active_session() else {
		return Err("No active session".to_string());
	};

	if appium_client::is_session_alive(&session.session_id, None).await {
		return Ok(session);
	}

	emit_log(
		app,
		LogLevel::Warn,
		format!(
			"[appium-client] Stored session {} is dead; auto-recovering",
			session.session_id
		),
	)
	.ok();
	recover_session(app, &session.device_serial).await
}

/// Ensures Appium is installed (downloads if needed).
#[tauri::command]
pub async fn ensure_appium(app: AppHandle) -> Result<AppiumInstallInfo, String> {
	emit_log(&app, LogLevel::Info, "[command] Ensuring Appium is installed").ok();
	ensure_appium_installed(&app).await
}

/// Starts the Appium server.
#[tauri::command]
pub async fn start_appium(app: AppHandle, port: Option<u16>) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, "[command] Starting Appium server").ok();
	start_appium_server(&app, port).await
}

/// Stops the Appium server.
#[tauri::command]
pub fn stop_appium(app: AppHandle) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, "[command] Stopping Appium server").ok();
	stop_appium_server(&app)
}

/// Gets Appium server status.
#[tauri::command]
pub fn get_appium_status() -> AppiumServerStatus {
	get_appium_server_status()
}

/// Creates a new Appium session for the active device.
#[tauri::command]
pub async fn create_appium_session(
	app: AppHandle,
	package_name: Option<String>,
) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, "[command] Creating Appium session").ok();
	emit_session_state(&app, "creating", None, None, Some("Creating session...".to_string())).ok();

	let serial = match get_active_device() {
		Some(s) => s,
		None => {
			let msg = "No active device selected. Pick a device first.".to_string();
			emit_session_state(&app, "error", None, None, Some(msg.clone())).ok();
			return Err(msg);
		}
	};

	let session_response = match appium_client::create_session(&app, &serial, package_name, None).await {
		Ok(r) => r,
		Err(e) => {
			let msg = format!("Session failed: {}", e);
			emit_log(&app, LogLevel::Info, format!("[appium-client] {}", msg)).ok();
			emit_session_state(&app, "error", None, None, Some(msg.clone())).ok();
			return Err(msg);
		}
	};

	// Store session
	let active_session = ActiveSession {
		session_id: session_response.session_id.clone(),
		device_serial: serial.clone(),
		capabilities: session_response.capabilities,
	};

	set_active_session(Some(active_session))?;

	emit_session_state(
		&app,
		"active",
		Some(session_response.session_id.clone()),
		Some(serial),
		Some("Session created".to_string()),
	)
	.ok();

	Ok(session_response.session_id)
}

/// Destroys the active Appium session.
#[tauri::command]
pub async fn destroy_appium_session(app: AppHandle) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, "[command] Destroying Appium session").ok();

	let Some(session) = get_active_session() else {
		emit_session_state(&app, "none", None, None, Some("No active session".to_string())).ok();
		return Ok("No active session".to_string());
	};

	let remote_delete = appium_client::delete_session(&app, &session.session_id, None).await;

	// Always clear local state so the UI can recover even when Appium already
	// dropped the session (common after app crash / server restart).
	set_active_session(None)?;

	match remote_delete {
		Ok(()) => {
			emit_session_state(&app, "none", None, None, Some("Session destroyed".to_string())).ok();
			Ok("Session destroyed".to_string())
		}
		Err(e) => {
			emit_log(
				&app,
				LogLevel::Warn,
				format!("[appium-client] Remote session delete failed; cleared local session: {}", e),
			)
			.ok();
			emit_session_state(
				&app,
				"none",
				None,
				None,
				Some("Session cleared locally (remote session already ended)".to_string()),
			)
			.ok();
			Ok("Session cleared locally".to_string())
		}
	}
}

/// Performs tap action at coordinates.
#[tauri::command]
pub async fn action_tap(app: AppHandle, x: i32, y: i32) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, format!("[command] Action: Tap ({}, {})", x, y)).ok();

	let mut session = get_or_recover_session(&app).await?;

	if let Err(e) = appium_client::tap_xy(&app, &session.session_id, x, y, None).await {
		if is_invalid_session_error(&e) {
			emit_log(&app, LogLevel::Warn, format!("[command] Tap failed due to stale session; retrying once: {}", e)).ok();
			session = recover_session(&app, &session.device_serial).await?;
			appium_client::tap_xy(&app, &session.session_id, x, y, None).await?;
		} else {
			return Err(e);
		}
	}

	Ok(format!("Tapped at ({}, {})", x, y))
}

/// Performs back button action.
#[tauri::command]
pub async fn action_back(app: AppHandle) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, "[command] Action: Back").ok();

	let mut session = get_or_recover_session(&app).await?;

	if let Err(e) = appium_client::back(&app, &session.session_id, None).await {
		if is_invalid_session_error(&e) {
			emit_log(&app, LogLevel::Warn, format!("[command] Back failed due to stale session; retrying once: {}", e)).ok();
			session = recover_session(&app, &session.device_serial).await?;
			appium_client::back(&app, &session.session_id, None).await?;
		} else {
			return Err(e);
		}
	}

	Ok("Back button pressed".to_string())
}

/// Performs swipe action.
#[tauri::command]
pub async fn action_swipe(
	app: AppHandle,
	x1: i32,
	y1: i32,
	x2: i32,
	y2: i32,
	duration_ms: u64,
) -> Result<String, String> {
	emit_log(
		&app,
		LogLevel::Info,
		format!("[command] Action: Swipe ({},{}) to ({},{})", x1, y1, x2, y2),
	)
	.ok();

	let mut session = get_or_recover_session(&app).await?;

	if let Err(e) = appium_client::swipe(&app, &session.session_id, x1, y1, x2, y2, duration_ms, None).await {
		if is_invalid_session_error(&e) {
			emit_log(&app, LogLevel::Warn, format!("[command] Swipe failed due to stale session; retrying once: {}", e)).ok();
			session = recover_session(&app, &session.device_serial).await?;
			appium_client::swipe(&app, &session.session_id, x1, y1, x2, y2, duration_ms, None).await?;
		} else {
			return Err(e);
		}
	}

	Ok(format!("Swiped from ({},{}) to ({},{})", x1, y1, x2, y2))
}

/// Performs input text action.
#[tauri::command]
pub async fn action_input(app: AppHandle, text: String) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, format!("[command] Action: Input '{}'", text)).ok();

	let mut session = get_or_recover_session(&app).await?;

	match appium_client::input_text(&app, &session.session_id, &text, None).await {
		Ok(_) => Ok(format!("Input text: {}", text)),
		Err(e) => {
			if is_invalid_session_error(&e) {
				emit_log(&app, LogLevel::Warn, format!("[command] Input failed due to stale session; retrying once: {}", e)).ok();
				session = recover_session(&app, &session.device_serial).await?;
				if appium_client::input_text(&app, &session.session_id, &text, None).await.is_ok() {
					return Ok(format!("Input text: {}", text));
				}
			}

			emit_log(&app, LogLevel::Warn, format!("[command] Appium input_text failed: {}. Falling back to ADB.", e)).ok();
			
			// Fallback: ADB shell input text bypasses active element checks and "invalid element state".
			use crate::core::process::ProcessRunner;
			let runner = ProcessRunner::new();
			
			// ADB requires spaces to be `%s`.
			let encoded_text = text.replace(' ', "%s");
			// Safely quote for Android's sh.
			let adb_arg = format!("'{}'", encoded_text.replace('\'', "'\\''"));
			
			let res = runner.run_capture("adb", &vec![
				"-s".to_string(),
				session.device_serial.clone(),
				"shell".to_string(),
				"input".to_string(),
				"text".to_string(),
				adb_arg
			]).await;

			match res {
				Ok(_) => Ok(format!("Input text (via ADB): {}", text)),
				Err(adb_err) => Err(format!("Appium failed: {} | ADB fallback failed: {}", e, adb_err.message))
			}
		}
	}
}

/// Takes a screenshot and saves to artifacts.
#[tauri::command]
pub async fn action_screenshot(app: AppHandle) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, "[command] Action: Screenshot").ok();

	let mut session = get_or_recover_session(&app).await?;

	// Save to the app's local data directory (absolute, guaranteed writable)
	let base_dir = app
		.path_resolver()
		.app_local_data_dir()
		.unwrap_or_else(|| PathBuf::from("reports"));
	let screenshots_dir = base_dir.join("screenshots");
	std::fs::create_dir_all(&screenshots_dir)
		.map_err(|err| format!("Failed to create screenshots directory: {}", err))?;

	let timestamp = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.unwrap()
		.as_millis();
	let filename = format!("screenshot-{}.png", timestamp);
	let dest_path = screenshots_dir.join(&filename);

	let saved_path = match appium_client::screenshot(&app, &session.session_id, &dest_path, None).await {
		Ok(path) => path,
		Err(e) => {
			if is_invalid_session_error(&e) {
				emit_log(&app, LogLevel::Warn, format!("[command] Screenshot failed due to stale session; retrying once: {}", e)).ok();
				session = recover_session(&app, &session.device_serial).await?;
				appium_client::screenshot(&app, &session.session_id, &dest_path, None).await?
			} else {
				return Err(e);
			}
		}
	};

	// Notify the UI so it can display the new screenshot immediately
	emit_screenshot_taken(&app, &saved_path).ok();

	Ok(saved_path)
}

/// Lists all saved screenshots (absolute paths), newest first.
#[tauri::command]
pub fn list_screenshots(app: AppHandle) -> Vec<String> {
	let base_dir = app
		.path_resolver()
		.app_local_data_dir()
		.unwrap_or_else(|| PathBuf::from("reports"));
	let screenshots_dir = base_dir.join("screenshots");

	let mut entries: Vec<(u64, String)> = std::fs::read_dir(&screenshots_dir)
		.into_iter()
		.flatten()
		.flatten()
		.filter_map(|e| {
			let p = e.path();
			if p.extension().and_then(|s| s.to_str()) == Some("png") {
				let modified = e.metadata().ok()?.modified().ok()?
					.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
				Some((modified, p.to_string_lossy().to_string()))
			} else {
				None
			}
		})
		.collect();
	entries.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
	entries.into_iter().map(|(_, path)| path).collect()
}
