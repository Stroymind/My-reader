export const FONTS = {
  serif: { label: '宋体', stack: '"RR Latin Serif","RR CJK Serif","Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif' },
  kai: { label: '文楷', stack: '"RR Kai","RR Latin Serif","LXGW WenKai","Kaiti SC",serif' },
  sans: { label: '黑体', stack: 'system-ui,-apple-system,"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif' },
  original: { label: '原书', stack: null }
};
export const THEMES = {
  paper: { label: '纸张', bg: '#faf9f6', fg: '#2b2a28', muted: '#8d8a84' },
  white: { label: '白色', bg: '#ffffff', fg: '#1f1f1f', muted: '#8a8a8a' },
  sepia: { label: '护眼', bg: '#f3ead7', fg: '#4f4130', muted: '#8f7d64' },
  night: { label: '夜间', bg: '#1c1c1e', fg: '#f2f2f7', muted: '#98989d' }
};
const KEY = 'rr-settings';
const DEFAULTS = { theme: 'paper', font: 'serif', size: 19, lh: 1.8, margin: 24 };
export const settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
export function saveSettings() { localStorage.setItem(KEY, JSON.stringify(settings)); }
export function appearancePref() {
  const v = localStorage.getItem('rr-appearance') || 'system';
  return v === 'light' || v === 'dark' ? v : 'system';
}
export function applyAppearance() {
  const pref = appearancePref();
  const systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = pref === 'dark' || (pref === 'system' && systemDark);
  document.documentElement.classList.toggle('appearance-dark', dark);
  document.documentElement.dataset.appearance = pref;
  const reading = document.getElementById('reader')?.classList.contains('active');
  const bg = reading ? (THEMES[settings.theme]?.bg || '#faf9f6') : (dark ? '#000000' : '#f5f5f7');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
  const btn = document.getElementById('btn-appearance');
  if (btn) {
    const name = pref === 'light' ? '浅色' : pref === 'dark' ? '深色' : '自动';
    btn.textContent = '外观 · ' + name;
    btn.setAttribute('aria-label', '外观，当前是' + name);
  }
}
export function cycleAppearance() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(appearancePref()) + 1) % order.length];
  localStorage.setItem('rr-appearance', next);
  applyAppearance();
  return next;
}
export function applyBodyTheme() {
  for (const k of Object.keys(THEMES)) document.body.classList.toggle('theme-' + k, settings.theme === k);
  applyAppearance();
}
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance());
}
// 注入到 EPUB iframe 的样式
// 中文书：引号、破折号、省略号用中文字形（全角），西文仍用 Literata
export function fontStack(cjk) { const st = FONTS[settings.font].stack; return st && cjk && settings.font === 'serif' ? '"RR CJK Punct",' + st : st; }
export function epubCss(cjk) {
  const t = THEMES[settings.theme], f = { stack: fontStack(cjk) };
  const font = f.stack ? `html, body, p, div, span, li, blockquote, td, h1, h2, h3, h4, h5, h6 { font-family: ${f.stack} !important; }` : '';
  return `@import url("${new URL('fonts/fonts.css', location.href)}");
html { background: ${t.bg} !important; }
body { color: ${t.fg} !important; background: transparent !important; -webkit-text-size-adjust: 100%; overflow-wrap: anywhere; }
body * { color: inherit; }
${font}
body { font-size: ${settings.size}px !important; }
${f.stack ? 'p { font-size: 1em !important; }' : ''}
p, li, blockquote, div { line-height: ${settings.lh} !important; }
p { text-align: justify; }
a { color: ${settings.theme === 'night' ? '#8fb8d8' : '#3c6e91'} !important; }
img, svg, video, table, pre { max-width: 100% !important; }
pre, code { white-space: pre-wrap !important; }
img, svg, video { height: auto; ${settings.theme === 'night' ? 'filter: brightness(.85);' : ''} }
rt { font-size: 50%; }
${settings.theme === 'night' ? 'body [style*="color"], body font { color: inherit !important; } body * { background-color: transparent !important; }' : ''}
`;
}
