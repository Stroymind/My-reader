// Zone 5.0 云端账号与跨端实时同步引擎（手机 Android APK ↔ 电脑 Web 端双向无冲突合并）
// 同步范围：Bot 列表与人设/形态、群聊、所有 Bot 对话消息与卡片、插件挂载、定时任务、长久知识库、阅读卡片堆
// 隐私边界：用户自有 AI API Key 仅保存在本机设备，绝不自动上传至云端

import { nativeGetJson, nativePostJson } from './ai.js';

const SESSION_KEY = 'zone-cloud-account-v1';
const DELETED_KEY = 'zone-sync-deleted-v1';

const LS_BOTS = 'zone-bots-v3';
const LS_GROUPS = 'zone-groups-v1';
const LS_THREADS = 'zone-task-threads-v1';
const LS_MEMORIES = 'zone-memory-v1';
const LS_STACKS = 'rr-stacks';
const LS_PLUGINS = 'zone-skill-plugins-v4';
const LS_AUTOS = 'zone-automations-v2';
const LS_ACTIVE_BOT = 'zone-active-bot-id';

let syncInFlight = null;
let syncDebounceTimer = null;

function safeJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function deviceLabel() {
  const native = !!(window.Capacitor?.isNativePlatform?.());
  if (native) return 'Android 手机端';
  const ua = navigator.userAgent || '';
  if (/Mac/i.test(ua)) return 'Mac 电脑端';
  if (/Windows/i.test(ua)) return 'Windows 电脑端';
  if (/Android|iPhone|iPad/i.test(ua)) return '移动浏览器';
  return '电脑网页端';
}

export function getCloudSession() {
  const s = safeJson(SESSION_KEY, null);
  if (!s || !s.token || !s.user?.account) return null;
  return s;
}

export function isCloudSignedIn() {
  return !!getCloudSession()?.token;
}

