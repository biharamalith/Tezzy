use serde_json::Value;
use tauri::AppHandle;

fn ai_engine_base_url() -> String {
	let raw = std::env::var("TEZZY_AI_ENGINE_URL").unwrap_or_else(|_| "http://127.0.0.1:8010/v1".to_string());
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
		return Err(format!("AI engine error [{}] {}: {}", status.as_u16(), url, text));
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
