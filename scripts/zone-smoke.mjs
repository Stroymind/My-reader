import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve, browserPath } from './browser-support.mjs';
const work = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(work, '..');
await fs.mkdir(path.resolve(root, 'test-results'), { recursive: true });
const server = await serve(root);
const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
const report = { version: '1.3.0', checks: [], errors: [], externalRequests: [], browser: await browser.version() };
try {
  const page = await browser.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith(server.base + '/')) {
      report.externalRequests.push(url.split('?')[0]); request.abort();
    } else request.continue();
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(server.base);
  await page.waitForFunction(() => window.__app);
  assert.equal(await page.title(), 'Zone');
  assert.equal(await page.$eval('h1', el => el.textContent), 'Zone');
  report.checks.push('Mobile startup and Zone heading/title');
  const ids = await page.evaluate(async () => {
    const k = await import('./knowledge.js');
    const a = await k.createNote({ title: 'Zone test A', body: 'Synthetic local note.', tags: ['test'] });
    const b = await k.createNote({ title: 'Zone test B', body: 'Link to [[Zone test A]].', tags: ['test'] });
    return { a: a.id, b: b.id, links: await k.listLinks(), notes: await k.listNotes() };
  });
  assert.equal(ids.notes.length, 2); assert.equal(ids.links.length, 1);
  await page.reload(); await page.waitForFunction(() => window.__app);
  assert.equal(await page.evaluate(async () => (await (await import('./knowledge.js')).listNotes()).length), 2);
  report.checks.push('Notes/tags persisted across reload; title link created');
  await page.evaluate(async () => { const w = await import('./workspace.js'); await w.refreshWorkspace(); });
  await page.$$eval('[data-pane="knowledge"]', buttons => buttons.find(b => b.offsetWidth > 0).click());
  assert.equal(await page.$$eval('#note-list .note-card', a => a.length), 2);
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-knowledge.png') });
  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('graph'); w.fitGraph(); });
  await page.waitForFunction(() => document.querySelectorAll('#graph-world .gnode').length === 2);
  report.checks.push('Knowledge list and graph render both notes');
  await page.evaluate(async ({a,b}) => {
    const k = await import('./knowledge.js');
    await k.unlinkPair(a,b);
    if ((await k.listLinks()).length) throw Error('Unlink left links');
    await k.linkNotes(a,b); await k.linkNotes(b,a);
    if ((await k.listLinks()).length !== 1) throw Error('Reverse duplicate');
    await k.deleteNote(a);
    if ((await k.listLinks()).length) throw Error('Delete left links');
  }, ids);
  report.checks.push('Unlink both directions, pair deduplication and deletion cleanup');
  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('shelf'); });
  await page.click('#btn-ai-settings');
  assert.equal(await page.$eval('#settings-mask', el => el.classList.contains('hidden')), false);
  await page.click('#ai-settings-cancel');
  assert.equal(await page.$eval('#settings-mask', el => el.classList.contains('hidden')), true);
  report.checks.push('AI settings dialog opens/closes without network calls');

  // ---- Full-width library list and manual overlapping-card stacks ----
  const LONG = '深度工作 Deep Work: Rules for Focused Success in a Distracted World（一个很长的中英混排书名，用来检查不会被截断）';
  await page.evaluate(async (long) => {
    localStorage.setItem('rr-hint-panes', '1');
    localStorage.setItem('rr-hint-select', '1');
    localStorage.removeItem('rr-stacks');
    const { db } = window.__app;
    const base = Date.now() - 100000;
    const mk = (id, title, author, type, progress, i) => ({ id, title, author, type, progress, addedAt: base + i * 1000, lastOpened: 0, pos: null, bookmarks: [], highlights: [] });
    const books = [
      mk('z-a', long, 'Cal Newport', 'epub', 0.42, 5),
      mk('z-b', '思考，快与慢 Thinking, Fast and Slow', '丹尼尔·卡尼曼', 'pdf', 0.1, 4),
      mk('z-c', '原则 Principles', 'Ray Dalio', 'txt', 0, 3),
      mk('z-d', 'Zettelkasten 卡片笔记写作法', 'Sönke Ahrens', 'txt', 0.75, 2),
      mk('z-e', '局外人 L’Étranger', 'Albert Camus', 'txt', 0, 1)
    ];
    for (const b of books) await db.put('books', b);
    const text = '第一章\n\n' + '这是一段只在本机测试里使用的中文正文，用来确认从卡片堆里打开一本书再返回时，列表的位置和焦点都还在。\n'.repeat(40);
    await db.put('files', { id: 'z-c', blob: new Blob([text], { type: 'text/plain' }) });
    await window.__app.renderLibrary();
  }, LONG);
  await page.waitForFunction(() => document.querySelectorAll('#grid .book').length === 5);
  const listShape = await page.evaluate(() => {
    const grid = document.querySelector('#grid');
    const gw = grid.getBoundingClientRect().width;
    const rows = [...grid.querySelectorAll('.book')];
    return {
      display: getComputedStyle(grid).display,
      dir: getComputedStyle(grid).flexDirection,
      gridClass: grid.className,
      allFull: rows.every(r => Math.abs(r.parentElement.getBoundingClientRect().width - gw) < 1),
      lefts: new Set(rows.map(r => Math.round(r.getBoundingClientRect().left))).size,
      clipped: [...grid.querySelectorAll('.book .t')].filter(t => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).map(t => t.textContent),
      longShown: [...grid.querySelectorAll('.book .t')].some(t => t.textContent.includes('一个很长的中英混排书名')),
      monogram: [...grid.querySelectorAll('.book .thumb .ph')].length === 5,
      meta: grid.querySelector('.book[data-id="z-a"] .a').textContent,
      bar: !!grid.querySelector('.book[data-id="z-a"] .pbar i')
    };
  });
  assert.equal(listShape.display, 'flex'); assert.equal(listShape.dir, 'column');
  assert.equal(listShape.gridClass.includes('book-grid'), false);
  assert.equal(listShape.allFull, true); assert.equal(listShape.lefts, 1);
  assert.deepEqual(listShape.clipped, []); assert.equal(listShape.longShown, true);
  assert.equal(listShape.monogram, true); assert.ok(listShape.meta.includes('EPUB') && listShape.meta.includes('Cal Newport'));
  assert.equal(listShape.bar, true);
  report.checks.push('Library renders one full-width row per book (single column, monogram, metadata, progress, unclipped mixed-language title)');

  const tap = async sel => { await page.$eval(sel, el => el.scrollIntoView({ block: 'center' })); await page.click(sel); };
  const stackState = () => page.evaluate(() => JSON.parse(localStorage.getItem('rr-stacks') || 'null'));
  const bookCount = () => page.evaluate(async () => (await window.__app.db.all('books')).length);
  const expanded = () => page.$eval('.stack-head', el => el.getAttribute('aria-expanded'));
  for (const id of ['z-a', 'z-b', 'z-c', 'z-d']) await tap(`#desk-list .desk-book[data-id="${id}"]`);
  assert.equal(await page.$eval('#manage-count', el => el.textContent), '已选 4 本');
  await tap('#btn-stack-picked');
  await page.waitForFunction(() => !document.querySelector('#stack-mask').classList.contains('hidden'));
  await page.$eval('#stack-name', el => { el.value = '研究 Research'; });
  await tap('#stack-save');
  await page.waitForFunction(() => document.querySelector('#stack-mask').classList.contains('hidden') && document.querySelector('[data-stack] .stack-name')?.textContent === '研究 Research');
  let saved = await stackState();
  assert.equal(saved.stacks.length, 1); assert.deepEqual([...saved.stacks[0].bookIds].sort(), ['z-a', 'z-b', 'z-c', 'z-d']);
  assert.equal(saved.stacks[0].collapsed, true);
  const stackId = saved.stacks[0].id;
  assert.equal(await expanded(), 'false');
  const collapsedShape = await page.evaluate(() => {
    const sec = document.querySelector('[data-stack]');
    const head = sec.querySelector('.stack-head');
    sec.scrollIntoView({ block: 'center' });
    const items = document.getElementById(head.getAttribute('aria-controls'));
    const card = sec.querySelector('.stack-card').getBoundingClientRect();
    const next = sec.nextElementSibling?.getBoundingClientRect();
    const hr = head.getBoundingClientRect();
    const hit = document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
    const parts = ['.stack-name', '.stack-preview', '.stack-count', '.stack-covers'].map(s => sec.querySelector(s).getBoundingClientRect());
    let collide = false;
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) collide = true;
    }
    const layer = getComputedStyle(sec.querySelector('.stack-card'), '::before');
    return {
      itemsHidden: items.hidden, rowsInside: items.querySelectorAll('.book').length,
      count: sec.querySelector('.stack-count').textContent, minis: sec.querySelectorAll('.stack-covers .mini').length,
      preview: sec.querySelector('.stack-preview').textContent,
      layer: layer.content !== 'none' && layer.position === 'absolute',
      gapBelow: next ? next.top - card.bottom : 99,
      headHit: head.contains(hit), collide,
      topRows: document.querySelectorAll('#grid > .row-wrap .book').length,
      headFocusable: head.tagName === 'BUTTON'
    };
  });
  assert.equal(collapsedShape.itemsHidden, true); assert.equal(collapsedShape.rowsInside, 0);
  assert.equal(collapsedShape.count, '4'); assert.equal(collapsedShape.minis, 3); assert.ok(collapsedShape.preview.length > 0);
  assert.equal(collapsedShape.layer, true); assert.ok(collapsedShape.gapBelow >= 14, 'offset cards must not overlap the next row');
  assert.equal(collapsedShape.headHit, true); assert.equal(collapsedShape.collide, false);
  assert.equal(collapsedShape.topRows, 1); assert.equal(collapsedShape.headFocusable, true);
  assert.equal(await bookCount(), 5);
  report.checks.push('Manual selection creates a named stack persisted in rr-stacks; collapsed front card (aria-expanded=false, count, preview, offset layers) is readable and non-colliding');

  const headTop = () => page.$eval('.stack-head', el => el.getBoundingClientRect().top - document.querySelector('#pane-shelf').getBoundingClientRect().top);
  await page.$eval('.stack-head', el => el.scrollIntoView({ block: 'center' }));
  const before = await headTop();
  await tap('.stack-head');
  await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'true');
  const after = await headTop();
  const openShape = await page.evaluate(() => {
    const head = document.querySelector('.stack-head');
    const items = document.getElementById(head.getAttribute('aria-controls'));
    const rows = [...items.querySelectorAll('.book')];
    const rects = rows.map(r => r.getBoundingClientRect());
    let overlap = false;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (rects[i].bottom > rects[j].top + 0.5 && rects[j].bottom > rects[i].top + 0.5) overlap = true;
    const focus = document.activeElement === head;
    const hits = rows.map(r => { r.scrollIntoView({ block: 'center' }); const c = r.getBoundingClientRect(); return document.elementFromPoint(c.left + 30, c.top + c.height / 2)?.closest('.book') === r; });
    return {
      hidden: items.hidden, rows: rows.length, overlap, hits,
      reader: document.querySelector('#reader').classList.contains('active'),
      focus,
      tools: [...document.querySelectorAll('.stack-tools button')].map(b => b.textContent)
    };
  });
  assert.equal(openShape.hidden, false); assert.equal(openShape.rows, 4); assert.equal(openShape.overlap, false);
  assert.deepEqual(openShape.hits, [true, true, true, true]); assert.equal(openShape.reader, false);
  assert.equal(openShape.focus, true); assert.deepEqual(openShape.tools, ['收起', '重命名', '解散']);
  assert.ok(Math.abs(after - before) < 1.5, `expand keeps the stack header anchored (${before} -> ${after})`);
  assert.equal((await stackState()).stacks[0].collapsed, false);
  report.checks.push('Tapping the stack header expands in place (aria-expanded=true) into independent full-width rows; no book opened; focus and scroll anchor kept');

  await tap('.stack-rename');
  await page.waitForFunction(() => !document.querySelector('#stack-mask').classList.contains('hidden'));
  await page.$eval('#stack-name', el => { el.value = '研究 Research 2026'; });
  await tap('#stack-save');
  await page.waitForFunction(() => document.querySelector('.stack-name')?.textContent === '研究 Research 2026');
  await tap('.row-wrap[data-anchor="book:z-d"] .row-out');
  await page.waitForFunction(() => document.querySelectorAll('.stack-items .book').length === 3 && !!document.querySelector('#grid > .row-wrap .book[data-id="z-d"]'));
  saved = await stackState();
  assert.deepEqual([...saved.stacks[0].bookIds].sort(), ['z-a', 'z-b', 'z-c']); assert.equal(saved.stacks[0].name, '研究 Research 2026');
  assert.equal(await bookCount(), 5);
  await tap('.stack-collapse');
  await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('stack-head')), true);
  assert.equal((await stackState()).stacks[0].collapsed, true);
  report.checks.push('Rename stack, remove a book from the stack (book kept), and collapse via separate 收起 button with focus returned to the header');

  await page.type('#search', 'Thinking');
  await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'true');
  const searchShape = await page.evaluate(() => ({
    ids: [...document.querySelectorAll('#grid .book')].map(b => b.dataset.id),
    kicker: document.querySelector('.stack-kicker').textContent
  }));
  assert.deepEqual(searchShape.ids, ['z-b']); assert.ok(searchShape.kicker.includes('1 本匹配'));
  assert.equal((await stackState()).stacks[0].collapsed, true, 'search must not change saved collapsed state');
  await tap('#search-chip');
  await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'false' && document.querySelectorAll('#grid .book').length === 2);
  assert.equal((await stackState()).stacks[0].collapsed, true);
  report.checks.push('Search surfaces a hidden member of a collapsed stack and restores the saved collapsed state when cleared');

  await page.type('#search', '原则');
  await page.waitForFunction(() => !!document.querySelector('.stack-items .book[data-id="z-c"]'));
  await tap('.stack-items .book[data-id="z-c"]');
  await page.waitForFunction(() => document.querySelector('#reader').classList.contains('active') && document.querySelector('#loading').classList.contains('hidden'));
  await page.evaluate(() => window.__app.closeBook());
  await page.waitForFunction(() => document.querySelector('#library').classList.contains('active') && !!document.querySelector('.stack-items .book[data-id="z-c"]'));
  const back = await page.evaluate(() => ({
    q: document.querySelector('#search').value,
    expanded: document.querySelector('.stack-head').getAttribute('aria-expanded'),
    focus: document.activeElement?.dataset?.id || null
  }));
  assert.deepEqual(back, { q: '原则', expanded: 'true', focus: 'z-c' });
  await tap('#search-chip');
  await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'false');
  report.checks.push('Opening a book from an expanded stack and returning keeps search text, expansion and focus');

  await tap('#desk-list .desk-book[data-id="z-c"]');
  await tap('#btn-delete-picked');
  await page.waitForFunction(async () => (await window.__app.db.all('books')).length === 4);
  await page.waitForFunction(() => document.querySelector('.stack-count')?.textContent === '2');
  saved = await stackState();
  assert.deepEqual([...saved.stacks[0].bookIds].sort(), ['z-a', 'z-b']);
  const apiCleanup = await page.evaluate(async () => {
    const s = await import('./stacks.js');
    const k = await import('./knowledge.js');
    const { db } = window.__app;
    await db.put('books', { id: 'z-f', title: '临时 Temp', author: '', type: 'txt', addedAt: 1, lastOpened: 0, highlights: [] });
    await db.put('books', { id: 'z-g', title: '临时二 Temp 2', author: '', type: 'txt', addedAt: 2, lastOpened: 0, highlights: [] });
    const made = s.createStack('临时堆', ['z-f', 'z-g']);
    await k.deleteBookBundle('z-f');
    const afterOne = s.listStacks().find(x => x.id === made.id);
    await k.deleteBookBundle('z-g');
    return { afterOne: afterOne ? afterOne.bookIds : null, survivors: s.listStacks().length, books: (await db.all('books')).length };
  });
  assert.equal(apiCleanup.afterOne, null, 'a stack left with one book dissolves'); assert.equal(apiCleanup.survivors, 1); assert.equal(apiCleanup.books, 4);
  await page.evaluate(() => window.__app.renderLibrary());
  report.checks.push('Deleting books (manage flow and deleteBookBundle) removes them from stack membership');

  await tap('.stack-head');
  await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'true');
  await tap('.stack-ungroup');
  await page.waitForFunction(() => !document.querySelector('[data-stack]') && document.querySelectorAll('#grid > .row-wrap .book').length === 4);
  assert.equal(await stackState(), null); assert.equal(await bookCount(), 4);
  report.checks.push('Ungrouping a stack keeps every book');

  await page.evaluate(async () => {
    const s = await import('./stacks.js');
    s.createStack('阅读中 Reading', ['z-a', 'z-b', 'z-d']);
    await window.__app.renderLibrary();
  });
  await page.waitForSelector('[data-stack]');
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-shelf-collapsed.png') });
  for (const width of [390, 1100]) {
    await page.setViewport({ width, height: 844 });
    for (const open of [false, true]) {
      if ((await expanded()) !== String(open)) {
        await tap('.stack-head');
        await page.waitForFunction(o => document.querySelector('.stack-head').getAttribute('aria-expanded') === String(o), {}, open);
      }
      const o = await page.evaluate(() => {
        const pane = document.querySelector('#pane-shelf');
        const grid = document.querySelector('#grid');
        const gw = grid.getBoundingClientRect().width;
        return {
          doc: document.documentElement.scrollWidth > innerWidth,
          pane: pane.scrollWidth > pane.clientWidth,
          rowsFull: [...document.querySelectorAll('#grid > .row-wrap, #grid > .stack')].every(r => Math.abs(r.getBoundingClientRect().width - gw) < 1),
          fill: gw / pane.clientWidth,
          clipped: [...grid.querySelectorAll('.book .t, .stack-name')].filter(t => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).length
        };
      });
      assert.equal(o.doc, false, `document overflow at ${width}`); assert.equal(o.pane, false, `shelf overflow at ${width}`);
      assert.equal(o.rowsFull, true); assert.ok(o.fill > 0.85, `list spans the pane at ${width}`); assert.equal(o.clipped, 0);
      if (width === 390 && open) await page.screenshot({ path: path.resolve(root, 'test-results/zone-shelf-expanded.png') });
    }
  }
  report.checks.push('Library list and stacks (collapsed and expanded) have no horizontal overflow at 390 px and 1100 px');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  for (const width of [390, 1100]) {
    await page.setViewport({ width, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
  }
  report.checks.push('Mobile/desktop shell has no horizontal overflow');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.setOfflineMode(true); await page.reload();
  await page.waitForFunction(() => window.__app);
  assert.equal(await page.title(), 'Zone');
  report.checks.push('Offline shell reload');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
  report.passed = true;
} catch (e) { report.passed = false; report.failure = e.stack; process.exitCode = 1; }
finally {
  await fs.writeFile(path.resolve(root, 'test-results/zone-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close(); server.close();
}
