"""思潮 SICHΑO V2.0 端到端功能与架构验收测试（离线确定性运行）。"""
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from sichao.app import create_app
from sichao.discovery import cluster_unassigned_documents, content_hash, title_similarity


def make_client(tmp_path: Path) -> TestClient:
    app = create_app(db_path=str(tmp_path / "test_sichao.db"), enable_scheduler=False)
    return TestClient(app)


def test_source_registry_and_coverage_map(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    r = client.get("/api/coverage")
    assert r.status_code == 200
    cov = r.json()
    assert cov["total_sources"] >= 9
    assert cov["active_sources"] >= 9
    assert "zh" in cov["by_language"] and "en" in cov["by_language"] and "ja" in cov["by_language"]


def test_deterministic_dedup_and_clustering(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    db = client.app.state.db
    # 两条重复报道相似事件，应合并为 1 个事件 + 2 条证据（绝不把媒体密度当事件密度）
    h1 = content_hash("OpenAI releases new open reasoning benchmark v2", "https://a.example/1")
    h2 = content_hash("OpenAI releases new open reasoning benchmark v2 report", "https://b.example/2")
    assert title_similarity(
        "OpenAI releases new open reasoning benchmark v2",
        "OpenAI releases new open reasoning benchmark v2 report",
    ) >= 0.42
    db.insert_document({"doc_id": f"d-{h1}", "source_id": "src-openai-blog", "title": "OpenAI releases new open reasoning benchmark v2", "url": "https://a.example/1", "content_hash": h1})
    db.insert_document({"doc_id": f"d-{h2}", "source_id": "src-hn-top", "title": "OpenAI releases new open reasoning benchmark v2 report", "url": "https://b.example/2", "content_hash": h2})
    created = cluster_unassigned_documents(db)
    assert len(created) == 1
    ev = client.get(f"/api/events/{created[0]}").json()
    assert len(ev["evidence"]) == 2


def test_strict_pre_judgment_isolation_and_immutable_initial_to_second(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    events = client.get("/api/events").json()["events"]
    assert len(events) >= 1
    ev = events[0]
    ev_id = ev["event_id"]

    # 1) 初判前：严禁泄露 ai_assessment 与 judgment
    assert ev["unlocked"] is False
    assert "ai_assessment" not in ev
    assert "judgment" not in ev
    assert len(ev["evidence"]) >= 1
    assert ev["evidence"][0]["status"] in ("CONFIRMED", "CLAIMED", "REPORTED")

    # 2) RECON 侦察机会
    recon = client.post(f"/api/events/{ev_id}/recon", json={"query": "中低端机发热情况"})
    assert recon.status_code == 200
    assert "result" in recon.json()

    # 3) 提交初判 -> 解锁 AI 伙伴视角 & 自动创建 Hypothesis Ledger
    j1 = client.post(
        f"/api/events/{ev_id}/judge",
        json={"verdict": "C", "confidence": 75, "rationale": "端侧成本塌缩但中端机散热待观察", "key_variable": "中端机连续推理功耗"},
    )
    assert j1.status_code == 200
    j1_data = j1.json()
    assert j1_data["event"]["unlocked"] is True
    assert "ai_assessment" in j1_data["event"]
    assert j1_data["event"]["ai_assessment"]["verdict"] in ("A", "B", "C", "D", "E")
    hyp_id = j1_data["hypothesis_id"]

    # 4) 初判不可覆盖（重复提交返回 409）
    dup = client.post(f"/api/events/{ev_id}/judge", json={"verdict": "D", "confidence": 90})
    assert dup.status_code == 409

    # 5) 二次修正判断：保留 initial_verdict=C，记录 second_verdict=D
    j2 = client.post(f"/api/events/{ev_id}/revise", json={"verdict": "D", "confidence": 80, "rationale": "结合架构视角上调"})
    assert j2.status_code == 200
    assert j2.json()["initial_verdict"] == "C"
    assert j2.json()["second_verdict"] == "D"
    assert j2.json()["changed"] is True

    # 6) Hypothesis Ledger 与 Reality Check 现实验证
    hyps = client.get("/api/hypotheses").json()["hypotheses"]
    assert any(h["hypothesis_id"] == hyp_id for h in hyps)
    rc = client.post(f"/api/hypotheses/{hyp_id}/reality-check", json={"reality_status": "hit", "reality_notes": "30天后多家手机厂商集成端侧模型"})
    assert rc.status_code == 200

    # 7) 判断档案（样本不足 10 条时不乱贴偏差标签）
    prof = client.get("/api/profile").json()
    assert prof["total_judgments"] == 1
    assert prof["revision_count"] == 1
    assert prof["reality_hit_rate"] == 1.0
    assert "样本量尚不足" in prof["bias_summary"]


def test_agent_runtime_recovery_pause_and_audit(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    rt = client.app.state.runtime
    db = client.app.state.db

    # 模拟任务崩溃中断后重启恢复
    tid = rt.enqueue_task("REALITY_CHECK", trigger_type="schedule")
    with db.connect() as conn:
        conn.execute("UPDATE research_tasks SET status = 'running' WHERE task_id = ?", (tid,))
    recovered = rt.recover_stale_tasks()
    assert recovered == 1

    # 人工暂停时不会消费队列；恢复后顺利执行并记录完整 steps
    assert client.post("/api/agent/pause").json()["paused"] is True
    assert asyncio.run(rt.run_next_task()) is None
    assert client.post("/api/agent/resume").json()["paused"] is False
    ran = asyncio.run(rt.run_next_task())
    assert ran is not None and ran["status"] == "completed"

    act = client.get("/api/agent/activity").json()
    assert act["paused"] is False
    assert any(t["task_id"] == tid and len(t["steps"]) >= 3 for t in act["tasks"])

    # Discovery Audit 漏报审计
    aud = client.post("/api/audits/missed-event", json={"event_title": "某实验室提前发布论文", "reason_code": "UNMONITORED_SOURCE", "recommendation": "新增该实验室 RSS"})
    assert aud.status_code == 200
    assert len(client.get("/api/audits").json()["audits"]) == 1


def test_byok_agent_endpoint_and_ssrf_guard(tmp_path: Path) -> None:
    from sichao.agent import tool_fetch_url

    client = make_client(tmp_path)
    h = client.get("/api/health").json()
    assert h["byok_mode"] is True
    assert "web_search" in h["agent_tools"] and "github_search" in h["agent_tools"]

    # 无用户自带 Key 时绝不消耗平台 Token
    r = client.post("/api/agent/run", json={"messages": [{"role": "user", "content": "搜一下最新论文"}]})
    assert r.status_code == 200
    assert r.json()["ok"] is False
    assert r.json()["error"] == "BYOK_KEY_REQUIRED"

    # SSRF 安全边界：禁止访问内网地址
    blocked = asyncio.run(tool_fetch_url("http://127.0.0.1:8080/secret"))
    assert "安全拦截" in blocked

    # 外部 MCP / Skill 探测接口同样具备 SSRF 强拦截
    r_mcp = client.post("/api/mcp/inspect", json={"url": "http://192.168.1.1/mcp"})
    assert r_mcp.status_code == 200
    assert r_mcp.json()["ok"] is False and "安全拦截" in r_mcp.json()["error"]

    # BYOK 实时余额接口：无 Key 时不扣平台额度并诚实返回
    r_bal = client.post("/api/byok/balance")
    assert r_bal.status_code == 200
    assert r_bal.json()["ok"] is False


def test_parallel_agent_loop_memory_and_usage(tmp_path: Path, monkeypatch) -> None:
    from sichao import agent as agent_mod
    from sichao.gateway import ModelGateway

    async def fake_web(q: str) -> str:
        return f"- {q} 官方发布\n  URL: https://example.org/{q}\n  摘要: 2026 最新详情"

    async def fake_gh(q: str) -> str:
        return f"- demo/{q} (★999, Python)\n  URL: https://github.com/demo/{q}\n  简介: 开源项目"

    monkeypatch.setitem(agent_mod.TOOL_REGISTRY, "web_search", fake_web)
    monkeypatch.setitem(agent_mod.TOOL_REGISTRY, "github_search", fake_gh)

    turns: list[list[dict[str, str]]] = []

    class FakeGateway(ModelGateway):
        def __init__(self) -> None:
            super().__init__(api_key="sk-test-byok", base_url="https://api.example.com/v1", model="test-model")

        async def complete_with_tools(self, messages, tools=None, temperature=0.2):
            return {"ok": False, "status": 400, "protocol": "openai", "content": "", "tool_calls": [], "tools_unsupported": True, "error": "tools unsupported", "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}

        async def complete_with_usage(self, messages, temperature=0.2):
            turns.append(messages)
            if len(turns) == 1:
                return (
                    '{"tools":[{"tool":"web_search","arg":"zone"},{"tool":"github_search","arg":"agent"}]}',
                    {"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150},
                )
            return (
                "已为你并行查完并汇总，详见 https://github.com/demo/agent 。",
                {"prompt_tokens": 260, "completion_tokens": 80, "total_tokens": 340},
            )

    res = asyncio.run(
        agent_mod.run_byok_agent_loop(
            FakeGateway(),
            [{"role": "user", "content": "帮我调研开源 agent 框架"}],
            rules="简洁回答",
            memory="用户偏好苹果极简风格，使用 Python 与 Android。",
            ext_plugins=[{"name": "写作规范", "protocol": "skill_md", "instructions": "结论先行，列出参考来源。"}],
            max_steps=4,
        )
    )
    assert res["ok"] is True
    assert len(res["steps"]) == 2
    assert len(res["sources"]) == 2
    assert res["usage"] == {"prompt_tokens": 380, "completion_tokens": 110, "total_tokens": 490}
    assert "用户偏好苹果极简风格" in turns[0][0]["content"]
    assert "写作规范" in turns[0][0]["content"]


def test_byok_chat_endpoint_normalization_and_cloud_kb(tmp_path: Path) -> None:
    from sichao.gateway import resolve_chat_endpoint

    assert resolve_chat_endpoint("https://api.openai.com") == ("https://api.openai.com/v1/chat/completions", "openai")
    assert resolve_chat_endpoint("https://api.deepseek.com/v1/chat/completions/") == ("https://api.deepseek.com/v1/chat/completions", "openai")
    assert resolve_chat_endpoint("https://api.siliconflow.cn") == ("https://api.siliconflow.cn/v1/chat/completions", "openai")
    assert resolve_chat_endpoint("https://dashscope.aliyuncs.com/compatible-mode") == ("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", "openai")
    assert resolve_chat_endpoint("https://api.anthropic.com") == ("https://api.anthropic.com/v1/messages", "anthropic")

    app = create_app(db_path=str(tmp_path / "kb.db"), enable_scheduler=False)
    client = TestClient(app)

    # /api/byok/chat: missing key & private IP SSRF guard
    r0 = client.post("/api/byok/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r0.status_code == 200 and r0.json()["ok"] is False
    r_ssrf = client.post(
        "/api/byok/chat",
        headers={"X-User-Api-Key": "sk-demo", "X-User-Base-Url": "http://127.0.0.1:11434/v1"},
        json={"messages": [{"role": "user", "content": "hi"}]},
    )
    assert r_ssrf.status_code == 200 and r_ssrf.json()["ok"] is False and "公网" in r_ssrf.json()["error"]

    # /api/kb/sync & /api/kb/list: durable cloud KB sync + multi-user space isolation + deletion tombstone
    h1 = {"X-Zone-Space-Key": "ZN-SPACE-ALPHA-01"}
    h2 = {"X-Zone-Space-Key": "ZN-SPACE-BETA-02"}
    s1 = client.post(
        "/api/kb/sync",
        headers=h1,
        json={
            "items": [
                {"id": "kb-1", "title": "项目架构", "text": "Zone 采用 BYOK 与独立云端知识库", "kind": "doc", "source": "设计.md", "scope": "global", "updatedAt": 100.0},
                {"id": "kb-2", "title": "偏好", "text": "偏好苹果极简设计", "kind": "memory", "source": "导入", "scope": "global", "updatedAt": 100.0},
            ]
        },
    )
    assert s1.status_code == 200 and s1.json()["ok"] is True and s1.json()["count"] == 2

    # Space 2 cannot see Space 1
    l2 = client.get("/api/kb/list", headers=h2)
    assert l2.status_code == 200 and l2.json()["count"] == 0

    # Device 2 in Space 1 pushes an update + deletes kb-2
    s2 = client.post(
        "/api/kb/sync",
        headers=h1,
        json={
            "items": [
                {"id": "kb-2", "deleted": True, "updatedAt": 200.0},
                {"id": "kb-3", "title": "云端新条", "text": "跨设备同步测试通过", "kind": "doc", "source": "云端", "scope": "global", "updatedAt": 210.0},
            ]
        },
    )
    assert s2.status_code == 200 and s2.json()["count"] == 2
    l1 = client.get("/api/kb/list", headers=h1).json()
    ids = {x["id"] for x in l1["items"]}
    assert ids == {"kb-1", "kb-3"}


def test_connectors_verify_and_array_429_error_extraction(tmp_path: Path) -> None:
    from sichao.gateway import extract_api_error_text, resolve_chat_endpoint

    # International-first endpoint normalization: Gemini, Codex (/v1/responses), Claude
    assert resolve_chat_endpoint("https://generativelanguage.googleapis.com", "gemini-2.5-flash") == (
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "openai",
    )
    assert resolve_chat_endpoint("https://api.openai.com/v1", "gpt-5.1-codex-mini") == (
        "https://api.openai.com/v1/responses",
        "openai-responses",
    )
    assert resolve_chat_endpoint("https://api.anthropic.com", "claude-sonnet-4-5") == (
        "https://api.anthropic.com/v1/messages",
        "anthropic",
    )

    # Gemini OpenAI-compat array error shape + OpenRouter nested metadata shape
    gem_err = [{"error": {"code": 429, "message": "You exceeded your current quota, please check your plan."}}]
    assert "exceeded your current quota" in extract_api_error_text(gem_err)
    or_err = {"error": {"message": "Provider returned error", "metadata": {"raw": "Rate limit exceeded"}}}
    assert "Rate limit exceeded" in extract_api_error_text(or_err)

    app = create_app(db_path=str(tmp_path / "conn.db"), enable_scheduler=False)
    client = TestClient(app)
    assert client.get("/api/health").json()["app_connectors"] is True

    # Invalid webhook host refused (no fake connect!)
    r_bad = client.post("/api/connectors/verify", json={"connector_id": "feishu", "token": "https://evil.example.com/hook"})
    assert r_bad.status_code == 200 and r_bad.json()["ok"] is False

    # Valid official Feishu webhook accepted & returns callable tool metadata
    r_ok = client.post("/api/connectors/verify", json={"connector_id": "feishu", "token": "https://open.feishu.cn/open-apis/bot/v2/hook/demo-token"})
    assert r_ok.status_code == 200 and r_ok.json()["ok"] is True
    assert any(t["name"] == "feishu_send_message" for t in r_ok.json()["tools"])

    # /api/share/create & /s/{id} WeChat/QQ article-style Card Stack share page
    r_sh = client.post(
        "/api/share/create",
        json={
            "title": "历史与复杂系统卡片堆",
            "subtitle": "3 本精选书目",
            "kind": "stack",
            "items": [
                {"title": "大分流 <script>alert(1)</script>", "author": "彭慕兰", "type": "epub", "progress": 0.45, "content": "现代世界经济的形成。\n\n为什么欧洲与中国走上不同道路？"},
                {"title": "规模", "author": "杰弗里·韦斯特", "type": "epub", "progress": 0.1, "notes": [{"quote": "城市像生物一样遵循超线性缩放律", "body": "核心洞察"}]},
            ],
        },
    )
    assert r_sh.status_code == 200 and r_sh.json()["ok"] is True
    sid = r_sh.json()["share_id"]
    page_res = client.get(f"/s/{sid}")
    assert page_res.status_code == 200
    assert "历史与复杂系统卡片堆" in page_res.text
    assert "<script>alert(1)</script>" not in page_res.text  # XSS escaped
    assert "城市像生物一样遵循超线性缩放律" in page_res.text


def test_account_auth_cross_device_sync_and_web_client(tmp_path: Path) -> None:
    app = create_app(db_path=str(tmp_path / "sync.db"), enable_scheduler=False)
    client = TestClient(app)

    health = client.get("/api/health").json()
    assert health["version"] == "2.6.0"
    assert health["account_sync"] is True
    assert health["web_client"] is True

    # PC registers account and pushes a newly downloaded/created Bot + message
    reg = client.post(
        "/api/auth/register",
        json={"account": "alice@zone.dev", "password": "secret-password", "display_name": "Alice", "device_name": "PC Chrome"},
    )
    assert reg.status_code == 200 and reg.json()["ok"] is True
    pc_token = reg.json()["token"]
    pc_h = {"Authorization": f"Bearer {pc_token}"}

    # Duplicate register rejected
    dup = client.post("/api/auth/register", json={"account": "alice@zone.dev", "password": "secret-password"})
    assert dup.status_code == 409

    # PC syncs a newly created Bot ("小土豆") + chat message
    ex1 = client.post(
        "/api/sync/exchange",
        headers=pc_h,
        json={
            "bots": [{"id": "bot-pc-1", "name": "电脑小土豆", "shape": "potato", "accent": "#FF9500", "updatedAt": 1000}],
            "threads": [{
                "id": "th-bot-pc-1",
                "botId": "bot-pc-1",
                "title": "电脑小土豆",
                "updatedAt": 1005,
                "messages": [{"role": "user", "content": "我在电脑端发的第一条消息", "at": 1001}],
            }],
        },
    )
    assert ex1.status_code == 200 and ex1.json()["revision"] == 1

    # Phone logs into the SAME account (wrong password rejected first)
    bad = client.post("/api/auth/login", json={"account": "alice@zone.dev", "password": "wrong"})
    assert bad.status_code == 401
    ph_login = client.post("/api/auth/login", json={"account": "alice@zone.dev", "password": "secret-password", "device_name": "Android Zone"})
    assert ph_login.status_code == 200 and ph_login.json()["devices_count"] == 2
    ph_h = {"Authorization": f"Bearer {ph_login.json()['token']}"}

    # Phone exchanges its local state -> receives PC Bot + PC message AND adds Phone reply
    ex2 = client.post(
        "/api/sync/exchange",
        headers=ph_h,
        json={
            "bots": [{"id": "bot-phone-2", "name": "手机紫薯", "shape": "triangle", "accent": "#7E67F8", "updatedAt": 1100}],
            "threads": [{
                "id": "th-phone-1",
                "botId": "bot-pc-1",
                "title": "电脑小土豆",
                "updatedAt": 1105,
                "messages": [{"role": "user", "content": "手机端同步接力回复", "at": 1102}],
            }],
        },
    )
    assert ex2.status_code == 200 and ex2.json()["revision"] == 2
    merged = ex2.json()["state"]
    assert {b["id"] for b in merged["bots"]} == {"bot-pc-1", "bot-phone-2"}
    pc_thread = next(t for t in merged["threads"] if t["botId"] == "bot-pc-1")
    assert [m["content"] for m in pc_thread["messages"]] == ["我在电脑端发的第一条消息", "手机端同步接力回复"]

    # PC polls delta with since_revision=1 -> sees revision=2; polling since_revision=2 -> changed=False
    st_new = client.get("/api/sync/state?since_revision=1", headers=pc_h).json()
    assert st_new["changed"] is True and st_new["revision"] == 2
    st_same = client.get("/api/sync/state?since_revision=2", headers=pc_h).json()
    assert st_same["changed"] is False

    # PC Web client allowlist serving + traversal protection
    w_idx = client.get("/web/")
    assert w_idx.status_code == 200 and "Zbot" in w_idx.text
    assert client.get("/web/agent-runtime.js").status_code == 200
    assert client.get("/web/icons/bots/sprite.webp").status_code == 200
    assert client.get("/web/sichao-server/sichao/app.py").status_code == 404
    assert client.get("/web/render.yaml").status_code == 404


def test_native_function_calling_and_sse_stream(tmp_path: Path, monkeypatch) -> None:
    import json
    from sichao import agent as agent_mod
    from sichao.gateway import ModelGateway

    # 1) Schema builder maps built-ins, connectors, and MCP tools with valid OpenAI identifiers
    schemas, api_map = agent_mod.build_native_tool_schemas(
        {"notion_search": ({"id": "notion", "token": "ntn_x"}, "搜索 Notion")},
        {"mcp:docs:query": ("https://mcp.example.com", "query", "", "查询文档", {"type": "object", "properties": {"q": {"type": "string"}}})},
    )
    fn_names = [s["function"]["name"] for s in schemas]
    assert "web_search" in fn_names and "get_current_time" in fn_names
    assert "notion_search" in fn_names
    assert any(api_map[n] == "mcp:docs:query" and ":" not in n for n in fn_names)

    # 2) Mock native tool_calls round-trip + SSE streaming endpoint /api/agent/stream
    async def fake_web(q: str) -> str:
        return f"- {q} 最新进展\n  URL: https://news.example.com/ai\n  摘要: 原生工具调用实测通过"

    monkeypatch.setitem(agent_mod.TOOL_REGISTRY, "web_search", fake_web)

    calls_seen: list[int] = []

    async def fake_complete_with_tools(self, messages, tools=None, temperature=0.2):
        calls_seen.append(len(tools or []))
        if len(calls_seen) == 1:
            return {
                "ok": True,
                "status": 200,
                "protocol": "openai",
                "content": "",
                "reasoning": "",
                "tool_calls": [
                    {"id": "tc_1", "name": "web_search", "arguments": {"query": "OpenBot"}},
                    {"id": "tc_2", "name": "get_current_time", "arguments": {}},
                ],
                "raw_assistant_message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"id": "tc_1", "type": "function", "function": {"name": "web_search", "arguments": '{"query":"OpenBot"}'}},
                        {"id": "tc_2", "type": "function", "function": {"name": "get_current_time", "arguments": "{}"}},
                    ],
                },
                "tools_unsupported": False,
                "usage": {"prompt_tokens": 100, "completion_tokens": 25, "total_tokens": 125},
                "error": "",
            }
        # Confirm native OpenAI tool result messages were appended
        assert any(m.get("role") == "tool" and m.get("tool_call_id") == "tc_1" for m in messages)
        return {
            "ok": True,
            "status": 200,
            "protocol": "openai",
            "content": "原生工具调用与流式输出均已就绪，参考 https://news.example.com/ai 。",
            "reasoning": "",
            "tool_calls": [],
            "raw_assistant_message": {"role": "assistant", "content": "done"},
            "tools_unsupported": False,
            "usage": {"prompt_tokens": 180, "completion_tokens": 45, "total_tokens": 225},
            "error": "",
        }

    monkeypatch.setattr(ModelGateway, "complete_with_tools", fake_complete_with_tools)

    app = create_app(db_path=str(tmp_path / "sse.db"), enable_scheduler=False)
    client = TestClient(app)
    res = client.post(
        "/api/agent/stream",
        headers={"X-User-Api-Key": "sk-test-stream", "X-User-Base-Url": "https://api.openai.com/v1", "X-User-Model": "gpt-4.1-mini"},
        json={"messages": [{"role": "user", "content": "帮我查一下 OpenBot 最新消息并核对时间"}]},
    )
    assert res.status_code == 200
    assert "text/event-stream" in res.headers.get("content-type", "")
    events = []
    for line in res.text.splitlines():
        if line.startswith("data:"):
            raw = line[5:].strip()
            if raw and raw != "[DONE]":
                events.append(json.loads(raw))
    ev_types = [e.get("type") for e in events]
    assert "step_start" in ev_types
    assert "step" in ev_types
    assert "delta" in ev_types
    assert "done" in ev_types
    done_ev = next(e for e in events if e.get("type") == "done")
    assert done_ev["ok"] is True
    assert done_ev["mode"] == "native_tools"
    assert len(done_ev["steps"]) == 2
    assert done_ev["usage"]["total_tokens"] == 350
    assert calls_seen[0] >= 6
