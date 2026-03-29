use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json;
use tauri::AppHandle;

use crate::core::events::{emit_log, LogLevel};

/// Get the scenarios directory path (~/.tezzy/scenarios/)
fn get_scenarios_dir() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    
    let scenarios_dir = home_dir.join(".tezzy").join("scenarios");
    
    // Create directory if it doesn't exist
    if !scenarios_dir.exists() {
        fs::create_dir_all(&scenarios_dir)
            .map_err(|e| format!("Failed to create scenarios directory: {}", e))?;
    }
    
    Ok(scenarios_dir)
}

/// Get the file path for a specific scenario
fn get_scenario_path(scenario_id: &str) -> Result<PathBuf, String> {
    let scenarios_dir = get_scenarios_dir()?;
    Ok(scenarios_dir.join(format!("{}.json", scenario_id)))
}

/// Save a scenario to disk
///
/// Saves the scenario as a JSON file in ~/.tezzy/scenarios/{scenario_id}.json
///
/// ## Parameters
/// - `scenario`: The scenario object to save (as JSON value)
///
/// ## Security
/// - Scenario ID is extracted from the scenario object itself
/// - File path is constructed using system-controlled directory
/// - No user-supplied paths are used directly
///
/// ## Errors
/// - Returns error if home directory cannot be determined
/// - Returns error if directory creation fails
/// - Returns error if file write fails
#[tauri::command]
pub async fn save_scenario(
    app: AppHandle,
    scenario: serde_json::Value,
) -> Result<(), String> {
    emit_log(&app, LogLevel::Info, "Saving scenario...");
    
    // Extract scenario ID from the scenario object
    let scenario_id = scenario.get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Scenario missing 'id' field".to_string())?;
    
    // Get file path
    let file_path = get_scenario_path(scenario_id)?;
    
    // Serialize scenario to pretty JSON
    let json_content = serde_json::to_string_pretty(&scenario)
        .map_err(|e| format!("Failed to serialize scenario: {}", e))?;
    
    // Write to file
    fs::write(&file_path, json_content)
        .map_err(|e| format!("Failed to write scenario file: {}", e))?;
    
    emit_log(
        &app,
        LogLevel::Info,
        &format!("Scenario saved: {} at {:?}", scenario_id, file_path),
    );
    
    Ok(())
}

/// Load a scenario from disk
///
/// Reads the scenario JSON file from ~/.tezzy/scenarios/{scenario_id}.json
///
/// ## Parameters
/// - `scenario_id`: ID of the scenario to load
///
/// ## Security
/// - Scenario ID is validated to prevent path traversal
/// - File path is constructed using system-controlled directory
///
/// ## Errors
/// - Returns error if scenario file doesn't exist
/// - Returns error if file read fails
/// - Returns error if JSON parsing fails
#[tauri::command]
pub async fn load_scenario(
    app: AppHandle,
    scenario_id: String,
) -> Result<serde_json::Value, String> {
    emit_log(&app, LogLevel::Info, &format!("Loading scenario: {}", scenario_id));
    
    // Validate scenario_id to prevent path traversal
    if scenario_id.contains("..") || scenario_id.contains("/") || scenario_id.contains("\\") {
        return Err("Invalid scenario ID: contains path separators".to_string());
    }
    
    // Get file path
    let file_path = get_scenario_path(&scenario_id)?;
    
    // Check if file exists
    if !file_path.exists() {
        return Err(format!("Scenario not found: {}", scenario_id));
    }
    
    // Read file
    let file_content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read scenario file: {}", e))?;
    
    // Parse JSON
    let scenario: serde_json::Value = serde_json::from_str(&file_content)
        .map_err(|e| format!("Failed to parse scenario JSON: {}", e))?;
    
    emit_log(&app, LogLevel::Info, &format!("Scenario loaded: {}", scenario_id));
    
    Ok(scenario)
}

