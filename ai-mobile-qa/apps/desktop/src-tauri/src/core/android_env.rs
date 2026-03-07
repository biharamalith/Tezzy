use std::path::PathBuf;

/// Check if a candidate SDK path contains platform-tools/adb.
fn has_adb(sdk: &std::path::Path) -> bool {
    let adb = if cfg!(windows) {
        sdk.join("platform-tools").join("adb.exe")
    } else {
        sdk.join("platform-tools").join("adb")
    };
    adb.exists()
}

/// Probes well-known locations for the Android SDK root on Windows.
/// Returns the first path that contains `platform-tools/adb(.exe)`.
fn find_android_sdk() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Already set in environment (highest priority)
    for var in &["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Ok(v) = std::env::var(var) {
            if !v.is_empty() {
                candidates.push(PathBuf::from(v));
            }
        }
    }

    if cfg!(windows) {
        // 2. Default Android Studio location
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local).join("Android").join("Sdk"));
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            candidates.push(PathBuf::from(&home).join("AppData").join("Local").join("Android").join("Sdk"));
            candidates.push(PathBuf::from(&home).join("Android").join("Sdk"));
        }
        candidates.push(PathBuf::from(r"C:\Android\Sdk"));
        // Hardcoded common fallback
        candidates.push(PathBuf::from(r"C:\Users\PC\AppData\Local\Android\Sdk"));
    } else {
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(&home).join("Android").join("Sdk"));
            candidates.push(PathBuf::from(&home).join("Library").join("Android").join("sdk")); // macOS
        }
        candidates.push(PathBuf::from("/opt/android-sdk"));
    }

    // 3. Try to find adb in PATH and derive SDK root from it
    //    e.g. C:\Users\PC\AppData\Local\Android\Sdk\platform-tools\adb.exe → Sdk
    if let Some(sdk_from_adb) = find_sdk_from_adb_in_path() {
        candidates.push(sdk_from_adb);
    }

    // Log candidates for diagnostics (visible in system log if caller prints)
    eprintln!("[android_env] Probing {} SDK candidates", candidates.len());
    for c in &candidates {
        let ok = has_adb(c);
        eprintln!("[android_env]   {} => {}", c.display(), if ok { "FOUND" } else { "miss" });
    }

    candidates.into_iter().find(|p| has_adb(p))
}

/// Runs `where adb` (Windows) or `which adb` (Unix) and walks up from the
/// result to find the SDK root. e.g. `.../Sdk/platform-tools/adb.exe` → `.../Sdk`.
fn find_sdk_from_adb_in_path() -> Option<PathBuf> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = std::process::Command::new(cmd)
        .arg("adb")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    // Take first line
    let first = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    let adb_path = PathBuf::from(&first);
    // adb.exe is in <sdk>/platform-tools/ — go up 2 levels
    let sdk_root = adb_path.parent()?.parent()?;
    if has_adb(sdk_root) {
        Some(sdk_root.to_path_buf())
    } else {
        None
    }
}

/// Returns a list of `(key, value)` environment variable pairs that child processes
/// (Appium, scrcpy, adb) need to work correctly when spawned by Tauri.
///
/// Tauri strips the shell environment, so `ANDROID_HOME`, `ANDROID_SDK_ROOT`,
/// and `platform-tools` in PATH are not inherited.
pub fn android_env_vars() -> Vec<(String, String)> {
    let mut vars: Vec<(String, String)> = Vec::new();

    let sdk = match find_android_sdk() {
        Some(p) => {
            eprintln!("[android_env] SDK resolved: {}", p.display());
            p
        }
        None => {
            eprintln!("[android_env] WARNING: Could not find Android SDK at any probed location!");
            return vars;
        }
    };

    let sdk_str = sdk.to_string_lossy().to_string();
    vars.push(("ANDROID_HOME".to_string(), sdk_str.clone()));
    vars.push(("ANDROID_SDK_ROOT".to_string(), sdk_str.clone()));

    // Append platform-tools to PATH so adb is discoverable by child processes
    let platform_tools = sdk.join("platform-tools").to_string_lossy().to_string();
    let existing_path = std::env::var("PATH").unwrap_or_default();
    let separator = if cfg!(windows) { ";" } else { ":" };
    let new_path = if existing_path.is_empty() {
        platform_tools
    } else {
        format!("{}{}{}", existing_path, separator, platform_tools)
    };
    vars.push(("PATH".to_string(), new_path));

    vars
}
