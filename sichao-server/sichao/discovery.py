"""Phase 1: 全球信息发现网络 — Source Registry、多语公开采集、去重、事件聚类与 Coverage Map。"""
from __future__ import annotations

import hashlib
import re
import time
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from .db import Database

DEFAULT_SOURCES: list[dict[str, Any]] = [
    {
        "source_id": "src-arxiv-ai",
        "name": "arXiv CS.AI",
        "platform": "arXiv",
        "region": "Global",
        "language": "en",
        "domain": "AI Research",
        "category": "academic",
        "access_method": "rss",
        "url": "https://rss.arxiv.org/rss/cs.AI",
        "frequency_minutes": 180,
        "reliability_score": 0.92,
    },
    {
        "source_id": "src-arxiv-lg",
        "name": "arXiv CS.LG",
        "platform": "arXiv",
        "region": "Global",
        "language": "en",
        "domain": "Machine Learning",
        "category": "academic",
        "access_method": "rss",
        "url": "https://rss.arxiv.org/rss/cs.LG",
        "frequency_minutes": 180,
        "reliability_score": 0.91,
    },
    {
        "source_id": "src-hn-top",
        "name": "Hacker News Top",
        "platform": "Hacker News",
        "region": "US/Global",
        "language": "en",
        "domain": "Tech & Startups",
        "category": "social",
        "access_method": "hn_api",
        "url": "https://hacker-news.firebaseio.com/v0/topstories.json",
        "frequency_minutes": 30,
        "reliability_score": 0.72,
    },
    {
        "source_id": "src-openai-blog",
        "name": "OpenAI News",
        "platform": "Official Blog",
        "region": "US",
        "language": "en",
        "domain": "AI Labs",
        "category": "official",
        "access_method": "rss",
        "url": "https://openai.com/news/rss.xml",
        "frequency_minutes": 60,
        "reliability_score": 0.88,
    },
    {
        "source_id": "src-deepmind-blog",
        "name": "Google DeepMind Blog",
        "platform": "Official Blog",
        "region": "UK/US",
        "language": "en",
        "domain": "AI Labs",
        "category": "official",
        "access_method": "rss",
        "url": "https://deepmind.google/blog/rss.xml",
        "frequency_minutes": 120,
        "reliability_score": 0.90,
    },
    {
        "source_id": "src-hf-blog",
        "name": "Hugging Face Blog",
        "platform": "Hugging Face",
        "region": "EU/US",
        "language": "en",
        "domain": "Open Source AI",
        "category": "academic",
        "access_method": "rss",
        "url": "https://huggingface.co/blog/feed.xml",
        "frequency_minutes": 120,
        "reliability_score": 0.86,
    },
    {
        "source_id": "src-zh-sspai",
        "name": "少数派",
        "platform": "中文科技社区",
        "region": "CN",
        "language": "zh",
        "domain": "Digital & AI Tools",
        "category": "chinese_web",
        "access_method": "rss",
        "url": "https://sspai.com/feed",
        "frequency_minutes": 120,
        "reliability_score": 0.76,
    },
    {
        "source_id": "src-zh-qbitai",
        "name": "量子位 QbitAI",
        "platform": "中文产业媒体",
        "region": "CN",
        "language": "zh",
        "domain": "AI Industry CN",
        "category": "chinese_web",
        "access_method": "rss",
        "url": "https://www.qbitai.com/feed",
        "frequency_minutes": 90,
        "reliability_score": 0.72,
    },
    {
        "source_id": "src-jp-zenn",
        "name": "Zenn Tech (JA)",
        "platform": "Zenn",
        "region": "JP",
        "language": "ja",
        "domain": "Engineering JP",
        "category": "multilingual",
        "access_method": "rss",
        "url": "https://zenn.dev/feed",
        "frequency_minutes": 180,
        "reliability_score": 0.75,
    },
    {
        "source_id": "src-user-signals",
        "name": "用户主动提交线索",
        "platform": "User Signal",
        "region": "Global",
        "language": "multi",
        "domain": "User Curated",
        "category": "user_signal",
        "access_method": "user_submit",
        "url": "local://user-signals",
        "frequency_minutes": 0,
        "reliability_score": 0.80,
    },
]


def seed_default_sources(db: Database) -> int:
    for src in DEFAULT_SOURCES:
        db.upsert_source(src)
    return len(DEFAULT_SOURCES)