/// List all scenarios
///
/// Lists all scenario files in ~/.tezzy/scenarios/ directory
/// Returns an array of scenario objects (not just IDs)
///
/// ## Security
/// - Only reads from system-controlled directory
/// - Filters to only .json files
///
/// ## Errors
/// - Returns error if directory cannot be accessed
/// - Skips files that cannot be read or parsed
#[tauri::command]
pub async fn list_scenarios(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    emit_log(&app, LogLevel::Info, "Listing scenarios...");
    
    let scenarios_dir = get_scenarios_dir()?;
    
    let mut scenarios = Vec::new();
    
    // Read directory entries
    let entries = fs::read_dir(&scenarios_dir)
        .map_err(|e| format!("Failed to read scenarios directory: {}", e))?;
    
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // Skip entries that can't be read
        };
        
        let path = entry.path();
        
        // Only process .json files
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        
        // Read and parse file
        match fs::read_to_string(&path) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(scenario) => scenarios.push(scenario),
                    Err(e) => {
                        emit_log(
                            &app,
                            LogLevel::Warn,
                            &format!("Failed to parse scenario file {:?}: {}", path, e),
                        );
                    }
                }
            }
            Err(e) => {
                emit_log(
                    &app,
                    LogLevel::Warn,
                    &format!("Failed to read scenario file {:?}: {}", path, e),
                );
            }
        }
    }
    
    emit_log(&app, LogLevel::Info, &format!("Found {} scenarios", scenarios.len()));
    
    Ok(scenarios)
}

/// Delete a scenario from disk
///
/// Removes the scenario JSON file from ~/.tezzy/scenarios/{scenario_id}.json
///
/// ## Parameters
/// - `scenario_id`: ID of the scenario to delete
///
/// ## Security
/// - Scenario ID is validated to prevent path traversal
/// - File path is constructed using system-controlled directory
///
/// ## Errors
/// - Returns error if scenario file doesn't exist
/// - Returns error if file deletion fails
#[tauri::command]
pub async fn delete_scenario(
    app: AppHandle,
    scenario_id: String,
) -> Result<(), String> {
    emit_log(&app, LogLevel::Info, &format!("Deleting scenario: {}", scenario_id));
    
    // Validate scenario_id to prevent path traversal
    if scenario_id.contains("..") || scenario_id.contains("/") || scenario_id.contains("\\") {
        return Err("Invalid scenario ID: contains path separators".to_string());
    }
    
    // Get file path
    let file_path = get_scenario_path(&scenario_id)?;
    
    // Check if file exists
    if !file_path.exists() {
        return Err(format!("Scenario not found: {}", scenario_id));
    }
    
    // Delete file
    fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete scenario file: {}", e))?;
    
    emit_log(&app, LogLevel::Info, &format!("Scenario deleted: {}", scenario_id));
    
    Ok(())
}

/// Read a file from an arbitrary path
///
/// Used for importing scenarios from external locations.
///
/// ## Parameters
/// - `file_path`: Absolute path to the file to read
///
/// ## Security
/// - User must have read permissions for the file
/// - No validation of file path (user is responsible for providing valid path)
///
/// ## Errors
/// - Returns error if file doesn't exist or cannot be read
#[tauri::command]
pub async fn read_file(
    app: AppHandle,
    file_path: String,
) -> Result<String, String> {
    emit_log(&app, LogLevel::Info, &format!("Reading file: {}", file_path));
    
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    Ok(content)
}

/// Write content to a file at an arbitrary path
///
/// Used for exporting scenarios to external locations.
///
/// ## Parameters
/// - `file_path`: Absolute path where the file should be written
/// - `content`: Content to write to the file
///
/// ## Security
/// - User must have write permissions for the location
/// - Creates parent directories if they don't exist
///
/// ## Errors
/// - Returns error if file cannot be written
#[tauri::command]
pub async fn write_file(
    app: AppHandle,
    file_path: String,
    content: String,
) -> Result<(), String> {
    emit_log(&app, LogLevel::Info, &format!("Writing file: {}", file_path));
    
    let path = PathBuf::from(&file_path);
    
    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }
    }
    
    // Write file
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    emit_log(&app, LogLevel::Info, &format!("File written: {}", file_path));
    
    Ok(())
}

