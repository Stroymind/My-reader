import * as pdfjsLib from './vendor/pdf.min.mjs';
import { db } from './db.js';
import { importArticleUrl, importBlob, importFiles, parseManifest, applyManifestToLibrary } from './importer.js';
import { findAndFetchBook, getOpdsUrl, setOpdsUrl } from './book-finder.js';
import { initSichao, setSichaoApi } from './sichao.js';
import { BookletEngine, EpubEngine, PdfEngine, TxtEngine } from './engines.js';
import { aiConfigured, complete as aiComplete } from './ai.js';
import { settings, saveSettings, applyBodyTheme, applyAppearance, appearancePref, cycleAppearance, applyCustomFontBlob, FONTS, THEMES } from './settings.js';
import { isMostlyCjk, translateVisible } from './bilingual.js';
import { backfillFromBooks, createNote, deleteBookBundle, parseTags, syncBook } from './knowledge.js';
import { addToStack, createStack, defaultStackName, dissolveStack, getStack, listStacks, reconcileStacks, removeFromStacks, renameStack, setStackCollapsed } from './stacks.js';
import { createDecisionNote, dismissAssistant, exploreCosmos, exportOutline, fitGraph, focusGraphNeighborhood, focusStarByQuery, getGraphMood, getGraphTilt, initWorkspace, linkFocusedStarTo, openAiSettingsDialog, openAssistant, refreshWorkspace, searchGraph, setGraphMood, setGraphSearch, setGraphTilt, setKnowledgeFind, showPane, workspaceHandleBack, zoomGraph } from './workspace.js';
import { createCommandController, fuzzyScore, speechSupported } from './command.js';

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
let confirmResolve = null;
function confirmSheet(title, sub = '', okLabel = '确认移除') {
  const mask = $('#confirm-mask');
  if (!mask) return Promise.resolve(true);
  if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  $('#confirm-title').textContent = title;
  const subEl = $('#confirm-sub');
  if (subEl) { subEl.textContent = sub; subEl.classList.toggle('hidden', !sub); }
  $('#confirm-ok').textContent = okLabel;
  mask.classList.remove('hidden');
  return new Promise(resolve => {
    confirmResolve = val => {
      confirmResolve = null;
      mask.classList.add('hidden');
      resolve(val);
    };
  });
}
$('#confirm-cancel')?.addEventListener('click', () => confirmResolve?.(false));
$('#confirm-ok')?.addEventListener('click', () => confirmResolve?.(true));
$('#confirm-mask')?.addEventListener('click', e => { if (e.target === e.currentTarget) confirmResolve?.(false); });

async function deleteBooks(recs) {
  if (!recs.length) return false;
  const title = recs.length === 1 ? `移除《${recs[0].title}》？` : `移除这 ${recs.length} 项？`;
  const sub = '进度、书签、摘录和相关笔记会一起移除。';
  if (!(await confirmSheet(title, sub, '确认移除'))) return false;
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
let peekSwipedAt = 0;
let peekBookId = null;
let peekToken = 0;

function stripMarkup(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script, style, nav, head').forEach(n => n.remove());
  return (doc.body?.textContent || '').replace(/[\r\t]+/g, ' ').replace(/\n{2,}/g, '\n').replace(/ {2,}/g, ' ').trim();
}

function decodeBlobText(buf) {
  let s = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const bad = (s.match(/\ufffd/g) || []).length;
  if (bad > 4) {
    try { s = new TextDecoder('gb18030', { fatal: false }).decode(buf); } catch {}
  }
  return s;
}

async function extractBookPreview(book) {
  if (book.lastSnippet && book.lastSnippet.trim()) {
    return {
      kicker: '读到 · ' + (book.lastLabel || fmtPct(book.progress) || '上次阅读位置'),
      text: book.lastSnippet.trim()
    };
  }
  try {
    const file = await db.get('files', book.id);
    if (!file?.blob) throw new Error('missing');
    if (book.type === 'epub' && window.JSZip) {
      const zip = await window.JSZip.loadAsync(file.blob);
      const containerXml = await zip.file('META-INF/container.xml')?.async('string');
      const opfPath = containerXml?.match(/full-path=["']([^"']+)["']/)?.[1];
      if (opfPath) {
        const opfText = await zip.file(opfPath)?.async('string');
        const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
        if (opfText) {
          const opfDoc = new DOMParser().parseFromString(opfText, 'application/xml');
          const descEl = opfDoc.querySelector('description, dc\\:description');
          const desc = stripMarkup(descEl?.textContent || '');
          if (desc.length >= 16) return { kicker: '内容简介', text: Array.from(desc).slice(0, 260).join('') };
          const manifest = new Map();
          opfDoc.querySelectorAll('manifest > item').forEach(it => {
            const id = it.getAttribute('id'), href = it.getAttribute('href');
            if (id && href) manifest.set(id, href);
          });
          const spineRefs = [...opfDoc.querySelectorAll('spine > itemref')].map(r => r.getAttribute('idref')).filter(Boolean);
          for (const ref of spineRefs.slice(0, 6)) {
            const href = manifest.get(ref);
            if (!href) continue;
            const entry = zip.file(opfDir + decodeURIComponent(href)) || zip.file(opfDir + href);
            if (!entry) continue;
            const raw = await entry.async('string');
            const plain = stripMarkup(raw);
            if (plain.length >= 40) return { kicker: '正文开篇', text: Array.from(plain).slice(0, 260).join('') };
          }
        }
      }
    } else if (book.type === 'txt' || book.type === 'html') {
      const slice = file.blob.slice(0, 32768);
      const raw = decodeBlobText(await slice.arrayBuffer());
      const plain = book.type === 'html' ? stripMarkup(raw) : raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (plain) return { kicker: '正文开篇', text: Array.from(plain).slice(0, 260).join('') };
    } else if (book.type === 'pdf') {
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.blob.arrayBuffer()), cMapUrl: './vendor/cmaps/', cMapPacked: true, standardFontDataUrl: './vendor/standard_fonts/' }).promise;
      try {
        const pNum = Math.min(Math.max(book.pos?.page || 1, 1), doc.numPages);
        const page = await doc.getPage(pNum);
        const tc = await page.getTextContent();
        const plain = tc.items.map(i => i.str || '').join(' ').replace(/\s+/g, ' ').trim();
        if (plain) return { kicker: book.pos?.page ? `读到 · 第 ${pNum} 页` : '正文开篇', text: Array.from(plain).slice(0, 260).join('') };
      } finally { try { doc.destroy(); } catch {} }
    }
  } catch {}
  return {
    kicker: book.progress > 0 ? '阅读进度 · ' + fmtPct(book.progress) : '尚未开始阅读',
    text: '点下方「继续阅读」打开正文；读过后，长按左推会自动展示你上次停下的章节文字。'
  };
}

function closeBookPeek() {
  const mask = $('#peek-mask');
  if (!mask || mask.classList.contains('hidden')) return false;
  peekToken++;
  peekBookId = null;
  mask.classList.add('hidden');
  return true;
}

