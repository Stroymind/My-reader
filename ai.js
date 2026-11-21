// 兼容 OpenAI 的解释与问答 + 真实 BYOK 用量/充值余额估算与官方余额刷新。密钥只留在 localStorage。

const KEY = 'rr-ai';
const USAGE_KEY = 'zone-ai-usage-v2';
const DEFAULTS = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' };
const CLOUD_FALLBACK_DEFAULT = 'https://sichao-v2-server.onrender.com';

export const AI_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'glm', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'doubao', label: '豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-1-5-pro-32k-250115' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { id: 'grok', label: 'Grok', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini' },
  { id: 'claude', label: 'Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' }
];

const NEEDS_V1_RE = /^https?:\/\/(api\.openai\.com|api\.deepseek\.com|api\.siliconflow\.cn|api\.moonshot\.cn|api\.x\.ai|openrouter\.ai\/api|api\.groq\.com\/openai|dashscope\.aliyuncs\.com\/compatible-mode)$/i;

export function resolveChatEndpoint(rawBase) {
  let base = String(rawBase || '').replace(/[\s\u200b-\u200d\ufeff]+/g, '').replace(/\/+$/, '');
  if (!base) base = DEFAULTS.baseUrl;
  if (!/^https?:\/\//i.test(base)) {
    const isLan = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(base);
    base = (isLan ? 'http://' : 'https://') + base;
  }
  const low = base.toLowerCase();
  if (low.includes('api.anthropic.com')) {
    if (low.endsWith('/messages')) return { url: base, proto: 'anthropic', base };
    if (low.endsWith('/v1')) return { url: `${base}/messages`, proto: 'anthropic', base };
    return { url: `${base}/v1/messages`, proto: 'anthropic', base };
  }
  if (low.endsWith('/chat/completions')) return { url: base, proto: 'openai', base: base.replace(/\/chat\/completions$/i, '') };
  if (NEEDS_V1_RE.test(base)) return { url: `${base}/v1/chat/completions`, proto: 'openai', base: `${base}/v1` };
  return { url: `${base}/chat/completions`, proto: 'openai', base };
}

function isPrivateHostUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local')
      || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch { return false; }
}

export async function nativePostJson(url, headers = {}, payload = {}, timeoutMs = 45000) {
  const capHttp = typeof window !== 'undefined' ? window?.Capacitor?.Plugins?.CapacitorHttp : null;
  if (capHttp && typeof capHttp.post === 'function') {
    const res = await capHttp.post({
      url,
      headers: { 'Content-Type': 'application/json', ...headers },
      data: payload,
      connectTimeout: Math.min(25000, timeoutMs),
      readTimeout: timeoutMs
    });
    let data = res?.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { data = { _raw: data }; }
    }
    const status = Number(res?.status || 0);
    return { ok: status >= 200 && status < 300, status, data: data || {} };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const text = await res.text().catch(() => '');
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeGetJson(url, headers = {}, timeoutMs = 30000) {
  const capHttp = typeof window !== 'undefined' ? window?.Capacitor?.Plugins?.CapacitorHttp : null;
  if (capHttp && typeof capHttp.get === 'function') {
    const res = await capHttp.get({
      url,
      headers,
      connectTimeout: Math.min(20000, timeoutMs),
      readTimeout: timeoutMs
    });
    let data = res?.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { data = { _raw: data }; }
    }
    const status = Number(res?.status || 0);
    return { ok: status >= 200 && status < 300, status, data: data || {} };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    const text = await res.text().catch(() => '');
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

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
  try {
    const { data } = await nativePostJson(`${api}/api/byok/balance`, {
      'X-User-Api-Key': cfg.apiKey,
      'X-User-Base-Url': cfg.baseUrl || '',
      'X-User-Model': cfg.model || ''
    }, {}, 35000);
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
  }
}

export function getAiConfig() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return Object.assign({}, DEFAULTS); }
}

export function aiConfigured() { return !!String(getAiConfig().apiKey || '').trim(); }

