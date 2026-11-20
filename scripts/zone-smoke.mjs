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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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

  const chrome = await page.evaluate(() => ({
    gone: ['.pane-intro', '.flow', '.pillars', '.tagline', '#desk-block', '#desk-list', '.sidebar', '.side-mark', '.book-grid'].filter(s => document.querySelector(s)),
    headerButtons: [...document.querySelectorAll('.appbar button')].map(b => b.id),
    labels: [...document.querySelectorAll('.tabbar [data-pane] span')].map(s => s.textContent),
    panes: [...document.querySelectorAll('.tabbar [data-pane]')].map(b => b.dataset.pane),
    shelfWords: /书架|书库/.test(document.querySelector('#library').innerText),
    findHidden: document.querySelector('#find-bar').hidden
  }));
  assert.deepEqual(chrome.gone, []);
  assert.deepEqual(chrome.headerButtons, ['btn-search-toggle', 'btn-menu']);
  assert.deepEqual(chrome.labels, ['流', '知识', '星海']); assert.deepEqual(chrome.panes, ['shelf', 'knowledge', 'graph']);
  assert.equal(chrome.shelfWords, false); assert.equal(chrome.findHidden, true);
  report.checks.push('Full-screen shell: no marketing chrome, no 整理 block, header has only search and + controls, nav reads 流 · 知识 · 星海');

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
  const kpane = await page.evaluate(() => ({
    actions: ['#btn-new-note', '#btn-new-decision', '#btn-export-notes'].map(s => !!document.querySelector(s)?.getClientRects().length),
    chips: document.querySelectorAll('#tag-filters .chip').length,
    overflow: document.querySelector('#pane-knowledge').scrollWidth > document.querySelector('#pane-knowledge').clientWidth
  }));
  assert.deepEqual(kpane.actions, [true, true, true]); assert.ok(kpane.chips >= 7); assert.equal(kpane.overflow, false);
  await page.type('#note-search', 'Zone test B');
  await page.waitForFunction(() => document.querySelectorAll('#note-list .note-card').length === 1);
  await page.$eval('#note-search', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelectorAll('#note-list .note-card').length === 2);
  await sleep(500);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-knowledge.png') });
  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('graph'); w.fitGraph(); });
  await page.waitForFunction(() => document.querySelectorAll('#graph-world .gnode').length === 2);
  report.checks.push('Knowledge pane (new note, judgment, outline, search, tag chips) and 星海 graph render both notes');
  await page.evaluate(async ({ a, b }) => {
    const k = await import('./knowledge.js');
    await k.unlinkPair(a, b);
    if ((await k.listLinks()).length) throw Error('Unlink left links');
    await k.linkNotes(a, b); await k.linkNotes(b, a);
    if ((await k.listLinks()).length !== 1) throw Error('Reverse duplicate');
    await k.deleteNote(a);
    if ((await k.listLinks()).length) throw Error('Delete left links');
  }, ids);
  report.checks.push('Unlink both directions, pair deduplication and deletion cleanup');

  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('shelf'); });
  const menuVisible = () => page.$eval('#menu-mask', el => !el.classList.contains('hidden'));
  await page.click('#btn-menu');
  await page.waitForFunction(() => !document.querySelector('#menu-mask').classList.contains('hidden'));
  const menu = await page.evaluate(() => ({
    expanded: document.querySelector('#btn-menu').getAttribute('aria-expanded'),
    items: [...document.querySelectorAll('#menu-sheet .menu-item')].filter(b => b.getClientRects().length).map(b => b.id),
    fileInput: !!document.querySelector('#file-input[type=file]'),
    focus: document.activeElement?.id,
    inView: (() => { const r = document.querySelector('#menu-sheet').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()
  }));
  assert.equal(menu.expanded, 'true');
  assert.deepEqual(menu.items, ['btn-import', 'btn-select-mode', 'btn-excerpts', 'btn-appearance', 'btn-ai-settings']);
  assert.equal(menu.fileInput, true); assert.equal(menu.focus, 'btn-import'); assert.equal(menu.inView, true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-select-mode');
  await page.keyboard.press('Escape');
  assert.equal(await menuVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-menu');
  await page.click('#btn-menu');
  await page.waitForFunction(() => !document.querySelector('#menu-mask').classList.contains('hidden'));
  await page.click('#btn-ai-settings');
  assert.equal(await page.$eval('#settings-mask', el => el.classList.contains('hidden')), false);
  assert.equal(await menuVisible(), false);
  await page.click('#ai-settings-cancel');
  assert.equal(await page.$eval('#settings-mask', el => el.classList.contains('hidden')), true);
  report.checks.push('+ menu opens as a popover (aria-expanded, arrow keys, Escape) with 导入/整理/摘录/外观/AI; AI settings opens/closes without network calls');

  await page.click('#btn-search-toggle');
  assert.equal(await page.$eval('#find-bar', el => !el.hidden && el.getClientRects().length > 0), true);
  assert.equal(await page.$eval('#btn-search-toggle', el => el.getAttribute('aria-expanded')), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'search');
  await page.click('#btn-search-toggle');
  assert.equal(await page.$eval('#find-bar', el => el.hidden), true);
  report.checks.push('Search toggle reveals and hides the inline search + sort bar');

  // ---- Full-width message list and manual overlapping-card stacks ----
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
    const avatar = grid.querySelector('.book .avatar');
    return {
      display: getComputedStyle(grid).display,
      dir: getComputedStyle(grid).flexDirection,
      allFull: rows.every(r => Math.abs(r.parentElement.getBoundingClientRect().width - gw) < 1),
      lefts: new Set(rows.map(r => Math.round(r.getBoundingClientRect().left))).size,
      clipped: [...grid.querySelectorAll('.book .t')].filter(t => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).map(t => t.textContent),
      longShown: [...grid.querySelectorAll('.book .t')].some(t => t.textContent.includes('一个很长的中英混排书名')),
      monogram: grid.querySelectorAll('.book .avatar .ph').length === 5,
      spine: getComputedStyle(avatar, '::after').content,
      radius: parseFloat(getComputedStyle(avatar).borderTopLeftRadius) === parseFloat(getComputedStyle(avatar).borderTopRightRadius),
      meta: grid.querySelector('.book[data-id="z-a"] .a').textContent,
      bar: !!grid.querySelector('.book[data-id="z-a"] .pbar i'),
      unread: !!grid.querySelector('.book[data-id="z-e"] .dot')
    };
  });
  assert.equal(listShape.display, 'flex'); assert.equal(listShape.dir, 'column');
  assert.equal(listShape.allFull, true); assert.equal(listShape.lefts, 1);
  assert.deepEqual(listShape.clipped, []); assert.equal(listShape.longShown, true);
  assert.equal(listShape.monogram, true); assert.equal(listShape.spine, 'none'); assert.equal(listShape.radius, true);
  assert.ok(listShape.meta.includes('EPUB') && listShape.meta.includes('Cal Newport'));
  assert.equal(listShape.bar, true); assert.equal(listShape.unread, true);
  report.checks.push('Stream renders one full-width row per item (monogram avatar without spine, unclipped mixed-language title, author/type, hairline progress, unread dot)');

  const tap = async sel => { await page.$eval(sel, el => el.scrollIntoView({ block: 'center' })); await page.click(sel); };
  const stackState = () => page.evaluate(() => JSON.parse(localStorage.getItem('rr-stacks') || 'null'));
  const bookCount = () => page.evaluate(async () => (await window.__app.db.all('books')).length);
  const expanded = () => page.$eval('.stack-head', el => el.getAttribute('aria-expanded'));
  const picking = () => page.evaluate(() => document.querySelector('#library').classList.contains('picking'));
  const enterSelect = async () => {
    await page.click('#btn-menu');
    await page.waitForFunction(() => !document.querySelector('#menu-mask').classList.contains('hidden'));
    await page.click('#btn-select-mode');
    await page.waitForFunction(() => document.querySelector('#library').classList.contains('picking') && !document.querySelector('#pick-bar').hidden);
  };

  await enterSelect();
  const pickShape = await page.evaluate(() => ({
    tabbarOff: getComputedStyle(document.querySelector('.tabbar')).pointerEvents === 'none',
    count: document.querySelector('#manage-count').textContent,
    stackDisabled: document.querySelector('#btn-stack-picked').disabled,
    buttons: [...document.querySelectorAll('#pick-bar button')].filter(b => b.getClientRects().length).map(b => b.textContent)
  }));
  assert.equal(pickShape.tabbarOff, true); assert.equal(pickShape.stackDisabled, true);
  assert.deepEqual(pickShape.buttons, ['建堆', '删除', '完成']);
  for (const id of ['z-a', 'z-b', 'z-c', 'z-d']) await tap(`#grid .book[data-id="${id}"]`);
  assert.equal(await page.$eval('#manage-count', el => el.textContent), '已选 4');
  assert.equal(await page.$$eval('#grid .book[aria-pressed="true"]', a => a.length), 4);
  await page.$eval('#pane-shelf', el => { el.scrollTop = 0; });
  await sleep(450);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-shelf-select.png') });
  assert.equal(await page.evaluate(() => document.querySelector('#reader').classList.contains('active')), false);
  await tap('#btn-stack-picked');
  await page.waitForFunction(() => !document.querySelector('#stack-mask').classList.contains('hidden'));
  await page.$eval('#stack-name', el => { el.value = '研究 Research'; });
  await page.click('#stack-save');
  await page.waitForFunction(() => document.querySelector('#stack-mask').classList.contains('hidden') && document.querySelector('[data-stack] .stack-name')?.textContent === '研究 Research');
  assert.equal(await picking(), false); assert.equal(await page.$eval('#pick-bar', el => el.hidden), true);
  let saved = await stackState();
  assert.equal(saved.stacks.length, 1); assert.deepEqual([...saved.stacks[0].bookIds].sort(), ['z-a', 'z-b', 'z-c', 'z-d']);
  assert.equal(saved.stacks[0].collapsed, true);
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
    const parts = ['.stack-name', '.stack-preview', '.stack-count', '.stack-chev'].map(s => sec.querySelector(s).getBoundingClientRect());
    let collide = false;
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) collide = true;
    }
    const l1 = getComputedStyle(sec, '::before'), l2 = getComputedStyle(sec, '::after');
    const sw = sec.getBoundingClientRect().width;
    return {
      itemsHidden: items.hidden, rowsInside: items.querySelectorAll('.book').length,
      count: sec.querySelector('.stack-count').textContent,
      clutter: ['.stack-kicker', '.stack-covers', '.mini'].filter(s => sec.querySelector(s)),
      preview: sec.querySelector('.stack-preview').textContent,
      previewOneLine: sec.querySelector('.stack-preview').getBoundingClientRect().height < 26,
      layers: [l1, l2].every(l => l.content !== 'none' && l.position === 'absolute'),
      layerWidths: [l1, l2].map(l => Math.round((sw - parseFloat(l.left) - parseFloat(l.right)) / sw * 100)),
      layerDrops: [l1, l2].map(l => -parseFloat(l.bottom)),
      gapBelow: next ? next.top - card.bottom : 99,
      headHit: head.contains(hit), collide,
      topRows: document.querySelectorAll('#grid > .row-wrap .book').length
    };
  });
  assert.equal(collapsedShape.itemsHidden, true); assert.equal(collapsedShape.rowsInside, 0);
  assert.equal(collapsedShape.count, '4'); assert.deepEqual(collapsedShape.clutter, []);
  assert.ok(collapsedShape.preview.length > 0); assert.equal(collapsedShape.previewOneLine, true);
  assert.equal(collapsedShape.layers, true); assert.deepEqual(collapsedShape.layerWidths, [96, 92]); assert.deepEqual(collapsedShape.layerDrops, [8, 16]);
  assert.ok(collapsedShape.gapBelow >= 20, 'deck layers must not touch the next row');
  assert.equal(collapsedShape.headHit, true); assert.equal(collapsedShape.collide, false);
  assert.equal(collapsedShape.topRows, 1);
  assert.equal(await bookCount(), 5);
  report.checks.push('In-place selection (menu 整理 → tap rows → 建堆) creates a named stack in rr-stacks; collapsed deck: front card + 96%/92% layers offset 8/16 px, quiet count, one-line preview, aria-expanded=false');

  const headTop = () => page.$eval('.stack-head', el => el.getBoundingClientRect().top - document.querySelector('#pane-shelf').getBoundingClientRect().top);
  await page.$eval('.stack-head', el => el.scrollIntoView({ block: 'center' }));
  const before = await headTop();
  await tap('.stack-head');
  await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'true');
  const after = await headTop();
  await sleep(700);
  const openShape = await page.evaluate(() => {
    const head = document.querySelector('.stack-head');
    const items = document.getElementById(head.getAttribute('aria-controls'));
    const rows = [...items.querySelectorAll('.book')];
    const rects = rows.map(r => r.getBoundingClientRect());
    let overlap = false;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (rects[i].bottom > rects[j].top + 0.5 && rects[j].bottom > rects[i].top + 0.5) overlap = true;
    const focus = document.activeElement === head;
    const hits = rows.map(r => { r.scrollIntoView({ block: 'center' }); const c = r.getBoundingClientRect(); return document.elementFromPoint(c.left + 30, c.top + c.height / 2)?.closest('.book') === r; });
    const wrap = items.querySelector('.row-wrap');
    const out = wrap.querySelector('.row-out');
    return {
      hidden: items.hidden, rows: rows.length, overlap, hits, focus,
      reader: document.querySelector('#reader').classList.contains('active'),
      collapse: document.querySelector('.stack-collapse')?.textContent,
      more: document.querySelector('.stack-more-btn')?.getAttribute('aria-haspopup'),
      menuItemsHidden: ['.stack-rename', '.stack-ungroup'].every(s => document.querySelector(s) && !document.querySelector(s).getClientRects().length),
      outLabel: out.getAttribute('aria-label'), outWidth: out.getBoundingClientRect().width,
      titleShare: wrap.querySelector('.t').getBoundingClientRect().width / wrap.getBoundingClientRect().width
    };
  });
  assert.equal(openShape.hidden, false); assert.equal(openShape.rows, 4); assert.equal(openShape.overlap, false);
  assert.deepEqual(openShape.hits, [true, true, true, true]); assert.equal(openShape.reader, false); assert.equal(openShape.focus, true);
  assert.equal(openShape.collapse, '收起'); assert.equal(openShape.more, 'menu'); assert.equal(openShape.menuItemsHidden, true);
  assert.equal(openShape.outLabel, '移出卡片堆'); assert.ok(openShape.outWidth <= 44); assert.ok(openShape.titleShare > 0.5, `title keeps room (${openShape.titleShare})`);
  assert.ok(Math.abs(after - before) < 1.5, `expand keeps the stack header anchored (${before} -> ${after})`);
  assert.equal((await stackState()).stacks[0].collapsed, false);
  await page.$eval('[data-stack]', el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-shelf-expanded.png') });
  report.checks.push('Tapping the stack expands in place (aria-expanded=true) into independent full-width rows with 收起 pill, ⋯ menu and slim 移出卡片堆 icon; no item opened; focus and anchor kept');

  await tap('.stack-more-btn');
  await page.waitForFunction(() => document.querySelector('.stack-more-btn')?.getAttribute('aria-expanded') === 'true' && document.querySelector('.stack-rename').getClientRects().length > 0);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('stack-rename')), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('.stack-more-btn', el => el.getAttribute('aria-expanded')), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('stack-more-btn')), true);
  await tap('.stack-more-btn');
  await page.waitForFunction(() => document.querySelector('.stack-rename')?.getClientRects().length > 0);
  await page.click('.stack-rename');
  await page.waitForFunction(() => !document.querySelector('#stack-mask').classList.contains('hidden'));
  await page.$eval('#stack-name', el => { el.value = '研究 Research 2026'; });
  await page.click('#stack-save');
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
  report.checks.push('⋯ menu (keyboard + Escape) renames the stack; 移出卡片堆 keeps the item; 收起 collapses with focus back on the header');

  await page.click('#btn-search-toggle');
  await page.type('#search', 'Thinking');
  await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'true');
  const searchShape = await page.evaluate(() => ({
    ids: [...document.querySelectorAll('#grid .book')].map(b => b.dataset.id),
    note: document.querySelector('.stack-more')?.textContent || ''
  }));
  assert.deepEqual(searchShape.ids, ['z-b']); assert.ok(searchShape.note.includes('2 项不匹配'));
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
    find: !document.querySelector('#find-bar').hidden,
    expanded: document.querySelector('.stack-head').getAttribute('aria-expanded'),
    focus: document.activeElement?.dataset?.id || null
  }));
  assert.deepEqual(back, { q: '原则', find: true, expanded: 'true', focus: 'z-c' });
  await tap('#search-chip');
  await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'false');
  await page.click('#btn-search-toggle');
  assert.equal(await page.$eval('#find-bar', el => el.hidden), true);
  report.checks.push('Opening an item from an expanded stack and returning keeps search text, expansion and focus');

  await page.$eval('#grid .book[data-id="z-e"]', el => el.scrollIntoView({ block: 'center' }));
  const er = await page.$eval('#grid .book[data-id="z-e"]', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(er.x, er.y); await page.mouse.down(); await sleep(650); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#library').classList.contains('picking'));
  assert.equal(await page.$eval('#grid .book[data-id="z-e"]', el => el.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.evaluate(() => document.querySelector('#reader').classList.contains('active')), false);
  assert.equal(await bookCount(), 5);
  await tap('#btn-done-picked');
  await page.waitForFunction(() => !document.querySelector('#library').classList.contains('picking') && document.querySelector('#pick-bar').hidden);
  report.checks.push('Long-press on a row enters selection mode with that row selected (nothing deleted or opened); 完成 exits');

  await enterSelect();
  await tap('.stack-head');
  await page.waitForFunction(() => !!document.querySelector('.stack-items .book[data-id="z-c"]'));
  await tap('.stack-items .book[data-id="z-c"]');
  assert.equal(await page.$eval('#manage-count', el => el.textContent), '已选 1');
  await tap('#btn-delete-picked');
  await page.waitForFunction(async () => (await window.__app.db.all('books')).length === 4);
  await page.waitForFunction(() => document.querySelector('.stack-count')?.textContent === '2' && !document.querySelector('#library').classList.contains('picking'));
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
  assert.equal(apiCleanup.afterOne, null, 'a stack left with one item dissolves'); assert.equal(apiCleanup.survivors, 1); assert.equal(apiCleanup.books, 4);
  await page.evaluate(() => window.__app.renderLibrary());
  report.checks.push('Deleting items (selection mode and deleteBookBundle) removes them from stack membership');

  if ((await expanded()) !== 'true') {
    await tap('.stack-head');
    await page.waitForFunction(() => document.querySelector('.stack-head')?.getAttribute('aria-expanded') === 'true');
  }
  await tap('.stack-more-btn');
  await page.waitForFunction(() => document.querySelector('.stack-ungroup')?.getClientRects().length > 0);
  await page.click('.stack-ungroup');
  await page.waitForFunction(() => !document.querySelector('[data-stack]') && document.querySelectorAll('#grid > .row-wrap .book').length === 4);
  assert.equal(await stackState(), null); assert.equal(await bookCount(), 4);
  report.checks.push('Ungrouping a stack from the ⋯ menu keeps every item');

  await page.evaluate(async () => {
    const s = await import('./stacks.js');
    s.createStack('阅读中 Reading', ['z-a', 'z-b', 'z-d']);
    await window.__app.renderLibrary();
    document.querySelector('#pane-shelf').scrollTop = 0;
  });
  await page.waitForSelector('[data-stack]');
  await sleep(400);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-shelf-collapsed.png') });

  const setAppearance = async want => {
    for (let i = 0; i < 3 && (await page.evaluate(() => document.documentElement.dataset.appearance)) !== want; i++) {
      if (!(await menuVisible())) { await page.click('#btn-menu'); await page.waitForFunction(() => !document.querySelector('#menu-mask').classList.contains('hidden')); }
      await page.click('#btn-appearance');
    }
    if (await menuVisible()) await page.keyboard.press('Escape');
  };
  await setAppearance('dark');
  const dark = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains('appearance-dark'),
    bg: getComputedStyle(document.body).backgroundColor,
    label: document.querySelector('#btn-appearance .menu-label').textContent,
    readingTheme: document.body.className
  }));
  assert.equal(dark.cls, true); assert.equal(dark.bg, 'rgb(0, 0, 0)'); assert.equal(dark.label, '外观 · 深色');
  assert.ok(dark.readingTheme.includes('theme-'), 'reading theme class stays separate');
  await sleep(300);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-shelf-dark.png') });
  await setAppearance('system');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), 'system');
  report.checks.push('Appearance cycles to dark from the menu (shell only, reading theme untouched) and back to system');

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
        const pr = pane.getBoundingClientRect(), gr = grid.getBoundingClientRect();
        const tab = document.querySelector('.tabbar').getBoundingClientRect();
        const h1 = document.querySelector('h1').getBoundingClientRect();
        return {
          doc: document.documentElement.scrollWidth > innerWidth,
          pane: pane.scrollWidth > pane.clientWidth,
          rowsFull: [...document.querySelectorAll('#grid > .row-wrap, #grid > .stack')].every(r => Math.abs(r.getBoundingClientRect().width - gr.width) < 1),
          width: gr.width, fill: gr.width / pane.clientWidth,
          centered: Math.abs((gr.left - pr.left) - (pr.left + pane.clientWidth - gr.right)) < 2,
          titleAligned: Math.abs(h1.left - gr.left) < 2,
          tabIn: tab.left >= 0 && tab.right <= innerWidth,
          clipped: [...grid.querySelectorAll('.book .t, .stack-name')].filter(t => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).length
        };
      });
      assert.equal(o.doc, false, `document overflow at ${width}`); assert.equal(o.pane, false, `stream overflow at ${width}`);
      assert.equal(o.rowsFull, true); assert.equal(o.centered, true); assert.equal(o.titleAligned, true); assert.equal(o.tabIn, true); assert.equal(o.clipped, 0);
      if (width === 1100 && !open) { await page.$eval('#pane-shelf', el => { el.scrollTop = 0; }); await sleep(400); await page.screenshot({ path: path.resolve(root, 'test-results/zone-desktop.png') }); }
      if (width === 390) assert.ok(o.fill > 0.85, `stream spans the phone width (${o.fill})`);
      else assert.ok(o.width >= 700 && o.width <= 770, `desktop measure is editorial (${o.width})`);
    }
  }
  report.checks.push('Stream and stacks (collapsed and expanded) have no horizontal overflow at 390 px; desktop 1100 px uses a centered ~760 px measure aligned with the title');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  for (const width of [390, 1100]) {
    await page.setViewport({ width, height: 844 });
    for (const pane of ['knowledge', 'graph', 'shelf']) {
      await page.evaluate(async p => { const w = await import('./workspace.js'); w.showPane(p); }, pane);
      const overflow = await page.evaluate(p => document.documentElement.scrollWidth > innerWidth || document.querySelector('#pane-' + p).scrollWidth > document.querySelector('#pane-' + p).clientWidth, pane);
      assert.equal(overflow, false, `${pane} overflow at ${width}`);
    }
  }
  report.checks.push('All three panes have no horizontal overflow at 390 px and 1100 px');
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