async function openBookPeek(book) {
  const mask = $('#peek-mask');
  if (!mask || !book) return;
  const fresh = (await db.get('books', book.id)) || book;
  const tok = ++peekToken;
  peekBookId = fresh.id;
  $('#peek-cover').replaceChildren(avatarNode(fresh));
  $('#peek-title').textContent = fresh.title || '未命名';
  $('#peek-sub').textContent = [fresh.author, fresh.type ? String(fresh.type).toUpperCase() : '', fresh.progress > 0 ? fmtPct(fresh.progress) : '未读'].filter(Boolean).join(' · ');
  $('#peek-kicker').textContent = fresh.lastSnippet ? ('读到 · ' + (fresh.lastLabel || fmtPct(fresh.progress) || '当前页')) : '正在读取章节…';
  $('#peek-body').textContent = fresh.lastSnippet || '…';
  const latestHl = (fresh.highlights || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  const qEl = $('#peek-quote');
  if (latestHl?.text) {
    qEl.textContent = '「' + Array.from(latestHl.text).slice(0, 110).join('') + (latestHl.text.length > 110 ? '…' : '') + '」';
    qEl.classList.remove('hidden');
  } else {
    qEl.classList.add('hidden');
  }
  $('#peek-open').textContent = fresh.progress > 0 ? '继续阅读' : '开始阅读';
  mask.classList.remove('hidden');
  const preview = await extractBookPreview(fresh);
  if (tok !== peekToken) return;
  $('#peek-kicker').textContent = preview.kicker;
  $('#peek-body').textContent = preview.text;
}

function findDropTarget(x, y, dragId) {
  const els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
  for (const node of els) {
    if (node.closest?.('.drag-ghost')) continue;
    const bookEl = node.closest?.('.book[data-id]');
    if (bookEl && bookEl.dataset.id !== dragId) {
      const stackSec = bookEl.closest?.('.stack[data-stack]');
      return stackSec
        ? { kind: 'stack', id: stackSec.dataset.stack, el: stackSec }
        : { kind: 'book', id: bookEl.dataset.id, el: bookEl };
    }
    const stackSec = node.closest?.('.stack[data-stack]');
    if (stackSec) return { kind: 'stack', id: stackSec.dataset.stack, el: stackSec };
  }
  return null;
}

function showTrashZone(show, hot = false) {
  const z = $('#drag-trash-zone');
  const lbl = $('#drag-trash-label');
  if (!z) return;
  z.classList.toggle('hidden', !show);
  z.classList.toggle('hot', !!(show && hot));
  if (lbl) lbl.textContent = hot ? '松手移除' : '拖到这里移除';
}
function inTrashZone(x, y) {
  const z = $('#drag-trash-zone');
  if (!z || z.classList.contains('hidden')) return false;
  const r = z.getBoundingClientRect();
  return x >= r.left - 24 && x <= r.right + 24 && y >= 0 && y <= r.bottom + 26;
}

function bindShelfBook(el, b, stack, swipeBg) {
  let hold = null, sx = 0, sy = 0, pid = null, held = false, swiping = false, dragging = false, dx = 0, movedDuringDrag = false, overTrash = false;
  let ghost = null, ghostOffX = 0, ghostOffY = 0, hoverTarget = null;
  const preventTouchScroll = ev => { if (dragging || swiping) ev.preventDefault(); };
  const clearHold = () => { clearTimeout(hold); hold = null; };
  const clearHover = () => {
    if (hoverTarget?.el) {
      hoverTarget.el.classList.remove('drop-target');
      hoverTarget.el.removeAttribute('data-drop-hint');
    }
    hoverTarget = null;
  };
  const resetSwipe = () => {
    swiping = false;
    dx = 0;
    el.classList.remove('swiping');
    el.style.transform = '';
    if (swipeBg) swipeBg.className = 'swipe-bg';
    window.removeEventListener('touchmove', preventTouchScroll, { passive: false });
  };
  const endDrag = () => {
    dragging = false;
    overTrash = false;
    showTrashZone(false, false);
    el.classList.remove('dragging');
    ghost?.remove();
    ghost = null;
    clearHover();
    window.removeEventListener('touchmove', preventTouchScroll, { passive: false });
  };
  const startLiftDrag = (clientX, clientY, pointerId) => {
    dragging = true;
    held = true;
    movedDuringDrag = false;
    overTrash = false;
    const rect = el.getBoundingClientRect();
    ghostOffX = clientX - rect.left;
    ghostOffY = clientY - rect.top;
    ghost = el.cloneNode(true);
    ghost.className = 'book drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1.03)`;
    document.body.appendChild(ghost);
    el.classList.add('dragging');
    showTrashZone(true, false);
    try { navigator.vibrate?.(16); } catch {}
    try { el.setPointerCapture(pointerId); } catch {}
    window.addEventListener('touchmove', preventTouchScroll, { passive: false });
  };
  el.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; pid = e.pointerId;
    held = false; swiping = false; dragging = false; dx = 0;
    clearHold();
    if (pickMode) return;
    // 像手机桌面 APP 一样：长按约 320ms 立即浮起卡片；拖到其他卡片自动叠堆、拖到顶部直接删除、原地松手弹出轻量快捷胶囊
    hold = setTimeout(() => {
      hold = null;
      if (swiping || dragging || pid !== e.pointerId) return;
      startLiftDrag(sx, sy, e.pointerId);
    }, 320);
  });
  el.addEventListener('pointermove', e => {
    if (pid !== e.pointerId || pickMode) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (!swiping && !dragging) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.25) {
        clearHold();
        swiping = true;
        el.classList.add('swiping');
        try { el.setPointerCapture(e.pointerId); } catch {}
        window.addEventListener('touchmove', preventTouchScroll, { passive: false });
      } else if (Math.abs(mx) > 10 || Math.abs(my) > 10) {
        clearHold();
      }
    }
    if (swiping) {
      dx = Math.max(-108, Math.min(108, mx));
      el.style.transform = `translate3d(${dx}px, 0, 0)`;
      if (swipeBg) {
        swipeBg.classList.toggle('show', Math.abs(dx) > 14);
        swipeBg.classList.toggle('dir-right', dx > 14);
        swipeBg.classList.toggle('dir-left', dx < -14);
      }
    } else if (dragging && ghost) {
      if (Math.hypot(mx, my) > 12) movedDuringDrag = true;
      ghost.style.transform = `translate3d(${e.clientX - ghostOffX}px, ${e.clientY - ghostOffY}px, 0) scale(1.03)`;
      const trash = inTrashZone(e.clientX, e.clientY);
      if (trash !== overTrash) {
        overTrash = trash;
        showTrashZone(true, overTrash);
      }
      if (overTrash) {
        clearHover();
      } else {
        const hit = findDropTarget(e.clientX, e.clientY, b.id);
        if (hit?.el !== hoverTarget?.el) {
          clearHover();
          hoverTarget = hit;
          if (hoverTarget?.el) {
            hoverTarget.el.classList.add('drop-target');
            hoverTarget.el.setAttribute('data-drop-hint', hoverTarget.kind === 'stack' ? '松手并入' : '松手叠合');
          }
        }
      }
    }
  });
  const finish = async e => {
    if (pid !== e.pointerId) return;
    pid = null;
    clearHold();
    if (swiping) {
      const dir = e.type === 'pointerup' ? (dx >= 56 ? 'right' : dx <= -56 ? 'left' : null) : null;
      resetSwipe();
      held = true;
      peekSwipedAt = Date.now();
      if (dir === 'right') {
        openBookPeek(b);
      } else if (dir === 'left') {
        if (stack) {
          removeFromStacks([b.id]);
          const still = getStack(stack.id);
          toast(still ? `已移出「${stack.name}」` : `「${stack.name}」只剩一项，已散开`);
          await renderLibrary(still ? { anchor: 'stack:' + stack.id, focus: 'stack:' + stack.id } : { anchor: 'book:' + b.id, focus: 'book:' + b.id });
        } else {
          await deleteBooks([b]);
        }
      }
    } else if (dragging) {
      const droppedTrash = e.type === 'pointerup' && (overTrash || inTrashZone(e.clientX, e.clientY));
      const drop = (e.type === 'pointerup' && !droppedTrash) ? (hoverTarget || findDropTarget(e.clientX, e.clientY, b.id)) : null;
      endDrag();
      held = true;
      peekSwipedAt = Date.now();
      if (droppedTrash) {
        await deleteBooks([b]);
      } else if (drop) {
        if (drop.kind === 'stack') {
          const s = addToStack(drop.id, [b.id]);
          if (s) {
            await renderLibrary({ focus: 'stack:' + s.id });
            toast(`已并入「${s.name}」`, 3600, () => { removeFromStacks([b.id]); renderLibrary(); });
          }
        } else if (drop.kind === 'book' && drop.id !== b.id) {
          const existing = listStacks().find(st => st.bookIds.includes(drop.id));
          if (existing) {
            const s = addToStack(existing.id, [b.id]);
            if (s) {
              await renderLibrary({ focus: 'stack:' + s.id });
              toast(`已并入「${s.name}」`, 3600, () => { removeFromStacks([b.id]); renderLibrary(); });
            }
          } else {
            const name = defaultStackName(listStacks());
            const s = createStack(name, [drop.id, b.id]);
            if (s) {
              await renderLibrary({ focus: 'stack:' + s.id });
              toast(`已叠合为「${s.name}」`, 3600, () => { dissolveStack(s.id); renderLibrary(); });
            }
          }
        }
      }
    }
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
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
  const swipeBg = node('div', 'swipe-bg');
  swipeBg.setAttribute('aria-hidden', 'true');
  swipeBg.append(node('span', 'swipe-act left-side', '透视'), node('span', 'swipe-act right-side', stack ? '移出堆' : '删除'));
  el.append(tick, avatarNode(b), meta, side);
  bindShelfBook(el, b, stack, swipeBg);
  wrap.append(swipeBg, el);
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
$('#btn-intent-search')?.addEventListener('click', () => openActiveSearch());
$('#btn-find-close')?.addEventListener('click', () => closeShelfFind());
$('#btn-import')?.addEventListener('click', () => $('#file-input').click());
$('#btn-empty-import')?.addEventListener('click', () => $('#file-input').click());
$('#btn-select-mode')?.addEventListener('click', () => startPick(null));
$('#peek-close')?.addEventListener('click', () => closeBookPeek());
$('#peek-mask')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeBookPeek(); });
$('#peek-open')?.addEventListener('click', () => { const id = peekBookId; closeBookPeek(); if (id) openBook(id); });

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
    || ['#auth-gate', '#ai-mask', '#note-mask', '#settings-mask', '#stack-mask', '#intent-mask', '#command-mask', '#peek-mask', '#lib-panel', '#note-editor']
      .some(sel => { const el = document.querySelector(sel); return el && !el.classList.contains('hidden'); });
  lib.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    if (blocked()) return;
    if (e.target.closest('input, textarea, select, #spatial-bar, .stack-menu, .graph-card, .hud-search, .book, .note-card')) return;
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
    if (Date.now() - peekSwipedAt < 380) return;
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

