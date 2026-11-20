// 书库之外的工作台：知识列表、笔记编辑、图谱、AI 面板。
import { aiConfigured, askText, clearAiKey, explainText, getAiConfig, saveAiConfig, testAi } from './ai.js';
import {
  createNote, deleteNote, extractKeyPoints, linkNotes, listLinks, listNotes,
  makeTitle, parseTags, saveNote, suggestTags, unlinkPair
} from './knowledge.js';
import { Cosmos, layoutCosmos, magLabel } from './cosmos.js';

const $ = s => document.querySelector(s);
const state = { notes: [], links: [], filter: { q: '', kind: 'all', tag: '' }, editing: null, focusId: null, ai: null };
let api = { toast() {}, openPassage() {}, onHighlightsChanged() {} };

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
const KIND = { highlight: '划线', excerpt: '摘录', copy: '复制', annotation: '批注', note: '笔记' };

function kindOf(note) {
  if (note.concept) return 'concept';
  if (note.kind === 'highlight' || note.kind === 'annotation' || note.kind === 'note') return note.kind;
  return 'excerpt';
}
function kindLabel(note) {
  if (note.concept && note.kind === 'note') return '概念';
  return KIND[note.kind] || '笔记';
}

let whisperTimer = null;
export function showSpaceWhisper(name) {
  const el = $('#space-whisper');
  if (!el) return;
  el.querySelectorAll('[data-w]').forEach(s => s.classList.toggle('on', s.dataset.w === name));
  el.classList.add('show');
  clearTimeout(whisperTimer);
  whisperTimer = setTimeout(() => el.classList.remove('show'), 1150);
}

