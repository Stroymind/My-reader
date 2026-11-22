// Zbot OpenBot 级模块化 Agent 运行时：
// 1) 云端 BYOK 原生 Function Calling + 真 SSE 流式事件（step_start / step / delta / done）
// 2) 直连模型真 SSE 逐字流式输出（OpenAI / Gemini / OpenRouter / Grok / Groq / Claude / 本机订阅桥）
// 3) 移动端 CapacitorHttp 或非流式接口自动平滑回退，零中断

import { complete as aiComplete, getAiConfig, nativePostJson, recordAiUsage, resolveChatEndpoint } from './ai.js';

const NO_TEMP_RE = /(?:^|\/)(?:o1|o3|o4|gpt-5|codex)/i;

const TOOL_LABEL_MAP = {
  web_search: '联网检索',
  github_search: '检索 GitHub',
  arxiv_search: '检索论文',
  wikipedia_search: '查阅百科',
  fetch_url: '读取网页',
  get_current_time: '核对时间'
};

export function formatToolStepLabel(toolName = '', arg = '') {
  const name = String(toolName || '').trim();
  const base = TOOL_LABEL_MAP[name]
    || (name.startsWith('mcp:') ? `调用 MCP · ${name.split(':').pop()}` : (name.includes('_') ? `调用 ${name.split('_')[0]}` : (name || '执行工具')));
  const cleanArg = String(arg || '').replace(/\s+/g, ' ').trim();
  return cleanArg ? `${base}：${cleanArg.slice(0, 26)}` : base;
}

export function createSseParser(onData) {
  let buf = '';
  return {
    push(chunk) {
      if (!chunk) return;
      buf += String(chunk).replace(/\r\n/g, '\n');
      let sep = buf.indexOf('\n\n');
      while (sep !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const lines = frame.split('\n');
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length) {
          const payload = dataLines.join('\n').trim();
          if (payload && payload !== '[DONE]') onData(payload);
        }
        sep = buf.indexOf('\n\n');
      }
    },
    flush() {
      const rem = buf.trim();
      buf = '';
      if (!rem) return;
      for (const line of rem.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') onData(payload);
      }
    }
  };
}

