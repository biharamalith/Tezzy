import json
import os
from typing import Any, Dict, Optional

from openai import AsyncOpenAI


class LLMClient:
	def __init__(self, *, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
		self._client = AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
		self._model = model or os.getenv("TEZZY_LLM_MODEL", "gpt-4.1-mini")

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
