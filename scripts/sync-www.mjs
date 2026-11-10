// 把阅读器的静态文件复制到 Capacitor 的 www/。不包含 tweet-to-text、Android 工程和依赖。
// 复制之后核对：源码 import 到的每个模块都必须在 www/ 里，并且（除 service worker 自身外）写进 sw.js 预缓存。
// 缺任何一个就退出失败，避免打出白屏、导入无反应的安装包。
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'www');
const assetDirs = ['fonts', 'icons', 'vendor'];
const staticFiles = ['index.html', 'app.css', 'manifest.webmanifest'];

const importFromRe = /\bfrom\s*['"](\.[^'"]+)['"]/g;
const importBareRe = /^\s*import\s*['"](\.[^'"]+)['"]/gm;
const importDynamicRe = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const workerRe = /workerSrc\s*=\s*['"](\.[^'"]+)['"]/g;
const swRegisterRe = /serviceWorker\.register\(\s*['"]([^'"]+)['"]\s*\)/g;
const tagRe = /<(script|link)\b[^>]*>/gi;
const attrRe = /\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/i;

function posixRel(fromFile, spec) {
  const clean = spec.split('#')[0].split('?')[0];
  const base = path.posix.dirname(fromFile);
  const rel = path.posix.normalize(path.posix.join(base === '.' ? '' : base, clean));
  if (!rel || rel === '.' || rel.startsWith('../') || rel === '..' || rel.startsWith('/')) {
    throw new Error(`${fromFile} 引用了打包范围之外的路径 ${spec}`);
  }
  return rel;
}

function remember(map, rel, from, precache) {
  const prev = map.get(rel);
  if (!prev) map.set(rel, { rel, from: [from], precache });
  else {
    if (!prev.from.includes(from)) prev.from.push(from);
    prev.precache = prev.precache || precache;
  }
}

function scanJsSpecifiers(text) {
  const specs = [];
  const lines = text.split('\n').filter(line => !line.trim().startsWith('//'));
  const body = lines.join('\n');
  for (const re of [importFromRe, importBareRe, importDynamicRe, workerRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body))) specs.push({ spec: m[1], precache: true });
  }
  swRegisterRe.lastIndex = 0;
  let sw;
  while ((sw = swRegisterRe.exec(body))) specs.push({ spec: sw[1], precache: false });
  return specs;
}

export async function collectRequired(startRoot) {
  const required = new Map();
  const html = await readFile(path.join(startRoot, 'index.html'), 'utf8');
  tagRe.lastIndex = 0;
  let tag;
  while ((tag = tagRe.exec(html))) {
    const attr = tag[0].match(attrRe);
    if (!attr) continue;
    const url = attr[1];
    if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('#')) continue;
    remember(required, posixRel('index.html', url), 'index.html', true);
  }
  const queue = [...required.values()].map(item => item.rel);
  const seenJs = new Set();
  while (queue.length) {
    const rel = queue.shift();
    if (!/\.(js|mjs)$/.test(rel) || rel.startsWith('vendor/') || seenJs.has(rel)) continue;
    seenJs.add(rel);
    const text = await readFile(path.join(startRoot, rel), 'utf8');
    for (const { spec, precache } of scanJsSpecifiers(text)) {
      const next = posixRel(rel, spec);
      remember(required, next, rel, precache);
      if (/\.(js|mjs)$/.test(next) && !next.startsWith('vendor/')) queue.push(next);
    }
  }
  return [...required.values()];
}

export function precacheList(source) {
  const m = source.match(/const FILES = (\[[\s\S]*?\]);/);
  if (!m) throw new Error('sw.js 里找不到预缓存列表 FILES');
  const list = vm.runInNewContext(`(${m[1]})`, Object.create(null), { timeout: 1000 });
  if (!Array.isArray(list) || list.some(item => typeof item !== 'string')) {
    throw new Error('sw.js 的 FILES 不是字符串数组');
  }
  return list;
}

function insideDest(dir, rel) {
  const abs = path.resolve(dir, rel);
  const base = path.resolve(dir);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

async function exists(dir, rel) {
  const abs = insideDest(dir, rel);
  if (!abs) return false;
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}

export async function packagingProblems({ startRoot, wwwDir, required }) {
  const problems = [];
  const precache = precacheList(await readFile(path.join(wwwDir, 'sw.js'), 'utf8'));
  const cache = new Set(precache);
  for (const name of ['bilingual.js', 'epub-repair.js']) {
    const mentioned = [];
    for (const file of ['app.js', 'engines.js', 'importer.js', 'bilingual.js']) {
      const text = await readFile(path.join(startRoot, file), 'utf8').catch(() => '');
      if (text.includes(`./${name}`)) mentioned.push(file);
    }
    if (mentioned.length && !required.some(item => item.rel === name)) {
      problems.push(`依赖扫描漏掉了 ${name}（${mentioned.join('、')} 仍在引用它）`);
    }
  }
  for (const item of required) {
    if (!(await exists(wwwDir, item.rel))) {
      problems.push(`www/ 缺少 ${item.rel}（被 ${item.from.join('、')} 引用）`);
    }
    if (item.precache && !cache.has(`./${item.rel}`)) {
      problems.push(`sw.js 预缓存未包含 ./${item.rel}（被 ${item.from.join('、')} 引用）`);
    }
  }
  for (const entry of precache) {
    if (entry === './' || entry === '.' || entry === '/') continue;
    const rel = entry.replace(/^\.\//, '').replace(/^\//, '');
    if (!rel || rel.split('/').includes('..') || !insideDest(wwwDir, rel)) {
      problems.push(`sw.js 预缓存路径不合法：${entry}`);
      continue;
    }
    if (!(await exists(wwwDir, rel))) problems.push(`sw.js 预缓存了不存在的文件 ${entry}`);
  }
  return problems;
}

async function rootModules() {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && /\.(js|mjs)$/.test(entry.name)).map(entry => entry.name);
}

export async function syncWww() {
  const modules = await rootModules();
  const files = [...new Set([...staticFiles, ...modules])];
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  for (const file of files) await cp(path.join(root, file), path.join(dest, file));
  for (const dir of assetDirs) await cp(path.join(root, dir), path.join(dest, dir), { recursive: true });
  const required = await collectRequired(root);
  const problems = await packagingProblems({ startRoot: root, wwwDir: dest, required });
  if (problems.length) {
    throw new Error(['阅读器打包不完整，已停止构建 Android 安装包。', ...problems].join('\n'));
  }
  const names = required.map(item => item.rel).sort();
  console.log(`已同步阅读器文件到 www/，并核对 ${names.length} 个被引用文件。`);
  console.log(names.join('\n'));
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirect) await syncWww();
