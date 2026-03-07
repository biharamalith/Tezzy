use serde::{Deserialize, Serialize};

use crate::core::process::ProcessRunner;

/// Normalized ADB device record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
	pub serial: String,
	pub state: String,
	pub model: Option<String>,
	pub product: Option<String>,
	pub transport_id: Option<String>,
}

/// Validates serials to a conservative character set before use in commands.
pub fn is_valid_serial(serial: &str) -> bool {
	!serial.is_empty()
		&& serial
			.chars()
			.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':'))
}

/// Returns the first line of `adb version` output.
pub async fn adb_version() -> Result<String, String> {
	let runner = ProcessRunner::new();
	let output = runner
		.run_capture("adb", &vec!["version".to_string()])
		.await
		.map_err(|err| err.message)?;

	let line = output
		.stdout
		.lines()
		.next()
		.unwrap_or("")
		.trim()
		.to_string();

	if line.is_empty() {
		return Err("adb version output was empty".to_string());
	}

	Ok(line)
}

/// Lists devices via `adb devices -l` and parses the output.
pub async fn list_devices() -> Result<Vec<Device>, String> {
	let runner = ProcessRunner::new();
	let output = runner
		.run_capture("adb", &vec!["devices".to_string(), "-l".to_string()])
		.await
		.map_err(|err| err.message)?;

	Ok(parse_devices(&output.stdout))
}

/// Parses device output in O(n) over the number of lines.
pub fn parse_devices(output: &str) -> Vec<Device> {
	let mut devices = Vec::new();

	for raw_line in output.lines() {
		let line = raw_line.trim();
		if line.is_empty() || line.starts_with("List of devices") {
			continue;
		}

		let mut parts = line.split_whitespace();
		let serial = match parts.next() {
			Some(value) => value,
			None => continue,
		};

		if !is_valid_serial(serial) {
			continue;
		}

		let state = match parts.next() {
			Some(value) => value,
			None => continue,
		};

		let mut device = Device {
			serial: serial.to_string(),
			state: state.to_string(),
			model: None,
			product: None,
			transport_id: None,
		};

		for token in parts {
			if let Some((key, value)) = token.split_once(':') {
				match key {
					"model" => device.model = Some(value.to_string()),
					"product" => device.product = Some(value.to_string()),
					"transport_id" => device.transport_id = Some(value.to_string()),
					_ => {}
				}
			}
		}

		devices.push(device);
	}

	devices
}

#[cfg(test)]
mod tests {
	use super::parse_devices;

	#[test]
	fn parses_basic_device_list() {
		let output = include_str!("../../../../../tools/fixtures/adb_devices_basic.txt");
		let devices = parse_devices(output);
		assert_eq!(devices.len(), 2);
		assert_eq!(devices[0].serial, "emulator-5554");
		assert_eq!(devices[0].state, "device");
		assert_eq!(devices[0].model.as_deref(), Some("Pixel_6"));
		assert_eq!(devices[0].product.as_deref(), Some("orion"));
		assert_eq!(devices[0].transport_id.as_deref(), Some("1"));
	}

	#[test]
	fn tolerates_missing_fields() {
		let output = include_str!("../../../../../tools/fixtures/adb_devices_missing_fields.txt");
		let devices = parse_devices(output);
		assert_eq!(devices.len(), 2);
		assert_eq!(devices[0].serial, "FAKE12345");
		assert_eq!(devices[0].state, "unauthorized");
		assert!(devices[0].model.is_none());
		assert_eq!(devices[1].serial, "R58M123ABC");
		assert_eq!(devices[1].state, "device");
		assert_eq!(devices[1].model.as_deref(), Some("SM_G998U1"));
	}
}
