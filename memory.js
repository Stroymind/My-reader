// Zone 独立长久知识库与记忆引擎（本地存储 + 真实云端同步，完全独立于「阅读器 / 星海」插件）
// 1) 长久资料与记忆：支持上传文档（MD/TXT/DOCX/JSON/CSV）、导入外部 AI 记忆（ChatGPT/Claude/DeepSeek/Grok）、对话一键存入
// 2) 真实云端同步：支持 Zone 云端空间同步码（/api/kb/sync）以及用户自有 GitHub 私有 Gist 永久云盘备份
// 3) 作用域选择（全部 Bot 共享 / 仅指定 Bot），自动按相关性注入所有 Bot 对话与云端多步 Agent

import { nativeGetJson, nativePostJson } from './ai.js';

const MEM_KEY = 'zone-memory-v1';
const KB_TOMB_KEY = 'zone-kb-tombstones-v1';
const KB_CLOUD_KEY = 'zone-kb-cloud-v1';

export const MEMORY_EXPORT_PROMPT = `请把我之前告诉过你的个人背景、职业与长期项目、常用工具与技术栈、写作/沟通偏好、雷区与重要决定，整理成清晰、精炼的逐条要点（每条一句话，去掉客套话），方便我迁移到自己的个人 AI Agent（Zone）云端知识库中。`;

function uid() {
  return 'kb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function generateSpaceCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = n => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `ZN-${pick(4)}-${pick(4)}`;
}

export function getCloudKbConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(KB_CLOUD_KEY) || 'null');
    if (raw && typeof raw === 'object' && raw.spaceKey) return raw;
  } catch {}
  const fresh = { spaceKey: generateSpaceCode(), githubToken: '', gistId: '', lastSyncedAt: 0, lastCloudCount: 0 };
  try { localStorage.setItem(KB_CLOUD_KEY, JSON.stringify(fresh)); } catch {}
  return fresh;
}

export function saveCloudKbConfig(patch = {}) {
  const cur = getCloudKbConfig();
  const next = {
    ...cur,
    spaceKey: String(patch.spaceKey ?? cur.spaceKey ?? '').trim() || cur.spaceKey || generateSpaceCode(),
    githubToken: patch.githubToken === undefined ? (cur.githubToken || '') : String(patch.githubToken || '').trim(),
    gistId: patch.gistId === undefined ? (cur.gistId || '') : String(patch.gistId || '').trim(),
    lastSyncedAt: patch.lastSyncedAt !== undefined ? Number(patch.lastSyncedAt || 0) : (cur.lastSyncedAt || 0),
    lastCloudCount: patch.lastCloudCount !== undefined ? Number(patch.lastCloudCount || 0) : (cur.lastCloudCount || 0)
  };
  try { localStorage.setItem(KB_CLOUD_KEY, JSON.stringify(next)); } catch {}
  return next;
}

