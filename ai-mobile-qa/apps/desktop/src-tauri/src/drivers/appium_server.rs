use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;

use crate::core::android_env::android_env_vars;
use crate::core::events::{emit_appium_state, emit_log, LogLevel};

#[derive(Debug, Clone, Serialize)]
pub struct AppiumInstallInfo {
    pub installed: bool,
    pub appium_path: PathBuf,
    pub node_path: PathBuf,
}

#[derive(Debug)]
pub struct AppiumServerHandle {
    child: Child,
    port: u16,
}

static APPIUM_SERVER: OnceLock<Mutex<Option<AppiumServerHandle>>> = OnceLock::new();

fn server_store() -> &'static Mutex<Option<AppiumServerHandle>> {
    APPIUM_SERVER.get_or_init(|| Mutex::new(None))
}

const DEFAULT_APPIUM_PORT: u16 = 4723;

/// Finds appium by probing known npm-global locations.
/// Tauri processes do not inherit the full shell PATH, so we check
/// %APPDATA%\npm\ and other common locations directly.
fn find_appium() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(&appdata).join("npm").join("appium.cmd"));
        }
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&localappdata).join("npm").join("appium.cmd"));
        }
        candidates.push(PathBuf::from(r"C:\Program Files\nodejs\appium.cmd"));
        candidates.push(PathBuf::from("appium.cmd"));
    } else {
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(&home).join(".npm-global").join("bin").join("appium"));
            candidates.push(PathBuf::from(&home).join(".local").join("bin").join("appium"));
        }
        candidates.push(PathBuf::from("/usr/local/bin/appium"));
        candidates.push(PathBuf::from("/usr/bin/appium"));
        candidates.push(PathBuf::from("appium"));
    }
    candidates.into_iter().find(|p| p.exists())
}

fn probe_appium() -> Option<(PathBuf, String)> {
    let path = find_appium()?;
    let output = Command::new(&path)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    let ver = if output.status.success() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    } else {
        let s = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if s.is_empty() { return None; } else { s }
    };
    Some((path, ver))
}

/// Checks appium is reachable. Returns an error with install instructions if not found.
pub async fn ensure_appium_installed(app: &AppHandle) -> Result<AppiumInstallInfo, String> {
    match probe_appium() {
        Some((path, ver)) => {
            emit_log(app, LogLevel::Info, format!("[appium] Found: {} (v{})", path.display(), ver)).ok();
            emit_appium_state(app, "ready", Some(format!("Appium {} ready", ver)), None).ok();
            Ok(AppiumInstallInfo { installed: true, appium_path: path, node_path: PathBuf::from("node") })
        }
        None => {
            let msg = "Appium not found. Open a terminal and run:  (1) npm logout  (2) npm install -g appium  (3) appium driver install uiautomator2  — then restart Tezzy.";
            emit_appium_state(app, "error", Some(msg.to_string()), None).ok();
            emit_log(app, LogLevel::Info, format!("[appium] {}", msg)).ok();
            Err(msg.to_string())
        }
    }
}

/// Starts Appium on localhost immediately. Finds executable, spawns, polls /status.
pub async fn start_appium_server(app: &AppHandle, port: Option<u16>) -> Result<String, String> {
    let port = port.unwrap_or(DEFAULT_APPIUM_PORT);

    {
        let guard = server_store().lock().unwrap();
        if guard.is_some() {
            return Err("Appium server is already running".to_string());
        }
    }

    let appium_path = find_appium().ok_or_else(|| {
        let msg = "Appium not found. Run in a terminal:  (1) npm logout  (2) npm install -g appium  (3) appium driver install uiautomator2  — then restart Tezzy.";
        emit_appium_state(app, "error", Some(msg.to_string()), None).ok();
        emit_log(app, LogLevel::Info, format!("[appium] {}", msg)).ok();
        msg.to_string()
    })?;

    emit_log(app, LogLevel::Info, format!("[appium] Spawning: {} --address 127.0.0.1 --port {}", appium_path.display(), port)).ok();
    emit_appium_state(app, "starting", Some(format!("Starting on port {}...", port)), Some(port)).ok();

    let mut cmd = Command::new(&appium_path);
    cmd.args(["--address", "127.0.0.1", "--port", &port.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for (k, v) in android_env_vars() {
        emit_log(app, LogLevel::Info, format!("[appium] env {}={}", k, if k == "PATH" { "<path>".to_string() } else { v.clone() })).ok();
        cmd.env(k, v);
    }
    let child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn Appium ({}): {}", appium_path.display(), e))?;

    let pid = child.id();
    { let mut g = server_store().lock().unwrap(); *g = Some(AppiumServerHandle { child, port }); }

    emit_log(app, LogLevel::Info, format!("[appium] PID {} - waiting for /status...", pid)).ok();

    for attempt in 1u8..=20 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if health_check(port).await.is_ok() {
            emit_log(app, LogLevel::Info, format!("[appium] Ready after {}s", attempt)).ok();
            emit_appium_state(app, "running", Some(format!("Listening on :{}", port)), Some(port)).ok();
            return Ok(format!("Appium running on 127.0.0.1:{}", port));
        }
    }

    emit_appium_state(app, "running", Some("Starting (slow)...".to_string()), Some(port)).ok();
    Ok(format!("Appium starting on 127.0.0.1:{}", port))
}

pub fn stop_appium_server(app: &AppHandle) -> Result<String, String> {
    let mut guard = server_store().lock().unwrap();
    match guard.take() {
        Some(mut handle) => {
            emit_log(app, LogLevel::Info, "[appium] Stopping...").ok();
            handle.child.kill().map_err(|e| format!("Failed to kill Appium: {}", e))?;
            emit_log(app, LogLevel::Info, "[appium] Stopped").ok();
            emit_appium_state(app, "stopped", Some("Server stopped".to_string()), None).ok();
            Ok("Appium server stopped".to_string())
        }
        None => Err("Appium server is not running".to_string()),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AppiumServerStatus {
    pub running: bool,
    pub port: Option<u16>,
}

pub fn get_appium_server_status() -> AppiumServerStatus {
    let guard = server_store().lock().unwrap();
    match guard.as_ref() {
        Some(h) => AppiumServerStatus { running: true, port: Some(h.port) },
        None    => AppiumServerStatus { running: false, port: None },
    }
}

async fn health_check(port: u16) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(format!("http://127.0.0.1:{}/status", port))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() { Ok(()) } else { Err(format!("HTTP {}", resp.status())) }
}
