import * as pdfjsLib from './vendor/pdf.min.mjs';
import { db } from './db.js';
import { importFiles, parseManifest, applyManifestToLibrary } from './importer.js';
import { EpubEngine, PdfEngine, TxtEngine } from './engines.js';
import { settings, saveSettings, applyBodyTheme, FONTS, THEMES } from './settings.js';
import { isMostlyCjk, translateVisible } from './bilingual.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
const $ = s => document.querySelector(s);
const coverUrls = new Map();
const KIND = { highlight: '高亮', excerpt: '摘录', copy: '复制' };

function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms); }
function colorFor(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) % 360; return `hsl(${h} 22% 42%)`; }
const fmtPct = p => (p == null ? '' : (p * 100).toFixed(p < 0.1 && p > 0 ? 1 : 0) + '%');
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function emptyNote(text) { const d = document.createElement('div'); d.className = 'item'; d.textContent = text; return d; }

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/* ---------------- 书架 ---------------- */
const picked = new Set();
let viewGen = 0;
const SORTS = ['recent', 'added', 'title'];

function recentKey(b) { return b.lastOpened > 0 ? b.lastOpened : 0; }
function currentSort() {
  const v = localStorage.getItem('rr-sort') || 'recent';
  return SORTS.includes(v) ? v : 'recent';
}
function sortBooks(list, sort) {
  list.sort((a, b) => {
    if (sort === 'title') return (a.title || '').localeCompare(b.title || '', 'zh');
    if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
    const byRead = recentKey(b) - recentKey(a);
    if (byRead) return byRead;
    return (b.addedAt || 0) - (a.addedAt || 0);
  });
}
function paintSort() {
  const v = currentSort();
  document.querySelectorAll('#sort-seg button').forEach(b => {
    const on = b.dataset.sort === v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}
function updateManageBar() {
  const n = picked.size;
  $('#manage-bar').classList.toggle('hidden', n === 0);
  $('#manage-count').textContent = n ? `已选 ${n} 本` : '';
}
function showShelfPage() {
  const pager = $('#pager');
  if (pager) pager.scrollTo({ left: 0, behavior: 'smooth' });
}
function onDesk() {
  const pager = $('#pager');
  return !!(pager && pager.clientWidth && pager.scrollLeft > pager.clientWidth * 0.4);
}
async function deleteBooks(recs) {
  if (!recs.length) return;
  const msg = recs.length === 1
    ? `删除《${recs[0].title}》吗？\n阅读进度、书签和摘录会一起去掉。`
    : `删除这 ${recs.length} 本吗？\n阅读进度、书签和摘录会一起去掉。`;
  if (!confirm(msg)) return;
  for (const b of recs) {
    await db.del('books', b.id);
    await db.del('files', b.id);
    picked.delete(b.id);
  }
  updateManageBar();
  await renderLibrary();
}
function bindShelfBook(el, b) {
  let hold = null, sx = 0, sy = 0, held = false;
  const clearHold = () => { clearTimeout(hold); hold = null; };
  el.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; held = false;
    clearHold();
    hold = setTimeout(() => { hold = null; held = true; deleteBooks([b]); }, 520);
  });
  el.addEventListener('pointermove', e => {
    if (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12) clearHold();
  });
  el.addEventListener('pointerup', clearHold);
  el.addEventListener('pointercancel', clearHold);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.onclick = () => { if (held) { held = false; return; } openBook(b.id); };
}
async function renderLibrary() {
  const books = await db.all('books');
  const q = $('#search').value.trim().toLowerCase();
  const sort = currentSort();
  const list = books.filter(b => !q || (b.title + ' ' + b.author).toLowerCase().includes(q));
  sortBooks(list, sort);
  $('#empty').classList.toggle('hidden', books.length > 0);
  $('#no-match').classList.toggle('hidden', !q || list.length > 0 || books.length === 0);
  const chip = $('#search-chip');
  chip.classList.toggle('hidden', !q);
  chip.textContent = q ? `搜索「${$('#search').value.trim()}」 · 清除` : '';
  const grid = $('#grid'); grid.replaceChildren();
  const desk = $('#desk-list'); desk.replaceChildren();
  for (const b of list) {
    const el = document.createElement('div');
    el.className = 'book';
    el.dataset.id = b.id;
    let coverHtml;
    if (b.cover) { if (!coverUrls.has(b.id)) coverUrls.set(b.id, URL.createObjectURL(b.cover)); coverHtml = `<img alt="" loading="lazy" src="${coverUrls.get(b.id)}">`; }
    else coverHtml = `<div class="ph" style="background:${colorFor(b.title)}"></div>`;
    el.innerHTML = `<div class="cover" style="${b.cover ? '' : 'background:' + colorFor(b.title)}">${coverHtml}</div><span class="type">${b.type.toUpperCase()}</span><div class="t"></div><div class="a"></div><div class="pbar"><i style="width:${Math.round((b.progress || 0) * 100)}%"></i></div>`;
    el.querySelector('.t').textContent = b.title;
    el.querySelector('.a').textContent = [b.author, b.progress ? fmtPct(b.progress) : ''].filter(Boolean).join(' · ');
    const ph = el.querySelector('.ph'); if (ph) ph.textContent = b.title;
    bindShelfBook(el, b);
    grid.appendChild(el);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'desk-book' + (picked.has(b.id) ? ' picked' : '');
    row.innerHTML = `<span class="tick">✓</span><span class="nm"><b></b><small></small></span>`;
    row.querySelector('b').textContent = b.title;
    row.querySelector('small').textContent = [b.author, b.progress ? fmtPct(b.progress) : ''].filter(Boolean).join(' · ');
    row.onclick = () => {
      if (picked.has(b.id)) picked.delete(b.id); else picked.add(b.id);
      row.classList.toggle('picked', picked.has(b.id));
      updateManageBar();
    };
    desk.appendChild(row);
  }
  if (!list.length && q) desk.appendChild(Object.assign(document.createElement('p'), { className: 'desk-note', textContent: '没有匹配的书' }));
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    $('#storage-info').textContent = books.length ? `共 ${books.length} 本 · 已用空间 ${(e.usage / 1048576).toFixed(0)} MB` : '';
  }
  updateManageBar();
  paintSort();
  if (books.length && !localStorage.getItem('rr-hint-swipe') && !$('#reader').classList.contains('active')) {
    localStorage.setItem('rr-hint-swipe', '1');
    setTimeout(() => toast('向左滑，可以搜索、导入和整理', 3200), 500);
  }
}
$('#search').oninput = renderLibrary;
$('#search-chip').onclick = () => { $('#search').value = ''; renderLibrary(); };
document.querySelectorAll('#sort-seg button').forEach(b => b.onclick = () => {
  localStorage.setItem('rr-sort', b.dataset.sort);
  renderLibrary();
});
paintSort();
$('#btn-delete-picked').onclick = async () => {
  const books = await db.all('books');
  await deleteBooks(books.filter(b => picked.has(b.id)));
};
const pager = $('#pager');
function syncDots() {
  const i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
  document.querySelectorAll('.dot').forEach((d, n) => d.classList.toggle('on', n === i));
}
pager.addEventListener('scroll', syncDots, { passive: true });
document.querySelectorAll('.dot').forEach(d => d.onclick = () => {
  pager.scrollTo({ left: Number(d.dataset.page) * pager.clientWidth, behavior: 'smooth' });
});