// Z 轴镜头穿层（Semantic Zoom）：在流 / 知识双指捏合拉远进入更深层（流 -> 知识 -> 星海），双指张开潜入更近层；星海放大到极限自动潜入对应星体笔记
(function bindSemanticZoom() {
  const lib = $('#library');
  if (!lib) return;
  const pts = new Map();
  let d0 = 0, activePane = null, previewEl = null, previewName = null, lastScale = 1;
  const blocked = () => pickMode || !lib.classList.contains('active')
    || ['#ai-mask', '#note-mask', '#settings-mask', '#stack-mask', '#intent-mask', '#command-mask', '#peek-mask', '#lib-panel', '#note-editor']
      .some(sel => { const el = document.querySelector(sel); return el && !el.classList.contains('hidden'); });
  const span = () => {
    const a = [...pts.values()];
    return a.length >= 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
  };
  const clearPreview = () => {
    if (activePane) {
      activePane.style.transition = '';
      activePane.style.transform = '';
      activePane.style.opacity = '';
    }
    if (previewEl) {
      previewEl.classList.remove('z-peek-under');
      previewEl.style.transform = '';
      previewEl.style.opacity = '';
    }
    activePane = null; previewEl = null; previewName = null; d0 = 0; lastScale = 1;
  };
  lib.addEventListener('pointerdown', e => {
    if (blocked() || currentPane() === 'graph') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      d0 = span() || 1;
      activePane = $('#pane-' + currentPane());
      lastScale = 1;
    }
  }, { passive: true });
  lib.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size < 2 || !d0 || !activePane) return;
    const cur = currentPane();
    if (cur === 'graph') { clearPreview(); return; }
    const ratio = (span() || d0) / d0;
    lastScale = ratio;
    const idx = SPACES.indexOf(cur);
    const want = ratio < 0.96 ? SPACES[idx + 1] : (ratio > 1.04 ? SPACES[idx - 1] : null);
    if (want !== previewName) {
      if (previewEl) { previewEl.classList.remove('z-peek-under'); previewEl.style.transform = ''; previewEl.style.opacity = ''; }
      previewName = want || null;
      previewEl = previewName ? $('#pane-' + previewName) : null;
      if (previewEl) previewEl.classList.add('z-peek-under');
    }
    const clamped = Math.max(0.76, Math.min(1.28, ratio));
    const prog = ratio < 1 ? Math.min(1, (1 - ratio) / 0.24) : Math.min(1, (ratio - 1) / 0.26);
    activePane.style.transition = 'none';
    activePane.style.transform = `scale(${clamped.toFixed(3)})`;
    activePane.style.opacity = String(Math.max(0.18, 1 - prog * 0.78));
    if (previewEl) {
      const pScale = ratio < 1 ? (1.14 - prog * 0.14) : (0.86 + prog * 0.14);
      previewEl.style.transform = `scale(${pScale.toFixed(3)})`;
      previewEl.style.opacity = String(Math.min(1, 0.15 + prog * 0.85));
    }
  }, { passive: true });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size >= 2 || !d0) return;
    const target = (lastScale <= 0.82 || lastScale >= 1.22) ? previewName : null;
    clearPreview();
    if (target) showPane(target, { whisper: true });
  };
  lib.addEventListener('pointerup', end, { passive: true });
  lib.addEventListener('pointercancel', end, { passive: true });

  // 桌面触控板捏合 / Ctrl+滚轮穿层
  let wheelLock = 0;
  lib.addEventListener('wheel', e => {
    if (!e.ctrlKey || blocked()) return;
    const cur = currentPane();
    if (cur === 'graph') return;
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLock < 420) return;
    const idx = SPACES.indexOf(cur);
    if (e.deltaY > 12 && idx < SPACES.length - 1) { wheelLock = now; showPane(SPACES[idx + 1], { whisper: true }); }
    else if (e.deltaY < -12 && idx > 0) { wheelLock = now; showPane(SPACES[idx - 1], { whisper: true }); }
  }, { passive: false });
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
  const modalUp = ['#ai-mask', '#note-mask', '#settings-mask', '#stack-mask', '#intent-mask', '#command-mask', '#peek-mask', '#lib-panel', '#note-editor']
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
let importHideTimer = null;
const scheduleImportHide = (ms = 4200) => {
  clearTimeout(importHideTimer);
  importHideTimer = setTimeout(() => $('#import-status')?.classList.add('hidden'), ms);
};
$('#import-status')?.addEventListener('click', () => { clearTimeout(importHideTimer); $('#import-status')?.classList.add('hidden'); });
$('#file-input').onchange = async e => {
  showShelfPage();
  const files = Array.from(e.target.files || []); e.target.value = '';
  if (!files.length) return;
  try { await navigator.storage?.persist?.(); } catch {}
  // 自动识别本地字体文件（.ttf / .otf / .woff / .woff2），直接安装并应用为阅读字体
  const fontFiles = files.filter(f => /\.(ttf|otf|woff2?)$/i.test(f.name || ''));
  const bookFiles = files.filter(f => !/\.(ttf|otf|woff2?)$/i.test(f.name || ''));
  if (fontFiles.length) {
    const ff = fontFiles[fontFiles.length - 1];
    const cleanName = ff.name.replace(/\.(ttf|otf|woff2?)$/i, '');
    await db.put('meta', { key: 'custom-font', name: cleanName, blob: ff });
    await applyCustomFontBlob(ff, cleanName);
    settings.font = 'custom';
    saveSettings();
    if (engine) await engine.applySettings();
    toast(`已导入并应用字体「${cleanName}」`, 3200);
    if (!bookFiles.length) return;
  }
  clearTimeout(importHideTimer);
  const st = $('#import-status'); st.classList.remove('hidden');
  const onlyManifest = bookFiles.every(f => /\.json$/i.test(f.name));
  if (onlyManifest) {
    let n = 0; for (const f of bookFiles) { try { const m = parseManifest(JSON.parse(await f.text())); if (m) n += await applyManifestToLibrary(m); } catch {} }
    st.textContent = `已为 ${n} 本书恢复阅读进度。`; renderLibrary(); scheduleImportHide(3600); return;
  }
  const res = await importFiles(bookFiles, { pdfjsLib, onStatus: t => (st.textContent = t) });
  let msg = `导入完成：新增 ${res.added} 本`;
  if (res.dup) msg += `，已存在 ${res.dup} 本`;
  if (res.progressApplied) msg += `，恢复进度 ${res.progressApplied} 本`;
  if (res.skipped) msg += `，跳过 ${res.skipped} 个不支持的文件`;
  if (res.fail.length) msg += `\n失败 ${res.fail.length} 个：\n` + res.fail.map(f => `· ${f.title}：${f.reason}`).join('\n');
  st.textContent = msg;
  renderLibrary();
  scheduleImportHide(res.fail.length ? 5200 : 3800);
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
  const Eng = rec.type === 'epub' ? EpubEngine : rec.type === 'pdf' ? PdfEngine : rec.type === 'booklet' ? BookletEngine : TxtEngine;
  engine = new Eng(el, rec, onRelocate, pdfjsLib);
  engine.onSelectionChange = () => {
    const sel = engine.getSelection?.();
    if (sel?.text) snap = sel;
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

let pageEnteredAt = Date.now();
let autoPaceOn = false;
let autoPaceTimer = null;
let paceCps = (() => {
  try { const v = Number(localStorage.getItem('rr-read-cps')); return v >= 2.5 && v <= 22 ? v : 8.5; } catch { return 8.5; }
})();

function scheduleAutoPace() {
  clearTimeout(autoPaceTimer);
  if (!autoPaceOn || !engine) return;
  if (lastState?.atEnd) { autoPaceOn = false; toast('已读到本书结尾'); return; }
  const chars = Math.max(80, (engine.pageText?.() || '').trim().length || 160);
  const waitMs = Math.round(Math.max(6, Math.min(45, chars / paceCps)) * 1000);
  autoPaceTimer = setTimeout(async () => {
    if (!autoPaceOn || !engine) return;
    await turn(1, true);
    scheduleAutoPace();
  }, waitMs);
}

function setAutoPace(on, speed = 'auto') {
  autoPaceOn = !!on;
  clearTimeout(autoPaceTimer);
  if (!autoPaceOn) return '已暂停自动翻页';
  if (speed === 'slower') paceCps = Math.max(2.5, +(paceCps * 0.78).toFixed(2));
  else if (speed === 'faster') paceCps = Math.min(22, +(paceCps * 1.25).toFixed(2));
  try { localStorage.setItem('rr-read-cps', String(paceCps)); } catch {}
  scheduleAutoPace();
  const sec = Math.round(Math.max(6, Math.min(45, ((engine?.pageText?.() || '').trim().length || 160) / paceCps)));
  return speed === 'slower' ? `已放慢（约 ${sec} 秒/页）` : speed === 'faster' ? `已加快（约 ${sec} 秒/页）` : `已按你的阅读速度自动翻页（约 ${sec} 秒/页）`;
}

function onRelocate(state) {
  if (!state) return;
  lastState = state;
  pageEnteredAt = Date.now();
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
  if (autoPaceOn) scheduleAutoPace();
}
async function persist() {
  if (!cur) return;
  const patch = { lastOpened: Date.now() };
  if (lastState) {
    patch.pos = lastState.pos;
    if (lastState.progress != null) patch.progress = lastState.progress;
    if (lastState.label) patch.lastLabel = lastState.label;
  }
  try {
    const snip = await engine?.snippet?.();
    if (snip && snip.trim()) patch.lastSnippet = Array.from(snip.trim()).slice(0, 220).join('');
  } catch {}
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
  closeReaderPanel();
  $('#settings').classList.add('hidden');
  $('#select-bar').classList.remove('hidden');
  engine.setSelectMode?.(true);
  if (x != null) engine.selectAt?.(x, y);
  const sel = engine.getSelection?.();
  snap = sel || null;
}
let closing = null;
function closeBook() {
  if (closing) return closing;
  closing = (async () => {
    viewGen++;
    autoPaceOn = false;
    stopTts();
    clearTimeout(autoPaceTimer);
    clearTimeout(saveTimer);
    try { await persist(); } catch (e) { console.error(e); }
    exitSelect();
    dismissAssistant();
    try { engine?.destroy(); } catch {}
    engine = null; cur = null; lastState = null;
    biToken++;
    document.body.classList.remove('bi');
    $('#bilingual')?.classList.add('hidden');
    $('#panel').classList.add('hidden'); $('#reader')?.classList.remove('bird-eye'); $('#note-mask').classList.add('hidden');
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
// 点按 / 滑动翻页；长按进入选择；双指捏合拉远 = 鸟瞰全书目录（Z 轴穿层统一）
(function gestures() {
  const tap = $('#tap'), viewer = $('#viewer'), stage = $('#stage'), readerEl = $('#reader');
  let sx = 0, sy = 0, st = 0, pid = null, timer = null, suppressUp = false, moved = false;
  const pointers = new Map();
  let pinchDist = 0, pinchScale = 1, zoomingOut = false, pageDragging = false, dragDx = 0;
  const pinchSpan = () => {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };
  const resetStageZoom = () => {
    zoomingOut = false;
    pinchScale = 1;
    if (stage) { stage.style.transition = ''; stage.style.transform = ''; stage.style.opacity = ''; stage.style.borderRadius = ''; }
  };
  const resetPageDrag = () => {
    pageDragging = false;
    dragDx = 0;
    viewer.classList.remove('turning-drag');
    viewer.style.transform = '';
    viewer.style.opacity = '';
  };
  const canAnimateTurn = () => !document.documentElement.classList.contains('mode-eink')
    && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animatedTurn = async dir => {
    if (!canAnimateTurn()) { resetPageDrag(); await turn(dir); return; }
    viewer.classList.remove('turning-drag');
    const outX = dir > 0 ? -36 : 36;
    viewer.style.transform = `translate3d(${outX}px, 0, 0)`;
    viewer.style.opacity = '0.25';
    await wait(115);
    await turn(dir);
    viewer.classList.add('turning-drag');
    viewer.style.transform = `translate3d(${-outX * 0.45}px, 0, 0)`;
    viewer.style.opacity = '0.55';
    void viewer.offsetWidth;
    viewer.classList.remove('turning-drag');
    viewer.style.transform = '';
    viewer.style.opacity = '';
    pageDragging = false;
    dragDx = 0;
  };
  const clearTimer = () => { clearTimeout(timer); timer = null; };
  const down = e => {
    if (e.button != null && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; st = Date.now(); pid = e.pointerId; moved = false; pageDragging = false; dragDx = 0;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) { resetPageDrag(); pinchDist = pinchSpan(); pinchScale = 1; zoomingOut = false; moved = true; clearTimer(); return; }
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
      const ratio = d / pinchDist;
      pinchScale = ratio;
      // 双指张开/捏合专一用于调字号，与目录手势彻底分离、零冲突
      if (ratio > 1.18) {
        pinchDist = d;
        suppressUp = true;
        bumpSize(2);
      } else if (ratio < 0.84) {
        pinchDist = d;
        suppressUp = true;
        bumpSize(-2);
      }
      return;
    }
    if (pid !== e.pointerId) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) { moved = true; clearTimer(); }
    // 苹果级跟手翻页物理反馈：横向滑动时书页实时跟随手指位移并带阻尼
    const zoomed = document.body.classList.contains('pdf-zoom');
    const scrolled = settings.flow === 'scrolled' && settings.writing !== 'vertical-rl' && cur?.type !== 'pdf';
    if (!zoomed && !scrolled && !document.body.classList.contains('selecting') && canAnimateTurn()) {
      if (!pageDragging && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        pageDragging = true;
        viewer.classList.add('turning-drag');
      }
      if (pageDragging) {
        dragDx = Math.max(-130, Math.min(130, dx));
        const shift = dragDx * 0.42;
        const fade = Math.max(0.68, 1 - Math.abs(dragDx) / 360);
        viewer.style.transform = `translate3d(${shift.toFixed(1)}px, 0, 0)`;
        viewer.style.opacity = fade.toFixed(3);
      }
    }
  };
  const up = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      const triggerBirdEye = zoomingOut && pinchScale <= 0.84;
      pinchDist = 0;
      resetStageZoom();
      if (triggerBirdEye) { openReaderPanel('toc'); return; }
    }
    clearTimer();
    if (pid != null && pid !== e.pointerId) return;
    pid = null;
    if (!engine) { resetPageDrag(); return; }
    if (suppressUp) { suppressUp = false; resetPageDrag(); return; }
    if (document.body.classList.contains('selecting')) {
      resetPageDrag();
      const dxSel = Math.abs(e.clientX - sx), dySel = Math.abs(e.clientY - sy);
      if (dxSel < 8 && dySel < 8 && Date.now() - st < 320) {
        setTimeout(() => {
          if (document.body.classList.contains('selecting') && !engine?.getSelection?.()?.text) exitSelect();
        }, 120);
      }
      return;
    }
    const zoomed = document.body.classList.contains('pdf-zoom');
    if (zoomed && e.currentTarget === tap) { resetPageDrag(); return; }
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const scrolled = settings.flow === 'scrolled' && settings.writing !== 'vertical-rl' && cur?.type !== 'pdf';
    const rtl = !!(engine?.isRtl?.() || settings.writing === 'vertical-rl');
    const nextOnLeft = rtl || !!settings.leftHand;
    if (!zoomed && !scrolled && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.15 && Date.now() - st < 900) {
      const dir = rtl ? (dx > 0 ? 1 : -1) : (dx < 0 ? 1 : -1);
      animatedTurn(dir);
      return;
    }
    // 顶部向下轻拉 -> 直接 Z 轴鸟瞰展开全书目录（与双指调字号、左右翻页 100% 物理分离）
    if (!zoomed && !scrolled && sy < 140 && dy > 48 && dy > Math.abs(dx) * 1.35 && Date.now() - st < 850) {
      resetPageDrag();
      openReaderPanel('toc');
      return;
    }
    if (pageDragging) { resetPageDrag(); return; }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const barsOpen = !$('#bars').classList.contains('hidden');
    if (barsOpen) { setBars(false); return; }
    if (scrolled) {
      const h = window.innerHeight, y = e.clientY;
      if (y < h * 0.28) turn(-1);
      else if (y > h * 0.72) turn(1);
      else setBars(true);
      return;
    }
    const w = window.innerWidth, x = e.clientX;
    if (nextOnLeft) {
      if (x < w * 0.35) turn(1); else if (x > w * 0.65) turn(-1); else setBars(true);
    } else {
      if (x < w * 0.3) turn(-1); else if (x > w * 0.7) turn(1); else setBars(true);
    }
  };
  for (const el of [tap, viewer]) {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinchDist = 0; resetStageZoom(); resetPageDrag(); clearTimer(); pid = null; });
  }
  // 桌面端 Ctrl+滚轮在阅读器内同样支持 Z 轴穿层：拉远鸟瞰全书目录，拉近潜回正文
  let rWheelLock = 0;
  readerEl?.addEventListener('wheel', e => {
    if (!e.ctrlKey || !engine) return;
    e.preventDefault();
    const now = Date.now();
    if (now - rWheelLock < 380) return;
    const panelOpen = !$('#panel').classList.contains('hidden');
    if (e.deltaY > 12 && !panelOpen) { rWheelLock = now; openReaderPanel('toc'); }
    else if (e.deltaY < -12 && panelOpen) { rWheelLock = now; closeReaderPanel(); }
  }, { passive: false });
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
async function turn(d, fromAuto = false) {
  if (turning) return;
  if (!fromAuto && d > 0 && engine) {
    const dt = (Date.now() - pageEnteredAt) / 1000;
    const chars = (engine.pageText?.() || '').trim().length;
    if (dt >= 3 && dt <= 180 && chars >= 25) {
      const sample = Math.max(2.5, Math.min(22, chars / dt));
      paceCps = +(paceCps * 0.72 + sample * 0.28).toFixed(2);
      try { localStorage.setItem('rr-read-cps', String(paceCps)); } catch {}
    }
  }
  turning = true;
  try { await (d > 0 ? engine.next() : engine.prev()); }
  finally { turning = false; }
}

$('#r-slider').addEventListener('change', e => engine?.goToFraction(e.target.value / 1000));
document.addEventListener('selectionchange', () => {
  if (!document.body.classList.contains('selecting') || !engine?.getSelection) return;
  const sel = engine.getSelection();
  if (sel?.text) snap = sel;
});

/* 面板：目录 / 书签 / 划线（Z 轴鸟瞰全书索引） */
function closeReaderPanel() {
  const p = $('#panel');
  if (!p || p.classList.contains('hidden')) return false;
  p.classList.add('hidden');
  $('#reader')?.classList.remove('bird-eye');
  return true;
}
function openPanel(title, nodes, tab = 'toc') {
  if ($('#panel-title')) $('#panel-title').textContent = title;
  document.querySelectorAll('#panel-tabs [data-ptab]').forEach(btn => {
    const on = btn.dataset.ptab === tab;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('#panel-body').replaceChildren(...nodes);
  $('#panel').classList.remove('hidden');
  $('#reader')?.classList.add('bird-eye');
  setBars(false);
}
async function openReaderPanel(tab = 'toc') {
  if (!engine || !cur) return;
  if (tab === 'bms') {
    const list = (cur.bookmarks || []).slice().sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0));
    const nodes = list.length ? list.map(bm => {
      const row = document.createElement('div'); row.className = 'item-row';
      const b = document.createElement('button'); b.className = 'item';
      b.textContent = bm.text || bm.label || '书签';
      const sm = document.createElement('small'); sm.textContent = [bm.label, fmtPct(bm.progress), new Date(bm.at).toLocaleDateString('zh-CN')].filter(Boolean).join(' · '); b.appendChild(sm);
      b.onclick = async () => { closeReaderPanel(); setBars(false); await engine.goTo(bm.pos); };
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '删除';
      x.onclick = async () => { cur.bookmarks.splice(cur.bookmarks.indexOf(bm), 1); await db.update('books', cur.id, { bookmarks: cur.bookmarks }); row.remove(); updateBmIcon(); };
      row.append(b, x); return row;
    }) : [emptyNote('还没有书签。直接说「加书签」即可收藏当前页。')];
    openPanel('书签', nodes, 'bms');
    return;
  }
  if (tab === 'hls') {
    const list = (cur.highlights || []).slice().sort((a, b) => b.createdAt - a.createdAt);
    const nodes = list.length ? list.map(item => passageRow(cur, item, {
      onOpen: async () => { closeReaderPanel(); setBars(false); try { if (item.pos) await engine.goTo(item.pos); } catch {} },
      onDelete: () => deletePassage(cur.id, item)
    })) : [emptyNote('还没有划线。长按文字或说「把第2行划线」即可高亮并同步到知识与星海。')];
    openPanel('划线', nodes, 'hls');
    return;
  }
  const toc = await engine.toc();
  const curLabel = lastState?.label;
  const nodes = toc.length ? toc.map(t => { const b = document.createElement('button'); b.className = 'item' + (t.label === curLabel ? ' cur' : ''); b.style.paddingLeft = 16 + t.depth * 18 + 'px'; b.textContent = t.label || '（无标题）'; b.onclick = async () => { closeReaderPanel(); setBars(false); await engine.goToc(t.target); }; return b; })
    : [emptyNote('这本书没有目录')];
  openPanel('目录', nodes, 'toc');
  $('#panel-body').querySelector('.cur')?.scrollIntoView({ block: 'center' });
}
$('#panel-close')?.addEventListener('click', () => closeReaderPanel());
$('#panel-backdrop')?.addEventListener('click', () => closeReaderPanel());
(function bindPanelSwipeClose() {
  const head = document.querySelector('#panel .panel-head');
  const grip = $('#panel-grip');
  const sheet = document.querySelector('#panel .panel-sheet');
  if (!sheet) return;
  let sy = 0, pid = null, dy = 0;
  const onDown = e => {
    if (e.button != null && e.button !== 0) return;
    sy = e.clientY; pid = e.pointerId; dy = 0;
    sheet.style.transition = 'none';
  };
  const onMove = e => {
    if (pid !== e.pointerId) return;
    dy = Math.max(0, e.clientY - sy);
    sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
  };
  const onUp = e => {
    if (pid !== e.pointerId) return;
    pid = null;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (e.type === 'pointerup' && dy > 76) closeReaderPanel();
  };
  for (const h of [head, grip].filter(Boolean)) {
    h.addEventListener('pointerdown', onDown);
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
    h.addEventListener('pointercancel', onUp);
  }
})();
document.querySelectorAll('#panel-tabs [data-ptab]').forEach(btn => {
  btn.onclick = () => openReaderPanel(btn.dataset.ptab);
});
$('#btn-toc')?.addEventListener('click', () => openReaderPanel('toc'));
function samePos(a, b) { return a && b && JSON.stringify(a) === JSON.stringify(b); }
function updateBmIcon() { const on = cur?.bookmarks?.some(b => samePos(b.pos, lastState?.pos)); if ($('#btn-bm')) $('#btn-bm').textContent = on ? '★' : '☆'; }
async function toggleCurrentBookmark(silent = false) {
  if (!cur || !lastState) return null;
  cur.bookmarks = cur.bookmarks || [];
  const i = cur.bookmarks.findIndex(b => samePos(b.pos, lastState.pos));
  let added = false;
  if (i >= 0) { cur.bookmarks.splice(i, 1); if (!silent) toast('已删除书签'); }
  else { cur.bookmarks.push({ pos: lastState.pos, progress: lastState.progress, label: lastState.label, text: await engine.snippet(), at: Date.now() }); added = true; if (!silent) toast('已添加书签'); }
  await db.update('books', cur.id, { bookmarks: cur.bookmarks });
  updateBmIcon();
  return added;
}
$('#btn-bm')?.addEventListener('click', () => toggleCurrentBookmark(false));

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
  closeReaderPanel();
  exitSelect();
  if (!engine || cur?.id !== bookId) await openBook(bookId);
  try { if (item.pos) await engine?.goTo(item.pos); } catch (err) { console.warn(err); }
}
async function openLibraryExcerpts() {
  const books = await db.all('books');
  const items = [];
  for (const b of books) for (const h of b.highlights || []) items.push({ book: b, item: h });
  items.sort((a, b) => b.item.createdAt - a.item.createdAt);
  const nodes = items.length ? items.map(({ book, item }) => passageRow(book, item, {
    onOpen: () => openPassage(book.id, item),
    onDelete: () => deletePassage(book.id, item)
  })) : [emptyNote('还没有摘录。打开一本书，长按文字或说「把第2行划线」即可保存。')];
  $('#lib-title').textContent = '摘录';
  $('#lib-body').replaceChildren(...nodes);
  $('#lib-panel').classList.remove('hidden');
}
$('#btn-excerpts')?.addEventListener('click', () => openLibraryExcerpts());
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
$('#btn-hl')?.addEventListener('click', async () => {
  const sel = currentSelection();
  const ok = await addPassage('highlight', sel);
  if (ok) { toast('已划线并同步到知识'); exitSelect(); }
});
let noteKind = 'excerpt';
function openNoteDialog(kind = 'excerpt') {
  const sel = currentSelection();
  if (!sel?.text) { toast('请先选中文字'); return; }
  noteKind = kind;
  noteSel = sel;
  const heading = $('#note-heading');
  if (heading) heading.textContent = '写想法或摘录';
  $('#note-text').placeholder = '写一句想法（留空则直接存为摘录）';
  $('#note-quote').textContent = sel.text.length > 180 ? sel.text.slice(0, 180) + '…' : sel.text;
  $('#note-text').value = '';
  if ($('#note-tags')) $('#note-tags').value = '';
  $('#note-mask').classList.remove('hidden');
  setTimeout(() => $('#note-text').focus(), 30);
}
$('#btn-note')?.addEventListener('click', () => openNoteDialog('annotation'));
$('#btn-ai')?.addEventListener('click', () => {
  const sel = currentSelection();
  if (!sel?.text) { toast('请先选中文字'); return; }
  openAssistant({
    title: '解释这段话',
    quote: sel.text.trim(),
    context: cur ? `来自《${cur.title}》${lastState?.label ? ' · ' + lastState.label : ''}` : '',
    bookId: cur?.id || null,
    bookTitle: cur?.title || ''
  });
});
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
$('#note-cancel').onclick = () => { $('#note-mask').classList.add('hidden'); noteSel = null; };
$('#note-dialog').onsubmit = async e => {
  e.preventDefault();
  const sel = noteSel;
  const note = $('#note-text').value.trim();
  const tags = parseTags($('#note-tags')?.value || '');
  const kind = note ? 'annotation' : 'excerpt';
  $('#note-mask').classList.add('hidden');
  const ok = await addPassage(kind, sel, note, tags);
  noteSel = null;
  noteKind = 'excerpt';
  if (ok) toast(note ? '已保存想法并划线' : '已保存摘录');
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
$('#btn-aa')?.addEventListener('click', () => { const s = $('#settings'); const show = s.classList.contains('hidden'); if (show) buildSettings(); s.classList.toggle('hidden', !show); });

let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => engine?.resize(), 250); });

