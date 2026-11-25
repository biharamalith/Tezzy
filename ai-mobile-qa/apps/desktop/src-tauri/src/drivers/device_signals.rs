//! Small adb helpers for the AI agent loop: crash log, screen density, key events,
//! and an adb text-input fallback. Every call validates the serial, runs adb directly
//! (no shell on the host) and is bounded by a timeout.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use crate::drivers::adb::is_valid_serial;

const MAX_CRASH_LINES: usize = 40;

async fn adb(serial: &str, args: &[&str], timeout_s: u64) -> Result<String, String> {
	if !is_valid_serial(serial) {
		return Err(format!("Invalid device serial: {}", serial));
	}
	let child = Command::new("adb")
		.arg("-s")
		.arg(serial)
		.args(args)
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.kill_on_drop(true)
		.spawn()
		.map_err(|e| format!("Failed to spawn adb: {}", e))?;
	let out = tokio::time::timeout(Duration::from_secs(timeout_s), child.wait_with_output())
		.await
		.map_err(|_| format!("adb {} timed out after {}s", args.join(" "), timeout_s))?
		.map_err(|e| format!("adb process error: {}", e))?;
	if !out.status.success() {
		return Err(format!(
			"adb {} failed: {}",
			args.join(" "),
			String::from_utf8_lossy(&out.stderr).trim()
		));
	}
	Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Clears the device log so the next read only holds what happened after it.
pub async fn clear_logcat(serial: &str) {
	let _ = adb(serial, &["logcat", "-c"], 5).await;
}

/// Crashes, fatal exceptions and ANRs logged since the last call, then clears the log.
/// Best-effort: returns an empty list when adb fails.
pub async fn read_crash_log(serial: &str) -> Vec<String> {
	let mut text = adb(serial, &["logcat", "-d", "-b", "crash"], 8).await.unwrap_or_default();
	text.push_str(
		&adb(serial, &["logcat", "-d", "AndroidRuntime:E", "ActivityManager:E", "*:S"], 8)
			.await
			.unwrap_or_default(),
	);
	clear_logcat(serial).await;
	let lines: Vec<String> = text
		.lines()
		.map(|l| l.trim_end().to_string())
		.filter(|l| !l.trim().is_empty() && !l.starts_with("-----"))
		.collect();
	let skip = lines.len().saturating_sub(MAX_CRASH_LINES);
	lines.into_iter().skip(skip).collect()
}

/// Screen density in dpi (the override when one is set). Defaults to 420.
pub async fn screen_density(serial: &str) -> u32 {
	let out = adb(serial, &["shell", "wm", "density"], 5).await.unwrap_or_default();
	out.lines()
		.filter_map(|l| l.rsplit(':').next())
		.filter_map(|v| v.trim().parse::<u32>().ok())
		.last()
		.unwrap_or(420)
}

/// Sends an Android key event, e.g. 66 = Enter.
pub async fn key_event(serial: &str, keycode: u32) -> Result<(), String> {
	let code = keycode.to_string();
	adb(serial, &["shell", "input", "keyevent", &code], 5).await.map(|_| ())
}

/// Types text through `adb shell input text`, for fields that refuse Appium's keys.
pub async fn input_text(serial: &str, text: &str) -> Result<(), String> {
	// `input text` needs %s for spaces; single quotes keep the device's shell from
	// reading any other character.
	let encoded = text.replace(' ', "%s");
	let quoted = format!("'{}'", encoded.replace('\'', "'\\''"));
	adb(serial, &["shell", "input", "text", &quoted], 15).await.map(|_| ())
}
