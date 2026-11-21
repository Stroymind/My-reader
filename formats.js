// 全格式本地解析引擎：MOBI / AZW / AZW3 / DOCX / Markdown / 网页文章 URL
// 100% 端侧本地解析，不上传任何用户文件。

import { decodeText, htmlToPlain } from './engines.js';

function u16(view, off) { return view.getUint16(off, false); }
function u32(view, off) { return view.getUint32(off, false); }

// PalmDOC LZ77 解压（MOBI / PRC / 非加密 AZW3 通用）
function decompressPalmDoc(bytes) {
  const out = [];
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const c = bytes[i++];
    if (c === 0) {
      out.push(0);
    } else if (c >= 1 && c <= 8) {
      for (let k = 0; k < c && i < len; k++) out.push(bytes[i++]);
    } else if (c >= 9 && c <= 0x7f) {
      out.push(c);
    } else if (c >= 0x80 && c <= 0xbf) {
      if (i >= len) break;
      const next = bytes[i++];
      const pair = ((c << 8) | next) & 0x3fff;
      const dist = pair >> 3;
      const count = (pair & 0x07) + 3;
      if (dist <= 0 || dist > out.length) continue;
      for (let k = 0; k < count; k++) out.push(out[out.length - dist]);
    } else {
      out.push(0x20, c ^ 0x80);
    }
  }
  return new Uint8Array(out);
}

function trimTrailingEntries(buf, flags) {
  let end = buf.length;
  const multibyte = flags & 1;
  let extra = flags >> 1;
  while (extra > 0 && end > 0) {
    if (extra & 1) {
      let size = 0, shift = 0, pos = end - 1;
      while (pos >= 0) {
        const b = buf[pos--];
        size |= (b & 0x7f) << shift;
        shift += 7;
        if (b & 0x80) break;
      }
      end = Math.max(0, end - size);
    }
    extra >>= 1;
  }
  if (multibyte && end > 0) {
    const n = (buf[end - 1] & 0x03) + 1;
    end = Math.max(0, end - n);
  }
  return buf.subarray(0, end);
}

