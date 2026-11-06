// 只翻译当前这一页的文字，并缓存在本机。不上传整本书。
import { db } from './db.js';

const CHUNK = 450;

export function isMostlyCjk(text) {
  const chars = String(text || '').replace(/\s+/g, '');
  if (chars.length < 8) return false;
  const cjk = (chars.match(/[\u3040-\u9fff]/g) || []).length;
  return cjk / chars.length > 0.35;
}

function paragraphsOf(text) {
  return String(text || '').split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 1).slice(0, 8);
}

function chunkText(text, max = CHUNK) {
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
  return chunks.filter(Boolean);
}

async function cacheKey(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function translateMyMemory(text) {
  const out = [];
  for (const c of chunkText(text)) {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(c) + '&langpair=en|zh-CN';
    const res = await fetch(url);
    if (!res.ok) throw new Error('MyMemory ' + res.status);
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (!translated || /^MYMEMORY WARNING/i.test(translated) || /^QUERY LENGTH LIMIT/i.test(translated)) throw new Error(translated || 'MyMemory empty');
    out.push(translated);
  }
  return out.join('');
}

async function translateGtx(text) {
  const out = [];
  for (const c of chunkText(text, 900)) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' + encodeURIComponent(c);
    const res = await fetch(url);
    if (!res.ok) throw new Error('gtx ' + res.status);
    const data = await res.json();
    const parts = (data?.[0] || []).map(x => x && x[0]).filter(Boolean);
    if (!parts.length) throw new Error('gtx empty');
    out.push(parts.join(''));
  }
  return out.join('');
}

async function translateFresh(text) {
  try { return await translateMyMemory(text); }
  catch {
    return await translateGtx(text);
  }
}

// 返回 { pairs: [{en, zh}], chinese: bool }。chinese 表示这一页本身就是中文。
export async function translateVisible(text, alive = () => true) {
  const paras = paragraphsOf(text);
  if (!paras.length) return { pairs: [], chinese: false };
  if (paras.every(isMostlyCjk)) return { pairs: [], chinese: true };
  const pairs = [];
  for (const en of paras) {
    if (!alive()) return { pairs, chinese: false };
    if (isMostlyCjk(en)) continue;
    const key = await cacheKey(en);
    const hit = await db.get('xlate', key);
    if (hit?.zh) { pairs.push({ en, zh: hit.zh }); continue; }
    let zh = '';
    try { zh = await translateFresh(en); }
    catch { zh = ''; }
    if (!alive()) return { pairs, chinese: false };
    if (zh) {
      try { await db.put('xlate', { key, zh, at: Date.now() }); } catch {}
    }
    pairs.push({ en, zh });
  }
  return { pairs, chinese: false };
}
