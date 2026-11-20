// 深空星海：确定性的星域布局 + Canvas 2D 星空与星图 + 可聚焦的星体按钮。
// 天空画布不倾斜；星图平面（画布 + 按钮）在 2.5D 模式下用 CSS 3D 倾斜，按钮反向旋转成为立起的标牌。
const TAU = Math.PI * 2;
const GOLDEN = 2.399963229728653;
// 史诗深空星海光谱（JWST 船底座/猎户座/创世之柱/船帆座/玫瑰星云 多色体积梯度）
const BIOMES = [
  { hue: 196, deep: [14, 52, 118], mid: [44, 168, 224], core: [255, 222, 152] }, // 船底座：深钴蓝 → 电离冰青 → 琥珀金核
  { hue: 34,  deep: [44, 34, 108], mid: [196, 86, 98],  core: [255, 212, 134] }, // 猎户炽焰：深靛蓝 → 玫瑰电离氢 → 炽金核
  { hue: 176, deep: [10, 62, 84],  mid: [42, 194, 186], core: [216, 250, 255] }, // 创世之柱：深渊青 → 极光碧 → 冰白蓝核
  { hue: 214, deep: [20, 42, 116], mid: [78, 146, 252], core: [232, 244, 255] }, // 船帆遗迹：深空蓝 → 炽天青 → 银白核
  { hue: 28,  deep: [68, 22, 46],  mid: [224, 118, 56], core: [255, 232, 178] }  // 玫瑰余烬：暗绯空 → 熔金 → 白金恒星核
];
const PALETTE = BIOMES.map(b => b.hue);
export const TILT_DEG = 34;
const TILT_PAN = 1 / Math.cos(TILT_DEG * Math.PI / 180);
const MAG_LABEL = { beacon: '主星', star: '恒星', faint: '未知信号' };
const UI_FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Noto Sans SC","Helvetica Neue",sans-serif';
const MONO_FONT = '"SF Mono","JetBrains Mono","Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const K_MIN = 0.18, K_MAX = 3;

export const magLabel = m => MAG_LABEL[m] || '恒星';
export function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- 布局：同样的笔记永远落在同样的位置 ---------- */
export function layoutCosmos(notes, links, kindOf = () => 'note') {
  const list = (notes || []).slice().sort(byId);
  const ids = new Set(list.map(n => n.id));
  const lanes = [];
  const seen = new Set();
  const pairKey = (a, b) => (a < b ? a + '~' + b : b + '~' + a);
  const add = (a, b, kind) => {
    if (!ids.has(a) || !ids.has(b) || a === b) return;
    const key = pairKey(a, b);
    if (seen.has(key + kind) || (kind === 'tag' && seen.has(key + 'link'))) return;
    seen.add(key + kind);
    lanes.push(a < b ? { a, b, kind } : { a: b, b: a, kind });
  };
  for (const l of (links || []).slice().sort((x, y) => pairKey(x.fromId, x.toId).localeCompare(pairKey(y.fromId, y.toId)))) add(l.fromId, l.toId, 'link');
  const byTag = new Map();
  for (const n of list) for (const t of n.tags || []) {
    if (!byTag.has(t)) byTag.set(t, []);
    byTag.get(t).push(n);
  }
  for (const [, members] of [...byTag].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (members.length < 2) continue;
    const g = members.slice(0, 8);
    if (g.length > 5) for (const n of g.slice(1)) add(g[0].id, n.id, 'tag');
    else for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) add(g[i].id, g[j].id, 'tag');
  }
  const linkDeg = new Map(), tagDeg = new Map();
  const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const l of lanes) { const m = l.kind === 'link' ? linkDeg : tagDeg; inc(m, l.a); inc(m, l.b); }

  const parent = new Map(list.map(n => [n.id, n.id]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const l of lanes) if (l.kind === 'link') {
    const ra = find(l.a), rb = find(l.b);
    if (ra !== rb) { if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb); }
  }
  const primary = n => {
    let best = null, bc = 0;
    for (const t of (n.tags || []).slice().sort()) { const c = byTag.get(t)?.length || 0; if (c > bc) { best = t; bc = c; } }
    return best;
  };
  const score = n => {
    const body = String(n.body || '');
    return (linkDeg.get(n.id) || 0) * 2 + (tagDeg.get(n.id) || 0) * 0.6 + (kindOf(n) === 'concept' ? 3 : 0)
      + (/##\s*判断/.test(body) || body.length > 360 ? 1.5 : 0);
  };
  const comps = new Map();
  for (const n of list) { const r = find(n.id); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(n); }
  const sectorOf = new Map();
  const frontier = [];
  for (const members of comps.values()) {
    const counts = new Map();
    for (const n of members) { const p = primary(n); if (p) counts.set(p, (counts.get(p) || 0) + 1); }
    let name = null, bc = 0;
    for (const [t, c] of [...counts].sort((x, y) => x[0].localeCompare(y[0]))) if (c > bc) { name = t; bc = c; }
    if (!name && members.length > 1) {
      const top = members.slice().sort((x, y) => score(y) - score(x) || byId(x, y))[0];
      name = Array.from(top.title || '未命名').slice(0, 8).join('');
    }
    for (const n of members) {
      if (!linkDeg.get(n.id) && !tagDeg.get(n.id)) frontier.push(n);
      else sectorOf.set(n.id, name || primary(n) || '无名');
    }
  }
  const groups = new Map();
  for (const n of list) {
    const nm = sectorOf.get(n.id);
    if (!nm) continue;
    if (!groups.has(nm)) groups.set(nm, []);
    groups.get(nm).push(n);
  }
  const sectors = [...groups].map(([name, members]) => ({ name, members, frontier: false }))
    .sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name));
  const used = new Set();
  for (const s of sectors) {
    let i = hash(s.name) % PALETTE.length;
    for (let k = 0; k < PALETTE.length && used.has(i); k++) i = (i + 1) % PALETTE.length;
    used.add(i);
    s.hue = PALETTE[i];
  }
  if (frontier.length) sectors.push({ name: '未测绘暗域', members: frontier, frontier: true, hue: 226 });

  const placed = [];
  for (const s of sectors) {
    s.R = 58 + 38 * Math.sqrt(s.members.length);
    if (!placed.length) { s.x = 0; s.y = 0; placed.push(s); continue; }
    const gap = s.frontier ? 70 : 46;
    const a0 = (hash(s.name) % 3600) / 3600 * TAU;
    const start = s.frontier
      ? Math.max(...placed.map(p => Math.hypot(p.x, p.y) + p.R)) + s.R * 0.6 + gap
      : placed[0].R + s.R + gap;
    let ok = false, ang = a0, dist = start;
    for (let step = 0; step < 900 && !ok; step++) {
      ang = a0 + step * 0.41;
      dist = start + step * 4;
      const x = Math.cos(ang) * dist * 0.9, y = Math.sin(ang) * dist * 1.12;
      ok = placed.every(p => Math.hypot(p.x - x, p.y - y) >= p.R + s.R + gap);
      if (ok) { s.x = x; s.y = y; }
    }
    if (!ok) { s.x = Math.cos(ang) * dist; s.y = Math.sin(ang) * dist; }
    placed.push(s);
  }

  const stars = [];
  for (const s of sectors) {
    const members = s.members.slice().sort((a, b) => score(b) - score(a) || byId(a, b));
    const seedA = (hash(s.name + '*') % 1000) / 1000 * TAU;
    const pts = members.map((n, k) => {
      const jitter = s.frontier ? (hash(n.id) % 100) / 100 * 30 : 0;
      const r = k === 0 && !s.frontier ? 0 : 24 + 32 * Math.sqrt(k + (s.frontier ? 1 : 0)) + jitter;
      return { n, x: s.x + Math.cos(seedA + k * GOLDEN) * r, y: s.y + Math.sin(seedA + k * GOLDEN) * r };
    });
    const idx = new Map(pts.map((p, i) => [p.n.id, i]));
    for (let it = 0; it < 60; it++) {
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y, d = Math.hypot(dx, dy) || 0.01;
        if (d < 64) { const f = (64 - d) / 2 / d; pts[i].x -= dx * f; pts[i].y -= dy * f; pts[j].x += dx * f; pts[j].y += dy * f; }
      }
      for (const l of lanes) {
        if (l.kind !== 'link') continue;
        const i = idx.get(l.a), j = idx.get(l.b);
        if (i == null || j == null) continue;
        const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y, d = Math.hypot(dx, dy) || 0.01;
        if (d > 96) { const f = (d - 96) * 0.05 / d; pts[i].x += dx * f; pts[i].y += dy * f; pts[j].x -= dx * f; pts[j].y -= dy * f; }
      }
      for (const p of pts) {
        const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy), lim = s.R * 0.8;
        if (d > lim) { p.x = s.x + dx / d * lim; p.y = s.y + dy / d * lim; }
      }
    }
    for (const p of pts) {
      const n = p.n, sc = score(n);
      stars.push({
        id: n.id, title: n.title || '未命名', kind: kindOf(n),
        x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        sector: s.name, hue: s.hue, frontier: s.frontier,
        mag: s.frontier ? 'faint' : sc >= 4 ? 'beacon' : 'star',
        score: sc, links: linkDeg.get(n.id) || 0, tags: (n.tags || []).slice(),
        phase: (hash(n.id) % 1000) / 1000 * TAU
      });
    }
  }
  return {
    stars, lanes,
    sectors: sectors.map(({ members, ...s }) => ({ ...s, count: members.length })),
    stats: { stars: stars.length, lanes: lanes.filter(l => l.kind === 'link').length, sectors: sectors.filter(s => !s.frontier).length }
  };
}

