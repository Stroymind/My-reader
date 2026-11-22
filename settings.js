export const FONTS = {
  serif: { label: '宋体', stack: '"RR Latin Serif","RR CJK Serif","Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif' },
  kai: { label: '文楷', stack: '"RR Kai","RR Latin Serif","LXGW WenKai","Kaiti SC",serif' },
  sans: { label: '黑体', stack: 'system-ui,-apple-system,"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif' },
  custom: { label: '自定义', stack: '"ZoneCustomFont","RR Latin Serif","RR CJK Serif",serif' },
  original: { label: '原书', stack: null }
};
let customFontUrl = '';
let customFontName = '';
export async function applyCustomFontBlob(blob, name = '') {
  if (!blob) return false;
  if (customFontUrl) { try { URL.revokeObjectURL(customFontUrl); } catch {} }
  customFontUrl = URL.createObjectURL(blob);
  customFontName = String(name || '自定义字体').replace(/\.(ttf|otf|woff2?|ttc)$/i, '').trim() || '自定义字体';
  FONTS.custom.label = customFontName.slice(0, 8);
  try {
    const face = new FontFace('ZoneCustomFont', `url("${customFontUrl}")`);
    await face.load();
    document.fonts.add(face);
  } catch {}
  return true;
}
export function getCustomFontName() { return customFontName; }
export const THEMES = {
  paper: { label: '纸张', bg: '#faf9f6', fg: '#2b2a28', muted: '#8d8a84' },
  white: { label: '白色', bg: '#ffffff', fg: '#1f1f1f', muted: '#8a8a8a' },
  sepia: { label: '护眼', bg: '#f3ead7', fg: '#4f4130', muted: '#8f7d64' },
  night: { label: '夜间', bg: '#1c1c1e', fg: '#f2f2f7', muted: '#98989d' }
};
const KEY = 'rr-settings';
const DEFAULTS = { theme: 'paper', font: 'serif', size: 19, lh: 1.8, margin: 10, eink: false, leftHand: false, flow: 'paginated', writing: 'horizontal' };
export const settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
export function saveSettings() { localStorage.setItem(KEY, JSON.stringify(settings)); }
export function appearancePref() {
  const v = localStorage.getItem('rr-appearance') || 'system';
  return v === 'light' || v === 'dark' ? v : 'system';
}
export function applyAppearance() {
  const pref = appearancePref();
  const systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const reading = !!document.getElementById('reader')?.classList.contains('active');
  const inReaderPlugin = !!(reading || document.documentElement.classList.contains('in-bot-reader') || document.documentElement.classList.contains('legacy-reader-home'));
  const dark = !(settings.eink && inReaderPlugin) && (pref === 'dark' || (pref === 'system' && systemDark));
  document.documentElement.classList.toggle('appearance-dark', dark);
  document.documentElement.classList.toggle('mode-eink', !!settings.eink);
  document.documentElement.classList.toggle('left-hand', !!settings.leftHand);
  document.documentElement.dataset.appearance = pref;
  document.body?.classList.toggle('flow-scrolled', settings.flow === 'scrolled');
  document.body?.classList.toggle('writing-vrl', settings.writing === 'vertical-rl');
  const bg = (settings.eink && inReaderPlugin) ? '#ffffff' : (reading ? (THEMES[settings.theme]?.bg || '#faf9f6') : (dark ? '#000000' : '#ffffff'));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
  const btn = document.getElementById('btn-appearance');
  if (btn) {
    const name = pref === 'light' ? '浅色' : pref === 'dark' ? '深色' : '自动';
    const label = btn.querySelector('.menu-label') || btn;
    label.textContent = '外观 · ' + name;
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
  const eink = !!settings.eink;
  const vrl = settings.writing === 'vertical-rl';
  const t = eink ? { bg: '#ffffff', fg: '#000000', muted: '#444444' } : THEMES[settings.theme];
  const f = { stack: fontStack(cjk) };
  const font = f.stack ? `html, body, p, div, span, li, blockquote, td, h1, h2, h3, h4, h5, h6 { font-family: ${f.stack} !important; }` : '';
  // 隐形出版级自动排版：英文书自动连字断词与连字字偶距、中文书避头尾标点禁则、自动修正糟糕 EPUB 的错乱缩进与固定宽
  const langRules = cjk
    ? `p { text-align: justify; line-break: strict; overflow-wrap: break-word; margin: 0 0 0.45em !important; ${vrl ? 'text-indent: 2em;' : ''} }`
    : `p { text-align: justify; hyphens: auto; -webkit-hyphens: auto; hyphenate-limit-chars: 6 3 2; font-kerning: normal; font-variant-ligatures: common-ligatures contextual; margin: 0 0 0.62em !important; text-indent: 1.35em; }
h1 + p, h2 + p, h3 + p, h4 + p, hr + p, blockquote + p, body > p:first-of-type { text-indent: 0; }`;
  const customFace = customFontUrl ? `@font-face { font-family: "ZoneCustomFont"; src: url("${customFontUrl}"); font-display: swap; }\n` : '';
  return `@import url("${new URL('fonts/fonts.css', location.href)}");
${customFace}html { background: ${t.bg} !important; ${vrl ? 'writing-mode: vertical-rl !important; -webkit-writing-mode: vertical-rl !important; text-orientation: mixed !important;' : ''} }
body { color: ${t.fg} !important; background: transparent !important; padding-top: 0 !important; padding-bottom: 0 !important; margin-top: 0 !important; margin-bottom: 0 !important; -webkit-text-size-adjust: 100%; overflow-wrap: anywhere; text-rendering: optimizeLegibility; ${vrl ? 'writing-mode: vertical-rl !important; -webkit-writing-mode: vertical-rl !important; text-orientation: mixed !important; line-break: strict;' : ''} }
body, p, div, section, article { max-width: 100% !important; box-sizing: border-box !important; }
p, div { margin-left: 0 !important; margin-right: 0 !important; }
body * { color: inherit; }
${font}
body { font-size: ${settings.size}px !important; }
${f.stack ? 'p { font-size: 1em !important; }' : ''}
p, li, blockquote, div { line-height: ${settings.lh} !important; }
${langRules}
h1, h2, h3 { line-height: 1.35 !important; break-after: avoid; page-break-after: avoid; }
a { color: ${eink ? '#000000' : (settings.theme === 'night' ? '#8fb8d8' : '#3c6e91')} !important; ${eink ? 'text-decoration: underline;' : ''} }
img, svg, video, table, pre { max-width: 100% !important; }
pre, code { white-space: pre-wrap !important; }
img, svg, video { height: auto; ${eink ? 'filter: grayscale(100%) contrast(1.1);' : (settings.theme === 'night' ? 'filter: brightness(.85);' : '')} }
rt { font-size: 50%; }
mark.rr-mark-el { color: inherit !important; border-radius: 3px; padding: 1px 0; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
mark.rr-mark-el.rr-hl { background: ${eink ? 'rgba(0,0,0,.14)' : (settings.theme === 'night' ? 'rgba(232,192,82,.30)' : 'rgba(236,200,88,.45)')} !important; border-bottom: 1.5px solid ${eink ? '#000' : (settings.theme === 'night' ? 'rgba(246,214,116,.78)' : 'rgba(202,154,32,.65)')}; }
mark.rr-mark-el.rr-ex { background: ${eink ? 'rgba(0,0,0,.10)' : (settings.theme === 'night' ? 'rgba(116,184,158,.30)' : 'rgba(130,194,170,.44)')} !important; border-bottom: 1.5px solid ${eink ? '#000' : (settings.theme === 'night' ? 'rgba(148,214,188,.76)' : 'rgba(72,148,120,.65)')}; }
mark.rr-mark-el.rr-an { background: ${eink ? 'rgba(0,0,0,.18)' : (settings.theme === 'night' ? 'rgba(98,162,255,.30)' : 'rgba(104,168,255,.36)')} !important; border-bottom: 1.5px solid ${eink ? '#000' : (settings.theme === 'night' ? 'rgba(136,188,255,.78)' : 'rgba(42,118,226,.62)')}; }
${!eink && settings.theme === 'night' ? 'body [style*="color"], body font { color: inherit !important; } body *:not(mark.rr-mark-el) { background-color: transparent !important; }' : ''}
${eink ? '*, *::before, *::after { transition: none !important; animation: none !important; text-shadow: none !important; }' : ''}
`;
}
