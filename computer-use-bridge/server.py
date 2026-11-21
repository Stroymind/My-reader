"""Zone Computer-Use 本地电脑桥接节点（纯 BYOK：仅使用手机透传的用户自有 API Key）。
在你的 Windows / macOS 电脑上双击 start-bridge.bat 启动后，在手机 Zone 里说：
「连接电脑 http://你的局域网IP:8765」即可从手机语音真实操控这台电脑。
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import socket
import subprocess
import sys
import time
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DANGER_RE = re.compile(r"(付款|支付|转账|删除|格式化|清空|关机|重启|发送|rm\s+-rf|del\s+|format|shutdown)", re.I)

app = FastAPI(title="Zone Computer-Use Local Bridge", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunReq(BaseModel):
    goal: str
    bot: str = "Zone"
    rules: str = ""
    confirm_danger: bool = False


def _local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _capture_screen_b64() -> tuple[str, int, int]:
    try:
        import pyautogui  # type: ignore

        img = pyautogui.screenshot()
        w, h = img.size
        img.thumbnail((1280, 1280))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=72)
        return base64.b64encode(buf.getvalue()).decode("ascii"), w, h
    except Exception:
        return "", 1920, 1080


def _exec_action(act: dict[str, Any], screen_w: int, screen_h: int) -> str:
    kind = str(act.get("action") or "").lower()
    if kind == "open_url":
        url = str(act.get("url") or "").strip()
        if url.startswith(("http://", "https://")):
            if sys.platform == "win32":
                os.startfile(url)  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", url])
            return f"已在浏览器打开 {url}"
        return "无效网址"

    if kind == "open_app":
        app_name = str(act.get("app") or "").strip()
        if not app_name:
            return "未指定应用名"
        if sys.platform == "win32":
            mapping = {
                "记事本": "notepad.exe", "notepad": "notepad.exe",
                "计算器": "calc.exe", "calc": "calc.exe",
                "浏览器": "msedge.exe", "edge": "msedge.exe", "chrome": "chrome.exe",
                "资源管理器": "explorer.exe", "微信": "WeChat.exe",
            }
            exe = mapping.get(app_name.lower(), app_name)
            subprocess.Popen(["cmd", "/c", "start", "", exe], shell=False)
            return f"已启动 {app_name}"
        subprocess.Popen(["open", "-a", app_name])
        return f"已启动 {app_name}"

    try:
        import pyautogui  # type: ignore
    except ImportError:
        return "未安装 pyautogui，请运行 pip install -r requirements.txt 后重试"

    if kind == "click":
        x = int(float(act.get("x", 500)) / 1000.0 * screen_w)
        y = int(float(act.get("y", 500)) / 1000.0 * screen_h)
        pyautogui.click(x, y)
        return f"已点击 ({x}, {y})"
    if kind == "type":
        txt = str(act.get("text") or "")
        pyautogui.write(txt, interval=0.02)
        return f"已输入 {len(txt)} 字符"
    if kind == "hotkey":
        keys = act.get("keys") or []
        if isinstance(keys, list) and keys:
            pyautogui.hotkey(*[str(k) for k in keys])
            return f"已按快捷键 {'+'.join(str(k) for k in keys)}"
    if kind == "scroll":
        pyautogui.scroll(int(act.get("delta", -400)))
        return "已滚动屏幕"
    return f"已记录动作 {kind}"


@app.get("/api/health")
def health() -> dict[str, Any]:
    import shutil

    workers = [w for w in ("codex", "claude", "dsh", "openclaw") if shutil.which(w)]
    return {"status": "ok", "bridge": "zone-computer-use", "ip": _local_ip(), "byok_only": True, "heavy_workers": workers}


class WorkerReq(BaseModel):
    task: str
    worker: str = "auto"  # auto | codex | claude | dsh | openclaw
    cwd: str = ""


@app.post("/api/worker/run")
async def run_heavy_worker(req: WorkerReq) -> dict[str, Any]:
    """复杂任务自动转交本机已安装的强力 Agent CLI（Codex / Claude Code / DeepSeek Harness / OpenClaw），不绑死 Cursor。"""
    import shutil

    task = req.task.strip()
    if not task:
        raise HTTPException(status_code=400, detail="task 不能为空")
    if DANGER_RE.search(task):
        return {"ok": False, "need_confirm": True, "summary": f"安全拦截：检测到敏感任务「{task}」，请在电脑端亲自确认。"}

    candidates = [req.worker] if req.worker != "auto" else ["codex", "claude", "dsh", "openclaw"]
    chosen = next((w for w in candidates if shutil.which(w)), None)
    if not chosen:
        return {"ok": False, "summary": "本机未检测到 codex / claude / dsh / openclaw 命令行，安装任意一个即可自动接管复杂任务。"}

    cmd_map = {
        "codex": ["codex", "exec", task],
        "claude": ["claude", "-p", task],
        "dsh": ["dsh", "run", task],
        "openclaw": ["openclaw", "run", task],
    }
    cwd = req.cwd.strip() if req.cwd and os.path.isdir(req.cwd.strip()) else os.getcwd()
    try:
        proc = subprocess.run(cmd_map[chosen], cwd=cwd, capture_output=True, text=True, timeout=180)
        out = (proc.stdout or proc.stderr or "").strip()
        return {"ok": proc.returncode == 0, "worker": chosen, "summary": out[-3000:] or f"{chosen} 执行完成（exit={proc.returncode}）"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "worker": chosen, "summary": f"{chosen} 正在后台深度处理，已超出单次同步等待时长。"}
    except Exception as e:
        return {"ok": False, "worker": chosen, "summary": f"调用 {chosen} 失败：{e}"}


@app.post("/api/computer-use/run")
async def run_computer_use(req: RunReq, request: Request) -> dict[str, Any]:
    goal = req.goal.strip()
    if not goal:
        raise HTTPException(status_code=400, detail="goal 不能为空")
    if DANGER_RE.search(goal) and not req.confirm_danger:
        return {
            "ok": False,
            "need_confirm": True,
            "summary": f"安全拦截：检测到敏感电脑操作「{goal}」，为保护本机数据已暂停执行。",
        }

    # 1. 零 Token 直达常见桌面动作（无需大模型也可秒执行）
    url_m = re.search(r"(https?://\S+)", goal)
    if url_m and ("打开" in goal or "访问" in goal):
        res = _exec_action({"action": "open_url", "url": url_m.group(1)}, 1920, 1080)
        return {"ok": True, "summary": res, "steps": [res]}
    app_m = re.match(r"^(?:打开|启动)\s*([^\s，。,.]{1,20})$", goal)
    if app_m:
        res = _exec_action({"action": "open_app", "app": app_m.group(1)}, 1920, 1080)
        return {"ok": True, "summary": res, "steps": [res]}

    # 2. 纯 BYOK 视觉/规划执行（透传用户手机里的 API Key，绝不消耗平台 Token）
    api_key = (request.headers.get("x-user-api-key") or "").strip()
    base_url = (request.headers.get("x-user-base-url") or "https://api.openai.com/v1").strip().rstrip("/")
    model = (request.headers.get("x-user-model") or "gpt-4o-mini").strip()
    if not api_key:
        return {
            "ok": False,
            "summary": "电脑桥接已连通！简单指令如「电脑控屏 打开记事本 / 打开 https://...」可免 Key 直达；复杂画面操控请先在手机 Zone 里填入你自己的 AI API Key。",
        }

    img_b64, sw, sh = _capture_screen_b64()
    user_content: Any = f"用户目标：{goal}"
    if img_b64:
        user_content = [
            {"type": "text", "text": f"用户目标：{goal}\n屏幕尺寸：{sw}x{sh}"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
        ]

    sys_prompt = (
        "你是 Zone 本地电脑 Computer-Use 执行器。根据目标和当前桌面截图，返回严格 JSON（不要多余说明）："
        '{"action":"open_app|open_url|click|type|hotkey|scroll|done","app":"","url":"","x":500,"y":500,"text":"","keys":["ctrl","c"],"delta":-400,"summary":"简短说明"}。'
        "坐标 x,y 使用 0..1000 归一化坐标。禁止自动付款、删除文件或对外发送消息。"
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "temperature": 0.1,
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_content},
                ],
            },
        )
        r.raise_for_status()
        raw = r.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    m = re.search(r"\{[\s\S]*\}", str(raw))
    if not m:
        return {"ok": True, "summary": str(raw)[:300]}
    act = json.loads(m.group(0))
    if act.get("action") == "done":
        return {"ok": True, "summary": act.get("summary") or "已完成"}
    log = _exec_action(act, sw, sh)
    return {"ok": True, "summary": f"{log}（{act.get('summary') or goal}）", "action": act}


if __name__ == "__main__":
    import uvicorn

    ip = _local_ip()
    print(f"\n=== Zone Computer-Use 本地电脑桥接已启动 ===")
    print(f"在手机 Zone 里输入或说出：连接电脑 http://{ip}:8765\n")
    uvicorn.run(app, host="0.0.0.0", port=8765)
