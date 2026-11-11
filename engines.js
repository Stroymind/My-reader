import { settings, epubCss, FONTS, fontStack } from './settings.js';
import { repairEpub } from './epub-repair.js';

function cleanWs(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

// HTML / HTM / XHTML → 纯文本段落。只取可读正文，不执行脚本。
export function htmlToPlain(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const title = cleanWs(doc.querySelector('title')?.textContent) || cleanWs(doc.querySelector('h1')?.textContent);
  const author = cleanWs(doc.querySelector('meta[name="author" i]')?.getAttribute('content'))
    || cleanWs(doc.querySelector('meta[name="creator" i]')?.getAttribute('content'))
    || cleanWs(doc.querySelector('meta[name="dc.creator" i]')?.getAttribute('content'));
  doc.querySelectorAll('script,style,noscript,iframe,object,embed,template,svg,link,meta').forEach(n => n.remove());
  doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  const root = doc.body || doc.documentElement;
  const lines = [];
  const push = (el) => {
    const t = cleanWs(el.innerText || el.textContent);
    if (t) lines.push(t);
  };
  for (const el of root.querySelectorAll('h1,h2,h3,h4,h5,p,li,blockquote,pre,figcaption')) {
    if (!/^H[1-5]$/.test(el.tagName) && el.tagName !== 'LI' && el.querySelector('p,li,blockquote,pre,h1,h2,h3,h4,h5')) continue;
    push(el);
  }
  if (!lines.length) {
    for (const el of root.querySelectorAll('div,section,article')) {
      if (el.querySelector('div,section,article,p,h1,h2,h3')) continue;
      push(el);
    }
  }
  if (!lines.length) {
    const raw = (root.innerText || root.textContent || '').replace(/\r\n?/g, '\n');
    for (const line of raw.split(/\n+/)) {
      const t = cleanWs(line);
      if (t) lines.push(t);
    }
  }
  return { title: title || '', author: author || '', text: lines.join('\n') };
}

export function normalizeQuote(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').replace(/[ \t\u3000]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t\u3000]{2,}/g, ' ').trim();
}

function renderMarked(line, marks) {
  const ranges = [];
  for (const m of marks) {
    const parts = String(m.text || '').split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const part of parts) {
      let from = 0, at;
      while ((at = line.indexOf(part, from)) >= 0) {
        ranges.push([at, at + part.length, m.kind]);
        from = at + part.length;
        if (part.length < 4) break;
      }
    }
  }
  if (!ranges.length) return esc(line);
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1], r[2]]);
  }
  let out = '', pos = 0;
  for (const [a, b, kind] of merged) {
    if (a < pos) continue;
    out += esc(line.slice(pos, a));
    const mark = kind === 'excerpt' ? 'ex' : kind === 'annotation' ? 'an' : 'hl';
    out += `<mark class="${mark}">${esc(line.slice(a, b))}</mark>`;
    pos = b;
  }
  return out + esc(line.slice(pos));
}

function textInView(rendition, viewEl) {
  const box = viewEl.getBoundingClientRect();
  const parts = [];
  const seen = new Set();
  let contents = [];
  try { contents = rendition.getContents(); } catch { return ''; }
  for (const c of contents) {
    const doc = c.document;
    if (!doc?.body) continue;
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect() || { left: 0, top: 0 };
    const nodes = doc.querySelectorAll('p, h1, h2, h3, h4, li, blockquote');
    for (const el of nodes) {
      if (el.querySelector('p, h1, h2, h3, li, blockquote')) continue;
      const r = el.getBoundingClientRect();
      const left = r.left + frame.left, right = r.right + frame.left, top = r.top + frame.top, bottom = r.bottom + frame.top;
      const overlap = Math.min(right, box.right) - Math.max(left, box.left);
      if (overlap < 24 || bottom < box.top + 2 || top > box.bottom - 2) continue;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && !seen.has(t)) { seen.add(t); parts.push(t); }
    }
  }
  return parts.join('\n');
}

function flatToc(items, depth = 0, out = []) {
  for (const it of items || []) { out.push({ label: (it.label || '').trim(), target: it.href, depth }); flatToc(it.subitems, depth + 1, out); }
  return out;
}

