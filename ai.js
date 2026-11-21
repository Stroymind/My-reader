// 兼容 OpenAI 的解释与问答 + 真实 BYOK 用量/充值余额估算与官方余额刷新。密钥只留在 localStorage。

const KEY = 'rr-ai';
const USAGE_KEY = 'zone-ai-usage-v2';
const DEFAULTS = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' };

// 常见主流模型官方公开单价参考（每百万 tokens：in=输入, out=输出）
const MODEL_PRICES = [
  { re: /deepseek[-_]?reasoner|deepseek[-_]?r1/i, currency: 'CNY', inPerM: 4.0, outPerM: 16.0, label: 'DeepSeek R1' },
  { re: /deepseek/i, currency: 'CNY', inPerM: 2.0, outPerM: 3.0, label: 'DeepSeek Chat' },
  { re: /qwen[-_]?max/i, currency: 'CNY', inPerM: 2.4, outPerM: 9.6, label: 'Qwen Max' },
  { re: /qwen/i, currency: 'CNY', inPerM: 0.8, outPerM: 2.0, label: 'Qwen' },
  { re: /glm|zhipu/i, currency: 'CNY', inPerM: 1.0, outPerM: 2.0, label: 'GLM' },
  { re: /moonshot|kimi/i, currency: 'CNY', inPerM: 2.0, outPerM: 10.0, label: 'Kimi' },
  { re: /doubao/i, currency: 'CNY', inPerM: 0.8, outPerM: 2.0, label: '豆包' },
  { re: /gpt-4o-mini|gpt-4\.1-mini|gpt-4\.1-nano/i, currency: 'USD', inPerM: 0.15, outPerM: 0.60, label: 'GPT Mini' },
  { re: /gpt-4o|gpt-4\.1|gpt-5/i, currency: 'USD', inPerM: 2.50, outPerM: 10.0, label: 'GPT Flagship' },
  { re: /claude.*haiku/i, currency: 'USD', inPerM: 0.80, outPerM: 4.0, label: 'Claude Haiku' },
  { re: /claude.*sonnet/i, currency: 'USD', inPerM: 3.0, outPerM: 15.0, label: 'Claude Sonnet' },
  { re: /claude.*opus/i, currency: 'USD', inPerM: 15.0, outPerM: 75.0, label: 'Claude Opus' },
  { re: /gemini.*flash/i, currency: 'USD', inPerM: 0.15, outPerM: 0.60, label: 'Gemini Flash' },
  { re: /gemini.*pro/i, currency: 'USD', inPerM: 1.25, outPerM: 10.0, label: 'Gemini Pro' },
  { re: /grok/i, currency: 'USD', inPerM: 3.0, outPerM: 15.0, label: 'Grok' }
];

export function getModelPricing(model = '', baseUrl = '') {
  const m = String(model || getAiConfig().model || '');
  const b = String(baseUrl || getAiConfig().baseUrl || '').toLowerCase();
  const hit = MODEL_PRICES.find(p => p.re.test(m));
  if (hit) return hit;
  if (/(deepseek|siliconflow|dashscope|moonshot|bigmodel|volces|baichuan|minimax)/.test(b)) {
    return { currency: 'CNY', inPerM: 2.0, outPerM: 4.0, label: '国内通用估算' };
  }
  return { currency: 'USD', inPerM: 0.50, outPerM: 1.50, label: '通用估算' };
}