/// List all JSON files in a directory
///
/// Used for batch importing scenarios from a directory.
///
/// ## Parameters
/// - `directory_path`: Path to the directory to scan
///
/// ## Returns
/// - Array of absolute file paths to JSON files
///
/// ## Errors
/// - Returns error if directory cannot be read
#[tauri::command]
pub async fn list_json_files(
    app: AppHandle,
    directory_path: String,
) -> Result<Vec<String>, String> {
    emit_log(&app, LogLevel::Info, &format!("Listing JSON files in: {}", directory_path));
    
    let dir_path = PathBuf::from(&directory_path);
    
    if !dir_path.exists() || !dir_path.is_dir() {
        return Err(format!("Directory not found or not a directory: {}", directory_path));
    }
    
    let mut json_files = Vec::new();
    
    let entries = fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;
    
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        
        let path = entry.path();
        
        // Only include .json files
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Some(path_str) = path.to_str() {
                json_files.push(path_str.to_string());
            }
        }
    }
    
    emit_log(&app, LogLevel::Info, &format!("Found {} JSON files", json_files.len()));
    
    Ok(json_files)
}

/// Ensure a directory exists, creating it if necessary
///
/// Used for batch exporting scenarios to a directory.
///
/// ## Parameters
/// - `directory_path`: Path to the directory to ensure exists
///
/// ## Errors
/// - Returns error if directory cannot be created
#[tauri::command]
pub async fn ensure_directory(
    app: AppHandle,
    directory_path: String,
) -> Result<(), String> {
    emit_log(&app, LogLevel::Info, &format!("Ensuring directory exists: {}", directory_path));
    
    let dir_path = PathBuf::from(&directory_path);
    
    if !dir_path.exists() {
        fs::create_dir_all(&dir_path)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        
        emit_log(&app, LogLevel::Info, &format!("Directory created: {}", directory_path));
    }
    
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution State Persistence Commands
// ─────────────────────────────────────────────────────────────────────────────

/// Get the state directory path (~/.tezzy/state/)
fn get_state_dir() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    
    let state_dir = home_dir.join(".tezzy").join("state");
    
    // Create directory if it doesn't exist
    if !state_dir.exists() {
        fs::create_dir_all(&state_dir)
            .map_err(|e| format!("Failed to create state directory: {}", e))?;
    }
    
    Ok(state_dir)
}

/// Get the file path for a specific execution state
fn get_state_path(run_id: &str) -> Result<PathBuf, String> {
    let state_dir = get_state_dir()?;
    Ok(state_dir.join(format!("{}.json", run_id)))
}

/// Save execution state to disk
///
/// Saves the execution state as a JSON file in ~/.tezzy/state/{run_id}.json
///
/// ## Parameters
/// - `run_id`: Unique identifier for the execution run
/// - `state`: The execution state object to save (as JSON value)
///
/// ## Security
/// - Run ID is validated to prevent path traversal
/// - File path is constructed using system-controlled directory
///
/// ## Errors
/// - Returns error if home directory cannot be determined
/// - Returns error if directory creation fails
/// - Returns error if file write fails
#[tauri::command]
pub async fn save_execution_state(
    app: AppHandle,
    run_id: String,
    state: serde_json::Value,
) -> Result<(), String> {
    // Validate run_id to prevent path traversal
    if run_id.contains("..") || run_id.contains("/") || run_id.contains("\\") {
        return Err("Invalid run ID: contains path separators".to_string());
    }
    
    // Get file path
    let file_path = get_state_path(&run_id)?;
    
    // Serialize state to pretty JSON
    let json_content = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialize execution state: {}", e))?;
    
    // Write to file
    fs::write(&file_path, json_content)
        .map_err(|e| format!("Failed to write execution state file: {}", e))?;
    
    let _ = emit_log(
        &app,
        LogLevel::Debug,
        &format!("Execution state saved: {}", run_id),
    );
    
    Ok(())
}

