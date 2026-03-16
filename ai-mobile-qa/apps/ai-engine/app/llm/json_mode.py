from __future__ import annotations

from typing import Any, Dict, Iterable


def ensure_keys_exact(payload: Dict[str, Any], *, allowed_keys: Iterable[str]) -> Dict[str, Any]:
	allowed = set(allowed_keys)
	extra = set(payload.keys()) - allowed
	missing = allowed - set(payload.keys())
	if missing:
		raise ValueError(f"Missing required keys: {sorted(missing)}")
	if extra:
		raise ValueError(f"Unexpected keys in JSON: {sorted(extra)}")
	return payload
