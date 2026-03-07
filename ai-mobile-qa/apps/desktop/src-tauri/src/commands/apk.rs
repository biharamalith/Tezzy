use std::path::Path;

use tauri::AppHandle;

use crate::core::storage::{create_run_folder, get_active_device, write_run_log};
use crate::drivers::apk::{
	detect_package_name_fallback, install_apk, launch_package, list_installed_packages, InstallResult,
};

/// Installs and launches an APK on the active device.
///
/// This command orchestrates the full pipeline:
/// 1. Validates active device is selected
/// 2. Lists installed packages (for before/after detection)
/// 3. Installs APK
/// 4. Detects package name via diff
/// 5. Launches the app
/// 6. Creates a run artifacts folder with logs and metadata
#[tauri::command]
pub async fn install_and_launch_apk(
	app: AppHandle,
	apk_path: String,
) -> Result<InstallResult, String> {
	let serial = get_active_device().ok_or_else(|| "No active device selected".to_string())?;

	// Extract APK filename for metadata
	let apk_filename = Path::new(&apk_path)
		.file_name()
		.and_then(|name| name.to_str())
		.map(|s| s.to_string());

	// List installed packages before install (for detection)
	let before_packages = list_installed_packages(&serial).await.unwrap_or_default();

	// Install APK
	let mut result = install_apk(&app, &serial, &apk_path).await?;

	// If install successful, attempt package detection and launch
	if result.success {
		let package_name =
			detect_package_name_fallback(&app, &serial, before_packages).await;

		result.package_name = package_name.clone();

		// Attempt launch if we detected the package
		if let Some(ref pkg) = package_name {
			match launch_package(&app, &serial, pkg).await {
				Ok(msg) => {
					result.message = format!("{}\n{}", result.message, msg);
				}
				Err(err) => {
					result.message = format!(
						"{}\nWarning: Launch failed: {}",
						result.message, err
					);
				}
			}
		} else {
			result.message = format!(
				"{}\nWarning: Could not detect package name (likely reinstall)",
				result.message
			);
		}

		// Create run artifacts folder
		let run_context = create_run_folder(
			"tezzy-run",
			Some(serial.clone()),
			apk_filename,
			package_name,
		)
		.ok();

		if let Some(ctx) = run_context {
			// Write install logs
			write_run_log(&ctx, "adb_install.txt", &result.stdout).ok();
			if !result.stderr.is_empty() {
				write_run_log(&ctx, "adb_install_stderr.txt", &result.stderr).ok();
			}

			result.message = format!(
				"{}\nRun artifacts saved to: reports/{}",
				result.message, ctx.run_id
			);
		}
	}

	Ok(result)
}
