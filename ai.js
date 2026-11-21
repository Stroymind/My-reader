// 兼容 OpenAI 的解释与问答。密钥只留在 localStorage，调用方在没有密钥时走本地要点。

const KEY = 'rr-ai';
const USAGE_KEY = 'zone-ai-usage-v1';
const DEFAULTS = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' };

function todayTag() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthTag() {
  return todayTag().slice(0, 7);
}
export function getAiUsage() {
  const def = { month: monthTag(), day: todayTag(), todayTokens: 0, monthTokens: 0, calls: 0, budget: 1000000, lastModel: '' };
  try {
    const u = Object.assign({}, def, JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'));
    if (u.month !== monthTag()) { u.month = monthTag(); u.monthTokens = 0; u.calls = 0; }
    if (u.day !== todayTag()) { u.day = todayTag(); u.todayTokens = 0; }
    return u;
  } catch { return def; }
}
export function recordAiUsage(tokens, model = '') {
  const n = Math.max(0, Math.round(Number(tokens) || 0));
  const u = getAiUsage();
  u.todayTokens += n;
  u.monthTokens += n;
  u.calls += 1;
  if (model) u.lastModel = model;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch {}
  return u;
}
export function setAiBudget(tokens) {
  const u = getAiUsage();
  u.budget = Math.max(10000, Math.round(Number(tokens) || 1000000));
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch {}
  return u;
}
export function resetAiUsage() {
  const u = getAiUsage();
  u.todayTokens = 0; u.monthTokens = 0; u.calls = 0;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch {}
  return u;
}

export function getAiConfig() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return Object.assign({}, DEFAULTS); }
}

export function aiConfigured() { return !!getAiConfig().apiKey; }

export function saveAiConfig(patch) {
  const cur = getAiConfig();
  const next = {
    baseUrl: String(patch.baseUrl ?? cur.baseUrl ?? DEFAULTS.baseUrl).trim() || DEFAULTS.baseUrl,
    model: String(patch.model ?? cur.model ?? DEFAULTS.model).trim() || DEFAULTS.model,
    apiKey: patch.apiKey == null ? cur.apiKey : String(patch.apiKey)
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  return { baseUrl: next.baseUrl, model: next.model, hasKey: !!next.apiKey };
}

export function clearAiKey() {
  const cur = getAiConfig();
  cur.apiKey = '';
  localStorage.setItem(KEY, JSON.stringify(cur));
}

export async function complete(messages, override) {
  const cfg = Object.assign({}, getAiConfig(), override || {});
  if (!cfg.apiKey) {
    const err = new Error('尚未配置密钥');
    err.code = 'NO_KEY';
    throw err;
  }
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('接口地址需要以 http:// 或 https:// 开头');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let res;
  let data = {};
  try {
    res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model || DEFAULTS.model, temperature: 0.3, messages }),
      signal: ctrl.signal
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('模型太久没有回应。');
    throw new Error('网络请求没有发出去。请检查接口地址，或稍后再试。');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(data?.error?.message || ('请求失败（' + res.status + '）'));
  const msgObj = data?.choices?.[0]?.message || {};
  const text = msgObj.content;
  const reasoning = msgObj.reasoning_content;
  if (!text) throw new Error('模型没有返回文字');
  const out = String(text).trim();
  const realTotal = Number(data?.usage?.total_tokens || 0);
  const est = Math.ceil((JSON.stringify(messages).length + out.length + String(reasoning || '').length) * 0.6);
  recordAiUsage(realTotal > 0 ? realTotal : est, cfg.model || DEFAULTS.model);
  return reasoning ? `<think>${String(reasoning).trim()}</think>\n${out}` : out;
}

export function explainText(quote, context = '') {
  return complete([
    { role: 'system', content: '你是阅读助手。用简体中文解释用户选中的文字。先用一句大白话说出意思，再给两到三个理解角度，并点出其中的概念。不要编造选段里没有的情节。全部控制在 220 字以内。' },
    { role: 'user', content: `${context ? '出处：' + context + '\n\n' : ''}选中文字：\n${quote}` }
  ]);
}

export function askText(question, quote, context = '') {
  return complete([
    { role: 'system', content: '你是个人知识助手。只根据给出的摘录和笔记用简体中文回答，语气直接。回答里点明依据来自摘录的哪一句。材料不够时直接说不够，不要补故事。' },
    { role: 'user', content: `摘录：\n${quote}\n\n${context ? '笔记：\n' + context + '\n\n' : ''}问题：${question}` }
  ]);
}

export function testAi(override) {
  return complete([{ role: 'user', content: '只回复这四个字：已经连通' }], override);
}

export async function transcribeAudio(base64, mimeType = 'audio/mp4') {
  const cfg = getAiConfig();
  if (!cfg.apiKey) {
    const err = new Error('尚未配置密钥');
    err.code = 'NO_KEY';
    throw err;
  }
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('接口地址需要以 http:// 或 https:// 开头');
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const fd = new FormData();
  fd.append('file', blob, 'voice.m4a');
  const lower = base.toLowerCase();
  const sttModel = lower.includes('siliconflow') ? 'FunAudioLLM/SenseVoiceSmall'
    : lower.includes('groq') ? 'whisper-large-v3-turbo'
      : 'whisper-1';
  fd.append('model', sttModel);
  fd.append('language', 'zh');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let res, data = {};
  try {
    res = await fetch(base + '/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.apiKey },
      body: fd,
      signal: ctrl.signal
    });
    data = await res.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(data?.error?.message || ('语音识别失败（' + res.status + '）'));
  return String(data?.text || '').trim();
}
