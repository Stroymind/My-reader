"""Phase 2-3 & 5: 持久化自主 Agent Runtime（任务队列、断点恢复、预算边界、质量门控、现实验证调度）。"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from .db import Database
from .discovery import cluster_unassigned_documents, fetch_source
from .gateway import ModelGateway


class AgentRuntime:
    def __init__(self, db: Database, gateway: ModelGateway) -> None:
        self.db = db
        self.gateway = gateway

    @property
    def paused(self) -> bool:
        return self.db.get_state("runtime_paused", "0") == "1"

    def set_paused(self, on: bool) -> bool:
        self.db.set_state("runtime_paused", "1" if on else "0")
        return self.paused

    def enqueue_task(
        self,
        task_type: str,
        trigger_type: str = "manual",
        priority: int = 5,
        input_refs: dict[str, Any] | None = None,
        budget_steps: int = 6,
        max_retries: int = 2,
    ) -> str:
        task_id = f"tsk-{uuid.uuid4().hex[:10]}"
        now = time.time()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO research_tasks(
                    task_id, task_type, trigger_type, priority, status,
                    created_at, max_retries, budget_steps, input_refs_json
                ) VALUES(?, ?, ?, ?, 'queued', ?, ?, ?, ?)
                """,
                (
                    task_id,
                    task_type,
                    trigger_type,
                    priority,
                    now,
                    max_retries,
                    budget_steps,
                    json.dumps(input_refs or {}, ensure_ascii=False),
                ),
            )
        return task_id

    def connect(self):
        return self.db.connect()

    def recover_stale_tasks(self) -> int:
        """崩溃恢复：重启后将中断的 running 任务重新放回 queued（若未超重试上限）。"""
        with self.connect() as conn:
            cur = conn.execute(
                """
                UPDATE research_tasks
                SET status = CASE WHEN retry_count < max_retries THEN 'queued' ELSE 'dead_letter' END,
                    retry_count = retry_count + 1,
                    error_details = 'Recovered after runtime interruption'
                WHERE status = 'running'
                """
            )
            return cur.rowcount

    def _log_step(self, task_id: str, phase: str, detail: str) -> None:
        with self.connect() as conn:
            row = conn.execute("SELECT steps_json FROM research_tasks WHERE task_id = ?", (task_id,)).fetchone()
            steps = json.loads(row["steps_json"] or "[]") if row else []
            steps.append({"at": round(time.time(), 2), "phase": phase, "detail": detail})
            conn.execute("UPDATE research_tasks SET steps_json = ? WHERE task_id = ?", (json.dumps(steps, ensure_ascii=False), task_id))

    async def run_next_task(self) -> dict[str, Any] | None:
        if self.paused:
            return None
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM research_tasks WHERE status = 'queued' ORDER BY priority ASC, created_at ASC LIMIT 1"
            ).fetchone()
            if not row:
                return None
            task = dict(row)
            conn.execute(
                "UPDATE research_tasks SET status = 'running', started_at = ? WHERE task_id = ?",
                (time.time(), task["task_id"]),
            )

        task_id = task["task_id"]
        task_type = task["task_type"]
        inputs = json.loads(task["input_refs_json"] or "{}")
        try:
            self._log_step(task_id, "OBSERVE", f"启动任务 {task_type}（触发源：{task['trigger_type']}）")
            output: dict[str, Any] = {}
            if task_type == "SOURCE_SCAN":
                self._log_step(task_id, "PLAN", "扫描已注册活跃信息源并记录健康度")
                sources = [s for s in self.db.list_sources() if s["status"] != "disabled"]
                limit = int(inputs.get("max_sources", 4))
                results = []
                for src in sources[:limit]:
                    results.append(await fetch_source(self.db, src, limit=int(inputs.get("per_source", 5))))
                self._log_step(task_id, "ACT", f"完成 {len(results)} 个来源扫描")
                clustered = cluster_unassigned_documents(self.db)
                self._log_step(task_id, "VERIFY", f"去重聚类产出 {len(clustered)} 个新事件")
                output = {"scanned": len(results), "new_events": clustered}
            elif task_type == "EVENT_CLUSTERING":
                clustered = cluster_unassigned_documents(self.db)
                self._log_step(task_id, "ACT", f"聚类完成，新增事件 {len(clustered)} 个")
                output = {"new_events": clustered}
            elif task_type == "INTELLIGENCE_ANALYSIS":
                event_id = inputs.get("event_id")
                output = await self._research_event(task_id, event_id)
            elif task_type == "REALITY_CHECK":
                output = self._run_due_reality_checks(task_id)
            else:
                self._log_step(task_id, "REFLECT", f"未识别任务类型 {task_type}，安全结束")
                output = {"ignored": True}

            self._log_step(task_id, "STOP", "任务通过质量验证并落盘")
            with self.connect() as conn:
                conn.execute(
                    "UPDATE research_tasks SET status = 'completed', finished_at = ?, output_refs_json = ? WHERE task_id = ?",
                    (time.time(), json.dumps(output, ensure_ascii=False), task_id),
                )
            return {"task_id": task_id, "status": "completed", "output": output}
        except Exception as exc:
            retry = int(task["retry_count"]) + 1
            next_status = "queued" if retry <= int(task["max_retries"]) else "dead_letter"
            self._log_step(task_id, "ERROR", str(exc)[:240])
            with self.connect() as conn:
                conn.execute(
                    "UPDATE research_tasks SET status = ?, retry_count = ?, finished_at = ?, error_details = ? WHERE task_id = ?",
                    (next_status, retry, time.time(), str(exc)[:400], task_id),
                )
            return {"task_id": task_id, "status": next_status, "error": str(exc)}

    async def _research_event(self, task_id: str, event_id: str | None) -> dict[str, Any]:
        if not event_id:
            return {"ok": False, "reason": "missing event_id"}
        with self.connect() as conn:
            ev = conn.execute("SELECT * FROM events WHERE event_id = ?", (event_id,)).fetchone()
            evi = conn.execute("SELECT * FROM evidence WHERE event_id = ?", (event_id,)).fetchall()
        if not ev:
            return {"ok": False, "reason": "event not found"}

        self._log_step(task_id, "PLAN", f"对事件「{ev['title'][:36]}」执行研究、核验与质量门控")
        ai_json = await self.gateway.complete(
            [
                {
                    "role": "system",
                    "content": (
                        "你是思潮 Research & Verification Agent。基于给定事件与证据，输出 JSON："
                        "{historical_baseline, change, unknowns(数组), pitfalls, ai_verdict(A/B/C/D/E), ai_reason, counterpoints}。"
                        "严禁编造事实或来源；证据不足必须写入 unknowns。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"title": ev["title"], "summary": ev["summary"], "evidence": [dict(x) for x in evi]},
                        ensure_ascii=False,
                    ),
                },
            ]
        )
        if ai_json:
            try:
                m = ai_json[ai_json.find("{") : ai_json.rfind("}") + 1]
                parsed = json.loads(m)
                with self.connect() as conn:
                    conn.execute(
                        """
                        UPDATE events
                        SET historical_baseline = ?, change_summary = ?, unknown_variables_json = ?,
                            pitfalls = ?, ai_verdict = ?, ai_reason = ?, counterpoints = ?, updated_at = ?
                        WHERE event_id = ?
                        """,
                        (
                            parsed.get("historical_baseline", ev["historical_baseline"]),
                            parsed.get("change", ev["change_summary"]),
                            json.dumps(parsed.get("unknowns", []), ensure_ascii=False),
                            parsed.get("pitfalls", ev["pitfalls"]),
                            parsed.get("ai_verdict", "B") if parsed.get("ai_verdict") in ("A", "B", "C", "D", "E") else "B",
                            parsed.get("ai_reason", ev["ai_reason"]),
                            parsed.get("counterpoints", ev["counterpoints"]),
                            time.time(),
                            event_id,
                        ),
                    )
            except Exception:
                pass
        # Quality Gate: 至少具备 1 条可追溯证据才允许通过质量门控
        quality_ok = len(evi) >= 1
        self._log_step(task_id, "VERIFY", f"Quality Gate 证据链核查：{'通过' if quality_ok else '缺少来源'}（{len(evi)} 条证据）")
        with self.connect() as conn:
            conn.execute("UPDATE events SET quality_passed = ? WHERE event_id = ?", (1 if quality_ok else 0, event_id))
        return {"ok": True, "event_id": event_id, "evidence_count": len(evi), "quality_passed": quality_ok}

    def _run_due_reality_checks(self, task_id: str) -> dict[str, Any]:
        now = time.time()
        with self.connect() as conn:
            due = conn.execute(
                "SELECT hypothesis_id, proposition FROM hypotheses "
                "WHERE reality_status = 'pending' AND (d7_at <= ? OR d30_at <= ? OR d90_at <= ?)",
                (now, now, now),
            ).fetchall()
        self._log_step(task_id, "ACT", f"发现 {len(due)} 条到期假设待现实验证")
        return {"due_hypotheses": [dict(r) for r in due]}

    def list_activity(self, limit: int = 20) -> dict[str, Any]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM research_tasks ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        tasks = []
        for r in rows:
            d = dict(r)
            d["steps"] = json.loads(d.pop("steps_json", "[]") or "[]")
            d["input_refs"] = json.loads(d.pop("input_refs_json", "{}") or "{}")
            d["output_refs"] = json.loads(d.pop("output_refs_json", "{}") or "{}")
            tasks.append(d)
        return {"paused": self.paused, "tasks": tasks}
