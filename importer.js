// 导入：EPUB / PDF / TXT / HTML / MOBI / AZW3 / DOCX / Markdown / 网页文章 URL / ZIP
import { db } from './db.js';
import { decodeText, htmlToPlain } from './engines.js';
import { repairEpub } from './epub-repair.js';
import { aiConfigured, transcribeAudio } from './ai.js';
import { extractEpubFallback, fetchArticleUrl, parseDocx, parseMarkdown, parseMobi, parseSubtitle } from './formats.js';

const BOOK_EXT = /\.(epub|pdf|txt|text|html|htm|xhtml|mobi|azw|azw3|prc|docx|md|markdown|png|jpe?g|webp|gif|srt|vtt|lrc|mp3|m4a|wav|ogg|aac|mp4|webm)$/i;

export function extOf(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
export function baseName(p) { return (p || '').split('/').pop(); }

async function sniffType(blob, name) {
  const e = extOf(name);
  if (e === 'text') return 'txt';
  if (e === 'htm' || e === 'xhtml') return 'html';
  if (e === 'mobi' || e === 'azw' || e === 'azw3' || e === 'prc') return 'mobi';
  if (e === 'md' || e === 'markdown') return 'md';
  if (e === 'docx') return 'docx';
  if (e === 'png' || e === 'jpg' || e === 'jpeg' || e === 'webp' || e === 'gif') return 'image';
  if (e === 'srt' || e === 'vtt' || e === 'lrc') return 'subtitle';
  if (e === 'mp3' || e === 'm4a' || e === 'wav' || e === 'ogg' || e === 'aac') return 'audio';
  if (e === 'mp4' || e === 'webm') return 'video';
  if (e === 'epub' || e === 'pdf' || e === 'txt' || e === 'html') return e;
  const head = new Uint8Array(await blob.slice(0, 80).arrayBuffer());
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image';
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
  if (head.length >= 68) {
    const ident = String.fromCharCode(...head.subarray(60, 68));
    if (ident === 'BOOKMOBI' || ident === 'TEXtREAd') return 'mobi';
  }
  if (head[0] === 0x50 && head[1] === 0x4b) return e === 'zip' ? 'zip' : 'epub?';
  const ascii = new TextDecoder('utf-8', { fatal: false }).decode(head).replace(/^\uFEFF/, '').trim().toLowerCase();
  if (ascii.startsWith('<!doctype html') || ascii.startsWith('<html') || ascii.startsWith('<head') || ascii.startsWith('<body')) return 'html';
  return null;
}

async function fingerprint(blob) {
  const chunk = blob.size > 4e6 ? new Blob([blob.slice(0, 2e6), blob.slice(blob.size - 2e6)]) : blob;
  const buf = await chunk.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('') + '-' + blob.size.toString(36);
}

async function shrinkImage(blob, maxW = 360) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxW / bmp.width);
    const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  } catch { return blob; }
}

async function epubMeta(blob) {
  let data = await blob.arrayBuffer();
  try { data = await repairEpub(data); } catch (e) { if (e.code === 'DRM' || e.code === 'BAD_EPUB') throw e; }
  const book = ePub(data);
  // 先接住打开过程里的拒绝，避免解析完元数据就 destroy 时留下未处理异常。
  const opened = book.opened.catch(() => null);
  const navigation = book.loaded.navigation.catch(() => null);
  try {
    const md = await book.loaded.metadata;
    let cover = null;
    try {
      const url = await book.coverUrl();
      if (url) cover = await shrinkImage(await (await fetch(url)).blob());
    } catch {}
    return { title: md.title, author: md.creator, cover, lang: md.language };
  } finally {
    try { await navigation; await opened; } catch {}
    try { book.destroy(); } catch {}
  }
}

async function pdfMeta(blob, pdfjsLib) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: './vendor/cmaps/', cMapPacked: true, standardFontDataUrl: './vendor/standard_fonts/' }).promise;
  try {
    let title, author;
    try { const m = await doc.getMetadata(); title = m.info?.Title; author = m.info?.Author; } catch {}
    let cover = null;
    try {
      const page = await doc.getPage(1);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 360 / vp0.width });
      const c = new OffscreenCanvas(Math.round(vp.width), Math.round(vp.height));
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      cover = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    } catch {}
    return { title, author, cover, pages: doc.numPages };
  } finally { doc.destroy(); }
}

function cleanTitle(name) { return baseName(name).replace(/\.(epub|pdf|txt|text|html|htm|xhtml|mobi|azw|azw3|prc|docx|md|markdown|png|jpe?g|webp|gif|srt|vtt|lrc|mp3|m4a|wav|ogg|aac|mp4|webm)$/i, '').replace(/\s*\([0-9a-z]{26}\)\s*$/, '').trim(); }

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('图片读取失败'));
    r.readAsDataURL(blob);
  });
}

