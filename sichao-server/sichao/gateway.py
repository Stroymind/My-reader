"""统一 Model Gateway：不绑定单一模型厂商，离线/无密钥时确定性降级，纯 BYOK 透传用户自有 API Key。"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

import httpx

_QUOTA_ERR_RE = re.compile(r"(insufficient|exceeded.*quota|balance|billing|credit|欠费|余额不足|quota_exceeded)", re.IGNORECASE)


def extract_api_error_text(data: Any, fallback: str = "") -> str:
    if isinstance(data, list) and data:
        return extract_api_error_text(data[0], fallback)
    if isinstance(data, dict):
        err_obj = data.get("error")
        if isinstance(err_obj, dict):
            meta_raw = (err_obj.get("metadata") or {}).get("raw") if isinstance(err_obj.get("metadata"), dict) else ""
            msg = str(err_obj.get("message") or "").strip()
            if meta_raw and meta_raw not in msg:
                return f"{msg} ({str(meta_raw)[:140]})".strip()
            if msg:
                return msg
        elif isinstance(err_obj, str) and err_obj.strip():
            return err_obj.strip()
        for k in ("message", "detail", "msg", "error_msg"):
            v = str(data.get(k) or "").strip()
            if v:
                return v
    return str(fallback or "").strip()[:200]

_NEEDS_V1_RE = re.compile(
    r"^https?://(api\.openai\.com|api\.siliconflow\.cn|api\.moonshot\.cn|api\.x\.ai|openrouter\.ai/api|api\.groq\.com/openai|dashscope\.aliyuncs\.com/compatible-mode)$",
    re.IGNORECASE,
)
_NO_TEMP_MODEL_RE = re.compile(r"(?:^|/)(?:o1|o3|o4|gpt-5|codex)", re.IGNORECASE)
_RESPONSES_ONLY_RE = re.compile(r"(?:^|/).*codex", re.IGNORECASE)


def resolve_chat_endpoint(raw_base: str, model: str = "") -> tuple[str, str]:
    """智能规范化接口地址，返回 (endpoint_url, protocol['openai'|'openai-responses'|'anthropic'])。"""
    base = re.sub(r"[\s\u200b\u200c\u200d\ufeff]+", "", str(raw_base or "")).rstrip("/")
    if not base:
        base = "https://generativelanguage.googleapis.com/v1beta/openai"
    if not re.match(r"^https?://", base, re.IGNORECASE):
        base = "https://" + base
    low = base.lower()
    if "api.anthropic.com" in low:
        if low.endswith("/messages"):
            return base, "anthropic"
        if low.endswith("/v1"):
            return f"{base}/messages", "anthropic"
        return f"{base}/v1/messages", "anthropic"
    if "generativelanguage.googleapis.com" in low:
        if low.endswith("/chat/completions"):
            return base, "openai"
        if low.endswith("/openai"):
            return f"{base}/chat/completions", "openai"
        if low.endswith("/v1beta") or low.endswith("/v1"):
            return f"{base}/openai/chat/completions", "openai"
        return f"{base}/v1beta/openai/chat/completions", "openai"
    if low.endswith("/responses"):
        return base, "openai-responses"
    if "api.openai.com" in low and _RESPONSES_ONLY_RE.search(str(model or "")):
        root_base = re.sub(r"/chat/completions$", "", base, flags=re.IGNORECASE)
        if not root_base.lower().endswith("/v1"):
            root_base = f"{root_base}/v1"
        return f"{root_base}/responses", "openai-responses"
    if low.endswith("/chat/completions"):
        return base, "openai"
    if _NEEDS_V1_RE.match(base):
        return f"{base}/v1/chat/completions", "openai"
    return f"{base}/chat/completions", "openai"


def _is_private_target(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").strip().lower()
        if not host or host in ("localhost", "0.0.0.0") or host.endswith(".local"):
            return True
        try:
            ip = ipaddress.ip_address(host)
            return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        except ValueError:
            return False
    except Exception:
        return True


class ModelGateway:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.getenv("SICHAO_API_KEY", "")).strip()
        self.base_url = re.sub(r"[\s\u200b\u200c\u200d\ufeff]+", "", (base_url or os.getenv("SICHAO_BASE_URL", "https://api.openai.com/v1"))).rstrip("/")
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

    async def complete_detailed(
        self,
        messages: list[dict[str, Any]],
        temperature: float = 0.25,
    ) -> dict[str, Any]:
        zero = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        if not self.configured:
            return {"ok": False, "status": 400, "error": "尚未提供 API Key", "usage": zero}
        endpoint, proto = resolve_chat_endpoint(self.base_url, self.model)
        if _is_private_target(endpoint):
            return {"ok": False, "status": 400, "error": "云端中转仅支持公网接口地址；局域网地址请用手机直连", "usage": zero}
        try:
            async with httpx.AsyncClient(timeout=50.0) as client:
                if proto == "openai-responses":
                    sys_parts_r: list[str] = []
                    inp_msgs: list[dict[str, Any]] = []
                    for m in messages:
                        role = m.get("role", "user")
                        raw_c = m.get("content")
                        if role == "system":
                            sys_parts_r.append(str(raw_c or ""))
                        else:
                            inp_msgs.append({"role": "assistant" if role == "assistant" else "user", "content": str(raw_c or "")})
                    r_body: dict[str, Any] = {"model": self.model, "input": inp_msgs or [{"role": "user", "content": "你好"}]}
                    if sys_parts_r:
                        r_body["instructions"] = "\n\n".join(sys_parts_r)
                    res = await client.post(
                        endpoint,
                        headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                        json=r_body,
                    )
                    try:
                        data = res.json()
                    except Exception:
                        data = {}
                    if not res.is_success:
                        err_msg = extract_api_error_text(data, res.text[:200])
                        return {"ok": False, "status": res.status_code, "error": err_msg or f"请求失败（HTTP {res.status_code}）", "usage": zero}
                    text = str(data.get("output_text") or "").strip()
                    if not text:
                        parts_out: list[str] = []
                        for item in (data.get("output") or []):
                            if isinstance(item, dict):
                                if isinstance(item.get("text"), str):
                                    parts_out.append(item["text"])
                                for c in (item.get("content") or []):
                                    if isinstance(c, dict) and isinstance(c.get("text"), str):
                                        parts_out.append(c["text"])
                        text = "\n".join(parts_out).strip()
                    raw_u = data.get("usage") or {}
                    pt = int(raw_u.get("input_tokens") or 0)
                    ct = int(raw_u.get("output_tokens") or 0)
                    tt = int(raw_u.get("total_tokens") or (pt + ct))
                    return {
                        "ok": bool(text),
                        "status": res.status_code,
                        "content": text,
                        "reasoning": "",
                        "usage": {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt},
                        "error": "" if text else "模型没有返回文字",
                    }
                if proto == "anthropic":
                    sys_parts: list[str] = []
                    user_msgs: list[dict[str, Any]] = []
                    for m in messages:
                        role = m.get("role", "user")
                        raw_c = m.get("content")
                        if role == "system":
                            sys_parts.append(str(raw_c or ""))
                            continue
                        if isinstance(raw_c, list):
                            blocks_in: list[dict[str, Any]] = []
                            for part in raw_c:
                                if not isinstance(part, dict):
                                    continue
                                if part.get("type") == "text":
                                    blocks_in.append({"type": "text", "text": str(part.get("text") or "")})
                                elif part.get("type") == "image_url":
                                    u = str((part.get("image_url") or {}).get("url") or "")
                                    dm = re.match(r"^data:(image/[^;]+);base64,(.+)$", u, re.DOTALL)
                                    if dm:
                                        blocks_in.append({
                                            "type": "image",
                                            "source": {"type": "base64", "media_type": dm.group(1), "data": dm.group(2)},
                                        })
                            user_msgs.append({"role": role, "content": blocks_in or [{"type": "text", "text": ""}]})
                        else:
                            user_msgs.append({"role": role, "content": str(raw_c or "")})
                    if not user_msgs:
                        user_msgs = [{"role": "user", "content": "你好"}]
                    body: dict[str, Any] = {
                        "model": self.model,
                        "max_tokens": 2048,
                        "temperature": temperature,
                        "messages": user_msgs,
                    }
                    if sys_parts:
                        body["system"] = "\n\n".join(sys_parts)
                    res = await client.post(
                        endpoint,
                        headers={
                            "x-api-key": self.api_key,
                            "anthropic-version": "2023-06-01",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    )
                    data: dict[str, Any] = res.json() if res.content else {}
                    if not res.is_success:
                        err_msg = (data.get("error") or {}).get("message") or f"请求失败（HTTP {res.status_code}）"
                        return {"ok": False, "status": res.status_code, "error": err_msg, "usage": zero}
                    blocks = data.get("content") or []
                    text = "\n".join(str(b.get("text") or "") for b in blocks if isinstance(b, dict) and b.get("type") == "text").strip()
                    raw_u = data.get("usage") or {}
                    pt = int(raw_u.get("input_tokens") or 0)
                    ct = int(raw_u.get("output_tokens") or 0)
                    return {
                        "ok": bool(text),
                        "status": res.status_code,
                        "content": text,
                        "reasoning": "",
                        "usage": {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct},
                        "error": "" if text else "模型没有返回文字",
                    }

                res = None
                data: Any = {}
                req_payload: dict[str, Any] = {"model": self.model, "messages": messages}
                if not _NO_TEMP_MODEL_RE.search(self.model):
                    req_payload["temperature"] = temperature
                for attempt in range(2):
                    res = await client.post(
                        endpoint,
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=req_payload,
                    )
                    try:
                        data = res.json()
                    except Exception:
                        data = {}
                    if res.status_code == 429 and attempt == 0:
                        err_preview = extract_api_error_text(data, res.text[:200])
                        if not _QUOTA_ERR_RE.search(err_preview):
                            await asyncio.sleep(1.5)
                            continue
                    break
                assert res is not None
                if not res.is_success:
                    err_msg = extract_api_error_text(data, res.text[:200])
                    return {
                        "ok": False,
                        "status": res.status_code,
                        "error": err_msg or f"请求失败（HTTP {res.status_code}）",
                        "usage": zero,
                    }
                msg = (data.get("choices") or [{}])[0].get("message", {}) or {}
                text = str(msg.get("content") or "").strip()
                reasoning = str(msg.get("reasoning_content") or "").strip()
                raw_usage = data.get("usage") or {}
                pt = int(raw_usage.get("prompt_tokens") or 0)
                ct = int(raw_usage.get("completion_tokens") or 0)
                tt = int(raw_usage.get("total_tokens") or (pt + ct))
                if not tt and text:
                    est_in = max(1, sum(len(str(m.get("content") or "")) for m in messages) // 2)
                    est_out = max(1, (len(text) + len(reasoning)) // 2)
                    pt, ct, tt = est_in, est_out, est_in + est_out
                return {
                    "ok": bool(text),
                    "status": res.status_code,
                    "content": text,
                    "reasoning": reasoning,
                    "usage": {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt},
                    "error": "" if text else "模型没有返回文字",
                }
        except httpx.TimeoutException:
            return {"ok": False, "status": 504, "error": "上游模型响应超时，请稍后再试", "usage": zero}
        except Exception as exc:
            return {"ok": False, "status": 502, "error": f"上游连接异常：{exc}", "usage": zero}

    async def complete_with_usage(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.2,
    ) -> tuple[str | None, dict[str, int]]:
        res = await self.complete_detailed(messages, temperature=temperature)
        if not res.get("ok"):
            return None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        return (res.get("content") or None), res.get("usage") or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    async def complete(self, messages: list[dict[str, str]], temperature: float = 0.2) -> str | None:
        text, _ = await self.complete_with_usage(messages, temperature=temperature)
        return text

    async def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.2,
    ) -> dict[str, Any]:
        """原生 Function Calling（OpenAI/Gemini/OpenRouter/Grok `tools`/`tool_calls` 与 Anthropic `tools`/`tool_use`）。"""
        zero = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        if not self.configured:
            return {"ok": False, "status": 400, "protocol": "openai", "content": "", "tool_calls": [], "tools_unsupported": False, "error": "尚未提供 API Key", "usage": zero}
        endpoint, proto = resolve_chat_endpoint(self.base_url, self.model)
        if _is_private_target(endpoint):
            return {"ok": False, "status": 400, "protocol": proto, "content": "", "tool_calls": [], "tools_unsupported": False, "error": "云端中转仅支持公网接口地址；局域网地址请用手机直连", "usage": zero}
        if not tools or proto == "openai-responses":
            res = await self.complete_detailed(messages, temperature=temperature)
            return {
                **res,
                "protocol": proto,
                "tool_calls": [],
                "raw_assistant_message": {"role": "assistant", "content": res.get("content") or ""},
                "tools_unsupported": proto == "openai-responses",
            }
        try:
            async with httpx.AsyncClient(timeout=55.0) as client:
                if proto == "anthropic":
                    sys_parts: list[str] = []
                    ant_msgs: list[dict[str, Any]] = []
                    for m in messages:
                        role = m.get("role", "user")
                        raw_c = m.get("content")
                        if role == "system":
                            sys_parts.append(str(raw_c or ""))
                            continue
                        if isinstance(raw_c, list):
                            ant_msgs.append({"role": "assistant" if role == "assistant" else "user", "content": raw_c})
                        else:
                            ant_msgs.append({"role": "assistant" if role == "assistant" else "user", "content": str(raw_c or "")})
                    ant_tools = []
                    for t in tools:
                        fn = t.get("function") if isinstance(t, dict) else None
                        if not isinstance(fn, dict):
                            continue
                        ant_tools.append({
                            "name": str(fn.get("name") or ""),
                            "description": str(fn.get("description") or ""),
                            "input_schema": fn.get("parameters") or {"type": "object", "properties": {}},
                        })
                    body: dict[str, Any] = {
                        "model": self.model,
                        "max_tokens": 2048,
                        "temperature": temperature,
                        "messages": ant_msgs or [{"role": "user", "content": "你好"}],
                        "tools": ant_tools,
                    }
                    if sys_parts:
                        body["system"] = "\n\n".join(sys_parts)
                    res = await client.post(
                        endpoint,
                        headers={
                            "x-api-key": self.api_key,
                            "anthropic-version": "2023-06-01",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    )
                    try:
                        data = res.json() if res.content else {}
                    except Exception:
                        data = {}
                    if not res.is_success:
                        err_msg = extract_api_error_text(data, res.text[:200])
                        unsupported = res.status_code in (400, 422) and bool(re.search(r"(tool|function|schema|unsupported)", err_msg, re.I))
                        return {"ok": False, "status": res.status_code, "protocol": "anthropic", "content": "", "tool_calls": [], "tools_unsupported": unsupported, "error": err_msg or f"HTTP {res.status_code}", "usage": zero}
                    blocks = data.get("content") or []
                    text_parts: list[str] = []
                    tool_calls: list[dict[str, Any]] = []
                    for b in blocks:
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") == "text":
                            text_parts.append(str(b.get("text") or ""))
                        elif b.get("type") == "tool_use":
                            tool_calls.append({
                                "id": str(b.get("id") or f"call_{len(tool_calls)}"),
                                "name": str(b.get("name") or ""),
                                "arguments": b.get("input") if isinstance(b.get("input"), dict) else {},
                            })
                    raw_u = data.get("usage") or {}
                    pt = int(raw_u.get("input_tokens") or 0)
                    ct = int(raw_u.get("output_tokens") or 0)
                    text = "\n".join(p for p in text_parts if p).strip()
                    return {
                        "ok": bool(text or tool_calls),
                        "status": res.status_code,
                        "protocol": "anthropic",
                        "content": text,
                        "reasoning": "",
                        "tool_calls": tool_calls,
                        "raw_assistant_message": {"role": "assistant", "content": blocks},
                        "tools_unsupported": False,
                        "usage": {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct},
                        "error": "" if (text or tool_calls) else "模型没有返回文字或工具调用",
                    }

                req_payload: dict[str, Any] = {
                    "model": self.model,
                    "messages": messages,
                    "tools": tools,
                    "tool_choice": "auto",
                }
                if not _NO_TEMP_MODEL_RE.search(self.model):
                    req_payload["temperature"] = temperature
                res = None
                data: Any = {}
                for attempt in range(2):
                    res = await client.post(
                        endpoint,
                        headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                        json=req_payload,
                    )
                    try:
                        data = res.json() if res.content else {}
                    except Exception:
                        data = {}
                    if res.status_code == 429 and attempt == 0:
                        err_preview = extract_api_error_text(data, res.text[:200])
                        if not _QUOTA_ERR_RE.search(err_preview):
                            await asyncio.sleep(1.5)
                            continue
                    break
                assert res is not None
                if not res.is_success:
                    err_msg = extract_api_error_text(data, res.text[:200])
                    unsupported = res.status_code in (400, 404, 422) and bool(re.search(r"(tool|function|tool_choice|unsupported|not support)", err_msg, re.I))
                    return {"ok": False, "status": res.status_code, "protocol": "openai", "content": "", "tool_calls": [], "tools_unsupported": unsupported, "error": err_msg or f"HTTP {res.status_code}", "usage": zero}
                msg = (data.get("choices") or [{}])[0].get("message", {}) or {}
                text = str(msg.get("content") or "").strip()
                reasoning = str(msg.get("reasoning_content") or "").strip()
                raw_tcs = msg.get("tool_calls") or []
                tool_calls: list[dict[str, Any]] = []
                for idx_tc, tc in enumerate(raw_tcs):
                    if not isinstance(tc, dict):
                        continue
                    fn = tc.get("function") or {}
                    name = str(fn.get("name") or "").strip()
                    raw_args = fn.get("arguments")
                    parsed_args: Any = {}
                    if isinstance(raw_args, dict):
                        parsed_args = raw_args
                    elif isinstance(raw_args, str) and raw_args.strip():
                        try:
                            parsed_args = json.loads(raw_args)
                        except Exception:
                            parsed_args = {"arg": raw_args}
                    if name:
                        tool_calls.append({
                            "id": str(tc.get("id") or f"call_{idx_tc}"),
                            "name": name,
                            "arguments": parsed_args,
                        })
                raw_usage = data.get("usage") or {}
                pt = int(raw_usage.get("prompt_tokens") or 0)
                ct = int(raw_usage.get("completion_tokens") or 0)
                tt = int(raw_usage.get("total_tokens") or (pt + ct))
                raw_assist: dict[str, Any] = {"role": "assistant", "content": msg.get("content") or ""}
                if raw_tcs:
                    raw_assist["tool_calls"] = raw_tcs
                return {
                    "ok": bool(text or tool_calls),
                    "status": res.status_code,
                    "protocol": "openai",
                    "content": text,
                    "reasoning": reasoning,
                    "tool_calls": tool_calls,
                    "raw_assistant_message": raw_assist,
                    "tools_unsupported": False,
                    "usage": {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt},
                    "error": "" if (text or tool_calls) else "模型没有返回文字或工具调用",
                }
        except httpx.TimeoutException:
            return {"ok": False, "status": 504, "protocol": proto, "content": "", "tool_calls": [], "tools_unsupported": False, "error": "上游模型响应超时，请稍后再试", "usage": zero}
        except Exception as exc:
            return {"ok": False, "status": 502, "protocol": proto, "content": "", "tool_calls": [], "tools_unsupported": False, "error": f"上游连接异常：{exc}", "usage": zero}

    async def stream_complete(
        self,
        messages: list[dict[str, Any]],
        temperature: float = 0.25,
    ) -> AsyncIterator[dict[str, Any]]:
        """真实 SSE 逐字流式生成（支持 OpenAI/Gemini/OpenRouter/Grok 与 Anthropic；不支持流式时自动回退）。"""
        zero = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        if not self.configured:
            yield {"type": "error", "error": "尚未提供 API Key"}
            return
        endpoint, proto = resolve_chat_endpoint(self.base_url, self.model)
        if _is_private_target(endpoint):
            yield {"type": "error", "error": "云端中转仅支持公网接口地址；局域网地址请用手机直连"}
            return
        if proto == "openai-responses":
            res = await self.complete_detailed(messages, temperature=temperature)
            if not res.get("ok"):
                yield {"type": "error", "error": res.get("error") or "模型调用失败"}
                return
            txt = str(res.get("content") or "")
            if txt:
                yield {"type": "delta", "text": txt}
            yield {"type": "done", "content": txt, "usage": res.get("usage") or zero}
            return

        full_parts: list[str] = []
        usage = dict(zero)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
                if proto == "anthropic":
                    sys_parts: list[str] = []
                    user_msgs: list[dict[str, Any]] = []
                    for m in messages:
                        role = m.get("role", "user")
                        raw_c = m.get("content")
                        if role == "system":
                            sys_parts.append(str(raw_c or ""))
                            continue
                        user_msgs.append({"role": "assistant" if role == "assistant" else "user", "content": raw_c if isinstance(raw_c, list) else str(raw_c or "")})
                    body: dict[str, Any] = {
                        "model": self.model,
                        "max_tokens": 2048,
                        "temperature": temperature,
                        "messages": user_msgs or [{"role": "user", "content": "你好"}],
                        "stream": True,
                    }
                    if sys_parts:
                        body["system"] = "\n\n".join(sys_parts)
                    headers = {
                        "x-api-key": self.api_key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream",
                    }
                else:
                    body = {"model": self.model, "messages": messages, "stream": True}
                    if not _NO_TEMP_MODEL_RE.search(self.model):
                        body["temperature"] = temperature
                    headers = {
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream",
                    }
                async with client.stream("POST", endpoint, headers=headers, json=body) as res:
                    if not res.is_success:
                        raw_err = (await res.aread()).decode("utf-8", errors="ignore")
                        try:
                            err_d = json.loads(raw_err)
                        except Exception:
                            err_d = {}
                        yield {"type": "error", "error": extract_api_error_text(err_d, raw_err[:200]) or f"HTTP {res.status_code}"}
                        return
                    ctype = (res.headers.get("content-type") or "").lower()
                    if "event-stream" not in ctype and "json" in ctype:
                        raw_body = (await res.aread()).decode("utf-8", errors="ignore")
                        data = json.loads(raw_body) if raw_body else {}
                        if proto == "anthropic":
                            txt = "\n".join(str(b.get("text") or "") for b in (data.get("content") or []) if isinstance(b, dict) and b.get("type") == "text").strip()
                        else:
                            txt = str(((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
                        if txt:
                            yield {"type": "delta", "text": txt}
                        yield {"type": "done", "content": txt, "usage": usage}
                        return
                    async for line in res.aiter_lines():
                        s = line.strip()
                        if not s or not s.startswith("data:"):
                            continue
                        payload_str = s[5:].strip()
                        if not payload_str or payload_str == "[DONE]":
                            continue
                        try:
                            ev = json.loads(payload_str)
                        except Exception:
                            continue
                        if proto == "anthropic":
                            ev_type = ev.get("type")
                            if ev_type == "content_block_delta":
                                delta_txt = str((ev.get("delta") or {}).get("text") or "")
                                if delta_txt:
                                    full_parts.append(delta_txt)
                                    yield {"type": "delta", "text": delta_txt}
                            elif ev_type == "message_start":
                                mu = (ev.get("message") or {}).get("usage") or {}
                                usage["prompt_tokens"] = int(mu.get("input_tokens") or usage["prompt_tokens"])
                            elif ev_type == "message_delta":
                                mu = ev.get("usage") or {}
                                usage["completion_tokens"] = int(mu.get("output_tokens") or usage["completion_tokens"])
                                usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
                        else:
                            choice = (ev.get("choices") or [{}])[0]
                            delta = choice.get("delta") or {}
                            delta_txt = str(delta.get("content") or "")
                            if delta_txt:
                                full_parts.append(delta_txt)
                                yield {"type": "delta", "text": delta_txt}
                            raw_u = ev.get("usage") or {}
                            if raw_u:
                                pt = int(raw_u.get("prompt_tokens") or 0)
                                ct = int(raw_u.get("completion_tokens") or 0)
                                usage = {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": int(raw_u.get("total_tokens") or (pt + ct))}
            full_text = "".join(full_parts).strip()
            if not usage["total_tokens"] and full_text:
                est_in = max(1, sum(len(str(m.get("content") or "")) for m in messages) // 2)
                est_out = max(1, len(full_text) // 2)
                usage = {"prompt_tokens": est_in, "completion_tokens": est_out, "total_tokens": est_in + est_out}
            yield {"type": "done", "content": full_text, "usage": usage}
        except httpx.TimeoutException:
            yield {"type": "error", "error": "上游模型流式响应超时，请稍后再试"}
        except Exception as exc:
            yield {"type": "error", "error": f"上游流式连接异常：{exc}"}

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
