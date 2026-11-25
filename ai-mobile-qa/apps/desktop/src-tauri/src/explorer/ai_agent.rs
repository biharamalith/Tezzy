//! The single-agent test loop, device side.
//!
//! Each step: take a screenshot, read the UI tree and the crash log, send them to the
//! AI engine (`/v1/agent/step`), execute the one action it returns, wait, repeat.
//! The engine keeps the agent's conversation between steps; this side owns the device,
//! the files and the stop button. At the end `/v1/agent/finish` returns the report,
//! written next to the screenshots as report.md and findings.json.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::commands::ai_engine::post_json_with_start;
use crate::core::events::{emit_log, emit_screenshot_taken, LogLevel};
use crate::core::storage::{get_active_device, get_active_session};
use crate::drivers::ai_engine_server::ensure_ai_engine_running;
use crate::drivers::appium_client;
use crate::drivers::device_signals;
use crate::drivers::uihierarchy::{dump_hierarchy, get_screen_size, parse_elements, UiElement};

const AGENT_TURN_EVENT: &str = "tezzy:agent_turn";
const DEFAULT_MAX_ACTIONS: u32 = 30;
const MAX_ACTIONS_LIMIT: u32 = 100;
const DEFAULT_STEP_DELAY_MS: u64 = 1200;
/// Steps beyond the action budget, for turns where the agent only waits or reports.
const EXTRA_STEPS: u32 = 10;
const ENTER_KEYCODE: u32 = 66;

static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);

/// Asks a running agent to stop after its current step. The agent still writes its report.
pub fn request_stop() {
	STOP_REQUESTED.store(true, Ordering::Relaxed);
}

