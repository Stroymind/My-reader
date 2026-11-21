# 思潮 SICHΑO V2.0 — 自主情报与认知训练后端

模块化单体后端（Python + FastAPI + SQLite WAL），严格遵循《思潮 V2.0》交接基线：
- **Phase 1**：`Source Registry`（官方 / arXiv / HN / 中文 / 日语 / 用户线索）、确定性去重与事件聚类、`Coverage Map`
- **Phase 2–3**：持久化 `Agent Runtime`（`OBSERVE → PLAN → ACT → VERIFY → REFLECT`、断点恢复、人工暂停/恢复、`Agent Activity` 可观测接口、Quality Gate 证据门控）
- **Phase 4–5**：严格服务端初判前信息隔离、RECON 侦察、不可篡改 `Initial → Second Judgment`、`Hypothesis Ledger` + `D+7/D+30/D+90 Reality Check`、`Discovery Audit` 与 `Judgment Profile`

## 启动方式
```bash
cd outputs/Zone/sichao-server
# 可选：配置任意 OpenAI 兼容模型（无密钥也可完整离线运行）
# set SICHAO_API_KEY=sk-...
# set SICHAO_BASE_URL=https://api.openai.com/v1
# set SICHAO_MODEL=gpt-4o-mini
python -m uvicorn sichao.app:app --host 0.0.0.0 --port 8787
```

## 运行自动化验收测试
```bash
python -m pytest -v
```
