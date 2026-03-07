#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod core;
mod drivers;
mod explorer;
mod reporting;

fn main() {
	tauri::Builder::default()
		.invoke_handler(tauri::generate_handler![
			commands::devices::env_check,
			commands::devices::list_devices,
			commands::devices::set_active_device,
			commands::scrcpy::start_scrcpy_preview,
			commands::scrcpy::stop_scrcpy_preview,
			commands::scrcpy::get_scrcpy_preview_status,
			commands::apk::install_and_launch_apk,
			commands::appium::ensure_appium,
			commands::appium::start_appium,
			commands::appium::stop_appium,
			commands::appium::get_appium_status,
			commands::appium::create_appium_session,
			commands::appium::destroy_appium_session,
			commands::appium::action_tap,
			commands::appium::action_back,
			commands::appium::action_swipe,
			commands::appium::action_input,
			commands::appium::action_screenshot,
			commands::appium::list_screenshots,
			commands::explorer::get_ui_hierarchy,
			commands::explorer::get_device_screen_size,
			commands::reports::run_smoke_check_cmd,
			commands::reports::stop_smoke_check_cmd
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
