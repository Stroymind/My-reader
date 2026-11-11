// 书库之外的工作台：知识列表、笔记编辑、图谱、AI 面板。
import { aiConfigured, askText, clearAiKey, explainText, getAiConfig, saveAiConfig, testAi } from './ai.js';
import {
  createNote, deleteNote, extractKeyPoints, linkNotes, listLinks, listNotes,
  makeTitle, parseTags, saveNote, suggestTags, unlinkPair
} from './knowledge.js';

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

export function showPane(name) {
  if (!['shelf', 'knowledge', 'graph'].includes(name)) name = 'shelf';
  document.querySelectorAll('.pane').forEach(pane => pane.classList.toggle('on', pane.id === 'pane-' + name));
  document.querySelectorAll('[data-pane]').forEach(btn => {
    const on = btn.dataset.pane === name;
    btn.classList.toggle('on', on);
    if (btn.getAttribute('role') === 'tab') btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (name === 'graph') requestAnimationFrame(() => renderGraph(false));
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
}

function emptyKnowledge() {
  const wrap = h('div', 'empty knowledge-empty');
  wrap.append(
    h('p', '', '知识库还是空的'),
    h('p', 'hint', '在书里长按一段文字，划线、批注或摘录。它们会留在这里，也可以直接写一条和书无关的笔记。')
  );
  const flow = h('ol', 'flow');
  for (const [name, sub] of [['阅读', 'EPUB · PDF · TXT'], ['标注', '划线 · 批注 · 摘录'], ['积累', '笔记与标签'], ['关联', '把笔记连起来'], ['理解', '解释 · 问答'], ['应用', '导出大纲']]) {
    const li = h('li');
    li.append(h('b', '', name), h('span', '', sub));
    flow.appendChild(li);
  }
  wrap.appendChild(flow);
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

function hash(text) {
  let hsh = 2166136261;
  for (const ch of String(text)) hsh = Math.imul(hsh ^ ch.codePointAt(0), 16777619);
  return hsh >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function graphModel() {
  const notes = state.notes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 120);
  const ids = new Set(notes.map(n => n.id));
  const edges = [];
  const seen = new Set();
  const add = (a, b, kind) => {
    if (!a || !b || a === b || !ids.has(a) || !ids.has(b)) return;
    const key = [a, b].sort().join('~') + kind;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b, kind });
  };
  for (const link of state.links) add(link.fromId, link.toId, 'link');
  const byTag = new Map();
  for (const note of notes) for (const tag of note.tags || []) {
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(note);
  }
  for (const members of byTag.values()) {
    if (members.length < 2) continue;
    const group = members.slice(0, 8);
    if (group.length > 6) {
      for (const note of group.slice(1)) add(group[0].id, note.id, 'tag');
    } else {
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) add(group[i].id, group[j].id, 'tag');
    }
  }
  const rnd = mulberry32(hash(notes.map(n => n.id).join('|')));
  const rad = Math.min(300, 120 + notes.length * 28);
  const nodes = notes.map((note, i) => {
    const ang = notes.length ? (i / notes.length) * Math.PI * 2 : 0;
    return {
      id: note.id, title: note.title || '未命名', kind: kindOf(note),
      x: 500 + Math.cos(ang) * rad + (rnd() - 0.5) * 24,
      y: 340 + Math.sin(ang) * rad * 0.72 + (rnd() - 0.5) * 24
    };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (nodes.length === 1) { nodes[0].x = 500; nodes[0].y = 340; }
  else {
    for (let step = 0; step < 160; step++) {
      for (const n of nodes) { n.vx = (n.vx || 0) + (500 - n.x) * 0.012; n.vy = (n.vy || 0) + (340 - n.y) * 0.012; }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        const dist = Math.hypot(dx, dy) || 1;
        const force = 9800 / (dist * dist) + (dist < 190 ? (190 - dist) * 0.08 : 0);
        const fx = force * dx / dist, fy = force * dy / dist;
        nodes[i].vx = (nodes[i].vx || 0) - fx; nodes[i].vy = (nodes[i].vy || 0) - fy;
        nodes[j].vx = (nodes[j].vx || 0) + fx; nodes[j].vy = (nodes[j].vy || 0) + fy;
      }
      for (const edge of edges) {
        const a = byId.get(edge.a), b = byId.get(edge.b);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1;
        const force = (dist - (edge.kind === 'link' ? 230 : 280)) * 0.015;
        a.vx = (a.vx || 0) + dx / dist * force; a.vy = (a.vy || 0) + dy / dist * force;
        b.vx = (b.vx || 0) - dx / dist * force; b.vy = (b.vy || 0) - dy / dist * force;
      }
      for (const n of nodes) {
        n.vx = (n.vx || 0) * 0.78; n.vy = (n.vy || 0) * 0.78;
        n.x = Math.max(70, Math.min(930, n.x + n.vx));
        n.y = Math.max(50, Math.min(630, n.y + n.vy));
      }
    }
  }
  return { nodes, edges, truncated: state.notes.length > notes.length };
}

let graphSig = '';
function renderGraph(forceFit) {
  const stage = $('#graph-stage');
  const world = $('#graph-world');
  const empty = $('#graph-empty');
  const title = $('#graph-title');
  if (!stage || !world) return;
  const model = graphModel();
  const sig = model.nodes.map(n => n.id + n.kind).join(',') + '|' + model.edges.map(e => e.a + e.b + e.kind).join(',');
  if (title) {
    const focus = state.notes.find(n => n.id === state.focusId);
    title.textContent = focus ? '围绕「' + (focus.title || '未命名') + '」' : '个人知识网络';
  }
  if (state.focusId && !model.nodes.some(n => n.id === state.focusId)) {
    const outside = state.notes.some(n => n.id === state.focusId);
    state.focusId = null;
    $('#graph-card')?.classList.add('hidden');
    if (outside) api.toast('这条笔记不在当前图谱里。图谱只画最近 120 条。');
  }
  if (!model.nodes.length) {
    world.replaceChildren();
    empty?.classList.remove('hidden');
    $('#graph-card')?.classList.add('hidden');
    return;
  }
  empty?.classList.add('hidden');
  const near = neighborSet(state.focusId, model.edges);
  world.replaceChildren();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'graph-edges');
  svg.setAttribute('viewBox', '0 0 1000 680');
  for (const edge of model.edges) {
    const a = model.nodes.find(n => n.id === edge.a);
    const b = model.nodes.find(n => n.id === edge.b);
    if (!a || !b) continue;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    const dim = state.focusId && !(near.has(edge.a) && near.has(edge.b));
    line.setAttribute('class', 'edge ' + edge.kind + (dim ? ' dim' : ''));
    svg.appendChild(line);
  }
  world.appendChild(svg);
  for (const node of model.nodes) {
    const btn = h('button', 'gnode kind-' + node.kind + (node.id === state.focusId ? ' on' : '') + (state.focusId && !near.has(node.id) ? ' dim' : ''));
    btn.type = 'button';
    btn.style.left = node.x + 'px';
    btn.style.top = node.y + 'px';
    btn.textContent = node.title.length > 12 ? node.title.slice(0, 12) + '…' : node.title;
    btn.onclick = e => { e.stopPropagation(); selectGraphNode(node.id); };
    world.appendChild(btn);
  }
  const changed = sig !== graphSig;
  graphSig = sig;
  if (forceFit || (changed && stage.dataset.fit !== '1')) requestAnimationFrame(fitGraph);
  if (model.truncated) stage.dataset.more = '1';
}

