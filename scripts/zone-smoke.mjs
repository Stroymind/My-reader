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
  // First-launch Zero-Button Spatial Portal (zero inputs, zero buttons)
  assert.equal(await page.$eval('#auth-gate', el => el.classList.contains('hidden')), false, 'spatial portal greets first-time user');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#auth-gate input, #auth-gate button').length), 0, 'spatial portal has zero inputs and zero buttons');
  await sleep(260);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-auth-gate.png') });
  await page.click('#auth-portal');
  await page.waitForFunction(() => document.querySelector('#auth-gate').classList.contains('hidden'));
  assert.equal(await page.evaluate(() => window.__app.getAuthUser()?.mode), 'guest');
  await sleep(360);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-agent-home.png') });
  // Verify top-left Profile, Recharge Balance Estimation, and real Import Memory
  await page.click('#btn-hub-profile');
  await page.waitForFunction(() => !document.querySelector('#zone-profile-mask').classList.contains('hidden'));
  await page.click('#zone-profile-mask [data-p-act="edit-recharge"]');
  await page.waitForSelector('#prof-recharge-inp');
  await page.type('#prof-recharge-inp', '50');
  await page.click('#zone-profile-mask [data-p-act="save-recharge"]');
  await sleep(160);
  const balCheck = await page.evaluate(async () => {
    const aiMod = await import('./ai.js');
    aiMod.recordAiUsage({ promptTokens: 50000, completionTokens: 20000, totalTokens: 70000 }, 'deepseek-chat');
    return aiMod.getAiUsage();
  });
  assert.equal(balCheck.rechargeAmount, 50, 'recharge baseline saved');
  assert.ok(balCheck.spentEstimated > 0 && balCheck.spentEstimated < 1, `estimated spend computed from real model price: ${balCheck.spentEstimated}`);
  await page.click('#zone-profile-mask [data-p-act="close"]');
  await page.waitForFunction(() => document.querySelector('#zone-profile-mask').classList.contains('hidden'));
  await page.click('#btn-hub-profile');
  await page.waitForFunction(() => !document.querySelector('#zone-profile-mask').classList.contains('hidden'));
  await sleep(200);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-profile-usage.png') });
  // Open Import Memory from Profile, paste real memories, and verify injection into Bot context
  await page.click('#zone-profile-mask [data-p-act="import-mem"]');
  await page.waitForFunction(() => !document.querySelector('#zone-memory-mask').classList.contains('hidden'));
  await page.type('#zone-mem-input', '- 我是独立开发者，偏好苹果极简设计\n- 常用 Python、Android Capacitor 和 DeepSeek');
  await page.click('#zone-memory-mask [data-m-act="import-text"]');
  await sleep(180);
  const memCtx = await page.evaluate(async () => {
    const m = await import('./memory.js');
    return { count: m.listMemories().length, ctx: m.buildMemoryContextForBot('zone-chief', '帮我优化 Android 界面') };
  });
  assert.equal(memCtx.count, 2, 'Import Memory parsed 2 clean facts');
  assert.ok(memCtx.ctx.includes('苹果极简设计') && memCtx.ctx.includes('Android Capacitor'), `Memory injected into Bot prompt: ${memCtx.ctx}`);
  // Verify E-Ink mode strictly isolates to Reader plugin (NEVER grayscale-filters Agent Home!)
  const einkIso = await page.evaluate(() => {
    document.documentElement.classList.add('mode-eink');
    const homeFilter = getComputedStyle(document.querySelector('#library')).filter;
    document.documentElement.classList.add('in-bot-reader');
    const readerFilter = getComputedStyle(document.querySelector('#library')).filter;
    document.documentElement.classList.remove('in-bot-reader', 'mode-eink');
    return { homeFilter, readerFilter };
  });
  assert.equal(einkIso.homeFilter, 'none', `E-Ink must NOT filter Agent Home: ${einkIso.homeFilter}`);
  assert.ok(einkIso.readerFilter.includes('grayscale'), `E-Ink MUST filter Reader plugin: ${einkIso.readerFilter}`);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-import-memory.png') });
  await page.click('#zone-memory-mask [data-m-act="close"]');
  await page.waitForFunction(() => document.querySelector('#zone-memory-mask').classList.contains('hidden'));
  // Tap + to verify clean Bot Creator
  await page.click('#btn-hub-newbot');
  await page.waitForFunction(() => !document.querySelector('#zone-bots-mask').classList.contains('hidden'));
  await sleep(240);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-bot-create.png') });
  await page.click('#zone-bots-mask [data-act="cancel"]');
  await page.waitForFunction(() => document.querySelector('#zone-bots-mask').classList.contains('hidden'));
  await page.click('#btn-hub-plugins');
  await page.waitForFunction(() => !document.querySelector('#zone-bots-mask').classList.contains('hidden'));
  await page.click('#zone-bots-mask [data-tab="automations"]');
  await sleep(220);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-automations.png') });
  await page.click('#zone-bots-mask [data-tab="plugins"]');
  await sleep(220);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-plugins-tab.png') });
  // Verify 阅读器 plugin toggle REALLY hides/restores books & reader chrome
  await page.click('#zone-bots-mask label.ios-switch:has([data-toggle="reading-cosmos"])');
  await sleep(160);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('plugin-reader-off')), true, 'toggling 阅读器 off really hides reader');
  await page.click('#zone-bots-mask label.ios-switch:has([data-toggle="reading-cosmos"])');
  await sleep(160);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('plugin-reader-off')), false, 'toggling 阅读器 on restores reader');
  assert.ok((await page.$$('#zone-bots-mask [data-assign-bot]')).length >= 1, 'plugin sheet shows per-Bot assignment chips');
  await page.click('#zone-bots-mask [data-act="close"]');
  await page.waitForFunction(() => document.querySelector('#zone-bots-mask').classList.contains('hidden'));
  // Verify tapping the top Hero Bot card opens full-screen Bot Chat
  await page.click('#zone-hero-card');
  await page.waitForFunction(() => !document.querySelector('#zone-chat-modal').classList.contains('hidden'));
  // Per-Bot plugin loading: initially 阅读器 is not mounted on Zone; tap + to load it ONLY into this Bot's chat
  assert.equal(await page.$('#btn-chat-reader'), null, '阅读器 not cluttered into Bot chat until mounted for this Bot');
  await page.click('#btn-chat-plugins');
  await page.waitForFunction(() => !document.querySelector('#zone-bot-plugins-mask').classList.contains('hidden'));
  await page.click('#zone-bot-plugins-mask label.ios-switch:has([data-bp-toggle="reading-cosmos"])');
  await sleep(160);
  await page.click('#zone-bot-plugins-mask [data-bp-act="close"]');
  await page.waitForFunction(() => document.querySelector('#zone-bot-plugins-mask').classList.contains('hidden'));
  assert.equal(await page.$eval('#btn-chat-reader', el => getComputedStyle(el).display !== 'none'), true, '阅读器 pill loaded into THIS Bot chat');
  // Tap 阅读器 inside THIS Bot chat -> enters full in-Bot Reader workspace (with Card Stacks + 流/知识/星海 + ‹ Zone return pill)
  await page.click('#btn-chat-reader');
  await page.waitForFunction(() => document.documentElement.classList.contains('in-bot-reader') && !document.querySelector('#bot-reader-bar').classList.contains('hidden'));
  assert.equal(await page.$eval('#grid', el => getComputedStyle(el).display !== 'none'), true, 'real Card Stack #grid active inside in-Bot Reader workspace');
  await page.click('#btn-reader-return-bot');
  await page.waitForFunction(() => !document.documentElement.classList.contains('in-bot-reader') && !document.querySelector('#zone-chat-modal').classList.contains('hidden'));
  await page.type('#zone-chat-input', '你好，帮我规划今天');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#zone-chat-messages .chat-row').length >= 2);
  // Test 新话题 context divider line (1 Bot = 1 clean stream, zero nested pills)
  await page.click('#btn-chat-new');
  await page.waitForFunction(() => document.querySelectorAll('#zone-chat-messages .chat-divider').length === 1);
  // Test Grok-style Interactive Confirmation Card + Task Result Link Card inside Bot Chat
  const confirmOutcome = await page.evaluate(async () => {
    const p = window.__app.requestChatConfirm({
      icon: 'computer',
      provider: '本机电脑 · Computer-Use',
      title: '确认在本地电脑执行任务',
      meta: 'http://192.168.1.100:8765',
      badge: '待确认',
      detail: '整理桌面截图并生成今日汇报文档',
      rejectLabel: '取消',
      approveLabel: '确认执行'
    });
    const approveBtn = document.querySelector('#zone-chat-messages .chat-card [data-card-act="approve"]');
    approveBtn.click();
    const ok = await p;
    window.__app.postChatCard(null, {
      kind: 'result',
      icon: 'cloud',
      provider: '云端 Agent',
      status: 'Done',
      statusTone: 'ok',
      title: 'My-reader 升级：苹果风格的 AI 阅读与知识工作台',
      meta: 'github.com/Stroymind/My-reader',
      badge: 'PR #5',
      detail: '已完成检索与校验，点击下方按钮可复制或打开链接。',
      url: 'https://github.com/Stroymind/My-reader',
      secondaryLabel: '复制链接',
      primaryLabel: '查看链接'
    });
    return {
      ok,
      cardCount: document.querySelectorAll('#zone-chat-messages .chat-card').length,
      statuses: [...document.querySelectorAll('#zone-chat-messages .chat-card-status')].map(e => e.textContent)
    };
  });
  assert.equal(confirmOutcome.ok, true, 'in-chat Confirmation Card resolves true on approve');
  assert.equal(confirmOutcome.cardCount, 2, 'renders both Confirmation Card and Task Link Card');
  assert.deepEqual(confirmOutcome.statuses, ['已确认', 'Done']);
  await sleep(260);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-bot-chat.png') });
  await page.click('#btn-chat-back');
  await page.waitForFunction(() => document.querySelector('#zone-chat-modal').classList.contains('hidden'));
  // Create a 2nd Bot (verify birth-from-zero animation + async non-synced animation timing) and a Multi-Bot Group Chat + silent Bot-to-Bot relay
  await page.click('#btn-hub-newbot');
  await page.waitForFunction(() => !document.querySelector('#zone-bots-mask').classList.contains('hidden'));
  assert.equal(await page.$eval('#zone-bots-mask .bots-preview', el => el.classList.contains('bot-born')), true, 'new Bot preview plays birth-from-zero animation');
  await page.type('#bot-f-name', '土豆');
  await page.click('#zone-bots-mask [data-shape="orb"]');
  await page.click('#zone-bots-mask [data-accent="#FF6B00"]');
  await page.click('#zone-bots-mask [data-act="save"]');
  await page.waitForFunction(() => !document.querySelector('#zone-chat-modal').classList.contains('hidden') && document.querySelector('#chat-head-name').textContent === '土豆');
  // Verify 土豆 does NOT inherit Zone's 阅读器 plugin (strict per-Bot plugin isolation!)
  assert.equal(await page.$('#btn-chat-reader'), null, '阅读器 mounted on Zone does NOT leak to 土豆');
  await page.click('#btn-chat-back');
  await page.waitForFunction(() => document.querySelector('#zone-chat-modal').classList.contains('hidden'));
  // Verify two Bots have different (non-synchronized) animation timing CSS variables
  const asyncTimings = await page.evaluate(() => [...document.querySelectorAll('#zone-agent-hub .bot-glyph')].map(el => el.getAttribute('style')));
  assert.ok(asyncTimings.length >= 2 && asyncTimings[0] !== asyncTimings[1], `Bots must have non-synced animation timings: ${JSON.stringify(asyncTimings)}`);
  // Test Multi-Bot Group Chat creation via + -> 创建群聊
  await page.click('#btn-hub-newbot');
  await page.waitForFunction(() => !document.querySelector('#zone-bots-mask').classList.contains('hidden'));
  await page.click('#zone-bots-mask [data-new-kind="group"]');
  await page.waitForSelector('#grp-f-name');
  await page.type('#grp-f-name', '产品研发群');
  await page.click('#zone-bots-mask [data-act="save-grp"]');
  await page.waitForFunction(() => !document.querySelector('#zone-chat-modal').classList.contains('hidden') && document.querySelector('#chat-head-name').textContent.includes('产品研发群'));
  const mentionChips = await page.$$eval('#zone-chat-plugins-bar .group-mention-chip', els => els.map(e => e.textContent));
  assert.ok(mentionChips.includes('@所有人') && mentionChips.includes('@Zone') && mentionChips.includes('@土豆'), `Group mention chips: ${JSON.stringify(mentionChips)}`);
  await page.type('#zone-chat-input', '@土豆 汇总下最新进度');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#zone-chat-messages .chat-row').length >= 2);
  await sleep(220);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-group-chat.png') });
  await page.click('#btn-chat-back');
  await page.waitForFunction(() => document.querySelector('#zone-chat-modal').classList.contains('hidden'));
  // Test silent Bot-to-Bot relay updates sender's Home Roster with ➤ preview while staying hidden from receiver's visible chat
  const relayCheck = await page.evaluate(async () => {
    const botsMod = await import('./bots.js');
    const all = botsMod.listBots();
    const potato = all.find(b => b.name === '土豆');
    const zone = all.find(b => b.name === 'Zone');
    await window.__app.relayBotToBotMessage(potato, zone, '帮我检查 PR #5');
    const rosterSub = [...document.querySelectorAll('#zone-bot-roster .roster-item')].map(el => el.textContent).join(' | ');
    return { rosterSub };
  });
  assert.ok(relayCheck.rosterSub.includes('➤ 已发消息给 Zone'), `Roster shows silent bot-to-bot handoff: ${relayCheck.rosterSub}`);
  await sleep(160);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-agent-home.png') });
  report.checks.push('Mobile startup, Spatial Z Portal, pure Apple Zone Agent Home, Profile/API Usage, Per-Bot Plugin Isolation, Grok-style Confirmation & Link Cards, Async Bot Animations + Birth Animation, Multi-Bot Group Chat, and Silent Bot-to-Bot Relay');
  // Enter legacy reader/stream view for the full 35-item Reader & Cosmos regression suite
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => {
      if (sessionStorage.getItem('zone-test-legacy') === '1') document.documentElement.classList.add('legacy-reader-home');
    });
  });
  await page.evaluate(() => {
    sessionStorage.setItem('zone-test-legacy', '1');
    document.documentElement.classList.add('legacy-reader-home');
  });

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
  // Verify unified Second Brain: Bot context reads BOTH Import Memory AND 星海/知识库 notes!
  const sbCtx = await page.evaluate(() => window.__app.buildSecondBrainContext('zone-chief', 'Zone test'));
  assert.ok(sbCtx.includes('苹果极简设计') && sbCtx.includes('Zone test A'), `Second Brain unifies Memory + 星海 notes: ${sbCtx}`);
  await page.reload(); await page.waitForFunction(() => window.__app);
  await page.evaluate(() => document.documentElement.classList.add('legacy-reader-home'));
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
  assert.deepEqual(intent.items, ['btn-import', 'btn-intent-search', 'btn-auth-account', 'btn-ai-settings']);
  assert.equal(intent.fileInput, true); assert.equal(intent.focus, 'btn-import'); assert.equal(intent.inView, true);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-intent-sheet.png') });
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-intent-search');
  await page.keyboard.press('Escape');
  assert.equal(await intentVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'spatial-bar');
  await openIntent();
  await page.click('#btn-ai-settings');
  assert.equal(await page.$eval('#settings-mask', el => el.classList.contains('hidden')), false);
  assert.equal(await intentVisible(), false);
  await page.click('#ai-settings-cancel');
  assert.equal(await page.$eval('#settings-mask', el => el.classList.contains('hidden')), true);
  report.checks.push('Bottom hairline opens ultra-clean buttonless Intent Sheet (spaces + voice bar + 2 irreducible tiles + AI settings, arrow keys, Escape)');

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
    await page.evaluate(() => window.__app.runCommand('进入整理'));
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
  await page.mouse.move(er.x, er.y); await page.mouse.down(); await sleep(380);
  assert.equal(await page.evaluate(() => !!document.querySelector('.drag-ghost') && !document.querySelector('#drag-trash-zone').classList.contains('hidden')), true, 'long-press lifts card and shows monochrome top drop-to-remove zone');
  await page.mouse.up();
  assert.equal(await page.evaluate(() => !document.querySelector('.drag-ghost') && !document.querySelector('#card-quick-mask') && !document.querySelector('#library').classList.contains('picking')), true, 'releasing in place settles cleanly with zero extra popup button menu');
  assert.equal(await page.evaluate(() => document.querySelector('#reader').classList.contains('active')), false);
  assert.equal(await bookCount(), 5);
  report.checks.push('Long-press lifts card with monochrome top drop-to-remove zone; releasing in place settles cleanly with zero popup delete button');

  await enterSelect();
  await tap('.stack-head');
  await page.waitForFunction(() => !!document.querySelector('.stack-items .book[data-id="z-c"]'));
  await tap('.stack-items .book[data-id="z-c"]');
  assert.equal(await page.$eval('#manage-count', el => el.textContent), '已选 1');
  await tap('#btn-delete-picked');
  await page.waitForFunction(() => !document.querySelector('#confirm-mask').classList.contains('hidden'));
  await page.click('#confirm-ok');
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
    const cmd = want === 'dark' ? '深色外观' : want === 'light' ? '浅色外观' : '跟随系统';
    await page.evaluate(c => window.__app.runCommand(c), cmd);
  };
  await setAppearance('dark');
  const dark = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains('appearance-dark'),
    bg: getComputedStyle(document.body).backgroundColor,
    readingTheme: document.body.className
  }));
  assert.equal(dark.cls, true); assert.equal(dark.bg, 'rgb(0, 0, 0)');
  assert.ok(dark.readingTheme.includes('theme-'), 'reading theme class stays separate');
  await sleep(300);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-shelf-dark.png') });
  await setAppearance('system');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), 'system');
  report.checks.push('Appearance switches to dark via voice/command (shell only, reading theme untouched) and back to system');

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
  await page.evaluate(() => window.__app.runCommand('适应全图'));
  await sleep(750);
  await openIntent();
  const graphTiles = await page.evaluate(() => [...document.querySelectorAll('#intent-sheet .menu-item')].filter(b => b.getClientRects().length).map(b => b.id));
  assert.deepEqual(graphTiles, ['btn-new-note', 'btn-intent-search', 'btn-auth-account', 'btn-ai-settings']);
  await page.keyboard.press('Escape');
  // Test Impressionist time-of-day mood cycle (auto -> dawn -> day -> dusk -> night -> auto) via voice/command + live motion
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
  const readMood = () => page.evaluate(async () => (await import('./workspace.js')).getGraphMood());
  assert.equal(await readMood(), 'auto');
  await page.evaluate(() => window.__app.runCommand('晨曦'));
  assert.equal(await readMood(), 'dawn');
  await sleep(920);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-cosmos-dawn.png') });
  await page.evaluate(() => window.__app.runCommand('晴蓝'));
  assert.equal(await readMood(), 'day');
  await page.evaluate(() => window.__app.runCommand('暮色'));
  assert.equal(await readMood(), 'dusk');
  await sleep(920);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-cosmos-dusk.png') });
  await page.evaluate(() => window.__app.runCommand('星夜'));
  assert.equal(await readMood(), 'night');
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
  // Zoom out via voice to verify organic radial nebula feathering (no rectangular edge seam)
  await page.evaluate(() => window.__app.runCommand('缩小星海'));
  await sleep(450);
  await page.evaluate(() => window.__app.runCommand('缩小星海'));
  await sleep(600);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-cosmos-zoomout.png') });
  await page.evaluate(() => window.__app.runCommand('适应全图'));
  await sleep(500);
  await page.evaluate(() => window.__app.runCommand('随时辰'));
  assert.equal(await readMood(), 'auto');
  report.checks.push('Impressionist time-of-day cycle (随时辰/晨曦/晴蓝/暮色/星夜), radial zoomed-out seamless cosmos, and live 60fps brushwork animation verified');
  await openIntent();
  await page.click('#btn-intent-search');
  assert.equal(await page.$eval('#graph-search-row', el => !el.hidden), true);
  await page.type('#graph-search', 'Zettel');
  await page.waitForFunction(() => document.querySelector('#graph-card .gc-title')?.textContent === '卡片写作 Zettelkasten');
  await page.$eval('#graph-search', el => { el.value = '每天'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#graph-card .gc-title')?.textContent === '每天写三百字');
  assert.deepEqual(await page.$$eval('#graph-card .gc-actions button', bs => bs.map(b => b.textContent)), ['编辑', '跃迁原文', '聚焦邻域', '问 AI']);
  await page.$eval('#graph-search', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#graph-card').classList.contains('hidden'));
  await sleep(260);
  await page.click('#btn-graph-search-close');
  assert.equal(await page.$eval('#graph-search-row', el => el.hidden), true);
  report.checks.push('星海 contextual Intent Sheet reveals search on demand, flies to matching stars and offers 跃迁原文 for sourced notes');

  await page.evaluate(() => window.__app.runCommand('适应全图'));
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
  await page.evaluate(() => window.__app.runCommand('适应全图'));
  await sleep(900);
  report.checks.push('Drag pans, wheel zoom reaches near LOD (star kinds appear), 适应全图 restores fit');

  await page.evaluate(() => window.__app.runCommand('2.5D 立体'));
  await sleep(1200);
  const tilt = await page.evaluate(async () => {
    const stage = document.querySelector('#graph-stage');
    const beacon = document.querySelector('#graph-world .gnode.mag-beacon .gstem');
    const labels = [...document.querySelectorAll('#graph-world .gnode:not(.quiet) .gtext')].map(el => el.getBoundingClientRect());
    let labelOverlap = false;
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) labelOverlap = true;
    }
    const w = await import('./workspace.js');
    return {
      on: stage.classList.contains('tilt'),
      tiltState: w.getGraphTilt(),
      plane: getComputedStyle(document.querySelector('#graph-plane')).transform,
      stem: beacon.getBoundingClientRect().height,
      labelOverlap
    };
  });
  assert.equal(tilt.on, true); assert.equal(tilt.tiltState, true);
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
  await page.evaluate(() => window.__app.runCommand('平视星图'));
  await sleep(1100);
  assert.equal(await page.$eval('#graph-stage', el => el.classList.contains('tilt')), false);
  // Voice cosmos exploration test
  await page.evaluate(() => window.__app.runCommand('探索星海'));
  await page.waitForFunction(() => !document.querySelector('#graph-card').classList.contains('hidden'));
  await page.keyboard.press('Escape');
  report.checks.push('2.5D voice toggle tilts the painterly atlas in CSS 3D with zero label overlap; voice cosmos exploration flies directly to stars');

  await page.setViewport({ width: 1100, height: 844 });
  await page.waitForFunction(() => window.__app);
  await page.evaluate(async () => { const w = await import('./workspace.js'); await w.refreshWorkspace(); w.showPane('graph'); });
  await page.waitForFunction(() => document.querySelectorAll('#graph-world .gnode').length === 9 && document.querySelector('#pane-graph').classList.contains('on'));
  await sleep(300);
  await page.evaluate(() => window.__app.runCommand('适应全图'));
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

  // ---- Ultra-clean buttonless Note Editor (zero top bar, zero Save/mic/link-picker/AI buttons) ----
  await page.evaluate(async id => {
    const w = await import('./workspace.js');
    await w.refreshWorkspace();
    w.showPane('knowledge');
    await w.openEditor(id);
  }, cosmosIds.lone);
  await page.waitForFunction(() => !document.querySelector('#note-editor').classList.contains('hidden') && !!document.querySelector('#note-editor .editor-title'));
  const editorUi = await page.evaluate(() => ({
    nativeSelects: document.querySelectorAll('#note-editor select').length,
    zeroTopBar: !document.querySelector('#note-editor .editor-bar') && !document.querySelector('#editor-mic'),
    zeroLinkTrigger: !document.querySelector('#note-editor .rel-add-trigger') && !document.querySelector('#note-editor .link-picker'),
    noClutterButtons: !document.querySelector('#note-editor .concept-pill') && !document.querySelector('#note-editor .editor-tools')
  }));
  assert.equal(editorUi.nativeSelects, 0, 'note editor must not use ugly raw <select>');
  assert.equal(editorUi.zeroTopBar, true, 'note editor has zero top header bar buttons');
  assert.equal(editorUi.zeroLinkTrigger, true, 'note editor has zero manual + 关联笔记 clutter button');
  assert.equal(editorUi.noClutterButtons, true, 'zero old-era button piles in note editor');
  await sleep(420);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-note-editor-clean.png') });
  await page.evaluate(async () => { const w = await import('./workspace.js'); await w.closeEditor(); });
  await page.waitForFunction(() => document.querySelector('#note-editor').classList.contains('hidden'));
  report.checks.push('Pure buttonless Note Editor canvas (zero top bar, zero Save/mic/+关联笔记/AI/concept buttons, zero raw <select>; auto-save + [[title]] & voice linking)');

  // ---- Z-Axis Semantic Zoom (流 <-> 知识 <-> 星海 + Cosmos dive-in into star note) ----
  assert.equal(await page.evaluate(() => !document.querySelector('.intent-spaces') && !!document.querySelector('.z-depth-track')), true, 'old 3-tab box replaced by frameless Z-depth hairline track');
  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('shelf'); });
  await sleep(200);
  await page.evaluate(() => {
    document.querySelector('#library').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector('#pane-knowledge').classList.contains('on'));
  await sleep(460);
  await page.evaluate(() => {
    document.querySelector('#library').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector('#pane-graph').classList.contains('on'));
  await sleep(460);
  await page.evaluate(async id => {
    const w = await import('./workspace.js');
    w.diveFromCosmos(id);
  }, cosmosIds.b);
  await page.waitForFunction(() => document.querySelector('#pane-knowledge').classList.contains('on') && !document.querySelector('#note-editor').classList.contains('hidden'));
  assert.equal(await page.$eval('#note-editor .editor-title', el => el.value), '元认知');
  await page.evaluate(async () => { const w = await import('./workspace.js'); await w.closeEditor(); });
  await page.waitForFunction(() => document.querySelector('#note-editor').classList.contains('hidden'));
  report.checks.push('Z-Axis Semantic Zoom transitions continuously across 流 -> 知识 -> 星海 and dives from a cosmos star directly into its note');

  // ---- Natural-language & voice direct-control + Hold+Push-Left Peek + Drag-to-Stack + Multi-Paragraph Dark Highlight + Chained Commands + E-Ink / Left-Hand / Scroll / Vertical-RL ----
  assert.equal(await page.$eval('#command-mask', el => el.classList.contains('hidden')), true);
  await page.evaluate(async () => { const w = await import('./workspace.js'); w.showPane('shelf'); });
  await sleep(250);
  // Long-press bottom breathing hairline opens pure whisper command bar (zero chip clutter)
  const barPt = await page.$eval('#spatial-bar', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(barPt.x, barPt.y); await page.mouse.down(); await sleep(540); await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('#command-mask').classList.contains('hidden'));
  await sleep(360);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-command-bar.png') });
  // Compound natural-language command: dark mode + 星海 + 暮色 + 2.5D
  await page.type('#cmd-input', '深色模式，去星海看暮色并开立体');
  await page.keyboard.press('Enter');
  await page.waitForFunction(async () => {
    const w = await import('./workspace.js');
    return document.querySelector('#command-mask').classList.contains('hidden')
      && document.documentElement.dataset.appearance === 'dark'
      && document.querySelector('#pane-graph').classList.contains('on')
      && document.querySelector('#graph-stage').classList.contains('tilt')
      && w.getGraphMood() === 'dusk'
      && !!document.querySelector('#toast .toast-undo');
  });
  // One-tap Undo reverts the whole compound command cleanly
  await page.click('#toast .toast-undo');
  await page.waitForFunction(() => document.documentElement.dataset.appearance !== 'dark'
    && !document.querySelector('#graph-stage').classList.contains('tilt')
    && document.querySelector('#pane-shelf').classList.contains('on'));

  // Seed fresh books (including 《黄仁勋传》 & 《砂女》) for Peek, Drag-to-Stack, Fuzzy ASR, Ordinal, Multi-Step Chain & Dark Highlight tests
  await page.evaluate(async () => {
    localStorage.removeItem('rr-stacks');
    const { db } = window.__app;
    const now = Date.now();
    await db.put('books', { id: 'z-v', title: '砂女', author: '安部公房', type: 'txt', progress: 0.12, lastLabel: '第一章', lastSnippet: '虽然不知有没有人真正来关心，事出蹊跷，也至少有看热闹的人，他们的好奇心，一定像忘了摘下的柿子似的熟透了。', addedAt: now + 2000, lastOpened: now + 2000, pos: null, bookmarks: [], highlights: [] });
    await db.put('files', { id: 'z-v', blob: new Blob(['第一章\n\n虽然不知有没有人真正来关心，事出蹊跷，也至少有看热闹的人。\n\n结果，自然而然，教务主任为了打听搜索申请书的填写方法，准备上警察局去查问。\n\n' + '自然交互让阅读回归纯粹与安静。\n'.repeat(60)], { type: 'text/plain' }) });
    await db.put('books', { id: 'z-hw', title: '黄仁勋传', author: '史蒂芬·维特', type: 'txt', progress: 0, addedAt: now + 1000, lastOpened: 0, pos: null, bookmarks: [], highlights: [] });
    await db.put('files', { id: 'z-hw', blob: new Blob(['序章\n\n在硅谷一家普通的丹尼餐厅里，三个年轻人决定造出改变计算世界的芯片。\n'.repeat(35)], { type: 'text/plain' }) });
    await window.__app.renderLibrary();
  });
  await page.waitForSelector('.book[data-id="z-v"]');
  await sleep(480);

  // 1) Fluid Horizontal Right-Swipe on a book card -> instant Book Peek Card (no hold delay!)
  const peekPt = await page.$eval('.book[data-id="z-v"]', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * 0.28, y: r.top + r.height / 2 }; });
  await page.mouse.move(peekPt.x, peekPt.y);
  await page.mouse.down();
  await page.mouse.move(peekPt.x + 82, peekPt.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('#peek-mask').classList.contains('hidden') && document.querySelector('#pane-shelf').classList.contains('on'));
  const peekCheck = await page.evaluate(() => ({
    title: document.querySelector('#peek-title').textContent,
    kicker: document.querySelector('#peek-kicker').textContent,
    body: document.querySelector('#peek-body').textContent
  }));
  assert.equal(peekCheck.title, '砂女');
  assert.ok(peekCheck.kicker.includes('第一章'));
  assert.ok(peekCheck.body.includes('柿子'));
  await sleep(320);
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-peek-card.png') });
  await page.click('#peek-close');
  await page.waitForFunction(() => document.querySelector('#peek-mask').classList.contains('hidden'));
  report.checks.push('Fluid right-swipe on a stream card opens frosted Book Peek card immediately without hold delay or switching panes');

  // 2) Home-screen Drag-to-Stack: long-press (~320ms) lifts card -> drop onto another book -> auto-merges into a stack!
  const dragPts = await page.evaluate(() => {
    const a = document.querySelector('.book[data-id="z-v"]').getBoundingClientRect();
    const b = document.querySelector('.book[data-id="z-hw"]').getBoundingClientRect();
    return { ax: a.left + a.width * 0.5, ay: a.top + a.height / 2, bx: b.left + b.width * 0.5, by: b.top + b.height / 2 };
  });
  await page.mouse.move(dragPts.ax, dragPts.ay);
  await page.mouse.down();
  await sleep(360);
  await page.mouse.move(dragPts.bx, dragPts.by, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__app.stacks.list().length === 1 && !!document.querySelector('#toast .toast-undo'));
  // Undo stack merge cleanly
  await page.click('#toast .toast-undo');
  await page.waitForFunction(() => window.__app.stacks.list().length === 0);
  report.checks.push('Home-screen long-press lift + drag onto another book auto-merges them into a Card Stack with 1-tap undo');

  // 3) Fuzzy ASR typo matching («打开黄仁勋的再记» -> 《黄仁勋传》) & Ordinal («打开倒数第二本书»)
  await page.evaluate(() => window.__app.runCommand('打开黄仁勋的再记'));
  await page.waitForFunction(() => document.querySelector('#reader').classList.contains('active') && document.querySelector('#r-title').textContent === '黄仁勋传');
  await page.evaluate(() => window.__app.runCommand('返回列表'));
  await page.waitForFunction(() => document.querySelector('#library').classList.contains('active'));
  await page.evaluate(() => window.__app.runCommand('打开第一本书'));
  await page.waitForFunction(() => document.querySelector('#reader').classList.contains('active'));
  await page.evaluate(() => window.__app.runCommand('返回列表'));
  await page.waitForFunction(() => document.querySelector('#library').classList.contains('active'));

  // 4) 6-step chained natural-language command: shrink font + close eye-care + open book + go page 2 + add bookmark + excerpt paragraph 1
  await page.evaluate(() => window.__app.runCommand('开护眼模式'));
  const preChainSize = await page.evaluate(async () => (await import('./settings.js')).settings.size);
  await page.evaluate(() => window.__app.runCommand('字调小一点，关闭护眼模式，打开砂女，再为第2页添加一个标签，并帮我摘抄第一段'));
  await page.waitForFunction(() => document.querySelector('#reader').classList.contains('active') && document.querySelector('#r-title').textContent === '砂女');
  const chainRes = await page.evaluate(async () => {
    const { settings } = await import('./settings.js');
    const b = await window.__app.db.get('books', 'z-v');
    return {
      size: settings.size, theme: settings.theme,
      bookmarks: (b?.bookmarks || []).length,
      highlights: (b?.highlights || []).length,
      marksInDom: document.querySelectorAll('#viewer mark.rr-mark-el').length
    };
  });
  assert.equal(chainRes.size, preChainSize - 2);
  assert.equal(chainRes.theme, 'paper');
  assert.ok(chainRes.bookmarks >= 1, 'chained bookmark created');
  assert.ok(chainRes.highlights >= 1, 'chained excerpt saved');
  assert.ok(chainRes.marksInDom >= 1, 'chained highlight painted in DOM');

  // 5) Dark-mode multi-paragraph highlighting + ultra-clean 3-pill #select-bar + 2-button #bars
  await page.evaluate(() => window.__app.runCommand('深色模式'));
  const readerChrome = await page.evaluate(() => ({
    selectBtns: [...document.querySelectorAll('#select-bar button')].map(b => b.textContent),
    barBtns: [...document.querySelectorAll('#bars .btn-row button span')].map(s => s.textContent),
    readerCmdBar: !!document.querySelector('#reader-cmd-bar'),
    noBookmarkStar: !document.querySelector('#btn-bm'),
    noPanelCloseX: !document.querySelector('#panel-close')
  }));
  assert.deepEqual(readerChrome.selectBtns, ['划线', '想法', '问 AI']);
  assert.deepEqual(readerChrome.barBtns, ['目录', '说一句']);
  assert.equal(readerChrome.readerCmdBar, true);
  assert.equal(readerChrome.noBookmarkStar, true, 'star bookmark button removed from reader top bar');
  assert.equal(readerChrome.noPanelCloseX, true, 'old X close button removed from spatial reader drawer');
  // Select across 2 paragraphs in dark mode and highlight
  await page.evaluate(() => {
    const ps = [...document.querySelectorAll('#viewer .txtcols p')].slice(0, 2);
    const range = document.createRange();
    range.setStart(ps[0].firstChild, 0);
    range.setEnd(ps[1].lastChild, ps[1].lastChild.textContent.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.body.classList.add('selecting');
    document.querySelector('#select-bar').classList.remove('hidden');
  });
  await page.click('#btn-hl');
  await sleep(250);
  const darkHl = await page.evaluate(() => {
    const marks = [...document.querySelectorAll('#viewer mark.rr-mark-el')];
    const totalChars = marks.reduce((s, m) => s + (m.textContent || '').length, 0);
    return { count: marks.length, totalChars, bg: marks[0] ? getComputedStyle(marks[0]).backgroundColor : '' };
  });
  assert.ok(darkHl.totalChars > 20, `multi-paragraph highlight covers full selection (${darkHl.totalChars} chars), never 1 char`);
  assert.ok(darkHl.bg && darkHl.bg !== 'rgba(0, 0, 0, 0)', 'highlight is visibly rendered on dark theme');

  // Reader Z-Axis Bird's-Eye Zoom: Ctrl+Wheel / pinch out opens full-book index with #reader.bird-eye, reverse dives back in
  await page.evaluate(() => {
    document.querySelector('#reader').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => !document.querySelector('#panel').classList.contains('hidden') && document.querySelector('#reader').classList.contains('bird-eye'));
  await sleep(420);
  await page.evaluate(() => {
    document.querySelector('#reader').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector('#panel').classList.contains('hidden') && !document.querySelector('#reader').classList.contains('bird-eye'));

  // 6) Reader ergonomic modes: E-Ink, Left-Hand, Scrolled vertical, Traditional Vertical-RL (台湾竖排)
  await page.evaluate(() => window.__app.runCommand('开墨水屏'));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('mode-eink')), true);
  await page.evaluate(() => window.__app.runCommand('关墨水屏'));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('mode-eink')), false);
  await page.evaluate(() => window.__app.runCommand('开左手模式'));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('left-hand')), true);
  await page.evaluate(() => window.__app.runCommand('打开右撇子模式'));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('left-hand')), false);
  await page.evaluate(() => window.__app.runCommand('眼睛累了'));
  assert.equal(await page.evaluate(async () => { const s = (await import('./settings.js')).settings; return s.theme === 'sepia' && s.lh >= 2.0; }), true);
  await page.evaluate(() => window.__app.runCommand('上下翻页'));
  assert.equal(await page.evaluate(() => document.body.classList.contains('flow-scrolled') && document.querySelector('.txtcols').classList.contains('scrolled')), true);
  await page.evaluate(() => window.__app.runCommand('竖排阅读'));
  assert.equal(await page.evaluate(() => document.body.classList.contains('writing-vrl') && getComputedStyle(document.querySelector('.txtcols')).writingMode === 'vertical-rl'), true);
  await page.evaluate(() => window.__app.runCommand('恢复横排'));
  assert.equal(await page.evaluate(() => document.body.classList.contains('writing-vrl')), false);
  await page.evaluate(() => window.__app.runCommand('返回列表'));
  await page.waitForFunction(() => document.querySelector('#library').classList.contains('active'));
  const beforeNotes = await page.evaluate(async () => (await (await import('./knowledge.js')).listNotes()).length);
  await page.evaluate(() => window.__app.runCommand('我有想法：自然指令比翻菜单更直觉'));
  const afterNotes = await page.evaluate(async () => (await (await import('./knowledge.js')).listNotes()).length);
  assert.equal(afterNotes, beforeNotes + 1);
  report.checks.push('Chained 6-step voice command, fuzzy ASR book match (黄仁勋的再记->黄仁勋传), ordinal books, dark multi-paragraph highlight, 3-pill select bar, E-Ink, Left-Hand, Scrolled flow, and Traditional Vertical-RL typography all verified');

  // ---- Full-format offline parsers (MOBI binary, DOCX zip, Markdown) + AI Book Finder / OPDS / URL command parser ----
  const formatCheck = await page.evaluate(async () => {
    const { parseNaturalCommands } = await import('./command.js');
    // 1) Synthetic valid uncompressed BOOKMOBI binary
    const bodyText = new TextEncoder().encode('<html><body><h1>第一章</h1><p>这是本地离线解析的 MOBI 电子书正文。</p></body></html>');
    const r0 = new Uint8Array(16);
    const r0v = new DataView(r0.buffer);
    r0v.setUint16(0, 1, false); // compression = 1 (none)
    r0v.setUint16(8, 1, false); // textRecordCount = 1
    r0v.setUint16(12, 0, false); // encryption = 0
    const headerLen = 78 + 2 * 8;
    const mobiBuf = new Uint8Array(headerLen + r0.length + bodyText.length);
    const mv = new DataView(mobiBuf.buffer);
    const titleBytes = new TextEncoder().encode('MobiDemoBook');
    mobiBuf.set(titleBytes, 0);
    mobiBuf.set(new TextEncoder().encode('BOOKMOBI'), 60);
    mv.setUint16(76, 2, false);
    mv.setUint32(78, headerLen, false);
    mv.setUint32(86, headerLen + r0.length, false);
    mobiBuf.set(r0, headerLen);
    mobiBuf.set(bodyText, headerLen + r0.length);
    const mobiRes = await window.__app.importBlob(new Blob([mobiBuf]), 'demo.mobi');

    // 2) Synthetic valid DOCX zip
    const dzip = new window.JSZip();
    dzip.file('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Docx样书</dc:title><dc:creator>测试作者</dc:creator></cp:coreProperties>');
    dzip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>这是本地解析的 DOCX 正文。</w:t></w:r></w:p></w:body></w:document>');
    const docxRes = await window.__app.importBlob(await dzip.generateAsync({ type: 'blob' }), 'sample.docx');

    // 3) Markdown file
    const mdRes = await window.__app.importBlob(new Blob(['# 思考笔记\n\n这是 **Markdown** 导入的正文。']), 'notes.md');

    // 4) Subtitle (.srt) transcript + Image (.png) visual booklet + Voice Stack & Live UI Style commands
    const srtRes = await window.__app.importBlob(new Blob(['1\n00:00:01,000 --> 00:00:04,000\n欢迎收听本期播客。\n\n2\n00:00:05,000 --> 00:00:08,000\n今天我们聊聊系统思维。']), 'podcast.srt');
    const tinyPng = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const imgRes = await window.__app.importBlob(new Blob([tinyPng], { type: 'image/png' }), 'poster.png');

    return {
      mobi: mobiRes.status,
      docx: docxRes.status === 'added' && docxRes.title === 'Docx样书',
      md: mdRes.status === 'added' && mdRes.title === '思考笔记',
      srt: srtRes.status === 'added' && srtRes.title === 'podcast',
      img: imgRes.status === 'added' && imgRes.title === 'poster',
      cmdFind: parseNaturalCommands('帮我找《平凡的世界》')[0],
      cmdOpds: parseNaturalCommands('配置书源 https://standardebooks.org/feeds/opds/all')[0],
      cmdUrl: parseNaturalCommands('https://example.com/essay')[0],
      cmdStackCreate: parseNaturalCommands('把第一本书、第二本书、第三本书新建一个卡片堆')[0],
      cmdStackRemove: parseNaturalCommands('把第一个卡片堆的第一本书拿出来')[0],
      cmdStackMerge: parseNaturalCommands('把第一个卡片堆和第二个卡片堆合并')[0],
      cmdAskAi: parseNaturalCommands('问AI：什么是熵增')[0],
      cmdStyleUi: parseNaturalCommands('改界面：把背景变成浅墨绿')[0]
    };
  });
  assert.equal(formatCheck.mobi, 'added', 'MOBI binary parses and imports offline');
  assert.equal(formatCheck.docx, true, 'DOCX zip parses and imports offline');
  assert.equal(formatCheck.md, true, 'Markdown parses and imports offline');
  assert.equal(formatCheck.srt, true, 'SRT subtitle parses into readable transcript offline');
  assert.equal(formatCheck.img, true, 'PNG image imports as visual booklet offline');
  assert.deepEqual(formatCheck.cmdFind, { op: 'findBook', query: '平凡的世界' });
  assert.deepEqual(formatCheck.cmdOpds, { op: 'setOpds', url: 'https://standardebooks.org/feeds/opds/all' });
  assert.deepEqual(formatCheck.cmdUrl, { op: 'importUrl', url: 'https://example.com/essay' });
  assert.deepEqual(formatCheck.cmdStackCreate, { op: 'stackCreate', ordinals: [1, 2, 3], name: '' });
  assert.deepEqual(formatCheck.cmdStackRemove, { op: 'stackRemove', stackIndex: 1, itemIndex: 1 });
  assert.deepEqual(formatCheck.cmdStackMerge, { op: 'stackMerge', a: 1, b: 2 });
  assert.deepEqual(formatCheck.cmdAskAi, { op: 'askAi', question: '什么是熵增' });
  assert.deepEqual(formatCheck.cmdStyleUi, { op: 'styleUi', prompt: '把背景变成浅墨绿' });
  report.checks.push('All-format offline importers (MOBI/AZW3, DOCX, Markdown, SRT/VTT transcripts, PNG/JPG visual booklets) + Voice Stack control + Direct Voice-to-AI + Live UI Styling verified');

  // 「思潮 × Zone」独立判断闭环端到端验证：语音打开 -> 选事件 -> 独立判断 -> 解锁 AI 视角 -> 沉淀判断星 -> 判断档案
  await page.evaluate(() => window.__app.runCommand('今日思潮'));
  await page.waitForFunction(() => !document.querySelector('#sichao-mask').classList.contains('hidden') && document.querySelectorAll('.sc-card').length >= 3);
  await page.click('.sc-card');
  await page.waitForSelector('.sc-opt[data-v="D"]');
  await page.click('.sc-opt[data-v="D"]');
  await page.click('#sc-submit');
  await page.waitForSelector('.sc-ai');
  await page.screenshot({ path: path.resolve(root, 'test-results/zone-sichao.png') });
  await page.evaluate(() => window.__app.handleBack());
  await page.waitForFunction(() => document.querySelector('#sichao-mask').classList.contains('hidden'));
  report.checks.push('思潮 × Zone end-to-end judgment loop (event facts -> independent A~E verdict -> AI partner unlock -> sync to 星海 -> archive) verified');

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
