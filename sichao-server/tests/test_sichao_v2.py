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
