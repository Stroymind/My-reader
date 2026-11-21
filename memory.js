// Zone Import Memory（导入外部记忆）引擎
// 100% 本地隐私存储（localStorage['zone-memory-v1']），支持：
// 1) 一键复制外部 AI 记忆导出提示词（ChatGPT / Claude / DeepSeek / Grok / 豆包 / Kimi）
// 2) 直接粘贴文本或导入文件（ChatGPT conversations.json / Claude memories.json / Markdown / TXT）
// 3) 作用域选择（全局共享 / 仅指定 Bot），并真实注入本地与云端 BYOK Bot 对话上下文

const MEM_KEY = 'zone-memory-v1';

export const MEMORY_EXPORT_PROMPT = `请把我之前告诉过你的个人背景、职业与长期项目、常用工具与技术栈、写作/沟通偏好、雷区与重要决定，整理成清晰、精炼的逐条要点（每条一句话，去掉客套话），方便我迁移到自己的个人 AI Agent（Zone）记忆库中。`;

function uid() {
  return 'mem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  try { localStorage.setItem(MEM_KEY, JSON.stringify(list.slice(0, 300))); } catch {}
}

export function deleteMemory(id) {
  const next = listMemories().filter(m => m.id !== id);
  saveMemories(next);
  return next;
}

export function toggleMemory(id) {
  const list = listMemories();
  const hit = list.find(m => m.id === id);
  if (hit) hit.enabled = !hit.enabled;
  saveMemories(list);
  return list;
}

export function clearMemories() {
  saveMemories([]);
  return [];
}

function extractFactsFromJson(data) {
  const facts = [];
  let detectedSource = 'JSON 导入';

  // 1. ChatGPT conversations.json (数组，含 title / mapping)
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
    // 尝试提取用户系统画像或自定义指令
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

  // 2. Claude / Grok / 通用记忆数组或对象
  const pullFromObj = obj => {
    if (!obj) return;
    if (typeof obj === 'string') {
      const s = obj.trim();
      if (s.length >= 4) facts.push(s.slice(0, 360));
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
      continue;
    }
    const bullet = t.replace(/^(?:[-*•·]|\d+[.)、])\s*/, '').trim();
    if (bullet !== t || t.length <= 160) {
      if (cur) { out.push(cur); cur = ''; }
      if (bullet.length >= 3) out.push(bullet.slice(0, 360));
    } else {
      cur = cur ? `${cur} ${t}` : t;
      if (cur.length >= 260) { out.push(cur.slice(0, 360)); cur = ''; }
    }
  }
  if (cur && cur.length >= 3) out.push(cur.slice(0, 360));
  return out;
}

export function importMemoryText(rawText, { source = '手动粘贴', scope = 'global' } = {}) {
  const raw = String(rawText || '').trim();
  if (!raw) return { added: 0, skipped: 0, total: listMemories().length };
  let facts = [];
  let finalSource = source;
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      const parsed = JSON.parse(raw);
      const res = extractFactsFromJson(parsed);
      facts = res.facts;
      if (source === '手动粘贴' || source === '文件导入') finalSource = res.source;
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
  const now = Date.now();
  const newly = [];
  for (const f of facts) {
    const clean = String(f || '').trim();
    if (clean.length < 3) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    newly.push({
      id: uid(),
      text: clean,
      source: finalSource,
      scope: scope || 'global',
      enabled: true,
      createdAt: now
    });
    added++;
  }
  const merged = [...newly, ...existing];
  saveMemories(merged);
  return { added, skipped, total: merged.length };
}

export async function importMemoryFile(file, { scope = 'global' } = {}) {
  if (!file) return { added: 0, skipped: 0, total: listMemories().length };
  const text = await file.text();
  const name = String(file.name || '文件导入');
  const source = /chatgpt|conversations/i.test(name) ? 'ChatGPT 文件'
    : /claude/i.test(name) ? 'Claude 文件'
      : /grok/i.test(name) ? 'Grok 文件'
        : `文件 · ${name.slice(0, 18)}`;
  return importMemoryText(text, { source, scope });
}

