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
    name: 'Zbot',
    role: '轻触形象切换样式、写规则、管定时任务与插件',
    rules: '',
    shape: 'soot',
    accent: '#1D2029',
    plugins: ['reading-cosmos', 'mcp-bridge']
  }
];

const DEFAULT_AUTOMATIONS = [
  {
    id: 'auto-news-brief',
    name: '新闻推送',
    schedule: '每天 08:30 · 对话内推送',
    prompt: '抓取全球 AI 与科技一手动态，去重核验事实，用 5 条极简要点在对话内推送',
    builtinAction: 'news',
    enabled: true
  }
];

const DEFAULT_PLUGINS = [
  { id: 'reading-cosmos', name: '阅读器', short: '阅读器', desc: '卡片堆 · 沉浸阅读 · 星海', enabled: true, launchable: true },
  { id: 'phone-use', name: '手机控屏', short: '手机控屏', desc: '跨应用执行与敏感确认', enabled: true, launchable: true },
  { id: 'computer-use', name: '连接电脑', short: '连接电脑', desc: '遥控本地桌面与工作节点', enabled: true, launchable: true },
  { id: 'mcp-bridge', name: '联网与 MCP', short: '联网与 MCP', desc: '实时检索与远程技能调用', enabled: true, launchable: false }
];

const THEME_PLUGINS = [
  { id: 'apple-light', name: '纯净瓷白', bg: '#ffffff', accent: '#111111', css: '' },
  { id: 'warm-linen', name: '暖白亚麻', bg: '#f7f4ee', accent: '#9a5b2f', css: ':root{--app-bg:#f7f4ee;--app-elev:#fffdf9;--app-accent:#9a5b2f}' },
  { id: 'mist-sage', name: '雾绿工作室', bg: '#eef3ef', accent: '#2e7d52', css: ':root{--app-bg:#eef3ef;--app-elev:#f9fcf9;--app-accent:#2e7d52}' },
  { id: 'slate-pro', name: '冷灰工坊', bg: '#f2f3f5', accent: '#2563eb', css: ':root{--app-bg:#f2f3f5;--app-elev:#ffffff;--app-accent:#2563eb}' }
];

// 12 款 Blender 5.1 Cycles 超清 512×512 纯毛绒雕塑系列（4 款小绒灵 + 4 款绒毛煤球 + 4 款绒毛小云）
// 支持 24 款精选色盘 + 1670 万色自由取色器实时全彩换色（煤球换色时自动采用高饱和毛发基底，保持纯白眼圈不偏色）
const SHAPES = [
  // 第一排：小绒灵系列（4 款）
  { id: 'sprite',        family: 'buddy', label: '薰衣草绒灵', nativeAccent: '#969CE4', isDark: false, chromatic: true,  chromaticBaseId: 'sprite',       chromaticBaseHex: '#969CE4' },
  { id: 'moss',          family: 'buddy', label: '苔绿小绒灵', nativeAccent: '#5D7556', isDark: false, chromatic: true,  chromaticBaseId: 'moss',         chromaticBaseHex: '#5D7556' },
  { id: 'buddy',         family: 'buddy', label: '焦糖小绒灵', nativeAccent: '#CE8E5E', isDark: false, chromatic: true,  chromaticBaseId: 'buddy',        chromaticBaseHex: '#CE8E5E' },
  { id: 'sage-spirit',   family: 'buddy', label: '燕麦奶绒灵', nativeAccent: '#E8DEC9', isDark: false, chromatic: false, chromaticBaseId: 'sprite',       chromaticBaseHex: '#969CE4' },
  // 第二排：绒毛煤球系列（4 款）
  { id: 'soot',          family: 'soot',  label: '曜墨煤球',   nativeAccent: '#1D2029', isDark: true,  chromatic: false, chromaticBaseId: 'acorn',        chromaticBaseHex: '#DE7D90' },
  { id: 'acorn',         family: 'soot',  label: '樱莓煤球',   nativeAccent: '#DE7D90', isDark: false, chromatic: true,  chromaticBaseId: 'acorn',        chromaticBaseHex: '#DE7D90' },
  { id: 'cobalt-pebble', family: 'soot',  label: '釉蓝煤球',   nativeAccent: '#3C68CE', isDark: false, chromatic: true,  chromaticBaseId: 'cobalt-pebble',chromaticBaseHex: '#3C68CE' },
  { id: 'pebble',        family: 'soot',  label: '抹茶煤球',   nativeAccent: '#698D67', isDark: false, chromatic: true,  chromaticBaseId: 'pebble',       chromaticBaseHex: '#698D67' },
  // 第三排：绒毛小云系列（4 款）
  { id: 'butter-cloud',  family: 'cloud', label: '奶油绒云',   nativeAccent: '#F2CE74', isDark: false, chromatic: true,  chromaticBaseId: 'butter-cloud', chromaticBaseHex: '#F2CE74' },
  { id: 'owl',           family: 'cloud', label: '晴空绒云',   nativeAccent: '#82B3E4', isDark: false, chromatic: true,  chromaticBaseId: 'owl',          chromaticBaseHex: '#82B3E4' },
  { id: 'terra-cloud',   family: 'cloud', label: '珊瑚绒云',   nativeAccent: '#EE7B5A', isDark: false, chromatic: true,  chromaticBaseId: 'terra-cloud',  chromaticBaseHex: '#EE7B5A' },
  { id: 'fox',           family: 'cloud', label: '芋泥绒云',   nativeAccent: '#BC9FD9', isDark: false, chromatic: true,  chromaticBaseId: 'fox',          chromaticBaseHex: '#BC9FD9' }
];

