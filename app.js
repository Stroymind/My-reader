import * as pdfjsLib from './vendor/pdf.min.mjs';
import { db } from './db.js';
import { importFiles, parseManifest, applyManifestToLibrary } from './importer.js';
import { EpubEngine, PdfEngine, TxtEngine } from './engines.js';
import { settings, saveSettings, applyBodyTheme, FONTS, THEMES } from './settings.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
const $ = s => document.querySelector(s);
const coverUrls = new Map();
let editing = false;

function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms); }
function colorFor(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) % 360; return `hsl(${h} 22% 42%)`; }
const fmtPct = p => (p == null ? '' : (p * 100).toFixed(p < 0.1 && p > 0 ? 1 : 0) + '%');

/* ---------------- 书架 ---------------- */
async function renderLibrary() {
  const books = await db.all('books');
  const q = $('#search').value.trim().toLowerCase();
  const sort = $('#sort').value;
  let list = books.filter(b => !q || (b.title + ' ' + b.author).toLowerCase().includes(q));
  list.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh') : sort === 'added' ? b.addedAt - a.addedAt : (b.lastOpened || b.addedAt / 1e3) - (a.lastOpened || a.addedAt / 1e3));
  $('#empty').classList.toggle('hidden', books.length > 0);
  $('.sortbar').classList.toggle('hidden', books.length === 0);
  const grid = $('#grid'); grid.replaceChildren();
  for (const b of list) {
    const el = document.createElement('div'); el.className = 'book'; el.dataset.id = b.id;
    let coverHtml;
    if (b.cover) { if (!coverUrls.has(b.id)) coverUrls.set(b.id, URL.createObjectURL(b.cover)); coverHtml = `<img alt="" loading="lazy" src="${coverUrls.get(b.id)}">`; }
    else coverHtml = `<div class="ph" style="background:${colorFor(b.title)}"></div>`;
    el.innerHTML = `<div class="cover" style="${b.cover ? '' : 'background:' + colorFor(b.title)}">${coverHtml}</div><span class="type">${b.type.toUpperCase()}</span><div class="t"></div><div class="a"></div><div class="pbar"><i style="width:${Math.round((b.progress || 0) * 100)}%"></i></div><button class="del" aria-label="删除">×</button>`;
    el.querySelector('.t').textContent = b.title;
    el.querySelector('.a').textContent = [b.author, b.progress ? fmtPct(b.progress) : ''].filter(Boolean).join(' · ');
    const ph = el.querySelector('.ph'); if (ph) ph.textContent = b.title;
    el.querySelector('.del').onclick = async e => { e.stopPropagation(); if (confirm(`确定删除《${b.title}》吗？\n（阅读进度与书签也会一起删除）`)) { await db.del('books', b.id); await db.del('files', b.id); renderLibrary(); } };
    el.onclick = () => { if (!editing) openBook(b.id); };
    grid.appendChild(el);
  }
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    $('#storage-info').textContent = `共 ${books.length} 本 · 已用空间 ${(e.usage / 1048576).toFixed(0)} MB`;
  }
}
$('#search').oninput = renderLibrary; $('#sort').onchange = () => { localStorage.setItem('rr-sort', $('#sort').value); renderLibrary(); };
$('#sort').value = localStorage.getItem('rr-sort') || 'recent';
$('#btn-edit').onclick = () => { editing = !editing; document.body.classList.toggle('editing', editing); $('#btn-edit').textContent = editing ? '完成' : '管理'; };

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
  if (res.fail.length) msg += `\n失败 ${res.fail.length} 个：\n` + res.fail.map(f => `· ${f.title}：${f.reason}`).join('\n');
  st.textContent = msg;
  renderLibrary();
};

/* ---------------- 阅读器 ---------------- */
let engine = null, cur = null, lastState = null, saveTimer = null;

function showView(id) { document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id)); }
function setBars(show) { $('#bars').classList.toggle('hidden', !show); if (!show) { $('#settings').classList.add('hidden'); } }

