"""统一 Model Gateway：不绑定单一模型厂商，离线/无密钥时确定性降级。"""
from __future__ import annotations

import os
from typing import Any

import httpx


class ModelGateway:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.getenv("SICHAO_API_KEY", "")).strip()
        self.base_url = (base_url or os.getenv("SICHAO_BASE_URL", "https://api.openai.com/v1")).rstrip("/")
        self.model = (model or os.getenv("SICHAO_MODEL", "gpt-4o-mini")).strip()

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    @classmethod
    def from_user_headers(cls, headers: Any) -> "ModelGateway":
        """BYOK：仅使用用户请求头透传的自有 API 额度，绝不落盘、绝不消耗平台 Token。"""
        key = (headers.get("x-user-api-key") or "").strip()
        base = (headers.get("x-user-base-url") or "").strip() or "https://api.openai.com/v1"
        model = (headers.get("x-user-model") or "").strip() or "gpt-4o-mini"
        return cls(api_key=key, base_url=base, model=model)

    async def complete(self, messages: list[dict[str, str]], temperature: float = 0.2) -> str | None:
        if not self.configured:
            return None
        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                res = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"model": self.model, "temperature": temperature, "messages": messages},
                )
                res.raise_for_status()
                data: dict[str, Any] = res.json()
                text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                return str(text).strip() or None
        except Exception:
            return None