export function buildMemoryContextForBot(botId = '', query = '', maxChars = 1400) {
  const all = listMemories().filter(m => m.enabled !== false && (m.scope === 'global' || (botId && m.scope === botId)));
  if (!all.length) return '';
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[\s,，。！？、；;:/()（）]+/)
    .filter(w => w.length >= 2);
  const scored = all.map((m, idx) => {
    const low = m.text.toLowerCase();
    let score = m.scope === botId ? 3 : 1;
    for (const tk of tokens) {
      if (low.includes(tk)) score += 4;
    }
    score += Math.max(0, 1 - idx * 0.02);
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const lines = [];
  let used = 0;
  for (const { m } of scored) {
    const line = `- ${m.text}`;
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

export function openImportMemorySheet({ bots = [], defaultScope = 'global', onCopyPrompt, onToast, onChanged, onSyncToKnowledge } = {}) {
  let mask = document.getElementById('zone-memory-mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'zone-memory-mask';
    mask.className = 'bots-mask hidden';
    document.body.appendChild(mask);
  }
  let scope = defaultScope || 'global';
  const botNameOf = id => {
    if (!id || id === 'global') return '全局记忆';
    return bots.find(b => b.id === id)?.name || '指定 Bot';
  };

  const draw = () => {
    const items = listMemories();
    mask.innerHTML = `
      <div class="bots-sheet" role="dialog" aria-label="导入记忆">
        <div class="bots-head">
          <div>
            <h3>导入记忆</h3>
            <p>存入本地并共享至星海，所有 Bot 均可按需读取</p>
          </div>
          <button type="button" class="bots-close" data-m-act="close">完成</button>
        </div>

        <div class="prof-group">
          <button type="button" class="prof-row" data-m-act="copy-prompt">
            <div class="prof-row-main">
              <strong>复制导出提示词</strong>
              <span>发给 ChatGPT / Claude / DeepSeek 提取记忆</span>
            </div>
            <span class="prof-row-val">复制 ›</span>
          </button>
          <button type="button" class="prof-row" data-m-act="pick-file">
            <div class="prof-row-main">
              <strong>导入文件</strong>
              <span>支持 JSON / Markdown / TXT</span>
            </div>
            <span class="prof-row-val">选择 ›</span>
          </button>
          <input id="zone-mem-file" type="file" accept=".json,.md,.txt,.markdown,text/plain,application/json" class="sr">
        </div>

        <div class="bots-form" style="margin-bottom:14px">
          <div class="plugin-assign" style="border-top:0;padding:0">
            <span class="plugin-assign-lbl">生效范围：</span>
            <div class="plugin-assign-chips">
              <button type="button" class="plugin-bot-chip ${scope === 'global' ? 'on' : ''}" data-m-scope="global">全部 Bot${scope === 'global' ? ' ✓' : ''}</button>
              ${bots.map(b => `<button type="button" class="plugin-bot-chip ${scope === b.id ? 'on' : ''}" data-m-scope="${esc(b.id)}">仅 ${esc(b.name)}${scope === b.id ? ' ✓' : ''}</button>`).join('')}
            </div>
          </div>
          <textarea id="zone-mem-input" rows="4" placeholder="粘贴其他 AI 整理的要点，每行一条…"></textarea>
          <button type="button" class="bots-primary" data-m-act="import-text">导入记忆</button>
        </div>

        <div class="prof-group">
          <div class="prof-row" style="cursor:default">
            <div class="prof-row-main">
              <strong>记忆库（${items.length}）</strong>
              <span>对话自动调用 · 可一键点亮至星海</span>
            </div>
            ${items.length ? `<button type="button" class="bot-edit" data-m-act="sync-k">点亮星海</button>` : ''}
          </div>
          ${items.length ? items.slice(0, 30).map(m => `
            <div class="mem-row">
              <div class="mem-row-txt">
                <p>${esc(m.text)}</p>
                <span>${esc(m.source)} · ${esc(botNameOf(m.scope))}</span>
              </div>
              <button type="button" class="mem-del" data-m-del="${esc(m.id)}" aria-label="删除此记忆">×</button>
            </div>
          `).join('') : '<p class="sc-empty" style="padding:18px 12px">暂无记忆，复制提示词或导入文件即可迁入。</p>'}
        </div>
        ${items.length ? '<button type="button" class="bots-danger" data-m-act="clear-all">清空记忆</button>' : ''}
      </div>`;

    mask.onclick = e => { if (e.target === mask) closeImportMemorySheet(); };
    mask.querySelector('[data-m-act="close"]').onclick = () => closeImportMemorySheet();
    mask.querySelector('[data-m-act="copy-prompt"]').onclick = async () => {
      await onCopyPrompt?.(MEMORY_EXPORT_PROMPT);
      onToast?.('已复制导出提示词，去发给 ChatGPT / Claude / DeepSeek 即可', 3000);
    };
    const fileInp = mask.querySelector('#zone-mem-file');
    mask.querySelector('[data-m-act="pick-file"]').onclick = () => fileInp?.click();
    if (fileInp) {
      fileInp.onchange = async () => {
        const f = fileInp.files?.[0];
        if (!f) return;
        const res = await importMemoryFile(f, { scope });
        onChanged?.();
        onToast?.(res.added ? `已从文件导入 ${res.added} 条记忆（去重跳过 ${res.skipped} 条）` : '未解析出新增记忆要点', 2800);
        draw();
      };
    }
    mask.querySelectorAll('[data-m-scope]').forEach(btn => {
      btn.onclick = () => { scope = btn.dataset.mScope; draw(); };
    });
    mask.querySelector('[data-m-act="import-text"]').onclick = () => {
      const val = mask.querySelector('#zone-mem-input')?.value || '';
      const res = importMemoryText(val, { source: '粘贴导入', scope });
      if (!res.added) { onToast?.('请先粘贴记忆要点（或要点已存在）', 2200); return; }
      onChanged?.();
      onToast?.(`已导入 ${res.added} 条记忆，Bot 对话时自动生效`, 2600);
      draw();
    };
    mask.querySelectorAll('[data-m-del]').forEach(btn => {
      btn.onclick = () => {
        deleteMemory(btn.dataset.mDel);
        onChanged?.();
        draw();
      };
    });
    const syncBtn = mask.querySelector('[data-m-act="sync-k"]');
    if (syncBtn) {
      syncBtn.onclick = async () => {
        await onSyncToKnowledge?.(listMemories());
        onToast?.('已将个人记忆归档到「知识与星海」', 2400);
      };
    }
    const clrBtn = mask.querySelector('[data-m-act="clear-all"]');
    if (clrBtn) {
      clrBtn.onclick = () => {
        clearMemories();
        onChanged?.();
        onToast?.('已清空本机记忆库', 2000);
        draw();
      };
    }
  };

  draw();
  mask.classList.remove('hidden');
}
