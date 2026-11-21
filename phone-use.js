// Zone 手机控屏引擎 (Phone-Use Agent) — 纯 BYOK（仅消耗用户自有 API 额度）
// 通过 Android 原生 ZonePhoneUse 无障碍服务 + 极简黑曜石悬浮球实现：
// 观察屏幕控件树 → 用户 AI 规划下一步 → 敏感动作强确认 → 执行点击/滑动/输入/切换 App → 紧急随时暂停。

import { aiConfigured, complete } from './ai.js';
import { createNote } from './knowledge.js';

const DANGER_RE = /(付款|支付|转账|确认支付|立即购买|提交订单|下单|免密|删除|清空|注销|卸载|发送|群发|发布|转账给|pay|checkout|delete|remove|send|confirm order)/i;
const MAX_STEPS = 12;

function plugin() {
  return window?.Capacitor?.Plugins?.ZonePhoneUse || null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function getPhoneUseStatus() {
  const p = plugin();
  if (!p) return { available: false, enabled: false, foregroundPkg: '', stopRequested: false };
  try {
    return await p.getStatus();
  } catch {
    return { available: false, enabled: false, foregroundPkg: '', stopRequested: false };
  }
}

export async function openPhoneUseSettings() {
  const p = plugin();
  if (!p) return false;
  try {
    await p.openAccessibilitySettings();
    return true;
  } catch {
    return false;
  }
}

function parseAgentStep(raw) {
  const txt = String(raw || '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function isDangerousStep(step, nodes) {
  if (!step) return '';
  if (step.action === 'confirm' || step.dangerReason) return step.dangerReason || step.thought || '敏感操作';
  if (step.text && DANGER_RE.test(step.text)) return `即将输入敏感内容：${step.text.slice(0, 24)}`;
  if (step.action === 'tap' || step.action === 'long_press') {
    const x = Number(step.x || 0), y = Number(step.y || 0);
    const hit = (nodes || []).find(n => Math.hypot((n.cx || 0) - x, (n.cy || 0) - y) < 64);
    const label = `${hit?.text || ''} ${hit?.desc || ''}`.trim();
    if (label && DANGER_RE.test(label)) return `即将点击「${label.slice(0, 24)}」`;
  }
  return '';
}

function summarizeScreenNodes(screen) {
  const nodes = (screen?.nodes || []).slice(0, 90);
  return JSON.stringify({
    pkg: screen?.pkg || '',
    w: screen?.w || 1080,
    h: screen?.h || 2400,
    nodes
  });
}

export async function runPhoneUseTask(goal, { onStatus, onConfirm, onNeedAi, onNoteSaved } = {}) {
  const p = plugin();
  if (!p) {
    onStatus?.('手机控屏仅在 Android 版 Zone APK 中可用');
    return { ok: false, reason: 'not-native' };
  }
  const st = await getPhoneUseStatus();
  if (!st.enabled) {
    const go = await onConfirm?.('开启「Zone 手机控屏」无障碍权限？开启后，AI 即可在你授权下代为操作手机应用（随时可点悬浮球停止）。');
    if (go) await openPhoneUseSettings();
    return { ok: false, reason: 'need-accessibility' };
  }
  if (!aiConfigured()) {
    onStatus?.('请先填入你自己的 AI API Key（纯 BYOK，不消耗平台额度）');
    onNeedAi?.();
    return { ok: false, reason: 'need-ai' };
  }

  await p.resetStop();
  await p.setOverlay({ visible: true, text: '启动中（点此停止）' });
  const history = [];
  let finalSummary = '';

  try {
    for (let stepIdx = 1; stepIdx <= MAX_STEPS; stepIdx++) {
      const curSt = await p.getStatus();
      if (curSt?.stopRequested) {
        finalSummary = '已由悬浮球手动停止控屏';
        break;
      }

      await p.setOverlay({ visible: true, text: `第 ${stepIdx} 步 · 观察屏幕` });
      const screen = await p.dumpScreen();
      const screenJson = summarizeScreenNodes(screen);

      await p.setOverlay({ visible: true, text: `第 ${stepIdx} 步 · AI 规划中` });
      const prompt = [
        {
          role: 'system',
          content:
            '你是 Zone 手机控屏 Agent（Android Accessibility）。根据用户目标、历史步骤和当前屏幕控件 JSON（含每个可见元素的 text/desc/c可点/e可输入/cx/cy 中心像素坐标），输出下一步唯一 JSON 动作（不要多余解释）：\n' +
            '{"thought":"简短思路","action":"open_app|tap|long_press|swipe|type|back|home|wait|save_screen_note|confirm|done","app":"应用名或包名","x":0,"y":0,"x2":0,"y2":0,"text":"要输入的文字","summary":"完成总结或笔记内容","dangerReason":"若涉及付款/转账/删除/正式发消息必须用confirm并说明原因"}\n' +
            '规则：\n1. 优先用 open_app 打开目标 App（如 微信/小红书/抖音/B站/知乎/WPS/Notion/Obsidian/浏览器/设置）。\n2. 点击元素时直接使用控件 JSON 中的 cx, cy。\n3. 遇到付款、转账、删除、正式发送外部消息时，严禁直接 tap，必须返回 action:"confirm"。\n4. 若用户想把当前屏幕内容存成 Zone 笔记，返回 action:"save_screen_note" 并把整理后的正文放进 summary。\n5. 任务完成后返回 action:"done" 并写清 summary。'
        },
        {
          role: 'user',
          content: `目标：${goal}\n已执行步骤：${JSON.stringify(history.slice(-6))}\n当前屏幕：${screenJson}`
        }
      ];

      const raw = await complete(prompt);
      const step = parseAgentStep(raw);
      if (!step || !step.action) {
        finalSummary = 'AI 未返回有效控屏指令，已安全停止';
        break;
      }

      if (step.action === 'done') {
        finalSummary = step.summary || step.thought || '已完成手机控屏任务';
        break;
      }

      if (step.action === 'save_screen_note') {
        const extracted = step.summary || (screen?.nodes || []).map(n => n.text || n.desc).filter(Boolean).join('\n');
        const note = await createNote({
          title: `控屏摘录 · ${goal.slice(0, 18)}`,
          body: extracted.slice(0, 8000),
          tags: ['控屏摘录', screen?.pkg || 'Android'].filter(Boolean)
        });
        onNoteSaved?.(note);
        finalSummary = `已将屏幕内容保存为笔记「${note.title}」`;
        break;
      }

      const danger = isDangerousStep(step, screen?.nodes);
      if (danger) {
        await p.setOverlay({ visible: true, text: '等待安全确认…' });
        await p.bringToFront();
        const ok = await onConfirm?.(`安全确认：${danger}。是否允许 Zone 继续执行？`);
        if (!ok) {
          finalSummary = '已取消敏感操作，安全停止';
          break;
        }
        if (step.action === 'confirm') {
          history.push({ step: stepIdx, action: 'confirmed', thought: danger });
          continue;
        }
      }

      await p.setOverlay({ visible: true, text: `${step.thought ? step.thought.slice(0, 14) : step.action}（点此停）` });
      await p.performAction({
        action: step.action,
        app: step.app || '',
        x: Number(step.x || 0),
        y: Number(step.y || 0),
        x2: Number(step.x2 || 0),
        y2: Number(step.y2 || 0),
        text: step.text || '',
        durationMs: Number(step.durationMs || 320)
      });
      history.push({ step: stepIdx, action: step.action, app: step.app, text: step.text, thought: step.thought });
      await sleep(step.action === 'open_app' ? 1600 : 950);
    }
  } finally {
    await p.setOverlay({ visible: false, text: '' });
    await p.bringToFront();
  }

  const msg = finalSummary || `已完成 ${history.length} 步手机控屏操作`;
  onStatus?.(msg);
  return { ok: true, summary: msg, steps: history.length };
}