// 导入单个文件。返回 {status:'added'|'dup'|'fail', title, id?}
export async function importBlob(blob, name, ctx = {}) {
  let type = await sniffType(blob, name);
  if (type === 'epub?') type = 'epub';
  if (!type || type === 'zip') return { status: 'skip', title: name };
  const id = await fingerprint(blob);
  const existing = await db.get('books', id);
  const m = ctx.manifest?.byFile?.get(baseName(name));
  if (existing) {
    if (m) await applyEntry(existing, m);
    return { status: 'dup', title: existing.title, id: existing.id };
  }
  let meta = {};
  let storeBlob = blob;
  let storeType = type;
  try {
    if (type === 'epub') {
      try {
        meta = await epubMeta(blob);
      } catch (e) {
        if (e.code === 'DRM') throw e;
        // 疑难非加密 EPUB 兜底：直接按阅读顺序抽取全部正文，确保绝不打不开
        const fb = await extractEpubFallback(blob);
        meta = { title: fb.title, author: fb.author };
        storeBlob = new Blob([fb.text], { type: 'text/plain;charset=utf-8' });
        storeType = 'txt';
      }
    } else if (type === 'pdf') {
      meta = await pdfMeta(blob, ctx.pdfjsLib);
    } else if (type === 'mobi') {
      const parsed = await parseMobi(blob);
      meta = { title: parsed.title, author: parsed.author };
      storeBlob = new Blob([parsed.text], { type: 'text/plain;charset=utf-8' });
      storeType = 'txt';
    } else if (type === 'docx') {
      const parsed = await parseDocx(blob);
      meta = { title: parsed.title, author: parsed.author };
      storeBlob = new Blob([parsed.text], { type: 'text/plain;charset=utf-8' });
      storeType = 'txt';
    } else if (type === 'md') {
      const parsed = await parseMarkdown(blob);
      meta = { title: parsed.title, author: parsed.author };
      storeBlob = new Blob([parsed.text], { type: 'text/plain;charset=utf-8' });
      storeType = 'txt';
    } else if (type === 'image') {
      const dataUrl = await blobToDataUrl(blob);
      const cover = await shrinkImage(blob, 360);
      const title = cleanTitle(name) || '图片小册子';
      meta = { title, author: '视觉小册子', cover };
      storeBlob = new Blob([`<h1>${title.replace(/</g, '&lt;')}</h1><figure><img src="${dataUrl}" alt=""></figure>`], { type: 'text/html;charset=utf-8' });
      storeType = 'booklet';
    } else if (type === 'subtitle') {
      const parsed = await parseSubtitle(blob);
      meta = { title: cleanTitle(name) || '字幕逐字稿', author: parsed.author };
      storeBlob = new Blob([parsed.text], { type: 'text/plain;charset=utf-8' });
      storeType = 'txt';
    } else if (type === 'audio' || type === 'video') {
      const title = cleanTitle(name) || (type === 'video' ? '视频逐字稿' : '播客逐字稿');
      let transcript = '';
      if (aiConfigured() && blob.size <= 24 * 1024 * 1024) {
        try {
          const dataUrl = await blobToDataUrl(blob);
          const b64 = dataUrl.split(',')[1] || '';
          if (b64) transcript = await transcribeAudio(b64, blob.type || (type === 'video' ? 'video/mp4' : 'audio/mpeg'));
        } catch {}
      }
      if (transcript) {
        meta = { title, author: type === 'video' ? '视频逐字稿' : '播客逐字稿' };
        storeBlob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
        storeType = 'txt';
      } else {
        const dataUrl = blob.size <= 16 * 1024 * 1024 ? await blobToDataUrl(blob) : '';
        const player = dataUrl
          ? (type === 'video'
            ? `<video controls playsinline style="width:100%;border-radius:14px;margin:12px 0" src="${dataUrl}"></video>`
            : `<audio controls style="width:100%;margin:16px 0" src="${dataUrl}"></audio>`)
          : '';
        const tip = '<p>已导入音视频。配置 AI 密钥后重新导入即可自动生成逐字稿；也可直接导入同名字幕（.srt / .vtt）用于逐句翻译与划线。</p>';
        meta = { title, author: type === 'video' ? '视频小册子' : '音频播客' };
        storeBlob = new Blob([`<h1>${title.replace(/</g, '&lt;')}</h1>${player}${tip}`], { type: 'text/html;charset=utf-8' });
        storeType = 'booklet';
      }
    } else if (type === 'html') {
      const parsed = htmlToPlain(decodeText(await blob.arrayBuffer()));
      if (!parsed.text.trim()) return { status: 'fail', title: cleanTitle(name), reason: 'HTML 里没有可读的正文' };
      meta = { title: parsed.title, author: parsed.author };
    }
  } catch (e) {
    if (type !== 'txt') return { status: 'fail', title: cleanTitle(name), reason: '无法解析：' + (e.message || e) };
  }
  const rec = {
    id, type: storeType, origType: type, fileName: baseName(name), size: blob.size,
    title: (m?.title || meta.title || cleanTitle(name)).trim(),
    author: (m?.author || meta.author || '').trim(),
    cover: meta.cover || null, pages: meta.pages,
    addedAt: Date.now(), lastOpened: 0, progress: 0, pos: null, bookmarks: [], highlights: []
  };
  if (m) fillPending(rec, m);
  await db.put('files', { id, blob: storeBlob.type ? storeBlob : new Blob([storeBlob], { type: mime(storeType) }) });
  await db.put('books', rec);
  return { status: 'added', title: rec.title, id };
}

