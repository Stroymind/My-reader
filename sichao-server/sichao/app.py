"""思潮 SICHΑO V2.0 — 模块化单体 FastAPI 服务。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .agent import TOOL_REGISTRY, inspect_external_plugin, run_byok_agent_loop
from .connectors import verify_connector
from .db import Database
from .discovery import build_coverage_map, cluster_unassigned_documents, content_hash, seed_default_sources
from .gateway import ModelGateway
from .runtime import AgentRuntime

VERDICT_SET = {"A", "B", "C", "D", "E"}


class SignalSubmitReq(BaseModel):
    title: str = Field(..., min_length=2, max_length=240)
    url: str = ""
    summary: str = ""
    language: str = "zh"


class ReconReq(BaseModel):
    query: str = Field(..., min_length=2, max_length=240)


class InitialJudgmentReq(BaseModel):
    verdict: str
    confidence: int = Field(..., ge=50, le=100)
    rationale: str = ""
    key_variable: str = ""


class SecondJudgmentReq(BaseModel):
    verdict: str
    confidence: int = Field(..., ge=50, le=100)
    rationale: str = ""


class RealityCheckReq(BaseModel):
    reality_status: str = Field(..., pattern="^(hit|partial|miss|pending)$")
    reality_notes: str = ""


class MissedEventAuditReq(BaseModel):
    event_title: str = Field(..., min_length=2, max_length=240)
    first_public_at: float | None = None
    detected_at: float | None = None
    reason_code: str = "UNMONITORED_SOURCE"
    notes: str = ""
    recommendation: str = ""


class AgentRunReq(BaseModel):
    messages: list[dict[str, str]] = Field(default_factory=list)
    rules: str = ""
    memory: str = ""
    ext_plugins: list[dict[str, Any]] = Field(default_factory=list)
    connectors: list[dict[str, Any]] = Field(default_factory=list)
    max_steps: int = Field(default=4, ge=1, le=5)


class ConnectorVerifyReq(BaseModel):
    connector_id: str = Field(..., min_length=2, max_length=60)
    token: str = ""
    extra: dict[str, Any] = Field(default_factory=dict)


class McpInspectReq(BaseModel):
    url: str = Field(..., min_length=6, max_length=1000)
    token: str = ""


class ByokChatReq(BaseModel):
    messages: list[dict[str, Any]] = Field(default_factory=list)
    temperature: float = Field(default=0.3, ge=0.0, le=2.0)


class KbSyncReq(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)


def _space_hash(request: Request) -> str:
    raw = (request.headers.get("x-zone-space-key") or "").strip()
    if len(raw) < 6:
        raise HTTPException(status_code=400, detail="请提供至少 6 位的云端同步码（X-Zone-Space-Key）")
    return hashlib.sha256(f"zone-kb-v1:{raw}".encode("utf-8")).hexdigest()


def _seed_initial_event_if_empty(db: Database) -> None:
    with db.connect() as conn:
        cnt = conn.execute("SELECT COUNT(*) AS c FROM events").fetchone()["c"]
    if cnt > 0:
        return
    now = time.time()
    db.upsert_event(
        {
            "event_id": "ev-seed-edge-ai",
            "title": "开源小模型在消费级手机端实现离线 30 token/s 推理",
            "domain": "AI · 端侧推理",
            "summary": "多家开源团队发布 3B~7B 量化模型与端侧推理框架更新，在主流手机 NPU/GPU 上实现离线流畅推理。",
            "facts": [
                "4-bit 量化后模型体积降至 2~4 GB，可常驻主流旗舰机内存。",
                "基础摘要、翻译与结构化指令解析延迟已进入秒级。",
            ],
            "historical_baseline": "两年前端侧 7B 模型推理速度普遍低于 4 token/s 且发热严重。",
            "change": "高频轻量智能任务的边际推理成本趋近于零，并天然满足本地隐私边界。",
            "unknowns": [
                "中低端机型长时间连续推理的发热与续航衰减尚无统一独立评测。",
                "复杂多步推理与工具调用稳定性仍落后云端旗舰。",
            ],
            "pitfalls": "容易把基准吞吐速度等同于真实复杂场景的可用质量。",
            "ai_verdict": "D",
            "ai_reason": "端侧零边际成本推理将改变个人软件与操作系统层的默认交互形态。",
            "counterpoints": "若端侧模型幻觉率长期高于云端两代以上，用户高频需求仍可能停留在云端。",
            "expert_perspectives": [
                {"source": "系统架构研究者", "view": "隐私敏感型个人软件将率先转向端云协同。"},
                {"source": "移动端工程团队", "view": "内存带宽与散热仍是中端机型普及的最大瓶颈。"},
            ],
            "created_at": now,
        },
        evidence_list=[
            {
                "evidence_id": "evi-seed-1",
                "claim": "4-bit 量化 3B~7B 开源模型在旗舰移动芯片上实测达到 25~35 token/s。",
                "status": "CONFIRMED",
                "source_name": "开源推理框架公开基准",
                "source_url": "https://github.com/ggerganov/llama.cpp",
                "observed_at": now,
            },
            {
                "evidence_id": "evi-seed-2",
                "claim": "厂商宣称端侧模型可替代 80% 日常云端助手场景。",
                "status": "CLAIMED",
                "source_name": "厂商发布声明",
                "source_url": "",
                "observed_at": now,
            },
        ],
    )


def create_app(db_path: str | None = None, enable_scheduler: bool = True) -> FastAPI:
    db = Database(db_path or os.getenv("SICHAO_DB_PATH", "data/sichao.db"))
    # 纯 BYOK 模式：服务端绝不消耗平台自身 Token，所有 AI 推理均由用户自有 API Key 承担
    gateway = ModelGateway(api_key="")
    runtime = AgentRuntime(db, gateway)
    seed_default_sources(db)
    _seed_initial_event_if_empty(db)
    runtime.recover_stale_tasks()

    async def _scheduler_loop() -> None:
        while True:
            try:
                if not runtime.paused:
                    await runtime.run_next_task()
            except Exception:
                pass
            await asyncio.sleep(5.0)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        task = asyncio.create_task(_scheduler_loop()) if enable_scheduler else None
        try:
            yield
        finally:
            if task:
                task.cancel()

    app = FastAPI(title="思潮 SICHΑO V2.0", version="2.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.db = db
    app.state.runtime = runtime
    app.state.gateway = gateway

    def _serialize_event(ev_row: dict[str, Any], evidence_rows: list[dict[str, Any]], judgment_row: dict[str, Any] | None) -> dict[str, Any]:
        """严格执行初判前信息隔离：未提交初判前，服务端物理不返回 AI 判断、专家观点与反例。"""
        unlocked = judgment_row is not None
        payload: dict[str, Any] = {
            "event_id": ev_row["event_id"],
            "title": ev_row["title"],
            "domain": ev_row["domain"],
            "summary": ev_row["summary"],
            "facts": json.loads(ev_row["fact_layer_json"] or "[]"),
            "historical_baseline": ev_row["historical_baseline"],
            "change": ev_row["change_summary"],
            "unknowns": json.loads(ev_row["unknown_variables_json"] or "[]"),
            "pitfalls": ev_row["pitfalls"],
            "quality_passed": bool(ev_row["quality_passed"]),
            "evidence": evidence_rows,
            "unlocked": unlocked,
            "created_at": ev_row["created_at"],
            "updated_at": ev_row["updated_at"],
        }
        if unlocked and judgment_row is not None:
            payload["judgment"] = {
                "initial_verdict": judgment_row["initial_verdict"],
                "initial_confidence": judgment_row["initial_confidence"],
                "initial_rationale": judgment_row["initial_rationale"],
                "key_variable": judgment_row["key_variable"],
                "recon_query": judgment_row["recon_query"],
                "recon_result": judgment_row["recon_result"],
                "second_verdict": judgment_row["second_verdict"],
                "second_confidence": judgment_row["second_confidence"],
                "second_rationale": judgment_row["second_rationale"],
            }
            payload["ai_assessment"] = {
                "verdict": ev_row["ai_verdict"],
                "reason": ev_row["ai_reason"],
                "counterpoints": ev_row["counterpoints"],
                "expert_perspectives": json.loads(ev_row["expert_perspectives_json"] or "[]"),
                "delta": (
                    "你与 AI 初步判断一致，需警惕共同盲区。"
                    if judgment_row["initial_verdict"] == ev_row["ai_verdict"]
                    else f"分歧提示：你的初判为 {judgment_row['initial_verdict']}，AI 倾向 {ev_row['ai_verdict']}。"
                ),
            }
        return payload

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "version": "2.4.0",
            "byok_mode": True,
            "platform_token_used": False,
            "agent_tools": sorted(TOOL_REGISTRY.keys()),
            "mcp_remote_http": True,
            "byok_balance_check": True,
            "byok_chat_proxy": True,
            "cloud_kb": True,
            "app_connectors": True,
            "runtime_paused": runtime.paused,
        }

    @app.post("/api/connectors/verify")
    async def connectors_verify(req: ConnectorVerifyReq) -> dict[str, Any]:
        """真实校验第三方应用授权令牌/Webhook（纯无状态，绝不落盘保存用户凭据）。"""
        return await verify_connector(req.connector_id, token=req.token, extra=req.extra)

    @app.post("/api/byok/chat")
    async def byok_chat(req: ByokChatReq, request: Request) -> dict[str, Any]:
        """无状态 BYOK 聊天中转（仅用于解决移动端 CORS / 跨境网络可达性，0 平台额度、不落盘 Key）。"""
        user_gw = ModelGateway.from_user_headers(request.headers)
        return await user_gw.complete_detailed(req.messages, temperature=req.temperature)

    @app.post("/api/kb/sync")
    def kb_sync(req: KbSyncReq, request: Request) -> dict[str, Any]:
        """独立长久云端知识库双向同步（完全独立于阅读器/星海插件，按用户同步码隔离）。"""
        sh = _space_hash(request)
        merged = db.sync_kb_items(sh, req.items)
        active = [x for x in merged if not x.get("deleted")]
        return {"ok": True, "count": len(active), "items": merged, "synced_at": time.time()}

    @app.get("/api/kb/list")
    def kb_list(request: Request) -> dict[str, Any]:
        sh = _space_hash(request)
        active = db.list_kb_items(sh)
        return {"ok": True, "count": len(active), "items": active}

    @app.post("/api/agent/run")
    async def agent_run(req: AgentRunReq, request: Request) -> dict[str, Any]:
        """Zone 手机端 Bot 多步联网工具调用引擎（纯 BYOK：仅透传用户请求头 API Key）。"""
        user_gw = ModelGateway.from_user_headers(request.headers)
        return await run_byok_agent_loop(
            user_gw,
            req.messages,
            rules=req.rules,
            memory=req.memory,
            ext_plugins=req.ext_plugins,
            connectors=req.connectors,
            max_steps=req.max_steps,
        )

    @app.post("/api/mcp/inspect")
    async def mcp_inspect(req: McpInspectReq) -> dict[str, Any]:
        """真实探测外部远程 HTTP MCP 服务（JSON-RPC 2.0 tools/list）或 SKILL.md 技能文件。"""
        return await inspect_external_plugin(req.url, token=req.token)

    @app.post("/api/byok/balance")
    async def byok_balance(request: Request) -> dict[str, Any]:
        """纯 BYOK 实时查询用户自有 API 服务商余额（绝不存 Key、绝不耗平台额度）。"""
        user_gw = ModelGateway.from_user_headers(request.headers)
        return await user_gw.check_balance()

    @app.get("/api/events")
    def list_events(limit: int = 20) -> dict[str, Any]:
        with db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM events WHERE status = 'published' ORDER BY updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
            out = []
            for r in rows:
                ev = dict(r)
                evi = [dict(x) for x in conn.execute("SELECT * FROM evidence WHERE event_id = ?", (ev["event_id"],)).fetchall()]
                j = conn.execute("SELECT * FROM judgments WHERE event_id = ?", (ev["event_id"],)).fetchone()
                out.append(_serialize_event(ev, evi, dict(j) if j else None))
        return {"events": out}

    @app.get("/api/events/{event_id}")
    def get_event(event_id: str) -> dict[str, Any]:
        with db.connect() as conn:
            r = conn.execute("SELECT * FROM events WHERE event_id = ?", (event_id,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Event not found")
            evi = [dict(x) for x in conn.execute("SELECT * FROM evidence WHERE event_id = ?", (event_id,)).fetchall()]
            j = conn.execute("SELECT * FROM judgments WHERE event_id = ?", (event_id,)).fetchone()
        return _serialize_event(dict(r), evi, dict(j) if j else None)

    @app.post("/api/signals/submit")
    def submit_signal(req: SignalSubmitReq) -> dict[str, Any]:
        h = content_hash(req.title, req.url or f"user://{time.time()}")
        db.insert_document(
            {
                "doc_id": f"doc-{h}",
                "source_id": "src-user-signals",
                "title": req.title.strip(),
                "url": req.url.strip(),
                "fetched_at": time.time(),
                "language": req.language,
                "content_text": req.summary.strip(),
                "content_hash": h,
            }
        )
        new_events = cluster_unassigned_documents(db)
        task_id = None
        if new_events:
            task_id = runtime.enqueue_task("INTELLIGENCE_ANALYSIS", trigger_type="user", input_refs={"event_id": new_events[0]})
        return {"ok": True, "new_events": new_events, "task_id": task_id}

    @app.post("/api/events/{event_id}/recon")
    async def run_recon(event_id: str, req: ReconReq, request: Request) -> dict[str, Any]:
        with db.connect() as conn:
            r = conn.execute("SELECT * FROM events WHERE event_id = ?", (event_id,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Event not found")
            ev = dict(r)
        user_gw = ModelGateway.from_user_headers(request.headers)
        ans = await user_gw.complete(
            [
                {
                    "role": "system",
                    "content": "你是思潮 RECON 侦察员。只提供客观补充事实、反例或缺失变量，绝不提前透露最终信号等级（A/B/C/D/E）。控制在 150 字以内。",
                },
                {"role": "user", "content": f"事件：{ev['title']}\n摘要：{ev['summary']}\n侦察方向：{req.query}"},
            ]
        )
        reply = ans or f"关于「{req.query}」的零 Token 侦察提示：请核查是否存在独立第三方复现、真实部署成本与 30 天后的采用数据（在 Zone 中填入你自己的 AI API Key 即可用自有额度启用深度侦察）。"
        return {"event_id": event_id, "query": req.query, "result": reply, "byok_used": user_gw.configured}

    @app.post("/api/events/{event_id}/judge")
    def submit_initial_judgment(event_id: str, req: InitialJudgmentReq) -> dict[str, Any]:
        verdict = req.verdict.strip().upper()
        if verdict not in VERDICT_SET:
            raise HTTPException(status_code=400, detail="Verdict must be A, B, C, D, or E")
        now = time.time()
        with db.connect() as conn:
            r = conn.execute("SELECT * FROM events WHERE event_id = ?", (event_id,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Event not found")
            existing = conn.execute("SELECT * FROM judgments WHERE event_id = ?", (event_id,)).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail="Initial judgment is immutable; use /revise for second judgment")
            evi = [dict(x) for x in conn.execute("SELECT * FROM evidence WHERE event_id = ?", (event_id,)).fetchall()]
            jid = f"jdg-{uuid.uuid4().hex[:10]}"
            conn.execute(
                """
                INSERT INTO judgments(
                    judgment_id, event_id, initial_verdict, initial_confidence,
                    initial_rationale, key_variable, initial_submitted_at, evidence_snapshot_json
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (jid, event_id, verdict, req.confidence, req.rationale.strip(), req.key_variable.strip(), now, json.dumps(evi, ensure_ascii=False)),
            )
            # 自动建立 Hypothesis Ledger 假设账本与 D+7 / D+30 / D+90 复核节点
            hid = f"hyp-{uuid.uuid4().hex[:10]}"
            conn.execute(
                """
                INSERT INTO hypotheses(
                    hypothesis_id, event_id, proposition, supporting_json, opposing_json,
                    unknowns_json, falsification_criteria, created_at, d7_at, d30_at, d90_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    hid,
                    event_id,
                    f"事件「{r['title']}」被判断为 {verdict}（置信度 {req.confidence}%）",
                    json.dumps([req.rationale.strip()] if req.rationale.strip() else [], ensure_ascii=False),
                    json.dumps([r["counterpoints"]] if r["counterpoints"] else [], ensure_ascii=False),
                    r["unknown_variables_json"],
                    req.key_variable.strip() or "若 30 天内未出现独立验证或真实采用变化，则该判断需下调。",
                    now,
                    now + 7 * 86400,
                    now + 30 * 86400,
                    now + 90 * 86400,
                ),
            )
            j_row = dict(conn.execute("SELECT * FROM judgments WHERE judgment_id = ?", (jid,)).fetchone())
        return {
            "ok": True,
            "hypothesis_id": hid,
            "event": _serialize_event(dict(r), evi, j_row),
        }

    @app.post("/api/events/{event_id}/revise")
    def submit_second_judgment(event_id: str, req: SecondJudgmentReq) -> dict[str, Any]:
        verdict = req.verdict.strip().upper()
        if verdict not in VERDICT_SET:
            raise HTTPException(status_code=400, detail="Verdict must be A, B, C, D, or E")
        with db.connect() as conn:
            j = conn.execute("SELECT * FROM judgments WHERE event_id = ?", (event_id,)).fetchone()
            if not j:
                raise HTTPException(status_code=400, detail="Submit initial judgment before second judgment")
            conn.execute(
                """
                UPDATE judgments
                SET second_verdict = ?, second_confidence = ?, second_rationale = ?, second_submitted_at = ?
                WHERE event_id = ?
                """,
                (verdict, req.confidence, req.rationale.strip(), time.time(), event_id),
            )
            updated = dict(conn.execute("SELECT * FROM judgments WHERE event_id = ?", (event_id,)).fetchone())
        return {
            "ok": True,
            "initial_verdict": updated["initial_verdict"],
            "second_verdict": updated["second_verdict"],
            "changed": updated["initial_verdict"] != updated["second_verdict"],
        }

    @app.get("/api/hypotheses")
    def list_hypotheses() -> dict[str, Any]:
        with db.connect() as conn:
            rows = conn.execute("SELECT * FROM hypotheses ORDER BY created_at DESC").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["supporting"] = json.loads(d.pop("supporting_json", "[]") or "[]")
            d["opposing"] = json.loads(d.pop("opposing_json", "[]") or "[]")
            d["unknowns"] = json.loads(d.pop("unknowns_json", "[]") or "[]")
            out.append(d)
        return {"hypotheses": out}

    @app.post("/api/hypotheses/{hypothesis_id}/reality-check")
    def update_reality_check(hypothesis_id: str, req: RealityCheckReq) -> dict[str, Any]:
        with db.connect() as conn:
            r = conn.execute("SELECT * FROM hypotheses WHERE hypothesis_id = ?", (hypothesis_id,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Hypothesis not found")
            conn.execute(
                "UPDATE hypotheses SET reality_status = ?, reality_notes = ?, last_checked_at = ? WHERE hypothesis_id = ?",
                (req.reality_status, req.reality_notes.strip(), time.time(), hypothesis_id),
            )
        return {"ok": True, "hypothesis_id": hypothesis_id, "reality_status": req.reality_status}

    @app.get("/api/profile")
    def judgment_profile() -> dict[str, Any]:
        with db.connect() as conn:
            judgments = [dict(r) for r in conn.execute("SELECT * FROM judgments").fetchall()]
            hyps = [dict(r) for r in conn.execute("SELECT * FROM hypotheses").fetchall()]
        total = len(judgments)
        avg_conf = round(sum(j["initial_confidence"] for j in judgments) / total, 1) if total else 0.0
        revised = sum(1 for j in judgments if j["second_verdict"] and j["second_verdict"] != j["initial_verdict"])
        verified = [h for h in hyps if h["reality_status"] in ("hit", "partial", "miss")]
        hits = sum(1 for h in verified if h["reality_status"] == "hit")
        return {
            "total_judgments": total,
            "average_confidence": avg_conf,
            "revision_count": revised,
            "verified_hypotheses": len(verified),
            "reality_hit_rate": round(hits / len(verified), 3) if verified else None,
            "bias_summary": (
                "样本量尚不足（少于 10 条现实检验记录），暂不下认知偏差标签。"
                if len(verified) < 10
                else f"已完成 {len(verified)} 条现实检验，命中率 {round(hits / len(verified) * 100)}%。"
            ),
        }

    @app.get("/api/coverage")
    def coverage_map() -> dict[str, Any]:
        return build_coverage_map(db)

    @app.post("/api/audits/missed-event")
    def log_missed_event(req: MissedEventAuditReq) -> dict[str, Any]:
        aid = f"aud-{uuid.uuid4().hex[:10]}"
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO discovery_audits(
                    audit_id, event_title, first_public_at, detected_at,
                    reason_code, notes, recommendation, created_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (aid, req.event_title.strip(), req.first_public_at, req.detected_at, req.reason_code, req.notes.strip(), req.recommendation.strip(), time.time()),
            )
        return {"ok": True, "audit_id": aid}

    @app.get("/api/audits")
    def list_audits() -> dict[str, Any]:
        with db.connect() as conn:
            rows = [dict(r) for r in conn.execute("SELECT * FROM discovery_audits ORDER BY created_at DESC LIMIT 50").fetchall()]
        return {"audits": rows}

    @app.get("/api/agent/activity")
    def agent_activity(limit: int = 20) -> dict[str, Any]:
        return runtime.list_activity(limit=limit)

    @app.post("/api/agent/scan")
    async def trigger_scan(max_sources: int = 4) -> dict[str, Any]:
        tid = runtime.enqueue_task("SOURCE_SCAN", trigger_type="manual", input_refs={"max_sources": max_sources})
        res = await runtime.run_next_task()
        return {"task_id": tid, "result": res}

    @app.post("/api/agent/pause")
    def pause_runtime() -> dict[str, Any]:
        return {"paused": runtime.set_paused(True)}

    @app.post("/api/agent/resume")
    def resume_runtime() -> dict[str, Any]:
        return {"paused": runtime.set_paused(False)}

    return app


app = create_app()