$('#file-input').onchange = async e => {
  const files = Array.from(e.target.files || []); e.target.value = '';
  if (!files.length) return;
  try { await navigator.storage?.persist?.(); } catch {}
  const st = $('#import-status'); st.classList.remove('hidden');
  const onlyManifest = files.every(f => /\.json$/i.test(f.name));
  if (onlyManifest) {
    let n = 0; for (const f of files) { try { const m = parseManifest(JSON.parse(await f.text())); if (m) n += await applyManifestToLibrary(m); } catch {} }
    st.textContent = `已为 ${n} 本书恢复阅读进度。`; renderLibrary(); return;
  }
  const res = await importFiles(files, { pdfjsLib, onStatus: t => (st.textContent = t) });
  let msg = `导入完成：新增 ${res.added} 本`;
  if (res.dup) msg += `，已存在 ${res.dup} 本`;
  if (res.progressApplied) msg += `，恢复进度 ${res.progressApplied} 本`;
  if (res.skipped) msg += `，跳过 ${res.skipped} 个不支持的文件`;
  if (res.fail.length) msg += `\n失败 ${res.fail.length} 个：\n` + res.fail.map(f => `· ${f.title}：${f.reason}`).join('\n');
  st.textContent = msg;
  renderLibrary();
};

/* ---------------- 阅读器 ---------------- */
let engine = null, cur = null, lastState = null, saveTimer = null, snap = null, noteSel = null;

