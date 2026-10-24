(function () {
// js/boroughs.js
// The rest of New York City around the simulated Manhattan grid, at true 1:1 scale on the real geography (1 unit = 1 m,
// x = Manhattan-grid east, z = grid south, origin at 5th Ave & 42nd St), built to read as real places from the street,
// the waterfront, the helicopter and the Empire State observatory while staying cheap at 60 FPS:
// - Land masses from the real shorelines (New Jersey, Brooklyn, Queens, Upper Manhattan, the Bronx, Staten Island and the
//   horizon fillers beyond the city line; Randall's, Roosevelt, Governors, Liberty, Ellis & Mill Rock islands) with
//   granite bulkheads
// - The Palisades cliffs (Fort Lee -> Weehawken) fading into Jersey City Heights and Bayonne as a heightfield ridge that
//   follows the real New Jersey shore
// - A procedural "city carpet" ground shader: per-neighbourhood street grids (a baked zone map), sidewalks, roofs,
//   backyard trees, parks, cemeteries, rail/port yards and marsh from a land-use map, sodium street-light grids at night
// - ~100k instanced borough buildings (one cheap window-grid shader, lit windows at night) on the same grids, plus the
//   real skyline clusters (Jersey City, Long Island City, Downtown Brooklyn, Williamsburg, Fort Lee)
// - Harbor islands (Roosevelt Island + tram, Governors Island forts & hills, Randall's fields, Statue of Liberty,
//   Ellis Island) and the four East River bridges with their distinct structures and necklace lights
// - The George Washington and Verrazzano-Narrows bridges as distant skyline landmarks

const { THREE } = window.NYC;
const {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  color,
  attribute,
  texture,
  positionWorld,
  positionGeometry,
  normalGeometry,
  normalWorld,
  sin,
  abs,
  floor,
  fract,
  max,
  min,
  clamp,
  mix,
  step,
  smoothstep,
  dot,
  fwidth,
  select,
  uniform
} = window.NYC.TSL;
const {
  cityUniforms,
  MANHATTAN_COASTLINE,
  NJ_SHORELINE_POLYGON,
  LONG_ISLAND_POLYGONS,
  BROOKLYN_POLYGONS,
  QUEENS_POLYGONS,
  BRONX_POLYGONS,
  UPPER_MANHATTAN_POLYGON,
  BRONX_POLYGON,
  STATEN_ISLAND_POLYGON,
  WESTCHESTER_POLYGON,
  NASSAU_POLYGON,
  RANDALLS_ISLAND_POLYGON,
  LIBERTY_ISLAND_POLYGON,
  LIBERTY_STATUE_POS,
  ELLIS_ISLAND_POLYGON,
  ROOSEVELT_ISLAND_POLYGON,
  GOVERNORS_ISLAND_POLYGON,
  MILL_ROCK_POLYGON,
  EAST_RIVER_BRIDGES,
  OUTER_BRIDGES,
  streetZ
} = window.NYC;

// =====================================================================================================================
// 0. REAL PLACES
// Hand-placed geography (land use, neighbourhood grids, high-rise clusters, signature towers, landmarks) is written in
// real longitude / latitude: LL() maps it into the world frame exactly (the frame is an affine image of the local
// tangent plane at 5th Ave & 42nd St, turned 29.02° with the street grid; constants from tools/geo-base.mjs toWorld).
// =====================================================================================================================
function LL(lon, lat) {
  const dl = lon + 73.98185;
  const dp = lat - 40.75318;
  return { x: -54.351 + 73845.537 * dl - 53872.251 * dp, z: 69.424 - 40967.61 * dl - 97106.601 * dp };
}
const LLs = (pairs) => pairs.map(([lon, lat]) => LL(lon, lat));

// =====================================================================================================================
// 1. GEOMETRY HELPERS & LAND MASSES
// =====================================================================================================================

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Colour constants in this file are authored as sRGB swatches (like the hex colours elsewhere) and converted to the
// linear values the shaders and lighting work in
const toLinear = (c) => Math.pow(c, 2.2);
const srgb = (r, g, b) => vec3(toLinear(r), toLinear(g), toLinear(b));
// The same as a uniform: materials that differ only by such values share one shader
const srgbUniform = (r, g, b) => uniform(new THREE.Vector3(toLinear(r), toLinear(g), toLinear(b)));

function pointInPolygon(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function polygonBounds(pts) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minZ = Math.min(b.minZ, p.z);
    b.maxZ = Math.max(b.maxZ, p.z);
  }
  return b;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

// Distance from (x, z) to the nearest edge of a small polygon (edges farther than maxReach on either axis are skipped)
function distToPolygonEdges(pts, x, z, maxReach = Infinity) {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (Math.min(a.x, b.x) - maxReach > x || Math.max(a.x, b.x) + maxReach < x) continue;
    if (Math.min(a.z, b.z) - maxReach > z || Math.max(a.z, b.z) + maxReach < z) continue;
    best = Math.min(best, distToSegment(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

// Douglas-Peucker simplification of a closed ring (tolerance eps, m)
function simplifyRing(pts, eps) {
  const n = pts.length;
  if (n < 8) return pts.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].z - pts[0].z);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const pa = pts[a];
    const pb = pts[b % n];
    let best = -1;
    let bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i].x, pts[i].z, pa.x, pa.z, pb.x, pb.z);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((p, i) => keep[i]);
}

// Spatial index of a big shoreline polygon (thousands of vertices): z-bands holding the edges that span them, for exact
// point-in-polygon tests and row crossings, and a hashed 128 m cell grid of its shore edges for distance queries. Edges
// longer than ARTIFICIAL_EDGE are the data's straight closures out to the horizon, not shore: they count for inside /
// outside only.
const ARTIFICIAL_EDGE = 2500;
const BAND = 64;
const CELL = 128;
const cellKey = (i, j) => (i + 4096) * 8192 + (j + 4096);

function indexPolygon(pts) {
  const n = pts.length;
  const b = polygonBounds(pts);
  const bands = Array.from({ length: Math.floor((b.maxZ - b.minZ) / BAND) + 1 }, () => []);
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const k1 = Math.floor((Math.max(p.z, q.z) - b.minZ) / BAND);
    for (let k = Math.floor((Math.min(p.z, q.z) - b.minZ) / BAND); k <= k1; k++) bands[k].push(i);
    if (Math.hypot(q.x - p.x, q.z - p.z) > ARTIFICIAL_EDGE) continue;
    const i1 = Math.floor(Math.max(p.x, q.x) / CELL);
    const j1 = Math.floor(Math.max(p.z, q.z) / CELL);
    for (let cj = Math.floor(Math.min(p.z, q.z) / CELL); cj <= j1; cj++) {
      for (let ci = Math.floor(Math.min(p.x, q.x) / CELL); ci <= i1; ci++) {
        const key = cellKey(ci, cj);
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(i);
      }
    }
  }
  return { pts, n, b, bands, cells, stamp: new Uint32Array(n), pass: 0 };
}

function insideIndexed(ix, x, z) {
  const { b, pts, n } = ix;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  let inside = false;
  for (const i of ix.bands[Math.floor((z - b.minZ) / BAND)]) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    if ((p.z > z) !== (q.z > z) && x < ((q.x - p.x) * (z - p.z)) / (q.z - p.z) + p.x) inside = !inside;
  }
  return inside;
}

// Sorted x of the polygon's edge crossings along the row z (inside spans: [xs[0], xs[1]], [xs[2], xs[3]] ...)
function rowCrossings(ix, z, out = []) {
  out.length = 0;
  const { b, pts, n } = ix;
  if (z <= b.minZ || z >= b.maxZ) return out;
  for (const i of ix.bands[Math.floor((z - b.minZ) / BAND)]) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    if ((p.z > z) !== (q.z > z)) out.push(p.x + ((z - p.z) / (q.z - p.z)) * (q.x - p.x));
  }
  return out.sort((a, c) => a - c);
}

// Distance from (x, z) to the polygon's shore edges (Infinity when none lies within `reach`)
function shoreDistIndexed(ix, x, z, reach) {
  const { pts, n } = ix;
  const pass = ++ix.pass;
  let best = Infinity;
  const i1 = Math.floor((x + reach) / CELL);
  const j1 = Math.floor((z + reach) / CELL);
  for (let cj = Math.floor((z - reach) / CELL); cj <= j1; cj++) {
    for (let ci = Math.floor((x - reach) / CELL); ci <= i1; ci++) {
      const list = ix.cells.get(cellKey(ci, cj));
      if (!list) continue;
      for (const i of list) {
        if (ix.stamp[i] === pass) continue;
        ix.stamp[i] = pass;
        const p = pts[i];
        const q = pts[(i + 1) % n];
        const d = distToSegment(x, z, p.x, p.z, q.x, q.z);
        if (d < best) best = d;
      }
    }
  }
  return best <= reach ? best : Infinity;
}

// Land masses (top heights in metres; the Manhattan road deck is y = 0, the harbor water y = -2.2). Several entries may
// share an id (Brooklyn & Queens are both 'li'); the first entry containing a point wins. 'minor' = the boroughs'
// smaller islands (the Rockaways, Jamaica Bay's marshes, Rikers, City Island...): open ground without generic blocks.
// The horizon fillers beyond the city line sit a little lower than the boroughs they overlap.
const LAND = [];
function addLand(id, pts, top, extra = {}) {
  if (!pts || pts.length < 3) return;
  LAND.push({ id, pts, top, bounds: polygonBounds(pts), index: indexPolygon(pts), ...extra });
}
const mainRing = (rings) => rings.reduce((a, r) => (r.length > a.length ? r : a), rings[0]);
addLand('nj', NJ_SHORELINE_POLYGON, 0.0, { borough: 'nj' });
addLand('li', LONG_ISLAND_POLYGONS[0], 0.0, { borough: 'brooklyn' });
addLand('li', LONG_ISLAND_POLYGONS[1], 0.0, { borough: 'queens' });
addLand('upper', UPPER_MANHATTAN_POLYGON, -0.02, { borough: 'upper' });
addLand('bronx', BRONX_POLYGON, 0.0, { borough: 'bronx' });
addLand('si', STATEN_ISLAND_POLYGON, 0.0, { borough: 'si' });
addLand('randalls', RANDALLS_ISLAND_POLYGON, 0.35);
addLand('roosevelt', ROOSEVELT_ISLAND_POLYGON, 0.3);
addLand('governors', GOVERNORS_ISLAND_POLYGON, 0.45);
addLand('liberty', LIBERTY_ISLAND_POLYGON, 0.6);
addLand('ellis', ELLIS_ISLAND_POLYGON, 0.6);
addLand('millrock', MILL_ROCK_POLYGON, 0.3);
for (const [rings, borough] of [[BROOKLYN_POLYGONS, 'brooklyn'], [QUEENS_POLYGONS, 'queens'], [BRONX_POLYGONS, 'bronx']]) {
  if (!rings || !rings.length) continue;
  const main = mainRing(rings);
  for (const r of rings) if (r !== main) addLand('minor', r, 0.0, { borough });
}
addLand('li', NASSAU_POLYGON, -0.4, { borough: 'queens', filler: true });
addLand('bronx', WESTCHESTER_POLYGON, -0.4, { borough: 'bronx', filler: true });
const landById = (id, borough) => LAND.find((l) => l.id === id && (!borough || l.borough === borough));
const NJ_LAND = landById('nj');
const BROOKLYN_LAND = landById('li', 'brooklyn');
const QUEENS_LAND = landById('li', 'queens');
const UPPER_LAND = landById('upper');

// Land-id raster (32 m cells over the region the camera can see): cells clear of every shoreline answer landAt() with
// one lookup, shoreline cells (255) fall back to the exact polygon tests
const LAND_GRID = (() => {
  const cell = 32;
  const minX = -16000;
  const minZ = -26000;
  const nx = 1125;
  const nz = 1750;
  const data = new Uint8Array(nx * nz);
  const xs = [];
  for (let k = LAND.length - 1; k >= 0; k--) {
    const b = LAND[k].bounds;
    const j0 = Math.max(0, Math.floor((b.minZ - minZ) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((b.maxZ - minZ) / cell));
    for (let j = j0; j <= j1; j++) {
      rowCrossings(LAND[k].index, minZ + (j + 0.5) * cell, xs);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const i0 = Math.max(0, Math.ceil((xs[s] - minX) / cell - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((xs[s + 1] - minX) / cell - 0.5));
        for (let i = i0; i <= i1; i++) data[j * nx + i] = k + 1;
      }
    }
  }
  const mark = (x, z) => {
    const i = Math.floor((x - minX) / cell);
    const j = Math.floor((z - minZ) / cell);
    if (i >= 0 && j >= 0 && i < nx && j < nz) data[j * nx + i] = 255;
  };
  const r = cell * 0.3;
  for (const land of LAND) {
    const pts = land.pts;
    for (let e = 0; e < pts.length; e++) {
      const p = pts[e];
      const q = pts[(e + 1) % pts.length];
      if (Math.max(p.x, q.x) < minX || Math.min(p.x, q.x) > minX + nx * cell) continue;
      if (Math.max(p.z, q.z) < minZ || Math.min(p.z, q.z) > minZ + nz * cell) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / (cell * 0.25)));
      for (let s = 0; s <= steps; s++) {
        const x = p.x + ((q.x - p.x) * s) / steps;
        const z = p.z + ((q.z - p.z) * s) / steps;
        mark(x - r, z - r);
        mark(x + r, z - r);
        mark(x - r, z + r);
        mark(x + r, z + r);
      }
    }
  }
  return { cell, minX, minZ, nx, nz, data };
})();

function landAt(x, z) {
  const g = LAND_GRID;
  const i = Math.floor((x - g.minX) / g.cell);
  const j = Math.floor((z - g.minZ) / g.cell);
  if (i >= 0 && j >= 0 && i < g.nx && j < g.nz) {
    const v = g.data[j * g.nx + i];
    if (v === 0) return null;
    if (v !== 255) return LAND[v - 1];
  }
  for (const land of LAND) if (insideIndexed(land.index, x, z)) return land;
  return null;
}

// Distance from (x, z) to a land mass's shore (Infinity beyond `reach`)
const shoreDist = (land, x, z, reach) => shoreDistIndexed(land.index, x, z, reach);

// The shoreline crossing of a land mass along row z nearest to x (where a waterfront landmark meets the water)
function shoreXNear(land, x, z) {
  const xs = rowCrossings(land.index, z);
  let best = x;
  let bestD = Infinity;
  for (const c of xs) {
    if (Math.abs(c - x) < bestD) {
      bestD = Math.abs(c - x);
      best = c;
    }
  }
  return best;
}

// Coarse distance to Manhattan's shoreline (the detailed island south of the cut), only for level-of-detail decisions:
// exact (to a 6 m simplification of the shore) within ~3 km of the island, bilinear from an 800 m grid beyond
const MANHATTAN_DIST_GRID = (() => {
  const cell = 100;
  const minX = -16000;
  const minZ = -26000;
  const nx = 361;
  const nz = 561;
  const shore = simplifyRing(MANHATTAN_COASTLINE, 6);
  const exact = (x, z) => distToPolygonEdges(shore, x, z);
  const k = 8;
  const cnx = Math.ceil((nx - 1) / k) + 1;
  const cnz = Math.ceil((nz - 1) / k) + 1;
  const coarse = new Float32Array(cnx * cnz);
  for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) coarse[j * cnx + i] = exact(minX + i * k * cell, minZ + j * k * cell);
  const data = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const fj = j / k;
    const j0 = Math.min(cnz - 2, Math.floor(fj));
    const tj = fj - j0;
    for (let i = 0; i < nx; i++) {
      const fi = i / k;
      const i0 = Math.min(cnx - 2, Math.floor(fi));
      const ti = fi - i0;
      const est = (coarse[j0 * cnx + i0] * (1 - ti) + coarse[j0 * cnx + i0 + 1] * ti) * (1 - tj) +
        (coarse[(j0 + 1) * cnx + i0] * (1 - ti) + coarse[(j0 + 1) * cnx + i0 + 1] * ti) * tj;
      // the field is 1-Lipschitz: an estimate this far out is within a half cell diagonal of the truth
      data[j * nx + i] = est > 3200 ? est : exact(minX + i * cell, minZ + j * cell);
    }
  }
  return { cell, minX, minZ, nx, nz, data };
})();

function distToManhattan(x, z) {
  const g = MANHATTAN_DIST_GRID;
  const fx = Math.max(0, Math.min(g.nx - 1.001, (x - g.minX) / g.cell));
  const fz = Math.max(0, Math.min(g.nz - 1.001, (z - g.minZ) / g.cell));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const d = g.data;
  const a = d[j * g.nx + i] * (1 - tx) + d[j * g.nx + i + 1] * tx;
  const b = d[(j + 1) * g.nx + i] * (1 - tx) + d[(j + 1) * g.nx + i + 1] * tx;
  return a * (1 - tz) + b * tz;
}

// =====================================================================================================================
// 2. LAND-USE MAP (R = park / woods, G = industry / rail / port, B = low-density suburbs, A = marsh), ~31 m texels over
//    the region the camera can see (the texture's edge texels carry on to the horizon)
// =====================================================================================================================

const LU = { minX: -14000, maxX: 18000, minZ: -24000, maxZ: 28000, w: 1024, h: 1664 };
const luData = new Uint8Array(LU.w * LU.h * 4);

// Scanline fill of a polygon over the LU texel grid (texel centres inside): span(j, i0, i1) per covered run of row j
function rasterPolygon(pts, span) {
  const b = polygonBounds(pts);
  const sx = LU.w / (LU.maxX - LU.minX);
  const sz = LU.h / (LU.maxZ - LU.minZ);
  const j0 = Math.max(0, Math.floor((b.minZ - LU.minZ) * sz));
  const j1 = Math.min(LU.h - 1, Math.ceil((b.maxZ - LU.minZ) * sz));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = LU.minZ + (j + 0.5) / sz;
    xs.length = 0;
    for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
      const a = pts[i];
      const c = pts[k];
      if ((a.z > z) !== (c.z > z)) xs.push(a.x + ((z - a.z) / (c.z - a.z)) * (c.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(0, Math.ceil((xs[s] - LU.minX) * sx - 0.5));
      const i1 = Math.min(LU.w - 1, Math.floor((xs[s + 1] - LU.minX) * sx - 0.5));
      if (i1 >= i0) span(j, i0, i1);
    }
  }
}

function luPaintPolygon(pts, ch, value) {
  rasterPolygon(pts, (j, i0, i1) => {
    for (let i = i0; i <= i1; i++) luData[(j * LU.w + i) * 4 + ch] = value;
  });
}

// Lon / lat outline
const luPolyLL = (pairs, ch, value = 255) => luPaintPolygon(LLs(pairs), ch, value);

function luRect(x0, z0, x1, z1, ch, value = 255) {
  luPaintPolygon([{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], ch, value);
}

// Ellipse (radii in m along the grid axes, turned by rot) around a world point or a lon / lat pair
function luEllipse(cx, cz, rx, rz, ch, value = 255, rot = 0) {
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const ex = Math.cos(a) * rx;
    const ez = Math.sin(a) * rz;
    pts.push({ x: cx + ex * Math.cos(rot) - ez * Math.sin(rot), z: cz + ex * Math.sin(rot) + ez * Math.cos(rot) });
  }
  luPaintPolygon(pts, ch, value);
}
function luEllipseLL(lon, lat, rx, rz, ch, value = 255, rot = 0) {
  const p = LL(lon, lat);
  luEllipse(p.x, p.z, rx, rz, ch, value, rot);
}

// A band of half-width halfW along one segment
function luSegment(a, b, halfW, ch, value) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-3) return;
  const tx = ((b.x - a.x) / len) * halfW;
  const tz = ((b.z - a.z) / len) * halfW;
  luPaintPolygon([
    { x: a.x - tx + tz, z: a.z - tz - tx }, { x: b.x + tx + tz, z: b.z + tz - tx },
    { x: b.x + tx - tz, z: b.z + tz + tx }, { x: a.x - tx - tz, z: a.z - tz + tx }
  ], ch, value);
}

// Paints a band of half-width `halfW` along every edge of a closed polygon
function luStroke(pts, ch, value, halfW) {
  for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) luSegment(pts[k], pts[i], halfW, ch, value);
}

// Paints a band along the stretch of a shoreline whose edges lie inside the box [x0, x1] x [z0, z1] (waterfront parks)
function luShore(pts, x0, z0, x1, z1, halfW, ch, value) {
  for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
    const a = pts[k];
    const b = pts[i];
    const mx = (a.x + b.x) * 0.5;
    const mz = (a.z + b.z) * 0.5;
    if (mx < x0 || mx > x1 || mz < z0 || mz > z1 || Math.hypot(b.x - a.x, b.z - a.z) > ARTIFICIAL_EDGE) continue;
    luSegment(a, b, halfW, ch, value);
  }
}

// Separable 3-tap box blur of all four channels
function luBlur(passes) {
  const tmp = new Uint8Array(luData.length);
  const W4 = LU.w * 4;
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < LU.h; j++) {
      const row = j * W4;
      for (let i = 0; i < LU.w; i++) {
        const o = row + i * 4;
        const l = i > 0 ? o - 4 : o;
        const r = i < LU.w - 1 ? o + 4 : o;
        for (let c = 0; c < 4; c++) tmp[o + c] = (luData[l + c] + luData[o + c] + luData[r + c] + 1) / 3;
      }
    }
    for (let j = 0; j < LU.h; j++) {
      const row = j * W4;
      const up = j > 0 ? row - W4 : row;
      const dn = j < LU.h - 1 ? row + W4 : row;
      for (let i = 0; i < W4; i++) luData[row + i] = (tmp[up + i] + tmp[row + i] + tmp[dn + i] + 1) / 3;
    }
  }
}

function luAt(x, z) {
  const i = Math.max(0, Math.min(LU.w - 1, Math.floor(((x - LU.minX) / (LU.maxX - LU.minX)) * LU.w)));
  const j = Math.max(0, Math.min(LU.h - 1, Math.floor(((z - LU.minZ) / (LU.maxZ - LU.minZ)) * LU.h)));
  const o = (j * LU.w + i) * 4;
  return { park: luData[o] / 255, industry: luData[o + 1] / 255, suburb: luData[o + 2] / 255, marsh: luData[o + 3] / 255 };
}

const PARK = 0;
const INDUSTRY = 1;
const SUBURB = 2;
const MARSH = 3;

