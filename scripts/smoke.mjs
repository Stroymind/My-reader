// 浏览器冒烟：批量导入、阅读、高亮、复制、摘录、书签、离线。样书只写在临时目录。
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8765;
const base = `http://127.0.0.1:${port}`;
const dir = await mkdtemp(path.join(tmpdir(), 'shufang-'));

const py = `
import os, zipfile
from pathlib import Path
d = Path(${JSON.stringify(dir)})
(d / "雨天.txt").write_text("第一章 雨\\n\\n雨从屋檐落下来，打湿了台阶。\\n\\n她把书合上，听了一会儿。\\n\\n灯亮得很晚。句子还停在上一页。\\n\\n第二章 灯\\n\\n另一章只有这一句，用来确认目录。\\n", encoding="utf-8")
(d / "国标.txt").write_bytes("这是一本用国标编码保存的小书。\\n院子里有一棵槐树。\\n".encode("gb18030"))
(d / "窗台.html").write_text("""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>窗台笔记</title>
<meta name="author" content="自写"></head><body>
<h1>窗台笔记</h1>
<p>冬天的下午，槐树落了叶子。</p>
<p>她把这句话留在窗台上。</p>
<script>window.__shouldNotRun = true</script>
</body></html>""", encoding="utf-8")
# pdf
text = "Hello highlight test."
content = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET"
objs = [
"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\\n",
"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\\n",
"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\\n",
f"4 0 obj << /Length {len(content)} >> stream\\n{content}\\nendstream\\nendobj\\n",
"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\\n",
]
header = "%PDF-1.4\\n"
body = ""
offsets = [0]
for obj in objs:
    offsets.append(len(header.encode('latin1')) + len(body.encode('latin1')))
    body += obj
xref_pos = len(header.encode('latin1')) + len(body.encode('latin1'))
xref = f"xref\\n0 {len(objs)+1}\\n0000000000 65535 f \\n"
for off in offsets[1:]:
    xref += f"{off:010d} 00000 n \\n"
trailer = f"trailer << /Size {len(objs)+1} /Root 1 0 R >>\\nstartxref\\n{xref_pos}\\n%%EOF\\n"
(d / "sample.pdf").write_bytes((header + body + xref + trailer).encode('latin1'))

chap = '''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><title>第一章</title></head>
<body>
<h1>第一章 院子</h1>
<p>这是一段可以高亮的测试文字，用来确认选区。</p>
</body></html>'''
nav = '''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">第一章 院子</a></li></ol></nav></body></html>'''
opf = '''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">local-test</dc:identifier>
<dc:title>院子里的书</dc:title>
<dc:creator>自写</dc:creator>
<dc:language>zh-CN</dc:language>
</metadata>
<manifest>
<item id="chap" href="chapter.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
</manifest>
<spine><itemref idref="chap"/></spine>
</package>'''
container = '''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''
epub = d / "院子.epub"
with zipfile.ZipFile(epub, "w") as z:
    info = zipfile.ZipInfo("mimetype")
    info.compress_type = zipfile.ZIP_STORED
    z.writestr(info, "application/epub+zip")
    z.writestr("META-INF/container.xml", container)
    z.writestr("OEBPS/content.opf", opf)
    z.writestr("OEBPS/chapter.xhtml", chap)
    z.writestr("OEBPS/nav.xhtml", nav)
with zipfile.ZipFile(d / "一批书.zip", "w") as z:
    z.writestr("书架/短笺.txt", "短笺正文。今天只写了这一句。\\n")
    z.writestr("书架/另一页.htm", "<html><head><title>另一页</title></head><body><p>压缩包里的网页也可以读。</p></body></html>")
print("fixtures ok")
`;
await new Promise((resolve, reject) => {
  const p = spawn('python3', ['-c', py], { stdio: 'inherit' });
  p.on('exit', code => code === 0 ? resolve() : reject(new Error('fixture failed ' + code)));
});

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 300));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const context = browser.defaultBrowserContext();
await context.overridePermissions(base, ['clipboard-read', 'clipboard-write']);
const page = await browser.newPage();
page.setDefaultTimeout(30000);
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', err => errors.push(err.stack || String(err)));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__app);

