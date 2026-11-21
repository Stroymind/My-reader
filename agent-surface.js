// Zone 移动端 Agent 直出表面：Android 桌面独立快捷方式 + BYOK 现场生成苹果风微应用（用完即关）

import { aiConfigured, complete } from './ai.js';

const MICROAPP_KEY = 'zone-microapps';
let activeAppId = null;

function shortcutPlugin() {
  return window?.Capacitor?.Plugins?.ZoneShortcut || null;
}

export function listMicroApps() {
  try { return JSON.parse(localStorage.getItem(MICROAPP_KEY) || '[]'); } catch { return []; }
}

function saveMicroApps(list) {
  try { localStorage.setItem(MICROAPP_KEY, JSON.stringify(list.slice(0, 24))); } catch {}
}

export async function pinToDesktop({ id, label, uri, glyph = '' }) {
  const p = shortcutPlugin();
  if (!p) {
    return { ok: false, message: '创建手机桌面图标需在 Android 版 Zone APK 中使用' };
  }
  try {
    const res = await p.pinShortcut({
      id: String(id || `zone-${Date.now()}`),
      label: String(label || 'Zone').slice(0, 14),
      uri: String(uri || 'zone://open/agent'),
      glyph: String(glyph || label || 'Z').trim().slice(0, 1)
    });
    return { ok: !!res?.ok, message: res?.ok ? `已请求将「${label}」放到手机桌面` : '当前系统桌面未允许创建快捷方式' };
  } catch (err) {
    return { ok: false, message: err?.message || '创建桌面快捷方式失败' };
  }
}

export async function consumeLaunchDeepLink(onDeepLink) {
  const p = shortcutPlugin();
  if (!p || typeof onDeepLink !== 'function') return false;
  try {
    const res = await p.getLaunchUri();
    const uri = String(res?.uri || '').trim();
    if (uri && uri.startsWith('zone://')) {
      await onDeepLink(uri);
      return true;
    }
  } catch {}
  return false;
}

function ensureStage() {
  let stage = document.getElementById('zone-microapp-stage');
  if (stage) return stage;
  stage = document.createElement('section');
  stage.id = 'zone-microapp-stage';
  stage.className = 'microapp-stage hidden';
  stage.setAttribute('aria-label', 'Zone 即时微应用');
  stage.innerHTML = `
    <div class="microapp-float">
      <span id="microapp-title" class="microapp-title"></span>
      <div class="microapp-actions">
        <button id="btn-microapp-pin" class="microapp-pill accent" type="button">放到桌面</button>
        <button id="btn-microapp-close" class="microapp-pill" type="button">关闭</button>
      </div>
    </div>
    <iframe id="microapp-frame" class="microapp-frame" sandbox="allow-scripts" title="Zone 微应用"></iframe>
  `;
  document.body.appendChild(stage);
  stage.querySelector('#btn-microapp-close').addEventListener('click', () => closeMicroApp());
  stage.querySelector('#btn-microapp-pin').addEventListener('click', async () => {
    const app = listMicroApps().find(x => x.id === activeAppId);
    if (!app) return;
    const r = await pinToDesktop({
      id: `microapp-${app.id}`,
      label: app.title,
      uri: `zone://open/microapp/${app.id}`,
      glyph: app.title.slice(0, 1)
    });
    const btn = stage.querySelector('#btn-microapp-pin');
    if (btn) {
      btn.textContent = r.ok ? '已请求固定' : '仅限安卓';
      setTimeout(() => { btn.textContent = '放到桌面'; }, 2200);
    }
  });
  return stage;
}

export function isMicroAppOpen() {
  const stage = document.getElementById('zone-microapp-stage');
  return !!(stage && !stage.classList.contains('hidden'));
}

export function closeMicroApp() {
  const stage = document.getElementById('zone-microapp-stage');
  if (!stage) return false;
  if (stage.classList.contains('hidden')) return false;
  stage.classList.add('hidden');
  const frame = stage.querySelector('#microapp-frame');
  if (frame) frame.srcdoc = '';
  activeAppId = null;
  return true;
}

export function openMicroApp(id) {
  const app = listMicroApps().find(x => x.id === id);
  if (!app) return false;
  const stage = ensureStage();
  activeAppId = app.id;
  const titleEl = stage.querySelector('#microapp-title');
  if (titleEl) titleEl.textContent = app.title;
  const frame = stage.querySelector('#microapp-frame');
  if (frame) frame.srcdoc = app.html;
  stage.classList.remove('hidden');
  return true;
}

export async function craftMicroApp(prompt, { onStatus, onNeedAi } = {}) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) return { ok: false, message: '请描述想生成的微应用' };
  if (!aiConfigured()) {
    onStatus?.('请先填入你自己的 AI API Key（纯 BYOK，不消耗平台额度）');
    onNeedAi?.();
    return { ok: false, message: '需要先配置自己的 AI API Key' };
  }
  onStatus?.(`正在为你现场打造「${cleanPrompt.slice(0, 16)}」…`);
  const raw = await complete([
    {
      role: 'system',
      content:
        '你是 Apple Human Interface Guidelines 级别的移动端微应用设计师。根据用户一句话需求，输出一个完整、单文件、零外部依赖的 HTML5 应用（内联 <style> 和 <script>）。\n' +
        '视觉硬性要求：\n' +
        '1. 严格苹果极简浅色风格：背景 #f5f5f7，卡片 #ffffff + 柔和圆角 20px + 细腻阴影，文字 #1d1d1f，次要文字 #86868b，强调色 #007aff，系统无衬线字体。\n' +
        '2. 顶部预留 68px 安全间距（避免被浮动条遮挡），适配 390px 手机竖屏，无横向溢出，支持触摸交互与 localStorage 本地保存。\n' +
        '3. 只输出纯 HTML 代码（以 <!doctype html> 开头），不要 markdown 代码块标记，不要任何解释文字。'
    },
    { role: 'user', content: `帮我做一个手机微应用：${cleanPrompt}` }
  ]);
  const html = String(raw || '')
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!html || !/<html|<body|<div/i.test(html)) {
    return { ok: false, message: '生成微应用失败，请重试或换一种描述' };
  }
  const titleMatch = html.match(/<title>([^<]{1,24})<\/title>/i);
  const title = (titleMatch?.[1] || cleanPrompt).trim().slice(0, 14);
  const id = `ma-${Date.now().toString(36)}`;
  const record = { id, title, prompt: cleanPrompt, html, createdAt: Date.now() };
  const list = listMicroApps();
  list.unshift(record);
  saveMicroApps(list);
  openMicroApp(id);
  return { ok: true, app: record, message: `已现场生成「${title}」，点右上角「放到桌面」即可成为独立图标` };
}
