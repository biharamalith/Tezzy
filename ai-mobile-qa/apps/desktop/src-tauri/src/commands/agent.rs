use std::path::PathBuf;

use tauri::AppHandle;

use crate::explorer::ai_agent::{request_stop, run_ai_agent, AgentRunOptions, AgentRunResult};

/// Runs the single-agent AI test on the active device and Appium session.
///
/// Screenshots, report.md and findings.json go to `<app_local_data>/agent-runs/<run id>/`.
/// Progress is streamed as `tezzy:agent_turn` events; the result comes back when the run ends.
#[tauri::command]
pub async fn run_ai_agent_cmd(app: AppHandle, options: Option<AgentRunOptions>) -> Result<AgentRunResult, String> {
	let base_dir = app
		.path_resolver()
		.app_local_data_dir()
		.unwrap_or_else(|| PathBuf::from("reports"));
	run_ai_agent(&app, options.unwrap_or_default(), base_dir.join("agent-runs")).await
}

/// Asks the running agent to stop after its current step. It still writes its report.
#[tauri::command]
pub fn stop_ai_agent_cmd() {
	request_stop();
}