const LEGACY_SHAPE_MAP = {
  onigiri: 'soot', cube: 'soot', zbot: 'soot', visor: 'soot', neko: 'soot', monolith: 'soot',
  heart: 'sprite', rover: 'sprite', bunny: 'sprite',
  orb: 'soot', eve: 'soot', studio: 'soot', halo: 'soot',
  bean: 'pebble', pocket: 'pebble', mochi: 'pebble', shield: 'pebble',
  house: 'acorn', capsule: 'acorn',
  cloud: 'terra-cloud', dome: 'terra-cloud',
  bloom: 'moss', frog: 'moss', clover: 'moss',
  splash: 'butter-cloud', antenna: 'butter-cloud', sprout: 'sage-spirit', drop: 'cobalt-pebble',
  hex: 'owl', cozmo: 'owl', prism: 'owl', star: 'fox', lynx: 'fox', bear: 'buddy'
};

// 24 款全谱系高审美毛绒色盘（涵盖莫兰迪、糖果、自然矿石与深邃暗色，另配自定义取色器支持无限色彩）
const ACCENTS = [
  '#1D2029', '#969CE4', '#5D7556', '#CE8E5E', '#E8DEC9', '#DE7D90',
  '#3C68CE', '#698D67', '#F2CE74', '#82B3E4', '#EE7B5A', '#BC9FD9',
  '#E85D75', '#FF8A3D', '#E6B800', '#38A87D', '#2997A8', '#5263D8',
  '#7C52D8', '#C45BA8', '#8C5E3C', '#586370', '#A3B899', '#F4A6B8'
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

function hexLuminance(hex) {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function hexToHsl(hex) {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return { h: 0, s: 0, l: 0.2 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (mx === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l };
}

function resolvePlushBaseAndTint(spec, accent, forceNative = false) {
  if (forceNative) return { imgId: spec.id, tint: '' };
  const cur = String(accent || '').trim().toLowerCase();
  const nat = String(spec.nativeAccent || '').trim().toLowerCase();
  if (!cur || cur === nat) return { imgId: spec.id, tint: '' };

  // 若所选颜色恰为同家族某款原生 Blender Cycles 渲染色，直接切换至该原生超清资产（零滤镜损耗！）
  const exactSibling = SHAPES.find(s => s.family === spec.family && String(s.nativeAccent).toLowerCase() === cur);
  if (exactSibling) return { imgId: exactSibling.id, tint: '' };

  const a = hexToHsl(cur);
  // 若目标为极暗曜黑且当前是煤球家族，直接使用原生黑煤球 soot.webp
  if (a.l < 0.22 && a.s < 0.28) {
    if (spec.family === 'soot') return { imgId: 'soot', tint: '' };
    return { imgId: spec.chromaticBaseId || spec.id, tint: 'saturate(0.16) brightness(0.44) contrast(1.10)' };
  }

  // 采用同家族高饱和度毛绒基底做全彩旋转（例如黑煤球换彩色时自动基于樱莓煤球基底旋转色相，保证白眼圈100%纯白！）
  const baseId = spec.chromatic ? spec.id : (spec.chromaticBaseId || spec.id);
  const baseHex = spec.chromatic ? spec.nativeAccent : (spec.chromaticBaseHex || spec.nativeAccent);
  const n = hexToHsl(baseHex);

  if (a.s < 0.14) {
    const briGray = Math.max(0.72, Math.min(1.22, a.l / Math.max(0.25, n.l)));
    return { imgId: baseId, tint: `saturate(0.14) brightness(${briGray.toFixed(2)})` };
  }
  let dh = Math.round(a.h - n.h);
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const sat = Math.max(0.68, Math.min(1.62, a.s / Math.max(0.22, n.s)));
  const bri = Math.max(0.78, Math.min(1.18, a.l / Math.max(0.28, n.l)));
  return { imgId: baseId, tint: `hue-rotate(${dh}deg) saturate(${sat.toFixed(2)}) brightness(${bri.toFixed(2)})` };
}

export function renderBotSvg(shape = 'soot', accent = '', seed = '', opts = {}) {
  const mapped = LEGACY_SHAPE_MAP[shape] || shape;
  const spec = SHAPES.find(s => s.id === mapped) || SHAPES[0];
  const color = accent || spec.nativeAccent || '#1D2029';
  const { imgId, tint } = resolvePlushBaseAndTint(spec, color, !!opts.nativeColor);
  const isDarkBody = (imgId === 'soot' && !tint) || hexLuminance(color) < 52;
  const timing = animTimingFor(`${seed || ''}:${spec.id}:${color}`);
  const cls = ['bot-glyph', 'bot-3d', opts.coalesce ? 'bot-coalescing' : '', opts.static ? 'no-life' : ''].filter(Boolean).join(' ');
  const filterStyle = tint ? `--bot-tint:${tint};` : '';
  return `<span class="${cls}"${isDarkBody ? ' data-dark-body="1"' : ''} data-bot-shape="${spec.id}" style="color:${color};${filterStyle}${timing}" aria-hidden="true"><span class="bot-body"><img class="bot-3d-img" src="icons/bots/${imgId}.webp" alt="" decoding="async" draggable="false"/></span></span>`;
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
    ? { isNew: true, name: '', role: '', rules: '', shape: 'buddy', accent: '#8C92D8', plugins: ['mcp-bridge'] }
    : (editBotId ? (() => { const h = listBots().find(x => x.id === editBotId); return h ? { ...h, shape: LEGACY_SHAPE_MAP[h.shape] || h.shape || 'sprite', plugins: Array.isArray(h.plugins) ? [...h.plugins] : ['mcp-bridge'], isNew: false } : null; })() : null);
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
        editing = { isNew: true, name: '', role: '', rules: '', shape: 'buddy', accent: '#8C92D8', plugins: ['mcp-bridge'] };
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
          onStatus?.('');
          return;
        }
        const grp = updateGroup(editingGroup.id, { name: name || editingGroup.name, memberIds: editingGroup.memberIds });
        editingGroup = null;
        mask.classList.add('hidden');
        if (grp) onSelectGroup?.(grp);
        onStatus?.('');
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
              ${SHAPES.map(s => `<button type="button" class="cb-shape-btn ${editing.shape === s.id ? 'on' : ''}" data-shape="${s.id}" title="${s.label}">${renderBotSvg(s.id, s.nativeAccent, s.id, { static: true, nativeColor: true })}</button>`).join('')}
            </div>
            <div class="cb-color-grid">
              ${ACCENTS.map(c => `<button type="button" class="cb-dot ${String(editing.accent).toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="background:${c}" data-accent="${c}" aria-label="${c}"></button>`).join('')}
              <label class="cb-dot cb-custom-wheel ${!ACCENTS.some(c => c.toLowerCase() === String(editing.accent).toLowerCase()) ? 'on' : ''}" title="自由调色盘（任意颜色）" aria-label="自定义任意颜色">
                <input type="color" id="bot-f-custom-color" value="${esc(editing.accent || '#969CE4')}">
              </label>
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
      mask.querySelectorAll('button[data-shape]').forEach(b => {
        b.onclick = () => {
          editing.name = mask.querySelector('#bot-f-name')?.value || '';
          const rEl = mask.querySelector('#bot-f-rules');
          if (rEl) editing.rules = rEl.value;
          editing.shape = b.dataset.shape;
          const sp = SHAPES.find(x => x.id === editing.shape);
          if (sp?.nativeAccent) editing.accent = sp.nativeAccent;
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
      const customColInp = mask.querySelector('#bot-f-custom-color');
      if (customColInp) {
        customColInp.onchange = () => {
          editing.name = mask.querySelector('#bot-f-name')?.value || '';
          const rEl = mask.querySelector('#bot-f-rules');
          if (rEl) editing.rules = rEl.value;
          editing.accent = customColInp.value;
          editing.justPicked = true;
          draw();
        };
      }
      mask.querySelector('[data-act="save"]').onclick = () => {
        const name = (mask.querySelector('#bot-f-name')?.value || '').trim();
        const rules = (mask.querySelector('#bot-f-rules')?.value ?? editing.rules ?? '').trim();
        if (!name) return;
        const role = rules ? rules.slice(0, 26) : '轻触形象切换样式、写规则、管定时任务与插件';
        const nextList = listBots();
        if (editing.isNew) {
          const item = { id: `bot-${Date.now().toString(36)}`, name, role, rules, shape: editing.shape, accent: editing.accent, plugins: Array.isArray(editing.plugins) ? [...editing.plugins] : ['mcp-bridge'], notify: true, updatedAt: Date.now() };
          nextList.push(item);
          saveBots(nextList);
          setActiveBot(item.id);
          editing = null;
          mask.classList.add('hidden');
          onSelect?.(item, { created: true });
          onStatus?.('');
          return;
        } else {
          const idx = nextList.findIndex(x => x.id === editing.id);
          if (idx >= 0) nextList[idx] = { ...nextList[idx], name, role, rules, shape: editing.shape, accent: editing.accent, updatedAt: Date.now() };
          saveBots(nextList);
          onStatus?.('');
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
        editing = { isNew: true, name: '', role: '', rules: '', shape: 'buddy', accent: '#8C92D8' };
        draw();
      };
      mask.querySelectorAll('[data-pick]').forEach(row => {
        row.onclick = e => {
          if (e.target.closest('[data-edit]')) return;
          const b = setActiveBot(row.dataset.pick);
          onSelect?.(b);
          onStatus?.('');
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
