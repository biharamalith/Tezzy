use std::path::Path;

use crate::explorer::agent_loop::SmokeCheckResult;

/// Writes a Markdown smoke check report to `output_path`.
///
/// ## Report structure
/// 1. Header with run metadata (ID, device, step counts, final status).
/// 2. **Smoke Check Findings** — bullet list of flagged issues with severity icons.
/// 3. **Step Table** — one row per executed step with action, result, and screenshot link.
///
/// ## Security
/// - `output_path` is controlled by the caller (always inside the app local-data folder).
/// - No user-supplied data is written without controlled formatting.
///
/// ## Complexity
/// O(findings + steps) — each item becomes one markdown row.
pub fn write_smoke_report(result: &SmokeCheckResult, output_path: &Path) -> Result<(), String> {
	let mut md = String::new();

	// ── Header ────────────────────────────────────────────────────────────
	md.push_str("# Tezzy Auto Smoke Check Report\n\n");
	md.push_str(&format!("> **Run ID**: `{}`  \n", result.run_id));
	md.push_str(&format!("> **Device**: `{}`  \n", result.device_serial));
	md.push_str(&format!(
		"> **Steps executed**: {} / {}  \n",
		result.steps_done, result.max_steps
	));

	let status_badge = match result.final_status.as_str() {
		"complete" => "✅ Complete",
		"crash" => "🔴 Crash detected",
		"loop" => "🟡 Loop detected",
		"stopped" => "⏹ Stopped by user",
		"no_elements" => "⚠️ No interactable elements",
		other => other,
	};
	md.push_str(&format!("> **Status**: {}  \n\n", status_badge));
	md.push_str("---\n\n");

	// ── Findings ─────────────────────────────────────────────────────────
	md.push_str("## Smoke Check Findings\n\n");

	if result.findings.is_empty() {
		md.push_str("No issues detected during this run.\n\n");
	} else {
		for finding in &result.findings {
			let icon = match finding.severity.as_str() {
				"error" => "🔴",
				"warn" => "🟡",
				_ => "🔵",
			};
			md.push_str(&format!(
				"- {} **[{}]** (step {}): {}\n",
				icon, finding.severity, finding.step, finding.message
			));
		}
		md.push('\n');
	}

	// ── Step table ────────────────────────────────────────────────────────
	md.push_str("## Step Log\n\n");
	md.push_str("| Step | Action | Result | Screenshot |\n");
	md.push_str("|-----:|--------|--------|------------|\n");

	for step in &result.steps {
		let screenshot_cell = step
			.screenshot
			.as_deref()
			.map(|p| {
				// Use a relative link if possible; just the filename is safest
				let filename = Path::new(p)
					.file_name()
					.and_then(|f| f.to_str())
					.unwrap_or(p);
				format!("[view]({})", filename)
			})
			.unwrap_or_else(|| "—".to_string());

		let result_badge = match step.result_status.as_str() {
			"ok" => "✅ ok",
			"dead_tap" => "🟡 dead tap",
			"loop" => "🔄 loop",
			"crash" => "🔴 crash",
			"stopped" => "⏹ stopped",
			other => other,
		};

		md.push_str(&format!(
			"| {} | `{}` | {} | {} |\n",
			step.step_num, step.action, result_badge, screenshot_cell
		));
	}

	md.push('\n');

	std::fs::write(output_path, &md)
		.map_err(|e| format!("Failed to write smoke report to {}: {}", output_path.display(), e))
}
