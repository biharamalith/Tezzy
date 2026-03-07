use std::path::PathBuf;

use tauri::AppHandle;

use crate::core::events::{emit_log, emit_screenshot_taken, emit_session_state, LogLevel};
use crate::core::storage::{get_active_device, get_active_session, set_active_session, ActiveSession};
use crate::drivers::appium_client;
use crate::drivers::appium_server::{
	ensure_appium_installed, get_appium_server_status, start_appium_server, stop_appium_server,
	AppiumInstallInfo, AppiumServerStatus,
};

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

	let session = get_active_session().ok_or_else(|| "No active session".to_string())?;

	appium_client::delete_session(&app, &session.session_id, None).await?;

	set_active_session(None)?;

	emit_session_state(&app, "none", None, None, Some("Session destroyed".to_string())).ok();

	Ok("Session destroyed".to_string())
}

/// Performs tap action at coordinates.
#[tauri::command]
pub async fn action_tap(app: AppHandle, x: i32, y: i32) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, format!("[command] Action: Tap ({}, {})", x, y)).ok();

	let session = get_active_session().ok_or_else(|| "No active session".to_string())?;

	appium_client::tap_xy(&app, &session.session_id, x, y, None).await?;

	Ok(format!("Tapped at ({}, {})", x, y))
}

/// Performs back button action.
#[tauri::command]
pub async fn action_back(app: AppHandle) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, "[command] Action: Back").ok();

	let session = get_active_session().ok_or_else(|| "No active session".to_string())?;

	appium_client::back(&app, &session.session_id, None).await?;

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

	let session = get_active_session().ok_or_else(|| "No active session".to_string())?;

	appium_client::swipe(&app, &session.session_id, x1, y1, x2, y2, duration_ms, None).await?;

	Ok(format!("Swiped from ({},{}) to ({},{})", x1, y1, x2, y2))
}

/// Performs input text action.
#[tauri::command]
pub async fn action_input(app: AppHandle, text: String) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, format!("[command] Action: Input '{}'", text)).ok();

	let session = get_active_session().ok_or_else(|| "No active session".to_string())?;

	appium_client::input_text(&app, &session.session_id, &text, None).await?;

	Ok(format!("Input text: {}", text))
}

/// Takes a screenshot and saves to artifacts.
#[tauri::command]
pub async fn action_screenshot(app: AppHandle) -> Result<String, String> {
	emit_log(&app, LogLevel::Info, "[command] Action: Screenshot").ok();

	let session = get_active_session().ok_or_else(|| "No active session".to_string())?;

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

	let saved_path = appium_client::screenshot(&app, &session.session_id, &dest_path, None).await?;

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
