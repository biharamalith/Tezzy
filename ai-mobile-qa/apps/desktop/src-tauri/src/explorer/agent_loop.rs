use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
use tauri::AppHandle;

use crate::commands::ai_engine::vision_analyze_screenshot;
use crate::core::events::{emit_log, emit_run_progress, LogLevel};
use crate::core::storage::{
	clear_smoke_stop, get_active_device, get_active_session, is_smoke_stop_requested,
};
use crate::drivers::appium_client;
use crate::drivers::uihierarchy::{dump_hierarchy, get_screen_size, parse_elements};
use crate::explorer::policies::{elem_key, select_candidate};
use crate::explorer::scoring::screen_hash;

// ── Result types ────────────────────────────────────────────────────────────

/// Record for one step inside a smoke check run.
#[derive(Debug, Clone, Serialize)]
pub struct SmokeStepRecord {
	pub step_num: u32,
	/// Short action description, e.g. "tap:OK", "dead_tap", "no_elements".
	pub action: String,
	/// Outcome of the step: "ok" | "dead_tap" | "loop" | "crash" | "stopped".
	pub result_status: String,
	/// Absolute path to the screenshot taken at this step, if any.
	pub screenshot: Option<String>,
}

/// A finding flagged during the smoke check — something worth the user's attention.
#[derive(Debug, Clone, Serialize)]
pub struct SmokeFinding {
	pub step: u32,
	/// "info" | "warn" | "error"
	pub severity: String,
	pub message: String,
}

/// Complete result returned after `run_smoke_check` completes.
#[derive(Debug, Clone, Serialize)]
pub struct SmokeCheckResult {
	pub run_id: String,
	pub device_serial: String,
	pub max_steps: u32,
	pub steps_done: u32,
	/// "complete" | "stopped" | "crash" | "loop" | "no_elements"
	pub final_status: String,
	pub findings: Vec<SmokeFinding>,
	pub steps: Vec<SmokeStepRecord>,
	/// Absolute path to the generated markdown report, if written successfully.
	pub report_path: Option<String>,
}

// ── Constants ────────────────────────────────────────────────────────────────

/// How many consecutive identical screen hashes trigger a "loop" detection.
const LOOP_THRESHOLD: u32 = 3;

// ── Main entry point ─────────────────────────────────────────────────────────

