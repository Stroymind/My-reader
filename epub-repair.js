// 打开前整理 EPUB：路径大小写、反斜杠、国标编码、不规范的 HTML。
// 只改内存里的压缩包，不上传。

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

function decodeBytes(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('gb18030').decode(b); }
}

function norm(p) {
  p = String(p || '').replace(/\\/g, '/').split('#')[0].split('?')[0];
  try { p = decodeURIComponent(p); } catch {}
  p = p.replace(/^\/+/, '');
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function indexZip(zip) {
  const map = new Map();
  for (const path of Object.keys(zip.files)) {
    if (zip.files[path].dir) continue;
    map.set(norm(path).toLowerCase(), path);
  }
  return map;
}

function lookup(map, p) { return map.get(norm(p).toLowerCase()); }

function relative(fromDir, target) {
  const from = norm(fromDir).split('/').filter(Boolean);
  const to = norm(target).split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function attrEsc(s) { return esc(s).replace(/"/g, '&quot;'); }

function serialize(node) {
  if (node.nodeType === 3) return esc(node.nodeValue);
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  if (tag === 'parsererror' || tag === 'script' || tag === 'iframe' || tag === 'object') return '';
  let attrs = '';
  for (const a of [...node.attributes]) {
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
    attrs += ` ${a.name}="${attrEsc(a.value)}"`;
  }
  if (VOID.has(tag)) return `<${tag}${attrs}/>`;
  let inner = '';
  for (const child of node.childNodes) inner += serialize(child);
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

function htmlToXhtml(raw) {
  const doc = new DOMParser().parseFromString(String(raw), 'text/html');
  const body = [...doc.body.childNodes].map(serialize).join('');
  const head = [...doc.head.querySelectorAll('style, link')].map(serialize).join('');
  const title = esc(doc.title || '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
}

function xmlOk(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  return !doc.querySelector('parsererror');
}

function isDoc(path, media) {
  const m = (media || '').toLowerCase();
  if (/xhtml|html/.test(m)) return true;
  return /\.x?html?$/i.test(path);
}

function drmError() {
  const err = new Error('这本 EPUB 有数字版权保护（DRM），无法在这里打开。');
  err.code = 'DRM';
  return err;
}

async function assertReadable(zip, map) {
  const encPath = lookup(map, 'META-INF/encryption.xml');
  if (!encPath) return;
  const xml = decodeBytes(await zip.file(encPath).async('uint8array'));
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const uris = [...doc.getElementsByTagName('*')].filter(el => el.localName === 'CipherReference').map(el => el.getAttribute('URI') || '');
  for (const uri of uris) {
    const p = lookup(map, norm(uri));
    if (!p || /\.(otf|ttf|woff2?)$/i.test(p)) continue;
    if (!/\.(x?html?|opf|ncx|svg|xml)$/i.test(p)) continue;
    const bytes = await zip.file(p).async('uint8array');
    const head = decodeBytes(bytes.subarray(0, 240)).trim();
    if (!head.startsWith('<')) throw drmError();
  }
}

export async function repairEpub(buf) {
  const JSZipLib = globalThis.JSZip;
  if (!JSZipLib) return buf;
  const zip = await JSZipLib.loadAsync(buf);
  const map = indexZip(zip);
  await assertReadable(zip, map);
  const containerPath = lookup(map, 'META-INF/container.xml');
  if (!containerPath) {
    const err = new Error('这本 EPUB 的目录损坏，找不到内容清单。');
    err.code = 'BAD_EPUB';
    throw err;
  }
  const containerOriginal = decodeBytes(await zip.file(containerPath).async('uint8array'));
  let container = containerOriginal.replace(/\\/g, '/');
  const found = container.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!found) {
    const err = new Error('这本 EPUB 的目录损坏，找不到内容清单。');
    err.code = 'BAD_EPUB';
    throw err;
  }
  let opfPath = lookup(map, norm(found[1]));
  if (!opfPath) {
    const err = new Error('这本 EPUB 的目录损坏，找不到内容清单。');
    err.code = 'BAD_EPUB';
    throw err;
  }
  if (found[1] !== opfPath) container = container.replace(found[1], opfPath);
  if (container !== containerOriginal || containerPath !== 'META-INF/container.xml') {
    zip.file('META-INF/container.xml', container);
  }
  let dirty = container !== containerOriginal || containerPath !== 'META-INF/container.xml';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  let opfText = decodeBytes(await zip.file(opfPath).async('uint8array'));
  const opfDoc = new DOMParser().parseFromString(opfText, 'application/xml');
  if (opfDoc.querySelector('parsererror')) return buf;
  let opfDirty = false;
  const items = [...opfDoc.getElementsByTagName('*')].filter(el => el.localName === 'item' && el.getAttribute('href'));
  for (const item of items) {
    const rawHref = item.getAttribute('href');
    const href = rawHref.split('#')[0];
    const hash = rawHref.includes('#') ? rawHref.slice(rawHref.indexOf('#')) : '';
    const joined = norm(opfDir + href);
    const actual = lookup(map, joined);
    if (!actual) continue;
    const rel = relative(opfDir, actual);
    if (rel !== href) {
      item.setAttribute('href', rel + hash);
      opfDirty = true;
    }
    const media = item.getAttribute('media-type') || '';
    if (!isDoc(actual, media)) continue;
    const bytes = await zip.file(actual).async('uint8array');
    const text = decodeBytes(bytes);
    let out = text;
    if (!xmlOk(text)) out = htmlToXhtml(text);
    else if (!/encoding\s*=\s*["']utf-8["']/i.test(text.slice(0, 200))) out = text.replace(/encoding\s*=\s*["'][^"']+["']/i, 'encoding="UTF-8"');
    const utf8 = new TextEncoder().encode(out);
    const same = utf8.length === bytes.length && utf8.every((b, i) => b === bytes[i]);
    if (!same) { zip.file(actual, out); dirty = true; }
  }
  if (opfDirty) {
    dirty = true;
    const xml = new XMLSerializer().serializeToString(opfDoc);
    zip.file(opfPath, xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
  }
  if (!dirty) return buf;
  if (zip.file('mimetype')) zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
