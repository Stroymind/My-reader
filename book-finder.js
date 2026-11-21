// 合规「AI 找书 · 自动入库」：支持用户自定义 OPDS 个人书源（Calibre/Kavita/Standard Ebooks 等）+ 合法公开公版书库（Project Gutenberg / Gutendex）
// 静息时零网络请求，仅在用户主动说出「帮我找《…》」或配置书源后才发起检索。

const OPDS_KEY = 'zone-opds-url';

export function getOpdsUrl() {
  try { return localStorage.getItem(OPDS_KEY) || ''; } catch { return ''; }
}
export function setOpdsUrl(url) {
  const clean = String(url || '').trim();
  try {
    if (clean) localStorage.setItem(OPDS_KEY, clean);
    else localStorage.removeItem(OPDS_KEY);
  } catch {}
  return clean;
}

async function fetchWithTimeout(url, ms = 16000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function searchOpds(baseUrl, query) {
  const q = String(query || '').trim().toLowerCase();
  const sep = baseUrl.includes('?') ? '&' : '?';
  const tryUrls = baseUrl.includes('{searchTerms}')
    ? [baseUrl.replace('{searchTerms}', encodeURIComponent(query))]
    : [`${baseUrl}${sep}q=${encodeURIComponent(query)}`, baseUrl];

  for (const u of tryUrls) {
    try {
      const res = await fetchWithTimeout(u, 14000);
      if (!res.ok) continue;
      const xml = await res.text();
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const entries = [...doc.getElementsByTagName('entry')];
      for (const e of entries) {
        const title = e.getElementsByTagName('title')[0]?.textContent?.trim() || '';
        const author = e.getElementsByTagName('name')[0]?.textContent?.trim() || '';
        if (q && !`${title} ${author}`.toLowerCase().includes(q) && u === baseUrl) continue;
        const links = [...e.getElementsByTagName('link')];
        const acq = links.find(l => /epub|pdf|plain/i.test(l.getAttribute('type') || '') && /acquisition|open-access/i.test(l.getAttribute('rel') || ''))
          || links.find(l => /epub/i.test(l.getAttribute('type') || ''));
        const href = acq?.getAttribute('href');
        if (!href) continue;
        const abs = new URL(href, u).href;
        const ext = /pdf/i.test(acq.getAttribute('type') || '') ? 'pdf' : /plain/i.test(acq.getAttribute('type') || '') ? 'txt' : 'epub';
        return { title: title || query, author, url: abs, ext, source: '个人 OPDS 书源' };
      }
    } catch {}
  }
  return null;
}

async function searchPublicDomain(query) {
  const url = `https://gutendex.com/books/?search=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, 15000);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const books = data?.results || [];
  for (const b of books) {
    const f = b.formats || {};
    const epub = f['application/epub+zip'];
    const txt = f['text/plain; charset=utf-8'] || f['text/plain; charset=us-ascii'] || f['text/plain'];
    const dl = epub || txt;
    if (!dl) continue;
    return {
      title: b.title || query,
      author: (b.authors || []).map(a => a.name).filter(Boolean).join('、'),
      url: dl,
      ext: epub ? 'epub' : 'txt',
      source: '公开公版书库'
    };
  }
  return null;
}

export async function findAndFetchBook(query) {
  const q = String(query || '').trim().replace(/[《》「」『』“”"']/g, '').trim();
  if (!q) throw new Error('请告诉我你想找的书名');
  let hit = null;
  const opds = getOpdsUrl();
  if (opds) hit = await searchOpds(opds, q);
  if (!hit) hit = await searchPublicDomain(q);
  if (!hit) {
    return { found: false, query: q };
  }
  const res = await fetchWithTimeout(hit.url, 25000);
  if (!res.ok) throw new Error('下载书源失败（' + res.status + '）');
  const blob = await res.blob();
  const fileName = `${hit.title.replace(/[\\/:*?"<>|]/g, '_')}.${hit.ext}`;
  return { found: true, ...hit, blob, fileName };
}
