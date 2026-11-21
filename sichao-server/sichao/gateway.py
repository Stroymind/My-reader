"""统一 Model Gateway：不绑定单一模型厂商，离线/无密钥时确定性降级，纯 BYOK 透传用户自有 API Key。"""
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

    async def complete_with_usage(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.2,
    ) -> tuple[str | None, dict[str, int]]:
        zero = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        if not self.configured:
            return None, zero
        try:
            async with httpx.AsyncClient(timeout=35.0) as client:
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
                msg = data.get("choices", [{}])[0].get("message", {}) or {}
                text = str(msg.get("content") or "").strip()
                raw_usage = data.get("usage") or {}
                pt = int(raw_usage.get("prompt_tokens") or 0)
                ct = int(raw_usage.get("completion_tokens") or 0)
                tt = int(raw_usage.get("total_tokens") or (pt + ct))
                if not tt:
                    est_in = max(1, sum(len(str(m.get("content") or "")) for m in messages) // 2)
                    est_out = max(1, len(text) // 2)
                    pt, ct, tt = est_in, est_out, est_in + est_out
                return (text or None), {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt}
        except Exception:
            return None, zero

    async def complete(self, messages: list[dict[str, str]], temperature: float = 0.2) -> str | None:
        text, _ = await self.complete_with_usage(messages, temperature=temperature)
        return text

    async def check_balance(self) -> dict[str, Any]:
        """纯 BYOK 实时余额查询（仅向用户自己的模型服务商官方接口发起只读查询，绝不保存密钥）。"""
        if not self.configured:
            return {"ok": False, "supported": False, "reason": "未提供 API Key"}
        base_low = self.base_url.lower()
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                # 1. DeepSeek 官方余额接口: GET https://api.deepseek.com/user/balance
                if "deepseek.com" in base_low:
                    root = self.base_url[:-3] if base_low.endswith("/v1") else self.base_url
                    r = await client.get(f"{root}/user/balance", headers=headers)
                    if r.status_code == 200:
                        data = r.json()
                        infos = data.get("balance_infos") or []
                        if infos:
                            top = infos[0]
                            cur = str(top.get("currency") or "CNY").upper()
                            bal = float(top.get("total_balance") or 0)
                            return {
                                "ok": True,
                                "supported": True,
                                "provider": "DeepSeek",
                                "currency": cur,
                                "balance": bal,
                                "is_available": bool(data.get("is_available", bal > 0)),
                            }
                    return {"ok": False, "supported": True, "provider": "DeepSeek", "reason": f"HTTP {r.status_code}"}

                # 2. OpenRouter 官方余额接口: GET https://openrouter.ai/api/v1/credits
                if "openrouter.ai" in base_low:
                    r = await client.get("https://openrouter.ai/api/v1/credits", headers=headers)
                    if r.status_code == 200:
                        d = (r.json().get("data") or {})
                        total = float(d.get("total_credits") or 0)
                        used = float(d.get("total_usage") or 0)
                        return {
                            "ok": True,
                            "supported": True,
                            "provider": "OpenRouter",
                            "currency": "USD",
                            "balance": max(0.0, total - used),
                            "total_credits": total,
                            "total_usage": used,
                        }
                    return {"ok": False, "supported": True, "provider": "OpenRouter", "reason": f"HTTP {r.status_code}"}

                # 3. 硅基流动 SiliconFlow: GET https://api.siliconflow.cn/v1/user/info
                if "siliconflow" in base_low:
                    r = await client.get(f"{self.base_url}/user/info", headers=headers)
                    if r.status_code == 200:
                        d = (r.json().get("data") or {})
                        bal = float(d.get("totalBalance") or d.get("balance") or 0)
                        return {
                            "ok": True,
                            "supported": True,
                            "provider": "SiliconFlow",
                            "currency": "CNY",
                            "balance": bal,
                        }
                    return {"ok": False, "supported": True, "provider": "SiliconFlow", "reason": f"HTTP {r.status_code}"}

                return {
                    "ok": False,
                    "supported": False,
                    "reason": "当前服务商未开放直接余额查询接口，已改用充值金额与真实 Token 单价本地实时估算。",
                }
        except Exception as exc:
            return {"ok": False, "supported": False, "reason": f"查询异常：{exc}"}
