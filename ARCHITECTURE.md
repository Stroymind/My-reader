# Zbot Long-Term Architecture & Maintenance Guide

> **Version**: Zbot 5.1 (`applicationId: io.github.stroymind.myreader`, `versionCode: 6`, `versionName: 5.1.0`)  
> **Live Cloud Relay & PC Web Portal**: `https://sichao-v2-server.onrender.com` (`/web/`)

## 1. Core Design Principles (Anti-Hardcoding & Global-First)

1. **Pure Solid Ceramic Aesthetic**: Light mode uses pure `#FFFFFF` with crisp `#E7E7EC` hairlines; dark mode uses pure OLED `#000000` with `#121216` surfaces and `#26262E` hairlines. No cloudy glassmorphism (`backdrop-filter: blur`), no noisy water ripples, and silent haptics (only a subtle 10ms pulse on long-press drag lift).
2. **Minimal Silhouette Brand System**: Full-bleed pure obsidian `#0A0A0C` icon (zero white outer border, zero nested visor box, zero glow) + crisp normal rounded-rectangle eye rims (`#F6F6F9`). Restores the original 13 sculpted organic Grok-style silhouettes (`bots.js`, zero outer grey border, zero glow), replacing only the eyes with Zbot's crisp hollow rounded-rectangle rims while preserving the original Create Bot layout and animations; black bodies auto-elevate to deep graphite `#25252D` in dark OLED mode for full legibility.
3. **Trends (`思潮`) Frontend Removed**: `sichao.js`, `#sichao-mask`, and standalone Trends commands are completely removed. Cloud sync & stateless US BYOK relay helpers live cleanly in `sync.js`.
3. **Pluggable Capabilities (Zero Hardcoding Conflicts)**:
   - Every capability (`reading-cosmos`, `phone-use`, `computer-use`, `mcp-bridge`, external REST/MCP connectors) is mounted per-Bot via `bots.js` / `connectors.js`.
   - `reading-cosmos` (阅读器) is mounted by default on the primary `Zbot` so users have an honest direct entry today, and can be unmounted with one toggle (`Bot Profile → Mounted Plugins`) once AI Agent automation handles everything autonomously.
   - **Never hijack live AI chat with hardcoded regexes**: when `aiConfigured()` is `true`, user messages go directly to the connected AI model with structured tool directives (`[[BOOK_CARD:...]]`, `[[STACK_CARD:...]]`, `[[NEWS_PUSH]]`, `[[CONFIRM:...]]`, `[[CARD:...]]`, `[[MSG_BOT:...]]`). Offline local fallbacks only run when `!aiConfigured()`.
   - **News Push (`deliverNewsPushInChat`)** always renders inside the Bot conversation timeline — never outside on the Agent Hub (`#zone-live-card`).

## 2. International-First AI & Local Subscription Bridge

- **Direct Cloud APIs (`ai.js` + `sichao-server/sichao/gateway.py`)**:
  - Presets prioritize **Gemini** (`gemini-2.5-flash`), **OpenAI** (`gpt-4.1-mini`), **Codex API** (`gpt-5.1-codex-mini` via `/v1/responses`), **Claude** (`claude-sonnet-4-5` via native Anthropic Messages + browser CORS header), **OpenRouter**, **Grok**, and **Groq**.
  - Automatic US-hosted Render stateless BYOK relay (`/api/byok/chat`, zero key persistence) whenever direct mobile/browser fetch hits regional network or CORS barriers.
  - Reasoning/Codex models (`o1/o3/o4/gpt-5/codex`) automatically omit unsupported `temperature` and route Codex models to OpenAI `/v1/responses`.
- **Official Local CLI Subscription Bridge (`scripts/ai-bridge.mjs`)**:
  - Run `npm run ai:bridge` on your PC to expose an OpenAI-compatible LAN endpoint (`http://<PC-IP>:8787/v1`) backed by your officially signed-in `codex`, `gemini`, or `claude` CLI (`codex-cli` / `gemini-cli` / `claude-cli`).
  - Mirrors OpenClaw/OpenBot's local gateway pattern cleanly without scraping private browser cookies.

## 3. External Apps & Open Ecosystem (`connectors.js`)

- International-first open catalog requiring zero vendor partnerships: **Notion, Obsidian Vault (Local REST / MCP), Google Workspace (via MCP / Composio), GitHub, Figma MCP, Canva MCP, Composio (1000+ OAuth), Zapier MCP (7000+ workflows), Linear, Todoist, Slack, Telegram, Discord, Resend, Airtable, Trello**.

## 4. Verification & Release Workflow

- **Web / E2E Smoke (37 checks)**: `npm run sync:www && npm run test:zone`
- **Cloud Backend Tests (9 checks)**: `cd sichao-server && python -m pytest -q`
- **Signed Release APK + Byte-for-Byte Verification**:
  - `powershell -ExecutionPolicy Bypass -File work/build-zone.ps1`
  - `python work/check-zone.py`
  - Rollback backups preserved untouched: `outputs/Zone-4.0-backup.apk`, `outputs/Zone-5.0.apk` → latest `outputs/Zbot-5.1.apk`.
- **IndexedDB Invariant**: Never bump DB `shufang` schema version `3` without an explicit migration plan. Never stage `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`, or `miniprogra/`.
