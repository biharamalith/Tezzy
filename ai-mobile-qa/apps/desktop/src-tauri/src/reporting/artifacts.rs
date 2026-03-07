use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Returns a timestamped run folder under `base/smoke-<timestamp>/`.
///
/// **Security**: Path is constructed entirely from controlled components
/// (base is system-set, "smoke" is a literal, timestamp is numeric).
/// No user input reaches the file system through here.
pub fn smoke_run_folder(base: &Path) -> PathBuf {
	let ts = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_millis())
		.unwrap_or(0);
	base.join(format!("smoke-{}", ts))
}
