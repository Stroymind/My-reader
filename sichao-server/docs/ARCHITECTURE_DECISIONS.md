# 思潮 SICHΑO V2.0 — 架构决策记录 (ARCHITECTURE_DECISIONS.md)

1. **模块化单体优先（Modular Monolith）**：单进程 FastAPI + 持久化 SQLite WAL（`sichao/db.py`），避免初期过度微服务化；所有表结构采用标准 SQL，后续可平滑迁移至 PostgreSQL。
2. **确定性优先，模型按需调用**：采集、标准化、SHA-256 去重、事件聚类、初判前字段裁剪、质量门控均由确定性 Python 程序完成；大模型仅通过统一 `Model Gateway`（`sichao/gateway.py`）用于深度证据拆解、侦察与竞争解释生成。
3. **严格的初判前信息隔离**：`GET /api/events/{id}` 在服务端物理剥离 `ai_verdict`、`ai_reason`、`counterpoints` 与 `expert_perspectives`，仅在数据库中存在该事件的 `initial_judgment` 后才解锁返回。
4. **不可篡改的判断与假设账本**：`initial_judgment` 写入后永久只读；二次修正写入独立的 `second_judgment` 字段；每次判断自动生成带 `D+7 / D+30 / D+90` 复核时间戳的 `Hypothesis Ledger` 记录。
5. **可观察、可恢复、有边界的自主运行**：所有任务持久化到 `research_tasks`，记录 `steps_json`、重试次数、预算上限与错误详情；支持启动断点恢复（`recover_stale_tasks`）与人工暂停/恢复。
