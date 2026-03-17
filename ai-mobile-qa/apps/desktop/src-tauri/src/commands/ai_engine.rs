use serde_json::Value;
use tauri::AppHandle;

pub fn get_ai_engine_base_url() -> String {
	ai_engine_base_url()
}

fn ai_engine_base_url() -> String {
	let raw = std::env::var("TEZZY_AI_ENGINE_URL")
		.unwrap_or_else(|_| "http://127.0.0.1:8010/v1".to_string());
	raw.trim_end_matches('/').to_string()
}

async fn post_json(path: &str, payload: &Value) -> Result<Value, String> {
	let base = ai_engine_base_url();
	let url = format!("{}{}", base, path);

	let client = reqwest::Client::new();
	let resp = client
		.post(&url)
		.json(payload)
		.send()
		.await
		.map_err(|e| format!("AI engine request failed: {}", e))?;

	let status = resp.status();
	let text = resp.text().await.unwrap_or_default();

	if !status.is_success() {
		return Err(format!(
			"AI engine error [{}] {}: {}",
			status.as_u16(),
			url,
			text
		));
	}

	serde_json::from_str::<Value>(&text)
		.map_err(|e| format!("AI engine returned non-JSON: {}\nRaw: {}", e, text))
}

/// Calls the AI engine /v1/run/step endpoint.
#[tauri::command]
pub async fn ai_run_step_cmd(_app: AppHandle, payload: Value) -> Result<Value, String> {
	post_json("/run/step", &payload).await
}

/// Calls the AI engine /v1/session/bootstrap endpoint.
#[tauri::command]
pub async fn ai_session_bootstrap_cmd(_app: AppHandle, payload: Value) -> Result<Value, String> {
	post_json("/session/bootstrap", &payload).await
}

/// Sends a base64-encoded screenshot to the AI engine /v1/vision/analyze endpoint.
/// Returns the raw JSON response. Non-fatal: returns `None` on any error.
pub async fn vision_analyze_screenshot(
	screenshot_b64: &str,
	step: u32,
	screen_hash: &str,
) -> Option<Value> {
	let payload = serde_json::json!({
		"screenshot_b64": screenshot_b64,
		"step": step,
		"screen_hash": screen_hash,
	});
	match post_json("/vision/analyze", &payload).await {
		Ok(v) => Some(v),
		Err(e) => {
			eprintln!("[vision] analyze failed (non-fatal): {}", e);
			None
		}
	}
}

/// Takes a screenshot via Appium (saving it to disk), then immediately sends the
/// raw base64 to the vision analyst in one Tauri round-trip.
///
/// Returns JSON:
/// ```json
/// { "screenshot_path": "...", "vision": { "has_issues": bool, "issues": [...], "summary": "..." } | null }
/// ```
///
/// Vision errors are non-fatal — `vision` will be `null` and the AI loop continues.
#[tauri::command]
pub async fn ai_vision_screenshot_cmd(
	app: AppHandle,
	step: u32,
	screen_hash: String,
) -> Result<Value, String> {
	use std::path::PathBuf;
	use crate::core::events::{emit_log, emit_screenshot_taken, LogLevel};
	use crate::core::storage::get_active_session;
	use crate::drivers::appium_client;

	// ── resolve active session ────────────────────────────────────────────
	let session = match get_active_session() {
		Some(s) => s,
		None => return Err("No active Appium session".to_string()),
	};

	// ── build output path ─────────────────────────────────────────────────
	let base_dir = app
		.path_resolver()
		.app_local_data_dir()
		.unwrap_or_else(|| PathBuf::from("reports"));
	let screenshots_dir = base_dir.join("screenshots");
	std::fs::create_dir_all(&screenshots_dir)
		.map_err(|e| format!("Failed to create screenshots dir: {}", e))?;

	let timestamp = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.unwrap()
		.as_millis();
	let filename = format!("screenshot-{}.png", timestamp);
	let dest_path = screenshots_dir.join(&filename);

	// ── take screenshot and get back both the file path AND the raw base64 ─
	let (screenshot_path, raw_b64) =
		appium_client::screenshot_with_b64(&app, &session.session_id, &dest_path, None).await?;

	// Notify the UI so the screenshots strip updates immediately
	emit_screenshot_taken(&app, &screenshot_path).ok();
	emit_log(
		&app,
		LogLevel::Info,
		format!("[vision] step {}: screenshot saved → {}", step, screenshot_path),
	)
	.ok();

	// ── call vision analyst (non-fatal) ───────────────────────────────────
	let vision = vision_analyze_screenshot(&raw_b64, step, &screen_hash).await;

	if let Some(ref v) = vision {
		let has_issues = v
			.get("has_issues")
			.and_then(|x| x.as_bool())
			.unwrap_or(false);
		emit_log(
			&app,
			LogLevel::Info,
			format!("[vision] step {}: has_issues={}", step, has_issues),
		)
		.ok();
	}

	Ok(serde_json::json!({
		"screenshot_path": screenshot_path,
		"vision": vision,
	}))
}
