use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tauri::AppHandle;
use tokio::process::Command as TokioCommand;

use crate::core::events::{emit_log, LogLevel};
use crate::drivers::adb::is_valid_serial;

const ADB_DUMP_TIMEOUT_SECS: u64 = 8;
const ADB_DUMP_MAX_RETRIES: u32 = 1;
const ADB_DUMP_RETRY_DELAY_MS: u64 = 400;
const OVERALL_DUMP_TIMEOUT_SECS: u64 = 25;

async fn adb_timeout(args: &[&str], timeout: Duration) -> Result<std::process::Output, String> {
    let mut child = TokioCommand::new("adb")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn adb: {}", e))?;

    tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| {
            format!(
                "adb command timed out after {}s. Make sure screen is unlocked and app is foreground.",
                timeout.as_secs()
            )
        })?
        .map_err(|e| format!("adb process error: {}", e))
}

#[derive(Debug, Clone, Serialize)]
pub struct UiElement {
    pub class: String,
    pub class_full: String,
    pub text: String,
    pub content_desc: String,
    pub resource_id: String,
    pub clickable: bool,
    pub enabled: bool,
    pub scrollable: bool,
    pub checkable: bool,
    pub checked: bool,
    pub bounds: String,
    pub center_x: i32,
    pub center_y: i32,
    pub depth: usize,
}

pub async fn dump_hierarchy(app: &AppHandle, serial: &str) -> Result<Vec<UiElement>, String> {
    if !is_valid_serial(serial) {
        return Err(format!("Invalid device serial: {}", serial));
    }

    emit_log(app, LogLevel::Info, "[inspector] Starting UI dump...").ok();

    let result = tokio::time::timeout(
        Duration::from_secs(OVERALL_DUMP_TIMEOUT_SECS),
        dump_hierarchy_inner(app, serial),
    )
    .await;

    match result {
        Ok(Ok(elements)) => Ok(elements),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("UI dump timed out after 25s total. Device may be locked or very slow.".to_string()),
    }
}

async fn dump_hierarchy_inner(app: &AppHandle, serial: &str) -> Result<Vec<UiElement>, String> {
    emit_log(app, LogLevel::Info, "[inspector] Using adb uiautomator dump (no active Appium session)").ok();

    let dump_timeout = Duration::from_secs(ADB_DUMP_TIMEOUT_SECS);
    let pull_timeout = Duration::from_secs(6);
    let tmp = std::env::temp_dir().join("tezzy_ui.xml");
    let tmp_str = tmp.to_string_lossy().to_string();
    let mut last_err = String::new();

    for attempt in 1..=ADB_DUMP_MAX_RETRIES {
        if attempt > 1 {
            emit_log(
                app,
                LogLevel::Info,
                format!("[inspector] uiautomator dump retry {}/{}", attempt, ADB_DUMP_MAX_RETRIES),
            )
            .ok();
            tokio::time::sleep(Duration::from_millis(ADB_DUMP_RETRY_DELAY_MS)).await;
        }

        let _ = adb_timeout(
            &["-s", serial, "shell", "rm", "-f", "/sdcard/tezzy_ui.xml"],
            Duration::from_secs(4),
        )
        .await;

        let dump_out = match adb_timeout(
            &["-s", serial, "shell", "uiautomator", "dump", "/sdcard/tezzy_ui.xml"],
            dump_timeout,
        )
        .await
        {
            Ok(out) => out,
            Err(e) => {
                last_err = e;
                continue;
            }
        };

        if !dump_out.status.success() {
            last_err = format!("uiautomator dump failed: {:?}", dump_out.status.code());
            continue;
        }

        if let Err(e) = adb_timeout(
            &["-s", serial, "pull", "/sdcard/tezzy_ui.xml", &tmp_str],
            pull_timeout,
        )
        .await
        {
            last_err = format!("adb pull failed: {}", e);
            continue;
        }

        let xml = std::fs::read_to_string(&tmp)
            .map_err(|e| format!("Could not read UI dump: {}", e))?;

        if !xml.contains("<hierarchy") {
            last_err = "No valid XML returned. Screen must be unlocked.".to_string();
            continue;
        }

        let elements = parse_elements(&xml);
        emit_log(
            app,
            LogLevel::Info,
            format!("[inspector] Got {} elements via ADB dump", elements.len()),
        )
        .ok();
        return Ok(elements);
    }

    Err(if last_err.is_empty() {
        "UI dump failed. Make sure the screen is unlocked and the app is in the foreground.".to_string()
    } else {
        last_err
    })
}

