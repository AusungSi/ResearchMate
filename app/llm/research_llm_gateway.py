from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

import httpx

from app.core.config import Settings, get_settings
from app.llm.openclaw_client import LLMTaskType, OpenClawClient


@dataclass
class ResearchLLMResponse:
    text: str
    provider: str
    model: str
    latency_ms: int


class ResearchLLMGateway:
    def __init__(
        self,
        *,
        settings: Settings | None = None,
        openclaw_client: OpenClawClient | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.openclaw_client = openclaw_client or OpenClawClient(settings=self.settings)

    def chat_text(
        self,
        *,
        backend: str,
        prompt: str,
        system_prompt: str | None = None,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 1200,
    ) -> ResearchLLMResponse:
        backend_norm = (backend or "gpt").strip().lower()
        if backend_norm == "openclaw":
            return self._chat_openclaw(
                prompt=prompt,
                system_prompt=system_prompt,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        return self._chat_gpt(
            prompt=prompt,
            system_prompt=system_prompt,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    def _chat_openclaw(
        self,
        *,
        prompt: str,
        system_prompt: str | None,
        model: str | None,
        temperature: float,
        max_tokens: int,
    ) -> ResearchLLMResponse:
        if self.settings.openclaw_cli_fallback_enabled:
            try:
                result = self.openclaw_client.chat_completion_cli_fallback(
                    task_type=LLMTaskType.RESEARCH_PLAN,
                    prompt=prompt,
                    system_prompt=system_prompt,
                    user=None,
                    max_tokens=max_tokens,
                )
            except Exception:
                result = self.openclaw_client.chat_completion(
                    task_type=LLMTaskType.RESEARCH_PLAN,
                    prompt=prompt,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
        else:
            result = self.openclaw_client.chat_completion(
                task_type=LLMTaskType.RESEARCH_PLAN,
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        return ResearchLLMResponse(
            text=result.text,
            provider=result.provider,
            model=model or result.model,
            latency_ms=result.latency_ms,
        )

    def _chat_gpt(
        self,
        *,
        prompt: str,
        system_prompt: str | None,
        model: str | None,
        temperature: float,
        max_tokens: int,
    ) -> ResearchLLMResponse:
        api_key = self.settings.research_gpt_api_key.strip()
        chosen_model = (model or self.settings.research_gpt_model).strip()
        if not api_key:
            text = self._fallback_response(prompt)
            return ResearchLLMResponse(text=text, provider="template", model=chosen_model, latency_ms=0)

        base_url = self.settings.research_gpt_base_url.rstrip("/")
        if not base_url.endswith("/chat/completions"):
            if base_url.endswith("/v1"):
                base_url = f"{base_url}/chat/completions"
            else:
                base_url = f"{base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        messages: list[dict[str, str]] = []
        if system_prompt and system_prompt.strip():
            messages.append({"role": "system", "content": system_prompt.strip()})
        messages.append({"role": "user", "content": prompt.strip()})
        payload = {
            "model": chosen_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        started = perf_counter()
        try:
            with httpx.Client(timeout=max(5, int(self.settings.research_gpt_timeout_seconds))) as client:
                resp = client.post(base_url, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except Exception:
            text = self._fallback_response(prompt)
            return ResearchLLMResponse(text=text, provider="template_fallback", model=chosen_model, latency_ms=0)

        content = ""
        choices = data.get("choices") or []
        if choices:
            message = choices[0].get("message") or {}
            content = str(message.get("content") or "").strip()
        if not content:
            content = self._fallback_response(prompt)
        return ResearchLLMResponse(
            text=content,
            provider="gpt_api",
            model=chosen_model,
            latency_ms=int((perf_counter() - started) * 1000),
        )

    @staticmethod
    def _fallback_response(prompt: str) -> str:
        clipped = " ".join((prompt or "").split())[:360]
        if not clipped:
            return "当前上下文为空，建议先选择一个节点或补充问题。"
        return f"基于当前节点上下文的保守回答：{clipped}"