def normalize_tokens(text: str) -> set[str]:
    clean = re.sub(r"[^\w\u4e00-\u9fff]+", " ", (text or "").lower()).strip()
    tokens: set[str] = set()
    for part in clean.split():
        if re.search(r"[\u4e00-\u9fff]", part):
            # 中文按 2-gram 切分，避免分词依赖
            if len(part) <= 2:
                tokens.add(part)
            else:
                for i in range(len(part) - 1):
                    tokens.add(part[i : i + 2])
        elif len(part) >= 2:
            tokens.add(part)
    return tokens


def title_similarity(a: str, b: str) -> float:
    ta, tb = normalize_tokens(a), normalize_tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0


def content_hash(title: str, url: str) -> str:
    raw = f"{(title or '').strip().lower()}|{(url or '').strip().lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def parse_rss_xml(xml_text: str, limit: int = 10) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    root = ET.fromstring(xml_text.strip())
    # 支持 RSS 2.0 (<item>) 与 Atom (<entry>)
    items = root.findall(".//item")
    if items:
        for it in items[:limit]:
            title = (it.findtext("title") or "").strip()
            link = (it.findtext("link") or "").strip()
            desc = re.sub(r"<[^>]+>", " ", (it.findtext("description") or "")).strip()
            if title:
                out.append({"title": title, "url": link, "summary": re.sub(r"\s+", " ", desc)[:400]})
        return out
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    entries = root.findall(".//atom:entry", ns) or root.findall(".//entry")
    for en in entries[:limit]:
        title = (en.findtext("atom:title", default="", namespaces=ns) or en.findtext("title") or "").strip()
        link_el = en.find("atom:link", ns) or en.find("link")
        link = (link_el.attrib.get("href", "") if link_el is not None else "").strip()
        summary = (en.findtext("atom:summary", default="", namespaces=ns) or en.findtext("summary") or "").strip()
        summary = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", summary))[:400]
        if title:
            out.append({"title": title, "url": link, "summary": summary})
    return out