function neighborSet(id, edges) {
  const set = new Set(id ? [id] : []);
  if (!id) return set;
  for (const edge of edges) {
    if (edge.a === id) set.add(edge.b);
    if (edge.b === id) set.add(edge.a);
  }
  return set;
}

function selectGraphNode(id) {
  state.focusId = id;
  renderGraph(false);
  if (state.focusId !== id) return;
  const card = $('#graph-card');
  const note = state.notes.find(n => n.id === id);
  if (!card || !note) return;
  card.classList.remove('hidden');
  card.replaceChildren();
  card.append(h('span', 'kind', kindLabel(note)), h('strong', '', note.title || '未命名'));
  const preview = (note.quote || note.body || '').replace(/\s+/g, ' ').trim();
  if (preview) card.append(h('p', '', preview.slice(0, 140)));
  const row = h('div', 'card-actions');
  const open = h('button', 'btn primary', '打开笔记');
  open.type = 'button';
  open.onclick = () => { showPane('knowledge'); openEditor(note.id); };
  const center = h('button', 'btn ghost', '查看全部');
  center.type = 'button';
  center.onclick = () => { state.focusId = null; card.classList.add('hidden'); renderGraph(false); };
  row.append(open, center);
  if (note.bookId && note.passageId) {
    const back = h('button', 'btn ghost', '回到原文');
    back.type = 'button';
    back.onclick = () => api.openPassage(note.bookId, note.passageId);
    row.appendChild(back);
  }
  card.appendChild(row);
}