/// Clears RUNNING when the run ends, whichever way it ends.
struct RunningGuard;
impl Drop for RunningGuard {
	fn drop(&mut self) {
		RUNNING.store(false, Ordering::Relaxed);
	}
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunOptions {
	pub app_name: Option<String>,
	pub goal: Option<String>,
	pub persona: Option<String>,
	pub notes: Option<String>,
	pub email: Option<String>,
	pub password: Option<String>,
	pub max_actions: Option<u32>,
	pub step_delay_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentTurnEvent {
	pub run_id: String,
	pub step: u32,
	pub max_actions: u32,
	pub actions_taken: u32,
	/// "observing" | "action" | "done" | "error"
	pub status: String,
	pub action: Option<String>,
	pub thought: Option<String>,
	pub screen_id: Option<String>,
	pub new_screen: bool,
	pub findings_count: u32,
	pub screenshot: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentRunResult {
	pub run_id: String,
	pub run_dir: String,
	pub model: String,
	/// "finished" | "budget" | "stopped" | "session_lost" | "error"
	pub end_reason: String,
	pub steps: u32,
	pub actions_taken: u32,
	pub findings_count: u32,
	pub screens_reached: u32,
	pub goal_reached: Option<String>,
	pub score: Option<i64>,
	pub summary: Option<String>,
	pub report_path: Option<String>,
	pub error: Option<String>,
}

fn non_empty(v: &Option<String>) -> Option<String> {
	v.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn u32_of(v: &Value, key: &str) -> u32 {
	v.get(key).and_then(Value::as_u64).unwrap_or(0) as u32
}

fn str_of(v: &Value, key: &str) -> Option<String> {
	v.get(key).and_then(Value::as_str).map(str::to_string)
}

fn truncate(s: &str, max: usize) -> String {
	if s.chars().count() <= max {
		return s.to_string();
	}
	format!("{}...", s.chars().take(max).collect::<String>())
}

/// Engine run ids become folder names: accept only what the engine produces.
fn is_safe_run_id(id: &str) -> bool {
	!id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn emit_turn(app: &AppHandle, ev: AgentTurnEvent) {
	let _ = app.emit_all(AGENT_TURN_EVENT, ev);
}

/// The UI tree through Appium (fast), or adb's uiautomator dump when Appium returns nothing.
async fn observe_elements(app: &AppHandle, session_id: &str, serial: &str) -> Vec<UiElement> {
	match appium_client::get_page_source(session_id, None).await {
		Ok(xml) => {
			let parsed = parse_elements(&xml);
			if !parsed.is_empty() {
				return parsed;
			}
		}
		Err(e) => {
			emit_log(app, LogLevel::Debug, format!("[agent] page source failed, using adb dump: {}", e)).ok();
		}
	}
	dump_hierarchy(app, serial).await.unwrap_or_default()
}

/// One retry on a transient failure. An unknown run (engine restarted) is not retried.
async fn post_step(app: &AppHandle, body: &Value) -> Result<Value, String> {
	match post_json_with_start(app, "/agent/step", body).await {
		Ok(v) => Ok(v),
		Err(e) if e.contains("unknown_run") => Err(e),
		Err(e) => {
			emit_log(app, LogLevel::Warn, format!("[agent] step failed, retrying once: {}", truncate(&e, 300))).ok();
			tokio::time::sleep(Duration::from_secs(2)).await;
			post_json_with_start(app, "/agent/step", body).await
		}
	}
}

/// Executes one engine action. Returns the result the agent reads on its next turn.
async fn execute(app: &AppHandle, session_id: &str, serial: &str, action: &Value) -> String {
	let int = |k: &str| action.get(k).and_then(Value::as_i64).map(|v| v as i32);
	let flag = |k: &str| action.get(k).and_then(Value::as_bool).unwrap_or(false);

	let result: Result<(), String> = match action.get("type").and_then(Value::as_str).unwrap_or("") {
		"tap" => match (int("x"), int("y")) {
			(Some(x), Some(y)) => appium_client::tap_xy(app, session_id, x, y, None).await,
			_ => Err("tap without coordinates".to_string()),
		},
		"swipe" => match (int("x"), int("y"), int("x2"), int("y2")) {
			(Some(x1), Some(y1), Some(x2), Some(y2)) => {
				let ms = action.get("duration_ms").and_then(Value::as_u64).unwrap_or(400).clamp(100, 3000);
				appium_client::swipe(app, session_id, x1, y1, x2, y2, ms, None).await
			}
			_ => Err("swipe without coordinates".to_string()),
		},
		"type_text" => {
			let text = action.get("text").and_then(Value::as_str).unwrap_or("");
			if flag("clear_first") {
				let _ = appium_client::clear_focused_field(app, session_id, None).await;
			}
			let mut typed = if text.is_empty() {
				Ok(())
			} else {
				appium_client::input_text(app, session_id, text, None).await
			};
			if typed.is_err() && !text.is_empty() {
				// Some fields refuse Appium's keys; adb types into whatever has focus.
				typed = device_signals::input_text(serial, text).await;
			}
			match typed {
				Ok(()) if flag("submit") => device_signals::key_event(serial, ENTER_KEYCODE).await,
				other => other,
			}
		}
		"back" => appium_client::back(app, session_id, None).await,
		"wait" => {
			let ms = action.get("duration_ms").and_then(Value::as_u64).unwrap_or(1000).clamp(200, 10_000);
			tokio::time::sleep(Duration::from_millis(ms)).await;
			Ok(())
		}
		other => Err(format!("unknown action type '{}'", other)),
	};

	match result {
		Ok(()) => "ok".to_string(),
		Err(e) => format!("failed: {}", truncate(&e, 200)),
	}
}

pub async fn run_ai_agent(
	app: &AppHandle,
	opts: AgentRunOptions,
	runs_dir: PathBuf,
) -> Result<AgentRunResult, String> {
	if RUNNING.swap(true, Ordering::Relaxed) {
		return Err("An AI agent run is already in progress.".to_string());
	}
	let _guard = RunningGuard;
	STOP_REQUESTED.store(false, Ordering::Relaxed);

	// ── Pre-flight ────────────────────────────────────────────────────────
	let serial = get_active_device().ok_or_else(|| "No active device selected".to_string())?;
	let session = get_active_session().ok_or_else(|| {
		"No Appium session active. Open the Automation tab and create a session first.".to_string()
	})?;
	if !appium_client::is_session_alive(&session.session_id, None).await {
		return Err("The Appium session is no longer active. Create a new session first.".to_string());
	}
	ensure_ai_engine_running(app).await?;

	let max_actions = opts.max_actions.unwrap_or(DEFAULT_MAX_ACTIONS).clamp(1, MAX_ACTIONS_LIMIT);
	let delay_ms = opts.step_delay_ms.unwrap_or(DEFAULT_STEP_DELAY_MS).clamp(300, 10_000);
	let (screen_w, screen_h) = get_screen_size(&serial).await.unwrap_or((1080, 1920));
	let density = device_signals::screen_density(&serial).await;

	let mut start = json!({
		"app_name": non_empty(&opts.app_name).unwrap_or_else(|| "the app".to_string()),
		"max_actions": max_actions,
		"screen_width": screen_w,
		"screen_height": screen_h,
		"density_dpi": density,
	});
	if let Some(goal) = non_empty(&opts.goal) {
		start["goal"] = json!(goal);
	}
	if let Some(persona) = non_empty(&opts.persona) {
		start["persona"] = json!(persona);
	}
	if let Some(notes) = non_empty(&opts.notes) {
		start["notes"] = json!(notes);
	}
	let (email, password) = (non_empty(&opts.email), non_empty(&opts.password));
	if email.is_some() || password.is_some() {
		start["credentials"] = json!({ "email": email, "password": password });
	}

	let started = post_json_with_start(app, "/agent/start", &start).await?;
	let run_id = str_of(&started, "run_id").unwrap_or_default();
	if !is_safe_run_id(&run_id) {
		return Err("The AI engine returned an invalid run id.".to_string());
	}
	let model = str_of(&started, "model").unwrap_or_default();
	let run_dir = runs_dir.join(&run_id);
	std::fs::create_dir_all(&run_dir).map_err(|e| format!("Cannot create run folder: {}", e))?;

	emit_log(
		app,
		LogLevel::Info,
		format!(
			"[agent] {} started: model {}, {} actions, screen {}x{} @ {} dpi",
			run_id, model, max_actions, screen_w, screen_h, density
		),
	)
	.ok();
	device_signals::clear_logcat(&serial).await;

	// ── Loop ──────────────────────────────────────────────────────────────
	let mut step: u32 = 0;
	let mut actions_taken: u32 = 0;
	let mut findings_count: u32 = 0;
	let mut last_result: Option<String> = None;
	let mut end_reason = "budget".to_string();
	let mut error: Option<String> = None;

	while step < max_actions + EXTRA_STEPS {
		if STOP_REQUESTED.load(Ordering::Relaxed) {
			end_reason = "stopped".to_string();
			break;
		}
		step += 1;

		// Observe.
		let shot = run_dir.join(format!("{:02}.png", step));
		let (shot_path, shot_b64) =
			match appium_client::screenshot_with_b64(app, &session.session_id, &shot, None).await {
				Ok((path, b64)) => (Some(path), Some(b64)),
				Err(e) => {
					if !appium_client::is_session_alive(&session.session_id, None).await {
						end_reason = "session_lost".to_string();
						error = Some(format!("Appium session lost: {}", truncate(&e, 200)));
						break;
					}
					emit_log(app, LogLevel::Warn, format!("[agent] screenshot failed: {}", truncate(&e, 200))).ok();
					(None, None)
				}
			};
		if let Some(p) = &shot_path {
			emit_screenshot_taken(app, p).ok();
		}
		let elements = observe_elements(app, &session.session_id, &serial).await;
		let crash_log = device_signals::read_crash_log(&serial).await;
		if !crash_log.is_empty() {
			emit_log(app, LogLevel::Warn, format!("[agent] {} crash log line(s) at step {}", crash_log.len(), step)).ok();
		}
		emit_turn(app, AgentTurnEvent {
			run_id: run_id.clone(), step, max_actions, actions_taken, status: "observing".to_string(),
			action: None, thought: None, screen_id: None, new_screen: false, findings_count,
			screenshot: shot_path.clone(),
		});

		// Decide.
		let body = json!({
			"run_id": run_id,
			"step": step,
			"screenshot_b64": shot_b64,
			"elements": elements,
			"crash_log": crash_log,
			"last_action_result": last_result,
		});
		let resp = match post_step(app, &body).await {
			Ok(v) => v,
			Err(e) => {
				end_reason = "error".to_string();
				error = Some(truncate(&e, 500));
				break;
			}
		};
		actions_taken = u32_of(&resp, "actions_taken");
		findings_count = u32_of(&resp, "findings_count");
		let thought = str_of(&resp, "thought").map(|t| truncate(&t, 400));
		let screen_id = str_of(&resp, "screen_id");
		let new_screen = resp.get("new_screen").and_then(Value::as_bool).unwrap_or(false);

		if resp.get("status").and_then(Value::as_str) == Some("done") {
			end_reason = if actions_taken >= max_actions { "budget" } else { "finished" }.to_string();
			emit_turn(app, AgentTurnEvent {
				run_id: run_id.clone(), step, max_actions, actions_taken, status: "done".to_string(),
				action: None, thought, screen_id, new_screen, findings_count, screenshot: shot_path,
			});
			break;
		}

		// Act.
		let action = resp.get("action").cloned().unwrap_or(Value::Null);
		let label = str_of(&action, "label").unwrap_or_else(|| "?".to_string());
		emit_log(
			app,
			LogLevel::Info,
			format!(
				"[agent] step {} ({}): {}{}",
				step,
				screen_id.clone().unwrap_or_default(),
				label,
				thought.as_ref().map(|t| format!(" - {}", t)).unwrap_or_default()
			),
		)
		.ok();
		emit_turn(app, AgentTurnEvent {
			run_id: run_id.clone(), step, max_actions, actions_taken, status: "action".to_string(),
			action: Some(label), thought, screen_id, new_screen, findings_count, screenshot: shot_path,
		});

		let result = execute(app, &session.session_id, &serial, &action).await;
		if result != "ok" {
			emit_log(app, LogLevel::Warn, format!("[agent] action {}", result)).ok();
			if !appium_client::is_session_alive(&session.session_id, None).await {
				end_reason = "session_lost".to_string();
				error = Some("Appium session lost after an action (the app may have crashed).".to_string());
				break;
			}
		}
		last_result = Some(result);
		tokio::time::sleep(Duration::from_millis(delay_ms)).await;
	}

	// ── Report ────────────────────────────────────────────────────────────
	let mut result = AgentRunResult {
		run_id: run_id.clone(),
		run_dir: run_dir.to_string_lossy().to_string(),
		model,
		end_reason: end_reason.clone(),
		steps: step,
		actions_taken,
		findings_count,
		screens_reached: 0,
		goal_reached: None,
		score: None,
		summary: None,
		report_path: None,
		error,
	};

	match post_json_with_start(app, "/agent/finish", &json!({ "run_id": run_id, "reason": end_reason })).await {
		Ok(mut report) => {
			let final_ = report.get("final").cloned().unwrap_or(Value::Null);
			result.goal_reached = str_of(&final_, "goal_reached");
			result.score = final_.get("score").and_then(Value::as_i64);
			result.summary = str_of(&final_, "summary");
			result.end_reason = str_of(&final_, "end_reason").unwrap_or(result.end_reason);
			result.actions_taken = u32_of(&report, "actions_taken");
			result.screens_reached = u32_of(&report, "screens_reached");
			result.findings_count = report.get("findings").and_then(Value::as_array).map_or(0, |f| f.len() as u32);

			let markdown = report
				.as_object_mut()
				.and_then(|o| o.remove("markdown"))
				.and_then(|m| m.as_str().map(str::to_string))
				.unwrap_or_default();
			let report_path = run_dir.join("report.md");
			match std::fs::write(&report_path, markdown) {
				Ok(()) => result.report_path = Some(report_path.to_string_lossy().to_string()),
				Err(e) => {
					emit_log(app, LogLevel::Error, format!("[agent] cannot write report.md: {}", e)).ok();
				}
			}
			let findings_json = serde_json::to_string_pretty(&report).unwrap_or_default();
			if let Err(e) = std::fs::write(run_dir.join("findings.json"), findings_json) {
				emit_log(app, LogLevel::Error, format!("[agent] cannot write findings.json: {}", e)).ok();
			}
		}
		Err(e) => {
			let msg = format!("Report not written: {}", truncate(&e, 300));
			emit_log(app, LogLevel::Error, format!("[agent] {}", msg)).ok();
			result.error = Some(result.error.map_or(msg.clone(), |prev| format!("{} | {}", prev, msg)));
		}
	}

	emit_log(
		app,
		LogLevel::Info,
		format!(
			"[agent] {} ended ({}): {} actions, {} screens, {} issues. Report: {}",
			result.run_id,
			result.end_reason,
			result.actions_taken,
			result.screens_reached,
			result.findings_count,
			result.report_path.clone().unwrap_or_else(|| "none".to_string())
		),
	)
	.ok();
	emit_turn(app, AgentTurnEvent {
		run_id: result.run_id.clone(), step, max_actions, actions_taken: result.actions_taken,
		status: if result.error.is_some() { "error" } else { "done" }.to_string(),
		action: None, thought: result.summary.clone(), screen_id: None, new_screen: false,
		findings_count: result.findings_count, screenshot: None,
	});
	Ok(result)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn run_ids_from_the_engine_are_the_only_folder_names() {
		assert!(is_safe_run_id("agent-0123456789ab"));
		assert!(!is_safe_run_id("../etc"));
		assert!(!is_safe_run_id("agent/1"));
		assert!(!is_safe_run_id(""));
	}

	#[test]
	fn truncate_keeps_short_strings() {
		assert_eq!(truncate("abc", 5), "abc");
		assert_eq!(truncate("abcdef", 3), "abc...");
	}
}