export function showPane(name, opts = {}) {
  if (!['shelf', 'knowledge', 'graph'].includes(name)) name = 'shelf';
  const prev = document.querySelector('.pane.on')?.id?.replace(/^pane-/, '');
  document.querySelectorAll('.pane').forEach(pane => pane.classList.toggle('on', pane.id === 'pane-' + name));
  document.querySelectorAll('[data-pane]').forEach(btn => {
    const on = btn.dataset.pane === name;
    btn.classList.toggle('on', on);
    if (btn.getAttribute('role') === 'tab') btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelector('#library')?.classList.toggle('cosmos-on', name === 'graph');
  if (opts?.whisper || (prev && prev !== name && opts?.whisper !== false && !opts?.silent)) {
    if (opts?.whisper) showSpaceWhisper(name);
  }
  if (name === 'graph') requestAnimationFrame(() => renderGraph(false));
  else cosmos?.setActive(false);
}

export function setKnowledgeFind(open) {
  const bar = $('#k-find-bar');
  if (!bar) return;
  bar.hidden = !open;
  if (open) {
    $('#pane-knowledge')?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('#note-search')?.focus({ preventScroll: true });
  }
  syncKnowledgeFilterChip();
}

function syncKnowledgeFilterChip() {
  const chip = $('#k-filter-chip');
  const bar = $('#k-find-bar');
  if (!chip) return;
  const parts = [];
  if (state.filter.q.trim()) parts.push(`「${state.filter.q.trim()}」`);
  if (state.filter.kind !== 'all') {
    const map = { highlight: '划线', excerpt: '摘录', annotation: '批注', note: '笔记', concept: '概念' };
    parts.push(map[state.filter.kind] || state.filter.kind);
  }
  if (state.filter.tag) parts.push('#' + state.filter.tag);
  const show = bar?.hidden && parts.length > 0;
  chip.classList.toggle('hidden', !show);
  chip.textContent = show ? `${parts.join(' · ')} · 清除` : '';
  $('#note-search-clear')?.classList.toggle('hidden', !state.filter.q.trim());
}

export async function refreshWorkspace() {
  state.notes = await listNotes();
  state.links = await listLinks();
  renderNotes();
  if ($('#pane-graph')?.classList.contains('on')) renderGraph(false);
}

function filteredNotes() {
  const q = state.filter.q.trim().toLowerCase();
  return state.notes.filter(note => {
    if (state.filter.kind !== 'all' && kindOf(note) !== state.filter.kind) return false;
    if (state.filter.tag && !(note.tags || []).includes(state.filter.tag)) return false;
    if (!q) return true;
    const hay = [note.title, note.body, note.quote, note.bookTitle, ...(note.tags || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function renderNotes() {
  const list = $('#note-list');
  const filters = $('#tag-filters');
  if (!list || !filters) return;
  const notes = filteredNotes();
  filters.replaceChildren();
  const kinds = [['all', '全部'], ['highlight', '划线'], ['excerpt', '摘录'], ['annotation', '批注'], ['note', '笔记'], ['concept', '概念']];
  for (const [id, label] of kinds) {
    const chip = h('button', 'chip' + (state.filter.kind === id && !state.filter.tag ? ' on' : ''), label);
    chip.type = 'button';
    chip.onclick = () => { state.filter.kind = id; state.filter.tag = ''; renderNotes(); };
    filters.appendChild(chip);
  }
  const tags = new Map();
  for (const note of state.notes) for (const tag of note.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
  for (const [tag] of [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const chip = h('button', 'chip' + (state.filter.tag === tag ? ' on' : ''), '#' + tag);
    chip.type = 'button';
    chip.onclick = () => { state.filter.tag = state.filter.tag === tag ? '' : tag; state.filter.kind = 'all'; renderNotes(); };
    filters.appendChild(chip);
  }

  list.replaceChildren();
  if (!state.notes.length) {
    list.appendChild(emptyKnowledge());
    return;
  }
  if (!notes.length) {
    list.appendChild(h('p', 'empty-inline', '没有符合筛选的笔记'));
    return;
  }
  for (const note of notes) list.appendChild(noteCard(note));
  syncKnowledgeFilterChip();
}

function emptyKnowledge() {
  const wrap = h('div', 'empty knowledge-empty');
  const glow = h('div', 'empty-glow');
  glow.setAttribute('aria-hidden', 'true');
  const cta = h('button', 'pill accent', '新建笔记');
  cta.type = 'button';
  cta.onclick = () => openEditor(null);
  wrap.append(glow, h('p', '', '还没有笔记'), h('p', 'hint', '阅读时长按一段文字，或写下第一条想法。'), cta);
  return wrap;
}

function noteCard(note) {
  const card = h('button', 'note-card kind-' + kindOf(note));
  card.type = 'button';
  const top = h('div', 'note-top');
  top.append(h('span', 'kind', kindLabel(note)));
  if (note.bookTitle) top.append(h('span', 'src', note.bookTitle));
  card.append(top, h('strong', 'note-title', note.title || '未命名'));
  const preview = (note.quote || note.body || '').replace(/\s+/g, ' ').trim();
  if (preview) card.append(h('p', 'note-preview', preview));
  if (note.tags?.length) {
    const row = h('div', 'mini-tags');
    for (const tag of note.tags) row.append(h('span', '', '#' + tag));
    card.append(row);
  }
  card.onclick = () => openEditor(note.id);
  return card;
}

function relatedOf(id) {
  const out = [];
  const seen = new Set();
  for (const link of state.links) {
    const otherId = link.fromId === id ? link.toId : link.toId === id ? link.fromId : null;
    if (!otherId || seen.has(otherId)) continue;
    seen.add(otherId);
    const other = state.notes.find(n => n.id === otherId);
    if (other) out.push({ link, note: other });
  }
  return out;
}

function draftSnapshot() {
  const draft = state.editing;
  if (!draft) return null;
  return { title: draft.title, body: draft.body, quote: draft.quote, tags: [...(draft.tags || [])], concept: !!draft.concept };
}
async function reopenKeeping(id) {
  const keep = draftSnapshot();
  await refreshWorkspace();
  await openEditor(id, keep);
}
export async function openEditor(id, keep) {
  const host = $('#note-editor');
  if (!host) return;
  const note = id ? state.notes.find(n => n.id === id) : null;
  state.editing = note ? { ...note, tags: [...(note.tags || [])] } : {
    id: null, title: '', body: '', quote: '', tags: [], kind: 'note', concept: false, bookId: null, bookTitle: '', passageId: null
  };
  if (keep) {
    state.editing.title = keep.title ?? state.editing.title;
    state.editing.body = keep.body ?? state.editing.body;
    state.editing.quote = keep.quote ?? state.editing.quote;
    state.editing.tags = Array.isArray(keep.tags) ? [...keep.tags] : state.editing.tags;
    state.editing.concept = !!keep.concept;
  }
  host.classList.remove('hidden');
  host.replaceChildren();
  const draft = state.editing;

  const bar = h('div', 'editor-bar');
  const back = h('button', 'texty', '返回');
  back.type = 'button';
  back.onclick = () => closeEditor();
  const save = h('button', 'btn primary', '保存');
  save.type = 'button';
  save.onclick = () => commitEditor();
  bar.append(back, h('span', 'editor-kicker', draft.id ? '编辑笔记' : '新笔记'), save);

  const title = h('input', 'editor-title');
  title.value = draft.title || '';
  title.placeholder = '标题';
  title.oninput = () => { draft.title = title.value; };

  const quote = h('textarea', 'editor-quote');
  quote.rows = 3;
  quote.placeholder = '摘录，可以留空';
  quote.value = draft.quote || '';
  quote.readOnly = !!draft.passageId;
  quote.oninput = () => { draft.quote = quote.value; };

  const body = h('textarea', 'editor-body');
  body.rows = 8;
  body.placeholder = '想法、批注，或用 [[另一条笔记的标题]] 建立关联';
  body.value = draft.body || '';
  body.oninput = () => { draft.body = body.value; };

  const tagRow = h('div', 'tag-editor');
  const tagInput = h('input');
  tagInput.placeholder = '添加标签';
  const paintTags = () => {
    tagRow.replaceChildren();
    for (const tag of draft.tags) {
      const chip = h('button', 'chip on', tag + ' ×');
      chip.type = 'button';
      chip.onclick = () => { draft.tags = draft.tags.filter(t => t !== tag); paintTags(); };
      tagRow.appendChild(chip);
    }
    tagRow.appendChild(tagInput);
  };
  tagInput.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    for (const tag of parseTags(tagInput.value)) {
      if (!draft.tags.includes(tag) && draft.tags.length < 8) draft.tags.push(tag);
    }
    tagInput.value = '';
    paintTags();
  };
  paintTags();

  const concept = h('label', 'checkline');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!draft.concept;
  box.onchange = () => { draft.concept = box.checked; };
  concept.append(box, document.createTextNode('当作一个概念，在图谱里突出显示'));

  host.append(bar, title, quote, body, tagRow, concept, h('p', 'editor-hint', '正文中的 [[笔记标题]] 会在保存时连到同名笔记。标签来自你的标注，也可以自己加。'));

  if (draft.bookId && draft.passageId) {
    const jump = h('button', 'texty', '回到《' + (draft.bookTitle || '原书') + '》');
    jump.type = 'button';
    jump.onclick = () => api.openPassage(draft.bookId, draft.passageId);
    host.appendChild(jump);
  }

  const tools = h('div', 'editor-tools');
  const aiBtn = h('button', 'btn ghost', 'AI 解释');
  aiBtn.type = 'button';
  aiBtn.onclick = () => openAssistant({
    title: draft.title, quote: draft.quote || draft.body, context: draft.body || '',
    bookId: draft.bookId, bookTitle: draft.bookTitle, linkTo: draft.id || null
  });
  const pointBtn = h('button', 'btn ghost', '本地要点');
  pointBtn.type = 'button';
  pointBtn.onclick = () => {
    const points = extractKeyPoints(draft.quote || draft.body || draft.title);
    if (!points.length) return api.toast('没有足够的文字');
    const block = points.map(p => '· ' + p).join('\n');
    draft.body = draft.body ? draft.body + '\n\n' + block : block;
    body.value = draft.body;
    api.toast('已把要点写进笔记');
  };
  tools.append(aiBtn, pointBtn);
  host.appendChild(tools);

  const relHead = h('h3', 'rel-head', '关联');
  host.appendChild(relHead);
  const rel = relatedOf(draft.id);
  if (!draft.id) host.appendChild(h('p', 'editor-hint', '先保存这条笔记，再把它和其他笔记连起来。'));
  else if (!rel.length) host.appendChild(h('p', 'editor-hint', '还没有关联。在下面选择另一条笔记，或在正文写 [[标题]]。'));
  for (const item of rel) {
    const row = h('div', 'rel-row');
    const open = h('button', 'texty', item.note.title || '未命名');
    open.type = 'button';
    open.onclick = () => openEditor(item.note.id);
    const cut = h('button', 'texty danger', '断开');
    cut.type = 'button';
    cut.onclick = async () => { await unlinkPair(draft.id, item.note.id); await reopenKeeping(draft.id); };
    row.append(open, cut);
    host.appendChild(row);
  }
  if (draft.id) {
    const picker = h('div', 'link-picker');
    const sel = document.createElement('select');
    sel.appendChild(new Option('选择要关联的笔记', ''));
    for (const other of state.notes) {
      if (other.id === draft.id || rel.some(item => item.note.id === other.id)) continue;
      sel.appendChild(new Option(other.title || '未命名', other.id));
    }
    const add = h('button', 'btn ghost', '建立关联');
    add.type = 'button';
    add.onclick = async () => {
      if (!sel.value) return api.toast('先选择一条笔记');
      await linkNotes(draft.id, sel.value);
      await reopenKeeping(draft.id);
      api.toast('已建立关联');
    };
    picker.append(sel, add);
    host.appendChild(picker);
  }

  if (draft.id) {
    const danger = h('button', 'texty danger', '删除这条笔记');
    danger.type = 'button';
    danger.onclick = async () => {
      if (!confirm('删除这条笔记？书里对应的划线或摘录也会去掉。')) return;
      const bookId = draft.bookId;
      await deleteNote(draft.id);
      if (bookId) api.onHighlightsChanged(bookId);
      closeEditor();
      await refreshWorkspace();
      api.toast('已删除');
    };
    host.appendChild(danger);
  }
  title.focus();
}

function closeEditor() {
  state.editing = null;
  $('#note-editor')?.classList.add('hidden');
}

async function commitEditor() {
  const draft = state.editing;
  if (!draft) return;
  const title = (draft.title || '').trim() || makeTitle(draft.quote || draft.body || '未命名');
  const payload = { ...draft, title, tags: draft.tags || [] };
  if (draft.id) await saveNote(payload);
  else await createNote(payload);
  closeEditor();
  await refreshWorkspace();
  api.toast('已保存到知识库');
}

/* ---------- 星海：深空知识地图 ---------- */
const GRAPH_LIMIT = 160;
let cosmos = null;
let cosmosModel = null;
let graphSig = '';

function ensureCosmos() {
  if (cosmos) return cosmos;
  const stage = $('#graph-stage');
  if (!stage || !$('#graph-map')) return null;
  cosmos = new Cosmos({
    stage, plane: $('#graph-plane'), world: $('#graph-world'), sky: $('#graph-sky'), map: $('#graph-map'),
    onSelect: id => selectGraphNode(id),
    onBackground: () => { if (state.focusId) clearGraphFocus(); }
  });
  return cosmos;
}

function graphNotes() {
  return state.notes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, GRAPH_LIMIT);
}

function renderGraph(forceFit) {
  const c = ensureCosmos();
  if (!c) return;
  const notes = graphNotes();
  const sig = notes.map(n => [n.id, n.title, (n.tags || []).join(','), kindOf(n), (n.body || '').length > 360 || /##\s*判断/.test(n.body || '')].join(':')).sort().join('|')
    + '#' + state.links.map(l => l.fromId + '>' + l.toId).sort().join(',');
  const changed = sig !== graphSig || !cosmosModel;
  if (changed) {
    graphSig = sig;
    cosmosModel = layoutCosmos(notes, state.links, kindOf);
    c.setModel(cosmosModel);
  }
  const s = cosmosModel.stats;
  $('#graph-empty')?.classList.toggle('hidden', s.stars > 0);
  if (state.focusId && !cosmosModel.stars.some(st => st.id === state.focusId)) {
    const outside = state.notes.some(n => n.id === state.focusId);
    clearGraphFocus();
    if (outside) api.toast(`这条笔记不在星海里。星海只点亮最近 ${GRAPH_LIMIT} 条。`);
  } else if (state.focusId && !$('#graph-card')?.classList.contains('hidden')) {
    fillGraphCard(state.focusId);
  }
  c.setFocus(state.focusId);
  c.setActive(!!$('#pane-graph')?.classList.contains('on'));
  if (forceFit || (changed && !c.userMoved)) c.fit(!changed);
}

function clearGraphFocus() {
  state.focusId = null;
  cosmos?.setFocus(null);
  $('#graph-card')?.classList.add('hidden');
}

function selectGraphNode(id, center = false) {
  const c = ensureCosmos();
  if (!c) return;
  if (!cosmosModel?.stars.some(s => s.id === id)) renderGraph(false);
  state.focusId = id;
  c.setFocus(id);
  if (!fillGraphCard(id)) return;
  c.reveal(id, center);
}

function fillGraphCard(id) {
  const card = $('#graph-card');
  const note = state.notes.find(n => n.id === id);
  const star = cosmosModel?.stars.find(s => s.id === id);
  if (!card || !note || !star) return false;
  const fresh = card.classList.contains('hidden');
  card.classList.remove('hidden');
  if (fresh) { card.style.animation = 'none'; void card.offsetWidth; card.style.animation = ''; }
  card.style.setProperty('--h', star.hue);
  card.replaceChildren();
  const top = h('div', 'gc-top');
  const cls = h('span', 'gc-class mag-' + star.mag, `${magLabel(star.mag)} · ${star.frontier ? '未测绘暗域' : star.sector + ' 星域'}`);
  const close = h('button', 'gc-close');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭');
  close.title = '关闭';
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/></svg>';
  close.onclick = () => {
    const btn = [...document.querySelectorAll('#graph-world .gnode')].find(b => b.dataset.id === id);
    clearGraphFocus();
    btn?.focus({ preventScroll: true });
  };
  top.append(cls, close);
  card.append(top, h('strong', 'gc-title', note.title || '未命名'));
  const preview = (note.quote || note.body || '').replace(/\s+/g, ' ').trim();
  if (preview) card.append(h('p', 'gc-preview', preview.slice(0, 160)));
  const meta = h('div', 'gc-meta');
  for (const tag of (note.tags || []).slice(0, 4)) meta.append(h('span', 'gc-tag', '#' + tag));
  meta.append(h('span', 'gc-links', star.links ? `${star.links} 条航线` : '尚无航线'));
  if (note.bookTitle) meta.append(h('span', 'gc-src', '《' + note.bookTitle + '》'));
  card.append(meta);
  const row = h('div', 'gc-actions');
  const act = (label, cls, fn) => { const b = h('button', cls, label); b.type = 'button'; b.onclick = fn; row.append(b); return b; };
  act('编辑', 'gc-primary', () => { showPane('knowledge'); openEditor(note.id); });
  if (note.bookId && note.passageId) act('跃迁原文', '', () => api.openPassage(note.bookId, note.passageId));
  act('聚焦邻域', '', () => cosmos?.focusNeighborhood(note.id));
  act('问 AI', '', () => openAssistant({
    title: '问 AI',
    quote: (note.quote || note.body || note.title || '').trim(),
    context: `星海 · ${star.frontier ? '未测绘暗域' : star.sector + ' 星域'} · 「${note.title || '未命名'}」`,
    bookId: note.bookId || null,
    bookTitle: note.bookTitle || ''
  }));
  card.append(row);
  return true;
}

export function fitGraph() {
  const c = ensureCosmos();
  if (!c) return;
  c.resize();
  c.fit(false);
}

function zoomBy(factor) { ensureCosmos()?.zoomBy(factor); }

export function setGraphSearch(open) {
  const row = $('#graph-search-row');
  if (!row) return;
  row.hidden = !open;
  if (open) $('#graph-search')?.focus({ preventScroll: true });
}

let aiToken = 0;
export function openAssistant(opts) {
  const mask = $('#ai-mask');
  if (!mask) return;
  const quote = String(opts?.quote || '').trim();
  if (!quote) { api.toast('没有可以解释的文字'); return; }
  const token = ++aiToken;
  state.ai = { ...opts, quote, answer: '', points: extractKeyPoints(quote), token };
  $('#ai-title').textContent = 'AI 解释';
  $('#ai-quote').textContent = quote.length > 280 ? quote.slice(0, 280) + '…' : quote;
  const body = $('#ai-body');
  body.replaceChildren();
  const list = h('ul', 'points');
  for (const point of state.ai.points) list.append(h('li', '', point));
  if (!aiConfigured()) {
    body.append(h('p', 'ai-banner', '还没有配置模型。下面是这台设备直接抽出的要点，不需要密钥，也不会把文字发出去。'));
    const open = h('button', 'btn ghost', '打开 AI 设置');
    open.type = 'button';
    open.onclick = () => { mask.classList.add('hidden'); openAiSettings(); };
    body.append(open);
  } else {
    const wait = h('p', 'ai-wait', '正在请模型解释…');
    body.append(wait);
    explainText(quote, opts.context || '').then(text => {
      if (token !== aiToken) return;
      wait.remove();
      state.ai.answer = text;
      const ans = h('div', 'ai-answer', text);
      body.prepend(ans);
    }).catch(err => {
      if (token !== aiToken) return;
      wait.textContent = '模型没有完成解释：' + (err.message || err) + '。下面仍是本地要点。';
    });
  }
  if (state.ai.points.length) {
    body.append(h('p', 'points-label', '本地要点'));
    body.append(list);
  }
  $('#ai-q').value = '';
  $('#ai-ask')?.classList.remove('hidden');
  mask.classList.remove('hidden');
  holdFocus(mask);
}

function openAiSettings() {
  const cfg = getAiConfig();
  $('#ai-base').value = cfg.baseUrl || '';
  $('#ai-model').value = cfg.model || '';
  $('#ai-key').value = '';
  $('#ai-key').placeholder = cfg.apiKey ? '已保存在这台设备，留空则不修改' : '只保存在这台设备';
  $('#ai-settings-status').textContent = cfg.apiKey ? '这台设备上已经有一把密钥。' : '还没有密钥。不填写也可以继续阅读，解释会使用本地要点。';
  const sheet = $('#settings-mask');
  sheet.classList.remove('hidden');
  holdFocus(sheet);
}

const focusReturn = new WeakMap();
function focusable(root) {
  return [...root.querySelectorAll('button, input, textarea, select, a[href]')].filter(el => !el.disabled && !el.closest('.hidden'));
}
function holdFocus(mask) {
  if (document.activeElement && !mask.contains(document.activeElement)) focusReturn.set(mask, document.activeElement);
  mask.onkeydown = e => {
    if (e.key !== 'Tab') return;
    const list = focusable(mask);
    if (!list.length) return;
    const index = list.indexOf(document.activeElement);
    const next = e.shiftKey ? (index <= 0 ? list.length - 1 : index - 1) : (index === list.length - 1 || index < 0 ? 0 : index + 1);
    if (e.shiftKey ? index <= 0 : index === list.length - 1 || index < 0) {
      e.preventDefault();
      list[next].focus();
    }
  };
  setTimeout(() => focusable(mask)[0]?.focus(), 30);
}
function releaseFocus(mask) {
  if (!mask) return;
  mask.onkeydown = null;
  const prev = focusReturn.get(mask);
  if (prev?.focus) prev.focus();
}
export function dismissAssistant() {
  const settings = $('#settings-mask');
  if (settings && !settings.classList.contains('hidden')) {
    settings.classList.add('hidden');
    releaseFocus(settings);
    return true;
  }
  const ai = $('#ai-mask');
  if (ai && !ai.classList.contains('hidden')) {
    aiToken++;
    ai.classList.add('hidden');
    releaseFocus(ai);
    return true;
  }
  return false;
}

async function saveAssistantNote() {
  const ai = state.ai;
  if (!ai) return;
  const points = (ai.points || []).map(p => '· ' + p).join('\n');
  const body = ai.answer || points;
  if (!body) { api.toast('没有可以保存的内容'); return; }
  const src = state.notes.find(n => ai.linkTo ? n.id === ai.linkTo : (ai.bookId && n.bookId === ai.bookId && n.quote === ai.quote));
  const note = await createNote({
    title: makeTitle(ai.answer || ai.quote),
    body, quote: ai.quote,
    tags: suggestTags(ai.quote + ' ' + body),
    bookId: ai.bookId || null,
    bookTitle: ai.bookTitle || '',
    kind: 'note',
    linkTo: src?.id || null
  });
  $('#ai-mask').classList.add('hidden');
  await refreshWorkspace();
  if ($('#library').classList.contains('active')) {
    showPane('knowledge');
    openEditor(note.id);
  }
  api.toast('已存入知识库');
}

export function workspaceHandleBack() {
  if (!$('#library')?.classList.contains('active')) return false;
  if ($('#note-editor') && !$('#note-editor').classList.contains('hidden')) { closeEditor(); return true; }
  if ($('#pane-knowledge')?.classList.contains('on') && $('#k-find-bar') && !$('#k-find-bar').hidden) {
    setKnowledgeFind(false);
    return true;
  }
  if ($('#graph-card') && !$('#graph-card').classList.contains('hidden')) {
    clearGraphFocus();
    return true;
  }
  if ($('#pane-graph')?.classList.contains('on') && $('#graph-search-row') && !$('#graph-search-row').hidden) {
    $('#graph-search').value = '';
    setGraphSearch(false);
    return true;
  }
  const onShelf = $('#pane-shelf')?.classList.contains('on');
  if (!onShelf) { showPane('shelf', { whisper: true }); return true; }
  return false;
}

async function exportOutline() {
  const notes = filteredNotes();
  if (!notes.length) { api.toast('没有可以导出的笔记'); return; }
  const md = notes.map(note => {
    const tags = (note.tags || []).map(tag => '#' + tag).join(' ');
    return ['## ' + (note.title || '未命名'), tags, note.quote ? '> ' + note.quote : '', note.body || ''].filter(Boolean).join('\n\n');
  }).join('\n\n---\n\n');
  const ok = await api.copyText(md);
  api.toast(ok ? '已复制大纲，可以贴进写作' : '复制失败');
}

export function initWorkspace(nextApi) {
  api = { ...api, ...nextApi };
  document.querySelectorAll('[data-pane]').forEach(btn => {
    btn.addEventListener('click', () => showPane(btn.dataset.pane));
  });
  $('#btn-new-note')?.addEventListener('click', () => { showPane('knowledge'); openEditor(null); });
  $('#btn-new-decision')?.addEventListener('click', async () => {
    const note = await createNote({
      title: '一次判断',
      kind: 'note',
      tags: [],
      body: '## 问题\n\n\n## 手里的材料\n\n\n## 判断\n\n'
    });
    await refreshWorkspace();
    showPane('knowledge');
    openEditor(note.id);
  });
  $('#btn-export-notes')?.addEventListener('click', () => exportOutline());
  $('#note-search')?.addEventListener('input', e => { state.filter.q = e.target.value; renderNotes(); });
  $('#note-search-clear')?.addEventListener('click', () => {
    $('#note-search').value = '';
    state.filter.q = '';
    renderNotes();
    $('#note-search').focus({ preventScroll: true });
  });
  $('#btn-k-find-close')?.addEventListener('click', () => setKnowledgeFind(false));
  $('#k-filter-chip')?.addEventListener('click', () => {
    state.filter.q = ''; state.filter.kind = 'all'; state.filter.tag = '';
    if ($('#note-search')) $('#note-search').value = '';
    renderNotes();
  });
  $('#btn-appearance')?.addEventListener('click', () => nextApi.cycleAppearance?.());
  $('#btn-ai-settings')?.addEventListener('click', () => openAiSettings());
  $('#ai-close')?.addEventListener('click', () => dismissAssistant());
  $('#ai-save')?.addEventListener('click', () => saveAssistantNote());
  $('#ai-ask')?.addEventListener('submit', async e => {
    e.preventDefault();
    const question = $('#ai-q').value.trim();
    if (!question) return;
    if (!aiConfigured()) { api.toast('先在 AI 设置里保存密钥'); openAiSettings(); return; }
    const token = state.ai?.token;
    const slot = h('p', 'ai-wait', '正在回答…');
    $('#ai-body').prepend(slot);
    try {
      const text = await askText(question, state.ai?.quote || '', state.ai?.context || '');
      if (token !== aiToken) { slot.remove(); return; }
      slot.remove();
      const block = h('div', 'ai-answer');
      block.append(h('strong', '', question), document.createElement('br'));
      block.append(document.createTextNode(text));
      $('#ai-body').prepend(block);
      state.ai.answer = (state.ai.answer ? state.ai.answer + '\n\n' : '') + question + '\n' + text;
    } catch (err) {
      if (token !== aiToken) return;
      slot.textContent = '没有得到回答：' + (err.message || err);
    }
  });
  $('#ai-settings')?.addEventListener('submit', e => {
    e.preventDefault();
    const typed = $('#ai-key').value.trim();
    const saved = saveAiConfig({
      baseUrl: $('#ai-base').value.trim(),
      model: $('#ai-model').value.trim(),
      apiKey: typed || null
    });
    $('#ai-key').value = '';
    $('#ai-settings-status').textContent = saved.hasKey ? '已保存。密钥只在这台设备上。' : '已保存接口和模型。还没有密钥。';
    api.toast('AI 设置已保存');
  });
  $('#ai-settings-cancel')?.addEventListener('click', () => dismissAssistant());
  $('#ai-settings-clear')?.addEventListener('click', () => {
    clearAiKey();
    $('#ai-key').value = '';
    $('#ai-key').placeholder = '只保存在这台设备';
    $('#ai-settings-status').textContent = '已清除这台设备上的密钥。';
    api.toast('已清除密钥');
  });
  $('#ai-settings-test')?.addEventListener('click', async () => {
    const status = $('#ai-settings-status');
    const typed = $('#ai-key').value.trim();
    const saved = getAiConfig();
    const trial = {
      baseUrl: $('#ai-base').value.trim() || saved.baseUrl,
      model: $('#ai-model').value.trim() || saved.model,
      apiKey: typed || saved.apiKey
    };
    if (!trial.apiKey) { status.textContent = '请先填写密钥。测试不会把它保存下来。'; return; }
    status.textContent = '正在测试…密钥不会因此保存。';
    try {
      const text = await testAi(trial);
      status.textContent = '测试成功：' + text.slice(0, 40) + (typed ? '。要留下这把密钥，请再点保存。' : '');
    } catch (err) {
      status.textContent = '测试没有成功：' + (err.message || err);
    }
  });
  $('#graph-reset')?.addEventListener('click', () => ensureCosmos()?.fit(true));
  $('#btn-graph-search-close')?.addEventListener('click', () => {
    $('#graph-search').value = '';
    clearGraphFocus();
    setGraphSearch(false);
  });
  $('#graph-search')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { clearGraphFocus(); return; }
    renderGraph(false);
    const stars = cosmosModel?.stars || [];
    const hit = stars.find(s => s.title.toLowerCase().startsWith(q))
      || stars.find(s => s.title.toLowerCase().includes(q))
      || stars.find(s => s.tags.some(t => t.toLowerCase().includes(q)))
      || stars.find(s => s.sector.toLowerCase().includes(q));
    if (hit) selectGraphNode(hit.id, true);
  });
  $('#graph-tilt')?.addEventListener('click', e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false');
    const lbl = e.currentTarget.querySelector('.menu-label');
    if (lbl) lbl.textContent = on ? '平视星图' : '2.5D 立体';
    ensureCosmos()?.setTilt(on);
  });
  refreshWorkspace().catch(err => console.warn(err));
}