function handleBack() {
  if (command?.closeBar(true)) return true;
  if (closeBookPeek()) return true;
  if (dismissAssistant()) return true;
  if (closeStackDialog()) return true;
  if (closeIntent()) return true;
  if (closeStackMenus(true)) return true;
  if (!$('#note-mask').classList.contains('hidden')) { $('#note-mask').classList.add('hidden'); noteSel = null; return true; }
  if (document.body.classList.contains('selecting')) { exitSelect(); return true; }
  if (closeEyeRest()) return true;
  if (sichao.close()) return true;
  if (closeReaderPanel()) return true;
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
  toast, copyText, cycleAppearance, confirm: confirmSheet,
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
  if (engine?.needsReopen?.() && cur) {
    await persist();
    const id = cur.id;
    try { engine.destroy(); } catch {}
    engine = null;
    await openBook(id);
    return;
  }
  if (cur?.type === 'pdf' && engine) {
    engine.reflow = true;
    await engine.render();
  }
  await engine?.applySettings?.();
  refreshBilingual();
}

function pickVisiblePassage(eng, opts = {}) {
  const raw = (eng?.pageText?.() || '').trim();
  if (!raw) return null;
  const paras = raw.split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const sentences = paras.flatMap(p => p.split(/(?<=[。！？!?；;])/).map(s => s.trim()).filter(Boolean));
  let text = '';
  if (opts.query) {
    const q = opts.query.trim();
    const ql = q.toLowerCase();
    const hitSent = sentences.find(s => s.toLowerCase().includes(ql)) || paras.find(p => p.toLowerCase().includes(ql));
    if (hitSent) text = q.length >= 4 && hitSent.length > 60 ? q : hitSent;
    else if (raw.toLowerCase().includes(ql)) text = q;
  } else if (opts.paragraph) {
    text = paras[Math.min(paras.length - 1, Math.max(0, opts.paragraph - 1))] || '';
  } else if (opts.line) {
    const lines = sentences.length >= opts.line ? sentences : paras;
    text = lines[Math.min(lines.length - 1, Math.max(0, opts.line - 1))] || '';
  } else {
    text = paras.find(p => p.length > 8) || paras[0] || '';
  }
  if (!text) return null;
  return {
    text,
    pos: lastState?.pos || null,
    cfiRange: null,
    ch: cur?.type === 'txt' ? eng.ch : null,
    page: cur?.type === 'pdf' ? eng.page : null
  };
}