/* ---------------- EPUB (epub.js) ---------------- */
export class EpubEngine {
  constructor(el, rec, onRelocate) { this.el = el; this.rec = rec; this.onRelocate = onRelocate; this.loc = null; this.highlights = []; this.selecting = false; this._hlCfis = []; }
  async open(blob) {
    let data = await blob.arrayBuffer();
    try { data = await repairEpub(data); }
    catch (e) {
      if (e.code === 'DRM') throw new Error('这本 EPUB 有数字版权保护（DRM），无法在这里打开。');
      if (e.code === 'BAD_EPUB') throw e;
    }
    this.book = ePub(data);
    this.horiz = !!settings.horiz;
    this.book.opened.then(() => { this.origDir = this.book.package?.metadata?.direction; const md = this.book.package?.metadata || {}; this.cjk = /^(zh|ja|ko)/i.test(md.language || '') || /[\u3040-\u9fff]/.test(md.title || this.rec.title || ''); if (this.horiz && this.book.package?.metadata) this.book.package.metadata.direction = 'ltr'; });
    if (this.horiz) this.book.spine.hooks.content.register(doc => {
      const st = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
      st.textContent = 'html,body,body *{writing-mode:horizontal-tb !important;-webkit-writing-mode:horizontal-tb !important;-epub-writing-mode:horizontal-tb !important;direction:ltr !important}';
      (doc.querySelector('head') || doc.documentElement).appendChild(st);
    });
    this.rendition = this.book.renderTo(this.el, { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false, minSpreadWidth: 99999 });
    this.rendition.hooks.content.register(c => this.inject(c));
    this.rendition.on('relocated', loc => { if (this.dead) return; this.loc = loc; this.onRelocate(this.current()); });
    await this.book.ready;
    await this.book.loaded.navigation.catch(() => null);
    const saved = this.rec.locations;
    if (saved) { try { this.book.locations.load(saved); } catch {} }
    const p = this.rec.pending;
    if (this.rec.pos?.cfi) { await this.rendition.display(this.rec.pos.cfi).catch(() => this.rendition.display()); await this.settle(this.rec.pos.cfi); }
    else if (p?.startHref) {
      const cfi = await this.cfiAtFraction(p.startHref, p.chapterFraction || 0).catch(() => null);
      if (cfi) { await this.rendition.display(cfi).catch(() => this.rendition.display(p.startHref)); await this.settle(cfi); }
      else await this.rendition.display(p.startHref).catch(() => this.rendition.display());
    } else if (p?.progress) {
      await this.ensureLocations();
      await this.rendition.display(this.book.locations.cfiFromPercentage(p.progress));
    } else await this.rendition.display();
    const doc = this.rendition.getContents?.()[0]?.document;
    if (doc?.querySelector?.('parsererror')) throw new Error('这本 EPUB 的章节格式无法阅读。');
    if (!this.el.querySelector('iframe')) throw new Error('这本 EPUB 找不到可显示的章节。');
    try { this.vertical = this.horiz || this.origDir === 'rtl' || this.rendition.getContents().some(c => c.writingMode().startsWith('vertical')); } catch {}
    if (!saved) this.locationsPromise = this.ensureLocations();
  }
  // 迁移进度：章节内按正文字符比例定位到具体文字
  async cfiAtFraction(href, frac) {
    const sec = this.book.spine.get(href); if (!sec) return null;
    const root = await sec.load(this.book.load.bind(this.book)); const doc = root?.ownerDocument || root;
    try {
      const body = doc.body || doc.documentElement;
      const w = doc.createTreeWalker(body, 4); const nodes = []; let total = 0, n;
      while ((n = w.nextNode())) { const L = n.nodeValue.trim().length; if (L) { nodes.push([n, L]); total += L; } }
      if (!total) return sec.cfiBase ? `epubcfi(${sec.cfiBase}!/4)` : null;
      let want = Math.max(0, Math.min(total - 1, Math.floor(frac * total)));
      for (const [node, L] of nodes) {
        if (want < L) { const r = doc.createRange(); const lead = node.nodeValue.length - node.nodeValue.trimStart().length; r.setStart(node, Math.min(node.nodeValue.length, lead + want)); r.collapse(true); return new ePub.CFI(r, sec.cfiBase).toString(); }
        want -= L;
      }
    } finally { try { sec.unload(); } catch {} }
    return null;
  }
  // 等正文字体加载完成后（排版会变化）检查目标位置是否在当前页内，不在就重新定位
  inPage(cfi) {
    try { const C = new ePub.CFI(); const l = this.loc; return C.compare(l.start.cfi, cfi) <= 0 && C.compare(cfi, l.end.cfi) <= 0; } catch { return true; }
  }
  async settle(target) {
    target = target || this.loc?.start?.cfi; if (!target || !String(target).startsWith('epubcfi')) return;
    const docs = this.rendition.getContents().map(c => c.document);
    await Promise.race([Promise.all(docs.map(d => d.fonts?.ready)), new Promise(r => setTimeout(r, 4000))]);
    this.expandViews();
    // 字体就绪后重新定位一次，并等待新的位置上报
    for (let i = 0; i < 2; i++) {
      const moved = new Promise(r => { this.rendition.once('relocated', r); setTimeout(r, 3000); });
      await this.rendition.display(target); await moved;
      if (this.inPage(target)) break;
    }
  }
  // 字体加载后正文变长，iframe 宽度需要跟着扩展，否则后面的页无法翻到
  expandViews() { try { for (const v of this.rendition.manager.views.all()) v.expand(); } catch {} }
  inject(contents) {
    const doc = contents.document;
    doc.fonts?.ready.then(() => this.expandViews());
    doc.fonts?.addEventListener?.('loadingdone', () => this.expandViews());
    let s = doc.getElementById('rr-style');
    if (!s) { s = doc.createElement('style'); s.id = 'rr-style'; doc.head.appendChild(s); }
    s.textContent = epubCss(this.cjk) + '::selection{background:rgba(74,107,93,.28)}';
    // 页边距
    doc.documentElement.style.setProperty('--rr-margin', settings.margin + 'px');
    this.bindSelect(contents);
  }
  bindSelect(contents) {
    const doc = contents.document;
    if (!doc || doc.__rrSel) return;
    doc.__rrSel = true;
    const report = () => { if (this.selecting) this.onSelectionChange?.(); };
    doc.addEventListener('selectionchange', report);
    doc.addEventListener('mouseup', report);
    doc.addEventListener('touchend', report);
    doc.addEventListener('click', e => {
      if (this.selecting && e.target.closest?.('a')) e.preventDefault();
    }, true);
  }
  setSelectMode(on) { this.selecting = !!on; if (!on) this.clearSelection(); }
  selectAt(x, y) {
    let contents = [];
    try { contents = this.rendition.getContents(); } catch { return false; }
    for (const c of contents) {
      const frame = c.document?.defaultView?.frameElement;
      if (!frame) continue;
      const rect = frame.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const el = c.document.elementFromPoint(x - rect.left, y - rect.top);
      if (!el) return false;
      let block = el.closest?.('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, dd');
      if (!block) block = el.nodeType === 1 ? el : el.parentElement;
      if (!block || block === c.document.body || block === c.document.documentElement) return false;
      const text = (block.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return false;
      if (text.length > 500) {
        const leaf = el.closest?.('span, a, em, strong, b, i') || el;
        if ((leaf.textContent || '').trim().length > 500 || !(leaf.textContent || '').trim()) return false;
        block = leaf;
      }
      const range = c.document.createRange();
      range.selectNodeContents(block);
      const sel = c.window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }
    return false;
  }
  getSelection() {
    let contents = [];
    try { contents = this.rendition.getContents(); } catch { return null; }
    for (const c of contents) {
      const sel = c.window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) continue;
      const text = normalizeQuote(sel.toString());
      if (!text) continue;
      let cfiRange = null;
      try { cfiRange = c.cfiFromRange(sel.getRangeAt(0)); } catch {}
      return { text, pos: this.current()?.pos || null, cfiRange, ch: null, page: null };
    }
    return null;
  }
  clearSelection() {
    let contents = [];
    try { contents = this.rendition.getContents(); } catch { return; }
    for (const c of contents) { try { c.window.getSelection()?.removeAllRanges(); } catch {} }
  }
  setHighlights(list) { this.highlights = list || []; this.syncHighlights(); }
  syncHighlights() {
    if (!this.rendition) return;
    for (const cfi of this._hlCfis || []) {
      try { this.rendition.annotations.remove(cfi, 'highlight'); } catch {}
    }
    this._hlCfis = [];
    const night = settings.theme === 'night';
    for (const h of this.highlights) {
      if (!h.cfiRange || h.kind === 'copy') continue;
      const styles = h.kind === 'excerpt'
        ? { fill: night ? '#6ea894' : '#8fbfa8', 'fill-opacity': night ? '0.55' : '0.5', 'mix-blend-mode': 'multiply' }
        : h.kind === 'annotation'
          ? { fill: night ? '#6aa8ff' : '#7eb6ff', 'fill-opacity': night ? '0.45' : '0.45', 'mix-blend-mode': 'multiply' }
          : { fill: night ? '#d7b15a' : '#e2c15a', 'fill-opacity': night ? '0.5' : '0.55', 'mix-blend-mode': 'multiply' };
      try {
        this.rendition.annotations.highlight(h.cfiRange, { id: h.id }, null, 'rr-hl', styles);
        this._hlCfis.push(h.cfiRange);
      } catch (err) { console.warn(err); }
    }
  }
  async ensureLocations() {
    if (this.book.locations.length()) return;
    try { await this.book.locations.generate(1200); } catch { return; }
    if (this.dead) return;
    this.locationsReady = true;
    this.onLocationsReady?.(this.book.locations.save());
    if (this.loc) this.onRelocate(this.current());
  }
  hasLocations() { return this.book.locations.length() > 0; }
  current() {
    const l = this.loc; if (!l || this.dead) return null;
    let progress = null;
    if (this.hasLocations()) progress = this.book.locations.percentageFromCfi(l.start.cfi);
    else if (this.rec.pending?.progress && !this.rec.pos) progress = this.rec.pending.progress;
    return { pos: { cfi: l.start.cfi }, progress, label: this.chapterLabel(l.start.href), atEnd: l.atEnd };
  }
  chapterLabel(href) {
    const toc = flatToc(this.book.navigation?.toc);
    const file = (href || '').split('#')[0].split('/').pop();
    const same = toc.filter(t => t.target && t.target.split('#')[0].split('/').pop() === file);
    if (!same.length) return this.lastLabel || '';
    let found = same[0].label;
    if (same.length > 1) {
      // 同一文件里有多个章节锚点：取当前页之前的最后一个
      try {
        const contents = this.rendition.getContents().find(c => (c.document?.URL || '').length);
        const doc = contents?.document, cur = this.loc.start.cfi;
        const sec = this.book.spine.get(this.loc.start.href);
        const CFI = ePub.CFI;
        for (const t of same) {
          const id = t.target.split('#')[1]; if (!id) continue;
          const el = doc?.getElementById(id); if (!el) continue;
          const c = sec.cfiFromElement(el);
          if (new CFI().compare(c, cur) <= 0) found = t.label; else break;
        }
      } catch {}
    }
    return (this.lastLabel = found);
  }
  async snippet() {
    try { const r = await this.book.getRange(this.loc.start.cfi); const t = r.startContainer.textContent || ''; return t.slice(r.startOffset, r.startOffset + 40).trim(); } catch { return ''; }
  }
  next() { return this.rendition.next(); }
  prev() { return this.rendition.prev(); }
  async goTo(pos) { await this.rendition.display(pos.cfi); await this.settle(pos.cfi); }
  async goToFraction(f) { if (!this.hasLocations()) return; return this.rendition.display(this.book.locations.cfiFromPercentage(f)); }
  toc() { return flatToc(this.book.navigation?.toc); }
  goToc(target) { return this.rendition.display(target); }
  async applySettings() {
    const cfi = this.loc?.start?.cfi;
    for (const c of this.rendition.getContents()) this.inject(c);
    this.rendition.themes.fontSize(settings.size + 'px'); // 触发重新分页
    try { this.rendition.resize(this.el.clientWidth, this.el.clientHeight); } catch {}
    if (cfi) { await this.rendition.display(cfi); await this.settle(cfi); }
    this.syncHighlights();
  }
  resize() { try { this.rendition.resize(); } catch {} }
  pageText() { return textInView(this.rendition, this.el); }
  destroy() { this.dead = true; try { this.book.destroy(); } catch {} this.el.innerHTML = ''; }
}

