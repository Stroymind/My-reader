// 深空星海：确定性的星域布局 + Canvas 2D 星空与星图 + 可聚焦的星体按钮。
// 天空画布不倾斜；星图平面（画布 + 按钮）在 2.5D 模式下用 CSS 3D 倾斜，按钮反向旋转成为立起的标牌。
const TAU = Math.PI * 2;
const GOLDEN = 2.399963229728653;
// 印象派油画夜空光谱（群青、钴蓝、暮紫、天青、松石绿、拿坡里黄、暖金）
const PALETTE = [212, 42, 194, 242, 34, 204, 226, 48];
export const TILT_DEG = 34;
const TILT_PAN = 1 / Math.cos(TILT_DEG * Math.PI / 180);
const MAG_LABEL = { beacon: '主星', star: '星体', faint: '未连接' };
const ART_FONT = '"RR Latin Serif","RR Kai","KaiTi","STKaiti","Kaiti SC","RR CJK Serif",Georgia,serif';
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
function glowSprite(hue, sat = 72) {
  const S = 128, c = canvas(S), g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.06, `hsla(${hue},${Math.min(sat, 58)}%,94%,.94)`);
  grd.addColorStop(0.18, `hsla(${hue},${sat}%,74%,.36)`);
  grd.addColorStop(0.42, `hsla(${hue},${sat}%,58%,.085)`);
  grd.addColorStop(1, `hsla(${hue},${sat}%,46%,0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return c;
}

// 真实猪鬃毛刷印象派油画笔触（多根微偏毛丝叠画，彻底告别平滑胶囊棒质感）
function paintBristle(g, pts, wid, bodyCol, sheenCol, shadowCol, rnd) {
  if (pts.length < 2) return;
  const trace = (ox, oy, trim = 0) => {
    g.beginPath();
    const lastIdx = pts.length - 1;
    const sx = pts[0][0] + ox + (pts[1][0] - pts[0][0]) * trim;
    const sy = pts[0][1] + oy + (pts[1][1] - pts[0][1]) * trim;
    g.moveTo(sx, sy);
    if (pts.length === 2) {
      g.lineTo(pts[1][0] + ox - (pts[1][0] - pts[0][0]) * trim, pts[1][1] + oy - (pts[1][1] - pts[0][1]) * trim);
    } else {
      for (let i = 1; i < lastIdx; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) * 0.5 + ox;
        const my = (pts[i][1] + pts[i + 1][1]) * 0.5 + oy;
        g.quadraticCurveTo(pts[i][0] + ox, pts[i][1] + oy, mx, my);
      }
      g.lineTo(pts[lastIdx][0] + ox, pts[lastIdx][1] + oy);
    }
    g.stroke();
  };
  const dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1];
  const d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d, ny = dx / d;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (shadowCol) {
    g.strokeStyle = shadowCol;
    g.lineWidth = wid * 0.52;
    trace(-nx * wid * 0.34, -ny * wid * 0.34, 0.08);
  }
  // 3 缕紧密并排的油画毛刷丝，长度与位置微错，呈现真实厚涂油画拉丝肌理
  g.strokeStyle = bodyCol;
  g.lineWidth = wid * 0.58;
  trace(0, 0, 0);
  g.lineWidth = wid * 0.38;
  trace(nx * wid * 0.28, ny * wid * 0.28, 0.06 + (rnd ? rnd() * 0.12 : 0.08));
  trace(-nx * wid * 0.26, -ny * wid * 0.26, 0.05 + (rnd ? rnd() * 0.14 : 0.1));
  if (sheenCol) {
    g.strokeStyle = sheenCol;
    g.lineWidth = Math.max(0.8, wid * 0.28);
    trace(nx * wid * 0.18, ny * wid * 0.18, 0.12);
  }
}

function buildWorldField(model) {
  const { stars, lanes, sectors } = model;
  if (!stars.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of sectors) {
    x0 = Math.min(x0, s.x - s.R); x1 = Math.max(x1, s.x + s.R);
    y0 = Math.min(y0, s.y - s.R); y1 = Math.max(y1, s.y + s.R);
  }
  const pad = 380;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const W = x1 - x0, H = y1 - y0;
  const GW = 156, GH = clamp(Math.round(GW * H / W), 108, 192);
  const fbm = makeNoise(20261120 ^ hash(sectors.map(s => s.name).join('|')));
  const rnd = seeded(90412026 ^ hash(stars.map(s => s.id).join('|')));
  const byId = new Map(stars.map(s => [s.id, s]));
  const chartedSectors = sectors.filter(s => !s.frontier);
  const chartedStars = stars.filter(s => !s.frontier);
  const explicitLanes = lanes.filter(l => l.kind === 'link').map(l => {
    const a = byId.get(l.a), b = byId.get(l.b);
    return a && b ? { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, inv: 1 / (2 * 120 * 120) } : null;
  }).filter(Boolean);
  const secWells = chartedSectors.map(s => {
    const sig = Math.max(98, s.R * 1.18);
    return {
      x: s.x, y: s.y, inv: 1 / (2 * sig * sig),
      warm: s.hue < 80 ? 1 : 0,
      teal: s.hue >= 175 && s.hue <= 205 ? 1 : 0,
      violet: s.hue >= 225 ? 1 : 0
    };
  });
  const starWells = chartedStars.map(s => ({
    x: s.x, y: s.y, w: s.mag === 'beacon' ? 0.56 : 0.28, inv: 1 / (2 * (s.mag === 'beacon' ? 84 : 62) ** 2),
    warm: s.hue < 80 ? 1 : 0
  }));

  const pot = new Float32Array(GW * GH);
  const warmGrid = new Float32Array(GW * GH);
  const tealGrid = new Float32Array(GW * GH);
  const violetGrid = new Float32Array(GW * GH);
  const lo = canvas(GW, GH), lg = lo.getContext('2d'), img = lg.createImageData(GW, GH), d = img.data;
  for (let iy = 0; iy < GH; iy++) {
    const wy = y0 + (iy / (GH - 1)) * H;
    for (let ix = 0; ix < GW; ix++) {
      const wx = x0 + (ix / (GW - 1)) * W;
      let p = 0, wSum = 0, tSum = 0, vSum = 0;
      for (const w of secWells) {
        const dx = wx - w.x, dy = wy - w.y;
        const g0 = Math.exp(-(dx * dx + dy * dy) * w.inv);
        p += g0 * 0.68; wSum += g0 * w.warm; tSum += g0 * w.teal; vSum += g0 * w.violet;
      }
      for (const s of starWells) {
        const dx = wx - s.x, dy = wy - s.y;
        const g0 = Math.exp(-(dx * dx + dy * dy) * s.inv) * s.w;
        p += g0; wSum += g0 * s.warm;
      }
      for (const l of explicitLanes) {
        const dx = wx - l.mx, dy = wy - l.my;
        p += Math.exp(-(dx * dx + dy * dy) * l.inv) * 0.26;
      }
      const ex = Math.min(ix / (GW * 0.22), (GW - 1 - ix) / (GW * 0.22), 1);
      const ey = Math.min(iy / (GH * 0.22), (GH - 1 - iy) / (GH * 0.22), 1);
      const edge = smoothstep(0, 1, Math.min(ex, ey));
      const v = p * edge;
      const gi = iy * GW + ix;
      pot[gi] = v;
      const wm = clamp(wSum / (p + 0.001), 0, 1);
      const tm = clamp(tSum / (p + 0.001), 0, 1);
      const vm = clamp(vSum / (p + 0.001), 0, 1);
      warmGrid[gi] = wm; tealGrid[gi] = tm; violetGrid[gi] = vm;
      if (v < 0.03) continue;
      // 莫奈式柔润油画罩染底色（群青、暮紫、松石青、暖金暮晕）
      const wash = smoothstep(0.03, 1.0, v);
      const r = 24 + wash * (32 + wm * 104 + vm * 44 - tm * 6);
      const gr = 46 + wash * (58 + wm * 56 + tm * 48 + vm * 16);
      const b = 108 + wash * (70 - wm * 34 + tm * 18 + vm * 30);
      const idx = gi * 4;
      d[idx] = Math.round(clamp(r, 0, 255));
      d[idx + 1] = Math.round(clamp(gr, 0, 255));
      d[idx + 2] = Math.round(clamp(b, 0, 255));
      d[idx + 3] = Math.round(clamp(wash * 0.34, 0, 0.36) * 255);
    }
  }
  lg.putImageData(img, 0, 0);

  // 高清纯印象派油画画布：抒情起伏的夜风短排笔，绝不做指纹同心圆！
  const scale = 3.2;
  const CW = Math.round(GW * scale), CH = Math.round(GH * scale);
  const c = canvas(CW, CH), g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(lo, 0, 0, CW, CH);

  const samplePot = (gx, gy) => {
    const ix = clamp(Math.floor(gx), 0, GW - 2), iy = clamp(Math.floor(gy), 0, GH - 2);
    const fx = gx - ix, fy = gy - iy, gi = iy * GW + ix;
    return (pot[gi] * (1 - fx) + pot[gi + 1] * fx) * (1 - fy) + (pot[gi + GW] * (1 - fx) + pot[gi + GW + 1] * fx) * fy;
  };
  // 主导全画面的抒情印象派夜风长波（微弱绕星域轻拂，绝不锁成指纹涡旋）
  const windVec = (gx, gy) => {
    const ix = clamp(Math.round(gx), 1, GW - 2), iy = clamp(Math.round(gy), 1, GH - 2);
    const gi = iy * GW + ix;
    const v = pot[gi];
    // 舒展的 S 形风浪 + 有机自然起伏
    const wave = -0.26 + Math.sin(gx * 0.044 + gy * 0.018) * 0.44 + Math.cos(gy * 0.036 - gx * 0.014) * 0.24;
    const breeze = wave + (fbm(gx * 0.045, gy * 0.045, 3) - 0.5) * 1.35;
    let vx = Math.cos(breeze), vy = Math.sin(breeze);
    const dpx = pot[gi + 1] - pot[gi - 1], dpy = pot[gi + GW] - pot[gi - GW];
    const mag = Math.hypot(dpx, dpy);
    if (mag > 0.004) {
      // 仅叠加 28% 的轻柔绕流，让云气顺风拂过星群，而不是卷成死板同心圆
      const tang = Math.atan2(dpy, dpx) + Math.PI / 2;
      const bend = smoothstep(0.14, 0.55, v) * smoothstep(0.004, 0.025, mag) * 0.28;
      vx = vx * (1 - bend) + Math.cos(tang) * bend;
      vy = vy * (1 - bend) + Math.sin(tang) * bend;
    }
    const norm = Math.hypot(vx, vy) || 1;
    return [vx / norm, vy / norm];
  };

  // 第一遍：大笔湿画晕染（打通笔触之间的缝隙，让整片油画云气浑厚丰润）
  for (let sy = 6; sy < GH - 6; sy += 5.4) {
    for (let sx = 6; sx < GW - 6; sx += 5.4) {
      const gx = sx + (rnd() - 0.5) * 4.5, gy = sy + (rnd() - 0.5) * 4.5;
      const ex = Math.min(gx / (GW * 0.22), (GW - gx) / (GW * 0.22), 1);
      const ey = Math.min(gy / (GH * 0.22), (GH - gy) / (GH * 0.22), 1);
      const edge = smoothstep(0, 1, Math.min(ex, ey));
      const v = samplePot(gx, gy);
      if (v < 0.05 || rnd() > 0.72 * edge) continue;
      const gi = clamp(Math.floor(gy), 0, GH - 1) * GW + clamp(Math.floor(gx), 0, GW - 1);
      const wm = warmGrid[gi], tm = tealGrid[gi], vm = violetGrid[gi];
      const [vx, vy] = windVec(gx, gy);
      const ds = 3.2 + rnd() * 2.4;
      const pts = [[gx * scale, gy * scale], [(gx + vx * ds) * scale, (gy + vy * ds) * scale], [(gx + vx * ds * 1.9) * scale, (gy + vy * ds * 1.9) * scale]];
      const t = smoothstep(0.05, 0.82, v);
      const h = wm > 0.45 && t > 0.45 ? 40 : vm > 0.35 ? 238 : tm > 0.32 ? 196 : 214;
      const body = `hsla(${h + (rnd() - 0.5) * 14},${36 + t * 18}%,${24 + t * 24}%,${(0.055 + t * 0.075) * edge})`;
      paintBristle(g, pts, 14 + rnd() * 10, body, null, null, rnd);
    }
  }

  // 第二遍：中号猪鬃毛刷短排笔（印象派标志性的色彩并置 + 厚涂层次）
  const stepGrid = 2.6;
  const seeds = [];
  for (let sy = 5; sy < GH - 5; sy += stepGrid) {
    for (let sx = 5; sx < GW - 5; sx += stepGrid) {
      const gx = sx + (rnd() - 0.5) * stepGrid * 0.94;
      const gy = sy + (rnd() - 0.5) * stepGrid * 0.94;
      const ex = Math.min(gx / (GW * 0.2), (GW - gx) / (GW * 0.2), 1);
      const ey = Math.min(gy / (GH * 0.2), (GH - gy) / (GH * 0.2), 1);
      const edge = smoothstep(0, 1, Math.min(ex, ey));
      const v = samplePot(gx, gy);
      const cloud = fbm(gx * 0.042 + 2.3, gy * 0.042 + 5.1, 3);
      const keep = (smoothstep(0.04, 0.36, v) * 0.68 + cloud * 0.42) * edge;
      if (rnd() > keep) continue;
      seeds.push({ gx, gy, v, edge, cloud });
    }
  }
  seeds.sort((a, b) => a.v - b.v);

  for (const s of seeds) {
    const { gx, gy, v, edge, cloud } = s;
    const gi = clamp(Math.floor(gy), 0, GH - 1) * GW + clamp(Math.floor(gx), 0, GW - 1);
    const wm = warmGrid[gi], tm = tealGrid[gi], vm = violetGrid[gi];
    const steps = 2 + (rnd() < 0.52 ? 1 : 0);
    const ds = (1.25 + rnd() * 0.95) * (0.88 + Math.min(0.4, v * 0.35));
    const pts = [[gx * scale, gy * scale]];
    let cx = gx, cy = gy;
    const jitterAng = (rnd() - 0.5) * 0.24;
    const cosJ = Math.cos(jitterAng), sinJ = Math.sin(jitterAng);
    for (let k = 0; k < steps; k++) {
      const [bx, by] = windVec(cx, cy);
      const vx = bx * cosJ - by * sinJ, vy = bx * sinJ + by * cosJ;
      cx += vx * ds; cy += vy * ds;
      if (cx < 1 || cx > GW - 2 || cy < 1 || cy > GH - 2) break;
      pts.push([cx * scale, cy * scale]);
    }
    if (pts.length < 2) continue;
    const wid = (3.4 + rnd() * 3.4) * (0.84 + Math.min(0.45, v * 0.4));
    const t = smoothstep(0.06, 0.82, v);
    const fade = edge;
    const pick = rnd();
    let body, sheen, shadow = null;
    if (t > 0.46 && pick < (0.22 + wm * 0.36 + (t - 0.46) * 0.44)) {
      // 暖金 / 拿坡里黄 / 杏色月光笔触
      const h = 39 + (rnd() - 0.5) * 16;
      const a = (0.11 + t * 0.14 + rnd() * 0.08) * fade;
      body = `hsla(${h},${56 + rnd() * 20}%,${57 + rnd() * 12}%,${a.toFixed(3)})`;
      sheen = `hsla(${h + 6},70%,${76 + rnd() * 8}%,${(a * 0.72).toFixed(3)})`;
      shadow = `hsla(238,42%,22%,${(a * 0.32).toFixed(3)})`;
    } else if (pick < 0.26 + vm * 0.28) {
      // 莫奈暮紫 / 熏衣草靛紫笔触
      const h = 238 + (rnd() - 0.5) * 22;
      const sat = 38 + t * 18 + rnd() * 14;
      const lum = 28 + t * 24 + rnd() * 12;
      const a = (0.1 + t * 0.13 + rnd() * 0.08) * fade;
      body = `hsla(${h},${sat.toFixed(0)}%,${lum.toFixed(0)}%,${a.toFixed(3)})`;
      sheen = `hsla(${h + 14},${(sat + 8).toFixed(0)}%,${Math.min(72, lum + 16).toFixed(0)}%,${(a * 0.55).toFixed(3)})`;
    } else {
      // 群青 / 钴蓝 / 天青松石色并置短笔触
      const h = (tm > 0.3 || cloud > 0.62 ? 194 : 214) + (rnd() - 0.5) * 18;
      const sat = 42 + t * 22 + rnd() * 14;
      const lum = 26 + t * 28 + rnd() * 12;
      const a = (0.1 + t * 0.14 + rnd() * 0.08) * fade;
      body = `hsla(${h},${sat.toFixed(0)}%,${lum.toFixed(0)}%,${a.toFixed(3)})`;
      sheen = `hsla(${h - 10},${(sat + 10).toFixed(0)}%,${Math.min(76, lum + 16).toFixed(0)}%,${(a * 0.6).toFixed(3)})`;
    }
    paintBristle(g, pts, wid, body, sheen, shadow, rnd);
  }

  return { canvas: c, x0, y0, W, H };
}
function skyField(seed = 20261120) {
  const rnd = seeded(seed);
  const layers = [
    { f: 0.015, n: 260, s: [0.6, 1.1], a: [0.16, 0.44] },
    { f: 0.05,  n: 110, s: [0.9, 1.5], a: [0.3, 0.72] },
    { f: 0.11,  n: 30,  s: [1.3, 2.2], a: [0.58, 0.92] }
  ];
  return layers.map(L => ({
    f: L.f,
    stars: Array.from({ length: L.n }, () => ({
      x: rnd(), y: rnd(), s: L.s[0] + rnd() * (L.s[1] - L.s[0]), a: L.a[0] + rnd() * (L.a[1] - L.a[0]),
      h: rnd() < 0.42 ? 42 : 206, sat: rnd() < 0.65 ? 34 : 62, ph: rnd() * TAU, sp: 0.28 + rnd() * 0.9
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
    document.fonts?.ready?.then(() => { this.widths.clear(); this.labelK = 0; this.dirty = true; this.camDirty = true; this.kick(); });
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
    // 100% 纯粹印象派油画夜空（群青、钴蓝、暮紫、天青厚涂短笔触；彻底移除一切横线/网格）
    const c = canvas(Math.round(W * dpr), Math.round(H * dpr)), g = c.getContext('2d');
    g.scale(dpr, dpr);
    const bg = g.createLinearGradient(0, 0, W * 0.42, H);
    bg.addColorStop(0, '#0b1633');
    bg.addColorStop(0.5, '#132752');
    bg.addColorStop(1, '#0d1a3a');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const fbm = makeNoise(42422026), rnd = seeded(18890619);
    const M = Math.max(W, H);
    // 莫奈式暮蓝与熏衣草紫油画罩染底晕
    const washes = [
      [W * 0.35, H * 0.38, M * 0.65, 'rgba(54,96,158,.24)'],
      [W * 0.72, H * 0.62, M * 0.58, 'rgba(72,64,132,.16)'],
      [W * 0.52, H * 0.22, M * 0.46, 'rgba(42,104,142,.15)']
    ];
    for (const [wx, wy, wr, col] of washes) {
      const grd = g.createRadialGradient(wx, wy, 0, wx, wy, wr);
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(12,24,54,0)');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
    }

    // 第一遍宽笔柔刷底云 + 第二遍致密毛刷油画排笔（铺满全屏，绝无漂浮短棒感）
    const broad = clamp(Math.round(M / 14), 48, 72);
    for (let sy = -broad; sy < H + broad; sy += broad * 0.72) {
      for (let sx = -broad; sx < W + broad; sx += broad * 0.85) {
        const cx = sx + (rnd() - 0.5) * broad * 0.7, cy = sy + (rnd() - 0.5) * broad * 0.7;
        const a = -0.26 + Math.sin(cx / M * 5.2 + cy / M * 2.1) * 0.4;
        const pts = [[cx, cy], [cx + Math.cos(a) * 28, cy + Math.sin(a) * 28], [cx + Math.cos(a + 0.1) * 54, cy + Math.sin(a + 0.1) * 54]];
        const lift = fbm(cx / M * 2.2 + 1.2, cy / M * 2.2 + 3.4, 2);
        const h = lift > 0.56 ? 206 : lift < 0.38 ? 236 : 220;
        paintBristle(g, pts, 24 + rnd() * 14, `hsla(${h},42%,${16 + lift * 16}%,0.09)`, null, null, rnd);
      }
    }
    const step = clamp(Math.round(M / 42), 15, 24);
    for (let sy = -step; sy < H + step; sy += step * 0.78) {
      for (let sx = -step; sx < W + step; sx += step) {
        let cx = sx + (rnd() - 0.5) * step * 0.92;
        let cy = sy + (rnd() - 0.5) * step * 0.92;
        const pts = [[cx, cy]];
        const segs = 2 + (rnd() < 0.55 ? 1 : 0);
        const ds = 5.5 + rnd() * 4.5;
        for (let k = 0; k < segs; k++) {
          const nx = cx / M * 2.6, ny = cy / M * 2.6;
          const a = -0.26 + Math.sin(nx * 2.2 + ny * 0.9) * 0.44 + (fbm(nx, ny, 3) - 0.5) * 1.25;
          cx += Math.cos(a) * ds; cy += Math.sin(a) * ds;
          pts.push([cx, cy]);
        }
        const lift = fbm(sx / M * 2.4 + 4.2, sy / M * 2.4 + 1.8, 2);
        const wid = 4.2 + rnd() * 4.6;
        let body, sheen = null;
        if (lift > 0.64) {
          const h = 200 + rnd() * 16;
          body = `hsla(${h},44%,${28 + rnd() * 11}%,${0.11 + rnd() * 0.08})`;
          sheen = `hsla(${h - 6},50%,${42 + rnd() * 10}%,${0.06 + rnd() * 0.05})`;
        } else if (lift < 0.34) {
          const h = rnd() < 0.48 ? 240 : 226;
          body = `hsla(${h},46%,${12 + rnd() * 6}%,${0.16 + rnd() * 0.12})`;
        } else {
          const h = rnd() < 0.34 ? 236 + rnd() * 14 : 214 + rnd() * 14;
          body = `hsla(${h},44%,${20 + rnd() * 9}%,${0.13 + rnd() * 0.09})`;
          sheen = `hsla(${h - 8},48%,${33 + rnd() * 9}%,${0.05 + rnd() * 0.05})`;
        }
        paintBristle(g, pts, wid, body, sheen, null, rnd);
      }
    }
    // 柔和油画暗角收束视心
    const vig = g.createRadialGradient(W * 0.5, H * 0.48, Math.min(W, H) * 0.28, W * 0.5, H * 0.5, Math.max(W, H) * 0.86);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(6,12,28,.48)');
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
    this.worldField = buildWorldField(model);
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
    const top = 96, bottom = 104, side = this.SW < 600 ? 32 : 90;
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
      if (g?.kind === 'pan' && !g.moved && !this.pointers.size && e.type === 'pointerup' && performance.now() - g.t0 < 600) {
        const now = performance.now();
        if (this.lastBgTap && now - this.lastBgTap < 320) {
          this.lastBgTap = 0;
          this.fit(true);
        } else {
          this.lastBgTap = now;
          this.onBackground?.();
        }
      }
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
      const sz = s.mag === 'beacon' ? 17.5 : 15;
      this.measureCtx.font = `400 ${sz}px ${ART_FONT}`;
      this.widths.set(key, Math.min(this.measureCtx.measureText(s.title).width * 1.12, s.mag === 'beacon' ? 220 : 196));
    }
    return this.widths.get(key);
  }
  layoutLabels() {
    const k = this.cam.k, lod = this.lod;
    const rank = s => (s.id === this.focus ? 1000 : this.near.has(s.id) ? 500 : 0) + (s.mag === 'beacon' ? 100 : s.mag === 'star' ? 50 : 0) + s.score;
    const allowed = s => this.near.has(s.id) || s.mag === 'beacon' || (lod !== 'far' && s.mag === 'star') || lod === 'near';
    // 平视时星点本身也是障碍；靠近屏幕右缘时优先向左翻，避免艺术字贴边。2.5D 时试多层丝线高度。
    const taken = this.tilt ? [] : this.model.stars.map(s => ({ id: s.id, x0: s.x * k - 10, x1: s.x * k + 10, y0: s.y * k - 10, y1: s.y * k + 10 }));
    for (const s of this.model.stars.slice().sort((a, b) => rank(b) - rank(a) || byId(a, b))) {
      const btn = this.buttons.get(s.id);
      if (!btn) continue;
      let pick = null;
      if (allowed(s)) {
        const w = this.textWidth(s) + 12, x = s.x * k, y = s.y * k;
        const stem = s.mag === 'beacon' ? 42 : s.mag === 'faint' ? 8 : 18;
        const py = this.tilt ? y * Math.cos(TILT_DEG * Math.PI / 180) : y;
        const lh = this.lod === 'near' || s.id === this.focus ? 54 : 36;
        const sx = this.SW / 2 + this.cam.x + x;
        const rightOpt = { flip: false, r: { x0: x + 13, x1: x + 22 + w, y0: y - 14, y1: y + 14 } };
        const leftOpt = { flip: true, r: { x0: x - 22 - w, x1: x - 13, y0: y - 14, y1: y + 14 } };
        const opts = this.tilt
          ? [0, 44, 88, 132].map(lift => ({ lift, r: { x0: x - w / 2 - 12, x1: x + w / 2 + 12, y0: py - stem - lift - lh, y1: py - stem - lift + 4 } }))
          : (sx + 22 + w > this.SW - 14 && sx - 22 - w > 10) ? [leftOpt, rightOpt] : [rightOpt, leftOpt];
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

    if (!stars.length) { this.paintBeacon(g, 0, 0, 42, zs, t, animate, 1, px); return; }

    // 1. 纯粹印象派油画云气与短排笔层（零几何等高线、零雷达同心圆）
    if (this.worldField) {
      const wf = this.worldField;
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = (lod === 'far' ? 0.92 : lod === 'mid' ? 0.84 : 0.7) * (focus ? 0.55 : 1);
      g.drawImage(wf.canvas, wf.x0, wf.y0, wf.W, wf.H);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }

    // 2. 画中艺术大题字（霞鹜文楷 / 楷书手书题款；2.5D 聚焦星体时该星域退隐，绝不与悬空艺术字重叠）
    const focusSec = focus ? this.byId.get(focus)?.sector : null;
    for (const s of sectors) {
      const sameFocus = focusSec === s.name;
      const df = (this.tilt && sameFocus) ? 0 : (focus && !sameFocus) ? 0.28 : 1;
      if (df <= 0.01) continue;
      const fs = lod === 'far' ? 22 : lod === 'mid' ? 19 : 16;
      const alpha = (lod === 'far' ? 0.88 : lod === 'mid' ? 0.72 : 0.5) * df;
      g.save();
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const ly = s.y - s.R * 0.94 - px(12);
      try { g.letterSpacing = px(lod === 'far' ? 7 : 4.5) + 'px'; } catch {}
      g.font = `400 ${px(fs)}px ${ART_FONT}`;
      g.shadowColor = 'rgba(7,14,34,0.95)';
      g.shadowBlur = px(14);
      g.fillStyle = s.frontier ? `rgba(210,222,248,${alpha * 0.62})` : `rgba(253,238,194,${alpha})`;
      g.fillText(s.frontier ? '未测绘' : s.name, s.x, ly);
      try { g.letterSpacing = '0px'; } catch {}
      g.restore();
    }

    // 3. 印象派星光流连线（温润金白光带 + 细碎微光浮尘）
    g.lineCap = 'round';
    for (const l of lanes) {
      const a = this.byId.get(l.a), b = this.byId.get(l.b);
      if (!a || !b) continue;
      const touch = focus && (l.a === focus || l.b === focus);
      const fade = focus && !touch ? 0.14 : 1;
      if (l.kind === 'tag') {
        g.setLineDash([px(1.5), px(8)]);
        g.lineWidth = px(1.0);
        g.strokeStyle = `rgba(196,216,248,${0.18 * fade})`;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.setLineDash([]);
        continue;
      }
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const bend = (hash(l.a + l.b) & 1 ? 1 : -1) * Math.min(d * 0.16, 76);
      const cx = mx - dy / d * bend, cy = my + dx / d * bend;
      const grad = g.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, 'rgba(252,226,154,0.92)');
      grad.addColorStop(0.5, 'rgba(255,248,224,0.98)');
      grad.addColorStop(1, 'rgba(252,226,154,0.92)');
      const curve = () => { g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(cx, cy, b.x, b.y); g.stroke(); };
      g.strokeStyle = 'rgba(9,18,44,0.44)'; g.globalAlpha = fade; g.lineWidth = px(touch ? 5 : 3.4); curve();
      g.strokeStyle = grad;
      g.globalAlpha = (touch ? 0.34 : 0.18) * fade; g.lineWidth = px(touch ? 7.5 : 4.8); curve();
      g.globalAlpha = (touch ? 0.94 : 0.72) * fade; g.lineWidth = px(touch ? 1.7 : 1.25); curve();
      if (touch || (!focus && animate)) {
        const u = ((animate ? t * 0.00022 : 0.38) + (hash(l.a + l.b) % 100) / 100) % 1;
        const iu = 1 - u;
        const px0 = iu * iu * a.x + 2 * iu * u * cx + u * u * b.x;
        const py0 = iu * iu * a.y + 2 * iu * u * cy + u * u * b.y;
        const ps = px(touch ? 14 : 9.5);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = (touch ? 0.92 : 0.58) * fade;
        g.drawImage(this.sprite(42, 68), px0 - ps / 2, py0 - ps / 2, ps, ps);
        g.globalCompositeOperation = 'source-over';
      }
      g.globalAlpha = 1;
    }

    // 4. 印象派厚涂发光星体（梵高《星夜》手绘圆弧暖金星晕，绝无硬十字标尺）
    for (const s of stars) {
      const fade = focus && !near.has(s.id) ? 0.18 : 1;
      const tw = animate ? 0.9 + 0.1 * Math.sin(t * 0.0017 + s.phase) : 1;
      if (s.mag === 'beacon') this.paintBeacon(g, s.x, s.y, s.hue, zs, t, animate, fade * tw, px, s.phase);
      else if (s.mag === 'star') {
        const H = 48 * zs;
        g.globalCompositeOperation = 'screen';
        g.globalAlpha = 0.74 * fade * tw;
        g.drawImage(this.sprite(44, 72), s.x - px(H / 2), s.y - px(H / 2), px(H), px(H));
        g.globalCompositeOperation = 'source-over';
        // 一圈温润的手绘星晕短弧
        g.lineCap = 'round';
        g.strokeStyle = `rgba(254,234,174,${0.56 * fade * tw})`;
        g.lineWidth = px(2.0 * zs);
        const rad = px(8.5 * zs);
        for (let i = 0; i < 4; i++) {
          const a0 = s.phase + (i / 4) * TAU;
          g.beginPath(); g.arc(s.x, s.y, rad, a0, a0 + 0.92); g.stroke();
        }
        g.globalAlpha = fade;
        g.fillStyle = '#fff9e6';
        g.beginPath(); g.arc(s.x, s.y, px(3.0 * zs), 0, TAU); g.fill();
      } else {
        // 未连接孤星：静谧柔雾微光圆点
        const breath = animate ? 0.5 + 0.5 * Math.sin(t * 0.0015 + s.phase) : 0.6;
        const H = 28 * zs;
        g.globalCompositeOperation = 'screen';
        g.globalAlpha = (0.42 + breath * 0.24) * fade;
        g.drawImage(this.sprite(214, 52), s.x - px(H / 2), s.y - px(H / 2), px(H), px(H));
        g.globalCompositeOperation = 'source-over';
        g.lineCap = 'round';
        g.strokeStyle = `rgba(204,220,252,${(0.24 + breath * 0.2) * fade})`;
        g.lineWidth = px(1.5 * zs);
        const rad = px((6.8 + breath * 2.6) * zs);
        for (let i = 0; i < 3; i++) {
          const a0 = s.phase + (i / 3) * TAU;
          g.beginPath(); g.arc(s.x, s.y, rad, a0, a0 + 1.15); g.stroke();
        }
        g.globalAlpha = 0.8 * fade;
        g.fillStyle = '#e6efff';
        g.beginPath(); g.arc(s.x, s.y, px(2.0 * zs), 0, TAU); g.fill();
      }
      if (s.id === focus) {
        // 选中光晕：柔和印象派暖金宽笔环（替代硬白 UI 细圈）
        const pulse = animate ? Math.sin(t * 0.0032) * 2.2 : 0;
        const R = px((s.mag === 'beacon' ? 28 : 16) * zs + pulse);
        g.lineCap = 'round';
        g.strokeStyle = 'rgba(255,236,174,0.72)';
        g.lineWidth = px(2.4 * zs);
        for (let i = 0; i < 5; i++) {
          const a0 = (animate ? t * 0.00025 : 0) + (i / 5) * TAU;
          g.beginPath(); g.arc(s.x, s.y, R, a0, a0 + 0.86); g.stroke();
        }
      }
      g.globalAlpha = 1;
    }
  }
  paintBeacon(g, x, y, hue, zs, t, animate, alpha, px, phase = 0) {
    // 梵高《星夜》厚涂发光主星：暖黄光晕 + 手绘断续油画同心弧笔触 + 温润奶油星核
    const halo = 112 * zs, core = 44 * zs;
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.56 * alpha;
    g.drawImage(this.sprite(42, 82), x - px(halo / 2), y - px(halo / 2), px(halo), px(halo));
    g.globalAlpha = 0.95 * alpha;
    g.drawImage(this.sprite(45, 70), x - px(core / 2), y - px(core / 2), px(core), px(core));
    g.globalCompositeOperation = 'source-over';
    const spin = animate ? t * 0.00014 : 0;
    g.lineCap = 'round';
    [
      { r: 10.5, n: 5, span: 0.72, w: 3.0, col: `rgba(255,238,176,${0.76 * alpha})`, dir: 1 },
      { r: 17.5, n: 7, span: 0.54, w: 2.5, col: `rgba(246,208,118,${0.54 * alpha})`, dir: -0.7 },
      { r: 24.5, n: 9, span: 0.4,  w: 2.0, col: `rgba(182,216,248,${0.3 * alpha})`,  dir: 0.45 }
    ].forEach((ring, ri) => {
      g.strokeStyle = ring.col;
      g.lineWidth = px(ring.w * zs);
      const rad = px(ring.r * zs);
      for (let i = 0; i < ring.n; i++) {
        const jit = Math.sin(phase * 3 + ri * 7 + i * 2.3) * 0.14;
        const a0 = phase + spin * ring.dir + (i / ring.n) * TAU + jit;
        g.beginPath();
        g.arc(x, y, rad, a0, a0 + ring.span * (0.88 + Math.abs(jit)));
        g.stroke();
      }
    });
    // 厚涂奶油金圆润星核（无几何尖刺）
    g.globalAlpha = alpha;
    g.fillStyle = '#fff5d4';
    g.beginPath(); g.arc(x, y, px(4.6 * zs), 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(x - px(0.8 * zs), y - px(0.8 * zs), px(2.2 * zs), 0, TAU); g.fill();
    g.globalAlpha = 1;
  }
}
