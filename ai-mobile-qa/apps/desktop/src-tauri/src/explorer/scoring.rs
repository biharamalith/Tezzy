use sha2::{Digest, Sha256};

use crate::drivers::uihierarchy::UiElement;

/// Computes a deterministic 64-char hex hash of the current UI screen state.
///
/// The hash is derived from each element's class, text, resource-id, and bounds
/// in document order. Two screens with identical element trees produce the same
/// hash; a single changed element produces a different one.
///
/// **Design**: Used by the smoke check to detect:
///   - **Dead taps**: hash unchanged after tapping — the tap had no visible effect.
///   - **Loops**: hash seen ≥ 3 times within a run — the agent is cycling.
///
/// **Complexity**: O(n) over elements, constant per element.
/// **Memory**: O(1) — sha2 is a streaming hasher; elements are not buffered.
pub fn screen_hash(elements: &[UiElement]) -> String {
	let mut hasher = Sha256::new();

	for el in elements {
		// Mix class, text, resource-id, and bounds separated by NUL bytes so
		// adjacent fields cannot collide (e.g., text="" + id="ab" ≠ text="a" + id="b").
		hasher.update(el.class.as_bytes());
		hasher.update(b"\x00");
		hasher.update(el.text.as_bytes());
		hasher.update(b"\x00");
		hasher.update(el.resource_id.as_bytes());
		hasher.update(b"\x00");
		hasher.update(el.bounds.as_bytes());
		hasher.update(b"\n");
	}

	let result = hasher.finalize();
	format!("{:x}", result)
}
