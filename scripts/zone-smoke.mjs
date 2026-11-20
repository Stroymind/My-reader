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
