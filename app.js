import * as pdfjsLib from './vendor/pdf.min.mjs';
import { db } from './db.js';
import { importArticleUrl, importBlob, importFiles, parseManifest, applyManifestToLibrary } from './importer.js';
import { findAndFetchBook, getOpdsUrl, setOpdsUrl } from './book-finder.js';
import { fetchLiveSignals, getSichaoApi, initSichao, setSichaoApi } from './sichao.js';
import { getPhoneUseStatus, openPhoneUseSettings, runPhoneUseTask } from './phone-use.js';
import { closeMicroApp, consumeLaunchDeepLink, craftMicroApp, isMicroAppOpen, listMicroApps, openMicroApp, pinToDesktop } from './agent-surface.js';
import { applyThemePlugin, closeBotStudio, getActiveBot, getActiveThemePlugin, getBotPlugins, getPrimaryBot, isPluginEnabled, isPluginMountedOnBot, listBots, listGroups, listPlugins, openBotStudio, renderBotSvg, renderGroupAvatarHtml, setActiveBot, syncToAndroidWidget, toggleBotPlugin } from './bots.js';
import { buildMemoryContextForBot, closeImportMemorySheet, importMemoryText, listMemories, openImportMemorySheet } from './memory.js';
import { BookletEngine, EpubEngine, PdfEngine, TxtEngine } from './engines.js';
import { aiConfigured, complete as aiComplete, fetchLiveBalance, getAiConfig, getAiUsage, getModelPricing, recordAiUsage, resetAiUsage, setAiBudget, setRechargeBalance } from './ai.js';
import { settings, saveSettings, applyBodyTheme, applyAppearance, appearancePref, cycleAppearance, applyCustomFontBlob, FONTS, THEMES } from './settings.js';
import { isMostlyCjk, translateVisible } from './bilingual.js';
import { backfillFromBooks, createNote, deleteBookBundle, listNotes, parseTags, syncBook } from './knowledge.js';
import { addToStack, createStack, defaultStackName, dissolveStack, getStack, listStacks, reconcileStacks, removeFromStacks, renameStack, setStackCollapsed } from './stacks.js';
import { createDecisionNote, dismissAssistant, exploreCosmos, exportOutline, fitGraph, focusGraphNeighborhood, focusStarByQuery, getGraphMood, getGraphTilt, initWorkspace, linkFocusedStarTo, openAiSettingsDialog, openAssistant, refreshWorkspace, searchGraph, setGraphMood, setGraphSearch, setGraphTilt, setKnowledgeFind, showPane, workspaceHandleBack, zoomGraph } from './workspace.js';
import { createCommandController, fuzzyScore, parseNaturalCommands, speechSupported } from './command.js';

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
    const pane = $('#pane-shelf');
    if (pane) pane.style.overflow = '';
    document.documentElement.style.touchAction = '';
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
    const pane = $('#pane-shelf');
    if (pane) pane.style.overflow = 'hidden';
    document.documentElement.style.touchAction = 'none';
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
  const readerOn = isPluginEnabled('reading-cosmos');
  document.documentElement.classList.toggle('plugin-reader-off', !readerOn);
  $('#zone-agent-hub')?.classList.toggle('compact', readerOn && books.length > 0);
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
    || (!document.documentElement.classList.contains('in-bot-reader') && !document.documentElement.classList.contains('legacy-reader-home'))
    || ['#ai-mask', '#note-mask', '#settings-mask', '#stack-mask', '#intent-mask', '#command-mask', '#peek-mask', '#lib-panel', '#note-editor', '#zone-chat-modal']
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
  closeBotPluginsSheet();
  closeBotReaderSheet();
  closeProfileSheet();
  closeImportMemorySheet();
  closeBotStudio();
  if (!$('#zone-chat-modal')?.classList.contains('hidden')) {
    if (!readerReturnBotId) readerReturnBotId = getActiveBot()?.id || '';
    $('#zone-chat-modal').classList.add('hidden');
    document.documentElement.classList.add('in-bot-reader');
  }
  if (engine && cur?.id === id) { showView('reader'); return; }
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
  closeBotPluginsSheet();
  closeBotReaderSheet();
  closeProfileSheet();
  closeImportMemorySheet();
  closeBotStudio();
  if (!$('#zone-chat-modal')?.classList.contains('hidden')) {
    if (!readerReturnBotId) readerReturnBotId = getActiveBot()?.id || '';
    $('#zone-chat-modal').classList.add('hidden');
    document.documentElement.classList.add('in-bot-reader');
  }
  showView('reader'); applyAppearance(); setBars(false); exitSelect(); $('#loading').classList.remove('hidden');
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

let readerReturnBotId = '';

function exitBotReaderWorkspace({ returnToBot = true } = {}) {
  if (!document.documentElement.classList.contains('in-bot-reader')) return false;
  if (document.body.classList.contains('selecting')) exitPick();
  document.documentElement.classList.remove('in-bot-reader');
  showPane('shelf', { instant: true });
  applyAppearance();
  const backBotId = readerReturnBotId;
  readerReturnBotId = '';
  if (returnToBot && backBotId) {
    const b = listBots().find(x => x.id === backBotId) || getActiveBot();
    if (b) openBotConversation(b);
  }
  return true;
}

function closeBotReaderSheet() {
  const mask = document.getElementById('zone-reader-sheet-mask');
  if (mask && !mask.classList.contains('hidden')) {
    mask.classList.add('hidden');
    return true;
  }
  return false;
}

async function openBotReaderSheet(bot = getActiveBot(), { initialPane = 'shelf', fromHome = false } = {}) {
  if (initialPane === 'shelf' && !isPluginEnabled('reading-cosmos')) {
    toast('请先在插件中开启「阅读器」');
    return;
  }
  const targetBot = fromHome ? null : (bot || getActiveBot());
  readerReturnBotId = targetBot?.id || '';
  const retBtn = $('#btn-intent-return-bot');
  if (retBtn) retBtn.textContent = targetBot ? `返回 ${targetBot.name}` : '返回 Zone';
  $('#zone-chat-modal')?.classList.add('hidden');
  document.documentElement.classList.add('in-bot-reader');
  showPane(initialPane || 'shelf', { instant: true });
  applyAppearance();
  await renderLibrary();
  if (initialPane === 'graph' || initialPane === 'knowledge') await refreshWorkspace();
}

$('#btn-intent-return-bot')?.addEventListener('click', () => {
  closeIntent(false);
  exitBotReaderWorkspace({ returnToBot: true });
});

function closeBotPluginsSheet() {
  const mask = document.getElementById('zone-bot-plugins-mask');
  if (!mask || mask.classList.contains('hidden')) return false;
  mask.classList.add('hidden');
  return true;
}

function openBotPluginsSheet(bot = getActiveBot()) {
  if (!bot) return;
  let mask = document.getElementById('zone-bot-plugins-mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'zone-bot-plugins-mask';
    mask.className = 'bots-mask hidden';
    document.body.appendChild(mask);
  }
  const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const draw = () => {
    const plugins = listPlugins();
    const mounted = getBotPlugins(bot.id);
    mask.innerHTML = `
      <div class="bots-sheet" role="dialog" aria-label="为 ${escHtml(bot.name)} 加载插件">
        <div class="bots-head">
          <div>
            <h3>为「${escHtml(bot.name)}」加载插件</h3>
            <p>仅在当前 Bot 对话中加载与展示，不影响其他 Bot 和主页</p>
          </div>
          <button type="button" class="bots-close" data-bp-act="close">完成</button>
        </div>
        <div class="bots-list">
          ${plugins.map(pl => {
            const on = pl.enabled && mounted.includes(pl.id);
            return `
              <div class="plugin-row" data-bp-row="${escHtml(pl.id)}">
                <div class="bot-meta">
                  <strong>${escHtml(pl.name)}${!pl.enabled ? '（全局已关）' : ''}</strong>
                  <span>${escHtml(pl.desc)}</span>
                </div>
                <label class="ios-switch" aria-label="在此 Bot 加载 ${escHtml(pl.name)}">
                  <input type="checkbox" data-bp-toggle="${escHtml(pl.id)}" ${on ? 'checked' : ''} ${!pl.enabled ? 'disabled' : ''}>
                  <span></span>
                </label>
              </div>`;
          }).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button type="button" class="bots-secondary" data-bp-act="cosmos">星海 · 第二大脑</button>
          <button type="button" class="bots-secondary" data-bp-act="memory">导入记忆（${listMemories().length}）</button>
          <button type="button" class="bots-secondary" data-bp-act="manage">插件中心与远程 MCP ›</button>
        </div>
      </div>`;
    mask.onclick = e => { if (e.target === mask) closeBotPluginsSheet(); };
    mask.querySelector('[data-bp-act="close"]').onclick = () => closeBotPluginsSheet();
    mask.querySelector('[data-bp-act="cosmos"]').onclick = () => {
      closeBotPluginsSheet();
      openBotReaderSheet(bot, { initialPane: 'graph' });
    };
    mask.querySelector('[data-bp-act="memory"]').onclick = () => {
      closeBotPluginsSheet();
      openZoneMemorySheet(bot.id);
    };
    mask.querySelector('[data-bp-act="manage"]').onclick = () => {
      closeBotPluginsSheet();
      openBotsFromHub({ initialTab: 'plugins' });
    };
    mask.querySelectorAll('[data-bp-toggle]').forEach(chk => {
      chk.onchange = () => {
        const pid = chk.dataset.bpToggle;
        const nowOn = toggleBotPlugin(bot.id, pid, chk.checked);
        const pl = listPlugins().find(p => p.id === pid);
        renderBotMountedBar(bot);
        toast(nowOn
          ? `已在「${bot.name}」对话中加载「${pl?.short || pl?.name || pid}」`
          : `已从「${bot.name}」对话卸载「${pl?.short || pl?.name || pid}」`, 2400);
        draw();
      };
    });
    mask.querySelectorAll('[data-bp-row]').forEach(row => {
      row.onclick = e => {
        if (e.target.closest('.ios-switch')) return;
        const pid = row.dataset.bpRow;
        const pl = listPlugins().find(p => p.id === pid);
        if (!pl?.enabled) {
          closeBotPluginsSheet();
          openBotsFromHub({ initialTab: 'plugins' });
          return;
        }
        if (!getBotPlugins(bot.id).includes(pid)) {
          toggleBotPlugin(bot.id, pid, true);
          renderBotMountedBar(bot);
        }
        closeBotPluginsSheet();
        if (pl.launchable) launchPluginById(pid, bot);
        else toast(`已在「${bot.name}」对话中启用「${pl.short || pl.name}」`, 2200);
      };
    });
  };
  draw();
  mask.classList.remove('hidden');
}

