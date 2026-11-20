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
    gone: ['.appbar', '#btn-search-toggle', '#btn-menu', '.tabbar', '.pane-head', '.pane-intro', '.flow', '.pillars', '.tagline', '#desk-block', '#desk-list', '.sidebar', '.side-mark', '.book-grid', '.cosmos-hud', '#cosmos-stats', '#graph-search-toggle', '#graph-in', '#graph-out'].filter(s => document.querySelector(s)),
    spatialBar: (() => {
      const b = document.querySelector('#spatial-bar'), l = document.querySelector('.spatial-line');
      if (!b || !l) return null;
      const lr = l.getBoundingClientRect();
      return { w: Math.round(lr.width), h: Math.round(lr.height), bg: getComputedStyle(b).backgroundColor };
    })(),
    intentTabs: [...document.querySelectorAll('#intent-sheet [data-pane] span')].map(s => s.textContent),
    intentPanes: [...document.querySelectorAll('#intent-sheet [data-pane]')].map(b => b.dataset.pane),
    shelfWords: /书架|书库/.test(document.querySelector('#library').innerText),
    findHidden: document.querySelector('#find-bar').hidden,
    kFindHidden: document.querySelector('#k-find-bar').hidden,
    intentHidden: document.querySelector('#intent-mask').classList.contains('hidden')
  }));
  assert.deepEqual(chrome.gone, []);
  assert.deepEqual(chrome.spatialBar, { w: 48, h: 4, bg: 'rgba(0, 0, 0, 0)' });
  assert.deepEqual(chrome.intentTabs, ['流', '知识', '星海']); assert.deepEqual(chrome.intentPanes, ['shelf', 'knowledge', 'graph']);
  assert.equal(chrome.shelfWords, false); assert.equal(chrome.findHidden, true);
  assert.equal(chrome.kFindHidden, true); assert.equal(chrome.intentHidden, true);
  report.checks.push('Frameless full-screen shell: zero top bar, zero bottom tab-bar box, only bottom 48x4 breathing hairline; search/filter hidden at rest');

  const canvasInk = sel => page.evaluate(s => {
    const c = document.querySelector(s);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20 && d[i - 3] + d[i - 2] + d[i - 1] > 150) lit++;
    return lit;
  }, sel);
  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('graph'); });
  await page.waitForFunction(() => document.querySelector('#library').classList.contains('cosmos-on') && !document.querySelector('#graph-empty').classList.contains('hidden'));
  await sleep(500);
  const emptySky = await page.evaluate(() => ({
    text: document.querySelector('#graph-empty p').textContent,
    searchHidden: document.querySelector('#graph-search-row').hidden
  }));
  assert.deepEqual(emptySky, { text: '星海尚未点亮', searchHidden: true });
  assert.ok(await canvasInk('#graph-map') > 10, 'empty cosmos still draws a single beacon');
  assert.ok(await canvasInk('#graph-sky') > 20, 'empty cosmos still draws the starfield');
  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('shelf'); });
  report.checks.push('Empty 星海 renders the painterly indigo night sky, one beacon and 星海尚未点亮 with zero top HUD');

  const intentVisible = () => page.$eval('#intent-mask', el => !el.classList.contains('hidden'));
  const openIntent = async () => {
    if (await intentVisible()) return;
    await page.click('#spatial-bar');
    await page.waitForFunction(() => !document.querySelector('#intent-mask').classList.contains('hidden'));
  };

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
  // Horizontal swipe from 流 -> 知识
  await page.mouse.move(320, 420); await page.mouse.down(); await page.mouse.move(80, 424, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#pane-knowledge').classList.contains('on'));
  assert.equal(await page.$$eval('#note-list .note-card', a => a.length), 2);
  const kResting = await page.evaluate(() => ({
    kFindHidden: document.querySelector('#k-find-bar').hidden,
    firstTop: document.querySelector('#note-list .note-card').getBoundingClientRect().top,
    overflow: document.querySelector('#pane-knowledge').scrollWidth > document.querySelector('#pane-knowledge').clientWidth
  }));
  assert.equal(kResting.kFindHidden, true); assert.ok(kResting.firstTop < 48, `notes start near top (${kResting.firstTop})`); assert.equal(kResting.overflow, false);
  await sleep(1250);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-knowledge.png') });
  // Open search in 知识 via intent sheet
  await openIntent();
  await page.click('#btn-intent-search');
  await page.waitForFunction(() => !document.querySelector('#k-find-bar').hidden);
  assert.ok(await page.$$eval('#tag-filters .chip', a => a.length) >= 7);
  await page.type('#note-search', 'Zone test B');
  await page.waitForFunction(() => document.querySelectorAll('#note-list .note-card').length === 1);
  await page.click('#note-search-clear');
  await page.waitForFunction(() => document.querySelectorAll('#note-list .note-card').length === 2);
  await page.click('#btn-k-find-close');
  assert.equal(await page.$eval('#k-find-bar', el => el.hidden), true);
  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('graph'); w.fitGraph(); });
  await page.waitForFunction(() => document.querySelectorAll('#graph-world .gnode').length === 2);
  report.checks.push('Horizontal swipe enters frameless 知识 pane (notes start near top, search/chips open on demand) and 星海 renders both notes');
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
  await openIntent();
  await sleep(400);
  const intent = await page.evaluate(() => ({
    expanded: document.querySelector('#spatial-bar').getAttribute('aria-expanded'),
    items: [...document.querySelectorAll('#intent-sheet .menu-item')].filter(b => b.getClientRects().length).map(b => b.id),
    fileInput: !!document.querySelector('#file-input[type=file]'),
    focus: document.activeElement?.id,
    inView: (() => { const r = document.querySelector('#intent-sheet').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1; })()
  }));
  assert.equal(intent.expanded, 'true');
  assert.deepEqual(intent.items, ['btn-intent-search', 'btn-import', 'btn-select-mode', 'btn-excerpts', 'btn-appearance', 'btn-ai-settings']);
  assert.equal(intent.fileInput, true); assert.equal(intent.focus, 'btn-intent-search'); assert.equal(intent.inView, true);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-intent-sheet.png') });
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-import');
  await page.keyboard.press('Escape');
  assert.equal(await intentVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'spatial-bar');
  await openIntent();
  await page.click('#btn-ai-settings');
  assert.equal(await page.$eval('#settings-mask', el => el.classList.contains('hidden')), false);
  assert.equal(await intentVisible(), false);
  await page.click('#ai-settings-cancel');
  assert.equal(await page.$eval('#settings-mask', el => el.classList.contains('hidden')), true);
  report.checks.push('Bottom hairline opens compact contextual Intent Sheet (spaces + 4 context tiles + 2 prefs, arrow keys, Escape); AI settings opens/closes without network calls');

  await openIntent();
  await page.click('#btn-intent-search');
  assert.equal(await page.$eval('#find-bar', el => !el.hidden && el.getClientRects().length > 0), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'search');
  await page.click('#btn-find-close');
  assert.equal(await page.$eval('#find-bar', el => el.hidden), true);
  report.checks.push('Intent sheet search reveals and closes the inline search + sort bar');

  // ---- Full-width message list and manual overlapping-card stacks ----
  const LONG = '深度工作 Deep Work: Rules for Focused Success in a Distracted World（一个很长的中英混排书名，用来检查不会被截断）';
  await page.evaluate(async (long) => {
    localStorage.setItem('rr-hint-panes', '1');
    localStorage.setItem('rr-hint-select', '1');
    localStorage.removeItem('rr-stacks');
    const { db } = window.__app;
    const base = Date.now() - 100000;
    const mkCover = (bg, accent, label, sub) => new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><rect width="120" height="160" fill="url(#g)"/><circle cx="88" cy="118" r="46" fill="#fff" opacity=".12"/><text x="16" y="54" fill="#f9f5eb" font-size="22" font-family="Georgia,serif" font-weight="700">${label}</text><text x="16" y="76" fill="#f9f5eb" opacity=".78" font-size="11" font-family="sans-serif">${sub}</text></svg>`], { type: 'image/svg+xml' });
    const mk = (id, title, author, type, progress, i, cover = null) => ({ id, title, author, type, progress, cover, addedAt: base + i * 1000, lastOpened: 0, pos: null, bookmarks: [], highlights: [] });
    const books = [
      mk('z-a', long, 'Cal Newport', 'epub', 0.42, 5, mkCover('#18345c', '#2c648e', 'Deep', 'WORK')),
      mk('z-b', '思考，快与慢 Thinking, Fast and Slow', '丹尼尔·卡尼曼', 'pdf', 0.1, 4),
      mk('z-c', '原则 Principles', 'Ray Dalio', 'txt', 0, 3),
      mk('z-d', 'Zettelkasten 卡片笔记写作法', 'Sönke Ahrens', 'txt', 0.75, 2),
      mk('z-e', '局外人 L’Étranger', 'Albert Camus', 'txt', 0, 1, mkCover('#8e3d2c', '#c97e48', '局外人', 'CAMUS'))
    ];
    for (const b of books) await db.put('books', b);
    const text = '第一章\n\n' + '这是一段只在本机测试里使用的中文正文，用来确认从卡片堆里打开一本书再返回时，列表的位置和焦点都还在。\n'.repeat(40);
    await db.put('files', { id: 'z-c', blob: new Blob([text], { type: 'text/plain' }) });
    await window.__app.renderLibrary();
  }, LONG);
  await page.waitForFunction(() => document.querySelectorAll('#grid .book').length === 5 && [...document.querySelectorAll('#grid .book .avatar img')].every(img => img.complete && img.naturalWidth > 0));
  const listShape = await page.evaluate(() => {
    const grid = document.querySelector('#grid');
    const gw = grid.getBoundingClientRect().width;
    const rows = [...grid.querySelectorAll('.book')];
    const avatar = grid.querySelector('.book .avatar');
    const ar = avatar.getBoundingClientRect();
    const typoTitles = [...grid.querySelectorAll('.book .avatar.typo .ph-title')].map(el => el.textContent);
    return {
      display: getComputedStyle(grid).display,
      dir: getComputedStyle(grid).flexDirection,
      allFull: rows.every(r => Math.abs(r.parentElement.getBoundingClientRect().width - gw) < 1),
      lefts: new Set(rows.map(r => Math.round(r.getBoundingClientRect().left))).size,
      clipped: [...grid.querySelectorAll('.book .t')].filter(t => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).map(t => t.textContent),
      longShown: [...grid.querySelectorAll('.book .t')].some(t => t.textContent.includes('一个很长的中英混排书名')),
      portrait: ar.height > ar.width && ar.width >= 38 && ar.height >= 50,
      imgCovers: grid.querySelectorAll('.book .avatar img').length,
      typoCovers: typoTitles.length,
      multiCharTypo: typoTitles.every(t => t.length >= 2),
      oldMonograms: grid.querySelectorAll('.book .avatar .ph').length,
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
  assert.equal(listShape.portrait, true); assert.equal(listShape.imgCovers, 2);
  assert.equal(listShape.typoCovers, 3); assert.equal(listShape.multiCharTypo, true); assert.equal(listShape.oldMonograms, 0);
  assert.equal(listShape.spine, 'none'); assert.equal(listShape.radius, true);
  assert.ok(listShape.meta.includes('EPUB') && listShape.meta.includes('Cal Newport'));
  assert.equal(listShape.bar, true); assert.equal(listShape.unread, true);
  report.checks.push('Stream renders one full-width message row per item with portrait cover thumbnails (real cover images + serif editorial mini-covers, zero single-char monograms, zero book spine)');

  const tap = async sel => { await page.$eval(sel, el => el.scrollIntoView({ block: 'center' })); await page.click(sel); };
  const stackState = () => page.evaluate(() => JSON.parse(localStorage.getItem('rr-stacks') || 'null'));
  const bookCount = () => page.evaluate(async () => (await window.__app.db.all('books')).length);
  const expanded = () => page.$eval('.stack-head', el => el.getAttribute('aria-expanded'));
  const picking = () => page.evaluate(() => document.querySelector('#library').classList.contains('picking'));
  const enterSelect = async () => {
    await openIntent();
    await page.click('#btn-select-mode');
    await page.waitForFunction(() => document.querySelector('#library').classList.contains('picking') && !document.querySelector('#pick-bar').hidden);
  };

  await enterSelect();
  const pickShape = await page.evaluate(() => ({
    dockOff: getComputedStyle(document.querySelector('#spatial-bar')).pointerEvents === 'none',
    count: document.querySelector('#manage-count').textContent,
    stackDisabled: document.querySelector('#btn-stack-picked').disabled,
    buttons: [...document.querySelectorAll('#pick-bar button')].filter(b => b.getClientRects().length).map(b => b.textContent)
  }));
  assert.equal(pickShape.dockOff, true); assert.equal(pickShape.stackDisabled, true);
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
    const parts = ['.stack-fan', '.stack-name', '.stack-preview', '.stack-count', '.stack-chev'].map(s => sec.querySelector(s).getBoundingClientRect());
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
      fanCovers: sec.querySelectorAll('.stack-fan .avatar.sm').length,
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
  assert.equal(collapsedShape.count, '4'); assert.equal(collapsedShape.fanCovers, 3); assert.deepEqual(collapsedShape.clutter, []);
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
    const sec = document.querySelector('.stack.is-open');
    return {
      hidden: items.hidden, rows: rows.length, overlap, hits, focus,
      reader: document.querySelector('#reader').classList.contains('active'),
      collapse: document.querySelector('.stack-collapse')?.textContent,
      more: document.querySelector('.stack-more-btn')?.getAttribute('aria-haspopup'),
      menuItemsHidden: ['.stack-rename', '.stack-ungroup'].every(s => document.querySelector(s) && !document.querySelector(s).getClientRects().length),
      outLabel: out.getAttribute('aria-label'), outWidth: out.getBoundingClientRect().width,
      titleShare: wrap.querySelector('.t').getBoundingClientRect().width / wrap.getBoundingClientRect().width,
      noNestedBoxes: getComputedStyle(sec).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(sec).boxShadow === 'none'
        && getComputedStyle(items).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(items).boxShadow === 'none'
    };
  });
  assert.equal(openShape.hidden, false); assert.equal(openShape.rows, 4); assert.equal(openShape.overlap, false);
  assert.deepEqual(openShape.hits, [true, true, true, true]); assert.equal(openShape.reader, false); assert.equal(openShape.focus, true);
  assert.equal(openShape.collapse, '收起'); assert.equal(openShape.more, 'menu'); assert.equal(openShape.menuItemsHidden, true);
  assert.equal(openShape.outLabel, '移出卡片堆'); assert.ok(openShape.outWidth <= 44); assert.ok(openShape.titleShare > 0.5, `title keeps room (${openShape.titleShare})`);
  assert.equal(openShape.noNestedBoxes, true, 'expanded stack has zero nested box-in-box borders/backgrounds');
  assert.ok(Math.abs(after - before) < 1.5, `expand keeps the stack header anchored (${before} -> ${after})`);
  assert.equal((await stackState()).stacks[0].collapsed, false);
  await page.$eval('[data-stack]', el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-shelf-expanded.png') });
  report.checks.push('Tapping the stack expands in place (aria-expanded=true) with zero nested double-box into independent full-width rows; focus and anchor kept');

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

  await openIntent();
  await page.click('#btn-intent-search');
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
  await page.click('#btn-find-close');
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
      await openIntent();
      await page.click('#btn-appearance');
    }
    if (await intentVisible()) await page.keyboard.press('Escape');
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
  report.checks.push('Appearance cycles to dark from the intent sheet (shell only, reading theme untouched) and back to system');

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
        const bar = document.querySelector('#spatial-bar').getBoundingClientRect();
        return {
          doc: document.documentElement.scrollWidth > innerWidth,
          pane: pane.scrollWidth > pane.clientWidth,
          rowsFull: [...document.querySelectorAll('#grid > .row-wrap, #grid > .stack')].every(r => Math.abs(r.getBoundingClientRect().width - gr.width) < 1),
          width: gr.width, fill: gr.width / pane.clientWidth,
          centered: Math.abs((gr.left - pr.left) - (pr.left + pane.clientWidth - gr.right)) < 2,
          barIn: bar.left >= 0 && bar.right <= innerWidth,
          clipped: [...grid.querySelectorAll('.book .t, .stack-name')].filter(t => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).length
        };
      });
      assert.equal(o.doc, false, `document overflow at ${width}`); assert.equal(o.pane, false, `stream overflow at ${width}`);
      assert.equal(o.rowsFull, true); assert.equal(o.centered, true); assert.equal(o.barIn, true); assert.equal(o.clipped, 0);
      if (width === 1100 && !open) { await page.$eval('#pane-shelf', el => { el.scrollTop = 0; }); await sleep(400); await page.screenshot({ path: path.resolve(root, 'test-results/zone-desktop.png') }); }
      if (width === 390) assert.ok(o.fill > 0.85, `stream spans the phone width (${o.fill})`);
      else assert.ok(o.width >= 700 && o.width <= 770, `desktop measure is editorial (${o.width})`);
    }
  }
  report.checks.push('Stream and stacks (collapsed and expanded) have no horizontal overflow at 390 px; desktop 1100 px uses a centered ~760 px measure');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  // ---- 星海 deep-space knowledge atlas ----
  const cosmosIds = await page.evaluate(async () => {
    const k = await import('./knowledge.js');
    const mk = (title, tags, extra = {}) => k.createNote({ title, body: `${title}：只在本机测试里使用的合成笔记。`, tags, ...extra });
    const a = await mk('注意力是稀缺资源', ['认知']);
    const b = await mk('元认知', ['认知'], { concept: true });
    const c = await mk('深度工作的节奏', ['认知']);
    const d = await mk('卡片写作 Zettelkasten', ['写作']);
    const e = await mk('每天写三百字', ['写作'], { body: '## 问题\n\n## 手里的材料\n\n## 判断\n坚持比灵感更可靠。', bookId: 'z-x', passageId: 'p-x', bookTitle: '合成样书' });
    const f = await mk('反馈回路', ['系统']);
    const g = await mk('杠杆点', ['系统']);
    const lone = await mk('一个还没连接的念头', []);
    await k.linkNotes(a.id, b.id); await k.linkNotes(b.id, c.id); await k.linkNotes(a.id, d.id); await k.linkNotes(f.id, g.id);
    const w = await import('./workspace.js');
    await w.refreshWorkspace();
    w.showPane('graph');
    return { a: a.id, b: b.id, d: d.id, e: e.id, lone: lone.id };
  });
  await page.waitForFunction(() => document.querySelectorAll('#graph-world .gnode').length === 9);
  await sleep(900);
  const atlas = await page.evaluate(() => {
    const stage = document.querySelector('#graph-stage').getBoundingClientRect();
    return {
      zeroTopHud: !document.querySelector('.cosmos-hud') && document.querySelector('#graph-search-row').hidden,
      fullBleed: stage.top <= 1 && stage.left <= 1 && Math.abs(stage.width - innerWidth) < 1 && Math.abs(stage.height - innerHeight) < 2,
      beacons: document.querySelectorAll('#graph-world .gnode.mag-beacon').length,
      faint: document.querySelectorAll('#graph-world .gnode.mag-faint').length,
      emptyHidden: document.querySelector('#graph-empty').classList.contains('hidden'),
      buttons: [...document.querySelectorAll('#graph-world .gnode')].every(b => b.tagName === 'BUTTON' && b.getAttribute('aria-label')),
      labelsInView: [...document.querySelectorAll('#graph-world .gnode:not(.quiet) .gl')].every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }),
      lod: [...document.querySelector('#graph-stage').classList].find(c => c.startsWith('lod-'))
    };
  });
  assert.equal(atlas.zeroTopHud, true); assert.equal(atlas.fullBleed, true);
  assert.ok(atlas.beacons >= 2, 'linked/concept notes become primary stars'); assert.equal(atlas.faint, 2);
  assert.equal(atlas.emptyHidden, true); assert.equal(atlas.buttons, true); assert.equal(atlas.labelsInView, true, 'all visible star art labels fit inside viewport'); assert.ok(atlas.lod);
  assert.ok(await canvasInk('#graph-map') > 300, 'Impressionist brushwork, lanes and stars are painted');
  assert.ok(await canvasInk('#graph-sky') > 40, 'Impressionist night sky is painted');
  const stable = await page.evaluate(async () => {
    const { layoutCosmos } = await import('./cosmos.js');
    const k = await import('./knowledge.js');
    const notes = await k.listNotes(), links = await k.listLinks();
    const pos = m => m.stars.map(s => `${s.id}@${s.x},${s.y}:${s.sector}`).sort().join('|');
    const one = layoutCosmos(notes, links), two = layoutCosmos(notes.slice().reverse(), links.slice().reverse());
    return { same: pos(one) === pos(two), sectors: one.sectors.map(s => s.name).sort() };
  });
  assert.equal(stable.same, true, 'star positions are deterministic');
  assert.deepEqual(stable.sectors, ['写作', '未测绘暗域', '认知', '系统'].sort());
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-cosmos-mobile.png') });
  report.checks.push('星海 full-bleed Impressionist oil atlas: 9 stars in 3 deterministic sectors + 未测绘暗域, zero top HUD at rest, pure multi-bristle Impressionism & calligraphic art lettering');

  await page.click(`#graph-world .gnode[data-id="${cosmosIds.a}"] .gdot`);
  await page.waitForFunction(() => !document.querySelector('#graph-card').classList.contains('hidden'));
  await sleep(700);
  const card = await page.evaluate(() => {
    const c = document.querySelector('#graph-card'), line = document.querySelector('.spatial-line').getBoundingClientRect();
    return {
      cls: c.querySelector('.gc-class').textContent, title: c.querySelector('.gc-title').textContent,
      actions: [...c.querySelectorAll('.gc-actions button')].map(b => b.textContent),
      close: !!c.querySelector('.gc-close'), links: c.querySelector('.gc-links').textContent,
      on: document.querySelector('#graph-world .gnode.on')?.dataset.id,
      dim: document.querySelectorAll('#graph-world .gnode.dim').length,
      above: c.getBoundingClientRect().bottom <= line.top + 0.5,
      inView: c.getBoundingClientRect().left >= 0 && c.getBoundingClientRect().right <= innerWidth
    };
  });
  assert.ok(card.cls.startsWith('主星') && card.cls.includes('认知'), JSON.stringify(card));
  assert.equal(card.title, '注意力是稀缺资源'); assert.deepEqual(card.actions, ['编辑', '聚焦邻域', '问 AI']);
  assert.equal(card.close, true); assert.equal(card.links, '2 条航线'); assert.equal(card.on, cosmosIds.a);
  assert.equal(card.dim, 5); assert.equal(card.above, true); assert.equal(card.inView, true);
  await page.click('#graph-card .gc-actions button:nth-child(2)');
  await sleep(800);
  await page.click('#graph-card .gc-actions button:nth-child(3)');
  await page.waitForFunction(() => !document.querySelector('#ai-mask').classList.contains('hidden'));
  await page.click('#ai-close');
  await page.waitForFunction(() => document.querySelector('#ai-mask').classList.contains('hidden'));
  report.checks.push('Tapping a star opens the frosted glass star card (class, sector, links, 编辑/聚焦邻域/问 AI/关闭) above the bottom hairline; neighbourhood ignites, others recede');

  await page.click('#graph-card .gc-close');
  await page.waitForFunction(() => document.querySelector('#graph-card').classList.contains('hidden'));
  await openIntent();
  await page.click('#graph-reset');
  await sleep(750);
  await openIntent();
  const graphTiles = await page.evaluate(() => [...document.querySelectorAll('#intent-sheet .menu-item')].filter(b => b.getClientRects().length).map(b => b.id));
  assert.deepEqual(graphTiles, ['btn-intent-search', 'btn-new-note', 'graph-tilt', 'graph-reset', 'graph-mood', 'btn-appearance', 'btn-ai-settings']);
  // Test Impressionist time-of-day mood cycle (auto -> dawn -> day -> dusk -> night -> auto) + live motion
  const moodCheck = await page.evaluate(async () => {
    const { themeForHour } = await import('./cosmos.js');
    const dawn = themeForHour(6.8), day = themeForHour(13), dusk = themeForHour(18.3), night = themeForHour(23), mid = themeForHour(8.3);
    return {
      distinct: JSON.stringify(dawn.skyMid) !== JSON.stringify(day.skyMid) && JSON.stringify(dusk.skyMid) !== JSON.stringify(night.skyMid),
      interp: mid.skyMid[0] !== dawn.skyMid[0] && mid.skyMid[0] !== day.skyMid[0],
      orbs: [dawn.orbKind, day.orbKind, dusk.orbKind, night.orbKind]
    };
  });
  assert.equal(moodCheck.distinct, true); assert.equal(moodCheck.interp, true);
  assert.deepEqual(moodCheck.orbs, ['sun', 'sun', 'sun', 'moon']);
  const readMood = () => page.$eval('#graph-mood .menu-label', el => el.textContent);
  assert.equal(await readMood(), '天色 · 随时辰');
  await page.click('#graph-mood');
  assert.equal(await intentVisible(), true, 'mood cycle keeps sheet open for live preview');
  assert.equal(await readMood(), '天色 · 晨曦');
  await page.keyboard.press('Escape');
  await sleep(920);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-cosmos-dawn.png') });
  await openIntent();
  await page.click('#graph-mood');
  assert.equal(await readMood(), '天色 · 晴蓝');
  await page.click('#graph-mood');
  assert.equal(await readMood(), '天色 · 暮色');
  await page.keyboard.press('Escape');
  await sleep(920);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-cosmos-dusk.png') });
  await openIntent();
  await page.click('#graph-mood');
  assert.equal(await readMood(), '天色 · 星夜');
  await page.keyboard.press('Escape');
  await sleep(920);
  // Check live Impressionist brushwork animation between frames
  const snapMap = () => page.evaluate(() => {
    const c = document.querySelector('#graph-map');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 37) sum = (sum + d[i] * ((i % 13) + 1)) % 1000000007;
    return sum;
  });
  const f1 = await snapMap();
  await sleep(420);
  const f2 = await snapMap();
  assert.notEqual(f1, f2, 'living Impressionist brushwork & starlight animate across frames');
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-cosmos-mobile.png') });
  await openIntent();
  await page.click('#graph-mood');
  assert.equal(await readMood(), '天色 · 随时辰');
  report.checks.push('Impressionist time-of-day cycle (随时辰/晨曦/晴蓝/暮色/星夜 with smooth interpolation & sun/moon arc) and live 60fps brushwork animation verified');
  await page.click('#btn-intent-search');
  assert.equal(await page.$eval('#graph-search-row', el => !el.hidden), true);
  await page.type('#graph-search', 'Zettel');
  await page.waitForFunction(() => document.querySelector('#graph-card .gc-title')?.textContent === '卡片写作 Zettelkasten');
  await page.$eval('#graph-search', el => { el.value = '每天'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#graph-card .gc-title')?.textContent === '每天写三百字');
  assert.deepEqual(await page.$$eval('#graph-card .gc-actions button', bs => bs.map(b => b.textContent)), ['编辑', '跃迁原文', '聚焦邻域', '问 AI']);
  await page.$eval('#graph-search', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#graph-card').classList.contains('hidden'));
  await page.click('#btn-graph-search-close');
  assert.equal(await page.$eval('#graph-search-row', el => el.hidden), true);
  report.checks.push('星海 contextual Intent Sheet reveals search on demand, flies to matching stars and offers 跃迁原文 for sourced notes');

  await openIntent();
  await page.click('#graph-reset');
  await sleep(900);
  const sample = () => page.$eval(`#graph-world .gnode[data-id="${cosmosIds.lone}"]`, el => el.style.transform);
  const t0 = await sample();
  const spot = await page.evaluate(() => {
    for (const [x, y] of [[40, 420], [350, 420], [195, 160], [60, 600], [330, 640], [195, 520]]) {
      const el = document.elementFromPoint(x, y);
      if (el && el.closest('#graph-stage') && !el.closest('.gnode')) return { x, y };
    }
    return null;
  });
  assert.ok(spot, 'found empty space to drag');
  await page.mouse.move(spot.x, spot.y); await page.mouse.down(); await page.mouse.move(spot.x + 60, spot.y + 40, { steps: 6 }); await page.mouse.up();
  assert.notEqual(await sample(), t0, 'single-pointer drag pans the map');
  await page.mouse.move(195, 420);
  await page.mouse.wheel({ deltaY: -700 });
  await page.waitForFunction(() => document.querySelector('#graph-stage').classList.contains('lod-near'));
  assert.equal(await page.$$eval('#graph-world .gnode .gk', ks => ks.some(k => getComputedStyle(k).display === 'block')), true);
  await openIntent();
  await page.click('#graph-reset');
  await sleep(900);
  report.checks.push('Drag pans, wheel zoom reaches near LOD (star kinds appear), contextual 适应全图 restores fit');

  await openIntent();
  await page.click('#graph-tilt');
  await sleep(1200);
  const tilt = await page.evaluate(() => {
    const stage = document.querySelector('#graph-stage');
    const beacon = document.querySelector('#graph-world .gnode.mag-beacon .gstem');
    const labels = [...document.querySelectorAll('#graph-world .gnode:not(.quiet) .gtext')].map(el => el.getBoundingClientRect());
    let labelOverlap = false;
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) labelOverlap = true;
    }
    return {
      on: stage.classList.contains('tilt'), pressed: document.querySelector('#graph-tilt').getAttribute('aria-pressed'),
      label: document.querySelector('#graph-tilt .menu-label').textContent,
      plane: getComputedStyle(document.querySelector('#graph-plane')).transform,
      stem: beacon.getBoundingClientRect().height,
      labelOverlap
    };
  });
  assert.equal(tilt.on, true); assert.equal(tilt.pressed, 'true'); assert.equal(tilt.label, '平视星图');
  assert.ok(tilt.plane.startsWith('matrix3d'), 'plane is tilted in 3D'); assert.ok(tilt.stem > 20, 'beacons rise on light stems');
  assert.equal(tilt.labelOverlap, false, '2.5D labels must not overlap');
  const bp = await page.$eval(`#graph-world .gnode[data-id="${cosmosIds.b}"] .gdot`, el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el }; });
  assert.equal(bp.hit, true, '3D hit-testing reaches the tilted star');
  await page.mouse.click(bp.x, bp.y);
  await page.waitForFunction(() => document.querySelector('#graph-card .gc-title')?.textContent === '元认知');
  assert.ok((await page.$eval('#graph-card .gc-class', el => el.textContent)).startsWith('主星'));
  await sleep(900);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-cosmos-25d.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#graph-card').classList.contains('hidden'));
  await openIntent();
  await page.click('#graph-tilt');
  await sleep(1100);
  assert.equal(await page.$eval('#graph-stage', el => el.classList.contains('tilt')), false);
  report.checks.push('2.5D toggle from Intent Sheet tilts the painterly atlas in CSS 3D with zero label overlap; tapping a star opens its card; Escape closes it');

  await page.setViewport({ width: 1100, height: 844 });
  await page.waitForFunction(() => window.__app);
  await page.evaluate(async () => { const w = await import('./workspace.js'); await w.refreshWorkspace(); w.showPane('graph'); });
  await page.waitForFunction(() => document.querySelectorAll('#graph-world .gnode').length === 9 && document.querySelector('#pane-graph').classList.contains('on'));
  await sleep(300);
  await openIntent();
  await page.click('#graph-reset');
  await sleep(1100);
  const wide = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth > innerWidth,
    stage: Math.abs(document.querySelector('#graph-stage').getBoundingClientRect().width - innerWidth) < 1,
    inView: [...document.querySelectorAll('#graph-world .gnode .gdot')].every(d => { const r = d.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; })
  }));
  assert.deepEqual(wide, { doc: false, stage: true, inView: true });
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-cosmos-desktop.png') });
  report.checks.push('Desktop 1100 px panorama: edge-to-edge cosmos, every star in view after 适应, no overflow');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  // ---- Natural-language & voice direct-control bar (zero AI-slop, compound actions + undo + reader control) ----
  assert.equal(await page.$eval('#command-mask', el => el.classList.contains('hidden')), true);
  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('shelf'); });
  await sleep(250);
  // Long-press bottom breathing hairline opens the command whisper bar
  const barPt = await page.$eval('#spatial-bar', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(barPt.x, barPt.y); await page.mouse.down(); await sleep(540); await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('#command-mask').classList.contains('hidden'));
  await sleep(360);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-command-bar.png') });
  // Compound natural-language command: dark mode + 星海 + 暮色 + 2.5D
  await page.type('#cmd-input', '深色模式，去星海看暮色并开立体');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#command-mask').classList.contains('hidden')
    && document.documentElement.dataset.appearance === 'dark'
    && document.querySelector('#pane-graph').classList.contains('on')
    && document.querySelector('#graph-stage').classList.contains('tilt')
    && document.querySelector('#graph-mood .menu-label').textContent === '天色 · 暮色'
    && !!document.querySelector('#toast .toast-undo'));
  // One-tap Undo reverts the whole compound command cleanly
  await page.click('#toast .toast-undo');
  await page.waitForFunction(() => document.documentElement.dataset.appearance !== 'dark'
    && !document.querySelector('#graph-stage').classList.contains('tilt')
    && document.querySelector('#pane-shelf').classList.contains('on'));

  // Reader direct voice/natural-language control: open book -> enlarge font + eye-care sepia + kai + loose line-height -> next page -> close -> quick note
  await page.evaluate(async () => {
    const { db } = window.__app;
    await db.put('books', { id: 'z-v', title: '原则 Principles', author: 'Ray Dalio', type: 'txt', progress: 0, addedAt: Date.now(), lastOpened: 0, pos: null, bookmarks: [], highlights: [] });
    await db.put('files', { id: 'z-v', blob: new Blob(['第一章\n\n' + '自然交互让阅读设置不再藏在层层菜单里。\n'.repeat(60)], { type: 'text/plain' }) });
    await window.__app.renderLibrary();
  });
  await page.evaluate(() => window.__app.runCommand('打开原则'));
  await page.waitForFunction(() => document.querySelector('#reader').classList.contains('active') && document.querySelector('#loading').classList.contains('hidden'));
  const beforeSize = await page.evaluate(async () => (await import('./settings.js')).settings.size);
  await page.evaluate(() => window.__app.runCommand('字大一点，开护眼模式，换楷体，行距宽一点'));
  const readerAfter = await page.evaluate(async () => {
    const { settings } = await import('./settings.js');
    return { size: settings.size, theme: settings.theme, font: settings.font, lh: settings.lh, sepiaCls: document.body.classList.contains('theme-sepia') };
  });
  assert.equal(readerAfter.size, beforeSize + 2);
  assert.equal(readerAfter.theme, 'sepia'); assert.equal(readerAfter.sepiaCls, true);
  assert.equal(readerAfter.font, 'kai'); assert.equal(readerAfter.lh, 2.1);
  await page.evaluate(() => window.__app.runCommand('下一页'));
  await sleep(250);
  await page.evaluate(() => window.__app.runCommand('返回列表'));
  await page.waitForFunction(() => document.querySelector('#library').classList.contains('active'));
  const beforeNotes = await page.evaluate(async () => (await (await import('./knowledge.js')).listNotes()).length);
  await page.evaluate(() => window.__app.runCommand('记笔记：自然指令比翻菜单更直觉'));
  const afterNotes = await page.evaluate(async () => (await (await import('./knowledge.js')).listNotes()).length);
  assert.equal(afterNotes, beforeNotes + 1);
  report.checks.push('Long-press bottom hairline opens whisper command bar; compound natural commands (dark + 星海 + 暮色 + 2.5D, 1-tap undo, open book, enlarge font + eye-care + kai + loose line-height + page turn + quick note) execute offline with zero AI clutter');

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
