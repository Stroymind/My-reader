// 手动分组的卡片堆。只存在 localStorage（rr-stacks），不改 IndexedDB 里的书。
// 一本书最多属于一个卡片堆；成员少于两本的卡片堆会自动解散，书本身不受影响。
const KEY = 'rr-stacks';
const NAME_MAX = 40;

function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function clean(raw) {
  const out = [];
  const owned = new Set();
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.stacks) ? raw.stacks : [];
  for (const s of list) {
    if (!s || typeof s.id !== 'string' || !/^[\w-]{1,40}$/.test(s.id)) continue;
    const ids = [];
    for (const id of Array.isArray(s.bookIds) ? s.bookIds : []) {
      if (typeof id !== 'string' || !id || owned.has(id)) continue;
      owned.add(id);
      ids.push(id);
    }
    if (ids.length < 2) { ids.forEach(id => owned.delete(id)); continue; }
    out.push({
      id: s.id,
      name: normalizeName(s.name) || '卡片堆',
      bookIds: ids,
      collapsed: s.collapsed !== false,
      createdAt: Number(s.createdAt) || 0
    });
  }
  return out;
}

export function normalizeName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function listStacks() {
  try { return clean(JSON.parse(localStorage.getItem(KEY) || 'null')); }
  catch { return []; }
}

function save(list) {
  const next = clean(list);
  try {
    if (next.length) localStorage.setItem(KEY, JSON.stringify({ v: 1, stacks: next }));
    else localStorage.removeItem(KEY);
  } catch (err) { console.warn(err); }
  return next;
}

function without(list, ids) {
  const drop = new Set(ids);
  return list.map(s => ({ ...s, bookIds: s.bookIds.filter(id => !drop.has(id)) }));
}

export function getStack(id) { return listStacks().find(s => s.id === id) || null; }
export function stackOfBook(bookId) { return listStacks().find(s => s.bookIds.includes(bookId)) || null; }

export function defaultStackName(list = listStacks()) {
  const taken = new Set(list.map(s => s.name));
  for (let n = list.length + 1; ; n++) if (!taken.has('卡片堆 ' + n)) return '卡片堆 ' + n;
}

// 新建：书会从原来的卡片堆里移过来。
export function createStack(name, bookIds) {
  const ids = [...new Set((bookIds || []).filter(id => typeof id === 'string' && id))];
  if (ids.length < 2) return null;
  const list = without(listStacks(), ids);
  const stack = { id: uid(), name: normalizeName(name) || defaultStackName(list), bookIds: ids, collapsed: true, createdAt: Date.now() };
  list.push(stack);
  save(list);
  return getStack(stack.id);
}

export function renameStack(id, name) {
  const next = normalizeName(name);
  if (!next) return null;
  save(listStacks().map(s => (s.id === id ? { ...s, name: next } : s)));
  return getStack(id);
}

export function addToStack(id, bookIds) {
  const ids = (bookIds || []).filter(x => typeof x === 'string' && x);
  const list = without(listStacks(), ids);
  const target = list.find(s => s.id === id);
  if (!target) return null;
  target.bookIds = [...target.bookIds, ...ids.filter(x => !target.bookIds.includes(x))];
  save(list);
  return getStack(id);
}

// 移出卡片堆，不删除书。
export function removeFromStacks(bookIds) {
  return save(without(listStacks(), bookIds || []));
}

export function dissolveStack(id) {
  return save(listStacks().filter(s => s.id !== id));
}

export function setStackCollapsed(id, collapsed) {
  save(listStacks().map(s => (s.id === id ? { ...s, collapsed: !!collapsed } : s)));
}

// 只保留仍在书库里的书。
export function reconcileStacks(liveIds) {
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
  const list = listStacks();
  const next = list.map(s => ({ ...s, bookIds: s.bookIds.filter(id => live.has(id)) }));
  const changed = next.some((s, i) => s.bookIds.length !== list[i].bookIds.length);
  return changed ? save(next) : list;
}
