import * as pdfjsLib from './vendor/pdf.min.mjs';
import { db } from './db.js';
import { importFiles, parseManifest, applyManifestToLibrary } from './importer.js';
import { EpubEngine, PdfEngine, TxtEngine } from './engines.js';
import { settings, saveSettings, applyBodyTheme, applyAppearance, appearancePref, cycleAppearance, FONTS, THEMES } from './settings.js';
import { isMostlyCjk, translateVisible } from './bilingual.js';
import { backfillFromBooks, createNote, deleteBookBundle, parseTags, syncBook } from './knowledge.js';
import { addToStack, createStack, defaultStackName, dissolveStack, getStack, listStacks, reconcileStacks, removeFromStacks, renameStack, setStackCollapsed } from './stacks.js';
import { dismissAssistant, fitGraph, getGraphMood, getGraphTilt, initWorkspace, openAiSettingsDialog, openAssistant, refreshWorkspace, searchGraph, setGraphMood, setGraphSearch, setGraphTilt, setKnowledgeFind, showPane, workspaceHandleBack } from './workspace.js';
import { createCommandController, speechSupported } from './command.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
const $ = s => document.querySelector(s);
const coverUrls = new Map();
const KIND = { highlight: '划线', excerpt: '摘录', copy: '复制', annotation: '批注' };

function toast(msg, ms = 2200, onUndo = null) {
  const t = $('#toast');
  t.replaceChildren(document.createTextNode(msg));
  t.classList.toggle('has-undo', typeof onUndo === 'function');
  if (typeof onUndo === 'function') {
    const u = document.createElement('button');
    u.type = 'button';
    u.className = 'toast-undo';
    u.textContent = '撤销';
    u.onclick = () => { clearTimeout(toast.t); t.classList.add('hidden'); onUndo(); };
    t.appendChild(u);
  }
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}
function hueFor(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) % 360; return h; }
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

/* ---------------- 流：整宽列表、手动卡片堆、就地整理 ---------------- */
const picked = new Set();
let viewGen = 0;
const SORTS = ['recent', 'added', 'title'];
// 搜索时临时展开 / 收起的卡片堆；清空搜索后丢弃，不改保存的收起状态。
const searchOpen = new Map();
let lastQuery = '';
let shelfOrder = [];
let shelfMemory = null;
let stackDialog = null;
let pickMode = false;
let findOpen = false;
let fanId = null, settleId = null;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));
const SVG = {
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h.01M12 12h.01M18 12h.01"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8.8 12h6.4"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 12.4l3 3 6-6.6"/></svg>'
};