function handleBack() {
  if (command?.closeBar(true)) return true;
  if (closeImportMemorySheet()) return true;
  if (closeBotPluginsSheet()) return true;
  if (closeBotReaderSheet()) return true;
  if (closeProfileSheet()) return true;
  if (closeBotStudio()) return true;
  if (closeMicroApp()) return true;
  if (closeBotChat()) return true;
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
  if (exitBotReaderWorkspace({ returnToBot: true })) return true;
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
      case 'exportVault': {
        const { listNotes, listLinks } = await import('./knowledge.js');
        const notes = await listNotes();
        const links = await listLinks();
        if (!notes.length) return { label: '还没有可导出的笔记' };
        const byId = new Map(notes.map(n => [n.id, n]));
        const zip = new window.JSZip();
        for (const n of notes) {
          const safe = (n.title || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
          const relTitles = links
            .filter(l => l.fromId === n.id || l.toId === n.id)
            .map(l => byId.get(l.fromId === n.id ? l.toId : l.fromId)?.title)
            .filter(Boolean);
          const fm = `---\ntitle: "${(n.title || '未命名').replace(/"/g, '\\"')}"\ntags: [${(n.tags || []).map(t => `"${t}"`).join(', ')}]\nsource: "${(n.bookTitle || '').replace(/"/g, '\\"')}"\n---\n\n`;
          const quote = n.quote ? `> ${n.quote.replace(/\n/g, '\n> ')}\n\n` : '';
          const relSec = relTitles.length ? `\n\n## 关联\n${relTitles.map(t => `- [[${t}]]`).join('\n')}\n` : '';
          zip.file(`${safe}.md`, fm + quote + (n.body || '') + relSec);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const aEl = document.createElement('a');
        aEl.href = URL.createObjectURL(blob);
        aEl.download = `Zone-Obsidian-Notion-${new Date().toISOString().slice(0, 10)}.zip`;
        aEl.click();
        setTimeout(() => URL.revokeObjectURL(aEl.href), 4000);
        return { label: `已导出 ${notes.length} 条 Markdown 笔记包（兼容 Obsidian / Notion）` };
      }
      case 'exportWord': {
        const { listNotes } = await import('./knowledge.js');
        const notes = await listNotes();
        if (!notes.length) return { label: '还没有可导出的笔记' };
        const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const bodyHtml = notes.map(n => `<h2>${esc(n.title || '未命名')}</h2>${n.bookTitle ? `<p><em>出处：《${esc(n.bookTitle)}》</em></p>` : ''}${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ''}<p>${esc(n.body || '').replace(/\n/g, '<br>')}</p>`).join('<hr>');
        const docHtml = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Zone 笔记导出</title><style>body{font-family:"Microsoft YaHei",serif;line-height:1.7}blockquote{border-left:3px solid #666;padding-left:10px;color:#555}</style></head><body><h1>Zone 知识笔记汇总</h1>${bodyHtml}</body></html>`;
        const blob = new Blob(['\uFEFF' + docHtml], { type: 'application/msword;charset=utf-8' });
        const aEl = document.createElement('a');
        aEl.href = URL.createObjectURL(blob);
        aEl.download = `Zone-WPS-Word-${new Date().toISOString().slice(0, 10)}.doc`;
        aEl.click();
        setTimeout(() => URL.revokeObjectURL(aEl.href), 4000);
        return { label: `已导出 ${notes.length} 条笔记为 Word / WPS 文档` };
      }
      case 'openSichao': {
        if (reading) await closeBook();
        sichao.open();
        return { label: '已打开「思潮」独立判断空间' };
      }
      case 'askAi': {
        const pageTxt = reading ? (engine?.pageText?.() || '').trim().slice(0, 1200) : '';
        const q = a.question || '总结这一段';
        if (!reading) {
          await chatWithActiveBot(q);
          return { label: `${getActiveBot().name} 已回复` };
        }
        openAssistant({
          title: q.slice(0, 18),
          quote: pageTxt || q,
          context: reading && cur ? `来自《${cur.title}》${lastState?.label ? ' · ' + lastState.label : ''}` : `${getActiveBot().name} · 语音直连`,
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
      case 'pinShortcut': {
        const target = String(a.target || '').trim();
        let spec = null;
        if (/思潮/.test(target)) {
          spec = { id: 'zone-sichao', label: '今日思潮', uri: 'zone://open/sichao', glyph: '思' };
        } else if (/星海/.test(target)) {
          spec = { id: 'zone-graph', label: 'Zone 星海', uri: 'zone://open/graph', glyph: '星' };
        } else if (/知识|笔记/.test(target)) {
          spec = { id: 'zone-knowledge', label: 'Zone 知识', uri: 'zone://open/knowledge', glyph: '知' };
        } else if (reading && cur?.id) {
          spec = { id: `book-${cur.id}`, label: cur.title || '阅读', uri: `zone://open/book/${cur.id}`, glyph: (cur.title || '读').slice(0, 1) };
        } else if (target) {
          const books = await db.all('books');
          const hit = books.find(b => (b.title || '').includes(target));
          if (hit) spec = { id: `book-${hit.id}`, label: hit.title, uri: `zone://open/book/${hit.id}`, glyph: hit.title.slice(0, 1) };
        }
        if (!spec) {
          const pane = currentPane();
          if (pane === 'graph') spec = { id: 'zone-graph', label: 'Zone 星海', uri: 'zone://open/graph', glyph: '星' };
          else if (pane === 'knowledge') spec = { id: 'zone-knowledge', label: 'Zone 知识', uri: 'zone://open/knowledge', glyph: '知' };
          else spec = { id: 'zone-sichao', label: '今日思潮', uri: 'zone://open/sichao', glyph: '思' };
        }
        const res = await pinToDesktop(spec);
        toast(res.message, 3200);
        return { label: res.message };
      }
      case 'setComputerBridge': {
        const clean = String(a.url || '').trim().replace(/\/+$/, '');
        try { if (clean) localStorage.setItem('zone-cu-bridge', clean); else localStorage.removeItem('zone-cu-bridge'); } catch {}
        return { label: clean ? `已绑定本地电脑桥接：${clean}` : '已断开本地电脑桥接' };
      }
      case 'computerUse': {
        if (!isPluginEnabled('computer-use')) return { label: '「Computer-Use」插件已关闭，打开开关即可使用' };
        const bridge = (() => { try { return localStorage.getItem('zone-cu-bridge') || ''; } catch { return ''; } })();
        if (!bridge) {
          toast('请先说「连接电脑 http://你的电脑地址:端口」绑定本地桌面桥接节点', 3600);
          return { label: '尚未绑定本地电脑桥接' };
        }
        const goal = String(a.goal || '').trim();
        const curBot = getActiveBot();
        const ok = await requestChatConfirm({
          botId: curBot.id,
          icon: 'computer',
          provider: '本机电脑 · Computer-Use',
          title: '确认在本地电脑执行任务',
          meta: bridge,
          badge: '待确认',
          detail: goal || '执行本地桌面任务',
          rejectLabel: '取消',
          approveLabel: '确认执行'
        });
        if (!ok) return { label: '已取消本地电脑执行' };
        showAgentLiveCard({ title: 'Computer-Use · 远程执行中', body: `正在向本地电脑 (${bridge}) 下发任务：${goal}` });
        try {
          const aiCfg = getAiConfig();
          const hdrs = { 'Content-Type': 'application/json' };
          if (aiCfg?.apiKey) {
            hdrs['X-User-Api-Key'] = aiCfg.apiKey;
            hdrs['X-User-Base-Url'] = aiCfg.baseUrl || '';
            hdrs['X-User-Model'] = aiCfg.model || '';
          }
          const r = await fetch(`${bridge}/api/computer-use/run`, {
            method: 'POST',
            headers: hdrs,
            body: JSON.stringify({ goal, bot: curBot.name, rules: curBot.rules || '' })
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data?.detail || `HTTP ${r.status}`);
          const msg = String(data?.summary || data?.result || '已下发至本地电脑执行');
          postChatCard(curBot.id, {
            kind: 'result',
            icon: 'computer',
            provider: '本机电脑 · Computer-Use',
            status: 'Done',
            statusTone: 'ok',
            title: goal || '本地电脑任务完成',
            meta: bridge,
            badge: '已完成',
            detail: msg.slice(0, 220),
            url: data?.url || '',
            secondaryLabel: data?.url ? '复制链接' : '',
            primaryLabel: data?.url ? '打开链接' : ''
          });
          return { label: '本地电脑已响应' };
        } catch (err) {
          postChatCard(curBot.id, {
            kind: 'result',
            icon: 'computer',
            provider: '本机电脑 · Computer-Use',
            status: '连接失败',
            title: `无法连接 ${bridge}`,
            meta: bridge,
            detail: err?.message || '请确认电脑端桥接服务已启动'
          });
          return { label: '本地电脑未连通' };
        }
      }
      case 'openBotStudio': {
        openBotStudio({
          onSelect: bot => openBotConversation(bot),
          onStatus: msg => { renderAgentHub(); toast(msg, 2600); },
          onLaunchPlugin: launchPluginById,
          onRunAutomation: runAutomationItem,
          initialTab: a.tab || 'bots'
        });
        return { label: a.tab === 'plugins' ? '插件与主题' : a.tab === 'automations' ? '定时任务' : 'Zone Bot' };
      }
      case 'craftApp': {
        const res = await craftMicroApp(a.prompt || '', {
          onStatus: msg => toast(msg, 3200),
          onNeedAi: () => openAiSettingsDialog()
        });
        renderAgentHub();
        if (res.ok && res.app) {
          postChatCard(getActiveBot().id, {
            kind: 'result',
            icon: 'app',
            provider: 'Zone 微应用',
            status: 'Done',
            statusTone: 'ok',
            title: res.app.title,
            meta: `zone://open/microapp/${res.app.id}`,
            badge: '已就绪',
            detail: `已生成独立微应用「${res.app.title}」，随时可全屏运行或钉到桌面。`,
            appId: res.app.id,
            pinSpec: { id: `microapp-${res.app.id}`, label: res.app.title, uri: `zone://open/microapp/${res.app.id}`, glyph: res.app.title.slice(0, 1) },
            secondaryLabel: '放到桌面',
            primaryLabel: '立即打开'
          });
        }
        return { label: res.message };
      }
      case 'phoneUseSetup': {
        const st = await getPhoneUseStatus();
        if (!st.available) return { label: '手机控屏需在 Android 版 Zone 中开启' };
        if (st.enabled) return { label: 'Zone 手机控屏无障碍服务已开启，直接说出任务即可' };
        const go = await requestChatConfirm({
          botId: getActiveBot().id,
          icon: 'phone',
          provider: '手机控屏 · Phone-Use',
          title: '开启 Android 无障碍控屏权限',
          meta: '系统无障碍服务',
          badge: '需授权',
          detail: '开启后可用你自己的 AI 语音跨 App 办事，并支持悬浮球随时急停。',
          rejectLabel: '暂不开启',
          approveLabel: '去开启'
        });
        if (go) await openPhoneUseSettings();
        return { label: go ? '已打开系统无障碍设置' : '已取消' };
      }
      case 'phoneUse': {
        if (!isPluginEnabled('phone-use')) return { label: '「Phone-Use」插件已关闭，打开开关即可使用' };
        const goal = String(a.goal || '').trim();
        if (!goal) return { label: '请说出要帮你在手机上执行的任务' };
        toast(`控屏启动：${goal.slice(0, 18)}…`);
        const curBot = getActiveBot();
        const res = await runPhoneUseTask(goal, {
          onStatus: msg => toast(msg, 3400),
          onConfirm: msg => requestChatConfirm({
            botId: curBot.id,
            icon: 'shield',
            provider: '手机控屏 · 安全确认',
            title: '请确认敏感手机操作',
            meta: goal.slice(0, 32),
            badge: '敏感拦截',
            detail: msg,
            rejectLabel: '取消操作',
            approveLabel: '允许继续'
          }),
          onNeedAi: () => openAiSettingsDialog(),
          onNoteSaved: () => refreshWorkspace()
        });
        return { label: res.summary || (res.ok ? '控屏完成' : '控屏已暂停') };
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

async function openDeepLink(uri) {
  const s = String(uri || '').trim();
  if (!s.startsWith('zone://')) return false;
  enterSpatialPortal('', 'guest', 'local');
  const mBook = s.match(/^zone:\/\/open\/book\/(.+)$/);
  if (mBook) { await openBook(decodeURIComponent(mBook[1])); return true; }
  const mApp = s.match(/^zone:\/\/open\/microapp\/(.+)$/);
  if (mApp) { return openMicroApp(decodeURIComponent(mApp[1])); }
  if (s.startsWith('zone://open/voice')) {
    try {
      const u = new URL(s);
      const botId = u.searchParams.get('bot');
      if (botId) setActiveBot(botId);
    } catch {}
    command.openBar({ listen: true });
    return true;
  }
  const mBot = s.match(/^zone:\/\/open\/bot\/(.+)$/);
  if (mBot) {
    const b = setActiveBot(decodeURIComponent(mBot[1]));
    if (b.id === 'bot-sichao') { openSichaoSheet(); return true; }
    toast(`当前 Bot：${b.name}`);
    command.openBar({ listen: false });
    return true;
  }
  if (s === 'zone://open/sichao') { openSichaoSheet(); return true; }
  if (s === 'zone://open/graph') { if (reading) await closeBook(); showPane('graph', { whisper: false }); return true; }
  if (s === 'zone://open/knowledge') { if (reading) await closeBook(); showPane('knowledge', { whisper: false }); return true; }
  return false;
}
/* ---------------- Zone 2.0 苹果风 Agent 主画布 + 独立上下文多任务线程 ---------------- */
const THREADS_KEY = 'zone-task-threads-v1';
let taskThreads = (() => {
  try { const x = JSON.parse(localStorage.getItem(THREADS_KEY) || '[]'); return Array.isArray(x) ? x : []; } catch { return []; }
})();
let activeThreadId = null;
let activeGroupId = null;
let newlyBornBotId = '';

function saveTaskThreads() {
  try { localStorage.setItem(THREADS_KEY, JSON.stringify(taskThreads.slice(0, 30))); } catch {}
}

function ensureActiveTaskThread(seedTitle, botId) {
  let t = taskThreads.find(x => x.id === activeThreadId);
  if (!t) {
    t = {
      id: `th-${Date.now().toString(36)}`,
      title: String(seedTitle || '新任务').trim().slice(0, 14),
      botId: botId || getActiveBot().id,
      messages: [],
      updatedAt: Date.now()
    };
    taskThreads.unshift(t);
    activeThreadId = t.id;
    saveTaskThreads();
  }
  return t;
}

function closeBotChat() {
  const modal = $('#zone-chat-modal');
  if (!modal || modal.classList.contains('hidden')) return false;
  modal.classList.add('hidden');
  modal.classList.remove('typing', 'thinking');
  activeGroupId = null;
  renderAgentHub();
  return true;
}

function renderChatThreadsBar() {}

function insertNewTopicDivider() {
  const thread = activeGroupId
    ? taskThreads.find(t => t.groupId === activeGroupId)
    : taskThreads.find(t => t.botId === getActiveBot().id && !t.groupId);
  if (!thread || !thread.messages.filter(m => !m.internal).length) { toast('当前已是全新话题'); return; }
  const visible = thread.messages.filter(m => !m.internal);
  const last = visible[visible.length - 1];
  if (last?.role === 'divider') { toast('已经开启新话题，直接发消息即可'); return; }
  thread.messages.push({ role: 'divider', content: '新话题 · 以上不带入上下文', at: Date.now() });
  thread.updatedAt = Date.now();
  saveTaskThreads();
  renderChatBox(thread);
  $('#zone-chat-input')?.focus();
}

const pendingCardResolvers = new Map();

function cardIconSvg(icon) {
  if (icon === 'computer') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
  if (icon === 'phone') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';
  if (icon === 'shield') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M9.5 12l1.8 1.8 3.4-3.6"/></svg>';
  if (icon === 'app') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>';
  if (icon === 'link') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14l4-4M7.5 16.5a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 5M16.5 7.5a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5-5"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 18h9.8a4.2 4.2 0 0 0 .8-8.3A5.5 5.5 0 0 0 7.4 8.5 4.4 4.4 0 0 0 7.5 18z"/></svg>';
}

function getOrCreateBotThread(botId) {
  const bot = listBots().find(b => b.id === botId) || getActiveBot();
  let thread = taskThreads.find(t => t.botId === bot.id);
  if (!thread) {
    thread = { id: `th-${bot.id}`, title: bot.name, botId: bot.id, messages: [], updatedAt: Date.now() };
    taskThreads.unshift(thread);
  }
  return { bot, thread };
}

function postChatCard(botId, spec = {}) {
  const { bot, thread } = getOrCreateBotThread(botId || getActiveBot().id);
  const card = {
    id: spec.id || `card-${uid()}`,
    kind: spec.kind || 'result',
    icon: spec.icon || 'cloud',
    provider: spec.provider || '云端 Agent',
    status: spec.status || 'Done',
    statusTone: spec.statusTone || '',
    title: spec.title || '任务更新',
    meta: spec.meta || '',
    badge: spec.badge || '',
    detail: spec.detail || '',
    url: spec.url || '',
    appId: spec.appId || '',
    pinSpec: spec.pinSpec || null,
    actionCmd: spec.actionCmd || '',
    secondaryLabel: spec.secondaryLabel ?? '',
    primaryLabel: spec.primaryLabel ?? '',
    resolved: spec.resolved || ''
  };
  thread.messages.push({ role: 'card', card, at: Date.now() });
  thread.updatedAt = Date.now();
  activeThreadId = thread.id;
  saveTaskThreads();
  setActiveBot(bot.id);
  renderChatBox(thread);
  renderBotRoster();
  return card;
}

function requestChatConfirm(spec = {}) {
  const botId = spec.botId || getActiveBot().id;
  const card = postChatCard(botId, {
    kind: 'confirm',
    icon: spec.icon || 'shield',
    provider: spec.provider || '任务确认',
    status: '待确认',
    statusTone: 'warn',
    title: spec.title || '请确认是否继续执行',
    meta: spec.meta || '',
    badge: spec.badge || '',
    detail: spec.detail || '',
    url: spec.url || '',
    actionCmd: spec.actionCmd || '',
    secondaryLabel: spec.rejectLabel || '取消',
    primaryLabel: spec.approveLabel || '确认执行',
    resolved: ''
  });
  return new Promise(resolve => {
    pendingCardResolvers.set(card.id, resolve);
  });
}

function renderBubbleRichText(container, text) {
  const str = String(text || '');
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) container.appendChild(document.createTextNode(str.slice(last, m.index)));
    if (m[1] && m[2]) {
      const a = document.createElement('a');
      a.className = 'chat-link';
      a.href = m[2];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = m[1];
      container.appendChild(a);
    } else if (m[3]) {
      const a = document.createElement('a');
      a.className = 'chat-link';
      a.href = m[3];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = m[3];
      container.appendChild(a);
    } else if (m[4]) {
      const strong = document.createElement('strong');
      strong.textContent = m[4];
      container.appendChild(strong);
    } else if (m[5]) {
      const code = document.createElement('code');
      code.textContent = m[5];
      container.appendChild(code);
    }
    last = re.lastIndex;
  }
  if (last < str.length) container.appendChild(document.createTextNode(str.slice(last)));
}

function parseBotCardDirectives(raw) {
  let clean = String(raw || '');
  const cards = [];
  clean = clean.replace(/\[\[CONFIRM:([^\]]+)\]\]/g, (_, body) => {
    const [title = '', meta = '', detail = '', action = ''] = body.split('|').map(s => s.trim());
    const isUrl = /^https?:\/\//i.test(action);
    cards.push({
      kind: 'confirm',
      icon: 'shield',
      provider: '任务确认',
      status: '待确认',
      statusTone: 'warn',
      title: title || '请确认执行此任务',
      meta: meta || (isUrl ? action : ''),
      badge: '待你确认',
      detail,
      url: isUrl ? action : '',
      actionCmd: isUrl ? '' : action,
      secondaryLabel: '取消',
      primaryLabel: '确认执行',
      resolved: ''
    });
    return '';
  });
  clean = clean.replace(/\[\[CARD:([^\]]+)\]\]/g, (_, body) => {
    const [provider = '云端 Agent', title = '', meta = '', detail = '', url = ''] = body.split('|').map(s => s.trim());
    cards.push({
      kind: 'result',
      icon: url ? 'link' : 'cloud',
      provider: provider || '云端 Agent',
      status: 'Done',
      statusTone: 'ok',
      title: title || '任务结果卡片',
      meta,
      detail,
      url: /^https?:\/\//i.test(url) ? url : '',
      secondaryLabel: /^https?:\/\//i.test(url) ? '复制链接' : '',
      primaryLabel: /^https?:\/\//i.test(url) ? '打开链接' : ''
    });
    return '';
  });
  return { text: clean.replace(/\n{3,}/g, '\n\n').trim(), cards };
}

function renderBotMountedBar(bot) {
  const bar = $('#zone-chat-plugins-bar');
  if (!bar || !bot) return;
  const mountedIds = getBotPlugins(bot.id);
  const allPlugs = listPlugins();
  const visiblePlugs = mountedIds
    .map(id => allPlugs.find(p => p.id === id))
    .filter(p => p && p.enabled && (p.launchable || p.id.startsWith('ext-')));
  bar.replaceChildren();
  if (!visiblePlugs.length) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  for (const pl of visiblePlugs) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bot-mounted-chip';
    if (pl.id === 'reading-cosmos') chip.id = 'btn-chat-reader';
    chip.dataset.mountedPlug = pl.id;
    const dot = document.createElement('span');
    dot.className = 'bot-mounted-dot';
    chip.append(dot, document.createTextNode(pl.short || pl.name));
    chip.onclick = () => {
      if (pl.launchable) launchPluginById(pl.id, bot);
      else toast(`已在此对话挂载外部插件「${pl.name}」${pl.url ? ` (${pl.url})` : ''}`, 2600);
    };
    bar.appendChild(chip);
  }
  const addChip = document.createElement('button');
  addChip.type = 'button';
  addChip.className = 'bot-mounted-chip add-more';
  addChip.textContent = '+ 插件';
  addChip.onclick = () => openBotPluginsSheet(bot);
  bar.appendChild(addChip);
}

function renderChatCardElement(card, thread) {
  const wrap = document.createElement('div');
  wrap.className = 'chat-card-wrap';
  const el = document.createElement('div');
  el.className = 'chat-card';
  el.dataset.cardId = card.id || '';

  const head = document.createElement('div');
  head.className = 'chat-card-head';
  const ico = document.createElement('span');
  ico.className = 'chat-card-ico';
  ico.innerHTML = cardIconSvg(card.icon);
  const prov = document.createElement('span');
  prov.className = 'chat-card-prov';
  prov.textContent = card.provider || '云端 Agent';
  const st = document.createElement('span');
  st.className = 'chat-card-status' + (card.statusTone ? ` ${card.statusTone}` : '');
  st.textContent = card.status || 'Done';
  head.append(ico, prov, st);
  el.appendChild(head);

  if (card.title) {
    const title = document.createElement('div');
    title.className = 'chat-card-title';
    title.textContent = card.title;
    el.appendChild(title);
  }

  if (card.meta || card.badge) {
    const meta = document.createElement('div');
    meta.className = 'chat-card-meta';
    const mt = document.createElement('span');
    mt.className = 'chat-card-meta-txt';
    mt.textContent = card.meta || '';
    meta.appendChild(mt);
    if (card.badge) {
      const bd = document.createElement('span');
      bd.className = 'chat-card-badge';
      bd.textContent = card.badge;
      meta.appendChild(bd);
    }
    el.appendChild(meta);
  }

  if (card.detail) {
    const det = document.createElement('p');
    det.className = 'chat-card-detail';
    det.textContent = card.detail;
    el.appendChild(det);
  }

  const hasActs = card.kind === 'confirm' || card.secondaryLabel || card.primaryLabel || card.url || card.appId;
  if (hasActs) {
    const acts = document.createElement('div');
    acts.className = 'chat-card-acts';
    if (card.kind === 'confirm') {
      const done = !!card.resolved;
      const bNo = document.createElement('button');
      bNo.type = 'button';
      bNo.className = 'chat-card-btn';
      bNo.dataset.cardAct = 'reject';
      bNo.textContent = card.resolved === 'rejected' ? '已取消' : (card.secondaryLabel || '取消');
      bNo.disabled = done;
      bNo.onclick = () => {
        card.resolved = 'rejected';
        card.status = '已取消';
        card.badge = '已终止';
        card.statusTone = '';
        saveTaskThreads();
        renderChatBox(thread);
        const fn = pendingCardResolvers.get(card.id);
        if (fn) { pendingCardResolvers.delete(card.id); fn(false); }
        else toast('已取消该操作');
      };

      const bYes = document.createElement('button');
      bYes.type = 'button';
      bYes.className = 'chat-card-btn primary';
      bYes.dataset.cardAct = 'approve';
      bYes.textContent = card.resolved === 'approved' ? '已确认 ✓' : (card.primaryLabel || '确认执行');
      bYes.disabled = done;
      bYes.onclick = async () => {
        card.resolved = 'approved';
        card.status = '已确认';
        card.badge = '已授权';
        card.statusTone = 'ok';
        saveTaskThreads();
        renderChatBox(thread);
        const fn = pendingCardResolvers.get(card.id);
        if (fn) {
          pendingCardResolvers.delete(card.id);
          fn(true);
          return;
        }
        if (card.url) {
          window.open(card.url, '_blank', 'noopener');
          toast('已确认并打开任务链接');
        } else if (card.actionCmd) {
          const ops = parseNaturalCommands(card.actionCmd, { reading: false, pane: currentPane() });
          if (ops.length && ops[0].op !== 'askAi') await command.run(card.actionCmd);
          else await chatWithActiveBot(`已确认执行「${card.title}」：${card.actionCmd}`);
        } else {
          await chatWithActiveBot(`我已确认执行「${card.title}」，请继续完成并汇报结果。`);
        }
      };
      acts.append(bNo, bYes);
    } else {
      if (card.secondaryLabel) {
        const bSec = document.createElement('button');
        bSec.type = 'button';
        bSec.className = 'chat-card-btn';
        bSec.textContent = card.secondaryLabel;
        bSec.onclick = async () => {
          if (card.pinSpec) {
            const r = await pinToDesktop(card.pinSpec);
            toast(r.message, 2600);
          } else if (card.url) {
            await copyText(card.url);
            toast('已复制链接');
          }
        };
        acts.appendChild(bSec);
      }
      if (card.primaryLabel || card.url || card.appId) {
        const bPri = document.createElement('button');
        bPri.type = 'button';
        bPri.className = 'chat-card-btn primary';
        bPri.textContent = card.primaryLabel || (card.appId ? '立即打开' : '打开链接');
        bPri.onclick = () => {
          if (card.appId) openMicroApp(card.appId);
          else if (card.url) window.open(card.url, '_blank', 'noopener');
        };
        acts.appendChild(bPri);
      }
    }
    el.appendChild(acts);
  }
  wrap.appendChild(el);
  return wrap;
}

function renderGroupMentionBar(group) {
  const bar = $('#zone-chat-plugins-bar');
  if (!bar || !group) return;
  const bots = listBots();
  const members = (group.memberIds || []).map(id => bots.find(b => b.id === id)).filter(Boolean);
  bar.replaceChildren();
  bar.classList.remove('hidden');
  const addMention = label => {
    const inp = $('#zone-chat-input');
    if (!inp) return;
    inp.value = `${inp.value ? inp.value.trimEnd() + ' ' : ''}@${label} `;
    inp.focus();
  };
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'group-mention-chip';
  allBtn.textContent = '@所有人';
  allBtn.onclick = () => addMention('所有人');
  bar.appendChild(allBtn);
  for (const b of members) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'group-mention-chip';
    chip.textContent = `@${b.name}`;
    chip.onclick = () => addMention(b.name);
    bar.appendChild(chip);
  }
}

function renderChatBox(thread, pendingText = '') {
  const modal = $('#zone-chat-modal');
  const listEl = $('#zone-chat-messages');
  if (!modal || !listEl) return;
  const bots = listBots();
  const isGroup = !!thread?.groupId;
  const group = isGroup ? listGroups().find(g => g.id === thread.groupId) : null;
  const bot = !isGroup ? (bots.find(b => b.id === (thread?.botId || getActiveBot().id)) || getActiveBot()) : getActiveBot();
  const avEl = $('#chat-head-av');
  const nameEl = $('#chat-head-name');
  const inp = $('#zone-chat-input');

  if (isGroup && group) {
    const members = (group.memberIds || []).map(id => bots.find(b => b.id === id)).filter(Boolean);
    if (avEl) avEl.innerHTML = renderGroupAvatarHtml(group.memberIds);
    if (nameEl) nameEl.textContent = `${group.name} (${members.length})`;
    if (inp) inp.placeholder = `在「${group.name}」发消息，可 @ 指定 Bot…`;
    renderGroupMentionBar(group);
  } else {
    if (avEl) avEl.innerHTML = renderBotSvg(bot.shape, bot.accent);
    if (nameEl) nameEl.textContent = bot.name;
    if (inp) inp.placeholder = `给 ${bot.name} 发消息，或直接说话…`;
    renderBotMountedBar(bot);
  }

  listEl.replaceChildren();
  const visibleMsgs = (thread?.messages || []).filter(m => !m.internal);
  const allMsgs = pendingText ? [...visibleMsgs, { role: 'assistant', content: pendingText, pending: true, botId: isGroup ? (group?.memberIds?.[0] || bot.id) : bot.id }] : visibleMsgs;
  if (!allMsgs.length) {
    const empty = document.createElement('div');
    empty.className = 'bot-chat-empty';
    const av = document.createElement('div');
    av.className = 'bot-chat-empty-av' + (!isGroup && newlyBornBotId === bot.id ? ' bot-born' : '');
    av.innerHTML = (isGroup && group) ? renderGroupAvatarHtml(group.memberIds) : renderBotSvg(bot.shape, bot.accent, bot.id);
    if (!isGroup && newlyBornBotId === bot.id) newlyBornBotId = '';
    const h4 = document.createElement('h4');
    h4.textContent = (isGroup && group) ? group.name : bot.name;
    const p = document.createElement('p');
    p.textContent = (isGroup && group)
      ? `群聊成员：${(group.memberIds || []).map(id => bots.find(b => b.id === id)?.name).filter(Boolean).join('、')}。直接发消息或 @ 某位 Bot 分工协作。`
      : (bot.rules ? bot.rules : `直接发消息或说话；点左下角 + 可为 ${bot.name} 加载阅读器、电脑或控屏等专属插件。`);
    empty.append(av, h4, p);
    listEl.appendChild(empty);
  } else {
    let lastTs = 0;
    for (const m of allMsgs) {
      if (m.at && m.role !== 'divider' && m.role !== 'handoff' && (!lastTs || m.at - lastTs > 900000)) {
        const tsEl = document.createElement('div');
        tsEl.className = 'chat-ts';
        tsEl.textContent = formatShortTime(m.at);
        listEl.appendChild(tsEl);
        lastTs = m.at;
      }
      if (m.role === 'divider') {
        const div = document.createElement('div');
        div.className = 'chat-divider';
        div.textContent = m.content || '新话题 · 以上不带入上下文';
        listEl.appendChild(div);
        continue;
      }
      if (m.role === 'handoff') {
        const hp = document.createElement('div');
        hp.className = 'chat-handoff-pill';
        hp.textContent = `➤ 已后台联系 ${m.targetName || '其他 Bot'}${m.summary ? `：${m.summary.slice(0, 26)}` : ''}`;
        listEl.appendChild(hp);
        continue;
      }
      if (m.role === 'card' && m.card) {
        listEl.appendChild(renderChatCardElement(m.card, thread));
        continue;
      }
      const row = document.createElement('div');
      row.className = 'chat-row ' + (m.role === 'user' ? 'user' : 'bot');
      const senderBot = m.role !== 'user' ? (bots.find(b => b.id === m.botId) || bot) : null;
      if (m.role !== 'user') {
        const av = document.createElement('div');
        av.className = 'chat-mini-av';
        av.innerHTML = renderBotSvg(senderBot.shape, senderBot.accent);
        row.appendChild(av);
      }
      const bub = document.createElement('div');
      bub.className = 'chat-bubble';
      const raw = String(m.content || '');
      const thinkM = raw.match(/^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/);
      if (thinkM) {
        const det = document.createElement('details');
        det.className = 'chat-think';
        const sum = document.createElement('summary');
        sum.textContent = '思考过程 ▾';
        const tp = document.createElement('p');
        tp.textContent = thinkM[1].trim();
        det.append(sum, tp);
        bub.appendChild(det);
        renderBubbleRichText(bub, thinkM[2].trim());
      } else {
        renderBubbleRichText(bub, raw);
      }
      if (m.needKey) {
        const cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'chat-cta';
        cta.textContent = '配置我的 API Key';
        cta.onclick = () => openAiSettingsDialog();
        bub.appendChild(document.createElement('br'));
        bub.appendChild(cta);
      } else if (m.role === 'assistant' && !m.pending && raw.length >= 6) {
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'chat-mem-btn' + (m.inCosmos ? ' saved' : '');
        saveBtn.textContent = m.inCosmos ? '已存星海 ✓' : '存入星海';
        saveBtn.onclick = async () => {
          if (m.inCosmos) { openBotReaderSheet(senderBot || bot, { initialPane: 'graph' }); return; }
          const cleanTxt = raw.replace(/^<think>[\s\S]*?<\/think>\s*/, '').trim();
          await saveBotInsightToCosmos(senderBot || bot, cleanTxt);
          m.inCosmos = true;
          saveTaskThreads();
          renderChatBox(thread);
        };
        bub.appendChild(document.createElement('br'));
        bub.appendChild(saveBtn);
      }
      if (isGroup && m.role !== 'user') {
        const col = document.createElement('div');
        col.className = 'chat-bot-col';
        const sName = document.createElement('span');
        sName.className = 'chat-sender-name';
        sName.textContent = m.botName || senderBot.name;
        col.append(sName, bub);
        row.appendChild(col);
      } else {
        row.appendChild(bub);
      }
      listEl.appendChild(row);
    }
  }
  modal.classList.remove('hidden');
  requestAnimationFrame(() => { listEl.scrollTop = listEl.scrollHeight; });
}

function parseBotRelayDirectives(raw) {
  let clean = String(raw || '');
  const relays = [];
  clean = clean.replace(/\[\[MSG_BOT:([^|\]]+)\|([^\]]+)\]\]/g, (_, targetName, msgBody) => {
    relays.push({ targetName: targetName.trim(), message: msgBody.trim() });
    return '';
  });
  return { text: clean.replace(/\n{3,}/g, '\n\n').trim(), relays };
}

async function relayBotToBotMessage(fromBot, targetBot, messageText) {
  const { thread: targetThread } = getOrCreateBotThread(targetBot.id);
  const { thread: fromThread } = getOrCreateBotThread(fromBot.id);
  fromThread.lastHandoff = { to: targetBot.name, text: messageText.slice(0, 60), at: Date.now() };
  fromThread.updatedAt = Date.now();
  // 记录为内部静默日志（internal: true），不打扰用户可见对话流
  targetThread.messages.push({
    role: 'user',
    content: `[来自同事 Bot「${fromBot.name}」的静默协作] ${messageText}`,
    internal: true,
    at: Date.now()
  });
  let reply = '';
  if (aiConfigured()) {
    const sys = [
      targetBot.rules ? targetBot.rules : `你是 ${targetBot.name}。`,
      `你正在后台与同事 Bot「${fromBot.name}」静默协作，请直接给出精炼、可执行的结论或数据，供对方汇总汇报给用户。`
    ].join('\n');
    const recentTarget = targetThread.messages
      .filter(m => !m.needKey && (m.role === 'user' || m.role === 'assistant'))
      .slice(-8)
      .map(m => ({ role: m.role, content: m.content }));
    reply = String(await aiComplete([{ role: 'system', content: sys }, ...recentTarget]) || '').trim();
  } else {
    reply = `（${targetBot.name} 已收到静默委托：${messageText}，配置 API Key 后可自动回复）`;
  }
  targetThread.messages.push({ role: 'assistant', content: reply, internal: true, at: Date.now() });
  targetThread.updatedAt = Date.now();
  saveTaskThreads();
  renderBotRoster();
  return reply;
}

function mountedExtPluginsFor(botId) {
  const ids = getBotPlugins(botId);
  const all = listPlugins();
  return ids
    .map(id => all.find(p => p.id === id))
    .filter(p => p && p.enabled && p.id.startsWith('ext-') && p.verified)
    .map(p => ({
      name: p.name,
      url: p.url || '',
      token: p.token || '',
      protocol: p.protocol || '',
      tools: Array.isArray(p.tools) ? p.tools : [],
      instructions: p.instructions || ''
    }));
}

async function inspectExternalPluginRemote({ url, token = '' } = {}) {
  const api = getSichaoApi();
  if (!api) return { ok: false, error: '未配置云端代理地址，无法探测远程 MCP' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(`${api}/api/mcp/inspect`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, token })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data?.detail || `HTTP ${r.status}` };
    return data;
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '云端节点正在唤醒或目标超时，请稍后再试' : (err?.message || '网络异常') };
  } finally {
    clearTimeout(timer);
  }
}