function saveCloudSession(next) {
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

export function recordSyncDeletion(bucket, id) {
  if (!bucket || !id) return;
  const cur = safeJson(DELETED_KEY, {});
  const arr = Array.isArray(cur[bucket]) ? cur[bucket] : [];
  if (!arr.includes(id)) arr.push(String(id));
  cur[bucket] = arr.slice(-80);
  try { localStorage.setItem(DELETED_KEY, JSON.stringify(cur)); } catch {}
}

function slimThreadForSync(t) {
  if (!t || typeof t !== 'object') return null;
  const msgs = (Array.isArray(t.messages) ? t.messages : []).slice(-100).map(m => {
    if (!m || typeof m !== 'object') return m;
    if (!Array.isArray(m.attachments) || !m.attachments.length) return m;
    const slimAtts = m.attachments.map(a => {
      if (!a || typeof a !== 'object') return a;
      if (a.kind === 'image' && String(a.dataUrl || '').length > 24000) {
        return { kind: 'image', name: a.name || '照片.jpg', syncedStub: true };
      }
      if (a.kind === 'video') {
        return { kind: 'video', name: a.name || '视频.mp4', durationSec: a.durationSec || 0, syncedStub: true };
      }
      if (a.kind === 'file' && String(a.text || '').length > 4000) {
        return { ...a, text: String(a.text).slice(0, 4000) };
      }
      return a;
    });
    return { ...m, attachments: slimAtts };
  });
  return { ...t, messages: msgs };
}

export function buildLocalSyncSnapshot() {
  const rawBots = safeJson(LS_BOTS, []);
  const bots = Array.isArray(rawBots) ? rawBots : [];
  const groups = Array.isArray(safeJson(LS_GROUPS, [])) ? safeJson(LS_GROUPS, []) : [];
  const rawThreads = safeJson(LS_THREADS, []);
  const threads = Array.isArray(rawThreads) ? rawThreads.map(slimThreadForSync).filter(Boolean) : [];
  const memories = Array.isArray(safeJson(LS_MEMORIES, [])) ? safeJson(LS_MEMORIES, []) : [];
  const stacksWrap = safeJson(LS_STACKS, null);
  const stacks = Array.isArray(stacksWrap?.stacks) ? stacksWrap.stacks : (Array.isArray(stacksWrap) ? stacksWrap : []);
  const plugins = Array.isArray(safeJson(LS_PLUGINS, [])) ? safeJson(LS_PLUGINS, []) : [];
  const automations = Array.isArray(safeJson(LS_AUTOS, [])) ? safeJson(LS_AUTOS, []) : [];
  const activeBotId = (() => { try { return localStorage.getItem(LS_ACTIVE_BOT) || ''; } catch { return ''; } })();
  const deletedIds = safeJson(DELETED_KEY, {});
  return { bots, groups, threads, memories, stacks, plugins, automations, activeBotId, deletedIds };
}

export function applyMergedSyncSnapshot(state) {
  if (!state || typeof state !== 'object') return false;
  let changed = false;
  const writeIfDiff = (key, val) => {
    const nextStr = JSON.stringify(val);
    let prevStr = '';
    try { prevStr = localStorage.getItem(key) || ''; } catch {}
    if (prevStr !== nextStr) {
      try { localStorage.setItem(key, nextStr); } catch {}
      changed = true;
    }
  };
  if (Array.isArray(state.bots) && state.bots.length) writeIfDiff(LS_BOTS, state.bots);
  if (Array.isArray(state.groups)) writeIfDiff(LS_GROUPS, state.groups);
  if (Array.isArray(state.threads)) writeIfDiff(LS_THREADS, state.threads);
  if (Array.isArray(state.memories)) writeIfDiff(LS_MEMORIES, state.memories);
  if (Array.isArray(state.stacks) && state.stacks.length) {
    writeIfDiff(LS_STACKS, { v: 1, stacks: state.stacks });
  }
  if (Array.isArray(state.plugins) && state.plugins.length) writeIfDiff(LS_PLUGINS, state.plugins);
  if (Array.isArray(state.automations) && state.automations.length) writeIfDiff(LS_AUTOS, state.automations);
  return changed;
}

export async function cloudAuthRegister({ apiBase, account, password, displayName = '' }) {
  const base = String(apiBase || '').replace(/\/+$/, '');
  if (!base) return { ok: false, error: '未配置云端同步服务地址' };
  const r = await nativePostJson(`${base}/api/auth/register`, {}, {
    account: String(account || '').trim(),
    password: String(password || ''),
    display_name: String(displayName || '').trim(),
    device_name: deviceLabel()
  }, 30000);
  if (!r.ok || !r.data?.ok || !r.data?.token) {
    return { ok: false, error: r.data?.detail || r.data?.error || `注册失败 (${r.status || '网络异常'})` };
  }
  const sess = {
    token: r.data.token,
    user: r.data.user,
    revision: Number(r.data.revision || 0),
    devicesCount: Number(r.data.devices_count || 1),
    lastSyncAt: Date.now()
  };
  saveCloudSession(sess);
  return { ok: true, session: sess };
}

export async function cloudAuthLogin({ apiBase, account, password }) {
  const base = String(apiBase || '').replace(/\/+$/, '');
  if (!base) return { ok: false, error: '未配置云端同步服务地址' };
  const r = await nativePostJson(`${base}/api/auth/login`, {}, {
    account: String(account || '').trim(),
    password: String(password || ''),
    device_name: deviceLabel()
  }, 30000);
  if (!r.ok || !r.data?.ok || !r.data?.token) {
    return { ok: false, error: r.data?.detail || r.data?.error || `登录失败 (${r.status || '网络异常'})` };
  }
  const sess = {
    token: r.data.token,
    user: r.data.user,
    revision: Number(r.data.revision || 0),
    devicesCount: Number(r.data.devices_count || 1),
    lastSyncAt: Date.now()
  };
  saveCloudSession(sess);
  return { ok: true, session: sess };
}

export async function cloudAuthLogout({ apiBase } = {}) {
  const sess = getCloudSession();
  const base = String(apiBase || '').replace(/\/+$/, '');
  saveCloudSession(null);
  if (sess?.token && base) {
    try {
      await nativePostJson(`${base}/api/auth/logout`, { Authorization: `Bearer ${sess.token}` }, {}, 10000);
    } catch {}
  }
  return { ok: true };
}

export async function syncNow({ apiBase, onApplied } = {}) {
  const sess = getCloudSession();
  const base = String(apiBase || '').replace(/\/+$/, '');
  if (!sess?.token || !base) return { ok: false, skipped: true };
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    try {
      const snap = buildLocalSyncSnapshot();
      const r = await nativePostJson(
        `${base}/api/sync/exchange`,
        { Authorization: `Bearer ${sess.token}` },
        snap,
        30000
      );
      if (r.status === 401) {
        saveCloudSession(null);
        return { ok: false, authExpired: true, error: '账号登录已过期，请重新登录' };
      }
      if (!r.ok || !r.data?.ok) {
        return { ok: false, error: r.data?.detail || `同步失败 (${r.status || '网络超时'})` };
      }
      const changed = applyMergedSyncSnapshot(r.data.state);
      const updatedSess = {
        ...sess,
        revision: Number(r.data.revision || sess.revision || 0),
        devicesCount: Number(r.data.devices_count || sess.devicesCount || 1),
        lastSyncAt: Date.now()
      };
      saveCloudSession(updatedSess);
      if (changed && typeof onApplied === 'function') onApplied(r.data.state, updatedSess);
      return { ok: true, changed, revision: updatedSess.revision, devicesCount: updatedSess.devicesCount };
    } catch (err) {
      return { ok: false, error: err?.message || '同步网络异常' };
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

export async function pollSyncDelta({ apiBase, onApplied } = {}) {
  const sess = getCloudSession();
  const base = String(apiBase || '').replace(/\/+$/, '');
  if (!sess?.token || !base || syncInFlight) return { ok: false, skipped: true };
  try {
    const r = await nativeGetJson(
      `${base}/api/sync/state?since_revision=${encodeURIComponent(String(sess.revision || 0))}`,
      { Authorization: `Bearer ${sess.token}` },
      18000
    );
    if (r.status === 401) {
      saveCloudSession(null);
      return { ok: false, authExpired: true };
    }
    if (!r.ok || !r.data?.ok) return { ok: false };
    if (r.data.changed === false) {
      saveCloudSession({ ...sess, devicesCount: Number(r.data.devices_count || sess.devicesCount || 1) });
      return { ok: true, changed: false };
    }
    return await syncNow({ apiBase: base, onApplied });
  } catch {
    return { ok: false };
  }
}

export function scheduleCloudSync({ apiBase, onApplied, delayMs = 1100 } = {}) {
  if (!isCloudSignedIn()) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    syncNow({ apiBase, onApplied }).catch(() => {});
  }, delayMs);
}