export async function streamCloudByokAgent({
  cloudApi = '',
  cfg = getAiConfig(),
  messages = [],
  rules = '',
  memory = '',
  extPlugins = [],
  connectors = [],
  maxSteps = 4,
  onStatus = null,
  onStepStart = null,
  onStep = null,
  onDelta = null,
  signal = null
} = {}) {
  const api = String(cloudApi || '').replace(/\/+$/, '');
  if (!api || !cfg?.apiKey) return null;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'X-User-Api-Key': cfg.apiKey || '',
    'X-User-Base-Url': cfg.baseUrl || '',
    'X-User-Model': cfg.model || ''
  };
  const bodyObj = {
    messages,
    rules: rules || '',
    memory: memory || '',
    ext_plugins: extPlugins || [],
    connectors: connectors || [],
    max_steps: maxSteps
  };

  // 优先尝试真实 SSE 流式端点 /api/agent/stream
  if (typeof fetch === 'function' && typeof TextDecoder === 'function') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 78000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      const res = await fetch(`${api}/api/agent/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyObj),
        signal: ctrl.signal
      });
      if (res.ok && res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let doneData = null;
        let accReply = '';
        const steps = [];
        const sources = [];
        const parser = createSseParser(raw => {
          let ev = null;
          try { ev = JSON.parse(raw); } catch { return; }
          if (!ev || typeof ev !== 'object') return;
          if (ev.type === 'status') {
            onStatus?.(String(ev.text || '思考中…'));
          } else if (ev.type === 'step_start') {
            onStepStart?.(ev);
          } else if (ev.type === 'step') {
            steps.push({ tool: ev.tool, label: ev.label, arg: ev.arg, preview: ev.preview });
            if (Array.isArray(ev.sources)) sources.push(...ev.sources);
            onStep?.(ev);
          } else if (ev.type === 'delta') {
            const chunk = String(ev.text || '');
            if (chunk) {
              accReply += chunk;
              onDelta?.(chunk, accReply);
            }
          } else if (ev.type === 'done') {
            doneData = ev;
          }
        });
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
        parser.flush();
        if (doneData?.ok && (doneData.reply || accReply)) {
          const finalReply = String(doneData.reply || accReply);
          const usage = doneData.usage || {};
          if (usage.total_tokens > 0) {
            recordAiUsage(usage, cfg.model || '');
          } else {
            recordAiUsage(Math.ceil((JSON.stringify(messages).length + finalReply.length + steps.length * 400) * 0.65), cfg.model || '');
          }
          return {
            ok: true,
            reply: finalReply,
            steps: Array.isArray(doneData.steps) ? doneData.steps : steps,
            sources: Array.isArray(doneData.sources) ? doneData.sources : sources,
            usage,
            mode: doneData.mode || 'native_tools'
          };
        }
        if (doneData && doneData.ok === false) return null;
      }
    } catch {
      if (signal?.aborted) return { ok: false, aborted: true, reply: '', steps: [], sources: [] };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  // 回退到稳定 JSON 端点 /api/agent/run（兼容 CapacitorHttp 或不支持流式的网络）
  try {
    const r = await nativePostJson(`${api}/api/agent/run`, {
      'X-User-Api-Key': cfg.apiKey || '',
      'X-User-Base-Url': cfg.baseUrl || '',
      'X-User-Model': cfg.model || ''
    }, bodyObj, 72000);
    const data = r.data;
    if (!r.ok || !data?.ok || !data.reply) return null;
    if (data.usage?.total_tokens > 0) {
      recordAiUsage(data.usage, cfg.model || '');
    } else {
      const stepsLen = Array.isArray(data.steps) ? data.steps.length : 0;
      recordAiUsage(Math.ceil((JSON.stringify(messages).length + data.reply.length + stepsLen * 400) * 0.65), cfg.model || '');
    }
    return data;
  } catch {
    return null;
  }
}

export async function streamDirectByokChat({
  cfg = getAiConfig(),
  messages = [],
  temperature = 0.25,
  onDelta = null,
  signal = null
} = {}) {
  const key = String(cfg?.apiKey || '').trim();
  if (!key) throw new Error('请先配置你的 AI API Key');
  const { url, proto } = resolveChatEndpoint(cfg.baseUrl, cfg.model);
  const canStreamDirect = typeof fetch === 'function'
    && typeof TextDecoder === 'function'
    && proto !== 'openai-responses';

  if (canStreamDirect) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 65000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      let headers;
      let payload;
      if (proto === 'anthropic') {
        const sysParts = [];
        const antMsgs = [];
        for (const m of messages) {
          if (m.role === 'system') sysParts.push(String(m.content || ''));
          else antMsgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
        }
        headers = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        };
        payload = {
          model: cfg.model,
          max_tokens: 2048,
          temperature,
          stream: true,
          messages: antMsgs.length ? antMsgs : [{ role: 'user', content: '你好' }],
          ...(sysParts.length ? { system: sysParts.join('\n\n') } : {})
        };
      } else {
        headers = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${key}`
        };
        payload = {
          model: cfg.model,
          messages,
          stream: true,
          ...(NO_TEMP_RE.test(cfg.model || '') ? {} : { temperature })
        };
      }

      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && res.body && typeof res.body.getReader === 'function' && ctype.includes('event-stream')) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let acc = '';
        let usage = null;
        const parser = createSseParser(raw => {
          let ev = null;
          try { ev = JSON.parse(raw); } catch { return; }
          if (!ev || typeof ev !== 'object') return;
          if (proto === 'anthropic') {
            if (ev.type === 'content_block_delta' && ev.delta?.text) {
              acc += ev.delta.text;
              onDelta?.(ev.delta.text, acc);
            } else if (ev.type === 'message_delta' && ev.usage) {
              usage = { completion_tokens: Number(ev.usage.output_tokens || 0) };
            }
          } else {
            const delta = ev.choices?.[0]?.delta?.content || '';
            if (delta) {
              acc += delta;
              onDelta?.(delta, acc);
            }
            if (ev.usage?.total_tokens) usage = ev.usage;
          }
        });
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
        parser.flush();
        if (acc.trim()) {
          if (usage?.total_tokens > 0) recordAiUsage(usage, cfg.model || '');
          else recordAiUsage(Math.ceil((JSON.stringify(messages).length + acc.length) * 0.5), cfg.model || '');
          return acc.trim();
        }
      }
    } catch {
      if (signal?.aborted) return '';
      // 若浏览器跨域拦截或原生 WebView 需走 CapacitorHttp，自动回退到 aiComplete()
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  return String(await aiComplete(messages) || '').trim();
}