async function openBook(id) {
  const rec = await db.get('books', id); const file = await db.get('files', id);
  if (!rec || !file) return toast('找不到这本书的文件');
  cur = rec; lastState = null;
  showView('reader'); setBars(false); $('#loading').classList.remove('hidden');
  $('#r-title').textContent = rec.title; $('#run-title').textContent = rec.title;
  if (history.state?.reader) history.replaceState({ reader: id }, ''); else history.pushState({ reader: id }, '');
  const el = $('#viewer'); el.innerHTML = '';
  const Eng = rec.type === 'epub' ? EpubEngine : rec.type === 'pdf' ? PdfEngine : TxtEngine;
  engine = new Eng(el, rec, onRelocate, pdfjsLib);
  document.body.dataset.type = rec.type;
  engine.onLocationsReady = locs => db.update('books', id, { locations: locs });
  try { await engine.open(file.blob); }
  catch (e) { console.error(e); toast('打开失败：' + (e.message || e), 4000); closeBook(); return; }
  finally { $('#loading').classList.add('hidden'); }
  if (rec.pending && engine.current()) { cur.pending = null; await db.update('books', id, r => { delete r.pending; return r; }); }
  db.update('books', id, { lastOpened: Date.now() });
  updateBmIcon();
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
}
async function persist() {
  if (!cur || !lastState) return;
  const patch = { pos: lastState.pos, lastOpened: Date.now() };
  if (lastState.progress != null) patch.progress = lastState.progress;
  Object.assign(cur, patch);
  await db.update('books', cur.id, patch);
}
async function closeBook() {
  clearTimeout(saveTimer); await persist();
  engine?.destroy(); engine = null; cur = null;
  $('#panel').classList.add('hidden'); showView('library'); renderLibrary();
}
$('#btn-back').onclick = () => history.back();
window.addEventListener('popstate', () => { if (engine) closeBook(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

// 点按 / 滑动翻页
(function gestures() {
  const tap = $('#tap'), viewer = $('#viewer'); let sx = 0, sy = 0, st = 0;
  const down = e => { sx = e.clientX; sy = e.clientY; st = Date.now(); };
  const up = e => {
    if (!engine) return;
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
  for (const el of [tap, viewer]) { el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); }
  document.addEventListener('keydown', e => {
    if (!engine) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) turn(1);
    if (['ArrowLeft', 'PageUp'].includes(e.key)) turn(-1);
  });
})();
let turning = false;
async function turn(d) { if (turning) return; turning = true; try { await (d > 0 ? engine.next() : engine.prev()); } finally { turning = false; } }

$('#r-slider').addEventListener('change', e => engine?.goToFraction(e.target.value / 1000));

/* 面板：目录 / 书签 */
function openPanel(title, nodes) { $('#panel-title').textContent = title; $('#panel-body').replaceChildren(...nodes); $('#panel').classList.remove('hidden'); }
$('#panel-close').onclick = () => $('#panel').classList.add('hidden');
$('#btn-toc').onclick = async () => {
  const toc = await engine.toc();
  const curLabel = lastState?.label;
  const nodes = toc.length ? toc.map(t => { const b = document.createElement('button'); b.className = 'item' + (t.label === curLabel ? ' cur' : ''); b.style.paddingLeft = 16 + t.depth * 18 + 'px'; b.textContent = t.label || '（无标题）'; b.onclick = async () => { $('#panel').classList.add('hidden'); setBars(false); await engine.goToc(t.target); }; return b; })
    : [Object.assign(document.createElement('div'), { className: 'item', textContent: '这本书没有目录' })];
  openPanel('目录', nodes);
  $('#panel-body').querySelector('.cur')?.scrollIntoView({ block: 'center' });
};
function samePos(a, b) { return a && b && JSON.stringify(a) === JSON.stringify(b); }
function updateBmIcon() { const on = cur?.bookmarks?.some(b => samePos(b.pos, lastState?.pos)); $('#btn-bm').textContent = on ? '★' : '☆'; }
$('#btn-bm').onclick = async () => {
  if (!cur || !lastState) return;
  const i = cur.bookmarks.findIndex(b => samePos(b.pos, lastState.pos));
  if (i >= 0) { cur.bookmarks.splice(i, 1); toast('已删除书签'); }
  else { cur.bookmarks.push({ pos: lastState.pos, progress: lastState.progress, label: lastState.label, text: await engine.snippet(), at: Date.now() }); toast('已添加书签'); }
  await db.update('books', cur.id, { bookmarks: cur.bookmarks }); updateBmIcon();
};
$('#btn-bms').onclick = () => {
  const list = cur.bookmarks.slice().sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0));
  const nodes = list.length ? list.map(bm => {
    const row = document.createElement('div'); row.className = 'item-row';
    const b = document.createElement('button'); b.className = 'item';
    b.textContent = bm.text || bm.label || '书签';
    const sm = document.createElement('small'); sm.textContent = [bm.label, fmtPct(bm.progress), new Date(bm.at).toLocaleDateString('zh-CN')].filter(Boolean).join(' · '); b.appendChild(sm);
    b.onclick = async () => { $('#panel').classList.add('hidden'); setBars(false); await engine.goTo(bm.pos); };
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '删除';
    x.onclick = async () => { cur.bookmarks.splice(cur.bookmarks.indexOf(bm), 1); await db.update('books', cur.id, { bookmarks: cur.bookmarks }); row.remove(); updateBmIcon(); };
    row.append(b, x); return row;
  }) : [Object.assign(document.createElement('div'), { className: 'item', textContent: '还没有书签。阅读时点屏幕中间，再点右上角 ☆ 即可添加。' })];
  openPanel('书签', nodes);
};

