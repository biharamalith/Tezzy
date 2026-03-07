use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::Arc;

use tauri::async_runtime;

/// Captured output for short-lived commands (e.g., `adb devices -l`).
#[derive(Debug, Clone)]
pub struct CapturedOutput {
	pub status: i32,
	pub stdout: String,
	pub stderr: String,
}

/// Error wrapper with a user-facing message.
#[derive(Debug, Clone)]
pub struct ProcessError {
	pub message: String,
}

/// Output stream indicator for streaming processes.
#[derive(Debug, Clone, Copy)]
pub enum LineStream {
	Stdout,
	Stderr,
}

/// A single line emitted from stdout or stderr.
#[derive(Debug, Clone)]
pub struct ProcessLine {
	pub stream: LineStream,
	pub line: String,
}

/// Handle to a spawned process (used for future lifecycle control).
#[derive(Debug)]
pub struct ProcessHandle {
	pub child: std::process::Child,
}

/// Executes trusted binaries without invoking a shell.
///
/// Security: executable names are allowlisted and validated to be bare names,
/// preventing path traversal or user-supplied shell injection.
pub struct ProcessRunner {
	allowlist: HashSet<String>,
	max_line_len: usize,
}

impl ProcessRunner {
	pub fn new() -> Self {
		let mut allowlist = HashSet::new();
		allowlist.insert("adb".to_string());
		allowlist.insert("scrcpy".to_string());

		Self {
			allowlist,
			max_line_len: 4096,
		}
	}

	pub fn with_allowlist(allowlist: HashSet<String>) -> Self {
		Self {
			allowlist,
			max_line_len: 4096,
		}
	}

	fn validate_exe(&self, exe: &str) -> Result<(), ProcessError> {
		if exe.contains('/') || exe.contains('\\') {
			return Err(ProcessError {
				message: "Executable must be a bare name, not a path".to_string(),
			});
		}

		if !self.allowlist.contains(exe) {
			return Err(ProcessError {
				message: format!("Executable is not allowlisted: {exe}"),
			});
		}

		Ok(())
	}

	/// Run a short-lived command and capture stdout/stderr.
	///
	/// Complexity: O(n) in output length.
	pub async fn run_capture(
		&self,
		exe: &str,
		args: &[String],
	) -> Result<CapturedOutput, ProcessError> {
		self.validate_exe(exe)?;

		let exe = exe.to_string();
		let args = args.to_vec();

		let output = async_runtime::spawn_blocking(move || {
			Command::new(exe)
				.args(args)
				.output()
				.map_err(|err| ProcessError {
					message: format!("Failed to run command: {err}"),
				})
		})
		.await
		.map_err(|err| ProcessError {
			message: format!("Command task failed: {err}"),
		})??;

		Ok(CapturedOutput {
			status: output.status.code().unwrap_or(-1),
			stdout: String::from_utf8_lossy(&output.stdout).to_string(),
			stderr: String::from_utf8_lossy(&output.stderr).to_string(),
		})
	}

	/// Spawn a long-lived process and stream lines as they arrive.
	///
	/// Streaming avoids unbounded buffering by emitting each line immediately.
	pub async fn spawn_streaming<F>(
		&self,
		exe: &str,
		args: &[String],
		on_line_event: F,
	) -> Result<ProcessHandle, ProcessError>
	where
		F: Fn(ProcessLine) + Send + Sync + 'static,
	{
		self.validate_exe(exe)?;

		let mut child = Command::new(exe)
			.args(args)
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			.spawn()
			.map_err(|err| ProcessError {
				message: format!("Failed to spawn process: {err}"),
			})?;

		let callback = Arc::new(on_line_event);

		if let Some(stdout) = child.stdout.take() {
			let callback = Arc::clone(&callback);
			let max_len = self.max_line_len;
			async_runtime::spawn_blocking(move || {
				let reader = BufReader::new(stdout);
				for line in reader.lines().flatten() {
					let line = if line.len() > max_len {
						let mut truncated = line[..max_len].to_string();
						truncated.push_str("...");
						truncated
					} else {
						line
					};

					callback(ProcessLine {
						stream: LineStream::Stdout,
						line,
					});
				}
			});
		}

		if let Some(stderr) = child.stderr.take() {
			let callback = Arc::clone(&callback);
			let max_len = self.max_line_len;
			async_runtime::spawn_blocking(move || {
				let reader = BufReader::new(stderr);
				for line in reader.lines().flatten() {
					let line = if line.len() > max_len {
						let mut truncated = line[..max_len].to_string();
						truncated.push_str("...");
						truncated
					} else {
						line
					};

					callback(ProcessLine {
						stream: LineStream::Stderr,
						line,
					});
				}
			});
		}

		Ok(ProcessHandle { child })
	}
}