function recentKey(b) { return b.lastOpened > 0 ? b.lastOpened : 0; }
function currentSort() {
  const v = localStorage.getItem('rr-sort') || 'recent';
  return SORTS.includes(v) ? v : 'recent';
}
function sortBooks(list, sort) {
  list.sort((a, b) => {
    let d;
    if (sort === 'title') d = (a.title || '').localeCompare(b.title || '', 'zh');
    else if (sort === 'added') d = (b.addedAt || 0) - (a.addedAt || 0);
    else d = (recentKey(b) - recentKey(a)) || ((b.addedAt || 0) - (a.addedAt || 0));
    return d || String(a.id).localeCompare(String(b.id));
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
function updatePickBar() {
  const n = picked.size;
  const stacks = listStacks();
  $('#manage-count').textContent = n ? `已选 ${n}` : '轻点选择';
  $('#btn-stack-picked').disabled = !(n >= 2 || (n >= 1 && stacks.length));
  $('#btn-delete-picked').disabled = n === 0;
  $('#btn-unstack-picked').classList.toggle('hidden', !(n && stacks.some(s => s.bookIds.some(id => picked.has(id)))));
}
function showShelfPage() { showPane('shelf'); }
let returnPane = 'shelf';
function currentPane() {
  const on = document.querySelector('.pane.on');
  return on?.id?.replace(/^pane-/, '') || 'shelf';
}
async function mirrorKnowledge(book) {
  try { await syncBook(book); await refreshWorkspace(); }
  catch (err) { console.warn(err); }
}
async function deleteBooks(recs) {
  if (!recs.length) return false;
  const msg = recs.length === 1
    ? `删除「${recs[0].title}」？\n进度、书签、摘录和相关笔记会一起移除。`
    : `删除这 ${recs.length} 项？\n进度、书签、摘录和相关笔记会一起移除。`;
  if (!confirm(msg)) return false;
  for (const b of recs) {
    try {
      await deleteBookBundle(b.id);
      picked.delete(b.id);
    } catch (err) {
      console.warn(err);
      toast('「' + b.title + '」没有删掉，内容和笔记都还在。');
    }
  }
  await renderLibrary();
  try { await refreshWorkspace(); } catch (err) { console.warn(err); }
  return true;
}

/* 就地整理：长按一行或从菜单进入；底部浮起操作条 */
function startPick(id) {
  if (currentPane() !== 'shelf') showPane('shelf');
  pickMode = true;
  if (id) picked.add(id);
  return renderLibrary({ focus: id ? 'book:' + id : undefined });
}
function exitPick() {
  if (!pickMode) return false;
  pickMode = false;
  picked.clear();
  renderLibrary();
  return true;
}
function togglePick(id, el) {
  if (picked.has(id)) picked.delete(id); else picked.add(id);
  el.classList.toggle('picked', picked.has(id));
  el.setAttribute('aria-pressed', picked.has(id) ? 'true' : 'false');
  updatePickBar();
}
function bindShelfBook(el, b) {
  let hold = null, sx = 0, sy = 0, held = false;
  const clearHold = () => { clearTimeout(hold); hold = null; };
  el.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; held = false;
    clearHold();
    if (pickMode) return;
    hold = setTimeout(() => { hold = null; held = true; startPick(b.id); }, 480);
  });
  el.addEventListener('pointermove', e => {
    if (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12) clearHold();
  });
  el.addEventListener('pointerup', clearHold);
  el.addEventListener('pointercancel', clearHold);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.onclick = () => {
    if (held) { held = false; return; }
    if (pickMode) togglePick(b.id, el);
    else openBook(b.id);
  };
}

function shelfQuery() { return $('#search').value.trim().toLowerCase(); }
function bookMatches(b, q) { return (`${b.title || ''} ${b.author || ''}`).toLowerCase().includes(q); }
function shortCoverTitle(title) {
  const raw = String(title || '未命名').trim().replace(/[（(].*$/, '').trim() || String(title || '未命名').trim();
  const cjk = raw.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g);
  if (cjk) {
    const pick = cjk.join('').replace(/^[，。、：·\s]+|[，。、：·\s]+$/g, '');
    if (pick.length >= 2) return Array.from(pick).slice(0, 7).join('');
  }
  const words = raw.split(/\s+/).filter(Boolean);
  let out = '';
  for (const w of words) {
    if (out && (out.length + 1 + w.length) > 12) break;
    out = out ? `${out} ${w}` : w;
    if (out.length >= 10) break;
  }
  return out || Array.from(raw).slice(0, 10).join('');
}
function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function avatarNode(b, small = false) {
  const t = node('span', 'avatar' + (small ? ' sm' : ''));
  t.setAttribute('aria-hidden', 'true');
  if (b.cover) {
    if (!coverUrls.has(b.id)) coverUrls.set(b.id, URL.createObjectURL(b.cover));
    const img = document.createElement('img');
    img.alt = ''; img.src = coverUrls.get(b.id);
    t.appendChild(img);
  } else {
    t.classList.add('typo');
    t.style.setProperty('--h', hueFor(b.title || ''));
    t.appendChild(node('span', 'ph-title', shortCoverTitle(b.title)));
    if (!small && b.type) t.appendChild(node('span', 'ph-ext', String(b.type).toUpperCase()));
  }
  return t;
}
function focusKey() { return document.activeElement?.closest?.('#pane-shelf [data-focus]')?.dataset.focus || null; }
function findKeyed(attr, key) {
  if (!key) return null;
  return [...document.querySelectorAll(`#pane-shelf [${attr}]`)].find(n => n.getAttribute(attr) === key) || null;
}
function restoreFocus(key) {
  const el = findKeyed('data-focus', key);
  if (el && el.getClientRects().length) el.focus({ preventScroll: true });
  return el;
}
function paneOffset(el) {
  return el.getBoundingClientRect().top - $('#pane-shelf').getBoundingClientRect().top;
}

function bookRow(b, stack, i = 0) {
  const wrap = node('div', 'row-wrap');
  wrap.setAttribute('role', 'listitem');
  wrap.dataset.anchor = 'book:' + b.id;
  wrap.style.setProperty('--i', i);
  const el = node('button', 'book');
  el.type = 'button';
  el.dataset.id = b.id;
  el.dataset.focus = 'book:' + b.id;
  if (pickMode) {
    el.classList.toggle('picked', picked.has(b.id));
    el.setAttribute('aria-pressed', picked.has(b.id) ? 'true' : 'false');
  }
  const tick = node('span', 'tick');
  tick.setAttribute('aria-hidden', 'true');
  tick.innerHTML = SVG.check;
  const meta = node('span', 'meta');
  const title = node('span', 't', b.title || '未命名');
  title.id = 't-' + b.id;
  const line = node('span', 'a', [b.author, b.type ? String(b.type).toUpperCase() : ''].filter(Boolean).join(' · '));
  meta.append(title, line);
  if (b.progress > 0) {
    const bar = node('span', 'pbar');
    const fill = document.createElement('i');
    fill.style.width = Math.round(Math.min(1, b.progress) * 100) + '%';
    bar.appendChild(fill);
    meta.appendChild(bar);
  }
  let side;
  if (b.progress > 0) side = node('span', 'pct', fmtPct(b.progress));
  else if (!b.lastOpened) { side = node('span', 'dot'); side.appendChild(node('span', 'sr', '未读')); }
  else side = node('span', 'pct', '');
  el.append(tick, avatarNode(b), meta, side);
  bindShelfBook(el, b);
  wrap.appendChild(el);
  if (stack && !pickMode) {
    const out = node('button', 'row-out');
    out.type = 'button';
    out.dataset.focus = 'out:' + b.id;
    out.title = '移出卡片堆';
    out.setAttribute('aria-label', '移出卡片堆');
    out.setAttribute('aria-describedby', title.id);
    out.innerHTML = SVG.minus;
    out.onclick = () => {
      removeFromStacks([b.id]);
      const still = getStack(stack.id);
      toast(still ? `已移出「${stack.name}」` : `「${stack.name}」只剩一项，已散开`);
      renderLibrary(still ? { anchor: 'stack:' + stack.id, focus: 'stack:' + stack.id } : { anchor: 'book:' + b.id, focus: 'book:' + b.id });
    };
    wrap.appendChild(out);
  }
  return wrap;
}

function closeStackMenus(refocus = false) {
  let closed = false;
  document.querySelectorAll('.stack-menu:not([hidden])').forEach(menu => {
    menu.hidden = true;
    const btn = document.querySelector(`[aria-controls="${menu.id}"]`);
    btn?.setAttribute('aria-expanded', 'false');
    if (refocus) btn?.focus();
    closed = true;
  });
  return closed;
}

function stackBlock(s, members, shown, open, q) {
  const sec = node('section', 'stack ' + (open ? 'is-open' : 'is-collapsed'));
  if (open && fanId === s.id) sec.classList.add('fanning');
  if (!open && settleId === s.id) sec.classList.add('settling');
  sec.setAttribute('role', 'listitem');
  sec.dataset.stack = s.id;
  sec.dataset.anchor = 'stack:' + s.id;
  const card = node('div', 'stack-card');
  const head = node('button', 'stack-head');
  head.type = 'button';
  head.id = 'stack-head-' + s.id;
  head.dataset.focus = 'stack:' + s.id;
  head.dataset.anchor = 'head:' + s.id;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  head.setAttribute('aria-controls', 'stack-items-' + s.id);
  head.setAttribute('aria-label', `卡片堆「${s.name}」，${members.length} 项`);
  const text = node('span', 'stack-text');
  text.appendChild(node('span', 'stack-name', s.name));
  const partial = q && shown.length < members.length;
  let fan = null;
  if (!open) {
    fan = node('span', 'stack-fan');
    fan.setAttribute('aria-hidden', 'true');
    shown.slice(0, 3).reverse().forEach((m, idx, arr) => {
      const av = avatarNode(m, true);
      av.style.setProperty('--k', arr.length - 1 - idx);
      fan.appendChild(av);
    });
    const titles = shown.slice(0, 3).map(m => m.title || '未命名').join(' · ');
    const preview = node('span', 'stack-preview', (partial ? `${shown.length} 项匹配 · ` : '') + titles);
    preview.id = 'stack-preview-' + s.id;
    head.setAttribute('aria-describedby', preview.id);
    text.appendChild(preview);
  }
  const side = node('span', 'stack-side');
  const count = node('span', 'stack-count', String(members.length));
  count.setAttribute('aria-hidden', 'true');
  side.appendChild(count);
  side.insertAdjacentHTML('beforeend', SVG.chev.replace('<svg', '<svg class="stack-chev"'));
  if (fan) head.append(fan, text, side); else head.append(text, side);
  head.onclick = () => toggleStack(s.id, !open);
  card.appendChild(head);

  const items = node('div', 'stack-items');
  items.id = 'stack-items-' + s.id;
  items.setAttribute('role', 'list');
  items.setAttribute('aria-labelledby', head.id);
  items.hidden = !open;
  if (open) {
    const collapse = node('button', 'stack-collapse', '收起');
    collapse.type = 'button';
    collapse.dataset.focus = 'collapse:' + s.id;
    collapse.setAttribute('aria-controls', items.id);
    collapse.onclick = () => toggleStack(s.id, false);
    const more = node('button', 'stack-more-btn');
    more.type = 'button';
    more.innerHTML = SVG.more;
    more.dataset.focus = 'more:' + s.id;
    more.title = '更多';
    more.setAttribute('aria-label', `「${s.name}」的更多操作`);
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', 'stack-menu-' + s.id);
    const menu = node('div', 'stack-menu');
    menu.id = 'stack-menu-' + s.id;
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const item = (label, cls, fn) => {
      const b = node('button', cls, label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.onclick = fn;
      menu.appendChild(b);
    };
    item('重命名', 'stack-rename', () => {
      closeStackMenus();
      openStackDialog({ mode: 'rename', stackId: s.id, returnFocus: 'more:' + s.id });
    });
    item('解散', 'stack-ungroup danger', () => {
      closeStackMenus();
      dissolveStack(s.id);
      toast(`已散开「${s.name}」，${members.length} 项都还在`);
      const first = members[0]?.id;
      renderLibrary({ anchor: first ? 'book:' + first : null, focus: first ? 'book:' + first : null });
    });
    more.onclick = () => {
      const show = menu.hidden;
      closeStackMenus();
      if (!show) return;
      menu.hidden = false;
      more.setAttribute('aria-expanded', 'true');
      menu.querySelector('button')?.focus();
    };
    card.append(collapse, more, menu);
    shown.forEach((m, i) => items.appendChild(bookRow(m, s, i)));
    if (partial) items.appendChild(node('p', 'stack-more', `另有 ${members.length - shown.length} 项不匹配`));
  }
  sec.append(card, items);
  return sec;
}

async function toggleStack(id, open) {
  closeStackMenus();
  const sec = findKeyed('data-anchor', 'stack:' + id);
  if (!open && sec && !reduceMotion()) { sec.classList.add('folding'); await wait(170); }
  if (shelfQuery()) searchOpen.set(id, open);
  else setStackCollapsed(id, !open);
  if (open) fanId = id; else settleId = id;
  try { await renderLibrary({ anchor: 'head:' + id, focus: 'stack:' + id }); }
  finally { fanId = null; settleId = null; }
}

function syncFindBar() {
  const bar = $('#find-bar');
  if (bar) bar.hidden = !findOpen;
}
function openShelfFind() {
  findOpen = true;
  syncFindBar();
  $('#pane-shelf')?.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  $('#search')?.focus({ preventScroll: true });
}
function closeShelfFind() {
  const had = !!$('#search').value;
  findOpen = false;
  $('#search').value = '';
  syncFindBar();
  if (had) renderLibrary();
}

async function renderLibrary(opts = {}) {
  if (!opts || opts instanceof Event) opts = {};
  const books = await db.all('books');
  const live = new Set(books.map(b => b.id));
  for (const id of [...picked]) if (!live.has(id)) picked.delete(id);
  if (pickMode && !books.length) { pickMode = false; picked.clear(); }
  const stacks = reconcileStacks(live);
  const raw = $('#search').value.trim();
  const q = raw.toLowerCase();
  if (q !== lastQuery) { searchOpen.clear(); lastQuery = q; }
  if (q) findOpen = true;
  syncFindBar();
  const sort = currentSort();
  const sorted = books.slice();
  sortBooks(sorted, sort);
  shelfOrder = sorted.map(b => b.id);
  const stackByBook = new Map();
  for (const s of stacks) for (const id of s.bookIds) stackByBook.set(id, s);

  const pane = $('#pane-shelf');
  const focus = opts.focus !== undefined ? opts.focus : focusKey();
  const anchorEl = findKeyed('data-anchor', opts.anchor);
  const anchorTop = anchorEl ? paneOffset(anchorEl) : null;

  const frag = document.createDocumentFragment();
  const seen = new Set();
  let shownCount = 0;
  for (const b of sorted) {
    const s = stackByBook.get(b.id);
    if (!s) {
      if (q && !bookMatches(b, q)) continue;
      frag.appendChild(bookRow(b, null));
      shownCount++;
      continue;
    }
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const members = sorted.filter(x => stackByBook.get(x.id) === s);
    const nameHit = q && s.name.toLowerCase().includes(q);
    const shown = !q || nameHit ? members : members.filter(m => bookMatches(m, q));
    if (!shown.length) continue;
    const open = q ? (searchOpen.has(s.id) ? searchOpen.get(s.id) : true) : !s.collapsed;
    frag.appendChild(stackBlock(s, members, shown, open, q));
    shownCount += shown.length;
  }
  $('#grid').replaceChildren(frag);
  $('#library').classList.toggle('picking', pickMode);
  $('#pick-bar').hidden = !pickMode;
  updatePickBar();

  $('#empty').classList.toggle('hidden', books.length > 0);
  $('#no-match').classList.toggle('hidden', !q || shownCount > 0 || books.length === 0);
  $('#search-chip').classList.toggle('hidden', !q);

  if (opts.restore) {
    pane.scrollTop = opts.restore.scroll || 0;
    restoreFocus(opts.restore.focus);
  } else {
    if (anchorTop != null) {
      const now = findKeyed('data-anchor', opts.anchor);
      if (now) pane.scrollTop += paneOffset(now) - anchorTop;
    }
    const el = restoreFocus(focus);
    if (opts.reveal && el) el.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  const sub = $('#shelf-sub');
  sub.textContent = !books.length ? ''
    : pickMode ? '轻点选择，长按也可以进入整理'
      : q ? `找到 ${shownCount} 项`
        : '';
  paintSort();
  if ($('#storage-info')) $('#storage-info').textContent = '';
  if (books.length && !localStorage.getItem('rr-hint-panes') && !$('#reader').classList.contains('active')) {
    localStorage.setItem('rr-hint-panes', '1');
    setTimeout(() => toast('划线和摘录会进入「知识」，也会在「星海」里相连', 3600), 600);
  }
}

function pickedInOrder() { return shelfOrder.filter(id => picked.has(id)); }
function syncStackDialog() {
  const pick = stackDialog?.mode === 'pick';
  const target = pick ? $('#stack-target').value : '';
  $('#stack-name-field').classList.toggle('hidden', !!target);
  const n = stackDialog?.ids?.length || 0;
  $('#stack-save').textContent = pick ? (target ? '加入' : '建堆') : '完成';
  $('#stack-desc').textContent = !pick ? '' : target ? `把 ${n} 项加进这一叠。` : `把 ${n} 项叠成一摞，随时可以散开。`;
}
function openStackDialog(opts) {
  const stacks = listStacks();
  const pick = opts.mode === 'pick';
  if (pick && opts.ids.length < 2 && !stacks.length) { toast('至少选两项'); return; }
  stackDialog = { ...opts, returnFocus: opts.returnFocus || focusKey() };
  $('#stack-heading').textContent = pick ? '建堆' : '重命名';
  const sel = $('#stack-target');
  sel.replaceChildren();
  $('#stack-target-field').classList.toggle('hidden', !pick || !stacks.length);
  if (pick) {
    if (opts.ids.length >= 2) sel.append(new Option('新的一叠', ''));
    for (const s of stacks) sel.append(new Option(`${s.name} · ${s.bookIds.length}`, s.id));
    sel.selectedIndex = 0;
  }
  $('#stack-name').value = pick ? defaultStackName(stacks) : (getStack(opts.stackId)?.name || '');
  syncStackDialog();
  $('#stack-mask').classList.remove('hidden');
  setTimeout(() => {
    const field = $('#stack-name-field').classList.contains('hidden') ? sel : $('#stack-name');
    field.focus();
    field.select?.();
  }, 30);
}
function closeStackDialog(refocus = true) {
  if ($('#stack-mask').classList.contains('hidden')) return false;
  const back = stackDialog?.returnFocus;
  $('#stack-mask').classList.add('hidden');
  stackDialog = null;
  if (refocus && back) restoreFocus(back);
  return true;
}
$('#stack-target').onchange = syncStackDialog;
$('#stack-cancel').onclick = () => closeStackDialog();
$('#stack-mask').addEventListener('click', e => { if (e.target === e.currentTarget) closeStackDialog(); });
$('#stack-dialog').onsubmit = async e => {
  e.preventDefault();
  const d = stackDialog;
  if (!d) return;
  if (d.mode === 'rename') {
    const s = renameStack(d.stackId, $('#stack-name').value);
    if (!s) { toast('名字不能为空'); return; }
    closeStackDialog(false);
    toast(`已改名为「${s.name}」`);
    await renderLibrary({ anchor: 'stack:' + s.id, focus: 'stack:' + s.id });
    return;
  }
  const target = $('#stack-target').value;
  let s;
  if (target) s = addToStack(target, d.ids);
  else if (d.ids.length < 2) { toast('至少选两项'); return; }
  else s = createStack($('#stack-name').value, d.ids);
  if (!s) { toast('没有成功，请再试一次'); return; }
  closeStackDialog(false);
  pickMode = false;
  picked.clear();
  toast(target ? `已加入「${s.name}」` : `已建堆「${s.name}」`);
  await renderLibrary({ focus: 'stack:' + s.id, reveal: true });
};

/* 底部全面屏细线 + 空间横滑 + 统一意图层 */
const SPACES = ['shelf', 'knowledge', 'graph'];
function stepSpace(delta) {
  const i = SPACES.indexOf(currentPane());
  const next = SPACES[Math.max(0, Math.min(SPACES.length - 1, i + delta))];
  showPane(next || SPACES[i], { whisper: true });
}
function intentOpen() { return !$('#intent-mask').classList.contains('hidden'); }
function syncIntentTiles() {
  const pane = currentPane();
  document.querySelectorAll('#intent-sheet [data-for]').forEach(btn => {
    const scope = (btn.dataset.for || '').split(/\s+/);
    btn.hidden = scope.length > 0 && scope[0] !== '' && !scope.includes(pane);
  });
}
function openIntent() {
  syncIntentTiles();
  $('#intent-mask').classList.remove('hidden');
  $('#spatial-bar')?.setAttribute('aria-expanded', 'true');
  [...document.querySelectorAll('#intent-sheet .menu-item')].find(b => !b.hidden)?.focus();
}
function closeIntent(refocus = true) {
  if (!intentOpen()) return false;
  $('#intent-mask').classList.add('hidden');
  $('#spatial-bar')?.setAttribute('aria-expanded', 'false');
  if (refocus) $('#spatial-bar')?.focus();
  return true;
}
function openActiveSearch() {
  const pane = currentPane();
  if (pane === 'knowledge') { setKnowledgeFind(true); return; }
  if (pane === 'graph') { setGraphSearch(true); return; }
  openShelfFind();
}
$('#intent-mask').addEventListener('click', e => { if (e.target === e.currentTarget) closeIntent(); });
$('#intent-sheet').addEventListener('click', e => {
  const tab = e.target.closest('[data-pane]');
  if (tab) { closeIntent(false); return; }
  const item = e.target.closest('.menu-item');
  if (item && item.id !== 'btn-appearance' && item.id !== 'graph-mood') closeIntent(false);
});
$('#btn-intent-search').onclick = () => openActiveSearch();
$('#btn-find-close').onclick = () => closeShelfFind();
$('#btn-import').onclick = () => $('#file-input').click();
$('#btn-empty-import').onclick = () => $('#file-input').click();
$('#btn-select-mode').onclick = () => startPick(null);

// 底部呼吸细线：轻点/上滑开意图层，左右滑切换空间，长按直接说指令
let command = null;
(function bindSpatialBar() {
  const bar = $('#spatial-bar');
  if (!bar) return;
  let sx = 0, sy = 0, pid = null, swiped = false, hold = null;
  const cancelHold = () => { clearTimeout(hold); hold = null; };
  bar.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; pid = e.pointerId; swiped = false;
    try { bar.setPointerCapture(e.pointerId); } catch {}
    cancelHold();
    hold = setTimeout(() => {
      hold = null;
      swiped = true;
      command?.openBar({ listen: speechSupported() });
    }, 460);
  });
  bar.addEventListener('pointermove', e => {
    if (pid !== e.pointerId || !hold) return;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 12) cancelHold();
  });
  bar.addEventListener('pointerup', e => {
    if (pid !== e.pointerId) return;
    pid = null;
    cancelHold();
    if (swiped) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swiped = true;
      stepSpace(dx < 0 ? 1 : -1);
    } else if (dy < -24 && Math.abs(dy) > Math.abs(dx)) {
      swiped = true;
      openIntent();
    }
  });
  bar.addEventListener('pointercancel', () => { pid = null; cancelHold(); });
  bar.onclick = () => {
    if (swiped) { swiped = false; return; }
    if (intentOpen()) closeIntent(); else openIntent();
  };
})();