/* 排版设置 */
function buildSettings() {
  const s = $('#settings'); s.innerHTML = '';
  const row = (label, ...kids) => { const r = document.createElement('div'); r.className = 'srow'; const l = document.createElement('span'); l.className = 'slabel'; l.textContent = label; const g = document.createElement('div'); g.className = 'seg'; g.append(...kids); r.append(l, g); s.appendChild(r); };
  const btn = (txt, on, fn, cls = '') => { const b = document.createElement('button'); b.textContent = txt; b.className = (on ? 'on ' : '') + cls; b.onclick = fn; return b; };
  const apply = async () => { saveSettings(); applyBodyTheme(); buildSettings(); await engine?.applySettings(); };
  if (cur?.type === 'pdf') {
    row('缩放', btn('−', false, () => engine.setZoom(Math.max(1, engine.zoom - 0.25))), btn('适应', false, () => engine.setZoom(1)), btn('+', false, () => engine.setZoom(Math.min(4, engine.zoom + 0.25))));
  } else {
    row('字号', btn('A−', false, () => { settings.size = Math.max(12, settings.size - 1); apply(); }, 'small'), Object.assign(document.createElement('span'), { className: 'sval', textContent: settings.size }), btn('A+', false, () => { settings.size = Math.min(40, settings.size + 1); apply(); }, 'big'));
    row('字体', ...Object.entries(FONTS).filter(([k]) => cur?.type !== 'txt' || k !== 'original').map(([k, f]) => btn(f.label, settings.font === k, () => { settings.font = k; apply(); }, 'font-' + k)));
    row('行距', ...[[1.5, '紧凑'], [1.8, '适中'], [2.1, '宽松']].map(([v, l]) => btn(l, Math.abs(settings.lh - v) < 0.01, () => { settings.lh = v; apply(); })));
  }
  if (cur?.type === 'epub' && engine?.vertical) row('竖排', btn('原样', !settings.horiz, () => { settings.horiz = false; saveSettings(); reopen(); }), btn('转横排', !!settings.horiz, () => { settings.horiz = true; saveSettings(); reopen(); }));
  row('主题', ...Object.entries(THEMES).map(([k, t]) => { const b = btn(t.label, settings.theme === k, () => { settings.theme = k; apply(); }, 'swatch'); b.style.background = t.bg; b.style.color = t.fg; return b; }));
}
async function reopen() { const id = cur.id; $('#settings').classList.add('hidden'); await closeBook(); await openBook(id); }
$('#btn-aa').onclick = () => { const s = $('#settings'); const show = s.classList.contains('hidden'); if (show) buildSettings(); s.classList.toggle('hidden', !show); };

let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => engine?.resize(), 250); });

/* 启动 */
applyBodyTheme();
renderLibrary();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadCtrl = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtrl && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.__app = { db, openBook, closeBook, get engine() { return engine; }, renderLibrary };
