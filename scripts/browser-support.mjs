import { existsSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
export function browserPath() {
  const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const found = candidates.find(p => p && existsSync(p));
  if (!found) throw new Error('Set CHROME_PATH to a Chromium executable');
  return found;
}
export async function serve(root) {
  const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2', '.png':'image/png', '.webmanifest':'application/manifest+json' };
  const server = createServer((req, res) => {
    let name;
    try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    if (name === '/') name = '/index.html';
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(path.resolve(root) + path.sep) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close(); } };
}
