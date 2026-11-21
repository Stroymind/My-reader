// Zone Bot 工坊：苹果风动态几何生命体 + 自定义规则 + 同步到 Android 桌面单组件总管

const BOTS_KEY = 'zone-bots-v1';
const ACTIVE_KEY = 'zone-active-bot-id';

const DEFAULT_BOTS = [
  {
    id: 'zone-chief',
    name: 'Zone 总管',
    role: '自动调度所有能力 · 直接说话派活',
    rules: '你是 Zone 私人总管。说话简洁克制、直奔结论；能直接调用工具/阅读器/控屏解决的事绝不废话。',
    shape: 'orb',
    accent: '#007AFF'
  },
  {
    id: 'bot-sichao',
    name: '思潮官',
    role: '云端 24/7 情报筛选与独立判断',
    rules: '只看一手事实与可验证证据，警惕营销噪音与标题党；输出永远区分「已确认事实」「变化」「未知变量」与「反例」。',
    shape: 'prism',
    accent: '#5856D6'
  },
  {
    id: 'bot-reader',
    name: '研读官',
    role: '精读文档、生成小册子与星海记忆',
    rules: '擅长把长文章、书籍、视频逐字稿提炼成结构清晰、带原句出处的精炼笔记，并主动关联星海已有概念。',
    shape: 'halo',
    accent: '#34C759'
  },
  {
    id: 'bot-phone',
    name: '手机代办官',
    role: '语音跨 App 操作手机与生成微应用',
    rules: '严格遵守安全边界：任何付款、转账、删除、正式对外发送消息前必须停下来请用户确认。',
    shape: 'fold',
    accent: '#FF9500'
  }
];

const SHAPES = [
  { id: 'orb', label: '星轨' },
  { id: 'prism', label: '棱镜' },
  { id: 'halo', label: '日冕' },
  { id: 'fold', label: '折纸' }
];

const ACCENTS = ['#007AFF', '#5856D6', '#34C759', '#FF9500', '#FF2D55', '#1D1D1F'];