// 空间手势：流/知识左右横滑切空间、顶部下拉唤出搜索；星海仅在屏幕边缘横滑离开，不冲突画布平移
(function bindSpatialGestures() {
  const lib = $('#library');
  if (!lib) return;
  let sx = 0, sy = 0, st = 0, pid = null, atTop = false, edge = false;
  const blocked = () => pickMode || !lib.classList.contains('active')
    || ['#ai-mask', '#note-mask', '#settings-mask', '#stack-mask', '#intent-mask', '#command-mask', '#lib-panel', '#note-editor']
      .some(sel => { const el = document.querySelector(sel); return el && !el.classList.contains('hidden'); });
  lib.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    if (blocked()) return;
    if (e.target.closest('input, textarea, select, #spatial-bar, .stack-menu, .graph-card, .hud-search')) return;
    const pane = currentPane();
    edge = e.clientX <= 28 || e.clientX >= window.innerWidth - 28;
    if (pane === 'graph' && !edge) return;
    sx = e.clientX; sy = e.clientY; st = Date.now(); pid = e.pointerId;
    const scroller = $('#pane-' + pane);
    atTop = !!(scroller && scroller.scrollTop <= 0);
  }, { passive: true });
  lib.addEventListener('pointerup', e => {
    if (pid !== e.pointerId) return;
    pid = null;
    if (blocked()) return;
    const dt = Date.now() - st;
    if (dt > 750) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const pane = currentPane();
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.45) {
      stepSpace(dx < 0 ? 1 : -1);
      return;
    }
    if (pane !== 'graph' && atTop && dy > 52 && dy > Math.abs(dx) * 1.5) {
      openActiveSearch();
    }
  }, { passive: true });
  lib.addEventListener('pointercancel', () => { pid = null; }, { passive: true });
})();

