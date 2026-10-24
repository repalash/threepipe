(function () {
// js/trees.js
// Procedural NYC street & park trees, planted by street-details.js (section 7):
// - London plane, honey locust & American elm grown from seeded per-species rules: a flared trunk / leader carrying
//   scaffold limbs, branches and twigs as tapered, curving bark tubes (uv in metres for the bark shader)
// - Leaf sprays on alpha-tested cards hung from the twigs, cut from a generated leaf atlas (palmate plane leaves,
//   feathery locust fronds, toothed elm leaves and a dense far-canopy clump) whose mipmaps keep their coverage, so
//   distant crowns don't thin out
// - Crown-shell normals, interior occlusion & sway weights baked per vertex (attributes: createTreeMaterial in
//   tsl-materials.js)
// - Three levels of detail (two variants per species up close), picked per tree from the camera distance and
//   regrouped into one instanced mesh per species / variant / level whenever the camera has moved a few metres

const { THREE } = window.NYC;
const { createTreeMaterial } = window.NYC;
const V3 = THREE.Vector3;

// Seeded PRNG (mulberry32): every species, variant and level grows the same tree on every load
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// =====================================================================================================================
// 1. LEAF ATLAS: 2x2 tiles of leaf sprays drawn in metres and fitted to their tile (tileMeters = the card's world size)
//    0 London plane · 1 honey locust · 2 American elm · 3 dense far-canopy clump (whole-crown cards of the far level)
//    Texels: r = leaf brightness, g = per-leaf hue jitter, b = twig / stalk mask, a = coverage
// =====================================================================================================================
const ATLAS_SIZE = 1024;
const TILE = ATLAS_SIZE / 2;
const GUTTER = 8; // px kept clear round every tile, so mip levels don't bleed between tiles
const TILE_FAR = 3;
const tileOrigin = (k) => [(k % 2) * TILE, (k >> 1) * TILE];

// Spray primitives in metres (x right, y up from the card's attachment point): twigs (polylines) & leaves
function buildSprays(rng) {
  const R = (a, b) => a + (b - a) * rng();
  const dirOf = (a) => [Math.sin(a), Math.cos(a)]; // a = angle from straight up

  // Curving twig from (x, y) at angle a off vertical, len m long, curling by `curl` rad over its length
  const twig = (x, y, a, len, curl, segs = 12) => {
    const pts = [[x, y]];
    let ang = a;
    for (let i = 1; i <= segs; i++) {
      ang += curl / segs + R(-0.035, 0.035);
      const p = pts[i - 1];
      pts.push([p[0] + Math.sin(ang) * len / segs, p[1] + Math.cos(ang) * len / segs]);
    }
    return pts;
  };
  // Point & direction angle at arc fraction t of a polyline
  const at = (pts, t) => {
    const f = Math.min(pts.length - 1.001, t * (pts.length - 1));
    const i = Math.floor(f);
    const k = f - i;
    const a = pts[i];
    const b = pts[i + 1];
    return { p: [lerp(a[0], b[0], k), lerp(a[1], b[1], k)], a: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  };

  const sprays = [];

  // 0. London plane: four or five twigs fanning out, big palmate leaves on long stalks, alternating along them
  {
    const prims = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const pts = twig(f * 0.08, 0, f * 1.55 + R(-0.1, 0.1), R(0.62, 0.8) * (1 - Math.abs(f) * 0.32), f * 0.6);
      prims.push({ type: 'twig', pts, w0: 0.016, w1: 0.006 });
      let side = rng() < 0.5 ? 1 : -1;
      for (let t = R(0.18, 0.26); t < 0.97; t += R(0.15, 0.19)) {
        const { p, a } = at(pts, t);
        side = -side;
        const la = a + side * R(0.55, 1.05);
        const len = R(0.17, 0.23) * (1 - t * 0.25);
        const stalk = len * 0.32;
        const q = [p[0] + Math.sin(la) * stalk, p[1] + Math.cos(la) * stalk];
        prims.push({ type: 'stalk', a: p, b: q, w: 0.006 });
        prims.push({ type: 'palmate', p: q, a: la + R(-0.25, 0.25), len, t });
      }
      const tip = at(pts, 1);
      prims.push({ type: 'palmate', p: tip.p, a: tip.a + R(-0.2, 0.2), len: R(0.15, 0.19), t: 1 });
    }
    sprays.push(prims);
  }

  // 1. Honey locust: slender twigs bearing feathery compound fronds of tiny paired leaflets (lacy, light-dappled)
  {
    const prims = [];
    const n = 3;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const pts = twig(0, 0, f * 1.3 + R(-0.1, 0.1), R(0.5, 0.62), f * 0.5);
      prims.push({ type: 'twig', pts, w0: 0.012, w1: 0.005 });
      let side = rng() < 0.5 ? 1 : -1;
      for (let t = R(0.12, 0.2); t <= 1.0; t += R(0.2, 0.26)) {
        const { p, a } = at(pts, Math.min(t, 1));
        side = -side;
        const fa = a + side * R(0.35, 0.8);
        const flen = R(0.26, 0.36);
        const rachis = twig(p[0], p[1], fa, flen, side * R(-0.3, 0.1), 8);
        prims.push({ type: 'stalk', pts: rachis, w: 0.004 });
        for (let s = 0.12; s < 0.98; s += 0.07) {
          const r = at(rachis, s);
          for (const sd of [-1, 1]) {
            prims.push({ type: 'oval', p: r.p, a: r.a + sd * R(1.0, 1.35), len: R(0.032, 0.042), wid: 0.38, t: Math.min(1, t + s * 0.3) });
          }
        }
        const end = at(rachis, 1);
        prims.push({ type: 'oval', p: end.p, a: end.a, len: 0.036, wid: 0.38, t: 1 });
      }
    }
    sprays.push(prims);
  }

  // 2. American elm: zigzag twigs, drooping a little, with two ranks of oval, pointed, lopsided leaves
  {
    const prims = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const pts = twig(f * 0.06, 0, f * 1.6 + R(-0.1, 0.1), R(0.5, 0.66) * (1 - Math.abs(f) * 0.25), f * 0.9, 14);
      prims.push({ type: 'twig', pts, w0: 0.012, w1: 0.004 });
      let side = rng() < 0.5 ? 1 : -1;
      for (let t = R(0.1, 0.16); t < 0.97; t += R(0.085, 0.11)) {
        const { p, a } = at(pts, t);
        side = -side;
        prims.push({ type: 'oval', p, a: a + side * R(0.6, 1.0), len: R(0.1, 0.13) * (1 - t * 0.2), wid: 0.5, skew: side * 0.12, t });
      }
      const tip = at(pts, 1);
      prims.push({ type: 'oval', p: tip.p, a: tip.a, len: 0.09, wid: 0.48, t: 1 });
    }
    sprays.push(prims);
  }

  // 3. Far-canopy clump: a ragged, roundish mass of leaves (one card stands for a whole section of a distant crown)
  {
    const prims = [];
    const lobes = Array.from({ length: 7 }, () => ({ a: R(0, Math.PI * 2), r: R(0.75, 1.0), w: R(0.5, 0.9) }));
    const edge = (ang) => 1.25 * lobes.reduce((m, l) => Math.max(m, l.r * Math.cos(Math.min(Math.PI / 2, Math.abs(((ang - l.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / l.w))), 0.6);
    for (let k = 0; k < 520; k++) {
      const ang = R(0, Math.PI * 2);
      const rr = Math.sqrt(rng()) * edge(ang);
      const p = [Math.cos(ang) * rr, 1.3 + Math.sin(ang) * rr];
      prims.push({ type: 'oval', p, a: R(-Math.PI, Math.PI), len: R(0.16, 0.22), wid: 0.55, t: Math.min(1, Math.max(0, (p[1] - 0.2) / 2.2)) });
    }
    sprays.push(prims);
  }
  return sprays;
}

// Bounding box of a spray (metres), with leaves treated as discs round their centre
function sprayBounds(prims) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const add = (x, y, r = 0) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };
  for (const q of prims) {
    if (q.type === 'twig' || (q.type === 'stalk' && q.pts)) for (const p of q.pts) add(p[0], p[1]);
    else if (q.type === 'stalk') {
      add(q.a[0], q.a[1]);
      add(q.b[0], q.b[1]);
    } else {
      add(q.p[0] + Math.sin(q.a) * q.len * 0.5, q.p[1] + Math.cos(q.a) * q.len * 0.5, q.len * 0.62);
    }
  }
  return { minX, maxX, minY, maxY };
}

function createLeafAtlas() {
  const ctx2d = () => {
    const c = document.createElement('canvas');
    c.width = c.height = ATLAS_SIZE;
    return c.getContext('2d', { willReadFrequently: true });
  };
  const col = ctx2d(); // r leaf brightness, g hue jitter, b twig mask
  const cov = ctx2d(); // coverage
  // Mean leaf value under the empty texels, so filtering never pulls black (or twig brown) into the leaf edges
  col.fillStyle = 'rgb(170, 128, 0)';
  col.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  for (const c of [col, cov]) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  const rng = mulberry32(20261015);
  const R = (a, b) => a + (b - a) * rng();
  const sprays = buildSprays(rng);
  const tileMeters = [];

  sprays.forEach((prims, k) => {
    // Fit: attachment point at the bottom centre of the tile (the far clump: centred), widest extent to the gutter
    const b = sprayBounds(prims);
    const [ox, oy] = tileOrigin(k);
    const room = TILE - 2 * GUTTER;
    let s;
    let cx;
    let by;
    if (k === TILE_FAR) {
      s = room / Math.max(b.maxX - b.minX, b.maxY - b.minY);
      cx = ox + TILE / 2 - ((b.minX + b.maxX) / 2) * s;
      by = oy + TILE / 2 + ((b.minY + b.maxY) / 2) * s;
    } else {
      s = Math.min((room / 2) / Math.max(-b.minX, b.maxX), room / Math.max(b.maxY, 0.01));
      cx = ox + TILE / 2;
      by = oy + TILE - GUTTER;
    }
    tileMeters[k] = room / s;
    const X = (p) => cx + p[0] * s;
    const Y = (p) => by - p[1] * s;
    // Point (u along, v across) of a leaf from P at angle a, L long & W wide (canvas space)
    const frame = (P, a, L, W) => {
      const d = [Math.sin(a), -Math.cos(a)];
      const x0 = X(P);
      const y0 = Y(P);
      return (u, v) => [x0 + d[0] * u * L * s - d[1] * v * W * s, y0 + d[1] * u * L * s + d[0] * v * W * s];
    };
    const ovalPath = (c, f, skew = 0) => {
      c.moveTo(...f(0, 0));
      c.bezierCurveTo(...f(0.05, 0.6 + skew), ...f(0.6, 0.62), ...f(1, 0));
      c.bezierCurveTo(...f(0.6, -0.62), ...f(0.05, -0.6 + skew), ...f(0, 0));
    };
    const halfPath = (c, f, skew = 0) => {
      c.moveTo(...f(0, 0));
      c.bezierCurveTo(...f(0.05, 0.6 + skew), ...f(0.6, 0.62), ...f(1, 0));
      c.closePath();
    };
    // Same path on both canvases: data colour on one, white coverage on the other
    const fill = (path, rgb) => {
      for (const [c, style] of [[col, rgb], [cov, '#fff']]) {
        c.beginPath();
        path(c);
        c.fillStyle = style;
        c.fill();
      }
    };
    const stroke = (pts, w0, w1, rgb) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const w = Math.max(0.8, lerp(w0, w1, i / (pts.length - 1)) * s);
        for (const [c, style] of [[col, rgb], [cov, '#fff']]) {
          c.beginPath();
          c.moveTo(X(pts[i]), Y(pts[i]));
          c.lineTo(X(pts[i + 1]), Y(pts[i + 1]));
          c.lineWidth = w;
          c.strokeStyle = style;
          c.stroke();
        }
      }
    };
    const leafRGB = (t) => {
      // brighter towards the sunlit outer end of the spray, a few darker or older leaves
      const r = Math.min(255, Math.round(255 * R(0.6, 0.9) * (0.8 + 0.2 * t)));
      return [r, Math.round(255 * rng())];
    };
    const rgb = (r, g, bl = 0) => `rgb(${r}, ${g}, ${bl})`;

    for (const q of prims) {
      if (q.type === 'twig') stroke(q.pts, q.w0, q.w1, rgb(110, 128, 255));
      else if (q.type === 'stalk') stroke(q.pts || [q.a, q.b], q.w, q.w * 0.7, rgb(120, 128, 150));
      else if (q.type === 'oval') {
        const [r, g] = leafRGB(q.t);
        const f = frame(q.p, q.a, q.len, q.len * q.wid);
        fill((c) => ovalPath(c, f, q.skew || 0), rgb(r, g));
        if (q.len * s > 9) {
          // one half of the blade a little darker (folded along the midrib) and the midrib itself
          col.beginPath();
          halfPath(col, f, q.skew || 0);
          col.fillStyle = rgb(Math.round(r * 0.84), g);
          col.fill();
        }
      } else if (q.type === 'palmate') {
        // Five pointed lobes radiating from the blade centre: main, two side & two small basal ones
        const [r, g] = leafRGB(q.t);
        const L = q.len;
        const cP = [q.p[0] + Math.sin(q.a) * L * 0.22, q.p[1] + Math.cos(q.a) * L * 0.22];
        const lobes = [[0, 0.78, 0.36], [0.85, 0.62, 0.34], [-0.85, 0.62, 0.34], [1.65, 0.34, 0.36], [-1.65, 0.34, 0.36]];
        lobes.forEach(([da, ll, ww], li) => {
          const f = frame(cP, q.a + da + R(-0.08, 0.08), L * ll, L * ll * ww);
          const shade = li === 0 ? 1 : (da > 0 ? 0.88 : 0.95);
          fill((c) => ovalPath(c, f), rgb(Math.round(r * shade), g));
        });
        fill((c) => c.arc(X(cP), Y(cP), L * 0.24 * s, 0, Math.PI * 2), rgb(Math.round(r * 0.96), g));
      }
    }
  });

  // Colour data + coverage -> level 0, then a mip chain whose alpha keeps each tile's coverage
  const data = col.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data;
  const mask = cov.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data;
  const level0 = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  for (let i = 0; i < level0.length; i += 4) {
    level0[i] = data[i];
    level0[i + 1] = data[i + 1];
    level0[i + 2] = data[i + 2];
    level0[i + 3] = mask[i + 3];
  }
  const tex = new THREE.DataTexture(level0, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = coverageMips(level0, ATLAS_SIZE, 2);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.name = 'TreeLeafAtlas';
  return { texture: tex, tileMeters };
}

