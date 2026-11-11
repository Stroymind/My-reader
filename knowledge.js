// 知识库：笔记、标签、笔记之间的关联。划线仍记在书上，这里做一份可编辑的投影。
import { db } from './db.js';

const STOP = new Set(('的 了 和 与 或 在 是 我 你 他 她 它 这 那 就 也 都 而 及 被 把 从 对 以 并 其 等 不 没 很 又 还 但 却 吧 吗 呢 啊 着 过 地 得 一个 我们 他们 她们 没有 不是 可以 这个 那个 因为 所以 如果 但是 然后 已经 还是 什么 怎么 自己 以及 或者 一些 进行 通过 这样 那种 一种 这些 那些 它们 就是 不是 不会 不能 这个 这里 那里 时候 开始 出来 起来 下去 the and that with from this have were been your into about there their which would could should').split(/\s+/));

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

export function parseTags(value) {
  const seen = new Set();
  const out = [];
  for (const raw of String(value || '').split(/[,，、\s#]+/)) {
    const tag = raw.trim().replace(/^#+/, '');
    if (!tag || tag.length > 16 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

export function makeTitle(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '未命名';
  const first = (clean.split(/[。！？!?；;\n]/).map(s => s.trim()).find(Boolean) || clean);
  return first.length > 22 ? first.slice(0, 22) + '…' : first;
}

export function suggestTags(text) {
  const picked = [];
  const seen = new Set();
  const take = (tag) => {
    const t = String(tag || '').trim();
    if (t.length < 2 || t.length > 8 || STOP.has(t) || seen.has(t)) return;
    if (picked.some(p => p.includes(t) || t.includes(p))) return;
    seen.add(t);
    picked.push(t);
  };
  const clauses = String(text || '').split(/[\s，。！？、；,.!?;:："“”「」『』（）()[\]【】]+/);
  for (const clause of clauses) {
    const bits = clause.split(/的|了|是|在|和|与|或|以及|一个|一种|我们|可以|这个|因为|所以|如果|但是/)
      .map(s => s.replace(/[^\u4e00-\u9fff]/g, ''))
      .filter(s => s.length >= 2 && s.length <= 8);
    for (const bit of bits) {
      take(bit);
      if (picked.length >= 3) return picked;
    }
    if (bits.length) continue;
    for (const word of clause.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []) {
      if (STOP.has(word)) continue;
      take(word);
      if (picked.length >= 3) return picked;
    }
  }
  return picked;
}

export function extractKeyPoints(text) {
  const parts = String(text || '')
    .split(/[\n。！？!?；;]+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 6 && s.length <= 90);
  const out = [];
  for (const part of parts) {
    if (out.some(u => u.includes(part) || part.includes(u))) continue;
    out.push(part);
    if (out.length >= 4) break;
  }
  if (!out.length) {
    const fallback = String(text || '').replace(/\s+/g, ' ').trim();
    if (fallback) out.push(fallback.slice(0, 90));
  }
  return out;
}

export async function listNotes() {
  const all = (await db.all('notes')) || [];
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export async function listLinks() {
  return (await db.all('links')) || [];
}

async function syncAutoLinks(note) {
  const notes = await listNotes();
  const byTitle = new Map(notes.filter(n => n.id !== note.id && n.title).map(n => [n.title, n.id]));
  const want = new Set();
  const re = /\[\[([^\]\n]{1,40})\]\]/g;
  const hay = `${note.title || ''}\n${note.body || ''}`;
  let match;
  while ((match = re.exec(hay))) {
    const id = byTitle.get(match[1].trim());
    if (id) want.add(id);
  }
  const links = await listLinks();
  for (const link of links) {
    if (!link.auto || link.fromId !== note.id) continue;
    if (!want.has(link.toId)) await db.del('links', link.id);
    else want.delete(link.toId);
  }
  for (const toId of want) {
    await db.put('links', { id: uid(), fromId: note.id, toId, auto: true, createdAt: Date.now() });
  }
}

export async function linkNotes(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return null;
  const links = await listLinks();
  const hit = links.find(l => (l.fromId === fromId && l.toId === toId) || (l.fromId === toId && l.toId === fromId));
  if (hit) return hit;
  const link = { id: uid(), fromId, toId, auto: false, createdAt: Date.now() };
  await db.put('links', link);
  return link;
}

export async function unlink(id) {
  if (id) await db.del('links', id);
}

function blankNote(partial = {}) {
  const now = Date.now();
  return {
    id: partial.id || uid(),
    title: partial.title || '未命名',
    body: partial.body || '',
    quote: partial.quote || '',
    tags: partial.tags || [],
    bookId: partial.bookId || null,
    bookTitle: partial.bookTitle || '',
    passageId: partial.passageId || null,
    kind: partial.kind || 'note',
    concept: !!partial.concept,
    createdAt: partial.createdAt || now,
    updatedAt: now
  };
}

export async function createNote(partial = {}) {
  const note = blankNote(partial);
  if (!partial.tags?.length) note.tags = suggestTags(`${note.title} ${note.quote} ${note.body}`);
  await db.put('notes', note);
  if (partial.linkTo) await linkNotes(note.id, partial.linkTo);
  await syncAutoLinks(note);
  return note;
}

export async function saveNote(note) {
  const next = { ...note, tags: note.tags || [], updatedAt: Date.now() };
  await db.put('notes', next);
  await syncAutoLinks(next);
  return next;
}

export async function deleteNote(id) {
  const notes = await listNotes();
  const note = notes.find(n => n.id === id);
  if (!note) return null;
  if (note.passageId && note.bookId) {
    await db.update('books', note.bookId, rec => {
      rec.highlights = (rec.highlights || []).filter(h => h.id !== note.passageId);
      return rec;
    });
  }
  await db.del('notes', id);
  const links = await listLinks();
  for (const link of links) {
    if (link.fromId === id || link.toId === id) await db.del('links', link.id);
  }
  return note;
}

export async function upsertFromPassage(book, item) {
  if (!book || !item?.id || !item.text) return null;
  const notes = await listNotes();
  const existing = notes.find(n => n.passageId === item.id && n.bookId === book.id);
  if (existing) {
    existing.quote = item.text;
    existing.bookTitle = book.title || existing.bookTitle || '';
    existing.kind = item.kind || existing.kind;
    await db.put('notes', existing);
    return existing;
  }
  return createNote({
    title: makeTitle(item.note || item.text),
    body: item.note || '',
    quote: item.text,
    tags: item.tags?.length ? item.tags : suggestTags(`${item.text} ${item.note || ''}`),
    bookId: book.id,
    bookTitle: book.title || '',
    passageId: item.id,
    kind: item.kind || 'excerpt',
    createdAt: item.createdAt || Date.now()
  });
}

export async function syncBook(book) {
  if (!book) return;
  const notes = await listNotes();
  const alive = new Set((book.highlights || []).map(h => h.id));
  for (const note of notes) {
    if (note.bookId === book.id && note.passageId && !alive.has(note.passageId)) await deleteNote(note.id);
  }
  for (const item of book.highlights || []) await upsertFromPassage(book, item);
}

export async function forgetBook(bookId) {
  const notes = await listNotes();
  for (const note of notes) {
    if (note.bookId !== bookId) continue;
    note.passageId = null;
    await db.del('notes', note.id);
    const links = await listLinks();
    for (const link of links) {
      if (link.fromId === note.id || link.toId === note.id) await db.del('links', link.id);
    }
  }
}

export async function backfillFromBooks() {
  const books = (await db.all('books')) || [];
  for (const book of books) {
    for (const item of book.highlights || []) await upsertFromPassage(book, item);
  }
}