async def fetch_source(db: Database, src: dict[str, Any], limit: int = 8) -> dict[str, Any]:
    method = src.get("access_method")
    if method == "user_submit":
        return {"source_id": src["source_id"], "ok": True, "added": 0}
    added = 0
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            if method == "hn_api":
                r = await client.get(src["url"])
                r.raise_for_status()
                ids = r.json()[:limit]
                for item_id in ids:
                    ir = await client.get(f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json")
                    if ir.status_code != 200:
                        continue
                    it = ir.json() or {}
                    title = (it.get("title") or "").strip()
                    url = (it.get("url") or f"https://news.ycombinator.com/item?id={item_id}").strip()
                    if not title:
                        continue
                    h = content_hash(title, url)
                    ok = db.insert_document(
                        {
                            "doc_id": f"doc-{h}",
                            "source_id": src["source_id"],
                            "title": title,
                            "url": url,
                            "fetched_at": time.time(),
                            "language": src.get("language", "en"),
                            "content_text": f"HN Score: {it.get('score', 0)}, Comments: {it.get('descendants', 0)}",
                            "content_hash": h,
                        }
                    )
                    if ok:
                        added += 1
            elif method == "rss":
                r = await client.get(src["url"], headers={"User-Agent": "SichaoV2/1.0"})
                r.raise_for_status()
                entries = parse_rss_xml(r.text, limit=limit)
                for en in entries:
                    h = content_hash(en["title"], en["url"])
                    ok = db.insert_document(
                        {
                            "doc_id": f"doc-{h}",
                            "source_id": src["source_id"],
                            "title": en["title"],
                            "url": en["url"],
                            "fetched_at": time.time(),
                            "language": src.get("language", "en"),
                            "content_text": en.get("summary", ""),
                            "content_hash": h,
                        }
                    )
                    if ok:
                        added += 1
        db.record_source_health(src["source_id"], ok=True, new_docs=added)
        return {"source_id": src["source_id"], "ok": True, "added": added}
    except Exception as exc:
        db.record_source_health(src["source_id"], ok=False, error=str(exc))
        return {"source_id": src["source_id"], "ok": False, "added": 0, "error": str(exc)}


def cluster_unassigned_documents(db: Database, threshold: float = 0.42) -> list[str]:
    """确定性事件去重与聚类：将相似标题的多条重复报道合并为同一个现实事件，避免把媒体密度当事件密度。"""
    created_or_updated: list[str] = []
    with db.connect() as conn:
        docs = conn.execute(
            "SELECT d.*, s.name AS source_name, s.domain AS source_domain, s.category AS source_cat "
            "FROM documents d JOIN sources s ON d.source_id = s.source_id "
            "WHERE d.event_id IS NULL ORDER BY d.fetched_at DESC LIMIT 60"
        ).fetchall()
        existing_events = conn.execute(
            "SELECT event_id, title FROM events ORDER BY updated_at DESC LIMIT 120"
        ).fetchall()

    known = [(r["event_id"], r["title"]) for r in existing_events]
    for d in docs:
        matched_event_id = None
        for ev_id, ev_title in known:
            if title_similarity(d["title"], ev_title) >= threshold:
                matched_event_id = ev_id
                break
        now = time.time()
        if matched_event_id is None:
            matched_event_id = f"ev-{d['content_hash'][:12]}"
            known.append((matched_event_id, d["title"]))
            ev_status = "CLAIMED" if d["source_cat"] == "official" else "REPORTED"
            db.upsert_event(
                {
                    "event_id": matched_event_id,
                    "title": d["title"],
                    "domain": d["source_domain"] or "全球前沿",
                    "summary": d["content_text"] or f"来自 {d['source_name']} 的原始线索。",
                    "facts": [f"来源 {d['source_name']} 发布了相关报道/资料。"],
                    "historical_baseline": "尚待研究 Agent 补充历史基线对比。",
                    "change": "检测到新公开动态，需区分声明、演示与独立验证。",
                    "unknowns": ["是否存在独立第三方复现与真实采用数据。", "长期成本与二阶影响尚不可观测。"],
                    "pitfalls": "单一信源或高热度讨论不等于结构性变化。",
                    "ai_verdict": "B",
                    "ai_reason": "当前仅完成初步聚类与来源留痕，尚缺独立第三方验证，暂评估为弱信号。",
                    "counterpoints": "若后续 7~30 天出现多方独立验证或真实部署数据，信号等级应上调。",
                    "created_at": now,
                },
                evidence_list=[
                    {
                        "evidence_id": f"evi-{d['content_hash'][:12]}",
                        "claim": d["title"],
                        "status": ev_status,
                        "source_name": d["source_name"],
                        "source_url": d["url"],
                        "observed_at": now,
                    }
                ],
            )
            created_or_updated.append(matched_event_id)
        else:
            # 同一事件的附加报道：仅追加证据记录，绝不重复建事件！
            db.upsert_event(
                {"event_id": matched_event_id, "title": d["title"]},
                evidence_list=[
                    {
                        "evidence_id": f"evi-{d['content_hash'][:12]}",
                        "claim": f"附加报道：{d['title']}",
                        "status": "REPORTED",
                        "source_name": d["source_name"],
                        "source_url": d["url"],
                        "observed_at": now,
                    }
                ],
            )
        with db.connect() as conn:
            conn.execute("UPDATE documents SET event_id = ? WHERE doc_id = ?", (matched_event_id, d["doc_id"]))
    return created_or_updated


def build_coverage_map(db: Database) -> dict[str, Any]:
    """基于真实可观测数据的信息覆盖地图（绝不编造覆盖率）。"""
    sources = db.list_sources()
    by_region: dict[str, int] = {}
    by_lang: dict[str, int] = {}
    by_domain: dict[str, int] = {}
    degraded: list[dict[str, Any]] = []
    for s in sources:
        by_region[s["region"]] = by_region.get(s["region"], 0) + 1
        by_lang[s["language"]] = by_lang.get(s["language"], 0) + 1
        by_domain[s["domain"]] = by_domain.get(s["domain"], 0) + 1
        if s["status"] != "active":
            degraded.append({"source_id": s["source_id"], "name": s["name"], "last_error": s["last_error"]})
    return {
        "total_sources": len(sources),
        "active_sources": sum(1 for s in sources if s["status"] == "active"),
        "degraded_sources": degraded,
        "by_region": by_region,
        "by_language": by_lang,
        "by_domain": by_domain,
        "note": "覆盖统计严格基于已注册且可观测的来源记录，不包含未监控区域的猜测。",
    }
