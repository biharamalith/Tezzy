use tauri::AppHandle;

use crate::core::events::emit_scrcpy_state;
use crate::core::storage::get_active_device;
use crate::drivers::scrcpy::{get_scrcpy_status, start_scrcpy, stop_scrcpy, ScrcpyOptions, ScrcpyStatus};

/// Starts scrcpy for the currently active device.
#[tauri::command]
pub async fn start_scrcpy_preview(app: AppHandle) -> Result<String, String> {
	let serial = get_active_device().ok_or_else(|| "No active device selected".to_string())?;

	let opts = ScrcpyOptions {
		serial: serial.clone(),
		bitrate: Some("8M".to_string()),
		max_size: Some(1080),
	};

	match start_scrcpy(&app, opts).await {
		Ok(msg) => {
			emit_scrcpy_state(&app, "running", Some(msg.clone()), Some(serial)).ok();
			Ok(msg)
		}
		Err(err) => {
			emit_scrcpy_state(&app, "error", Some(err.message.clone()), None).ok();
			Err(err.message)
		}
	}
}

/// Stops the active scrcpy session.
#[tauri::command]
pub fn stop_scrcpy_preview(app: AppHandle) -> Result<String, String> {
	match stop_scrcpy(&app) {
		Ok(msg) => {
			emit_scrcpy_state(&app, "stopped", Some(msg.clone()), None).ok();
			Ok(msg)
		}
		Err(err) => {
			emit_scrcpy_state(&app, "error", Some(err.message.clone()), None).ok();
			Err(err.message)
		}
	}
}

/// Gets current scrcpy status.
#[tauri::command]
pub fn get_scrcpy_preview_status() -> ScrcpyStatus {
	get_scrcpy_status()
}