let eyeRestTimer = null;
function closeEyeRest() {
  clearInterval(eyeRestTimer);
  eyeRestTimer = null;
  const m = $('#eye-rest-mask');
  if (!m || m.classList.contains('hidden')) return false;
  m.classList.add('hidden');
  return true;
}
function openEyeRest(seconds = 20) {
  const m = $('#eye-rest-mask');
  const cnt = $('#eye-rest-count');
  if (!m) return;
  clearInterval(eyeRestTimer);
  let left = seconds;
  if (cnt) cnt.textContent = `${left}s · 轻触任意处返回`;
  m.classList.remove('hidden');
  eyeRestTimer = setInterval(() => {
    left--;
    if (left <= 0) { closeEyeRest(); toast('休息好了，继续阅读吧'); return; }
    if (cnt) cnt.textContent = `${left}s · 轻触任意处返回`;
  }, 1000);
}
$('#eye-rest-mask')?.addEventListener('click', () => closeEyeRest());

let ttsActive = false;
function stopTts() {
  ttsActive = false;
  try { window.speechSynthesis?.cancel(); } catch {}
}
function speakCurrentPage() {
  if (!ttsActive || !engine) return;
  const text = (engine.pageText?.() || '').replace(/\s+/g, ' ').trim();
  if (!text) { stopTts(); return; }
  if (!('speechSynthesis' in window)) { ttsActive = false; toast('当前环境不支持语音朗读'); return; }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = isMostlyCjk(text) ? 'zh-CN' : 'en-US';
    u.rate = 0.96;
    u.onend = async () => {
      if (!ttsActive || !engine || lastState?.atEnd) { ttsActive = false; return; }
      await turn(1, true);
      setTimeout(() => speakCurrentPage(), 350);
    };
    u.onerror = () => { ttsActive = false; };
    window.speechSynthesis.speak(u);
  } catch { ttsActive = false; }
}