function readAscii(bytes, start, len) {
  let s = '';
  for (let i = 0; i < len && start + i < bytes.length; i++) {
    const c = bytes[start + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export async function parseMobi(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 86) throw new Error('文件太小，不是有效的 MOBI/AZW3');
  const view = new DataView(buf);
  const ident = readAscii(bytes, 60, 8);
  if (ident !== 'BOOKMOBI' && ident !== 'TEXtREAd') {
    throw new Error('不支持的电子书文件头（' + (ident || '未知') + '）');
  }
  const numRecords = u16(view, 76);
  if (numRecords < 2) throw new Error('MOBI 记录为空');
  const offsets = [];
  for (let i = 0; i < numRecords; i++) {
    offsets.push(u32(view, 78 + i * 8));
  }
  const r0Start = offsets[0];
  const r0End = offsets[1] || bytes.length;
  const r0 = bytes.subarray(r0Start, r0End);
  const r0v = new DataView(buf, r0Start, r0End - r0Start);

  const compression = u16(r0v, 0);
  const textRecordCount = u16(r0v, 8);
  const encryption = u16(r0v, 12);
  if (encryption !== 0) {
    const err = new Error('这本书受 Kindle DRM 加密保护，无法直接打开');
    err.code = 'DRM';
    throw err;
  }
  if (compression !== 1 && compression !== 2) {
    throw new Error('暂不支持 HUFF/CDIC 压缩的 MOBI，请转换为 EPUB 或无压缩 MOBI');
  }

  let title = readAscii(bytes, 0, 32).replace(/_/g, ' ').trim();
  let author = '';
  let encoding = 65001;
  let extraFlags = 0;

  if (r0.length >= 132 && readAscii(r0, 16, 4) === 'MOBI') {
    const mobiHeaderLen = u32(r0v, 20);
    encoding = u32(r0v, 28);
    const fullNameOff = u32(r0v, 84);
    const fullNameLen = u32(r0v, 88);
    if (fullNameOff > 0 && fullNameLen > 0 && fullNameOff + fullNameLen <= r0.length) {
      title = decodeText(r0.subarray(fullNameOff, fullNameOff + fullNameLen)).trim() || title;
    }
    const exthFlags = u32(r0v, 128);
    if (mobiHeaderLen >= 228 && r0.length >= 244) {
      extraFlags = u16(r0v, 242);
    }
    if ((exthFlags & 0x40) && 16 + mobiHeaderLen + 12 <= r0.length) {
      const exStart = 16 + mobiHeaderLen;
      if (readAscii(r0, exStart, 4) === 'EXTH') {
        const count = u32(r0v, exStart + 8);
        let p = exStart + 12;
        for (let i = 0; i < count && p + 8 <= r0.length; i++) {
          const type = u32(r0v, p);
          const len = u32(r0v, p + 4);
          if (len < 8 || p + len > r0.length) break;
          const val = decodeText(r0.subarray(p + 8, p + len)).trim();
          if (type === 100 && val && !author) author = val;
          if (type === 503 && val) title = val;
          p += len;
        }
      }
    }
  }

  const chunks = [];
  const maxRec = Math.min(numRecords - 1, textRecordCount);
  for (let i = 1; i <= maxRec; i++) {
    const start = offsets[i];
    const end = i + 1 < numRecords ? offsets[i + 1] : bytes.length;
    if (end <= start) continue;
    let rec = bytes.subarray(start, end);
    if (extraFlags) rec = trimTrailingEntries(rec, extraFlags);
    chunks.push(compression === 2 ? decompressPalmDoc(rec) : rec);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) { merged.set(c, pos); pos += c.length; }

  let raw = '';
  if (encoding === 1252) {
    try { raw = new TextDecoder('windows-1252', { fatal: false }).decode(merged); }
    catch { raw = decodeText(merged); }
  } else {
    raw = decodeText(merged);
  }
  const parsed = /<(?:html|body|p|div|br|h[1-6]|mbp:pagebreak)\b/i.test(raw)
    ? htmlToPlain(raw.replace(/<mbp:pagebreak\s*\/?>/gi, '\n\n'))
    : { title: '', author: '', text: raw };
  const text = (parsed.text || '').trim();
  if (!text) throw new Error('未能从 MOBI/AZW3 中提取到正文');
  return {
    title: title || parsed.title || '',
    author: author || parsed.author || '',
    text
  };
}

export async function parseDocx(blob) {
  if (!window.JSZip) throw new Error('缺少 ZIP 解压组件');
  const zip = await window.JSZip.loadAsync(blob);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('DOCX 缺少 word/document.xml 正文');
  const doc = new DOMParser().parseFromString(docXml, 'application/xml');
  const paras = [...doc.getElementsByTagName('w:p')];
  const lines = [];
  for (const p of paras) {
    const texts = [...p.getElementsByTagName('w:t')].map(t => t.textContent || '').join('').trim();
    if (!texts) continue;
    const pStyle = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '';
    if (/^Heading[123]|标题/i.test(pStyle)) lines.push('\n' + texts + '\n');
    else lines.push(texts);
  }
  let title = '', author = '';
  const coreXml = await zip.file('docProps/core.xml')?.async('string');
  if (coreXml) {
    const cdoc = new DOMParser().parseFromString(coreXml, 'application/xml');
    title = cdoc.getElementsByTagName('dc:title')[0]?.textContent?.trim() || '';
    author = cdoc.getElementsByTagName('dc:creator')[0]?.textContent?.trim() || '';
  }
  const text = lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('DOCX 文档里没有可读文字');
  return { title, author, text };
}

export async function parseMarkdown(blob) {
  const raw = decodeText(await blob.arrayBuffer()).replace(/\r\n?/g, '\n');
  const h1 = raw.match(/^#\s+(.+)$/m);
  const title = h1 ? h1[1].trim() : '';
  const text = raw
    .replace(/^```[\s\S]*?^```/gm, m => m.replace(/^```.*\n?|\n?```$/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+(.+)$/gm, '\n$1\n')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new Error('Markdown 文件内容为空');
  return { title, author: '', text };
}

// 疑难 EPUB 兜底：若 epub.js 无法解析某本非加密 EPUB，直接用 JSZip 按阅读顺序提取全文
export async function extractEpubFallback(blob) {
  if (!window.JSZip) throw new Error('缺少 ZIP 解压组件');
  const zip = await window.JSZip.loadAsync(blob);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = containerXml?.match(/full-path=["']([^"']+)["']/)?.[1];
  let title = '', author = '';
  const orderedPaths = [];
  if (opfPath && zip.file(opfPath)) {
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opfText = await zip.file(opfPath).async('string');
    const opfDoc = new DOMParser().parseFromString(opfText, 'application/xml');
    title = opfDoc.querySelector('title, dc\\:title')?.textContent?.trim() || '';
    author = opfDoc.querySelector('creator, dc\\:creator')?.textContent?.trim() || '';
    const manifest = new Map();
    opfDoc.querySelectorAll('manifest > item').forEach(it => {
      const id = it.getAttribute('id'), href = it.getAttribute('href');
      if (id && href) manifest.set(id, href);
    });
    opfDoc.querySelectorAll('spine > itemref').forEach(r => {
      const href = manifest.get(r.getAttribute('idref'));
      if (href) orderedPaths.push(opfDir + decodeURIComponent(href));
    });
  }
  const files = orderedPaths.length
    ? orderedPaths.map(p => zip.file(p)).filter(Boolean)
    : Object.keys(zip.files).filter(k => /\.x?html?$/i.test(k) && !zip.files[k].dir).sort().map(k => zip.file(k));
  const sections = [];
  for (const f of files) {
    try {
      const raw = await f.async('string');
      const parsed = htmlToPlain(raw);
      if (parsed.text && parsed.text.trim().length > 10) sections.push(parsed.text.trim());
    } catch {}
  }
  const text = sections.join('\n\n').trim();
  if (!text) throw new Error('未能从 EPUB 中提取到可读正文');
  return { title, author, text };
}

export async function fetchArticleUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('请输入以 http:// 或 https:// 开头的文章链接');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18000);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? '网页打开超时' : '无法直接抓取该网页（目标站点可能限制跨站访问）');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('网页返回错误（' + res.status + '）');
  const html = await res.text();
  const parsed = htmlToPlain(html);
  if (!parsed.text || parsed.text.trim().length < 20) throw new Error('这个链接里没有提取到可读正文');
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  return {
    title: (parsed.title || host || '网页文章').trim(),
    author: parsed.author || host,
    text: parsed.text.trim()
  };
}
