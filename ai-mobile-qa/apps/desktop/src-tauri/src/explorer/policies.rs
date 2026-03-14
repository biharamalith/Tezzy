use std::collections::HashSet;

use crate::drivers::uihierarchy::UiElement;

/// Priority labels used to prefer common action buttons when selecting
/// a candidate to tap during the smoke check.
///
/// Comparisons are case-insensitive, substring matches.
/// **Security**: This list is hard-coded; it never accepts user input.
const PRIORITY_LABELS: &[&str] = &[
	"allow",
	"ok",
	"accept",
	"yes",
	"next",
	"continue",
	"proceed",
	"confirm",
	"done",
	"submit",
	"login",
	"log in",
	"sign in",
	"sign up",
	"register",
	"start",
	"get started",
	"skip",
	"close",
	"retry",
];

/// Produces a stable deduplication key for a UI element.
///
/// Combines resource-id and bounds so the same logical button at the same
/// position is only tapped once per smoke-check run.
pub fn elem_key(el: &UiElement) -> String {
	format!("{}::{}", el.resource_id, el.bounds)
}

/// Selects the best candidate element to tap next, using a three-pass heuristic.
///
/// **Pass 1** — Interactive, enabled node whose text or content-desc contains a
///   priority label (case-insensitive). Preferring known action words means we
///   navigate real flows rather than dismissing random taps.
///
/// **Pass 2** — Any interactive, enabled node with a non-empty label (text or
///   content-desc) that has not been tapped yet.
///
/// **Pass 3** — Any interactive, enabled node not yet tapped (may be unlabelled).
///
/// **Pass 4** — Any enabled, unseen node with a useful label, even if it is not
/// explicitly marked interactive. Some Android views omit clickable flags but still
/// react to center taps through parent delegation.
///
/// Returns `None` if no interactable node exists on the current screen.
///
/// **Security**: `seen_ids` is built from device-sourced data; no path or shell
/// injection is possible — keys are pure strings.
/// **Complexity**: O(n) over `elements` per pass. n < 500 in practice.
pub fn select_candidate<'a>(
	elements: &'a [UiElement],
	seen_ids: &HashSet<String>,
) -> Option<&'a UiElement> {
	let unseen_interactive: Vec<&UiElement> = elements
		.iter()
		.filter(|el| {
			let interactive = el.clickable || el.scrollable || el.checkable;
			interactive && el.enabled && !seen_ids.contains(&elem_key(el))
		})
		.collect();

	// Pass 1 – priority label
	for el in &unseen_interactive {
		let haystack = format!("{} {}", el.text, el.content_desc).to_lowercase();
		if PRIORITY_LABELS.iter().any(|&p| haystack.contains(p)) {
			return Some(el);
		}
	}

	// Pass 2 – any labelled interactive
	for el in &unseen_interactive {
		if !el.text.is_empty() || !el.content_desc.is_empty() {
			return Some(el);
		}
	}

	// Pass 3 – any interactive
	if let Some(candidate) = unseen_interactive.into_iter().next() {
		return Some(candidate);
	}

	// Pass 4 – fallback to labelled enabled nodes (non-interactive)
	elements
		.iter()
		.filter(|el| {
			el.enabled
				&& !seen_ids.contains(&elem_key(el))
				&& (!el.text.is_empty() || !el.content_desc.is_empty() || !el.resource_id.is_empty())
		})
		.next()
}