function paintLandUse() {
  // --- Regional character: suburbs west of the Hackensack and in eastern Queens, Staten Island, Westchester ---
  luRect(-16000, -30000, -11800, 30000, SUBURB, 165);         // Bergen, Essex & Union county suburbs
  luRect(-11800, -30000, -6000, -11000, SUBURB, 150);         // Hackensack, Teaneck, Englewood (behind the Palisades)
  luRect(-9600, -30000, -4600, 1200, SUBURB, 175);            // Leonia, Palisades Park, Ridgefield, Fairview, Secaucus
  luRect(7000, -14000, 20000, 9000, SUBURB, 120);             // Eastern Queens
  luRect(2000, 12800, 20000, 20000, SUBURB, 105);             // Bay Ridge, Bensonhurst, Gravesend, Sheepshead Bay
  luRect(5200, 9000, 12000, 12800, SUBURB, 70);               // Flatbush, Midwood
  luPaintPolygon(STATEN_ISLAND_POLYGON, SUBURB, 190);         // Staten Island
  luPaintPolygon(WESTCHESTER_POLYGON, SUBURB, 200);           // Westchester
  luRect(-4000, -24000, 9000, -19500, SUBURB, 120);           // Riverdale, Fieldston, Wakefield (north Bronx)

  // Harbor islands are parkland, out beyond the shore so their rims don't fall back to the street-grid shading
  for (const pts of [RANDALLS_ISLAND_POLYGON, GOVERNORS_ISLAND_POLYGON, LIBERTY_ISLAND_POLYGON, ELLIS_ISLAND_POLYGON, ROOSEVELT_ISLAND_POLYGON, MILL_ROCK_POLYGON]) {
    if (!pts || pts.length < 3) continue;
    luPaintPolygon(pts, PARK, 255);
    luStroke(pts, PARK, 255, 60);
  }

  // --- Upper Manhattan ---
  const um = UPPER_MANHATTAN_POLYGON;
  luShore(um, -3200, -14600, -1900, -7090, 75, PARK, 255);     // Riverside Park, Riverbank, Fort Washington Park (Hudson shore)
  luShore(um, -1500, -12900, 800, -9300, 95, PARK, 235);       // Highbridge Park (Harlem River bluffs)
  luEllipseLL(-73.9320, 40.8625, 170, 430, PARK, 255);         // Fort Tryon Park (The Cloisters)
  luEllipseLL(-73.9255, 40.8720, 300, 480, PARK, 255);         // Inwood Hill Park
  luRect(-990, -8900, -880, -8150, PARK, 210);                 // Jackie Robinson Park
  luRect(-960, -8050, -830, -7150, PARK, 200);                 // St. Nicholas Park

  // --- The Bronx ---
  luEllipseLL(-73.9285, 40.8268, 150, 230, PARK, 150);         // Macombs Dam Park / Yankee Stadium lawns
  luPolyLL([[-73.9025, 40.8880], [-73.8850, 40.8850], [-73.8760, 40.8960], [-73.8790, 40.9120], [-73.8960, 40.9125], [-73.9020, 40.9000]], PARK); // Van Cortlandt Park
  luPolyLL([[-73.8830, 40.8440], [-73.8710, 40.8420], [-73.8690, 40.8700], [-73.8730, 40.8730], [-73.8800, 40.8680], [-73.8850, 40.8570]], PARK); // Bronx Park (Zoo & Botanical Garden)
  luEllipseLL(-73.8960, 40.8392, 300, 240, PARK, 210);         // Crotona Park
  luPolyLL([[-73.8805, 40.8830], [-73.8655, 40.8830], [-73.8645, 40.8975], [-73.8775, 40.8980]], PARK, 230); // Woodlawn Cemetery
  luPolyLL([[-73.8805, 40.8830], [-73.8655, 40.8830], [-73.8645, 40.8975], [-73.8775, 40.8980]], SUBURB, 200);
  luPolyLL([[-73.8240, 40.8480], [-73.7900, 40.8440], [-73.7830, 40.8700], [-73.8120, 40.8870], [-73.8270, 40.8700]], PARK, 230); // Pelham Bay Park
  luPolyLL([[-73.9185, 40.8790], [-73.9060, 40.8780], [-73.8990, 40.9130], [-73.9160, 40.9130], [-73.9210, 40.8930]], SUBURB, 170); // Riverdale
  luPolyLL([[-73.9205, 40.8025], [-73.9075, 40.7960], [-73.8950, 40.8000], [-73.8985, 40.8065], [-73.9150, 40.8075]], INDUSTRY, 220); // Port Morris / Bronx Kill waterfront
  luPolyLL([[-73.8960, 40.8030], [-73.8800, 40.7985], [-73.8690, 40.8070], [-73.8800, 40.8165], [-73.8935, 40.8130]], INDUSTRY, 230); // Hunts Point
  for (const r of BRONX_POLYGONS || []) {
    const b = polygonBounds(r);
    if (b.minX > 4000 && b.maxX < 6500 && b.maxZ < -6900 && b.minZ > -8400) luPaintPolygon(r, INDUSTRY, 210); // Rikers Island
  }

  // --- Queens ---
  luPolyLL([[-73.9280, 40.7700], [-73.9225, 40.7695], [-73.9175, 40.7815], [-73.9230, 40.7840]], PARK);     // Astoria Park
  luEllipseLL(-73.9478, 40.7565, 85, 150, PARK, 230);           // Queensbridge Park
  luEllipseLL(-73.9450, 40.7595, 170, 230, INDUSTRY, 255);      // Ravenswood Generating Station ("Big Allis")
  luPolyLL([[-73.9385, 40.7510], [-73.9300, 40.7528], [-73.9050, 40.7482], [-73.9060, 40.7430], [-73.9250, 40.7440], [-73.9370, 40.7468]], INDUSTRY); // Sunnyside Yard
  luPolyLL([[-73.9560, 40.7400], [-73.9350, 40.7350], [-73.9100, 40.7200], [-73.9000, 40.7235], [-73.9250, 40.7395], [-73.9450, 40.7450]], INDUSTRY, 200); // Newtown Creek, Blissville & Maspeth industry
  luPolyLL([[-73.9425, 40.7310], [-73.9330, 40.7362], [-73.9150, 40.7322], [-73.9120, 40.7232], [-73.9300, 40.7228]], PARK, 230); // Calvary Cemetery
  luPolyLL([[-73.9425, 40.7310], [-73.9330, 40.7362], [-73.9150, 40.7322], [-73.9120, 40.7232], [-73.9300, 40.7228]], SUBURB, 200);
  luPolyLL([[-73.8900, 40.7700], [-73.8700, 40.7650], [-73.8550, 40.7700], [-73.8580, 40.7840], [-73.8800, 40.7880], [-73.8900, 40.7820]], INDUSTRY); // LaGuardia Airport
  luPolyLL([[-73.8900, 40.7700], [-73.8700, 40.7650], [-73.8550, 40.7700], [-73.8580, 40.7840], [-73.8800, 40.7880], [-73.8900, 40.7820]], SUBURB);
  luPolyLL([[-73.8520, 40.7600], [-73.8380, 40.7600], [-73.8320, 40.7300], [-73.8350, 40.7150], [-73.8480, 40.7150], [-73.8500, 40.7350]], PARK, 220); // Flushing Meadows Corona Park
  luPolyLL([[-73.8750, 40.7000], [-73.8500, 40.7080], [-73.8350, 40.7020], [-73.8450, 40.6960], [-73.8700, 40.6940]], PARK); // Forest Park
  luPolyLL([[-73.9100, 40.6950], [-73.8780, 40.7000], [-73.8650, 40.6900], [-73.8950, 40.6850]], PARK, 200); // Cypress Hills cemeteries
  luPolyLL([[-73.9100, 40.6950], [-73.8780, 40.7000], [-73.8650, 40.6900], [-73.8950, 40.6850]], SUBURB, 200);

  // --- Brooklyn ---
  const bk = BROOKLYN_LAND ? BROOKLYN_LAND.pts : [];
  luPolyLL([[-73.9548, 40.7196], [-73.9500, 40.7178], [-73.9478, 40.7230], [-73.9522, 40.7247]], PARK);     // McCarren Park
  luPolyLL([[-73.9610, 40.7385], [-73.9500, 40.7335], [-73.9300, 40.7255], [-73.9220, 40.7185], [-73.9300, 40.7150], [-73.9480, 40.7280], [-73.9600, 40.7330]], INDUSTRY, 200); // Newtown Creek (Greenpoint side)
  luPolyLL([[-73.9400, 40.7200], [-73.9250, 40.7180], [-73.9200, 40.7080], [-73.9350, 40.7060]], INDUSTRY, 140); // East Williamsburg industrial park
  luEllipseLL(-73.9688, 40.7140, 35, 130, PARK, 200);          // Domino Park
  luPolyLL([[-73.9805, 40.7010], [-73.9700, 40.7058], [-73.9620, 40.7042], [-73.9640, 40.6970], [-73.9760, 40.6965]], INDUSTRY); // Brooklyn Navy Yard
  const bbp0 = LL(-73.9905, 40.7045);
  const bbp1 = LL(-74.0015, 40.6895);
  luShore(bk, Math.min(bbp0.x, bbp1.x) - 300, bbp0.z, Math.max(bbp0.x, bbp1.x) + 150, bbp1.z, 90, PARK, 255); // Brooklyn Bridge Park
  luEllipseLL(-73.9760, 40.6912, 170, 150, PARK, 230);          // Fort Greene Park
  luEllipseLL(-73.9905, 40.6975, 60, 190, PARK, 160);           // Cadman Plaza
  luPolyLL([[-74.0175, 40.6870], [-74.0080, 40.6885], [-74.0050, 40.6790], [-74.0135, 40.6770]], INDUSTRY); // Red Hook Container Terminal
  luEllipseLL(-74.0120, 40.6742, 350, 250, INDUSTRY, 230);       // Erie Basin / Gowanus Bay
  luPolyLL([[-73.9880, 40.6812], [-73.9848, 40.6800], [-73.9930, 40.6648], [-73.9982, 40.6660]], INDUSTRY, 160); // Gowanus Canal
  luPolyLL([[-73.9700, 40.6738], [-73.9640, 40.6695], [-73.9618, 40.6620], [-73.9620, 40.6545], [-73.9680, 40.6518], [-73.9762, 40.6545],
    [-73.9805, 40.6610], [-73.9780, 40.6662]], PARK);                                     // Prospect Park
  luPolyLL([[-74.0045, 40.6560], [-73.9900, 40.6622], [-73.9830, 40.6540], [-73.9930, 40.6448], [-74.0005, 40.6460]], PARK, 235); // Green-Wood Cemetery
  luPolyLL([[-74.0045, 40.6560], [-73.9900, 40.6622], [-73.9830, 40.6540], [-73.9930, 40.6448], [-74.0005, 40.6460]], SUBURB, 200);
  luPolyLL([[-74.0225, 40.6580], [-74.0050, 40.6652], [-74.0000, 40.6600], [-74.0200, 40.6458], [-74.0272, 40.6500]], INDUSTRY, 240); // Bush Terminal / Industry City
  luEllipseLL(-74.0320, 40.6400, 150, 130, PARK, 220);           // Owl's Head Park
  const sr0 = LL(-74.0380, 40.6330);
  const sr1 = LL(-74.0300, 40.6080);
  luShore(bk, Math.min(sr0.x, sr1.x) - 400, sr0.z, Math.max(sr0.x, sr1.x) + 200, sr1.z, 80, PARK, 170); // Shore Road Park
  luEllipseLL(-74.0200, 40.6145, 400, 300, PARK, 220);           // Dyker Beach Park
  luShore(bk, 5500, 16600, 13000, 19500, 110, PARK, 150);        // Coney Island & Brighton beaches
  luPolyLL([[-73.9300, 40.6000], [-73.9150, 40.6050], [-73.9050, 40.5950], [-73.9250, 40.5880]], PARK, 200); // Marine Park
  luPolyLL([[-73.8960, 40.5950], [-73.8800, 40.5960], [-73.8750, 40.5830], [-73.8930, 40.5810]], INDUSTRY, 200); // Floyd Bennett Field
  luPolyLL([[-73.8960, 40.5950], [-73.8800, 40.5960], [-73.8750, 40.5830], [-73.8930, 40.5810]], SUBURB, 220);

  // --- New Jersey ---
  luPolyLL([[-74.0565, 40.7080], [-74.0420, 40.7122], [-74.0330, 40.7082], [-74.0330, 40.7010], [-74.0430, 40.6960], [-74.0560, 40.6930],
    [-74.0632, 40.6980]], PARK);                                                        // Liberty State Park
  luEllipseLL(-74.0242, 40.7450, 150, 120, PARK, 210);          // Stevens Institute / Castle Point
  luPolyLL([[-74.0300, 40.7362], [-74.0282, 40.7342], [-74.0390, 40.7318], [-74.0425, 40.7342]], INDUSTRY, 230); // Hoboken Terminal rail yard
  luEllipseLL(-74.0412, 40.7108, 120, 90, PARK, 180);           // Liberty Harbor / Morris Canal
  luEllipseLL(-74.0465, 40.7280, 60, 60, PARK, 200);            // Hamilton Park
  luEllipseLL(-74.0870, 40.7245, 260, 300, PARK, 230);          // Lincoln Park (Jersey City)
  luPolyLL([[-74.0905, 40.6862], [-74.0700, 40.6902], [-74.0650, 40.6820], [-74.0800, 40.6778], [-74.0955, 40.6800]], INDUSTRY); // Port Jersey / Greenville Yard
  luPolyLL([[-74.0905, 40.6725], [-74.0440, 40.6725], [-74.0415, 40.6638], [-74.0905, 40.6628]], INDUSTRY); // Bayonne peninsula (MOTBY)
  luEllipse(-2750, 13950, 500, 380, INDUSTRY, 200);              // Constable Hook tank farms
  luRect(-6600, 11200, -2000, 16000, SUBURB, 90);                // Bayonne
  luPaintPolygon([{ x: -13500, z: -9500 }, { x: -9600, z: -10200 }, { x: -7600, z: -5000 }, { x: -7200, z: 0 }, { x: -8000, z: 2500 },
    { x: -10500, z: 3200 }, { x: -13500, z: 1000 }], MARSH, 255);                     // Hackensack Meadowlands
  luPaintPolygon([{ x: -13500, z: -9500 }, { x: -9600, z: -10200 }, { x: -7600, z: -5000 }, { x: -7200, z: 0 }, { x: -8000, z: 2500 },
    { x: -10500, z: 3200 }, { x: -13500, z: 1000 }], SUBURB, 200);
  luEllipseLL(-74.0565, 40.7895, 900, 700, MARSH, 0);           // Secaucus (built up within the marsh)
  luEllipseLL(-74.0745, 40.8135, 500, 420, INDUSTRY);           // MetLife Stadium / Meadowlands complex
  luEllipseLL(-74.0745, 40.8135, 500, 420, MARSH, 0);
  luPaintPolygon([{ x: -10600, z: 7500 }, { x: -8200, z: 7800 }, { x: -7900, z: 15000 }, { x: -10400, z: 15500 }], INDUSTRY, 170); // Port Newark / Elizabeth docks
  luEllipseLL(-74.1745, 40.6895, 1400, 1100, INDUSTRY);         // Newark Airport
  luEllipseLL(-74.1745, 40.6895, 1400, 1100, SUBURB);
  const njShore = NJ_LAND ? NJ_LAND.pts : [];
  luShore(njShore, -6000, -30000, -3300, -10900, 260, PARK, 255); // Palisades Interstate Park (cliffs & wooded crest)
  luEllipseLL(-73.9690, 40.8475, 170, 140, PARK, 200);          // Fort Lee Historic Park

  // --- Staten Island ---
  luEllipseLL(-74.1400, 40.5900, 1500, 900, PARK, 235, 0.5);    // Staten Island Greenbelt (Todt Hill)
  luEllipseLL(-74.1020, 40.6440, 220, 150, PARK, 200);          // Snug Harbor
  luEllipseLL(-74.0560, 40.6060, 260, 210, PARK, 230);          // Fort Wadsworth
  luEllipseLL(-74.1000, 40.6180, 260, 380, PARK, 210);          // Clove Lakes & Silver Lake parks
  luEllipseLL(-74.1900, 40.5800, 1800, 1300, PARK, 200);        // Freshkills Park

  luBlur(1);
}

paintLandUse();

const landUseTexture = new THREE.DataTexture(luData, LU.w, LU.h, THREE.RGBAFormat);
landUseTexture.magFilter = THREE.LinearFilter;
landUseTexture.minFilter = THREE.LinearMipmapLinearFilter;
landUseTexture.generateMipmaps = true;
landUseTexture.wrapS = THREE.ClampToEdgeWrapping;
landUseTexture.wrapT = THREE.ClampToEdgeWrapping;
landUseTexture.needsUpdate = true;

// =====================================================================================================================
// 3. NEIGHBOURHOOD STREET GRIDS (shared by the ground shader and the building generator so buildings sit on blocks)
//    u runs along each block's long side: u = R(angle) * (p - origin); pu >= pv are the block pitches and su / sv the
//    street widths (m). Which grid applies where is baked into a zone map (one byte per land-use texel) that the ground
//    shader samples too, so the CPU and GPU always agree.
// =====================================================================================================================

const ZONE_LIST = [
  // Harbor islands' paths & lawns
  { id: 'island', angle: 0, o: { x: 0, z: 0 }, pu: 120, pv: 60, su: 8, sv: 8, lot: 10 },
  // Harlem, Washington Heights & Inwood: the Manhattan grid itself (avenues ~274 m apart, streets every 79.4 m from 130th St)
  { id: 'upper', angle: 0, o: { x: 0, z: streetZ ? streetZ(130) : -7125 }, pu: 274, pv: 79.4, su: 30, sv: 18, lot: 9 },
  // The Bronx: streets square to the Grand Concourse
  { id: 'bronx', angle: -5, o: LL(-73.9262, 40.8296), pu: 210, pv: 80, su: 18, sv: 15, lot: 9 },
  // Long Island City & Astoria (numbered streets running NNE, parallel to the East River) / the rest of Queens (true N-S)
  { id: 'queens', angle: 101, o: LL(-73.9440, 40.7470), pu: 200, pv: 76, su: 16, sv: 13, lot: 8 },
  { id: 'queenseast', angle: 61, o: LL(-73.8830, 40.7470), pu: 250, pv: 74, su: 16, sv: 13, lot: 8 },
  // Greenpoint, Williamsburg & Bushwick / Downtown, brownstone & southern Brooklyn
  { id: 'bknorth', angle: -2, o: LL(-73.9570, 40.7170), pu: 140, pv: 76, su: 15, sv: 12, lot: 7 },
  { id: 'bksouth', angle: -4, o: LL(-73.9850, 40.6900), pu: 225, pv: 78, su: 18, sv: 12, lot: 6.5 },
  // Hoboken & downtown Jersey City / Weehawken, Union City, West New York, Edgewater, Fort Lee, JC Heights
  { id: 'nj', angle: 76, o: LL(-74.0300, 40.7370), pu: 135, pv: 62, su: 14, sv: 13, lot: 6.5 },
  { id: 'njheights', angle: 4, o: LL(-74.0300, 40.7700), pu: 165, pv: 66, su: 13, sv: 12, lot: 7.5 },
  // Kearny, Harrison, Newark & the Meadowlands towns west of the Hackensack / Bayonne & Greenville
  { id: 'njwest', angle: 8, o: LL(-74.1500, 40.7400), pu: 190, pv: 90, su: 14, sv: 12, lot: 10 },
  { id: 'bayonne', angle: -4, o: LL(-74.1140, 40.6680), pu: 175, pv: 82, su: 14, sv: 12, lot: 8 },
  // Staten Island's suburban grids
  { id: 'si', angle: 24, o: LL(-74.0750, 40.6400), pu: 170, pv: 95, su: 12, sv: 10, lot: 14 }
];
const ZONES = {};
ZONE_LIST.forEach((z, i) => {
  const a = (z.angle * Math.PI) / 180;
  z.index = i;
  z.ox = z.o.x;
  z.oz = z.o.z;
  z.cos = Math.cos(a);
  z.sin = Math.sin(a);
  ZONES[z.id] = z;
});

// Zone map: zone index per land-use texel (255 = no land)
const zoneData = new Uint8Array(LU.w * LU.h).fill(255);

function paintZones() {
  const DEFAULT = { nj: 'njheights', brooklyn: 'bksouth', queens: 'queens', upper: 'upper', bronx: 'bronx', si: 'si' };
  for (let k = LAND.length - 1; k >= 0; k--) {
    const land = LAND[k];
    const zone = land.id === 'minor' ? ZONES.island : ZONES[DEFAULT[land.borough] || 'island'];
    rasterPolygon(land.pts, (j, i0, i1) => zoneData.fill(zone.index, j * LU.w + i0, j * LU.w + i1 + 1));
  }
  // Neighbourhood grids within a borough (painted over their parent zone only)
  const sub = (pts, id, parent) => {
    const from = ZONES[parent].index;
    const to = ZONES[id].index;
    rasterPolygon(pts, (j, i0, i1) => {
      for (let o = j * LU.w + i0; o <= j * LU.w + i1; o++) if (zoneData[o] === from) zoneData[o] = to;
    });
  };
  const P = (arr) => arr.map(([x, z]) => ({ x, z }));
  // Hoboken & downtown Jersey City, east of the Palisades / Bergen Hill
  sub(P([[-4350, 1350], [-1000, 1350], [-1000, 7050], [-3650, 7050], [-3950, 4200]]), 'nj', 'njheights');
  // West of the Hackensack River & Newark Bay
  sub(P([[-60000, -60000], [-9400, -60000], [-9400, -500], [-9200, 1000], [-9400, 2000], [-8700, 3000], [-8500, 4000], [-7300, 5500],
    [-7400, 6500], [-7300, 8000], [-7400, 9500], [-7100, 11000], [-7100, 13000], [-7300, 16000], [-7300, 60000], [-60000, 60000]]), 'njwest', 'njheights');
  // Greenville & Bayonne
  sub(P([[-7400, 9300], [0, 9300], [0, 30000], [-7400, 30000]]), 'bayonne', 'njheights');
  // Greenpoint, Williamsburg & Bushwick (north of Flushing Ave)
  sub(P([[0, -3000], [30000, -3000], [30000, 4400], [0, 4400]]), 'bknorth', 'bksouth');
  // Queens east of Sunnyside & Maspeth
  sub(P([[6200, -30000], [60000, -30000], [60000, 30000], [6200, 30000]]), 'queenseast', 'queens');
  // Shore texels whose centre lies in the water take the zone of the land next to them
  for (let pass = 0; pass < 2; pass++) {
    const src = zoneData.slice();
    for (let j = 0; j < LU.h; j++) {
      for (let i = 0; i < LU.w; i++) {
        const o = j * LU.w + i;
        if (src[o] !== 255) continue;
        if (i > 0 && src[o - 1] !== 255) zoneData[o] = src[o - 1];
        else if (i < LU.w - 1 && src[o + 1] !== 255) zoneData[o] = src[o + 1];
        else if (j > 0 && src[o - LU.w] !== 255) zoneData[o] = src[o - LU.w];
        else if (j < LU.h - 1 && src[o + LU.w] !== 255) zoneData[o] = src[o + LU.w];
      }
    }
  }
}
paintZones();

const zoneTexture = new THREE.DataTexture(zoneData, LU.w, LU.h, THREE.RedFormat, THREE.UnsignedByteType);
zoneTexture.magFilter = THREE.NearestFilter;
zoneTexture.minFilter = THREE.NearestFilter;
zoneTexture.generateMipmaps = false;
zoneTexture.wrapS = THREE.ClampToEdgeWrapping;
zoneTexture.wrapT = THREE.ClampToEdgeWrapping;
zoneTexture.needsUpdate = true;

// The zone of a world point: the same texel the ground shader samples (nearest, clamped to the edge)
function zoneAt(x, z) {
  const i = Math.max(0, Math.min(LU.w - 1, Math.floor(((x - LU.minX) / (LU.maxX - LU.minX)) * LU.w)));
  const j = Math.max(0, Math.min(LU.h - 1, Math.floor(((z - LU.minZ) / (LU.maxZ - LU.minZ)) * LU.h)));
  return ZONE_LIST[zoneData[j * LU.w + i]] || ZONES.island;
}

function zoneToLocal(zone, x, z) {
  const dx = x - zone.ox;
  const dz = z - zone.oz;
  return { u: dx * zone.cos + dz * zone.sin, v: dz * zone.cos - dx * zone.sin };
}

function zoneToWorld(zone, u, v) {
  return { x: zone.ox + u * zone.cos - v * zone.sin, z: zone.oz + u * zone.sin + v * zone.cos };
}

// Grid parameters of the zone texel under luUV: p0 = (cos, sin, origin x, origin z), p1 = (pu, pv, su, sv)
function zoneParamsNode(luUV) {
  const zid = floor(texture(zoneTexture, luUV).r.mul(255.0).add(0.5)).toVar();
  const p0Of = (z) => vec4(z.cos, z.sin, z.ox, z.oz);
  const p1Of = (z) => vec4(z.pu, z.pv, z.su, z.sv);
  let p0 = p0Of(ZONE_LIST[0]);
  let p1 = p1Of(ZONE_LIST[0]);
  for (let k = 1; k < ZONE_LIST.length; k++) {
    const hit = abs(zid.sub(k)).lessThan(0.5);
    p0 = select(hit, p0Of(ZONE_LIST[k]), p0);
    p1 = select(hit, p1Of(ZONE_LIST[k]), p1);
  }
  return { p0, p1 };
}

// =====================================================================================================================
// 4. CHEAP DISTANT MATERIALS
// =====================================================================================================================

const hash12 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

