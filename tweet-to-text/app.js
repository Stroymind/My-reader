/**
 * 推文转文本 — client-side PWA
 * Content: api.fxtwitter.com → api.vxtwitter.com fallback
 * Translate: MyMemory (free) → Google gtx fallback → optional OpenAI-compatible
 */

const SETTINGS_KEY = 'ttt_settings_v1';
const HISTORY_KEY = 'ttt_history_v1';
const MAX_HISTORY = 40;
const MYMEMORY_CHUNK = 450; // stay under ~500 char free limit

const $ = (sel) => document.querySelector(sel);

const els = {
  urlInput: $('#urlInput'),
  btnFetch: $('#btnFetch'),
  status: $('#status'),
  resultCard: $('#resultCard'),
  meta: $('#meta'),
  output: $('#output'),
  btnCopy: $('#btnCopy'),
  btnSave: $('#btnSave'),
  btnShare: $('#btnShare'),
  historyList: $('#historyList'),
  historyEmpty: $('#historyEmpty'),
  btnClearHistory: $('#btnClearHistory'),
  btnSettings: $('#btnSettings'),
  settingsDialog: $('#settingsDialog'),
  settingsForm: $('#settingsForm'),
  useAi: $('#useAi'),
  aiBase: $('#aiBase'),
  aiKey: $('#aiKey'),
  aiModel: $('#aiModel'),
  preferThread: $('#preferThread'),
};

let current = null; // { id, url, author, text, paragraphs:[{orig,zh}], media, date, source }
let viewMode = 'bilingual';

/* ---------- settings ---------- */
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function fillSettingsForm() {
  const s = loadSettings();
  els.useAi.checked = !!s.useAi;
  els.aiBase.value = s.aiBase || 'https://api.openai.com/v1';
  els.aiKey.value = s.aiKey || '';
  els.aiModel.value = s.aiModel || 'gpt-4o-mini';
  els.preferThread.checked = s.preferThread !== false;
}

/* ---------- history ---------- */
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}
function pushHistory(item) {
  const list = loadHistory().filter((h) => h.id !== item.id);
  list.unshift({
    id: item.id,
    url: item.url,
    author: item.author,
    preview: (item.text || '').slice(0, 120),
    zhPreview: (item.paragraphs?.[0]?.zh || '').slice(0, 80),
    savedAt: Date.now(),
    text: item.text,
    paragraphs: item.paragraphs,
    media: item.media,
    date: item.date,
    source: item.source,
  });
  saveHistory(list);
  renderHistory();
}
function renderHistory() {
  const list = loadHistory();
  els.historyList.innerHTML = '';
  els.historyEmpty.hidden = list.length > 0;
  for (const h of list) {
    const li = document.createElement('li');
    const when = new Date(h.savedAt).toLocaleString('zh-CN', { hour12: false });
    li.innerHTML = `<div class="t">${escapeHtml(h.zhPreview || h.preview || h.url)}</div>
      <div class="s">@${escapeHtml(h.author || '?')} · ${when}</div>`;
    li.addEventListener('click', () => {
      current = h;
      showResult();
      els.urlInput.value = h.url || '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    els.historyList.appendChild(li);
  }
}

/* ---------- URL parsing ---------- */
function extractTweetUrl(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  // Prefer explicit x.com / twitter.com / mobile.twitter.com / fxtwitter etc.
  const re =
    /https?:\/\/(?:(?:www|mobile|m)\.)?(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com|fixxtwitter\.com)\/[^\s]+/i;
  const m = text.match(re);
  let url = m ? m[0] : text;
  // strip trailing punctuation common in shared text
  url = url.replace(/[)\]>,.]+$/g, '');
  return url;
}

function parseStatusId(urlOrText) {
  const url = extractTweetUrl(urlOrText);
  if (!url) return null;
  // /status/ID or /statuses/ID or /i/web/status/ID
  const m = url.match(/\/(?:status|statuses)(?:es)?\/(\d{5,30})/i) ||
            url.match(/\/i\/web\/status\/(\d{5,30})/i);
  if (m) return { id: m[1], url: normalizeXUrl(url, m[1]) };
  // bare numeric?
  const n = url.match(/^(\d{10,30})$/);
  if (n) return { id: n[1], url: `https://x.com/i/web/status/${n[1]}` };
  return null;
}

function normalizeXUrl(url, id) {
  try {
    const u = new URL(url);
    const user = u.pathname.split('/').filter(Boolean)[0];
    if (user && user !== 'i' && user !== 'status' && !/^\d+$/.test(user)) {
      return `https://x.com/${user}/status/${id}`;
    }
  } catch { /* ignore */ }
  return `https://x.com/i/web/status/${id}`;
}