/// Runs a heuristic smoke check, tapping through the app up to `max_steps` times.
///
/// ## Algorithm
/// 1. Dump UI hierarchy.
/// 2. Compute `screenHash` from all element text / resource-ids / bounds.
/// 3. Select a candidate node using the three-pass heuristic in `policies.rs`.
/// 4. Tap the node center via Appium.
/// 5. Wait `per_step_delay_ms`.
/// 6. Re-dump UI; compare hash.
///    - Unchanged → record `dead_tap`.
///    - Hash seen ≥ 3 times → record `loop`, stop.
/// 7. Take a screenshot for each step.
/// 8. After all steps, write a markdown report.
///
/// ## Security
/// - All taps go through `appium_client::tap_xy` which talks to `127.0.0.1` only.
/// - Serial and session_id are sourced from locked in-process storage (validated at set time).
/// - Screenshot paths are built from controlled components only.
/// - No shell invocation; no user-controlled strings reach the file system.
///
/// ## Complexity
/// O(max_steps × n_elements) — hierarchy dump + hash + policy selection per step.
/// With n_elements < 500 and max_steps ≤ 50, this is ~25 000 iterations per run: negligible.
pub async fn run_smoke_check(
	app: &AppHandle,
	max_steps: u32,
	per_step_delay_ms: u64,
	screenshots_dir: PathBuf,
	run_id: String,
) -> Result<SmokeCheckResult, String> {
	// ── Pre-flight ────────────────────────────────────────────────────────
	let serial =
		get_active_device().ok_or_else(|| "No active device selected".to_string())?;
	let session =
		get_active_session().ok_or_else(|| {
			"No Appium session active. Open the Session panel and click 'Create Session' first.".to_string()
		})?;

	// Verify the session is still alive before starting — avoids a confusing
	// "crash" finding when the user's app was already closed/uninstalled.
	if !appium_client::is_session_alive(&session.session_id, None).await {
		return Err(
			"Appium session is no longer active (the app may have crashed or been closed). \
			 Please create a new session in the Session panel before running the smoke check."
			.to_string(),
		);
	}

	clear_smoke_stop();

	let smoke_dir = screenshots_dir.join(&run_id);
	std::fs::create_dir_all(&smoke_dir)
		.map_err(|e| format!("Cannot create smoke screenshots folder: {}", e))?;

	emit_log(
		app,
		LogLevel::Info,
		format!(
			"[smoke] Starting smoke check — max {} steps, {}ms delay",
			max_steps, per_step_delay_ms
		),
	)
	.ok();

	// ── State ─────────────────────────────────────────────────────────────
	let mut steps: Vec<SmokeStepRecord> = Vec::new();
	let mut findings: Vec<SmokeFinding> = Vec::new();
	let mut seen_keys: HashSet<String> = HashSet::new();
	let mut hash_counts: HashMap<String, u32> = HashMap::new();
	let mut final_status = "complete".to_string();
	let mut step_num: u32 = 0;
	let mut no_elements_streak: u32 = 0;

	let (screen_w, screen_h) = get_screen_size(&serial).await.unwrap_or((1080, 1920));

	// ── Step loop ─────────────────────────────────────────────────────────
	while step_num < max_steps {
		// Check stop flag first
		if is_smoke_stop_requested() {
			emit_log(app, LogLevel::Info, "[smoke] Stop requested — aborting run").ok();
			emit_run_progress(app, step_num, max_steps, "stopped", "stopped", None).ok();
			final_status = "stopped".to_string();
			break;
		}

		step_num += 1;

		// — 1. Get UI hierarchy via Appium page source ——————————————————
		// Smoke check always runs with an active Appium session, so we use
		// get_page_source directly — no adb round-trip, typically < 2 seconds.
		let elements = match appium_client::get_page_source(&session.session_id, None).await {
			Ok(xml) => {
				let parsed = parse_elements(&xml);
				if parsed.is_empty() {
					emit_log(
						app,
						LogLevel::Debug,
						"[smoke] Appium source parsed to 0 elements, falling back to adb dump",
					)
					.ok();
					dump_hierarchy(app, &serial).await.unwrap_or_default()
				} else {
					parsed
				}
			}
			Err(e) => {
				// A failed dump after a tap is a strong crash signal.
				let msg = format!("UI dump failed at step {}: {}", step_num, e);
				emit_log(app, LogLevel::Warn, &msg).ok();
				findings.push(SmokeFinding {
					step: step_num,
					severity: "error".to_string(),
					message: format!("Possible crash or unresponsive app: {}", e),
				});
				emit_run_progress(
					app, step_num, max_steps, "crash", "error", None,
				)
				.ok();
				steps.push(SmokeStepRecord {
					step_num,
					action: "crash".to_string(),
					result_status: "crash".to_string(),
					screenshot: None,
				});
				final_status = "crash".to_string();
				break;
			}
		};

		// — 2. Compute screen hash ——————————————————————————————————————
		let current_hash = screen_hash(&elements);
		let hash_count = hash_counts.entry(current_hash.clone()).or_insert(0);
		*hash_count += 1;

		if *hash_count >= LOOP_THRESHOLD {
			let msg = format!("Loop detected at step {} — same screen hash seen {} times", step_num, hash_count);
			emit_log(app, LogLevel::Warn, &msg).ok();
			findings.push(SmokeFinding {
				step: step_num,
				severity: "warn".to_string(),
				message: msg.clone(),
			});
			emit_run_progress(app, step_num, max_steps, "loop", "warn", None).ok();
			steps.push(SmokeStepRecord {
				step_num,
				action: "loop".to_string(),
				result_status: "loop".to_string(),
				screenshot: None,
			});
			final_status = "loop".to_string();
			break;
		}

		// — 3. Select candidate ——————————————————————————————————————
		let candidate = match select_candidate(&elements, &seen_keys) {
			Some(c) => c,
			None => {
				no_elements_streak += 1;
				emit_log(
					app,
					LogLevel::Info,
					format!("[smoke] Step {}: no interactable elements found", step_num),
				)
				.ok();

				let swipe_x = screen_w / 2;
				let swipe_y1 = (screen_h as f32 * 0.75) as i32;
				let swipe_y2 = (screen_h as f32 * 0.25) as i32;
				let swipe_action = "fallback_swipe".to_string();

				emit_run_progress(
					app, step_num, max_steps, &swipe_action, "warn", None,
				)
				.ok();

				let _ = appium_client::swipe(
					app,
					&session.session_id,
					swipe_x,
					swipe_y1,
					swipe_x,
					swipe_y2,
					600,
					None,
				)
				.await;

				if per_step_delay_ms > 0 {
					tokio::time::sleep(Duration::from_millis(per_step_delay_ms)).await;
				}

				let screenshot_filename = format!("step-{:03}-no_elements.png", step_num);
				let screenshot_path = smoke_dir.join(&screenshot_filename);
				let saved_screenshot = appium_client::screenshot(
					app,
					&session.session_id,
					&screenshot_path,
					None,
				)
				.await
				.ok();

				steps.push(SmokeStepRecord {
					step_num,
					action: "no_elements".to_string(),
					result_status: "warn".to_string(),
					screenshot: saved_screenshot,
				});

				if no_elements_streak >= 3 {
					final_status = "no_elements".to_string();
					break;
				}

				continue;
			}
		};

		// Build action label from candidate text / id
		let label = if !candidate.text.is_empty() {
			candidate.text.clone()
		} else if !candidate.content_desc.is_empty() {
			candidate.content_desc.clone()
		} else if !candidate.resource_id.is_empty() {
			// Strip package prefix for brevity
			candidate
				.resource_id
				.split('/')
				.last()
				.unwrap_or(&candidate.resource_id)
				.to_string()
		} else {
			format!("{}@({},{})", candidate.class, candidate.center_x, candidate.center_y)
		};
		let action = format!("tap:{}", label);

		// Mark key as seen before tapping (prevents infinite re-tap on dead taps)
		seen_keys.insert(elem_key(candidate));

		let (tap_x, tap_y) = (candidate.center_x, candidate.center_y);

		// — 4. Emit step start ——————————————————————————————————————
		emit_log(
			app,
			LogLevel::Info,
			format!("[smoke] Step {}/{}: {}", step_num, max_steps, action),
		)
		.ok();
		emit_run_progress(app, step_num, max_steps, &action, "running", None).ok();

		// — 5. Tap ——————————————————————————————————————————————————
		let tap_result = appium_client::tap_xy(
			app,
			&session.session_id,
			tap_x,
			tap_y,
			None,
		)
		.await;

		if let Err(ref e) = tap_result {
			// Appium session errors often mean the app crashed / closed
			let msg = format!("Tap failed at step {}: {}", step_num, e);
			emit_log(app, LogLevel::Warn, &msg).ok();
			findings.push(SmokeFinding {
				step: step_num,
				severity: "error".to_string(),
				message: format!("Tap failed — possible crash or session lost: {}", e),
			});
			emit_run_progress(app, step_num, max_steps, &action, "error", None)
				.ok();
			steps.push(SmokeStepRecord {
				step_num,
				action,
				result_status: "crash".to_string(),
				screenshot: None,
			});
			final_status = "crash".to_string();
			break;
		}

		// — 6. Wait ——————————————————————————————————————————————————
		if per_step_delay_ms > 0 {
			tokio::time::sleep(Duration::from_millis(per_step_delay_ms)).await;
		}

		// — 7. Screenshot ——————————————————————————————————————————————
		let timestamp = std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.unwrap_or_default()
			.as_millis();
		let screenshot_filename = format!("step-{:03}-{}.png", step_num, timestamp);
		let screenshot_path = smoke_dir.join(&screenshot_filename);

		let saved_screenshot = appium_client::screenshot(
			app,
			&session.session_id,
			&screenshot_path,
			None,
		)
		.await
		.ok();

		// — 7b. Vision analysis ——————————————————————————————————————————————
		// Read the saved PNG, re-encode to base64, and send to GPT-4o vision.
		// This is non-fatal: if the AI engine is unreachable or the call fails,
		// the loop continues normally without vision findings for this step.
		if let Some(ref path_str) = saved_screenshot {
			if let Ok(png_bytes) = std::fs::read(path_str) {
				let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
				if let Some(vision_result) = vision_analyze_screenshot(&b64, step_num, &current_hash).await {
					// Log a summary of what vision detected
					let vision_summary = vision_result
						.get("summary")
						.and_then(|v| v.as_str())
						.unwrap_or("Vision analysis complete");
					emit_log(
						app,
						LogLevel::Info,
						format!("[vision] Step {}: {}", step_num, vision_summary),
					)
					.ok();

					// Convert vision issues into SmokeFinding entries
					if let Some(issues) = vision_result.get("issues").and_then(|v| v.as_array()) {
						for issue in issues {
							let severity = issue
								.get("severity")
								.and_then(|v| v.as_str())
								.unwrap_or("info");
							// Only surface error and warn issues in the findings list
							if severity == "info" {
								continue;
							}
							let issue_type = issue
								.get("type")
								.and_then(|v| v.as_str())
								.unwrap_or("other");
							let description = issue
								.get("description")
								.and_then(|v| v.as_str())
								.unwrap_or("Visual defect detected");
							let region = issue
								.get("region")
								.and_then(|v| v.as_str())
								.map(|r| format!(" [{}]", r))
								.unwrap_or_default();
							let msg = format!(
								"[vision] {}{}: {}",
								issue_type, region, description
							);
							emit_log(app, LogLevel::Warn, &msg).ok();
							findings.push(SmokeFinding {
								step: step_num,
								severity: severity.to_string(),
								message: msg,
							});
						}
					}
				}
			}
		}

		// — 8. Re-read hierarchy and compare hash ————————————————————————
		let post_elements = match appium_client::get_page_source(&session.session_id, None).await {
			Ok(xml) => {
				let parsed = parse_elements(&xml);
				if parsed.is_empty() {
					emit_log(
						app,
						LogLevel::Debug,
						"[smoke] Post-tap Appium source parsed to 0 elements, falling back to adb dump",
					)
					.ok();
					dump_hierarchy(app, &serial).await.unwrap_or_default()
				} else {
					parsed
				}
			}
			Err(_) => dump_hierarchy(app, &serial).await.unwrap_or_default(),
		};
		let post_hash = screen_hash(&post_elements);

		let (result_status, finding) = if post_hash == current_hash {
			let msg = format!("Dead tap at step {}: tapped '{}' but screen unchanged", step_num, label);
			emit_log(app, LogLevel::Warn, &msg).ok();
			emit_run_progress(
				app, step_num, max_steps, "dead_tap", "warn",
				saved_screenshot.clone(),
			)
			.ok();
			let f = SmokeFinding {
				step: step_num,
				severity: "warn".to_string(),
				message: msg,
			};
			("dead_tap".to_string(), Some(f))
		} else {
			// Update hash count for new hash
			*hash_counts.entry(post_hash).or_insert(0) += 1;
			emit_run_progress(
				app, step_num, max_steps, &action, "running",
				saved_screenshot.clone(),
			)
			.ok();
			("ok".to_string(), None)
		};

		if let Some(f) = finding {
			findings.push(f);
		}

		steps.push(SmokeStepRecord {
			step_num,
			action,
			result_status,
			screenshot: saved_screenshot,
		});
	}

	// Emit final done event
	emit_run_progress(app, step_num, max_steps, &final_status, "done", None).ok();
	emit_log(
		app,
		LogLevel::Info,
		format!("[smoke] Run complete — {} steps, {} findings, status: {}", step_num, findings.len(), final_status),
	)
	.ok();

	// Write markdown report
	let report_path_buf = smoke_dir.join("smoke_report.md");
	let result = SmokeCheckResult {
		run_id: run_id.clone(),
		device_serial: serial.clone(),
		max_steps,
		steps_done: step_num,
		final_status: final_status.clone(),
		findings: findings.clone(),
		steps: steps.clone(),
		report_path: None,
	};

	let report_path = match crate::reporting::markdown::write_smoke_report(&result, &report_path_buf) {
		Ok(()) => {
			emit_log(
				app,
				LogLevel::Info,
				format!("[smoke] Report written: {}", report_path_buf.display()),
			)
			.ok();
			Some(report_path_buf.to_string_lossy().to_string())
		}
		Err(e) => {
			emit_log(app, LogLevel::Warn, format!("[smoke] Report write failed: {}", e)).ok();
			None
		}
	};

	Ok(SmokeCheckResult {
		report_path,
		..result
	})
}