export async function importArticleUrl(url) {
  const art = await fetchArticleUrl(url);
  const isRich = !!art.richHtml;
  const blob = new Blob([isRich ? art.richHtml : art.text], { type: isRich ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' });
  const id = await fingerprint(blob);
  const existing = await db.get('books', id);
  if (existing) return { status: 'dup', title: existing.title, id: existing.id };
  const rec = {
    id, type: isRich ? 'booklet' : 'txt', origType: 'url', fileName: art.title + (isRich ? '.html' : '.txt'), size: blob.size,
    title: art.title, author: art.author || '图文小册子', cover: null,
    addedAt: Date.now(), lastOpened: 0, progress: 0, pos: null, bookmarks: [], highlights: []
  };
  await db.put('files', { id, blob });
  await db.put('books', rec);
  return { status: 'added', title: rec.title, id };
}

function mime(t) { return t === 'epub' ? 'application/epub+zip' : t === 'pdf' ? 'application/pdf' : t === 'html' ? 'text/html' : 'text/plain'; }

function fillPending(rec, m) {
  if (typeof m.progress === 'number' && m.progress > 0) {
    rec.pending = { progress: m.progress, startHref: m.startHref || null, chapterFraction: m.chapterFraction ?? null };
    rec.progress = m.progress;
  }
}
async function applyEntry(rec, m) {
  if (rec.pos || !(m.progress > 0)) return; // 已在本应用读过，不覆盖
  fillPending(rec, m); await db.put('books', rec);
}

export function parseManifest(obj) {
  const list = Array.isArray(obj) ? obj : obj.books;
  if (!Array.isArray(list)) return null;
  const byFile = new Map();
  for (const b of list) if (b && b.file) byFile.set(baseName(b.file), b);
  return { byFile, count: byFile.size };
}

// 已经导入过书、再单独导入 manifest 时，按文件名补上进度
export async function applyManifestToLibrary(manifest) {
  let n = 0;
  for (const rec of await db.all('books')) {
    const m = manifest.byFile.get(rec.fileName);
    if (m && !rec.pos && m.progress > 0) { await applyEntry(rec, m); n++; }
  }
  return n;
}

// 处理用户选择的一批文件
export async function importFiles(files, { pdfjsLib, onStatus }) {
  const res = { added: 0, addedIds: [], dup: 0, fail: [], skipped: 0 };
  const ctx = { pdfjsLib, manifest: null };
  files = Array.from(files);
  // 先读取独立的 manifest JSON
  for (const f of files.filter(f => extOf(f.name) === 'json')) {
    try { const m = parseManifest(JSON.parse(await f.text())); if (m) ctx.manifest = mergeManifest(ctx.manifest, m); } catch {}
  }
  const tasks = []; // {name, get:()=>Promise<Blob>}
  for (const f of files) {
    const e = extOf(f.name);
    if (e === 'json') continue;
    if (e === 'zip') {
      onStatus(`正在读取压缩包 ${f.name}…`);
      try {
        const zip = await JSZip.loadAsync(f);
        const entries = Object.values(zip.files).filter(z => !z.dir && !/(^|\/)(__MACOSX|\.)/.test(z.name));
        for (const z of entries.filter(z => extOf(z.name) === 'json')) {
          try { const m = parseManifest(JSON.parse(await z.async('string'))); if (m) ctx.manifest = mergeManifest(ctx.manifest, m); } catch {}
        }
        for (const z of entries) if (BOOK_EXT.test(z.name)) tasks.push({ name: z.name, get: () => z.async('blob') });
      } catch (err) { res.fail.push({ title: f.name, reason: '压缩包无法打开：' + err.message }); }
    } else tasks.push({ name: f.name, get: async () => f });
  }
  let i = 0;
  for (const t of tasks) {
    i++;
    onStatus(`正在导入 ${i}/${tasks.length}：${cleanTitle(t.name)}`);
    try {
      const r = await importBlob(await t.get(), t.name, ctx);
      if (r.status === 'added') { res.added++; if (r.id) res.addedIds.push(r.id); }
      else if (r.status === 'dup') res.dup++;
      else if (r.status === 'fail') res.fail.push(r);
      else res.skipped++;
    } catch (err) { res.fail.push({ title: cleanTitle(t.name), reason: err.message || String(err) }); }
  }
  if (ctx.manifest) res.progressApplied = await applyManifestToLibrary(ctx.manifest);
  return res;
}
function mergeManifest(a, b) { if (!a) return b; for (const [k, v] of b.byFile) a.byFile.set(k, v); a.count = a.byFile.size; return a; }