const valueNoise = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash12(i);
  const b = hash12(i.add(vec2(1.0, 0.0)));
  const c = hash12(i.add(vec2(0.0, 1.0)));
  const d = hash12(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// Box-filtered periodic pulse (fraction of a footprint `w` around `x` where fract() lies in [a, b]): settles to the mean
// coverage once a period shrinks below a pixel, so grids never shimmer at distance
const boxPulse = Fn(([x, a, b, w]) => {
  const p = float(x).toVar();
  const lo = float(a).toVar();
  const hi = float(b).toVar();
  const hw = max(float(w), 0.0001).mul(0.5).toVar();
  const integral = (t) => floor(t).mul(hi.sub(lo)).add(clamp(fract(t), lo, hi).sub(lo));
  return integral(p.add(hw)).sub(integral(p.sub(hw))).div(hw.mul(2.0));
});

// 0 by day, ~0.75 at blue hour, 1 at night
const nightFactorNode = () => smoothstep(0.7, 1.45, cityUniforms.uInteriorGlow);

/**
 * Procedural "city carpet" for every borough & island ground surface: neighbourhood street grids with sidewalks,
 * flat roofs and backyard trees, overridden by the land-use map (parks, cemeteries, industry, suburbs, marsh) and by
 * slope (Palisades rock faces and wooded talus). Sodium street-light grids glow at night.
 */
function createLandMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0.0 });
  const wp = positionWorld;
  const luUV = vec2(wp.x.sub(LU.minX).div(LU.maxX - LU.minX), wp.z.sub(LU.minZ).div(LU.maxZ - LU.minZ));
  const lu = texture(landUseTexture, luUV).toVar();
  const { p0, p1 } = zoneParamsNode(luUV);
  const zp0 = p0.toVar();
  const zp1 = p1.toVar();

  const dx = wp.x.sub(zp0.z);
  const dz = wp.z.sub(zp0.w);
  const gu = dx.mul(zp0.x).add(dz.mul(zp0.y)).div(zp1.x).toVar();
  const gv = dz.mul(zp0.x).sub(dx.mul(zp0.y)).div(zp1.y).toVar();
  const fwU = fwidth(gu).toVar();
  const fwV = fwidth(gv).toVar();
  const cell = floor(vec2(gu, gv)).toVar();

  const hu = zp1.z.mul(0.5).div(zp1.x);
  const hv = zp1.w.mul(0.5).div(zp1.y);
  const swU = float(2.2).div(zp1.x);
  const swV = float(2.2).div(zp1.y);
  const inBlock = boxPulse(gu, hu, float(1.0).sub(hu), fwU).mul(boxPulse(gv, hv, float(1.0).sub(hv), fwV)).toVar();
  const inLots = boxPulse(gu, hu.add(swU), float(1.0).sub(hu).sub(swU), fwU)
    .mul(boxPulse(gv, hv.add(swV), float(1.0).sub(hv).sub(swV), fwV)).toVar();

  // Lots ~8 m wide along the block, two rows of roofs with a band of backyard trees between them
  const lotsU = max(floor(zp1.x.div(8.5)), 1.0);
  const lotCoord = gu.mul(lotsU);
  const lotId = vec2(floor(lotCoord), cell.y.mul(3.0).add(floor(fract(gv).mul(3.0))));
  const lotHash = hash12(lotId.add(vec2(zp0.z.mul(0.013), zp0.w.mul(0.017)))).toVar();
  const lotDetail = float(1.0).sub(smoothstep(0.35, 1.1, max(fwU.mul(lotsU), fwV.mul(3.0)))).toVar();

  const cTar = srgb(0.30, 0.30, 0.29);
  const cGreyRoof = srgb(0.50, 0.495, 0.48);
  const cLightRoof = srgb(0.72, 0.71, 0.69);
  const cBrownRoof = srgb(0.46, 0.34, 0.28);
  const roofVar = mix(
    mix(cTar, cGreyRoof, step(0.38, lotHash)),
    mix(cBrownRoof, cLightRoof, step(0.86, lotHash)),
    step(0.66, lotHash)
  );
  const roofMean = srgb(0.43, 0.41, 0.39);
  const roofCol = mix(roofMean, roofVar, lotDetail);

  const yardBand = boxPulse(fract(gv), 0.36, 0.64, fwV);
  const treeNoise = valueNoise(wp.xz.mul(0.11)).toVar();
  const cTree = mix(srgb(0.19, 0.26, 0.13), srgb(0.30, 0.37, 0.19), treeNoise);
  const yardAmount = clamp(yardBand.mul(0.85).add(lu.b.mul(0.35)).mul(smoothstep(0.25, 0.65, treeNoise.add(lu.b.mul(0.3)))), 0.0, 1.0);
  const lotsCol = mix(roofCol, cTree, yardAmount);

  const cAsphalt = srgb(0.30, 0.30, 0.31);
  const cSidewalk = srgb(0.56, 0.55, 0.53);
  let urban = mix(cAsphalt, mix(cSidewalk, lotsCol, inLots.div(max(inBlock, 0.001))), inBlock);

  // Curbside street trees: canopies over the sidewalks and the parking lanes of residential blocks, with gaps;
  // settles to an average canopy cover once single trees shrink below a pixel
  const reachU = min(float(3.2).div(zp1.x), hu.mul(0.9));
  const reachV = min(float(3.2).div(zp1.y), hv.mul(0.9));
  const curbZone = boxPulse(gu, hu.sub(reachU), float(1.0).sub(hu).add(reachU), fwU)
    .mul(boxPulse(gv, hv.sub(reachV), float(1.0).sub(hv).add(reachV), fwV));
  const treeBand = max(curbZone.sub(inLots), 0.0);
  const crowns = smoothstep(0.42, 0.62, valueNoise(wp.xz.mul(0.16).add(vec2(zp0.z, zp0.w).mul(0.01))));
  const canopyFar = smoothstep(1.2, 4.0, max(fwU.mul(zp1.x), fwV.mul(zp1.y)));
  const streetTrees = treeBand.mul(mix(crowns, float(0.5), canopyFar)).mul(float(1.0).sub(lu.g)).toVar();
  urban = mix(urban, cTree.mul(1.12), streetTrees);

  // Industry & rail / port yards: huge light roofs, tank farms and concrete yards in coarse cells
  const indCell = hash12(floor(wp.xz.div(26.0)));
  const cIndustry = mix(srgb(0.50, 0.49, 0.47), mix(srgb(0.70, 0.69, 0.67), srgb(0.52, 0.42, 0.35), step(0.82, indCell)), step(0.45, indCell));

  // Parks / woods (lawn clearings among dense canopy) and cemeteries (pale lawns speckled with stones)
  const woods = smoothstep(0.35, 0.7, valueNoise(wp.xz.mul(0.045)).add(treeNoise.mul(0.35)));
  const cLawn = srgb(0.36, 0.45, 0.2);
  const cPark = mix(cLawn, cTree, woods);
  const cCemetery = mix(srgb(0.40, 0.48, 0.27), srgb(0.66, 0.66, 0.64), step(0.8, hash12(floor(wp.xz.mul(0.5)))).mul(0.5));

  // Hackensack Meadowlands: reeds, mudflats and winding water channels
  const marshN = valueNoise(wp.xz.mul(0.02)).toVar();
  const cMarsh = mix(mix(srgb(0.47, 0.5, 0.31), srgb(0.36, 0.43, 0.24), treeNoise), srgb(0.22, 0.26, 0.28), smoothstep(0.47, 0.5, marshN).mul(float(1.0).sub(smoothstep(0.5, 0.53, marshN))));

  const park = lu.r.toVar();
  const cemeteryMix = park.mul(lu.b);
  let col = mix(urban, cIndustry, lu.g.mul(float(1.0).sub(lu.b.mul(0.6))));
  col = mix(col, cMarsh, lu.a);
  col = mix(col, mix(cPark, cCemetery, smoothstep(0.4, 0.8, cemeteryMix)), park);

  // Palisades: columnar diabase cliffs (dark, rust-stained, vertical joints breaking into tall blocks, shrubs on the
  // ledges) where the ridge is steep, wooded talus slopes below the crest
  const slope = float(1.0).sub(normalWorld.y).toVar();
  const colCoord = wp.z.add(wp.x.mul(0.35)).div(3.4).toVar();
  const colId = floor(colCoord);
  const colFw = fwidth(colCoord);
  const colDetail = float(1.0).sub(smoothstep(0.3, 1.0, colFw));
  const colHash = hash12(vec2(colId, floor(wp.y.div(13.0).add(hash12(vec2(colId, 7.0)).mul(3.0)))));
  const joint = float(1.0).sub(boxPulse(fract(colCoord), 0.07, 0.93, colFw)).mul(colDetail);
  const rockN = valueNoise(vec2(wp.x.add(wp.z).mul(0.12), wp.y.mul(0.05)));
  const rust = smoothstep(0.55, 0.85, valueNoise(wp.xz.mul(0.03).add(wp.y.mul(0.02)))).mul(0.6);
  const rockBase = mix(mix(srgb(0.25, 0.235, 0.22), srgb(0.40, 0.37, 0.33), rockN), srgb(0.42, 0.31, 0.23), rust);
  const rockCol = rockBase.mul(mix(float(1.0), float(0.82).add(colHash.mul(0.3)), colDetail)).mul(float(1.0).sub(joint.mul(0.45)));
  const ledges = smoothstep(0.6, 0.78, valueNoise(vec2(wp.x.add(wp.z).mul(0.08), wp.y.mul(0.3))).add(treeNoise.mul(0.2)));
  const rock = mix(rockCol, cTree.mul(0.9), ledges.mul(0.8));
  col = mix(col, cTree, smoothstep(0.04, 0.12, slope));
  col = mix(col, rock, smoothstep(0.28, 0.5, slope));
  mat.colorNode = col;

  mat.roughnessNode = mix(float(0.9), float(0.97), park);

  // Night: sodium street lights along the grid (none in parks, marsh or yards); faint lit windows on the roofs; none on
  // the cliffs
  const flat = float(1.0).sub(smoothstep(0.1, 0.3, slope));
  const street = float(1.0).sub(inBlock).mul(float(1.0).sub(park)).mul(float(1.0).sub(lu.a)).mul(flat);
  const windowGlow = inLots.mul(step(0.9, lotHash).mul(lotDetail).add(float(1.0).sub(lotDetail).mul(0.1))).mul(float(1.0).sub(park)).mul(flat);
  mat.emissiveNode = vec3(1.0, 0.62, 0.3).mul(street.mul(0.55).add(windowGlow.mul(0.18))).mul(nightFactorNode());
  return mat;
}

/**
 * Borough building facades (instanced unit boxes): punched brick / limestone windows, curtain-wall glass, warehouse
 * sashes or ribbon windows by style, a per-building tint, darker storefront bases & tar roofs, and lit windows at night.
 * Instance attributes: bInfo = (width, height, depth, seed), bTint = (r, g, b, style).
 */
function createBoroughBuildingMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0.0 });
  const info = attribute('bInfo', 'vec4');
  const tint = attribute('bTint', 'vec4');
  const pG = positionGeometry;
  const nG = normalGeometry;
  const style = tint.w;

  const isRoof = step(0.5, nG.y).toVar();
  const faceX = step(0.5, abs(nG.x));
  const wallW = mix(info.x, info.z, faceX);
  const u = mix(pG.x, pG.z, faceX).add(0.5).mul(wallW).add(info.w.mul(3.7)).toVar();
  const y = pG.y.mul(info.y).toVar();

  const s0 = style.lessThan(0.5);
  const s1 = style.lessThan(1.5);
  const s2 = style.lessThan(2.5);
  const s3 = style.lessThan(3.5);
  const pick = (a, b, c, d, e) => select(s0, float(a), select(s1, float(b), select(s2, float(c), select(s3, float(d), float(e)))));
  const bay = pick(3.0, 1.6, 4.8, 2.2, 2.6);
  const floorH = pick(3.1, 3.7, 4.6, 3.3, 3.4);
  const winW = pick(0.44, 0.88, 0.62, 0.96, 0.46);
  const winH = pick(0.54, 0.74, 0.46, 0.44, 0.56);
  const litProb = pick(0.32, 0.36, 0.14, 0.3, 0.3);
  const glassy = pick(0.15, 1.0, 0.1, 0.35, 0.15);

  const gu = u.div(bay).toVar();
  const gv = y.div(floorH).toVar();
  const fwU = fwidth(gu).toVar();
  const fwV = fwidth(gv).toVar();
  const winMask = boxPulse(gu, float(0.5).sub(winW.mul(0.5)), float(0.5).add(winW.mul(0.5)), fwU)
    .mul(boxPulse(gv, float(0.42).sub(winH.mul(0.5)), float(0.42).add(winH.mul(0.5)), fwV))
    .mul(float(1.0).sub(isRoof))
    .mul(step(1.0, gv))
    .mul(float(1.0).sub(step(info.y.sub(1.2), y)))
    .toVar();
  const cellHash = hash12(floor(vec2(gu, gv)).add(vec2(info.w.mul(0.61), info.w.mul(1.37))));
  const far = smoothstep(0.35, 1.2, max(fwU, fwV)).toVar();
  const lit = mix(step(cellHash, litProb), litProb, far).toVar();

  const bHash = fract(info.w.mul(0.1373));
  const grime = valueNoise(vec2(u.mul(0.45), y.mul(0.05).add(info.w))).toVar();
  const fwY = fwidth(y);
  const parapet = smoothstep(fwY.negate(), fwY, y.sub(info.y.sub(0.85))).mul(float(1.0).sub(isRoof));
  const wallBase = tint.rgb.mul(float(0.84).add(bHash.mul(0.3))).mul(mix(float(0.78), float(1.0), smoothstep(0.0, 9.0, y)));
  const wallCol = mix(wallBase.mul(mix(float(0.86), float(1.07), grime)), wallBase.mul(mix(float(0.62), float(1.3), step(0.55, bHash))), parapet);
  const storefront = float(1.0).sub(step(4.2, y)).mul(float(1.0).sub(isRoof));
  // Window frames & sills (white / cream trim on masonry, dark mullions on glass & warehouses, aluminium on modern)
  const frameMask = boxPulse(gu, float(0.45).sub(winW.mul(0.5)), float(0.55).add(winW.mul(0.5)), fwU)
    .mul(boxPulse(gv, float(0.36).sub(winH.mul(0.5)), float(0.45).add(winH.mul(0.5)), fwV))
    .mul(float(1.0).sub(isRoof))
    .mul(step(1.0, gv))
    .mul(float(1.0).sub(step(info.y.sub(1.2), y)));
  const frame = max(frameMask.sub(winMask), 0.0);
  const cFrame = vec3(1.0, 0.98, 0.94).mul(pick(0.58, 0.04, 0.05, 0.34, 0.5));
  // Dark interiors (the sky shows up through Fresnel reflection), some drawn blinds; tinted curtain-wall glass
  const winHash = hash12(floor(vec2(gu, gv)).add(vec2(info.w.mul(1.91), 5.3)));
  const blinds = mix(step(0.84, winHash), float(0.16), far).mul(float(1.0).sub(glassy));
  const cGlass = mix(mix(vec3(0.012, 0.014, 0.017), vec3(0.05, 0.065, 0.08), glassy), srgb(0.56, 0.53, 0.47), blinds);
  const roofCol = mix(srgb(0.30, 0.30, 0.31), srgb(0.66, 0.66, 0.65), step(0.72, bHash));
  let col = mix(wallCol, cFrame, frame);
  col = mix(col, cGlass, winMask);
  col = mix(col, vec3(0.09, 0.085, 0.08), storefront.mul(0.65));
  col = mix(col, roofCol, isRoof);
  mat.colorNode = col;
  mat.roughnessNode = mix(mix(float(0.86), float(0.5), frame), mix(float(0.14), float(0.06), glassy), winMask);
  mat.metalnessNode = winMask.mul(glassy).mul(0.6);

  const night = nightFactorNode();
  const warm = mix(vec3(1.0, 0.66, 0.36), vec3(0.92, 0.86, 0.76), step(0.78, cellHash));
  const dimmer = mix(fract(cellHash.mul(13.7)).mul(0.75).add(0.25), float(0.62), far);
  const shop = storefront.mul(step(0.35, hash12(vec2(floor(gu), info.w)))).mul(0.8);
  mat.emissiveNode = warm.mul(winMask.mul(lit).mul(dimmer).add(shop)).mul(night.mul(0.95).add(cityUniforms.uInteriorGlow.mul(0.1)));
  return mat;
}

// =====================================================================================================================
// 5. LAND MASSES, BULKHEADS & THE PALISADES RIDGE
// =====================================================================================================================

const LAND_BOTTOM_Y = -3.6;

function smooth01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

// Granite / concrete bulkheads: block courses, weathering and a dark algae band at the waterline
function createBulkheadMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.86, metalness: 0.0 });
  const wp = positionWorld;
  const courseV = wp.y.div(0.85).toVar();
  const course = boxPulse(courseV, 0.0, 0.92, fwidth(courseV));
  const n = valueNoise(vec2(wp.x.add(wp.z).mul(0.09), wp.y.mul(0.6)));
  const stone = mix(srgb(0.42, 0.41, 0.39), srgb(0.55, 0.53, 0.50), n).mul(mix(float(0.8), float(1.0), course));
  const wet = float(1.0).sub(smoothstep(-1.95, -1.0, wp.y));
  mat.colorNode = mix(stone, srgb(0.2, 0.22, 0.18), wet.mul(0.85));
  mat.roughnessNode = mix(float(0.9), float(0.45), wet);
  return mat;
}

// Flat land tops (earcut-triangulated shoreline polygons) + vertical bulkhead walls down into the harbor along the real
// shores (not along the data's straight closures, the borders between land masses or beyond the fogged horizon)
function buildLandGeometries() {
  const topPos = [];
  const topIdx = [];
  const wallPos = [];
  const wallNrm = [];
  const mb = polygonBounds(MANHATTAN_COASTLINE);
  const onManhattanGrid = (x, z) => x > mb.minX && x < mb.maxX && z > mb.minZ && z < mb.maxZ && pointInPolygon(MANHATTAN_COASTLINE, x, z);

  for (const land of LAND) {
    const pts = land.pts;
    const base = topPos.length / 3;
    for (const p of pts) topPos.push(p.x, land.top, p.z);
    const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.x, p.z)), []);
    for (const t of tris) {
      const a = pts[t[0]];
      const b = pts[t[1]];
      const c = pts[t[2]];
      const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
      if (up) topIdx.push(base + t[0], base + t[1], base + t[2]);
      else topIdx.push(base + t[0], base + t[2], base + t[1]);
    }
    if (land.filler) continue;

    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3 || len > ARTIFICIAL_EDGE) continue;
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      if (Math.hypot(mx, mz) > 32000) continue;
      let nx = dz / len;
      let nz = -dx / len;
      if (insideIndexed(land.index, mx + nx * 0.5, mz + nz * 0.5)) {
        nx = -nx;
        nz = -nz;
      }
      const other = landAt(mx + nx * 1.5, mz + nz * 1.5);
      if ((other && other !== land) || onManhattanGrid(mx + nx * 1.5, mz + nz * 1.5)) continue;
      const at = [a.x, land.top, a.z];
      const ab = [a.x, LAND_BOTTOM_Y, a.z];
      const bt = [b.x, land.top, b.z];
      const bb = [b.x, LAND_BOTTOM_Y, b.z];
      // (a_top, a_bot, b_bot) faces (-dz, 0, dx)
      const quad = -dz * nx + dx * nz > 0 ? [at, ab, bb, at, bb, bt] : [at, bb, ab, at, bt, bb];
      for (const v of quad) {
        wallPos.push(v[0], v[1], v[2]);
        wallNrm.push(nx, 0, nz);
      }
    }
  }

  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3));
  const topNrm = new Float32Array(topPos.length);
  for (let i = 1; i < topNrm.length; i += 3) topNrm[i] = 1;
  topGeo.setAttribute('normal', new THREE.BufferAttribute(topNrm, 3));
  topGeo.setIndex(topIdx);

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wallNrm, 3));
  return { topGeo, wallGeo };
}

// The Palisades: a heightfield ridge whose cliff foot follows the real New Jersey shore. North of Weehawken the diabase
// cliffs rise straight behind the narrow Edgewater strip; south of it the ridge swings behind Hoboken and fades into the
// low Bergen Hill ridge of Jersey City Heights and Bayonne. Keys (north to south): crest height h (m), cliff width cw
// (foot to crest, m) and the crest's place: `set` = metres inland of the shore, or `x` = an absolute crest x where the
// ridge leaves the shore behind or must meet a structure (the George Washington Bridge deck lands on the cliff top at
// its New Jersey anchorage).
const RIDGE_Z0 = -60000;
const RIDGE_Z1 = 14000;
const RIDGE_BACK = 1800; // nominal reach of the gentle western slope behind the crest (less where Newark Bay is near)

const GWB_SPEC = OUTER_BRIDGES.find((b) => b.type === 'gwb');
const GWB_ANCHOR_NJ = GWB_SPEC ? (() => {
  const L = Math.hypot(GWB_SPEC.b.x - GWB_SPEC.a.x, GWB_SPEC.b.z - GWB_SPEC.a.z);
  const t = GWB_SPEC.towers[1] + GWB_SPEC.sideSpan[1] / L;
  return { x: GWB_SPEC.a.x + (GWB_SPEC.b.x - GWB_SPEC.a.x) * t, z: GWB_SPEC.a.z + (GWB_SPEC.b.z - GWB_SPEC.a.z) * t };
})() : null;

const RIDGE_KEYS = [
  { z: -60000, h: 150, cw: 120, set: 260 },
  { z: -26000, h: 160, cw: 120, set: 260 }, // State Line Lookout
  { z: -20000, h: 140, cw: 110, set: 250 }, // Alpine
  { z: -15000, h: 115, cw: 100, set: 230 }, // Englewood Cliffs
  { z: -12200, h: 92, cw: 90, set: 210 },
  { z: -11300, h: 78, cw: 75, set: 190 },
  ...(GWB_ANCHOR_NJ ? [{ z: GWB_ANCHOR_NJ.z, h: 66, cw: 60, x: GWB_ANCHOR_NJ.x + 40 }] : []), // Fort Lee
  { z: -9900, h: 76, cw: 80, set: 200 },
  { z: -8700, h: 80, cw: 90, set: 300 }, // Edgewater begins below the cliffs
  { z: -7300, h: 80, cw: 95, set: 440 }, // Edgewater / Cliffside Park
  { z: -5500, h: 76, cw: 95, set: 470 },
  { z: -4000, h: 70, cw: 90, set: 470 }, // North Bergen
  { z: -2800, h: 62, cw: 85, set: 380 }, // Guttenberg (Galaxy Towers on the crest)
  { z: -1000, h: 58, cw: 80, set: 420 }, // West New York / Port Imperial
  { z: 0, h: 55, cw: 80, set: 380 }, // Weehawken
  { z: 700, h: 52, cw: 90, set: 560 },
  { z: 1700, h: 48, cw: 110, x: -4150 }, // behind Hoboken
  { z: 2900, h: 46, cw: 130, x: -4230 }, // 9th St-Congress St (cliff foot) & Jersey City Heights
  { z: 4300, h: 43, cw: 160, x: -4420 },
  { z: 5500, h: 40, cw: 200, x: -4650 }, // Journal Square
  { z: 7200, h: 33, cw: 240, x: -4900 }, // Bergen-Lafayette
  { z: 9200, h: 24, cw: 260, x: -5050 }, // Greenville
  { z: 11200, h: 15, cw: 260, x: -5100 }, // Bayonne
  { z: 12800, h: 7, cw: 260, x: -5000 },
  { z: RIDGE_Z1, h: 0, cw: 260, x: -4900 }
];