// Box-filtered mip chain whose alpha is rescaled per tile so the share of texels above the alpha-test cutoff stays as
// it is at level 0 (otherwise alpha-tested foliage thins out and vanishes at distance)
function coverageMips(level0, size, tiles, cutoff = 128) {
  const levels = [{ data: level0, width: size, height: size }];
  const target = [];
  const tilePx = size / tiles;
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      let n = 0;
      for (let y = ty * tilePx; y < (ty + 1) * tilePx; y++) {
        for (let x = tx * tilePx; x < (tx + 1) * tilePx; x++) if (level0[(y * size + x) * 4 + 3] >= cutoff) n++;
      }
      target.push(n / (tilePx * tilePx));
    }
  }
  const meanTarget = target.reduce((a, b) => a + b, 0) / target.length;
  let src = level0;
  let w = size;
  const hist = new Uint32Array(256);
  while (w > 1) {
    const h = w >> 1;
    const dst = new Uint8Array(h * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < h; x++) {
        const i0 = ((2 * y) * w + 2 * x) * 4;
        const i1 = i0 + w * 4;
        const o = (y * h + x) * 4;
        for (let c = 0; c < 4; c++) dst[o + c] = (src[i0 + c] + src[i0 + 4 + c] + src[i1 + c] + src[i1 + 4 + c] + 2) >> 2;
      }
    }
    const nt = h >= tiles ? tiles : 1;
    const tp = h / nt;
    for (let ty = 0; ty < nt; ty++) {
      for (let tx = 0; tx < nt; tx++) {
        const want = (nt === tiles ? target[ty * tiles + tx] : meanTarget) * tp * tp;
        hist.fill(0);
        for (let y = ty * tp; y < (ty + 1) * tp; y++) for (let x = tx * tp; x < (tx + 1) * tp; x++) hist[dst[(y * h + x) * 4 + 3]]++;
        let acc = 0;
        let aStar = 255;
        for (let a = 255; a >= 1; a--) {
          acc += hist[a];
          if (acc >= want) {
            aStar = a;
            break;
          }
        }
        const scale = cutoff / Math.max(aStar, 1);
        if (Math.abs(scale - 1) < 0.01) continue;
        for (let y = ty * tp; y < (ty + 1) * tp; y++) {
          for (let x = tx * tp; x < (tx + 1) * tp; x++) {
            const i = (y * h + x) * 4 + 3;
            dst[i] = Math.min(255, Math.round(dst[i] * scale));
          }
        }
      }
    }
    levels.push({ data: dst, width: h, height: h });
    src = dst;
    w = h;
  }
  return levels;
}

