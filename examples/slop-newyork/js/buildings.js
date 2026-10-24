(function () {
// js/buildings.js
// Generates dense, architecturally varied Manhattan city blocks across the entire island
// indexed by a spatial 2D Quadtree (ManhattanQuadtree) that dynamically streams high-detail
// architectural elements (carved stone cornices/ledges, rooftop cedar water towers, mechanical
// penthouses, wrought-iron fire escapes, retail awnings, illuminated storefront signs, and
// sidewalk scaffolding sheds) around the player anywhere in Manhattan.
//
// Blocks are divided into lots the way Manhattan's are: apartment houses on the avenue corners, rows of
// brownstones / tenements along the side streets around a "donut" of rear yards, lofts and office buildings sharing
// party walls, towers rising from full-lot podiums. Footprints are rectilinear plans (light courts, U / E / H / ring
// courtyards, dumbbell tenements, notched, stepped & cruciform towers) built as unions of non-overlapping boxes.

const { THREE } = window.NYC;
const { mergeGeometries } = window.NYC.Addons;
const {
  Fn,
  float,
  vec2,
  color,
  uv,
  positionGeometry,
  positionWorld,
  normalWorldGeometry,
  normalGeometry,
  abs,
  floor,
  fract,
  mod,
  step,
  smoothstep,
  fwidth,
  max,
  min,
  mix,
  length,
  mx_noise_float,
  mx_worley_noise_float
} = window.NYC.TSL;
const {
  ALL_AVENUES,
  CENTRAL_PARK_BOUNDS,
  ISLAND_BOUNDS,
  BLOCKS,
  LANDMARK_SITES,
  streetZ,
  avenueX,
  getBroadwayX,
  EAST_RIVER_BRIDGES
} = window.NYC;
const {
  createPreWarBuildingMaterial,
  createCurtainWallMaterial,
  createFacadeBoxes,
  createBillboardMaterial,
  WALL_KINDS
} = window.NYC;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spatial 2D Quadtree partitioning all of Manhattan Island (Harlem 125th St to Battery Park)
 * for fast O(log N) range queries around the active player/camera position.
 */
class ManhattanQuadtree {
  constructor(bounds, capacity = 6, maxDepth = 6, depth = 0) {
    this.bounds = bounds; // { minX, maxX, minZ, maxZ }
    this.capacity = capacity;
    this.maxDepth = maxDepth;
    this.depth = depth;
    this.items = [];
    this.divided = false;
    this.nw = null;
    this.ne = null;
    this.sw = null;
    this.se = null;
  }

  containsPoint(x, z) {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  intersectsCircle(cx, cz, radius) {
    const b = this.bounds;
    const closestX = Math.max(b.minX, Math.min(cx, b.maxX));
    const closestZ = Math.max(b.minZ, Math.min(cz, b.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return (dx * dx + dz * dz) <= (radius * radius);
  }

  subdivide() {
    const b = this.bounds;
    const midX = (b.minX + b.maxX) * 0.5;
    const midZ = (b.minZ + b.maxZ) * 0.5;
    const nextDepth = this.depth + 1;

    this.nw = new ManhattanQuadtree({ minX: b.minX, maxX: midX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.ne = new ManhattanQuadtree({ minX: midX, maxX: b.maxX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.sw = new ManhattanQuadtree({ minX: b.minX, maxX: midX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.se = new ManhattanQuadtree({ minX: midX, maxX: b.maxX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.divided = true;

    for (const item of this.items) {
      this._insertIntoChildren(item);
    }
    this.items.length = 0;
  }

  _insertIntoChildren(item) {
    if (this.nw.containsPoint(item.cx, item.cz)) return this.nw.insert(item);
    if (this.ne.containsPoint(item.cx, item.cz)) return this.ne.insert(item);
    if (this.sw.containsPoint(item.cx, item.cz)) return this.sw.insert(item);
    if (this.se.containsPoint(item.cx, item.cz)) return this.se.insert(item);
    return false;
  }

  insert(item) {
    if (!this.containsPoint(item.cx, item.cz)) return false;

    if (!this.divided) {
      if (this.items.length < this.capacity || this.depth >= this.maxDepth) {
        this.items.push(item);
        return true;
      }
      this.subdivide();
    }
    return this._insertIntoChildren(item);
  }

  queryRange(cx, cz, radius, found = []) {
    if (!this.intersectsCircle(cx, cz, radius)) return found;

    const rSq = radius * radius;
    if (!this.divided) {
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        const dx = item.cx - cx;
        const dz = item.cz - cz;
        if (dx * dx + dz * dz <= rSq) {
          found.push(item);
        }
      }
      return found;
    }

    this.nw.queryRange(cx, cz, radius, found);
    this.ne.queryRange(cx, cz, radius, found);
    this.sw.queryRange(cx, cz, radius, found);
    this.se.queryRange(cx, cz, radius, found);
    return found;
  }
}

// ============================================================================
// RECTILINEAR FOOTPRINTS: plans as unions of non-overlapping axis-aligned rects { x0, x1, z0, z1 }
// (x runs west → east, z north → south)
// ============================================================================
const EPS = 0.05;
const OPPOSITE = { n: 's', s: 'n', w: 'e', e: 'w' };
const rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
const rectW = (r) => r.x1 - r.x0;
const rectD = (r) => r.z1 - r.z0;
const insetAll = (r, d) => rect(r.x0 + d, r.x1 - d, r.z0 + d, r.z1 - d);

// Length of side `s` of rect r, and the rect's extent perpendicular to it
const sideLen = (r, s) => (s === 'n' || s === 's' ? r.x1 - r.x0 : r.z1 - r.z0);
const sideDepth = (r, s) => (s === 'n' || s === 's' ? r.z1 - r.z0 : r.x1 - r.x0);

/** Rect in the frame of side `s` of r: `a` runs along that side (from its west / north end), `b` inward from it */
function sideRect(r, s, a0, a1, b0, b1) {
  if (s === 'n') return rect(r.x0 + a0, r.x0 + a1, r.z0 + b0, r.z0 + b1);
  if (s === 's') return rect(r.x0 + a0, r.x0 + a1, r.z1 - b1, r.z1 - b0);
  if (s === 'w') return rect(r.x0 + b0, r.x0 + b1, r.z0 + a0, r.z0 + a1);
  return rect(r.x1 - b1, r.x1 - b0, r.z0 + a0, r.z0 + a1);
}

/** Light court `cw` wide and `cd` deep, cut into the middle of side `s` (shifted `off` along it) */
function courtHole(r, s, cw, cd, off = 0) {
  const L = sideLen(r, s);
  return sideRect(r, s, (L - cw) * 0.5 + off, (L + cw) * 0.5 + off, -1, cd);
}

/** Notches nx (along x) by nz (along z) cut from the given corners of r */
function cornerHoles(r, nx, nz, corners = ['nw', 'ne', 'sw', 'se']) {
  return corners.map((c) => {
    const x0 = c[1] === 'w' ? r.x0 - 1 : r.x1 - nx;
    const z0 = c[0] === 'n' ? r.z0 - 1 : r.z1 - nz;
    return rect(x0, x0 + nx + 1, z0, z0 + nz + 1);
  });
}

/**
 * `r` minus `holes`, as non-overlapping rects: sliced into strips across `axis` ('x': strips running north-south,
 * 'z': strips running east-west) at every hole edge, neighbouring strips with identical spans merged back, so a
 * U-plan comes out as its base bar plus two wings. Slice so the street front stays one piece (one window grid).
 */
function carve(r, holes, axis = 'x') {
  const flip = axis === 'z';
  const U0 = flip ? r.z0 : r.x0;
  const U1 = flip ? r.z1 : r.x1;
  const V0 = flip ? r.x0 : r.z0;
  const V1 = flip ? r.x1 : r.z1;
  const hs = holes.map((h) => (flip ? [h.z0, h.z1, h.x0, h.x1] : [h.x0, h.x1, h.z0, h.z1]));
  const cuts = [U0, U1];
  for (const [u0, u1] of hs) {
    if (u0 > U0 + EPS && u0 < U1 - EPS) cuts.push(u0);
    if (u1 > U0 + EPS && u1 < U1 - EPS) cuts.push(u1);
  }
  cuts.sort((a, b) => a - b);

  const out = [];
  let open = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const ua = cuts[i];
    const ub = cuts[i + 1];
    if (ub - ua < EPS) continue;
    const um = (ua + ub) * 0.5;
    let spans = [[V0, V1]];
    for (const [u0, u1, v0, v1] of hs) {
      if (um <= u0 || um >= u1) continue;
      const next = [];
      for (const [a, b] of spans) {
        if (v1 <= a + EPS || v0 >= b - EPS) {
          next.push([a, b]);
          continue;
        }
        if (v0 > a + EPS) next.push([a, v0]);
        if (v1 < b - EPS) next.push([v1, b]);
      }
      spans = next;
    }
    const nextOpen = [];
    for (const [a, b] of spans) {
      let strip = open.find((o) => Math.abs(o[2] - a) < EPS && Math.abs(o[3] - b) < EPS);
      if (strip) {
        strip[1] = ub;
      } else {
        strip = [ua, ub, a, b];
        out.push(strip);
      }
      nextOpen.push(strip);
    }
    open = nextOpen;
  }
  return out.map(([u0, u1, v0, v1]) => (flip ? rect(v0, v1, u0, u1) : rect(u0, u1, v0, v1)));
}

function buildCityBlocks(scene) {
  const group = new THREE.Group();
  group.name = 'ManhattanCityBlocks';
  const colliders = [];

  // Frame of the lots being populated. Irregular blocks come with frontage frames (city-config.js BLOCKS: lots laid
  // out along the streets they front, in a frame turned by θ about p); the generator works in the frame as on a grid
  // block, and everything it emits is turned into place (placeInFrame), so buildings line up with their street.
  let xf = null; // { th, cs, sn, px, pz }
  let minLot = 15; // smallest lot side built on (frontage frames come in lots of 12 m and up, see geo-blocks.mjs)
  const toWorld = (x, z) => (xf
    ? [xf.px + (x - xf.px) * xf.cs + (z - xf.pz) * xf.sn, xf.pz - (x - xf.px) * xf.sn + (z - xf.pz) * xf.cs]
    : [x, z]);
  // Player collider over the rect [x0, x1] x [z0, z1] (of the current frame): an oriented box inside its world AABB
  function pushCollider(x0, x1, z0, z1, maxY) {
    if (!xf) {
      colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY });
      return;
    }
    const [cx, cz] = toWorld((x0 + x1) * 0.5, (z0 + z1) * 0.5);
    const hx = (x1 - x0) * 0.5;
    const hz = (z1 - z0) * 0.5;
    const ex = Math.abs(xf.cs) * hx + Math.abs(xf.sn) * hz;
    const ez = Math.abs(xf.sn) * hx + Math.abs(xf.cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY, obb: { cx, cz, hx, hz, cs: xf.cs, sn: xf.sn } });
  }

  // Re-seeded from each block's position (see populateBlock), so every block is reproducible on its own
  let rand = mulberry32(10019);
  const range = (a, b) => a + (b - a) * rand();
  const irange = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const chance = (p) => rand() < p;
  const pick = (items) => items[Math.floor(rand() * items.length)];
  // Weighted pick from [[value, weight], ...]
  function pickW(table) {
    let total = 0;
    for (const e of table) total += e[1];
    let r = rand() * total;
    for (const e of table) {
      r -= e[1];
      if (r < 0) return e[0];
    }
    return table[table.length - 1][0];
  }

  // Full-island Spatial Quadtree covering Harlem (~129th St) down to the Battery
  const quadtree = new ManhattanQuadtree({
    minX: ISLAND_BOUNDS.minX - 50,
    maxX: ISLAND_BOUNDS.maxX + 50,
    minZ: ISLAND_BOUNDS.minZ - 50,
    maxZ: ISLAND_BOUNDS.maxZ + 50
  }, 6, 9);
  const allBlocks = [];

  const facades = [
    // 0: Pre-War Limestone & Buff Brick (5th Ave / Madison Ave / Upper East Side style)
    [createPreWarBuildingMaterial, {
      stoneColor: 0xd8cdb8,
      trimColor: 0x9e937f,
      windowGlassColor: 0x1a2836,
      windowWidth: 2.6,
      floorHeight: 3.7,
      litProbability: 0.54,
      warmth: 0.80,
      seed: 12.4
    }],
    // 1: Historic Warm Red/Terracotta Brick (Garment District / Chelsea / SoHo / Upper West Side)
    [createPreWarBuildingMaterial, {
      stoneColor: 0xa45a45,
      trimColor: 0xcab9a0,
      windowGlassColor: 0x16222e,
      windowWidth: 2.4,
      floorHeight: 3.5,
      litProbability: 0.56,
      warmth: 0.86,
      seed: 27.8
    }],
    // 2: Classic NYC Brownstone & Dark Masonry (Cross-street rowhouses, Village & Harlem)
    [createPreWarBuildingMaterial, {
      stoneColor: 0x765443,
      trimColor: 0x503a2e,
      windowGlassColor: 0x151e26,
      windowWidth: 2.2,
      floorHeight: 3.4,
      litProbability: 0.60,
      warmth: 0.90,
      seed: 41.2
    }],
    // 3: Blue-Teal Curtain-Wall Glass (Park Ave / 6th Ave / Financial District modernism)
    [createCurtainWallMaterial, {
      glassTint: 0x1a3a52,
      frameTint: 0x3b4c5b,
      windowWidth: 2.7,
      floorHeight: 3.9,
      litProbability: 0.60,
      warmth: 0.52,
      reflectivity: 0.92,
      seed: 63.5
    }],
    // 4: Dark Bronze / Charcoal Miesian Glass (Avenue of the Americas / Midtown West)
    [createCurtainWallMaterial, {
      glassTint: 0x242220,
      frameTint: 0x3c3631,
      windowWidth: 2.5,
      floorHeight: 3.8,
      litProbability: 0.64,
      warmth: 0.72,
      reflectivity: 0.88,
      seed: 81.9
    }],
    // 5: Silver / Ice-Blue Contemporary Supertall Glass (Billionaires' Row / Hudson Yards / WTC)
    [createCurtainWallMaterial, {
      glassTint: 0x264664,
      frameTint: 0xb0bcc8,
      windowWidth: 2.9,
      floorHeight: 4.1,
      litProbability: 0.58,
      warmth: 0.48,
      reflectivity: 0.95,
      seed: 94.3
    }]
  ];
  const materials = facades.map(([create, opts]) => create({ ...opts, boxLocal: true }));
  // Storey height of each facade: buildings are massed in whole storeys so every window row lines up across tiers
  const storeys = facades.map(([, opts]) => opts.floorHeight);

  const buckets = materials.map(() => []);
  const broadwayBillboards = [];

  // Times Square's bowtie: the Broadway plaza strip (city-config.js GEO.plazas) and 7th Avenue's roadway between 47th
  // and 42nd St. Lots fronting it rise as sheer walls (flushTower) and every podium wall facing it carries billboards
  const TS = (() => {
    const def = (window.NYC.GEO.plazas || []).find((d) => d.name === 'Times Square');
    const ave7 = ALL_AVENUES.find((a) => a.id === '7');
    if (!def || !ave7) return null;
    const [ax, az] = def.a;
    const [bx, bz] = def.b;
    return {
      zN: streetZ(47) - 6,
      zS: streetZ(42) + 6,
      x7: ave7.x,
      half7: ave7.width * 0.5 + 1,
      halfB: def.w * 0.5 + 1,
      xAt: (z) => ax + ((z - az) / (bz - az)) * (bx - ax)
    };
  })();
  const inBowtie = (x, z) => !!TS && z > TS.zN && z < TS.zS && (Math.abs(x - TS.xAt(z)) < TS.halfB || Math.abs(x - TS.x7) < TS.half7);
  // Does the lot edge at x (dir -1: its west edge, +1: its east edge; in the current frame) look across the sidewalk
  // onto the bowtie?
  const frontsBowtie = (x, dir, z0, z1) => [0.25, 0.5, 0.75].some((f) => [6, 12, 20].some((t) => inBowtie(...toWorld(x + dir * t, z0 + (z1 - z0) * f))));

  // ============================================================================
  // BUILDING MASSING TOOLKIT
  // A building is a list of non-overlapping parts { x0, x1, z0, z1, y0, y1 } on one lot: footprints carved into
  // plans, extruded storey by storey, tiers stacked on whole storeys
  // ============================================================================
  const BLOCK_COLLIDER_TOP = 26; // every block gets one collider up to here; taller parts add their own

  // East River bridge approaches on Manhattan: no building may stand under a deck (from its street-level landing out to
  // the first tower) or on a masonry anchorage. Oriented boxes { cx, cz, ux, uz, hl, hw } (u = along the bridge).
  const bridgeCorridors = [];
  for (const s of EAST_RIVER_BRIDGES || []) {
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const L = Math.hypot(dx, dz);
    const box = (t0, t1, hw) => bridgeCorridors.push({
      cx: s.a.x + dx * (t0 + t1) * 0.5, cz: s.a.z + dz * (t0 + t1) * 0.5, ux: dx / L, uz: dz / L, hl: (t1 - t0) * L * 0.5, hw
    });
    box(-4 / L, s.towers[0] + 8 / L, s.width * 0.5 + 3);
    box(s.towers[0] - 11 / L, s.towers[0] + 11 / L, s.width * 0.5 + 8); // first pier / caisson (wider than the deck)
    if (s.anchorage) {
      const ta = s.towers[0] - s.sideSpan / L;
      const hl = (s.anchorage[0] * 0.5 + 3) / L;
      box(ta - hl, ta + hl, (s.width + s.anchorage[1]) * 0.5 + 3);
    }
  }
  // ... nor under the South Street Viaduct and its Battery Park Underpass portal (laid out by city-grid.js)
  for (const o of (window.NYC.fdrViaduct && window.NYC.fdrViaduct.boxes) || []) bridgeCorridors.push(o);
  // Separating-axis test of the rect [x0, x1] x [z0, z1] (of the current frame) against every corridor box
  function hitsBridgeCorridor(x0, x1, z0, z1) {
    const hx = (x1 - x0) * 0.5;
    const hz = (z1 - z0) * 0.5;
    const [cx, cz] = toWorld(x0 + hx, z0 + hz);
    // the rect's axes in the world (R_y(θ) of local x and z)
    const ax = xf ? xf.cs : 1, az = xf ? -xf.sn : 0;
    const bx = xf ? xf.sn : 0, bz = xf ? xf.cs : 1;
    for (const o of bridgeCorridors) {
      const dx = cx - o.cx;
      const dz = cz - o.cz;
      const vx = -o.uz, vz = o.ux;
      let apart = false;
      for (const [nx, nz] of [[ax, az], [bx, bz], [o.ux, o.uz], [vx, vz]]) {
        const r = hx * Math.abs(ax * nx + az * nz) + hz * Math.abs(bx * nx + bz * nz) +
          o.hl * Math.abs(o.ux * nx + o.uz * nz) + o.hw * Math.abs(vx * nx + vz * nz);
        if (Math.abs(dx * nx + dz * nz) >= r) { apart = true; break; }
      }
      if (!apart) return true;
    }
    return false;
  }

  function building(blk, mat, lot) {
    return {
      mat,
      lot,
      parts: [],
      // Lot sides facing a street; the others are party walls / rear lot lines shared with neighbours
      street: {
        n: lot.z0 - blk.minZ < EPS,
        s: blk.maxZ - lot.z1 < EPS,
        w: lot.x0 - blk.minX < EPS,
        e: blk.maxX - lot.x1 < EPS
      }
    };
  }

  // Extrude footprint `rects` from storey f0 up to storey f1
  function mass(b, rects, f0, f1) {
    if (f1 <= f0) return;
    const s = storeys[b.mat];
    for (const r of rects) {
      if (r.x1 - r.x0 < 0.5 || r.z1 - r.z0 < 0.5) continue;
      b.parts.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y0: f0 * s, y1: f1 * s });
    }
  }

  // `r` pulled back `d` from the lot's street sides (and `party` from its party walls): zoning setbacks
  function streetInset(b, r, d, party = 0) {
    const s = b.street;
    return rect(r.x0 + (s.w ? d : party), r.x1 - (s.e ? d : party), r.z0 + (s.n ? d : party), r.z1 - (s.s ? d : party));
  }

  // Storeys `f` capped so a tower rises at most ~7x as tall as its lot is narrow (no needles on the small lots of
  // Lower Manhattan's irregular blocks)
  const slender = (f, lot, mat) => Math.min(f, Math.max(6, Math.floor((Math.min(rectW(lot), rectD(lot)) * 7) / storeys[mat])));

  // How far part p's cornice reaches past its `side` wall: `oh` out into open air, flush against parts of the same
  // building rising past it, tucked just inside party walls (a neighbour's own ledge may run at the same height)
  function corniceReach(b, p, side, oh) {
    const alongX = side === 'n' || side === 's';
    const c = side === 'n' ? p.z0 : side === 's' ? p.z1 : side === 'w' ? p.x0 : p.x1;
    const edge = side === 'n' ? b.lot.z0 : side === 's' ? b.lot.z1 : side === 'w' ? b.lot.x0 : b.lot.x1;
    if (Math.abs(c - edge) < EPS && !b.street[side]) return -0.03;
    for (const q of b.parts) {
      if (q === p || q.y1 < p.y1 - EPS || q.y0 > p.y1 - EPS) continue;
      const qc = side === 'n' ? q.z1 : side === 's' ? q.z0 : side === 'w' ? q.x1 : q.x0;
      if (Math.abs(qc - c) > EPS) continue;
      if (alongX ? (q.x0 < p.x1 - EPS && q.x1 > p.x0 + EPS) : (q.z0 < p.z1 - EPS && q.z1 > p.z0 + EPS)) return 0;
    }
    return oh;
  }

  // The spans of [a0, a1] left after removing the `cuts` ([c0, c1] pairs)
  function spanMinus(a0, a1, cuts) {
    let spans = [[a0, a1]];
    for (const [c0, c1] of cuts) {
      const next = [];
      for (const [s0, s1] of spans) {
        if (c1 <= s0 + EPS || c0 >= s1 - EPS) {
          next.push([s0, s1]);
          continue;
        }
        if (c0 > s0 + EPS) next.push([s0, c0]);
        if (c1 < s1 - EPS) next.push([c1, s1]);
      }
      spans = next;
    }
    return spans;
  }
  const spanLen = (spans) => spans.reduce((t, [s0, s1]) => t + s1 - s0, 0);

  // What part p's `side` wall looks out on: the spans of it not hidden by parts of the same building built flush
  // against it, and how much of those the building's own wings screen across a court or light well
  function wallView(b, p, side) {
    const alongX = side === 'n' || side === 's';
    const c = side === 'n' ? p.z0 : side === 's' ? p.z1 : side === 'w' ? p.x0 : p.x1;
    const flush = [];
    const across = [];
    for (const q of b.parts) {
      if (q === p || q.y1 < p.y0 + EPS || q.y0 > p.y1 - EPS) continue;
      const qc = side === 'n' ? q.z1 : side === 's' ? q.z0 : side === 'w' ? q.x1 : q.x0;
      const gap = side === 'n' || side === 'w' ? c - qc : qc - c;
      if (gap < -EPS) continue; // beside or behind the wall
      (gap < EPS ? flush : across).push(alongX ? [q.x0, q.x1] : [q.z0, q.z1]);
    }
    const visible = spanMinus(alongX ? p.x0 : p.z0, alongX ? p.x1 : p.z1, flush);
    const open = visible.flatMap(([s0, s1]) => spanMinus(s0, s1, across));
    return { visible, screened: spanLen(visible) - spanLen(open) };
  }

  // Facade treatment of each wall of part p, in createFacadeBoxes `faces` order (w, e, n, s). Street fronts (the lot
  // fronts a street there and the building's own wings don't screen most of the wall) get storefronts (`shops[side]`)
  // or a residential entrance, and so do the side walls of courts open to the street; walls on the lot lines shared
  // with neighbours stay windowless; the rest are rear yard, court & air-shaft walls. A `freestanding` building
  // (towers in the park) fronts every way; `o.walls` forces one WALL_KINDS everywhere.
  function wallKinds(b, p, shops, o) {
    if (o.walls !== undefined) return [o.walls, o.walls, o.walls, o.walls];
    const front = (side) => (shops[side] ? WALL_KINDS.shop : WALL_KINDS.entry);
    return ['w', 'e', 'n', 's'].map((side) => {
      if (o.freestanding) return front(side);
      const { visible, screened } = wallView(b, p, side);
      if (b.street[side] && screened < spanLen(visible) * 0.5) return front(side);
      const c = side === 'w' ? p.x0 : side === 'e' ? p.x1 : side === 'n' ? p.z0 : p.z1;
      const edge = side === 'w' ? b.lot.x0 : side === 'e' ? b.lot.x1 : side === 'n' ? b.lot.z0 : b.lot.z1;
      if (!b.street[side] && Math.abs(c - edge) < EPS) return WALL_KINDS.lotLine; // (see openOntoVoidLots)
      // A court wall reaching the street line belongs to a court open to the street
      const alongX = side === 'n' || side === 's';
      const [e0, e1, s0, s1] = alongX ? [b.lot.x0, b.lot.x1, b.street.w, b.street.e] : [b.lot.z0, b.lot.z1, b.street.n, b.street.s];
      const onStreet = visible.some(([a, z]) => (s0 && a - e0 < EPS) || (s1 && e1 - z < EPS));
      return screened > EPS && onStreet ? WALL_KINDS.entry : WALL_KINDS.rear;
    });
  }

  // Lots left empty under a bridge approach (see commit): the lot-line walls of the buildings next to them look out
  // over the gap, so they get windows like a rear wall
  function openOntoVoidLots(blk) {
    if (!blk.voidLots.length) return;
    for (const e of blk.facadeBoxes) {
      const x0 = e.x - e.w * 0.5;
      const x1 = e.x + e.w * 0.5;
      const z0 = e.z - e.d * 0.5;
      const z1 = e.z + e.d * 0.5;
      // The 2 m strip beyond each wall: w, e, n, s
      const strips = [[x0 - 2, x0, z0, z1], [x1, x1 + 2, z0, z1], [x0, x1, z0 - 2, z0], [x0, x1, z1, z1 + 2]];
      strips.forEach(([a0, a1, b0, b1], k) => {
        if (e.faces[k] !== WALL_KINDS.lotLine) return;
        const open = blk.voidLots.some((v) => v.x0 < a1 - EPS && v.x1 > a0 + EPS && v.z0 < b1 - EPS && v.z1 > b0 + EPS);
        if (open) e.faces[k] = WALL_KINDS.rear;
      });
    }
  }

  // Ground-floor frontage on an avenue: storefront awnings (if it has shops), remembered for scaffolding sheds
  function avenueFront(blk, side, z0, z1, shops = true) {
    blk.avenueFronts[side].push([z0, z1]);
    const len = z1 - z0;
    const n = Math.max(1, Math.round(len / 12));
    const seg = len / n;
    if (seg < 4.5) return;
    for (let k = 0; k < n; k++) {
      if (!chance(0.62)) continue;
      const colorIdx = irange(0, 4);
      if (!shops) continue;
      blk.awnings.push({
        x: side === 'w' ? blk.minX - 0.9 : blk.maxX + 0.9,
        y: 3.8,
        z: z0 + seg * (k + 0.5),
        w: 1.8,
        d: Math.min(8.5, seg - 1.6),
        sideDir: side === 'w' ? -1 : 1,
        colorIdx
      });
    }
  }

  /**
   * Emits building `b`: facade boxes, map footprints, colliders for parts above the block collider, stone cornices
   * under every masonry roof line, rooftop bulkhead & water tower, fire escapes and avenue storefront awnings.
   * o: { cornice, corniceH, roof: 'mech' | 'prewar' | 'walkup' | 'none', wtP, hvacH, fireEscapes, rearFireEscapes,
   *      awnings, shops: 'all' | 'avenue' | 'none' | probability of 'all' (street fronts with storefronts on the
   *      ground floor, the others get a residential entrance), freestanding, walls (see wallKinds) }
   */
  function commit(blk, b, o = {}) {
    const parts = b.parts;
    if (!parts.length) return;
    if (parts.some((p) => hitsBridgeCorridor(p.x0, p.x1, p.z0, p.z1))) {
      blk.voidLots.push(b.lot);
      return;
    }
    const mat = b.mat;
    const storey = storeys[mat];
    const tone = rand();
    let shopsOn = o.shops ?? 'all';
    if (typeof shopsOn === 'number') shopsOn = tone < shopsOn ? 'all' : 'none';
    const shops = { w: shopsOn !== 'none', e: shopsOn !== 'none', n: shopsOn === 'all', s: shopsOn === 'all' };
    let top = parts[0];
    for (const p of parts) {
      const w = p.x1 - p.x0;
      const d = p.z1 - p.z0;
      const h = p.y1 - p.y0;
      const box = { x: p.x0 + w * 0.5, y: p.y0 + h * 0.5, z: p.z0 + d * 0.5, w, h, d, faces: wallKinds(b, p, shops, o), tone };
      buckets[mat].push(box);
      blk.facadeBoxes.push(box);
      blk.footprints.push({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, h: p.y1, tone });
      if (p.y1 > blk.maxH) blk.maxH = p.y1;
      if (p.y1 > BLOCK_COLLIDER_TOP) pushCollider(p.x0, p.x1, p.z0, p.z1, p.y1);
      if (p.y1 > top.y1 + EPS || (p.y1 > top.y1 - EPS && w * d > rectW(top) * rectD(top))) top = p;
    }

    // 1. Stone cornices & setback ledges
    if (o.cornice ?? mat <= 2) {
      const ch = o.corniceH ?? (mat === 2 ? 0.75 : 0.9);
      for (const p of parts) {
        const x0 = p.x0 - corniceReach(b, p, 'w', 0.6);
        const x1 = p.x1 + corniceReach(b, p, 'e', 0.6);
        const z0 = p.z0 - corniceReach(b, p, 'n', 0.6);
        const z1 = p.z1 + corniceReach(b, p, 's', 0.6);
        blk.cornices.push({ x: (x0 + x1) * 0.5, y: p.y1, z: (z0 + z1) * 0.5, w: x1 - x0, h: ch, d: z1 - z0 });
      }
    }

    // 2. Rooftop gear on the highest roof: water tower on one half, bulkhead / mechanical penthouse on the other
    const roof = o.roof ?? 'mech';
    if (roof !== 'none') {
      const tw = rectW(top);
      const td = rectD(top);
      const halves = tw >= td
        ? [rect(top.x0, top.x0 + tw * 0.5, top.z0, top.z1), rect(top.x0 + tw * 0.5, top.x1, top.z0, top.z1)]
        : [rect(top.x0, top.x1, top.z0, top.z0 + td * 0.5), rect(top.x0, top.x1, top.z0 + td * 0.5, top.z1)];
      if (chance(0.5)) halves.reverse();
      let bulkheadArea = top;
      if (roof !== 'mech' && chance(o.wtP ?? 0.7)) {
        const fits = (r) => rectW(r) >= 4.6 && rectD(r) >= 4.6;
        const spot = fits(halves[0]) ? halves[0] : fits(top) ? top : null;
        if (spot) {
          const jx = rectW(spot) * 0.5 - 2.3;
          const jz = rectD(spot) * 0.5 - 2.3;
          blk.waterTowers.push({
            x: (spot.x0 + spot.x1) * 0.5 + range(-jx, jx),
            y: top.y1,
            z: (spot.z0 + spot.z1) * 0.5 + range(-jz, jz)
          });
          bulkheadArea = spot === top ? null : halves[1];
        }
      }
      if (bulkheadArea) {
        const aw = rectW(bulkheadArea);
        const ad = rectD(bulkheadArea);
        const big = roof === 'mech';
        const hw = Math.min(aw - 1.2, big ? Math.max(3, aw * range(0.4, 0.65)) : range(2.4, 4.2));
        const hd = Math.min(ad - 1.2, big ? Math.max(3, ad * range(0.4, 0.65)) : range(2.4, 4.2));
        if (hw >= 1.8 && hd >= 1.8) {
          const jx = (aw - hw) * 0.5 - 0.6;
          const jz = (ad - hd) * 0.5 - 0.6;
          blk.hvacUnits.push({
            x: (bulkheadArea.x0 + bulkheadArea.x1) * 0.5 + range(-jx, jx),
            y: top.y1,
            z: (bulkheadArea.z0 + bulkheadArea.z1) * 0.5 + range(-jz, jz),
            w: hw,
            h: o.hvacH ?? (big ? range(3.4, 5.8) : range(2.4, 3.2)),
            d: hd
          });
        }
      }
    }

    // 3. Wrought-iron fire escapes on walk-up street fronts (and over the rear yards)
    if (o.fireEscapes) {
      for (const p of parts) {
        if (p.y0 > EPS) continue;
        const nf = Math.round(p.y1 / storey);
        const w = p.x1 - p.x0;
        if (nf < 3 || w < 4.6) continue;
        // A landing per floor from the 2nd up (3.45m apart, see ironMat), ending at the top landing's rail
        const landings = Math.min(nf - 1, 7);
        const h = (landings - 1) * 3.45 + 1;
        for (const side of ['n', 's']) {
          const front = side === 'n' ? p.z0 - blk.minZ < EPS : blk.maxZ - p.z1 < EPS;
          if (!front) {
            const gap = side === 'n' ? p.z0 - b.lot.z0 : b.lot.z1 - p.z1;
            if (!o.rearFireEscapes || gap < 1.2 || corniceReach(b, p, side, 1) <= 0) continue;
          }
          const z = side === 'n' ? p.z0 - 0.55 : p.z1 + 0.55;
          const count = w >= 15 ? 2 : 1;
          for (let k = 0; k < count; k++) {
            blk.fireEscapes.push({ x: p.x0 + (w * (k + 0.5)) / count, y: 3.55, z, h });
          }
        }
      }
    }

    // 4. Storefront awnings along the avenue frontage (the dice are rolled either way, so the block stays the same)
    if (o.awnings !== false) {
      for (const p of parts) {
        if (p.y0 > EPS) continue;
        if (p.x0 - blk.minX < EPS) avenueFront(blk, 'w', p.z0, p.z1, shops.w);
        if (blk.maxX - p.x1 < EPS) avenueFront(blk, 'e', p.z0, p.z1, shops.e);
      }
    }
  }

  // Corner treatments for tower shafts: notched (re-entrant corners), stepped (double notches), plus (cruciform),
  // L (one corner cut away) or a plain rect
  function shapeHoles(r, shape) {
    const w = rectW(r);
    const d = rectD(r);
    const m = Math.min(w, d);
    if (shape === 'notched') {
      const n = Math.min(range(2, 4), m * 0.22);
      return n >= 1.2 ? cornerHoles(r, n, n) : [];
    }
    if (shape === 'stepped') {
      const a = Math.min(range(3, 4.5), m * 0.26);
      return a >= 2 ? [...cornerHoles(r, a, a * 0.5), ...cornerHoles(r, a * 0.5, a)] : [];
    }
    if (shape === 'plus') return cornerHoles(r, w * range(0.24, 0.3), d * range(0.24, 0.3));
    if (shape === 'L') return cornerHoles(r, w * range(0.35, 0.5), d * range(0.35, 0.5), [pick(['nw', 'ne', 'sw', 'se'])]);
    return [];
  }

  // ============================================================================
  // MID-BLOCK ROW BUILDINGS (lots fronting one side street, `side` = that street; half the block deep)
  // ============================================================================

  // Brownstones, rowhouses & townhouses: front block plus an optional lower rear extension into the yard
  function rowhouse(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const D = sideDepth(lot, side);
    const dep = Math.min(D - 0.8, k.depth);
    mass(b, [sideRect(lot, side, 0, L, 0, dep)], 0, k.floors);
    const ext = Math.min(range(2.2, 4), D - dep - 0.6);
    if (ext > 1.5 && chance(0.45)) {
      const ew = L * range(0.45, 0.65);
      const ea = chance(0.5) ? 0 : L - ew;
      mass(b, [sideRect(lot, side, ea, ea + ew, dep, dep + ext)], 0, Math.max(1, k.floors - irange(1, 2)));
    }
    commit(blk, b, { corniceH: 0.7, roof: 'none', shops: 'none' });
  }

  // Tenements: deep walk-ups with fire escapes. Old-law "dumbbells" pinch in at air shafts on both party walls,
  // wider new-law ones open a light court onto the rear yard
  function tenement(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const D = sideDepth(lot, side);
    const dep = Math.min(D - 0.5, k.depth);
    const holes = [];
    if (L < 13.5 && chance(0.55)) {
      const sw = range(0.9, 1.4);
      const sd = range(2.4, 4);
      const sb = dep * range(0.38, 0.5);
      holes.push(sideRect(lot, side, -1, sw, sb, sb + sd), sideRect(lot, side, L - sw, L + 1, sb, sb + sd));
    } else if (L >= 13.5 && chance(0.6)) {
      const cw = L * range(0.24, 0.36);
      const cd = dep * range(0.3, 0.45);
      holes.push(sideRect(lot, side, (L - cw) * 0.5, (L + cw) * 0.5, dep - cd, dep + 1));
    }
    mass(b, carve(sideRect(lot, side, 0, L, 0, dep), holes, 'z'), 0, k.floors);
    commit(blk, b, { fireEscapes: true, rearFireEscapes: chance(0.6), roof: 'walkup', wtP: k.floors >= 6 ? 0.3 : 0.08, shops: 0.3 });
  }

  // Pre-war elevator apartment house mid-block: light court onto the yard (or the street) or shafts on the party
  // walls, sometimes setback penthouse floors behind a terrace
  function midApartment(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const D = sideDepth(lot, side);
    const dep = Math.min(D, k.depth);
    const plan = L >= 14
      ? pickW([['rearCourt', 4], ['frontCourt', 1.2], ['shafts', 1.5], ['rect', 1]])
      : pickW([['shafts', 1], ['rect', 1]]);
    const holes = [];
    let solid = dep; // depth of the street-front bar left whole
    if (plan === 'rearCourt') {
      const cw = L * range(0.28, 0.4);
      const cd = dep * range(0.35, 0.55);
      holes.push(sideRect(lot, side, (L - cw) * 0.5, (L + cw) * 0.5, dep - cd, dep + 1));
      solid = dep - cd;
    } else if (plan === 'frontCourt') {
      const cw = L * range(0.3, 0.4);
      const cd = dep * range(0.25, 0.38);
      holes.push(sideRect(lot, side, (L - cw) * 0.5, (L + cw) * 0.5, -1, cd));
      solid = 0;
    } else if (plan === 'shafts') {
      const sw = range(1.4, 2.4);
      const sd = range(3, 5);
      const sb = dep * range(0.35, 0.5);
      holes.push(sideRect(lot, side, -1, sw, sb, sb + sd), sideRect(lot, side, L - sw, L + 1, sb, sb + sd));
      solid = sb;
    }
    mass(b, carve(sideRect(lot, side, 0, L, 0, dep), holes, 'z'), 0, k.floors);
    const terrace = range(2.4, 3.4);
    if (solid - terrace >= 3.5 && chance(0.35)) {
      mass(b, [sideRect(lot, side, 0, L, terrace, solid)], k.floors, k.floors + irange(1, 2));
    }
    commit(blk, b, { roof: 'prewar', wtP: 0.75, shops: 'none' });
  }

  // Post-war brick apartment slab, often behind a planted strip, with a rear wing; plain parapet, big bulkhead
  function postwarApartment(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const D = sideDepth(lot, side);
    const front = chance(0.55) ? range(1.5, 3.5) : 0;
    const dep = Math.min(D, k.depth);
    const holes = [];
    if (L > 18 && chance(0.5)) {
      const cw = L * range(0.3, 0.45);
      const cd = (dep - front) * range(0.3, 0.45);
      holes.push(chance(0.5)
        ? sideRect(lot, side, -1, cw, dep - cd, dep + 1)
        : sideRect(lot, side, L - cw, L + 1, dep - cd, dep + 1));
    }
    mass(b, carve(sideRect(lot, side, 0, L, front, dep), holes, 'z'), 0, k.floors);
    commit(blk, b, { cornice: false, roof: 'mech', shops: 'none' });
  }

  // Mid-block loft on a half lot (Village / Chelsea side streets)
  function loftRow(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const dep = Math.min(sideDepth(lot, side), k.depth);
    const holes = L > 12 && chance(0.4) ? [sideRect(lot, side, L * 0.3, L * 0.7, dep * range(0.6, 0.75), dep + 1)] : [];
    mass(b, carve(sideRect(lot, side, 0, L, 0, dep), holes, 'z'), 0, k.floors);
    commit(blk, b, { roof: 'walkup', wtP: 0.6, fireEscapes: chance(0.35), shops: 0.75 });
  }

  // One- and two-storey "taxpayers", garages & old stables
  function lowRow(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    mass(b, [sideRect(lot, side, 0, sideLen(lot, side), 0, Math.min(sideDepth(lot, side), k.depth))], 0, k.floors);
    commit(blk, b, { corniceH: 0.5, roof: 'none' });
  }

  // Mid-block lot kinds: lot width (m), run (identical neighbours built together), storeys, depth (share of the half
  // block), facade weights
  const ROW_KINDS = {
    brownstone: { w: [5.8, 7.4], run: [3, 8], floors: [4, 5], depth: [0.6, 0.78], mats: [[2, 6], [1, 2], [0, 1]], build: rowhouse },
    rowhouse: { w: [5.4, 7.6], run: [2, 6], floors: [3, 4], depth: [0.55, 0.75], mats: [[1, 6], [2, 2], [0, 1]], build: rowhouse },
    townhouse: { w: [7, 11], run: [1, 3], floors: [4, 6], depth: [0.7, 0.86], mats: [[0, 5], [2, 2], [1, 1]], build: rowhouse },
    tenement: { w: [7.6, 12.5], run: [2, 6], floors: [5, 6], depth: [0.8, 0.94], mats: [[1, 6], [0, 2], [2, 2]], build: tenement },
    midApt: { w: [14, 24], run: [1, 1], floors: [8, 13], depth: [0.9, 1.0], mats: [[0, 5], [1, 4]], build: midApartment },
    postwarApt: { w: [16, 28], run: [1, 1], floors: [9, 16], depth: [0.8, 1.0], mats: [[0, 6], [1, 3]], build: postwarApartment },
    loft: { w: [8, 16], run: [1, 3], floors: [6, 10], depth: [0.9, 1.0], mats: [[1, 5], [0, 4]], build: loftRow },
    low: { w: [7, 14], run: [1, 1], floors: [1, 2], depth: [0.85, 1.0], mats: [[1, 1], [0, 1]], build: lowRow },
    garden: { w: [6, 11], run: [1, 1], floors: [0, 0], depth: [0, 0], mats: [[1, 1]], build: null } // vacant lot
  };

  // Fill the frontage [a, b] of one side street with runs of row buildings
  function fillFrontage(blk, a, b, side, cfg) {
    const halfD = (blk.maxZ - blk.minZ) * 0.5;
    let x = a;
    while (b - x > 0.5) {
      const kindName = pickW(cfg.rows);
      const kind = ROW_KINDS[kindName];
      const fl = (cfg.kf && cfg.kf[kindName]) || kind.floors;
      const run = irange(kind.run[0], kind.run[1]);
      const lotW = range(kind.w[0], kind.w[1]);
      const mat = pickW(kind.mats);
      const floorsRun = irange(fl[0], fl[1]);
      const depthRun = halfD * range(kind.depth[0], kind.depth[1]);
      for (let i = 0; i < run && b - x > 0.5; i++) {
        let w = lotW * range(0.96, 1.04);
        if (b - x - w < kind.w[0] * 0.6) w = b - x;
        const lot = side === 'n' ? rect(x, x + w, blk.minZ, blk.minZ + halfD) : rect(x, x + w, blk.maxZ - halfD, blk.maxZ);
        if (kind.build) {
          kind.build(blk, lot, side, {
            mat,
            floors: Math.max(1, floorsRun + (chance(0.2) ? pick([-1, 1]) : 0)),
            depth: Math.min(halfD, depthRun * range(0.95, 1.05))
          });
        }
        x += w;
      }
    }
  }

  // ============================================================================
  // APARTMENT HOUSES (corner lots along an avenue, through-block lots mid-block)
  // ============================================================================

  // Pre-war apartment house on its corner lot (`side` = the avenue): light courts in U, E, H, ring or L plans, and
  // setback crown floors over the solid avenue bar on the grander ones
  function prewarHouse(blk, side, lot, cfg, grand) {
    const inner = OPPOSITE[side];
    const L = rectD(lot); // avenue frontage
    const W = rectW(lot); // depth into the block
    const b = building(blk, pickW(grand ? cfg.grandMats : cfg.prewarMats), lot);
    const f = grand ? irange(cfg.grand[0], cfg.grand[1]) : irange(cfg.prewar[0], cfg.prewar[1]);
    const plan = pickW([
      ['U', 4],
      ['E', L >= 24 ? 1.5 : 0],
      ['ring', W >= 17 && L >= 20 ? 2 : 0],
      ['H', W >= 15 ? 1.5 : 0],
      ['L', 1.5],
      ['rect', 1.2]
    ]);
    let holes = [];
    let core = lot; // solid part a crown may rise from
    if (plan === 'U') {
      const cw = Math.min(L - 10, L * range(0.3, 0.42));
      const cd = W * range(0.35, 0.55);
      holes = [courtHole(lot, inner, cw, cd)];
      core = sideRect(lot, side, 0, L, 0, W - cd);
    } else if (plan === 'E') {
      const cw = L * range(0.13, 0.18);
      const cd = W * range(0.35, 0.5);
      holes = [courtHole(lot, inner, cw, cd, -L * 0.22), courtHole(lot, inner, cw, cd, L * 0.22)];
      core = sideRect(lot, side, 0, L, 0, W - cd);
    } else if (plan === 'ring') {
      holes = [insetAll(lot, range(5.8, 7.2))];
      core = null;
    } else if (plan === 'H') {
      const cw = W * range(0.32, 0.42);
      const cd = L * range(0.18, 0.26);
      holes = [courtHole(lot, 'n', cw, cd), courtHole(lot, 's', cw, cd)];
      core = rect(lot.x0, lot.x1, lot.z0 + cd, lot.z1 - cd);
    } else if (plan === 'L') {
      const cw = L * range(0.35, 0.5);
      const cd = W * range(0.4, 0.6);
      holes = [chance(0.5) ? sideRect(lot, inner, -1, cw, -1, cd) : sideRect(lot, inner, L - cw, L + 1, -1, cd)];
      core = sideRect(lot, side, 0, L, 0, W - cd);
    }
    mass(b, carve(lot, holes, 'x'), 0, f);
    const tiers = !core ? 0 : grand ? (chance(0.75) ? irange(1, 2) : 0) : (chance(0.3) ? 1 : 0);
    let cur = core;
    let fl = f;
    for (let t = 0; t < tiers; t++) {
      const next = insetAll(cur, range(2.2, 3.4));
      if (rectW(next) < 6 || rectD(next) < 6) break;
      const tf = irange(1, 3);
      mass(b, [next], fl, fl + tf);
      cur = next;
      fl += tf;
    }
    commit(blk, b, { roof: 'prewar', wtP: grand ? 0.5 : 0.75, shops: !grand && shopsOnAvenue(blk, side) ? 'avenue' : 'none' });
  }

  // Central Park West twin-towered apartment house (San Remo, Eldorado, Century, Majestic)
  function twinTower(blk, side, lot) {
    const inner = OPPOSITE[side];
    const L = rectD(lot);
    const W = rectW(lot);
    const b = building(blk, 0, lot);
    const f = irange(14, 17);
    const cd = W * range(0.38, 0.5);
    mass(b, carve(lot, [courtHole(lot, inner, L * range(0.24, 0.32), cd)], 'x'), 0, f);
    const tw = Math.min(W - cd - 2, range(9, 12));
    const td = Math.min(L * 0.36, range(8, 10.5));
    const t1 = irange(6, 9);
    const t2 = irange(2, 3);
    for (const a0 of [1.6, L - 1.6 - td]) {
      const tower = sideRect(lot, side, a0, a0 + td, 1.6, 1.6 + tw);
      mass(b, [tower], f, f + t1);
      mass(b, [insetAll(tower, 1.6)], f + t1, f + t1 + t2);
    }
    commit(blk, b, { roof: 'prewar', wtP: 0, shops: 'none' });
  }

  // Post-war tower on a podium (white / red brick, or glass for the newer condos): shaft pulled back from the
  // streets with notched, stepped or cruciform corners; plain parapet & big mechanical penthouse
  function postwarTower(blk, side, lot, cfg, glass) {
    const L = rectD(lot);
    const W = rectW(lot);
    const mat = glass ? pickW([[3, 3], [5, 3], [4, 1]]) : pickW(cfg.towerMats);
    const b = building(blk, mat, lot);
    const pf = mat >= 3 ? irange(2, 5) : irange(1, 2);
    const f = pf + irange(cfg.tower[0], cfg.tower[1]);
    const plaza = chance(0.3) ? range(3, 6) : 0;
    const podium = sideRect(lot, side, 0, L, plaza, W);
    mass(b, [podium], 0, pf);
    const st = range(1.5, 3.2);
    let shaft = sideRect(lot, side, st, L - st, plaza + range(0, 2.5), W - range(0, 2));
    if (rectW(shaft) < 9 || rectD(shaft) < 9) shaft = podium;
    mass(b, carve(shaft, shapeHoles(shaft, pickW([['notched', 3], ['rect', 2], ['stepped', 1.5], ['plus', 0.8]])), 'x'), pf, f);
    commit(blk, b, { cornice: false, roof: 'mech', shops: shopsOnAvenue(blk, side) ? 'avenue' : 'none' });
  }

  // Through-block pre-war apartment house mid-block: H (front courts on both streets), ring, U or dumbbell plans
  function throughApartment(blk, lot, cfg) {
    const b = building(blk, pickW(cfg.prewarMats), lot);
    const W = rectW(lot);
    const D = rectD(lot);
    const f = irange(cfg.prewar[0], cfg.prewar[1]);
    const plan = pickW([['H', 3], ['ring', W >= 18 ? 2 : 0], ['U', 2], ['dumbbell', 2], ['rect', 1]]);
    let holes = [];
    let core = null;
    if (plan === 'H') {
      const cd = D * range(0.2, 0.3);
      holes = [courtHole(lot, 'n', W * range(0.3, 0.42), cd), courtHole(lot, 's', W * range(0.3, 0.42), cd)];
      core = rect(lot.x0, lot.x1, lot.z0 + cd, lot.z1 - cd);
    } else if (plan === 'ring') {
      holes = [insetAll(lot, range(5.5, 7))];
    } else if (plan === 'U') {
      const s = pick(['n', 's']);
      const cd = D * range(0.3, 0.45);
      holes = [courtHole(lot, s, W * range(0.3, 0.42), cd)];
      core = sideRect(lot, OPPOSITE[s], 0, W, 0, D - cd);
    } else if (plan === 'dumbbell') {
      holes = [courtHole(lot, 'w', D * range(0.25, 0.35), W * range(0.15, 0.22)), courtHole(lot, 'e', D * range(0.25, 0.35), W * range(0.15, 0.22))];
    } else {
      core = lot;
    }
    mass(b, carve(lot, holes, plan === 'dumbbell' ? 'z' : 'x'), 0, f);
    if (core && chance(0.35)) {
      const crown = insetAll(core, range(2.4, 3.4));
      if (rectW(crown) >= 6 && rectD(crown) >= 6) mass(b, [crown], f, f + irange(1, 2));
    }
    commit(blk, b, { roof: 'prewar', wtP: 0.75, shops: 'none' });
  }

  // Corner building(s) along an avenue: `side` is the avenue edge of `lot`, which spans the block's full depth
  function avenueEnd(blk, side, type, lot, cfg) {
    const inner = OPPOSITE[side];
    if (type === 'walkups') {
      // Two or three walk-ups side by side along the avenue, each its own height, shops below
      const L = rectD(lot);
      const W = rectW(lot);
      const n = L > 24 && chance(0.4) ? 3 : 2;
      const cuts = n === 2
        ? [lot.z0, lot.z0 + L * range(0.42, 0.58), lot.z1]
        : [lot.z0, lot.z0 + L * range(0.3, 0.37), lot.z1 - L * range(0.3, 0.37), lot.z1];
      for (let i = 0; i < n; i++) {
        const sub = rect(lot.x0, lot.x1, cuts[i], cuts[i + 1]);
        const subL = cuts[i + 1] - cuts[i];
        const b = building(blk, pickW(cfg.walkupMats), sub);
        const holes = [];
        if (W > 11 && chance(0.4)) {
          // Light well on the inner corner shared with the next walk-up
          const cw = range(2.4, 3.6);
          const cd = range(2.2, 3.4);
          holes.push(i === 0 ? sideRect(sub, inner, subL - cw, subL + 1, -1, cd) : sideRect(sub, inner, -1, cw, -1, cd));
        }
        const f = irange(cfg.walkup[0], cfg.walkup[1]);
        mass(b, carve(sub, holes, 'x'), 0, f);
        commit(blk, b, { fireEscapes: true, roof: 'walkup', wtP: f >= 6 ? 0.45 : 0.12, shops: shopsOnAvenue(blk, side) ? 'all' : 'none' });
      }
    } else if (type === 'low') {
      const b = building(blk, pickW(cfg.walkupMats), lot);
      mass(b, [lot], 0, irange(1, 2));
      commit(blk, b, { corniceH: 0.5, roof: 'none' });
    } else if (type === 'loft') {
      loftBuilding(blk, lot, cfg.loft || LOFT_CHELSEA);
    } else if (type === 'tower' || type === 'glass') {
      postwarTower(blk, side, lot, cfg, type === 'glass');
    } else if (type === 'twin') {
      twinTower(blk, side, lot);
    } else {
      prewarHouse(blk, side, lot, cfg, type === 'grand');
    }
  }

  // ============================================================================
  // BLOCK LAYOUTS: each fills the block's x range [x0, x1] (the full block unless a billboard wall took an end)
  // ============================================================================
  const END_WIDTH = {
    walkups: [10, 15],
    prewar: [15, 22],
    grand: [17, 25],
    twin: [24, 30],
    tower: [17, 26],
    glass: [16, 24],
    loft: [14, 22],
    low: [8, 14]
  };

  // Residential block: apartment houses on the avenue corners, rows of brownstones / tenements / walk-ups along
  // both side streets, their rear yards forming the block's green "donut hole"
  function residentialBlock(blk, cfg, x0, x1) {
    const span = x1 - x0;
    const tW = x0 - blk.minX < EPS ? pickW(cfg.ends.w) : 'none';
    const tE = blk.maxX - x1 < EPS ? pickW(cfg.ends.e) : 'none';
    let wW = tW === 'none' ? 0 : range(END_WIDTH[tW][0], END_WIDTH[tW][1]);
    let wE = tE === 'none' ? 0 : range(END_WIDTH[tE][0], END_WIDTH[tE][1]);
    blk.yards.push(rect(x0 + 2, x1 - 2, blk.minZ + 2.5, blk.maxZ - 2.5));

    if (span - wW - wE < 7 && (wW > 0 || wE > 0)) {
      if (span < 24 || wW === 0 || wE === 0) {
        // No room for a mid-block: one apartment house takes the whole lot
        const side = wW > 0 ? 'w' : 'e';
        avenueEnd(blk, side, side === 'w' ? tW : tE, rect(x0, x1, blk.minZ, blk.maxZ), cfg);
        return;
      }
      wW = span * (wW / (wW + wE));
      wE = span - wW;
    }
    if (wW > 0) avenueEnd(blk, 'w', tW, rect(x0, x0 + wW, blk.minZ, blk.maxZ), cfg);
    if (wE > 0) avenueEnd(blk, 'e', tE, rect(x1 - wE, x1, blk.minZ, blk.maxZ), cfg);

    // Mid-block: maybe one through-block apartment house, rows of lots on both side streets around it
    const mx0 = x0 + wW;
    const mx1 = x1 - wE;
    if (mx1 - mx0 < 0.5) return;
    const mid = mx1 - mx0;
    let segs = [[mx0, mx1]];
    if (mid >= 24 && chance(cfg.through)) {
      let tw = range(16, 28);
      if (mid - tw < 7) tw = mid;
      const free = mid - tw;
      const left = free < 14 ? (chance(0.5) ? 0 : free) : pick([0, free, range(7, free - 7)]);
      throughApartment(blk, rect(mx0 + left, mx0 + left + tw, blk.minZ, blk.maxZ), cfg);
      segs = [[mx0, mx0 + left], [mx0 + left + tw, mx1]];
    }
    for (const [a, b] of segs) {
      if (b - a < 0.5) continue;
      fillFrontage(blk, a, b, 'n', cfg);
      fillFrontage(blk, a, b, 's', cfg);
    }
  }

  // Loft building filling its lot: light well / rear yard, 1916 setbacks on the tall ones
  function loftBuilding(blk, lot, cfg) {
    const b = building(blk, pickW(cfg.mats), lot);
    const W = rectW(lot);
    const D = rectD(lot);
    const through = b.street.n && b.street.s;
    const f = irange(cfg.floors[0], cfg.floors[1]);
    const holes = [];
    if (!through) {
      const rear = b.street.n ? 's' : 'n';
      if (chance(0.45)) holes.push(sideRect(lot, rear, -1, W + 1, -1, D * range(0.1, 0.28)));
      else if (W > 12 && chance(0.4)) holes.push(courtHole(lot, rear, W * range(0.3, 0.45), D * range(0.25, 0.4)));
    } else if (D > 18 && W > 10 && chance(0.45)) {
      const walls = ['w', 'e'].filter((s) => !b.street[s]);
      if (walls.length) {
        const lw = range(3, 5.5);
        holes.push(sideRect(lot, pick(walls), D * 0.5 - lw * 0.5, D * 0.5 + lw * 0.5, -1, Math.min(W * 0.32, range(2.4, 4))));
      }
    }
    const axis = through ? 'x' : 'z';
    const cuts = [f];
    if (f >= cfg.setbackAt && chance(0.75)) {
      cuts.unshift(f - irange(2, Math.min(5, f - 8)));
      if (f >= cfg.setbackAt + 6 && chance(0.6)) cuts.unshift(cuts[0] - irange(3, 6));
    }
    let fl = 0;
    let foot = lot;
    cuts.forEach((c, i) => {
      if (i > 0) foot = streetInset(b, foot, range(2.4, 3.8));
      mass(b, carve(foot, holes, axis), fl, c);
      fl = c;
    });
    commit(blk, b, { roof: 'walkup', wtP: cfg.wtP, fireEscapes: chance(cfg.feP) });
  }

  // Loft block (SoHo, Tribeca, NoHo, Garment District, Chelsea, Flatiron): full lot coverage, corner lofts through to
  // both streets, stretches of independent half-depth lofts back to back between them
  function loftBlock(blk, cfg, x0, x1) {
    const { minZ, maxZ } = blk;
    const halfD = (maxZ - minZ) * 0.5;
    const minW = cfg.lotW[0] * 0.7;
    blk.yards.push(rect(x0 + 2, x1 - 2, minZ + 3, maxZ - 3));
    let x = x0;
    while (x1 - x > 0.5) {
      if (x - blk.minX < EPS || chance(cfg.throughP)) {
        let w = range(cfg.lotW[0], cfg.lotW[1]);
        if (x1 - x - w < minW) w = x1 - x;
        loftBuilding(blk, rect(x, x + w, minZ, maxZ), cfg);
        x += w;
        continue;
      }
      let len = range(18, 40);
      if (x1 - x - len < minW) len = x1 - x;
      for (const side of ['n', 's']) {
        let xx = x;
        while (x + len - xx > 0.5) {
          let w = range(cfg.lotW[0], cfg.lotW[1]);
          if (x + len - xx - w < minW) w = x + len - xx;
          loftBuilding(blk, side === 'n' ? rect(xx, xx + w, minZ, minZ + halfD) : rect(xx, xx + w, maxZ - halfD, maxZ), cfg);
          xx += w;
        }
      }
      x += len;
    }
  }

  // Curtain-wall tower: full-lot podium, shaft set back from the streets and the party walls (further on big lots) with
  // rect / notched / stepped / L corners, often a slimmer crown
  function glassTower(blk, lot, cfg) {
    const b = building(blk, pickW(cfg.glassMats), lot);
    let f = irange(cfg.towerFloors[0], cfg.towerFloors[1]);
    if (chance(0.12)) f += irange(3, 6);
    f = slender(f, lot, b.mat);
    const pf = Math.min(f - 6, irange(2, 8));
    mass(b, [lot], 0, pf);
    // Clear of the party walls, the shaft is glazed all round above its neighbours
    let shaft = streetInset(b, lot, range(1.5, 3.5), rectW(lot) > 44 ? range(2, 6) : 1.5);
    if (rectW(shaft) < 12 || rectD(shaft) < 12) shaft = streetInset(b, lot, 1);
    const holes = shapeHoles(shaft, pickW(cfg.shaftShapes));
    const crown = insetAll(shaft, range(2, 3.5));
    const f1 = chance(0.45) && rectW(crown) >= 8 && rectD(crown) >= 8 ? Math.max(pf + 4, Math.round(f * range(0.68, 0.82))) : f;
    mass(b, carve(shaft, holes, 'x'), pf, f1);
    if (f1 < f) mass(b, carve(crown, shapeHoles(crown, chance(0.5) ? 'notched' : 'rect'), 'x'), f1, f);
    commit(blk, b, { cornice: false, roof: 'mech' });
  }

  // 1916-zoning "wedding cake": a full-lot base, setback tiers pulled back from the streets, then a tower at least
  // ~half the lot wide; a stone cornice on every tier
  function decoTower(blk, lot, cfg) {
    const b = building(blk, pickW(cfg.decoMats), lot);
    const W = rectW(lot);
    const D = rectD(lot);
    const f = slender(irange(cfg.towerFloors[0], cfg.towerFloors[1]), lot, b.mat);
    const tiers = [lot];
    while (tiers.length < 4) {
      const cur = tiers[tiers.length - 1];
      const d = range(2, 3.4);
      const next = tiers.length === 1 ? streetInset(b, cur, d) : insetAll(cur, d);
      if (rectW(next) < Math.max(10, W * 0.45) || rectD(next) < Math.max(9, D * 0.45)) break;
      tiers.push(next);
    }
    let fl = 0;
    tiers.forEach((t, i) => {
      const last = i === tiers.length - 1;
      const left = f - fl;
      const tf = last ? left : Math.max(2, Math.round(left * (i === 0 ? range(0.38, 0.55) : range(0.35, 0.55))));
      mass(b, last && i > 0 && chance(0.45) ? carve(t, shapeHoles(t, 'notched'), 'x') : [t], fl, fl + tf);
      fl += tf;
    });
    commit(blk, b, { roof: 'prewar', wtP: 0.15 });
  }

  // International Style slab behind an open avenue plaza (Seagram / Sixth Avenue style), sometimes a low rear wing
  function slabTower(blk, lot, cfg) {
    const b = building(blk, pickW(cfg.glassMats), lot);
    const W = rectW(lot);
    const f = slender(irange(cfg.towerFloors[0], cfg.towerFloors[1]), lot, b.mat);
    const ps = b.street.w && b.street.e ? pick(['w', 'e']) : b.street.w ? 'w' : b.street.e ? 'e' : null;
    const plaza = ps ? Math.min(range(8, 14), W * 0.35) : 0;
    const zIn = range(1.5, 3);
    // Clear of the party wall as well: glazed on all four sides
    const slab = rect(
      lot.x0 + (ps === 'w' ? plaza : b.street.w ? 0 : 2),
      lot.x1 - (ps === 'e' ? plaza : b.street.e ? 0 : 2),
      lot.z0 + (b.street.n ? zIn : 0),
      lot.z1 - (b.street.s ? zIn : 0)
    );
    if (rectW(slab) > 26 && chance(0.4)) {
      const wing = rectW(slab) * range(0.3, 0.42);
      const behindW = ps !== 'e';
      mass(b, [behindW ? rect(slab.x0, slab.x1 - wing, slab.z0, slab.z1) : rect(slab.x0 + wing, slab.x1, slab.z0, slab.z1)], 0, f);
      mass(b, [behindW ? rect(slab.x1 - wing, slab.x1, lot.z0, lot.z1) : rect(slab.x0, slab.x0 + wing, lot.z0, lot.z1)], 0, irange(3, 6));
    } else {
      mass(b, [slab], 0, f);
    }
    commit(blk, b, { cornice: false, roof: 'mech' });
  }

  // Billionaires' Row: one slender supertall on a podium (kept under ~235m so the landmarks still lead the skyline)
  function slenderTower(blk, lot) {
    const mat = pickW([[5, 3], [3, 2], [0, 1]]);
    const b = building(blk, mat, lot);
    const s = storeys[mat];
    const f = irange(Math.floor(185 / s), Math.floor(235 / s));
    const pf = irange(3, 6);
    mass(b, [lot], 0, pf);
    const shaft = streetInset(b, lot, range(1, 2), 1.5); // clear of the party walls: glazed all round
    const f1 = f - irange(3, 6);
    mass(b, carve(shaft, shapeHoles(shaft, pickW([['notched', 2], ['rect', 2], ['stepped', 1]])), 'x'), pf, f1);
    mass(b, [insetAll(shaft, range(1.8, 2.6))], f1, f);
    commit(blk, b, { cornice: mat <= 2, roof: 'mech' });
  }

  function officeTower(blk, lot, cfg, style) {
    if (style === 'deco') decoTower(blk, lot, cfg);
    else if (style === 'slab') slabTower(blk, lot, cfg);
    else if (style === 'resTower') postwarTower(blk, lot.x0 - blk.minX < EPS ? 'w' : 'e', lot, cfg, false);
    else glassTower(blk, lot, cfg);
  }

  // Office-block filler: older loft / office buildings (light wells on deep lots, 1916 setbacks when tall), modern
  // glass mid-rises, the odd low holdout
  function midrise(blk, lot, cfg) {
    const mat = pickW(cfg.fillMats);
    const glass = mat >= 3;
    const b = building(blk, mat, lot);
    const W = rectW(lot);
    const D = rectD(lot);
    const f = chance(0.15) ? irange(2, 5) : irange(cfg.fillFloors[0], cfg.fillFloors[1]);
    const holes = [];
    if (!glass && D > 18 && W > 11 && chance(0.5)) {
      const walls = ['w', 'e'].filter((s) => !b.street[s]);
      if (walls.length) {
        const lw = range(3, 5);
        holes.push(sideRect(lot, pick(walls), D * 0.5 - lw * 0.5, D * 0.5 + lw * 0.5, -1, Math.min(W * 0.3, range(2.4, 4))));
      }
    }
    const f1 = !glass && f >= 12 && chance(0.7) ? f - irange(2, 4) : f;
    mass(b, carve(lot, holes, 'x'), 0, f1);
    if (f1 < f) mass(b, carve(streetInset(b, lot, range(2.4, 3.8)), holes, 'x'), f1, f);
    commit(blk, b, glass ? { cornice: false, roof: 'mech' } : { roof: 'prewar', wtP: 0.55 });
  }

  function officeFill(blk, a, b, cfg) {
    const { minZ, maxZ } = blk;
    const halfD = (maxZ - minZ) * 0.5;
    let x = a;
    while (b - x > 0.5) {
      let w = range(9, 22);
      if (b - x - w < 7) w = b - x;
      if (w > 18 || chance(0.6)) {
        midrise(blk, rect(x, x + w, minZ, maxZ), cfg);
      } else {
        midrise(blk, rect(x, x + w, minZ, minZ + halfD), cfg);
        midrise(blk, rect(x, x + w, maxZ - halfD, maxZ), cfg);
      }
      x += w;
    }
  }

  // Office block (Midtown, FiDi, Hudson Yards): a pair of towers on the avenue corners, one big tower (or a slab
  // behind a plaza) with older neighbours, or a single full-block tower. Floor plates stay real-sized (towers up to
  // ~62 m, slabs ~72 m along the street) however long the block is: the rest of it fills with older buildings
  function officeBlock(blk, cfg, x0, x1) {
    const { minZ, maxZ } = blk;
    const span = x1 - x0;
    const full = (a, b) => rect(a, b, minZ, maxZ);
    // Floor-plate caps from a position hash (no dice rolled, so blocks under the caps come out as before)
    const cap = (k, lo, hi) => lo + (hi - lo) * (Math.abs(Math.sin(x0 * 12.9898 + minZ * 78.233 + k * 37.719) * 43758.5453) % 1);
    const plan = span < 34 ? 'full' : pickW(cfg.plans);
    if (plan === 'full') {
      officeTower(blk, full(x0, x1), cfg, pickW(cfg.styles));
    } else if (plan === 'slender') {
      const w = Math.min(range(18, 24), span * 0.5);
      let left = range(0, span - w);
      if (left < 8) left = 0;
      else if (span - w - left < 8) left = span - w;
      slenderTower(blk, full(x0 + left, x0 + left + w));
      officeFill(blk, x0, x0 + left, cfg);
      officeFill(blk, x0 + left + w, x1, cfg);
    } else if (plan === 'pair') {
      let wa = Math.min(cap(1, 44, 62), Math.max(18, span * range(0.3, 0.42)));
      let wb = Math.min(cap(2, 44, 62), Math.max(18, span * range(0.3, 0.42)));
      if (span - wa - wb < 9) {
        wa += (span - wa - wb) * 0.5;
        wb = span - wa;
      }
      officeTower(blk, full(x0, x0 + wa), cfg, pickW(cfg.styles));
      officeTower(blk, full(x1 - wb, x1), cfg, pickW(cfg.styles));
      officeFill(blk, x0 + wa, x1 - wb, cfg);
    } else {
      let wm = Math.min(plan === 'plaza' ? cap(3, 58, 72) : cap(3, 46, 62), span * (plan === 'plaza' ? range(0.55, 0.75) : range(0.5, 0.68)));
      if (span - wm < 9) wm = span;
      const atW = chance(0.5);
      officeTower(blk, atW ? full(x0, x0 + wm) : full(x1 - wm, x1), cfg, plan === 'plaza' ? 'slab' : pickW(cfg.styles));
      if (atW) officeFill(blk, x0 + wm, x1, cfg);
      else officeFill(blk, x0, x1 - wm, cfg);
    }
  }

  // NYCHA "towers in the park": cruciform, H or T red-brick towers on lawns, set back from every street
  function projectsBlock(blk, cfg, x0, x1) {
    const { minZ, maxZ, cz } = blk;
    const D = maxZ - minZ;
    const n = Math.max(1, Math.min(3, Math.round((x1 - x0) / 34)));
    const slot = (x1 - x0) / n;
    blk.yards.push(rect(x0 + 1.5, x1 - 1.5, minZ + 1.5, maxZ - 1.5));
    for (let k = 0; k < n; k++) {
      const tw = Math.min(slot - 7, range(18, 24));
      const td = Math.min(D - 5, range(16.5, 20));
      if (tw < 12 || td < 12) continue;
      const cx = x0 + slot * (k + 0.5) + range(-1.5, 1.5);
      const zc = cz + range(-0.8, 0.8);
      const r = rect(cx - tw * 0.5, cx + tw * 0.5, zc - td * 0.5, zc + td * 0.5);
      const b = building(blk, pickW(cfg.mats), r);
      const shape = pickW([['plus', 4], ['H', 2], ['T', 1.5]]);
      let holes;
      if (shape === 'plus') {
        holes = cornerHoles(r, tw * range(0.27, 0.31), td * range(0.26, 0.3));
      } else if (shape === 'H') {
        const cd = td * range(0.28, 0.36);
        holes = [courtHole(r, 'n', tw * range(0.3, 0.4), cd), courtHole(r, 's', tw * range(0.3, 0.4), cd)];
      } else {
        holes = cornerHoles(r, tw * 0.32, td * range(0.4, 0.5), pick([['sw', 'se'], ['nw', 'ne']]));
      }
      mass(b, carve(r, holes, 'x'), 0, irange(cfg.floors[0], cfg.floors[1]));
      commit(blk, b, { cornice: false, roof: 'mech', hvacH: 3, awnings: false, shops: 'none', freestanding: true });
    }
  }

  // Low-rise waterfront blocks: warehouses, garages and small walk-ups (keeps the East River skyline view open)
  function lowriseBlock(blk, cfg, x0, x1) {
    const { minZ, maxZ } = blk;
    const halfD = (maxZ - minZ) * 0.5;
    let x = x0;
    while (x1 - x > 0.5) {
      let w = range(10, 26);
      if (x1 - x - w < 8) w = x1 - x;
      const lots = chance(0.6)
        ? [rect(x, x + w, minZ, maxZ)]
        : [rect(x, x + w, minZ, minZ + halfD), rect(x, x + w, maxZ - halfD, maxZ)];
      for (const lot of lots) {
        const mat = pickW([[1, 4], [0, 3], [3, 1]]);
        const f = irange(cfg.floors[0], cfg.floors[1]);
        const b = building(blk, mat, lot);
        mass(b, [lot], 0, f);
        commit(blk, b, { cornice: mat <= 2 && chance(0.6), corniceH: 0.6, roof: f >= 5 ? 'walkup' : 'none', wtP: 0.3 });
      }
      x += w;
    }
  }

  // East River lots between 1st Ave and the FDR Drive (23rd–58th St), too narrow for regular lots: a 2-4 storey podium
  // with a slab rising from it, as tall as the lot is wide allows (Kips Bay & NYU Langone hospital slabs, glass towers
  // on the old Con Ed site at 35th–41st St, Beekman & Sutton Place apartment towers). On the 42nd–45th St superblock
  // stands the United Nations Secretariat (1952): a blue-green curtain-wall slab between marble end walls, with the
  // low General Assembly hall and the North Lawn Building on the lots north of it.
  function riverfrontBlock(blk, cfg, x0, x1) {
    const { minZ, maxZ, cz } = blk;
    const lot = rect(x0, x1, minZ, maxZ);
    if (cz > -85 && cz < -10 && maxZ - minZ > 45) {
      const f = 36;
      const glass = building(blk, 3, lot);
      mass(glass, [rect(x0, x1, minZ + 2.4, maxZ - 2.4)], 0, f);
      commit(blk, glass, { cornice: false, roof: 'none' });
      const top = Math.round((f * storeys[3]) / storeys[0]);
      for (const [z0, z1] of [[minZ + 1, minZ + 2.4], [maxZ - 2.4, maxZ - 1]]) {
        const end = building(blk, 0, rect(x0 - 0.3, x1 + 0.3, z0, z1));
        mass(end, [rect(x0 - 0.3, x1 + 0.3, z0, z1)], 0, top);
        commit(blk, end, { cornice: false, roof: 'none', walls: WALL_KINDS.blankStone }); // windowless marble
      }
      return;
    }
    if (cz > -180 && cz < -90) {
      const hall = building(blk, 0, lot);
      mass(hall, [lot], 0, cz > -130 ? 7 : 4);
      commit(blk, hall, { cornice: false, roof: 'mech', hvacH: 2.6 });
      return;
    }
    const mat = cz > 180
      ? pickW([[0, 3], [3, 2], [1, 1]])
      : cz > 0 ? pickW([[5, 2], [3, 2], [4, 1], [1, 1]]) : pickW([[0, 4], [1, 2], [3, 1]]);
    const b = building(blk, mat, lot);
    const pf = irange(2, 4);
    mass(b, [lot], 0, pf);
    const sx = Math.max(0, Math.min(1.8, (x1 - x0 - 9) * 0.5));
    const slab = rect(x0 + sx, x1 - sx, minZ + range(1, 3), maxZ - range(1, 3));
    const f = cz > 180 ? irange(12, 24) : cz > 0 ? irange(26, 42) : irange(18, 34);
    mass(b, [slab], pf, Math.max(pf + 6, Math.min(f, Math.floor(((x1 - x0) * 8) / storeys[mat]))));
    commit(blk, b, mat <= 2 ? { roof: 'prewar', wtP: 0.35, corniceH: 0.6 } : { cornice: false, roof: 'mech' });
  }

  // Sheer avenue wall carrying a Broadway billboard (flush ≥ 46m), often a tower rising behind it
  function flushTower(blk, lot, side) {
    const mat = pickW([[3, 3], [4, 3], [0, 2], [1, 1]]);
    const b = building(blk, mat, lot);
    const pf = Math.ceil(46 / storeys[mat]) + irange(0, 3);
    mass(b, [lot], 0, pf);
    if (chance(0.6)) {
      const L = rectD(lot);
      const shaft = sideRect(lot, side, range(1.5, 3.5), L - range(1.5, 3.5), range(0, 1.5), rectW(lot) - range(0, 2));
      if (rectW(shaft) >= 10 && rectD(shaft) >= 10) {
        mass(b, carve(shaft, shapeHoles(shaft, pickW([['rect', 2], ['notched', 1]])), 'x'), pf, pf + irange(8, 24));
      }
    }
    commit(blk, b, mat >= 3 ? { cornice: false, roof: 'mech' } : { roof: 'prewar', wtP: 0.3 });
  }

  const LAYOUTS = {
    res: residentialBlock,
    loft: loftBlock,
    office: officeBlock,
    projects: projectsBlock,
    lowrise: lowriseBlock,
    river: riverfrontBlock
  };

  // ============================================================================
  // NEIGHBOURHOOD PROFILES
  // ============================================================================
  const RES_BASE = {
    kind: 'res',
    walkup: [5, 6],
    prewar: [10, 15],
    grand: [13, 18],
    tower: [18, 32],
    walkupMats: [[1, 6], [2, 2], [0, 2]],
    prewarMats: [[0, 6], [1, 4]],
    grandMats: [[0, 8], [1, 2]],
    towerMats: [[0, 6], [1, 3]],
    through: 0.22,
    rows: [['brownstone', 5], ['tenement', 2.5], ['midApt', 2], ['postwarApt', 1]],
    ends: { w: [['prewar', 1]], e: [['prewar', 1]] }
  };
  const res = (o) => ({ ...RES_BASE, ...o });
  const bothEnds = (table) => ({ w: table, e: table });

  // What each avenue's corners tend to be (by the avenue a block end faces)
  const AVE_ENDS = {
    riverside: [['grand', 5], ['prewar', 3], ['tower', 1]],
    wea: [['prewar', 6], ['grand', 2], ['tower', 1]],
    broadway: [['grand', 3], ['prewar', 3], ['tower', 2], ['walkups', 2]],
    amsterdam: [['walkups', 5], ['prewar', 2], ['tower', 2]],
    columbus: [['walkups', 4], ['prewar', 2], ['tower', 3]],
    cpw: [['grand', 4], ['twin', 2], ['prewar', 2]],
    seventh: [['prewar', 3], ['walkups', 3], ['tower', 1]],
    lenox: [['prewar', 3], ['walkups', 3], ['tower', 1]],
    fifth: [['grand', 6], ['tower', 1]],
    madison: [['prewar', 4], ['walkups', 3], ['grand', 1]],
    park: [['grand', 5], ['prewar', 3]],
    lex: [['walkups', 4], ['prewar', 3], ['tower', 2]],
    third: [['tower', 6], ['prewar', 1], ['walkups', 1]],
    second: [['walkups', 4], ['tower', 3], ['prewar', 1]],
    first: [['walkups', 4], ['tower', 3], ['prewar', 1]],
    york: [['tower', 4], ['prewar', 2], ['walkups', 2]],
    water: [['tower', 3], ['prewar', 2], ['walkups', 1]]
  };
  // Corner type of each real avenue line (city-config.js ALL_AVENUES ids), by where along it a block stands
  function avenueKind(ave, z) {
    const uptown = z < streetZ(59);
    const harlem = z < streetZ(110);
    switch (ave.id) {
      case 'riverside': return 'riverside';
      case '11': return uptown ? 'wea' : 'amsterdam';
      case '10': return 'amsterdam';
      case '9':
      case 'manhattan': return 'columbus';
      case '8': return uptown && !harlem ? 'cpw' : 'seventh';
      case '7': return 'seventh';
      case '6': return 'lenox';
      case '5': return 'fifth';
      case 'madison':
      case 'vanderbilt':
      case 'university': return 'madison';
      case 'park': return 'park';
      case 'lex':
      case 'irving': return 'lex';
      case '3': return 'third';
      case '2': return 'second';
      case '1': return 'first';
      default: return 'york'; // York / East End Aves, Aves A-D
    }
  }

  // Avenue faced by the block edge at x (`dir` -1: the avenue to its west, +1: to its east): the nearest avenue line
  // running past that z, ~10-25 m beyond the property line (its roadway & sidewalk)
  function avenueName(x, dir, cz) {
    if (Math.abs(x + dir * 15 - getBroadwayX(cz)) < 5) return 'broadway';
    let best = null;
    for (const ave of ALL_AVENUES) {
      if (ave.isHighway || cz < ave.minZ - 20 || cz > ave.maxZ + 20) continue;
      const d = (ave.x - x) * dir;
      if (d > 0 && d < 45 && (!best || d < (best.x - x) * dir)) best = ave;
    }
    if (!best) return 'water';
    return avenueKind(best, cz);
  }
  const avenueEnds = (blk, table = AVE_ENDS) => ({
    w: table[avenueName(blk.minX, -1, blk.cz)] || table.water,
    e: table[avenueName(blk.maxX, 1, blk.cz)] || table.water
  });
  // Corner apartment houses keep shops on the avenue, except where doormen line it: Fifth & Park Avenues, Central Park
  // West, West End Avenue, Riverside Drive and the waterfront drives
  const QUIET_AVENUES = new Set(['fifth', 'park', 'cpw', 'wea', 'riverside', 'water']);
  const shopsOnAvenue = (blk, side) => !QUIET_AVENUES.has(side === 'w' ? avenueName(blk.minX, -1, blk.cz) : avenueName(blk.maxX, 1, blk.cz));

  const RES_HELLS_KITCHEN = res({
    ends: bothEnds([['walkups', 5], ['tower', 2], ['glass', 1], ['prewar', 1]]),
    prewar: [7, 12],
    tower: [16, 34],
    rows: [['tenement', 7], ['brownstone', 1.5], ['midApt', 1], ['low', 0.6]],
    through: 0.1
  });
  const RES_EAST_MIDTOWN = res({
    ends: bothEnds([['tower', 4], ['prewar', 3], ['walkups', 2], ['glass', 1]]),
    tower: [20, 36],
    rows: [['brownstone', 4], ['midApt', 3], ['postwarApt', 2], ['tenement', 1.5]],
    through: 0.25
  });
  const RES_MURRAY_HILL = res({
    ends: bothEnds([['prewar', 4], ['tower', 3], ['walkups', 2], ['grand', 1]]),
    prewar: [10, 17],
    tower: [18, 34],
    rows: [['brownstone', 4], ['midApt', 3], ['postwarApt', 2], ['tenement', 1]],
    through: 0.3
  });
  const RES_UES_SOUTH = res({
    ends: { w: [['grand', 3], ['tower', 3], ['glass', 1]], e: [['tower', 3], ['prewar', 2], ['glass', 1]] },
    prewar: [12, 18],
    grand: [14, 20],
    tower: [22, 38],
    rows: [['townhouse', 3], ['brownstone', 2], ['midApt', 3], ['postwarApt', 2]],
    through: 0.3
  });
  const RES_GRAMERCY = res({
    ends: bothEnds([['prewar', 4], ['tower', 2], ['walkups', 2]]),
    prewar: [9, 16],
    tower: [16, 28],
    rows: [['brownstone', 4], ['midApt', 3], ['postwarApt', 2], ['tenement', 1]],
    through: 0.3
  });
  const RES_CHELSEA = res({
    ends: bothEnds([['walkups', 4], ['prewar', 2], ['tower', 1.5], ['loft', 1]]),
    prewar: [8, 14],
    tower: [14, 26],
    rows: [['brownstone', 3], ['tenement', 3], ['rowhouse', 2], ['midApt', 1], ['loft', 1]],
    through: 0.15
  });
  const RES_WEST_VILLAGE = res({
    ends: bothEnds([['none', 3], ['walkups', 4], ['prewar', 1.5], ['loft', 1]]),
    walkup: [4, 6],
    prewar: [7, 14],
    rows: [['rowhouse', 5], ['tenement', 3], ['brownstone', 2], ['midApt', 1], ['loft', 0.8]],
    kf: { midApt: [6, 12] },
    through: 0.12
  });
  const RES_VILLAGE_CORE = res({
    ends: bothEnds([['prewar', 4], ['grand', 1], ['tower', 1], ['walkups', 2]]),
    prewar: [9, 16],
    grand: [12, 18],
    tower: [14, 24],
    rows: [['brownstone', 3], ['rowhouse', 2], ['midApt', 3], ['postwarApt', 1], ['tenement', 1]],
    through: 0.3
  });
  const RES_EAST_VILLAGE = res({
    ends: bothEnds([['walkups', 6], ['prewar', 1], ['tower', 0.5], ['none', 1]]),
    prewar: [7, 12],
    tower: [12, 20],
    rows: [['tenement', 8], ['rowhouse', 0.6], ['midApt', 0.8], ['garden', 0.5], ['low', 0.4]],
    through: 0.06
  });
  const RES_LES = res({
    ends: bothEnds([['walkups', 6], ['tower', 1], ['none', 1]]),
    tower: [14, 22],
    rows: [['tenement', 9], ['low', 0.6], ['garden', 0.4], ['midApt', 0.5]],
    through: 0.05
  });
  const RES_UPTOWN = res({ prewar: [10, 15], grand: [13, 18], tower: [18, 32], through: 0.25 });
  const RES_HARLEM = res({
    walkup: [4, 6],
    prewar: [6, 9],
    grand: [7, 10],
    tower: [12, 20],
    rows: [['brownstone', 7], ['tenement', 2.5], ['midApt', 1], ['garden', 0.4]],
    kf: { brownstone: [3, 4], midApt: [5, 7] },
    ends: bothEnds([['walkups', 4], ['prewar', 3], ['tower', 0.4]]),
    through: 0.1
  });
  const RES_EAST_HARLEM = res({
    walkup: [4, 6],
    prewar: [6, 8],
    tower: [14, 22],
    rows: [['tenement', 7], ['brownstone', 1], ['garden', 0.5], ['low', 0.6]],
    ends: bothEnds([['walkups', 6], ['tower', 1], ['low', 1]]),
    through: 0.04
  });

  const LOFT_BASE = { kind: 'loft', lotW: [8, 20], throughP: 0.35, floors: [6, 10], mats: [[1, 5], [0, 4], [2, 1]], setbackAt: 99, wtP: 0.65, feP: 0.3 };
  const LOFT_SOHO = { ...LOFT_BASE, floors: [5, 7], lotW: [7.5, 16], feP: 0.55, mats: [[0, 4], [1, 5], [2, 1]] };
  const LOFT_NOHO = { ...LOFT_BASE, floors: [6, 12], lotW: [9, 20], throughP: 0.45, setbackAt: 11, feP: 0.3 };
  const LOFT_TRIBECA = { ...LOFT_BASE, floors: [6, 11], lotW: [9, 22], throughP: 0.45 };
  const LOFT_CHELSEA = { ...LOFT_BASE, floors: [5, 12], lotW: [10, 24], throughP: 0.5, setbackAt: 12, feP: 0.2 };
  const LOFT_CHELSEA_WEST = { ...LOFT_BASE, floors: [2, 8], lotW: [14, 30], throughP: 0.7, wtP: 0.4, feP: 0.05 };
  const LOFT_FLATIRON = { ...LOFT_BASE, floors: [8, 14], lotW: [10, 22], throughP: 0.5, setbackAt: 12, feP: 0.1 };
  const LOFT_NOMAD = { ...LOFT_BASE, floors: [10, 20], lotW: [10, 24], throughP: 0.55, setbackAt: 13, wtP: 0.6, feP: 0.05 };
  const LOFT_GARMENT = { ...LOFT_BASE, floors: [12, 24], lotW: [12, 26], throughP: 0.6, setbackAt: 14, wtP: 0.55, feP: 0.05, mats: [[0, 5], [1, 5]] };
  const LOFT_GARMENT_SOUTH = { ...LOFT_GARMENT, floors: [9, 18], setbackAt: 12, feP: 0.1 };

  const OFFICE_MIDTOWN = {
    kind: 'office',
    plans: [['pair', 4], ['major', 4], ['full', 1.5], ['plaza', 1.5]],
    styles: [['glass', 5], ['deco', 3], ['slab', 1.2]],
    towerFloors: [24, 44],
    glassMats: [[3, 4], [4, 3], [5, 2]],
    decoMats: [[0, 6], [1, 3]],
    fillMats: [[0, 5], [1, 4], [3, 1], [4, 1]],
    fillFloors: [6, 20],
    shaftShapes: [['rect', 3], ['notched', 3], ['stepped', 2], ['L', 1]]
  };
  const OFFICE_FIDI = {
    ...OFFICE_MIDTOWN,
    plans: [['pair', 4], ['major', 4], ['full', 2], ['plaza', 1]],
    styles: [['deco', 4], ['glass', 4], ['slab', 2]],
    towerFloors: [22, 46],
    fillFloors: [8, 24]
  };
  const OFFICE_HUDSON_YARDS = {
    ...OFFICE_MIDTOWN,
    plans: [['full', 3], ['major', 2], ['pair', 2]],
    styles: [['glass', 1]],
    towerFloors: [34, 54],
    glassMats: [[5, 5], [3, 3]],
    fillMats: [[3, 1], [5, 1], [1, 1]],
    fillFloors: [8, 18]
  };
  const OFFICE_BILLIONAIRES = { ...OFFICE_MIDTOWN, plans: [['slender', 1]], fillMats: [[0, 5], [1, 3], [3, 1]], fillFloors: [10, 22] };
  const OFFICE_BATTERY_PARK_CITY = {
    ...OFFICE_MIDTOWN,
    plans: [['pair', 3], ['major', 2], ['plaza', 2]],
    styles: [['glass', 3], ['resTower', 2]],
    towerFloors: [18, 38],
    tower: [16, 34],
    towerMats: [[1, 3], [0, 2]],
    fillMats: [[1, 3], [0, 2], [3, 1]],
    fillFloors: [8, 16]
  };

  const PROJECTS = { kind: 'projects', floors: [12, 20], mats: [[1, 8], [0, 2]] };
  const PROJECTS_STUY_TOWN = { ...PROJECTS, floors: [12, 14], mats: [[1, 1]] };
  const LOWRISE = { kind: 'lowrise', floors: [2, 7] };
  const RIVERFRONT = { kind: 'river' };

  const CPB = CENTRAL_PARK_BOUNDS;
  function uptownProfile(blk) {
    const { cx, cz } = blk;
    const nearPark = (cx > avenueX('9') + 20 && cx < CPB.minX) || (cx > CPB.maxX && cx < avenueX('lex') + 20);
    const rows = nearPark
      ? [['brownstone', 6], ['townhouse', cx > 0 ? 3 : 1], ['midApt', 2], ['tenement', 0.6]]
      : cx > avenueX('3')
        ? [['tenement', 6], ['brownstone', 1.5], ['midApt', 1.5], ['postwarApt', 1.5]] // Yorkville
        : [['brownstone', 5], ['tenement', 2.5], ['midApt', 2], ['postwarApt', 1]];
    if (cz > streetZ(66) && cx > 0) return { ...RES_UES_SOUTH, ends: avenueEnds(blk) }; // 59th-66th St, east side
    return { ...RES_UPTOWN, rows, ends: avenueEnds(blk) };
  }

  function harlemProfile(blk) {
    // Morningside & Hamilton Heights (west of Manhattan Ave), Central Harlem, East Harlem
    return res({
      prewar: [8, 13],
      grand: [10, 14],
      tower: [14, 24],
      rows: [['brownstone', 3], ['midApt', 3], ['tenement', 2.5]],
      ends: avenueEnds(blk),
      through: 0.25
    });
  }

  // Profile of a block by its real neighbourhood (city-config.js districtAt)
  function blockProfile(blk, district) {
    switch (district) {
      case 'riverfront': return RIVERFRONT;
      case 'hudson_yards': return OFFICE_HUDSON_YARDS;
      case 'billionaires_row': return chance(0.6) ? OFFICE_BILLIONAIRES : OFFICE_MIDTOWN;
      case 'midtown': return OFFICE_MIDTOWN;
      case 'garment': return blk.cz > streetZ(36) ? LOFT_GARMENT_SOUTH : LOFT_GARMENT;
      case 'murray_hill': return RES_MURRAY_HILL;
      case 'turtle_bay': return RES_EAST_MIDTOWN;
      case 'hells_kitchen': return RES_HELLS_KITCHEN;
      case 'west_chelsea': return LOFT_CHELSEA_WEST;
      case 'chelsea': return chance(0.55) ? RES_CHELSEA : LOFT_CHELSEA;
      case 'flatiron': return LOFT_FLATIRON;
      case 'nomad': return LOFT_NOMAD;
      case 'gramercy': return RES_GRAMERCY;
      case 'stuy_town': return PROJECTS_STUY_TOWN;
      case 'uws':
      case 'ues': return uptownProfile(blk);
      case 'morningside': return harlemProfile(blk);
      case 'harlem': return chance(0.15) ? PROJECTS : RES_HARLEM;
      case 'east_harlem': return chance(0.35) ? PROJECTS : RES_EAST_HARLEM;
      case 'village': return chance(0.4) ? LOFT_NOHO : RES_VILLAGE_CORE;
      case 'west_village': return blk.cx < avenueX('11') ? (chance(0.5) ? LOFT_CHELSEA_WEST : RES_WEST_VILLAGE) : RES_WEST_VILLAGE;
      case 'east_village': return blk.cx > avenueX('eastend') + 150 ? PROJECTS : RES_EAST_VILLAGE;
      case 'soho': return LOFT_SOHO;
      case 'little_italy': return chance(0.5) ? LOFT_SOHO : RES_LES;
      case 'hudson_square':
      case 'tribeca': return LOFT_TRIBECA;
      case 'chinatown': return RES_LES;
      case 'lower_east_side': return chance(0.3) ? PROJECTS : RES_LES;
      case 'civic_center':
      case 'fidi': return OFFICE_FIDI;
      case 'battery_park_city': return OFFICE_BATTERY_PARK_CITY;
      default: return OFFICE_MIDTOWN;
    }
  }

  /**
   * Populates a single Manhattan block with lots and buildings for its neighbourhood and registers its high-detail
   * architectural features (stone cornices, water towers, rooftop bulkheads, fire escapes, awnings, storefront
   * fascia signs, and scaffolding sheds) into the Quadtree.
   */
  function populateBlock(minX, maxX, minZ, maxZ, colIndex, rowIndex, isOuter = false, lowRiseEsplanade = false, district = 'midtown') {
    const bw = maxX - minX;
    const bd = maxZ - minZ;
    if (bw < (district === 'riverfront' ? 9 : minLot) || bd < minLot) return;
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const blockDetail = {
      id: `${district}_${Math.round(cx)}_${Math.round(cz)}`,
      cx,
      cz,
      minX,
      maxX,
      minZ,
      maxZ,
      district,
      cornices: [],
      waterTowers: [],
      hvacUnits: [],
      fireEscapes: [],
      awnings: [],
      scaffoldSheds: [],
      footprints: [], // { x0, x1, z0, z1, h, tone } per building part, lowest first (maps; + pts: its world corners when turned)
      yards: [], // rear yards, courts & lawns { x0, x1, z0, z1 } (+ ry: turned about their centre)
      maxH: 0,
      avenueFronts: { w: [], e: [] }, // ground-floor frontage [z0, z1] along each avenue
      facadeBoxes: [], // this block's facade boxes & the lots left empty under bridge approaches (until it's built)
      voidLots: []
    };
    const bucketMarks = buckets.map((items) => items.length);
    rand = mulberry32((Math.imul(Math.round(minX * 4), 73856093) ^ Math.imul(Math.round(minZ * 4), 19349663) ^ 10019) >>> 0);

    // Times Square's billboards hang on the walls of the lots fronting the bowtie (section B7), so a sheer wall rises
    // flush there
    const flush = { w: false, e: false };
    if (TS && !isOuter && (xf || (maxZ > TS.zN && minZ < TS.zS))) {
      const za = xf ? minZ : Math.max(minZ, TS.zN);
      const zb = xf ? maxZ : Math.min(maxZ, TS.zS);
      flush.w = frontsBowtie(minX, -1, za, zb);
      flush.e = frontsBowtie(maxX, 1, za, zb);
    }

    let x0 = minX;
    let x1 = maxX;
    for (const side of ['w', 'e']) {
      if (!flush[side]) continue;
      let w = Math.min(range(18, 26), (x1 - x0) * 0.6);
      if (x1 - x0 - w < 8) w = x1 - x0;
      flushTower(blockDetail, side === 'w' ? rect(x0, x0 + w, minZ, maxZ) : rect(x1 - w, x1, minZ, maxZ), side);
      if (side === 'w') x0 += w;
      else x1 -= w;
    }
    if (x1 - x0 > 0.5) {
      const profile = lowRiseEsplanade ? LOWRISE : blockProfile(blockDetail, district);
      LAYOUTS[profile.kind](blockDetail, profile, x0, x1);
    }
    openOntoVoidLots(blockDetail);
    delete blockDetail.facadeBoxes;
    delete blockDetail.voidLots;

    // Sidewalk scaffolding shed along a stretch of the west avenue frontage
    const fronts = blockDetail.avenueFronts.w;
    if (fronts.length && chance(0.2)) {
      const [z0, z1] = fronts.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      if (z1 - z0 > 8) blockDetail.scaffoldSheds.push({ x: minX - 2.2, y: 0.22, z: (z0 + z1) * 0.5, w: 3.8, d: (z1 - z0) * 0.85 });
    }

    blockDetail.footprints.sort((a, b) => a.h - b.h);
    if (xf) placeInFrame(blockDetail, bucketMarks);
    if (blockDetail.maxH > 0) {
      pushCollider(minX + 0.5, maxX - 0.5, minZ + 0.5, maxZ - 0.5, Math.min(BLOCK_COLLIDER_TOP, blockDetail.maxH));
    }

    quadtree.insert(blockDetail);
    allBlocks.push(blockDetail);
  }

  // Turns everything a lot of the current frame emitted into place: facade boxes, roof gear, cornices, fire escapes,
  // awnings & sheds get the frame's turn (ry) about their own centre, map footprints their world corners, the block
  // its world centre (streaming) & bounds
  function placeInFrame(blk, marks) {
    const th = xf.th;
    buckets.forEach((items, m) => {
      for (let i = marks[m]; i < items.length; i++) {
        const b = items[i];
        [b.x, b.z] = toWorld(b.x, b.z);
        b.ry = th;
      }
    });
    for (const list of [blk.cornices, blk.waterTowers, blk.hvacUnits, blk.fireEscapes, blk.awnings, blk.scaffoldSheds]) {
      for (const o of list) {
        [o.x, o.z] = toWorld(o.x, o.z);
        o.ry = th;
      }
    }
    const corners = (x0, x1, z0, z1) => [toWorld(x0, z0), toWorld(x1, z0), toWorld(x1, z1), toWorld(x0, z1)].map(([x, z]) => ({ x, z }));
    const bounds = (o, pts) => {
      o.x0 = Math.min(...pts.map((p) => p.x));
      o.x1 = Math.max(...pts.map((p) => p.x));
      o.z0 = Math.min(...pts.map((p) => p.z));
      o.z1 = Math.max(...pts.map((p) => p.z));
    };
    for (const f of blk.footprints) {
      f.pts = corners(f.x0, f.x1, f.z0, f.z1);
      bounds(f, f.pts);
    }
    for (const y of blk.yards) {
      const [cx, cz] = toWorld((y.x0 + y.x1) * 0.5, (y.z0 + y.z1) * 0.5);
      const hw = (y.x1 - y.x0) * 0.5;
      const hd = (y.z1 - y.z0) * 0.5;
      Object.assign(y, { x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd, ry: th });
    }
    const pts = corners(blk.minX, blk.maxX, blk.minZ, blk.maxZ);
    [blk.cx, blk.cz] = toWorld(blk.cx, blk.cz);
    const b = {};
    bounds(b, pts);
    Object.assign(blk, { minX: b.x0, maxX: b.x1, minZ: b.z0, maxZ: b.z1, ry: th, pts });
  }

  // ============================================================================
  // LANDMARK LOTS: the footprints landmarks.js builds on (real OpenStreetMap outlines + a margin; Seagram's plaza out
  // to Park Ave) stay clear of the generic buildings, which fill the rest of their blocks
  // ============================================================================
  const LANDMARK_RESERVE = [
    ['Empire State Building'], ['Chrysler Building'], ['One Vanderbilt'], ['Grand Central Terminal'], ['MetLife Building'],
    ['Stephen A. Schwarzman Building'], ['One Times Square'], ['30 Rockefeller Plaza'], ['Citigroup Center'],
    ['Seagram Building', { x0: avenueX('park') + 20 }], ['Flatiron Building'], ['One World Trade Center'], ['New York Stock Exchange']
  ].map(([name, o]) => {
    const t = LANDMARK_SITES[name];
    if (!t) return null;
    return { x0: t.x - t.w / 2 - 3, x1: t.x + t.w / 2 + 3, z0: t.z - t.d / 2 - 3, z1: t.z + t.d / 2 + 3, ...(o || {}) };
  }).filter(Boolean);
  const hitR = (a, x0, x1, z0, z1) => a.x0 < x1 && a.x1 > x0 && a.z0 < z1 && a.z1 > z0;
  // [x0, x1, z0, z1] minus the reserved rects, as up to four slabs per hole (strips across the full depth first). In a
  // frontage frame the reserves are their bounds in the frame
  function minusReserves(r) {
    let reserves = LANDMARK_RESERVE;
    if (xf) {
      reserves = LANDMARK_RESERVE.map((h) => {
        const pts = [[h.x0, h.z0], [h.x1, h.z0], [h.x1, h.z1], [h.x0, h.z1]].map(([x, z]) => [
          xf.px + (x - xf.px) * xf.cs - (z - xf.pz) * xf.sn,
          xf.pz + (x - xf.px) * xf.sn + (z - xf.pz) * xf.cs
        ]);
        return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])) };
      });
    }
    let parts = [r];
    for (const h of reserves) {
      const next = [];
      for (const [x0, x1, z0, z1] of parts) {
        if (!hitR(h, x0, x1, z0, z1)) { next.push([x0, x1, z0, z1]); continue; }
        if (h.x0 > x0) next.push([x0, h.x0, z0, z1]);
        if (h.x1 < x1) next.push([h.x1, x1, z0, z1]);
        const mx0 = Math.max(x0, h.x0), mx1 = Math.min(x1, h.x1);
        if (h.z0 > z0) next.push([mx0, mx1, z0, h.z0]);
        if (h.z1 < z1) next.push([mx0, mx1, h.z1, z1]);
      }
      parts = next;
    }
    return parts;
  }
  function overlapsParkOrLandmark(minX, maxX, minZ, maxZ) {
    const cp = CENTRAL_PARK_BOUNDS;
    if (maxX > cp.minX && minX < cp.maxX && maxZ > cp.minZ && minZ < cp.maxZ) return true;
    return LANDMARK_RESERVE.some((h) => hitR(h, minX, maxX, minZ, maxZ));
  }

  // ============================================================================
  // A. EVERY REAL BLOCK OF MANHATTAN (city-config.js BLOCKS): each curb island's lots inside its property line,
  //    filled for its neighbourhood. A grid block is one lot rect spanning avenue to avenue (61 m deep between the
  //    streets); Broadway's trapezoids and Lower Manhattan's irregular blocks come with frontage frames: lot rects laid
  //    out along each street they front, filled in the frame and turned into place.
  // ============================================================================
  // Superblocks (Battery Park City, the campuses & housing projects uptown, Stuy Town...) are cut into strips about a
  // street block deep with a ~9 m passage between them, so no lot (and no building) runs 100+ m deep
  const DEEP_LOT = 95;
  function splitDeep(r) {
    const [x0, x1, z0, z1] = r;
    const d = z1 - z0;
    if (d <= DEEP_LOT) return [r];
    const gap = 9;
    const n = Math.max(2, Math.round((d + gap) / (64 + gap)));
    const s = (d - gap * (n - 1)) / n;
    const out = [];
    for (let k = 0; k < n; k++) out.push([x0, x1, z0 + k * (s + gap), z0 + k * (s + gap) + s]);
    return out;
  }
  for (const b of BLOCKS) {
    if (b.park > 0.6 || b.median) continue;
    minLot = b.frames ? 12 : 15;
    for (const [th, px, pz, rects] of b.frames || [[0, 0, 0, b.rects]]) {
      xf = th ? { th, cs: Math.cos(th), sn: Math.sin(th), px, pz } : null;
      for (const r of rects) {
        for (const part of minusReserves(r)) {
          for (const [x0, x1, z0, z1] of splitDeep(part)) {
            if (x1 - x0 < minLot || z1 - z0 < minLot) continue;
            populateBlock(x0, x1, z0, z1, 0, 0, false, false, b.district);
          }
        }
      }
      xf = null;
    }
  }
  minLot = 15;

  // B6. Narrow leftover slabs no building fits on (8-26 m wide: clipped short by the shore highways or cut by Broadway)
  //     become sitting areas: a row or two of honey locusts & planes in tree pits (planted by street-details.js)
  {
    const plazas = window.NYC.pavedPlazaRects || [];
    const sites = window.NYC.parkTreeSites;
    const hit = (r, x0, x1, z0, z1) => r.minX < x1 && r.maxX > x0 && r.minZ < z1 && r.maxZ > z0;
    for (const s of (sites && window.NYC.sidewalkBlocks) || []) {
      const x0 = s.cx - s.w / 2;
      const x1 = s.cx + s.w / 2;
      const z0 = s.cz - s.d / 2;
      const z1 = s.cz + s.d / 2;
      if (s.cover || (s.block && (s.block.median || s.block.park > 0.6))) continue;
      const narrow = Math.min(s.w, s.d);
      if (narrow < 8 || narrow > 26 || Math.max(s.w, s.d) < 20) continue;
      if (allBlocks.some((b) => hit(b, x0 + 2, x1 - 2, z0 + 2, z1 - 2)) || plazas.some((r) => hit(r, x0, x1, z0, z1))) continue;
      if (overlapsParkOrLandmark(x0, x1, z0, z1)) continue;
      const alongX = s.w > s.d;
      const len = alongX ? s.w : s.d;
      const n = Math.max(1, Math.floor((len - 6) / 8));
      const lanes = narrow >= 15 ? [-narrow / 4, narrow / 4] : [0];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        for (const [j, o] of lanes.entries()) {
          const u = (len - 6) * t + (j % 2) * 2;
          const x = alongX ? s.cx + u : s.cx + o;
          const z = alongX ? s.cz + o : s.cz + u;
          const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
          sites.push({ x, y: 0.22, z, scale: 0.8 + h * 0.3, species: h < 0.55 ? 1 : 0, tier: 1 });
        }
      }
    }
  }

  // B7. Times Square: tiers of billboards up every street wall that looks onto the bowtie (podiums and the tower
  //     shafts set back above them alike), from above the storefront marquees to ~62 m, split into screens up to
  //     ~26 m wide (the odd screen left out)
  if (TS) {
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // createFacadeBoxes `faces` order: w, e, n, s
    const hash = (a, b) => Math.abs(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1;
    for (const items of buckets) {
      for (const bx of items) {
        if (bx.z + bx.d * 0.5 < TS.zN - 40 || bx.z - bx.d * 0.5 > TS.zS + 40 || Math.abs(bx.x - TS.x7) > 280) continue;
        const base = Math.max(7.5, bx.y - bx.h * 0.5 + 1.2);
        const top = Math.min(bx.y + bx.h * 0.5 - 2, 62);
        if (top - base < 8) continue;
        DIRS.forEach(([lx, lz], f) => {
          if (bx.faces && bx.faces[f] > WALL_KINDS.entry) return; // street fronts only (not rear / lot-line walls)
          // the wall's centre, outward normal (n) and direction along it (a) in the world (boxes may be turned by ry)
          const c = Math.cos(bx.ry || 0);
          const s = Math.sin(bx.ry || 0);
          const ox = lx * bx.w * 0.5;
          const oz = lz * bx.d * 0.5;
          const cx = bx.x + ox * c + oz * s;
          const cz = bx.z - ox * s + oz * c;
          const nx = lx * c + lz * s;
          const nz = -lx * s + lz * c;
          const ax = -lz * c + lx * s;
          const az = lz * s + lx * c;
          const L = lx ? bx.d : bx.w;
          if (L < 8) return;
          const seen = [0.2, 0.5, 0.8].some((t) => [6, 12, 20, 30].some((d) => {
            const u = (t - 0.5) * L;
            return inBowtie(cx + nx * d + ax * u, cz + nz * d + az * u);
          }));
          if (!seen) return;
          const n = Math.max(1, Math.ceil((L - 2) / 26));
          const pw = (L - 2 - (n - 1) * 1.2) / n;
          for (let i = 0; i < n; i++) {
            const u = -L * 0.5 + 1 + i * (pw + 1.2) + pw * 0.5;
            let y = base;
            for (let tier = 0; y < top - 6; tier++) {
              const h = Math.min(top - y, 8 + 8 * hash(u + tier, cx));
              if (h < 6) break;
              if (hash(cz + tier, u) > 0.12) {
                broadwayBillboards.push({
                  x: cx + nx * 0.35 + ax * u,
                  y: y + h * 0.5,
                  z: cz + nz * 0.35 + az * u,
                  w: pw,
                  h,
                  rotY: Math.atan2(nx, nz),
                  variant: Math.floor(hash(cx + i, cz + tier) * 6)
                });
              }
              y += h + 1.2;
            }
          }
        });
      }
    }
  }

  // ============================================================================
  // C. STATIC ISLAND-WIDE ARCHITECTURAL MASSING (6 TSL Facade Materials)
  // ============================================================================
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();

  buckets.forEach((items, matIdx) => {
    if (items.length === 0) return;
    const inst = createFacadeBoxes(materials[matIdx], items);
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  });

  // Billboards: one merged mesh per poster theme
  {
    const byVariant = new Map();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const bb of broadwayBillboards) {
      const g = new THREE.PlaneGeometry(bb.w, bb.h);
      g.applyMatrix4(m.compose(new THREE.Vector3(bb.x, bb.y, bb.z), q.setFromAxisAngle(up, bb.rotY), new THREE.Vector3(1, 1, 1)));
      if (!byVariant.has(bb.variant)) byVariant.set(bb.variant, []);
      byVariant.get(bb.variant).push(g);
    }
    for (const [variant, geos] of byVariant) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), createBillboardMaterial(variant));
      mesh.name = `TimesSquareBillboards_${variant}`;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
  }

  // Rear yards, light courts & project lawns: one thin slab per patch just above the sidewalk (buildings standing on
  // it hide the rest). Lawn, paving and tree canopies come from world-space noise; detail finer than a pixel fades
  // to its average so the gardens don't shimmer from the air
  const yardMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0.0 });
  yardMat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const px = length(fwidth(p)); // metres per pixel
    const fine = smoothstep(0.9, 0.12, px);
    const crownLOD = smoothstep(8.0, 3.0, px); // crowns a few pixels wide or more are drawn, smaller ones averaged
    const grain = mx_noise_float(p.mul(1.9)).mul(fine).mul(0.5).add(0.5);
    const clump = mx_noise_float(p.mul(0.7).add(5.3)).mul(smoothstep(2.0, 0.4, px)).mul(0.5).add(0.5);

    // Lawns with grey / beige patios & light-court paving
    const patch = mx_noise_float(p.mul(0.21)).mul(smoothstep(12.0, 4.0, px));
    const lawn = mix(color(0x5d7a3a), color(0x7a944c), grain);
    const paving = mix(color(0x8c8679), color(0xa59e90), grain);
    const ground = mix(lawn, paving, smoothstep(0.15, 0.45, patch));

    // Street-tree-sized (~12 m) & small (~6 m) crowns, domed: sunlit crowns, softer & darker towards their rims
    const w1 = mx_worley_noise_float(p.mul(0.085));
    const w2 = mx_worley_noise_float(p.mul(0.16).add(17.0));
    const crowns = max(smoothstep(0.55, 0.3, w1), smoothstep(0.45, 0.25, w2).mul(0.85));
    const rim = smoothstep(0.0, 1.0, min(w1.div(0.55), w2.div(0.45)));
    const leaves = mix(color(0x3f5e2a), color(0x5e7f3b), clump.mul(0.6).add(grain.mul(0.4))).mul(mix(float(1.08), float(0.78), rim));
    const leavesMean = mix(color(0x3f5e2a), color(0x5e7f3b), 0.5).mul(0.93);
    return mix(ground, mix(leavesMean, leaves, crownLOD), mix(float(0.5), crowns, crownLOD));
  })();
  const yardRects = [];
  for (const blk of allBlocks) yardRects.push(...blk.yards);
  if (yardRects.length) {
    const yardInst = new THREE.InstancedMesh(unitBox, yardMat, yardRects.length);
    yardRects.forEach((r, i) => {
      dummy.position.set((r.x0 + r.x1) * 0.5, 0.225, (r.z0 + r.z1) * 0.5);
      dummy.rotation.set(0, r.ry || 0, 0);
      dummy.scale.set(r.x1 - r.x0, 0.05, r.z1 - r.z0);
      dummy.updateMatrix();
      yardInst.setMatrixAt(i, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0);
    yardInst.receiveShadow = true;
    group.add(yardInst);
  }

  // ============================================================================
  // D. QUADTREE-STREAMED HIGH-DETAIL ARCHITECTURAL POOLS (LOD0 around player)
  // ============================================================================
  const MAX_CORNICES = 7000;
  const MAX_WATER_TOWERS = 1400;
  const MAX_HVAC = 1600;
  const MAX_FIRE_ESCAPES = 2400;
  const MAX_AWNINGS = 1800;
  const MAX_SHEDS = 300;

  // 1. Projecting horizontal stone cornices & parapet ledges
  const corniceMat = new THREE.MeshStandardNodeMaterial({ color: 0xc8bca6, roughness: 0.78, metalness: 0.08 });
  const corniceInst = new THREE.InstancedMesh(unitBox, corniceMat, MAX_CORNICES);
  corniceInst.castShadow = true;
  corniceInst.receiveShadow = true;
  corniceInst.frustumCulled = false;
  group.add(corniceInst);

  // 2. 3-part rooftop cedar water towers with steel hoop bands & open 4-leg steel trestle
  const woodMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.78 });
  woodMat.colorNode = Fn(() => {
    const u = uv();
    const staveSeam = smoothstep(0.08, 0.0, abs(fract(u.x.mul(28.0)).sub(0.5)));
    const staveTone = mix(color(0x8e6343), color(0x5c3e26), staveSeam.mul(0.55));
    const bandY = fract(u.y.mul(5.0));
    const isHoop = smoothstep(0.11, 0.05, abs(bandY.sub(0.5)));
    return mix(staveTone, color(0x1f2328), isHoop);
  })();
  const roofCapMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b4045, roughness: 0.65, metalness: 0.3 });
  const legMat = new THREE.MeshStandardNodeMaterial({ color: 0x262b30, roughness: 0.45, metalness: 0.68 });
  const barrelGeo = new THREE.CylinderGeometry(1.65, 1.75, 3.6, 12);
  const coneGeo = new THREE.ConeGeometry(1.9, 1.5, 12);

  // Open 4-leg structural steel trestle with cross-bracing and top chime deck
  const trestleParts = [];
  const legPostGeo = new THREE.BoxGeometry(0.24, 2.75, 0.24);
  const legPositions = [
    [-1.05, 0, -1.05],
    [1.05, 0, -1.05],
    [-1.05, 0, 1.05],
    [1.05, 0, 1.05],
  ];
  for (const [lx, ly, lz] of legPositions) {
    const g = legPostGeo.clone();
    g.rotateZ(lx > 0 ? 0.08 : -0.08);
    g.rotateX(lz > 0 ? -0.08 : 0.08);
    g.translate(lx, ly, lz);
    trestleParts.push(g);
  }
  const deckRingGeo = new THREE.CylinderGeometry(1.88, 1.88, 0.22, 12);
  deckRingGeo.translate(0, 1.22, 0);
  trestleParts.push(deckRingGeo);
  const braceX1 = new THREE.BoxGeometry(2.15, 0.14, 0.14);
  braceX1.translate(0, 0.2, -1.02);
  trestleParts.push(braceX1);
  const braceX2 = new THREE.BoxGeometry(2.15, 0.14, 0.14);
  braceX2.translate(0, 0.2, 1.02);
  trestleParts.push(braceX2);
  const braceZ1 = new THREE.BoxGeometry(0.14, 0.14, 2.15);
  braceZ1.translate(-1.02, -0.45, 0);
  trestleParts.push(braceZ1);
  const braceZ2 = new THREE.BoxGeometry(0.14, 0.14, 2.15);
  braceZ2.translate(1.02, -0.45, 0);
  trestleParts.push(braceZ2);
  const riserPipe = new THREE.CylinderGeometry(0.24, 0.24, 2.6, 8);
  trestleParts.push(riserPipe);
  const legsGeo = mergeGeometries(trestleParts, false);

  const barrelInst = new THREE.InstancedMesh(barrelGeo, woodMat, MAX_WATER_TOWERS);
  const coneInst = new THREE.InstancedMesh(coneGeo, roofCapMat, MAX_WATER_TOWERS);
  const legsInst = new THREE.InstancedMesh(legsGeo, legMat, MAX_WATER_TOWERS);
  barrelInst.castShadow = barrelInst.receiveShadow = true;
  coneInst.castShadow = coneInst.receiveShadow = true;
  legsInst.castShadow = legsInst.receiveShadow = true;
  barrelInst.frustumCulled = coneInst.frustumCulled = legsInst.frustumCulled = false;
  group.add(legsInst, barrelInst, coneInst);

  // 3. Rooftop mechanical penthouses & HVAC chillers with top exhaust fans & side louvers
  const hvacMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.52, metalness: 0.45 });
  hvacMat.colorNode = Fn(() => {
    const u = uv();
    const isTop = step(0.7, normalWorldGeometry.y);
    const fan1 = length(u.sub(vec2(0.3, 0.5)));
    const fan2 = length(u.sub(vec2(0.7, 0.5)));
    const fanDist = min(fan1, fan2);
    const inFanWell = smoothstep(0.19, 0.17, fanDist);
    const fanRing = smoothstep(0.025, 0.008, abs(fract(fanDist.mul(16.0)).sub(0.5))).mul(inFanWell);
    const topCol = mix(color(0x889098), color(0x1b2026), inFanWell.mul(0.82).sub(fanRing.mul(0.45)));

    const inLouverBox = step(0.12, u.x).mul(step(u.x, 0.88)).mul(step(0.18, u.y)).mul(step(u.y, 0.82));
    const louverSlat = step(0.45, fract(u.y.mul(14.0))).mul(inLouverBox);
    const panelSeam = smoothstep(0.03, 0.0, abs(fract(u.x.mul(3.0)).sub(0.5)));
    const sideCol = mix(color(0x7c848c), color(0x282e36), max(louverSlat.mul(0.72), panelSeam.mul(0.35)));
    return mix(sideCol, topCol, isTop);
  })();
  const hvacInst = new THREE.InstancedMesh(unitBox, hvacMat, MAX_HVAC);
  hvacInst.castShadow = hvacInst.receiveShadow = true;
  hvacInst.frustumCulled = false;
  group.add(hvacInst);

  // 4. Wrought-iron facade fire escapes: one box each, cut by a mask (honoured by the main & shadow passes) into a
  //    landing & railing at every floor, zig-zag stairs and corner posts. Bars never get thinner than a pixel, so
  //    far away the lattice fills in instead of breaking up into shimmer
  const ironMat = new THREE.MeshStandardNodeMaterial({ color: 0x22252a, roughness: 0.45, metalness: 0.7 });
  ironMat.maskNode = Fn(() => {
    const across = positionGeometry.x.add(0.5).mul(3.4);
    const storey = positionWorld.y.sub(3.55).div(3.45); // Landings from the 2nd floor up, see fireEscapes
    const up = fract(storey).mul(3.45);
    const px = fwidth(across);
    const py = fwidth(positionWorld.y);
    const bar = (dist, halfWidth, footprint) => step(dist, max(footprint.mul(0.5), halfWidth));
    const deck = bar(abs(up.sub(0.06)), 0.06, py);
    const rails = max(bar(abs(up.sub(0.97)), 0.03, py), bar(abs(up.sub(0.5)), 0.02, py));
    const flight = mix(across, float(3.4).sub(across), mod(floor(storey), 2.0));
    const stairs = bar(abs(flight.sub(up)), 0.1, px.add(py));
    const posts = bar(min(across, float(3.4).sub(across)), 0.07, px.mul(2.0)).mul(abs(normalGeometry.z)); // box-local: boxes may be turned
    const caps = step(0.5, abs(normalWorldGeometry.y)); // Bottom landing & top rail stay solid
    return max(deck, rails, stairs, posts, caps).greaterThan(0.5);
  })();
  const feInst = new THREE.InstancedMesh(unitBox, ironMat, MAX_FIRE_ESCAPES);
  feInst.castShadow = feInst.receiveShadow = true;
  feInst.frustumCulled = false;
  group.add(feInst);

  // 5. Ground-floor retail canvas awnings & illuminated storefront fascia signs
  const awningMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.65 });
  const awningPalette = [
    new THREE.Color(0x9e222e),
    new THREE.Color(0x1f593b),
    new THREE.Color(0x213d68),
    new THREE.Color(0xd9912b),
    new THREE.Color(0x2d2d32)
  ];
  const awningInst = new THREE.InstancedMesh(unitBox, awningMat, MAX_AWNINGS);
  awningInst.castShadow = awningInst.receiveShadow = true;
  awningInst.frustumCulled = false;
  // Pre-initialize instanceColor buffer so dynamic updates work cleanly
  for (let i = 0; i < MAX_AWNINGS; i++) {
    awningInst.setColorAt(i, awningPalette[i % awningPalette.length]);
  }
  group.add(awningInst);

  const signThemes = [
    { bg: '#161210', border: '#c89d54', text: 'FIFTH AVE BISTRO · EST. 1928', color: '#ffe4a8' },
    { bg: '#0c2244', border: '#38b6ff', text: 'DUANE READE · PHARMACY', color: '#ffffff' },
    { bg: '#142b20', border: '#d4af37', text: 'MANHATTAN BOOKS & ESPRESSO', color: '#fff2cc' },
    { bg: '#280a10', border: '#ff5252', text: 'BROADWAY DELI & GRILL · 24HR', color: '#ffd180' },
    { bg: '#101318', border: '#e0e6ed', text: 'EMPIRE WATCHES · NEW YORK', color: '#f5f9ff' }
  ];
  const MAX_SIGNS_PER_THEME = Math.ceil(MAX_AWNINGS / signThemes.length) + 32;
  const signInsts = signThemes.map((st) => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = st.border;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 84);
    ctx.fillStyle = st.color;
    ctx.font = '800 26px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.text, 256, 50);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sMat = new THREE.MeshBasicNodeMaterial({ map: tex });
    const sInst = new THREE.InstancedMesh(unitBox, sMat, MAX_SIGNS_PER_THEME);
    sInst.frustumCulled = false;
    group.add(sInst);
    return sInst;
  });

  // 6. Sidewalk construction scaffolding sheds
  const shedMat = new THREE.MeshStandardNodeMaterial({ color: 0x214f37, roughness: 0.6, metalness: 0.25 });
  const shedInst = new THREE.InstancedMesh(unitBox, shedMat, MAX_SHEDS);
  shedInst.castShadow = shedInst.receiveShadow = true;
  shedInst.frustumCulled = false;
  group.add(shedInst);

  // 7. Ground-floor storefront clustered SpotLights (awnings/fascia signs)
  const storeLightGroup = new THREE.Group();
  storeLightGroup.name = 'StoreClusteredLights';
  scene.add(storeLightGroup);

  const storeThemeColors = [
    new THREE.Color(0xffd896), // Bistro warm gold
    new THREE.Color(0xd8eeff), // Pharmacy crisp cool white
    new THREE.Color(0xffe4ad), // Bookstore warm amber
    new THREE.Color(0xffbe88), // 24hr Deli warm orange-gold
    new THREE.Color(0xfff2d6)  // Watch boutique warm ivory
  ];

  const STORE_SPOT_POOL = 2; // bounded WebGL forward-light budget (SSGI handles local bounce)
  const storeSpotPool = [];
  for (let i = 0; i < STORE_SPOT_POOL; i++) {
    const spot = new THREE.SpotLight(0xffd896, 0, 12.0, 0.84, 0.80, 1.30);
    spot.castShadow = false;
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    storeLightGroup.add(spot);
    storeLightGroup.add(spot.target);
    storeSpotPool.push(spot);
  }

  const activeAwnings = [];
  const spotCandidates = [];

  // ============================================================================
  // E. DYNAMIC QUADTREE STREAMING UPDATE AROUND PLAYER / CAMERA
  // ============================================================================
  let lastStreamX = Infinity;
  let lastStreamZ = Infinity;
  let activeBlockCount = 0;
  const STREAM_RADIUS = 560; // High-detail architectural radius around player in meters

  // Streaming rewrites only the active prefix; unused pool capacity need not cross the GPU queue.
  function flagRange(attribute, count) {
    if (count === 0) return;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * attribute.itemSize);
    attribute.needsUpdate = true;
  }

  function update(focusX, focusZ, force = false) {
    const dx = focusX - lastStreamX;
    const dz = focusZ - lastStreamZ;
    if (!force && (dx * dx + dz * dz) < 324) {
      // Player moved less than 18m since last Quadtree stream update
      return;
    }
    lastStreamX = focusX;
    lastStreamZ = focusZ;

    const nearbyBlocks = quadtree.queryRange(focusX, focusZ, STREAM_RADIUS);
    // Sort closest blocks first so if any pool hits capacity, closest blocks around the player always win
    nearbyBlocks.sort((a, b) => {
      const da = (a.cx - focusX) * (a.cx - focusX) + (a.cz - focusZ) * (a.cz - focusZ);
      const db = (b.cx - focusX) * (b.cx - focusX) + (b.cz - focusZ) * (b.cz - focusZ);
      return da - db;
    });
    activeBlockCount = nearbyBlocks.length;
    activeAwnings.length = 0;

    let corniceCount = 0;
    let wtCount = 0;
    let hvacCount = 0;
    let feCount = 0;
    let awningCount = 0;
    let shedCount = 0;
    const signCounts = signInsts.map(() => 0);

    for (let bIdx = 0; bIdx < nearbyBlocks.length; bIdx++) {
      const blk = nearbyBlocks[bIdx];
      // every piece of a block turned into a frontage frame shares its turn (see placeInFrame)
      dummy.rotation.set(0, blk.ry || 0, 0);
      const collectNearLights = bIdx < 20;

      // 1. Stone cornices & setback ledges, hung just below their roof line (top 0.1h under it, so no two ledges or
      //    roofs share a plane) so roofs & terraces keep their own roofing instead of a stone lid
      for (let i = 0; i < blk.cornices.length && corniceCount < MAX_CORNICES; i++) {
        const c = blk.cornices[i];
        dummy.position.set(c.x, c.y - c.h * 0.6, c.z);
        dummy.scale.set(c.w, c.h, c.d);
        dummy.updateMatrix();
        corniceInst.setMatrixAt(corniceCount++, dummy.matrix);
      }

      // 2. Rooftop cedar water towers
      for (let i = 0; i < blk.waterTowers.length && wtCount < MAX_WATER_TOWERS; i++) {
        const wt = blk.waterTowers[i];
        dummy.scale.set(1, 1, 1);

        dummy.position.set(wt.x, wt.y + 1.3, wt.z);
        dummy.updateMatrix();
        legsInst.setMatrixAt(wtCount, dummy.matrix);

        dummy.position.set(wt.x, wt.y + 4.2, wt.z);
        dummy.updateMatrix();
        barrelInst.setMatrixAt(wtCount, dummy.matrix);

        dummy.position.set(wt.x, wt.y + 6.7, wt.z);
        dummy.updateMatrix();
        coneInst.setMatrixAt(wtCount, dummy.matrix);
        wtCount++;
      }

      // 3. Rooftop HVAC & mechanical bulkheads
      for (let i = 0; i < blk.hvacUnits.length && hvacCount < MAX_HVAC; i++) {
        const u = blk.hvacUnits[i];
        dummy.position.set(u.x, u.y + u.h * 0.5, u.z);
        dummy.scale.set(u.w, u.h, u.d);
        dummy.updateMatrix();
        hvacInst.setMatrixAt(hvacCount++, dummy.matrix);
      }

      // 4. Wrought-iron fire escapes
      for (let i = 0; i < blk.fireEscapes.length && feCount < MAX_FIRE_ESCAPES; i++) {
        const fe = blk.fireEscapes[i];
        dummy.position.set(fe.x, fe.y + fe.h * 0.5, fe.z);
        dummy.scale.set(3.4, fe.h, 1.1);
        dummy.updateMatrix();
        feInst.setMatrixAt(feCount++, dummy.matrix);
      }

      // 5. Retail awnings & illuminated storefront fascia signs
      for (let i = 0; i < blk.awnings.length && awningCount < MAX_AWNINGS; i++) {
        const a = blk.awnings[i];
        dummy.position.set(a.x, a.y, a.z);
        dummy.scale.set(a.w, 0.75, a.d);
        dummy.updateMatrix();
        awningInst.setMatrixAt(awningCount, dummy.matrix);
        awningInst.setColorAt(awningCount, awningPalette[a.colorIdx % awningPalette.length]);

        const themeIdx = awningCount % signInsts.length;
        if (signCounts[themeIdx] < MAX_SIGNS_PER_THEME) {
          dummy.position.set(a.x, 4.68, a.z);
          dummy.scale.set(0.28, 0.86, a.d * 0.92);
          dummy.updateMatrix();
          signInsts[themeIdx].setMatrixAt(signCounts[themeIdx]++, dummy.matrix);
        }
        if (collectNearLights) {
          activeAwnings.push({ a, themeIdx, ry: blk.ry || 0 });
        }
        awningCount++;
      }

      // 6. Sidewalk construction sheds
      for (let i = 0; i < blk.scaffoldSheds.length && shedCount < MAX_SHEDS; i++) {
        const s = blk.scaffoldSheds[i];
        dummy.position.set(s.x, s.y + 3.6, s.z);
        dummy.scale.set(s.w, 0.85, s.d);
        dummy.updateMatrix();
        shedInst.setMatrixAt(shedCount++, dummy.matrix);
      }
    }
    dummy.rotation.set(0, 0, 0);

    corniceInst.count = corniceCount;
    flagRange(corniceInst.instanceMatrix, corniceCount);

    legsInst.count = wtCount;
    barrelInst.count = wtCount;
    coneInst.count = wtCount;
    flagRange(legsInst.instanceMatrix, wtCount);
    flagRange(barrelInst.instanceMatrix, wtCount);
    flagRange(coneInst.instanceMatrix, wtCount);

    hvacInst.count = hvacCount;
    flagRange(hvacInst.instanceMatrix, hvacCount);

    feInst.count = feCount;
    flagRange(feInst.instanceMatrix, feCount);

    awningInst.count = awningCount;
    flagRange(awningInst.instanceMatrix, awningCount);
    if (awningInst.instanceColor) flagRange(awningInst.instanceColor, awningCount);

    signInsts.forEach((sInst, idx) => {
      sInst.count = signCounts[idx];
      flagRange(sInst.instanceMatrix, signCounts[idx]);
    });

    shedInst.count = shedCount;
    flagRange(shedInst.instanceMatrix, shedCount);
  }

  function smoothFade(d, start, end) {
    const t = Math.min(1, Math.max(0, (end - d) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  function updateLights(camera) {
    const glow = window.NYC.uInteriorGlow ? window.NYC.uInteriorGlow.value : 0.85;
    const glowFactor = Math.max(0, (glow - 0.15) / 0.90);
    if (!camera || glowFactor <= 0.001) {
      for (let i = 0; i < STORE_SPOT_POOL; i++) {
        storeSpotPool[i].intensity = 0;
        storeSpotPool[i].position.set(0, -1000, 0);
      }
      return;
    }

    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;
    const e = camera.matrixWorld.elements;
    const fwdLen = Math.hypot(e[8], e[10]) || 1;
    const fwdX = -e[8] / fwdLen;
    const fwdZ = -e[10] / fwdLen;
    const STORE_MAX_DIST = 115;

    spotCandidates.length = 0;
    for (let i = 0; i < activeAwnings.length; i++) {
      const item = activeAwnings[i];
      const a = item.a;
      const dx = a.x - camX;
      const dz = a.z - camZ;
      const d2 = dx * dx + dz * dz + camY * camY;
      if (d2 > STORE_MAX_DIST * STORE_MAX_DIST) continue;
      const d = Math.sqrt(d2);
      const forwardDot = dx * fwdX + dz * fwdZ;
      const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
      if (effDist >= STORE_MAX_DIST) continue;
      spotCandidates.push({ item, effDist });
    }
    spotCandidates.sort((a, b) => a.effDist - b.effDist);

    const storeCutoff = spotCandidates.length > STORE_SPOT_POOL
      ? Math.min(STORE_MAX_DIST, spotCandidates[STORE_SPOT_POOL].effDist)
      : STORE_MAX_DIST;
    const activeSpots = Math.min(STORE_SPOT_POOL, spotCandidates.length);
    const spotIntensity = 46 * glowFactor;
    for (let i = 0; i < STORE_SPOT_POOL; i++) {
      const spot = storeSpotPool[i];
      if (i < activeSpots) {
        const cand = spotCandidates[i];
        const { a, themeIdx, ry } = cand.item;
        const fade = smoothFade(cand.effDist, storeCutoff * 0.62, storeCutoff);
        const sideDir = a.sideDir || 1;
        const outX = Math.cos(ry) * sideDir;
        const outZ = -Math.sin(ry) * sideDir;
        spot.position.set(a.x + outX * 0.45, 4.35, a.z + outZ * 0.45);
        spot.target.position.set(a.x + outX * 1.85, 0.0, a.z + outZ * 1.85);
        spot.target.updateMatrixWorld();
        spot.color.copy(storeThemeColors[themeIdx % storeThemeColors.length]);
        spot.intensity = spotIntensity * fade;
      } else {
        spot.intensity = 0;
        spot.position.set(0, -1000, 0);
      }
    }
  }

  // Initial Quadtree stream centered at Midtown 5th Ave & 42nd St
  update(0, 62, true);

  scene.add(group);
  return {
    group,
    colliders,
    quadtree,
    allBlocks,
    update,
    updateLights,
    getActiveBlockCount: () => activeBlockCount
  };
}

Object.assign(window.NYC, { ManhattanQuadtree, buildCityBlocks });
})();