// Per-z table (20 m rows) of the cliff foot x, crest height, cliff width, back-slope reach and the foot's limit
const RIDGE_TABLE = (() => {
  const step = 20;
  const n = Math.floor((RIDGE_Z1 - RIDGE_Z0) / step) + 1;
  const ix = NJ_LAND.index;
  const zAt = (i) => RIDGE_Z0 + i * step;

  // 1. The Hudson / Upper Bay shore: the easternmost crossing of the New Jersey outline; where that is one of the data's
  //    straight closures (no real shore there) the shore carries on along the trend of the last real stretch
  const shore = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const z = zAt(i);
    if (z <= ix.b.minZ || z >= ix.b.maxZ) continue;
    let best = -Infinity;
    let real = false;
    for (const e of ix.bands[Math.floor((z - ix.b.minZ) / BAND)]) {
      const p = ix.pts[e];
      const q = ix.pts[(e + 1) % ix.n];
      if ((p.z > z) === (q.z > z)) continue;
      const x = p.x + ((z - p.z) / (q.z - p.z)) * (q.x - p.x);
      if (x > best) {
        best = x;
        real = Math.hypot(q.x - p.x, q.z - p.z) <= ARTIFICIAL_EDGE;
      }
    }
    if (real) shore[i] = best;
  }
  const known = [];
  for (let i = 0; i < n; i++) if (!Number.isNaN(shore[i])) known.push(i);
  // (the first & last 400 m of real shore next to a closure are usually its joint, so the trend is taken inside them)
  const extrapolate = (from, dir) => {
    const k = Math.min(known.length - 1, Math.max(0, known.indexOf(from) + dir * 100));
    const to = known[k];
    const slope = to !== from ? Math.max(-0.3, Math.min(0.3, (shore[to] - shore[from]) / (zAt(to) - zAt(from)))) : 0;
    return (i) => shore[from] + slope * (zAt(i) - zAt(from));
  };
  if (known.length) {
    const first = known[Math.min(known.length - 1, 20)];
    const last = known[Math.max(0, known.length - 21)];
    const north = extrapolate(first, 1);
    const south = extrapolate(last, -1);
    for (let i = 0; i < first; i++) shore[i] = north(i);
    for (let i = last + 1; i < n; i++) shore[i] = south(i);
    for (let a = 0; a + 1 < known.length; a++) {
      const i0 = known[a];
      const i1 = known[a + 1];
      if (i0 < first || i1 > last) continue;
      for (let i = i0 + 1; i < i1; i++) shore[i] = shore[i0] + ((shore[i1] - shore[i0]) * (i - i0)) / (i1 - i0);
    }
  } else {
    shore.fill(-3300);
  }
  // behind coves & slips: the westernmost shore within 120 m, then rounded off over ~200 m
  const minFilter = (src, r) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) m = Math.min(m, src[j]);
      out[i] = m;
    }
    return out;
  };
  const boxFilter = (arr, r, passes) => {
    const tmp = new Float32Array(n);
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        let c = 0;
        for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
          s += arr[j];
          c++;
        }
        tmp[i] = s / c;
      }
      arr.set(tmp);
    }
    return arr;
  };
  const ref = boxFilter(minFilter(shore, 6), 10, 2);

  // 2. Keys -> crest, height, cliff width
  const K = RIDGE_KEYS;
  const lerpKeys = (z, keys, get) => {
    if (!keys.length) return 0;
    if (z <= keys[0].z) return get(keys[0]);
    for (let k = 0; k + 1 < keys.length; k++) {
      if (z <= keys[k + 1].z) {
        const t = (z - keys[k].z) / (keys[k + 1].z - keys[k].z);
        return get(keys[k]) + (get(keys[k + 1]) - get(keys[k])) * t;
      }
    }
    return get(keys[keys.length - 1]);
  };
  const setKeys = K.filter((k) => k.set !== undefined);
  const absKeys = K.filter((k) => k.x !== undefined);
  const crest = new Float32Array(n);
  const h = new Float32Array(n);
  const cw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = zAt(i);
    const w = lerpKeys(z, K, (k) => (k.x !== undefined ? 1 : 0));
    const fromShore = ref[i] - lerpKeys(z, setKeys, (k) => k.set);
    crest[i] = fromShore + (lerpKeys(z, absKeys, (k) => k.x) - fromShore) * w;
    h[i] = lerpKeys(z, K, (k) => k.h);
    cw[i] = lerpKeys(z, K, (k) => k.cw);
  }
  boxFilter(crest, 3, 3);

  // 3. Keep the ridge on its land: the cliff foot (and its buried skirt) short of the water on the east, the back slope
  //    short of the Hackensack / Newark Bay on the west
  const eastLim = new Float32Array(n);
  const backLim = new Float32Array(n);
  const xs = [];
  for (let i = 0; i < n; i++) {
    rowCrossings(ix, zAt(i), xs);
    let L = -Infinity;
    let R = Math.min(shore[i], crest[i] + cw[i] + 400);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      if (crest[i] >= xs[s] && crest[i] <= xs[s + 1]) {
        L = xs[s];
        R = Math.min(xs[s + 1], shore[i]);
        break;
      }
    }
    eastLim[i] = R;
    backLim[i] = crest[i] - L;
  }
  const eastE = minFilter(eastLim, 5);
  const backE = minFilter(backLim, 5);
  const footX = new Float32Array(n);
  const footMax = new Float32Array(n);
  const back = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    footMax[i] = eastE[i] - 30;
    let foot = crest[i] + cw[i];
    if (foot > footMax[i]) {
      foot = footMax[i];
      cw[i] = Math.max(30, foot - crest[i]);
    }
    footX[i] = foot;
    back[i] = Math.max(0, Math.min(RIDGE_BACK, backE[i] - 60));
    h[i] *= smooth01((back[i] - 120) / 480);
  }
  // Round off the polyline corners
  boxFilter(footX, 3, 3);
  boxFilter(h, 3, 3);
  boxFilter(cw, 3, 3);
  for (let i = 0; i < n; i++) footX[i] = Math.min(footX[i], footMax[i]);
  return { step, n, x: footX, h, cw, back, footMax };
})();

// Gullies & buttresses: the cliff line wanders a few metres and the crest height breathes (wavelengths the mesh rows
// resolve), calm where the George Washington Bridge lands on the cliff top and far north where the rows are sparse
const GWB_Z = GWB_ANCHOR_NJ ? GWB_ANCHOR_NJ.z : -10640;
function ridgeJitter(z) {
  const fine = smooth01((z + 13000) / 400) * (1 - smooth01((z - 6000) / 400));
  const all = smooth01((z + 22000) / 600) * smooth01((Math.abs(z - GWB_Z) - 120) / 300);
  return all * (9.0 * Math.sin(z * 0.005 + 0.7) + (6.0 * Math.sin(z * 0.0112 + 2.1) + 3.5 * Math.sin(z * 0.022 + 4.0)) * fine);
}

function ridgeParamsAt(z) {
  const T = RIDGE_TABLE;
  const f = Math.max(0, Math.min(T.n - 1.001, (z - RIDGE_Z0) / T.step));
  const i = Math.floor(f);
  const t = f - i;
  const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * t;
  const j = ridgeJitter(z);
  return {
    x: Math.min(lerp(T.x) + j, lerp(T.footMax)),
    h: lerp(T.h) * (1 + 0.004 * j),
    cw: Math.max(25, lerp(T.cw) - 0.4 * j),
    back: lerp(T.back)
  };
}

// Height above the New Jersey ground at horizontal distance d west of the cliff foot (back = reach of the back slope)
function ridgeProfile(d, h, cw, back) {
  if (d <= -12) return -1.5;
  if (d <= 0) return -1.5 * (-d / 12);
  if (d < cw) {
    // wooded talus up to ~40% of the height, then the bare columnar cliff
    const t = d / cw;
    const talus = 0.4 * smooth01(t / 0.62);
    const face = 0.56 * smooth01((t - 0.55) / 0.4);
    return h * (talus + face);
  }
  const b = d - cw;
  if (b >= back) return -1.5;
  const crest = 0.96 + 0.04 * smooth01(b / 30);
  const b1 = back * 0.5;
  const fall = b < b1 ? 1 - 0.2 * (b / b1) : 0.8 * (1 - smooth01((b - b1) / (back * 0.47)));
  return h * crest * fall;
}

function ridgeHeightAt(x, z) {
  if (z < RIDGE_Z0 || z > RIDGE_Z1) return 0;
  const r = ridgeParamsAt(z);
  const d = r.x - x;
  if (d <= 0 || d >= r.cw + r.back) return 0;
  return Math.max(0, ridgeProfile(d, r.h, r.cw, r.back));
}

// Heightfield sheared along the cliff foot (rows of constant z, columns at fixed distances west of the foot), so it can
// never fold over; dense columns resolve the talus and the cliff face, the skirt edges are buried below the ground.
function buildRidgeGeometry() {
  const rows = [];
  for (let z = RIDGE_Z0; z < -26000; z += 1000) rows.push(z);
  for (let z = -26000; z < -14000; z += 120) rows.push(z);
  for (let z = -14000; z < 9000; z += 30) rows.push(z);
  for (let z = 9000; z < RIDGE_Z1; z += 60) rows.push(z);
  rows.push(RIDGE_Z1);
  const faceFr = [0.15, 0.3, 0.45, 0.55, 0.62, 0.7, 0.78, 0.86, 0.93, 1.0];
  const backFr = [0.006, 0.016, 0.031, 0.0625, 0.125, 0.219, 0.344, 0.469, 0.594, 0.719, 0.844, 0.9375, 0.969, 1.0];
  const nc = 2 + faceFr.length + backFr.length;
  const pos = new Float32Array(rows.length * nc * 3);
  let o = 0;
  for (const z of rows) {
    const r = ridgeParamsAt(z);
    const back = Math.max(r.back, 20);
    const ds = [-12, 0, ...faceFr.map((f) => f * r.cw), ...backFr.map((b) => r.cw + b * back)];
    for (const d of ds) {
      pos[o++] = r.x - d;
      pos[o++] = r.h > 0.5 ? ridgeProfile(d, r.h, r.cw, back) : -1.5;
      pos[o++] = z;
    }
  }
  const idx = [];
  for (let rI = 0; rI < rows.length - 1; rI++) {
    for (let c = 0; c < nc - 1; c++) {
      const a = rI * nc + c;
      const b = a + 1;
      const d = a + nc;
      const e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// =====================================================================================================================
// 6. BOROUGH BUILDINGS (instanced boxes standing on the neighbourhood grids)
// =====================================================================================================================

// Unit box with its base at y = 0 and no bottom face
const BOX_GEO = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const src = g.index.array;
  const keep = [];
  for (let i = 0; i < src.length; i++) if (i < 18 || i >= 24) keep.push(src[i]);
  g.setIndex(keep);
  g.clearGroups();
  return g;
})();

// Facade swatches in sRGB (converted to linear when the instance tints are written)
const PALETTE = {
  brick: [[0.56, 0.31, 0.23], [0.50, 0.28, 0.21], [0.62, 0.39, 0.29], [0.45, 0.27, 0.21], [0.60, 0.35, 0.26], [0.68, 0.52, 0.40], [0.74, 0.64, 0.52]],
  brownstone: [[0.43, 0.30, 0.24], [0.48, 0.34, 0.27], [0.39, 0.28, 0.23], [0.55, 0.39, 0.29], [0.64, 0.55, 0.45]],
  light: [[0.76, 0.71, 0.62], [0.70, 0.66, 0.58], [0.82, 0.80, 0.76], [0.73, 0.63, 0.51], [0.78, 0.74, 0.67]],
  glass: [[0.32, 0.39, 0.44], [0.38, 0.44, 0.48], [0.42, 0.46, 0.50], [0.30, 0.40, 0.42], [0.22, 0.25, 0.29], [0.47, 0.50, 0.52]],
  industrial: [[0.58, 0.55, 0.50], [0.62, 0.42, 0.34], [0.72, 0.72, 0.70], [0.50, 0.48, 0.45], [0.66, 0.63, 0.57]],
  modern: [[0.86, 0.85, 0.83], [0.68, 0.68, 0.67], [0.77, 0.73, 0.67], [0.57, 0.59, 0.61]],
  siding: [[0.80, 0.78, 0.74], [0.71, 0.68, 0.63], [0.64, 0.69, 0.72], [0.82, 0.78, 0.67], [0.60, 0.40, 0.33], [0.75, 0.71, 0.63]]
};
const PALETTE_STYLE = { brick: 0, brownstone: 4, light: 4, glass: 1, industrial: 2, modern: 3, siding: 0 };

const pickFrom = (arr, rand) => arr[Math.floor(rand() * arr.length) % arr.length];

const BUILD_LANDS = new Set(['nj', 'li', 'upper', 'bronx', 'si']);
// Generic blocks out to ~9 km from Manhattan's shore (the aerial perspective swallows the city beyond ~8 km; the ground
// shader carries the street grids on to the horizon)
const MAX_BUILD_DIST = 9000;

// World rectangles searched for each zone's blocks: the zone map's extent within reach of Manhattan
const BUILD_REGIONS = (() => {
  const regions = {};
  const sx = (LU.maxX - LU.minX) / LU.w;
  const sz = (LU.maxZ - LU.minZ) / LU.h;
  for (let j = 0; j < LU.h; j += 2) {
    const z = LU.minZ + (j + 0.5) * sz;
    for (let i = 0; i < LU.w; i += 2) {
      const id = zoneData[j * LU.w + i];
      if (id === 255 || id === ZONES.island.index) continue;
      const x = LU.minX + (i + 0.5) * sx;
      if (distToManhattan(x, z) > MAX_BUILD_DIST + 200) continue;
      const key = ZONE_LIST[id].id;
      const r = regions[key] || (regions[key] = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
      r.x0 = Math.min(r.x0, x - 2 * sx);
      r.x1 = Math.max(r.x1, x + 2 * sx);
      r.z0 = Math.min(r.z0, z - 2 * sz);
      r.z1 = Math.max(r.z1, z + 2 * sz);
    }
  }
  return regions;
})();

// Waterfront & downtown high-rise clusters (radii in m): blocks inside get podium + tower massing
const hotspot = (lon, lat, r, h0, h1, p, style) => ({ ...LL(lon, lat), r, h0, h1, p, style });
const TOWER_HOTSPOTS = [
  hotspot(-74.0345, 40.7160, 620, 90, 230, 0.6),             // Jersey City: Exchange Place / Paulus Hook / Harborside
  hotspot(-74.0345, 40.7268, 460, 70, 170, 0.55),            // Newport
  hotspot(-74.0628, 40.7328, 330, 50, 180, 0.3),             // Journal Square
  hotspot(-74.0272, 40.7425, 260, 30, 70, 0.3),              // Hoboken waterfront
  hotspot(-74.0175, 40.7705, 900, 24, 60, 0.3),              // Weehawken / Port Imperial / Lincoln Harbor
  hotspot(-73.9800, 40.8200, 1500, 22, 55, 0.25),            // Edgewater
  hotspot(-73.9725, 40.8500, 650, 80, 150, 0.4),             // Fort Lee
  hotspot(-73.9440, 40.7470, 420, 80, 200, 0.55),            // Long Island City: Court Square
  hotspot(-73.9385, 40.7500, 380, 70, 190, 0.5),             // Queens Plaza
  hotspot(-73.9560, 40.7440, 420, 60, 150, 0.6),             // Hunters Point
  hotspot(-73.9345, 40.7745, 300, 40, 110, 0.45),            // Hallets Point / Astoria Cove
  hotspot(-73.9585, 40.7375, 260, 70, 180, 0.5),             // Greenpoint Landing
  hotspot(-73.9630, 40.7185, 500, 40, 130, 0.45),            // Williamsburg waterfront
  hotspot(-73.9850, 40.6915, 560, 80, 240, 0.55),            // Downtown Brooklyn
  hotspot(-73.9880, 40.7030, 210, 28, 50, 0.55, 2),          // DUMBO warehouses
  hotspot(-73.9775, 40.6845, 260, 50, 140, 0.35),            // Atlantic Terminal
  hotspot(-73.9255, 40.8215, 520, 26, 50, 0.25, 4),          // Grand Concourse (149th - 161st St)
  hotspot(-73.9195, 40.8335, 520, 26, 50, 0.25, 4),          // Grand Concourse (161st - 170th St)
  hotspot(-73.9130, 40.8455, 520, 26, 50, 0.25, 4)           // Grand Concourse (170th - Tremont)
];

// Individually placed skyline landmarks (real places; heights in m; w along the local grid's u axis, d along v)
const tower = (name, lon, lat, w, d, h, style, tint, extra = {}) => ({ name, ...LL(lon, lat), w, d, h, style, tint, ...extra });
const SIGNATURE_TOWERS = [
  tower('99 Hudson Street', -74.0347, 40.7150, 30, 26, 270, 1, [0.24, 0.28, 0.31]),
  tower('Goldman Sachs Tower', -74.0337, 40.7144, 40, 30, 238, 1, [0.30, 0.36, 0.40]),
  tower('Urby Jersey City', -74.0348, 40.7182, 28, 24, 213, 3, [0.78, 0.77, 0.74]),
  tower('Trump Plaza Jersey City', -74.0370, 40.7198, 28, 22, 163, 1, [0.20, 0.23, 0.27]),
  tower('Newport Tower', -74.0338, 40.7268, 40, 32, 161, 1, [0.26, 0.30, 0.33]),
  tower('The One Journal Square', -74.0632, 40.7322, 32, 26, 215, 1, [0.30, 0.33, 0.36]),
  tower('Skyline Tower', -73.9446, 40.7480, 30, 30, 237, 1, [0.16, 0.20, 0.25]),
  tower('One Court Square', -73.9430, 40.7471, 42, 36, 205, 1, [0.14, 0.27, 0.26]),
  tower('Queens Plaza Park', -73.9392, 40.7509, 30, 26, 228, 1, [0.24, 0.27, 0.30]),
  tower('The Brooklyn Tower', -73.9836, 40.6904, 34, 34, 325, 1, [0.10, 0.11, 0.13], { crown: true }),
  tower('Brooklyn Point', -73.9822, 40.6913, 28, 28, 219, 1, [0.36, 0.38, 0.40]),
  tower('The Hub', -73.9805, 40.6871, 30, 28, 230, 3, [0.62, 0.62, 0.62]),
  tower('Williamsburgh Savings Bank Tower', -73.9775, 40.6855, 26, 26, 156, 4, [0.66, 0.58, 0.45], { crown: true }),
  tower('Fort Lee Twin Tower North', -73.9712, 40.8512, 26, 44, 140, 3, [0.72, 0.70, 0.66]),
  tower('Fort Lee Twin Tower South', -73.9722, 40.8500, 26, 44, 140, 3, [0.72, 0.70, 0.66]),
  tower('Galaxy Tower 1', -74.0042, 40.7906, 34, 34, 125, 3, [0.55, 0.52, 0.48]),
  tower('Galaxy Tower 2', -74.0036, 40.7914, 34, 34, 125, 3, [0.55, 0.52, 0.48]),
  tower('Galaxy Tower 3', -74.0028, 40.7921, 34, 34, 125, 3, [0.55, 0.52, 0.48])
];

// Areas kept free of generic buildings (bridge approaches, landmark sites)
const EXCLUSIONS = [];
function addExclusionCircle(x, z, r) {
  EXCLUSIONS.push({ x, z, r, test: (px, pz) => (px - x) * (px - x) + (pz - z) * (pz - z) < r * r });
}
function addExclusionCapsule(ax, az, bx, bz, hw) {
  EXCLUSIONS.push({
    x: (ax + bx) * 0.5,
    z: (az + bz) * 0.5,
    r: Math.hypot(bx - ax, bz - az) * 0.5 + hw,
    test: (px, pz) => distToSegment(px, pz, ax, az, bx, bz) < hw
  });
}
function exclusionsNear(x, z, r) {
  return EXCLUSIONS.filter((e) => Math.hypot(e.x - x, e.z - z) < e.r + r);
}

// Building character by borough & neighbourhood (heights, palette, lot width, row depth in m)
function neighbourhood(land, zone, x, z, lu) {
  const H = (hMin, hMax, palette, lot, extra = {}) => ({
    hMin, hMax, palette, style: PALETTE_STYLE[palette], lot,
    kind: 'urban', tall: 0, tallH: [30, 45], gap: 0.04, projects: 0, depth: 15, ...extra
  });
  if (lu.industry > 0.5 && lu.park < 0.35) return H(8, 18, 'industrial', 34, { kind: 'industrial', gap: 0.15, depth: 30 });
  if (lu.suburb > 0.55) return H(6.5, 9.5, 'siding', 11, { kind: 'suburb', gap: 0.18, depth: 10 });
  switch (land.borough) {
    case 'upper': return H(17, 26, 'brick', 9, { tall: 0.1, tallH: [36, 58], projects: 0.04, depth: 20 });
    case 'bronx': return H(14, 24, 'brick', 9, { tall: 0.08, tallH: [38, 60], projects: 0.05, gap: 0.07, depth: 20 });
    case 'si': return H(7, 11, 'siding', 12, { kind: 'suburb', gap: 0.2, depth: 11 });
    case 'nj':
      if (zone.id === 'nj' && z < 3850) return H(12, 18, 'brownstone', 6.5, { tall: 0.04, tallH: [30, 50], depth: 15 }); // Hoboken
      if (zone.id === 'nj') return H(12, 20, 'brick', 8, { tall: 0.08, tallH: [30, 60], depth: 16 });                     // Downtown Jersey City
      if (zone.id === 'njwest') return H(8, 13, 'siding', 9, { tall: 0.02, tallH: [20, 32], gap: 0.08, depth: 13 });      // Kearny, Harrison, Secaucus
      if (z < 1500 && x > ridgeParamsAt(z).x) return H(14, 30, 'modern', 14, { tall: 0.1, tallH: [35, 60], depth: 18 }); // Edgewater strip & Port Imperial
      return H(9, 15, 'siding', 7.5, { tall: 0.04, tallH: [24, 40], gap: 0.06, depth: 14 });                               // Union City, West NY, JC Heights, Bayonne
    case 'queens':
      if (z < -2600) return H(9, 14, 'brick', 8, { tall: 0.04, tallH: [24, 40], projects: 0.02, depth: 16 });             // Astoria
      if (x < 4000) return H(10, 18, 'brick', 10, { tall: 0.06, tallH: [30, 50], depth: 18 });                            // Long Island City
      return H(12, 20, 'light', 12, { tall: 0.04, tallH: [24, 40], depth: 18 });                                           // Sunnyside, Woodside, Jackson Heights
    case 'brooklyn':
      if (z < 4400) return H(9, 15, 'siding', 7, { tall: 0.04, tallH: [24, 42], depth: 14 });                             // Greenpoint / Williamsburg / Bushwick
      if (x < 4800 && z < 9500) return H(12, 17, 'brownstone', 6.5, { tall: 0.03, tallH: [30, 50], depth: 15 });          // Brooklyn Heights, Cobble Hill, Park Slope
      if (z < 9500) return H(10, 15, 'brownstone', 6.5, { tall: 0.03, tallH: [24, 40], projects: 0.03, depth: 15 });      // Fort Greene, Bed-Stuy, Crown Heights
      return H(10, 16, 'brick', 8, { tall: 0.05, tallH: [24, 45], projects: 0.02, depth: 15 });                           // Sunset Park, Bay Ridge, Flatbush
    default:
      return H(9, 15, 'brick', 9);
  }
}

function hotspotAt(x, z) {
  let best = null;
  let bestP = 0;
  for (const s of TOWER_HOTSPOTS) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d >= s.r) continue;
    const fall = 1 - (d / s.r) * (d / s.r);
    if (s.p * fall > bestP) {
      bestP = s.p * fall;
      best = { spec: s, fall, p: bestP };
    }
  }
  return best;
}

/**
 * Lays out one city block: two rows of lots facing the long streets (row houses, tenements, walk-ups), industrial
 * sheds, suburban houses, NYCHA towers in the park or a podium + tower cluster in the high-rise hotspots.
 */