/* ---------- content fetch ---------- */
async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function normalizeFxTweet(raw) {
  // Legacy: { tweet: {...} } ; /2: { status, thread, author, code } ; or tweet itself
  if (!raw) return null;
  if (raw.tweet) return raw.tweet;
  if (raw.status && (raw.status.text || raw.status.raw_text)) return raw.status;
  if (raw.text || raw.full_text || raw.raw_text) return raw;
  return null;
}

function pickTextFromFxTweet(tweet) {
  if (!tweet) return '';
  // Prefer long-form note / article body when present
  const note =
    tweet.note_tweet?.text ||
    tweet.note?.text ||
    (typeof tweet.article === 'object' && tweet.article
      ? (tweet.article.plain_language || tweet.article.content || tweet.article.title || '')
      : '') ||
    '';
  const body = tweet.text || tweet.raw_text || tweet.full_text || '';
  // If note is longer / more complete, use it; else body
  if (note && note.length >= body.length) return note;
  if (note && body && !body.includes(note.slice(0, 40))) return `${body}\n\n${note}`;
  return note || body || '';
}

function mediaFromFx(tweet) {
  const out = [];
  const bag = tweet?.media;
  if (!bag) return out;
  const list = Array.isArray(bag) ? bag : (bag.all || []);
  for (const m of list) {
    const u = typeof m === 'string' ? m : (m.url || m.media_url_https || m.preview_url || m.thumbnail_url);
    if (u && !out.includes(u)) out.push(u);
  }
  for (const key of ['photos', 'videos']) {
    const arr = bag[key];
    if (Array.isArray(arr)) {
      for (const m of arr) {
        const u = typeof m === 'string' ? m : (m.url || m.media_url_https || m.thumbnail_url);
        if (u && !out.includes(u)) out.push(u);
      }
    }
  }
  return out;
}

