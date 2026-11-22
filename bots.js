// Zone Mobile Agent OS 核心工坊：
// 1) 12 款雕塑级极简有机盲盒形态（纯色实体 + 灵动眨眼双白瞳，无多余线条边框）+ 11 款精选配色 + 100% 用户自定义规则
// 2) 定时任务 Automations（自由定制周期采集、分析与推送）
// 3) 开放插件与主题（Phone-Use 手机操控 / 外部 MCP & DeepSeek 互通 / 主题插件）

const BOTS_KEY = 'zone-bots-v3';
const GROUPS_KEY = 'zone-groups-v1';
const ACTIVE_KEY = 'zone-active-bot-id';
const PRIMARY_KEY = 'zone-primary-bot-id';
const PLUGINS_KEY = 'zone-skill-plugins-v4';
const AUTO_KEY = 'zone-automations-v2';
const THEME_PLUG_KEY = 'zone-theme-plugin-v1';

const DEFAULT_BOTS = [
  {
    id: 'zone-chief',
    name: 'Zone',
    role: '轻触形象切换样式、写规则、管定时任务与插件',
    rules: '',
    shape: 'onigiri',
    accent: '#111111',
    plugins: ['mcp-bridge']
  }
];

const DEFAULT_AUTOMATIONS = [
  {
    id: 'auto-sichao',
    name: '新闻推送',
    schedule: '每天 08:30 · 云端自动运行',
    prompt: '抓取全球 AI 与科技一手动态，去重核验事实，生成独立判断信号卡片',
    builtinAction: 'sichao',
    enabled: true
  }
];

const DEFAULT_PLUGINS = [
  { id: 'reading-cosmos', name: '阅读器', short: '阅读器', desc: '卡片堆 · 沉浸阅读 · 星海', enabled: true, launchable: true },
  { id: 'phone-use', name: '手机控屏', short: '手机控屏', desc: '跨应用执行与敏感确认', enabled: true, launchable: true },
  { id: 'computer-use', name: '连接电脑', short: '连接电脑', desc: '遥控本地桌面与工作节点', enabled: true, launchable: true },
  { id: 'mcp-bridge', name: '联网与 MCP', short: '联网与 MCP', desc: '实时检索与远程技能调用', enabled: true, launchable: false },
  { id: 'sichao', name: '思潮', short: '思潮', desc: 'AI 与科技前沿信号卡', enabled: true, launchable: true }
];

const THEME_PLUGINS = [
  { id: 'apple-light', name: 'Apple 瓷白', bg: '#f5f5f7', accent: '#007aff', css: '' },
  { id: 'warm-linen', name: '暖白亚麻', bg: '#f7f4ee', accent: '#9a5b2f', css: ':root{--app-bg:#f7f4ee;--app-elev:#fffdf9;--app-accent:#9a5b2f}' },
  { id: 'mist-sage', name: '雾绿工作室', bg: '#eef3ef', accent: '#2e7d52', css: ':root{--app-bg:#eef3ef;--app-elev:#f9fcf9;--app-accent:#2e7d52}' },
  { id: 'slate-pro', name: '钛灰专业', bg: '#eef1f6', accent: '#3b5bdb', css: ':root{--app-bg:#eef1f6;--app-elev:#ffffff;--app-accent:#3b5bdb}' }
];

// 12 款雕塑级极简有机轮廓（纯实体剪影 + 俏皮倾斜双白瞳）
const SHAPES = [
  { id: 'orb', label: '团子', eyeDx: 5, eyeDy: -6, tilt: -14, path: 'M50 12 A38 38 0 1 0 50 88 A38 38 0 1 0 50 12 Z' },
  { id: 'cloud', label: '云朵', eyeDx: 5, eyeDy: -2, tilt: -8, path: 'M29 74 C16 74 10 64 13 52 C15 44 21 39 27 38 C29 24 42 18 54 22 C63 25 69 32 71 39 C82 40 89 50 86 61 C84 69 76 74 67 74 Z' },
  { id: 'cube', label: '方糖', eyeDx: 3, eyeDy: -1, tilt: -18, path: 'M26 16 H74 A12 12 0 0 1 86 28 V72 A12 12 0 0 1 74 84 H26 A12 12 0 0 1 14 72 V28 A12 12 0 0 1 26 16 Z' },
  { id: 'star', label: '星芒', eyeDx: 4, eyeDy: -1, tilt: -6, path: 'M50 8 C58 8 60 28 69 35 C78 42 92 42 92 50 C92 58 78 58 69 65 C60 72 58 92 50 92 C42 92 40 72 31 65 C22 58 8 58 8 50 C8 42 22 42 31 35 C40 28 42 8 50 8 Z' },
  { id: 'clover', label: '四叶', eyeDx: 3, eyeDy: -1, tilt: -10, path: 'M50 24 C56 12 76 14 78 30 C90 36 88 58 74 64 C74 80 54 88 44 76 C30 86 14 72 20 56 C10 46 16 26 32 24 C36 14 46 16 50 24 Z' },
  { id: 'heart', label: '团心', eyeDx: 4, eyeDy: -4, tilt: -12, path: 'M50 84 C44 84 14 64 14 40 C14 23 28 14 42 22 C46 24 48 27 50 30 C52 27 54 24 58 22 C72 14 86 23 86 40 C86 64 56 84 50 84 Z' },
  { id: 'bloom', label: '绒花', eyeDx: 4, eyeDy: -2, tilt: -8, path: 'M50 11 C60 11 63 19 71 21 C80 23 86 31 84 40 C89 48 86 60 78 66 C76 76 66 84 56 82 C48 89 35 86 30 78 C20 76 13 66 16 56 C10 48 13 35 22 30 C24 20 34 13 43 16 C45 12 48 11 50 11 Z' },
  { id: 'drop', label: '水滴', eyeDx: 5, eyeDy: 5, tilt: -12, path: 'M50 10 C57 10 83 41 83 59 C83 77 68 89 50 89 C32 89 17 77 17 59 C17 41 43 10 50 10 Z' },
  { id: 'bean', label: '软豆', eyeDx: 5, eyeDy: -4, tilt: -16, path: 'M24 27 H76 A23 23 0 0 1 76 73 H24 A23 23 0 0 1 24 27 Z' },
  { id: 'onigiri', label: '饭团', eyeDx: 0, eyeDy: 6, tilt: 0, path: 'M42 16 C46 9 54 9 58 16 L86 67 C91 76 85 86 75 86 H25 C15 86 9 76 14 67 Z' },
  { id: 'house', label: '小屋', eyeDx: 3, eyeDy: 3, tilt: -10, path: 'M43 14 C47 10 53 10 57 14 L82 36 C86 40 87 45 86 50 L80 76 C78 82 73 86 67 86 H33 C27 86 22 82 20 76 L14 50 C13 45 14 40 18 36 Z' },
  { id: 'splash', label: '海星', eyeDx: 3, eyeDy: 0, tilt: -8, path: 'M49 10 C57 10 58 24 66 26 C74 28 84 20 89 27 C93 34 81 44 83 52 C85 60 95 66 90 74 C85 82 72 75 65 79 C58 83 56 93 48 92 C40 91 40 79 32 76 C24 73 14 80 10 72 C6 64 18 57 17 49 C16 41 6 35 12 27 C18 19 29 27 36 23 C43 19 41 10 49 10 Z' },
  { id: 'hex', label: '六角', eyeDx: 3, eyeDy: -1, tilt: -12, path: 'M44 13 C48 10.5 52 10.5 56 13 L81 27.5 C85 30 87 34 87 38.5 V61.5 C87 66 85 70 81 72.5 L56 87 C52 89.5 48 89.5 44 87 L19 72.5 C15 70 13 66 13 61.5 V38.5 C13 34 15 30 19 27.5 Z' }
];