function generateBlock(list, zone, land, i, j, c, dM, lu, rand) {
  const rot = (-zone.angle * Math.PI) / 180;
  const u0 = i * zone.pu + zone.su * 0.5 + 2.2;
  const u1 = (i + 1) * zone.pu - zone.su * 0.5 - 2.2;
  const v0 = j * zone.pv + zone.sv * 0.5 + 2.2;
  const v1 = (j + 1) * zone.pv - zone.sv * 0.5 - 2.2;
  const bw = u1 - u0;
  const bd = v1 - v0;
  const radius = Math.hypot(bw, bd) * 0.5;
  const nearShore = shoreDist(land, c.x, c.z, radius + 12) < radius + 8;
  const nearEx = exclusionsNear(c.x, c.z, radius + 4);
  const onRidge = land.id === 'nj' && c.z > RIDGE_Z0 && c.z < RIDGE_Z1 && c.x < ridgeParamsAt(c.z).x + 15;
  const hood = neighbourhood(land, zone, c.x, c.z, lu);

  // Footprint centred at (uc, vc) in zone coordinates, w along u, d along v
  const place = (uc, vc, w, d, h, tint, style) => {
    const p = zoneToWorld(zone, uc, vc);
    let y0 = land.top;
    if (nearShore || nearEx.length || onRidge) {
      let rMin = Infinity;
      let rMax = -Infinity;
      for (let k = 0; k < 9; k++) {
        const cu = k === 8 ? 0 : [-1, 0, 1, 1, 1, 0, -1, -1][k] * w * 0.5;
        const cv = k === 8 ? 0 : [-1, -1, -1, 0, 1, 1, 1, 0][k] * d * 0.5;
        const q = k === 8 ? p : zoneToWorld(zone, uc + cu, vc + cv);
        if (nearShore && k !== 8 && (landAt(q.x, q.z) !== land || shoreDist(land, q.x, q.z, 8) < 5)) return null;
        for (const ex of nearEx) if (ex.test(q.x, q.z)) return null;
        if (onRidge) {
          const rh = ridgeHeightAt(q.x, q.z);
          rMin = Math.min(rMin, rh);
          rMax = Math.max(rMax, rh);
        }
      }
      if (onRidge) {
        if (rMax - rMin > 2.5) return null;
        if (rMax > 0.01) y0 += rMin - 0.4;
      }
    }
    const rec = { x: p.x, y: y0, z: p.z, w, h, d, rot, tint, style, seed: rand() * 100 };
    list.push(rec);
    return rec;
  };
  // Small roof structures (stair / elevator bulkheads) add relief to the roofscape
  const roofBox = (rec, uc, vc) => {
    if (!rec || rec.h < 16 || dM > 2000 || rand() > 0.3) return;
    const p = zoneToWorld(zone, uc + (rand() - 0.5) * rec.w * 0.4, vc + (rand() - 0.5) * rec.d * 0.3);
    list.push({ x: p.x, y: rec.y + rec.h, z: p.z, w: Math.max(2.5, rec.w * 0.3), h: 2.8 + rand() * 1.6, d: Math.max(2.5, rec.d * 0.3), rot, tint: rec.tint, style: 2, seed: rand() * 100 });
  };

  const uc = (u0 + u1) * 0.5;
  const vc = (v0 + v1) * 0.5;

  // High-rise hotspots: podium + one to three towers
  const hs = hotspotAt(c.x, c.z);
  if (hs && rand() < hs.p) {
    const s = hs.spec;
    if (s.style === 2 || s.style === 4) {
      const h = s.h0 + (s.h1 - s.h0) * rand() * (0.5 + 0.5 * hs.fall);
      const pal = s.style === 2 ? (rand() < 0.7 ? PALETTE.brick : PALETTE.industrial) : PALETTE.light;
      const segs = Math.max(1, Math.round(bw / 70));
      for (let k = 0; k < segs; k++) {
        const tu = u0 + (bw / segs) * (k + 0.5);
        for (const side of [0, 1]) {
          const d = bd * (0.38 + rand() * 0.1);
          const tv = side === 0 ? v0 + d * 0.5 : v1 - d * 0.5;
          roofBox(place(tu, tv, (bw / segs) * (0.85 + rand() * 0.13), d, h * (0.85 + rand() * 0.3), pickFrom(pal, rand), s.style), tu, tv);
        }
      }
      return;
    }
    const podH = 8 + rand() * 10;
    place(uc, vc, bw * 0.92, bd * 0.9, podH, pickFrom(PALETTE.light, rand), 3);
    const n = Math.max(1, Math.min(3, Math.round((bw / 75) * (0.6 + rand() * 0.8))));
    for (let k = 0; k < n; k++) {
      const tw = Math.min((bw / n) * 0.75, 20 + rand() * 16);
      const td = Math.min(bd * 0.8, 18 + rand() * 14);
      const h = s.h0 + (s.h1 - s.h0) * Math.pow(rand(), 0.8) * (0.55 + 0.45 * hs.fall);
      const r = rand();
      const style = r < 0.62 ? 1 : r < 0.86 ? 3 : 4;
      const tint = pickFrom(style === 1 ? PALETTE.glass : style === 3 ? PALETTE.modern : PALETTE.light, rand);
      const tu = n === 1 ? uc + (rand() - 0.5) * (bw - tw) * 0.6 : u0 + (bw / n) * (k + 0.5);
      const tv = vc + (rand() - 0.5) * (bd - td) * 0.6;
      const rec = place(tu, tv, tw, td, h, tint, style);
      if (rec && h > 110 && rand() < 0.55) {
        const p = zoneToWorld(zone, tu, tv);
        list.push({ x: p.x, y: rec.y + h, z: p.z, w: tw * 0.72, h: 5 + rand() * 9, d: td * 0.72, rot, tint, style, seed: rand() * 100 });
      }
    }
    return;
  }

  // NYCHA "towers in the park": cross-plan brick towers on a lawn
  if (hood.projects && rand() < hood.projects) {
    const n = Math.max(2, Math.min(4, Math.round(bw / 55)));
    const h = 38 + rand() * 24;
    for (let k = 0; k < n; k++) {
      const tu = u0 + (bw / n) * (k + 0.5);
      const tint = pickFrom(PALETTE.brick, rand);
      roofBox(place(tu, vc, Math.min(14, bw / n - 4), Math.min(40, bd - 6), h, tint, 0), tu, vc);
      place(tu, vc, Math.min(34, bw / n - 4), Math.min(14, bd - 6), h, tint, 0);
    }
    return;
  }

  // Industrial blocks: one to three big sheds / warehouses
  if (hood.kind === 'industrial') {
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      if (rand() < hood.gap) continue;
      const segW = bw / n;
      const w = segW * (0.7 + rand() * 0.28);
      const d = bd * (0.55 + rand() * 0.4);
      const tu = u0 + segW * (k + 0.5);
      const tv = vc + (rand() - 0.5) * (bd - d);
      place(tu, tv, w, d, hood.hMin + rand() * (hood.hMax - hood.hMin), pickFrom(PALETTE.industrial, rand), 2);
    }
    return;
  }

  // Lot rows (merged into wider buildings with distance)
  const lod = dM < 650 ? 1 : dM < 1600 ? 2.2 : dM < 3200 ? 3.4 : 5;
  const rowD = Math.min(bd * (hood.kind === 'suburb' ? 0.3 : 0.44), hood.depth);
  const blockH = hood.hMin + (hood.hMax - hood.hMin) * Math.pow(rand(), 1.2);
  const palette = PALETTE[hood.palette];
  const blockTint = pickFrom(palette, rand);
  for (const side of [0, 1]) {
    let u = u0;
    while (u < u1 - 2) {
      let w = hood.lot * lod * (0.75 + rand() * 0.6);
      if (u1 - u - w < hood.lot * 0.6) w = u1 - u;
      if (rand() < hood.gap) {
        u += w;
        continue;
      }
      let h = blockH * (0.85 + rand() * 0.3);
      let d = rowD * (0.8 + rand() * 0.2);
      if (rand() < hood.tall) {
        h = hood.tallH[0] + rand() * (hood.tallH[1] - hood.tallH[0]);
        d = Math.min(bd * 0.5, d * 1.25);
      }
      const suburbGap = hood.kind === 'suburb' ? 1.5 + rand() * 1.5 : 0.25;
      const ww = Math.max(3, w - suburbGap);
      const tint = rand() < 0.55 ? blockTint : pickFrom(palette, rand);
      const vcc = side === 0 ? v0 + d * 0.5 : v1 - d * 0.5;
      roofBox(place(u + w * 0.5, vcc, ww, d, h, tint, hood.style), u + w * 0.5, vcc);
      u += w;
    }
  }
}

// Lowest ridge height under a footprint (what a building standing on the Palisades must reach down to)
function ridgeFloorUnder(x, z, w, d, rot) {
  let m = Infinity;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const [a, b] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
    m = Math.min(m, ridgeHeightAt(x + a * w * c + b * d * s, z - a * w * s + b * d * c));
  }
  return m;
}

function placeSignatureTowers(list) {
  const rand = mulberry32(911);
  for (const t of SIGNATURE_TOWERS) {
    const zone = zoneAt(t.x, t.z);
    const land = landAt(t.x, t.z);
    if (!land) continue;
    const rot = (-zone.angle * Math.PI) / 180;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([a, b]) => landAt(t.x + a * t.w * c + b * t.d * s, t.z - a * t.w * s + b * t.d * c));
    if (corners.some((l) => l !== land)) continue;
    const y0 = land.top + (land.id === 'nj' ? Math.max(0, ridgeFloorUnder(t.x, t.z, t.w, t.d, rot) - 0.5) : 0);
    list.push({ x: t.x, y: y0, z: t.z, w: t.w, h: t.h, d: t.d, rot, tint: t.tint, style: t.style, seed: rand() * 100 });
    if (t.crown) {
      // Setback crown + mechanical top
      list.push({ x: t.x, y: y0 + t.h, z: t.z, w: t.w * 0.72, h: 10, d: t.d * 0.72, rot, tint: t.tint, style: t.style, seed: rand() * 100 });
      list.push({ x: t.x, y: y0 + t.h + 10, z: t.z, w: t.w * 0.42, h: 8, d: t.d * 0.42, rot, tint: t.tint, style: 2, seed: rand() * 100 });
    }
    addExclusionCircle(t.x, t.z, Math.max(t.w, t.d) * 0.75 + 6);
  }
  // Boulevard East & Palisade Ave: apartment towers lining the Palisades crest above Weehawken, West New York,
  // Guttenberg, North Bergen, Cliffside Park and Fort Lee
  for (let z = -10000; z < -250; z += 110 + rand() * 120) {
    if (rand() < 0.4 || Math.abs(z - GWB_Z) < 400) continue;
    const r = ridgeParamsAt(z);
    const x = r.x - r.cw - 25 - rand() * 60;
    if (EXCLUSIONS.some((e) => e.test(x, z)) || landAt(x, z) !== NJ_LAND) continue;
    const zone = zoneAt(x, z);
    const rot = (-zone.angle * Math.PI) / 180;
    const w = 18 + rand() * 10;
    const d = 26 + rand() * 18;
    const floor0 = ridgeFloorUnder(x, z, w, d, rot);
    if (r.h - floor0 > 6) continue;
    const h = 45 + rand() * 75;
    const style = rand() < 0.6 ? 3 : 0;
    const tint = pickFrom(style === 3 ? PALETTE.modern : PALETTE.light, rand);
    list.push({ x, y: Math.max(0, floor0 - 0.5), z, w, h, d, rot, tint, style, seed: rand() * 100 });
    addExclusionCircle(x, z, 30);
  }
}

function generateBoroughBuildings() {
  const list = [];
  const stats = {};
  placeSignatureTowers(list);
  stats.signature = list.length;
  const rand = mulberry32(20261007);
  for (const zone of ZONE_LIST) {
    const reg = BUILD_REGIONS[zone.id];
    if (!reg || zone.id === 'island') continue;
    let umin = Infinity;
    let umax = -Infinity;
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const [x, z] of [[reg.x0, reg.z0], [reg.x1, reg.z0], [reg.x1, reg.z1], [reg.x0, reg.z1]]) {
      const l = zoneToLocal(zone, x, z);
      umin = Math.min(umin, l.u);
      umax = Math.max(umax, l.u);
      vmin = Math.min(vmin, l.v);
      vmax = Math.max(vmax, l.v);
    }
    const before = list.length;
    for (let i = Math.floor(umin / zone.pu); i <= Math.ceil(umax / zone.pu); i++) {
      for (let j = Math.floor(vmin / zone.pv); j <= Math.ceil(vmax / zone.pv); j++) {
        const c = zoneToWorld(zone, (i + 0.5) * zone.pu, (j + 0.5) * zone.pv);
        if (c.x < reg.x0 || c.x > reg.x1 || c.z < reg.z0 || c.z > reg.z1) continue;
        if (zoneAt(c.x, c.z) !== zone) continue;
        const dM = distToManhattan(c.x, c.z);
        if (dM > MAX_BUILD_DIST) continue;
        const land = landAt(c.x, c.z);
        if (!land || !BUILD_LANDS.has(land.id) || land.filler) continue;
        const lu = luAt(c.x, c.z);
        if (lu.park > 0.45 || lu.marsh > 0.45) continue;
        // Thin out with distance (suburbs first); the ground shader carries the texture beyond
        const keep = dM < 1000 ? 1 : 1 - smooth01((dM - 1000) / (MAX_BUILD_DIST - 1000)) * (0.93 + lu.suburb * 0.07);
        if (rand() > keep) continue;
        generateBlock(list, zone, land, i, j, c, dM, lu, rand);
      }
    }
    stats[zone.id] = list.length - before;
  }
  return { list, stats };
}

// Spatially chunked InstancedMeshes (frustum culled per chunk) sharing one facade material
function buildBuildingChunks(list, material, chunkSize, name) {
  const chunks = new Map();
  for (const b of list) {
    const key = Math.floor(b.x / chunkSize) + ',' + Math.floor(b.z / chunkSize);
    let arr = chunks.get(key);
    if (!arr) chunks.set(key, (arr = []));
    arr.push(b);
  }
  const meshes = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (const [key, arr] of chunks) {
    const geo = new THREE.BufferGeometry();
    geo.setIndex(BOX_GEO.index);
    geo.setAttribute('position', BOX_GEO.attributes.position);
    geo.setAttribute('normal', BOX_GEO.attributes.normal);
    const info = new Float32Array(arr.length * 4);
    const tint = new Float32Array(arr.length * 4);
    const mesh = new THREE.InstancedMesh(geo, material, arr.length);
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      q.setFromAxisAngle(yAxis, b.rot);
      m.compose(p.set(b.x, b.y, b.z), q, s.set(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m);
      info[i * 4] = b.w;
      info[i * 4 + 1] = b.h;
      info[i * 4 + 2] = b.d;
      info[i * 4 + 3] = b.seed;
      tint[i * 4] = toLinear(b.tint[0]);
      tint[i * 4 + 1] = toLinear(b.tint[1]);
      tint[i * 4 + 2] = toLinear(b.tint[2]);
      tint[i * 4 + 3] = b.style;
    }
    geo.setAttribute('bInfo', new THREE.InstancedBufferAttribute(info, 4));
    geo.setAttribute('bTint', new THREE.InstancedBufferAttribute(tint, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = name + ':' + key;
    meshes.push(mesh);
  }
  return meshes;
}

// =====================================================================================================================
// 7. HARBOR ISLANDS & BOROUGH LANDMARKS
// =====================================================================================================================

// Collects static parts per material and merges them into one mesh per material (few draw calls)
function createPartCollector() {
  const buckets = new Map();
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const add = (material, geometry, matrix) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    let arr = buckets.get(material);
    if (!arr) buckets.set(material, (arr = []));
    arr.push(g);
  };
  const matrixOf = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) =>
    m.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz)).clone();
  return {
    add,
    matrixOf,
    // Box with its base centre at (x, y, z)
    box(material, x, y, z, w, h, d, ry = 0) {
      add(material, unitBox, matrixOf(x, y, z, w, h, d, 0, ry, 0));
    },
    build(parent, { castShadow = false, receiveShadow = false } = {}) {
      const { mergeGeometries } = window.NYC.Addons;
      for (const [material, geos] of buckets) {
        const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
        parent.add(mesh);
      }
    }
  };
}

// Stone / metal surfaces (sRGB swatch) with a little world-space weathering, optional ashlar coursing (block height
// in metres) and optional night floodlighting. The swatch & amounts are uniforms, so every coursed (or plain) and
// floodlit (or not) landmark shares one shader
function createLandmarkMaterial(rgb, { roughness = 0.8, metalness = 0.0, flood = 0.0, noise = 0.18, courses = 0, side = THREE.FrontSide } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness, metalness, side });
  const base = srgbUniform(rgb[0], rgb[1], rgb[2]);
  const uNoise = uniform(noise);
  const n = valueNoise(positionWorld.xz.mul(0.35).add(positionWorld.y.mul(0.21)));
  const streak = valueNoise(vec2(positionWorld.x.add(positionWorld.z).mul(1.3), positionWorld.y.mul(0.06)));
  let col = base.mul(float(1.0).sub(uNoise).add(n.mul(uNoise.mul(1.2))).mul(mix(float(0.9), float(1.06), streak)));
  if (courses > 0) {
    const uCourses = uniform(courses);
    const cv = positionWorld.y.div(uCourses).toVar();
    const row = floor(cv);
    const along = select(abs(normalWorld.x).greaterThan(abs(normalWorld.z)), positionWorld.z, positionWorld.x);
    const cu = along.div(uCourses.mul(2.3)).add(row.mul(0.5)).toVar();
    const joint = boxPulse(cv, 0.0, 0.92, fwidth(cv)).mul(boxPulse(cu, 0.0, 0.965, fwidth(cu)));
    col = col.mul(mix(float(0.7), float(1.0), joint)).mul(hash12(vec2(floor(cu), row)).mul(0.16).add(0.92));
  }
  mat.colorNode = col;
  if (flood > 0) mat.emissiveNode = col.mul(vec3(1.0, 0.86, 0.68)).mul(nightFactorNode().mul(uniform(flood)));
  return mat;
}

function createEmissiveTrimMaterial(rgb, dayGlow, nightGlow) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.3 });
  const c = srgbUniform(rgb[0], rgb[1], rgb[2]);
  mat.colorNode = c;
  mat.emissiveNode = c.mul(uniform(dayGlow).add(nightFactorNode().mul(uniform(nightGlow))));
  return mat;
}

// Extruded footprint polygon (x, z points relative to the origin) rising from y0 by h
function extrudeFootprint(pts, h, holes = []) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, -p.z))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function starPolygon(points, rOuter, rInner, rot = 0) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return pts;
}

/**
 * Statue of Liberty on Fort Wood's eleven-point star: granite pedestal, copper-green robed figure with the raised torch
 * (gilded flame), crown rays and tablet, facing south-east toward the Narrows. Floodlit at night.
 */
function buildStatueOfLiberty(parts, mats) {
  const { x: sx, z: sz } = LIBERTY_STATUE_POS;
  const top = 0.6;
  // Fort Wood star & pedestal
  parts.add(mats.granite, extrudeFootprint(starPolygon(11, 27, 20, 0.14), 9), parts.matrixOf(sx, top, sz, 1, 1, 1));
  parts.box(mats.granite, sx, top + 9, sz, 24, 5, 24);
  // Hunt's granite pedestal: battered lower shaft, belt course, an upper stage with a columned loggia on every face,
  // projecting cornice and attic (the figure stands at top + 43.8)
  const ped = new THREE.CylinderGeometry(10.6 * Math.SQRT2, 12.0 * Math.SQRT2, 16, 4, 1, true).toNonIndexed();
  ped.computeVertexNormals(); // flat faces (the cylinder's radial normals would round the corners)
  parts.add(mats.granite, ped, parts.matrixOf(sx, top + 14 + 8, sz, 1, 1, 1, 0, Math.PI / 4, 0));
  parts.box(mats.granite, sx, top + 30, sz, 22.6, 1.0, 22.6);
  parts.box(mats.slate, sx, top + 31, sz, 18.4, 7.8, 18.4);
  const column = new THREE.CylinderGeometry(0.4, 0.46, 5.2, 8);
  for (let k = 0; k < 4; k++) {
    const ry = (k * Math.PI) / 2;
    const fx = Math.sin(ry);
    const fz = Math.cos(ry);
    const at = (u, n) => [sx + fx * n + fz * u, sz + fz * n - fx * u];
    // Corner piers either side of the loggia, sill below, lintel above, balcony slab and four columns
    for (const u of [-7.85, 7.85]) {
      const [px, pz] = at(u, 9.7);
      parts.box(mats.granite, px, top + 31, pz, Math.abs(fz) > 0.5 ? 4.7 : 1.0, 7.8, Math.abs(fz) > 0.5 ? 1.0 : 4.7);
    }
    const [lx, lz] = at(0, 9.7);
    const wide = Math.abs(fz) > 0.5;
    parts.box(mats.granite, lx, top + 31, lz, wide ? 11 : 1.0, 0.8, wide ? 1.0 : 11);
    parts.box(mats.granite, lx, top + 37, lz, wide ? 11 : 1.0, 1.8, wide ? 1.0 : 11);
    const [bx, bz] = at(0, 10.4);
    parts.box(mats.granite, bx, top + 31.5, bz, wide ? 12 : 1.6, 0.35, wide ? 1.6 : 12);
    for (const u of [-4.1, -1.37, 1.37, 4.1]) {
      const [cx, cz] = at(u, 9.9);
      parts.add(mats.granite, column, parts.matrixOf(cx, top + 31.8 + 2.6, cz, 1, 1, 1));
    }
  }
  parts.box(mats.granite, sx, top + 38.8, sz, 22.8, 1.4, 22.8);
  parts.box(mats.granite, sx, top + 40.2, sz, 19, 2.0, 19);
  parts.box(mats.granite, sx, top + 42.2, sz, 16, 1.6, 16);

  // The figure (local frame: front = +z, right hand = -x), rotated to face the Narrows
  const facing = Math.atan2(0.961, 0.276);
  const base = new THREE.Matrix4().compose(new THREE.Vector3(sx, top + 43.8, sz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing), new THREE.Vector3(1, 1, 1));
  const local = (geo, x, y, z, sx2 = 1, sy2 = 1, sz2 = 1, rx = 0, ry = 0, rz = 0) =>
    new THREE.Matrix4().multiplyMatrices(base, parts.matrixOf(x, y, z, sx2, sy2, sz2, rx, ry, rz));
  const robe = new THREE.LatheGeometry([
    [4.7, 0], [4.5, 1.5], [4.1, 5], [3.8, 10], [3.55, 15], [3.35, 19], [3.45, 22.5], [3.3, 25.2], [2.6, 26.8], [1.5, 27.6], [0.9, 28.4]
  ].map(([r, y]) => new THREE.Vector2(r, y)), 20);
  parts.add(mats.copper, robe, local(robe, 0, 0, 0, 1, 1, 0.82));
  const head = new THREE.SphereGeometry(1.7, 14, 10);
  parts.add(mats.copper, head, local(head, 0, 29.9, 0.25, 1, 1.18, 1));
  const ray = new THREE.ConeGeometry(0.28, 3.4, 5);
  for (let k = 0; k < 7; k++) {
    const a = (-1.2 + (k / 6) * 2.4);
    parts.add(mats.copper, ray, local(ray, Math.sin(a) * 1.9, 31.4 + Math.cos(a) * 0.9, -0.2, 1, 1, 1, -0.35, 0, -a * 0.95));
  }
  // Raised right arm, torch & gilded flame
  const arm = new THREE.CylinderGeometry(0.72, 0.95, 12.5, 8);
  parts.add(mats.copper, arm, local(arm, -3.25, 33.2, 0.2, 1, 1, 1, 0.05, 0, 0.17));
  const handle = new THREE.CylinderGeometry(0.42, 0.5, 2.6, 8);
  parts.add(mats.copper, handle, local(handle, -4.4, 40.4, 0.5));
  const cup = new THREE.CylinderGeometry(1.15, 0.6, 1.3, 10);
  parts.add(mats.torchRim, cup, local(cup, -4.4, 42.2, 0.5));
  const flame = new THREE.ConeGeometry(0.85, 2.6, 10);
  parts.add(mats.flame, flame, local(flame, -4.4, 44.1, 0.5));
  // Left arm cradling the tablet (July IV MDCCLXXVI)
  const fore = new THREE.CylinderGeometry(0.6, 0.75, 7, 8);
  parts.add(mats.copper, fore, local(fore, 3.0, 20.5, 0.8, 1, 1, 1, 0.5, 0, -0.2));
  parts.add(mats.copper, new THREE.BoxGeometry(1.0, 6.4, 3.4), local(null, 3.6, 21.5, 1.4, 1, 1, 1, 0.25, 0, -0.12));
}

// Ellis Island: the French Renaissance main building (red brick, limestone trim, four copper-domed towers) on the
// northern island and the hospital wings along the southern islands
function buildEllisIsland(parts, mats, list) {
  const { x: cx, z: cz } = LL(-74.0396, 40.6995);
  const top = 0.6;
  parts.box(mats.brick, cx, top, cz, 92, 18, 30);
  parts.box(mats.limestone, cx, top + 18, cz, 93.4, 1.3, 31.4);
  parts.box(mats.slate, cx, top + 19.3, cz, 88, 4.5, 26);
  const dome = new THREE.SphereGeometry(3.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const [dx, dz] of [[-17, -11.5], [17, -11.5], [-17, 11.5], [17, 11.5]]) {
    parts.box(mats.limestone, cx + dx, top, cz + dz, 6, 31, 6);
    parts.add(mats.copper, dome, parts.matrixOf(cx + dx, top + 31, cz + dz, 1, 1.5, 1));
  }
  parts.box(mats.limestone, cx, top, cz - 15.8, 26, 15, 1.6); // arched entrance pavilion
  // Hospital wings: two rows along the southern islands' long axis
  const rand = mulberry32(1892);
  const a = { x: -1615, z: 7885 };
  const b = { x: -1400, z: 7942 };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const rot = -Math.atan2(uz, ux);
  for (let k = 0; k < 9; k++) {
    const t = (k + 0.5) / 9;
    const s = (k % 2 ? 1 : -1) * 22;
    const x = a.x + ux * len * t - uz * s;
    const z = a.z + uz * len * t + ux * s;
    const w = 16;
    const d = 30;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => ({ x: x + p * w * 0.5 * ux - q * d * 0.5 * uz, z: z + p * w * 0.5 * uz + q * d * 0.5 * ux }));
    if (!corners.every((c) => pointInPolygon(ELLIS_ISLAND_POLYGON, c.x, c.z))) continue;
    list.push({ x, y: top, z, w, h: 11 + rand() * 4, d, rot, tint: [0.5, 0.29, 0.21], style: 4, seed: rand() * 100 });
  }
}