function todayTag() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthTag() {
  return todayTag().slice(0, 7);
}
export function getAiUsage() {
  const cfg = getAiConfig();
  const pr = getModelPricing(cfg.model, cfg.baseUrl);
  const def = {
    month: monthTag(),
    day: todayTag(),
    todayTokens: 0,
    monthTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    calls: 0,
    budget: 1000000,
    rechargeAmount: 0,
    currency: pr.currency,
    spentEstimated: 0,
    liveBalance: null,
    liveCurrency: pr.currency,
    liveProvider: '',
    liveUpdatedAt: 0,
    lastModel: ''
  };
  try {
    const u = Object.assign({}, def, JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'));
    if (u.month !== monthTag()) { u.month = monthTag(); u.monthTokens = 0; u.calls = 0; }
    if (u.day !== todayTag()) { u.day = todayTag(); u.todayTokens = 0; }
    return u;
  } catch { return def; }
}
function saveAiUsage(u) {
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch {}
}
export function recordAiUsage(tokensOrObj, model = '') {
  const u = getAiUsage();
  let pt = 0;
  let ct = 0;
  let tt = 0;
  let mod = model;
  if (tokensOrObj && typeof tokensOrObj === 'object') {
    pt = Math.max(0, Math.round(Number(tokensOrObj.promptTokens ?? tokensOrObj.prompt_tokens ?? 0)));
    ct = Math.max(0, Math.round(Number(tokensOrObj.completionTokens ?? tokensOrObj.completion_tokens ?? 0)));
    tt = Math.max(0, Math.round(Number(tokensOrObj.totalTokens ?? tokensOrObj.total_tokens ?? (pt + ct))));
    if (!pt && !ct && tt > 0) { pt = Math.round(tt * 0.7); ct = tt - pt; }
    mod = tokensOrObj.model || model || u.lastModel;
  } else {
    tt = Math.max(0, Math.round(Number(tokensOrObj) || 0));
    pt = Math.round(tt * 0.7);
    ct = tt - pt;
  }
  const pricing = getModelPricing(mod || getAiConfig().model, getAiConfig().baseUrl);
  const rawCost = (pt / 1000000) * pricing.inPerM + (ct / 1000000) * pricing.outPerM;
  // 若币种不一致按 1 USD ≈ 7.2 CNY 粗略换算
  let deltaCost = rawCost;
  if (pricing.currency !== u.currency) {
    deltaCost = pricing.currency === 'USD' && u.currency === 'CNY' ? rawCost * 7.2 : rawCost / 7.2;
  }
  u.todayTokens += tt;
  u.monthTokens += tt;
  u.promptTokens += pt;
  u.completionTokens += ct;
  u.spentEstimated = Number((Number(u.spentEstimated || 0) + deltaCost).toFixed(6));
  u.calls += 1;
  if (mod) u.lastModel = mod;
  saveAiUsage(u);
  return u;
}
export function setAiBudget(tokens) {
  const u = getAiUsage();
  u.budget = Math.max(10000, Math.round(Number(tokens) || 1000000));
  saveAiUsage(u);
  return u;
}
export function setRechargeBalance(amount, currency) {
  const u = getAiUsage();
  u.rechargeAmount = Math.max(0, Number(amount) || 0);
  if (currency === 'CNY' || currency === 'USD') u.currency = currency;
  u.spentEstimated = 0;
  saveAiUsage(u);
  return u;
}
export function resetAiUsage() {
  const u = getAiUsage();
  u.todayTokens = 0;
  u.monthTokens = 0;
  u.promptTokens = 0;
  u.completionTokens = 0;
  u.spentEstimated = 0;
  u.calls = 0;
  saveAiUsage(u);
  return u;
}

export async function fetchLiveBalance(cloudApiBase) {
  const cfg = getAiConfig();
  if (!cfg.apiKey) return { ok: false, supported: false, reason: '请先填入你的 API Key' };
  const api = String(cloudApiBase || '').replace(/\/+$/, '');
  if (!api) return { ok: false, supported: false, reason: '未配置云端代理地址' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 35000);
  try {
    const r = await fetch(`${api}/api/byok/balance`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Api-Key': cfg.apiKey,
        'X-User-Base-Url': cfg.baseUrl || '',
        'X-User-Model': cfg.model || ''
      }
    });
    const data = await r.json().catch(() => ({}));
    if (data?.ok && data.balance != null) {
      const u = getAiUsage();
      u.liveBalance = Number(data.balance);
      u.liveCurrency = data.currency === 'USD' ? 'USD' : 'CNY';
      u.liveProvider = String(data.provider || '');
      u.liveUpdatedAt = Date.now();
      if (!u.rechargeAmount && u.liveBalance > 0) {
        u.rechargeAmount = Number(u.liveBalance.toFixed(2));
        u.currency = u.liveCurrency;
      }
      saveAiUsage(u);
    }
    return data;
  } catch (err) {
    return { ok: false, supported: false, reason: err?.name === 'AbortError' ? '云端节点正在冷启动，请稍后重试' : (err?.message || '网络异常') };
  } finally {
    clearTimeout(timer);
  }
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
  const timer = setTimeout(() => ctrl.abort(), 30000);
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
  const pt = Number(data?.usage?.prompt_tokens || 0);
  const ct = Number(data?.usage?.completion_tokens || 0);
  const realTotal = Number(data?.usage?.total_tokens || (pt + ct));
  const estIn = Math.ceil(JSON.stringify(messages).length * 0.55);
  const estOut = Math.ceil((out.length + String(reasoning || '').length) * 0.65);
  recordAiUsage(
    realTotal > 0 ? { promptTokens: pt, completionTokens: ct, totalTokens: realTotal } : { promptTokens: estIn, completionTokens: estOut, totalTokens: estIn + estOut },
    cfg.model || DEFAULTS.model
  );
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
  if (!res.ok) throw new Error(data?.error?.message || `语音识别失败（${res.status}）`);
  return String(data?.text || '').trim();
}