/// Load execution state from disk
///
/// Reads the execution state JSON file from ~/.tezzy/state/{run_id}.json
///
/// ## Parameters
/// - `run_id`: ID of the execution run to load
///
/// ## Security
/// - Run ID is validated to prevent path traversal
/// - File path is constructed using system-controlled directory
///
/// ## Returns
/// - Returns the execution state if file exists
/// - Returns null if file doesn't exist (not an error)
///
/// ## Errors
/// - Returns error if file read fails (other than not found)
/// - Returns error if JSON parsing fails
#[tauri::command]
pub async fn load_execution_state(
    app: AppHandle,
    run_id: String,
) -> Result<Option<serde_json::Value>, String> {
    // Validate run_id to prevent path traversal
    if run_id.contains("..") || run_id.contains("/") || run_id.contains("\\") {
        return Err("Invalid run ID: contains path separators".to_string());
    }
    
    // Get file path
    let file_path = get_state_path(&run_id)?;
    
    // Check if file exists
    if !file_path.exists() {
        let _ = emit_log(
            &app,
            LogLevel::Debug,
            &format!("Execution state not found: {}", run_id),
        );
        return Ok(None);
    }
    
    // Read file
    let file_content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read execution state file: {}", e))?;
    
    // Parse JSON
    let state: serde_json::Value = serde_json::from_str(&file_content)
        .map_err(|e| format!("Failed to parse execution state JSON: {}", e))?;
    
    let _ = emit_log(
        &app,
        LogLevel::Debug,
        &format!("Execution state loaded: {}", run_id),
    );
    
    Ok(Some(state))
}

/// Delete execution state from disk
///
/// Removes the execution state JSON file from ~/.tezzy/state/{run_id}.json
///
/// ## Parameters
/// - `run_id`: ID of the execution run to delete
///
/// ## Security
/// - Run ID is validated to prevent path traversal
/// - File path is constructed using system-controlled directory
///
/// ## Errors
/// - Returns error if file deletion fails
/// - Does NOT return error if file doesn't exist (idempotent)
#[tauri::command]
pub async fn delete_execution_state(
    app: AppHandle,
    run_id: String,
) -> Result<(), String> {
    // Validate run_id to prevent path traversal
    if run_id.contains("..") || run_id.contains("/") || run_id.contains("\\") {
        return Err("Invalid run ID: contains path separators".to_string());
    }
    
    // Get file path
    let file_path = get_state_path(&run_id)?;
    
    // Check if file exists
    if !file_path.exists() {
        let _ = emit_log(
            &app,
            LogLevel::Debug,
            &format!("Execution state already deleted or never existed: {}", run_id),
        );
        return Ok(());
    }
    
    // Delete file
    fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete execution state file: {}", e))?;
    
    let _ = emit_log(
        &app,
        LogLevel::Info,
        &format!("Execution state deleted: {}", run_id),
    );
    
    Ok(())
}

/// List all incomplete execution runs
///
/// Lists all execution state files in ~/.tezzy/state/ directory
/// Returns an array of run IDs (extracted from filenames)
///
/// ## Security
/// - Only reads from system-controlled directory
/// - Filters to only .json files
///
/// ## Errors
/// - Returns error if directory cannot be accessed
#[tauri::command]
pub async fn list_incomplete_runs(app: AppHandle) -> Result<Vec<String>, String> {
    let _ = emit_log(&app, LogLevel::Info, "Listing incomplete runs...");
    
    let state_dir = get_state_dir()?;
    
    let mut run_ids = Vec::new();
    
    // Read directory entries
    let entries = fs::read_dir(&state_dir)
        .map_err(|e| format!("Failed to read state directory: {}", e))?;
    
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        
        let path = entry.path();
        
        // Only process .json files
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        
        // Extract run ID from filename (remove .json extension)
        if let Some(file_stem) = path.file_stem() {
            if let Some(run_id) = file_stem.to_str() {
                run_ids.push(run_id.to_string());
            }
        }
    }
    
    let _ = emit_log(
        &app,
        LogLevel::Info,
        &format!("Found {} incomplete runs", run_ids.len()),
    );
    
    Ok(run_ids)
}