async function buildSecondBrainContext(botId = '', query = '') {
  const parts = [];
  const memText = buildMemoryContextForBot(botId, query, 1000);
  if (memText) parts.push(`[个人与 Bot 记忆]\n${memText}`);
  try {
    const notes = await listNotes();
    if (notes.length) {
      const qTokens = String(query || '')
        .toLowerCase()
        .split(/[\s,，。！？、；;:/()（）]+/)
        .filter(w => w.length >= 2);
      const scored = notes.map((n, idx) => {
        const hay = `${n.title || ''} ${(n.tags || []).join(' ')} ${n.bookTitle || ''} ${n.quote || ''} ${n.body || ''}`.toLowerCase();
        let score = 1;
        for (const tk of qTokens) { if (hay.includes(tk)) score += 5; }
        if (n.kind === 'memory' || (n.tags || []).includes('记忆')) score += 2;
        score += Math.max(0, 1 - idx * 0.015);
        return { n, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const lines = [];
      let used = 0;
      for (const { n } of scored.slice(0, 10)) {
        const src = n.bookTitle ? `《${n.bookTitle}》` : ((n.tags || []).slice(0, 2).join('/') || '笔记');
        const snippet = String(n.quote || n.body || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const line = `- [${src}] ${n.title}${snippet ? `：${snippet}` : ''}`;
        if (used + line.length + 1 > 900) break;
        lines.push(line);
        used += line.length + 1;
      }
      if (lines.length) parts.push(`[星海知识库（书籍摘录 / 笔记 / 共享记忆）]\n${lines.join('\n')}`);
    }
  } catch {}
  return parts.join('\n\n');
}

async function saveBotInsightToCosmos(bot, text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const botName = bot?.name || 'Zone';
  importMemoryText(clean.slice(0, 320), { source: `${botName} 对话`, scope: 'global' });
  const firstLine = (clean.split(/[。！？!?\n]/).map(s => s.trim()).find(Boolean) || clean).slice(0, 24);
  const note = await createNote({
    title: firstLine || `${botName} 记忆`,
    body: clean.slice(0, 2400),
    tags: ['记忆', botName],
    kind: 'memory'
  });
  await refreshWorkspace();
  toast('已存入星海并共享给所有 Bot', 2400);
  return note;
}

function openZoneMemorySheet(defaultScope = 'global') {
  openImportMemorySheet({
    bots: listBots(),
    defaultScope,
    onCopyPrompt: txt => copyText(txt),
    onToast: (msg, ms) => toast(msg, ms),
    onChanged: () => renderAgentHub(),
    onSyncToKnowledge: async items => {
      const existing = await listNotes();
      const seenBodies = new Set(existing.map(n => String(n.body || n.title || '').trim().toLowerCase()));
      let added = 0;
      for (const m of items.slice(0, 30)) {
        const body = String(m.text || '').trim();
        if (!body || seenBodies.has(body.toLowerCase())) continue;
        seenBodies.add(body.toLowerCase());
        const title = (body.split(/[。！？!?\n]/).map(s => s.trim()).find(Boolean) || body).slice(0, 22);
        await createNote({
          title,
          body,
          tags: ['记忆', m.source || '导入'],
          kind: 'memory'
        });
        added++;
      }
      await refreshWorkspace();
      toast(added ? `已将 ${added} 条记忆点亮到「星海」第二大脑` : '这些记忆已在「星海」中', 2600);
    }
  });
}

async function runCloudByokAgent(bot, ctxMsgs, memoryCtx, extPlugs, rulesOverride = '') {
  const api = getSichaoApi();
  if (!api) return null;
  const cfg = getAiConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 72000);
  try {
    const r = await fetch(`${api}/api/agent/run`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Api-Key': cfg.apiKey || '',
        'X-User-Base-Url': cfg.baseUrl || '',
        'X-User-Model': cfg.model || ''
      },
      body: JSON.stringify({
        messages: ctxMsgs,
        rules: rulesOverride || bot.rules || '',
        memory: memoryCtx || '',
        ext_plugins: extPlugs || [],
        max_steps: 4
      })
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!data?.ok || !data.reply) return null;
    if (data.usage?.total_tokens > 0) {
      recordAiUsage(data.usage, cfg.model || '');
    } else {
      const stepsLen = Array.isArray(data.steps) ? data.steps.length : 0;
      recordAiUsage(Math.ceil((JSON.stringify(ctxMsgs).length + data.reply.length + stepsLen * 400) * 0.65), cfg.model || '');
    }
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function chatWithActiveGroup(text) {
  const q = String(text || '').trim();
  if (!q || !activeGroupId) return;
  const group = listGroups().find(g => g.id === activeGroupId);
  if (!group) return;
  const bots = listBots();
  const members = (group.memberIds || []).map(id => bots.find(b => b.id === id)).filter(Boolean);
  if (!members.length) return;

  let thread = taskThreads.find(t => t.groupId === group.id);
  if (!thread) {
    thread = { id: `th-${group.id}`, title: group.name, groupId: group.id, messages: [], updatedAt: Date.now() };
    taskThreads.unshift(thread);
  }
  activeThreadId = thread.id;
  thread.messages.push({ role: 'user', content: q, at: Date.now() });
  thread.updatedAt = Date.now();
  saveTaskThreads();

  if (!aiConfigured()) {
    thread.messages.push({
      role: 'assistant',
      botId: members[0].id,
      botName: members[0].name,
      content: `群聊「${group.name}」已就绪（成员：${members.map(b => b.name).join('、')}）。填入你自己的 AI API Key（纯 BYOK）后，群内所有 Bot 就能按分工与 @ 提及协作回复啦。`,
      needKey: true,
      at: Date.now()
    });
    saveTaskThreads();
    renderChatBox(thread);
    renderBotRoster();
    return;
  }

  // 解析 @ 指定 Bot；若未指定或 @所有人 则按群内成员顺序轮流协同
  const mentionAll = /@(所有人|all|everyone)/i.test(q);
  const mentioned = mentionAll ? [] : members.filter(b => q.includes(`@${b.name}`));
  const queue = (mentioned.length ? mentioned : members).slice(0, 4);
  const respondedIds = new Set();

  $('#zone-chat-modal')?.classList.add('thinking');
  try {
    let startIdx = 0;
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      if (thread.messages[i]?.role === 'divider') { startIdx = i + 1; break; }
    }
    const buildGroupCtx = () => thread.messages
      .slice(startIdx)
      .filter(m => !m.needKey && !m.internal && (m.role === 'user' || m.role === 'assistant'))
      .slice(-16)
      .map(m => ({
        role: m.role,
        content: m.role === 'assistant' ? `[${m.botName || 'Bot'}]: ${m.content}` : m.content
      }));

    let handoffCount = 0;
    for (let idx = 0; idx < queue.length; idx++) {
      const b = queue[idx];
      if (respondedIds.has(b.id)) continue;
      respondedIds.add(b.id);
      const memCtx = await buildSecondBrainContext(b.id, q);
      const extPlugs = mountedExtPluginsFor(b.id);
      const useCloud = (isPluginMountedOnBot(b.id, 'mcp-bridge') || extPlugs.length > 0) && getSichaoApi() && q.length >= 6;
      renderChatBox(thread, `${b.name} ${useCloud ? '正在联网协同思考…' : '正在群内回复…'}`);
      const peers = members.filter(x => x.id !== b.id).map(x => `${x.name}${x.rules ? `(${x.rules.slice(0, 20)})` : ''}`).join('、');
      const sysPrompt = [
        b.rules ? b.rules : `你是群聊中的智能体「${b.name}」。`,
        memCtx ? `[共享第二大脑（记忆与星海知识库）]\n${memCtx}` : '',
        `当前你在多 Bot 群聊「${group.name}」中，同群成员有：${peers || '无'}。`,
        '请站在你的职责与视角简洁发言，不要重复前面同事已说过的观点；若本轮无需你发言，请仅回复 [[PASS]]。',
        '如需交接给同群某位成员继续，可在回复中 @对方名字；如需用户确认某项操作，可输出 [[CONFIRM:标题|目标|说明|指令]]；如需输出卡片，可输出 [[CARD:来源|标题|副标题|详情|https://链接]]。'
      ].filter(Boolean).join('\n');
      let rawAns = '';
      if (useCloud) {
        const cloudData = await runCloudByokAgent(b, buildGroupCtx(), memCtx, extPlugs, sysPrompt);
        if (cloudData?.reply) {
          const steps = Array.isArray(cloudData.steps) ? cloudData.steps : [];
          rawAns = steps.length
            ? `<think>已执行 ${steps.length} 次云端联网工具：\n${steps.map((st, i) => `${i + 1}. [${st.tool}] ${st.arg}\n${st.preview}`).join('\n\n')}</think>\n${cloudData.reply}`
            : cloudData.reply;
        }
      }
      if (!rawAns) {
        rawAns = String(await aiComplete([{ role: 'system', content: sysPrompt }, ...buildGroupCtx()]) || '').trim();
      }
      if (!rawAns || /^\[\[PASS\]\]$/i.test(rawAns)) continue;
      const parsed = parseBotCardDirectives(rawAns);
      if (parsed.text) {
        thread.messages.push({ role: 'assistant', botId: b.id, botName: b.name, content: parsed.text, at: Date.now() });
      }
      for (const c of parsed.cards) {
        thread.messages.push({ role: 'card', card: { id: `card-${uid()}`, ...c }, at: Date.now() });
      }
      // 若该 Bot 在群聊里 @ 了同群另一位尚未发言的 Bot，自动拉入本轮接力（最多 1 次接力防止死循环）
      if (handoffCount < 1 && parsed.text) {
        const nextPeer = members.find(x => x.id !== b.id && !respondedIds.has(x.id) && parsed.text.includes(`@${x.name}`));
        if (nextPeer) { queue.push(nextPeer); handoffCount++; }
      }
      thread.updatedAt = Date.now();
      saveTaskThreads();
      renderChatBox(thread);
    }
  } catch (err) {
    thread.messages.push({ role: 'assistant', botId: members[0].id, botName: members[0].name, content: `群聊连接模型失败：${err?.message || '请检查 API 设置'}`, needKey: true, at: Date.now() });
    saveTaskThreads();
    renderChatBox(thread);
  } finally {
    $('#zone-chat-modal')?.classList.remove('thinking');
    renderBotRoster();
  }
}

async function chatWithActiveBot(text) {
  if (activeGroupId) { await chatWithActiveGroup(text); return; }
  const q = String(text || '').trim();
  if (!q) return;
  const bot = getActiveBot();
  let thread = taskThreads.find(t => t.botId === bot.id && !t.groupId);
  if (!thread) {
    thread = {
      id: `th-${bot.id}`,
      title: bot.name,
      botId: bot.id,
      messages: [],
      updatedAt: Date.now()
    };
    taskThreads.unshift(thread);
  }
  activeThreadId = thread.id;
  thread.messages.push({ role: 'user', content: q, at: Date.now() });
  thread.updatedAt = Date.now();
  saveTaskThreads();

  // 自然语言直接记住或存入星海第二大脑（无需联网、零 Token 即可写入共享记忆与星海）
  const memMatch = q.match(/^(?:帮我记住|请记住|记住|存入星海|存进星海)[：:\s]+([\s\S]+)$/);
  if (memMatch && memMatch[1].trim()) {
    const fact = memMatch[1].trim();
    await saveBotInsightToCosmos(bot, fact);
    thread.messages.push({
      role: 'assistant',
      content: `已记住并存入「星海」第二大脑：「${fact.slice(0, 80)}」。后续你和任意 Bot 对话，都能自动共享这条记忆。`,
      inCosmos: true,
      at: Date.now()
    });
    thread.updatedAt = Date.now();
    saveTaskThreads();
    renderChatBox(thread);
    renderBotRoster();
    return;
  }

  if (!aiConfigured()) {
    thread.messages.push({
      role: 'assistant',
      content: `你好，我是 ${bot.name}。填上你自己的 AI API Key（支持 OpenAI / DeepSeek / Claude / Gemini 兼容接口，纯 BYOK 零平台扣费）后，就能直接在这里和我连续对话啦。`,
      needKey: true,
      at: Date.now()
    });
    saveTaskThreads();
    renderChatBox(thread);
    renderBotRoster();
    return;
  }
  const memoryCtx = await buildSecondBrainContext(bot.id, q);
  const extPlugs = mountedExtPluginsFor(bot.id);
  const canUseCloudEngine = (isPluginMountedOnBot(bot.id, 'mcp-bridge') || extPlugs.length > 0) && !!getSichaoApi() && (q.length >= 4 || extPlugs.length > 0);
  renderChatBox(thread, canUseCloudEngine ? '云端多步 Agent 思考与按需联网中…' : '思考中…');
  $('#zone-chat-modal')?.classList.add('thinking');
  try {
    // 只携带最后一条「新话题分割线」之后的上下文，彻底零串味、省 Token
    let startIdx = 0;
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      if (thread.messages[i]?.role === 'divider') { startIdx = i + 1; break; }
    }
    const ctxMsgs = thread.messages.slice(startIdx).filter(m => !m.needKey && !m.internal && (m.role === 'user' || m.role === 'assistant')).slice(-14).map(m => ({ role: m.role, content: m.content }));
    const otherBots = listBots().filter(b => b.id !== bot.id);
    const peerHint = otherBots.length
      ? `你可后台静默联系的其他 Bot：${otherBots.map(b => `${b.name}${b.rules ? `(${b.rules.slice(0, 22)})` : ''}`).join('、')}。如任务需要交给某位 Bot 协同，可输出 [[MSG_BOT:对方Bot名|具体委托内容]]，系统会后台静默通讯并把结果交回给你，不会打扰用户。`
      : '';
    const cardHint = '如需用户点击卡片确认后再执行关键任务，可在回复末尾另起一行输出 [[CONFIRM:标题|目标或链接|简短说明|确认后指令]]；如产出关键链接/PR/报告卡片，可输出 [[CARD:来源|标题|副标题|详情|https://链接]]。';
    const combinedRules = [bot.rules || '', peerHint, cardHint].filter(Boolean).join('\n\n');

    let ans = '';
    let cloudSteps = [];
    let cloudSources = [];
    if (canUseCloudEngine) {
      const data = await runCloudByokAgent(bot, ctxMsgs, memoryCtx, extPlugs, combinedRules);
      if (data?.reply) {
        cloudSteps = Array.isArray(data.steps) ? data.steps : [];
        cloudSources = Array.isArray(data.sources) ? data.sources : [];
        if (cloudSteps.length) {
          const trace = cloudSteps.map((st, i) => `${i + 1}. [${st.tool}] ${st.arg}\n${st.preview}`).join('\n\n');
          ans = `<think>已通过云端多步引擎执行 ${cloudSteps.length} 次真实工具：\n${trace}</think>\n${data.reply}`;
        } else {
          ans = data.reply;
        }
      }
    }
    if (!ans) {
      const skillBlocks = extPlugs.filter(p => p.protocol === 'skill_md' && p.instructions).map(p => `[已挂载 Skill「${p.name}」]\n${p.instructions.slice(0, 1800)}`).join('\n\n');
      const memBlock = memoryCtx ? `[用户已导入的个人记忆（请自然结合但无需逐条复述）]\n${memoryCtx}` : '';
      const sysContent = [combinedRules, memBlock, skillBlocks].filter(Boolean).join('\n\n');
      ans = await aiComplete([{ role: 'system', content: sysContent }, ...ctxMsgs]);
    }
    // 处理 Bot 间静默后台通讯（最多 2 次接力，绝不刷屏、绝不死循环）
    const relayParsed = parseBotRelayDirectives(String(ans || ''));
    if (relayParsed.relays.length && otherBots.length) {
      const relayNotes = [];
      for (const rel of relayParsed.relays.slice(0, 2)) {
        const target = otherBots.find(b => b.name.toLowerCase() === rel.targetName.toLowerCase() || b.name.includes(rel.targetName));
        if (!target) continue;
        renderChatBox(thread, `后台正与「${target.name}」静默协同…`);
        const targetReply = await relayBotToBotMessage(bot, target, rel.message);
        thread.messages.push({ role: 'handoff', targetId: target.id, targetName: target.name, summary: rel.message, at: Date.now() });
        relayNotes.push(`[${target.name} 回复]: ${targetReply}`);
      }
      if (relayNotes.length) {
        renderChatBox(thread, '已收到后台协作结果，正在汇总…');
        const synth = await aiComplete([
          ...(bot.rules ? [{ role: 'system', content: bot.rules }] : []),
          ...ctxMsgs,
          { role: 'user', content: `以下为其他 Bot 在后台静默协作返回的结果（不要输出 MSG_BOT 标签），请直接整理成清晰结果回复用户：\n${relayNotes.join('\n')}` }
        ]);
        ans = String(synth || relayParsed.text || relayNotes.join('\n'));
      } else {
        ans = relayParsed.text || ans;
      }
    }
    const parsed = parseBotCardDirectives(String(ans || '未收到回复'));
    if (parsed.text) {
      thread.messages.push({ role: 'assistant', content: parsed.text, at: Date.now() });
    }
    for (const c of parsed.cards) {
      thread.messages.push({ role: 'card', card: { id: `card-${uid()}`, ...c }, at: Date.now() });
    }
    if (cloudSteps.length && !parsed.cards.length) {
      const topSrc = cloudSources[0] || null;
      const allText = `${parsed.text}\n${cloudSteps.map(s => `${s.arg} ${s.preview}`).join('\n')}`;
      const fallbackUrl = allText.match(/https?:\/\/[^\s<>"')]+/)?.[0] || '';
      const bestUrl = topSrc?.url || fallbackUrl;
      const srcNote = cloudSources.length > 1
        ? `已核验 ${cloudSources.length} 个公开来源：${cloudSources.slice(0, 3).map(s => s.title).join(' · ')}`
        : cloudSteps.map(s => `${s.tool}: ${s.arg}`).join('；');
      thread.messages.push({
        role: 'card',
        card: {
          id: `card-${uid()}`,
          kind: 'result',
          icon: 'cloud',
          provider: '云端 Agent',
          status: 'Done',
          statusTone: 'ok',
          title: topSrc?.title || q.slice(0, 36),
          meta: bestUrl || cloudSteps.map(s => s.tool).join(' · '),
          badge: `${cloudSteps.length} 步工具`,
          detail: srcNote.slice(0, 160),
          url: bestUrl,
          secondaryLabel: bestUrl ? '复制链接' : '',
          primaryLabel: bestUrl ? '打开链接' : ''
        },
        at: Date.now()
      });
    }
    thread.updatedAt = Date.now();
    saveTaskThreads();
    renderChatBox(thread);
  } catch (err) {
    thread.messages.push({ role: 'assistant', content: `连接模型失败：${err?.message || '请检查 API 地址、模型名或密钥'}`, needKey: true, at: Date.now() });
    saveTaskThreads();
    renderChatBox(thread);
  } finally {
    $('#zone-chat-modal')?.classList.remove('thinking');
    renderBotRoster();
  }
}

function renderTaskThreadUI() {}

function showAgentLiveCard({ title, body, onOpen = null, pinSpec = null, threadId = null }) {
  const card = $('#zone-live-card');
  if (!card) return;
  card.replaceChildren();
  const head = document.createElement('div');
  head.className = 'agent-live-head';
  const t = document.createElement('span');
  t.className = 'agent-live-title';
  t.textContent = title || getActiveBot().name;
  head.appendChild(t);
  card.appendChild(head);

  const p = document.createElement('p');
  p.className = 'agent-live-body';
  p.textContent = body || '';
  card.appendChild(p);

  const acts = document.createElement('div');
  acts.className = 'agent-live-acts';
  if (typeof onOpen === 'function') {
    const bOpen = document.createElement('button');
    bOpen.type = 'button';
    bOpen.className = 'agent-live-pill accent';
    bOpen.textContent = '全屏打开';
    bOpen.onclick = () => onOpen();
    acts.appendChild(bOpen);
  }
  if (pinSpec) {
    const bPin = document.createElement('button');
    bPin.type = 'button';
    bPin.className = 'agent-live-pill';
    bPin.textContent = '放到桌面';
    bPin.onclick = async () => { const r = await pinToDesktop(pinSpec); toast(r.message, 2800); };
    acts.appendChild(bPin);
  }
  if (threadId) {
    const bNew = document.createElement('button');
    bNew.type = 'button';
    bNew.className = 'agent-live-pill';
    bNew.textContent = '开新任务';
    bNew.onclick = () => { activeThreadId = null; card.classList.add('hidden'); renderTaskThreadUI(); $('#zone-hero-input')?.focus(); };
    acts.appendChild(bNew);

    const bArch = document.createElement('button');
    bArch.type = 'button';
    bArch.className = 'agent-live-pill';
    bArch.textContent = '归档';
    bArch.onclick = () => {
      taskThreads = taskThreads.filter(x => x.id !== threadId);
      if (activeThreadId === threadId) activeThreadId = null;
      saveTaskThreads();
      card.classList.add('hidden');
      renderTaskThreadUI();
    };
    acts.appendChild(bArch);
  }
  const bClose = document.createElement('button');
  bClose.type = 'button';
  bClose.className = 'agent-live-pill';
  bClose.textContent = '收起';
  bClose.onclick = () => card.classList.add('hidden');
  acts.appendChild(bClose);
  card.appendChild(acts);
  card.classList.remove('hidden');
}

function syncPluginStates() {
  const readerOn = isPluginEnabled('reading-cosmos');
  document.documentElement.classList.toggle('plugin-reader-off', !readerOn);
  if (!$('#zone-chat-modal')?.classList.contains('hidden')) {
    if (activeGroupId) {
      const grp = listGroups().find(g => g.id === activeGroupId);
      if (grp) renderGroupMentionBar(grp);
    } else {
      renderBotMountedBar(getActiveBot());
    }
  }
  if (!readerOn) {
    $('#zone-agent-hub')?.classList.remove('compact');
    if ($('#reader')?.classList.contains('active')) closeBook();
    if (currentPane() !== 'shelf') showPane('shelf', { instant: true });
  } else {
    renderLibrary();
  }
}

function openBotConversation(bot, { fresh = false, created = false } = {}) {
  if (!bot) return;
  activeGroupId = null;
  setActiveBot(bot.id);
  if (created) newlyBornBotId = bot.id;
  let thread = !fresh ? taskThreads.find(t => t.botId === bot.id && !t.groupId) : null;
  if (!thread) {
    thread = {
      id: `th-${Date.now().toString(36)}`,
      title: bot.name,
      botId: bot.id,
      messages: [],
      updatedAt: Date.now()
    };
    taskThreads.unshift(thread);
    saveTaskThreads();
  }
  activeThreadId = thread.id;
  renderAgentHub();
  renderChatBox(thread);
}

function openGroupConversation(group) {
  if (!group) return;
  activeGroupId = group.id;
  let thread = taskThreads.find(t => t.groupId === group.id);
  if (!thread) {
    thread = {
      id: `th-${group.id}`,
      title: group.name,
      groupId: group.id,
      messages: [],
      updatedAt: Date.now()
    };
    taskThreads.unshift(thread);
    saveTaskThreads();
  }
  activeThreadId = thread.id;
  renderAgentHub();
  renderChatBox(thread);
}

function formatShortTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays <= 1) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function renderBotRoster() {
  const roster = $('#zone-bot-roster');
  if (!roster) return;
  const bots = listBots();
  const groups = listGroups();
  const primary = getPrimaryBot();
  const q = ($('#zone-bot-search')?.value || '').trim().toLowerCase();

  const entries = [];
  for (const g of groups) {
    const th = taskThreads.find(t => t.groupId === g.id);
    const membersText = (g.memberIds || []).map(id => bots.find(b => b.id === id)?.name || '').join(' ');
    const msgsText = (th?.messages || []).filter(m => !m.internal).map(m => m.content || '').join(' ').toLowerCase();
    if (!q || (g.name || '').toLowerCase().includes(q) || membersText.toLowerCase().includes(q) || msgsText.includes(q)) {
      entries.push({ kind: 'group', group: g, th, updatedAt: th?.updatedAt || g.createdAt || 0 });
    }
  }
  const botCandidates = q ? bots : bots.filter(b => b.id !== primary.id);
  for (const b of botCandidates) {
    const th = taskThreads.find(t => t.botId === b.id && !t.groupId);
    const msgsText = (th?.messages || []).filter(m => !m.internal).map(m => m.content || '').join(' ').toLowerCase();
    if (!q || (b.name || '').toLowerCase().includes(q) || (b.rules || '').toLowerCase().includes(q) || msgsText.includes(q)) {
      entries.push({ kind: 'bot', bot: b, th, updatedAt: th?.updatedAt || 0 });
    }
  }
  entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  roster.replaceChildren();
  if (!entries.length) { roster.classList.add('hidden'); return; }
  roster.classList.remove('hidden');

  for (const entry of entries) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'roster-item';
    const av = document.createElement('div');
    av.className = 'roster-av';
    const txt = document.createElement('div');
    txt.className = 'roster-txt';
    const top = document.createElement('div');
    top.className = 'roster-top';
    const nameEl = document.createElement('strong');
    const timeEl = document.createElement('span');
    timeEl.className = 'roster-time';
    timeEl.textContent = formatShortTime(entry.th?.updatedAt || entry.updatedAt);
    top.append(nameEl, timeEl);

    const subEl = document.createElement('span');
    const visibleMsgs = (entry.th?.messages || []).filter(m => m.role !== 'divider' && !m.internal);
    const lastEntry = visibleMsgs[visibleMsgs.length - 1];

    if (entry.kind === 'group') {
      const g = entry.group;
      av.innerHTML = renderGroupAvatarHtml(g.memberIds);
      nameEl.textContent = g.name;
      const lastTxt = lastEntry?.role === 'card'
        ? `[${lastEntry.card?.status || '卡片'}] ${lastEntry.card?.title || ''}`
        : lastEntry?.content
          ? `${lastEntry.botName ? `${lastEntry.botName}: ` : ''}${String(lastEntry.content).replace(/<think>[\s\S]*?<\/think>\s*/, '')}`
          : `群聊 · ${(g.memberIds || []).length} 个 Bot`;
      subEl.textContent = lastTxt.slice(0, 42);
      item.onclick = () => openGroupConversation(g);
    } else {
      const b = entry.bot;
      av.innerHTML = renderBotSvg(b.shape, b.accent, b.id);
      if (newlyBornBotId && newlyBornBotId === b.id) item.classList.add('bot-born');
      nameEl.textContent = b.name;
      let preview = '';
      if (entry.th?.lastHandoff && (!lastEntry?.at || entry.th.lastHandoff.at >= lastEntry.at)) {
        preview = `➤ 已发消息给 ${entry.th.lastHandoff.to}: ${entry.th.lastHandoff.text}`;
      } else if (lastEntry?.role === 'handoff') {
        preview = `➤ 已发消息给 ${lastEntry.targetName}: ${lastEntry.summary || ''}`;
      } else if (lastEntry?.role === 'card') {
        preview = `[${lastEntry.card?.status || '卡片'}] ${lastEntry.card?.title || ''}`;
      } else if (lastEntry?.content) {
        preview = String(lastEntry.content).replace(/<think>[\s\S]*?<\/think>\s*/, '');
      }
      subEl.textContent = preview ? preview.slice(0, 42) : (b.rules ? b.rules.slice(0, 32) : '轻触进入对话');
      item.onclick = () => openBotConversation(b);
    }
    txt.append(top, subEl);
    item.append(av, txt);
    roster.appendChild(item);
  }
}

function closeProfileSheet() {
  const mask = document.getElementById('zone-profile-mask');
  if (!mask || mask.classList.contains('hidden')) return false;
  mask.classList.add('hidden');
  return true;
}

function formatTokens(n) {
  const v = Number(n || 0);
  if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
  return String(v);
}

function openProfileSheet() {
  let mask = document.getElementById('zone-profile-mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'zone-profile-mask';
    mask.className = 'bots-mask hidden';
    document.body.appendChild(mask);
  }
  let editingRecharge = false;
  let checkingLive = false;
  const draw = () => {
    const u = getAiUsage();
    const cfg = getAiConfig();
    const pr = getModelPricing(cfg.model, cfg.baseUrl);
    const sym = u.currency === 'USD' ? '$' : '¥';
    const liveSym = u.liveCurrency === 'USD' ? '$' : '¥';
    const spent = Number(u.spentEstimated || 0);
    const recharge = Number(u.rechargeAmount || 0);
    const estRemain = recharge > 0 ? Math.max(0, recharge - spent) : null;
    const pct = recharge > 0
      ? Math.min(100, Math.round((spent / recharge) * 100))
      : Math.min(100, Math.round((u.monthTokens / Math.max(1, u.budget)) * 100));
    const appMap = { system: '跟随系统', light: '浅色', dark: '深色' };
    const memCount = listMemories().length;
    const balLine = u.liveBalance != null
      ? `${u.liveProvider || '官方'}余额 ${liveSym}${Number(u.liveBalance).toFixed(2)} · 本月 ${formatTokens(u.monthTokens)}`
      : estRemain != null
        ? `剩余 ${sym}${estRemain.toFixed(2)} · 本月 ${formatTokens(u.monthTokens)} tokens`
        : `今日 ${formatTokens(u.todayTokens)} · 本月 ${formatTokens(u.monthTokens)} tokens`;

    mask.innerHTML = `
      <div class="bots-sheet" role="dialog" aria-label="我的 Zone">
        <div class="bots-head">
          <div>
            <h3>我的 Zone</h3>
            <p>自有密钥 · 本地隐私</p>
          </div>
          <button type="button" class="bots-close" data-p-act="close">完成</button>
        </div>
        <div class="prof-group">
          <button type="button" class="prof-row" data-p-act="ai-cfg">
            <div class="prof-row-main">
              <strong>模型与密钥</strong>
              <span>${aiConfigured() ? cfg.model : '未配置'}</span>
            </div>
            <span class="prof-row-val">配置 ›</span>
          </button>
          <button type="button" class="prof-row" data-p-act="edit-recharge">
            <div class="prof-row-main">
              <strong>用量</strong>
              <span>${balLine}</span>
            </div>
            <span class="prof-row-val">${estRemain != null ? `${sym}${estRemain.toFixed(2)}` : `${pct}%`} ›</span>
          </button>
          <div class="prof-usage-bar"><div class="prof-usage-fill" style="width:${pct}%"></div></div>
          ${editingRecharge ? `
            <div class="prof-recharge-box">
              <div class="prof-recharge-row">
                <button type="button" class="bot-edit" data-p-cur="CNY" style="${u.currency === 'CNY' ? 'background:var(--app-fg);color:var(--app-bg)' : ''}">¥</button>
                <button type="button" class="bot-edit" data-p-cur="USD" style="${u.currency === 'USD' ? 'background:var(--app-fg);color:var(--app-bg)' : ''}">$</button>
                <input id="prof-recharge-inp" type="number" step="0.01" min="0" placeholder="输入充值金额，如 50" value="${recharge || ''}">
              </div>
              <button type="button" class="bots-primary" style="height:38px;font-size:14px" data-p-act="save-recharge">保存余额基数</button>
            </div>
          ` : ''}
          <button type="button" class="prof-row" data-p-act="refresh-bal">
            <div class="prof-row-main">
              <strong>${checkingLive ? '查询中…' : '刷新余额'}</strong>
              <span>DeepSeek · OpenRouter · 硅基流动</span>
            </div>
            <span class="prof-row-val">${checkingLive ? '…' : '刷新 ›'}</span>
          </button>
          <button type="button" class="prof-row" data-p-act="usage-reset">
            <div class="prof-row-main">
              <strong>重置用量</strong>
              <span>清零本机计数</span>
            </div>
            <span class="prof-row-val">清零</span>
          </button>
        </div>
        <div class="prof-group">
          <button type="button" class="prof-row" data-p-act="cosmos">
            <div class="prof-row-main">
              <strong>星海</strong>
              <span>书籍 · 笔记 · Bot 共享第二大脑</span>
            </div>
            <span class="prof-row-val">进入 ›</span>
          </button>
          <button type="button" class="prof-row" data-p-act="import-mem">
            <div class="prof-row-main">
              <strong>导入记忆</strong>
              <span>从其他 AI 迁入并同步至星海</span>
            </div>
            <span class="prof-row-val">${memCount ? `${memCount} 条 ›` : '导入 ›'}</span>
          </button>
          <button type="button" class="prof-row" data-p-act="plugins">
            <div class="prof-row-main">
              <strong>插件</strong>
              <span>MCP · 电脑 · 控屏 · 阅读器</span>
            </div>
            <span class="prof-row-val">›</span>
          </button>
          <button type="button" class="prof-row" data-p-act="automations">
            <div class="prof-row-main">
              <strong>定时任务</strong>
              <span>周期运行与推送</span>
            </div>
            <span class="prof-row-val">›</span>
          </button>
        </div>
        <div class="prof-group">
          <button type="button" class="prof-row" data-p-act="appearance">
            <div class="prof-row-main">
              <strong>外观</strong>
              <span>浅色 · 深色 · 跟随系统</span>
            </div>
            <span class="prof-row-val">${appMap[appearancePref()] || '跟随系统'} ›</span>
          </button>
          <div class="prof-row">
            <div class="prof-row-main">
              <strong>权限</strong>
              <span>敏感操作卡片确认</span>
            </div>
            <span class="prof-row-val">已开启</span>
          </div>
        </div>
      </div>`;
    mask.onclick = e => { if (e.target === mask) closeProfileSheet(); };
    mask.querySelector('[data-p-act="close"]').onclick = () => closeProfileSheet();
    mask.querySelector('[data-p-act="ai-cfg"]').onclick = () => { closeProfileSheet(); openAiSettingsDialog(); };
    mask.querySelector('[data-p-act="cosmos"]').onclick = () => { closeProfileSheet(); openBotReaderSheet(null, { initialPane: 'graph', fromHome: true }); };
    mask.querySelector('[data-p-act="edit-recharge"]').onclick = () => { editingRecharge = !editingRecharge; draw(); };
    mask.querySelectorAll('[data-p-cur]').forEach(btn => {
      btn.onclick = () => { setRechargeBalance(u.rechargeAmount, btn.dataset.pCur); draw(); };
    });
    const saveRec = mask.querySelector('[data-p-act="save-recharge"]');
    if (saveRec) {
      saveRec.onclick = () => {
        const val = Number(mask.querySelector('#prof-recharge-inp')?.value || 0);
        setRechargeBalance(val, u.currency);
        editingRecharge = false;
        toast(val > 0 ? `已设定充值基数 ${sym}${val.toFixed(2)}，后续对话自动实时扣减估算` : '已清除充值基数', 2600);
        draw();
      };
    }
    mask.querySelector('[data-p-act="refresh-bal"]').onclick = async () => {
      if (checkingLive) return;
      if (!aiConfigured()) { toast('请先配置你的 API Key'); return; }
      checkingLive = true; draw();
      const res = await fetchLiveBalance(getSichaoApi());
      checkingLive = false;
      if (res?.ok) {
        toast(`${res.provider || '官方'}实时余额：${res.currency === 'USD' ? '$' : '¥'}${Number(res.balance).toFixed(2)}`, 3000);
      } else {
        toast(res?.reason || '该服务商未开放直接查余额，可点上方填入充值金额估算', 3400);
      }
      draw();
    };
    mask.querySelector('[data-p-act="usage-reset"]').onclick = () => {
      resetAiUsage();
      toast('已清零本地 API 用量与花费统计', 2000);
      draw();
    };
    mask.querySelector('[data-p-act="plugins"]').onclick = () => { closeProfileSheet(); openBotsFromHub({ initialTab: 'plugins' }); };
    mask.querySelector('[data-p-act="automations"]').onclick = () => { closeProfileSheet(); openBotsFromHub({ initialTab: 'automations' }); };
    mask.querySelector('[data-p-act="import-mem"]').onclick = () => { closeProfileSheet(); openZoneMemorySheet('global'); };
    mask.querySelector('[data-p-act="appearance"]').onclick = () => { cycleAppearance(); draw(); };
  };
  draw();
  mask.classList.remove('hidden');
}

function renderAgentHub() {
  syncPluginStates();
  const primary = getPrimaryBot();
  const glyphEl = $('#zone-hero-glyph');
  if (glyphEl) glyphEl.innerHTML = renderBotSvg(primary.shape, primary.accent, primary.id);
  const nameEl = $('#zone-hero-name');
  if (nameEl) nameEl.textContent = primary.name;
  renderBotRoster();

  const strip = $('#zone-microapp-strip');
  if (strip) {
    const apps = listMicroApps();
    strip.replaceChildren();
    strip.classList.toggle('hidden', !apps.length);
    for (const app of apps.slice(0, 6)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'agent-app-chip';
      const dot = document.createElement('span');
      dot.className = 'agent-app-dot';
      chip.append(dot, document.createTextNode(app.title));
      chip.onclick = () => openMicroApp(app.id);
      strip.appendChild(chip);
    }
  }
}

function launchPluginById(id, bot = getActiveBot()) {
  const targetBot = bot || getActiveBot();
  if (id === 'sichao') { openSichaoSheet(); return; }
  if (id === 'phone-use') { command.run('开启手机控屏'); return; }
  if (id === 'computer-use') {
    const curUrl = (() => { try { return localStorage.getItem('zone-cu-bridge') || ''; } catch { return ''; } })();
    openBotConversation(targetBot);
    const inp = $('#zone-chat-input');
    if (inp) {
      inp.value = curUrl ? `电脑控屏 ` : `连接电脑 http://192.168.1.100:8765`;
      inp.focus();
    }
    toast(curUrl ? `已绑定本地电脑桥接：${curUrl}` : '输入电脑桥接地址即可遥控本地电脑', 3400);
    return;
  }
  if (id === 'reading-cosmos') {
    openBotConversation(targetBot);
    openBotReaderSheet(targetBot);
    return;
  }
}
async function runAutomationItem(auto, opts = {}) {
  if (opts?.disabled) {
    $('#zone-live-card')?.classList.add('hidden');
    return;
  }
  if (auto?.builtinAction === 'sichao') {
    if (opts?.fromToggle) {
      showAgentLiveCard({ title: '新闻推送 · 正在拉取最新动态…', body: '正在连接云端思潮获取今日前沿信号…' });
      try {
        const list = await fetchLiveSignals();
        const preview = list.slice(0, 3).map((ev, i) => `${i + 1}. ${ev.title}`).join('\n');
        showAgentLiveCard({
          title: `新闻推送 · 已送达 ${list.length} 条`,
          body: preview || '暂无最新信号',
          onOpen: () => openSichaoSheet(),
          pinSpec: { id: 'zone-sichao', label: '新闻推送', uri: 'zone://open/sichao', glyph: '闻' }
        });
      } catch (err) {
        showAgentLiveCard({
          title: '新闻推送 · 离线就绪',
          body: `云端唤醒中（${err?.message || '稍后重试'}），点下方可立即进入本地情报卡。`,
          onOpen: () => openSichaoSheet()
        });
      }
      return;
    }
    openSichaoSheet();
    return;
  }
  if (auto?.prompt) {
    activeThreadId = null;
    await chatWithActiveBot(auto.prompt);
  }
}
const openBotsFromHub = (opts = {}) => openBotStudio({
  onSelect: (bot, meta) => openBotConversation(bot, { created: !!meta?.created }),
  onSelectGroup: grp => openGroupConversation(grp),
  onStatus: msg => { renderAgentHub(); if (!$('#zone-chat-modal')?.classList.contains('hidden')) renderChatBox(taskThreads.find(t => t.id === activeThreadId)); toast(msg, 2600); },
  onLaunchPlugin: launchPluginById,
  onRunAutomation: runAutomationItem,
  onInspectPlugin: inspectExternalPluginRemote,
  ...opts
});
$('#zone-hero-card')?.addEventListener('click', () => openBotConversation(getPrimaryBot()));
$('#btn-hub-profile')?.addEventListener('click', () => openProfileSheet());
$('#btn-hub-newbot')?.addEventListener('click', () => openBotsFromHub({ startNew: true }));
$('#btn-hub-plugins')?.addEventListener('click', () => openBotsFromHub({ initialTab: 'plugins' }));
$('#zone-bot-search')?.addEventListener('input', () => renderBotRoster());
$('#btn-chat-back')?.addEventListener('click', () => closeBotChat());
$('#btn-chat-botmeta')?.addEventListener('click', () => {
  if (activeGroupId) openBotsFromHub({ editGroupId: activeGroupId });
  else openBotsFromHub({ editBotId: getActiveBot().id });
});
$('#btn-chat-plugins')?.addEventListener('click', () => {
  if (activeGroupId) openBotsFromHub({ editGroupId: activeGroupId });
  else openBotPluginsSheet(getActiveBot());
});
$('#btn-chat-new')?.addEventListener('click', () => insertNewTopicDivider());
$('#zone-chat-mic')?.addEventListener('click', () => command.openBar({ listen: true }));
$('#zone-chat-input')?.addEventListener('focus', () => $('#zone-chat-modal')?.classList.add('typing'));
$('#zone-chat-input')?.addEventListener('blur', () => $('#zone-chat-modal')?.classList.remove('typing'));
$('#zone-chat-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const inp = $('#zone-chat-input');
  const text = (inp?.value || '').trim();
  if (!text) { command.openBar({ listen: true }); return; }
  inp.value = '';
  if (activeGroupId) {
    await chatWithActiveGroup(text);
    renderAgentHub();
    return;
  }
  const ops = parseNaturalCommands(text, { reading: false, pane: currentPane() });
  if (ops.length && ops[0].op !== 'askAi') {
    await command.run(text);
  } else {
    await chatWithActiveBot(ops[0]?.question || text);
  }
  renderAgentHub();
});

applyThemePlugin(getActiveThemePlugin());
renderAgentHub();
consumeLaunchDeepLink(openDeepLink);
syncToAndroidWidget();

window.__app = { db, openBook, closeBook, importFiles, importBlob, importArticleUrl, handleBack, openDeepLink, openMicroApp, closeMicroApp, isMicroAppOpen, pinToDesktop, postChatCard, requestChatConfirm, openBotConversation, openGroupConversation, relayBotToBotMessage, buildSecondBrainContext, get engine() { return engine; }, renderLibrary, stacks: { list: listStacks }, runCommand: text => command.run(text), openCommand: opts => command.openBar(opts), openPeek: openBookPeek, closePeek: closeBookPeek, openAuthGate, getAuthUser, getOpdsUrl, setOpdsUrl };