// Governors Island: Castle Williams, Fort Jay, Liggett Hall, the Nolan Park & Colonels Row houses and the landscaped
// Hills of the southern island
function buildGovernorsIsland(parts, mats, list, landMat, group) {
  const top = 0.45;
  const castle = new THREE.CylinderGeometry(31, 32, 13, 40, 1);
  parts.add(mats.sandstone, castle, parts.matrixOf(445, top + 6.5, 7480, 1, 1, 1));
  parts.add(mats.sandstone, extrudeFootprint(starPolygon(4, 80, 48, Math.PI / 4), 7, [[{ x: -32, z: -32 }, { x: 32, z: -32 }, { x: 32, z: 32 }, { x: -32, z: 32 }]]), parts.matrixOf(790, top, 7560, 1, 1, 1));
  parts.box(mats.brick, 760, top, 7800, 290, 15, 15);
  parts.box(mats.slate, 760, top + 15, 7800, 288, 3, 12);
  parts.box(mats.limestone, 760, top, 7800, 16, 21, 17);
  const rand = mulberry32(1783);
  for (let k = 0; k < 9; k++) {
    list.push({ x: 820 + (k % 3) * 30, y: top, z: 7365 + Math.floor(k / 3) * 28 + (k % 3) * 6, w: 14, h: 10 + rand() * 4, d: 10, rot: 0, tint: pickFrom(PALETTE.light, rand), style: 4, seed: rand() * 100 });
  }
  for (let k = 0; k < 6; k++) {
    list.push({ x: 600 + (k % 2) * 34, y: top, z: 7600 + Math.floor(k / 2) * 26, w: 24, h: 12 + rand() * 4, d: 11, rot: 0, tint: pickFrom(PALETTE.brick, rand), style: 0, seed: rand() * 100 });
  }
  // The Hills (Outlook, Grassy, Discovery, Slide): smooth grassy mounds on the ground shader
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const r = 1 - i / 10;
    prof.push(new THREE.Vector2(Math.max(0.0001, r), Math.pow(1 - r * r, 2)));
  }
  const mound = new THREE.LatheGeometry(prof, 24);
  for (const [x, z, rx, h, rz] of [[420, 8250, 75, 22, 55], [520, 8140, 45, 12, 36], [610, 8300, 50, 12, 40], [470, 8390, 36, 8, 28]]) {
    const mesh = new THREE.Mesh(mound, landMat);
    mesh.position.set(x, top - 0.4, z);
    mesh.scale.set(rx, h, rz);
    group.add(mesh);
  }
}

// Roosevelt Island's spine (the Octagon, Coler, Northtown's Main Street towers, Southtown, Cornell Tech) placed along
// the real island, and Ward's / Randall's Island buildings
function addIslandBuildings(list) {
  const rand = mulberry32(1976);
  const T = (pal) => pickFrom(PALETTE[pal], rand);
  const R = ROOSEVELT_ISLAND_POLYGON;
  if (R && R.length > 2) {
    const b = polygonBounds(R);
    const ix = indexPolygon(R);
    const span = (z) => {
      const xs = rowCrossings(ix, z);
      return xs.length >= 2 ? { l: xs[0], r: xs[xs.length - 1] } : null;
    };
    // [fraction from the north tip, offset across (-1 west .. 1 east), width across, depth along, height, palette]
    const rows = [
      [0.12, -0.35, 26, 40, 20, 'light'], [0.19, 0.1, 50, 110, 24, 'light'],
      [0.31, 0.4, 24, 70, 42, 'brick'], [0.35, 0.45, 22, 60, 50, 'brick'], [0.38, -0.4, 22, 80, 58, 'brick'],
      [0.42, 0.45, 20, 70, 52, 'brick'], [0.45, -0.4, 20, 70, 60, 'brick'], [0.48, 0.4, 18, 50, 46, 'brick'],
      [0.53, -0.35, 22, 50, 62, 'modern'], [0.56, 0.35, 20, 44, 56, 'modern'], [0.59, -0.3, 22, 44, 66, 'modern'],
      [0.62, 0.3, 18, 40, 58, 'modern'],
      [0.76, -0.2, 22, 30, 82, 'glass'], [0.79, 0.25, 36, 44, 20, 'modern'], [0.83, -0.2, 30, 40, 30, 'modern']
    ];
    for (const [f, s, w, d, h, pal] of rows) {
      const z = b.minZ + 60 + f * (b.maxZ - b.minZ - 120);
      const sp = span(z);
      const n0 = span(z - 40);
      const n1 = span(z + 40);
      if (!sp) continue;
      const cx = (sp.l + sp.r) * 0.5;
      const half = (sp.r - sp.l) * 0.5;
      const rot = n0 && n1 ? Math.atan2((n1.l + n1.r) * 0.5 - (n0.l + n0.r) * 0.5, 80) : 0;
      const x = cx + s * Math.max(0, half - w * 0.6);
      list.push({ x, y: 0.3, z, w, h, d, rot, tint: T(pal), style: PALETTE_STYLE[pal], seed: rand() * 100 });
    }
  }
  // Ward's Island: Manhattan Psychiatric Center slabs; Randall's Island: Icahn Stadium grandstand
  const mpc = LL(-73.9305, 40.7858);
  const icahn = LL(-73.9248, 40.7944);
  for (const [x, z, w, d, h, pal] of [[mpc.x, mpc.z, 22, 60, 72, 'light'], [mpc.x + 70, mpc.z + 60, 22, 60, 72, 'light'],
    [mpc.x - 20, mpc.z + 140, 22, 60, 66, 'light'], [icahn.x, icahn.z, 16, 120, 14, 'modern']]) {
    const land = landAt(x, z);
    if (!land || land.id !== 'randalls') continue;
    list.push({ x, y: land.top, z, w, h, d, rot: 0, tint: T(pal), style: PALETTE_STYLE[pal], seed: rand() * 100 });
  }
}

// Roosevelt Island Tramway (1976): two red cabins shuttling in opposite directions on parallel track ropes between the
// station on the east side of 2nd Ave at 60th St and the Roosevelt Island station, up over steel towers by 1st Ave and
// York Ave and down across the East River's west channel, all along the north side of the Queensboro Bridge (the line
// runs parallel to the bridge, 25 m north of its centreline). Static parts go into `parts`; returns
// { colliders, update(elapsed) } (55 s trips, 12 s dwells)
function buildRooseveltTram(group, parts, lm) {
  const QB = EAST_RIVER_BRIDGES.find((b) => b.id === 'queensboro') || EAST_RIVER_BRIDGES[0];
  const qbLen = Math.hypot(QB.b.x - QB.a.x, QB.b.z - QB.a.z);
  const dx = (QB.b.x - QB.a.x) / qbLen;
  const dz = (QB.b.z - QB.a.z) / qbLen;
  const nx = dz; // towards the north (-z) side of the bridge
  const nz = -dx;
  const OFF = 25;
  // Line frame: u along the bridge from its Manhattan landing, v across (north +)
  const at = (u, v = 0) => ({ x: QB.a.x + dx * u + nx * (OFF + v), z: QB.a.z + dz * u + nz * (OFF + v) });
  const V = (u, y, v = 0) => {
    const p = at(u, v);
    return new THREE.Vector3(p.x, y, p.z);
  };
  const uAtX = (x) => (x - QB.a.x - nx * OFF) / dx;
  const RY = -Math.atan2(dz, dx);
  const TRACKS = [-4, 4]; // v of the two tracks (cabin A, cabin B), passing between the towers' legs
  const V0 = -6.5;
  const V1 = 6.5;
  const BASE = 0.22; // Manhattan sidewalk top
  // Roosevelt Island under the line: the station stands 40% of the way across
  let uW = null;
  let uE = null;
  for (let u = uAtX(1450); u < uAtX(2400); u += 2) {
    const p = at(u);
    const l = landAt(p.x, p.z);
    if (l && l.id === 'roosevelt') {
      if (uW === null) uW = u;
      uE = u;
    }
  }
  if (uW === null) {
    uW = uAtX(1670);
    uE = uAtX(1890);
  }
  const uM = uAtX(866); // Manhattan station centre (east side of 2nd Ave)
  const uI = uW + (uE - uW) * 0.4; // Roosevelt Island station centre
  // Track-rope profile [u, y]: Manhattan station, tower 1 (1st Ave), tower 2 (by York Ave, clear of the bridge's
  // Manhattan pier), island station; the river span sags
  const PROFILE = [[uM + 6, 17.5], [uAtX(1100), 40], [uAtX(1306), 76], [uI - 4, 6]];
  const SAG = [0.3, 0.4, 6.5];
  const pts = [];
  for (let i = 0; i + 1 < PROFILE.length; i++) {
    const [u0, y0] = PROFILE[i];
    const [u1, y1] = PROFILE[i + 1];
    const n = i === 2 ? 30 : 8;
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      pts.push([u0 + (u1 - u0) * t, y0 + (y1 - y0) * t - SAG[i] * 4 * t * (1 - t)]);
    }
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  const ropeAt = (s) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / (cum[i] - cum[i - 1])));
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };

  // Beams between two points (centred unit box stretched along a -> b)
  const box = new THREE.BoxGeometry(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  const beam = (mat, a, b, w) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(w, len, w));
    parts.add(mat, box, m);
  };
  // Box aligned with the line: base centre at (u, y, v), `along` x `h` x `across`
  const lineBox = (mat, u, y, v, along, h, across) => {
    const p = at(u, v);
    parts.box(mat, p.x, y, p.z, along, h, across, RY);
  };
  // Axis-aligned collider around a line-aligned footprint
  const colliders = [];
  const collider = (u, v, along, across, maxY) => {
    const p = at(u, v);
    const ex = Math.abs(dx) * along * 0.5 + Math.abs(nx) * across * 0.5;
    const ez = Math.abs(dz) * along * 0.5 + Math.abs(nz) * across * 0.5;
    colliders.push({ minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez, maxY });
  };
  const steel = lm.darkSteel;
  const beacon = createEmissiveTrimMaterial([1.0, 0.12, 0.08], 0.4, 5.0);

  // Track ropes: two per track
  for (const v of TRACKS) {
    for (const dv of [-0.55, 0.55]) {
      for (let i = 0; i + 1 < pts.length; i++) beam(steel, V(pts[i][0], pts[i][1], v + dv), V(pts[i + 1][0], pts[i + 1][1], v + dv), 0.09);
    }
  }

  // Towers: portal frames of four legs (splayed along the line, standing outside both tracks so the cabins pass
  // between them) braced every ~9 m, a cross-arm with rope saddles, red beacons on the taller one
  for (const [tu, top] of [PROFILE[1], PROFILE[2]]) {
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const leg = (k, y) => {
      const f = (y - BASE) / (top - BASE);
      const hu = 3.0 + (1.1 - 3.0) * f;
      const hv = 7.4 + (7.0 - 7.4) * f;
      return V(tu + legs[k][0] * hu, y, legs[k][1] * hv);
    };
    for (let k = 0; k < 4; k++) beam(steel, leg(k, BASE), leg(k, top - 1), 0.6);
    for (let y = BASE + 9; y < top - 3; y += 9) {
      for (let k = 0; k < 4; k++) {
        beam(steel, leg(k, y), leg((k + 1) % 4, y), 0.3);
        beam(steel, leg(k, y - 9 + 0.3), leg((k + 1) % 4, y), 0.18);
      }
    }
    lineBox(steel, tu, top - 1.2, 0, 2.4, 1.2, V1 - V0 + 1.2);
    for (const v of TRACKS) lineBox(steel, tu, top - 0.1, v, 3.2, 0.5, 1.8);
    if (top > 50) for (const v of [V0 - 0.4, V1 + 0.4]) lineBox(beacon, tu, top - 0.1, v, 0.6, 0.6, 0.6);
    collider(tu, 0, 6.8, V1 - V0 + 2.6, top);
  }

  // Manhattan station: deck at the cabins' floor on steel columns, glazed platform hall, roof and drive house
  const M0 = uM - 10;
  const M1 = uM + 10;
  const mc = (M0 + M1) / 2;
  const deckY = PROFILE[0][1] - 5;
  for (const u of [M0 + 0.5, M1 - 0.5]) for (const v of [V0 + 0.5, V1 - 0.5]) lineBox(steel, u, BASE, v, 0.9, 21 - BASE, 0.9);
  lineBox(lm.granite, mc, deckY - 0.9, 0, M1 - M0, 0.9, V1 - V0);
  lineBox(lm.glassBand, mc - 2, deckY, 0, M1 - M0 - 4, 1.0, V1 - V0 - 0.4);
  lineBox(steel, mc, 20.4, 0, M1 - M0 + 1.2, 0.7, V1 - V0 + 1.2);
  lineBox(lm.limestone, M0 + 3, deckY, 0, 6, 20.4 - deckY, V1 - V0 - 1);
  lineBox(lm.limestone, M0 + 2.5, BASE, V1 - 2.5, 4.2, deckY - BASE, 4.2); // stair & lift tower
  collider(mc, 0, M1 - M0, V1 - V0, 21);

  // Roosevelt Island station: a platform under a long canopy at grade, the bull-wheel house at its east end
  const I0 = uI - 8;
  const I1 = uI + 8;
  const ic = (I0 + I1) / 2;
  const iy = 0.3;
  lineBox(lm.granite, ic, iy, 0, I1 - I0, 0.75, V1 - V0);
  for (const u of [I0 + 0.5, I1 - 6]) for (const v of [V0 + 0.5, V1 - 0.5]) lineBox(steel, u, iy, v, 0.6, 9.2, 0.6);
  lineBox(steel, ic, iy + 9.2, 0, I1 - I0 + 1.5, 0.5, V1 - V0 + 1.5);
  lineBox(lm.limestone, I1 - 3, iy, 0, 6, 9.2, V1 - V0 - 1);
  const ex0 = at(uW - 20);
  const ex1 = at(I1 + 6);
  addExclusionCapsule(ex0.x, ex0.z, ex1.x, ex1.z, 12); // no island trees under the cabins

  // Cabins (red, glazed all round, lit at night) hanging 5 m below their carriages: two instances each
  const cabinGeo = new THREE.BoxGeometry(8.0, 3.0, 4.0).translate(0, -3.5, 0);
  const cabinMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.15 });
  const ly = positionGeometry.y;
  const glass = smoothstep(-4.15, -4.05, ly).mul(smoothstep(-2.45, -2.55, ly));
  cabinMat.colorNode = mix(srgb(0.7, 0.06, 0.08), srgb(0.07, 0.09, 0.11), glass);
  cabinMat.roughnessNode = mix(float(0.4), float(0.08), glass);
  cabinMat.emissiveNode = vec3(1.0, 0.84, 0.6).mul(glass.mul(nightFactorNode().mul(0.8)));
  const gearGeo = window.NYC.Addons.mergeGeometries([
    new THREE.BoxGeometry(0.3, 1.7, 0.3).translate(0, -1.15, 0),
    new THREE.BoxGeometry(3.4, 0.8, 1.7)
  ]);
  const cabins = new THREE.InstancedMesh(cabinGeo, cabinMat, 2);
  const gear = new THREE.InstancedMesh(gearGeo, steel, 2);
  for (const mesh of [cabins, gear]) {
    mesh.name = 'RooseveltTram';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(UP, RY);
  const one = new THREE.Vector3(1, 1, 1);
  const ease = (t) => t * t * (3 - 2 * t);
  const update = (elapsed) => {
    const p = (elapsed + 40) % 134; // mid-trip at load
    const u = p < 12 ? 0 : p < 67 ? ease((p - 12) / 55) : p < 79 ? 1 : 1 - ease((p - 79) / 55);
    [u, 1 - u].forEach((s, i) => {
      const [ru, ry] = ropeAt(s * L);
      m.compose(V(ru, ry, TRACKS[i]), q, one);
      cabins.setMatrixAt(i, m);
      gear.setMatrixAt(i, m);
    });
    cabins.instanceMatrix.needsUpdate = true;
    gear.instanceMatrix.needsUpdate = true;
  };
  update(20);
  return { colliders, update };
}

// Lumpy deciduous crown (unit radius, centred at the origin): overlapping low-poly lobes whose normals point away from
// the crown centre, so the canopy shades softly as one mass while its silhouette stays leafy
function makeCanopyGeometry(seed) {
  const rand = mulberry32(seed);
  const lobes = [[0, 0.05, 0, 0.62], [0, 0.48, 0, 0.46]];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + rand() * 0.6;
    const d = 0.42 + rand() * 0.12;
    lobes.push([Math.cos(a) * d, -0.12 + rand() * 0.36, Math.sin(a) * d, 0.4 + rand() * 0.12]);
  }
  const geos = lobes.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.deleteAttribute('uv');
    g.translate(x, y, z);
    return g;
  });
  const geo = window.NYC.Addons.mergeGeometries(geos, false);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i) + 0.15, pos.getZ(i)).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}

// Scattered park trees (islands, waterfront parks): clustered groves of instanced crowns + trunks with per-instance tint
function buildIslandTrees(group) {
  const rand = mulberry32(4242);
  const spots = [];
  const scatter = (pts, count, top) => {
    const b = polygonBounds(pts);
    let tries = 0;
    while (count > 0 && tries++ < count * 40) {
      // Groves of 2-7 trees around a random seed point
      const cx = b.minX + rand() * (b.maxX - b.minX);
      const cz = b.minZ + rand() * (b.maxZ - b.minZ);
      const grove = 2 + Math.floor(rand() * 6);
      for (let k = 0; k < grove && count > 0; k++) {
        const a = rand() * Math.PI * 2;
        const d = k === 0 ? 0 : 5 + rand() * 9;
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d;
        if (!pointInPolygon(pts, x, z) || distToPolygonEdges(pts, x, z, 6) < 4) continue;
        if (EXCLUSIONS.some((e) => e.test(x, z))) continue;
        spots.push([x, top, z]);
        count--;
      }
    }
  };
  scatter(GOVERNORS_ISLAND_POLYGON, 900, 0.45);
  scatter(LIBERTY_ISLAND_POLYGON, 60, 0.6);
  scatter(ELLIS_ISLAND_POLYGON, 40, 0.6);
  scatter(ROOSEVELT_ISLAND_POLYGON, 380, 0.3);
  scatter(RANDALLS_ISLAND_POLYGON, 1200, 0.35);
  if (MILL_ROCK_POLYGON && MILL_ROCK_POLYGON.length > 2) scatter(MILL_ROCK_POLYGON, 30, 0.3);

  const crownGeo = makeCanopyGeometry(77);
  const crownMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0 });
  const lp = positionGeometry;
  const clump = valueNoise(positionWorld.xz.mul(0.8).add(positionWorld.y.mul(0.9)));
  const interior = smoothstep(-0.75, 0.85, lp.y).mul(0.6).add(0.4);
  crownMat.colorNode = vec3(interior.mul(clump.mul(0.4).add(0.78)));
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.16, 1, 6, 1, true).translate(0, 0.5, 0);
  const trunkMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0.0 });
  trunkMat.colorNode = srgb(0.27, 0.24, 0.21);

  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  spots.forEach(([x, y, z], i) => {
    const r = 2.6 + rand() * 3.0;
    const trunkH = r * (0.75 + rand() * 0.35);
    const sy = r * (0.85 + rand() * 0.3);
    q.setFromAxisAngle(yAxis, rand() * 6.28);
    m.compose(new THREE.Vector3(x, y + trunkH + sy * 0.55, z), q, new THREE.Vector3(r * (0.9 + rand() * 0.2), sy, r * (0.9 + rand() * 0.2)));
    crowns.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r * 0.5, trunkH + sy * 0.3, r * 0.5));
    trunks.setMatrixAt(i, m);
    // Summer greens: London plane / oak (deep), honey locust (yellow-green), a few copper beeches
    const g = rand();
    if (g < 0.04) c.setRGB(toLinear(0.29), toLinear(0.18), toLinear(0.15));
    else if (g < 0.3) c.setRGB(toLinear(0.36 + rand() * 0.06), toLinear(0.45 + rand() * 0.05), toLinear(0.17));
    else c.setRGB(toLinear(0.2 + rand() * 0.07), toLinear(0.29 + rand() * 0.07), toLinear(0.13 + rand() * 0.04));
    crowns.setColorAt(i, c);
  });
  for (const mesh of [crowns, trunks]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  crowns.name = 'BoroughIslandTrees';
  trunks.name = 'BoroughIslandTrunks';
}

// Landmark sites kept clear of generic buildings (registered before the generator runs): real places, the waterfront
// ones measured from the local shoreline (`inland` m: + east for the East River shores, - west for New Jersey)
function siteOnShore(land, lon, lat, inland, r) {
  const p = LL(lon, lat);
  return { x: (land ? shoreXNear(land, p.x, p.z) : p.x) + inland, z: p.z, r };
}
const LANDMARK_SITES = {
  bigAllis: siteOnShore(QUEENS_LAND, -73.9455, 40.7593, 75, 110),
  eggs: { ...LL(-73.9479, 40.7353), r: 75 },
  pepsi: siteOnShore(QUEENS_LAND, -73.9593, 40.7473, 14, 30),
  domino: siteOnShore(BROOKLYN_LAND, -73.9677, 40.7143, 30, 55),
  yankee: { ...LL(-73.9262, 40.8296), r: 150 },
  hoboken: siteOnShore(NJ_LAND, -74.0275, 40.7350, -45, 85)
};

function registerLandmarkExclusions() {
  for (const s of Object.values(LANDMARK_SITES)) addExclusionCircle(s.x, s.z, s.r);
  for (const b of EAST_RIVER_BRIDGES) {
    // Borough approach & anchorage corridor (from the river to the street-level landing)
    addExclusionCapsule(b.a.x + (b.b.x - b.a.x) * 0.55, b.a.z + (b.b.z - b.a.z) * 0.55, b.b.x, b.b.z, b.width * 0.5 + 7);
  }
  // Outer bridges land on boroughs at both ends
  for (const b of OUTER_BRIDGES) addExclusionCapsule(b.a.x, b.a.z, b.b.x, b.b.z, b.width * 0.5 + 9);
}

// Canvas-lettered sign face (transparent background) for the waterfront signs
function makeSignTexture(text, { font, color, glow, width = 1024, height = 256 }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = glow;
  ctx.lineWidth = height * 0.035;
  ctx.strokeText(text, width / 2, height * 0.54);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height * 0.54);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createSignMaterial(tex, nightGlow) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide });
  const t = texture(tex);
  mat.colorNode = t.rgb;
  mat.opacityNode = t.a;
  mat.alphaTest = 0.4;
  mat.emissiveNode = t.rgb.mul(float(0.25).add(nightFactorNode().mul(nightGlow)));
  return mat;
}

/**
 * Industrial waterfront icons seen from Manhattan: Ravenswood's red-and-white "Big Allis" stacks, the Newtown Creek
 * digester eggs, the Pepsi-Cola sign at Gantry Plaza, the Domino Sugar refinery & sign, Yankee Stadium and the
 * Hoboken Terminal clock tower.
 */
