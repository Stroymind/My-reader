// 把阅读器的静态文件复制到 Capacitor 的 www/。不包含 tweet-to-text、Android 工程和依赖。
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'www');
const files = [
  'index.html', 'app.css', 'app.js', 'db.js', 'engines.js', 'importer.js',
  'settings.js', 'sw.js', 'manifest.webmanifest'
];
const dirs = ['fonts', 'icons', 'vendor'];

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const file of files) await cp(path.join(root, file), path.join(dest, file));
for (const dir of dirs) await cp(path.join(root, dir), path.join(dest, dir), { recursive: true });
console.log('已同步阅读器文件到 www/');