export function saveAiConfig(patch) {
  const cur = getAiConfig();
  const rawBase = String(patch.baseUrl ?? cur.baseUrl ?? DEFAULTS.baseUrl).replace(/[\s\u200b-\u200d\ufeff]+/g, '');
  const cleanKey = patch.apiKey == null ? String(cur.apiKey || '').trim() : String(patch.apiKey).replace(/[\r\n\u200b-\u200d\ufeff]+/g, '').trim();
  const next = {
    baseUrl: rawBase || DEFAULTS.baseUrl,
    model: String(patch.model ?? cur.model ?? DEFAULTS.model).trim() || DEFAULTS.model,
    apiKey: cleanKey
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  return { baseUrl: next.baseUrl, model: next.model, hasKey: !!next.apiKey };
}

export function clearAiKey() {
  const cur = getAiConfig();
  cur.apiKey = '';
  localStorage.setItem(KEY, JSON.stringify(cur));
}

const QUOTA_ERR_RE = /(insufficient|exceeded.*quota|balance|billing|credit|欠费|余额不足|quota_exceeded)/i;

export function extractApiErrorText(data) {
  if (Array.isArray(data) && data.length) return extractApiErrorText(data[0]);
  if (data && typeof data === 'object') {
    if (data.error && typeof data.error === 'object') {
      const msg = String(data.error.message || '').trim();
      const rawMeta = typeof data.error.metadata?.raw === 'string' ? data.error.metadata.raw.trim() : '';
      if (rawMeta && !msg.includes(rawMeta)) return `${msg ? `${msg}：` : ''}${rawMeta.slice(0, 140)}`;
      if (msg) return msg;
    } else if (typeof data.error === 'string' && data.error.trim()) {
      return data.error.trim();
    }
    for (const k of ['message', 'detail', 'msg', 'error_msg', '_raw']) {
      if (typeof data[k] === 'string' && data[k].trim()) return data[k].trim().slice(0, 180);
    }
  }
  return '';
}

function formatHttpApiError(status, data, model) {
  const rawMsg = extractApiErrorText(data);
  if (status === 401) return `密钥无效或已过期（401）${rawMsg ? `：${rawMsg.slice(0, 120)}` : ''}`;
  if (status === 402) return `账号余额不足（402）${rawMsg ? `：${rawMsg.slice(0, 120)}` : ''}`;
  if (status === 403) return `无权限访问该接口或模型（403）${rawMsg ? `：${rawMsg.slice(0, 120)}` : ''}`;
  if (status === 404) return `接口地址或模型「${model}」不存在（404）${rawMsg ? `：${rawMsg.slice(0, 90)}` : ''}`;
  if (status === 429) {
    if (QUOTA_ERR_RE.test(rawMsg)) {
      return `当前 API 密钥额度已用尽（429）：${rawMsg.slice(0, 130)}。请到对应平台充值，或换用 DeepSeek / 智谱 GLM-4-Flash / 硅基流动。`;
    }
    return `服务商限流或免费额度已满（429）${rawMsg ? `：${rawMsg.slice(0, 130)}` : '（请检查该 API Key 是否有余额或免费速率已达上限）'}`;
  }
  return rawMsg || `请求失败（HTTP ${status || '未知'}）`;
}

function toAnthropicBody(messages, model, temperature) {
  const sys = [];
  const userMsgs = [];
  for (const m of messages || []) {
    if (m.role === 'system') { sys.push(String(m.content || '')); continue; }
    if (Array.isArray(m.content)) {
      const blocks = [];
      for (const part of m.content) {
        if (part?.type === 'text') blocks.push({ type: 'text', text: String(part.text || '') });
        else if (part?.type === 'image_url') {
          const u = String(part.image_url?.url || '');
          const dm = u.match(/^data:(image\/[^;]+);base64,(.+)$/s);
          if (dm) blocks.push({ type: 'image', source: { type: 'base64', media_type: dm[1], data: dm[2] } });
        }
      }
      userMsgs.push({ role: m.role || 'user', content: blocks.length ? blocks : [{ type: 'text', text: '' }] });
    } else {
      userMsgs.push({ role: m.role || 'user', content: String(m.content || '') });
    }
  }
  const body = { model, max_tokens: 2048, temperature, messages: userMsgs.length ? userMsgs : [{ role: 'user', content: '你好' }] };
  if (sys.length) body.system = sys.join('\n\n');
  return body;
}

export async function complete(messages, override) {
  const cfg = Object.assign({}, getAiConfig(), override || {});
  const apiKey = String(cfg.apiKey || '').replace(/[\r\n\u200b-\u200d\ufeff]+/g, '').trim();
  if (!apiKey) {
    const err = new Error('尚未配置密钥');
    err.code = 'NO_KEY';
    throw err;
  }
  const model = String(cfg.model || DEFAULTS.model).trim() || DEFAULTS.model;
  const { url: endpoint, proto } = resolveChatEndpoint(cfg.baseUrl);
  if (!/^https?:\/\//i.test(endpoint)) throw new Error('接口地址需要以 http:// 或 https:// 开头');

  const recordAndReturn = (text, reasoning, pt, ct, tt) => {
    const out = String(text || '').trim();
    if (!out) throw new Error('模型没有返回文字');
    const estIn = Math.ceil(JSON.stringify(messages).length * 0.45);
    const estOut = Math.ceil((out.length + String(reasoning || '').length) * 0.65);
    const realTotal = Number(tt || (Number(pt || 0) + Number(ct || 0)));
    recordAiUsage(
      realTotal > 0 ? { promptTokens: Number(pt || 0), completionTokens: Number(ct || 0), totalTokens: realTotal } : { promptTokens: estIn, completionTokens: estOut, totalTokens: estIn + estOut },
      model
    );
    return reasoning ? `<think>${String(reasoning).trim()}</think>\n${out}` : out;
  };

  let directErr = '';
  try {
    const headers = proto === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: 'Bearer ' + apiKey };
    const body = proto === 'anthropic'
      ? toAnthropicBody(messages, model, 0.3)
      : { model, temperature: 0.3, messages };
    let res = await nativePostJson(endpoint, headers, body, 45000);
    // 瞬时 429 速率限制自动退避重试 1 次（若是明确余额/配额耗尽则不浪费时间直接提示）
    if (res.status === 429 && !QUOTA_ERR_RE.test(extractApiErrorText(res.data))) {
      await new Promise(r => setTimeout(r, 1500));
      res = await nativePostJson(endpoint, headers, body, 45000);
    }
    if (!res.ok) {
      const apiErr = new Error(formatHttpApiError(res.status, res.data, model));
      apiErr.isHttpApiError = true;
      throw apiErr;
    }
    if (proto === 'anthropic') {
      const blocks = Array.isArray(res.data?.content) ? res.data.content : [];
      const text = blocks.filter(b => b?.type === 'text').map(b => b.text || '').join('\n').trim();
      const u = res.data?.usage || {};
      return recordAndReturn(text, '', u.input_tokens || 0, u.output_tokens || 0, (u.input_tokens || 0) + (u.output_tokens || 0));
    }
    const msgObj = res.data?.choices?.[0]?.message || {};
    const u = res.data?.usage || {};
    return recordAndReturn(msgObj.content, msgObj.reasoning_content, u.prompt_tokens || 0, u.completion_tokens || 0, u.total_tokens || 0);
  } catch (err) {
    if (err?.isHttpApiError) throw err;
    directErr = err?.name === 'AbortError' ? '直连超时' : String(err?.message || '直连失败');
  }

  // 若手机直连公网接口失败（如跨境网络/CORS），自动走无状态云端 BYOK 中转重试（0 平台额度、不保存 Key）
  const cloudApi = (() => {
    try { return String(override?.cloudApi || localStorage.getItem('zone-sichao-api') || CLOUD_FALLBACK_DEFAULT).replace(/\/+$/, ''); }
    catch { return CLOUD_FALLBACK_DEFAULT; }
  })();
  if (cloudApi && !isPrivateHostUrl(endpoint)) {
    try {
      const proxyRes = await nativePostJson(
        `${cloudApi}/api/byok/chat`,
        { 'X-User-Api-Key': apiKey, 'X-User-Base-Url': cfg.baseUrl || '', 'X-User-Model': model },
        { messages, temperature: 0.3 },
        55000
      );
      if (proxyRes.ok && proxyRes.data?.ok) {
        const u = proxyRes.data.usage || {};
        return recordAndReturn(proxyRes.data.content, proxyRes.data.reasoning, u.prompt_tokens || 0, u.completion_tokens || 0, u.total_tokens || 0);
      }
      if (proxyRes.data?.error) {
        throw new Error(formatHttpApiError(proxyRes.data.status || proxyRes.status, { error: proxyRes.data.error }, model));
      }
    } catch (pErr) {
      if (pErr?.message && /401|402|403|404|429|密钥|余额|模型/.test(pErr.message)) throw pErr;
      throw new Error(`无法连接接口（${endpoint}）：${directErr}；云端中转失败：${pErr?.name === 'AbortError' ? '超时' : (pErr?.message || '网络不可用')}`);
    }
  }
  throw new Error(`无法连接接口（${endpoint}）：${directErr}。请检查网络与接口地址。`);
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
