import json
import os
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI


def _env_first(*keys: str) -> Optional[str]:
	for key in keys:
		value = os.getenv(key)
		if value and value.strip():
			return value.strip()
	return None


class LLMClient:
	def __init__(self, *, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
		resolved_api_key = api_key or _env_first("OPENAI_API_KEY", "OPENROUTER_API_KEY")
		resolved_base_url = _env_first("OPENAI_BASE_URL", "OPENROUTER_BASE_URL")

		# Auto-wire OpenRouter URL when a sk-or-v1 style key is present and
		# no explicit base URL was configured.
		if not resolved_base_url and resolved_api_key and resolved_api_key.startswith("sk-or-v1-"):
			resolved_base_url = "https://openrouter.ai/api/v1"

		default_headers: Optional[Dict[str, str]] = None
		if resolved_base_url and "openrouter.ai" in resolved_base_url:
			default_headers = {}
			site_url = _env_first("OPENROUTER_SITE_URL")
			app_name = _env_first("OPENROUTER_APP_NAME")
			if site_url:
				default_headers["HTTP-Referer"] = site_url
			if app_name:
				default_headers["X-Title"] = app_name
			if not default_headers:
				default_headers = None

		self._client = AsyncOpenAI(
			api_key=resolved_api_key,
			base_url=resolved_base_url,
			default_headers=default_headers,
		)
		self._model = model or os.getenv("TEZZY_LLM_MODEL", "gpt-4.1-mini")
		
		vision_api_key = _env_first("OPENAI_VISION_API_KEY", "OPENAI_API_KEY") or resolved_api_key
		vision_base_url = _env_first("OPENAI_VISION_BASE_URL")
		if not vision_base_url and resolved_base_url and "groq.com" not in resolved_base_url.lower():
			vision_base_url = resolved_base_url
			
		self._vision_client = AsyncOpenAI(
			api_key=vision_api_key,
			base_url=vision_base_url,
			default_headers=default_headers if vision_base_url == resolved_base_url else None,
		)
		
		self._vision_model = os.getenv(
			"TEZZY_VISION_MODEL",
			"openai/gpt-4o" if resolved_base_url and "openrouter.ai" in resolved_base_url else "gpt-4o",
		)

	async def chat_json_messages(
		self,
		*,
		system_prompt: str,
		user_messages: list[str],
		temperature: float = 0.0,
		model: Optional[str] = None,
		timeout_s: float = 60.0,
	) -> Dict[str, Any]:
		# OpenAI requires the literal word "json" somewhere in the messages when using
		# `response_format={"type": "json_object"}`. Some of our prompt templates only
		# mention "JSON" (uppercase), so we always prepend a minimal guard message that
		# contains lowercase "json" without mutating the templates.
		messages: list[dict[str, str]] = [
			{"role": "system", "content": "Respond with json only."},
			{"role": "system", "content": system_prompt},
			*[{"role": "user", "content": m} for m in user_messages],
		]

		resp = await self._client.chat.completions.create(
			model=model or self._model,
			temperature=temperature,
			response_format={"type": "json_object"},
			timeout=timeout_s,
			messages=messages,
		)

		content = resp.choices[0].message.content
		if not content:
			raise ValueError("LLM returned empty content")

		try:
			return json.loads(content)
		except json.JSONDecodeError as e:
			raise ValueError(f"LLM did not return valid JSON: {e}\nRaw: {content}")

	async def chat_json(
		self,
		*,
		system_prompt: str,
		user_prompt: str,
		temperature: float = 0.0,
		model: Optional[str] = None,
		timeout_s: float = 60.0,
	) -> Dict[str, Any]:
		return await self.chat_json_messages(
			system_prompt=system_prompt,
			user_messages=[user_prompt],
			temperature=temperature,
			model=model,
			timeout_s=timeout_s,
		)

	async def chat_vision_json(
		self,
		*,
		system_prompt: str,
		text_prompt: str,
		image_b64: str,
		temperature: float = 0.0,
		timeout_s: float = 90.0,
	) -> Dict[str, Any]:
		"""Send a screenshot + text prompt to GPT-4o vision and return parsed JSON.

		`image_b64` must be a raw base64-encoded PNG/JPEG string (no data-URL prefix).
		Always uses gpt-4o regardless of the model configured in the environment,
		because mini-class models do not support vision.
		"""
		messages: List[dict] = [
			{"role": "system", "content": "Respond with json only."},
			{"role": "system", "content": system_prompt},
			{
				"role": "user",
				"content": [
					{
						"type": "image_url",
						"image_url": {
							"url": f"data:image/png;base64,{image_b64}",
							"detail": "high",
						},
					},
					{"type": "text", "text": text_prompt},
				],
			},
		]

		resp = await self._vision_client.chat.completions.create(
			model=self._vision_model,
			temperature=temperature,
			response_format={"type": "json_object"},
			timeout=timeout_s,
			messages=messages,
		)

		content = resp.choices[0].message.content
		if not content:
			raise ValueError("LLM returned empty vision response")

		try:
			return json.loads(content)
		except json.JSONDecodeError as e:
			raise ValueError(f"LLM did not return valid JSON (vision): {e}\nRaw: {content}")

	@property
	def agent_model(self) -> str:
		"""The model of the single-agent loop. It must read images: it sees every screenshot."""
		return os.getenv("TEZZY_AGENT_MODEL", "").strip() or self._vision_model

	async def chat_tools(
		self,
		messages: List[Dict[str, Any]],
		tools: List[Dict[str, Any]],
		tool_choice: Any = "required",
		*,
		temperature: float = 0.2,
		timeout_s: float = 120.0,
	) -> Dict[str, Any]:
		"""One tool-calling turn of the agent, on the vision-capable client.

		Returns a plain dict so the agent session does not depend on the SDK's types:
		{"content": str | None, "tool_calls": [{"id", "name", "arguments"}], "usage": {...}}
		"""
		resp = await self._vision_client.chat.completions.create(
			model=self.agent_model,
			messages=messages,
			tools=tools,
			tool_choice=tool_choice,
			temperature=temperature,
			timeout=timeout_s,
		)
		if not resp.choices:
			raise ValueError("LLM returned no choices")
		msg = resp.choices[0].message
		usage = getattr(resp, "usage", None)
		return {
			"content": msg.content,
			"tool_calls": [
				{"id": c.id, "name": c.function.name, "arguments": c.function.arguments}
				for c in (msg.tool_calls or [])
				if getattr(c, "function", None) is not None
			],
			"usage": {
				"prompt_tokens": getattr(usage, "prompt_tokens", 0) or 0,
				"completion_tokens": getattr(usage, "completion_tokens", 0) or 0,
			},
		}