const files = ['雨天.txt', '国标.txt', '窗台.html', 'sample.pdf', '院子.epub', '一批书.zip'].map(f => path.join(dir, f));
const input = await page.$('#file-input');
await input.uploadFile(...files);
await page.waitForFunction(() => (document.querySelector('#import-status')?.textContent || '').includes('导入完成'), { timeout: 30000 });
const status = await page.$eval('#import-status', el => el.textContent);
if (!status.includes('新增 7')) throw new Error('批量导入结果不对：' + status);
const types = await page.$$eval('.book .type', els => els.map(e => e.textContent).sort());
for (const t of ['EPUB', 'HTML', 'PDF', 'TXT']) {
  if (!types.includes(t)) throw new Error('缺少类型 ' + t + '：' + types.join(','));
}

async function openNamed(name) {
  await page.evaluate(title => {
    const book = [...document.querySelectorAll('.book')].find(el => el.querySelector('.t').textContent === title);
    book.click();
  }, name);
  await page.waitForFunction(() => document.querySelector('#reader').classList.contains('active') && window.__app.engine);
}

await openNamed('窗台笔记');
await page.waitForFunction(() => (document.querySelector('.txtcols')?.innerText || '').includes('槐树落了叶子'));
const htmlText = await page.$eval('.txtcols', el => el.innerText);
if (htmlText.includes('shouldNotRun') || htmlText.includes('alert')) throw new Error('HTML 脚本被当成正文');
await page.evaluate(() => history.back());
await page.waitForFunction(() => document.querySelector('#library').classList.contains('active'));

await openNamed('雨天');
await page.waitForFunction(() => document.querySelectorAll('.txtcols p').length >= 2);
await page.evaluate(() => {
  const p = [...document.querySelectorAll('.txtcols p')].find(el => el.textContent.includes('雨从屋檐'));
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.body.classList.add('selecting');
  document.getElementById('select-bar').classList.remove('hidden');
});
await page.evaluate(() => document.getElementById('btn-hl').click());
await page.waitForFunction(() => !!document.querySelector('.txtcols mark.hl'));
const hl = await page.$eval('.txtcols mark.hl', el => el.textContent);
if (!hl.includes('雨从屋檐')) throw new Error('高亮文字不对：' + hl);

await page.evaluate(() => {
  const p = [...document.querySelectorAll('.txtcols p')].find(el => el.textContent.includes('她把书合上'));
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.body.classList.add('selecting');
  document.getElementById('select-bar').classList.remove('hidden');
});
await page.evaluate(() => document.getElementById('btn-copy').click());
await page.waitForFunction(async () => {
  const books = await window.__app.db.all('books');
  const book = books.find(b => b.title === '雨天');
  return (book.highlights || []).some(h => h.kind === 'copy' && h.text.includes('她把书合上'));
});
const clip = await page.evaluate(async () => navigator.clipboard.readText());
if (!clip.includes('她把书合上')) throw new Error('剪贴板没有复制到文字：' + clip);

await page.evaluate(() => {
  const p = [...document.querySelectorAll('.txtcols p')].find(el => el.textContent.includes('灯亮得很晚'));
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.body.classList.add('selecting');
  document.getElementById('select-bar').classList.remove('hidden');
});
await page.evaluate(() => document.getElementById('btn-excerpt').click());
await page.waitForSelector('#note-mask:not(.hidden)');
await page.type('#note-text', '夜里记下的一句');
await page.click('#note-save');
await page.waitForFunction(async () => {
  const books = await window.__app.db.all('books');
  const book = books.find(b => b.title === '雨天');
  return (book.highlights || []).some(h => h.kind === 'excerpt' && h.note === '夜里记下的一句');
});
await page.evaluate(() => document.getElementById('btn-bm').click());
await page.waitForFunction(async () => {
  const books = await window.__app.db.all('books');
  return (books.find(b => b.title === '雨天').bookmarks || []).length === 1;
});