// 菜单上下键 + 快捷键（Ctrl+K / Alt+左右 / 1-3 / /）
document.addEventListener('keydown', e => {
  if ((e.altKey && e.code === 'Space') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j')) {
    e.preventDefault();
    if (command?.isOpen()) command.closeBar(true); else command?.openBar();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && $('#library')?.classList.contains('active')) {
    e.preventDefault();
    if (intentOpen()) closeIntent(); else openIntent();
    return;
  }
  const menu = e.target.closest?.('#intent-sheet, [role="menu"]');
  if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(n => n.getClientRects().length);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    return;
  }
  if (!$('#library')?.classList.contains('active') || engine) return;
  if (e.target.closest?.('input, textarea, select')) return;
  const modalUp = ['#ai-mask', '#note-mask', '#settings-mask', '#stack-mask', '#intent-mask', '#command-mask', '#lib-panel', '#note-editor']
    .some(sel => { const el = document.querySelector(sel); return el && !el.classList.contains('hidden'); });
  if (modalUp) return;
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); stepSpace(-1); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); stepSpace(1); return; }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === '1') { e.preventDefault(); showPane('shelf', { whisper: true }); }
    else if (e.key === '2') { e.preventDefault(); showPane('knowledge', { whisper: true }); }
    else if (e.key === '3') { e.preventDefault(); showPane('graph', { whisper: true }); }
    else if (e.key === '/') { e.preventDefault(); openActiveSearch(); }
  }
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest?.('.stack-menu, .stack-more-btn')) closeStackMenus();
});

