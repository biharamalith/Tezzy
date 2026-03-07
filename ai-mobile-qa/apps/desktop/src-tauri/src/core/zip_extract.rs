use std::fs;
use std::io;
use std::path::Path;

use tauri::AppHandle;
use zip::ZipArchive;

use crate::core::events::{emit_log, LogLevel};

/// Safely extracts a ZIP file preventing path traversal attacks.
///
/// **What**: Extracts ZIP to destination, validating each entry path for security.
/// **Security**:
///   - Rejects absolute paths (e.g., "/etc/passwd", "C:\Windows\...")
///   - Rejects parent directory traversal (e.g., "../../../etc/passwd")
///   - All extracted files stay within dest_dir
/// **Complexity**: O(n) where n = number of files in ZIP.
/// **Memory**: Extracts one file at a time, bounded memory usage.
pub fn extract_zip_safely(
	app: &AppHandle,
	zip_path: &Path,
	dest_dir: &Path,
) -> Result<(), String> {
	emit_log(
		app,
		LogLevel::Info,
		format!("[zip] Extracting: {}", zip_path.display()),
	)
	.ok();

	// Open ZIP file
	let file = fs::File::open(zip_path)
		.map_err(|err| format!("Failed to open ZIP file: {}", err))?;

	let mut archive = ZipArchive::new(file)
		.map_err(|err| format!("Failed to read ZIP archive: {}", err))?;

	// Create destination directory
	fs::create_dir_all(dest_dir)
		.map_err(|err| format!("Failed to create destination directory: {}", err))?;

	let dest_dir_canonical = dest_dir
		.canonicalize()
		.map_err(|err| format!("Failed to canonicalize destination: {}", err))?;

	let total_files = archive.len();
	emit_log(
		app,
		LogLevel::Info,
		format!("[zip] Extracting {} files", total_files),
	)
	.ok();

	// Extract each file
	for i in 0..total_files {
		let mut file = archive
			.by_index(i)
			.map_err(|err| format!("Failed to read ZIP entry {}: {}", i, err))?;

		let entry_path = file
			.enclosed_name()
			.ok_or_else(|| format!("ZIP entry {} has invalid path", i))?;

		// Security: Reject absolute paths
		if entry_path.is_absolute() {
			return Err(format!(
				"Security violation: ZIP contains absolute path: {}",
				entry_path.display()
			));
		}

		// Security: Reject parent directory traversal
		if entry_path.components().any(|c| c.as_os_str() == "..") {
			return Err(format!(
				"Security violation: ZIP contains path traversal: {}",
				entry_path.display()
			));
		}

		let target_path = dest_dir.join(entry_path);

		// Security: Ensure target path is still within dest_dir
		let target_canonical = target_path
			.parent()
			.ok_or_else(|| "Invalid target path".to_string())?
			.canonicalize()
			.unwrap_or_else(|_| target_path.parent().unwrap().to_path_buf());

		if !target_canonical.starts_with(&dest_dir_canonical) {
			return Err(format!(
				"Security violation: ZIP entry escapes destination: {}",
				entry_path.display()
			));
		}

		// Extract file or directory
		if file.is_dir() {
			fs::create_dir_all(&target_path)
				.map_err(|err| format!("Failed to create directory: {}", err))?;
		} else {
			if let Some(parent) = target_path.parent() {
				fs::create_dir_all(parent)
					.map_err(|err| format!("Failed to create parent directory: {}", err))?;
			}

			let mut outfile = fs::File::create(&target_path)
				.map_err(|err| format!("Failed to create file: {}", err))?;

			io::copy(&mut file, &mut outfile)
				.map_err(|err| format!("Failed to write file: {}", err))?;
		}

		// Log progress for larger archives
		if i % 100 == 0 && i > 0 {
			emit_log(
				app,
				LogLevel::Debug,
				format!("[zip] Extracted {} / {} files", i, total_files),
			)
			.ok();
		}
	}

	emit_log(
		app,
		LogLevel::Info,
		format!("[zip] Extraction complete: {}", dest_dir.display()),
	)
	.ok();

	Ok(())
}