const ACCENTS = [
  '#111111', '#9A6332', '#FF2D46', '#FF6B00', '#F59E0B', '#10B981',
  '#14B8A6', '#007AFF', '#7C5CFF', '#FF2D87', '#8E8E93'
];

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

export function updateBotNotify(botId, enabled) {
  const list = listBots();
  const idx = list.findIndex(b => b.id === botId);
  if (idx < 0) return true;
  list[idx] = { ...list[idx], notify: !!enabled };
  saveBots(list);
  return !!enabled;
}

export function deleteBotById(botId) {
  const list = listBots();
  if (list.length <= 1) return false;
  const next = list.filter(b => b.id !== botId);
  saveBots(next);
  try {
    const d = JSON.parse(localStorage.getItem('zone-sync-deleted-v1') || '{}');
    const arr = Array.isArray(d.bots) ? d.bots : [];
    if (!arr.includes(botId)) arr.push(String(botId));
    d.bots = arr.slice(-80);
    localStorage.setItem('zone-sync-deleted-v1', JSON.stringify(d));
  } catch {}
  if (getActiveBot().id === botId) setActiveBot(next[0].id);
  return true;
}

export function listGroups() {
  try {
    const saved = JSON.parse(localStorage.getItem(GROUPS_KEY) || 'null');
    if (Array.isArray(saved)) return saved;
  } catch {}
  return [];
}

function saveGroups(list) {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(list)); } catch {}
}

export function createGroup({ name = '', memberIds = [] } = {}) {
  const bots = listBots();
  const cleanIds = Array.from(new Set(memberIds)).filter(id => bots.some(b => b.id === id));
  if (!cleanIds.length && bots.length) cleanIds.push(bots[0].id);
  const autoName = cleanIds.map(id => bots.find(b => b.id === id)?.name).filter(Boolean).slice(0, 3).join('、') || 'Bot 群聊';
  const group = {
    id: `grp-${Date.now().toString(36)}`,
    name: String(name || '').trim() || autoName,
    memberIds: cleanIds,
    createdAt: Date.now()
  };
  const next = [group, ...listGroups()];
  saveGroups(next);
  return group;
}

export function updateGroup(id, patch = {}) {
  const list = listGroups();
  const idx = list.findIndex(g => g.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  saveGroups(list);
  return list[idx];
}

export function deleteGroup(id) {
  const next = listGroups().filter(g => g.id !== id);
  saveGroups(next);
  return next;
}

export function renderGroupAvatarHtml(memberIds = []) {
  const bots = listBots();
  const members = (memberIds || []).map(id => bots.find(b => b.id === id)).filter(Boolean).slice(0, 4);
  if (!members.length && bots[0]) members.push(bots[0]);
  return `<div class="grp-av-grid grp-av-n${Math.min(4, members.length)}">${members.map(b => renderBotSvg(b.shape, b.accent, b.id)).join('')}</div>`;
}

export function listAutomations() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTO_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return DEFAULT_AUTOMATIONS.map(a => ({ ...a }));
}

function saveAutomations(list) {
  try { localStorage.setItem(AUTO_KEY, JSON.stringify(list)); } catch {}
}

export function listPlugins() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLUGINS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      const merged = saved.map(p => {
        const def = DEFAULT_PLUGINS.find(d => d.id === p.id);
        return def ? { ...p, ...def, enabled: p.enabled !== undefined ? !!p.enabled : def.enabled } : p;
      });
      for (const def of DEFAULT_PLUGINS) {
        if (!merged.some(p => p.id === def.id)) merged.push({ ...def });
      }
      return merged;
    }
  } catch {}
  return DEFAULT_PLUGINS.map(p => ({ ...p }));
}

export function savePlugins(list) {
  try { localStorage.setItem(PLUGINS_KEY, JSON.stringify(list)); } catch {}
}

export function isPluginEnabled(id) {
  const hit = listPlugins().find(p => p.id === id);
  return hit ? !!hit.enabled : true;
}

export function getBotPlugins(botId) {
  const bot = listBots().find(b => b.id === botId);
  const raw = Array.isArray(bot?.plugins) ? bot.plugins : ['mcp-bridge'];
  return raw.filter(pid => isPluginEnabled(pid));
}

