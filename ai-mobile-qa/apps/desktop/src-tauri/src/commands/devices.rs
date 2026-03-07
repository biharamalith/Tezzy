use serde::Serialize;
use tauri::AppHandle;

use crate::core::events::{emit_device_state, emit_log, LogLevel};
use crate::core::storage;
use crate::drivers::adb::{self, Device};

/// Environment status for required tooling.
#[derive(Debug, Serialize)]
pub struct EnvStatus {
	pub adb_available: bool,
	pub version: Option<String>,
	pub message: Option<String>,
}

/// Checks if adb is available and reports its version.
#[tauri::command]
pub async fn env_check(app: AppHandle) -> EnvStatus {
	emit_log(&app, LogLevel::Info, "Checking adb availability").ok();

	match adb::adb_version().await {
		Ok(version) => {
			emit_log(&app, LogLevel::Info, format!("adb detected: {version}"))
				.ok();
			EnvStatus {
				adb_available: true,
				version: Some(version),
				message: None,
			}
		}
		Err(err) => {
			emit_log(&app, LogLevel::Warn, format!("adb not available: {err}"))
				.ok();
			EnvStatus {
				adb_available: false,
				version: None,
				message: Some(err),
			}
		}
	}
}

/// Refreshes the device list and emits state to the UI.
#[tauri::command]
pub async fn list_devices(app: AppHandle) -> Vec<Device> {
	emit_log(&app, LogLevel::Info, "Refreshing adb devices list").ok();

	match adb::list_devices().await {
		Ok(devices) => {
			let active_serial = storage::get_active_device();
			emit_device_state(&app, active_serial, devices.clone()).ok();
			devices
		}
		Err(err) => {
			emit_log(&app, LogLevel::Error, format!("Failed to list devices: {err}"))
				.ok();
			Vec::new()
		}
	}
}

/// Sets the active device after validating the serial format.
#[tauri::command]
pub async fn set_active_device(app: AppHandle, serial: String) -> Result<(), String> {
	if !adb::is_valid_serial(&serial) {
		emit_log(&app, LogLevel::Warn, "Rejected invalid device serial").ok();
		return Err("Invalid device serial".to_string());
	}

	storage::set_active_device(Some(serial.clone()))?;
	emit_log(&app, LogLevel::Info, format!("Active device set: {serial}"))?;

	let devices = adb::list_devices().await.unwrap_or_default();
	emit_device_state(&app, Some(serial), devices)?;
	Ok(())
}