function showView(id) { document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id)); }
function setBars(show) { $('#bars').classList.toggle('hidden', !show); if (!show) { $('#settings').classList.add('hidden'); } }

async function rememberReading(id) {
  const now = Date.now();
  if (cur?.id === id) cur.lastOpened = now;
  await db.update('books', id, { lastOpened: now });
}
async function openBook(id) {
  if (engine && cur?.id === id) return;
  const gen = ++viewGen;
  if (engine) {
    clearTimeout(saveTimer); await persist(); exitSelect();
    try { engine.destroy(); } catch {}
    engine = null;
  }
  if (gen !== viewGen) return;
  const rec = await db.get('books', id); const file = await db.get('files', id);
  if (!rec || !file) return toast('找不到这本书的文件');
  if (gen !== viewGen) return;
  cur = rec; lastState = null;
  cur.bookmarks = cur.bookmarks || [];
  cur.highlights = cur.highlights || [];
  await rememberReading(id);
  if (gen !== viewGen) return;
  showView('reader'); setBars(false); exitSelect(); $('#loading').classList.remove('hidden');
  $('#r-title').textContent = rec.title; $('#run-title').textContent = rec.title;
  if (history.state?.reader) history.replaceState({ reader: id }, ''); else history.pushState({ reader: id }, '');
  const el = $('#viewer'); el.innerHTML = '';
  const Eng = rec.type === 'epub' ? EpubEngine : rec.type === 'pdf' ? PdfEngine : TxtEngine;
  engine = new Eng(el, rec, onRelocate, pdfjsLib);
  engine.onSelectionChange = () => {
    const sel = engine.getSelection?.();
    if (sel?.text) $('#select-hint').textContent = `已选中 ${sel.text.length} 个字`;
  };
  document.body.dataset.type = rec.type;
  engine.onLocationsReady = locs => db.update('books', id, { locations: locs });
  try { await engine.open(file.blob); }
  catch (e) {
    console.error(e);
    if (gen === viewGen) { toast('打开失败：' + (e.message || e), 4000); closeBook(); }
    return;
  }
  finally { if (gen === viewGen) $('#loading').classList.add('hidden'); }
  if (gen !== viewGen) return;
  engine.setHighlights?.(cur.highlights);
  if (rec.pending && engine.current()) { cur.pending = null; await db.update('books', id, r => { delete r.pending; return r; }); }
  updateBmIcon();
  refreshBilingual();
  if (!localStorage.getItem('rr-hint-select')) {
    localStorage.setItem('rr-hint-select', '1');
    setTimeout(() => toast('长按文字可以高亮、复制或保存摘录', 3600), 700);
  }
}