function buildBoroughLandmarks(parts, mats, list, group) {
  const rand = mulberry32(1963);
  // --- Ravenswood Generating Station ("Big Allis") ---
  const A = LANDMARK_SITES.bigAllis;
  list.push({ x: A.x + 18, y: 0, z: A.z, w: 50, h: 38, d: 120, rot: 0, tint: [0.52, 0.5, 0.46], style: 2, seed: 3 });
  list.push({ x: A.x + 62, y: 0, z: A.z + 20, w: 36, h: 24, d: 70, rot: 0, tint: [0.45, 0.44, 0.42], style: 2, seed: 7 });
  const stack = new THREE.CylinderGeometry(3.8, 4.9, 1, 16, 1, true);
  for (let k = 0; k < 4; k++) {
    const h = k === 3 ? 120 : 152;
    parts.add(mats.stack, stack, parts.matrixOf(A.x - 8, h * 0.5, A.z - 45 + k * 30, 1, h, 1));
  }

  // --- Newtown Creek Wastewater Treatment Plant digester eggs ---
  const E = LANDMARK_SITES.eggs;
  const egg = new THREE.SphereGeometry(1, 18, 12);
  for (let k = 0; k < 8; k++) {
    const ex = E.x - 42 + (k % 4) * 28;
    const ez = E.z - 15 + Math.floor(k / 4) * 30;
    parts.add(mats.steel, egg, parts.matrixOf(ex, 22, ez, 12, 22, 11));
    parts.box(mats.glassBand, ex, 37, ez, 17, 2.4, 15);
  }
  parts.box(mats.darkSteel, E.x, 44, E.z - 15, 96, 1.4, 2.6);
  parts.box(mats.darkSteel, E.x, 44, E.z + 15, 96, 1.4, 2.6);
  list.push({ x: E.x, y: 0, z: E.z + 52, w: 100, h: 12, d: 20, rot: 0, tint: [0.55, 0.53, 0.5], style: 2, seed: 11 });

  // --- Pepsi-Cola sign (Gantry Plaza State Park), facing Manhattan ---
  const P = LANDMARK_SITES.pepsi;
  const pepsiTex = makeSignTexture('Pepsi-Cola', { font: 'italic bold 190px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive', color: '#ff2a2a', glow: '#7a0505' });
  const pepsiMat = createSignMaterial(pepsiTex, 4.0);
  const signW = 34;
  const signH = 9;
  const pg = new THREE.PlaneGeometry(1, 1);
  const pm = new THREE.Mesh(pg, pepsiMat);
  pm.position.set(P.x - 1, 10.5 + signH * 0.5, P.z);
  pm.rotation.y = -Math.PI / 2;
  pm.scale.set(signW, signH, 1);
  group.add(pm);
  for (let k = 0; k <= 4; k++) parts.box(mats.darkSteel, P.x + 0.6, 0, P.z - signW * 0.5 + (k / 4) * signW, 0.7, 10.5 + signH, 0.7);
  parts.box(mats.darkSteel, P.x + 0.6, 10.2, P.z, 0.8, 0.6, signW + 1);
  // The two LONG ISLAND gantry cranes beside it
  for (const gz of [P.z + 26, P.z + 40]) {
    parts.box(mats.darkSteel, P.x - 4, 0, gz - 4, 1.4, 20, 1.4);
    parts.box(mats.darkSteel, P.x - 4, 0, gz + 4, 1.4, 20, 1.4);
    parts.box(mats.darkSteel, P.x + 6, 0, gz - 4, 1.4, 20, 1.4);
    parts.box(mats.darkSteel, P.x + 6, 0, gz + 4, 1.4, 20, 1.4);
    parts.box(mats.darkSteel, P.x + 1, 20, gz, 16, 3.2, 10);
  }

  // --- Domino Sugar refinery & sign (Williamsburg) ---
  const D = LANDMARK_SITES.domino;
  list.push({ x: D.x - 2, y: 0, z: D.z, w: 30, h: 40, d: 60, rot: 0, tint: [0.45, 0.25, 0.18], style: 2, seed: 19 });
  list.push({ x: D.x - 2, y: 40, z: D.z - 10, w: 16, h: 10, d: 16, rot: 0, tint: [0.45, 0.25, 0.18], style: 2, seed: 23 });
  parts.add(mats.brick, new THREE.CylinderGeometry(1.8, 2.5, 64, 10), parts.matrixOf(D.x - 10, 32, D.z + 22, 1, 1, 1));
  const dominoTex = makeSignTexture('DOMINO SUGARS', { font: 'bold 150px "Futura", "Avenir Next Condensed", "Arial Narrow", sans-serif', color: '#ffc61a', glow: '#6b4a00' });
  const dm = new THREE.Mesh(pg, createSignMaterial(dominoTex, 3.0));
  dm.position.set(D.x - 17.4, 45.5, D.z);
  dm.rotation.y = -Math.PI / 2;
  dm.scale.set(36, 9, 1);
  group.add(dm);
  parts.box(mats.darkSteel, D.x - 16.8, 40, D.z, 0.6, 1.2, 36);

  // --- Yankee Stadium (limestone facade ring, seating bowl, field) ---
  const Y = LANDMARK_SITES.yankee;
  parts.add(mats.limestone, new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), parts.matrixOf(Y.x, 15, Y.z, 118, 30, 98, 0, 0.5, 0));
  parts.add(mats.seats, new THREE.CylinderGeometry(0.97, 0.5, 1, 48, 1, true), parts.matrixOf(Y.x, 15.5, Y.z, 118, 29, 98, 0, 0.5, 0));
  parts.add(mats.field, new THREE.CircleGeometry(1, 40), parts.matrixOf(Y.x, 1.2, Y.z, 60, 1, 50, -Math.PI / 2, 0, 0));

  // --- Hoboken Terminal (Lackawanna) with its clock tower and ferry slips on the Hudson ---
  const H = LANDMARK_SITES.hoboken;
  parts.box(mats.limestone, H.x, 0, H.z, 26, 15, 100);
  parts.box(mats.copper, H.x, 15, H.z, 26.8, 3.6, 100.8);
  parts.box(mats.limestone, H.x - 3, 0, H.z + 54, 9, 50, 9);
  parts.add(mats.copper, new THREE.ConeGeometry(5.8, 11, 4), parts.matrixOf(H.x - 3, 55.5, H.z + 54, 1, 1, 1, 0, Math.PI / 4, 0));
  for (let k = 0; k < 6; k++) parts.box(mats.copper, H.x + 21, 0, H.z - 40 + k * 16, 16, 6 + rand(), 11);
}

// =====================================================================================================================
// 8. EAST RIVER BRIDGES
// =====================================================================================================================

// Instanced "beam" sets: every member is a unit box stretched between two points (one InstancedMesh per material)
function createBeamSet() {
  const sets = new Map();
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  const U = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const push = (material, m) => {
    let arr = sets.get(material);
    if (!arr) sets.set(material, (arr = []));
    arr.push(m);
  };
  return {
    // Member from p0 to p1; `a` = thickness along the member's up-ish axis, `b` = along its side axis
    beam(material, p0, p1, a, b, ref = null) {
      X.subVectors(p1, p0);
      const len = X.length();
      if (len < 1e-4) return;
      X.multiplyScalar(1 / len);
      U.copy(ref || (Math.abs(X.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : UP));
      Z.crossVectors(X, U);
      if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1);
      Z.normalize();
      Y.crossVectors(Z, X);
      const m = new THREE.Matrix4().makeBasis(X.clone().multiplyScalar(len), Y.clone().multiplyScalar(a), Z.clone().multiplyScalar(b));
      mid.addVectors(p0, p1).multiplyScalar(0.5);
      m.setPosition(mid);
      push(material, m);
    },
    // Axis-aligned-to-bridge block centred at p (size along the bridge, vertical, across)
    block(material, p, dir, along, h, across) {
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(along),
        new THREE.Vector3(0, h, 0),
        new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(across)
      );
      m.setPosition(p);
      push(material, m);
    },
    build(parent, name, shadowMats = new Set()) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      for (const [material, mats] of sets) {
        const mesh = new THREE.InstancedMesh(geo, material, mats.length);
        mats.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = shadowMats.has(material);
        mesh.receiveShadow = false;
        mesh.name = name;
        parent.add(mesh);
      }
    }
  };
}

function bridgeFrame(spec) {
  const ax = spec.a.x;
  const az = spec.a.z;
  const dx = spec.b.x - ax;
  const dz = spec.b.z - az;
  const L = Math.hypot(dx, dz);
  const dir = new THREE.Vector3(dx / L, 0, dz / L);
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  // Point at fraction t along the bridge, lateral offset s, height y
  const at = (t, s = 0, y = 0) => new THREE.Vector3(ax + dx * t + side.x * s, y, az + dz * t + side.z * s);
  return { L, dir, side, at };
}

// Deck height: ramps from street level to the anchorages / end towers (r1, r2), then a gentle crown over the river
function makeDeckProfile(spec, r1, r2, rampFrac) {
  const yR = spec.deckY * rampFrac;
  const ease = (x) => 0.55 * x + 0.45 * smooth01(x);
  return (t) => {
    if (t <= 0 || t >= 1) return 0;
    if (t < r1) return yR * ease(t / r1);
    if (t > r2) return yR * ease((1 - t) / (1 - r2));
    return yR + (spec.deckY - yR) * Math.sin((Math.PI * (t - r1)) / (r2 - r1));
  };
}

function createBridgeMaterials() {
  const nf = nightFactorNode();
  const lamp = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.0 });
  lamp.colorNode = srgb(0.62, 0.61, 0.58);
  lamp.emissiveNode = vec3(1.0, 0.88, 0.66).mul(nf.mul(9.0));
  const necklace = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.0 });
  necklace.colorNode = srgb(0.7, 0.7, 0.68);
  necklace.emissiveNode = vec3(1.0, 0.95, 0.85).mul(nf.mul(12.0));
  return {
    lamp,
    necklace,
    deck: createLandmarkMaterial([0.36, 0.36, 0.37], { roughness: 0.85, noise: 0.1 }),
    pier: createLandmarkMaterial([0.55, 0.53, 0.5], { roughness: 0.9, flood: 0.08, courses: 0.9 }),
    granite: createLandmarkMaterial([0.64, 0.58, 0.49], { roughness: 0.88, flood: 0.35, courses: 1.1 }),
    queensboro: createLandmarkMaterial([0.6, 0.59, 0.55], { roughness: 0.55, metalness: 0.05, noise: 0.12, flood: 0.05 }),
    williamsburg: createLandmarkMaterial([0.6, 0.28, 0.24], { roughness: 0.55, metalness: 0.05, noise: 0.12, flood: 0.05 }),
    manhattan: createLandmarkMaterial([0.5, 0.6, 0.68], { roughness: 0.55, metalness: 0.05, noise: 0.12, flood: 0.05 }),
    brooklyn: createLandmarkMaterial([0.66, 0.6, 0.5], { roughness: 0.6, metalness: 0.05, noise: 0.12 }),
    gwb: createLandmarkMaterial([0.56, 0.58, 0.6], { roughness: 0.6, metalness: 0.05, noise: 0.14, flood: 0.04 }),
    verrazzano: createLandmarkMaterial([0.68, 0.7, 0.72], { roughness: 0.55, metalness: 0.05, noise: 0.1, flood: 0.04 }),
    concrete: createLandmarkMaterial([0.6, 0.59, 0.56], { roughness: 0.92, noise: 0.16, flood: 0.05 }),
    lighthouse: createLandmarkMaterial([0.62, 0.12, 0.08], { roughness: 0.6, flood: 0.2 }),
    beacon: createEmissiveTrimMaterial([1.0, 0.1, 0.05], 1.2, 7.0)
  };
}

// Shared deck: roadway slab, side girders / stiffening trusses, approach piers or masonry embankment, deck lamps.
// `opts.trussBelow` drops the stiffening truss below the roadway, with a lower deck along its bottom chords.
function buildDeck(B, spec, f, profile, mats, steel, opts) {
  const { L, dir, at } = f;
  const W = spec.width;
  const n = Math.max(12, Math.ceil(L / 5));
  const trussH = opts.trussH;
  const drop = opts.trussBelow || 0;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(i / n);
  for (let i = 0; i < n; i++) {
    const t0 = pts[i];
    const t1 = pts[i + 1];
    const y0 = profile(t0);
    const y1 = profile(t1);
    B.beam(mats.deck, at(t0, 0, y0 - 1.1), at(t1, 0, y1 - 1.1), 2.2, W);
    const suspended = t0 >= opts.trussFrom && t1 <= opts.trussTo;
    const h = suspended ? trussH : 2.4;
    const yb = 2.2 + (suspended ? drop : 0);
    if (suspended && drop > 0) B.beam(mats.deck, at(t0, 0, y0 - yb + 0.7), at(t1, 0, y1 - yb + 0.7), 1.0, W - 1.2);
    for (const s of [-W * 0.5, W * 0.5]) {
      const b0 = at(t0, s, y0 - yb);
      const b1 = at(t1, s, y1 - yb);
      const c0 = at(t0, s, y0 - yb + h);
      const c1 = at(t1, s, y1 - yb + h);
      B.beam(steel, b0, b1, 0.9, 0.9);
      B.beam(steel, c0, c1, suspended ? 0.8 : 0.5, suspended ? 0.8 : 0.5);
      if (suspended) {
        B.beam(steel, b0, c0, 0.45, 0.45);
        B.beam(steel, i % 2 ? b0 : c0, i % 2 ? c1 : b1, 0.35, 0.35);
      }
    }
    // Approach supports: steel bents over the streets (on Manhattan only where both columns stand on a block, never in a
    // roadway), solid masonry where the deck is low
    if (!suspended && i % 3 === 0 && y0 > 1.2) {
      const p = at(t0, 0, 0);
      const l = landAt(p.x, p.z);
      const manhattan = !l && pointInPolygon(MANHATTAN_COASTLINE, p.x, p.z);
      const land = l ? l.id !== 'roosevelt' : manhattan;
      const feet = [-W * 0.38, W * 0.38];
      if (y0 < 5.5) B.block(mats.pier, at(t0, 0, (y0 - 2.2) * 0.5), dir, L / n * 3.05, Math.max(0.2, y0 - 2.2), W * 0.9);
      else if (land && (!manhattan || feet.every((s) => onManhattanBlock(at(t0, s, 0), 1.6)))) {
        for (const s of feet) {
          B.beam(mats.pier, at(t0, s, 0), at(t0, s, y0 - 2.2), 2.2, 2.2);
          if (manhattan) addBridgeCollider(at(t0, s, 0), dir, 2.4, 2.4, y0 - 2.2);
        }
      }
    }
    // Where the deck end is too low to drive under (~4.2 m clearance) it blocks the Manhattan street below
    if (Math.min(y0, y1) - 2.2 < 4.2) {
      const p = at((t0 + t1) * 0.5, 0, 0);
      if (onManhattan(p)) addBridgeCollider(p, dir, L / n, W, Math.max(y0, y1));
    }
    // Deck lamps every 15 m along both parapets
    if (i % 3 === 0 && y0 > 0.5) {
      for (const s of [-W * 0.5 + 0.6, W * 0.5 - 0.6]) {
        B.beam(steel, at(t0, s, y0), at(t0, s, y0 + 6), 0.25, 0.25);
        B.block(mats.lamp, at(t0, s * 0.96, y0 + 6.1), dir, 0.9, 0.35, 0.6);
      }
    }
  }
}

// Parabolic main cable between tower saddles + side spans to the anchorages; suspenders & necklace lights
function buildCables(B, spec, f, profile, mats, steel, o) {
  const { at } = f;
  const W = spec.width;
  const [t1, t2] = spec.towers;
  const lowY = (t) => profile(t) - 2.2 + o.trussH + 0.6;
  const cableY = (t) => {
    if (t >= t1 && t <= t2) {
      const s = (t - t1) / (t2 - t1);
      const sagLow = lowY((t1 + t2) * 0.5);
      return o.saddleY - (o.saddleY - sagLow) * (1 - (2 * s - 1) * (2 * s - 1));
    }
    const tA = t < t1 ? o.anchor1 : o.anchor2;
    const tT = t < t1 ? t1 : t2;
    const aY = t < t1 || o.anchorY2 === undefined ? o.anchorY : o.anchorY2;
    const s = (t - tA) / (tT - tA);
    return aY + (o.saddleY - aY) * s - 5 * 4 * s * (1 - s);
  };
  for (const s of o.cableOffsets.map((k) => k * W * 0.5)) {
    const segs = [];
    const add = (ta, tb, n) => {
      for (let i = 0; i < n; i++) segs.push([ta + ((tb - ta) * i) / n, ta + ((tb - ta) * (i + 1)) / n]);
    };
    add(o.anchor1, t1, 14);
    add(t1, t2, 36);
    add(t2, o.anchor2, 14);
    for (const [ta, tb] of segs) B.beam(steel, at(ta, s, cableY(ta)), at(tb, s, cableY(tb)), o.cableR, o.cableR);
    // Suspenders every ~5 m (`hangToDeck`: from cables outside the deck down onto the edge trusses)
    const step = 5 / f.L;
    const sLow = o.hangToDeck ? Math.sign(s) * Math.min(Math.abs(s), W * 0.5) : s;
    for (let t = o.anchor1 + step; t < o.anchor2 - step * 0.5; t += step) {
      const yc = cableY(t);
      const yd = lowY(t);
      if (yc - yd > 1.2 && Math.abs(t - t1) > step * 0.6 && Math.abs(t - t2) > step * 0.6) B.beam(steel, at(t, sLow, yd), at(t, s, yc), 0.18, 0.18);
    }
    // Necklace lights on the outer cables
    if (Math.abs(s) >= (o.necklaceFrom || 1) * W * 0.5) {
      const lstep = 9 / f.L;
      for (let t = o.anchor1 + lstep; t < o.anchor2; t += lstep) B.block(mats.necklace, at(t, s, cableY(t) + o.cableR * 0.5 + 0.28), f.dir, 0.55, 0.55, 0.55);
    }
  }
  return cableY;
}

// Manhattan footing of the bridge approaches: raised sidewalk blocks (approach columns stand only on blocks, never in a
// roadway) and the colliders handed to traffic / pedestrians / the player. Set by buildBoroughs.
let bridgeSite = { sidewalks: [], colliders: [] };

function onManhattan(p) {
  return !landAt(p.x, p.z) && pointInPolygon(MANHATTAN_COASTLINE, p.x, p.z);
}

function onManhattanBlock(p, r) {
  for (const s of bridgeSite.sidewalks) if (p.x - r >= s.minX && p.x + r <= s.maxX && p.z - r >= s.minZ && p.z + r <= s.maxZ) return true;
  return false;
}

// Collider for a bridge part standing on Manhattan: an oriented box (centre p, sizes along / across `dir`) as a few
// axis-aligned cells no larger than ~10 m, so slanted parts don't block whole street corners
function addBridgeCollider(p, dir, along, across, maxY) {
  const na = Math.max(1, Math.ceil(along / 10));
  const nc = Math.max(1, Math.ceil(across / 10));
  const a = along / na;
  const c = across / nc;
  const ex = Math.abs(dir.x) * a * 0.5 + Math.abs(dir.z) * c * 0.5;
  const ez = Math.abs(dir.z) * a * 0.5 + Math.abs(dir.x) * c * 0.5;
  for (let i = 0; i < na; i++) {
    for (let k = 0; k < nc; k++) {
      const u = -along * 0.5 + a * (i + 0.5);
      const v = -across * 0.5 + c * (k + 0.5);
      const x = p.x + dir.x * u - dir.z * v;
      const z = p.z + dir.z * u + dir.x * v;
      bridgeSite.colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, maxY });
    }
  }
}

// Semicircular arch opening in a wall's (along, up) plane
function roundArchPath(cx, y0, halfW, springY, n = 8) {
  const pts = [new THREE.Vector2(cx - halfW, y0), new THREE.Vector2(cx + halfW, y0)];
  for (let k = 0; k <= n; k++) {
    const a = (Math.PI * k) / n;
    pts.push(new THREE.Vector2(cx + halfW * Math.cos(a), springY + halfW * Math.sin(a)));
  }
  return new THREE.Path(pts);
}

// Masonry anchorage at fraction ta: rusticated plinth, walls with deep blind arcades (pointed for the Brooklyn Bridge),
// a cornice and parapets flanking the roadway that crosses its top at height h
function buildAnchorage(B, parts, mats, f, ta, len, across, h, gothic) {
  const { at, dir } = f;
  const UP = new THREE.Vector3(0, 1, 0);
  const sideV = new THREE.Vector3(-dir.z, 0, dir.x);
  const endV = new THREE.Vector3(dir.z, 0, -dir.x);
  const D = 1.5; // depth of the arcade recesses
  const wall = (w, count) => {
    const bay = w / count;
    const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(w / 2, h - 0.1), new THREE.Vector2(-w / 2, h - 0.1)]);
    for (let k = 0; k < count; k++) {
      const cx = -w / 2 + bay * (k + 0.5);
      const hw = bay * 0.3;
      const top = h * 0.74;
      shape.holes.push(gothic ? pointedArchPath(cx, 3.2, hw, top - hw * 1.35, top) : roundArchPath(cx, 3.2, hw, top - hw));
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -D * 0.5);
    return g;
  };
  B.block(mats.pier, at(ta, 0, 1.6), dir, len + 2.4, 3.2, across + 2.4);
  // Core in the greyer pier stone: it shows at the back of the recesses
  B.block(mats.pier, at(ta, 0, (h - 0.1) * 0.5), dir, len - D * 2, h - 0.1, across - D * 2);
  const longGeo = wall(len, Math.max(2, Math.round(len / 12)));
  for (const sg of [-1, 1]) parts.add(mats.granite, longGeo, new THREE.Matrix4().makeBasis(dir, UP, sideV).setPosition(at(ta, sg * (across - D) * 0.5, 0)));
  const endGeo = wall(across - D * 2, Math.max(2, Math.round((across - D * 2) / 13)));
  for (const sg of [-1, 1]) parts.add(mats.granite, endGeo, new THREE.Matrix4().makeBasis(endV, UP, dir).setPosition(at(ta + (sg * (len - D) * 0.5) / f.L, 0, 0)));
  B.block(mats.granite, at(ta, 0, h - 0.9), dir, len + 1.4, 1.8, across + 1.4);
  for (const sg of [-1, 1]) B.block(mats.granite, at(ta, sg * (across * 0.5 - 0.3), h + 0.75), dir, len + 1.4, 1.5, 0.8);
  const p = at(ta, 0, 0);
  if (onManhattan(p)) addBridgeCollider(p, dir, len + 2.4, across + 2.4, h);
}

/** Williamsburg (riveted lattice towers) & Manhattan (portal-arched towers) suspension bridges. */
function buildSuspensionBridge(group, parts, spec, mats) {
  const B = createBeamSet();
  const f = bridgeFrame(spec);
  const { at, dir, side } = f;
  const W = spec.width;
  const isManhattan = spec.id === 'manhattan';
  const steel = isManhattan ? mats.manhattan : mats.williamsburg;
  const [t1, t2] = spec.towers;
  const sideSpan = spec.sideSpan / f.L;
  const anchor1 = t1 - sideSpan;
  const anchor2 = t2 + sideSpan;
  const profile = makeDeckProfile(spec, anchor1, anchor2, 0.86);
  const trussH = isManhattan ? 7 : 10;
  buildDeck(B, spec, f, profile, mats, steel, { trussH, trussFrom: anchor1, trussTo: anchor2 });

  // Masonry anchorages (the roadway crosses their top) and caissons
  const yAnchor = profile(anchor1);
  const [anchorLen, anchorExtra] = spec.anchorage;
  for (const ta of [anchor1, anchor2]) buildAnchorage(B, parts, mats, f, ta, anchorLen, W + anchorExtra, yAnchor - 0.3, false);
  const saddleY = spec.towerH - 2;
  for (const tt of [t1, t2]) {
    B.block(mats.pier, at(tt, 0, 2), dir, 16, 9, W + 12);
    const yDeck = profile(tt);
    for (const sgn of [-1, 1]) {
      const s = sgn * (W * 0.5 + 1.6);
      if (isManhattan) {
        // Steel box columns with a gentle batter and a decorative portal at the top
        B.beam(steel, at(tt, s * 1.08, 6.5), at(tt, s, spec.towerH), 3.4, 2.6, dir);
      } else {
        // Riveted lattice column: two posts with X-bracing
        const p0 = at(tt - 2.6 / f.L, s, 6.5);
        const p1 = at(tt + 2.6 / f.L, s, 6.5);
        B.beam(steel, p0, at(tt - 2.6 / f.L, s, spec.towerH), 1.4, 1.4, dir);
        B.beam(steel, p1, at(tt + 2.6 / f.L, s, spec.towerH), 1.4, 1.4, dir);
        for (let y = 10; y < spec.towerH - 4; y += 9) {
          B.beam(steel, at(tt - 2.6 / f.L, s, y), at(tt + 2.6 / f.L, s, y + 9), 0.4, 0.4);
          B.beam(steel, at(tt + 2.6 / f.L, s, y), at(tt - 2.6 / f.L, s, y + 9), 0.4, 0.4);
        }
      }
    }
    // Cross portals above the deck and the saddle girder
    for (const y of [yDeck + 9, (yDeck + spec.towerH) * 0.5 + 6, spec.towerH - 1.5]) {
      B.beam(steel, at(tt, -W * 0.5 - 1.6, y), at(tt, W * 0.5 + 1.6, y), 2.2, 2.4, dir);
    }
    if (isManhattan) {
      // Portal arch under the top girder
      const n = 8;
      for (let k = 0; k < n; k++) {
        const a0 = Math.PI * (k / n);
        const a1 = Math.PI * ((k + 1) / n);
        const r = W * 0.5 + 1.6;
        B.beam(steel, at(tt, -Math.cos(a0) * r, spec.towerH - 14 + Math.sin(a0) * 9), at(tt, -Math.cos(a1) * r, spec.towerH - 14 + Math.sin(a1) * 9), 1.2, 2.0, dir);
      }
      B.block(steel, at(tt, 0, spec.towerH + 1.5), dir, 4, 3, W + 6);
    } else {
      for (let y = yDeck + 12; y < spec.towerH - 8; y += 14) {
        B.beam(steel, at(tt, -W * 0.5 - 1.6, y), at(tt, W * 0.5 + 1.6, y + 12), 0.5, 0.5, dir);
        B.beam(steel, at(tt, W * 0.5 + 1.6, y), at(tt, -W * 0.5 - 1.6, y + 12), 0.5, 0.5, dir);
      }
    }
  }
  buildCables(B, spec, f, profile, mats, steel, {
    trussH, saddleY, anchor1, anchor2, anchorY: yAnchor + 1, cableR: 0.7,
    cableOffsets: isManhattan ? [-1.06, -0.62, 0.62, 1.06] : [-1.09, -0.86, 0.86, 1.09]
  });
  void side;
  B.build(group, spec.name, new Set([mats.deck, mats.pier, mats.granite]));
}

// Pointed (lancet) arch opening for the Brooklyn Bridge towers, in the tower's (across, up) plane
function pointedArchPath(cx, y0, halfW, springY, apexY, n = 7) {
  const rise = apexY - springY;
  const c = (rise * rise - halfW * halfW) / (2 * halfW);
  const R = halfW + c;
  const ta = Math.acos(c / R);
  const pts = [new THREE.Vector2(cx - halfW, y0), new THREE.Vector2(cx + halfW, y0)];
  for (let k = 0; k <= n; k++) {
    const a = (ta * k) / n;
    pts.push(new THREE.Vector2(cx - c + R * Math.cos(a), springY + R * Math.sin(a)));
  }
  for (let k = 1; k <= n; k++) {
    const a = Math.PI - ta + (ta * k) / n;
    pts.push(new THREE.Vector2(cx + c + R * Math.cos(a), springY + R * Math.sin(a)));
  }
  return new THREE.Path(pts);
}

