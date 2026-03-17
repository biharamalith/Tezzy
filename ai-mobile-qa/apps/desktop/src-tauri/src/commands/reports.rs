use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::AppHandle;

use crate::core::events::{emit_log, LogLevel};
use crate::core::storage::request_smoke_stop;
use crate::explorer::agent_loop::{run_smoke_check, SmokeCheckResult};

/// Default maximum number of steps for a smoke check run.
const DEFAULT_MAX_STEPS: u32 = 20;

/// Default per-step wait time in milliseconds.
const DEFAULT_STEP_DELAY_MS: u64 = 1500;

/// Maximum allowed steps to prevent unbounded runs.
const MAX_STEPS_LIMIT: u32 = 50;

/// Minimum per-step delay to avoid hammering the device (milliseconds).
const MIN_STEP_DELAY_MS: u64 = 500;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct AiErroredScreenRecord {
	step: u32,
	screen_hash: String,
	issue: String,
	evidence: Option<Vec<String>>,
	screenshot: Option<String>,
}

/// Starts a heuristic auto smoke check run against the active device.
///
/// ## Parameters
/// - `max_steps`: How many taps to attempt before stopping. Clamped to [1, 50].
/// - `per_step_delay_ms`: Milliseconds to wait between tap and next dump. Clamped to [500, 10000].
///
/// ## Security
/// - `max_steps` and `per_step_delay_ms` are numeric — no path or injection risk.
/// - Screenshot output directory is derived from `app_local_data_dir` — system-controlled.
/// - No user-supplied strings reach the file system.
///
/// ## Complexity
/// O(max_steps × n_elements_per_screen). Typically < 50 steps × 500 elements = 25 000 ops.
#[tauri::command]
pub async fn run_smoke_check_cmd(
	app: AppHandle,
	max_steps: Option<u32>,
	per_step_delay_ms: Option<u64>,
) -> Result<SmokeCheckResult, String> {
	let steps = max_steps
		.unwrap_or(DEFAULT_MAX_STEPS)
		.clamp(1, MAX_STEPS_LIMIT);

	let delay = per_step_delay_ms
		.unwrap_or(DEFAULT_STEP_DELAY_MS)
		.clamp(MIN_STEP_DELAY_MS, 10_000);

	emit_log(
		&app,
		LogLevel::Info,
		format!("[command] Starting smoke check: {} steps, {} ms delay", steps, delay),
	)
	.ok();

	// Build a unique run identifier
	let ts = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_millis())
		.unwrap_or(0);
	let run_id = format!("smoke-{}", ts);

	// Screenshots for this run go under <app_local_data>/smoke-screenshots/
	let base_dir = app
		.path_resolver()
		.app_local_data_dir()
		.unwrap_or_else(|| PathBuf::from("reports"));
	let screenshots_dir = base_dir.join("smoke-screenshots");

	run_smoke_check(&app, steps, delay, screenshots_dir, run_id).await
}

/// Signals a running smoke check to stop after the current step.
///
/// This is a best-effort, non-blocking call — the running loop checks the flag
/// at the start of each step.
#[tauri::command]
pub fn stop_smoke_check_cmd() {
	request_smoke_stop();
}

/// Writes an AI-run errored screen report as Markdown and returns the absolute path.
#[tauri::command]
pub fn write_ai_errored_screens_report_cmd(
	app: AppHandle,
	run_id: String,
	steps_done: u32,
	errored_screens: Vec<AiErroredScreenRecord>,
) -> Result<String, String> {
	let base_dir = app
		.path_resolver()
		.app_local_data_dir()
		.unwrap_or_else(|| PathBuf::from("reports"));
	let reports_dir = base_dir.join("ai-reports");
	std::fs::create_dir_all(&reports_dir)
		.map_err(|e| format!("Failed to create AI reports directory: {}", e))?;

	let ts = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_millis())
		.unwrap_or(0);
	let filename = format!("ai-errored-screens-{}-{}.md", run_id, ts);
	let out_path = reports_dir.join(filename);

	let mut md = String::new();
	md.push_str("# AI Test Run Errored Screens\n\n");
	md.push_str(&format!("> **Run ID**: `{}`  \n", run_id));
	md.push_str(&format!("> **Steps executed**: {}  \n", steps_done));
	md.push_str(&format!("> **Errored screens**: {}  \n\n", errored_screens.len()));

	if errored_screens.is_empty() {
		md.push_str("No errored screens were captured.\n");
	} else {
		for item in &errored_screens {
			md.push_str(&format!("## Step {}\n\n", item.step));
			md.push_str(&format!("- **Screen hash**: `{}`\n", item.screen_hash));
			md.push_str(&format!("- **Issue**: {}\n", item.issue));

			if let Some(evidence) = &item.evidence {
				if !evidence.is_empty() {
					md.push_str("- **Evidence**:\n");
					for line in evidence {
						md.push_str(&format!("  - {}\n", line));
					}
				}
			}

			if let Some(path) = &item.screenshot {
				let screenshot_name = std::path::Path::new(path)
					.file_name()
					.and_then(|f| f.to_str())
					.unwrap_or(path.as_str());
				md.push_str(&format!("- **Screenshot**: {}\n", screenshot_name));
			}

			md.push('\n');
		}
	}

	std::fs::write(&out_path, md)
		.map_err(|e| format!("Failed to write AI errored screen report: {}", e))?;

	emit_log(
		&app,
		LogLevel::Info,
		format!("[command] AI errored screen report written: {}", out_path.display()),
	)
	.ok();

	Ok(out_path.to_string_lossy().to_string())
}