function onRelocate(state) {
  if (!state) return;
  lastState = state;
  const p = state.progress;
  $('#r-pct').textContent = p == null ? '…' : fmtPct(p);
  $('#run-pct').textContent = p == null ? '' : fmtPct(p);
  $('#r-pos').textContent = state.label || '';
  $('#r-slider').disabled = !engine?.hasLocations();
  if (p != null && !$('#r-slider').matches(':active')) $('#r-slider').value = Math.round(p * 1000);
  updateBmIcon();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(), 400);
  clearTimeout(onRelocate.bi);
  onRelocate.bi = setTimeout(() => refreshBilingual(), 180);
}
async function persist() {
  if (!cur) return;
  const patch = { lastOpened: Date.now() };
  if (lastState) {
    patch.pos = lastState.pos;
    if (lastState.progress != null) patch.progress = lastState.progress;
  }
  Object.assign(cur, patch);
  await db.update('books', cur.id, patch);
}
function exitSelect() {
  document.body.classList.remove('selecting');
  $('#select-bar')?.classList.add('hidden');
  snap = null;
  try { engine?.setSelectMode?.(false); } catch {}
  try { window.getSelection()?.removeAllRanges(); } catch {}
}
function enterSelect(x, y) {
  if (!engine) return;
  document.body.classList.add('selecting');
  setBars(false);
  $('#panel').classList.add('hidden');
  $('#settings').classList.add('hidden');
  $('#select-bar').classList.remove('hidden');
  engine.setSelectMode?.(true);
  if (x != null) engine.selectAt?.(x, y);
  const sel = engine.getSelection?.();
  snap = sel || null;
  $('#select-hint').textContent = sel?.text ? `已选中 ${sel.text.length} 个字` : '拖动选择文字，或长按一段';
}
let closing = null;
function closeBook() {
  if (closing) return closing;
  closing = (async () => {
    viewGen++;
    clearTimeout(saveTimer);
    try { await persist(); } catch (e) { console.error(e); }
    exitSelect();
    try { engine?.destroy(); } catch {}
    engine = null; cur = null; lastState = null;
    biToken++;
    document.body.classList.remove('bi');
    $('#bilingual')?.classList.add('hidden');
    $('#panel').classList.add('hidden'); $('#note-mask').classList.add('hidden');
    showView('library');
    showShelfPage();
    await renderLibrary();
  })();
  return closing.finally(() => { closing = null; });
}
$('#btn-back').onclick = () => history.back();
window.addEventListener('popstate', () => { if (engine) closeBook(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

// 点按 / 滑动翻页；长按进入选择
(function gestures() {
  const tap = $('#tap'), viewer = $('#viewer');
  let sx = 0, sy = 0, st = 0, pid = null, timer = null, suppressUp = false, moved = false;
  const clearTimer = () => { clearTimeout(timer); timer = null; };
  const down = e => {
    if (e.button != null && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; st = Date.now(); pid = e.pointerId; moved = false;
    clearTimer();
    if (!engine) return;
    timer = setTimeout(() => {
      timer = null;
      if (moved) return;
      suppressUp = true;
      enterSelect(sx, sy);
    }, 480);
  };
  const move = e => {
    if (pid !== e.pointerId) return;
    if (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12) { moved = true; clearTimer(); }
  };
  const up = e => {
    clearTimer();
    if (pid != null && pid !== e.pointerId) return;
    pid = null;
    if (!engine) return;
    if (suppressUp) { suppressUp = false; return; }
    if (document.body.classList.contains('selecting')) return;
    const zoomed = document.body.classList.contains('pdf-zoom');
    if (zoomed && e.currentTarget === tap) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!zoomed && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2 && Date.now() - st < 800) { dx < 0 ? turn(1) : turn(-1); return; }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const barsOpen = !$('#bars').classList.contains('hidden');
    if (barsOpen) { setBars(false); return; }
    const w = window.innerWidth, x = e.clientX;
    if (x < w * 0.3) turn(-1); else if (x > w * 0.7) turn(1); else setBars(true);
  };
  for (const el of [tap, viewer]) {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { clearTimer(); pid = null; });
  }
  document.addEventListener('keydown', e => {
    if (!engine) return;
    if (e.target.matches('input, textarea')) return;
    if (document.body.classList.contains('selecting')) { if (e.key === 'Escape') exitSelect(); return; }
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) turn(1);
    if (['ArrowLeft', 'PageUp'].includes(e.key)) turn(-1);
  });
})();
let turning = false;
async function turn(d) { if (turning) return; turning = true; try { await (d > 0 ? engine.next() : engine.prev()); } finally { turning = false; } }

$('#r-slider').addEventListener('change', e => engine?.goToFraction(e.target.value / 1000));
document.addEventListener('selectionchange', () => {
  if (!document.body.classList.contains('selecting') || !engine?.getSelection) return;
  const sel = engine.getSelection();
  if (sel?.text) { snap = sel; $('#select-hint').textContent = `已选中 ${sel.text.length} 个字`; }
});

/* 面板：目录 / 书签 / 划线 */
function openPanel(title, nodes) { $('#panel-title').textContent = title; $('#panel-body').replaceChildren(...nodes); $('#panel').classList.remove('hidden'); }
$('#panel-close').onclick = () => $('#panel').classList.add('hidden');
$('#btn-toc').onclick = async () => {
  const toc = await engine.toc();
  const curLabel = lastState?.label;
  const nodes = toc.length ? toc.map(t => { const b = document.createElement('button'); b.className = 'item' + (t.label === curLabel ? ' cur' : ''); b.style.paddingLeft = 16 + t.depth * 18 + 'px'; b.textContent = t.label || '（无标题）'; b.onclick = async () => { $('#panel').classList.add('hidden'); setBars(false); await engine.goToc(t.target); }; return b; })
    : [emptyNote('这本书没有目录')];
  openPanel('目录', nodes);
  $('#panel-body').querySelector('.cur')?.scrollIntoView({ block: 'center' });
};
function samePos(a, b) { return a && b && JSON.stringify(a) === JSON.stringify(b); }
function updateBmIcon() { const on = cur?.bookmarks?.some(b => samePos(b.pos, lastState?.pos)); $('#btn-bm').textContent = on ? '★' : '☆'; }
$('#btn-bm').onclick = async () => {
  if (!cur || !lastState) return;
  cur.bookmarks = cur.bookmarks || [];
  const i = cur.bookmarks.findIndex(b => samePos(b.pos, lastState.pos));
  if (i >= 0) { cur.bookmarks.splice(i, 1); toast('已删除书签'); }
  else { cur.bookmarks.push({ pos: lastState.pos, progress: lastState.progress, label: lastState.label, text: await engine.snippet(), at: Date.now() }); toast('已添加书签'); }
  await db.update('books', cur.id, { bookmarks: cur.bookmarks }); updateBmIcon();
};
$('#btn-bms').onclick = () => {
  const list = (cur.bookmarks || []).slice().sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0));
  const nodes = list.length ? list.map(bm => {
    const row = document.createElement('div'); row.className = 'item-row';
    const b = document.createElement('button'); b.className = 'item';
    b.textContent = bm.text || bm.label || '书签';
    const sm = document.createElement('small'); sm.textContent = [bm.label, fmtPct(bm.progress), new Date(bm.at).toLocaleDateString('zh-CN')].filter(Boolean).join(' · '); b.appendChild(sm);
    b.onclick = async () => { $('#panel').classList.add('hidden'); setBars(false); await engine.goTo(bm.pos); };
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '删除';
    x.onclick = async () => { cur.bookmarks.splice(cur.bookmarks.indexOf(bm), 1); await db.update('books', cur.id, { bookmarks: cur.bookmarks }); row.remove(); updateBmIcon(); };
    row.append(b, x); return row;
  }) : [emptyNote('还没有书签。阅读时点屏幕中间，再点右上角 ☆ 即可添加。')];
  openPanel('书签', nodes);
};