export function isPluginMountedOnBot(botId, pluginId) {
  return isPluginEnabled(pluginId) && getBotPlugins(botId).includes(pluginId);
}

export function toggleBotPlugin(botId, pluginId, forceVal) {
  const list = listBots();
  const idx = list.findIndex(b => b.id === botId);
  if (idx < 0) return false;
  const cur = Array.isArray(list[idx].plugins) ? [...list[idx].plugins] : ['mcp-bridge'];
  const exists = cur.includes(pluginId);
  const nextOn = typeof forceVal === 'boolean' ? forceVal : !exists;
  const nextIds = nextOn ? (exists ? cur : [...cur, pluginId]) : cur.filter(x => x !== pluginId);
  list[idx] = { ...list[idx], plugins: nextIds };
  saveBots(list);
  return nextOn;
}

export function setBotPlugins(botId, pluginIds) {
  const list = listBots();
  const idx = list.findIndex(b => b.id === botId);
  if (idx < 0) return [];
  const nextIds = Array.from(new Set(Array.isArray(pluginIds) ? pluginIds : []));
  list[idx] = { ...list[idx], plugins: nextIds };
  saveBots(list);
  return nextIds;
}

export function getActiveThemePlugin() {
  try { return localStorage.getItem(THEME_PLUG_KEY) || 'apple-light'; } catch { return 'apple-light'; }
}

export function applyThemePlugin(id) {
  const hit = THEME_PLUGINS.find(t => t.id === id) || THEME_PLUGINS[0];
  try { localStorage.setItem(THEME_PLUG_KEY, hit.id); } catch {}
  let tag = document.getElementById('zone-theme-plugin-style');
  if (!hit.css) { tag?.remove(); return hit; }
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'zone-theme-plugin-style';
    document.head.appendChild(tag);
  }
  tag.textContent = hit.css;
  return hit;
}

export function getPrimaryBot() {
  const list = listBots();
  const id = (() => { try { return localStorage.getItem(PRIMARY_KEY) || ''; } catch { return ''; } })();
  return list.find(b => b.id === id) || list[0];
}

