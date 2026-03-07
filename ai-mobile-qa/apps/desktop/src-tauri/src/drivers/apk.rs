use std::path::Path;

use serde::Serialize;
use tauri::AppHandle;

use crate::core::events::{emit_log, LogLevel};
use crate::core::process::ProcessRunner;
use crate::drivers::adb::is_valid_serial;

/// Result of an APK installation operation.
#[derive(Debug, Clone, Serialize)]
pub struct InstallResult {
	pub success: bool,
	pub message: String,
	pub package_name: Option<String>,
	pub stdout: String,
	pub stderr: String,
}

/// Validates that an APK file path is safe to use.
///
/// **What**: Checks file exists, is a file (not directory), and has .apk extension.
/// **Security**: Prevents directory traversal and non-APK file injection into adb install.
/// **Complexity**: O(1) file system checks.
fn validate_apk_path(apk_path: &str) -> Result<(), String> {
	let path = Path::new(apk_path);

	if !path.exists() {
		return Err(format!("APK file does not exist: {}", apk_path));
	}

	if !path.is_file() {
		return Err(format!("Path is not a file: {}", apk_path));
	}

	match path.extension().and_then(|s| s.to_str()) {
		Some(ext) if ext.eq_ignore_ascii_case("apk") => Ok(()),
		_ => Err(format!(
			"File does not have .apk extension: {}",
			apk_path
		)),
	}
}

/// Installs an APK to the specified device using `adb install -r`.
///
/// **What**: Runs `adb -s <serial> install -r <apk_path>` and captures output.
/// **Security**:
///   - Device serial validated with conservative regex.
///   - APK path validated to be an existing .apk file.
///   - No shell invocation; arguments passed directly to adb.
/// **Complexity**: O(n) where n = APK file size (adb transfer time). Does not load APK into memory.
pub async fn install_apk(
	app: &AppHandle,
	serial: &str,
	apk_path: &str,
) -> Result<InstallResult, String> {
	// Validate serial
	if !is_valid_serial(serial) {
		return Err(format!("Invalid device serial: {}", serial));
	}

	// Validate APK path
	validate_apk_path(apk_path)?;

	emit_log(
		app,
		LogLevel::Info,
		format!("[adb] Installing APK: {}", apk_path),
	)
	.ok();

	let runner = ProcessRunner::new();
	let args = vec![
		"-s".to_string(),
		serial.to_string(),
		"install".to_string(),
		"-r".to_string(), // Replace existing app
		apk_path.to_string(),
	];

	match runner.run_capture("adb", &args).await {
		Ok(output) => {
			let success = output.stdout.contains("Success");

			if success {
				emit_log(app, LogLevel::Info, "[adb] APK installed successfully").ok();
			} else {
				emit_log(
					app,
					LogLevel::Error,
					format!("[adb] Install failed: {}", output.stderr),
				)
				.ok();
			}

			Ok(InstallResult {
				success,
				message: if success {
					"APK installed successfully".to_string()
				} else {
					format!("Install failed: {}", output.stderr)
				},
				package_name: None, // Filled in by caller after detection
				stdout: output.stdout,
				stderr: output.stderr,
			})
		}
		Err(err) => {
			emit_log(
				app,
				LogLevel::Error,
				format!("[adb] Install command failed: {}", err.message),
			)
			.ok();
			Err(err.message)
		}
	}
}