async function fetchFromFx(id) {
  // Legacy first (stable), then /2 which returns {status,thread,author}
  const urls = [
    `https://api.fxtwitter.com/status/${id}`,
    `https://api.fxtwitter.com/2/status/${id}`,
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const data = await fetchJson(u);
      const tweet = normalizeFxTweet(data);
      const text = pickTextFromFxTweet(tweet);
      if (!text) throw new Error('empty text');
      const authorObj = tweet.author || data.author || {};
      return {
        id,
        text,
        author: authorObj.screen_name || tweet.user_screen_name || authorObj.name || '',
        authorName: authorObj.name || '',
        date: tweet.created_at || tweet.date || '',
        media: mediaFromFx(tweet),
        url: tweet.url || `https://x.com/i/web/status/${id}`,
        source: 'fxtwitter',
        raw: tweet,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('fxtwitter failed');
}

async function fetchFromVx(id) {
  const data = await fetchJson(`https://api.vxtwitter.com/Twitter/status/${id}`);
  const text = data.text || data.full_text || '';
  if (!text) throw new Error('vxtwitter empty');
  const media = [];
  for (const m of data.mediaURLs || data.media_extended || []) {
    const u = typeof m === 'string' ? m : m.url;
    if (u) media.push(u);
  }
  return {
    id,
    text,
    author: data.user_screen_name || data.user_name || '',
    authorName: data.user_name || '',
    date: data.date || data.created_at || '',
    media,
    url: data.tweetURL || `https://x.com/i/web/status/${id}`,
    source: 'vxtwitter',
    raw: data,
  };
}

async function fetchThread(id) {
  try {
    const data = await fetchJson(`https://api.fxtwitter.com/2/thread/${id}`);
    // Shape: { status, thread: [...], author, code }
    const tweets =
      data.thread ||
      data.tweets ||
      (Array.isArray(data) ? data : null);
    if (!tweets || !tweets.length) return null;
    const parts = [];
    const media = [];
    let author = data.author?.screen_name || '';
    let date = '';
    let url = '';
    for (const t of tweets) {
      const tweet = normalizeFxTweet(t) || t;
      const txt = pickTextFromFxTweet(tweet);
      if (txt) parts.push(txt);
      media.push(...mediaFromFx(tweet));
      if (!author) author = tweet.author?.screen_name || '';
      if (!date) date = tweet.created_at || '';
      if (!url) url = tweet.url || '';
    }
    if (!parts.length) return null;
    return {
      id,
      text: parts.join('\n\n——\n\n'),
      author,
      authorName: data.author?.name || '',
      date,
      media: [...new Set(media)],
      url: url || data.status?.url || `https://x.com/i/web/status/${id}`,
      source: 'fxtwitter-thread',
      raw: data,
    };
  } catch {
    return null;
  }
}

async function fetchTweet(id, preferThread) {
  let singleErr;
  // Optionally try thread first
  if (preferThread) {
    const th = await fetchThread(id);
    if (th && th.text.split('\n\n——\n\n').length > 1) return th;
  }
  try {
    return await fetchFromFx(id);
  } catch (e) {
    singleErr = e;
  }
  try {
    return await fetchFromVx(id);
  } catch (e2) {
    throw new Error(`抓取失败：${singleErr?.message || singleErr} / ${e2.message || e2}`);
  }
}

/* ---------- translation ---------- */
function splitParagraphs(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function chunkText(text, max = MYMEMORY_CHUNK) {
  if (text.length <= max) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function translateMyMemory(text) {
  const chunks = chunkText(text);
  const out = [];
  for (const c of chunks) {
    const url =
      'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(c) +
      '&langpair=en|zh-CN';
    const data = await fetchJson(url, 15000);
    const translated = data?.responseData?.translatedText;
    if (!translated) throw new Error('MyMemory empty');
    // MyMemory returns ERROR messages as the "translation" sometimes
    if (/^MYMEMORY WARNING/i.test(translated) || /^QUERY LENGTH LIMIT/i.test(translated)) {
      throw new Error(translated);
    }
    out.push(translated);
  }
  return out.join('');
}

async function translateGtx(text) {
  // Undocumented Google Translate endpoint; often works in browsers
  const chunks = chunkText(text, 900);
  const out = [];
  for (const c of chunks) {
    const url =
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' +
      encodeURIComponent(c);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`gtx ${res.status}`);
    const data = await res.json();
    const parts = (data?.[0] || []).map((x) => x[0]).filter(Boolean);
    if (!parts.length) throw new Error('gtx empty');
    out.push(parts.join(''));
  }
  return out.join('');
}

async function translateAi(text, settings) {
  const base = (settings.aiBase || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = settings.aiModel || 'gpt-4o-mini';
  const key = settings.aiKey;
  if (!key) throw new Error('未填写 API Key');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是专业翻译。把用户给出的英文（或其它语言）准确翻译成简体中文。只输出译文，不要解释，保留人名、产品名、链接和 emoji。',
        },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AI ${res.status}: ${errText.slice(0, 120)}`);
  }
  const data = await res.json();
  const t = data.choices?.[0]?.message?.content?.trim();
  if (!t) throw new Error('AI 返回空');
  return t;
}

async function translateParagraph(text, settings) {
  // Skip if already mostly CJK
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk > text.length * 0.4 && text.length > 8) return text;

  if (settings.useAi && settings.aiKey) {
    try {
      return await translateAi(text, settings);
    } catch (e) {
      console.warn('AI translate failed, fallback', e);
    }
  }
  try {
    return await translateMyMemory(text);
  } catch (e1) {
    try {
      return await translateGtx(text);
    } catch (e2) {
      throw new Error(`翻译失败：${e1.message || e1} / ${e2.message || e2}`);
    }
  }
}

async function translateAll(text, onProgress) {
  const settings = loadSettings();
  const paras = splitParagraphs(text);
  const result = [];
  for (let i = 0; i < paras.length; i++) {
    onProgress?.(`正在翻译 ${i + 1}/${paras.length}…`);
    const zh = await translateParagraph(paras[i], settings);
    result.push({ orig: paras[i], zh });
  }
  return result;
}

/* ---------- UI ---------- */
function setStatus(msg, kind = '') {
  els.status.hidden = !msg;
  els.status.textContent = msg || '';
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPlain(mode = viewMode) {
  if (!current) return '';
  const lines = [];
  lines.push(`作者：@${current.author || '?'}`);
  if (current.date) lines.push(`时间：${current.date}`);
  lines.push(`链接：${current.url}`);
  if (current.media?.length) {
    lines.push('媒体：');
    current.media.forEach((u) => lines.push(`  ${u}`));
  }
  lines.push('');
  lines.push('——');
  lines.push('');
  for (const p of current.paragraphs || []) {
    if (mode === 'bilingual') {
      lines.push(p.orig);
      lines.push('');
      lines.push(p.zh);
      lines.push('');
    } else if (mode === 'zh') {
      lines.push(p.zh);
      lines.push('');
    } else {
      lines.push(p.orig);
      lines.push('');
    }
  }
  return lines.join('\n').trim() + '\n';
}

function showResult() {
  if (!current) return;
  els.resultCard.hidden = false;
  const mediaNote = current.media?.length
    ? `<br>媒体 ${current.media.length} 个`
    : '';
  els.meta.innerHTML = `<strong>@${escapeHtml(current.author || '?')}</strong>
    ${current.date ? ' · ' + escapeHtml(String(current.date)) : ''}
    · 来源 ${escapeHtml(current.source || '')}${mediaNote}
    <br><a href="${escapeHtml(current.url)}" target="_blank" rel="noopener" style="color:var(--accent-2)">打开原帖</a>`;

  if (viewMode === 'bilingual') {
    els.output.innerHTML = (current.paragraphs || [])
      .map(
        (p) =>
          `<div class="para"><div class="orig">${escapeHtml(p.orig)}</div><div class="zh">${escapeHtml(p.zh)}</div></div>`
      )
      .join('');
  } else if (viewMode === 'zh') {
    els.output.textContent = (current.paragraphs || []).map((p) => p.zh).join('\n\n');
  } else {
    els.output.textContent = (current.paragraphs || []).map((p) => p.orig).join('\n\n');
  }
}

async function runFetch(rawInput) {
  const parsed = parseStatusId(rawInput);
  if (!parsed) {
    setStatus('请粘贴有效的推文链接（含 /status/数字）', 'err');
    return;
  }
  els.urlInput.value = parsed.url;
  els.btnFetch.disabled = true;
  setStatus('正在抓取推文…');
  els.resultCard.hidden = true;

  try {
    const settings = loadSettings();
    const tweet = await fetchTweet(parsed.id, settings.preferThread !== false);
    setStatus('正在翻译成中文…');
    const paragraphs = await translateAll(tweet.text, (m) => setStatus(m));
    current = { ...tweet, paragraphs };
    showResult();
    pushHistory(current);
    setStatus('完成', 'ok');
    setTimeout(() => setStatus(''), 2000);
  } catch (e) {
    console.error(e);
    setStatus(String(e.message || e), 'err');
  } finally {
    els.btnFetch.disabled = false;
  }
}

/* ---------- share target / deep link ---------- */
function handleLaunchParams() {
  const sp = new URLSearchParams(location.search);
  // Web Share Target: ?url=&text=&title=
  const shared =
    sp.get('url') ||
    sp.get('text') ||
    sp.get('title') ||
    '';
  // Also support ?id= or path leftover
  if (shared) {
    const extracted = extractTweetUrl(shared) || shared;
    els.urlInput.value = extracted;
    // Clean URL bar so refresh doesn't re-trigger awkwardly
    history.replaceState({}, '', location.pathname + location.hash);
    runFetch(extracted);
    return;
  }
}

/* ---------- events ---------- */
els.btnFetch.addEventListener('click', () => runFetch(els.urlInput.value));
els.urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runFetch(els.urlInput.value);
  }
});

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    viewMode = btn.dataset.view;
    showResult();
  });
});

els.btnCopy.addEventListener('click', async () => {
  const plain = formatPlain();
  try {
    await navigator.clipboard.writeText(plain);
    setStatus('已复制到剪贴板', 'ok');
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = plain;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    setStatus('已复制', 'ok');
  }
});

els.btnSave.addEventListener('click', () => {
  const plain = formatPlain();
  const blob = new Blob([plain], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  const name = `tweet-${current?.id || 'text'}.txt`;
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus('已开始下载 ' + name, 'ok');
});

els.btnShare.addEventListener('click', async () => {
  const plain = formatPlain();
  if (navigator.share) {
    try {
      await navigator.share({
        title: '推文译文',
        text: plain,
      });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  // fallback to copy
  els.btnCopy.click();
  setStatus('当前浏览器不支持系统分享，已改为复制', 'ok');
});

els.btnClearHistory.addEventListener('click', () => {
  if (confirm('确定清空全部本地记录？')) {
    saveHistory([]);
    renderHistory();
  }
});

els.btnSettings.addEventListener('click', () => {
  fillSettingsForm();
  els.settingsDialog.showModal();
});

els.settingsForm.addEventListener('submit', (e) => {
  const val = e.submitter?.value || 'save';
  if (val === 'save') {
    saveSettings({
      useAi: els.useAi.checked,
      aiBase: els.aiBase.value.trim(),
      aiKey: els.aiKey.value.trim(),
      aiModel: els.aiModel.value.trim(),
      preferThread: els.preferThread.checked,
    });
    setStatus('设置已保存', 'ok');
  }
});

/* ---------- SW ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Scope stays inside this folder so it does not replace the reader SW at /My-reader/.
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('SW', e));
  });
}

renderHistory();
handleLaunchParams();
