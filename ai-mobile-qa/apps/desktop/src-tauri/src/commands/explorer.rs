use serde::Serialize;
use std::time::Duration;
use tauri::AppHandle;

use crate::core::events::{emit_log, LogLevel};
use crate::core::storage::{get_active_device, get_active_session};
use crate::drivers::appium_client::{self, is_session_alive}; // ← added is_session_alive
use crate::drivers::uihierarchy::{dump_hierarchy, get_screen_size, parse_ui_xml, UiElement};
use crate::explorer::scoring::screen_hash;

/// Screen dimensions returned by `get_device_screen_size`.
#[derive(Debug, Clone, Serialize)]
pub struct ScreenSize {
    pub width: i32,
    pub height: i32,
}

/// Full UI snapshot for AI orchestration.
#[derive(Debug, Clone, Serialize)]
pub struct UiSnapshot {
    pub screen_hash: String,
    pub screen_size: ScreenSize,
    pub ui_elements: Vec<UiElement>,
}

/// Dumps the current UI hierarchy for the active device.
///
/// Strategy (fastest → slowest):
/// 1. Appium `/source` (1–3 seconds) ← now with alive check + optimizations
/// 2. ADB uiautomator dump (max 25s total — never hangs for 10 minutes again)
#[tauri::command]
pub async fn get_ui_hierarchy(app: AppHandle) -> Result<Vec<UiElement>, String> {
    // Hard safety wall — now safe because both paths are capped
    tokio::time::timeout(
        Duration::from_secs(35),
        get_ui_hierarchy_inner(app),
    )
    .await
    .map_err(|_| {
        "UI dump timed out after 35s. Device may be locked — unlock screen and try again.".to_string()
    })?
}

async fn get_ui_hierarchy_inner(app: AppHandle) -> Result<Vec<UiElement>, String> {
    let serial = get_active_device().ok_or_else(|| "No active device selected".to_string())?;

    // ── FAST PATH: Active + Alive Appium session ────────────────────────
    if let Some(session) = get_active_session() {
        emit_log(&app, LogLevel::Info, "[inspector] Session found in storage — checking if alive...").ok();

        if is_session_alive(&session.session_id, None).await {
            emit_log(&app, LogLevel::Info, "[inspector] ✅ Session alive → Using FAST Appium page source").ok();

            // Extra safety: re-apply fast-dump settings (harmless & very quick)
            let _ = appium_client::optimize_for_fast_dump(&app, &session.session_id, None).await;

            match appium_client::get_page_source(&session.session_id, None).await {
                Ok(xml) => {
                    let elements = parse_ui_xml(&xml);
                    emit_log(
                        &app,
                        LogLevel::Info,
                        format!("[inspector] ✅ Success! Got {} elements via Appium (fast path)", elements.len()),
                    )
                    .ok();
                    return Ok(elements);
                }
                Err(e) => {
                    emit_log(
                        &app,
                        LogLevel::Warn,
                        format!("[inspector] Appium get_page_source failed ({}), falling back to ADB", e),
                    )
                    .ok();
                }
            }
        } else {
            emit_log(&app, LogLevel::Info, "[inspector] Session in storage but dead — falling back to ADB").ok();
        }
    }

    // ── FALLBACK: Pure ADB (capped at 25s total in uihierarchy.rs) ───────
    emit_log(&app, LogLevel::Info, "[inspector] Using ADB uiautomator dump (fallback)").ok();
    dump_hierarchy(&app, &serial).await
}

/// Returns screen size (unchanged — already perfect)
#[tauri::command]
pub async fn get_device_screen_size() -> Result<ScreenSize, String> {
    let serial = get_active_device().ok_or_else(|| "No active device selected".to_string())?;
    let (width, height) = get_screen_size(&serial).await?;
    Ok(ScreenSize { width, height })
}

/// Returns the current UI snapshot: elements + `screen_hash` + `screen_size`.
///
/// This is a convenience wrapper used by the AI engine orchestrator client.
#[tauri::command]
pub async fn get_ui_snapshot(app: AppHandle) -> Result<UiSnapshot, String> {
    let serial = get_active_device().ok_or_else(|| "No active device selected".to_string())?;
    let ui_elements = get_ui_hierarchy_inner(app.clone()).await?;
    let hash = screen_hash(&ui_elements);
    let (width, height) = get_screen_size(&serial).await?;
    Ok(UiSnapshot {
        screen_hash: hash,
        screen_size: ScreenSize { width, height },
        ui_elements,
    })
}