const sichao = initSichao({ toast, onNoteCreated: () => refreshWorkspace() });

command = createCommandController({
  toast,
  closeMenus: () => { closeIntent(false); closeStackMenus(false); closeBookPeek(); },
  context: () => ({ reading: !!engine && $('#reader').classList.contains('active'), pane: currentPane(), tilt: getGraphTilt() }),
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
        if (settings.eink) { settings.eink = false; saveSettings(); }
        applyAppearance();
        const nm = a.value === 'dark' ? '深色外观' : a.value === 'light' ? '浅色外观' : '自动外观';
        return { label: nm, undoable: true };
      }
      case 'eink': {
        settings.eink = !!a.on;
        await applyReaderPrefs();
        return { label: settings.eink ? '已开墨水屏模式' : '已退出墨水屏', undoable: true };
      }
      case 'leftHand': {
        settings.leftHand = !!a.on;
        saveSettings();
        applyAppearance();
        return { label: settings.leftHand ? '已切到左手模式' : '已恢复右手模式', undoable: true };
      }
      case 'eyeComfort': {
        settings.theme = 'sepia';
        settings.lh = Math.max(settings.lh || 1.8, 2.1);
        settings.size = Math.min(40, Math.max(21, (settings.size || 19) + 2));
        await applyReaderPrefs();
        return { label: '已切至舒眼柔和排版（护眼暖纸 · 宽松行距 · 放大字号）', undoable: true };
      }
      case 'eyeRest': {
        openEyeRest(20);
        return { label: '护眼远眺小憩 20 秒' };
      }
      case 'tts': {
        if (!a.on) { stopTts(); return { label: '已停止朗读' }; }
        if (!reading) return { label: '打开一本书后即可闭眼听书' };
        ttsActive = true;
        speakCurrentPage();
        return { label: '已开始轻声朗读，闭上眼歇一会儿吧' };
      }
      case 'flow': {
        settings.flow = a.value === 'scrolled' ? 'scrolled' : 'paginated';
        if (settings.flow === 'scrolled' && settings.writing === 'vertical-rl') settings.writing = 'horizontal';
        await applyReaderPrefs();
        return { label: settings.flow === 'scrolled' ? '上下滚动翻页' : '左右分页阅读', undoable: true };
      }
      case 'writing': {
        settings.writing = a.value === 'vertical-rl' ? 'vertical-rl' : 'horizontal';
        if (settings.writing === 'vertical-rl') settings.flow = 'paginated';
        await applyReaderPrefs();
        return { label: settings.writing === 'vertical-rl' ? '传统竖排（从右往左）' : '横排阅读', undoable: true };
      }
      case 'bilingual': {
        settings.bilingual = !!a.on;
        saveSettings();
        if (!$('#settings').classList.contains('hidden')) buildSettings();
        refreshBilingual();
        return { label: a.on ? '已开自动对照翻译' : '只看原文', undoable: true };
      }
      case 'autoPace': {
        if (!reading) return { label: '打开一本书后即可按你的阅读速度自动翻页' };
        return { label: setAutoPace(a.on, a.speed || 'auto') };
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
      case 'goPage': {
        if (!reading) return { label: '先打开一本书即可跳页' };
        const p = Math.max(1, Number(a.page) || 1);
        if (cur?.type === 'pdf') {
          const target = Math.min(p, engine.n || p);
          await engine.goTo({ page: target });
          return { label: `第 ${target} 页` };
        }
        if (cur?.type === 'txt' && engine.pages) {
          const target = Math.min(p, engine.pages);
          engine.p = target - 1;
          engine.paint();
          return { label: `本章第 ${target} 页` };
        }
        if (engine.hasLocations?.()) {
          const total = engine.book?.locations?.length?.() || 100;
          await engine.goToFraction(Math.min(0.995, (p - 1) / Math.max(1, total)));
          return { label: `已翻至约第 ${p} 页` };
        }
        return { label: '这本书正在分页，稍后再试' };
      }
      case 'goChapter': {
        if (!reading) return { label: '先打开一本书即可跳章' };
        const toc = (await engine.toc?.()) || [];
        if (!toc.length) return { label: '这本书没有目录' };
        const idx = Math.max(1, Number(a.index) || 1);
        const re = new RegExp(`(?:第\\s*${idx}\\s*[章节回]|chapter\\s*${idx}\\b|^${idx}[.、\\s])`, 'i');
        const hit = toc.find(t => re.test(t.label || '')) || toc[Math.min(toc.length - 1, idx - 1)];
        await engine.goToc(hit.target);
        return { label: hit.label || `第 ${idx} 章` };
      }
      case 'voiceMark': {
        if (!reading) return { label: '打开一本书后即可语音划线' };
        const sel = pickVisiblePassage(engine, a);
        if (!sel) return { label: a.query ? `这页没找到「${a.query}」` : '当前页没有可标记的文字' };
        const kind = a.note ? 'annotation' : (a.kind || 'highlight');
        const ok = await addPassage(kind, sel, a.note || '');
        if (!ok) return null;
        const preview = Array.from(sel.text).slice(0, 14).join('') + (sel.text.length > 14 ? '…' : '');
        return { label: `已${kind === 'annotation' ? '批注' : kind === 'excerpt' ? '摘抄' : '划线'}「${preview}」` };
      }
      case 'bookmark': {
        if (!reading) return { label: '打开一本书后即可加书签' };
        const added = await toggleCurrentBookmark(true);
        return { label: added ? '已添加书签' : '已取消书签' };
      }
      case 'toc': {
        if (!reading) return { label: '打开一本书后即可看目录' };
        await openReaderPanel('toc');
        return { label: '已打开目录' };
      }
      case 'bookmarks': {
        if (!reading) return { label: '打开一本书后即可看书签' };
        await openReaderPanel('bms');
        return { label: '已打开书签' };
      }
      case 'highlights': {
        if (!reading) return { label: '打开一本书后即可看划线' };
        await openReaderPanel('hls');
        return { label: '已打开划线' };
      }
      case 'openSettings': {
        if (!reading) return { label: '阅读时说出「打开排版」可调细节' };
        setBars(true);
        buildSettings();
        $('#settings').classList.remove('hidden');
        return { label: '已展开排版面板' };
      }
      case 'importUrl': {
        if (reading) await closeBook();
        showPane('shelf');
        toast('正在抓取文章正文…', 2400);
        try {
          const r = await importArticleUrl(a.url);
          await renderLibrary();
          return { label: r.status === 'dup' ? `《${r.title}》已在流中` : `已导入文章《${r.title}》` };
        } catch (err) {
          return { label: err?.message || '网页导入失败' };
        }
      }
      case 'setOpds': {
        setOpdsUrl(a.url);
        return { label: '已绑定个人 OPDS 书源，现在可直接说「帮我找《书名》」' };
      }
      case 'findBook': {
        if (reading) await closeBook();
        showPane('shelf');
        toast(`正在检索「${a.query}」…`, 2600);
        try {
          const found = await findAndFetchBook(a.query);
          if (!found.found) {
            return { label: `公版书库未收录《${found.query}》，说「配置书源 网址」可接入个人书库` };
          }
          const r = await importBlob(found.blob, found.fileName, { pdfjsLib });
          await renderLibrary();
          return { label: `已从${found.source}导入《${r.title || found.title}》` };
        } catch (err) {
          return { label: err?.message || '找书失败，请检查网络或书源地址' };
        }
      }
      case 'setSichaoApi': {
        setSichaoApi(a.url || '');
        return { label: a.url ? '已连接思潮 24/7 云端情报底座' : '已切回本机离线思潮模式' };
      }
      case 'openSichao': {
        if (reading) await closeBook();
        sichao.open();
        return { label: '已打开「思潮」独立判断空间' };
      }
      case 'askAi': {
        const pageTxt = reading ? (engine?.pageText?.() || '').trim().slice(0, 1200) : '';
        const q = a.question || '总结这一段';
        openAssistant({
          title: q.slice(0, 18),
          quote: pageTxt || q,
          context: reading && cur ? `来自《${cur.title}》${lastState?.label ? ' · ' + lastState.label : ''}` : '语音直连 AI 提问',
          bookId: cur?.id || null,
          bookTitle: cur?.title || ''
        });
        if (pageTxt && q) {
          setTimeout(() => {
            const inp = $('#ai-q');
            if (inp) { inp.value = q; $('#ai-ask')?.requestSubmit?.(); }
          }, 180);
        }
        return { label: '已唤醒 AI 助手' };
      }
      case 'resetUi': {
        try { localStorage.removeItem('zone-custom-css'); } catch {}
        document.getElementById('zone-user-style')?.remove();
        return { label: '已恢复 Zone 默认界面风格' };
      }
      case 'styleUi': {
        const prevCss = localStorage.getItem('zone-custom-css') || '';
        const applyCss = css => {
          let tag = document.getElementById('zone-user-style');
          if (!tag) { tag = document.createElement('style'); tag.id = 'zone-user-style'; document.head.appendChild(tag); }
          tag.textContent = css;
          try { if (css) localStorage.setItem('zone-custom-css', css); else localStorage.removeItem('zone-custom-css'); } catch {}
        };
        let css = '';
        if (aiConfigured()) {
          toast('AI 正在实时定制界面…', 2400);
          try {
            const raw = await aiComplete([
              { role: 'system', content: '你是 Zone 界面样式师。只输出合法的纯 CSS 代码（不要 markdown 代码块、不要解释、不要 @import 或 url()）。常用变量：--app-bg, --app-fg, --app-muted, --app-card, --app-elev, --app-accent, --bg, --fg。' },
              { role: 'user', content: a.prompt }
            ]);
            css = String(raw || '').replace(/^```(?:css)?\s*/i, '').replace(/```\s*$/i, '').replace(/@import|url\s*\(/gi, '').trim();
          } catch {}
        }
        if (!css) {
          // 离线自然语言即时换肤兜底
          const p = a.prompt;
          const rules = [];
          if (/墨绿|森绿|豆沙绿|绿/.test(p)) rules.push(':root,body{--app-bg:#eef3ef;--bg:#eef3ef;--app-fg:#1d2b22;--fg:#1d2b22}');
          else if (/灰蓝|雾蓝|淡蓝|蓝/.test(p)) rules.push(':root,body{--app-bg:#eef2f7;--bg:#eef2f7;--app-fg:#1c2533;--fg:#1c2533}');
          else if (/暖黄|米黄|羊皮|暖/.test(p)) rules.push(':root,body{--app-bg:#f6efe2;--bg:#f6efe2;--app-fg:#3b2f21;--fg:#3b2f21}');
          if (/圆角|圆润/.test(p)) rules.push('.book,.stack-card,.note-card{border-radius:26px!important}');
          if (/紧凑/.test(p)) rules.push('.book{padding-top:8px!important;padding-bottom:8px!important}');
          css = rules.join('\n');
        }
        if (!css) return { label: '配置 AI 密钥后可按任意描述实时改造界面（离线支持颜色/圆角/紧凑调节）' };
        applyCss(css);
        return { label: '已实时应用自定义界面（说「恢复默认界面」可一键还原）' };
      }
      case 'stackCreate': {
        if (reading) await closeBook();
        showPane('shelf');
        await renderLibrary();
        const ids = a.ordinals.map(n => shelfOrder[n - 1]).filter(Boolean);
        if (ids.length < 2) return { label: '至少需要 2 本有效书籍才能建卡片堆' };
        const s = createStack(a.name || defaultStackName(listStacks()), ids);
        if (!s) return { label: '建堆失败' };
        await renderLibrary({ focus: 'stack:' + s.id, reveal: true });
        return { label: `已新建卡片堆「${s.name}」（${s.bookIds.length} 项）` };
      }
      case 'stackRemove': {
        if (reading) await closeBook();
        showPane('shelf');
        const stacks = listStacks();
        const st = stacks[(a.stackIndex || 1) - 1];
        if (!st) return { label: `找不到第 ${a.stackIndex || 1} 个卡片堆` };
        const targetId = st.bookIds[(a.itemIndex || 1) - 1];
        if (!targetId) return { label: `「${st.name}」里没有第 ${a.itemIndex || 1} 项` };
        removeFromStacks([targetId]);
        await renderLibrary();
        return { label: `已从「${st.name}」移出第 ${a.itemIndex || 1} 项` };
      }
      case 'stackMerge': {
        if (reading) await closeBook();
        showPane('shelf');
        const stacks = listStacks();
        const sa = stacks[(a.a || 1) - 1], sb = stacks[(a.b || 2) - 1];
        if (!sa || !sb || sa.id === sb.id) return { label: '需要至少两个不同的卡片堆才能合并' };
        const merged = addToStack(sa.id, sb.bookIds);
        dissolveStack(sb.id);
        await renderLibrary({ focus: 'stack:' + sa.id });
        return { label: `已将「${sb.name}」合并进「${merged?.name || sa.name}」` };
      }
      case 'stackDissolve': {
        if (reading) await closeBook();
        showPane('shelf');
        const st = listStacks()[(a.stackIndex || 1) - 1];
        if (!st) return { label: `找不到第 ${a.stackIndex || 1} 个卡片堆` };
        dissolveStack(st.id);
        await renderLibrary();
        return { label: `已解散「${st.name}」` };
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
        const books = await db.all('books');
        if (!books.length) return { label: '还没有导入书' };
        sortBooks(books, currentSort());
        let hit = null;
        if (typeof a.index === 'number' && a.index !== 0) {
          const idx = a.index > 0 ? a.index - 1 : books.length + a.index;
          if (idx < 0 || idx >= books.length) return { label: `列表里目前只有 ${books.length} 本书` };
          hit = books[idx];
        } else {
          const q = String(a.query || '').trim();
          if (!q) {
            hit = books[0];
          } else {
            let best = null, bestScore = 0;
            for (const b of books) {
              const sc = Math.max(
                fuzzyScore(b.title, q) * 1.12,
                fuzzyScore(b.author, q) * 0.92,
                fuzzyScore(`${b.title || ''} ${b.author || ''}`, q) * 0.88
              );
              if (sc > bestScore) { bestScore = sc; best = b; }
            }
            if (best && bestScore >= 85) hit = best;
          }
        }
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
        await createNote({
          title, body: a.text, tags: [], kind: 'note',
          bookId: reading ? cur?.id || null : null,
          bookTitle: reading ? cur?.title || '' : ''
        });
        await refreshWorkspace();
        return { label: `已记想法「${title}」` };
      }
      case 'newDecision': {
        if (reading) await closeBook();
        await createDecisionNote();
        return { label: '新建判断' };
      }
      case 'exportOutline': {
        if (reading) await closeBook();
        await exportOutline();
        return null;
      }
      case 'importBooks': {
        if (reading) await closeBook();
        showPane('shelf');
        $('#file-input')?.click();
        return { label: '请选择要导入的书籍或文件' };
      }
      case 'cosmosExplore': {
        if (reading) await closeBook();
        showPane('graph', { whisper: false });
        const hit = exploreCosmos(a.mode || 'tour');
        if (!hit) return { label: '星海还没有点亮的星，先记一条想法吧' };
        return { label: `${hit.sector} · ${hit.title}` };
      }
      case 'cosmosFocus': {
        if (reading) await closeBook();
        showPane('graph', { whisper: false });
        const hit = focusStarByQuery(a.query);
        if (!hit) return { label: `星海里没找到「${a.query}」` };
        return { label: `已飞往「${hit.title}」` };
      }
      case 'cosmosNeighbors': {
        if (reading) await closeBook();
        showPane('graph', { whisper: false });
        const hit = focusGraphNeighborhood();
        if (!hit) return { label: '星海还没有可展开的星' };
        return { label: `「${hit.title}」· ${hit.links} 条航线` };
      }
      case 'cosmosLink': {
        if (reading) await closeBook();
        showPane('graph', { whisper: false });
        const res = await linkFocusedStarTo(a.target);
        if (!res.ok) return { label: res.reason === 'no-focus' ? '先点亮或飞到一颗星，再说「连到…」' : `没找到「${a.target}」` };
        return { label: `已连接「${res.from}」↔「${res.to}」` };
      }
      case 'cosmosZoom': {
        if (reading) await closeBook();
        showPane('graph', { whisper: false });
        zoomGraph(a.factor || 1.45);
        return { label: (a.factor || 1) > 1 ? '星海已拉近' : '星海已拉远' };
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
(function bindReaderCmdBar() {
  const bar = $('#reader-cmd-bar');
  if (!bar) return;
  let sx = 0, sy = 0, pid = null, fired = false, hold = null;
  const clear = () => { clearTimeout(hold); hold = null; };
  bar.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; pid = e.pointerId; fired = false;
    try { bar.setPointerCapture(e.pointerId); } catch {}
    clear();
    hold = setTimeout(() => {
      hold = null; fired = true;
      command.openBar({ listen: speechSupported() });
    }, 320);
  });
  bar.addEventListener('pointermove', e => {
    if (pid !== e.pointerId) return;
    if (sy - e.clientY > 18) {
      clear();
      if (!fired) { fired = true; command.openBar({ listen: false }); }
    } else if (Math.hypot(e.clientX - sx, e.clientY - sy) > 12) {
      clear();
    }
  });
  bar.addEventListener('pointerup', e => {
    if (pid !== e.pointerId) return;
    pid = null; clear();
  });
  bar.addEventListener('pointercancel', () => { pid = null; clear(); });
  bar.addEventListener('click', () => {
    if (fired) { fired = false; return; }
    command.openBar({ listen: false });
  });
})();
$('#btn-reader-voice')?.addEventListener('click', () => { setBars(false); command.openBar({ listen: speechSupported() }); });

/* ---------------- 零按钮 Z 轴空间入口（支持微信小程序静默微信登录） ---------------- */
const AUTH_KEY = 'zone-auth';
function getAuthUser() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
}
function syncAuthLabel() {
  const u = getAuthUser();
  const lbl = $('#intent-auth-label');
  if (lbl) lbl.textContent = u ? (u.provider === 'wechat' ? '微信空间' : u.mode === 'guest' ? '本机空间' : u.name) : '本机空间';
}
function openAuthGate() {
  const gate = $('#auth-gate');
  if (!gate) return;
  gate.classList.remove('entering', 'hidden');
}
function enterSpatialPortal(account = '', mode = 'guest', provider = 'local') {
  const gate = $('#auth-gate');
  const clean = String(account || '').trim();
  const user = mode === 'guest'
    ? { name: '本机空间', account: '', mode: 'guest', provider: provider || 'local', at: Date.now() }
    : { name: clean.includes('@') ? clean.split('@')[0] : clean, account: clean, mode: 'account', provider: provider || 'account', at: Date.now() };
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(user)); } catch {}
  syncAuthLabel();
  if (gate && !gate.classList.contains('hidden')) {
    gate.classList.add('entering');
    setTimeout(() => { gate.classList.add('hidden'); gate.classList.remove('entering'); }, 260);
  }
}
// 若从微信小程序内嵌打开并携带 wx_uid，实现真正的「零点击静默微信登录」
(() => {
  try {
    const sp = new URLSearchParams(location.search);
    const wxUid = sp.get('wx_uid');
    if (wxUid) enterSpatialPortal('微信读者', 'account', 'wechat');
  } catch {}
})();
$('#auth-gate')?.addEventListener('click', () => enterSpatialPortal('', 'guest', 'local'));
$('#auth-portal')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterSpatialPortal('', 'guest', 'local'); }
});
$('#btn-auth-account')?.addEventListener('click', () => openAuthGate());
syncAuthLabel();
if (!getAuthUser()) openAuthGate();
// 启动时静默恢复已导入的本地自定义字体与自定义界面样式
db.get('meta', 'custom-font').then(rec => { if (rec?.blob) applyCustomFontBlob(rec.blob, rec.name); }).catch(() => {});
(() => {
  try {
    const css = localStorage.getItem('zone-custom-css');
    if (css) {
      const tag = document.createElement('style');
      tag.id = 'zone-user-style';
      tag.textContent = css;
      document.head.appendChild(tag);
    }
  } catch {}
})();

window.__app = { db, openBook, closeBook, importFiles, importBlob, importArticleUrl, handleBack, get engine() { return engine; }, renderLibrary, stacks: { list: listStacks }, runCommand: text => command.run(text), openCommand: opts => command.openBar(opts), openPeek: openBookPeek, closePeek: closeBookPeek, openAuthGate, getAuthUser, getOpdsUrl, setOpdsUrl };