function listTombstones() {
  try {
    const arr = JSON.parse(localStorage.getItem(KB_TOMB_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveTombstones(arr) {
  try { localStorage.setItem(KB_TOMB_KEY, JSON.stringify(arr.slice(0, 200))); } catch {}
}

export function listMemories() {
  try {
    const arr = JSON.parse(localStorage.getItem(MEM_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(x => x && typeof x.text === 'string' && x.text.trim()) : [];
  } catch {
    return [];
  }
}

function saveMemories(list) {
  try { localStorage.setItem(MEM_KEY, JSON.stringify(list.slice(0, 400))); } catch {}
}

export function deleteMemory(id) {
  const next = listMemories().filter(m => m.id !== id);
  saveMemories(next);
  const tombs = listTombstones().filter(t => t.id !== id);
  tombs.unshift({ id, deleted: true, updatedAt: Date.now() / 1000 });
  saveTombstones(tombs);
  return next;
}

export function toggleMemory(id) {
  const list = listMemories();
  const hit = list.find(m => m.id === id);
  if (hit) { hit.enabled = !hit.enabled; hit.updatedAt = Date.now() / 1000; }
  saveMemories(list);
  return list;
}

export function clearMemories() {
  const now = Date.now() / 1000;
  const tombs = listMemories().map(m => ({ id: m.id, deleted: true, updatedAt: now }));
  saveTombstones([...tombs, ...listTombstones()]);
  saveMemories([]);
  return [];
}

export async function extractDocFileText(file) {
  if (!file) return '';
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.docx') && typeof window !== 'undefined' && window.JSZip) {
    try {
      const buf = await file.arrayBuffer();
      const zip = await window.JSZip.loadAsync(buf);
      const xml = await zip.file('word/document.xml')?.async('string');
      if (xml) {
        return xml
          .replace(/<\/w:p>/g, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
    } catch {}
  }
  return String(await file.text()).trim();
}

function extractFactsFromJson(data) {
  const facts = [];
  let detectedSource = 'JSON 导入';

  if (Array.isArray(data) && data.length && data[0] && typeof data[0] === 'object' && ('mapping' in data[0] || 'conversation_id' in data[0])) {
    detectedSource = 'ChatGPT 导出';
    const titles = [];
    for (const conv of data.slice(0, 80)) {
      const t = String(conv.title || '').trim();
      if (t && t.length >= 2 && t.length <= 80 && !/^New chat$/i.test(t)) titles.push(t);
    }
    if (titles.length) {
      facts.push(`ChatGPT 历史关注主题（共 ${data.length} 段对话）：${titles.slice(0, 18).join('、')}`);
    }
    for (const conv of data.slice(0, 20)) {
      const mapping = conv.mapping || {};
      for (const node of Object.values(mapping)) {
        const msg = node?.message;
        if (msg?.metadata?.user_context_message_data) {
          const uc = msg.metadata.user_context_message_data;
          if (uc.about_user_message) facts.push(`关于我：${String(uc.about_user_message).trim().slice(0, 300)}`);
          if (uc.about_model_message) facts.push(`回复偏好：${String(uc.about_model_message).trim().slice(0, 300)}`);
        }
      }
    }
    return { facts, source: detectedSource };
  }

  const pullFromObj = obj => {
    if (!obj) return;
    if (typeof obj === 'string') {
      const s = obj.trim();
      if (s.length >= 4) facts.push(s.slice(0, 600));
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj.slice(0, 120)) pullFromObj(item);
      return;
    }
    if (typeof obj === 'object') {
      if (typeof obj.conversations_memory === 'string' && obj.conversations_memory.trim()) {
        detectedSource = 'Claude 记忆';
        facts.push(...extractFactsFromText(obj.conversations_memory));
      }
      for (const k of ['memory', 'memories', 'facts', 'items', 'content', 'text', 'summary', 'about_user_message', 'about_model_message']) {
        if (obj[k] != null) pullFromObj(obj[k]);
      }
    }
  };
  pullFromObj(data);
  return { facts, source: detectedSource };
}

function extractFactsFromText(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const out = [];
  let cur = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (cur) { out.push(cur); cur = ''; }
      continue;
    }
    if (/^#{1,4}\s+/.test(t)) {
      if (cur) { out.push(cur); cur = ''; }
      const heading = t.replace(/^#{1,4}\s+/, '').trim();
      if (heading.length >= 2) cur = `【${heading}】`;
      continue;
    }
    const bullet = t.replace(/^(?:[-*•·]|\d+[.)、])\s*/, '').trim();
    if (bullet !== t || t.length <= 160) {
      if (cur && !cur.endsWith('】')) { out.push(cur); cur = ''; }
      const piece = cur ? `${cur} ${bullet}` : bullet;
      cur = '';
      if (piece.length >= 3) out.push(piece.slice(0, 600));
    } else {
      cur = cur ? `${cur} ${t}` : t;
      if (cur.length >= 420) { out.push(cur.slice(0, 600)); cur = ''; }
    }
  }
  if (cur && cur.length >= 3) out.push(cur.slice(0, 600));
  return out;
}

export function importMemoryText(rawText, { source = '手动录入', scope = 'global', kind = 'memory', title = '' } = {}) {
  const raw = String(rawText || '').trim();
  if (!raw) return { added: 0, skipped: 0, total: listMemories().length };
  let facts = [];
  let finalSource = source;
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      const parsed = JSON.parse(raw);
      const res = extractFactsFromJson(parsed);
      facts = res.facts;
      if (source === '手动录入' || source === '手动粘贴' || source === '文件导入') finalSource = res.source;
    } catch {
      facts = extractFactsFromText(raw);
    }
  } else {
    facts = extractFactsFromText(raw);
  }
  const existing = listMemories();
  const seen = new Set(existing.map(m => m.text.trim().toLowerCase()));
  let added = 0;
  let skipped = 0;
  const nowMs = Date.now();
  const nowSec = nowMs / 1000;
  const newly = [];
  for (const f of facts) {
    const clean = String(f || '').trim();
    if (clean.length < 3) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    newly.push({
      id: uid(),
      title: title || clean.slice(0, 26),
      text: clean,
      kind: kind || 'memory',
      source: finalSource,
      scope: scope || 'global',
      enabled: true,
      createdAt: nowMs,
      updatedAt: nowSec
    });
    added++;
  }
  const merged = [...newly, ...existing];
  saveMemories(merged);
  return { added, skipped, total: merged.length };
}

export async function importMemoryFile(file, { scope = 'global' } = {}) {
  if (!file) return { added: 0, skipped: 0, total: listMemories().length };
  const text = await extractDocFileText(file);
  const name = String(file.name || '文件导入');
  const isAiExport = /chatgpt|conversations|claude|grok|memor/i.test(name);
  const source = /chatgpt|conversations/i.test(name) ? 'ChatGPT 文件'
    : /claude/i.test(name) ? 'Claude 文件'
      : /grok/i.test(name) ? 'Grok 文件'
        : name.slice(0, 24);
  return importMemoryText(text, { source, scope, kind: isAiExport ? 'memory' : 'doc', title: name.replace(/\.[^.]+$/, '').slice(0, 26) });
}

export async function syncCloudKb(cloudApiBase) {
  const cfg = getCloudKbConfig();
  const localItems = listMemories();
  const tombs = listTombstones();
  const payloadItems = [
    ...localItems.map(m => ({
      id: m.id,
      title: m.title || m.text.slice(0, 26),
      text: m.text,
      kind: m.kind || 'memory',
      source: m.source || '手动录入',
      scope: m.scope || 'global',
      updatedAt: Number(m.updatedAt || (m.createdAt ? m.createdAt / 1000 : Date.now() / 1000)),
      deleted: false
    })),
    ...tombs
  ];

  // 1. 优先：若用户填了 GitHub Token，则同步至用户自己的私有 GitHub Gist（永久云盘，永不丢失）
  if (cfg.githubToken) {
    const ghHeaders = {
      Authorization: `Bearer ${cfg.githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    let remoteItems = [];
    let gistId = cfg.gistId || '';
    if (gistId) {
      const gr = await nativeGetJson(`https://api.github.com/gists/${gistId}`, ghHeaders, 25000);
      if (gr.ok && gr.data?.files?.['zone-cloud-kb.json']?.content) {
        try {
          const parsed = JSON.parse(gr.data.files['zone-cloud-kb.json'].content);
          if (Array.isArray(parsed?.items)) remoteItems = parsed.items;
        } catch {}
      } else if (gr.status === 404) {
        gistId = '';
      }
    }
    const mergedMap = new Map();
    for (const item of [...remoteItems, ...payloadItems]) {
      if (!item?.id) continue;
      const prev = mergedMap.get(item.id);
      if (!prev || Number(item.updatedAt || 0) >= Number(prev.updatedAt || 0)) mergedMap.set(item.id, item);
    }
    const allMerged = [...mergedMap.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    const active = allMerged.filter(x => !x.deleted && x.text);
    const body = {
      description: 'Zone 个人云端知识库（加密隔离私有备份）',
      public: false,
      files: { 'zone-cloud-kb.json': { content: JSON.stringify({ version: 1, spaceKey: cfg.spaceKey, syncedAt: Date.now(), items: allMerged.slice(0, 500) }, null, 2) } }
    };
    const saveUrl = gistId ? `https://api.github.com/gists/${gistId}` : 'https://api.github.com/gists';
    const capHttp = typeof window !== 'undefined' ? window?.Capacitor?.Plugins?.CapacitorHttp : null;
    let res;
    if (gistId && capHttp?.patch) {
      const r = await capHttp.patch({ url: saveUrl, headers: { 'Content-Type': 'application/json', ...ghHeaders }, data: body, connectTimeout: 20000, readTimeout: 30000 });
      res = { ok: r.status >= 200 && r.status < 300, status: r.status, data: typeof r.data === 'string' ? JSON.parse(r.data || '{}') : (r.data || {}) };
    } else if (gistId) {
      const r = await fetch(saveUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ghHeaders }, body: JSON.stringify(body) });
      res = { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
    } else {
      res = await nativePostJson(saveUrl, ghHeaders, body, 30000);
    }
    if (!res.ok) return { ok: false, error: `GitHub 私有云同步失败（HTTP ${res.status}），请检查 Token 是否勾选 gist 权限` };
    saveMemories(active.map(x => ({ ...x, enabled: true, createdAt: Math.round((x.updatedAt || Date.now() / 1000) * 1000) })));
    saveCloudKbConfig({ gistId: res.data?.id || gistId, lastSyncedAt: Date.now(), lastCloudCount: active.length });
    return { ok: true, provider: 'GitHub 私有云', count: active.length };
  }

  // 2. 默认：零配置 Zone 云端知识库同步（按个人同步码 SHA-256 隔离）
  const api = String(cloudApiBase || '').replace(/\/+$/, '');
  if (!api) return { ok: false, error: '未配置云端服务地址' };
  const res = await nativePostJson(`${api}/api/kb/sync`, { 'X-Zone-Space-Key': cfg.spaceKey }, { items: payloadItems }, 40000);
  if (!res.ok || !res.data?.ok) {
    return { ok: false, error: res.data?.detail || `云端同步失败（HTTP ${res.status || '超时'}）` };
  }
  const merged = Array.isArray(res.data.items) ? res.data.items : [];
  const active = merged.filter(x => !x.deleted && x.text).map(x => ({
    id: x.id,
    title: x.title || x.text.slice(0, 26),
    text: x.text,
    kind: x.kind || 'memory',
    source: x.source || '云端同步',
    scope: x.scope || 'global',
    enabled: true,
    createdAt: Math.round((x.updatedAt || Date.now() / 1000) * 1000),
    updatedAt: Number(x.updatedAt || Date.now() / 1000)
  }));
  saveMemories(active);
  saveCloudKbConfig({ lastSyncedAt: Date.now(), lastCloudCount: active.length });
  return { ok: true, provider: 'Zone 云端', count: active.length };
}

export function buildMemoryContextForBot(botId = '', query = '', maxChars = 1600) {
  const all = listMemories().filter(m => m.enabled !== false && (m.scope === 'global' || (botId && m.scope === botId)));
  if (!all.length) return '';
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[\s,，。！？、；;:/()（）]+/)
    .filter(w => w.length >= 2);
  const scored = all.map((m, idx) => {
    const low = `${m.title || ''} ${m.source || ''} ${m.text || ''}`.toLowerCase();
    let score = m.scope === botId ? 3 : 1;
    for (const tk of tokens) {
      if (low.includes(tk)) score += 4;
    }
    score += Math.max(0, 1 - idx * 0.015);
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const lines = [];
  let used = 0;
  for (const { m } of scored) {
    const tag = m.kind === 'doc' && m.source ? `[${m.source}] ` : '';
    const line = `- ${tag}${m.text}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

export function closeImportMemorySheet() {
  const mask = document.getElementById('zone-memory-mask');
  if (!mask || mask.classList.contains('hidden')) return false;
  mask.classList.add('hidden');
  return true;
}

export function openImportMemorySheet({ bots = [], defaultScope = 'global', cloudApi = '', onCopyPrompt, onToast, onChanged } = {}) {
  let mask = document.getElementById('zone-memory-mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'zone-memory-mask';
    mask.className = 'bots-mask hidden';
    document.body.appendChild(mask);
  }
  let scope = defaultScope || 'global';
  let showCloudCfg = false;
  let syncing = false;
  let query = '';
  const botNameOf = id => {
    if (!id || id === 'global') return '全部 Bot';
    return bots.find(b => b.id === id)?.name || '指定 Bot';
  };
  const fmtTime = ts => {
    if (!ts) return '尚未同步';
    const d = new Date(ts);
    return `已同步 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const draw = () => {
    const items = listMemories();
    const cfg = getCloudKbConfig();
    const filtered = query
      ? items.filter(m => `${m.title || ''} ${m.text || ''} ${m.source || ''}`.toLowerCase().includes(query.toLowerCase()))
      : items;
    mask.innerHTML = `
      <div class="bots-sheet" role="dialog" aria-label="云端知识库">
        <div class="bots-head">
          <div>
            <h3>知识库</h3>
            <p>长久记忆与文档 · 支持云端同步，独立于插件</p>
          </div>
          <button type="button" class="bots-close" data-m-act="close">完成</button>
        </div>

        <div class="prof-group">
          <div class="prof-row" style="cursor:default">
            <div class="prof-row-main">
              <strong>${cfg.githubToken ? 'GitHub 私有云' : 'Zone 云端空间'}</strong>
              <span>同步码 ${esc(cfg.spaceKey)} · ${fmtTime(cfg.lastSyncedAt)}</span>
            </div>
            <button type="button" class="bot-edit" data-m-act="sync-cloud" ${syncing ? 'disabled' : ''}>${syncing ? '同步中…' : '云端同步'}</button>
          </div>
          <button type="button" class="prof-row" data-m-act="toggle-cloud-cfg">
            <div class="prof-row-main">
              <strong>云端设置</strong>
              <span>换设备输入同一同步码即可拉取 · 可选 GitHub 永久备份</span>
            </div>
            <span class="prof-row-val">${showCloudCfg ? '收起' : '配置 ›'}</span>
          </button>
          ${showCloudCfg ? `
            <div class="prof-recharge-box">
              <input id="kb-space-key" type="text" placeholder="空间同步码（如 ZN-XXXX-XXXX）" value="${esc(cfg.spaceKey)}">
              <input id="kb-gh-token" type="password" placeholder="可选：GitHub Token（勾选 gist 权限可永久私密云存）" value="${esc(cfg.githubToken)}">
              <div style="display:flex;gap:8px">
                <button type="button" class="bots-secondary" style="flex:1;height:38px" data-m-act="copy-code">复制同步码</button>
                <button type="button" class="bots-primary" style="flex:1;height:38px;font-size:14px" data-m-act="save-cloud-cfg">保存并同步</button>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="prof-group">
          <button type="button" class="prof-row" data-m-act="pick-file">
            <div class="prof-row-main">
              <strong>上传文档或导出文件</strong>
              <span>支持 MD / TXT / DOCX / JSON / CSV</span>
            </div>
            <span class="prof-row-val">上传 ›</span>
          </button>
          <button type="button" class="prof-row" data-m-act="copy-prompt">
            <div class="prof-row-main">
              <strong>导入其他 AI 记忆</strong>
              <span>复制提示词发给 ChatGPT / Claude / DeepSeek</span>
            </div>
            <span class="prof-row-val">复制 ›</span>
          </button>
          <input id="zone-mem-file" type="file" accept=".json,.md,.txt,.markdown,.csv,.docx,text/plain,application/json" multiple class="sr">
        </div>

        <div class="bots-form" style="margin-bottom:14px">
          <div class="plugin-assign" style="border-top:0;padding:0">
            <span class="plugin-assign-lbl">共享范围：</span>
            <div class="plugin-assign-chips">
              <button type="button" class="plugin-bot-chip ${scope === 'global' ? 'on' : ''}" data-m-scope="global">全部 Bot${scope === 'global' ? ' ✓' : ''}</button>
              ${bots.map(b => `<button type="button" class="plugin-bot-chip ${scope === b.id ? 'on' : ''}" data-m-scope="${esc(b.id)}">仅 ${esc(b.name)}${scope === b.id ? ' ✓' : ''}</button>`).join('')}
            </div>
          </div>
          <textarea id="zone-mem-input" rows="3" placeholder="粘贴长久知识、项目规范或个人记忆，每行一条…"></textarea>
          <button type="button" class="bots-primary" data-m-act="import-text">存入知识库</button>
        </div>

        <div class="prof-group">
          <div class="prof-row" style="cursor:default">
            <div class="prof-row-main">
              <strong>已存条目（${items.length}）</strong>
              <span>所有 Bot 对话自动检索，与阅读器插件互不依赖</span>
            </div>
          </div>
          ${items.length > 3 ? `<div style="padding:0 12px 10px"><input id="kb-filter-inp" type="search" placeholder="搜索知识库…" value="${esc(query)}" style="width:100%;height:36px;padding:0 12px;border:0;border-radius:10px;background:var(--app-fill);color:var(--app-fg);font-size:14px;outline:none"></div>` : ''}
          ${filtered.length ? filtered.slice(0, 40).map(m => `
            <div class="mem-row">
              <div class="mem-row-txt">
                <p>${esc(m.text)}</p>
                <span>${m.kind === 'doc' ? '文档' : '记忆'} · ${esc(m.source)} · ${esc(botNameOf(m.scope))}</span>
              </div>
              <button type="button" class="mem-del" data-m-del="${esc(m.id)}" aria-label="删除此条目">×</button>
            </div>
          `).join('') : '<p class="sc-empty" style="padding:18px 12px">暂无条目，上传文档或输入长久知识即可供所有 Bot 使用。</p>'}
        </div>
        ${items.length ? '<button type="button" class="bots-danger" data-m-act="clear-all">清空知识库</button>' : ''}
      </div>`;

    mask.onclick = e => { if (e.target === mask) closeImportMemorySheet(); };
    mask.querySelector('[data-m-act="close"]').onclick = () => closeImportMemorySheet();
    mask.querySelector('[data-m-act="toggle-cloud-cfg"]').onclick = () => { showCloudCfg = !showCloudCfg; draw(); };

    const doSync = async () => {
      if (syncing) return;
      syncing = true; draw();
      try {
        const res = await syncCloudKb(cloudApi);
        if (res.ok) {
          onToast?.(`已与${res.provider}完成双向同步（共 ${res.count} 条）`, 2800);
          onChanged?.();
        } else {
          onToast?.(res.error || '云端同步失败，请稍后重试', 3200);
        }
      } catch (err) {
        onToast?.(err?.message || '云端同步网络异常', 3000);
      } finally {
        syncing = false; draw();
      }
    };
    mask.querySelector('[data-m-act="sync-cloud"]').onclick = () => doSync();

    const copyCodeBtn = mask.querySelector('[data-m-act="copy-code"]');
    if (copyCodeBtn) copyCodeBtn.onclick = async () => {
      const code = mask.querySelector('#kb-space-key')?.value?.trim() || getCloudKbConfig().spaceKey;
      await onCopyPrompt?.(code);
      onToast?.(`已复制同步码 ${code}`, 2400);
    };
    const saveCloudBtn = mask.querySelector('[data-m-act="save-cloud-cfg"]');
    if (saveCloudBtn) saveCloudBtn.onclick = () => {
      const spaceKey = mask.querySelector('#kb-space-key')?.value?.trim() || '';
      const githubToken = mask.querySelector('#kb-gh-token')?.value?.trim() || '';
      if (spaceKey.length < 6) { onToast?.('同步码至少需要 6 位字符'); return; }
      saveCloudKbConfig({ spaceKey, githubToken });
      showCloudCfg = false;
      doSync();
    };

    mask.querySelector('[data-m-act="copy-prompt"]').onclick = async () => {
      await onCopyPrompt?.(MEMORY_EXPORT_PROMPT);
      onToast?.('已复制导出提示词，去发给 ChatGPT / Claude / DeepSeek 即可', 3000);
    };
    const fileInp = mask.querySelector('#zone-mem-file');
    mask.querySelector('[data-m-act="pick-file"]').onclick = () => fileInp?.click();
    if (fileInp) {
      fileInp.onchange = async () => {
        const files = [...(fileInp.files || [])];
        if (!files.length) return;
        let totalAdded = 0;
        for (const f of files) {
          const res = await importMemoryFile(f, { scope });
          totalAdded += res.added;
        }
        onChanged?.();
        onToast?.(totalAdded ? `已导入 ${totalAdded} 条知识（点上方「云端同步」可备份上云）` : '未解析出新增条目', 2800);
        draw();
      };
    }
    mask.querySelectorAll('[data-m-scope]').forEach(btn => {
      btn.onclick = () => { scope = btn.dataset.mScope; draw(); };
    });
    mask.querySelector('[data-m-act="import-text"]').onclick = () => {
      const ta = mask.querySelector('#zone-mem-input');
      const txt = ta?.value || '';
      if (!txt.trim()) { onToast?.('请先粘贴或输入知识内容'); return; }
      const res = importMemoryText(txt, { source: '手动录入', scope, kind: 'memory' });
      onChanged?.();
      onToast?.(res.added ? `已存入 ${res.added} 条至知识库（点「云端同步」可上云）` : '内容已在知识库中', 2600);
      draw();
    };
    const filterInp = mask.querySelector('#kb-filter-inp');
    if (filterInp) {
      filterInp.oninput = () => { query = filterInp.value; draw(); const el = mask.querySelector('#kb-filter-inp'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
    }
    mask.querySelectorAll('[data-m-del]').forEach(btn => {
      btn.onclick = () => {
        deleteMemory(btn.dataset.mDel);
        onChanged?.();
        draw();
      };
    });
    const clearBtn = mask.querySelector('[data-m-act="clear-all"]');
    if (clearBtn) clearBtn.onclick = () => {
      clearMemories();
      onChanged?.();
      onToast?.('已清空本地知识库');
      draw();
    };
  };

  draw();
  mask.classList.remove('hidden');
}
