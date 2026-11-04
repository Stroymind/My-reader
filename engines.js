import { settings, epubCss, FONTS, fontStack } from './settings.js';

function flatToc(items, depth = 0, out = []) {
  for (const it of items || []) { out.push({ label: (it.label || '').trim(), target: it.href, depth }); flatToc(it.subitems, depth + 1, out); }
  return out;
}

/* ---------------- EPUB (epub.js) ---------------- */
export class EpubEngine {
  constructor(el, rec, onRelocate) { this.el = el; this.rec = rec; this.onRelocate = onRelocate; this.loc = null; }
  async open(blob) {
    this.book = ePub(await blob.arrayBuffer());
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
    s.textContent = epubCss(this.cjk);
    // 页边距
    doc.documentElement.style.setProperty('--rr-margin', settings.margin + 'px');
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
    if (cfi) { await this.rendition.display(cfi); await this.settle(cfi); }
  }
  resize() { try { this.rendition.resize(); } catch {} }
  destroy() { this.dead = true; try { this.book.destroy(); } catch {} this.el.innerHTML = ''; }
}

/* ---------------- PDF (pdf.js) ---------------- */
export class PdfEngine {
  constructor(el, rec, onRelocate, pdfjsLib) { this.el = el; this.rec = rec; this.onRelocate = onRelocate; this.lib = pdfjsLib; this.zoom = 1; }
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
    const vp1 = page.getViewport({ scale: 1 });
    const W = this.el.clientWidth - 8, H = this.el.clientHeight - 4;
    const fit = Math.min(W / vp1.width, H / vp1.height) * this.zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const vp = page.getViewport({ scale: fit * dpr });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = Math.floor(vp.width / dpr) + 'px'; c.style.height = Math.floor(vp.height / dpr) + 'px';
    this.renderTask?.cancel?.();
    this.renderTask = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
    try { await this.renderTask.promise; } catch { return; }
    if (token !== this.token) return;
    this.wrap.replaceChildren(c); this.canvas = c; this.wrap.scrollTo(0, 0);
    this.wrap.style.alignItems = this.zoom > 1 ? 'flex-start' : 'center';
    this.wrap.style.justifyContent = this.zoom > 1 ? 'flex-start' : 'center';
    this.onRelocate(this.current());
  }
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
  setZoom(z) { this.zoom = z; document.body.classList.toggle('pdf-zoom', z > 1); return this.render(); }
  applySettings() { return this.render(); }
  resize() { return this.render(); }
  destroy() { document.body.classList.remove('pdf-zoom'); try { this.doc.destroy(); } catch {} this.el.innerHTML = ''; }
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
  constructor(el, rec, onRelocate) { this.el = el; this.rec = rec; this.onRelocate = onRelocate; }
  async open(blob) {
    const { text, chapters } = splitChapters(decodeText(await blob.arrayBuffer()));
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
      if (first && c.heading) { html += `<h2>${esc(line)}</h2>`; first = false; continue; }
      first = false; html += `<p>${esc(line)}</p>`;
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
  hasLocations() { return true; }
  next() { if (this.p < this.pages - 1) { this.p++; this.paint(); } else if (this.ch < this.chs.length - 1) this.show(this.ch + 1, 0); }
  prev() { if (this.p > 0) { this.p--; this.paint(); } else if (this.ch > 0) this.show(this.ch - 1, 0, true); }
  goTo(pos) { this.show(pos.ch, pos.frac); }
  goToFraction(f) { const [ch, fr] = this.locate(f * this.total); this.show(ch, fr); }
  toc() { return this.chs.map((c, i) => ({ label: c.title, target: i, depth: 0 })); }
  goToc(i) { this.show(i, 0); }
  applySettings() { const frac = this.p / this.pages; this.show(this.ch, frac); }
  resize() { this.applySettings(); }
  destroy() { this.el.innerHTML = ''; }
}