export function setPrimaryBot(id) {
  const list = listBots();
  const bot = list.find(b => b.id === id) || list[0];
  try { localStorage.setItem(PRIMARY_KEY, bot.id); } catch {}
  return bot;
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

function animTimingFor(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const floatDur = (4.4 + ((h % 25) / 10)).toFixed(2);       // 4.40s ~ 6.80s
  const floatDel = (((h >>> 5) % 58) / 10).toFixed(2);        // 0.00s ~ 5.70s
  const eyeDur = (4.6 + (((h >>> 11) % 34) / 10)).toFixed(2); // 4.60s ~ 7.90s
  const eyeDel = (((h >>> 17) % 66) / 10).toFixed(2);         // 0.00s ~ 6.50s
  return `--float-dur:${floatDur}s;--float-del:-${floatDel}s;--eye-dur:${eyeDur}s;--eye-del:-${eyeDel}s`;
}

const COALESCE_DROPS = [
  { sx: '24px', sy: '-22px', r: 7.4, del: '0s' },
  { sx: '18px', sy: '34px', r: 5.2, del: '.04s' },
  { sx: '-30px', sy: '-14px', r: 6.8, del: '.02s' },
  { sx: '-24px', sy: '26px', r: 5.8, del: '.06s' },
  { sx: '34px', sy: '6px', r: 4.8, del: '.08s' }
];

export function renderBotSvg(shape = 'onigiri', accent = '#111111', seed = '', opts = {}) {
  const spec = SHAPES.find(s => s.id === shape) || SHAPES.find(s => s.id === 'onigiri');
  const color = accent || '#111111';
  const ex1 = 41 + (spec.eyeDx || 0);
  const ex2 = 57 + (spec.eyeDx || 0);
  const ey = 43 + (spec.eyeDy || 0);
  const lx1 = (ex1 - 2.4).toFixed(1), lx2 = (ex1 + 9.6).toFixed(1), lcx = (ex1 + 3.6).toFixed(1);
  const rx1 = (ex2 - 2.4).toFixed(1), rx2 = (ex2 + 9.6).toFixed(1), rcx = (ex2 + 3.6).toFixed(1);
  const ly = (ey + 11.2).toFixed(1), lcy = (ey + 2.2).toFixed(1);
  const rot = spec.tilt || 0;
  const timing = animTimingFor(`${seed || ''}:${spec.id}:${color}`);
  const cls = ['bot-glyph', opts.coalesce ? 'bot-coalescing' : '', opts.static ? 'no-life' : ''].filter(Boolean).join(' ');
  const dropsMarkup = opts.coalesce ? `
    <g class="bot-coalesce" filter="url(#zone-gooey)">
      <circle class="bot-core-drop" cx="50" cy="50" r="14" fill="${color}" stroke="none"/>
      ${COALESCE_DROPS.map(d => `<circle class="bot-drop" cx="50" cy="50" r="${d.r}" fill="${color}" stroke="none" style="--sx:${d.sx};--sy:${d.sy};--dd:${d.del}"/>`).join('')}
    </g>` : '';
  return `<svg class="${cls}" style="${timing}" viewBox="0 0 100 100" aria-hidden="true">
    ${dropsMarkup}
    <g class="bot-body">
      <g transform="rotate(${rot} 50 50)">
        <path class="bot-main-shape" d="${spec.path}" fill="${color}" stroke="none"/>
        <g class="bot-eyes">
          <g class="bot-eyes-norm">
            <rect class="bot-eye bot-eye-l" x="${ex1}" y="${ey}" width="7.2" height="17" rx="3.6" fill="#FFFFFF" stroke="none"/>
            <rect class="bot-eye bot-eye-r" x="${ex2}" y="${ey}" width="7.2" height="17" rx="3.6" fill="#FFFFFF" stroke="none"/>
          </g>
          <g class="bot-eyes-laugh">
            <path d="M${lx1} ${ly} Q${lcx} ${lcy} ${lx2} ${ly}" fill="none" stroke="#FFFFFF" stroke-width="4.4" stroke-linecap="round"/>
            <path d="M${rx1} ${ly} Q${rcx} ${lcy} ${rx2} ${ly}" fill="none" stroke="#FFFFFF" stroke-width="4.4" stroke-linecap="round"/>
          </g>
        </g>
      </g>
    </g>
  </svg>`;
}

const MOOD_LIST = ['laugh', 'hop', 'wink', 'curious', 'wiggle'];
const MOOD_DURS = { laugh: 1350, hop: 1050, wink: 980, curious: 1450, wiggle: 1120 };
let lifeTimer = null;

export function triggerBotMood(svgEl, mood = '') {
  if (!svgEl || svgEl.classList.contains('no-life') || svgEl.classList.contains('bot-coalescing')) return;
  const pick = mood || MOOD_LIST[Math.floor(Math.random() * MOOD_LIST.length)];
  for (const m of MOOD_LIST) svgEl.classList.remove('mood-' + m);
  void svgEl.getBoundingClientRect();
  svgEl.classList.add('mood-' + pick);
  svgEl.dataset.lastMood = pick;
  clearTimeout(svgEl._moodTimer);
  svgEl._moodTimer = setTimeout(() => {
    svgEl.classList.remove('mood-' + pick);
  }, MOOD_DURS[pick] || 1200);
}

export function startBotLifeEngine() {
  if (lifeTimer) return;
  const tick = () => {
    if (document.hidden) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const now = Date.now();
    const glyphs = document.querySelectorAll('.bot-glyph:not(.no-life):not(.bot-coalescing)');
    for (const el of glyphs) {
      if (el.closest('.hidden') || el.closest('.bots-shape-btn') || el.closest('.grp-av-grid')) continue;
      let due = Number(el.dataset.nextMood || 0);
      if (!due) {
        // 每个 Bot 首次触发时间完全随机散开（1.6s ~ 5.8s），绝不同步
        el.dataset.nextMood = String(now + 1600 + Math.floor(Math.random() * 4200));
        continue;
      }
      if (now >= due) {
        const last = el.dataset.lastMood || '';
        const pool = MOOD_LIST.filter(m => m !== last);
        const nextMood = pool[Math.floor(Math.random() * pool.length)] || 'laugh';
        triggerBotMood(el, nextMood);
        // 下一次表现同样独立随机（3.2s ~ 8.4s），绝不齐舞
        el.dataset.nextMood = String(now + (MOOD_DURS[nextMood] || 1200) + 3200 + Math.floor(Math.random() * 5200));
      }
    }
  };
  lifeTimer = setInterval(tick, 450);
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function openBotStudio({ onSelect, onSelectGroup, onStatus, onLaunchPlugin, onRunAutomation, onInspectPlugin, initialTab = 'bots', startNew = false, startNewGroup = false, editBotId = '', editGroupId = '' } = {}) {
  let mask = document.getElementById('zone-bots-mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'zone-bots-mask';
    mask.className = 'bots-mask hidden';
    document.body.appendChild(mask);
  }
  let tab = initialTab;
  let editing = startNew
    ? { isNew: true, name: '', role: '', rules: '', shape: 'onigiri', accent: '#9A6332', plugins: ['mcp-bridge'] }
    : (editBotId ? (() => { const h = listBots().find(x => x.id === editBotId); return h ? { ...h, plugins: Array.isArray(h.plugins) ? [...h.plugins] : ['mcp-bridge'], isNew: false } : null; })() : null);
  let editingGroup = startNewGroup
    ? { isNew: true, name: '', memberIds: listBots().slice(0, 3).map(b => b.id) }
    : (editGroupId ? (() => { const g = listGroups().find(x => x.id === editGroupId); return g ? { ...g, memberIds: [...(g.memberIds || [])], isNew: false } : null; })() : null);
  let addingAuto = false;
  let addingPlugin = false;

  const draw = () => {
    const list = listBots();
    const active = getActiveBot();
    const autos = listAutomations();
    const plugins = listPlugins();
    const curTheme = getActiveThemePlugin();

    if (editingGroup) {
      mask.innerHTML = `
        <div class="bots-sheet" role="dialog" aria-label="${editingGroup.isNew ? '创建 Bot 群聊' : '管理群聊'}">
          <div class="bots-head">
            <h3>${editingGroup.isNew ? '创建群聊' : '群聊管理'}</h3>
            <button type="button" class="bots-close" data-act="cancel-grp">返回</button>
          </div>
          ${editingGroup.isNew ? `
            <div class="bots-seg" role="tablist">
              <button type="button" role="tab" data-new-kind="bot">新建 Bot</button>
              <button type="button" role="tab" class="on" data-new-kind="group">创建群聊</button>
            </div>
          ` : ''}
          <div class="bots-form">
            <input id="grp-f-name" class="bot-name-inp" type="text" placeholder="群聊名称（留空自动按成员命名）" value="${esc(editingGroup.name)}">
            <div class="bots-list">
              ${list.map(b => {
                const picked = editingGroup.memberIds.includes(b.id);
                return `
                  <button type="button" class="bot-row ${picked ? 'active' : ''}" data-grp-mem="${esc(b.id)}">
                    <div class="bot-avatar">${renderBotSvg(b.shape, b.accent)}</div>
                    <div class="bot-meta">
                      <strong>${esc(b.name)}</strong>
                      <span>${esc(b.rules ? b.rules.slice(0, 28) : '可加入群聊协作')}</span>
                    </div>
                    <span class="grp-check ${picked ? 'on' : ''}">${picked ? '✓' : ''}</span>
                  </button>`;
              }).join('')}
            </div>
            ${list.length < 2 ? '<p class="sc-empty" style="padding:2px 0">提示：可先多建几个不同分工的 Bot，再拉入群聊一起协同。</p>' : ''}
            <button type="button" class="bots-primary" data-act="save-grp">${editingGroup.isNew ? `创建群聊（已选 ${editingGroup.memberIds.length} 个 Bot）` : '保存群聊'}</button>
            ${!editingGroup.isNew ? '<button type="button" class="bots-danger" data-act="del-grp">解散此群聊</button>' : ''}
          </div>
        </div>`;
      mask.onclick = e => { if (e.target === mask) mask.classList.add('hidden'); };
      mask.querySelector('[data-act="cancel-grp"]').onclick = () => {
        if (startNew || startNewGroup || editGroupId) { mask.classList.add('hidden'); return; }
        editingGroup = null; draw();
      };
      const swBot = mask.querySelector('[data-new-kind="bot"]');
      if (swBot) swBot.onclick = () => {
        editingGroup = null;
        editing = { isNew: true, name: '', role: '', rules: '', shape: 'onigiri', accent: '#9A6332', plugins: ['mcp-bridge'] };
        draw();
      };
      mask.querySelectorAll('[data-grp-mem]').forEach(btn => {
        btn.onclick = () => {
          editingGroup.name = mask.querySelector('#grp-f-name').value;
          const id = btn.dataset.grpMem;
          if (editingGroup.memberIds.includes(id)) {
            if (editingGroup.memberIds.length > 1) editingGroup.memberIds = editingGroup.memberIds.filter(x => x !== id);
          } else {
            editingGroup.memberIds.push(id);
          }
          draw();
        };
      });
      mask.querySelector('[data-act="save-grp"]').onclick = () => {
        const name = mask.querySelector('#grp-f-name').value.trim();
        if (!editingGroup.memberIds.length) return;
        if (editingGroup.isNew) {
          const grp = createGroup({ name, memberIds: editingGroup.memberIds });
          editingGroup = null;
          mask.classList.add('hidden');
          onSelectGroup?.(grp);
          onStatus?.(`已创建群聊「${grp.name}」`);
          return;
        }
        const grp = updateGroup(editingGroup.id, { name: name || editingGroup.name, memberIds: editingGroup.memberIds });
        editingGroup = null;
        mask.classList.add('hidden');
        if (grp) onSelectGroup?.(grp);
        onStatus?.('已保存群聊成员与名称');
      };
      const delGrp = mask.querySelector('[data-act="del-grp"]');
      if (delGrp) delGrp.onclick = () => {
        deleteGroup(editingGroup.id);
        editingGroup = null;
        mask.classList.add('hidden');
        onStatus?.('已解散群聊');
      };
      return;
    }

    if (editing) {
      const showRules = !!(editing.showRules || editing.rules);
      const hasName = !!String(editing.name || '').trim();
      mask.innerHTML = `
        <div class="bots-sheet create-bot-full" role="dialog" aria-label="${editing.isNew ? '新建 Bot' : '编辑 Bot'}">
          <div class="cb-head">
            <div class="cb-head-l">
              <button type="button" class="cb-close-btn" data-act="cancel" aria-label="关闭">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>
              </button>
              <h3>${editing.isNew ? '新建 Bot' : '编辑 Bot'}</h3>
            </div>
            ${editing.isNew ? `<button type="button" class="cb-grp-btn" data-new-kind="group">创建群聊</button>` : ''}
          </div>
          <div class="bots-preview cb-preview ${editing.isNew || editing.justPicked ? 'bot-born' : ''}">${renderBotSvg(editing.shape, editing.accent, editing.id || ('prev-' + editing.shape), { coalesce: !!(editing.isNew || editing.justPicked) })}</div>
          <div class="cb-body">
            <input id="bot-f-name" class="cb-name-inp" type="text" placeholder="给你的 Bot 起个名字" value="${esc(editing.name)}">
            <div class="cb-shape-grid">
              ${SHAPES.map(s => `<button type="button" class="cb-shape-btn ${editing.shape === s.id ? 'on' : ''}" data-shape="${s.id}" title="${s.label}">${renderBotSvg(s.id, editing.accent, s.id, { static: true })}</button>`).join('')}
            </div>
            <div class="cb-color-grid">
              ${ACCENTS.map(c => `<button type="button" class="cb-dot ${editing.accent === c ? 'on' : ''}" style="background:${c}" data-accent="${c}" aria-label="${c}"></button>`).join('')}
            </div>
            ${showRules
              ? `<textarea id="bot-f-rules" class="cb-rules-inp" rows="3" placeholder="定义它的规则、风格或边界（留空则无预设限制）">${esc(editing.rules)}</textarea>`
              : `<button type="button" class="cb-rules-toggle" data-act="show-rules">+ 添加规则与人格（可选）</button>`}
          </div>
          <div class="cb-foot">
            <button type="button" id="bot-f-submit" class="cb-submit ${hasName ? 'ready' : ''}" data-act="save">${editing.isNew ? '创建' : '保存'}</button>
            ${!editing.isNew && editing.id !== getPrimaryBot().id ? `<button type="button" class="bots-secondary" data-act="pin-primary">设为顶部固定主位 ★</button>` : ''}
            ${!editing.isNew && list.length > 1 ? `<button type="button" class="bots-danger" data-act="del">删除此 Bot</button>` : ''}
          </div>
        </div>`;
      mask.onclick = e => { if (e.target === mask) mask.classList.add('hidden'); };
      const nameInp = mask.querySelector('#bot-f-name');
      const submitBtn = mask.querySelector('#bot-f-submit');
      if (nameInp && submitBtn) {
        nameInp.oninput = () => submitBtn.classList.toggle('ready', !!nameInp.value.trim());
      }
      const prevEl = mask.querySelector('.bots-preview');
      if (prevEl) {
        prevEl.onclick = () => {
          const svg = prevEl.querySelector('.bot-glyph');
          if (svg) {
            svg.classList.remove('bot-coalescing');
            triggerBotMood(svg, Math.random() < 0.55 ? 'laugh' : 'hop');
          }
        };
        setTimeout(() => {
          const svg = prevEl.querySelector('.bot-glyph');
          if (svg) svg.classList.remove('bot-coalescing');
        }, 1180);
      }
      mask.querySelector('[data-act="cancel"]').onclick = () => {
        if (startNew || editBotId) { mask.classList.add('hidden'); return; }
        editing = null; draw();
      };
      const showRulesBtn = mask.querySelector('[data-act="show-rules"]');
      if (showRulesBtn) showRulesBtn.onclick = () => {
        editing.name = mask.querySelector('#bot-f-name')?.value || '';
        editing.showRules = true;
        editing.justPicked = false;
        draw();
      };
      const swGrp = mask.querySelector('[data-new-kind="group"]');
      if (swGrp) swGrp.onclick = () => {
        editing = null;
        editingGroup = { isNew: true, name: '', memberIds: list.slice(0, 3).map(b => b.id) };
        draw();
      };
      const pinBtn = mask.querySelector('[data-act="pin-primary"]');
      if (pinBtn) pinBtn.onclick = () => {
        setPrimaryBot(editing.id);
        editing = null;
        mask.classList.add('hidden');
        onStatus?.('已将该 Bot 设为顶部固定主位');
      };
      const delBtn = mask.querySelector('[data-act="del"]');
      if (delBtn) delBtn.onclick = () => {
        const nextList = listBots().filter(x => x.id !== editing.id);
        if (!nextList.length) return;
        saveBots(nextList);
        if (getActiveBot().id === editing.id) setActiveBot(nextList[0].id);
        editing = null;
        onStatus?.('已删除该 Bot');
        draw();
      };
      mask.querySelectorAll('[data-shape]').forEach(b => {
        b.onclick = () => {
          editing.name = mask.querySelector('#bot-f-name')?.value || '';
          const rEl = mask.querySelector('#bot-f-rules');
          if (rEl) editing.rules = rEl.value;
          editing.shape = b.dataset.shape;
          editing.justPicked = true;
          draw();
        };
      });
      mask.querySelectorAll('[data-accent]').forEach(b => {
        b.onclick = () => {
          editing.name = mask.querySelector('#bot-f-name')?.value || '';
          const rEl = mask.querySelector('#bot-f-rules');
          if (rEl) editing.rules = rEl.value;
          editing.accent = b.dataset.accent;
          editing.justPicked = true;
          draw();
        };
      });
      mask.querySelector('[data-act="save"]').onclick = () => {
        const name = (mask.querySelector('#bot-f-name')?.value || '').trim();
        const rules = (mask.querySelector('#bot-f-rules')?.value ?? editing.rules ?? '').trim();
        if (!name) return;
        const role = rules ? rules.slice(0, 26) : '轻触形象切换样式、写规则、管定时任务与插件';
        const nextList = listBots();
        if (editing.isNew) {
          const item = { id: `bot-${Date.now().toString(36)}`, name, role, rules, shape: editing.shape, accent: editing.accent, plugins: Array.isArray(editing.plugins) ? [...editing.plugins] : ['mcp-bridge'], notify: true };
          nextList.push(item);
          saveBots(nextList);
          setActiveBot(item.id);
          editing = null;
          mask.classList.add('hidden');
          onSelect?.(item, { created: true });
          onStatus?.(`已创建「${name}」，可以直接开始对话`);
          return;
        } else {
          const idx = nextList.findIndex(x => x.id === editing.id);
          if (idx >= 0) nextList[idx] = { ...nextList[idx], name, role, rules, shape: editing.shape, accent: editing.accent };
          saveBots(nextList);
          onStatus?.(`已保存「${name}」`);
        }
        editing = null;
        mask.classList.add('hidden');
      };
      return;
    }

    if (addingAuto) {
      mask.innerHTML = `
        <div class="bots-sheet" role="dialog" aria-label="新建定时任务">
          <div class="bots-head">
            <h3>新建定时任务</h3>
            <button type="button" class="bots-close" data-act="cancel-auto">返回</button>
          </div>
          <div class="bots-form">
            <input id="auto-f-name" type="text" placeholder="任务名（如：盯 GitHub 新项目 / 行业早报）">
            <input id="auto-f-sched" type="text" placeholder="执行周期（如：每天 08:00 / 每周一 09:00）" value="每天 08:30">
            <textarea id="auto-f-prompt" rows="4" placeholder="由你定义每次定时触发要抓取、分析并推送什么内容"></textarea>
            <button type="button" class="bots-primary" data-act="save-auto">创建并启用定时任务</button>
          </div>
        </div>`;
      mask.querySelector('[data-act="cancel-auto"]').onclick = () => { addingAuto = false; draw(); };
      mask.querySelector('[data-act="save-auto"]').onclick = () => {
        const name = mask.querySelector('#auto-f-name').value.trim();
        const schedule = mask.querySelector('#auto-f-sched').value.trim() || '每天 08:30';
        const prompt = mask.querySelector('#auto-f-prompt').value.trim();
        if (!name || !prompt) return;
        const next = listAutomations();
        next.push({ id: `auto-${Date.now().toString(36)}`, name, schedule, prompt, enabled: true });
        saveAutomations(next);
        addingAuto = false;
        onStatus?.(`已创建定时任务「${name}」`);
        draw();
      };
      return;
    }

    if (addingPlugin) {
      mask.innerHTML = `
        <div class="bots-sheet" role="dialog" aria-label="安装远程 MCP / Skill 插件">
          <div class="bots-head">
            <div>
              <h3>安装远程 MCP / Skill</h3>
              <p>实测连通远程 Streamable HTTP MCP（自动发现 tools/list 并真实调用）或公开 SKILL.md；本地电脑 stdio MCP 请用「Computer-Use」桥接。</p>
            </div>
            <button type="button" class="bots-close" data-act="cancel-plug">返回</button>
          </div>
          <div class="bots-form">
            <input id="plug-f-url" type="url" placeholder="必填：远程 MCP 地址 (https://.../mcp) 或 SKILL.md 链接">
            <input id="plug-f-token" type="password" placeholder="可选：Bearer Token / API Key（无需鉴权可留空）">
            <input id="plug-f-name" type="text" placeholder="可选：自定义插件名（留空自动读取远端名称）">
            <p id="plug-f-err" class="sc-empty hidden" style="padding:6px 2px;color:var(--app-danger);text-align:left"></p>
            <button type="button" class="bots-primary" data-act="save-plug">实测连通并安装</button>
          </div>
        </div>`;
      mask.querySelector('[data-act="cancel-plug"]').onclick = () => { addingPlugin = false; draw(); };
      mask.querySelector('[data-act="save-plug"]').onclick = async () => {
        const btn = mask.querySelector('[data-act="save-plug"]');
        const errEl = mask.querySelector('#plug-f-err');
        const url = mask.querySelector('#plug-f-url').value.trim();
        const token = mask.querySelector('#plug-f-token').value.trim();
        const customName = mask.querySelector('#plug-f-name').value.trim();
        if (!/^https?:\/\//i.test(url)) {
          errEl.textContent = '请输入以 http:// 或 https:// 开头的远程 MCP 或 SKILL.md 链接';
          errEl.classList.remove('hidden');
          return;
        }
        errEl.classList.add('hidden');
        btn.disabled = true;
        btn.textContent = '正在实测连通并探测工具…';
        try {
          const res = await onInspectPlugin?.({ url, token });
          if (!res?.ok) {
            errEl.textContent = res?.error || '远端探测失败，请检查地址或 Token 是否可用';
            errEl.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = '实测连通并安装';
            return;
          }
          const finalName = customName || res.name || '外部 MCP';
          const pid = `ext-${Date.now().toString(36)}`;
          const toolNames = (res.tools || []).map(t => t.name).slice(0, 4).join(' / ');
          const desc = res.protocol === 'mcp'
            ? `已实测连通远程 MCP · ${(res.tools || []).length} 个工具${toolNames ? `（${toolNames}）` : ''}`
            : (res.summary || '已实测拉取 SKILL.md 技能规范');
          const next = listPlugins();
          next.push({
            id: pid,
            name: finalName,
            short: finalName.slice(0, 10),
            desc,
            url,
            token,
            protocol: res.protocol,
            tools: res.tools || [],
            instructions: res.instructions || '',
            verified: true,
            enabled: true,
            launchable: false
          });
          savePlugins(next);
          toggleBotPlugin(getActiveBot().id, pid, true);
          addingPlugin = false;
          onStatus?.(`已实测安装「${finalName}」并挂载到「${getActiveBot().name}」`);
          draw();
        } catch (err) {
          errEl.textContent = err?.message || '探测异常，请稍后重试';
          errEl.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = '实测连通并安装';
        }
      };
      return;
    }

    const subtitle = tab === 'bots'
      ? '选择或定制你的专属 Bot'
      : tab === 'automations'
        ? '周期采集与自动推送'
        : '全局插件开关与外观主题（在各 Bot 资料页按需挂载）';

    mask.innerHTML = `
      <div class="bots-sheet" role="dialog" aria-label="Zone 控制台">
        <div class="bots-head">
          <div>
            <h3>Zone</h3>
            <p>${subtitle}</p>
          </div>
          <button type="button" class="bots-close" data-act="close">完成</button>
        </div>
        <div class="bots-seg bots-seg-3" role="tablist">
          <button type="button" role="tab" class="${tab === 'bots' ? 'on' : ''}" data-tab="bots">Bot 形象</button>
          <button type="button" role="tab" class="${tab === 'automations' ? 'on' : ''}" data-tab="automations">定时任务</button>
          <button type="button" role="tab" class="${tab === 'plugins' ? 'on' : ''}" data-tab="plugins">插件主题</button>
        </div>
        ${tab === 'bots' ? `
          <div class="bots-list">
            ${list.map(b => `
              <div class="bot-row ${b.id === active.id ? 'active' : ''}" data-pick="${esc(b.id)}">
                <div class="bot-avatar">${renderBotSvg(b.shape, b.accent)}</div>
                <div class="bot-meta">
                  <strong>${esc(b.name)}${b.id === active.id ? ' · 当前' : ''}</strong>
                  <span>${esc(b.rules ? b.rules.slice(0, 32) : '未设固定规则 · 由你自由定义')}</span>
                </div>
                <button type="button" class="bot-edit" data-edit="${esc(b.id)}">定制</button>
              </div>
            `).join('')}
          </div>
          <button type="button" class="bots-primary" data-act="new">+ 新建专属 Bot</button>
        ` : tab === 'automations' ? `
          <div class="bots-list">
            ${autos.map(a => `
              <div class="plugin-row" data-run-auto="${esc(a.id)}">
                <div class="bot-meta">
                  <strong>${esc(a.name)}</strong>
                  <span>${esc(a.schedule)} · 点此立即运行</span>
                </div>
                <label class="ios-switch" aria-label="开关 ${esc(a.name)}">
                  <input type="checkbox" data-toggle-auto="${esc(a.id)}" ${a.enabled ? 'checked' : ''}>
                  <span></span>
                </label>
              </div>
            `).join('')}
          </div>
          <button type="button" class="bots-primary" data-act="add-auto">+ 新建定时任务 / 信息推送</button>
        ` : `
          <div class="bots-list">
            ${plugins.map(pl => `
              <div class="plugin-card">
                <div class="plugin-row" data-launch="${pl.launchable ? esc(pl.id) : ''}">
                  <div class="bot-meta">
                    <strong>${esc(pl.name)}</strong>
                    <span>${esc(pl.desc)}</span>
                  </div>
                  ${pl.id.startsWith('ext-') ? `<button type="button" class="plugin-bot-chip" style="color:var(--app-danger);margin-right:4px" data-remove-plug="${esc(pl.id)}">卸载</button>` : ''}
                  <label class="ios-switch" aria-label="开关 ${esc(pl.name)}">
                    <input type="checkbox" data-toggle="${esc(pl.id)}" ${pl.enabled ? 'checked' : ''}>
                    <span></span>
                  </label>
                </div>
              </div>`).join('')}
          </div>
          <div class="theme-plug-bar">
            <span class="theme-plug-lbl">主题插件</span>
            <div class="theme-plug-list">
              ${THEME_PLUGINS.map(t => `<button type="button" class="theme-plug-chip ${curTheme === t.id ? 'on' : ''}" data-theme-plug="${t.id}"><i style="background:${t.accent}"></i>${t.name}</button>`).join('')}
            </div>
          </div>
          <button type="button" class="bots-primary" data-act="add-plug">+ 安装远程 MCP / 技能</button>
        `}
      </div>`;

    mask.querySelector('[data-act="close"]').onclick = () => mask.classList.add('hidden');
    mask.onclick = e => { if (e.target === mask) mask.classList.add('hidden'); };
    mask.querySelectorAll('[data-tab]').forEach(t => {
      t.onclick = () => { tab = t.dataset.tab; draw(); };
    });

    if (tab === 'bots') {
      mask.querySelector('[data-act="new"]').onclick = () => {
        editing = { isNew: true, name: '', role: '', rules: '', shape: 'onigiri', accent: '#9A6332' };
        draw();
      };
      mask.querySelectorAll('[data-pick]').forEach(row => {
        row.onclick = e => {
          if (e.target.closest('[data-edit]')) return;
          const b = setActiveBot(row.dataset.pick);
          onSelect?.(b);
          onStatus?.(`已切换为「${b.name}」，直接输入即可对话`);
          mask.classList.add('hidden');
        };
      });
      mask.querySelectorAll('[data-edit]').forEach(btn => {
        btn.onclick = () => {
          const hit = listBots().find(x => x.id === btn.dataset.edit);
          if (hit) { editing = { ...hit, isNew: false }; draw(); }
        };
      });
    } else if (tab === 'automations') {
      mask.querySelector('[data-act="add-auto"]').onclick = () => { addingAuto = true; draw(); };
      mask.querySelectorAll('[data-toggle-auto]').forEach(chk => {
        chk.onchange = () => {
          const next = listAutomations();
          const hit = next.find(x => x.id === chk.dataset.toggleAuto);
          if (hit) {
            hit.enabled = chk.checked;
            saveAutomations(next);
            onStatus?.(`定时任务「${hit.name}」已${hit.enabled ? '启用，正在拉取最新推送…' : '关闭'}`);
            if (hit.enabled && onRunAutomation) {
              mask.classList.add('hidden');
              onRunAutomation(hit, { fromToggle: true });
            } else if (!hit.enabled && onRunAutomation) {
              onRunAutomation(hit, { disabled: true });
            }
          }
        };
      });
      mask.querySelectorAll('[data-run-auto]').forEach(row => {
        row.onclick = e => {
          if (e.target.closest('.ios-switch')) return;
          const hit = listAutomations().find(x => x.id === row.dataset.runAuto);
          if (!hit) return;
          mask.classList.add('hidden');
          onRunAutomation?.(hit);
        };
      });
    } else {
      mask.querySelector('[data-act="add-plug"]').onclick = () => { addingPlugin = true; draw(); };
      mask.querySelectorAll('[data-theme-plug]').forEach(btn => {
        btn.onclick = () => {
          const th = applyThemePlugin(btn.dataset.themePlug);
          onStatus?.(`已切换主题插件「${th.name}」`);
          draw();
        };
      });
      mask.querySelectorAll('[data-toggle]').forEach(chk => {
        chk.onchange = () => {
          const id = chk.dataset.toggle;
          const next = listPlugins();
          const hit = next.find(x => x.id === id);
          if (hit) {
            hit.enabled = chk.checked;
            savePlugins(next);
            onStatus?.(`${hit.name}已${hit.enabled ? '开启（可在下方选定展示的 Bot）' : '关闭'}`);
            draw();
          }
        };
      });
      mask.querySelectorAll('[data-assign-bot]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const bid = btn.dataset.assignBot;
          const pid = btn.dataset.assignPlug;
          const botObj = listBots().find(x => x.id === bid);
          const plugObj = listPlugins().find(x => x.id === pid);
          const nowOn = toggleBotPlugin(bid, pid);
          onStatus?.(nowOn
            ? `已将「${plugObj?.short || plugObj?.name || pid}」加载到「${botObj?.name || 'Bot'}」对话`
            : `已从「${botObj?.name || 'Bot'}」对话移除「${plugObj?.short || plugObj?.name || pid}」`);
          draw();
        };
      });
      mask.querySelectorAll('[data-remove-plug]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const pid = btn.dataset.removePlug;
          savePlugins(listPlugins().filter(p => p.id !== pid));
          onStatus?.('已卸载该外部插件');
          draw();
        };
      });
      mask.querySelectorAll('[data-launch]').forEach(row => {
        const id = row.dataset.launch;
        if (!id) return;
        row.onclick = e => {
          if (e.target.closest('.ios-switch')) return;
          const pl = listPlugins().find(p => p.id === id);
          if (!isPluginEnabled(id)) { onStatus?.('请先打开右侧开关启用此插件'); return; }
          const mountedBots = listBots().filter(b => getBotPlugins(b.id).includes(id));
          if (!mountedBots.length) {
            onStatus?.(`请在目标 Bot 资料页的「插件」中为它开启「${pl?.name || id}」`);
            return;
          }
          const curBot = getActiveBot();
          const targetBot = mountedBots.find(b => b.id === curBot.id) || mountedBots[0];
          mask.classList.add('hidden');
          onSelect?.(targetBot);
          onStatus?.(`已进入「${targetBot.name}」对话，点输入框上方「${pl?.short || pl?.name || id}」即可打开`);
        };
      });
    }
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