export function listBots() {
  try {
    const saved = JSON.parse(localStorage.getItem(BOTS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return DEFAULT_BOTS.map(b => ({ ...b }));
}

function saveBots(list) {
  try { localStorage.setItem(BOTS_KEY, JSON.stringify(list)); } catch {}
  syncToAndroidWidget(list);
}

export function getActiveBot() {
  const list = listBots();
  const id = (() => { try { return localStorage.getItem(ACTIVE_KEY) || ''; } catch { return ''; } })();
  return list.find(b => b.id === id) || list[0];
}

export function setActiveBot(id) {
  const list = listBots();
  const idx = Math.max(0, list.findIndex(b => b.id === id));
  const bot = list[idx];
  try { localStorage.setItem(ACTIVE_KEY, bot.id); } catch {}
  syncToAndroidWidget(list, idx);
  return bot;
}

export function syncToAndroidWidget(list = listBots(), activeIndex = -1) {
  const p = window?.Capacitor?.Plugins?.ZoneShortcut;
  if (!p?.syncWidgetBots) return;
  const idx = activeIndex >= 0 ? activeIndex : Math.max(0, list.findIndex(b => b.id === getActiveBot().id));
  const slim = list.map(b => ({ id: b.id, name: b.name, role: b.role, shape: b.shape, accent: b.accent }));
  p.syncWidgetBots({ botsJson: JSON.stringify(slim), activeIndex: idx }).catch(() => {});
}

export function renderBotSvg(shape = 'orb', accent = '#007AFF') {
  const soft = `${accent}24`;
  if (shape === 'prism') {
    return `<svg class="bot-glyph" viewBox="0 0 64 64" aria-hidden="true">
      <polygon points="32,10 54,50 10,50" fill="${soft}" stroke="${accent}" stroke-width="2.4" stroke-linejoin="round"/>
      <circle cx="32" cy="36" r="4.2" fill="${accent}"/>
    </svg>`;
  }
  if (shape === 'halo') {
    return `<svg class="bot-glyph" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="18" fill="${soft}" stroke="${accent}" stroke-width="2.4"/>
      <ellipse cx="32" cy="32" rx="24" ry="8.5" fill="none" stroke="${accent}" stroke-width="2"/>
      <circle cx="32" cy="32" r="3.8" fill="${accent}"/>
    </svg>`;
  }
  if (shape === 'fold') {
    return `<svg class="bot-glyph" viewBox="0 0 64 64" aria-hidden="true">
      <polygon points="32,9 55,32 32,55 9,32" fill="${soft}" stroke="${accent}" stroke-width="2.4" stroke-linejoin="round"/>
      <line x1="9" y1="32" x2="55" y2="32" stroke="${accent}" stroke-width="2"/>
      <circle cx="32" cy="32" r="3.8" fill="${accent}"/>
    </svg>`;
  }
  return `<svg class="bot-glyph" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="20" fill="${soft}" stroke="${accent}" stroke-width="2.4"/>
    <circle cx="32" cy="32" r="11" fill="none" stroke="${accent}" stroke-width="2"/>
    <circle cx="40" cy="24" r="3.8" fill="${accent}"/>
  </svg>`;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function openBotStudio({ onSelect, onStatus } = {}) {
  let mask = document.getElementById('zone-bots-mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'zone-bots-mask';
    mask.className = 'bots-mask hidden';
    document.body.appendChild(mask);
  }
  let editing = null;

  const draw = () => {
    const list = listBots();
    const active = getActiveBot();
    if (editing) {
      mask.innerHTML = `
        <div class="bots-sheet" role="dialog" aria-label="编辑 Bot">
          <div class="bots-head">
            <h3>${editing.isNew ? '新建专属 Bot' : '编辑 Bot 规则'}</h3>
            <button type="button" class="bots-close" data-act="cancel">返回</button>
          </div>
          <div class="bots-preview">${renderBotSvg(editing.shape, editing.accent)}</div>
          <div class="bots-form">
            <input id="bot-f-name" type="text" placeholder="名称（如：科研侦察官）" value="${esc(editing.name)}">
            <input id="bot-f-role" type="text" placeholder="一句话职能（显示在手机桌面小组件上）" value="${esc(editing.role)}">
            <textarea id="bot-f-rules" rows="4" placeholder="给它制定专属规则（例：只看一手论文，拒绝营销号，回答不超过 3 点）">${esc(editing.rules)}</textarea>
            <div class="bots-pick-row">
              ${SHAPES.map(s => `<button type="button" class="bots-chip ${editing.shape === s.id ? 'on' : ''}" data-shape="${s.id}">${s.label}</button>`).join('')}
            </div>
            <div class="bots-pick-row">
              ${ACCENTS.map(c => `<button type="button" class="bots-dot ${editing.accent === c ? 'on' : ''}" style="background:${c}" data-accent="${c}" aria-label="${c}"></button>`).join('')}
            </div>
            <button type="button" class="bots-primary" data-act="save">保存并同步到桌面小组件</button>
          </div>
        </div>`;
      mask.querySelector('[data-act="cancel"]').onclick = () => { editing = null; draw(); };
      mask.querySelectorAll('[data-shape]').forEach(b => {
        b.onclick = () => {
          editing.name = mask.querySelector('#bot-f-name').value;
          editing.role = mask.querySelector('#bot-f-role').value;
          editing.rules = mask.querySelector('#bot-f-rules').value;
          editing.shape = b.dataset.shape;
          draw();
        };
      });
      mask.querySelectorAll('[data-accent]').forEach(b => {
        b.onclick = () => {
          editing.name = mask.querySelector('#bot-f-name').value;
          editing.role = mask.querySelector('#bot-f-role').value;
          editing.rules = mask.querySelector('#bot-f-rules').value;
          editing.accent = b.dataset.accent;
          draw();
        };
      });
      mask.querySelector('[data-act="save"]').onclick = () => {
        const name = mask.querySelector('#bot-f-name').value.trim();
        const role = mask.querySelector('#bot-f-role').value.trim() || '自定义专属 Bot';
        const rules = mask.querySelector('#bot-f-rules').value.trim();
        if (!name) return;
        const nextList = listBots();
        if (editing.isNew) {
          const item = { id: `bot-${Date.now().toString(36)}`, name, role, rules, shape: editing.shape, accent: editing.accent };
          nextList.push(item);
          saveBots(nextList);
          setActiveBot(item.id);
          onStatus?.(`已创建「${name}」并同步到桌面小组件`);
        } else {
          const idx = nextList.findIndex(x => x.id === editing.id);
          if (idx >= 0) nextList[idx] = { ...nextList[idx], name, role, rules, shape: editing.shape, accent: editing.accent };
          saveBots(nextList);
          onStatus?.(`已更新「${name}」规则`);
        }
        editing = null;
        draw();
      };
      return;
    }

    mask.innerHTML = `
      <div class="bots-sheet" role="dialog" aria-label="Zone Bot 工坊">
        <div class="bots-head">
          <div>
            <h3>Zone Bot 工坊</h3>
            <p>手机桌面添加 1 块「Zone 桌面总管」小组件即可直接切换全部 Bot</p>
          </div>
          <button type="button" class="bots-close" data-act="close">完成</button>
        </div>
        <div class="bots-list">
          ${list.map(b => `
            <div class="bot-row ${b.id === active.id ? 'active' : ''}" data-pick="${esc(b.id)}">
              <div class="bot-avatar">${renderBotSvg(b.shape, b.accent)}</div>
              <div class="bot-meta">
                <strong>${esc(b.name)}${b.id === active.id ? ' · 当前' : ''}</strong>
                <span>${esc(b.role)}</span>
              </div>
              <button type="button" class="bot-edit" data-edit="${esc(b.id)}">规则</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="bots-primary" data-act="new">+ 新建专属 Bot</button>
      </div>`;

    mask.querySelector('[data-act="close"]').onclick = () => mask.classList.add('hidden');
    mask.onclick = e => { if (e.target === mask) mask.classList.add('hidden'); };
    mask.querySelector('[data-act="new"]').onclick = () => {
      editing = { isNew: true, name: '', role: '', rules: '', shape: 'orb', accent: '#007AFF' };
      draw();
    };
    mask.querySelectorAll('[data-pick]').forEach(row => {
      row.onclick = e => {
        if (e.target.closest('[data-edit]')) return;
        const b = setActiveBot(row.dataset.pick);
        onSelect?.(b);
        onStatus?.(`已切换为「${b.name}」`);
        draw();
      };
    });
    mask.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => {
        const hit = listBots().find(x => x.id === btn.dataset.edit);
        if (hit) { editing = { ...hit, isNew: false }; draw(); }
      };
    });
  };

  draw();
  mask.classList.remove('hidden');
}

export function closeBotStudio() {
  const mask = document.getElementById('zone-bots-mask');
  if (!mask || mask.classList.contains('hidden')) return false;
  mask.classList.add('hidden');
  return true;
}
