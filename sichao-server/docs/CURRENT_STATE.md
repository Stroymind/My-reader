# 思潮 SICHΑO V2.0 — 现状审计 (CURRENT_STATE.md)

## 1. 运行环境审计（实测）
- **Python**: `3.11.9`
- **已就绪核心库**: `fastapi`, `uvicorn`, `httpx`, `pydantic`, `sqlite3`, `pytest`
- **无额外外部依赖需求**: RSS/Atom 解析采用 Python 标准库 `xml.etree.ElementTree`，HTML 清洗采用标准库 `html.parser`。

## 2. 现有系统盘点
- **Zone 移动端/Web 前端**（`outputs/Zone/sichao.js`）：已实现基础的移动端判断卡片、A~E 选项、置信度滑杆、本地判断档案与自动同步星海「判断星」。
- **后端自主引擎**：此前为空白（无持久化 Source Registry、无 Agent Runtime 任务队列、无独立核验与 D+7/D+30/D+90 现实验证调度）。

## 3. 本次重建范围（V2.0 模块化单体）
在 `outputs/Zone/sichao-server/` 从零搭建符合 V2.0 规范的自主情报与认知训练后端（FastAPI + SQLite WAL，SQL 架构兼容迁移至 PostgreSQL），并与 Zone 前端 API 实时打通。