// =====================================================================================================================
// 2. SPECIES: trunk / leader (radius, top, lean), scaffold limbs (count, heights up the leader, tilt off vertical and
//    length blended from the lowest to the highest limb), branches & twigs (count, span along the parent, angle off it,
//    length as a share of the parent or in metres), bending per metre (up: toward the sky, out: away from the trunk,
//    droop: down, growing toward the tips), leaf cards per twig (scale, droop) and the per-tree foliage tints (sRGB).
//    Scale 1 is a mature park tree; street trees are planted smaller.
// =====================================================================================================================
const SPECIES = [
  { // 0: London plane: tall clear trunk and leader with heavy ascending limbs, a broad rounded crown of big leaves
    name: 'plane', tile: 0,
    trunk: { r: 0.3, top: 8.6, lean: 0.04, segs: 8 },
    limbs: { n: 6, y: [3.4, 7.4], tilt: [1.0, 0.36], len: [4.6, 2.8], r: 0.62, up: 0.07, out: 0, droop: 0, jitter: 0.07, segs: 6 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.55, 0.95], len: [0.62, 0.42], up: 0.06, out: 0.02, droop: 0, jitter: 0.1, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.6, 1.05], len: [1.15, 0.75], up: 0.02, out: 0, droop: 0.04, jitter: 0.12, segs: 2 },
    cards: { perTwig: 2, scale: [0.85, 1.1], droop: 0.05 },
    tints: [0x4b6a29, 0x5a7a2f, 0x3f5e25]
  },
  { // 1: Honey locust: slim trunk forking into spreading, zigzag limbs, an open layered crown of feathery fronds
    name: 'locust', tile: 1,
    trunk: { r: 0.19, top: 5.4, lean: 0.07, segs: 7 },
    limbs: { n: 5, y: [2.6, 5.0], tilt: [1.12, 0.55], len: [4.2, 2.8], r: 0.68, up: 0.04, out: 0, droop: 0, jitter: 0.16, segs: 6 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.6, 1.05], len: [0.6, 0.42], up: 0.03, out: 0.03, droop: 0.02, jitter: 0.16, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.55, 1.0], len: [1.0, 0.65], up: 0, out: 0, droop: 0.06, jitter: 0.14, segs: 2 },
    cards: { perTwig: 2, scale: [0.85, 1.1], droop: 0.1 },
    tints: [0x7b8c33, 0x8d9b3d, 0x6c7f2d]
  },
  { // 2: American elm: trunk forking low into upright limbs that arch outward, a tall vase with drooping twigs
    name: 'elm', tile: 2,
    trunk: { r: 0.28, top: 4.3, lean: 0.03, segs: 6 },
    limbs: { n: 5, y: [3.3, 4.1], tilt: [0.36, 0.22], len: [7.4, 7.0], r: 0.6, up: 0, out: 0.075, droop: 0, jitter: 0.06, segs: 7 },
    branches: { n: 5, t: [0.35, 1.0], angle: [0.5, 0.85], len: [0.44, 0.3], up: 0, out: 0.05, droop: 0.07, jitter: 0.1, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.5, 0.95], len: [1.3, 0.85], up: 0, out: 0, droop: 0.16, jitter: 0.12, segs: 2 },
    cards: { perTwig: 2, scale: [0.85, 1.1], droop: 0.4 },
    tints: [0x44622a, 0x53702e, 0x3a5724]
  }
];