export function fitGraph() {
  const stage = $('#graph-stage');
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return;
  const nodes = [...stage.querySelectorAll('.gnode')];
  if (!nodes.length) {
    stage.style.setProperty('--gk', '0.8');
    stage.style.setProperty('--gx', '0px');
    stage.style.setProperty('--gy', '0px');
    stage.dataset.fit = '1';
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const x = parseFloat(node.style.left) || 0;
    const y = parseFloat(node.style.top) || 0;
    minX = Math.min(minX, x - 100);
    maxX = Math.max(maxX, x + 100);
    minY = Math.min(minY, y - 36);
    maxY = Math.max(maxY, y + 36);
  }
  const bw = Math.max(220, maxX - minX);
  const bh = Math.max(140, maxY - minY);
  const k = Math.min((rect.width - 72) / bw, (rect.height - 72) / bh, 1.65);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  stage.style.setProperty('--gk', String(Math.max(0.45, k)));
  stage.style.setProperty('--gx', ((500 - cx) * k) + 'px');
  stage.style.setProperty('--gy', ((340 - cy) * k) + 'px');
  stage.dataset.fit = '1';
}

function zoomBy(factor) {
  const stage = $('#graph-stage');
  if (!stage) return;
  const cur = parseFloat(stage.style.getPropertyValue('--gk')) || parseFloat(getComputedStyle(stage).getPropertyValue('--gk')) || 1;
  const next = Math.min(2.5, Math.max(0.4, cur * factor));
  const ratio = next / cur;
  stage.style.setProperty('--gk', String(next));
  stage.style.setProperty('--gx', (readPx('--gx') * ratio) + 'px');
  stage.style.setProperty('--gy', (readPx('--gy') * ratio) + 'px');
  stage.dataset.fit = '1';
}

function readPx(name) {
  const stage = $('#graph-stage');
  const raw = stage?.style.getPropertyValue(name) || '0';
  return parseFloat(raw) || 0;
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

function bindGraphPointer() {
  const stage = $('#graph-stage');
  if (!stage) return;
  let pan = null;
  stage.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('.gnode, .graph-card, .legend, button')) return;
    stage.classList.add('panning');
    pan = { x: e.clientX, y: e.clientY, gx: readPx('--gx'), gy: readPx('--gy'), id: e.pointerId };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (!pan || pan.id !== e.pointerId) return;
    stage.style.setProperty('--gx', (pan.gx + e.clientX - pan.x) + 'px');
    stage.style.setProperty('--gy', (pan.gy + e.clientY - pan.y) + 'px');
  });
  const end = e => {
    if (!pan || (e && pan.id !== e.pointerId)) return;
    pan = null;
    stage.classList.remove('panning');
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.08 : 0.92);
  }, { passive: false });
}

export function workspaceHandleBack() {
  if (!$('#library')?.classList.contains('active')) return false;
  if ($('#note-editor') && !$('#note-editor').classList.contains('hidden')) { closeEditor(); return true; }
  if ($('#graph-card') && !$('#graph-card').classList.contains('hidden')) {
    state.focusId = null;
    $('#graph-card').classList.add('hidden');
    renderGraph(false);
    return true;
  }
  const onShelf = $('#pane-shelf')?.classList.contains('on');
  if (!onShelf) { showPane('shelf'); return true; }
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
  $('#graph-in')?.addEventListener('click', () => zoomBy(1.16));
  $('#graph-out')?.addEventListener('click', () => zoomBy(1 / 1.16));
  $('#graph-reset')?.addEventListener('click', () => fitGraph());
  $('#graph-search')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { state.focusId = null; $('#graph-card')?.classList.add('hidden'); renderGraph(false); return; }
    const hit = state.notes.find(n => (n.title || '').toLowerCase().includes(q) || (n.tags || []).some(t => t.toLowerCase().includes(q)));
    if (hit) selectGraphNode(hit.id);
  });
  bindGraphPointer();
  window.addEventListener('resize', () => {
    if ($('#pane-graph')?.classList.contains('on')) fitGraph();
  });
  refreshWorkspace().catch(err => console.warn(err));
}