await page.screenshot({ path: '/opt/cursor/artifacts/reader-highlight.png' });
await page.evaluate(() => history.back());
await page.waitForFunction(() => document.querySelector('#library').classList.contains('active'));
await page.click('#btn-excerpts');
await page.waitForFunction(() => (document.querySelector('#lib-body')?.innerText || '').includes('夜里记下的一句'));
await page.screenshot({ path: '/opt/cursor/artifacts/excerpts.png' });
await page.click('#lib-close');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__app);
const after = await page.evaluate(async () => {
  const books = await window.__app.db.all('books');
  const book = books.find(b => b.title === '雨天');
  return { n: books.length, highlights: book.highlights.map(h => h.kind).sort(), marks: book.bookmarks.length };
});
if (after.n !== 7) throw new Error('刷新后书的数量不对 ' + after.n);
if (after.marks !== 1 || !after.highlights.includes('highlight') || !after.highlights.includes('copy') || !after.highlights.includes('excerpt')) {
  throw new Error('刷新后摘录或书签丢失 ' + JSON.stringify(after));
}
await page.screenshot({ path: '/opt/cursor/artifacts/library.png' });

await openNamed('雨天');
await page.waitForFunction(() => !!document.querySelector('.txtcols mark.hl'));
await page.evaluate(() => history.back());
await page.waitForSelector('#library.active, #library.view.active');

await openNamed('院子里的书');
await page.waitForFunction(() => {
  const frame = document.querySelector('#viewer iframe');
  return frame && frame.contentDocument && frame.contentDocument.body && frame.contentDocument.body.innerText.includes('可以高亮');
});
await page.evaluate(() => {
  const doc = document.querySelector('#viewer iframe').contentDocument;
  const p = [...doc.querySelectorAll('p')].find(el => el.textContent.includes('可以高亮'));
  const range = doc.createRange();
  range.selectNodeContents(p);
  const sel = doc.defaultView.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
await page.evaluate(() => document.getElementById('btn-hl').click());
await page.waitForFunction(async () => {
  const books = await window.__app.db.all('books');
  const book = books.find(b => b.title === '院子里的书');
  return (book.highlights || []).some(h => h.kind === 'highlight' && h.cfiRange && h.text.includes('可以高亮'));
});
await page.evaluate(() => history.back());
await page.waitForFunction(() => document.querySelector('#library').classList.contains('active'));

await openNamed('sample');
await page.waitForFunction(() => document.querySelector('.pdfpage canvas') && document.querySelector('.textLayer span'));
await page.evaluate(() => {
  const span = [...document.querySelectorAll('.textLayer span')].find(el => (el.textContent || '').includes('Hello'));
  const range = document.createRange();
  range.selectNodeContents(span);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
await page.evaluate(() => document.getElementById('btn-hl').click());
await page.waitForFunction(() => !!document.querySelector('.textLayer span.rr-mark'));

await page.evaluate(() => history.back());
await page.waitForFunction(() => document.querySelector('#library').classList.contains('active'));
await page.waitForFunction(() => navigator.serviceWorker.controller);
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__app && document.querySelectorAll('.book').length === 7);
const offlineTitle = await page.$eval('h1', el => el.textContent);
if (offlineTitle !== '我的书房') throw new Error('离线页面标题不对');

if (errors.length) throw new Error('页面报错：\\n' + errors.join('\\n'));
const tweet = await fetch(base + '/tweet-to-text/index.html');
if (!tweet.ok) throw new Error('tweet-to-text 页面打不开');
const tweetHtml = await tweet.text();
if (!tweetHtml.includes('推文')) throw new Error('tweet-to-text 内容不对');

console.log('SMOKE_OK', status);
await browser.close();
server.kill();
await rm(dir, { recursive: true, force: true });