// =====================================================================================================================
// 3. SKELETON
// =====================================================================================================================

// Unit vector `angle` off `dir`, turned `azimuth` round it
function deflect(dir, angle, azimuth) {
  const ref = Math.abs(dir.y) < 0.95 ? new V3(0, 1, 0) : new V3(1, 0, 0);
  const u = new V3().crossVectors(dir, ref).normalize();
  const w = new V3().crossVectors(dir, u);
  return dir.clone().multiplyScalar(Math.cos(angle))
    .addScaledVector(u, Math.sin(angle) * Math.cos(azimuth))
    .addScaledVector(w, Math.sin(angle) * Math.sin(azimuth))
    .normalize();
}

// A branch as a polyline from p0 along dir, len metres in segs steps (or at the given length fractions), bending per
// metre toward the sky (up), away from the trunk axis (out) and downward toward its tip (droop), with some wander
function growBranch(p0, dir, len, r0, r1, segs, bend, rng, level, schedule = null) {
  const ts = schedule || Array.from({ length: segs + 1 }, (_, i) => i / segs);
  const pts = [p0.clone()];
  const rad = [r0];
  const d = dir.clone();
  const p = p0.clone();
  const out = new V3();
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i];
    const step = (t - ts[i - 1]) * len;
    out.set(p.x, 0, p.z);
    if (out.lengthSq() > 1e-6) out.normalize();
    d.x += out.x * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.y += (bend.up - bend.droop * t * 2.0) * step + (rng() - 0.5) * bend.jitter * 0.6;
    d.z += out.z * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
    rad.push(r0 + (r1 - r0) * Math.pow(t, 0.8));
  }
  return { pts, rad, len, level, ts };
}

// Point, direction & radius at length fraction t of a branch
function along(b, t) {
  const ts = b.ts;
  let i = 0;
  while (i < ts.length - 2 && ts[i + 1] < t) i++;
  const k = Math.min(1, Math.max(0, (t - ts[i]) / (ts[i + 1] - ts[i])));
  return {
    p: b.pts[i].clone().lerp(b.pts[i + 1], k),
    d: b.pts[i + 1].clone().sub(b.pts[i]).normalize(),
    r: lerp(b.rad[i], b.rad[i + 1], k)
  };
}

