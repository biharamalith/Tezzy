use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::AppHandle;

use crate::core::events::{emit_log, LogLevel};

#[derive(Debug)]
struct AiEngineServerHandle {
	child: Child,
	port: u16,
}

static AI_ENGINE_SERVER: OnceLock<Mutex<Option<AiEngineServerHandle>>> = OnceLock::new();

fn server_store() -> &'static Mutex<Option<AiEngineServerHandle>> {
	AI_ENGINE_SERVER.get_or_init(|| Mutex::new(None))
}

fn clear_dead_spawned_server() {
	let mut guard = server_store().lock().unwrap();
	let is_dead = guard
		.as_mut()
		.and_then(|handle| handle.child.try_wait().ok().flatten())
		.is_some();

	if is_dead {
		*guard = None;
	}
}

fn ai_engine_dir() -> PathBuf {
	PathBuf::from(env!("CARGO_MANIFEST_DIR"))
		.join("..")
		.join("..")
		.join("ai-engine")
}

fn ai_engine_base_url() -> String {
	std::env::var("TEZZY_AI_ENGINE_URL")
		.unwrap_or_else(|_| "http://127.0.0.1:8010/v1".to_string())
		.trim_end_matches('/')
		.to_string()
}

fn ai_engine_port() -> u16 {
	let base_url = ai_engine_base_url();
	let host_port = base_url
		.split("://")
		.nth(1)
		.and_then(|rest| rest.split('/').next())
		.unwrap_or("");

	host_port
		.rsplit_once(':')
		.and_then(|(_, port)| port.parse::<u16>().ok())
		.unwrap_or(8010)
}

fn find_python_executable() -> Option<PathBuf> {
	let engine_dir = ai_engine_dir();
	let mut candidates = Vec::new();
	if cfg!(windows) {
		candidates.push(engine_dir.join(".venv").join("Scripts").join("python.exe"));
		candidates.push(engine_dir.join(".venv").join("Scripts").join("python"));
	}
	candidates.push(PathBuf::from("python"));
	candidates.into_iter().find(|path| path.exists())
}

fn health_url(port: u16) -> String {
	format!("http://127.0.0.1:{}/v1/health", port)
}

async fn health_check(port: u16) -> Result<(), String> {
	let client = reqwest::Client::builder()
		.timeout(Duration::from_secs(3))
		.build()
		.map_err(|err| err.to_string())?;
	let response = client
		.get(health_url(port))
		.send()
		.await
		.map_err(|err| err.to_string())?;

	if response.status().is_success() {
		Ok(())
	} else {
		Err(format!("HTTP {}", response.status()))
	}
}

fn is_localhost_base_url() -> bool {
	let base_url = ai_engine_base_url();
	let host = base_url
		.split("://")
		.nth(1)
		.and_then(|rest| rest.split('/').next())
		.and_then(|host_port| host_port.rsplit_once(':').map(|(host, _)| host).or(Some(host_port)))
		.unwrap_or("");

	matches!(host, "127.0.0.1" | "localhost" | "::1")
}

async fn wait_for_ready(port: u16) -> Result<(), String> {
	for _attempt in 1u8..=20 {
		if health_check(port).await.is_ok() {
			return Ok(());
		}
		tokio::time::sleep(Duration::from_secs(1)).await;
	}

	Err(format!("AI engine did not become ready on 127.0.0.1:{}", port))
}

async fn spawn_ai_engine(app: &AppHandle, port: u16) -> Result<(), String> {
	let python = find_python_executable().ok_or_else(|| {
		let msg = "Python for the AI engine was not found. Activate apps/ai-engine/.venv or install Python, then restart Tezzy.".to_string();
		emit_log(app, LogLevel::Error, format!("[ai-engine] {}", msg)).ok();
		msg
	})?;

	let engine_dir = ai_engine_dir();
	if !engine_dir.exists() {
		let msg = format!("AI engine directory not found: {}", engine_dir.display());
		emit_log(app, LogLevel::Error, format!("[ai-engine] {}", msg)).ok();
		return Err(msg);
	}

	emit_log(
		app,
		LogLevel::Info,
		format!("[ai-engine] Spawning: {} -m uvicorn app.main:app --host 127.0.0.1 --port {}", python.display(), port),
	)
	.ok();

	let mut cmd = Command::new(&python);
	cmd.current_dir(&engine_dir)
		.args(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", &port.to_string()])
		.stdout(Stdio::null())
		.stderr(Stdio::null());

	let child = cmd
		.spawn()
		.map_err(|err| format!("Failed to spawn AI engine ({}): {}", python.display(), err))?;

	let pid = child.id();
	{
		let mut guard = server_store().lock().unwrap();
		*guard = Some(AiEngineServerHandle { child, port });
	}

	emit_log(app, LogLevel::Info, format!("[ai-engine] PID {} - waiting for /v1/health...", pid)).ok();
	wait_for_ready(port).await
}

/// Ensures the local AI engine is reachable, starting it if needed.
pub async fn ensure_ai_engine_running(app: &AppHandle) -> Result<String, String> {
	let port = ai_engine_port();

	if health_check(port).await.is_ok() {
		return Ok(format!("AI engine ready on 127.0.0.1:{}", port));
	}

	clear_dead_spawned_server();

	if !is_localhost_base_url() {
		let msg = format!(
			"AI engine is unreachable at {}. Start that service manually or reset TEZZY_AI_ENGINE_URL.",
			ai_engine_base_url()
		);
		emit_log(app, LogLevel::Error, format!("[ai-engine] {}", msg)).ok();
		return Err(msg);
	}

	let needs_spawn = {
		let guard = server_store().lock().unwrap();
		guard.is_none()
	};

	if needs_spawn {
		spawn_ai_engine(app, port).await?;
	} else {
		emit_log(app, LogLevel::Info, format!("[ai-engine] Waiting for existing server on port {}", port)).ok();
		wait_for_ready(port).await?;
	}

	Ok(format!("AI engine ready on 127.0.0.1:{}", port))
}