pub async fn get_screen_size(serial: &str) -> Result<(i32, i32), String> {
    if !is_valid_serial(serial) {
        return Err(format!("Invalid device serial: {}", serial));
    }

    let out = adb_timeout(
        &["-s", serial, "shell", "wm", "size"],
        Duration::from_secs(10),
    )
    .await
    .map_err(|e| format!("adb wm size failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();

    for line in stdout.lines() {
        if let Some(size_part) = line.split(':').nth(1) {
            let trimmed = size_part.trim();
            if let Some((w_str, h_str)) = trimmed.split_once('x') {
                if let (Ok(w), Ok(h)) = (w_str.trim().parse::<i32>(), h_str.trim().parse::<i32>()) {
                    return Ok((w, h));
                }
            }
        }
    }

    Err(format!("Could not parse screen size from: {}", stdout))
}

// ====================== XML PARSING (NOW 100% UTF-8 SAFE) ======================
fn attr_val<'a>(tag: &'a str, name: &str) -> &'a str {
    let needle = format!(" {}=\"", name);
    if let Some(start) = tag.find(&needle) {
        let after = &tag[start + needle.len()..];
        if let Some(end) = after.find('"') {
            return &after[..end];
        }
    }
    ""
}

fn parse_bounds(s: &str) -> (i32, i32, i32, i32) {
    let nums: Vec<i32> = s
        .replace('[', " ")
        .replace(']', " ")
        .split_whitespace()
        .flat_map(|chunk| chunk.split(','))
        .filter_map(|n| n.trim().parse::<i32>().ok())
        .collect();

    if nums.len() == 4 {
        (nums[0], nums[1], nums[2], nums[3])
    } else {
        (0, 0, 0, 0)
    }
}

fn short_class(full: &str) -> String {
    full.rsplit('.').next().unwrap_or(full).to_string()
}

pub fn parse_elements(xml: &str) -> Vec<UiElement> {
    let mut elements = Vec::new();
    let mut depth: usize = 0;
    let mut search_pos = 0usize;

    let cutoff = xml
        .rfind("</hierarchy>")
        .map(|i| i + "</hierarchy>".len())
        .unwrap_or(xml.len());
    let xml = &xml[..cutoff];

    while search_pos < xml.len() {
        // Find next tag (safe UTF-8 find)
        let next_node = xml[search_pos..].find("<node");
        let next_close = xml[search_pos..].find("</node>");

        let (is_open, rel_pos) = match (next_node, next_close) {
            (Some(o), Some(c)) if o < c => (true, o),
            (Some(_), Some(c)) => (false, c),
            (Some(o), None) => (true, o),
            (None, Some(c)) => (false, c),
            (None, None) => break,
        };

        let tag_start = search_pos + rel_pos;
        search_pos = tag_start;

        if !is_open {
            // closing </node>
            if depth > 0 {
                depth -= 1;
            }
            search_pos += 7;
            continue;
        }

        // opening <node ...>
        let tag_end = match xml[tag_start..].find('>') {
            Some(i) => tag_start + i + 1,
            None => break,
        };

        let tag = &xml[tag_start..tag_end];
        let self_closing = tag.ends_with("/>");

        let class_full = attr_val(tag, "class").to_string();
        let text = attr_val(tag, "text").to_string();
        let content_desc = attr_val(tag, "content-desc").to_string();
        let resource_id = attr_val(tag, "resource-id").to_string();
        let clickable = attr_val(tag, "clickable") == "true";
        let enabled = attr_val(tag, "enabled") == "true";
        let scrollable = attr_val(tag, "scrollable") == "true";
        let checkable = attr_val(tag, "checkable") == "true";
        let checked = attr_val(tag, "checked") == "true";
        let bounds_str = attr_val(tag, "bounds").to_string();

        let (x1, y1, x2, y2) = parse_bounds(&bounds_str);

        let has_info = !text.is_empty() || !content_desc.is_empty() || !resource_id.is_empty();
        let interactive = clickable || scrollable || checkable;

        if enabled && (has_info || interactive) {
            elements.push(UiElement {
                class: short_class(&class_full),
                class_full,
                text,
                content_desc,
                resource_id,
                clickable,
                enabled,
                scrollable,
                checkable,
                checked,
                bounds: bounds_str,
                center_x: (x1 + x2) / 2,
                center_y: (y1 + y2) / 2,
                depth,
            });
        }

        if !self_closing {
            depth += 1;
        }
        search_pos = tag_end;
    }

    elements
}

pub fn parse_ui_xml(xml: &str) -> Vec<UiElement> {
    parse_elements(xml)
}