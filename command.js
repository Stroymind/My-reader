// Zone 自然语言与语音直控引擎：离线优先（零延迟复合意图解析）+ 可选 AI 回退 + Web Speech 语音 / 前台唤醒词 + 一键撤销
// 严禁执行未白名单化的删除或外部发送操作；无密钥/离线时零网络请求。

import { aiConfigured, complete } from './ai.js';

const WAKE_KEY = 'rr-voice-wake';
const WAKE_RE = /^(?:hey\s+|hi\s+|你好\s*)?(?:zone|小域|小雨|小玉|小宇|小余|宗)[，,、。\s]*(.*)$/i;
const RESERVED_OPEN = /^(?:目录|书签|星海|星图|知识|笔记|摘录|护眼|深色|浅色|夜间|日间|双语|对照|翻译|语音|唤醒|立体|全图|设置|整理|搜索|AI)/i;

const SpeechRec = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

export const speechSupported = () => !!SpeechRec;

/**
 * 将一句自然中文/英文解析为可组合的原子操作列表。
 * 例如：「字大一点，开护眼模式，行距宽一点」-> [fontSize(+2), readTheme('sepia'), lineHeight(2.1)]
 */
export function parseNaturalCommands(raw, ctx = {}) {
  const text = String(raw || '').trim().replace(/[。！？!?]+$/g, '').trim();
  if (!text) return [];
  const ops = [];
  const has = re => re.test(text);

  // 1. 撤销（最高优先级，单独生效）
  if (/^(?:撤销|撤回|恢复刚才|恢复原样|改回去|算了|undo)$/i.test(text)) {
    return [{ op: 'undo' }];
  }

  // 2. 语音唤醒开关
  if (/(?:开|打开|开启|启动).{0,3}(?:语音)?唤醒/.test(text)) ops.push({ op: 'wake', on: true });
  else if (/(?:关|关闭|停止|取消).{0,3}(?:语音)?唤醒/.test(text)) ops.push({ op: 'wake', on: false });

  // 3. 记笔记 / 写想法（整句带内容优先识别）
  const noteMatch = text.match(/^(?:帮我)?(?:记一条?笔记|写一条?笔记|记笔记|记一下|写一条?想法|记录)[：:\s]*(.*)$/);
  if (noteMatch) {
    ops.push({ op: 'createNote', text: noteMatch[1].trim() });
    return ops;
  }
  if (/(?:写判断|新建判断|做个?判断|决策笔记)/.test(text)) {
    ops.push({ op: 'newDecision' });
    return ops;
  }

  // 4. 字号调节（精确数值 / 相对增减 / 默认）
  const exactSize = text.match(/(?:字号|字体大小|字)\s*(?:调到|设为|改成|调成|设置成|为|到)?\s*(\d{2})\b/);
  if (exactSize) {
    ops.push({ op: 'fontSize', value: Math.max(12, Math.min(40, Number(exactSize[1]))) });
  } else if (/(?:默认字号|恢复字号|字号复原)/.test(text)) {
    ops.push({ op: 'fontSize', value: 19 });
  } else if (/(?:字.{0,3}(?:大|放大|增|加)|放大(?:字|一点)|字太小|看不清|larger\s*font|bigger\s*font)/i.test(text)) {
    ops.push({ op: 'fontSize', delta: /(?:很多|大大|两号|多一点)/.test(text) ? 4 : 2 });
  } else if (/(?:字.{0,3}(?:小|缩小|减)|缩小(?:字|一点)|字太大|smaller\s*font)/i.test(text)) {
    ops.push({ op: 'fontSize', delta: /(?:很多|小小|两号|多一点)/.test(text) ? -4 : -2 });
  }

  // 5. 字体切换
  if (/(?:楷体|文楷|楷书|手写体)/.test(text)) ops.push({ op: 'font', value: 'kai' });
  else if (/(?:宋体|衬线|明体)/.test(text)) ops.push({ op: 'font', value: 'serif' });
  else if (/(?:黑体|无衬线)/.test(text)) ops.push({ op: 'font', value: 'sans' });
  else if (/(?:原书字体|原字体)/.test(text)) ops.push({ op: 'font', value: 'original' });

  // 6. 行距
  if (/(?:行距.{0,3}(?:宽|松|大)|宽松|行间距大|松一点)/.test(text)) ops.push({ op: 'lineHeight', value: 2.1 });
  else if (/(?:行距.{0,3}(?:紧|小|窄|密)|紧凑|密一点)/.test(text)) ops.push({ op: 'lineHeight', value: 1.5 });
  else if (/(?:行距.{0,3}(?:适中|默认|正常))/.test(text)) ops.push({ op: 'lineHeight', value: 1.8 });

  // 7. 护眼 / 阅读主题 / 应用深浅外观
  const reading = !!ctx.reading;
  if (/(?:护眼|暖色|泛黄|米黄|羊皮纸|sepia)/i.test(text)) {
    ops.push({ op: 'readTheme', value: 'sepia' });
  } else if (/(?:纸张|纸色|自然纸)/.test(text)) {
    ops.push({ op: 'readTheme', value: 'paper' });
  } else if (/(?:纯白|白底|白色背景)/.test(text)) {
    ops.push({ op: 'readTheme', value: 'white' });
  }

  if (/(?:深色|暗色|夜间|黑夜|暗黑|关灯|dark\s*mode)/i.test(text)) {
    ops.push({ op: 'appearance', value: 'dark' });
    if (reading || /(?:夜间阅读|暗夜阅读|关灯|阅读)/.test(text)) ops.push({ op: 'readTheme', value: 'night' });
  } else if (/(?:浅色|亮色|日间|白天模式|light\s*mode)/i.test(text)) {
    ops.push({ op: 'appearance', value: 'light' });
    if (reading && !ops.some(o => o.op === 'readTheme')) ops.push({ op: 'readTheme', value: 'paper' });
  } else if (/(?:跟随系统|自动外观|系统外观)/.test(text)) {
    ops.push({ op: 'appearance', value: 'system' });
  }

  // 8. 中英对照
  if (/(?:开|打开|开启).{0,3}(?:中英|对照|双语|翻译)/.test(text)) ops.push({ op: 'bilingual', on: true });
  else if (/(?:关|关闭|取消|只看原文).{0,3}(?:中英|对照|双语|翻译)?/.test(text) && /(?:中英|对照|双语|翻译|只看原文)/.test(text)) {
    ops.push({ op: 'bilingual', on: false });
  }

  // 9. 阅读翻页 / 跳转 / 书签 / 目录 / 退出阅读
  if (/(?:下一页|往后翻|翻一页|向后翻|翻页|next\s*page)/i.test(text)) ops.push({ op: 'turn', delta: 1 });
  else if (/(?:上一页|往前翻|回上一页|向前翻|prev\s*page)/i.test(text)) ops.push({ op: 'turn', delta: -1 });
  const pct = text.match(/(?:跳到|翻到|去|进度)?\s*第?\s*(\d{1,3})\s*%/);
  if (pct) ops.push({ op: 'seek', fraction: Math.max(0, Math.min(1, Number(pct[1]) / 100)) });
  else if (/(?:回到开头|从头看|第一页)/.test(text)) ops.push({ op: 'seek', fraction: 0 });
  if (/(?:加书签|加个?书签|收藏这页|记个?书签|打书签)/.test(text)) ops.push({ op: 'bookmark' });
  if (/(?:打开目录|看目录|显示目录|^目录$)/.test(text)) ops.push({ op: 'toc' });
  if (/(?:退出阅读|关闭这?本书|返回列表|回到书单|不看了)/.test(text)) ops.push({ op: 'closeBook' });

  // 10. 星海天色与视角（提及星海专属词时，若未指定其他空间则自动前往星海）
  let graphHint = false;
  if (/(?:2\.5d|立体|三维|倾斜视角)/i.test(text)) { ops.push({ op: 'graphTilt', on: true }); graphHint = true; }
  else if (/(?:平视|平面视角|关闭立体|取消立体|二维)/.test(text)) { ops.push({ op: 'graphTilt', on: false }); graphHint = true; }
  if (/(?:适应全图|看全图|全图|复位星海|星海复位)/.test(text)) { ops.push({ op: 'graphFit' }); graphHint = true; }
  if (/(?:晨曦|印象日出|日出天色|清晨|早晨)/.test(text)) { ops.push({ op: 'graphMood', value: 'dawn' }); graphHint = true; }
  else if (/(?:晴蓝|晴空|睡莲|正午)/.test(text)) { ops.push({ op: 'graphMood', value: 'day' }); graphHint = true; }
  else if (/(?:暮色|黄昏|晚霞|日落)/.test(text)) { ops.push({ op: 'graphMood', value: 'dusk' }); graphHint = true; }
  else if (/(?:星夜|梵高|深夜天色)/.test(text)) { ops.push({ op: 'graphMood', value: 'night' }); graphHint = true; }
  else if (/(?:随时辰|随时间|自动天色|按时间变化)/.test(text)) { ops.push({ op: 'graphMood', value: 'auto' }); graphHint = true; }

  // 11. 空间切换
  if (/(?:去星海|看星海|打开星海|星海|星图)/.test(text)) ops.push({ op: 'pane', value: 'graph' });
  else if (/(?:看知识|去知识|知识库|看笔记|笔记列表)/.test(text)) ops.push({ op: 'pane', value: 'knowledge' });
  else if (/(?:回到流|去流|回首页|看列表|看流)/.test(text)) ops.push({ op: 'pane', value: 'shelf' });
  else if (graphHint && !reading && ctx.pane !== 'graph') ops.unshift({ op: 'pane', value: 'graph' });

  // 12. 整理 / 摘录 / AI 设置
  if (/(?:进入整理|整理列表|多选|建堆)/.test(text)) ops.push({ op: 'selectMode' });
  if (/(?:看摘录|打开摘录|我的摘录)/.test(text)) ops.push({ op: 'excerpts' });
  if (/(?:AI\s*设置|配置\s*AI|设置密钥)/i.test(text)) ops.push({ op: 'aiSettings' });

  // 13. 直接打开书（如「打开原则」「继续读思考快与慢」）
  if (!ops.length) {
    const openM = text.match(/^(?:帮我)?(?:打开|阅读|继续看|想看|读一下|读)\s*[《「]?([^，。！？,!?》」]{1,36})[》」]?$/);
    if (openM && openM[1].trim() && !RESERVED_OPEN.test(openM[1].trim())) {
      ops.push({ op: 'openBook', query: openM[1].trim() });
    }
  }
  // 14. 搜索（如「搜深度工作」「找元认知」）
  if (!ops.length) {
    const findM = text.match(/^(?:帮我)?(?:搜索|查找|搜一下|搜|找一下|找)\s*(.+)$/);
    if (findM && findM[1].trim()) {
      ops.push({ op: 'search', query: findM[1].trim() });
    }
  }

  return ops;
}