$('#search').oninput = () => renderLibrary();
$('#search-chip').onclick = () => { $('#search').value = ''; renderLibrary(); $('#search').focus({ preventScroll: true }); };
document.querySelectorAll('#sort-seg button').forEach(b => b.onclick = () => {
  localStorage.setItem('rr-sort', b.dataset.sort);
  renderLibrary();
});
paintSort();
$('#btn-stack-picked').onclick = () => {
  const ids = pickedInOrder();
  openStackDialog({ mode: 'pick', ids, returnFocus: ids.length ? 'book:' + ids[0] : null });
};
$('#btn-unstack-picked').onclick = () => {
  const ids = pickedInOrder();
  removeFromStacks(ids);
  toast(`已移出 ${ids.length} 项`);
  renderLibrary();
};
$('#btn-done-picked').onclick = () => exitPick();
$('#btn-delete-picked').onclick = async () => {
  const books = await db.all('books');
  const done = await deleteBooks(books.filter(b => picked.has(b.id)));
  if (done && !picked.size) exitPick();
};
$('#file-input').onchange = async e => {
  showShelfPage();
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

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
  applyAppearance();
}
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
  if ($('#library')?.classList.contains('active')) {
    returnPane = currentPane();
    shelfMemory = { scroll: $('#pane-shelf').scrollTop, focus: focusKey() || 'book:' + id };
  }
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
    dismissAssistant();
    try { engine?.destroy(); } catch {}
    engine = null; cur = null; lastState = null;
    biToken++;
    document.body.classList.remove('bi');
    $('#bilingual')?.classList.add('hidden');
    $('#panel').classList.add('hidden'); $('#note-mask').classList.add('hidden');
    showView('library');
    showPane(returnPane || 'shelf');
    const memory = shelfMemory; shelfMemory = null;
    await renderLibrary(memory ? { restore: memory } : {});
  })();
  return closing.finally(() => { closing = null; });
}
$('#btn-back').onclick = () => history.back();
window.addEventListener('popstate', () => { if (engine) closeBook(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

// 双指放大改字号并重排，不缩放整页
let pinchLock = false;
async function bumpSize(delta) {
  if (!engine || pinchLock) return;
  const next = Math.max(12, Math.min(40, (settings.size || 19) + delta));
  if (next === settings.size) return;
  settings.size = next;
  saveSettings();
  pinchLock = true;
  try {
    if (engine.setReadingSize) await engine.setReadingSize();
    else await engine.applySettings();
  } finally { pinchLock = false; }
  refreshBilingual();
}
// 点按 / 滑动翻页；长按进入选择
(function gestures() {
  const tap = $('#tap'), viewer = $('#viewer');
  let sx = 0, sy = 0, st = 0, pid = null, timer = null, suppressUp = false, moved = false;
  const pointers = new Map();
  let pinchDist = 0;
  const pinchSpan = () => {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };
  const clearTimer = () => { clearTimeout(timer); timer = null; };
  const down = e => {
    if (e.button != null && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; st = Date.now(); pid = e.pointerId; moved = false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) { pinchDist = pinchSpan(); moved = true; clearTimer(); return; }
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
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinchDist) {
      const d = pinchSpan();
      if (d > pinchDist * 1.18) { pinchDist = d; suppressUp = true; bumpSize(2); }
      else if (d < pinchDist * 0.84) { pinchDist = d; suppressUp = true; bumpSize(-2); }
      return;
    }
    if (pid !== e.pointerId) return;
    if (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12) { moved = true; clearTimer(); }
  };
  const up = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
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
    el.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinchDist = 0; clearTimer(); pid = null; });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const field = e.target.closest?.('input, textarea, select');
      if (field && field.closest('#note-editor, #search, #note-search, #graph-search')) { field.blur(); return; }
      handleBack();
      return;
    }
    if (!engine) return;
    if (e.target.matches('input, textarea, select')) return;
    const maskOpen = ['#ai-mask', '#note-mask', '#settings-mask', '#stack-mask', '#intent-mask', '#lib-panel'].some(sel => {
      const el = document.querySelector(sel);
      return el && !el.classList.contains('hidden');
    });
    if (maskOpen || document.body.classList.contains('selecting')) return;
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
  await mirrorKnowledge(rec);
}
async function openPassageById(bookId, passageId) {
  const book = await db.get('books', bookId);
  const item = (book?.highlights || []).find(h => h.id === passageId);
  if (!book || !item) { toast('找不到原文位置'); return; }
  await openPassage(bookId, item);
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
  await mirrorKnowledge(cur);
}
async function addPassage(kind, sel, note = '', tags = null) {
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
    id: uid(), kind, text: limited, note: note || '', tags: Array.isArray(tags) ? tags : [],
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
let noteKind = 'excerpt';
function openNoteDialog(kind) {
  const sel = currentSelection();
  if (!sel?.text) { toast('请先选中文字'); return; }
  noteKind = kind;
  noteSel = sel;
  const heading = $('#note-heading');
  if (heading) heading.textContent = kind === 'annotation' ? '写下批注' : '保存摘录';
  $('#note-text').placeholder = kind === 'annotation' ? '这段话让你想到什么' : '写一句笔记，也可以留空';
  $('#note-quote').textContent = sel.text.length > 180 ? sel.text.slice(0, 180) + '…' : sel.text;
  $('#note-text').value = '';
  if ($('#note-tags')) $('#note-tags').value = '';
  $('#note-mask').classList.remove('hidden');
  setTimeout(() => $('#note-text').focus(), 30);
}
$('#btn-excerpt').onclick = () => openNoteDialog('excerpt');
$('#btn-annotate').onclick = () => openNoteDialog('annotation');
$('#btn-ai').onclick = () => {
  const sel = currentSelection();
  if (!sel?.text) { toast('请先选中文字'); return; }
  openAssistant({
    title: '解释这段话',
    quote: sel.text.trim(),
    context: cur ? `来自《${cur.title}》${lastState?.label ? ' · ' + lastState.label : ''}` : '',
    bookId: cur?.id || null,
    bookTitle: cur?.title || ''
  });
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
  const tags = parseTags($('#note-tags')?.value || '');
  const kind = noteKind;
  $('#note-mask').classList.add('hidden');
  const ok = await addPassage(kind, sel, note, tags);
  noteSel = null;
  noteKind = 'excerpt';
  if (ok) toast(kind === 'annotation' ? '已保存批注' : (note ? '已保存摘录和笔记' : '已保存摘录'));
  if (ok) exitSelect();
};

/* 排版设置 */
function buildSettings() {
  const s = $('#settings'); s.innerHTML = '';
  const row = (label, ...kids) => { const r = document.createElement('div'); r.className = 'srow'; const l = document.createElement('span'); l.className = 'slabel'; l.textContent = label; const g = document.createElement('div'); g.className = 'seg'; g.append(...kids); r.append(l, g); s.appendChild(r); };
  const btn = (txt, on, fn, cls = '') => { const b = document.createElement('button'); b.textContent = txt; b.className = (on ? 'on ' : '') + cls; b.onclick = fn; return b; };
  const apply = async () => { saveSettings(); applyBodyTheme(); buildSettings(); await engine?.applySettings(); refreshBilingual(); };
  row('对照', btn('开', settings.bilingual !== false, () => { settings.bilingual = true; saveSettings(); buildSettings(); refreshBilingual(); }), btn('关', settings.bilingual === false, () => { settings.bilingual = false; saveSettings(); buildSettings(); refreshBilingual(); }));
  if (cur?.type === 'pdf') {
    row('字号', btn('A−', false, () => { settings.size = Math.max(12, settings.size - 1); engine.reflow = true; saveSettings(); engine.render(); apply(); }, 'small'), Object.assign(document.createElement('span'), { className: 'sval', textContent: settings.size }), btn('A+', false, () => { settings.size = Math.min(40, settings.size + 1); engine.reflow = true; saveSettings(); engine.render(); apply(); }, 'big'), btn('原页', !engine.reflow, () => { engine.reflow = false; saveSettings(); engine.render(); buildSettings(); refreshBilingual(); }));
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
  if (command?.closeBar(true)) return true;
  if (dismissAssistant()) return true;
  if (closeStackDialog()) return true;
  if (closeIntent()) return true;
  if (closeStackMenus(true)) return true;
  if (!$('#note-mask').classList.contains('hidden')) { $('#note-mask').classList.add('hidden'); noteSel = null; return true; }
  if (document.body.classList.contains('selecting')) { exitSelect(); return true; }
  if (!$('#panel').classList.contains('hidden')) { $('#panel').classList.add('hidden'); return true; }
  if (!$('#settings').classList.contains('hidden')) { $('#settings').classList.add('hidden'); return true; }
  if (!$('#lib-panel').classList.contains('hidden')) { $('#lib-panel').classList.add('hidden'); return true; }
  if (currentPane() === 'shelf' && findOpen) { closeShelfFind(); return true; }
  if (workspaceHandleBack()) return true;
  if ($('#library').classList.contains('active') && exitPick()) return true;
  if (engine) { history.back(); return true; }
  return false;
}

/* 启动 */
applyBodyTheme();
initWorkspace({
  toast, copyText, cycleAppearance,
  openPassage: (bookId, passageId) => openPassageById(bookId, passageId),
  onHighlightsChanged(bookId) {
    if (cur?.id !== bookId) return;
    db.get('books', bookId).then(fresh => {
      if (!fresh || cur?.id !== bookId) return;
      cur.highlights = fresh.highlights || [];
      engine?.setHighlights?.(cur.highlights);
    }).catch(err => console.warn(err));
  }
});
renderLibrary();
backfillFromBooks().then(() => refreshWorkspace()).catch(err => console.warn(err));
const nativeApp = !!(window.Capacitor?.isNativePlatform?.());
if (nativeApp && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
} else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadCtrl = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtrl && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
async function applyReaderPrefs() {
  saveSettings();
  applyBodyTheme();
  if (!$('#settings').classList.contains('hidden')) buildSettings();
  if (cur?.type === 'pdf' && engine) {
    engine.reflow = true;
    await engine.render();
  }
  await engine?.applySettings?.();
  refreshBilingual();
}

command = createCommandController({
  toast,
  closeMenus: () => { closeIntent(false); closeStackMenus(false); },
  context: () => ({ reading: !!engine && $('#reader').classList.contains('active'), pane: currentPane() }),
  snapshot: () => ({
    settings: { ...settings },
    appearance: appearancePref(),
    pane: currentPane(),
    mood: getGraphMood(),
    tilt: getGraphTilt()
  }),
  async restore(snap) {
    Object.assign(settings, snap.settings);
    localStorage.setItem('rr-appearance', snap.appearance);
    applyAppearance();
    await applyReaderPrefs();
    setGraphMood(snap.mood, true);
    setGraphTilt(snap.tilt);
    if (!engine && snap.pane) showPane(snap.pane, { whisper: false });
  },
  async exec(a) {
    const reading = !!engine && $('#reader').classList.contains('active');
    switch (a.op) {
      case 'fontSize': {
        const next = a.value != null ? a.value : Math.max(12, Math.min(40, settings.size + (a.delta || 0)));
        settings.size = next;
        await applyReaderPrefs();
        return { label: `字号 ${next}`, undoable: true };
      }
      case 'font': {
        if (!FONTS[a.value]) return null;
        settings.font = a.value;
        await applyReaderPrefs();
        return { label: FONTS[a.value].label, undoable: true };
      }
      case 'lineHeight': {
        settings.lh = a.value;
        await applyReaderPrefs();
        return { label: a.value > 1.9 ? '宽松行距' : a.value < 1.65 ? '紧凑行距' : '适中行距', undoable: true };
      }
      case 'readTheme': {
        if (!THEMES[a.value]) return null;
        settings.theme = a.value;
        await applyReaderPrefs();
        return { label: THEMES[a.value].label + '模式', undoable: true };
      }
      case 'appearance': {
        localStorage.setItem('rr-appearance', a.value);
        applyAppearance();
        const nm = a.value === 'dark' ? '深色外观' : a.value === 'light' ? '浅色外观' : '自动外观';
        return { label: nm, undoable: true };
      }
      case 'bilingual': {
        settings.bilingual = !!a.on;
        saveSettings();
        if (!$('#settings').classList.contains('hidden')) buildSettings();
        refreshBilingual();
        return { label: a.on ? '已开中英对照' : '只看原文', undoable: true };
      }
      case 'turn': {
        if (!reading) return { label: '打开一本书后即可语音翻页' };
        await turn(a.delta > 0 ? 1 : -1);
        return { label: a.delta > 0 ? '下一页' : '上一页' };
      }
      case 'seek': {
        if (!reading) return { label: '打开一本书后即可跳转进度' };
        await engine.goToFraction(a.fraction);
        return { label: `已跳到 ${Math.round(a.fraction * 100)}%` };
      }
      case 'bookmark': {
        if (!reading) return { label: '打开一本书后即可加书签' };
        $('#btn-bm')?.click();
        return { label: '已切换书签' };
      }
      case 'toc': {
        if (!reading) return { label: '打开一本书后即可看目录' };
        $('#btn-toc')?.click();
        return { label: '已打开目录' };
      }
      case 'closeBook': {
        if (!reading) return null;
        await closeBook();
        return { label: '已返回列表' };
      }
      case 'pane': {
        if (reading) await closeBook();
        showPane(a.value, { whisper: true });
        const nm = a.value === 'graph' ? '星海' : a.value === 'knowledge' ? '知识' : '流';
        return { label: nm, undoable: true };
      }
      case 'graphTilt': {
        if (reading) await closeBook();
        showPane('graph', { whisper: false });
        setGraphTilt(a.on);
        return { label: a.on ? '2.5D 立体' : '平视星图', undoable: true };
      }
      case 'graphFit': {
        if (reading) await closeBook();
        showPane('graph', { whisper: false });
        fitGraph();
        return { label: '适应全图' };
      }
      case 'graphMood': {
        if (reading) await closeBook();
        showPane('graph', { whisper: false });
        setGraphMood(a.value, true);
        const nm = { auto: '天色随时辰', dawn: '晨曦', day: '晴蓝', dusk: '暮色', night: '星夜' }[a.value] || '星海';
        return { label: nm, undoable: true };
      }
      case 'openBook': {
        const q = a.query.toLowerCase();
        const books = await db.all('books');
        const hit = books.find(b => (b.title || '').toLowerCase().includes(q))
          || books.find(b => (b.author || '').toLowerCase().includes(q));
        if (!hit) return { label: `没有找到「${a.query}」` };
        await openBook(hit.id);
        return { label: `已打开《${hit.title.slice(0, 14)}》` };
      }
      case 'createNote': {
        if (!a.text) {
          if (reading) await closeBook();
          $('#btn-new-note')?.click();
          return { label: '新建笔记' };
        }
        const title = Array.from(a.text).slice(0, 18).join('');
        await createNote({ title, body: a.text, tags: [], kind: 'note' });
        await refreshWorkspace();
        return { label: `已记笔记「${title}」` };
      }
      case 'newDecision': {
        if (reading) await closeBook();
        $('#btn-new-decision')?.click();
        return { label: '新建判断' };
      }
      case 'search': {
        if (reading) await closeBook();
        const pane = currentPane();
        if (pane === 'graph') {
          searchGraph(a.query);
        } else if (pane === 'knowledge') {
          setKnowledgeFind(true);
          const inp = $('#note-search');
          if (inp) { inp.value = a.query; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        } else {
          openShelfFind();
          const inp = $('#search');
          if (inp) { inp.value = a.query; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        }
        return { label: `查找「${a.query}」` };
      }
      case 'selectMode': {
        if (reading) await closeBook();
        showPane('shelf');
        startPick(null);
        return { label: '进入整理' };
      }
      case 'excerpts': {
        if (reading) await closeBook();
        await openLibraryExcerpts();
        return { label: '已打开摘录' };
      }
      case 'aiSettings': {
        openAiSettingsDialog();
        return { label: 'AI 设置' };
      }
      default:
        return null;
    }
  }
});

$('#intent-cmd-btn')?.addEventListener('click', () => command.openBar({ listen: false }));
$('#intent-mic')?.addEventListener('click', () => command.openBar({ listen: true }));
$('#reader-cmd-bar')?.addEventListener('click', () => command.openBar({ listen: false }));
$('#btn-reader-cmd')?.addEventListener('click', () => { setBars(false); command.openBar({ listen: speechSupported() }); });

window.__app = { db, openBook, closeBook, importFiles, handleBack, get engine() { return engine; }, renderLibrary, stacks: { list: listStacks }, runCommand: text => command.run(text), openCommand: opts => command.openBar(opts) };