/// Attempts to detect package name from APK using before/after diff of installed packages.
///
/// **What**: Lists third-party packages before and after install to detect newly installed package.
/// **Why**: aapt2 may not be available on all systems. Fallback uses adb shell pm list packages -3.
/// **Limitations**: Best-effort only. May fail if:
///   - App was already installed (no diff detected).
///   - Multiple packages installed simultaneously.
///   - Reinstall with -r flag (no new package appears).
/// **Security**: Uses validated serial. No file system access.
/// **Complexity**: O(n) where n = number of installed packages (typically < 100 for -3 filter).
pub async fn detect_package_name_fallback(
	app: &AppHandle,
	serial: &str,
	before_packages: Vec<String>,
) -> Option<String> {
	emit_log(
		app,
		LogLevel::Info,
		"[adb] Detecting package name via diff...",
	)
	.ok();

	let runner = ProcessRunner::new();
	let args = vec![
		"-s".to_string(),
		serial.to_string(),
		"shell".to_string(),
		"pm".to_string(),
		"list".to_string(),
		"packages".to_string(),
		"-3".to_string(), // Third-party packages only
	];

	match runner.run_capture("adb", &args).await {
		Ok(output) => {
			let after_packages: Vec<String> = output
				.stdout
				.lines()
				.map(|line| line.trim().replace("package:", ""))
				.filter(|pkg| !pkg.is_empty())
				.collect();

			// Find new package (simple set diff)
			for pkg in &after_packages {
				if !before_packages.contains(pkg) {
					emit_log(
						app,
						LogLevel::Info,
						format!("[adb] Detected new package: {}", pkg),
					)
					.ok();
					return Some(pkg.clone());
				}
			}

			emit_log(
				app,
				LogLevel::Warn,
				"[adb] Could not detect new package (likely reinstall)",
			)
			.ok();
			None
		}
		Err(err) => {
			emit_log(
				app,
				LogLevel::Warn,
				format!("[adb] Package detection failed: {}", err.message),
			)
			.ok();
			None
		}
	}
}

/// Lists currently installed third-party packages (for before/after comparison).
pub async fn list_installed_packages(serial: &str) -> Result<Vec<String>, String> {
	if !is_valid_serial(serial) {
		return Err(format!("Invalid device serial: {}", serial));
	}

	let runner = ProcessRunner::new();
	let args = vec![
		"-s".to_string(),
		serial.to_string(),
		"shell".to_string(),
		"pm".to_string(),
		"list".to_string(),
		"packages".to_string(),
		"-3".to_string(),
	];

	match runner.run_capture("adb", &args).await {
		Ok(output) => {
			let packages = output
				.stdout
				.lines()
				.map(|line| line.trim().replace("package:", ""))
				.filter(|pkg| !pkg.is_empty())
				.collect();
			Ok(packages)
		}
		Err(err) => Err(err.message),
	}
}

/// Launches an installed app using the monkey tool.
///
/// **What**: Runs `adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1`.
/// **Security**: Package name is basic string validation (no path traversal risk). Serial is validated.
/// **Complexity**: O(1) command execution.
pub async fn launch_package(
	app: &AppHandle,
	serial: &str,
	package: &str,
) -> Result<String, String> {
	if !is_valid_serial(serial) {
		return Err(format!("Invalid device serial: {}", serial));
	}

	if package.is_empty() || package.contains('/') || package.contains('\\') {
		return Err(format!("Invalid package name: {}", package));
	}

	emit_log(
		app,
		LogLevel::Info,
		format!("[adb] Launching package: {}", package),
	)
	.ok();

	let runner = ProcessRunner::new();
	let args = vec![
		"-s".to_string(),
		serial.to_string(),
		"shell".to_string(),
		"monkey".to_string(),
		"-p".to_string(),
		package.to_string(),
		"-c".to_string(),
		"android.intent.category.LAUNCHER".to_string(),
		"1".to_string(),
	];

	match runner.run_capture("adb", &args).await {
		Ok(output) => {
			if output.stdout.contains("Events injected") || output.status == 0 {
				emit_log(
					app,
					LogLevel::Info,
					format!("[adb] Successfully launched: {}", package),
				)
				.ok();
				Ok(format!("Launched: {}", package))
			} else {
				let error = format!("Launch failed: {}", output.stderr);
				emit_log(app, LogLevel::Error, format!("[adb] {}", error)).ok();
				Err(error)
			}
		}
		Err(err) => {
			emit_log(
				app,
				LogLevel::Error,
				format!("[adb] Launch failed: {}", err.message),
			)
			.ok();
			Err(err.message)
		}
	}
}