/* ---------------- PDF (pdf.js) ---------------- */
export class PdfEngine {
  constructor(el, rec, onRelocate, pdfjsLib) { this.el = el; this.rec = rec; this.onRelocate = onRelocate; this.lib = pdfjsLib; this.zoom = 1; this.highlights = []; this.selecting = false; }
  async open(blob) {
    this.doc = await this.lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: './vendor/cmaps/', cMapPacked: true, standardFontDataUrl: './vendor/standard_fonts/' }).promise;
    this.n = this.doc.numPages;
    this.wrap = document.createElement('div'); this.wrap.className = 'pdfwrap'; this.el.appendChild(this.wrap);
    this.canvas = document.createElement('canvas'); this.wrap.appendChild(this.canvas);
    let page = this.rec.pos?.page;
    if (!page && this.rec.pending?.progress) page = Math.round(this.rec.pending.progress * (this.n - 1)) + 1;
    this.page = Math.min(Math.max(page || 1, 1), this.n);
    try { this.outline = await this.doc.getOutline(); } catch { this.outline = null; }
    await this.render();
  }
  async render() {
    const token = (this.token = (this.token || 0) + 1);
    const page = await this.doc.getPage(this.page);
    if (token !== this.token) return;
    if (this.reflow) return this.renderReflow(page, token);
    const vp1 = page.getViewport({ scale: 1 });
    const W = Math.max(1, this.el.clientWidth - 8), H = Math.max(1, this.el.clientHeight - 4);
    const fit = Math.min(W / vp1.width, H / vp1.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const vp = page.getViewport({ scale: fit * dpr });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = Math.floor(vp.width / dpr) + 'px'; c.style.height = Math.floor(vp.height / dpr) + 'px';
    this.renderTask?.cancel?.();
    this.renderTask = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
    try { await this.renderTask.promise; } catch { return; }
    if (token !== this.token) return;
    const box = document.createElement('div');
    box.className = 'pdfpage';
    const textLayerEl = document.createElement('div');
    textLayerEl.className = 'textLayer';
    box.append(c, textLayerEl);
    this.wrap.replaceChildren(box);
    this.canvas = c;
    this.textLayerEl = textLayerEl;
    this.wrap.scrollTo(0, 0);
    this.wrap.style.alignItems = 'center';
    this.wrap.style.justifyContent = 'center';
    const vpCss = page.getViewport({ scale: fit });
    try {
      textLayerEl.replaceChildren();
      const textContent = await page.getTextContent();
      if (token !== this.token) return;
      const layer = new this.lib.TextLayer({ textContentSource: textContent, container: textLayerEl, viewport: vpCss });
      this.textTask = layer;
      await layer.render();
    } catch (err) { console.warn(err); }
    if (token !== this.token) return;
    this.paintMarks();
    this.onRelocate(this.current());
  }
  paintMarks() {
    const root = this.textLayerEl;
    if (!root) return;
    root.querySelectorAll('.rr-mark').forEach(el => el.classList.remove('rr-mark', 'ex'));
    const quotes = (this.highlights || []).filter(h => h.kind !== 'copy' && h.text && (h.page == null || h.page === this.page));
    if (!quotes.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let raw = '';
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, start: raw.length });
      raw += walker.currentNode.nodeValue;
    }
    const map = [];
    let norm = '';
    for (let i = 0; i < raw.length; i++) {
      if (/\s/.test(raw[i])) continue;
      map.push(i);
      norm += raw[i];
    }
    for (const h of quotes) {
      const nq = h.text.replace(/\s+/g, '');
      if (!nq) continue;
      const idx = norm.indexOf(nq);
      if (idx < 0 || idx + nq.length > map.length) continue;
      const a = map[idx];
      const b = map[idx + nq.length - 1] + 1;
      for (const { node, start } of nodes) {
        const end = start + node.nodeValue.length;
        if (end <= a || start >= b) continue;
        const span = node.parentElement;
        if (!span || !root.contains(span)) continue;
        span.classList.add('rr-mark');
        if (h.kind === 'excerpt') span.classList.add('ex');
        else if (h.kind === 'annotation') span.classList.add('an');
      }
    }
  }
  setSelectMode(on) { this.selecting = !!on; if (!on) this.clearSelection(); }
  selectAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const span = el?.closest?.('.textLayer span');
    if (!span || !this.textLayerEl?.contains(span)) return false;
    const top = span.getBoundingClientRect().top;
    const line = [...this.textLayerEl.querySelectorAll('span')].filter(s => Math.abs(s.getBoundingClientRect().top - top) < 5);
    if (!line.length) return false;
    const range = document.createRange();
    range.setStartBefore(line[0]);
    range.setEndAfter(line[line.length - 1]);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  getSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !this.textLayerEl?.contains(sel.anchorNode)) return null;
    const text = normalizeQuote(sel.toString());
    if (!text) return null;
    return { text, pos: { page: this.page }, cfiRange: null, ch: null, page: this.page };
  }
  clearSelection() {
    const sel = window.getSelection();
    if (sel && this.textLayerEl?.contains(sel.anchorNode)) sel.removeAllRanges();
  }
  setHighlights(list) { this.highlights = list || []; this.paintMarks(); }
  current() { return { pos: { page: this.page }, progress: this.n > 1 ? (this.page - 1) / (this.n - 1) : 1, label: `第 ${this.page} / ${this.n} 页`, atEnd: this.page >= this.n }; }
  async snippet() { return `第 ${this.page} 页`; }
  hasLocations() { return true; }
  next() { if (this.page < this.n) { this.page++; return this.render(); } }
  prev() { if (this.page > 1) { this.page--; return this.render(); } }
  goTo(pos) { this.page = pos.page; return this.render(); }
  goToFraction(f) { this.page = Math.round(f * (this.n - 1)) + 1; return this.render(); }
  async toc() {
    const out = [];
    const walk = async (items, depth) => {
      for (const it of items || []) {
        let page = null;
        try {
          let dest = it.dest; if (typeof dest === 'string') dest = await this.doc.getDestination(dest);
          if (dest) page = (await this.doc.getPageIndex(dest[0])) + 1;
        } catch {}
        out.push({ label: it.title, target: page, depth });
        await walk(it.items, depth + 1);
      }
    };
    await walk(this.outline, 0);
    return out;
  }
  goToc(page) { if (page) { this.page = page; return this.render(); } }
  setReadingSize() { this.reflow = true; document.body.classList.remove('pdf-zoom'); return this.render(); }
  async renderReflow(page, token) {
    const content = await page.getTextContent();
    if (token !== this.token) return;
    const paras = pdfParagraphs(content.items || []);
    const col = document.createElement('div');
    col.className = 'pdfreflow';
    col.style.fontSize = settings.size + 'px';
    col.style.lineHeight = String(settings.lh);
    col.style.fontFamily = fontStack(true) || '';
    for (const para of paras) {
      const p = document.createElement('p');
      p.textContent = para;
      col.appendChild(p);
    }
    if (!paras.length) { const p = document.createElement('p'); p.textContent = '这一页没有可重排的文字。'; col.appendChild(p); }
    this.wrap.replaceChildren(col);
    this.textLayerEl = null;
    this.canvas = null;
    this.onRelocate(this.current());
  }
  pageText() {
    const col = this.wrap?.querySelector('.pdfreflow');
    if (col) return [...col.querySelectorAll('p')].map(p => p.textContent.trim()).filter(Boolean).join('\n');
    const root = this.textLayerEl;
    if (!root) return '';
    const lines = [];
    let line = '', lastTop = null;
    for (const span of root.querySelectorAll('span')) {
      const t = span.textContent || '';
      if (!t.trim()) continue;
      const top = span.getBoundingClientRect().top;
      if (lastTop != null && Math.abs(top - lastTop) > 5) { if (line.trim()) lines.push(line.trim()); line = ''; }
      line += t;
      lastTop = top;
    }
    if (line.trim()) lines.push(line.trim());
    return lines.join('\n');
  }
  applySettings() { if (this.reflow) return this.render(); return this.render(); }
  resize() { return this.render(); }
  destroy() { document.body.classList.remove('pdf-zoom'); try { this.textTask?.cancel?.(); } catch {} try { this.doc.destroy(); } catch {} this.el.innerHTML = ''; }
}

