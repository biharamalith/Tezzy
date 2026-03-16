use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;

use crate::core::events::{emit_log, LogLevel};

const DEFAULT_PORT: u16 = 4723;
const REQUEST_TIMEOUT_SECS: u64 = 30;

// ====================== SHARED CLIENT (makes every call faster) ======================
static SHARED_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn get_shared_client() -> &'static reqwest::Client {
    SHARED_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_keepalive(Duration::from_secs(60))
            .build()
            .expect("Failed to build shared HTTP client")
    })
}

// ====================== TYPES ======================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionResponse {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub capabilities: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValueResponse<T> {
    pub value: T,
}

// ====================== FAST DUMP OPTIMIZATIONS ======================
pub async fn optimize_for_fast_dump(
    app: &AppHandle,
    session_id: &str,
    port: Option<u16>,
) -> Result<(), String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session/{}/appium/settings", port, session_id);

    emit_log(app, LogLevel::Info, "[appium-client] Applying fast-dump optimizations (waitForIdleTimeout=0 + snapshotMaxDepth=45)").ok();

    let body = json!({
        "settings": {
            "waitForIdleTimeout": 0,
            "snapshotMaxDepth": 45,
            "waitForSelectorTimeout": 0,
            "ignoreUnimportantViews": true
        }
    });

    send_action_request(&url, &body).await
}

// ====================== CREATE SESSION ======================
pub async fn create_session(
    app: &AppHandle,
    serial: &str,
    app_package: Option<String>,
    port: Option<u16>,
) -> Result<SessionResponse, String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session", port);

    emit_log(app, LogLevel::Info, format!("[appium-client] Creating session for device: {}", serial)).ok();

    let mut capabilities = json!({
        "platformName": "Android",
        "appium:automationName": "UiAutomator2",
        "appium:deviceName": serial,
        "appium:udid": serial,
        "appium:newCommandTimeout": 300,
        "appium:uiautomator2ServerReadTimeout": 30000,
    });

    if let Some(pkg) = app_package {
        capabilities["appium:appPackage"] = json!(pkg);
        capabilities["appium:appActivity"] = json!(".MainActivity");
    }

    let body = json!({
        "capabilities": {
            "alwaysMatch": capabilities,
            "firstMatch": [{}]
        }
    });

    let response = get_shared_client()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("Create session request failed: {}", err))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Create session failed [{}]: {}", status, text));
    }

    let result: ValueResponse<SessionResponse> = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse session response: {}", err))?;

    let _ = optimize_for_fast_dump(app, &result.value.session_id, Some(port)).await;

    emit_log(app, LogLevel::Info, format!("[appium-client] Session created: {}", result.value.session_id)).ok();

    Ok(result.value)
}

// ====================== OTHER FUNCTIONS (all complete) ======================
pub async fn delete_session(
    app: &AppHandle,
    session_id: &str,
    port: Option<u16>,
) -> Result<(), String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session/{}", port, session_id);

    emit_log(app, LogLevel::Info, format!("[appium-client] Deleting session: {}", session_id)).ok();

    let response = get_shared_client()
        .delete(&url)
        .send()
        .await
        .map_err(|err| format!("Delete session request failed: {}", err))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Delete session failed [{}]: {}", status, text));
    }

    emit_log(app, LogLevel::Info, "[appium-client] Session deleted").ok();
    Ok(())
}

pub async fn is_session_alive(session_id: &str, port: Option<u16>) -> bool {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session/{}", port, session_id);

    match get_shared_client()
        .get(&url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

pub async fn get_page_source(session_id: &str, port: Option<u16>) -> Result<String, String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session/{}/source", port, session_id);

    let response = get_shared_client()
        .get(&url)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Page source request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Page source failed [{}]: {}", status, text));
    }

    let result: ValueResponse<String> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse page source response: {}", e))?;

    Ok(result.value)
}

pub async fn tap_xy(
    app: &AppHandle,
    session_id: &str,
    x: i32,
    y: i32,
    port: Option<u16>,
) -> Result<(), String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session/{}/actions", port, session_id);

    emit_log(app, LogLevel::Info, format!("[appium-client] Tap at ({}, {})", x, y)).ok();

    let body = json!({
        "actions": [{
            "type": "pointer",
            "id": "finger",
            "parameters": {"pointerType": "touch"},
            "actions": [
                {"type": "pointerMove", "duration": 0, "x": x, "y": y},
                {"type": "pointerDown", "button": 0},
                {"type": "pause", "duration": 100},
                {"type": "pointerUp", "button": 0}
            ]
        }]
    });

    send_action_request(&url, &body).await?;
    Ok(())
}

pub async fn back(
    app: &AppHandle,
    session_id: &str,
    port: Option<u16>,
) -> Result<(), String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session/{}/back", port, session_id);

    emit_log(app, LogLevel::Info, "[appium-client] Back button").ok();

    send_action_request(&url, &json!({})).await?;
    Ok(())
}

pub async fn swipe(
    app: &AppHandle,
    session_id: &str,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    duration_ms: u64,
    port: Option<u16>,
) -> Result<(), String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session/{}/actions", port, session_id);

    emit_log(app, LogLevel::Info, format!("[appium-client] Swipe from ({},{}) to ({},{})", x1, y1, x2, y2)).ok();

    let body = json!({
        "actions": [{
            "type": "pointer",
            "id": "finger",
            "parameters": {"pointerType": "touch"},
            "actions": [
                {"type": "pointerMove", "duration": 0, "x": x1, "y": y1},
                {"type": "pointerDown", "button": 0},
                {"type": "pause", "duration": 50},
                {"type": "pointerMove", "duration": duration_ms, "x": x2, "y": y2},
                {"type": "pointerUp", "button": 0}
            ]
        }]
    });

    send_action_request(&url, &body).await?;
    Ok(())
}

pub async fn input_text(
    app: &AppHandle,
    session_id: &str,
    text: &str,
    port: Option<u16>,
) -> Result<(), String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session/{}/keys", port, session_id);

    emit_log(app, LogLevel::Info, format!("[appium-client] Input text: {}", text)).ok();

    // W3C WebDriver expects `value` (array of strings). Some servers also accept `text`.
    let value: Vec<String> = text.chars().map(|c| c.to_string()).collect();
    let body = json!({ "text": text, "value": value });
    send_action_request(&url, &body).await?;
    Ok(())
}

pub async fn screenshot(
    app: &AppHandle,
    session_id: &str,
    dest_path: &std::path::Path,
    port: Option<u16>,
) -> Result<String, String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/session/{}/screenshot", port, session_id);

    emit_log(app, LogLevel::Info, "[appium-client] Taking screenshot").ok();

    let response = get_shared_client()
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("Screenshot request failed: {}", err))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Screenshot failed [{}]: {}", status, text));
    }

    let result: ValueResponse<String> = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse screenshot response: {}", err))?;

    use base64::Engine as _;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&result.value)
        .map_err(|err| format!("Failed to decode base64 screenshot: {}", err))?;

    std::fs::write(dest_path, decoded)
        .map_err(|err| format!("Failed to write screenshot: {}", err))?;

    emit_log(app, LogLevel::Info, format!("[appium-client] Screenshot saved: {}", dest_path.display())).ok();

    Ok(dest_path.to_string_lossy().to_string())
}

// ====================== HELPER ======================
async fn send_action_request(url: &str, body: &serde_json::Value) -> Result<(), String> {
    let response = get_shared_client()
        .post(url)
        .json(body)
        .send()
        .await
        .map_err(|err| format!("Action request failed: {}", err))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Action failed [{}] {}: {}", status, url, text));
    }

    Ok(())
}