const SAFE_OPS = new Set([
  'undo', 'wake', 'fontSize', 'font', 'lineHeight', 'readTheme', 'appearance',
  'bilingual', 'turn', 'seek', 'bookmark', 'toc', 'closeBook',
  'pane', 'graphTilt', 'graphFit', 'graphMood', 'openBook', 'createNote', 'search'
]);

async function aiFallbackPlan(text, ctx) {
  if (!aiConfigured()) return [];
  const sys = `你是 Zone 应用的静默意图解析器。把用户的话翻译成严格 JSON 数组（只输出 JSON，不要解释）。
允许的 op：
- {"op":"fontSize","delta":2} 或 {"op":"fontSize","value":22}
- {"op":"font","value":"serif"|"kai"|"sans"|"original"}
- {"op":"lineHeight","value":1.5|1.8|2.1}
- {"op":"readTheme","value":"paper"|"white"|"sepia"|"night"}
- {"op":"appearance","value":"light"|"dark"|"system"}
- {"op":"bilingual","on":true|false}
- {"op":"turn","delta":1|-1} / {"op":"seek","fraction":0..1} / {"op":"bookmark"} / {"op":"toc"} / {"op":"closeBook"}
- {"op":"pane","value":"shelf"|"knowledge"|"graph"}
- {"op":"graphTilt","on":true|false} / {"op":"graphFit"} / {"op":"graphMood","value":"auto"|"dawn"|"day"|"dusk"|"night"}
- {"op":"openBook","query":"书名"} / {"op":"createNote","text":"内容"} / {"op":"search","query":"词"} / {"op":"undo"}
若无法映射到上述操作，返回 []。`;
  try {
    const out = await complete([
      { role: 'system', content: sys },
      { role: 'user', content: `当前状态：${ctx.reading ? '阅读中' : '主界面(' + (ctx.pane || 'shelf') + ')'}\n用户说：${text}` }
    ]);
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed.filter(a => a && SAFE_OPS.has(a.op)).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function createCommandController(host) {
  const undoStack = [];
  let wakeOn = false;
  let activeRec = null;
  let wakeRec = null;
  let wakeTimer = null;
  let listening = false;

  const setBarListening = on => {
    listening = !!on;
    document.getElementById('command-bar')?.classList.toggle('listening', listening);
    document.getElementById('spatial-bar')?.classList.toggle('listening', listening);
    const mic = document.getElementById('cmd-mic');
    if (mic) mic.setAttribute('aria-pressed', listening ? 'true' : 'false');
  };

  const syncWakeUi = () => {
    const btn = document.getElementById('cmd-wake');
    if (btn) {
      btn.setAttribute('aria-pressed', wakeOn ? 'true' : 'false');
      btn.textContent = wakeOn ? '唤醒 · 开' : '唤醒';
    }
    document.getElementById('spatial-bar')?.classList.toggle('wake-on', wakeOn);
  };

  function stopWake() {
    clearTimeout(wakeTimer);
    if (wakeRec) { try { wakeRec.onend = null; wakeRec.stop(); } catch {} wakeRec = null; }
  }

  function startWakeLoop() {
    if (!wakeOn || !SpeechRec || listening || document.hidden) return;
    stopWake();
    try {
      const rec = new SpeechRec();
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = e => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const said = (e.results[i][0]?.transcript || '').trim();
          const m = said.match(WAKE_RE);
          if (!m) continue;
          const rest = (m[1] || '').trim();
          if (rest) {
            run(rest);
          } else {
            openBar({ listen: true });
          }
          break;
        }
      };
      rec.onerror = err => {
        if (err?.error === 'not-allowed' || err?.error === 'service-not-allowed') {
          setWake(false);
          host.toast('需要麦克风权限才能开启语音唤醒');
        }
      };
      rec.onend = () => {
        wakeRec = null;
        if (wakeOn && !listening && !document.hidden) {
          wakeTimer = setTimeout(startWakeLoop, 450);
        }
      };
      wakeRec = rec;
      rec.start();
    } catch {
      wakeRec = null;
    }
  }

  function setWake(on, silent = false) {
    if (on && !SpeechRec) {
      if (!silent) host.toast('当前环境不支持语音唤醒，长按底线可直接输入指令');
      wakeOn = false;
      syncWakeUi();
      return false;
    }
    wakeOn = !!on;
    try { localStorage.setItem(WAKE_KEY, wakeOn ? '1' : '0'); } catch {}
    syncWakeUi();
    if (wakeOn) startWakeLoop(); else stopWake();
    return true;
  }

  function stopListening() {
    if (activeRec) { try { activeRec.stop(); } catch {} activeRec = null; }
    setBarListening(false);
    if (wakeOn) startWakeLoop();
  }

  function startListening() {
    if (!SpeechRec) {
      host.toast('当前环境不支持语音，可直接打字执行');
      document.getElementById('cmd-input')?.focus();
      return false;
    }
    stopWake();
    if (activeRec) { stopListening(); return false; }
    const input = document.getElementById('cmd-input');
    try {
      const rec = new SpeechRec();
      rec.lang = 'zh-CN';
      rec.continuous = false;
      rec.interimResults = true;
      let latest = '';
      rec.onstart = () => setBarListening(true);
      rec.onresult = e => {
        let interim = '', fin = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0]?.transcript || '';
          if (e.results[i].isFinal) fin += t; else interim += t;
        }
        latest = (fin || interim).trim();
        if (input && latest) input.value = latest;
        if (fin.trim()) {
          const clean = fin.trim().replace(WAKE_RE, '$1').trim() || fin.trim();
          stopListening();
          run(clean);
        }
      };
      rec.onerror = err => {
        setBarListening(false);
        activeRec = null;
        if (err?.error === 'not-allowed' || err?.error === 'service-not-allowed') {
          host.toast('未获得麦克风权限，可直接输入指令');
        }
        if (wakeOn) startWakeLoop();
      };
      rec.onend = () => {
        activeRec = null;
        setBarListening(false);
        if (wakeOn) startWakeLoop();
      };
      activeRec = rec;
      rec.start();
      return true;
    } catch {
      setBarListening(false);
      return false;
    }
  }

  function openBar({ listen = false, prefill = '' } = {}) {
    const mask = document.getElementById('command-mask');
    const input = document.getElementById('cmd-input');
    if (!mask || !input) return;
    host.closeMenus?.();
    mask.classList.remove('hidden');
    if (prefill) input.value = prefill;
    else if (!listen) input.value = '';
    syncWakeUi();
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
    if (listen) startListening();
  }

  function closeBar(refocus = false) {
    const mask = document.getElementById('command-mask');
    if (!mask || mask.classList.contains('hidden')) return false;
    stopListening();
    mask.classList.add('hidden');
    if (refocus) document.getElementById('spatial-bar')?.focus();
    return true;
  }

  async function undoLast() {
    const fn = undoStack.pop();
    if (!fn) { host.toast('没有可撤销的操作'); return false; }
    await fn();
    host.toast('已恢复刚才的状态');
    return true;
  }

  async function run(raw) {
    const text = String(raw || '').trim();
    if (!text) return { ok: false, count: 0 };
    const ctx = host.context();
    let ops = parseNaturalCommands(text, ctx);
    if (!ops.length && aiConfigured()) {
      host.toast('正在理解…', 1800);
      ops = await aiFallbackPlan(text, ctx);
    }
    if (!ops.length) {
      host.toast('试试说「字大一点、开护眼」「去星海看暮色」或「打开书名」', 3000);
      return { ok: false, count: 0 };
    }
    if (ops.length === 1 && ops[0].op === 'undo') {
      closeBar(false);
      const ok = await undoLast();
      return { ok, count: ok ? 1 : 0, ops };
    }

    const snap = host.snapshot();
    const notes = [];
    let undoable = false;
    for (const a of ops) {
      if (a.op === 'wake') {
        const ok = setWake(a.on);
        if (ok) notes.push(a.on ? '已开启语音唤醒（说「Zone…」）' : '已关闭语音唤醒');
        continue;
      }
      const res = await host.exec(a);
      if (res?.label) notes.push(res.label);
      if (res?.undoable) undoable = true;
    }
    if (undoable) {
      undoStack.push(() => host.restore(snap));
      if (undoStack.length > 16) undoStack.shift();
    }
    closeBar(false);
    if (notes.length) {
      host.toast(notes.join(' · '), undoable ? 4200 : 2400, undoable ? () => undoLast() : null);
    }
    return { ok: notes.length > 0, count: notes.length, ops, labels: notes };
  }

  // 绑定轻量声控条事件
  const mask = document.getElementById('command-mask');
  const form = document.getElementById('command-form');
  const input = document.getElementById('cmd-input');
  mask?.addEventListener('click', e => { if (e.target === mask) closeBar(true); });
  form?.addEventListener('submit', e => { e.preventDefault(); run(input?.value || ''); });
  document.getElementById('cmd-mic')?.addEventListener('click', () => {
    if (listening) stopListening(); else startListening();
  });
  document.getElementById('cmd-wake')?.addEventListener('click', () => {
    const next = !wakeOn;
    if (setWake(next)) host.toast(next ? '前台语音唤醒已开，直接说「Zone…」' : '语音唤醒已关');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopWake();
    else if (wakeOn) startWakeLoop();
  });

  // 恢复已保存的唤醒偏好（仅当用户主动开过）
  try {
    if (localStorage.getItem(WAKE_KEY) === '1' && SpeechRec) { wakeOn = true; syncWakeUi(); }
  } catch {}

  return { openBar, closeBar, run, undoLast, startListening, stopListening, setWake, isOpen: () => !mask?.classList.contains('hidden') };
}