/** Brooklyn Bridge: granite towers with twin Gothic arches, four cables, the diagonal stay web and the promenade. */
function buildBrooklynBridge(group, parts, spec, mats) {
  const B = createBeamSet();
  const f = bridgeFrame(spec);
  const { at, dir } = f;
  const W = spec.width;
  const steel = mats.brooklyn;
  const [t1, t2] = spec.towers;
  const sideSpan = spec.sideSpan / f.L;
  const anchor1 = t1 - sideSpan;
  const anchor2 = t2 + sideSpan;
  const profile = makeDeckProfile(spec, anchor1, anchor2, 0.84);
  const trussH = 5;
  buildDeck(B, spec, f, profile, mats, steel, { trussH, trussFrom: anchor1, trussTo: anchor2 });

  // Granite anchorages with Gothic blind arcades (the roadway crosses their top)
  const yAnchor = profile(anchor1);
  const [anchorLen, anchorExtra] = spec.anchorage;
  for (const ta of [anchor1, anchor2]) buildAnchorage(B, parts, mats, f, ta, anchorLen, W + anchorExtra, yAnchor - 0.3, true);

  // Towers: extruded masonry with two pointed arches the roadways pass through
  const H = spec.towerH;
  const deckBottom = spec.deckY - 2.6;
  const shape = new THREE.Shape([
    new THREE.Vector2(-18, -2.5), new THREE.Vector2(18, -2.5), new THREE.Vector2(16.6, H - 3), new THREE.Vector2(-16.6, H - 3)
  ]);
  for (const cx of [-7.4, 7.4]) shape.holes.push(pointedArchPath(cx, deckBottom, 4.7, spec.deckY + 17, spec.deckY + 30));
  const towerGeo = new THREE.ExtrudeGeometry(shape, { depth: 13, bevelEnabled: false, curveSegments: 1 });
  towerGeo.translate(0, 0, -6.5);
  const sideV = new THREE.Vector3(dir.z, 0, -dir.x);
  for (const tt of [t1, t2]) {
    const c = at(tt, 0, 0);
    const m = new THREE.Matrix4().makeBasis(sideV, new THREE.Vector3(0, 1, 0), dir.clone()).setPosition(c);
    parts.add(mats.granite, towerGeo, m);
    B.block(mats.granite, at(tt, 0, H - 2), dir, 14.4, 2.2, 35.4);
    B.block(mats.granite, at(tt, 0, H - 0.4), dir, 12.6, 1.4, 31.5);
    B.block(mats.pier, at(tt, 0, -0.5), dir, 17, 3.4, 40);
    // Pilasters on the arched faces (both outer piers and the central pier), string courses wrapping the tower at the
    // roadway and above the arch crowns, and battered buttresses on the narrow ends
    const widthAt = (y) => 36 - (2.8 * (y + 2.5)) / (H - 0.5);
    for (const sg of [-1, 1]) {
      const ta = tt + (sg * 6.8) / f.L;
      for (const [s, w] of [[0, 4.2], [-14.4, 3.4], [14.4, 3.4]]) B.block(mats.granite, at(ta, s, (H - 3.1) * 0.5), dir, 0.6, H - 3.1, w);
      B.beam(mats.granite, at(tt, sg * 18.35, -2.5), at(tt, sg * 16.95, H - 3), 5.2, 1.4, dir);
    }
    for (const y of [deckBottom - 0.75, spec.deckY + 31.4]) B.block(mats.granite, at(tt, 0, y), dir, 13.6, 1.3, widthAt(y) + 0.6);
  }

  const saddleY = H - 4;
  const cableY = buildCables(B, spec, f, profile, mats, steel, {
    trussH, saddleY, anchor1, anchor2, anchorY: yAnchor + 2, cableR: 0.55, cableOffsets: [-1.0, -0.27, 0.27, 1.0]
  });

  // Diagonal stays radiating from each tower top down to the deck
  for (const tt of [t1, t2]) {
    for (const s of [-W * 0.5, -3.5, 3.5, W * 0.5]) {
      for (const sgn of [-1, 1]) {
        for (let k = 1; k <= 11; k++) {
          const td = tt + (sgn * k * 5.2) / f.L;
          B.beam(steel, at(tt + (sgn * 6.6) / f.L, s, saddleY - 3), at(td, s, profile(td) - 2.2 + trussH), 0.14, 0.14);
        }
      }
    }
  }
  void cableY;

  // Elevated central promenade (timber deck on steel), interrupted by the towers' central piers
  const n = Math.ceil(((anchor2 - anchor1) * f.L) / 5);
  for (let i = 0; i < n; i++) {
    const ta = anchor1 + ((anchor2 - anchor1) * i) / n;
    const tb = anchor1 + ((anchor2 - anchor1) * (i + 1)) / n;
    if (Math.abs((ta + tb) * 0.5 - t1) * f.L < 8 || Math.abs((ta + tb) * 0.5 - t2) * f.L < 8) continue;
    B.beam(mats.deck, at(ta, 0, profile(ta) + 4), at(tb, 0, profile(tb) + 4), 0.5, 5.2);
    for (const s of [-2.6, 2.6]) B.beam(steel, at(ta, s, profile(ta) + 5.1), at(tb, s, profile(tb) + 5.1), 0.12, 0.12);
  }
  B.build(group, spec.name, new Set([mats.deck, mats.pier, mats.granite]));
}

/** Queensboro (59th Street) Bridge: double-deck cantilever trusses with humped top chords, spired towers, necklace lights. */
function buildQueensboroBridge(group, spec, mats) {
  const B = createBeamSet();
  const f = bridgeFrame(spec);
  const { at, dir } = f;
  const W = spec.width;
  const steel = mats.queensboro;
  const T = spec.towers;
  const profile = makeDeckProfile(spec, T[0], T[3], 0.95);
  const reach = 0.105;
  const trussFrom = T[0] - reach;
  const trussTo = T[3] + reach;
  buildDeck(B, spec, f, profile, mats, steel, { trussH: 2.4, trussFrom: 2, trussTo: -1 });

  const crownY = spec.towerH - 6;
  const topY = (t) => {
    const base = profile(t) + 9;
    let y = base;
    for (const tk of T) {
      const d = Math.abs(t - tk) / reach;
      if (d < 1) y = Math.max(y, base + (crownY - base) * Math.pow(1 - d, 1.5));
    }
    return y;
  };
  const lowY = (t) => profile(t) - 8;
  const n = Math.ceil(((trussTo - trussFrom) * f.L) / 6);
  for (let i = 0; i < n; i++) {
    const ta = trussFrom + ((trussTo - trussFrom) * i) / n;
    const tb = trussFrom + ((trussTo - trussFrom) * (i + 1)) / n;
    B.beam(mats.deck, at(ta, 0, lowY(ta) - 1), at(tb, 0, lowY(tb) - 1), 1.6, W * 0.92);
    for (const s of [-W * 0.5, W * 0.5]) {
      const b0 = at(ta, s, lowY(ta));
      const b1 = at(tb, s, lowY(tb));
      const c0 = at(ta, s, topY(ta));
      const c1 = at(tb, s, topY(tb));
      B.beam(steel, b0, b1, 1.2, 1.0);
      B.beam(steel, c0, c1, 1.3, 1.1);
      B.beam(steel, b0, c0, 0.6, 0.6);
      B.beam(steel, i % 2 ? b0 : c0, i % 2 ? c1 : b1, 0.5, 0.5);
      B.block(mats.necklace, at(ta, s * 1.03, topY(ta) + 0.83), dir, 0.55, 0.55, 0.55);
    }
    if (i % 2 === 0 && topY(ta) - profile(ta) > 12) B.beam(steel, at(ta, -W * 0.5, topY(ta)), at(ta, W * 0.5, topY(ta)), 0.6, 0.6, dir);
  }
  // Masonry piers (York Ave, both Roosevelt Island banks, Queens shore) and spired steel towers
  for (const tt of T) {
    const pierTop = profile(tt) - 9;
    B.block(mats.granite, at(tt, 0, (pierTop - 2.5) * 0.5), dir, 18, pierTop + 2.5, W + 10);
    if (onManhattan(at(tt, 0, 0))) addBridgeCollider(at(tt, 0, 0), dir, 18, W + 10, pierTop);
    for (const s of [-W * 0.5, W * 0.5]) {
      for (const o of [-3.2, 3.2]) {
        B.beam(steel, at(tt + o / f.L, s, pierTop), at(tt + o / f.L, s, spec.towerH), 1.6, 1.6, dir);
        B.block(steel, at(tt + o / f.L, s, spec.towerH + 6), dir, 0.9, 12, 0.9);
      }
      for (let y = pierTop + 6; y < spec.towerH - 3; y += 8) {
        B.beam(steel, at(tt - 3.2 / f.L, s, y), at(tt + 3.2 / f.L, s, y + 8), 0.4, 0.4);
        B.beam(steel, at(tt + 3.2 / f.L, s, y), at(tt - 3.2 / f.L, s, y + 8), 0.4, 0.4);
      }
    }
    B.beam(steel, at(tt, -W * 0.5, spec.towerH - 1), at(tt, W * 0.5, spec.towerH - 1), 1.6, 1.6, dir);
  }
  B.build(group, spec.name, new Set([mats.deck, mats.granite]));
}

// George Washington Bridge tower: two open riveted-lattice legs (four corner posts with X-braced panels) tapering and
// leaning in slightly, a strut under the deck, two arched portals above it and the cable saddles on top
function buildGWBTower(B, f, tt, spec, steel, yDeck) {
  const { at, dir, L } = f;
  const H = spec.towerH;
  const W = spec.width;
  const legAt = (sg, u) => sg * (W * 0.5 + 4 - 1.5 * u);
  const inner = (u) => W * 0.5 + 1 - 0.75 * u; // inner face of the legs
  const corner = (sg, ia, ic, y) => {
    const u = y / H;
    return at(tt + (ia * (6 - 2 * u)) / L, legAt(sg, u) + ic * (3 - 0.75 * u), y);
  };
  const levels = [];
  for (let y = 4; y < H - 8; y += 12.5) levels.push(y);
  levels.push(H - 3);
  const ring = (sg, y) => [corner(sg, -1, -1, y), corner(sg, 1, -1, y), corner(sg, 1, 1, y), corner(sg, -1, 1, y)];
  for (const sg of [-1, 1]) {
    for (const ia of [-1, 1]) for (const ic of [-1, 1]) B.beam(steel, corner(sg, ia, ic, 0), corner(sg, ia, ic, H - 2), 1.5, 1.5, dir);
    for (let k = 0; k < levels.length; k++) {
      const c = ring(sg, levels[k]);
      for (let e = 0; e < 4; e++) B.beam(steel, c[e], c[(e + 1) % 4], 0.7, 0.7);
      if (k + 1 >= levels.length) continue;
      const d = ring(sg, levels[k + 1]);
      for (let e = 0; e < 4; e++) {
        B.beam(steel, c[e], d[(e + 1) % 4], 0.45, 0.45);
        B.beam(steel, c[(e + 1) % 4], d[e], 0.45, 0.45);
      }
    }
    B.block(steel, at(tt, legAt(sg, 1), H - 0.5), dir, 9, 3, 5.5);
  }
  const yS = yDeck - 13;
  B.beam(steel, at(tt, -inner(yS / H), yS), at(tt, inner(yS / H), yS), 8, 4, dir);
  // Arched portals: a deep girder with an elliptical arch below it and spandrel posts
  const portal = (yTop, depth) => {
    const r = inner(yTop / H);
    const ySpring = yTop - depth;
    const rise = depth - 1.5;
    B.beam(steel, at(tt, -r, yTop), at(tt, r, yTop), 7, 3, dir);
    let prev = null;
    for (let k = 0; k <= 12; k++) {
      const a = (Math.PI * k) / 12;
      const p = at(tt, -Math.cos(a) * r, ySpring + Math.sin(a) * rise);
      if (prev) B.beam(steel, prev, p, 6, 1.6, dir);
      prev = p;
    }
    for (const sx of [-0.8, -0.55, -0.3, 0.3, 0.55, 0.8]) {
      B.beam(steel, at(tt, sx * r, ySpring + Math.sqrt(1 - sx * sx) * rise), at(tt, sx * r, yTop - 1.5), 5, 0.7, dir);
    }
  };
  portal(H - 4, 26);
  portal(yDeck + 46, 17);
}

// Verrazzano-Narrows tower: two slender tapered box legs leaning in slightly, struts under the deck, at two-thirds
// height and at the top
let verrazzanoLegGeo = null;
function buildVerrazzanoTower(B, parts, f, tt, spec, steel, yDeck) {
  const { at, dir, side } = f;
  const H = spec.towerH;
  const W = spec.width;
  if (!verrazzanoLegGeo) {
    // Unit frustum (half-widths 1 -> 0.66), flat-shaded, base at y = 0
    verrazzanoLegGeo = new THREE.CylinderGeometry(Math.SQRT2 * 0.66, Math.SQRT2, 1, 4, 1, false).toNonIndexed();
    verrazzanoLegGeo.rotateY(Math.PI / 4).translate(0, 0.5, 0);
    verrazzanoLegGeo.computeVertexNormals();
  }
  const y0 = 6;
  const lean = 1.2;
  for (const sg of [-1, 1]) {
    const base = at(tt, sg * (W * 0.5 + 3.4), y0);
    const m = new THREE.Matrix4().makeBasis(
      dir.clone().multiplyScalar(4.6),
      new THREE.Vector3(0, H - y0, 0).addScaledVector(side, -sg * lean),
      side.clone().multiplyScalar(3.1)
    ).setPosition(base);
    parts.add(steel, verrazzanoLegGeo, m);
    B.block(steel, at(tt, sg * (W * 0.5 + 3.4 - lean), H + 0.6), dir, 5, 1.2, 3.2);
  }
  const inner = (y) => W * 0.5 + 3.4 - (lean * (y - y0)) / (H - y0) - 3.1 * (1 - (0.34 * (y - y0)) / (H - y0));
  for (const [y, h] of [[yDeck - 12, 5], [H * 0.64, 4.5], [H - 3, 5]]) {
    const r = inner(y) + 0.4;
    B.beam(steel, at(tt, -r, y), at(tt, r, y), 5.5, h, dir);
  }
}

/**
 * Outer suspension bridges (skyline landmarks): the George Washington Bridge (lattice towers, double deck, granite
 * Manhattan anchorage, cables anchored in the Palisades, the Little Red Lighthouse at Jeffrey's Hook) and the
 * Verrazzano-Narrows Bridge (tapered box towers, double deck, concrete anchorages). Red aircraft beacons on the towers.
 */
function buildOuterBridge(group, parts, spec, mats) {
  const B = createBeamSet();
  const f = bridgeFrame(spec);
  const { at, dir } = f;
  const W = spec.width;
  const H = spec.towerH;
  const gwb = spec.type === 'gwb';
  const steel = gwb ? mats.gwb : mats.verrazzano;
  const [t1, t2] = spec.towers;
  const anchor1 = t1 - spec.sideSpan[0] / f.L;
  const anchor2 = t2 + spec.sideSpan[1] / f.L;
  let profile = makeDeckProfile(spec, anchor1, anchor2, 0.84);
  if (gwb) {
    // Near-level main span from the Manhattan anchorage to the cliff top; the approach ramps down across the Harlem
    // River into the Bronx and the New Jersey end follows the plateau
    const yA = spec.deckY - 6;
    const pB = at(anchor2);
    const yB = ridgeHeightAt(pB.x, pB.z) + 0.3;
    const ease = (x) => 0.55 * x + 0.45 * smooth01(x);
    profile = (t) => {
      if (t <= 0) return 0;
      if (t < anchor1) return yA * ease(t / anchor1);
      if (t <= anchor2) {
        const s = (t - anchor1) / (anchor2 - anchor1);
        return yA + (yB - yA) * s + 4 * Math.sin(Math.PI * s);
      }
      const p = at(Math.min(1, t));
      return ridgeHeightAt(p.x, p.z) + 0.3;
    };
  }
  const trussH = gwb ? 9 : 8;
  buildDeck(B, spec, f, profile, mats, steel, { trussH, trussBelow: trussH - 3, trussFrom: anchor1, trussTo: anchor2 });

  // Anchorages (the GWB's New Jersey cables dive into the Palisades rock below the deck)
  const [anchorLen, anchorExtra] = spec.anchorage;
  const anchorY2 = gwb ? profile(anchor2) - 7 : profile(anchor2) + 1;
  if (gwb) {
    buildAnchorage(B, parts, mats, f, anchor1, anchorLen, W + anchorExtra, profile(anchor1) - 0.3, false);
    for (const sg of [-1, 1]) B.block(mats.granite, at(anchor2, sg * (W * 0.5 + 2.5), anchorY2 + 1), dir, 9, 7, 6);
  } else {
    for (const ta of [anchor1, anchor2]) {
      const h = profile(ta) - 0.3;
      const across = W + anchorExtra;
      B.block(mats.concrete, at(ta, 0, h * 0.5 - 1), dir, anchorLen, h + 2, across);
      B.block(mats.concrete, at(ta, 0, h - 1.4), dir, anchorLen + 1.4, 2.8, across + 1.4);
      for (const sg of [-1, 1]) B.block(mats.concrete, at(ta, sg * (across * 0.5 - 0.4), h + 0.8), dir, anchorLen, 1.6, 0.8);
    }
  }

  // Towers on their caissons, crowned by red aircraft beacons
  for (const tt of [t1, t2]) {
    B.block(mats.pier, at(tt, 0, 2), dir, 20, 9, W + 22);
    if (gwb) buildGWBTower(B, f, tt, spec, steel, profile(tt));
    else buildVerrazzanoTower(B, parts, f, tt, spec, steel, profile(tt));
    const sb = gwb ? W * 0.5 + 4.1 : W * 0.5 + 3.4;
    for (const sg of [-1, 1]) B.block(mats.beacon, at(tt, sg * sb, H + 1.6), dir, 0.9, 1.2, 0.9);
  }
  const k = gwb ? [1.115, 1.18] : [1.1, 1.16];
  buildCables(B, spec, f, profile, mats, steel, {
    trussH: 3, saddleY: H + (gwb ? 0.8 : 1.0), anchor1, anchor2, anchorY: profile(anchor1) + 1, anchorY2, cableR: 0.95,
    cableOffsets: [-k[1], -k[0], k[0], k[1]], hangToDeck: true, necklaceFrom: 1.14
  });

  if (gwb) {
    // The Little Red Lighthouse on Jeffrey's Hook, just south of the Manhattan tower
    const towerA = at(t1);
    const lz = towerA.z + 28;
    const lx = (UPPER_LAND ? shoreXNear(UPPER_LAND, towerA.x, lz) : towerA.x) + 7;
    parts.add(mats.lighthouse, new THREE.CylinderGeometry(1.5, 2.2, 11, 12), parts.matrixOf(lx, 5.5, lz, 1, 1, 1));
    parts.add(mats.deck, new THREE.CylinderGeometry(2.0, 2.0, 0.4, 12), parts.matrixOf(lx, 11.2, lz, 1, 1, 1));
    parts.add(mats.deck, new THREE.CylinderGeometry(1.0, 1.0, 1.8, 10), parts.matrixOf(lx, 12.3, lz, 1, 1, 1));
    parts.add(mats.lighthouse, new THREE.ConeGeometry(1.3, 1.4, 10), parts.matrixOf(lx, 13.9, lz, 1, 1, 1));
  }
  B.build(group, spec.name, new Set([mats.deck, mats.pier, mats.granite, mats.concrete]));
}

// =====================================================================================================================
// 9. ASSEMBLY
// =====================================================================================================================

function createLandmarkMaterials() {
  const stack = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.0 });
  stack.colorNode = mix(srgb(0.86, 0.85, 0.83), srgb(0.66, 0.2, 0.16), step(0.5, fract(positionWorld.y.div(30.0))));
  const torchRim = new THREE.MeshStandardNodeMaterial({ color: 0xd9a54a, roughness: 0.3, metalness: 1.0 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0xb8bcc4, roughness: 0.32, metalness: 0.85 });
  const glassBand = new THREE.MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0.5 });
  glassBand.colorNode = srgb(0.3, 0.45, 0.6);
  glassBand.emissiveNode = vec3(0.3, 0.6, 1.0).mul(nightFactorNode().mul(0.6));
  return {
    stack,
    torchRim,
    steel,
    glassBand,
    flame: createEmissiveTrimMaterial([1.0, 0.72, 0.3], 0.6, 6.0),
    copper: createLandmarkMaterial([0.42, 0.62, 0.55], { roughness: 0.7, metalness: 0.0, flood: 0.45, noise: 0.25 }),
    granite: createLandmarkMaterial([0.62, 0.58, 0.51], { roughness: 0.88, flood: 0.3, courses: 0.8 }),
    brick: createLandmarkMaterial([0.5, 0.27, 0.2], { flood: 0.15 }),
    limestone: createLandmarkMaterial([0.7, 0.66, 0.58], { flood: 0.2 }),
    slate: createLandmarkMaterial([0.3, 0.32, 0.34], { roughness: 0.7 }),
    sandstone: createLandmarkMaterial([0.56, 0.34, 0.25], { flood: 0.15 }),
    darkSteel: createLandmarkMaterial([0.2, 0.2, 0.21], { roughness: 0.6, metalness: 0.4 }),
    seats: createLandmarkMaterial([0.15, 0.25, 0.42], { side: THREE.DoubleSide }),
    field: createLandmarkMaterial([0.25, 0.45, 0.18], { roughness: 0.95 })
  };
}

/**
 * Builds everything around the simulated Manhattan grid: land masses, the Palisades, borough buildings, harbor islands,
 * landmarks, the East River bridges and the George Washington / Verrazzano-Narrows bridges. Call after buildCityGrid()
 * with its raised sidewalk blocks: Manhattan approach
 * columns stand only on blocks. Returns the colliders of the bridge parts standing on Manhattan (anchorages, piers,
 * columns, deck ends too low to drive under).
 */
function buildBoroughs(scene, { sidewalks = [] } = {}) {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'Boroughs';

  // Land, bulkheads & the Palisades ridge (all on the procedural ground shader)
  const landMat = createLandMaterial();
  const { topGeo, wallGeo } = buildLandGeometries();
  const landMesh = new THREE.Mesh(topGeo, landMat);
  landMesh.name = 'BoroughLand';
  const wallMesh = new THREE.Mesh(wallGeo, createBulkheadMaterial());
  wallMesh.name = 'BoroughBulkheads';
  const ridgeMesh = new THREE.Mesh(buildRidgeGeometry(), landMat);
  ridgeMesh.name = 'Palisades';
  group.add(landMesh, wallMesh, ridgeMesh);

  // Buildings (generic grid blocks + skyline signatures + island & landmark buildings) in chunked instanced meshes
  registerLandmarkExclusions();
  const { list, stats } = generateBoroughBuildings();
  const parts = createPartCollector();
  const lm = createLandmarkMaterials();
  addIslandBuildings(list);
  buildStatueOfLiberty(parts, lm);
  buildEllisIsland(parts, lm, list);
  buildGovernorsIsland(parts, lm, list, landMat, group);
  buildBoroughLandmarks(parts, lm, list, group);
  const buildingMat = createBoroughBuildingMaterial();
  for (const mesh of buildBuildingChunks(list, buildingMat, 1200, 'BoroughBuildings')) group.add(mesh);
  parts.build(group);

  // East River bridges, and the Roosevelt Island Tramway beside the Queensboro Bridge (before the island's trees,
  // which keep out from under its cabins)
  bridgeSite = { sidewalks, colliders: [] };
  const bridgeMats = createBridgeMaterials();
  const bridgeParts = createPartCollector();
  const tram = buildRooseveltTram(group, bridgeParts, lm);
  buildIslandTrees(group);
  for (const spec of EAST_RIVER_BRIDGES) {
    if (spec.type === 'suspension') buildSuspensionBridge(group, bridgeParts, spec, bridgeMats);
    else if (spec.type === 'brooklyn') buildBrooklynBridge(group, bridgeParts, spec, bridgeMats);
    else if (spec.type === 'cantilever') buildQueensboroBridge(group, spec, bridgeMats);
  }
  for (const spec of OUTER_BRIDGES) buildOuterBridge(group, bridgeParts, spec, bridgeMats);
  bridgeParts.build(group, { castShadow: true });

  scene.add(group);
  console.info(`[boroughs] ${list.length} buildings ${JSON.stringify(stats)} built in ${(performance.now() - t0).toFixed(0)} ms`);
  return { group, ridgeHeightAt, landAt, colliders: bridgeSite.colliders.concat(tram.colliders), update: tram.update };
}

Object.assign(window.NYC, { buildBoroughs, ridgeHeightAt, boroughLandAt: landAt });
})();