function growTree(sp, seed) {
  const rng = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rng();
  const branches = [];
  const still = { up: 0, out: 0, droop: 0, jitter: 0.025 };

  // Trunk & leader: leaning a little, flaring at the root (dense rings at the base), tapering to a slim top
  const T = sp.trunk;
  const lean = R(0, Math.PI * 2);
  const trunkDir = new V3(Math.cos(lean) * T.lean, 1, Math.sin(lean) * T.lean).normalize();
  const schedule = [0, 0.03, 0.08];
  for (let i = 1; i <= T.segs; i++) schedule.push(0.08 + (0.92 * i) / T.segs);
  const trunk = growBranch(new V3(0, 0, 0), trunkDir, T.top, T.r, T.r * 0.3, T.segs, still, rng, 0, schedule);
  trunk.rad = trunk.rad.map((r, i) => r * (1 + 0.75 * Math.exp(-(trunk.ts[i] * T.top) / 0.28)));
  branches.push(trunk);

  // Scaffold limbs spiralling up the leader by the golden angle; branches along each limb; twigs along each branch
  const L = sp.limbs;
  const B = sp.branches;
  const W = sp.twigs;
  let az = R(0, Math.PI * 2);
  for (let i = 0; i < L.n; i++) {
    const f = L.n > 1 ? i / (L.n - 1) : 0;
    const y = lerp(L.y[0], L.y[1], f) + R(-0.25, 0.25);
    const base = along(trunk, Math.min(0.98, y / T.top));
    az += 2.39996 + R(-0.35, 0.35);
    const tilt = lerp(L.tilt[0], L.tilt[1], f) + R(-0.08, 0.08);
    const dir = new V3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const len = lerp(L.len[0], L.len[1], f) * R(0.88, 1.1);
    const limb = growBranch(base.p, dir, len, base.r * L.r, 0.035, L.segs, L, rng, 1);
    branches.push(limb);

    const nb = B.n + (rng() < 0.5 ? 1 : 0);
    let baz = R(0, Math.PI * 2);
    for (let j = 0; j < nb; j++) {
      const bt = lerp(B.t[0], B.t[1], (j + R(0.15, 0.85)) / nb);
      const a = along(limb, bt);
      baz += 2.39996 + R(-0.4, 0.4);
      const bdir = deflect(a.d, R(B.angle[0], B.angle[1]), baz);
      const outw = new V3(a.p.x, 0, a.p.z).normalize();
      if (bdir.dot(outw) < -0.15) bdir.addScaledVector(outw, 0.7).normalize(); // keep out of the crown core
      const blen = len * lerp(B.len[0], B.len[1], bt) * R(0.85, 1.12);
      const br = growBranch(a.p, bdir, blen, Math.max(0.022, a.r * 0.62), 0.014, B.segs, B, rng, 2);
      br.parentT = bt;
      branches.push(br);

      const nw = W.n + (rng() < 0.4 ? 1 : 0);
      let taz = R(0, Math.PI * 2);
      for (let k = 0; k < nw; k++) {
        const tt = lerp(W.t[0], W.t[1], (k + R(0.2, 0.8)) / nw);
        const ta = along(br, tt);
        taz += 2.39996 + R(-0.5, 0.5);
        const tdir = deflect(ta.d, R(W.angle[0], W.angle[1]), taz);
        const tw = growBranch(ta.p, tdir, lerp(W.len[0], W.len[1], tt) * R(0.8, 1.2), Math.max(0.012, ta.r * 0.7), 0.006, W.segs, W, rng, 3);
        tw.parentT = tt;
        branches.push(tw);
      }
    }
  }
  return branches;
}

// =====================================================================================================================
// 4. GEOMETRY: bark tubes & leaf cards of one species / variant at one level of detail
// =====================================================================================================================
class TreeGeometryBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.attr = [];
    this.idx = [];
  }

  vertex(p, n, u, v, leaf, ao, sway, rnd) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.attr.push(leaf, ao, sway, rnd);
    return this.pos.length / 3 - 1;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(this.attr, 4));
    const vCount = this.pos.length / 3;
    g.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Tapered tube along a branch with parallel-transported rings (every `stride`-th skeleton point); uv in metres
function addTube(gb, b, radial, stride, aoAt, swayAt) {
  const n = b.pts.length;
  const keep = [];
  for (let i = 0; i < n; i += stride) keep.push(i);
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
  const tangent = (i) => {
    const a = b.pts[Math.max(0, i - 1)];
    const c = b.pts[Math.min(n - 1, i + 1)];
    return c.clone().sub(a).normalize();
  };
  let T = tangent(keep[0]);
  let N = Math.abs(T.y) < 0.9 ? new V3(0, 1, 0).cross(T).normalize() : new V3(1, 0, 0).cross(T).normalize();
  const q = new THREE.Quaternion();
  const around = 2 * Math.PI * Math.max(b.rad[0], 0.02);
  let vLen = 0;
  const base = gb.pos.length / 3;
  const dir = new V3();
  const p = new V3();
  keep.forEach((i, ki) => {
    if (ki > 0) {
      const T2 = tangent(i);
      q.setFromUnitVectors(T, T2);
      N.applyQuaternion(q).normalize();
      T = T2;
      vLen += b.pts[i].distanceTo(b.pts[keep[ki - 1]]);
    }
    const Bn = new V3().crossVectors(T, N);
    const t = b.ts[i];
    const ao = aoAt(b.pts[i]);
    const sway = swayAt(b, t);
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      dir.copy(N).multiplyScalar(Math.cos(ang)).addScaledVector(Bn, Math.sin(ang));
      p.copy(b.pts[i]).addScaledVector(dir, b.rad[i]);
      gb.vertex(p, dir, (j / radial) * around, vLen, 0, ao, sway, 0);
    }
  });
  // Rings run counter-clockwise round the tangent, so (a, a + 1, c) is counter-clockwise seen from outside: the front
  // faces point out along the normals (the material drops the bark's back faces)
  for (let k = 0; k < keep.length - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const a = base + k * (radial + 1) + j;
      const c = a + radial + 1;
      gb.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
}