function passageRow(book, item, { onOpen, onDelete }) {
  const row = document.createElement('div'); row.className = 'item-row passage';
  const b = document.createElement('button'); b.className = 'item';
  const kind = document.createElement('span'); kind.className = 'kind'; kind.textContent = KIND[item.kind] || '摘录';
  const tx = document.createElement('span'); tx.className = 'passage-text'; tx.textContent = item.text;
  const sm = document.createElement('small');
  sm.textContent = [book?.title, item.label, item.note, new Date(item.createdAt).toLocaleDateString('zh-CN')].filter(Boolean).join(' · ');
  b.append(kind, tx, sm);
  b.onclick = () => onOpen();
  const copy = document.createElement('button'); copy.className = 'x'; copy.textContent = '复制';
  copy.onclick = async ev => { ev.stopPropagation(); toast(await copyText(item.text) ? '已复制' : '复制失败'); };
  const del = document.createElement('button'); del.className = 'x danger'; del.textContent = '删除';
  del.onclick = async ev => { ev.stopPropagation(); await onDelete(); row.remove(); };
  row.append(b, copy, del);
  return row;
}
async function deletePassage(bookId, item) {
  const rec = bookId === cur?.id ? cur : await db.get('books', bookId);
  if (!rec) return;
  rec.highlights = (rec.highlights || []).filter(h => h.id !== item.id);
  await db.update('books', bookId, { highlights: rec.highlights });
  if (cur?.id === bookId) engine?.setHighlights?.(cur.highlights);
}
async function openPassage(bookId, item) {
  $('#lib-panel').classList.add('hidden');
  $('#panel').classList.add('hidden');
  exitSelect();
  if (!engine || cur?.id !== bookId) await openBook(bookId);
  try { if (item.pos) await engine?.goTo(item.pos); } catch (err) { console.warn(err); }
}
function openHighlightPanel() {
  const list = (cur?.highlights || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const nodes = [];
  const pick = document.createElement('button');
  pick.className = 'item cur';
  pick.textContent = '选择文字';
  pick.onclick = () => enterSelect(null, null);
  nodes.push(pick);
  if (!list.length) nodes.push(emptyNote('还没有划线。点上方“选择文字”，或长按一段文字，就可以高亮、复制和摘录。'));
  else for (const item of list) nodes.push(passageRow(cur, item, {
    onOpen: async () => { $('#panel').classList.add('hidden'); setBars(false); try { if (item.pos) await engine.goTo(item.pos); } catch {} },
    onDelete: () => deletePassage(cur.id, item)
  }));
  openPanel('划线与摘录', nodes);
}
$('#btn-hls').onclick = () => openHighlightPanel();
async function openLibraryExcerpts() {
  const books = await db.all('books');
  const items = [];
  for (const b of books) for (const h of b.highlights || []) items.push({ book: b, item: h });
  items.sort((a, b) => b.item.createdAt - a.item.createdAt);
  const nodes = items.length ? items.map(({ book, item }) => passageRow(book, item, {
    onOpen: () => openPassage(book.id, item),
    onDelete: () => deletePassage(book.id, item)
  })) : [emptyNote('还没有摘录。打开一本书，长按文字即可高亮、复制或保存。')];
  $('#lib-title').textContent = '摘录';
  $('#lib-body').replaceChildren(...nodes);
  $('#lib-panel').classList.remove('hidden');
}
$('#btn-excerpts').onclick = () => openLibraryExcerpts();
$('#lib-close').onclick = () => $('#lib-panel').classList.add('hidden');

function currentSelection() { return snap || engine?.getSelection?.() || null; }
async function persistHighlights() {
  if (!cur) return;
  const highlights = (cur.highlights || []).map(h => ({ ...h }));
  cur.highlights = highlights;
  await db.update('books', cur.id, { highlights });
  engine?.setHighlights?.(highlights);
}
async function addPassage(kind, sel, note = '') {
  if (!cur) return false;
  sel = sel || currentSelection();
  const text = (sel?.text || '').trim();
  if (!text) { toast('请先选中文字'); return false; }
  const limited = text.length > 4000 ? text.slice(0, 4000) : text;
  cur.highlights = cur.highlights || [];
  if (kind === 'highlight') {
    const i = cur.highlights.findIndex(h => h.kind === 'highlight' && h.text === limited && (
      (h.cfiRange && sel.cfiRange && h.cfiRange === sel.cfiRange)
      || (sel.ch != null && h.ch === sel.ch)
      || (sel.page != null && h.page === sel.page)
    ));
    if (i >= 0) { cur.highlights.splice(i, 1); await persistHighlights(); toast('已取消高亮'); return true; }
  }
  if (kind === 'copy' && cur.highlights.some(h => h.kind === 'copy' && h.text === limited)) return 'dup';
  cur.highlights.push({
    id: uid(), kind, text: limited, note: note || '',
    pos: sel.pos || lastState?.pos || null,
    cfiRange: sel.cfiRange || null,
    ch: sel.ch ?? null,
    page: sel.page ?? null,
    progress: lastState?.progress ?? null,
    label: lastState?.label || '',
    createdAt: Date.now()
  });
  await persistHighlights();
  return true;
}
$('#select-bar').addEventListener('mousedown', e => {
  if (e.target.closest('button')) { snap = engine?.getSelection?.() || snap; e.preventDefault(); }
});
$('#select-bar').addEventListener('touchstart', e => {
  if (e.target.closest('button')) snap = engine?.getSelection?.() || snap;
}, { passive: true });
$('#btn-hl').onclick = async () => {
  const sel = currentSelection();
  const ok = await addPassage('highlight', sel);
  if (ok) exitSelect();
};
$('#btn-copy').onclick = async () => {
  const sel = currentSelection();
  if (!sel?.text) { toast('请先选中文字'); return; }
  const copied = await copyText(sel.text);
  const saved = await addPassage('copy', sel);
  if (copied && saved === 'dup') toast('已复制（摘录里已经有这段）');
  else if (copied) toast('已复制，并保存到摘录');
  else if (saved) toast('剪贴板不可用，已保存在摘录里');
  else toast('复制失败');
  if (copied || saved) exitSelect();
};
$('#btn-excerpt').onclick = () => {
  const sel = currentSelection();
  if (!sel?.text) { toast('请先选中文字'); return; }
  noteSel = sel;
  $('#note-quote').textContent = sel.text.length > 180 ? sel.text.slice(0, 180) + '…' : sel.text;
  $('#note-text').value = '';
  $('#note-mask').classList.remove('hidden');
  setTimeout(() => $('#note-text').focus(), 30);
};
$('#btn-select-done').onclick = () => exitSelect();
$('#btn-bi-off').onclick = () => { settings.bilingual = false; saveSettings(); refreshBilingual(); };
let biToken = 0;
function renderPairs(pairs) {
  const body = $('#bi-body');
  body.replaceChildren();
  if (!pairs.length) { body.appendChild(Object.assign(document.createElement('p'), { className: 'bi-miss', textContent: '这一页没有需要对照的英文。' })); return; }
  for (const pair of pairs) {
    const block = document.createElement('div');
    block.className = 'bi-pair';
    const en = document.createElement('p');
    en.className = 'bi-en';
    en.textContent = pair.en;
    const zh = document.createElement('p');
    zh.className = 'bi-zh';
    zh.textContent = pair.zh || '这句暂时没有译出来。';
    block.append(en, zh);
    body.appendChild(block);
  }
}
function refreshBilingual() {
  const token = ++biToken;
  const pane = $('#bilingual');
  const on = settings.bilingual !== false;
  const text = on && engine?.pageText ? (engine.pageText() || '') : '';
  if (!on || !text.trim() || isMostlyCjk(text)) {
    document.body.classList.remove('bi');
    pane?.classList.add('hidden');
    return;
  }
  document.body.classList.add('bi');
  pane.classList.remove('hidden');
  $('#bi-body').replaceChildren(Object.assign(document.createElement('p'), { className: 'bi-wait', textContent: '正在翻译这一页…' }));
  translateVisible(text, () => token === biToken).then(res => {
    if (token !== biToken) return;
    if (res.chinese || !res.pairs.length) { document.body.classList.remove('bi'); pane.classList.add('hidden'); return; }
    renderPairs(res.pairs);
  }).catch(() => {
    if (token !== biToken) return;
    $('#bi-body').replaceChildren(Object.assign(document.createElement('p'), { className: 'bi-miss', textContent: '这一页暂时没有译出来。原文仍在上面。' }));
  });
}
$('#btn-select').onclick = () => enterSelect(null, null);
$('#note-cancel').onclick = () => { $('#note-mask').classList.add('hidden'); noteSel = null; };
$('#note-dialog').onsubmit = async e => {
  e.preventDefault();
  const sel = noteSel;
  const note = $('#note-text').value.trim();
  $('#note-mask').classList.add('hidden');
  const ok = await addPassage('excerpt', sel, note);
  noteSel = null;
  if (ok) { toast(note ? '已保存摘录和笔记' : '已保存摘录'); exitSelect(); }
};

/* 排版设置 */
function buildSettings() {
  const s = $('#settings'); s.innerHTML = '';
  const row = (label, ...kids) => { const r = document.createElement('div'); r.className = 'srow'; const l = document.createElement('span'); l.className = 'slabel'; l.textContent = label; const g = document.createElement('div'); g.className = 'seg'; g.append(...kids); r.append(l, g); s.appendChild(r); };
  const btn = (txt, on, fn, cls = '') => { const b = document.createElement('button'); b.textContent = txt; b.className = (on ? 'on ' : '') + cls; b.onclick = fn; return b; };
  const apply = async () => { saveSettings(); applyBodyTheme(); buildSettings(); await engine?.applySettings(); refreshBilingual(); };
  row('对照', btn('开', settings.bilingual !== false, () => { settings.bilingual = true; saveSettings(); buildSettings(); refreshBilingual(); }), btn('关', settings.bilingual === false, () => { settings.bilingual = false; saveSettings(); buildSettings(); refreshBilingual(); }));
  if (cur?.type === 'pdf') {
    row('缩放', btn('−', false, () => engine.setZoom(Math.max(1, engine.zoom - 0.25))), btn('适应', false, () => engine.setZoom(1)), btn('+', false, () => engine.setZoom(Math.min(4, engine.zoom + 0.25))));
  } else {
    row('字号', btn('A−', false, () => { settings.size = Math.max(12, settings.size - 1); apply(); }, 'small'), Object.assign(document.createElement('span'), { className: 'sval', textContent: settings.size }), btn('A+', false, () => { settings.size = Math.min(40, settings.size + 1); apply(); }, 'big'));
    row('字体', ...Object.entries(FONTS).filter(([k]) => cur?.type === 'epub' || k !== 'original').map(([k, f]) => btn(f.label, settings.font === k, () => { settings.font = k; apply(); }, 'font-' + k)));
    row('行距', ...[[1.5, '紧凑'], [1.8, '适中'], [2.1, '宽松']].map(([v, l]) => btn(l, Math.abs(settings.lh - v) < 0.01, () => { settings.lh = v; apply(); })));
  }
  if (cur?.type === 'epub' && engine?.vertical) row('竖排', btn('原样', !settings.horiz, () => { settings.horiz = false; saveSettings(); reopen(); }), btn('转横排', !!settings.horiz, () => { settings.horiz = true; saveSettings(); reopen(); }));
  row('主题', ...Object.entries(THEMES).map(([k, t]) => { const b = btn(t.label, settings.theme === k, () => { settings.theme = k; apply(); }, 'swatch'); b.style.background = t.bg; b.style.color = t.fg; return b; }));
}
async function reopen() { const id = cur.id; $('#settings').classList.add('hidden'); await closeBook(); await openBook(id); }
$('#btn-aa').onclick = () => { const s = $('#settings'); const show = s.classList.contains('hidden'); if (show) buildSettings(); s.classList.toggle('hidden', !show); };

let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => engine?.resize(), 250); });

function handleBack() {
  if (!$('#note-mask').classList.contains('hidden')) { $('#note-mask').classList.add('hidden'); noteSel = null; return true; }
  if (document.body.classList.contains('selecting')) { exitSelect(); return true; }
  if (!$('#panel').classList.contains('hidden')) { $('#panel').classList.add('hidden'); return true; }
  if (!$('#settings').classList.contains('hidden')) { $('#settings').classList.add('hidden'); return true; }
  if (!$('#lib-panel').classList.contains('hidden')) { $('#lib-panel').classList.add('hidden'); return true; }
  if (onDesk()) { picked.clear(); showShelfPage(); renderLibrary(); return true; }
  if (engine) { history.back(); return true; }
  return false;
}

/* 启动 */
applyBodyTheme();
renderLibrary();
const nativeApp = !!(window.Capacitor?.isNativePlatform?.());
if (nativeApp && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
} else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadCtrl = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtrl && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.__app = { db, openBook, closeBook, importFiles, handleBack, get engine() { return engine; }, renderLibrary };