/* ---------- 预渲染的光斑与域扭曲 fBm 体积星云 ---------- */
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function makeNoise(seed) {
  const rnd = seeded(seed);
  const perm = new Uint8Array(512), vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const X = xi & 255, Y = yi & 255;
    const aa = vals[perm[perm[X] + Y]], ba = vals[perm[perm[X + 1] + Y]];
    const ab = vals[perm[perm[X] + Y + 1]], bb = vals[perm[perm[X + 1] + Y + 1]];
    return (aa + (ba - aa) * u) * (1 - w) + (ab + (bb - ab) * u) * w;
  };
  return (x, y, oct = 4) => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < oct; i++) { sum += v(x * freq, y * freq) * amp; norm += amp; amp *= 0.5; freq *= 2.04; }
    return sum / norm;
  };
}
function glowSprite(hue, sat = 82) {
  const S = 128, c = canvas(S), g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.07, `hsla(${hue},${Math.min(sat, 72)}%,92%,.95)`);
  grd.addColorStop(0.2, `hsla(${hue},${sat}%,70%,.42)`);
  grd.addColorStop(0.45, `hsla(${hue},${sat}%,55%,.11)`);
  grd.addColorStop(1, `hsla(${hue},${sat}%,45%,0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return c;
}
function nebulaSprite(hue, seed, frontier) {
  const N = 160, S = 380, rnd = seeded(seed);
  const fbm = makeNoise(seed ^ 0x9e3779b9);
  const lo = canvas(N), lg = lo.getContext('2d'), img = lg.createImageData(N, N), d = img.data;
  const biome = BIOMES.find(b => b.hue === hue) || BIOMES[seed % BIOMES.length];
  const ang = rnd() * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
  const sx = 1.0, sy = 0.72 + rnd() * 0.22; // 非正圆有机星云拉长比
  for (let y = 0; y < N; y++) {
    const ny = (y / N - 0.5) * 2;
    for (let x = 0; x < N; x++) {
      const nx = (x / N - 0.5) * 2;
      const rx = (nx * ca - ny * sa) * sx, ry = (nx * sa + ny * ca) * sy;
      const dist = Math.hypot(rx, ry);
      if (dist >= 1.05) continue;
      // 域扭曲 fBm：生成真实的沸腾星云山脊与自然边缘
      const wx = fbm(nx * 2.1 + 1.7, ny * 2.1 + 4.3, 3);
      const wy = fbm(nx * 2.1 + 8.3, ny * 2.1 + 2.8, 3);
      const n1 = fbm(nx * 2.4 + (wx - 0.5) * 1.65, ny * 2.4 + (wy - 0.5) * 1.65, 4);
      const n2 = fbm(nx * 4.2 + (wy - 0.5) * 1.4 + 5.1, ny * 4.2 - (wx - 0.5) * 1.4, 3);
      const edgeNoise = (n1 - 0.5) * 0.42;
      const mask = 1 - smoothstep(0.18, 0.96, dist + edgeNoise);
      if (mask <= 0.002) continue;
      const idx = (y * N + x) * 4;
      if (frontier) {
        // 未知暗物质疆域：中心吞噬星光的深渊 + 边缘微弱幽青电离雾环
        const rim = smoothstep(0.35, 0.78, dist) * (1 - smoothstep(0.78, 1.02, dist)) * n1;
        const coreVoid = (1 - smoothstep(0.05, 0.76, dist + edgeNoise * 0.6)) * (0.58 + n2 * 0.25);
        d[idx] = Math.round(14 + rim * 76);
        d[idx + 1] = Math.round(28 + rim * 175);
        d[idx + 2] = Math.round(48 + rim * 218);
        d[idx + 3] = Math.round(clamp(coreVoid * 0.78 + rim * 0.42, 0, 0.85) * 255);
        continue;
      }
      // 韦伯星云亮脊（ridge）+ 自然暗尘埃空洞（dust）
      const ridge = Math.pow(1 - Math.abs(n2 * 2 - 1), 2.4);
      const dust = smoothstep(0.56, 0.84, fbm(nx * 3.1 - 3.4, ny * 3.1 + 6.7, 3));
      const dens = clamp((n1 * 0.85 + ridge * 0.55) * mask * (1 - dust * 0.58), 0, 1);
      const coreW = smoothstep(0.42, 0.92, dens * (1 - dist * 0.45) + ridge * 0.28 * mask);
      const midW = smoothstep(0.14, 0.62, dens);
      const [dr, dg, db] = biome.deep, [mr, mg, mb] = biome.mid, [cr, cg, cb] = biome.core;
      let r = dr + (mr - dr) * midW + (cr - mr) * coreW;
      let gr = dg + (mg - dg) * midW + (cg - mg) * coreW;
      let b = db + (mb - db) * midW + (cb - mb) * coreW;
      const alpha = clamp(Math.pow(dens, 0.82) * 0.88, 0, 0.86);
      d[idx] = Math.round(clamp(r, 0, 255));
      d[idx + 1] = Math.round(clamp(gr, 0, 255));
      d[idx + 2] = Math.round(clamp(b, 0, 255));
      d[idx + 3] = Math.round(alpha * 255);
    }
  }
  lg.putImageData(img, 0, 0);
  const c = canvas(S), g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(lo, 0, 0, S, S);
  if (!frontier) {
    // 沿高密度星云脊线播撒高锐度育星区微星团
    g.globalCompositeOperation = 'lighter';
    const M = S / 2;
    for (let i = 0; i < 280; i++) {
      const rx = (rnd() - 0.5) * 1.5, ry = (rnd() - 0.5) * 1.5;
      if (Math.hypot(rx, ry) > 0.78) continue;
      const n = fbm(rx * 2.4 + 2.1, ry * 2.4 + 3.7, 3);
      if (n < 0.42) continue;
      const px = M + rx * M, py = M + ry * M;
      const sh = rnd() < 0.3 ? 40 : rnd() < 0.7 ? biome.hue : 206;
      g.fillStyle = `hsla(${sh},65%,${86 + rnd() * 14}%,${0.12 + (n - 0.42) * 0.9})`;
      const sz = rnd() < 0.85 ? 1 : 1.7;
      g.fillRect(px, py, sz, sz);
    }
  }
  return c;
}
function skyField(seed = 20261120) {
  const rnd = seeded(seed);
  const layers = [
    { f: 0.015, n: 380, s: [0.45, 0.95], a: [0.12, 0.44] },
    { f: 0.05,  n: 170, s: [0.7, 1.4],   a: [0.28, 0.74] },
    { f: 0.11,  n: 44,  s: [1.1, 2.05],  a: [0.58, 0.96] }
  ];
  return layers.map(L => ({
    f: L.f,
    stars: Array.from({ length: L.n }, () => ({
      x: rnd(), y: rnd(), s: L.s[0] + rnd() * (L.s[1] - L.s[0]), a: L.a[0] + rnd() * (L.a[1] - L.a[0]),
      h: rnd() < 0.24 ? 38 : rnd() < 0.72 ? 204 : 190, sat: rnd() < 0.6 ? 32 : 70, ph: rnd() * TAU, sp: 0.35 + rnd() * 1.3
    }))
  }));
}

/* ---------- 渲染器 ---------- */
export class Cosmos {
  constructor({ stage, plane, world, sky, map, onSelect, onBackground, onView }) {
    Object.assign(this, { stage, plane, world, sky, map, onSelect, onBackground, onView });
    this.cam = { x: 0, y: 0, k: 1 };
    this.model = { stars: [], lanes: [], sectors: [], stats: { stars: 0, lanes: 0, sectors: 0 } };
    this.byId = new Map();
    this.buttons = new Map();
    this.focus = null;
    this.near = new Set();
    this.tilt = false;
    this.active = false;
    this.userMoved = false;
    this.dirty = true;
    this.camDirty = true;
    this.pointers = new Map();
    this.gesture = null;
    this.tween = null;
    this.lod = '';
    this.labelK = 0;
    this.widths = new Map();
    this.sprites = new Map();
    this.nebulae = new Map();
    this.field = skyField();
    this.reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    this.skyCtx = sky.getContext('2d');
    this.mapCtx = map.getContext('2d');
    this.measureCtx = canvas(4).getContext('2d');
    this.frame = this.frame.bind(this);
    this.bind();
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => {
        const was = this.SW;
        this.resize();
        if (this.SW && (!was || !this.userMoved)) this.fit(false);
      });
      this.ro.observe(stage);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.active) this.kick(); });
  }

  /* 尺寸 */
  resize() {
    const SW = this.stage.clientWidth, SH = this.stage.clientHeight;
    const PW = this.plane.offsetWidth, PH = this.plane.offsetHeight;
    if (!SW || !SH || !PW || !PH) { this.SW = 0; return; }
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    if (PW * PH * dpr * dpr > 4.2e6) dpr = Math.sqrt(4.2e6 / (PW * PH));
    Object.assign(this, { SW, SH, PW, PH, dpr });
    this.sky.width = Math.round(SW * dpr); this.sky.height = Math.round(SH * dpr);
    this.map.width = Math.round(PW * dpr); this.map.height = Math.round(PH * dpr);
    this.bg = this.paintBackdrop(SW, SH, dpr);
    this.camDirty = true; this.dirty = true;
    this.kick();
  }
  paintBackdrop(W, H, dpr) {
    // 域扭曲 fBm 银河星河全景背景（深渊宇宙 + 蜿蜒银心辉光 + 星际暗尘裂隙）
    const bw = 220, bh = Math.max(120, Math.round(bw * H / W));
    const lo = canvas(bw, bh), lg = lo.getContext('2d'), img = lg.createImageData(bw, bh), d = img.data;
    const fbm = makeNoise(42422026);
    for (let y = 0; y < bh; y++) {
      const ny = y / bh - 0.5;
      for (let x = 0; x < bw; x++) {
        const nx = x / bw - 0.5;
        // 对角银河旋臂带坐标系
        const u = nx * 0.82 - ny * 0.57;
        const v = nx * 0.57 + ny * 0.82;
        const wx = fbm(u * 2.6 + 2.4, v * 2.6 + 1.1, 3);
        const wy = fbm(u * 2.6 + 7.1, v * 2.6 + 5.8, 3);
        const cloud = fbm(u * 2.8 + (wx - 0.5) * 1.4, v * 2.8 + (wy - 0.5) * 1.4, 4);
        const dust = fbm(u * 4.2 - 1.9, v * 4.2 + 3.4, 3);
        const band = Math.exp(-Math.pow((v + (wx - 0.5) * 0.22) * 3.8, 2));
        const core = Math.exp(-Math.pow(u * 2.1, 2)) * band;
        const rift = smoothstep(0.48, 0.78, dust) * band * 0.72;
        const glow = clamp(band * (0.25 + cloud * 0.95) * (1 - rift), 0, 1);
        const r = 3 + glow * 26 + core * cloud * 68;
        const gr = 5 + glow * 44 + core * cloud * 58;
        const b = 12 + glow * 78 + core * cloud * 48;
        const idx = (y * bw + x) * 4;
        d[idx] = Math.round(clamp(r, 0, 255));
        d[idx + 1] = Math.round(clamp(gr, 0, 255));
        d[idx + 2] = Math.round(clamp(b, 0, 255));
        d[idx + 3] = 255;
      }
    }
    lg.putImageData(img, 0, 0);
    const c = canvas(Math.round(W * dpr), Math.round(H * dpr)), g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(lo, 0, 0, c.width, c.height);
    // 微弱深空边缘暗角，聚焦中心星海
    g.scale(dpr, dpr);
    const vig = g.createRadialGradient(W * 0.5, H * 0.48, Math.min(W, H) * 0.28, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(1,2,6,.58)');
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
    return c;
  }

  /* 模型 */
  setModel(model) {
    this.model = model;
    this.byId = new Map(model.stars.map(s => [s.id, s]));
    this.adj = new Map();
    for (const l of model.lanes) {
      if (!this.adj.has(l.a)) this.adj.set(l.a, new Set());
      if (!this.adj.has(l.b)) this.adj.set(l.b, new Set());
      this.adj.get(l.a).add(l.b); this.adj.get(l.b).add(l.a);
    }
    this.nebulae = new Map(model.sectors.map(s => [s.name, nebulaSprite(s.hue, hash(s.name), s.frontier)]));
    const order = model.stars.slice().sort((a, b) => (a.frontier - b.frontier) || a.sector.localeCompare(b.sector) || b.score - a.score || byId(a, b));
    const keep = new Map();
    const frag = document.createDocumentFragment();
    for (const s of order) {
      let btn = this.buttons.get(s.id);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.id = s.id;
        btn.innerHTML = '<span class="gdot"></span><span class="gstem"></span><span class="gtext"><span class="gl"></span><span class="gk"></span></span>';
        btn.addEventListener('click', e => { e.stopPropagation(); this.onSelect?.(s.id); });
      }
      btn.className = `gnode kind-${s.kind} mag-${s.mag}`;
      btn.style.setProperty('--h', s.hue);
      btn.querySelector('.gl').textContent = s.title;
      btn.querySelector('.gk').textContent = `${magLabel(s.mag)} · ${s.frontier ? '暗域' : s.sector}`;
      btn.setAttribute('aria-label', `${s.title}，${magLabel(s.mag)}，${s.frontier ? '未测绘暗域' : s.sector + ' 星域'}，${s.links} 条航线`);
      keep.set(s.id, btn);
      frag.appendChild(btn);
    }
    this.world.replaceChildren(frag);
    this.buttons = keep;
    if (this.focus && !this.byId.has(this.focus)) this.focus = null;
    this.setFocus(this.focus);
    this.labelK = 0;
    this.camDirty = true; this.dirty = true;
    this.kick();
  }
  setFocus(id) {
    this.focus = id && this.byId.has(id) ? id : null;
    this.near = new Set(this.focus ? [this.focus, ...(this.adj?.get(this.focus) || [])] : []);
    for (const [sid, btn] of this.buttons) {
      const on = sid === this.focus;
      btn.classList.toggle('on', on);
      btn.classList.toggle('near', !on && this.near.has(sid));
      btn.classList.toggle('dim', !!this.focus && !this.near.has(sid));
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    this.labelK = 0;
    this.dirty = true; this.camDirty = true;
    this.kick();
  }

  /* 相机 */
  bounds(ids) {
    const stars = ids ? ids.map(id => this.byId.get(id)).filter(Boolean) : this.model.stars;
    if (!stars.length) return { x0: -120, x1: 120, y0: -120, y1: 120 };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of stars) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); }
    if (!ids) for (const s of this.model.sectors) {
      x0 = Math.min(x0, s.x - s.R * 1.04); x1 = Math.max(x1, s.x + s.R * 1.04);
      y0 = Math.min(y0, s.y - s.R * 1.04); y1 = Math.max(y1, s.y + s.R * 1.04);
    }
    return ids ? { x0: x0 - 40, x1: x1 + 40, y0: y0 - 40, y1: y1 + 40 } : { x0, x1, y0, y1 };
  }
  viewFor(b) {
    const top = 96, bottom = 104, side = this.SW < 600 ? 22 : 90;
    const k = clamp(Math.min((this.SW - side * 2) / (b.x1 - b.x0), (this.SH - top - bottom) / (b.y1 - b.y0)), 0.22, 1.5) * (this.tilt ? 1.1 : 1);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return { x: -cx * k, y: -cy * k + (top - bottom) / 2 + (this.tilt ? this.SH * 0.07 : 0), k };
  }
  fit(animate = true) {
    if (!this.SW) this.resize();
    if (!this.SW) return;
    this.userMoved = false;
    this.go(this.viewFor(this.bounds()), animate);
  }
  focusNeighborhood(id) {
    if (!this.byId.has(id)) return;
    this.userMoved = true;
    const ids = [id, ...(this.adj?.get(id) || [])];
    const v = this.viewFor(this.bounds(ids));
    v.k = Math.min(v.k, 1.9);
    this.go(v, true);
  }
  reveal(id, center = false) {
    const s = this.byId.get(id);
    if (!s || !this.SW) return;
    const p = this.toScreen(s.x, s.y);
    const safe = p.x > 40 && p.x < this.SW - 40 && p.y > 80 && p.y < this.SH - 320;
    if (safe && !center) return;
    const k = Math.max(this.cam.k, 0.9);
    this.userMoved = true;
    this.go({ x: -s.x * k, y: -s.y * k - this.SH * 0.12, k }, true);
  }
  toScreen(x, y) {
    const k = this.cam.k;
    return { x: this.SW / 2 + this.cam.x + x * k, y: this.SH / 2 + this.cam.y + y * k };
  }
  go(view, animate) {
    if (!animate || this.reduce.matches) { this.tween = null; Object.assign(this.cam, view); this.changed(); return; }
    this.tween = { from: { ...this.cam }, to: view, t0: performance.now(), dur: 720 };
    this.kick();
  }
  zoomBy(f, ox = 0, oy = 0) {
    this.tween = null;
    const k0 = this.cam.k, k = clamp(k0 * f, K_MIN, K_MAX);
    const wx = (ox - this.cam.x) / k0, wy = (oy - this.cam.y) / k0;
    this.cam.k = k; this.cam.x = ox - wx * k; this.cam.y = oy - wy * k;
    this.userMoved = true;
    this.changed();
  }
  changed() { this.camDirty = true; this.dirty = true; this.onView?.(this.cam); this.kick(); }
  setTilt(on) {
    this.tilt = !!on;
    this.stage.classList.add('tilting');
    this.stage.classList.toggle('tilt', this.tilt);
    clearTimeout(this.tiltTimer);
    this.tiltTimer = setTimeout(() => this.stage.classList.remove('tilting'), 950);
    this.labelK = 0;
    this.camDirty = true; this.dirty = true;
    if (!this.userMoved) this.fit(true); else this.kick();
  }
  setActive(on) {
    this.active = !!on;
    if (this.active) { if (!this.SW) this.resize(); this.dirty = true; this.camDirty = true; this.kick(); }
  }
  kick() {
    if (!this.active || this.raf || document.hidden) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  /* 指针：单指平移、双指捏合、滚轮缩放、点空白处取消选择 */
  bind() {
    const st = this.stage;
    const center = () => { const r = st.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    st.addEventListener('pointerdown', e => {
      if (e.button != null && e.button > 0) return;
      if (e.target.closest('.gnode')) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { st.setPointerCapture(e.pointerId); } catch {}
      this.tween = null;
      this.startGesture(e.clientX, e.clientY);
    });
    st.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.gesture;
      if (!g) return;
      if (g.kind === 'pan') {
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
        if (!g.moved && Math.hypot(dx, dy) < 5) return;
        g.moved = true;
        st.classList.add('panning');
        this.cam.x = g.cam.x + dx;
        this.cam.y = g.cam.y + dy * (this.tilt ? TILT_PAN : 1);
        this.userMoved = true;
        this.changed();
      } else if (g.kind === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const c = center();
        const mx = (a.x + b.x) / 2 - c.x, my = (a.y + b.y) / 2 - c.y;
        const k = clamp(g.k0 * d / g.d0, K_MIN, K_MAX);
        const wx = (g.mx - g.cam.x) / g.k0, wy = (g.my - g.cam.y) / g.k0;
        this.cam.k = k; this.cam.x = mx - wx * k; this.cam.y = my - wy * k;
        g.moved = true;
        this.userMoved = true;
        this.changed();
      }
    });
    const end = e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (g?.kind === 'pan' && !g.moved && !this.pointers.size && e.type === 'pointerup' && performance.now() - g.t0 < 600) this.onBackground?.();
      if (this.pointers.size === 1) { const p = [...this.pointers.values()][0]; this.startGesture(p.x, p.y, true); }
      else if (!this.pointers.size) { this.gesture = null; st.classList.remove('panning'); }
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
    st.addEventListener('wheel', e => {
      e.preventDefault();
      const c = center();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
      if (this.tilt) this.zoomBy(f); else this.zoomBy(f, e.clientX - c.x, e.clientY - c.y);
    }, { passive: false });
    st.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea')) return;
      const step = 64;
      const map = { '+': () => this.zoomBy(1.2), '=': () => this.zoomBy(1.2), '-': () => this.zoomBy(1 / 1.2), '0': () => this.fit(true),
        ArrowLeft: () => this.pan(step, 0), ArrowRight: () => this.pan(-step, 0), ArrowUp: () => this.pan(0, step), ArrowDown: () => this.pan(0, -step) };
      if (!map[e.key] || (e.key.startsWith('Arrow') && e.target.closest('.gnode') === null && e.target !== st)) return;
      e.preventDefault();
      map[e.key]();
    });
  }
  startGesture(x, y, resumed = false) {
    const c = this.stage.getBoundingClientRect();
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: this.cam.k, cam: { ...this.cam },
        mx: (a.x + b.x) / 2 - (c.left + c.width / 2), my: (a.y + b.y) / 2 - (c.top + c.height / 2), moved: true
      };
    } else {
      this.gesture = { kind: 'pan', x0: x, y0: y, cam: { ...this.cam }, t0: performance.now(), moved: resumed };
    }
  }
  pan(dx, dy) { this.tween = null; this.cam.x += dx; this.cam.y += dy; this.userMoved = true; this.changed(); }

  /* 帧循环：有动画时持续绘制；减少动态效果时只在需要时绘制 */
  frame(t) {
    this.raf = 0;
    if (!this.active || !this.SW) return;
    if (this.tween) {
      const { from, to, t0, dur } = this.tween;
      const p = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 4);
      const lk = Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e;
      this.cam.k = Math.exp(lk);
      this.cam.x = from.x + (to.x - from.x) * e;
      this.cam.y = from.y + (to.y - from.y) * e;
      this.camDirty = true;
      if (p >= 1) { this.tween = null; this.onView?.(this.cam); }
    }
    const animate = !this.reduce.matches;
    if (this.camDirty) { this.place(); this.camDirty = false; this.dirty = true; }
    if (this.dirty || animate) {
      if (animate && !this.dirty && !this.tween && t - (this.lastPaint || 0) < 30) { this.kick(); return; }
      this.lastPaint = t;
      this.paintSky(t, animate);
      this.paintMap(t, animate);
      this.dirty = false;
    }
    if (animate || this.tween) this.kick();
  }

  place() {
    const k = this.cam.k;
    const lod = k < 0.55 ? 'far' : k < 1.1 ? 'mid' : 'near';
    if (lod !== this.lod) {
      this.stage.classList.remove('lod-far', 'lod-mid', 'lod-near');
      this.stage.classList.add('lod-' + lod);
      this.lod = lod;
      this.labelK = 0;
    }
    if (!this.labelK || Math.abs(Math.log(k / this.labelK)) > 0.08) { this.labelK = k; this.layoutLabels(); }
    const ox = this.PW / 2 + this.cam.x, oy = this.PH / 2 + this.cam.y;
    for (const s of this.model.stars) {
      const btn = this.buttons.get(s.id);
      if (!btn) continue;
      const x = (ox + s.x * k).toFixed(1), y = (oy + s.y * k).toFixed(1);
      btn.style.transform = this.tilt
        ? `translate3d(${x}px,${y}px,0) rotateX(-${TILT_DEG}deg) translate(-50%,calc(-100% + 14px))`
        : btn.classList.contains('flip')
          ? `translate3d(${x}px,${y}px,0) translate(calc(-100% + 14px),-50%)`
          : `translate3d(${x}px,${y}px,0) translate(-14px,-50%)`;
    }
  }
  textWidth(s) {
    const key = s.mag + s.title;
    if (!this.widths.has(key)) {
      this.measureCtx.font = `${s.mag === 'beacon' ? 700 : 600} ${s.mag === 'beacon' ? 14 : 12.5}px ${UI_FONT}`;
      this.widths.set(key, Math.min(this.measureCtx.measureText(s.title).width, s.mag === 'beacon' ? 196 : 168));
    }
    return this.widths.get(key);
  }
  layoutLabels() {
    const k = this.cam.k, lod = this.lod;
    const rank = s => (s.id === this.focus ? 1000 : this.near.has(s.id) ? 500 : 0) + (s.mag === 'beacon' ? 100 : s.mag === 'star' ? 50 : 0) + s.score;
    const allowed = s => this.near.has(s.id) || s.mag === 'beacon' || (lod !== 'far' && s.mag === 'star') || lod === 'near';
    // 平视时星点本身也是障碍；标签先试右侧再试左侧。2.5D 时试三种立杆高度。
    const taken = this.tilt ? [] : this.model.stars.map(s => ({ id: s.id, x0: s.x * k - 9, x1: s.x * k + 9, y0: s.y * k - 9, y1: s.y * k + 9 }));
    for (const s of this.model.stars.slice().sort((a, b) => rank(b) - rank(a) || byId(a, b))) {
      const btn = this.buttons.get(s.id);
      if (!btn) continue;
      let pick = null;
      if (allowed(s)) {
        const w = this.textWidth(s) + 8, x = s.x * k, y = s.y * k;
        const stem = s.mag === 'beacon' ? 46 : s.mag === 'faint' ? 8 : 18;
        const py = this.tilt ? y * Math.cos(TILT_DEG * Math.PI / 180) : y;
        const lh = this.lod === 'near' || s.id === this.focus ? 48 : 36;
        const opts = this.tilt
          ? [0, 40, 80, 120].map(lift => ({ lift, r: { x0: x - w / 2 - 14, x1: x + w / 2 + 14, y0: py - stem - lift - lh, y1: py - stem - lift + 2 } }))
          : [{ flip: false, r: { x0: x + 12, x1: x + 20 + w, y0: y - 11, y1: y + 11 } }, { flip: true, r: { x0: x - 20 - w, x1: x - 12, y0: y - 11, y1: y + 11 } }];
        const blocked = r => taken.some(o => o.id !== s.id && r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1);
        pick = opts.find(o => !blocked(o.r)) || (s.id === this.focus ? opts[0] : null);
        if (pick) taken.push(pick.r);
      }
      btn.classList.toggle('quiet', !pick);
      btn.classList.toggle('flip', !!pick?.flip);
      btn.style.setProperty('--lift', (pick?.lift || 0) + 'px');
    }
  }

  paintSky(t, animate) {
    const g = this.skyCtx, dpr = this.dpr, W = this.SW, H = this.SH;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.bg, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const L of this.field) {
      const ox = this.cam.x * L.f, oy = this.cam.y * L.f;
      for (const s of L.stars) {
        const x = ((s.x * W + ox) % W + W) % W, y = ((s.y * H + oy) % H + H) % H;
        const tw = animate ? 0.72 + 0.28 * Math.sin(t * 0.0012 * s.sp + s.ph) : 1;
        g.fillStyle = `hsla(${s.h},${s.sat}%,90%,${(s.a * tw).toFixed(3)})`;
        if (s.s > 1.5) {
          g.globalAlpha = 0.55 * tw;
          g.drawImage(this.sprite(s.h, 40), x - s.s * 3, y - s.s * 3, s.s * 6, s.s * 6);
          g.globalAlpha = 1;
        }
        g.fillRect(x - s.s / 2, y - s.s / 2, s.s, s.s);
      }
    }
  }
  sprite(hue, sat = 90) {
    const key = hue + ':' + sat;
    if (!this.sprites.has(key)) this.sprites.set(key, glowSprite(hue, sat));
    return this.sprites.get(key);
  }

  paintMap(t, animate) {
    const g = this.mapCtx, dpr = this.dpr, k = this.cam.k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.map.width, this.map.height);
    g.setTransform(dpr * k, 0, 0, dpr * k, dpr * (this.PW / 2 + this.cam.x), dpr * (this.PH / 2 + this.cam.y));
    const px = v => v / k;
    const zs = clamp(Math.sqrt(k), 0.7, 1.45);
    const focus = this.focus, near = this.near;
    const lod = this.lod;
    const { stars, lanes, sectors } = this.model;

    // 精密星盘测绘网格：同心距离环 + 方位刻度 + 经纬准星
    let ext = 280;
    for (const s of sectors) ext = Math.max(ext, Math.hypot(s.x, s.y) + s.R * 1.45);
    const outerR = Math.ceil((ext + 140) / 200) * 200;
    g.lineWidth = px(0.85);
    for (let r = 200; r <= outerR; r += 200) {
      g.strokeStyle = `rgba(130,188,236,${this.tilt ? 0.11 : 0.06})`;
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    }
    const dialR = Math.max(400, outerR - 200);
    for (let deg = 0; deg < 360; deg += 5) {
      const a = deg * Math.PI / 180 - Math.PI / 2;
      const major = deg % 30 === 0, mid = deg % 15 === 0;
      const len = major ? px(10) : mid ? px(6) : px(3);
      g.strokeStyle = `rgba(145,200,240,${major ? 0.24 : mid ? 0.14 : 0.07})`;
      g.beginPath();
      g.moveTo(Math.cos(a) * (dialR - len), Math.sin(a) * (dialR - len));
      g.lineTo(Math.cos(a) * dialR, Math.sin(a) * dialR);
      g.stroke();
    }
    g.strokeStyle = `rgba(130,188,236,${this.tilt ? 0.075 : 0.04})`;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU;
      g.beginPath(); g.moveTo(Math.cos(a) * 90, Math.sin(a) * 90); g.lineTo(Math.cos(a) * outerR, Math.sin(a) * outerR); g.stroke();
    }
    g.font = `500 ${px(9.5)}px ${MONO_FONT}`;
    g.fillStyle = 'rgba(148,198,236,0.28)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 90) {
      const a = deg * Math.PI / 180 - Math.PI / 2;
      const r = dialR + px(14);
      g.fillText(String(deg).padStart(3, '0') + '°', Math.cos(a) * r, Math.sin(a) * r);
    }

    if (!stars.length) { this.paintBeacon(g, 0, 0, 196, zs, t, animate, 1, px); return; }

    // 体积星云领地（域扭曲 fBm 连续星云云团，不再被死板圆框切碎）
    for (const s of sectors) {
      const neb = this.nebulae.get(s.name);
      if (!neb) continue;
      const S = s.R * (s.frontier ? 3.2 : 3.75);
      const dimmed = focus && this.byId.get(focus)?.sector !== s.name;
      g.globalCompositeOperation = s.frontier ? 'source-over' : 'lighter';
      g.globalAlpha = (s.frontier ? 1 : lod === 'far' ? 1 : lod === 'mid' ? 0.94 : 0.78) * (dimmed ? 0.42 : 1);
      g.drawImage(neb, s.x - S / 2, s.y - S / 2, S, S);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    // 星域极细测绘弧标与未知疆域扫描雷达
    const spin = animate ? t * 0.000035 : 0;
    let secIdx = 0;
    for (const s of sectors) {
      if (!s.frontier) secIdx++;
      const col = s.frontier ? '138,198,232' : null;
      const stroke = a => (col ? `rgba(${col},${a})` : `hsla(${s.hue},82%,76%,${a})`);
      const dimmed = focus && this.byId.get(focus)?.sector !== s.name;
      const df = dimmed ? 0.42 : 1;
      g.lineWidth = px(0.9);
      if (s.frontier) {
        g.setLineDash([px(2), px(6)]);
        g.strokeStyle = stroke(0.32 * df);
        g.beginPath(); g.arc(s.x, s.y, s.R * 1.04, 0, TAU); g.stroke();
        g.setLineDash([]);
        const sw = animate ? (t * 0.00045) % TAU : 0.9;
        const sweep = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.R * 1.04);
        sweep.addColorStop(0, 'rgba(95,212,255,0)');
        sweep.addColorStop(0.68, `rgba(95,212,255,${0.08 * df})`);
        sweep.addColorStop(1, `rgba(160,235,255,${0.22 * df})`);
        g.fillStyle = sweep;
        g.beginPath(); g.moveTo(s.x, s.y); g.arc(s.x, s.y, s.R * 1.04, sw - 0.55, sw); g.closePath(); g.fill();
        g.strokeStyle = `rgba(175,238,255,${0.55 * df})`;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + Math.cos(sw) * s.R * 1.04, s.y + Math.sin(sw) * s.R * 1.04); g.stroke();
      } else {
        // 极简四段星图短弧括标（不把自然星云关进死圆圈里）
        g.strokeStyle = stroke(0.22 * df);
        for (let q = 0; q < 4; q++) {
          const a0 = spin + q * (TAU / 4) - 0.18;
          g.beginPath(); g.arc(s.x, s.y, s.R * 1.04, a0, a0 + 0.36); g.stroke();
        }
        g.strokeStyle = stroke(0.42 * df);
        for (let i = 0; i < 4; i++) {
          const a = spin + i * TAU / 4;
          g.beginPath();
          g.moveTo(s.x + Math.cos(a) * s.R * 1.0, s.y + Math.sin(a) * s.R * 1.0);
          g.lineTo(s.x + Math.cos(a) * s.R * 1.08, s.y + Math.sin(a) * s.R * 1.08);
          g.stroke();
        }
      }
      const fs = lod === 'far' ? 14.5 : lod === 'mid' ? 12.5 : 11.5;
      const alpha = (lod === 'far' ? 0.94 : lod === 'mid' ? 0.8 : 0.6) * df;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const ly = s.y - s.R * 1.04 - px(14);
      g.font = `600 ${px(9)}px ${MONO_FONT}`;
      g.fillStyle = col ? `rgba(${col},${alpha * 0.62})` : `hsla(${s.hue},72%,76%,${alpha * 0.65})`;
      const code = s.frontier ? `UNMAPPED // ${String(s.count).padStart(2, '0')}` : `SEC-${String(secIdx).padStart(2, '0')} // ${String(s.count).padStart(2, '0')}`;
      g.fillText(code, s.x, ly - px(13));
      try { g.letterSpacing = px(lod === 'far' ? 3 : 2) + 'px'; } catch {}
      g.font = `650 ${px(fs)}px ${UI_FONT}`;
      g.fillStyle = col ? `rgba(205,232,248,${alpha * 0.86})` : `hsla(${s.hue},58%,90%,${alpha})`;
      g.fillText(s.frontier ? s.name : s.name.toLocaleUpperCase(), s.x, ly);
      try { g.letterSpacing = '0px'; } catch {}
      g.font = `500 ${px(9.5)}px ${UI_FONT}`;
      g.fillStyle = col ? `rgba(${col},${alpha * 0.56})` : `hsla(${s.hue},46%,78%,${alpha * 0.56})`;
      g.fillText(s.frontier ? `${s.count} 处未知信号` : `${s.count} 星体 · 星域`, s.x, ly + px(13));
    }

    // 跃迁航线：锐白电离核心 + 柔光外晕 + 流动光脉冲数据包
    g.lineCap = 'round';
    for (const l of lanes) {
      const a = this.byId.get(l.a), b = this.byId.get(l.b);
      if (!a || !b) continue;
      const touch = focus && (l.a === focus || l.b === focus);
      const fade = focus && !touch ? 0.16 : 1;
      if (l.kind === 'tag') {
        g.setLineDash([px(1.2), px(6)]);
        g.lineWidth = px(1.1);
        g.strokeStyle = `hsla(${a.hue},55%,78%,${0.28 * fade})`;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.setLineDash([]);
        continue;
      }
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const bend = (hash(l.a + l.b) & 1 ? 1 : -1) * Math.min(d * 0.18, 84);
      const cx = mx - dy / d * bend, cy = my + dx / d * bend;
      const grad = g.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, `hsla(${a.hue},88%,78%,1)`);
      grad.addColorStop(0.5, 'rgba(232,248,255,0.95)');
      grad.addColorStop(1, `hsla(${b.hue},88%,78%,1)`);
      g.strokeStyle = grad;
      const curve = () => { g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(cx, cy, b.x, b.y); g.stroke(); };
      g.globalAlpha = (touch ? 0.28 : 0.12) * fade; g.lineWidth = px(touch ? 7.5 : 4.8); curve();
      g.globalAlpha = (touch ? 0.96 : 0.68) * fade; g.lineWidth = px(touch ? 1.5 : 1.1); curve();
      if (touch || (!focus && animate)) {
        const u = ((animate ? t * 0.00028 : 0.35) + (hash(l.a + l.b) % 100) / 100) % 1;
        const iu = 1 - u;
        const px0 = iu * iu * a.x + 2 * iu * u * cx + u * u * b.x;
        const py0 = iu * iu * a.y + 2 * iu * u * cy + u * u * b.y;
        const ps = px(touch ? 14 : 10);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = (touch ? 0.95 : 0.65) * fade;
        g.drawImage(this.sprite(a.hue, 60), px0 - ps / 2, py0 - ps / 2, ps, ps);
        g.globalCompositeOperation = 'source-over';
      }
      g.globalAlpha = 1;
    }

    // 星体：韦伯六芒光学衍射星 + 未知信号声呐脉冲 + 战术目标锁定准星
    for (const s of stars) {
      const fade = focus && !near.has(s.id) ? 0.2 : 1;
      const tw = animate ? 0.88 + 0.12 * Math.sin(t * 0.0019 + s.phase) : 1;
      if (s.mag === 'beacon') this.paintBeacon(g, s.x, s.y, s.hue, zs, t, animate, fade * tw, px);
      else if (s.mag === 'star') {
        const H = 44 * zs;
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.8 * fade * tw;
        g.drawImage(this.sprite(s.hue, 68), s.x - px(H / 2), s.y - px(H / 2), px(H), px(H));
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 0.55 * fade;
        g.strokeStyle = `hsla(${s.hue},75%,90%,1)`;
        g.lineWidth = px(0.75);
        const L = 10 * zs;
        g.beginPath();
        g.moveTo(s.x - px(L), s.y); g.lineTo(s.x + px(L), s.y);
        g.moveTo(s.x, s.y - px(L * 0.72)); g.lineTo(s.x, s.y + px(L * 0.72));
        g.stroke();
        g.globalAlpha = fade;
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(s.x, s.y, px(1.85 * zs), 0, TAU); g.fill();
      } else {
        const ping = animate ? ((t * 0.00055 + s.phase / TAU) % 1) : 0.42;
        const H = 26 * zs;
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.55 * fade * tw;
        g.drawImage(this.sprite(196, 65), s.x - px(H / 2), s.y - px(H / 2), px(H), px(H));
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = (1 - ping) * 0.52 * fade;
        g.strokeStyle = 'rgba(130,218,248,1)';
        g.lineWidth = px(0.9);
        g.beginPath(); g.arc(s.x, s.y, px((5 + ping * 18) * zs), 0, TAU); g.stroke();
        g.globalAlpha = 0.4 * fade;
        g.setLineDash([px(1.5), px(3)]);
        g.beginPath(); g.arc(s.x, s.y, px(8 * zs), 0, TAU); g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 0.85 * fade;
        g.fillStyle = '#d8f4ff';
        g.beginPath(); g.arc(s.x, s.y, px(1.5 * zs), 0, TAU); g.fill();
      }
      if (s.id === focus) {
        const pulse = animate ? Math.sin(t * 0.004) * 2.5 : 0;
        const R = px((s.mag === 'beacon' ? 24 : 16) * zs + pulse);
        g.globalAlpha = 0.92;
        g.strokeStyle = `hsla(${s.hue},90%,88%,1)`;
        g.lineWidth = px(1.3);
        for (let q = 0; q < 4; q++) {
          const a = q * (TAU / 4) + 0.35;
          g.beginPath(); g.arc(s.x, s.y, R, a, a + 0.85); g.stroke();
        }
        g.globalAlpha = 0.32;
        g.lineWidth = px(0.9);
        g.beginPath(); g.arc(s.x, s.y, R + px(9 * zs), 0, TAU); g.stroke();
      }
      g.globalAlpha = 1;
    }
  }
  paintBeacon(g, x, y, hue, zs, t, animate, alpha, px) {
    const halo = 126 * zs, core = 44 * zs;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.42 * alpha;
    g.drawImage(this.sprite(hue, 72), x - px(halo / 2), y - px(halo / 2), px(halo), px(halo));
    g.globalAlpha = 0.94 * alpha;
    g.drawImage(this.sprite(hue, 78), x - px(core / 2), y - px(core / 2), px(core), px(core));
    g.globalCompositeOperation = 'source-over';
    const spin = animate ? t * 0.01 : 0;
    g.lineWidth = px(0.85);
    [16, 27, 40].forEach((r, i) => {
      g.globalAlpha = (0.38 - i * 0.1) * alpha;
      g.setLineDash(i === 1 ? [px(12), px(8)] : [px(2.5), px(6 + i * 2)]);
      g.lineDashOffset = px(spin * (i % 2 ? -1 : 1) * (0.9 + i * 0.35));
      g.strokeStyle = `hsla(${hue},78%,82%,1)`;
      g.beginPath(); g.arc(x, y, px(r * zs), 0, TAU); g.stroke();
    });
    g.setLineDash([]);
    g.strokeStyle = `hsla(${hue},85%,94%,1)`;
    g.lineWidth = px(0.9);
    const L = 30 * zs, D = 16 * zs;
    g.globalAlpha = 0.72 * alpha;
    g.beginPath(); g.moveTo(x - px(L), y); g.lineTo(x + px(L), y); g.moveTo(x, y - px(L * 0.78)); g.lineTo(x, y + px(L * 0.78)); g.stroke();
    g.globalAlpha = 0.34 * alpha;
    g.beginPath();
    g.moveTo(x - px(D), y - px(D * 0.58)); g.lineTo(x + px(D), y + px(D * 0.58));
    g.moveTo(x - px(D), y + px(D * 0.58)); g.lineTo(x + px(D), y - px(D * 0.58));
    g.stroke();
    g.globalAlpha = alpha;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(x, y, px(2.7 * zs), 0, TAU); g.fill();
    g.globalAlpha = 1;
  }
}
