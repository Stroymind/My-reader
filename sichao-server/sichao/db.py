"""思潮 V2.0 持久化数据库层（SQLite WAL，表结构兼容 PostgreSQL）。"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

EVIDENCE_STATUSES = (
    "CONFIRMED",
    "CLAIMED",
    "REPORTED",
    "INFERRED",
    "HYPOTHESIS",
    "DISPUTED",
    "UNKNOWN",
    "NOT FOUND",
)


class Database:
    def __init__(self, db_path: str | Path = "data/sichao.db") -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    def _init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS sources (
                    source_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    region TEXT NOT NULL,
                    language TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    category TEXT NOT NULL,
                    access_method TEXT NOT NULL,
                    url TEXT NOT NULL,
                    auth_required INTEGER NOT NULL DEFAULT 0,
                    collection_permission TEXT NOT NULL DEFAULT 'public',
                    frequency_minutes INTEGER NOT NULL DEFAULT 60,
                    last_fetch_at REAL,
                    last_update_at REAL,
                    reliability_score REAL NOT NULL DEFAULT 0.75,
                    discovery_yield INTEGER NOT NULL DEFAULT 0,
                    consecutive_failures INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active',
                    last_error TEXT DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS documents (
                    doc_id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    published_at REAL,
                    fetched_at REAL NOT NULL,
                    language TEXT NOT NULL DEFAULT 'en',
                    content_text TEXT NOT NULL DEFAULT '',
                    content_hash TEXT NOT NULL UNIQUE,
                    event_id TEXT,
                    FOREIGN KEY(source_id) REFERENCES sources(source_id)
                );

                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    fact_layer_json TEXT NOT NULL DEFAULT '[]',
                    historical_baseline TEXT NOT NULL DEFAULT '',
                    change_summary TEXT NOT NULL DEFAULT '',
                    unknown_variables_json TEXT NOT NULL DEFAULT '[]',
                    pitfalls TEXT NOT NULL DEFAULT '',
                    ai_verdict TEXT NOT NULL DEFAULT 'B',
                    ai_reason TEXT NOT NULL DEFAULT '',
                    counterpoints TEXT NOT NULL DEFAULT '',
                    expert_perspectives_json TEXT NOT NULL DEFAULT '[]',
                    analysis_16d_json TEXT NOT NULL DEFAULT '{}',
                    quality_passed INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL DEFAULT 'published',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS evidence (
                    evidence_id TEXT PRIMARY KEY,
                    event_id TEXT NOT NULL,
                    claim TEXT NOT NULL,
                    status TEXT NOT NULL,
                    source_name TEXT NOT NULL,
                    source_url TEXT NOT NULL DEFAULT '',
                    observed_at REAL NOT NULL,
                    FOREIGN KEY(event_id) REFERENCES events(event_id)
                );

                CREATE TABLE IF NOT EXISTS research_tasks (
                    task_id TEXT PRIMARY KEY,
                    task_type TEXT NOT NULL,
                    trigger_type TEXT NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 5,
                    status TEXT NOT NULL DEFAULT 'queued',
                    created_at REAL NOT NULL,
                    started_at REAL,
                    finished_at REAL,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    max_retries INTEGER NOT NULL DEFAULT 2,
                    budget_steps INTEGER NOT NULL DEFAULT 6,
                    steps_json TEXT NOT NULL DEFAULT '[]',
                    input_refs_json TEXT NOT NULL DEFAULT '{}',
                    output_refs_json TEXT NOT NULL DEFAULT '{}',
                    error_details TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS judgments (
                    judgment_id TEXT PRIMARY KEY,
                    event_id TEXT NOT NULL UNIQUE,
                    initial_verdict TEXT NOT NULL,
                    initial_confidence INTEGER NOT NULL,
                    initial_rationale TEXT NOT NULL DEFAULT '',
                    key_variable TEXT NOT NULL DEFAULT '',
                    recon_query TEXT NOT NULL DEFAULT '',
                    recon_result TEXT NOT NULL DEFAULT '',
                    initial_submitted_at REAL NOT NULL,
                    second_verdict TEXT,
                    second_confidence INTEGER,
                    second_rationale TEXT,
                    second_submitted_at REAL,
                    evidence_snapshot_json TEXT NOT NULL DEFAULT '[]',
                    FOREIGN KEY(event_id) REFERENCES events(event_id)
                );

                CREATE TABLE IF NOT EXISTS hypotheses (
                    hypothesis_id TEXT PRIMARY KEY,
                    event_id TEXT NOT NULL,
                    proposition TEXT NOT NULL,
                    supporting_json TEXT NOT NULL DEFAULT '[]',
                    opposing_json TEXT NOT NULL DEFAULT '[]',
                    unknowns_json TEXT NOT NULL DEFAULT '[]',
                    falsification_criteria TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL,
                    d7_at REAL NOT NULL,
                    d30_at REAL NOT NULL,
                    d90_at REAL NOT NULL,
                    reality_status TEXT NOT NULL DEFAULT 'pending',
                    reality_notes TEXT NOT NULL DEFAULT '',
                    last_checked_at REAL,
                    FOREIGN KEY(event_id) REFERENCES events(event_id)
                );

                CREATE TABLE IF NOT EXISTS discovery_audits (
                    audit_id TEXT PRIMARY KEY,
                    event_title TEXT NOT NULL,
                    first_public_at REAL,
                    detected_at REAL,
                    reason_code TEXT NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    recommendation TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runtime_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS kb_items (
                    space_hash TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    content TEXT NOT NULL DEFAULT '',
                    kind TEXT NOT NULL DEFAULT 'memory',
                    source TEXT NOT NULL DEFAULT '手动录入',
                    scope TEXT NOT NULL DEFAULT 'global',
                    updated_at REAL NOT NULL,
                    deleted INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (space_hash, item_id)
                );

                CREATE INDEX IF NOT EXISTS idx_kb_space_upd ON kb_items(space_hash, deleted, updated_at DESC);
                """
            )

    def get_state(self, key: str, default: str = "") -> str:
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM runtime_state WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else default

    def set_state(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO runtime_state(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def list_sources(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM sources ORDER BY domain, name").fetchall()
            return [dict(r) for r in rows]

    def upsert_source(self, src: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO sources(
                    source_id, name, platform, region, language, domain, category,
                    access_method, url, auth_required, collection_permission,
                    frequency_minutes, reliability_score, status
                ) VALUES(
                    :source_id, :name, :platform, :region, :language, :domain, :category,
                    :access_method, :url, :auth_required, :collection_permission,
                    :frequency_minutes, :reliability_score, :status
                )
                ON CONFLICT(source_id) DO UPDATE SET
                    name = excluded.name,
                    url = excluded.url,
                    status = excluded.status
                """,
                {
                    "auth_required": 0,
                    "collection_permission": "public",
                    "frequency_minutes": 60,
                    "reliability_score": 0.75,
                    "status": "active",
                    **src,
                },
            )

    def record_source_health(self, source_id: str, ok: bool, new_docs: int = 0, error: str = "") -> None:
        now = time.time()
        with self.connect() as conn:
            if ok:
                conn.execute(
                    """
                    UPDATE sources
                    SET last_fetch_at = ?,
                        last_update_at = CASE WHEN ? > 0 THEN ? ELSE last_update_at END,
                        discovery_yield = discovery_yield + ?,
                        consecutive_failures = 0,
                        status = 'active',
                        last_error = ''
                    WHERE source_id = ?
                    """,
                    (now, new_docs, now, new_docs, source_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE sources
                    SET last_fetch_at = ?,
                        consecutive_failures = consecutive_failures + 1,
                        status = CASE WHEN consecutive_failures + 1 >= 3 THEN 'degraded' ELSE status END,
                        last_error = ?
                    WHERE source_id = ?
                    """,
                    (now, error[:300], source_id),
                )

    def insert_document(self, doc: dict[str, Any]) -> bool:
        with self.connect() as conn:
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO documents(
                    doc_id, source_id, title, url, published_at, fetched_at,
                    language, content_text, content_hash, event_id
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doc["doc_id"],
                    doc["source_id"],
                    doc["title"],
                    doc["url"],
                    doc.get("published_at"),
                    doc.get("fetched_at", time.time()),
                    doc.get("language", "en"),
                    doc.get("content_text", ""),
                    doc["content_hash"],
                    doc.get("event_id"),
                ),
            )
            return cur.rowcount > 0

    def upsert_event(self, ev: dict[str, Any], evidence_list: list[dict[str, Any]] | None = None) -> None:
        now = time.time()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO events(
                    event_id, title, domain, summary, fact_layer_json, historical_baseline,
                    change_summary, unknown_variables_json, pitfalls, ai_verdict, ai_reason,
                    counterpoints, expert_perspectives_json, analysis_16d_json,
                    quality_passed, status, created_at, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(event_id) DO UPDATE SET
                    summary = excluded.summary,
                    fact_layer_json = excluded.fact_layer_json,
                    unknown_variables_json = excluded.unknown_variables_json,
                    updated_at = excluded.updated_at
                """,
                (
                    ev["event_id"],
                    ev["title"],
                    ev.get("domain", "全球前沿"),
                    ev.get("summary", ""),
                    json.dumps(ev.get("facts", []), ensure_ascii=False),
                    ev.get("historical_baseline", ""),
                    ev.get("change", ""),
                    json.dumps(ev.get("unknowns", []), ensure_ascii=False),
                    ev.get("pitfalls", ""),
                    ev.get("ai_verdict", "B"),
                    ev.get("ai_reason", ""),
                    ev.get("counterpoints", ""),
                    json.dumps(ev.get("expert_perspectives", []), ensure_ascii=False),
                    json.dumps(ev.get("analysis_16d", {}), ensure_ascii=False),
                    1 if ev.get("quality_passed", True) else 0,
                    ev.get("status", "published"),
                    ev.get("created_at", now),
                    now,
                ),
            )
            if evidence_list:
                for item in evidence_list:
                    status = item.get("status", "REPORTED")
                    if status not in EVIDENCE_STATUSES:
                        status = "REPORTED"
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO evidence(
                            evidence_id, event_id, claim, status, source_name, source_url, observed_at
                        ) VALUES(?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            item["evidence_id"],
                            ev["event_id"],
                            item["claim"],
                            status,
                            item.get("source_name", "公开来源"),
                            item.get("source_url", ""),
                            item.get("observed_at", now),
                        ),
                    )

    def sync_kb_items(self, space_hash: str, incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """长久云端知识库双向合并同步（按 updated_at 保留最新状态，支持删除墓碑）。"""
        now = time.time()
        with self.connect() as conn:
            for raw in incoming[:400]:
                item_id = str(raw.get("id") or "").strip()[:80]
                if not item_id:
                    continue
                updated_at = float(raw.get("updatedAt") or raw.get("updated_at") or now)
                deleted = 1 if raw.get("deleted") else 0
                title = str(raw.get("title") or "").strip()[:160]
                content = str(raw.get("text") or raw.get("content") or "").strip()[:16000]
                kind = str(raw.get("kind") or "memory").strip()[:24]
                source = str(raw.get("source") or "手动录入").strip()[:60]
                scope = str(raw.get("scope") or "global").strip()[:60]
                if not deleted and not content:
                    continue
                conn.execute(
                    """
                    INSERT INTO kb_items(space_hash, item_id, title, content, kind, source, scope, updated_at, deleted)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(space_hash, item_id) DO UPDATE SET
                        title = CASE WHEN excluded.updated_at >= kb_items.updated_at THEN excluded.title ELSE kb_items.title END,
                        content = CASE WHEN excluded.updated_at >= kb_items.updated_at THEN excluded.content ELSE kb_items.content END,
                        kind = CASE WHEN excluded.updated_at >= kb_items.updated_at THEN excluded.kind ELSE kb_items.kind END,
                        source = CASE WHEN excluded.updated_at >= kb_items.updated_at THEN excluded.source ELSE kb_items.source END,
                        scope = CASE WHEN excluded.updated_at >= kb_items.updated_at THEN excluded.scope ELSE kb_items.scope END,
                        deleted = CASE WHEN excluded.updated_at >= kb_items.updated_at THEN excluded.deleted ELSE kb_items.deleted END,
                        updated_at = MAX(kb_items.updated_at, excluded.updated_at)
                    """,
                    (space_hash, item_id, title, content, kind, source, scope, updated_at, deleted),
                )
            rows = conn.execute(
                """
                SELECT item_id, title, content, kind, source, scope, updated_at, deleted
                FROM kb_items
                WHERE space_hash = ?
                ORDER BY updated_at DESC
                LIMIT 500
                """,
                (space_hash,),
            ).fetchall()
        return [
            {
                "id": r["item_id"],
                "title": r["title"],
                "text": r["content"],
                "kind": r["kind"],
                "source": r["source"],
                "scope": r["scope"],
                "updatedAt": r["updated_at"],
                "deleted": bool(r["deleted"]),
            }
            for r in rows
        ]

    def list_kb_items(self, space_hash: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT item_id, title, content, kind, source, scope, updated_at, deleted
                FROM kb_items
                WHERE space_hash = ? AND deleted = 0
                ORDER BY updated_at DESC
                LIMIT 500
                """,
                (space_hash,),
            ).fetchall()
        return [
            {
                "id": r["item_id"],
                "title": r["title"],
                "text": r["content"],
                "kind": r["kind"],
                "source": r["source"],
                "scope": r["scope"],
                "updatedAt": r["updated_at"],
                "deleted": False,
            }
            for r in rows
        ]