function pdfParagraphs(items) {
  const lines = [];
  let line = '', lastY = null;
  for (const it of items) {
    const str = it?.str || '';
    if (!str) continue;
    const y = it.transform ? it.transform[5] : 0;
    if (lastY != null && Math.abs(y - lastY) > 10) {
      if (line.trim()) lines.push(line.trim());
      line = '';
    }
    line += str;
    lastY = y;
  }
  if (line.trim()) lines.push(line.trim());
  const paras = [];
  let buf = '';
  for (const ln of lines) {
    buf = buf ? buf + ' ' + ln : ln;
    if (/[.!?。！？…"”]$/.test(ln) || ln.length > 80) { paras.push(buf); buf = ''; }
  }
  if (buf) paras.push(buf);
  return paras.length ? paras : lines;
}

/* ---------------- TXT（自动识别 UTF-8 / GBK）---------------- */
export function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch {}
  return new TextDecoder('gb18030').decode(b); // GBK 的超集
}
const CH_RE = /^[ \t\u3000]*(第[0-9０-９零〇一二三四五六七八九十百千万两]+[章节回卷集部篇幕][^\n]{0,30}|序章|序言|序|楔子|引子|前言|尾声|后记|番外[^\n]{0,20}|Chapter\s+\d+[^\n]{0,40}|CHAPTER\s+\d+[^\n]{0,40})[ \t\u3000]*$/gm;
export function splitChapters(text) {
  text = text.replace(/\r\n?/g, '\n');
  const marks = [];
  let m; CH_RE.lastIndex = 0;
  while ((m = CH_RE.exec(text))) marks.push({ idx: m.index, title: m[1].trim() });
  const chapters = [];
  if (marks.length >= 2) {
    if (marks[0].idx > 0 && text.slice(0, marks[0].idx).trim()) chapters.push({ title: '开始', start: 0, end: marks[0].idx });
    marks.forEach((mk, i) => chapters.push({ title: mk.title, start: mk.idx, end: i + 1 < marks.length ? marks[i + 1].idx : text.length, heading: true }));
  } else chapters.push({ title: '正文', start: 0, end: text.length });
  // 过长的章节再切分，保证排版速度
  const out = [];
  for (const c of chapters) {
    const L = c.end - c.start, MAX = 40000;
    if (L <= MAX) { out.push(c); continue; }
    let s = c.start, k = 1;
    while (s < c.end) {
      let e = Math.min(c.end, s + MAX); const nl = text.indexOf('\n', e); if (nl > 0 && nl < c.end && nl - e < 2000) e = nl;
      out.push({ title: k === 1 ? c.title : `${c.title}（${k}）`, start: s, end: e, heading: k === 1 && c.heading }); s = e; k++;
    }
  }
  return { text, chapters: out };
}
function esc(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

export class TxtEngine {
  constructor(el, rec, onRelocate) { this.el = el; this.rec = rec; this.onRelocate = onRelocate; this.highlights = []; this.selecting = false; }
  async open(blob) {
    let raw = decodeText(await blob.arrayBuffer());
    if (this.rec.type === 'html') raw = htmlToPlain(raw).text || raw;
    const { text, chapters } = splitChapters(raw);
    this.text = text; this.chs = chapters; this.total = text.length || 1;
    this.page_ = document.createElement('div'); this.page_.className = 'txtpage';
    this.cols = document.createElement('div'); this.cols.className = 'txtcols';
    this.page_.appendChild(this.cols); this.el.appendChild(this.page_);
    let ch = 0, frac = 0;
    if (this.rec.pos) { ch = this.rec.pos.ch; frac = this.rec.pos.frac; }
    else if (this.rec.pending?.progress) { [ch, frac] = this.locate(this.rec.pending.progress * this.total); }
    this.show(Math.min(ch, this.chs.length - 1), frac);
  }
  locate(off) {
    for (let i = 0; i < this.chs.length; i++) { const c = this.chs[i]; if (off < c.end) return [i, (off - c.start) / (c.end - c.start)]; }
    return [this.chs.length - 1, 1];
  }
  layout() {
    const w = this.page_.clientWidth;
    this.gap = 36; this.w = w;
    Object.assign(this.cols.style, { columnWidth: w + 'px', fontSize: settings.size + 'px', lineHeight: settings.lh, fontFamily: fontStack(/[\u3040-\u9fff]/.test(this.text.slice(0, 3000))) || '' });
    this.cols.style.transition = 'none';
    this.pages = Math.max(1, Math.round((this.cols.scrollWidth + this.gap) / (w + this.gap)));
  }
  show(ch, frac = 0, fromEnd = false) {
    this.ch = ch; const c = this.chs[ch];
    const body = this.text.slice(c.start, c.end);
    const lines = body.split('\n');
    let html = '';
    let first = true;
    for (let line of lines) {
      line = line.replace(/^[ \t\u3000]+/, '').trimEnd();
      if (!line) continue;
      const marks = (this.highlights || []).filter(h => h.kind !== 'copy' && h.text && (h.ch == null || h.ch === ch));
      const marked = renderMarked(line, marks);
      if (first && c.heading) { html += `<h2>${marked}</h2>`; first = false; continue; }
      first = false; html += `<p>${marked}</p>`;
    }
    this.cols.innerHTML = html || '<p></p>';
    this.layout();
    this.p = fromEnd ? this.pages - 1 : Math.max(0, Math.min(this.pages - 1, Math.floor(frac * this.pages + 1e-6)));
    this.paint();
  }
  paint() {
    this.cols.style.transform = `translateX(${-this.p * (this.w + this.gap)}px)`;
    this.onRelocate(this.current());
  }
  current() {
    const c = this.chs[this.ch]; const frac = this.p / this.pages;
    return { pos: { ch: this.ch, frac }, progress: (c.start + frac * (c.end - c.start)) / this.total, label: c.title, atEnd: this.ch === this.chs.length - 1 && this.p === this.pages - 1 };
  }
  async snippet() { const c = this.chs[this.ch]; const off = Math.floor(c.start + (this.p / this.pages) * (c.end - c.start)); return this.text.slice(off, off + 40).replace(/\s+/g, ' ').trim(); }
  setSelectMode(on) { this.selecting = !!on; if (!on) this.clearSelection(); }
  selectAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !this.page_?.contains(el)) return false;
    const block = el.closest('p, h1, h2') || el;
    if (!block || block === this.page_ || block === this.cols) return false;
    if (!(block.textContent || '').trim()) return false;
    const range = document.createRange();
    range.selectNodeContents(block);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  getSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !this.cols?.contains(sel.anchorNode)) return null;
    const text = normalizeQuote(sel.toString());
    if (!text) return null;
    const cur = this.current();
    let pos = cur?.pos || { ch: this.ch, frac: 0 };
    const c = this.chs[this.ch];
    const body = this.text.slice(c.start, c.end);
    const probe = text.split('\n').map(s => s.trim()).find(Boolean) || '';
    const at = probe ? body.indexOf(probe) : -1;
    if (at >= 0) pos = { ch: this.ch, frac: at / Math.max(1, c.end - c.start) };
    return { text, pos, cfiRange: null, ch: this.ch, page: null };
  }
  clearSelection() {
    const sel = window.getSelection();
    if (sel && this.cols?.contains(sel.anchorNode)) sel.removeAllRanges();
  }
  setHighlights(list) {
    this.highlights = list || [];
    if (!this.chs) return;
    const frac = this.pages ? this.p / this.pages : 0;
    this.show(this.ch, frac);
  }
  hasLocations() { return true; }
  next() { if (this.p < this.pages - 1) { this.p++; this.paint(); } else if (this.ch < this.chs.length - 1) this.show(this.ch + 1, 0); }
  prev() { if (this.p > 0) { this.p--; this.paint(); } else if (this.ch > 0) this.show(this.ch - 1, 0, true); }
  goTo(pos) { this.show(pos.ch, pos.frac); }
  goToFraction(f) { const [ch, fr] = this.locate(f * this.total); this.show(ch, fr); }
  toc() { return this.chs.map((c, i) => ({ label: c.title, target: i, depth: 0 })); }
  goToc(i) { this.show(i, 0); }
  pageText() {
    const box = this.page_?.getBoundingClientRect();
    if (!box) return '';
    const parts = [];
    for (const el of this.cols.querySelectorAll('p, h2')) {
      const r = el.getBoundingClientRect();
      const overlap = Math.min(r.right, box.right) - Math.max(r.left, box.left);
      if (overlap < 24 || r.bottom < box.top + 2 || r.top > box.bottom - 2) continue;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    }
    return parts.join('\n');
  }
  applySettings() { const frac = this.p / this.pages; this.show(this.ch, frac); }
  resize() { this.applySettings(); }
  destroy() { this.el.innerHTML = ''; }
}