// Leaf card: bottom edge centred on `at`, rising along `up`, facing `face`; uv over atlas tile `tile` (mirrored or not)
function addCard(gb, at, up, face, size, tile, mirror, rnd, crown) {
  const side = new V3().crossVectors(up, face).normalize();
  const nrm = new V3().crossVectors(side, up).normalize();
  const [ox, oy] = tileOrigin(tile);
  let u0 = (ox + GUTTER) / ATLAS_SIZE;
  let u1 = (ox + TILE - GUTTER) / ATLAS_SIZE;
  if (mirror) [u0, u1] = [u1, u0];
  const vTop = (oy + GUTTER) / ATLAS_SIZE;
  const vBot = (oy + TILE - GUTTER) / ATLAS_SIZE;
  const corners = [
    [-0.5, 0, u0, vBot],
    [0.5, 0, u1, vBot],
    [0.5, 1, u1, vTop],
    [-0.5, 1, u0, vTop]
  ];
  const base = gb.pos.length / 3;
  const p = new V3();
  for (const [sx, sy, u, v] of corners) {
    p.copy(at).addScaledVector(side, sx * size).addScaledVector(up, sy * size);
    const { n, ao } = crown.shade(p, nrm);
    gb.vertex(p, n, u, v, 1, ao, lerp(0.8, 1.0, sy), rnd);
  }
  gb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Crown ellipsoid (from the foliage) for shell normals & interior occlusion
function makeCrown(points) {
  const box = new THREE.Box3().setFromPoints(points);
  const C = box.getCenter(new V3());
  const Rr = box.getSize(new V3()).multiplyScalar(0.5).max(new V3(0.5, 0.5, 0.5));
  const tmp = new V3();
  const sn = new V3();
  return {
    C,
    R: Rr,
    bottom: box.min.y,
    // Shell normal (out from the centre, a little skyward) blended with the card face (turned to agree with it)
    shade(p, face) {
      tmp.copy(p).sub(C).divide(Rr);
      const e = tmp.length();
      sn.copy(tmp).normalize();
      sn.y += 0.22;
      sn.normalize();
      const f = face.dot(sn) < 0 ? face.clone().negate() : face.clone();
      const n = sn.clone().multiplyScalar(0.72).addScaledVector(f, 0.28).normalize();
      const top = Math.min(1, Math.max(-1, (p.y - C.y) / Rr.y));
      const ao = (0.22 + 0.78 * smooth(0.15, 1.0, e)) * (0.86 + 0.14 * top);
      return { n, ao };
    },
    // Bark: open below the crown, darker the deeper inside it
    barkAO(p) {
      if (p.y < box.min.y) return 0.9;
      tmp.copy(p).sub(C).divide(Rr);
      return lerp(0.32, 0.8, smooth(0.2, 1.0, tmp.length()));
    }
  };
}

// Sway weight along the hierarchy: 0 on the trunk (whole-tree bend is height based), rising to 1 at the twig tips
function swayWeight(b, t) {
  switch (b.level) {
    case 0: return 0;
    case 1: return 0.18 * t;
    case 2: return 0.18 + 0.4 * t;
    default: return 0.58 + 0.4 * t;
  }
}

// Leaf cards of one tree: lod 0 on every twig, lod 1 fewer & larger along the branches, lod 2 a shell of whole-crown
// cards (far-canopy tile) round the crown ellipsoid
function placeCards(sp, branches, lod, tileMeters, rng, crown) {
  const R = (a, b) => a + (b - a) * rng();
  const cards = [];
  const outward = (p) => new V3(p.x - crown.C.x, (p.y - crown.C.y) * 0.6, p.z - crown.C.z).normalize();
  const orient = (p, d, droop) => {
    const o = outward(p);
    const up = d.clone().multiplyScalar(0.55).addScaledVector(o, 0.45)
      .add(new V3(R(-0.3, 0.3), R(-0.2, 0.3), R(-0.3, 0.3)));
    up.y -= droop;
    up.normalize();
    let face = o.clone().add(new V3(R(-0.9, 0.9), R(-0.6, 0.9), R(-0.9, 0.9))).normalize();
    face.addScaledVector(up, -face.dot(up));
    if (face.lengthSq() < 1e-4) face = new V3(0, 1, 0).cross(up);
    return { up, face: face.normalize() };
  };
  const size = tileMeters[sp.tile];
  if (lod === 0) {
    for (const b of branches) {
      if (b.level !== 3) continue;
      const n = sp.cards.perTwig;
      for (let k = 0; k < n; k++) {
        const t = lerp(0.4, 1.0, (k + R(0.3, 0.9)) / n);
        const a = along(b, t);
        const { up, face } = orient(a.p, a.d, sp.cards.droop);
        cards.push({ at: a.p, up, face, size: size * R(sp.cards.scale[0], sp.cards.scale[1]), tile: sp.tile });
      }
    }
    // a card at the end of every branch fills the gap between its twigs
    for (const b of branches) {
      if (b.level !== 2) continue;
      const a = along(b, 1);
      const { up, face } = orient(a.p, a.d, sp.cards.droop);
      cards.push({ at: a.p, up, face, size: size * R(0.9, 1.1), tile: sp.tile });
    }
  } else if (lod === 1) {
    for (const b of branches) {
      if (b.level !== 2) continue;
      for (const t of [0.42, 0.72, 1.0]) {
        const a = along(b, Math.min(1, t + R(-0.06, 0.04)));
        const { up, face } = orient(a.p, a.d, sp.cards.droop);
        const at = a.p.clone().addScaledVector(outward(a.p), 0.35);
        cards.push({ at, up, face, size: size * R(1.35, 1.6), tile: sp.tile });
      }
    }
  } else {
    // Fibonacci directions over the crown, fewer underneath; cards centred just inside the shell, facing out
    const n = 18;
    const meanR = (crown.R.x + crown.R.y + crown.R.z) / 3;
    const s = Math.max(meanR * 1.25, 2.4);
    for (let i = 0; i < n; i++) {
      const y = 1 - (i + 0.5) / n * 1.55; // 1 .. -0.55
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ph = i * 2.39996 + R(-0.2, 0.2);
      const dir = new V3(Math.cos(ph) * r, y, Math.sin(ph) * r);
      const center = crown.C.clone().add(dir.clone().multiply(crown.R).multiplyScalar(0.58));
      const face = dir.clone().add(new V3(R(-0.25, 0.25), R(-0.25, 0.25), R(-0.25, 0.25))).normalize();
      let up = new V3(0, 1, 0).addScaledVector(face, -face.y);
      if (up.lengthSq() < 1e-3) up = new V3(1, 0, 0);
      up.normalize().applyAxisAngle(face, R(-0.5, 0.5));
      const at = center.clone().addScaledVector(up, -s * 0.5);
      cards.push({ at, up, face, size: s, tile: TILE_FAR });
    }
  }
  return cards;
}

// One species / variant: [lod0, lod1, lod2] geometries (lod 2 only for variant 0)
function buildTreeGeometries(speciesIndex, variant, tileMeters) {
  const sp = SPECIES[speciesIndex];
  const seed = 7919 * (speciesIndex + 1) + 104729 * (variant + 1);
  const branches = growTree(sp, seed);

  // Crown from the full-detail foliage: card anchors pushed out by half a card
  const rngC = mulberry32(seed ^ 0x5bd1e995);
  const tips = [];
  for (const b of branches) if (b.level === 3) tips.push(b.pts[b.pts.length - 1]);
  const roughCrown = makeCrown(tips);
  const cards0 = placeCards(sp, branches, 0, tileMeters, rngC, roughCrown);
  const pts = [];
  for (const c of cards0) {
    pts.push(c.at.clone().addScaledVector(c.up, c.size * 0.5));
    pts.push(c.at.clone().addScaledVector(c.up, c.size));
  }
  const crown = makeCrown(pts);

  const geos = [];
  const levels = variant === 0 ? [0, 1, 2] : [0, 1];
  for (const lod of levels) {
    const gb = new TreeGeometryBuilder();
    const rng = mulberry32(seed + lod * 31337);
    const aoAt = (p) => crown.barkAO(p);
    // Bark: lod 0 everything, lod 1 trunk + limbs + branches (coarser), lod 2 trunk + limbs as thin prisms
    for (const b of branches) {
      if (lod === 0) {
        const radial = [9, 6, 4, 3][b.level];
        addTube(gb, b, radial, 1, aoAt, swayWeight);
      } else if (lod === 1 && b.level <= 2) {
        addTube(gb, b, [6, 5, 3][b.level], 2, aoAt, swayWeight);
      } else if (lod === 2 && b.level <= 1) {
        addTube(gb, b, b.level === 0 ? 5 : 3, b.level === 0 ? 4 : 6, aoAt, swayWeight);
      }
    }
    const cards = lod === 0 ? cards0 : placeCards(sp, branches, lod, tileMeters, rng, crown);
    for (const c of cards) addCard(gb, c.at, c.up, c.face, c.size, c.tile, rng() < 0.5, rng(), crown);
    const g = gb.build();
    g.userData = { species: sp.name, variant, lod, cards: cards.length, triangles: gb.idx.length / 3 };
    geos[lod] = g;
  }
  return geos;
}

// =====================================================================================================================
// 5. TREE FIELD: per-tree level of detail, regrouped into one instanced mesh per species / variant / level
// =====================================================================================================================
const LOD_NEAR = 105; // full detail within (m)
const LOD_MID = 420; // coarse cards & branches within; whole-crown cards beyond
const LOD_HYSTERESIS = 6;
// Draw distance per tier (0 park & plaza, 1 avenue & esplanade, 2 cross-street); at street level everything beyond
// LOW_CUTOFF is behind the buildings anyway
const MAX_DIST = [3000, 1600, 950];
const LOW_CUTOFF = 1150;

function hashPos(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Builds the instanced tree field for `sites` ({ x, y, z, scale, species, yaw?, sx?, sz?, tier? }) and keeps each
 * tree's level of detail up to date from the camera of every view pass (scene.onBeforeRender). Returns
 * { group, material, atlas, update(cameraPosition) }.
 */
function createTreeField(scene, sites) {
  const group = new THREE.Group();
  group.name = 'Trees';
  const atlas = createLeafAtlas();
  const material = createTreeMaterial(atlas.texture);

  // Geometries: [species][variant][lod]
  const geos = SPECIES.map((_, s) => [0, 1].map((v) => buildTreeGeometries(s, v, atlas.tileMeters)));

  // Per-tree transform & data
  const N = sites.length;
  const mats = new Float32Array(N * 16);
  const data = new Float32Array(N * 4);
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const pz = new Float32Array(N);
  const meshOf = new Int16Array(N * 3); // mesh index per level
  const tier = new Uint8Array(N);
  const lod = new Uint8Array(N).fill(255);

  // Meshes: lod 0 & 1 per species & variant, lod 2 per species
  const meshes = [];
  const counts = [];
  const makeMesh = (geo, name) => {
    meshes.push({ geo, name, capacity: 0 });
    return meshes.length - 1;
  };
  const meshIndex = SPECIES.map((sp, s) => ({
    l0: [0, 1].map((v) => makeMesh(geos[s][v][0], `Trees_${sp.name}_v${v}_lod0`)),
    l1: [0, 1].map((v) => makeMesh(geos[s][v][1], `Trees_${sp.name}_v${v}_lod1`)),
    l2: makeMesh(geos[s][0][2], `Trees_${sp.name}_lod2`)
  }));

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  sites.forEach((t, i) => {
    const sp = Math.min(SPECIES.length - 1, Math.max(0, t.species || 0));
    const r1 = hashPos(t.x, 1.3, t.z);
    const r2 = hashPos(t.z, 7.1, t.x);
    const r3 = hashPos(t.x + t.z, 3.3, 0.7);
    const variant = hashPos(t.x, 5.9, t.z) < 0.5 ? 0 : 1;
    const s = t.scale * (0.9 + r1 * 0.2);
    dummy.position.set(t.x, t.y || 0, t.z);
    dummy.rotation.set(0, t.yaw ?? r2 * Math.PI * 2, 0);
    dummy.scale.set(s * (0.9 + r3 * 0.2) * (t.sx || 1), s * (0.88 + r1 * 0.24), s * (0.9 + r2 * 0.2) * (t.sz || 1));
    dummy.updateMatrix();
    dummy.matrix.toArray(mats, i * 16);
    tint.setHex(SPECIES[sp].tints[Math.floor(r3 * 2.999)]).multiplyScalar(0.82 + r1 * 0.36);
    data.set([tint.r, tint.g, tint.b, sp + r2 * 0.999], i * 4);
    px[i] = t.x;
    py[i] = (t.y || 0) + 6 * s;
    pz[i] = t.z;
    tier[i] = Math.min(2, t.tier || 0);
    const mi = meshIndex[sp];
    meshOf[i * 3] = mi.l0[variant];
    meshOf[i * 3 + 1] = mi.l1[variant];
    meshOf[i * 3 + 2] = mi.l2;
    for (let l = 0; l < 3; l++) meshes[meshOf[i * 3 + l]].capacity++;
  });

  const instanced = meshes.map((m) => {
    const geo = new THREE.BufferGeometry();
    for (const name of Object.keys(m.geo.attributes)) geo.setAttribute(name, m.geo.attributes[name]);
    geo.setIndex(m.geo.index);
    geo.boundingSphere = m.geo.boundingSphere;
    const cap = Math.max(1, m.capacity);
    // Static usage on purpose: three.js re-uploads a DynamicDrawUsage attribute in every render pass of every frame
    // (both shadow cascades + the scene pass, ~7 MB/frame here). rebuild() uploads just the instances in use, and only
    // when the levels change.
    const treeData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geo.setAttribute('aTreeData', treeData);
    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.name = m.name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false; // instances surround the camera: the per-tree levels do the culling
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    counts.push(0);
    return mesh;
  });

  // Regroup every visible tree into the mesh of its level
  function rebuild() {
    counts.fill(0);
    for (let i = 0; i < N; i++) {
      const l = lod[i];
      if (l === 255) continue;
      const mi = meshOf[i * 3 + l];
      const mesh = instanced[mi];
      const c = counts[mi]++;
      mesh.instanceMatrix.array.set(mats.subarray(i * 16, i * 16 + 16), c * 16);
      mesh.geometry.attributes.aTreeData.array.set(data.subarray(i * 4, i * 4 + 4), c * 4);
    }
    instanced.forEach((mesh, mi) => {
      const n = counts[mi];
      if (n > 0) {
        // upload only the instances in use (main.js swaps instanceMatrix for a storage attribute: look it up here)
        for (const attr of [mesh.instanceMatrix, mesh.geometry.attributes.aTreeData]) {
          attr.clearUpdateRanges();
          attr.addUpdateRange(0, n * attr.itemSize);
          attr.needsUpdate = true;
        }
      }
      mesh.count = n;
      mesh.visible = n > 0;
    });
  }

  // Levels from the camera position (3D distance to mid-crown), with hysteresis at every boundary
  const last = new V3(Infinity, Infinity, Infinity);
  const cam = new V3();
  function update(position) {
    cam.copy(position);
    if (cam.distanceToSquared(last) < 16) return false;
    last.copy(cam);
    const low = cam.y < 40;
    let changed = false;
    for (let i = 0; i < N; i++) {
      const dx = px[i] - cam.x;
      const dy = py[i] - cam.y;
      const dz = pz[i] - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const maxD = low ? Math.min(MAX_DIST[tier[i]], LOW_CUTOFF) : MAX_DIST[tier[i]];
      // levels 0-2, 3 = hidden; next to a boundary a tree keeps the level it has
      const curL = lod[i] === 255 ? 3 : lod[i];
      let nextL = d < LOD_NEAR ? 0 : d < LOD_MID ? 1 : d < maxD ? 2 : 3;
      if (Math.abs(nextL - curL) === 1) {
        const edge = [LOD_NEAR, LOD_MID, maxD][Math.min(nextL, curL)];
        if (Math.abs(d - edge) < LOD_HYSTERESIS) nextL = curL;
      }
      const next = nextL === 3 ? 255 : nextL;
      if (next !== lod[i]) {
        lod[i] = next;
        changed = true;
      }
    }
    if (changed) rebuild();
    return changed;
  }

  // Follow the view camera of every scene render (shadow cascades are orthographic and keep the view's levels)
  const viewPos = new V3();
  const prevBeforeRender = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, scn, camera, target) {
    prevBeforeRender.call(this, renderer, scn, camera, target);
    if (camera.isOrthographicCamera === true || camera.isArrayCamera === true) return;
    update(viewPos.setFromMatrixPosition(camera.matrixWorld));
  };

  // Levels for the start-up view (Midtown, 5th Ave), so the precompile pass sees the tree meshes
  update(new V3(0, 10, 140));

  const stats = {
    trees: N,
    triangles: geos.map((v) => v.map((l) => l.map((g) => g && g.userData.triangles))),
    cards: geos.map((v) => v.map((l) => l.map((g) => g && g.userData.cards)))
  };
  return { group, material, atlas, update, meshes: instanced, stats };
}

Object.assign(window.NYC, { createTreeField, createLeafAtlas, buildTreeGeometries, TREE_SPECIES: SPECIES });
})();
