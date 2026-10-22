(function () {
// js/city-grid.js
// Builds Manhattan Island's true polygonal coastline contour, granite seawall bulkhead,
// full-island 3D raised sidewalks & curbstones (split by Broadway's diagonal corridor),
// organic Central Park lakes & winding drives, Roosevelt & Governors Islands,
// Hudson & East River piers, and East River suspension bridges at 60 FPS.

const { THREE } = window.NYC;
const { mergeGeometries } = window.NYC.Addons;
const {
  AVENUES,
  STREETS,
  ISLAND_BOUNDS,
  CENTRAL_PARK_BOUNDS,
  LANDMARK_BLOCKS,
  getIslandBoundsAtZ,
  MANHATTAN_COASTLINE,
  getBroadwayX,
  WATERFRONT_PIERS,
  ROOSEVELT_ISLAND_POLYGON,
  GOVERNORS_ISLAND_POLYGON,
  getBlockBounds,
  BLOCKS
} = window.NYC;
const {
  createRoadSurfaceMaterial,
  createSidewalkMaterial,
  createCurbMaterial,
  createWaterMaterial,
  createCurtainWallMaterial,
  createFacadeBoxes,
  createParkLawnMaterial
} = window.NYC;

/**
 * Builds a multi-part vaulted stone-arch park bridge (Gapstow Bridge & Bow Bridge)
 * with stone abutments, segmented arch ring, cambered walkway deck, and parapet walls.
 */
function addStoneArchBridge(parent, cx, cz, rotY, span, width, archRise, wallMat, deckMat) {
  const bGroup = new THREE.Group();
  bGroup.position.set(cx, 1.22, cz);
  bGroup.rotation.y = rotY;

  const numSegs = 9;
  const segLen = span / numSegs;
  for (let i = 0; i < numSegs; i++) {
    const u = ((i + 0.5) / numSegs) * 2.0 - 1.0; // -1 .. +1
    const archY = Math.max(0.15, (1.0 - u * u) * archRise);
    const xPos = u * (span * 0.48);
    const tiltZ = -2.0 * u * (archRise / (span * 0.55));

    // Segmented stone arch & spandrel wall
    const spandrelH = 0.55 + (1.0 - Math.abs(u) * 0.35) * 0.45;
    const archSeg = new THREE.Mesh(new THREE.BoxGeometry(segLen * 1.08, spandrelH, width), wallMat);
    archSeg.position.set(xPos, archY + spandrelH * 0.35, 0);
    archSeg.rotation.z = tiltZ * 0.65;
    archSeg.castShadow = true;
    archSeg.receiveShadow = true;
    bGroup.add(archSeg);

    // Cambered gravel/bluestone pedestrian deck
    const deckSeg = new THREE.Mesh(new THREE.BoxGeometry(segLen * 1.08, 0.22, width - 0.7), deckMat);
    deckSeg.position.set(xPos, archY + spandrelH * 0.78, 0);
    deckSeg.rotation.z = tiltZ * 0.65;
    deckSeg.receiveShadow = true;
    bGroup.add(deckSeg);

    // Left & right stone parapet railings
    for (const side of [-1, 1]) {
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(segLen * 1.06, 0.78, 0.38), wallMat);
      parapet.position.set(xPos, archY + spandrelH * 0.78 + 0.44, side * (width * 0.5 - 0.20));
      parapet.rotation.z = tiltZ * 0.65;
      parapet.castShadow = true;
      parapet.receiveShadow = true;
      bGroup.add(parapet);
    }
  }

  // Heavy rusticated stone end abutments anchored into both banks
  for (const endSign of [-1, 1]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.35, width + 1.0), wallMat);
    pier.position.set(endSign * (span * 0.49), 0.52, 0);
    pier.castShadow = true;
    pier.receiveShadow = true;
    bGroup.add(pier);
  }

  parent.add(bGroup);
}

/**
 * Builds a flat-faceted, glacially striated Manhattan Schist bedrock outcrop geometry
 * (non-indexed with crisp per-facet surface normals).
 */
function buildManhattanSchistGeometry() {
  const base = new THREE.DodecahedronGeometry(5.6, 1);
  const nonIndexed = base.index ? base.toNonIndexed() : base;
  const pos = nonIndexed.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let vx = pos.getX(i);
    let vy = pos.getY(i);
    let vz = pos.getZ(i);

    // Flatten sub-surface base and sculpt stepped glacial striation ridges along NE-SW axis
    if (vy < -0.6) {
      vy = -0.6;
    } else {
      const ridge = Math.sin(vx * 0.55 + vz * 0.35) * 0.65 + Math.cos(vx * 0.9 - vz * 0.7) * 0.35;
      const stepShelf = Math.round((vy + ridge * 0.4) * 1.25) / 1.25;
      vy = vy * 0.55 + stepShelf * 0.45;
      vx += Math.sin(vz * 0.6 + vy * 0.4) * 0.55;
      vz += Math.cos(vx * 0.5 - vy * 0.3) * 0.45;
    }
    pos.setXYZ(i, vx, vy, vz);
  }
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

/**
 * Merges static non-instanced THREE.Mesh objects sharing the same material into a single
 * batched BufferGeometry per material to minimize WebGPU render & shadow pass draw calls.
 */
function batchStaticGroupMeshes(rootGroup, excludeMaterials = null) {
  if (!mergeGeometries) return;
  rootGroup.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(rootGroup.matrixWorld).invert();
  const buckets = new Map();

  rootGroup.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || !obj.geometry || !obj.material) return;
    if (excludeMaterials && excludeMaterials.has(obj.material)) return;
    const attrs = obj.geometry.attributes;
    if (!attrs.position || !attrs.normal || !attrs.uv) return;
    if (!buckets.has(obj.material)) {
      buckets.set(obj.material, []);
    }
    buckets.get(obj.material).push(obj);
  });

  for (const [mat, meshes] of buckets.entries()) {
    if (meshes.length < 2) continue;
    const geos = [];
    let anyCast = false;
    let anyReceive = false;

    for (const m of meshes) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const key of Object.keys(g.attributes)) {
        if (key !== 'position' && key !== 'normal' && key !== 'uv') {
          g.deleteAttribute(key);
        }
      }
      const relMat = new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(relMat);
      geos.push(g);
      if (m.castShadow) anyCast = true;
      if (m.receiveShadow) anyReceive = true;
      if (m.parent) m.parent.remove(m);
    }

    const merged = mergeGeometries(geos, false);
    if (merged) {
      const batchedMesh = new THREE.Mesh(merged, mat);
      batchedMesh.castShadow = anyCast;
      batchedMesh.receiveShadow = anyReceive;
      rootGroup.add(batchedMesh);
    }
  }
}

/**
 * Helper to convert an array of world {x, z} polygon vertices into a horizontal THREE.Shape
 * in (x, -z) space so that rotating by rotateX(-Math.PI / 2) maps (x, -z, 0) -> (x, 0, z)
 * with an upward (+Y) surface normal.
 */
function createWorldXZShape(pts) {
  const shape = new THREE.Shape();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  }
  shape.closePath();
  return shape;
}

function createExtrudedPolygonMesh(pts, bottomY, height, material, receiveShadow = true, castShadow = false) {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bottomY, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  mesh.castShadow = castShadow;
  return mesh;
}

function createFlatPolygonMesh(pts, y, material, receiveShadow = true) {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/**
 * Sutherland-Hodgman clip of polygon [{x, z}] to the half-plane nx * x + nz * z >= c.
 */
function clipPolygonHalfPlane(pts, nx, nz, c) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const da = nx * a.x + nz * a.z - c;
    const db = nx * b.x + nz * b.z - c;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function rectPolygon(minX, maxX, minZ, maxZ) {
  return [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }];
}

/**
 * Clips polygon [{x, z}] (may be concave, e.g. MANHATTAN_COASTLINE) to the inside of a convex polygon (either winding).
 * The part inside must be connected.
 */
function clipPolygonToConvex(pts, convex) {
  let area = 0;
  for (let i = 0; i < convex.length; i++) {
    const a = convex[i];
    const b = convex[(i + 1) % convex.length];
    area += a.x * b.z - b.x * a.z;
  }
  const s = area > 0 ? 1 : -1;
  let out = pts;
  for (let i = 0; i < convex.length && out.length; i++) {
    const a = convex[i];
    const b = convex[(i + 1) % convex.length];
    const nx = -s * (b.z - a.z);
    const nz = s * (b.x - a.x);
    out = clipPolygonHalfPlane(out, nx, nz, nx * a.x + nz * a.z);
  }
  return out;
}

/** Area centroid {x, z} of a simple polygon [{x, z}]. */
function polygonCentroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.z - q.x * p.z;
    a += f;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return Math.abs(a) < 1e-9 ? { x: pts[0].x, z: pts[0].z } : { x: cx / (3 * a), z: cz / (3 * a) };
}

/**
 * Offsets a convex polygon outward (d > 0) or inward (d < 0) by moving each vertex along its corner bisector.
 */
function offsetConvexPolygon(pts, d) {
  const src = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(q.x - p.x, q.z - p.z) > 0.05;
  });
  const n = src.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = src[i];
    const b = src[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  const s = area > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = src[(i + n - 1) % n];
    const p1 = src[i];
    const p2 = src[(i + 1) % n];
    const l1 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const l2 = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n1x = (s * (p1.z - p0.z)) / l1;
    const n1z = (-s * (p1.x - p0.x)) / l1;
    const n2x = (s * (p2.z - p1.z)) / l2;
    const n2z = (-s * (p2.x - p1.x)) / l2;
    let bx = n1x + n2x;
    let bz = n1z + n2z;
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    const cosHalf = Math.max(0.3, bx * n1x + bz * n1z);
    out.push({ x: p1.x + (bx * d) / cosHalf, z: p1.z + (bz * d) / cosHalf });
  }
  return out;
}

/**
 * Tags every vertex of a mesh using the shared park paving material with its paving style (uv.x, see
 * createParkPavingMaterial: 0 hex asphalt pavers, 1 light granite plaza pavers, 2 bluestone slabs).
 */
/**
 * A simple polygon ([{x, z}], either winding, convex or not) offset inward by d with mitred corners (miters clamped
 * to 3d); null if it collapses
 */
function offsetPolygonInward(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const s = area > 0 ? 1 : -1; // positive area: the inside lies left of each edge, i.e. along (-dz, dx)
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n];
    const q = pts[i];
    const r = pts[(i + 1) % n];
    let ax = q.x - p.x, az = q.z - p.z;
    let bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az) || 1e-9;
    const lb = Math.hypot(bx, bz) || 1e-9;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * s, n1z = ax * s; // inward normals of the two edges
    const n2x = -bz * s, n2z = bx * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push({ x: q.x + n1x * d, z: q.z + n1z * d }); continue; }
    mx /= ml; mz /= ml;
    const cos = mx * n1x + mz * n1z; // miter length = d / cos(half angle)
    const len = Math.min(3 * d, d / Math.max(1e-3, cos));
    out.push({ x: q.x + mx * len, z: q.z + mz * len });
  }
  let a2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a2 += out[j].x * out[i].z - out[i].x * out[j].z;
  return a2 * area > 0 && Math.abs(a2) < Math.abs(area) ? out : null;
}

function polygonCentroidArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return a * 0.5;
}
function pointInPolygonXZ(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Polygon offset by d (d > 0 inward, d < 0 outward), mitred corners clamped to 3|d|; null if it degenerates */
function offsetPolygon(pts, d) {
  if (d > 0) return offsetPolygonInward(pts, d);
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const s = area > 0 ? -1 : 1; // outward normal side
  const D = -d;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], q = pts[i], r = pts[(i + 1) % n];
    let ax = q.x - p.x, az = q.z - p.z, bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az) || 1e-9, lb = Math.hypot(bx, bz) || 1e-9;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * s, n1z = ax * s, n2x = -bz * s, n2z = bx * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push({ x: q.x + n1x * D, z: q.z + n1z * D }); continue; }
    mx /= ml; mz /= ml;
    const len = Math.min(3 * D, D / Math.max(1e-3, mx * n1x + mz * n1z));
    out.push({ x: q.x + mx * len, z: q.z + mz * len });
  }
  return out;
}

function setPavingStyle(geo, style) {
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, style, 0);
  uvAttr.needsUpdate = true;
  return geo;
}

/**
 * Vertical alpha-tested iron fence strips (createIronFenceMaterial) along segments [[x1, z1, x2, z2], ...]:
 * uv.x = metres along the run, uv.y = 0 (bottom) .. 1 (top).
 */
function buildFenceStripGeometry(segments, y0, h) {
  const pos = [];
  const nor = [];
  const uvs = [];
  for (const [x1, z1, x2, z2] of segments) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.4) continue;
    const nx = -(z2 - z1) / len;
    const nz = (x2 - x1) / len;
    const corners = [[x1, z1, 0, 0], [x2, z2, len, 0], [x2, z2, len, 1], [x1, z1, 0, 0], [x2, z2, len, 1], [x1, z1, 0, 1]];
    for (const [x, z, u, v] of corners) {
      pos.push(x, y0 + v * h, z);
      nor.push(nx, 0, nz);
      uvs.push(u, v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * Closed polygon outline -> fence segments, skipping the stretches within `gapR` of any gate point {x, z}.
 */
function polygonFenceSegments(pts, gates = [], gapR = 2.0, step = 1.0) {
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / step));
    let runStart = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const open = gates.some((g) => Math.hypot(g.x - x, g.z - z) < gapR);
      if (!open && runStart === null) runStart = { x, z };
      if ((open || k === n) && runStart !== null) {
        if (Math.hypot(x - runStart.x, z - runStart.z) > 0.4) segs.push([runStart.x, runStart.z, x, z]);
        runStart = null;
      }
    }
  }
  return segs;
}

// Waterfront piers: shared TSL uber-materials. All static pier geometry is merged per material, so the look of each
// structure is selected by a "variant" id packed into uv.x (uv.x = variant * 10 + u) instead of extra draw calls.
function createWaterfrontPierMaterials() {
  const {
    float, vec2, vec3, color, uv, texture, positionWorld, positionGeometry, normalWorldGeometry,
    fract, floor, mod, sin, dot, abs, min, max, mix, step, smoothstep, clamp, fwidth, length
  } = window.NYC.TSL;
  const night = smoothstep(0.7, 1.45, window.NYC.cityUniforms.uInteriorGlow);
  const hash = (p) => fract(sin(dot(mod(p, 211.0), vec2(127.1, 311.7))).mul(43758.5453));
  const vnoise = (p) => {
    const i = floor(p);
    const f = fract(p);
    const w = f.mul(f).mul(f.mul(-2.0).add(3.0));
    const a = hash(i), b = hash(i.add(vec2(1, 0))), c = hash(i.add(vec2(0, 1))), d = hash(i.add(vec2(1, 1)));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
  };
  // 1 on anti-aliased lines of half-width hw (metres) repeating every `cell` along q; fades out once sub-pixel
  const lines = (q, cell, hw) => {
    const f = fract(q.div(cell));
    const fw = max(fwidth(q), 0.0001);
    return smoothstep(fw.add(hw), float(hw), min(f, f.oneMinus()).mul(cell)).mul(clamp(float(hw * 2.5).div(fw), 0.0, 1.0));
  };
  // 1 inside [lo, hi] of a 0..1 periodic coordinate t (anti-aliased over fw)
  const band = (t, lo, hi, fw) => smoothstep(float(lo).sub(fw), float(lo).add(fw), t).mul(smoothstep(float(hi).add(fw), float(hi).sub(fw), t));
  const variantOf = () => floor(uv().x.mul(0.1).add(0.01));
  const picker = (vid) => {
    const w = (k) => step(abs(vid.sub(k)), 0.5);
    return {
      f: (vals) => vals.reduce((acc, val, k) => acc.add(w(k).mul(val)), float(0)),
      c: (vals) => vals.reduce((acc, val, k) => acc.add(w(k).mul(typeof val === 'number' ? color(val) : val)), vec3(0))
    };
  };

  // ---- Ground: 0 concrete deck · 1 rooftop parking · 2 sand · 3 timber boardwalk · 4 lawn · 5 sports turf (field uv) ·
  //      6 golf turf · 7 pavers · 8 asphalt
  const ground = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0 });
  {
    const gv = variantOf();
    const P = picker(gv);
    const wp = positionWorld.xz;
    const lu = vec2(uv().x.sub(gv.mul(10.0)), uv().y);
    const concrete = mix(mix(color(0x6c6860), color(0x8a857b), hash(floor(wp.div(5.0)))), color(0x403d38),
      max(lines(wp.x, 5.0, 0.035), lines(wp.y, 5.0, 0.035)).mul(0.6));
    // Rooftop parking: 5.2 m stall rows either side of 6.6 m drive aisles, ~60% occupied
    const rowT = fract(wp.y.div(17.0)).mul(17.0);
    const rowB = step(11.8, rowT);
    const inRow = step(rowT, 5.2).add(rowB);
    const dep = rowT.sub(rowB.mul(11.8));
    const sx = fract(wp.x.div(2.7));
    const carId = hash(vec2(floor(wp.x.div(2.7)), floor(wp.y.div(17.0)).mul(2.0).add(rowB)));
    const car = inRow.mul(step(0.38, carId)).mul(step(0.17, sx)).mul(step(sx, 0.83)).mul(step(0.45, dep)).mul(step(dep, 4.75));
    const carCol = mix(mix(color(0x1e2024), color(0xd6d6d1), step(0.5, fract(carId.mul(7.31)))), color(0x7c2a22), step(0.82, fract(carId.mul(13.7))));
    const parking = mix(mix(color(0x5e5d59), color(0xe4e2da), lines(wp.x, 2.7, 0.06).mul(inRow)), carCol, car);
    const grain = vnoise(wp.mul(1.3));
    const sand = mix(color(0xbca47c), color(0xd8c6a0), grain);
    const row = floor(wp.y.div(0.32));
    const boards = mix(mix(color(0x5b4533), color(0x8b6b4d), hash(vec2(row, floor(wp.x.div(3.6).add(hash(vec2(row, 7.0))))))),
      color(0x2a2119), lines(wp.y, 0.32, 0.014));
    const lawn = mix(color(0x2b5424), color(0x507e34), vnoise(wp.mul(0.12)).mul(0.6).add(vnoise(wp.mul(0.7)).mul(0.4)));
    // Sports turf with white soccer markings drawn in the field box's own 0..1 top-face uv
    const fwF = max(max(fwidth(lu.x), fwidth(lu.y)), 0.0001);
    const fieldLine = (d) => smoothstep(fwF.add(0.006), 0.006, abs(d));
    const edgeD = min(min(lu.x, lu.x.oneMinus()), min(lu.y, lu.y.oneMinus()));
    const px = min(lu.x, lu.x.oneMinus());
    const marks = max(max(fieldLine(edgeD.sub(0.035)), fieldLine(lu.x.sub(0.5)).mul(step(0.035, edgeD))),
      max(fieldLine(length(lu.sub(0.5).mul(vec2(2.0, 1.0))).sub(0.16)), fieldLine(max(abs(px.sub(0.115)).sub(0.08), abs(lu.y.sub(0.5)).sub(0.24)))));
    const turf = mix(mix(color(0x2c6633), color(0x37773d), step(0.5, fract(lu.x.mul(9.0)))), color(0xecece6), marks);
    const golf = mix(color(0x3d7b35), color(0x4b8a3f), step(0.5, fract(wp.x.div(6.0))));
    const pavers = mix(mix(color(0x8a8176), color(0xa1998d), hash(floor(wp.div(0.9)))), color(0x5b554d),
      max(lines(wp.x, 0.9, 0.02), lines(wp.y, 0.9, 0.02)));
    const asphalt = mix(color(0x323337), color(0x45464a), grain);
    ground.colorNode = P.c([concrete, parking, sand, boards, lawn, turf, golf, pavers, asphalt]);
    ground.roughnessNode = P.f([0.88, 0.8, 0.96, 0.78, 0.95, 0.85, 0.9, 0.8, 0.86]);
  }

  // ---- Buildings: 0 cruise terminal · 1 Chelsea Piers · 2 industrial shed · 3 Pier 57 concrete · 4 Pier 40 garage ·
  //      5 brick vent · 6 white panels/fabric · 7 glass curtain wall · 8 green trim · 9 dark steel · 10 light concrete
  const bldg = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.0 });
  {
    const bv = variantOf();
    const P = picker(bv);
    const n = normalWorldGeometry;
    const wall = smoothstep(0.65, 0.35, abs(n.y));
    const h = positionWorld.x.mul(n.z.negate()).add(positionWorld.z.mul(n.x)); // horizontal coordinate along any wall
    const y = positionWorld.y.sub(0.12);
    const NO = 9.0; // sill/head beyond 1 => blank wall
    const fh = P.f([7.6, 4.6, 9.0, 5.2, 4.6, 6.0, 50, 4.2, 50, 50, 50]);
    const sill = P.f([0.42, 0.38, 0.74, 0.22, 0.44, 0.2, NO, 0.03, NO, NO, NO]);
    const head = P.f([0.8, 0.8, 0.93, 0.86, 0.95, 0.85, NO, 0.97, NO, NO, NO]);
    const bay = P.f([3.2, 2.6, 4.0, 3.6, 8.0, 3.0, 1.6, 1.6, 2.0, 2.0, 2.4]);
    const wf = P.f([0.95, 0.56, 0.9, 0.84, 0.93, 0.34, 0, 0.95, 0, 0, 0]);
    const fy = fract(y.div(fh));
    const fwy = max(fwidth(y).div(fh), 0.0005);
    const fx = fract(h.div(bay));
    const fwx = max(fwidth(h).div(bay), 0.0005);
    const win = band(fy, sill, head, fwy).mul(band(fx, wf.mul(-0.5).add(0.5), wf.mul(0.5).add(0.5), fwx)).mul(wall).mul(step(1.2, y));
    const rnd = hash(vec2(floor(h.div(bay)), floor(y.div(fh)).add(bv.mul(17.0))));
    const wallCol = P.c([0xdadddb, 0xe2dbc8, 0xb4b7b3, 0xb0a691, 0xa39b8e, 0x84463a, 0xefeee8, 0x2f353a, 0x587061, 0x2a3033, 0xc3beb2]);
    const glassCol = P.c([0x25303a, 0x29323a, 0x333f49, 0x283039, 0x111111, 0x2b2725, 0, 0x5a7482, 0, 0, 0]);
    const roofCol = P.c([0x9a9994, 0x8b8a85, 0x91908b, 0x8c867a, 0x7c776e, 0x6b5e55, 0xe5e5e0, 0x343b41, 0x587061, 0x2a3033, 0xbdb8ac]);
    const trim = step(abs(bv.sub(1.0)), 0.5).mul(band(fy, 0.0, 0.08, fwy)); // Chelsea Piers' green cornice bands
    const seam = lines(h, bay, 0.02).mul(0.22).add(step(abs(bv.sub(2.0)), 0.5).mul(lines(h, 0.6, 0.05)).mul(0.18));
    const facade = mix(wallCol.mul(seam.oneMinus()), color(0x55705f), trim);
    const glazing = glassCol.mul(rnd.mul(0.35).add(0.8));
    const ao = smoothstep(0.0, 2.5, y).mul(0.22).add(0.78);
    const roof = roofCol.mul(hash(floor(positionWorld.xz.div(4.0))).mul(0.1).add(0.95));
    bldg.colorNode = mix(roof, mix(facade, glazing, win).mul(ao), wall);
    bldg.roughnessNode = mix(float(0.85), mix(P.f([0.6, 0.72, 0.5, 0.88, 0.92, 0.9, 0.55, 0.3, 0.45, 0.4, 0.85]), float(0.1), win), wall);
    bldg.metalnessNode = mix(P.f([0, 0, 0.3, 0, 0, 0, 0, 0.5, 0.2, 0.55, 0]), float(0.0), win).mul(wall);
    const lit = step(rnd, P.f([0.45, 0.45, 0.25, 0.5, 0.9, 0, 0, 0.55, 0, 0, 0]));
    const warm = mix(color(0xffc27a), color(0xfff1da), fract(rnd.mul(5.7)));
    bldg.emissiveNode = warm.mul(win).mul(lit).mul(night).mul(P.f([0.8, 0.75, 0.5, 0.7, 0.4, 0, 0, 0.6, 0, 0, 0]));
  }
  return createWaterfrontPierMaterialsPart2({ ground, bldg, night, hash, vnoise, band, variantOf, picker });
}

// Waterfront piers: ship paint / timber / steel, golf netting, tree crowns and a canvas sign atlas
function createWaterfrontPierMaterialsPart2(shared) {
  const { vec2, vec3, color, uv, texture, positionWorld, positionGeometry, normalWorldGeometry, fract, floor, abs, max, mix, step, smoothstep, fwidth, float } = window.NYC.TSL;
  const { night, hash, vnoise, band, variantOf, picker } = shared;

  // ---- Paint: 0 haze grey · 1 ferry orange · 2 black · 3 lightship red · 4 white · 5 navy · 6 buff · 7 teak ·
  //      8 creosote timber · 9 dark steel · 10 lamp glass · 11 ship windows · 12 under-deck shadow · 13 aircraft grey
  const paint = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });
  {
    const pv = variantOf();
    const P = picker(pv);
    const n = normalWorldGeometry;
    const h = positionWorld.x.mul(n.z.negate()).add(positionWorld.z.mul(n.x));
    const y = positionWorld.y;
    const isWin = step(abs(pv.sub(11.0)), 0.5);
    const pane = band(fract(h.div(1.3)), 0.1, 0.9, max(fwidth(h).div(1.3), 0.0005));
    const base = P.c([0x68707a, 0xe0662b, 0x1b1c1f, 0xa2271f, 0xe7e6e1, 0x1e3451, 0xc6ae86, 0x8a6542, 0x2d2621, 0x252c2a, 0xf2ede0, 0x1a232a, 0x0a0a09, 0x8a939a,
      0x4a6634, 0x58743c, 0x667f45]);
    const grime = smoothstep(-0.8, -1.9, y).mul(0.4).mul(isWin.oneMinus()); // water-line staining on hulls & piles
    const leaf = step(13.5, pv); // 14-16: tree crowns, leafy noise and darker undersides
    const leafShade = vnoise(positionWorld.xz.mul(0.9).add(y)).mul(0.35).add(0.62).add(n.y.mul(0.22));
    paint.colorNode = mix(base, color(0x3a3f43), isWin.mul(pane.oneMinus())).mul(grime.oneMinus()).mul(mix(float(1), leafShade, leaf));
    paint.roughnessNode = P.f([0.55, 0.45, 0.5, 0.5, 0.42, 0.5, 0.6, 0.75, 0.95, 0.45, 0.3, 0.12, 1.0, 0.4, 0.9, 0.9, 0.9]);
    paint.metalnessNode = P.f([0.2, 0.05, 0.15, 0.05, 0.02, 0.1, 0.05, 0, 0, 0.5, 0, 0, 0, 0.3, 0, 0, 0]);
    const lamp = step(abs(pv.sub(10.0)), 0.5).mul(night.mul(3.4).add(0.03));
    const winLit = isWin.mul(pane).mul(step(0.4, hash(vec2(floor(h.div(1.3)), floor(y.div(2.4)))))).mul(night).mul(1.1);
    paint.emissiveNode = color(0xffcf8c).mul(lamp.add(winLit));
  }

  // Sign atlas: one 1024x512 canvas, one row per sign (white letters, alpha-tested, lit at night)
  const SIGNS = ['STATEN ISLAND FERRY', 'CHELSEA PIERS', 'PIER 17', 'CIRCLE LINE'];
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const signRects = {};
  SIGNS.forEach((text, i) => {
    let size = 96;
    ctx.font = `800 ${size}px Inter, Arial, sans-serif`;
    let w = ctx.measureText(text).width;
    if (w > 960) {
      size = Math.floor((size * 960) / w);
      ctx.font = `800 ${size}px Inter, Arial, sans-serif`;
      w = ctx.measureText(text).width;
    }
    const cy = i * 128 + 64;
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(24, 28, 32, 0.95)';
    ctx.strokeText(text, 512, cy);
    ctx.fillStyle = '#f5f6f2';
    ctx.fillText(text, 512, cy);
    const ww = w + 24;
    signRects[text] = { u0: (512 - ww / 2) / 1024, u1: (512 + ww / 2) / 1024, v0: 1 - (i + 1) / 4, v1: 1 - i / 4, aspect: ww / 128 };
  });
  const signTex = new THREE.CanvasTexture(canvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  // Lettering and the golf / sports-cage netting share this alpha-tested material: net panels (uv.x >= 2) discard on a
  // stable screen-space dither (~42% coverage) that reads as fine mesh at any distance, without a transparent pass
  const tex = texture(signTex, uv());
  const isNet = step(1.5, uv().x);
  const sc = window.NYC.TSL.screenCoordinate;
  const dither = fract(fract(sc.x.mul(0.06711056).add(sc.y.mul(0.00583715))).mul(52.9829189));
  const sign = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.5, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide });
  sign.colorNode = mix(tex.rgb, color(0x161b19), isNet);
  sign.opacityNode = mix(tex.a, step(dither, 0.42), isNet);
  sign.emissiveNode = tex.rgb.mul(night.mul(0.9)).mul(isNet.oneMinus());

  return { ground: shared.ground, bldg: shared.bldg, paint, sign, signRects };
}

// Waterfront piers: accumulates world-space boxes and small geometries per material into growable typed arrays,
// writing the material variant into uv.x so a whole waterfront costs one draw call per material.
function createPierBoxBatcher() {
  const unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const UP = unit.attributes.position.array, UN = unit.attributes.normal.array, UU = unit.attributes.uv.array;
  const SIDE = [0, 1, 4, 5].flatMap((f) => [0, 1, 2, 3, 4, 5].map((k) => f * 6 + k)); // px, nx, pz, nz faces
  const pick = (arr, k) => Float32Array.from(SIDE.flatMap((i) => Array.from(arr.subarray(i * k, i * k + k))));
  const SP = pick(UP, 3), SN = pick(UN, 3), SU = pick(UU, 2);
  const buckets = new Map();
  const bucket = (mat, extra) => {
    let b = buckets.get(mat);
    if (!b) {
      b = { p: new Float32Array(36 * 3 * 1024), n: new Float32Array(36 * 3 * 1024), u: new Float32Array(36 * 2 * 1024), count: 0 };
      buckets.set(mat, b);
    }
    if ((b.count + extra) * 3 > b.p.length) {
      const cap = (b.count + extra) * 2;
      const grow = (arr, k) => { const a = new Float32Array(cap * k); a.set(arr); return a; };
      b.p = grow(b.p, 3);
      b.n = grow(b.n, 3);
      b.u = grow(b.u, 2);
    }
    return b;
  };
  const push = (mat, P, N, U, cnt, x, y, z, sx, sy, sz, rotY, variant) => {
    const b = bucket(mat, cnt);
    const c = Math.cos(rotY), s = Math.sin(rotY);
    for (let i = 0; i < cnt; i++) {
      const px = P[i * 3] * sx, py = P[i * 3 + 1] * sy, pz = P[i * 3 + 2] * sz;
      const o = (b.count + i) * 3;
      b.p[o] = x + px * c + pz * s;
      b.p[o + 1] = y + py;
      b.p[o + 2] = z - px * s + pz * c;
      const nx = N[i * 3], nz = N[i * 3 + 2];
      b.n[o] = nx * c + nz * s;
      b.n[o + 1] = N[i * 3 + 1];
      b.n[o + 2] = -nx * s + nz * c;
      const t = (b.count + i) * 2;
      b.u[t] = variant * 10 + Math.min(0.999, Math.max(0, U[i * 2]));
      b.u[t + 1] = U[i * 2 + 1];
    }
    b.count += cnt;
  };
  return {
    box: (mat, x, y, z, sx, sy, sz, rotY = 0, variant = 0, open = false) =>
      (open ? push(mat, SP, SN, SU, 24, x, y, z, sx, sy, sz, rotY, variant) : push(mat, UP, UN, UU, 36, x, y, z, sx, sy, sz, rotY, variant)),
    geo: (mat, geo, x, y, z, rotY = 0, variant = 0) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (!g.attributes.normal) g.computeVertexNormals();
      const cnt = g.attributes.position.count;
      const U = g.attributes.uv ? g.attributes.uv.array : new Float32Array(cnt * 2);
      push(mat, g.attributes.position.array, g.attributes.normal.array, U, cnt, x, y, z, 1, 1, 1, rotY, variant);
    },
    build: (group, castMats) => {
      for (const [mat, b] of buckets) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(b.p.slice(0, b.count * 3), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(b.n.slice(0, b.count * 3), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(b.u.slice(0, b.count * 2), 2));
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = castMats.has(mat);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
  };
}

// Waterfront piers: vertical-sided ship hull from its plan outline (bow toward +x, optional double-ended ferry form)
function pierHullGeometry(len, beam, depth, bowFrac = 0.28, sternFrac = 0.06, doubleEnded = false) {
  const hl = len / 2, hb = beam / 2;
  const bowA = hl - len * bowFrac;
  const sternA = doubleEnded ? -bowA : -hl + len * sternFrac;
  const side = [];
  if (doubleEnded) {
    for (let i = 0; i <= 5; i++) { const t = 1 - i / 5; side.push([sternA - (hl + sternA) * t, hb * (1 - t * t)]); }
  } else {
    side.push([-hl, hb * 0.78], [sternA, hb]);
  }
  for (let i = 0; i <= 6; i++) { const t = i / 6; side.push([bowA + (hl - bowA) * t, hb * (1 - t * t)]); }
  const shape = new THREE.Shape();
  side.forEach(([a, b], i) => (i === 0 ? shape.moveTo(a, b) : shape.lineTo(a, b)));
  for (let i = side.length - 1; i >= 0; i--) if (side[i][1] > 0.001) shape.lineTo(side[i][0], -side[i][1]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// Waterfront piers: builds every WATERFRONT_PIERS entry: concrete decks on timber piles with fenders, railings and
// lamps, plus each pier's landmark structures. All static parts go through one batcher (~1 draw call per material).
function buildWaterfrontPiers(group) {
  const M = createWaterfrontPierMaterials();
  for (const [k, m] of Object.entries(M)) if (m && m.isMaterial) m.name = 'waterfrontPier.' + k;
  const B = createPierBoxBatcher();
  const { ground: GR, bldg: BL, paint: PA } = M;
  const DY = 0.12; // deck top, just above the esplanade
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const trees = [];
  let seed = 1234567;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // Local frame: u runs seaward from the bulkhead, s across the pier (rotation about Y as in Object3D.rotation.y)
  const frame = (x0, z0, theta) => {
    const c = Math.cos(theta), sn = Math.sin(theta);
    const wx = (u, s) => x0 + u * c + s * sn;
    const wz = (u, s) => z0 - u * sn + s * c;
    return {
      theta, wx, wz,
      box: (mat, u0, u1, y0, y1, s0, s1, v = 0, open = false) => B.box(mat, wx((u0 + u1) / 2, (s0 + s1) / 2), (y0 + y1) / 2, wz((u0 + u1) / 2, (s0 + s1) / 2),
        Math.abs(u1 - u0), Math.abs(y1 - y0), Math.abs(s1 - s0), theta, v, open),
      geo: (mat, geo, u = 0, y = 0, s = 0, rot = 0, v = 0) => B.geo(mat, geo, wx(u, s), y, wz(u, s), theta + rot, v),
      sub: (u, s, rot = 0) => frame(wx(u, s), wz(u, s), theta + rot),
      // Thin beam between two local points [u, y, s] (rigging, masts, ramps); t thick, t2 wide
      strut: (mat, a, b, t, v = 0, t2 = t) => {
        const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const g = new THREE.BoxGeometry(t, d.length(), t2);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d.normalize()));
        g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        B.geo(mat, g, x0, 0, z0, theta, v);
      },
      tree: (u, s, y, r) => trees.push([wx(u, s), y, wz(u, s), r]),
      // Canvas-atlas lettering; rot = -PI/2 faces landward (-u), +PI/2 seaward (+u)
      sign: (text, u, y, s, height, rot) => {
        const r = M.signRects[text];
        const g = new THREE.PlaneGeometry(height * r.aspect, height);
        const uvA = g.attributes.uv;
        for (let i = 0; i < uvA.count; i++) uvA.setXY(i, r.u0 + (r.u1 - r.u0) * uvA.getX(i), r.v0 + (r.v1 - r.v0) * uvA.getY(i));
        const mesh = new THREE.Mesh(g, M.sign);
        mesh.position.set(wx(u, s), y, wz(u, s));
        mesh.rotation.y = theta + rot;
        group.add(mesh);
      }
    };
  };

  // Hudson piers run straight out along the cross streets; East River piers stand perpendicular to the bulkhead
  const pierFrame = (p) => {
    const west = p.side === 'west';
    const shoreAt = (z) => { const b = getIslandBoundsAtZ(z); return west ? b.westX : b.eastX; };
    let theta = west ? Math.PI : Math.atan2(shoreAt(p.z + 14) - shoreAt(p.z - 14), 28);
    let x0 = shoreAt(p.z);
    let z0 = p.z;
    if (p.angle !== undefined) {
      // A real pier (city-config.js): its long axis, seaward toward the end further out in the river, the frame's origin
      // at its landward end
      let dx = Math.cos(p.angle);
      let dz = Math.sin(p.angle);
      const out = (x, z) => (west ? shoreAt(z) - x : x - shoreAt(z));
      const h = p.length / 2;
      if (out(p.cx + dx * h, p.cz + dz * h) < out(p.cx - dx * h, p.cz - dz * h)) { dx = -dx; dz = -dz; }
      theta = Math.atan2(-dz, dx);
      x0 = p.cx - dx * h;
      z0 = p.cz - dz * h;
    }
    const F = frame(x0, z0, theta);
    const inWater = (u, s) => { const x = F.wx(u, s), sx = shoreAt(F.wz(u, s)); return west ? x < sx : x > sx; };
    let u0 = 0; // extend the deck inland until it meets the bulkhead across its whole width
    for (const s of [-p.width / 2, 0, p.width / 2]) {
      let u = 0;
      while (u > -40 && inWater(u, s)) u -= 0.5;
      u0 = Math.min(u0, u - 0.5);
    }
    return Object.assign(F, { L: p.length, hw: p.width / 2, u0, west });
  };

  // Steel pipe railing with posts every 3 m along both sides (+ optional seaward end)
  const railing = (F, u0, u1, s0, s1, y, end = true) => {
    for (const s of [s0 + 0.12, s1 - 0.12]) {
      F.box(PA, u0, u1, y + 1.04, y + 1.1, s - 0.05, s + 0.05, 9);
      F.box(PA, u0, u1, y + 0.52, y + 0.56, s - 0.02, s + 0.02, 9);
      for (let u = u0; u <= u1 + 0.01; u += 3) F.box(PA, u - 0.04, u + 0.04, y, y + 1.06, s - 0.04, s + 0.04, 9, true);
    }
    if (end) {
      const u = u1 - 0.12;
      F.box(PA, u - 0.05, u + 0.05, y + 1.04, y + 1.1, s0 + 0.12, s1 - 0.12, 9);
      F.box(PA, u - 0.02, u + 0.02, y + 0.52, y + 0.56, s0 + 0.12, s1 - 0.12, 9);
      for (let s = s0 + 3.1; s < s1 - 1; s += 3) F.box(PA, u - 0.04, u + 0.04, y, y + 1.06, s - 0.04, s + 0.04, 9, true);
    }
  };
  // Hudson River Park lantern posts (glass heads glow at night)
  const lamps = (F, u0, u1, s0, s1, y, spacing = 16) => {
    for (let u = u0; u <= u1; u += spacing) {
      for (const s of [s0, s1]) {
        F.box(PA, u - 0.08, u + 0.08, y, y + 4.7, s - 0.08, s + 0.08, 9, true);
        F.box(PA, u - 0.2, u + 0.2, y + 4.25, y + 4.85, s - 0.2, s + 0.2, 10);
        F.box(PA, u - 0.27, u + 0.27, y + 4.85, y + 4.97, s - 0.27, s + 0.27, 9);
      }
    }
  };
  // Pier deck on timber piles: concrete slab, shadowed under-deck, fender wales & piles, railings, lamps
  const deck = (F, u0, u1, s0, s1, o = {}) => {
    const y = o.y ?? DY;
    F.box(GR, u0, u1, y - 0.85, y, s0, s1, o.surface ?? 0);
    F.box(PA, u0 + 0.5, u1 - 0.5, -2.9, y - 0.85, s0 + 0.5, s1 - 0.5, 12);
    const ua = Math.max(u0, 2);
    F.box(PA, ua, u1, y - 1.3, y - 0.9, s0 - 0.32, s0 - 0.02, 8);
    F.box(PA, ua, u1, y - 1.3, y - 0.9, s1 + 0.02, s1 + 0.32, 8);
    if (o.endFender !== false) F.box(PA, u1 + 0.02, u1 + 0.32, y - 1.3, y - 0.9, s0, s1, 8);
    for (let u = ua + 1.5; u <= u1; u += 4) {
      for (const s of [s0 - 0.28, s1 + 0.28]) F.box(PA, u - 0.19, u + 0.19, -3.0, y - 0.15, s - 0.19, s + 0.19, 8, true);
    }
    if (o.endFender !== false) {
      for (let s = s0 + 1.2; s < s1 - 0.5; s += 4) F.box(PA, u1 + 0.09, u1 + 0.47, -3.0, y - 0.15, s - 0.19, s + 0.19, 8, true);
    }
    if (o.rail !== false) railing(F, Math.max(u0, 1.5), u1, s0, s1, y, o.railEnd !== false);
    if (o.lamps) lamps(F, Math.max(u0, 0) + 7, u1 - 3, s0 + 1.0, s1 - 1.0, y, o.lamps);
  };

  const kinds = {};
  kinds.generic = (F) => deck(F, F.u0, F.L, -F.hw, F.hw, { lamps: 16 });
  const ships = {}; // moored vessels, filled in below
  // See-through netting / fencing panel (golf range, sports cages; dithered in the sign material): spans u in [a, b] at
  // s = at (alongU) or s in [a, b] at u = at
  const netWall = (F, a, b, at, y0, h, alongU = true) => {
    const g = new THREE.PlaneGeometry(Math.abs(b - a), h);
    const uvA = g.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) + 2); // uv.x >= 2 marks netting in the sign material
    const mesh = new THREE.Mesh(g, M.sign);
    const u = alongU ? (a + b) / 2 : at, s = alongU ? at : (a + b) / 2;
    mesh.position.set(F.wx(u, s), y0 + h / 2, F.wz(u, s));
    mesh.rotation.y = F.theta + (alongU ? 0 : Math.PI / 2);
    group.add(mesh);
  };

  // Hudson River Park lawn piers (84, 45, 66, 26): paver promenade, curbed lawn panels with trees, benches, shade sails
  kinds.park = (F, p) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: 18, surface: 7 });
    const lw = hw - 3.4;
    const n = Math.max(2, Math.round((L - 22) / 22));
    const seg = (L - 22) / n;
    for (let i = 0; i < n; i++) {
      const a = 7 + i * seg + 1.2, b = 7 + (i + 1) * seg - 1.2;
      F.box(GR, a - 0.3, b + 0.3, DY, DY + 0.32, -lw - 0.3, lw + 0.3, 0);
      F.box(GR, a, b, DY, DY + 0.36, -lw, lw, 4);
      for (let u = a + 3; u < b - 2; u += 6.5 + rnd() * 3) {
        for (const s of [-lw + 1.7, lw - 1.7]) if (rnd() < 0.8) F.tree(u, s + (rnd() - 0.5), DY + 0.36, 2.0 + rnd() * 1.4);
      }
    }
    for (let u = 10; u < L - 16; u += 9) for (const s of [-hw + 2.1, hw - 2.1]) F.box(PA, u - 0.9, u + 0.9, DY, DY + 0.45, s - 0.3, s + 0.3, 7);
    const su = L - 9, sw = Math.min(7, hw - 2.2);
    for (const du of [-4, 4]) for (const s of [-sw, sw]) F.box(PA, su + du - 0.12, su + du + 0.12, DY, DY + 4.6, s - 0.12, s + 0.12, 9);
    F.strut(BL, [su - 5, DY + 4.3, 0], [su + 5, DY + 5.3, 0], 0.18, 6, sw * 2 + 1.6);
    if (p.lightship) ships.lightship?.(F.sub(L * 0.5, hw + 6.5, 0));
  };

  // Pier 25 (Tribeca): artificial-turf field in a fenced cage, beach volleyball, mini golf, schooner alongside
  kinds.fields = (F, p) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: 18, surface: 7 });
    const f1 = L * 0.56;
    F.box(GR, 6, f1, DY, DY + 0.08, -hw + 2, hw - 2, 5);
    for (const s of [-hw + 1.7, hw - 1.7]) netWall(F, 5.7, f1 + 0.3, s, DY, 4.5, true);
    for (const u of [5.7, f1 + 0.3]) netWall(F, -hw + 1.7, hw - 1.7, u, DY, 4.5, false);
    for (let u = 5.7; u <= f1 + 0.4; u += 4.6) for (const s of [-hw + 1.7, hw - 1.7]) F.box(PA, u - 0.06, u + 0.06, DY, DY + 4.6, s - 0.06, s + 0.06, 9);
    const v0 = f1 + 3, v1 = L * 0.77;
    F.box(GR, v0, v1, DY, DY + 0.1, -hw + 2, hw - 2, 2);
    for (const uc of [v0 + (v1 - v0) * 0.27, v0 + (v1 - v0) * 0.73]) {
      for (const s of [-hw + 3, hw - 3]) F.box(PA, uc - 0.05, uc + 0.05, DY, DY + 2.45, s - 0.05, s + 0.05, 9);
      F.box(PA, uc - 0.02, uc + 0.02, DY + 1.45, DY + 2.45, -hw + 3, hw - 3, 4);
    }
    F.box(GR, L * 0.8, L - 4, DY, DY + 0.3, -hw + 2.5, hw - 2.5, 4);
    for (let u = L * 0.8 + 3; u < L - 6; u += 5) F.tree(u, (rnd() - 0.5) * (hw - 4), DY + 0.3, 1.6 + rnd());
    ships.schooner?.(F.sub(L * 0.52, hw + 4.2, Math.PI));
  };

  // Manhattan Cruise Terminal piers 88/90/92: two-level passenger sheds with ribbon windows and rooftop parking
  kinds.cruise = (F, p) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: false });
    const H = 15.2, s0 = -hw + 1.6, s1 = hw - 1.6, u1 = L - 6;
    F.box(BL, 3, u1, DY, DY + H, s0, s1, 0);
    F.box(GR, 3.3, u1 - 0.3, DY + H, DY + H + 0.06, s0 + 0.3, s1 - 0.3, 1);
    for (const s of [s0 + 0.15, s1 - 0.15]) F.box(BL, 3, u1, DY + H, DY + H + 1.0, s - 0.15, s + 0.15, 6);
    F.box(BL, u1 - 0.3, u1, DY + H, DY + H + 1.0, s0, s1, 6);
    F.box(BL, 8, 15, DY + H, DY + H + 4.4, s0 + 0.4, s0 + 5, 6);
    F.box(BL, u1 - 16, u1 - 9, DY + H, DY + H + 4.4, s1 - 5, s1 - 0.4, 6);
    F.box(BL, Math.max(F.u0, -1), 3.5, DY, DY + H + 3.6, s0 + 2, s1 - 2, 7);
    for (const s of [-1, 1]) for (const u of [L * 0.32, L * 0.68]) F.box(BL, u - 4, u + 4, DY + 8.2, DY + 11.4, s * (hw - 1.6), s * (hw + 1.6), 6);
    if (p.cruiseShip) ships.cruise?.(F.sub(Math.max(L * 0.5, 54), hw + 9.5, 0));
  };

  // Big low industrial pier sheds (Pier 76, Basketball City at Pier 36) with clerestory bands
  kinds.shed = (F, p) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: false });
    const H = p.shedH || 9.0;
    F.box(BL, 2, L - 3, DY, DY + H, -hw + 1.2, hw - 1.2, p.white ? 6 : 2);
    F.box(BL, 2, L - 3, DY + H, DY + H + 0.5, -hw + 1.0, hw - 1.0, 9);
    if (p.roofParking) F.box(GR, 2.4, L - 3.4, DY + H + 0.5, DY + H + 0.56, -hw + 1.6, hw - 1.6, 1);
    else F.box(BL, 6, L - 8, DY + H + 0.5, DY + H + 2.4, -hw * 0.3, hw * 0.3, 2);
  };

  // Pier 99: DSNY marine transfer station (tall tipping hall, truck ramp, container barge alongside)
  kinds.sanitation = (F, p) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: false });
    const a = L * 0.32;
    F.box(BL, a, L - 3, DY, DY + 17.6, -hw + 1, hw - 1, 2);
    F.box(BL, a + 4, L - 12, DY + 17.6, DY + 20.6, -hw * 0.4, hw * 0.4, 2);
    F.strut(GR, [2, DY + 0.35, 0], [a, DY + 8.4, 0], 0.6, 8, 7.5);
    for (const s of [-3.9, 3.9]) F.strut(BL, [2, DY + 0.9, s], [a, DY + 8.9, s], 1.2, 10, 0.3);
    F.box(PA, a + 2, L - 4, -2.7, -0.9, hw + 1.2, hw + 10, 2);
    for (let u = a + 4; u < L - 8; u += 6.4) F.box(PA, u, u + 5.8, -0.9, 1.7, hw + 2.2, hw + 9, [5, 3, 0, 9][Math.floor(rnd() * 4)]);
  };
  // Chelsea Piers 59-61: long low sheds behind arched headhouse facades (cream with green trim); Pier 59 golf range nets
  kinds.chelsea = (F, p) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: false });
    const s0 = -hw + 1.3, s1 = hw - 1.3;
    const shedEnd = p.golf ? L * 0.36 : L - 4;
    F.box(BL, 0, 9, DY, DY + 18.5, -hw + 0.6, hw - 0.6, 1);
    F.box(BL, -0.4, 9.4, DY + 18.5, DY + 19.3, -hw + 0.2, hw - 0.2, 8);
    F.box(BL, 9, shedEnd, DY, DY + 13.8, s0, s1, 1);
    F.box(BL, 9, shedEnd, DY + 13.8, DY + 14.4, s0 - 0.3, s1 + 0.3, 8);
    F.box(BL, 11, shedEnd - 2, DY + 14.4, DY + 16.4, -hw * 0.42, hw * 0.42, 8);
    // Arched windows: landward headhouse face and the shed's seaward gable
    const arch = (u, r) => {
      F.geo(BL, new THREE.CylinderGeometry(r + 0.8, r + 0.8, 0.5, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), u, DY + 6.5, 0, 0, 8);
      F.geo(BL, new THREE.CylinderGeometry(r, r, 0.7, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), u, DY + 6.5, 0, 0, 7);
      F.box(BL, u - 0.35, u + 0.35, DY + 0.4, DY + 6.5, -r, r, 7);
    };
    arch(-0.2, Math.min(8, hw - 3));
    if (!p.golf) arch(shedEnd + 0.2, Math.min(7, hw - 3.5));
    if (p.sign) F.sign('CHELSEA PIERS', -0.8, DY + 16.8, 0, 1.7, -Math.PI / 2);
    if (p.golf) {
      const g0 = shedEnd, g1 = L - 2, H = 46;
      F.box(GR, g0, g1, DY, DY + 0.05, s0, s1, 6);
      for (let k = 1; k <= 3; k++) F.box(BL, g0 - 0.2, g0 + 3.2, DY + k * 4.6 - 0.35, DY + k * 4.6, s0, s1, 9);
      for (let u = g0 + 2; u <= g1 + 0.1; u += (g1 - g0 - 2) / 4) {
        for (const s of [s0, s1]) {
          F.box(PA, u - 0.3, u + 0.3, DY, DY + H, s - 0.3, s + 0.3, 9);
          F.box(PA, u - 0.5, u + 0.5, DY + H - 1.2, DY + H - 0.4, s - 0.5, s + 0.5, 10);
        }
      }
      for (const s of [s0, s1]) netWall(F, g0, g1, s, DY + 2, H - 3, true);
      netWall(F, s0, s1, g1, DY + 2, H - 3, false);
    }
  };

  // Pier 57: 1950s concrete pier building (taller headhouse, steel-sash windows) with its public rooftop park
  kinds.pier57 = (F) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: false });
    const s0 = -hw + 1, s1 = hw - 1, H = 15.6;
    F.box(BL, 0.5, 15, DY, DY + 26, s0, s1, 3);
    F.box(BL, 15, L - 4, DY, DY + H, s0, s1, 3);
    F.box(BL, 0.3, 15.2, DY + 26, DY + 26.6, s0 - 0.2, s1 + 0.2, 9);
    F.box(GR, 15.2, L - 4.2, DY + H, DY + H + 0.2, s0 + 0.3, s1 - 0.3, 7);
    F.box(GR, 19, L - 10, DY + H + 0.2, DY + H + 0.5, s0 + 3.5, s1 - 3.5, 4);
    for (let u = 21; u < L - 12; u += 6.5) for (const s of [s0 + 4.6, s1 - 4.6]) if (rnd() < 0.75) F.tree(u, s, DY + H + 0.5, 1.8 + rnd() * 0.9);
    railing(F, 15.3, L - 4.2, s0 + 0.3, s1 - 0.3, DY + H + 0.2, true);
    F.box(BL, L - 4, L - 1.2, DY + 5, DY + 5.4, s0, s1, 9);
  };

  // Pier 40: vast 3-storey square parking & sports building ringed around a courtyard field, more fields on the roof
  kinds.pier40 = (F) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: false });
    const u0 = 1.5, u1 = L - 2, s0 = -hw + 1.5, s1 = hw - 1.5, H = 13.8, R = 15;
    F.box(BL, u0, u1, DY, DY + H, s0, s0 + R, 4);
    F.box(BL, u0, u1, DY, DY + H, s1 - R, s1, 4);
    F.box(BL, u0, u0 + R, DY, DY + H, s0 + R, s1 - R, 4);
    F.box(BL, u1 - R, u1, DY, DY + H, s0 + R, s1 - R, 4);
    F.box(BL, u0 - 0.2, u1 + 0.2, DY + H, DY + H + 0.7, s0 - 0.2, s0 + 0.4, 10);
    F.box(BL, u0 - 0.2, u1 + 0.2, DY + H, DY + H + 0.7, s1 - 0.4, s1 + 0.2, 10);
    F.box(GR, u0 + R, u1 - R, DY, DY + 0.06, s0 + R, s1 - R, 5);
    F.box(GR, u0 + 1, u1 - 1, DY + H, DY + H + 0.08, s0 + 1, s0 + R - 1, 5);
    F.box(GR, u0 + 1, u1 - 1, DY + H, DY + H + 0.08, s1 - R + 1, s1 - 1, 5);
    for (const s of [s0 + 0.6, s0 + R - 0.6, s1 - R + 0.6, s1 - 0.6]) netWall(F, u0 + 0.6, u1 - 0.6, s, DY + H, 4.5, true);
    for (const u of [u0 + 0.8, (u0 + u1) / 2, u1 - 0.8]) {
      for (const s of [s0 + 0.5, s1 - 0.5]) {
        F.box(PA, u - 0.2, u + 0.2, DY + H, DY + H + 15, s - 0.2, s + 0.2, 9);
        F.box(PA, u - 0.8, u + 0.8, DY + H + 14.2, DY + H + 15.2, s - 0.5, s + 0.5, 10);
      }
    }
  };

  // Pier 34: twin narrow walkways out to the Holland Tunnel's brick river ventilation building
  kinds.vent = (F) => {
    const { L, hw } = F;
    const pl = L - 26;
    for (const s of [-hw + 1, hw - 6]) deck(F, F.u0, pl + 1, s, s + 5, { lamps: 18, railEnd: false, endFender: false });
    deck(F, pl, L, -hw, hw, { lamps: false });
    F.box(BL, pl + 3, L - 3, DY, DY + 24.1, -hw + 3, hw - 3, 5);
    F.box(BL, pl + 7, L - 7, DY + 24.1, DY + 30.1, -hw + 6, hw - 6, 5);
    F.box(BL, pl + 2.6, L - 2.6, DY + 24.1, DY + 24.8, -hw + 2.6, hw - 2.6, 10);
  };
  // ---- Moored vessels (S = ship frame: +u toward the bow, s across; starboard is +s when moored bow-out on the Hudson)
  const hullCache = new Map();
  const hull = (S, len, beam, depth, y0, v, bow = 0.28, stern = 0.06, dbl = false) => {
    const key = [len, beam, depth, bow, stern, dbl].join('|');
    if (!hullCache.has(key)) hullCache.set(key, pierHullGeometry(len, beam, depth, bow, stern, dbl));
    S.geo(PA, hullCache.get(key), 0, y0, 0, 0, v);
  };
  const flatShape = (pts, depth) => {
    const sh = new THREE.Shape();
    pts.forEach(([a, s], i) => (i === 0 ? sh.moveTo(a, -s) : sh.lineTo(a, -s)));
    return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2);
  };
  // Simple jet silhouette (fuselage, wings, fin, tailplane) parked on a deck
  const plane = (S, a, s, rot, y, sc, v = 13, folded = false) => {
    const P = S.sub(a, s, rot);
    P.box(PA, -4.6 * sc, 4.6 * sc, y + 0.5 * sc, y + 1.5 * sc, -0.55 * sc, 0.55 * sc, v);
    const span = (folded ? 2.4 : 4.6) * sc;
    P.box(PA, -1.4 * sc, 1.2 * sc, y + 0.8 * sc, y + 1.0 * sc, -span, span, v);
    P.box(PA, -4.4 * sc, -2.9 * sc, y + 1.5 * sc, y + 3.1 * sc, -0.08 * sc, 0.08 * sc, v);
    P.box(PA, -4.5 * sc, -3.4 * sc, y + 1.3 * sc, y + 1.45 * sc, -1.8 * sc, 1.8 * sc, v);
  };

  // USS Intrepid (Essex class): flared hull, hangar gallery, angled flight deck, starboard island, air wing, shuttle pavilion
  ships.carrier = (S) => {
    hull(S, 100, 16, 10.8, -3.2, 0, 0.22, 0.04);
    S.box(PA, -44, 40, 7.6, 10.2, -9, 9, 0);
    for (const s of [-9.05, 9.05]) for (const [a0, a1] of [[-34, -14], [2, 22]]) S.box(PA, a0, a1, 8.0, 9.8, s - 0.02, s + 0.02, 12);
    const deckPts = [[50, 6], [40, 9.5], [-46, 9.5], [-50, 8], [-50, -8], [-46, -10], [-20, -14.5], [10, -13], [28, -9.5], [40, -8], [50, -6]];
    S.geo(GR, flatShape(deckPts, 0.6), 0, 10.2, 0, 0, 8);
    S.box(PA, -46, 46, 10.8, 10.83, -0.18, 0.18, 4);
    S.sub(-9, -6.6, Math.atan2(7.6, 76)).box(PA, -40, 40, 10.8, 10.84, -0.2, 0.2, 4);
    // Island superstructure, bridge glazing, funnel and tripod mast with radar
    S.box(PA, 2, 18, 10.8, 16.4, 8.2, 11.6, 0);
    S.box(PA, 4, 14, 16.4, 20.2, 8.6, 11.2, 0);
    S.box(PA, 3.9, 14.1, 18.5, 19.6, 8.5, 11.3, 11);
    S.box(PA, 7, 12.5, 20.2, 24.2, 8.9, 11.0, 0);
    S.box(PA, 6.9, 12.6, 24.2, 24.8, 8.8, 11.1, 2);
    S.strut(PA, [5, 20.2, 9.9], [5, 33, 9.9], 0.4, 9);
    S.strut(PA, [3, 20.2, 9.0], [5, 29, 9.9], 0.25, 9);
    S.strut(PA, [3, 20.2, 10.8], [5, 29, 9.9], 0.25, 9);
    S.box(PA, 4.8, 5.2, 29.4, 29.7, 7.4, 12.4, 9);
    S.box(PA, 4.6, 5.4, 31.0, 32.6, 8.2, 11.6, 9);
    // Air wing on the flight deck (some with folded wings)
    [[-38, 3, 0.1, 1, false], [-30, -5, 0.35, 0.9, true], [-21, 4, -0.2, 1, false], [-12, -8, 0.8, 0.8, true],
      [24, -4, 0.5, 1.1, false], [35, 2, 0.05, 1, true], [-44, -3, 0.2, 0.9, false]]
      .forEach(([a, s, r, sc, f]) => plane(S, a, s, r, 10.8, sc, 13, f));
    plane(S, 30, -9.5, -0.4, 10.8, 1.15, 2, false); // A-12 Blackbird
    // Space Shuttle Pavilion: white pressurised tent over the aft flight deck
    S.geo(BL, new THREE.CylinderGeometry(6.4, 6.4, 20, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), -36, 10.8, 1.5, 0, 6);
  };

  // British Airways Concorde on the pier apron
  ships.concorde = (S) => {
    const y = DY + 2.4;
    S.box(PA, -11, 10, y, y + 1.3, -0.65, 0.65, 4);
    S.strut(PA, [10, y + 0.65, 0], [15, y + 0.3, 0], 0.7, 4);
    S.geo(PA, flatShape([[5, 0.7], [-11, 5.8], [-11, -5.8], [5, -0.7]], 0.22), 0, y + 0.2, 0, 0, 4);
    S.strut(PA, [-6.5, y + 1.3, 0], [-11, y + 5.4, 0], 2.2, 4, 0.2);
    for (const a of [-5, 6]) S.box(PA, a - 0.25, a + 0.25, DY, y, -0.25, 0.25, 9);
  };

  // USS Growler guided-missile submarine alongside the pier
  ships.submarine = (S) => {
    hull(S, 24, 3.2, 2.2, -2.6, 2, 0.35, 0.3, true);
    S.box(PA, 1, 5, -0.4, 2.6, -0.55, 0.55, 2);
    S.box(PA, 5, 10.5, -0.4, 0.8, -1.2, 1.2, 2);
  };

  // Red lightship (Frying Pan at Pier 66 / Ambrose at the Seaport)
  ships.lightship = (S) => {
    hull(S, 26, 6.5, 4.4, -2.8, 3, 0.3, 0.1);
    S.box(PA, -7, 4, 1.6, 3.5, -2.2, 2.2, 4);
    S.box(PA, -6.9, 3.9, 2.2, 3.0, -2.25, 2.25, 11);
    S.box(PA, -3.2, -1.8, 3.5, 6.4, -0.7, 0.7, 6);
    S.strut(PA, [0.8, 3.5, 0], [0.8, 13, 0], 0.45, 9);
    S.box(PA, 0.2, 1.4, 12.4, 13.6, -0.6, 0.6, 10);
    S.strut(PA, [8.5, 1.6, 0], [8.5, 9, 0], 0.3, 9);
  };

  // Cruise ship moored at the passenger terminal
  ships.cruise = (S) => {
    hull(S, 104, 15, 9.4, -3.2, 4, 0.22, 0.03);
    S.box(PA, -50, 36, -2.9, -1.9, -7.56, 7.56, 5);
    S.box(PA, -46, 38, 6.2, 18.2, -7.2, 7.2, 4);
    S.box(PA, -40, 30, 18.2, 24.2, -6.6, 6.6, 4);
    S.box(PA, -30, 20, 24.2, 27, -5.5, 5.5, 4);
    for (const y of [8.8, 11.8, 14.8]) S.box(PA, -45.8, 37.8, y, y + 1.3, -7.25, 7.25, 11);
    for (const y of [19.6, 22.4]) S.box(PA, -39.8, 29.8, y, y + 1.2, -6.65, 6.65, 11);
    for (let a = -38; a <= 26; a += 5) for (const s of [-7.75, 7.75]) S.box(PA, a - 1.9, a + 1.9, 6.4, 7.7, s - 0.55, s + 0.55, 1);
    S.box(PA, 30, 33, 18.2, 19.3, -8.6, 8.6, 4);
    S.box(PA, -30, -20, 27, 33, -2.8, 2.8, 5);
    S.box(PA, -30.2, -19.8, 33, 33.8, -3.0, 3.0, 2);
  };
  // Sailing ship: square-rigged (Wavertree) or schooner (Pier 25's Sherman Zwicker); masts = [[u, height], ...] bow first
  ships.tallShip = (S, len, beam, masts, yd, square) => {
    const hb = beam / 2;
    hull(S, len, beam, yd + 3, -3, 2, 0.26, 0.16);
    S.box(PA, -len * 0.44, len * 0.24, yd - 0.75, yd - 0.45, -hb - 0.02, hb + 0.02, 4);
    S.box(PA, -len * 0.42, len * 0.22, yd, yd + 0.06, -hb + 0.3, hb - 0.3, 7);
    S.box(PA, -len * 0.08, len * 0.06, yd, yd + 1.8, -hb * 0.45, hb * 0.45, 6);
    S.box(PA, -len * 0.5 + 1, -len * 0.36, yd, yd + 1.2, -hb + 0.5, hb - 0.5, 7);
    const sprit = [len * 0.68, yd + len * 0.07, 0];
    S.strut(PA, [len * 0.45, yd + 0.4, 0], sprit, 0.4, 6);
    masts.forEach(([a, h], i) => {
      S.strut(PA, [a, yd, 0], [a, yd + h * 0.62, 0], 0.55, 6);
      S.strut(PA, [a, yd + h * 0.6, 0], [a, yd + h, 0], 0.3, 2);
      if (square) {
        [[0.3, 1.0], [0.44, 0.88], [0.57, 0.76], [0.7, 0.62], [0.82, 0.5]].forEach(([f, w]) => {
          const yy = yd + h * f, half = beam * 0.95 * w;
          S.box(PA, a - 0.15, a + 0.15, yy, yy + 0.26, -half, half, 2);
        });
      } else {
        S.strut(PA, [a, yd + 1.6, 0], [a - len * 0.28, yd + 2.0, 0], 0.22, 7);
        S.strut(PA, [a, yd + h * 0.72, 0], [a - len * 0.26, yd + h * 0.64, 0], 0.18, 7);
      }
      for (const sd of [-1, 1]) for (const da of [-1.6, 0, 1.6]) S.strut(PA, [a, yd + h * 0.62, 0], [a + da, yd, sd * (hb - 0.1)], 0.05, 2);
      S.strut(PA, [a, yd + h * 0.95, 0], i === 0 ? sprit : [masts[i - 1][0], yd + masts[i - 1][1] * 0.62, 0], 0.05, 2);
    });
  };
  ships.schooner = (S) => ships.tallShip(S, 26, 5.6, [[4, 18], [-4.5, 21]], 1.6, false);

  // Staten Island Ferry: double-ended, Staten Island Ferry orange, glazed passenger decks, wheelhouse at each end
  ships.siFerry = (S) => {
    hull(S, 46, 13, 5.2, -2.8, 1, 0.2, 0, true);
    S.box(PA, -18, 18, 1.8, 2.4, -6.55, 6.55, 2);
    S.box(PA, -19, 19, 2.4, 5.6, -6, 6, 1);
    S.box(PA, -18.8, 18.8, 3.4, 4.8, -6.05, 6.05, 11);
    S.box(PA, -16, 16, 5.6, 8.6, -5.4, 5.4, 1);
    S.box(PA, -15.8, 15.8, 6.5, 7.9, -5.45, 5.45, 11);
    S.box(PA, -12, 12, 8.6, 9.1, -4.8, 4.8, 4);
    for (const e of [-1, 1]) {
      S.box(PA, e * 12.5 - 2, e * 12.5 + 2, 8.6, 11, -2.6, 2.6, 1);
      S.box(PA, e * 12.5 - 2.05, e * 12.5 + 2.05, 9.6, 10.6, -2.65, 2.65, 11);
      S.strut(PA, [e * 10, 9.1, 0], [e * 10, 15, 0], 0.25, 9);
    }
  };

  // Commuter / sightseeing ferry (NYC Ferry, NY Waterway, Circle Line): white hull, navy band, glazed cabins
  ships.ferry = (S, len, decks = 1) => {
    const hb = len * 0.15;
    hull(S, len, hb * 2, 3.4, -2.6, 4, 0.3, 0.05);
    S.box(PA, -len * 0.44, len * 0.18, -0.5, 0.15, -hb - 0.03, hb + 0.03, 5);
    let y = 0.8;
    for (let d = 0; d < decks; d++) {
      const a0 = -len * (0.4 - d * 0.06), a1 = len * (0.22 - d * 0.05), w = hb * (0.88 - d * 0.08);
      S.box(PA, a0, a1, y, y + 2.5, -w, w, 4);
      S.box(PA, a0 + 0.1, a1 - 0.1, y + 0.8, y + 2.0, -w - 0.04, w + 0.04, 11);
      y += 2.5;
    }
    S.box(PA, len * 0.02, len * 0.17, y, y + 1.8, -hb * 0.45, hb * 0.45, 4);
    S.box(PA, len * 0.015, len * 0.175, y + 0.6, y + 1.4, -hb * 0.47, hb * 0.47, 11);
  };

  // Marina yachts: sloops with masts and motor cruisers
  ships.boat = (S, len, sail) => {
    len = Math.round(len * 2) / 2;
    const hb = len * 0.17;
    hull(S, len, hb * 2, 1.5, -2.55, rnd() < 0.15 ? 5 : 4, 0.38, 0.05);
    S.box(PA, -len * 0.18, len * 0.16, -1.05, sail ? -0.45 : 0.1, -hb * 0.6, hb * 0.6, 4);
    S.box(PA, -len * 0.17, len * 0.15, sail ? -0.9 : -0.55, sail ? -0.6 : -0.15, -hb * 0.62, hb * 0.62, 11);
    if (sail) {
      S.box(PA, len * 0.08, len * 0.08 + 0.14, -1.05, len * 1.3 - 1.05, -0.07, 0.07, 4);
      S.box(PA, -len * 0.3, len * 0.08, -0.1, 0.05, -0.06, 0.06, 4);
    } else {
      S.box(PA, -len * 0.05, len * 0.1, 0.1, 0.9, -hb * 0.4, hb * 0.4, 4);
    }
  };

  // Pier 86: Intrepid Sea, Air & Space Museum (carrier alongside, Concorde and Growler, glass entry pavilion)
  kinds.intrepid = (F) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: 16 });
    F.box(BL, 1, 13, DY, DY + 6.3, -hw + 2.5, hw - 2.5, 7);
    ships.carrier(F.sub(L * 0.52, hw + 9.5, 0));
    ships.concorde(F.sub(L * 0.72, -hw * 0.3, 0.22));
    ships.submarine(F.sub(L * 0.3, -hw - 3.6, 0));
  };
  // 79th Street Boat Basin: floating timber docks with finger piers, gangways from the bulkhead, wave attenuator, yachts
  kinds.basin = (F) => {
    const { L } = F;
    const FY = -1.5; // floating dock deck, 0.7 m above the water
    for (const s0 of [-30, 0, 30]) {
      F.box(GR, 4, L, FY - 0.45, FY, s0 - 1.4, s0 + 1.4, 3);
      F.box(PA, 4.2, L - 0.2, FY - 0.9, FY - 0.45, s0 - 1.2, s0 + 1.2, 8);
      F.strut(GR, [-1, DY - 0.2, s0], [5, FY - 0.05, s0], 0.25, 3, 2.2);
      for (let u = 10; u < L - 2; u += 7) {
        F.box(PA, u - 0.2, u + 0.2, -3, FY + 1.4, s0 + 1.6, s0 + 2.0, 8);
        for (const sd of [-1, 1]) {
          F.box(GR, u - 0.6, u + 0.6, FY - 0.4, FY, s0 + sd * 1.4, s0 + sd * 10.5, 3);
          if (rnd() < 0.85) {
            const len = 6 + rnd() * 5;
            ships.boat(F.sub(u + 3.5, s0 + sd * (2.0 + len * 0.5), sd > 0 ? -Math.PI / 2 : Math.PI / 2), len, rnd() < 0.6);
          }
        }
      }
    }
    F.box(PA, L + 4, L + 6.5, -2.6, -1.5, -44, 44, 8);
    F.box(PA, L + 4.1, L + 6.4, -1.5, -1.3, -44, 44, 4);
  };

  // Little Island (Pier 55): undulating park on concrete 'tulip' pots, lifted toward the river corners, two gangways
  kinds.littleIsland = (F) => {
    const { L, hw } = F;
    const U0 = 9, cu = (U0 + L) / 2, ru = (L - U0) / 2;
    // a: -1 (shore) .. 1 (river); b: -1 .. 1 across (+1 = north on the Hudson); SW corner highest, east edge low
    const height = (a, b) => {
      const A = Math.pow((a + 1) / 2, 1.6);
      return 4 + A * (10 - 3.5 * b) + 2 * Math.max(0, -b) * (1 - A) + 0.8 * Math.sin(a * 5.1 + b * 2.3) * Math.cos(b * 3.7 - a);
    };
    const squircle = (x, z) => {
      const m = Math.max(Math.abs(x), Math.abs(z));
      const r = Math.pow(x ** 4 + z ** 4, 0.25) || 1;
      return [x * m / r, z * m / r];
    };
    const NX = 26, NZ = 20;
    const top = new THREE.PlaneGeometry(2, 2, NX, NZ).rotateX(-Math.PI / 2);
    const tp = top.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const [a, b] = squircle(tp.getX(i), tp.getZ(i));
      tp.setXYZ(i, cu + a * ru, height(a, b), b * hw);
    }
    top.computeVertexNormals();
    F.geo(GR, top, 0, 0, 0, 0, 4);
    // Concrete rim skirt around the edge (pot rims), wound to face outward
    const ring = [];
    for (let ix = 0; ix <= NX; ix++) ring.push(ix);
    for (let iz = 1; iz <= NZ; iz++) ring.push(iz * (NX + 1) + NX);
    for (let ix = NX - 1; ix >= 0; ix--) ring.push(NZ * (NX + 1) + ix);
    for (let iz = NZ - 1; iz >= 1; iz--) ring.push(iz * (NX + 1));
    const sk = [];
    for (let k = 0; k < ring.length; k++) {
      const i = ring[k], j = ring[(k + 1) % ring.length];
      const P = [tp.getX(i), tp.getY(i), tp.getZ(i)], Q = [tp.getX(j), tp.getY(j), tp.getZ(j)];
      const out = (P[0] + Q[0]) / 2 - cu, outS = (P[2] + Q[2]) / 2;
      const flip = (Q[2] - P[2]) * out - (Q[0] - P[0]) * outS < 0;
      const t0 = [P[0], P[1] + 0.25, P[2]], t1 = [Q[0], Q[1] + 0.25, Q[2]], b0 = [P[0], P[1] - 2.3, P[2]], b1 = [Q[0], Q[1] - 2.3, Q[2]];
      const quad = flip ? [t0, t1, b1, t0, b1, b0] : [t0, b1, t1, t0, b0, b1];
      quad.forEach((v) => sk.push(...v));
    }
    const skirt = new THREE.BufferGeometry();
    skirt.setAttribute('position', new THREE.Float32BufferAttribute(sk, 3));
    skirt.computeVertexNormals();
    F.geo(BL, skirt, 0, 0, 0, 0, 10);
    // Tulip pots on columns rising from the river; neighbouring rims meet to form the scalloped underside
    for (let u = U0 + 3; u < L - 2; u += 5.4) {
      for (let s = -hw + 3; s < hw - 2; s += 5.4) {
        const uj = u + (rnd() - 0.5) * 1.2, sj = s + (rnd() - 0.5) * 1.2;
        const a = (uj - cu) / ru, b = sj / hw;
        if (a ** 4 + b ** 4 > 0.92) continue;
        const ch = height(a, b) - 1.15;
        const prof = [[0.55, 0], [0.55, ch], [0.8, ch + 0.6], [1.6, ch + 1.6], [2.6, ch + 2.6], [3.15, ch + 3.3], [3.2, ch + 3.6], [0, ch + 3.6]];
        F.geo(BL, new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 8), uj, -2.6, sj, 0, 10);
      }
    }
    for (let k = 0; k < 26; k++) {
      const a = rnd() * 1.7 - 0.85, b = rnd() * 1.7 - 0.85;
      F.tree(cu + a * ru, b * hw, height(a, b) - 0.1, 1.6 + rnd() * 1.2);
    }
    // Gangways from the esplanade to the low east edge
    for (const s of [-hw + 8, hw - 8]) {
      const y1 = height(-0.95, s / hw) - 0.1;
      F.strut(GR, [F.u0, DY - 0.15, s], [U0 + 2, y1, s], 0.5, 3, 4.2);
      for (const e of [-2.1, 2.1]) F.strut(PA, [F.u0, DY + 1.0, s + e], [U0 + 2, y1 + 1.1, s + e], 0.08, 9);
    }
  };
  // Pier 17 (SHoP, 2018): glass-and-steel box over a garage-door ground floor, rooftop lawn and concert stage
  kinds.pier17 = (F) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: 14, surface: 7 });
    const s0 = -hw + 3.5, s1 = hw - 3.5, uA = 5, uM = Math.round(L * 0.56), uB = L - 7;
    const vols = [[uA, uM, 16.8, 0], [uM, uB, 12.6, 1.5]];
    for (const [a, b, h, i] of vols) {
      const top = DY + h + 0.9;
      F.box(BL, a, b, DY, DY + h, s0 + i, s1 - i, 7);
      F.box(BL, a - 0.3, b + 0.3, DY + h, top, s0 + i - 0.3, s1 - i + 0.3, 9);
      for (let u = a + 0.2; u < b; u += 8.4) for (const s of [s0 + i - 0.12, s1 - i + 0.12]) F.box(BL, u - 0.2, u + 0.2, DY, DY + h, s - 0.1, s + 0.1, 9);
      F.box(GR, a, b, top, top + 0.1, s0 + i, s1 - i, 3);
      railing(F, a, b, s0 + i, s1 - i, top + 0.1, i > 0);
    }
    // Rooftop: lawn bowl and stage with a white tensile canopy on the upper roof, planters on the lower roof
    const R1 = DY + 16.8 + 1.0, R2 = DY + 12.6 + 1.0;
    F.box(GR, uA + 3, uM - 18, R1, R1 + 0.15, s0 + 3, s1 - 3, 4);
    F.box(PA, uM - 15, uM - 3, R1, R1 + 1.2, -8, 8, 2);
    F.box(BL, uM - 16, uM - 1, R1 + 7.4, R1 + 7.9, -11, 11, 6);
    for (const u of [uM - 15.5, uM - 1.5]) for (const s of [-10.5, 10.5]) F.box(PA, u - 0.2, u + 0.2, R1, R1 + 7.4, s - 0.2, s + 0.2, 9);
    for (let u = uM + 4; u < uB - 2; u += 7) for (const s of [s0 + 3.5, s1 - 3.5]) {
      F.box(PA, u - 0.9, u + 0.9, R2, R2 + 0.6, s - 0.9, s + 0.9, 6);
      F.tree(u, s, R2 + 0.6, 1.3);
    }
    F.sign('PIER 17', uA - 0.06, DY + 14.2, 0, 2.6, -Math.PI / 2);
  };

  // Pier 16 (Seaport Museum): open timber deck, ticket kiosk, the Wavertree (bowsprit over South Street) and Ambrose lightship
  kinds.tallShip = (F) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: 16, surface: 3 });
    F.box(BL, 4, 10, DY, DY + 3.2, -3, 3, 6);
    F.box(PA, 3.6, 10.4, DY + 3.2, DY + 3.5, -3.4, 3.4, 5);
    ships.tallShip(F.sub(Math.min(L - 30, 40), hw + 6.4, Math.PI), 58, 9, [[16, 36], [1, 39], [-14, 32]], 3.6, true);
    ships.lightship(F.sub(L * 0.62, -hw - 4.4, 0));
  };

  // Pier 15 (SHoP, 2011): lower deck with glass pavilions under a raised lawn deck on steel frames, teak fascia, bleacher steps
  kinds.pier15 = (F) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { surface: 3 });
    const UY = DY + 6.2, ua = 4, ub = L - 20, sa = -hw + 1, sb = hw - 1;
    F.box(GR, ua, ub, UY - 1.0, UY, sa, sb, 4);
    F.box(PA, ua - 0.12, ua, UY - 1.1, UY + 0.04, sa - 0.12, sb + 0.12, 7);
    for (const [s, t] of [[sa - 0.12, sa], [sb, sb + 0.12]]) F.box(PA, ua, ub, UY - 1.1, UY + 0.04, s, t, 7);
    for (let u = ua + 1; u < ub; u += 6.5) for (const s of [sa + 1.2, 0, sb - 1.2]) F.box(PA, u - 0.18, u + 0.18, DY, UY - 1.0, s - 0.18, s + 0.18, 9);
    F.box(BL, 7, 25, DY, UY - 1.0, -hw + 3.5, hw - 3.5, 7);
    F.box(BL, ub - 13, ub - 3, DY, UY - 1.0, -4, 4, 7);
    const n = 6, dh = (UY - DY) / n;
    for (let i = 0; i < n; i++) F.box(PA, ub + i * 2.2, ub + (i + 1) * 2.2, DY, UY - i * dh, sa + 1, sb - 1, 7);
    railing(F, ua, ub, sa, sb, UY, false);
    lamps(F, ub + 16, L - 3, -hw + 1, hw - 1, DY, 10);
    for (let u = ua + 4; u < ub - 6; u += 9) F.tree(u, (u % 2 ? 1 : -1) * (hw - 3.5), UY, 1.5);
    ships.schooner(F.sub(L * 0.62, hw + 4.4, Math.PI));
  };
  // Ferry piers (Pier 11, Pier 79, E 34th St; Circle Line at Pier 83): terminal at the head, floating barges with gangways
  kinds.ferryPier = (F, p) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: 16 });
    if (p.circleLine) {
      F.box(BL, 2.4, 23.6, DY, DY + 4.2, -hw + 1.9, hw - 1.9, 7);
      F.box(BL, 2, 24, DY + 4.2, DY + 9.2, -hw + 1.5, hw - 1.5, 6);
      F.box(PA, 1.7, 24.3, DY + 9.2, DY + 9.7, -hw + 1.2, hw - 1.2, 5);
      F.sign('CIRCLE LINE', 1.94, DY + 6.7, 0, 2.3, -Math.PI / 2);
      ships.ferry(F.sub(L * 0.5, hw + 6.8, 0), 40, 3);
      ships.ferry(F.sub(L * 0.66, -hw - 6, Math.PI), 34, 2);
      return;
    }
    F.box(BL, 3, 21, DY, DY + 8.4, -hw + 2.5, hw - 2.5, 7);
    F.box(BL, 1.5, 22.5, DY + 8.4, DY + 9.0, -hw + 1, hw - 1, 6);
    for (const u of [1.9, 22.1]) for (const s of [-hw + 1.4, hw - 1.4]) F.box(PA, u - 0.15, u + 0.15, DY, DY + 8.4, s - 0.15, s + 0.15, 9);
    const FY = -1.2, len = p.ferryLen ?? 26;
    for (const sd of [-1, 1]) {
      const sb = sd * (hw + 4.5), a = L - 34, b = L - 4;
      F.box(PA, a, b, -2.8, FY, sb - 3.5, sb + 3.5, 9);
      F.box(GR, a, b, FY, FY + 0.1, sb - 3.5, sb + 3.5, 0);
      F.box(BL, a + 6, b - 8, FY + 0.1, FY + 3.2, sb - 2.2, sb + 2.2, 6);
      F.box(PA, a + 5.7, b - 7.7, FY + 3.2, FY + 3.5, sb - 2.5, sb + 2.5, 5);
      for (const u of [a + 4, b - 4]) F.strut(PA, [u, DY + 0.05, sd * (hw - 0.3)], [u, FY + 0.15, sd * (hw + 1.2)], 2.2, 9, 0.25);
      if (sd > 0 || p.ferries === 2) ships.ferry(F.sub((a + b) / 2, sb + sd * (3.9 + len * 0.15), sd > 0 ? 0 : Math.PI), len, p.ferryDecks ?? 1);
    }
  };

  // Pier 35 (EcoPark): folded 10 m 'green screen' of vine-covered steel trellis along one edge, lawn mounds, swings
  kinds.eco = (F) => {
    const { L, hw } = F;
    deck(F, F.u0, L, -hw, hw, { lamps: 16, surface: 7 });
    for (let u = 8, k = 0; u < L - 10; u += 6, k++) {
      const P = F.sub(u + 3, -hw + 2.6, k % 2 ? 0.22 : -0.22);
      P.box(BL, -3.1, 3.1, DY, DY + 10.5, -0.35, 0.35, 8);
      P.box(PA, -3.15, -2.95, DY, DY + 10.8, -0.45, 0.45, 9);
    }
    for (const [u, s, r] of [[14, 3, 4.5], [30, 4, 5.5], [46, 2.5, 4]]) {
      F.box(GR, u - r, u + r, DY, DY + 0.45, s - r * 0.7, s + r * 0.7, 4);
      F.tree(u, s, DY + 0.45, 1.8);
    }
    for (const u of [22, 38]) {
      for (const s of [hw - 5, hw - 1.5]) F.box(PA, u - 0.06, u + 0.06, DY, DY + 3.2, s - 0.06, s + 0.06, 9);
      F.box(PA, u - 0.06, u + 0.06, DY + 3.1, DY + 3.25, hw - 5, hw - 1.5, 9);
    }
  };

  // Whitehall Terminal (Staten Island Ferry): tall glass facade with the lettering toward the city, canopy, slips with racks
  kinds.whitehall = () => {
    const F = frame(35, 1463, Math.atan2(-0.987, 0.158)); // u points out into the harbor, +s points west
    deck(F, 0, 16, -33, 33, { rail: false });
    F.box(BL, -18, 14, DY, DY + 15.2, -32, 32, 0);
    F.box(PA, -18.3, 14.3, DY + 15.2, DY + 16.0, -32.3, 32.3, 9);
    F.box(BL, -20, -18, DY, DY + 21, -30, 30, 7);
    F.box(PA, -20.2, -17.8, DY + 21, DY + 21.6, -30.2, 30.2, 9);
    F.box(BL, -16, 8, DY + 16.0, DY + 19.0, -22, 22, 6);
    F.box(BL, -29, -20, DY + 14.4, DY + 15.0, -26, 26, 6);
    for (const s of [-24, 24]) F.box(PA, -28.2, -27.8, DY, DY + 14.4, s - 0.2, s + 0.2, 9);
    F.sign('STATEN ISLAND FERRY', -20.06, DY + 18.4, 0, 2.4, -Math.PI / 2);
    for (const sr of [-33, -11, 11, 33]) {
      F.box(PA, 14, 50, -3.0, DY + 1.5, sr - 0.6, sr + 0.6, 8);
      for (let u = 16; u <= 50; u += 4.5) F.box(PA, u - 0.3, u + 0.3, -3.0, DY + 2.6, sr - 0.3, sr + 0.3, 8);
      F.sub(50, sr, sr > 0 ? -0.35 : 0.35).box(PA, 0, 9, -3.0, DY + 1.2, -0.5, 0.5, 8);
    }
    for (const s of [-22, 0, 22]) {
      F.box(PA, 14, 18.5, DY + 4.6, DY + 7.8, s - 3.2, s + 3.2, 9);
      F.box(PA, 14.1, 18.4, DY + 6.0, DY + 7.0, s - 3.25, s + 3.25, 11);
    }
    ships.siFerry(F.sub(40, 0, 0));
    ships.siFerry(F.sub(41, 22, Math.PI));
  };
  // [pier kinds]

  for (const p of WATERFRONT_PIERS) (kinds[p.kind] || kinds.generic)(pierFrame(p), p);

  // Park trees: trunks and lumpy low-poly crowns (one of three summer greens) join the paint batch: no extra draw calls
  if (trees.length) {
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const cp = crownGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const k = 0.86 + 0.28 * Math.abs(Math.sin(cp.getX(i) * 5.1 + cp.getY(i) * 3.7 + cp.getZ(i) * 4.3));
      cp.setXYZ(i, cp.getX(i) * k, cp.getY(i) * k, cp.getZ(i) * k);
    }
    crownGeo.computeVertexNormals();
    for (const [x, y, z, r] of trees) {
      const th = r * (0.85 + rnd() * 0.35);
      B.box(PA, x, y + th * 0.5, z, 0.3, th, 0.3, 0, 8, true);
      const g = crownGeo.clone().scale(r, r * (0.8 + rnd() * 0.3), r);
      B.geo(PA, g, x, y + th + r * 0.6, z, rnd() * 6.28, 14 + Math.floor(rnd() * 3));
    }
  }
  B.build(group, new Set([BL, PA]));
}

function buildCityGrid(scene) {
  const group = new THREE.Group();
  group.name = 'ManhattanCityGrid';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  // Ground footprints that traffic and pedestrians must keep clear of (medians, plazas, monuments, parks)
  const footprints = [];
  const addFootprint = (x, z, w, d) => footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

  // =========================================================================
  // 1. NEW YORK HARBOR, HUDSON RIVER, EAST RIVER & HARLEM RIVER WATER PLANE
  // =========================================================================
  const waterMat = createWaterMaterial();
  const harborWaterGeo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
  harborWaterGeo.rotateX(-Math.PI / 2);
  const harborWaterMesh = new THREE.Mesh(harborWaterGeo, waterMat);
  harborWaterMesh.position.set(0, ISLAND_BOUNDS.waterLevel, -50);
  group.add(harborWaterMesh);

  // =========================================================================
  // 2. POLYGONAL MANHATTAN ISLAND SEAWALL BULKHEAD & ROADWAY ASPHALT DECK
  // =========================================================================
  const seawallMat = new THREE.MeshStandardNodeMaterial({
    color: 0x5c5a55,
    roughness: 0.82,
    metalness: 0.1
  });
  const esplanadeMat = new THREE.MeshStandardNodeMaterial({
    color: 0x76726a,
    roughness: 0.76,
    metalness: 0.08
  });

  // Slightly expanded perimeter polygon for the granite seawall & waterfront esplanade coping
  const seawallPolygon = MANHATTAN_COASTLINE.map((p) => ({
    x: p.x + (p.x < -100 ? -6 : (p.x > 100 ? 6 : 0)),
    z: p.z + (p.z > 1350 ? 6 : (p.z < -1550 ? -6 : 0))
  }));
  const seawallMesh = createExtrudedPolygonMesh(seawallPolygon, -2.35, 2.31, seawallMat, true, false);
  group.add(seawallMesh);

  // Unified Manhattan Roadway Asphalt Deck (Y = 0.0) following true Manhattan coastline
  const roadMat = createRoadSurfaceMaterial();
  const roadMesh = createFlatPolygonMesh(MANHATTAN_COASTLINE, 0.0, roadMat, true);
  group.add(roadMesh);

  // =========================================================================
  // 3. PARK LAWN MATERIALS (the harbor islands themselves are built in boroughs.js)
  // =========================================================================
  const cpLawnMat = createParkLawnMaterial(false);
  const cpMeadowMat = createParkLawnMaterial(true);

  // =========================================================================
  // 4. RAISED SIDEWALKS & GRANITE CURBSTONES: every real curb island of Manhattan (city-config.js BLOCKS, from the
  //    street centreline at its curb-to-curb widths). Rectangular islands are instanced slabs; the rest (Broadway's
  //    triangles & trapezoids, Lower Manhattan's irregular blocks, the malls down the middle of Park Ave & Broadway)
  //    are extruded from their outlines
  // =========================================================================
  const sidewalkMat = createSidewalkMaterial();
  const curbMat = createCurbMaterial();
  const medianHedgeMat = new THREE.MeshStandardNodeMaterial({ color: 0x366e3b, roughness: 0.82 });
  const blockSidewalks = []; // { cx, cz, w, d, block } axis-aligned slabs (irregular islands: their lot cover)
  const roadSidewalks = []; // the curbs road-network.js bounds the roads with (medians go in as footprints)
  const slabGeos = [];
  const curbGeos = [];
  const hedgeGeos = [];
  const SW_TOP = 0.22;
  for (const b of BLOCKS) {
    if (b.park > 0.6 && !b.median && b.parkName !== 'Bryant Park') continue; // parks build their own perimeter sidewalk (sections 7, 7B)
    if (b.rect) {
      const slab = { cx: (b.minX + b.maxX) * 0.5, cz: (b.minZ + b.maxZ) * 0.5, w: b.maxX - b.minX, d: b.maxZ - b.minZ, block: b };
      blockSidewalks.push(slab);
      if (b.median) addFootprint(slab.cx, slab.cz, slab.w, slab.d);
      else roadSidewalks.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    } else {
      // curb (granite) ring under a sidewalk slab inset by 0.25 m, like the instanced pair below
      const curb = createExtrudedPolygonMesh(b.poly, 0.0, 0.18, curbMat).geometry;
      curbGeos.push(curb);
      const inner = offsetPolygonInward(b.poly, 0.25);
      if (inner) slabGeos.push(createExtrudedPolygonMesh(inner, 0.03, SW_TOP - 0.03, sidewalkMat).geometry);
      // rect cover for the consumers that work on rectangles: the lot rects grown back out to the curb
      for (const [x0, x1, z0, z1] of b.rects) {
        const r = { minX: x0 - 4.4, maxX: x1 + 4.4, minZ: z0 - 4.4, maxZ: z1 + 4.4 };
        blockSidewalks.push({ cx: (r.minX + r.maxX) * 0.5, cz: (r.minZ + r.maxZ) * 0.5, w: r.maxX - r.minX, d: r.maxZ - r.minZ, block: b, cover: true });
        if (!b.median) roadSidewalks.push(r);
      }
      if (b.median) addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ);
    }
    // Planted malls down the middle of Park Ave, Broadway (Upper West Side), Allen St...: a clipped hedge on the slab
    if (b.median && Math.min(b.maxX - b.minX, b.maxZ - b.minZ) > 2.2) {
      const hedge = offsetPolygonInward(b.poly, 1.0);
      if (hedge) hedgeGeos.push(createExtrudedPolygonMesh(hedge, SW_TOP, 0.55, medianHedgeMat).geometry);
    }
  }
  const mergeInto = (geos, mat, cast = false) => {
    for (let i = 0; i < geos.length; i += 400) {
      const m = new THREE.Mesh(mergeGeometries(geos.slice(i, i + 400), false), mat);
      m.receiveShadow = true;
      m.castShadow = cast;
      group.add(m);
    }
  };
  mergeInto(curbGeos, curbMat, true);
  mergeInto(slabGeos, sidewalkMat);
  mergeInto(hedgeGeos, medianHedgeMat, true);

  const rectSlabs = blockSidewalks.filter((s) => !s.cover);
  const swInstanced = new THREE.InstancedMesh(unitBox, sidewalkMat, rectSlabs.length);
  const curbInstanced = new THREE.InstancedMesh(unitBox, curbMat, rectSlabs.length);
  swInstanced.receiveShadow = true;
  curbInstanced.receiveShadow = true;
  curbInstanced.castShadow = true;

  rectSlabs.forEach((blk, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(blk.cx, 0.125, blk.cz);
    dummy.scale.set(blk.w - 0.5, 0.19, blk.d - 0.5);
    dummy.updateMatrix();
    swInstanced.setMatrixAt(i, dummy.matrix);

    dummy.position.set(blk.cx, 0.095, blk.cz);
    dummy.scale.set(blk.w, 0.17, blk.d);
    dummy.updateMatrix();
    curbInstanced.setMatrixAt(i, dummy.matrix);
  });
  swInstanced.instanceMatrix.needsUpdate = true;
  curbInstanced.instanceMatrix.needsUpdate = true;
  group.add(swInstanced, curbInstanced);

  // 6. Times Square Pedestrian Plazas, Duffy Square TKTS Red Steps, Herald Square & Flatiron Plaza
  //    Curb-height light-grey granite paver plazas in Broadway's roadbed with granite benches & planters, plus the
  //    shared street-furniture instancing of the plazas & small parks (instanced at the end of section 7B)
  const {
    createParkPavingMaterial,
    createIronFenceMaterial,
    createParkLampGlobeMaterial,
    createTktsStepMaterial,
    createMarbleAshlarMaterial,
    createParkWallMaterial
  } = window.NYC;
  const pavingMat = createParkPavingMaterial();
  const graniteMat = new THREE.MeshStandardNodeMaterial({ color: 0x86837c, roughness: 0.8 }); // benches, planters, copings
  const benchMatrices = []; // NYC Parks "World's Fair" slatted benches
  const lampMatrices = []; // NYC Parks cast-iron lampposts with glass globes
  const parkTreeSites = []; // { x, y, z, scale, species } park & plaza trees planted by street-details.js (section 7)
  const PLAZA_Y = 0.24;
  const pavedRects = []; // plaza & park slab bounds, exported so street trees (street-details.js) stay off them

  function addPavedPlaza(pts, style, topY = PLAZA_Y) {
    group.add(createExtrudedPolygonMesh(pts, 0.0, topY - 0.04, curbMat, true, false));
    const top = createExtrudedPolygonMesh(offsetConvexPolygon(pts, -0.3), 0.0, topY, pavingMat, true, false);
    setPavingStyle(top.geometry, style);
    group.add(top);
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    pavedRects.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  }
  function addBox(mat, x, y, z, w, h, d, rotY = 0, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h * 0.5, z);
    m.rotation.y = rotY;
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  function addPlanter(x, z, w, d, baseY = PLAZA_Y) {
    addBox(graniteMat, x, baseY, z, w, 0.55, d);
    addBox(medianHedgeMat, x, baseY + 0.55, z, w - 0.35, 0.3, d - 0.35, 0, false);
  }
  function addPlanterTree(x, z, species = 1, scale = 0.85) {
    addPlanter(x, z, 2.4, 2.4);
    parkTreeSites.push({ x, y: PLAZA_Y + 0.55, z, scale, species });
  }
  function addBench(x, y, z, rotY) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    benchMatrices.push(dummy.matrix.clone());
  }
  function addLamp(x, y, z) {
    lampMatrices.push(new THREE.Matrix4().makeTranslation(x, y, z));
  }

  // Broadway's pedestrian plazas on the real street grid (city-config.js GEO.plazas: the Broadway roadbed between the
  // cross streets, which carry on across them): Times Square's bowtie where Broadway crosses 7th Ave (42nd-47th St)
  // and Herald Square where it crosses 6th Ave (33rd-35th St). Each strip is cut into the pieces between the cross
  // streets and either side of the avenue it crosses.
  const { streetZ, avenueX, ALL_AVENUES: AVES, ALL_STREETS: STS } = window.NYC;
  const PLAZA_DEFS = window.NYC.GEO.plazas;
  const streetHalf = (n) => {
    const st = STS.find((t) => t.number === n);
    return st ? st.width * 0.5 : 5;
  };
  // Pieces of a plaza strip (centre a -> b, width w) between streets n0..n1, cut around the avenue `aveId`
  function plazaPieces(def, n0, n1, aveId) {
    const [ax, az] = def.a;
    const [bx, bz] = def.b;
    const hw = def.w * 0.5;
    const xAt = (z) => ax + ((z - az) / (bz - az)) * (bx - ax);
    const ave = AVES.find((a) => a.id === aveId);
    const aveHalf = ave.width * 0.5 + 0.4;
    const pieces = [];
    for (let n = n0; n > n1; n--) {
      const zN = streetZ(n) + streetHalf(n) + 0.6; // south curb of the northern street
      const zS = streetZ(n - 1) - streetHalf(n - 1) - 0.6; // north curb of the southern street
      if (zS - zN < 4) continue;
      const strip = [
        { x: xAt(zN) - hw, z: zN }, { x: xAt(zN) + hw, z: zN }, { x: xAt(zS) + hw, z: zS }, { x: xAt(zS) - hw, z: zS }
      ];
      // either side of the avenue's roadway (x = ave.x +- aveHalf)
      const west = clipPolygonHalfPlane(strip, -1, 0, -(ave.x - aveHalf)); // keeps x <= ave.x - aveHalf
      const east = clipPolygonHalfPlane(strip, 1, 0, ave.x + aveHalf); // keeps x >= ave.x + aveHalf
      for (const piece of [west, east]) {
        if (piece.length >= 3 && Math.abs(polygonCentroidArea(piece)) > 25) pieces.push({ pts: piece, zN, zS, west: piece === west });
      }
    }
    return pieces;
  }
  const tsDef = PLAZA_DEFS.find((d) => d.name === 'Times Square');
  const hsDef = PLAZA_DEFS.find((d) => d.name === 'Herald Square');
  const tsPieces = tsDef ? plazaPieces(tsDef, 47, 42, '7') : [];
  const hsPieces = hsDef ? plazaPieces(hsDef, 35, 33, '6') : [];
  const footprintOf = (pts) => {
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    addFootprint((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  };
  for (const pc of [...tsPieces, ...hsPieces]) {
    addPavedPlaza(pc.pts, 1);
    footprintOf(pc.pts);
  }
  // Times Square: long, low granite benches of the 2017 plaza redesign in staggered rows along the bowtie, planters
  // closing each piece towards the cross streets
  const pieceBox = (pc) => {
    const xs = pc.pts.map((p) => p.x);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), cx: (Math.min(...xs) + Math.max(...xs)) / 2 };
  };
  const insidePiece = (pc, x, z, m = 1.5) => {
    const inner = offsetPolygonInward(pc.pts, m);
    return inner && pointInPolygonXZ(inner, x, z);
  };
  for (const pc of tsPieces) {
    const bx = pieceBox(pc);
    if (bx.maxX - bx.minX < 6) continue;
    for (let z = pc.zN + 6; z <= pc.zS - 6; z += 12) {
      for (const [dx, dz] of [[-0.22, 0], [0.22, -6]]) {
        const x = bx.cx + (bx.maxX - bx.minX) * dx;
        if (insidePiece(pc, x, z + dz, 2)) addBox(graniteMat, x, PLAZA_Y, z + dz, 1.25, 0.46, 8.0);
      }
    }
    for (const z of [pc.zN + 2.2, pc.zS - 2.2]) if (insidePiece(pc, bx.cx, z, 0.8)) addPlanter(bx.cx, z, Math.min(5.5, (bx.maxX - bx.minX) * 0.5), 1.6);
  }

  // Duffy Square TKTS booth (47th St & Broadway): 27 ruby-red glass bleacher steps rising ~5 m to the north, seats
  // facing south down Times Square toward One Times Square, the glazed ticket booth tucked under the top steps.
  // Duffy Square is the bowtie's northern piece west of 7th Ave (46th-47th St)
  const tktsStepMat = createTktsStepMaterial(PLAZA_Y, 0.18);
  const tktsGlassMat = new THREE.MeshStandardNodeMaterial({ color: 0x1b252c, roughness: 0.08, metalness: 0.75 });
  const steelMat = new THREE.MeshStandardNodeMaterial({ color: 0xa3a8ab, roughness: 0.3, metalness: 0.85 });
  const bronzeMat = new THREE.MeshStandardNodeMaterial({ color: 0x4a5a46, roughness: 0.45, metalness: 0.7 });
  const duffyPiece = tsPieces.filter((pc) => pc.west).sort((p, q) => p.zN - q.zN)[0];
  if (duffyPiece) {
    const duffy = { ...pieceBox(duffyPiece), minZ: duffyPiece.zN, maxZ: duffyPiece.zS };
    const tkRun0 = 27 * 0.66;
    const tkX = (duffy.minX + duffy.maxX) * 0.5;
    const tkW = 12.4;
    const tkFrontZ = duffy.minZ + tkRun0 + 4.1;
    const tkSteps = 27;
    const tkRiser = 0.18;
    const tkTread = 0.66;
    const tkRun = tkSteps * tkTread;
    const tkRise = tkSteps * tkRiser;
    for (let s = 0; s < tkSteps; s++) {
      addBox(tktsStepMat, tkX, PLAZA_Y, tkFrontZ - (s + 0.5) * tkTread, tkW, (s + 1) * tkRiser, tkTread);
    }
    // Glazed ticket booth face under the top of the bleachers (47th St side) & a steel canopy edge
    addBox(tktsGlassMat, tkX, PLAZA_Y, tkFrontZ - tkRun - 0.15, tkW - 0.4, tkRise - 0.25, 0.3);
    addBox(steelMat, tkX, PLAZA_Y + tkRise - 0.25, tkFrontZ - tkRun - 0.2, tkW + 0.2, 0.25, 0.5);
    // Sloped steel handrails up both sides and the centre of the steps
    const tkSlope = Math.atan2(tkRise, tkRun);
    const tkRailLen = Math.hypot(tkRise, tkRun);
    for (const rx of [-tkW * 0.5 + 0.12, 0, tkW * 0.5 - 0.12]) {
      const rail = addBox(steelMat, tkX + rx, 0, tkFrontZ - tkRun * 0.5, 0.07, 0.07, tkRailLen, 0, false);
      rail.rotation.x = tkSlope;
      rail.position.y = PLAZA_Y + tkRise * 0.5 + 1.0;
      for (let k = 0; k <= 4; k++) {
        const pz = tkFrontZ - 0.5 - k * ((tkRun - 1.0) / 4);
        const stepTop = PLAZA_Y + Math.ceil((tkFrontZ - pz) / tkTread) * tkRiser;
        addBox(steelMat, tkX + rx, stepTop, pz, 0.06, PLAZA_Y + tkRise * ((tkFrontZ - pz) / tkRun) + 1.0 - stepTop, 0.06, 0, false);
      }
    }
    // Father Duffy statue: bronze chaplain before a granite Celtic cross at the south end of the square
    addBox(graniteMat, tkX, PLAZA_Y, tkFrontZ + 4.4, 1.2, 1.35, 1.2);
    const duffyFigure = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 1.85, 8), bronzeMat);
    duffyFigure.position.set(tkX, PLAZA_Y + 1.35 + 0.925, tkFrontZ + 4.6);
    duffyFigure.castShadow = true;
    group.add(duffyFigure);
    addBox(graniteMat, tkX, PLAZA_Y + 1.35, tkFrontZ + 3.95, 0.36, 3.9, 0.3);
    addBox(graniteMat, tkX, PLAZA_Y + 4.1, tkFrontZ + 3.95, 1.45, 0.34, 0.3);
    addLamp(duffy.minX + 1.2, PLAZA_Y, tkFrontZ + 2.6);
    addLamp(duffy.maxX - 1.2, PLAZA_Y, tkFrontZ + 2.6);
  }

  // Herald Square (34th-35th St) & Greeley Square: planted honey locusts in granite planters, benches & lampposts on the
  // larger pieces
  for (const pc of hsPieces) {
    const bx = pieceBox(pc);
    if (bx.maxX - bx.minX < 7 || pc.zS - pc.zN < 20) continue;
    for (let z = pc.zN + 8; z <= pc.zS - 8; z += 16) {
      if (!insidePiece(pc, bx.cx, z, 3)) continue;
      addPlanterTree(bx.cx, z, 1, 0.9);
      addBench(bx.cx - 4.6, PLAZA_Y, z + 5.5, Math.PI * 0.5);
      addBench(bx.cx + 4.6, PLAZA_Y, z + 5.5, -Math.PI * 0.5);
    }
    addLamp(bx.cx - 5.5, PLAZA_Y, pc.zN + 3);
    addLamp(bx.cx + 5.5, PLAZA_Y, pc.zS - 3);
  }

  // =========================================================================
  // 7. CENTRAL PARK (59th to 110th St, 5th Ave to Central Park West) from its real features (city-config.js GEO:
  //    the NYC Parks outline, OpenStreetMap's meadows, water bodies, loop drives & landmarks, the transverses from the
  //    street centreline)
  // =========================================================================
  const cpWallMat = new THREE.MeshStandardNodeMaterial({
    color: 0x6e6a63,
    roughness: 0.78
  });
  const cpPathMat = new THREE.MeshStandardNodeMaterial({
    color: 0xb8afa0,
    roughness: 0.74
  });
  const cpDriveMat = new THREE.MeshStandardNodeMaterial({
    color: 0x2f333a,
    roughness: 0.68
  });
  const schistRockMat = new THREE.MeshStandardNodeMaterial({
    color: 0x4c4e52,
    roughness: 0.86,
    metalness: 0.12
  });
  const marbleArchMat = new THREE.MeshStandardNodeMaterial({
    color: 0xd2cbbd,
    roughness: 0.62
  });

  const CPG = window.NYC.GEO.centralPark;
  const flatPts = (flat) => {
    const o = [];
    for (let i = 0; i < flat.length; i += 2) o.push({ x: flat[i], z: flat[i + 1] });
    return o;
  };
  const cp = CENTRAL_PARK_BOUNDS;
  const cpSite = (name) => CPG.sites.find((t) => t.name === name);

  // Perimeter sidewalk: the park's curb island (BLOCKS), with the schist wall along the real park line inside it
  const cpBlock = BLOCKS.filter((b) => b.parkName === 'Central Park').sort((a, b) => b.area - a.area)[0];
  if (cpBlock) {
    group.add(createExtrudedPolygonMesh(cpBlock.poly, 0.0, 0.18, curbMat, true, true));
    const sw = offsetPolygonInward(cpBlock.poly, 0.25);
    if (sw) group.add(createExtrudedPolygonMesh(sw, 0.03, 0.19, sidewalkMat));
    addFootprint((cpBlock.minX + cpBlock.maxX) * 0.5, (cpBlock.minZ + cpBlock.maxZ) * 0.5, cpBlock.maxX - cpBlock.minX, cpBlock.maxZ - cpBlock.minZ);
  }
  // Low coursed-schist perimeter wall (~0.8 m above the sidewalk) with the lawn a little inside it
  const cpWall = flatPts(CPG.outline);
  group.add(createExtrudedPolygonMesh(cpWall, 0.0, 1.05, createParkWallMaterial(), true, false));
  const cpLawnPts = offsetPolygonInward(cpWall, 0.6) || cpWall;
  group.add(createExtrudedPolygonMesh(cpLawnPts, 0.85, 0.34, cpLawnMat, true, false));

  // Sunlit open meadows & lawns: Sheep Meadow, the Great Lawn, North Meadow, the Great Hill, Cedar & Pilgrim Hills...
  const cpLawnPolys = CPG.lawns.map((l) => flatPts(l.ring));
  for (const pts of cpLawnPolys) group.add(createFlatPolygonMesh(pts, 1.21, cpMeadowMat, true));

  // Water: the Lake, the Jacqueline Kennedy Onassis Reservoir (raised in its stone basin, ringed by the running
  // track), Harlem Meer, the Pond, Turtle Pond, the Pool & Conservatory Water
  const cpWaterPolys = [];
  for (const w of CPG.water) {
    const pts = flatPts(w.ring);
    cpWaterPolys.push(pts);
    if (w.name === 'Jacqueline Kennedy Onassis Reservoir') {
      const track = offsetPolygon(pts, -6);
      if (track) group.add(createExtrudedPolygonMesh(track, 1.18, 0.38, cpPathMat, true, false));
      group.add(createFlatPolygonMesh(pts, 1.58, waterMat, true));
    } else {
      group.add(createFlatPolygonMesh(pts, 1.24, waterMat, true));
    }
  }

  // The loop drives (East, West, Center & Terrace Drives, car-free) and the four transverse roads crossing the park
  const cpDrives = [];
  const cpTransverses = [];
  function buildParkDriveRibbon(waypoints, width, y) {
    for (let i = 0; i < waypoints.length - 1; i++) {
      const [x1, z1] = waypoints[i];
      const [x2, z2] = waypoints[i + 1];
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz) + Math.min(2.5, width * 0.3);
      if (len < 0.5) continue;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, len), cpDriveMat);
      seg.position.set((x1 + x2) * 0.5, y, (z1 + z2) * 0.5);
      seg.rotation.y = Math.atan2(dx, dz);
      seg.receiveShadow = true;
      group.add(seg);
    }
  }
  for (const d of CPG.drives) {
    const wp = [];
    for (let i = 0; i < d.pts.length; i += 2) wp.push([d.pts[i], d.pts[i + 1]]);
    if (wp.length < 2) continue;
    if (d.transverse) {
      cpTransverses.push(wp);
      buildParkDriveRibbon(wp, Math.max(9, d.w || 10), 1.215);
    } else {
      cpDrives.push(wp);
      buildParkDriveRibbon(wp, d.w || 8.5, 1.20);
    }
  }

  // Stone arch bridges: Gapstow Bridge over the Pond, Bow Bridge across the Lake (spanning their real headings)
  const gapstow = cpSite('Gapstow Bridge');
  if (gapstow) addStoneArchBridge(group, gapstow.x, gapstow.z, -gapstow.ang, 24.0, 5.2, 2.25, cpWallMat, cpPathMat);
  const bow = cpSite('Bow Bridge');
  if (bow) addStoneArchBridge(group, bow.x, bow.z, -bow.ang, 30.0, 4.8, 2.1, marbleArchMat, cpPathMat);

  // The Mall / Literary Walk (66th to 72nd St) up to Bethesda Terrace & the Angel of the Waters fountain: hex asphalt
  // pavers (the park paving's style 0) under the elm allée, not the pale gravel of the walks, which read as a white strip
  const beth = cpSite('Bethesda Fountain') || { x: -380, z: -2434 };
  const MALL_LEN = 390;
  const mallX = beth.x + 6;
  const mallZ0 = beth.z + 46; // Bethesda Terrace's south (upper) terrace
  const mallGeo = new THREE.BoxGeometry(18, 0.16, MALL_LEN);
  setPavingStyle(mallGeo, 0);
  const mallPromenade = new THREE.Mesh(mallGeo, pavingMat);
  mallPromenade.position.set(mallX, 1.18, mallZ0 + MALL_LEN * 0.5);
  mallPromenade.receiveShadow = true;
  group.add(mallPromenade);
  const bethesdaTerrace = new THREE.Mesh(new THREE.BoxGeometry(48, 2.2, 16), marbleArchMat);
  bethesdaTerrace.position.set(beth.x + 4, 1.8, beth.z + 20);
  group.add(bethesdaTerrace);
  const bethesdaBasin = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 10.2, 1.1, 20), marbleArchMat);
  bethesdaBasin.position.set(beth.x, 1.5, beth.z);
  group.add(bethesdaBasin);
  const bethesdaStatue = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.6, 5.2, 10),
    new THREE.MeshStandardNodeMaterial({ color: 0x5c7a68, metalness: 0.65, roughness: 0.35 })
  );
  bethesdaStatue.position.set(beth.x, 3.8, beth.z);
  group.add(bethesdaStatue);

  // Manhattan Schist glacial outcrops: Umpire Rock (by the Heckscher ballfields), Rat Rock (Billy Johnson Playground),
  // Vista Rock under Belvedere Castle, a couple near the Pond & the Lake
  const belv = cpSite('Belvedere Castle') || { x: -506, z: -3000 };
  const rockGeo = buildManhattanSchistGeometry();
  const rockCoords = [
    { x: -585, z: -1745, sx: 2.1, sy: 0.78, sz: 1.65 }, // Umpire Rock
    { x: -430, z: -1690, sx: 1.7, sy: 0.65, sz: 1.40 }, // Rat Rock
    { x: belv.x - 2, z: belv.z + 6, sx: 2.3, sy: 1.25, sz: 1.85 }, // Vista Rock (under Belvedere Castle)
    { x: -150, z: -1700, sx: 1.5, sy: 0.62, sz: 1.30 },
    { x: -690, z: -2700, sx: 1.8, sy: 0.72, sz: 1.50 }
  ];
  for (const rc of rockCoords) {
    const rock = new THREE.Mesh(rockGeo, schistRockMat);
    rock.position.set(rc.x, 1.05, rc.z);
    rock.scale.set(rc.sx, rc.sy, rc.sz);
    rock.rotation.y = rc.x * 0.12;
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);

    // Flanking lower glacial schist bedrock shelf
    const shelf = new THREE.Mesh(rockGeo, schistRockMat);
    shelf.position.set(rc.x + 5.2, 0.92, rc.z + 3.4);
    shelf.scale.set(rc.sx * 0.72, rc.sy * 0.52, rc.sz * 0.68);
    shelf.rotation.y = rc.x * 0.12 + 1.1;
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    group.add(shelf);
  }

  // Belvedere Castle overlooking Vista Rock & Turtle Pond (79th St)
  const castleKeep = new THREE.Mesh(new THREE.BoxGeometry(12, 11, 10), cpWallMat);
  castleKeep.position.set(belv.x, 10.5, belv.z);
  group.add(castleKeep);
  const castleTurret = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 16, 12), cpWallMat);
  castleTurret.position.set(belv.x + 6, 13.0, belv.z + 3);
  group.add(castleTurret);

  // Areas the Central Park woodland (street-details.js section 7) must keep clear: meadows, water, the loop
  // drives, the transverses, the Mall elm allée, Bethesda Terrace, Belvedere Castle & the schist outcrops
  const gap = cpSite('Pulitzer Fountain') || { x: -32, z: -1327 };
  window.NYC.centralParkClearings = {
    polygons: [...cpLawnPolys, ...cpWaterPolys],
    drives: [...cpDrives, ...cpTransverses],
    transverseZ: [],
    rects: [
      { minX: mallX - 19, maxX: mallX + 19, minZ: mallZ0, maxZ: mallZ0 + MALL_LEN }, // The Mall & Literary Walk
      { minX: beth.x - 24, maxX: beth.x + 28, minZ: beth.z - 12, maxZ: beth.z + 30 }, // Bethesda Terrace & fountain
      { minX: belv.x - 10, maxX: belv.x + 12, minZ: belv.z - 8, maxZ: belv.z + 10 } // Belvedere Castle
    ],
    circles: rockCoords.map((rc) => ({ x: rc.x + 2, z: rc.z + 1.5, r: 5.6 * Math.max(rc.sx, rc.sz) + 3 })),
    mall: { x: mallX, z0: mallZ0, z1: mallZ0 + MALL_LEN }
  };

  // 6. Grand Army Plaza (5th Ave & 59th St: the Pulitzer Fountain, Sherman's gilded statue) & Columbus Circle
  const gapPlaza = new THREE.Mesh(new THREE.CylinderGeometry(16, 17, 0.45, 24), marbleArchMat);
  gapPlaza.position.set(gap.x, 0.25, gap.z);
  group.add(gapPlaza);
  addFootprint(gap.x, gap.z, 34, 34);
  const shermanGold = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 4.2, 4.4),
    new THREE.MeshStandardNodeMaterial({ color: 0xffc938, metalness: 0.78, roughness: 0.22 })
  );
  shermanGold.position.set(gap.x, 2.6, gap.z - 28);
  group.add(shermanGold);

  const colC = cpSite('Columbus Circle') || { x: -860, z: -1375 };
  const columbusCircle = new THREE.Mesh(new THREE.CylinderGeometry(15, 16, 0.5, 24), marbleArchMat);
  columbusCircle.position.set(colC.x, 0.25, colC.z);
  group.add(columbusCircle);
  addFootprint(colC.x, colC.z, 32, 32);
  const columbusColumn = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 18, 12), marbleArchMat);
  columbusColumn.position.set(colC.x, 9.5, colC.z);
  group.add(columbusColumn);

  // 7B. Madison Square Park, Union Square Park, Washington Square Park, Tompkins Square Park & Battery Park
  //     Flush with the sidewalks: hex-paver walks, granite-coped lawn beds with low hoop fences between radial &
  //     diagonal paths, a cast-iron perimeter fence on a granite coping, benches, lampposts & a dense plane canopy
  const PARK_Y = 0.26; // hex-paver walks (sidewalk tops are at 0.22)
  const BED_Y = 0.41; // lawn top inside the granite bed copings
  const parkLawnGeos = [];
  const parkFenceGeos = [];
  const inPolygon = (x, z, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  const prand = (x, z, k = 0) => {
    const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
    return s - Math.floor(s);
  };
  const polygonArea = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * q.z - q.x * p.z;
    }
    return a * 0.5;
  };

  // Scatters trees on a jittered grid inside polygon `pts` (kept `margin` m from its edges)
  function scatterParkTrees(pts, spacing, y, margin, speciesMix) {
    const inner = offsetConvexPolygon(pts, -margin);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of inner) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    for (let gx = x0; gx <= x1; gx += spacing) {
      for (let gz = z0; gz <= z1; gz += spacing) {
        const tx = gx + (prand(gx, gz) - 0.5) * spacing * 0.7;
        const tz = gz + (prand(gz, gx, 1) - 0.5) * spacing * 0.7;
        if (!inPolygon(tx, tz, inner)) continue;
        const r = prand(tx, tz, 2);
        const species = r < speciesMix[0] ? 0 : (r < speciesMix[0] + speciesMix[1] ? 1 : 2);
        parkTreeSites.push({ x: tx, y, z: tz, scale: 0.95 + prand(tx, tz, 3) * 0.35, species });
      }
    }
  }

  // Benches (backs to the bed coping, facing the walk) & lampposts along the edges of a lawn bed
  function lineBedEdges(bed, benchStep = 7.0) {
    const s = polygonArea(bed) > 0 ? 1 : -1;
    for (let i = 0; i < bed.length; i++) {
      const a = bed[i];
      const b = bed[(i + 1) % bed.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 6) continue;
      const nx = (s * (b.z - a.z)) / len;
      const nz = (-s * (b.x - a.x)) / len;
      const count = Math.floor((len - 3) / benchStep);
      for (let k = 0; k < count; k++) {
        const t = (1.5 + benchStep * (k + 0.5) + (len - 3 - count * benchStep) * 0.5) / len;
        const px = a.x + (b.x - a.x) * t;
        const pz = a.z + (b.z - a.z) * t;
        if (k % 3 === 1) addLamp(px + nx * 0.55, PARK_Y, pz + nz * 0.55);
        else addBench(px + nx * 0.62, PARK_Y, pz + nz * 0.62, Math.atan2(nx, nz));
      }
    }
  }

  // Lawn beds of one park cell: the sectors between path rays radiating from the hub, minus walks & hub plaza. A cell
  // is a rect (minX..maxZ) or a convex polygon `poly` (rays default to its corners, the hub to its centroid)
  function buildParkCell(cell, speciesMix) {
    const { minX, maxX, minZ, maxZ } = cell;
    const corners = cell.poly ?? rectPolygon(minX, maxX, minZ, maxZ);
    const c0 = cell.poly ? polygonCentroid(cell.poly) : { x: (minX + maxX) * 0.5, z: (minZ + maxZ) * 0.5 };
    const hx = cell.hubX ?? c0.x;
    const hz = cell.hubZ ?? c0.z;
    const halfPath = (cell.pathW ?? 3.0) * 0.5;
    const hubR = cell.hubR ?? 4.0;
    const rays = (cell.rays ?? corners.map((p) => Math.atan2(p.z - hz, p.x - hx)))
      .concat(cell.extraRays ?? []).sort((a, b) => a - b);
    cell.rayList = rays;
    for (let i = 0; i < rays.length; i++) {
      const a1 = rays[i];
      const a2 = i + 1 < rays.length ? rays[i + 1] : rays[0] + Math.PI * 2;
      let poly = corners.map((p) => ({ x: p.x - hx, z: p.z - hz }));
      poly = clipPolygonHalfPlane(poly, -Math.sin(a1), Math.cos(a1), halfPath);
      poly = clipPolygonHalfPlane(poly, Math.sin(a2), -Math.cos(a2), halfPath);
      for (const f of [0.25, 0.5, 0.75]) {
        const am = a1 + (a2 - a1) * f;
        poly = clipPolygonHalfPlane(poly, Math.cos(am), Math.sin(am), hubR + halfPath + 0.6);
      }
      if (poly.length < 3 || Math.abs(polygonArea(poly)) < 30) continue;
      const bed = poly.map((p) => ({ x: p.x + hx, z: p.z + hz }));
      group.add(createExtrudedPolygonMesh(bed, 0.2, BED_Y - 0.21, graniteMat, true, false));
      parkLawnGeos.push(createExtrudedPolygonMesh(offsetConvexPolygon(bed, -0.3), 0.3, BED_Y - 0.3, cpLawnMat).geometry);
      const hoop = offsetConvexPolygon(bed, -0.18);
      parkFenceGeos.push(buildFenceStripGeometry(hoop.map((p, k) => {
        const q = hoop[(k + 1) % hoop.length];
        return [p.x, p.z, q.x, q.z];
      }), BED_Y - 0.01, 0.5));
      lineBedEdges(bed);
      scatterParkTrees(bed, cell.treeSpacing ?? 9.0, BED_Y, 2.0, speciesMix);
    }
    // Paved hub plaza (bluestone) with an optional granite-rimmed fountain basin
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR + 0.6, hubR + 0.6, 0.03, 40), pavingMat);
    setPavingStyle(hub.geometry, 2);
    hub.position.set(hx, PARK_Y + 0.005, hz);
    hub.receiveShadow = true;
    group.add(hub);
    if (cell.fountain) {
      const f = cell.fountain;
      const basin = [[f + 0.18, 0], [f, 0.5], [f - 0.4, 0.5], [f - 0.4, 0.26]].map(([r, y]) => new THREE.Vector2(r, y));
      const rim = new THREE.Mesh(new THREE.LatheGeometry(basin, 40), graniteMat);
      rim.position.set(hx, PARK_Y, hz);
      rim.receiveShadow = true;
      group.add(rim);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(f - 0.39, 40).rotateX(-Math.PI / 2), waterMat);
      pool.position.set(hx, PARK_Y + 0.3, hz);
      group.add(pool);
      if (f > 6) {
        addBox(graniteMat, hx, PARK_Y + 0.28, hz, 1.6, 0.5, 1.6, Math.PI / 4);
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.6, 0.35, 24), graniteMat);
        bowl.position.set(hx, PARK_Y + 0.95, hz);
        group.add(bowl);
      }
    }
    return { hx, hz, rays };
  }

  // Perimeter of a small park: hex-paver slab flush with the sidewalks, granite coping & iron fence set back from
  // the curb (gates where the walks come out), and a row of big London planes & lampposts along the outer sidewalk.
  // pk.clipToShore: the slab, fence and tree row keep to the island's asphalt deck where the shore cuts a corner off
  function buildSmallPark(pk) {
    const minX = pk.x - pk.w * 0.5;
    const maxX = pk.x + pk.w * 0.5;
    const minZ = pk.z - pk.d * 0.5;
    const maxZ = pk.z + pk.d * 0.5;
    const slab = pk.clipToShore ? clipPolygonToConvex(MANHATTAN_COASTLINE, rectPolygon(minX, maxX, minZ, maxZ)) : rectPolygon(minX, maxX, minZ, maxZ);
    addPavedPlaza(slab, 0, PARK_Y);
    addFootprint(pk.x, pk.z, pk.w, pk.d);
    const fi = 2.6; // outer sidewalk width
    const fMinX = minX + fi;
    const fMaxX = maxX - fi;
    const fMinZ = minZ + fi;
    const fMaxZ = maxZ - fi;
    const inset = fi + 3.0;
    const gates = [...(pk.gates ?? [])];
    for (const c of pk.cells) {
      const cell = { minX: minX + inset, maxX: maxX - inset, minZ: minZ + inset, maxZ: maxZ - inset - (pk.southPlaza ?? 0), ...c };
      const { hx, hz, rays } = buildParkCell(cell, pk.speciesMix);
      for (const a of rays) {
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const tx = dx > 1e-6 ? (fMaxX - hx) / dx : (dx < -1e-6 ? (fMinX - hx) / dx : Infinity);
        const tz = dz > 1e-6 ? (fMaxZ - hz) / dz : (dz < -1e-6 ? (fMinZ - hz) / dz : Infinity);
        const t = Math.min(tx, tz);
        gates.push({ x: hx + dx * t, z: hz + dz * t });
      }
    }
    const fenceSegs = polygonFenceSegments(pk.clipToShore ? offsetConvexPolygon(slab, -fi) : rectPolygon(fMinX, fMaxX, fMinZ, fMaxZ), gates, 2.3)
      .filter(([, z1, , z2]) => !(pk.openSouth && z1 > fMaxZ - 0.1 && z2 > fMaxZ - 0.1));
    for (const [x1, z1, x2, z2] of fenceSegs) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      addBox(graniteMat, (x1 + x2) * 0.5, PARK_Y - 0.02, (z1 + z2) * 0.5, 0.42, 0.34, len + 0.2, Math.atan2(x2 - x1, z2 - z1), false);
    }
    parkFenceGeos.push(buildFenceStripGeometry(fenceSegs, PARK_Y + 0.32, 0.95));

    // London planes & lampposts lining the perimeter sidewalk (kept clear of the corners & gates)
    const row = pk.clipToShore ? offsetConvexPolygon(slab, -1.3) : rectPolygon(minX + 1.3, maxX - 1.3, minZ + 1.3, maxZ - 1.3);
    for (let i = 0; i < row.length; i++) {
      const a = row[i];
      const b = row[(i + 1) % row.length];
      if (pk.openSouth && a.z > pk.z && b.z > pk.z) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.floor((len - 8) / 8.5);
      for (let k = 0; k <= n; k++) {
        const t = (4 + k * ((len - 8) / Math.max(1, n))) / len;
        const px = a.x + (b.x - a.x) * t;
        const pz = a.z + (b.z - a.z) * t;
        if (gates.some((g) => Math.hypot(g.x - px, g.z - pz) < 3.6)) continue;
        if (k % 4 === 2) addLamp(px, PARK_Y, pz);
        else parkTreeSites.push({ x: px, y: PARK_Y, z: pz, scale: 1.05 + prand(px, pz, 4) * 0.3, species: 0 });
      }
    }
    return { minX, maxX, minZ, maxZ, fi, inset };
  }

  const blockAtPoint = (x, z) => window.NYC.blockAt(x, z);
  const QUARTER = Math.PI * 0.5;
  // The squares on their real blocks (curb islands tagged by NYC Parks): Madison Square Park (23rd-26th St, 5th to
  // Madison Ave) facing the Flatiron, Union Square (14th-17th St), Washington Square Park at the foot of 5th Ave and
  // Tompkins Square Park (Ave A-B, 7th-10th St)
  const parkBlock = (name) => BLOCKS.filter((b) => b.parkName === name && !b.median).sort((a, b) => b.area - a.area)[0];
  const parkRect = (name, extra) => {
    const b = parkBlock(name);
    return b ? { x: (b.minX + b.maxX) * 0.5, z: (b.minZ + b.maxZ) * 0.5, w: b.maxX - b.minX, d: b.maxZ - b.minZ, block: b, ...extra } : null;
  };
  const smallParks = {};
  const wsq = parkRect('Washington Square Park');
  const x5 = window.NYC.avenueX('5');
  for (const [key, def] of Object.entries({
    // diagonal & N-S walks, oval fountain
    madison: parkRect('Madison Square Park', { speciesMix: [0.7, 0.1], cells: [{ extraRays: [-QUARTER, QUARTER], hubR: 6, fountain: 4.2 }] }),
    // lawns & walks north of the open granite south plaza on 14th St
    union: parkRect('Union Square Park', { speciesMix: [0.75, 0.15], southPlaza: 18, openSouth: true, cells: [{ extraRays: [-QUARTER, 0, Math.PI], hubR: 5 }] }),
    // radial walks to the central fountain, the Arch at the foot of 5th Ave
    washington: wsq && { ...wsq, speciesMix: [0.65, 0.1], gates: [-3, 0, 3].map((dx) => ({ x: x5 + dx, z: wsq.z - wsq.d * 0.5 + 2.6 })), cells: [{ extraRays: [-QUARTER, QUARTER, 0, Math.PI], hubR: 12, fountain: 8.0 }] },
    // radial & cross walks under big elms & planes
    tompkins: parkRect('Tompkins Square Park', { speciesMix: [0.45, 0.1], cells: [{ extraRays: [-QUARTER, QUARTER, 0, Math.PI], hubR: 4.5 }] })
  })) if (def) smallParks[key] = def;
  const parkFrames = {};
  for (const key of Object.keys(smallParks)) parkFrames[key] = buildSmallPark(smallParks[key]);

  // Washington Square Arch (white marble, 1892) at the foot of 5th Ave, over the park's north-east entrance
  const wsArchX = window.NYC.avenueX('5');
  const wsArchZ = parkFrames.washington ? parkFrames.washington.minZ + 4.6 : 2815;
  if (parkFrames.washington) {
    const archShape = new THREE.Shape();
    archShape.moveTo(-8.5, 0);
    archShape.lineTo(-4.4, 0);
    archShape.lineTo(-4.4, 8.6);
    archShape.absarc(0, 8.6, 4.4, Math.PI, 0, true);
    archShape.lineTo(4.4, 0);
    archShape.lineTo(8.5, 0);
    archShape.lineTo(8.5, 17.4);
    archShape.lineTo(-8.5, 17.4);
    archShape.closePath();
    const archGeo = new THREE.ExtrudeGeometry(archShape, { depth: 4.4, bevelEnabled: false, curveSegments: 16 });
    archGeo.translate(0, 0, -2.2);
    const archMat = createMarbleAshlarMaterial();
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(wsArchX, PARK_Y, wsArchZ);
    arch.castShadow = true;
    arch.receiveShadow = true;
    group.add(arch);
    addBox(archMat, wsArchX, PARK_Y + 16.3, wsArchZ, 17.3, 1.1, 4.62); // frieze
    addBox(archMat, wsArchX, PARK_Y + 17.4, wsArchZ, 18.2, 0.75, 5.0); // cornice
    addBox(archMat, wsArchX, PARK_Y + 18.15, wsArchZ, 17.2, 2.7, 4.6); // attic
    addBox(archMat, wsArchX, PARK_Y + 20.85, wsArchZ, 17.6, 0.35, 4.8); // attic coping
    addBox(archMat, wsArchX, PARK_Y + 7.9, wsArchZ, 17.4, 0.6, 4.7); // impost band
    for (const sx of [-6.45, 6.45]) {
      addBox(archMat, wsArchX + sx, PARK_Y, wsArchZ, 4.5, 1.3, 5.0); // pier plinths
      // "Washington at War" & "Washington at Peace": statue groups on pedestals against the piers' north faces
      const fz = wsArchZ - 2.5 - 0.95;
      addBox(archMat, wsArchX + sx, PARK_Y, fz, 3.4, 2.4, 1.8);
      addBox(archMat, wsArchX + sx, PARK_Y + 2.4, fz, 0.9, 3.3, 0.8); // Washington
      addBox(archMat, wsArchX + sx, PARK_Y + 5.7, fz, 0.45, 0.5, 0.45);
      for (const fx of [-1.05, 1.05]) addBox(archMat, wsArchX + sx + fx, PARK_Y + 2.4, fz + 0.15, 0.75, 2.5, 0.7, fx * 0.3); // allegorical figures
    }
  }
  const nearArch = (x, z) => Math.abs(x - wsArchX) < 11 && z > wsArchZ - 6 && z < wsArchZ + 4.5;
  for (let i = parkTreeSites.length - 1; i >= 0; i--) {
    if (nearArch(parkTreeSites[i].x, parkTreeSites[i].z)) parkTreeSites.splice(i, 1);
  }
  for (let i = lampMatrices.length - 1; i >= 0; i--) {
    if (nearArch(lampMatrices[i].elements[12], lampMatrices[i].elements[14])) lampMatrices.splice(i, 1);
  }

  // Union Square's open granite south plaza on 14th St with the George Washington equestrian statue (facing south)
  if (parkFrames.union) {
    const f = parkFrames.union;
    const pz0 = f.maxZ - f.inset - smallParks.union.southPlaza;
    const plaza = addBox(pavingMat, smallParks.union.x, PARK_Y - 0.03, (pz0 + f.maxZ - 0.3) * 0.5, smallParks.union.w - 0.6, 0.05, f.maxZ - 0.3 - pz0, 0, false);
    setPavingStyle(plaza.geometry, 1);
    const sx = smallParks.union.x;
    const sz = pz0 + 4.0;
    const top = PARK_Y + 3.6;
    addBox(graniteMat, sx, PARK_Y, sz, 4.0, 0.55, 6.0); // stepped granite plinth, die & cornice
    addBox(graniteMat, sx, PARK_Y + 0.55, sz, 2.4, 2.7, 4.4);
    addBox(graniteMat, sx, PARK_Y + 3.25, sz, 2.9, 0.35, 4.9);
    addBox(bronzeMat, sx, top + 1.05, sz, 0.95, 1.15, 2.7); // horse body
    for (const [lx, lz] of [[-0.3, -1.0], [0.3, -1.0], [-0.3, 1.0], [0.3, 1.0]]) addBox(bronzeMat, sx + lx, top, sz + lz, 0.2, 1.1, 0.22);
    const neck = addBox(bronzeMat, sx, top + 1.6, sz + 1.45, 0.5, 1.3, 0.6);
    neck.rotation.x = 0.5;
    addBox(bronzeMat, sx, top + 2.2, sz - 0.1, 0.62, 1.2, 0.5); // rider
    addBox(bronzeMat, sx, top + 3.4, sz - 0.1, 0.3, 0.32, 0.3);
    const arm = addBox(bronzeMat, sx + 0.38, top + 2.9, sz + 0.2, 0.14, 0.9, 0.14);
    arm.rotation.x = 0.9;
  }

  // ---- Every other park block (Riverside & Morningside Parks, Marcus Garvey, Stuyvesant Square, City Hall Park, the
  //      Battery...): its curb island paved like a park walk, a granite-coped lawn inset from it under scattered trees
  //      (big planes along the walk), lampposts on the perimeter
  const SPECIAL_PARKS = new Set(['Central Park', 'Madison Square Park', 'Union Square Park', 'Washington Square Park', 'Tompkins Square Park', 'Bryant Park']);
  const genericParks = BLOCKS.filter((b) => b.park > 0.6 && !b.median && !SPECIAL_PARKS.has(b.parkName) && b.area > 250);
  for (const b of genericParks) {
    const slab = offsetPolygonInward(b.poly, 0.1) || b.poly;
    group.add(createExtrudedPolygonMesh(b.poly, 0.0, PARK_Y - 0.04, curbMat, true, false));
    const top = createExtrudedPolygonMesh(slab, 0.0, PARK_Y, pavingMat, true, false);
    setPavingStyle(top.geometry, 0);
    group.add(top);
    pavedRects.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ);
    const bed = offsetPolygonInward(b.poly, Math.min(5, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.2));
    if (!bed) continue;
    group.add(createExtrudedPolygonMesh(bed, 0.2, BED_Y - 0.21, graniteMat, true, false));
    const lawnTop = offsetPolygonInward(bed, 0.3);
    if (lawnTop) parkLawnGeos.push(createExtrudedPolygonMesh(lawnTop, 0.3, BED_Y - 0.3, cpLawnMat).geometry);
    // trees on a jittered grid inside the bed
    const SP = 11;
    for (let gx = b.minX + SP * 0.5; gx < b.maxX; gx += SP) {
      for (let gz = b.minZ + SP * 0.5; gz < b.maxZ; gz += SP) {
        const tx = gx + (prand(gx, gz) - 0.5) * SP * 0.7;
        const tz = gz + (prand(gz, gx, 1) - 0.5) * SP * 0.7;
        if (prand(tx, tz, 9) < 0.3) continue; // glades
        const inner = lawnTop || bed;
        if (!inPolygon(tx, tz, inner)) continue;
        const r = prand(tx, tz, 2);
        parkTreeSites.push({ x: tx, y: BED_Y, z: tz, scale: 0.9 + prand(tx, tz, 3) * 0.4, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });
      }
    }
    // lampposts every ~34 m along the walk
    for (let i = 0; i < slab.length; i++) {
      const a = slab[i];
      const c = slab[(i + 1) % slab.length];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      for (let t = 17; t < len - 8; t += 34) {
        const px = a.x + ((c.x - a.x) * t) / len;
        const pz = a.z + ((c.z - a.z) * t) / len;
        addLamp(px, PARK_Y, pz);
      }
    }
  }

  // ---- The Battery: Castle Clinton at the island's south-west, the esplanade carried around the tip (trees &
  //      lampposts on the seawall coping behind an iron railing), Peter Minuit Plaza's tree grid before the Whitehall
  //      Terminal
  const GPTS = window.NYC.GEO.points;
  const castleC = { x: GPTS.castleClinton[0], z: GPTS.castleClinton[1], r: 19 }; // Castle Clinton (below)
  {
    const COPING_TOP = -0.04; // seawall coping (section 2)
    const WH = { x: GPTS.whitehallTerminal[0], z: GPTS.whitehallTerminal[1] };
    const inTerminal = (x, z) => Math.hypot(x - WH.x, z - WH.z) < 48;
    // Peter Minuit Plaza: honey locusts & planes in a 9 m grid of tree pits, a lamppost & bench pair in every other bay
    const PM = { x: GPTS.peterMinuitPlaza[0], z: GPTS.peterMinuitPlaza[1] };
    const pmBlock = blockAtPoint(PM.x, PM.z);
    if (pmBlock) {
      const plazaIn = offsetPolygonInward(pmBlock.poly, 3.0);
      for (let x = pmBlock.minX + 4.5; x < pmBlock.maxX; x += 9) {
        for (let z = pmBlock.minZ + 4.5; z < pmBlock.maxZ; z += 9) {
          if (!plazaIn || !inPolygon(x, z, plazaIn) || inTerminal(x, z)) continue;
          parkTreeSites.push({ x, y: PARK_Y, z, scale: 0.85 + prand(x, z, 5) * 0.3, species: prand(z, x, 6) < 0.55 ? 1 : 0 });
        }
      }
    }
    // The esplanade around the tip along the deck edge (MANHATTAN_COASTLINE), from Battery Place round to Whitehall:
    // o = outward normal (toward the harbor)
    const tip = [];
    const C = MANHATTAN_COASTLINE;
    const iStart = C.reduce((bi, p, i) => (p.z > C[bi].z ? i : bi), 0); // southernmost point
    const onTip = (p) => p.z > castleC.z - 260 && p.x < WH.x + 60 && p.x > castleC.x - 420;
    // walk both ways from the southernmost point while on the tip
    const fwd = [];
    for (let i = iStart, k = 0; k < C.length && onTip(C[i]); i = (i + 1) % C.length, k++) fwd.push(C[i]);
    const back = [];
    for (let i = (iStart - 1 + C.length) % C.length, k = 0; k < C.length && onTip(C[i]); i = (i - 1 + C.length) % C.length, k++) back.push(C[i]);
    tip.push(...back.reverse(), ...fwd);
    const nearCastle = (x, z, m) => Math.hypot(x - castleC.x, z - castleC.z) < castleC.r + m;
    let signA = 0;
    for (let i = 0, j = C.length - 1; i < C.length; j = i++) signA += C[j].x * C[i].z - C[i].x * C[j].z;
    const edgeO = (a, b) => {
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const s0 = signA > 0 ? 1 : -1; // outward = right of travel for a CCW ring
      return { x: (s0 * (b.z - a.z)) / l, z: (-s0 * (b.x - a.x)) / l };
    };
    let k = 0;
    for (let i = 0; i + 1 < tip.length; i++) {
      const a = tip[i];
      const b = tip[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const o = edgeO(a, b);
      for (let t = 4; t < len - 3; t += 8.5, k++) {
        const px = a.x + ((b.x - a.x) * t) / len;
        const pz = a.z + ((b.z - a.z) * t) / len;
        if (inTerminal(px, pz)) continue;
        if (k % 3 === 1) addLamp(px - o.x * 3.3, COPING_TOP, pz - o.z * 3.3);
        else if (!nearCastle(px, pz, 4)) parkTreeSites.push({ x: px - o.x * 4.0, y: COPING_TOP, z: pz - o.z * 4.0, scale: 0.85 + prand(px, pz, 7) * 0.25, species: prand(pz, px, 8) < 0.6 ? 0 : 1, tier: 1 });
      }
    }
    // Iron railing 0.6 m in from the bulkhead on the coping, gapped at the ferry terminal
    const railSegs = [];
    for (let i = 0; i + 1 < tip.length; i++) {
      const a = tip[i];
      const b = tip[i + 1];
      const o = edgeO(a, b);
      const A = { x: a.x - o.x * 0.6, z: a.z - o.z * 0.6 };
      const B = { x: b.x - o.x * 0.6, z: b.z - o.z * 0.6 };
      if (inTerminal((A.x + B.x) / 2, (A.z + B.z) / 2)) continue;
      railSegs.push([A.x, A.z, B.x, B.z]);
    }
    if (railSegs.length) parkFenceGeos.push(buildFenceStripGeometry(railSegs, COPING_TOP, 1.1));
  }

  // One merged lawn mesh & one alpha-tested iron fence mesh for every small park
  if (parkLawnGeos.length) {
    const parkLawnMesh = new THREE.Mesh(mergeGeometries(parkLawnGeos, false), cpLawnMat);
    parkLawnMesh.receiveShadow = true;
    group.add(parkLawnMesh);
  }
  if (parkFenceGeos.length) {
    group.add(new THREE.Mesh(mergeGeometries(parkFenceGeos, false), createIronFenceMaterial()));
  }

  // Historic Castle Clinton National Monument (1811): the round red-sandstone fort at the Battery's west edge, a ring of
  // thick, slightly battered walls around an open bluestone courtyard, entered through a gate facing the park (+x)
  {
    const { x: cx, z: cz, r: R } = castleC;
    const WALL = 2.6;
    const H = 7.0;
    const GATE = 1.8 / R; // half-angle of the 3.6 m gate
    const sandstone = new THREE.MeshStandardNodeMaterial({ color: 0x8c5244, roughness: 0.78 });
    // Cylinder angle t puts a vertex at (sin t, cos t): the gate at t = PI / 2
    const outer = new THREE.CylinderGeometry(R - 0.3, R, H, 56, 1, true, Math.PI / 2 + GATE, Math.PI * 2 - 2 * GATE);
    const inner = new THREE.CylinderGeometry(R - WALL, R - WALL, H, 56, 1, true, Math.PI / 2 + GATE, Math.PI * 2 - 2 * GATE);
    const idx = inner.index.array; // face the inner wall into the courtyard
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    const nrm = inner.attributes.normal.array;
    for (let i = 0; i < nrm.length; i++) nrm[i] = -nrm[i];
    const top = new THREE.RingGeometry(R - WALL, R - 0.3, 56, 1, GATE, Math.PI * 2 - 2 * GATE).rotateX(-Math.PI / 2).translate(0, H / 2, 0);
    const walls = new THREE.Mesh(mergeGeometries([outer, inner, top]), sandstone);
    walls.position.set(cx, PARK_Y + H / 2, cz);
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);
    // Gate: jambs and the wall carried over it on a lintel; the parapet's granite coping
    for (const t of [Math.PI / 2 - GATE, Math.PI / 2 + GATE]) {
      addBox(sandstone, cx + Math.sin(t) * (R - WALL / 2 - 0.15), PARK_Y, cz + Math.cos(t) * (R - WALL / 2 - 0.15), 0.06, H, WALL + 0.3, t);
    }
    addBox(sandstone, cx + R - WALL / 2 - 0.15, PARK_Y + 4.3, cz, WALL + 0.3, H - 4.3, 2 * GATE * R + 0.3);
    const coping = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.15, R - 0.15, 0.32, 56, 1, true), graniteMat);
    coping.position.set(cx, PARK_Y + H - 0.16, cz);
    group.add(coping);
    const yard = new THREE.Mesh(new THREE.CircleGeometry(R - WALL, 48).rotateX(-Math.PI / 2), pavingMat);
    setPavingStyle(yard.geometry, 2);
    yard.position.set(cx, PARK_Y + 0.006, cz);
    yard.receiveShadow = true;
    group.add(yard);
    for (let i = parkTreeSites.length - 1; i >= 0; i--) {
      if (Math.hypot(parkTreeSites[i].x - cx, parkTreeSites[i].z - cz) < R + 3) parkTreeSites.splice(i, 1);
    }
    for (let i = lampMatrices.length - 1; i >= 0; i--) {
      if (Math.hypot(lampMatrices[i].elements[12] - cx, lampMatrices[i].elements[14] - cz) < R + 1) lampMatrices.splice(i, 1);
    }
  }

  // Instanced plaza & park furniture: NYC Parks slatted benches (seat facing +z) & cast-iron lampposts with globes
  if (benchMatrices.length) {
    const benchGeo = mergeGeometries([
      new THREE.BoxGeometry(1.9, 0.06, 0.46).translate(0, 0.45, 0.02),
      new THREE.BoxGeometry(1.9, 0.34, 0.05).rotateX(-0.22).translate(0, 0.74, -0.22),
      new THREE.BoxGeometry(0.07, 0.45, 0.52).translate(-0.86, 0.225, 0),
      new THREE.BoxGeometry(0.07, 0.45, 0.52).translate(0.86, 0.225, 0),
      new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(-0.9, 0.62, 0.02),
      new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(0.9, 0.62, 0.02)
    ]);
    const benchMat = new THREE.MeshStandardNodeMaterial({ color: 0x34503a, roughness: 0.66, metalness: 0.15 });
    const benchInst = new THREE.InstancedMesh(benchGeo, benchMat, benchMatrices.length);
    benchMatrices.forEach((m, i) => benchInst.setMatrixAt(i, m));
    benchInst.instanceMatrix.needsUpdate = true;
    benchInst.castShadow = true;
    benchInst.receiveShadow = true;
    benchInst.computeBoundingSphere();
    group.add(benchInst);
  }
  if (lampMatrices.length) {
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.15, 0.2, 0.7, 8).translate(0, 0.35, 0),
      new THREE.CylinderGeometry(0.055, 0.085, 3.1, 8).translate(0, 2.25, 0),
      new THREE.CylinderGeometry(0.13, 0.07, 0.2, 8).translate(0, 3.85, 0)
    ]);
    const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x1c201d, roughness: 0.45, metalness: 0.6 });
    const globeGeo = new THREE.SphereGeometry(0.27, 12, 8).translate(0, 4.17, 0);
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampMatrices.length);
    const globeInst = new THREE.InstancedMesh(globeGeo, createParkLampGlobeMaterial(), lampMatrices.length);
    lampMatrices.forEach((m, i) => {
      poleInst.setMatrixAt(i, m);
      globeInst.setMatrixAt(i, m);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    globeInst.instanceMatrix.needsUpdate = true;
    poleInst.castShadow = true;
    poleInst.computeBoundingSphere();
    globeInst.computeBoundingSphere();
    group.add(poleInst, globeInst);

    // Warm pools of lamplight on the walks & bed copings after dusk (additive decal, black by day)
    const poolInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), window.NYC.createParkLampPoolMaterial(), lampMatrices.length);
    const poolM = new THREE.Matrix4();
    lampMatrices.forEach((m, i) => {
      poolInst.setMatrixAt(i, poolM.makeScale(14, 1, 14).setPosition(m.elements[12], m.elements[13] + 0.17, m.elements[14]));
    });
    poolInst.instanceMatrix.needsUpdate = true;
    poolInst.computeBoundingSphere();
    group.add(poolInst);
  }

  // Park & plaza tree and lamp sites, read by street-details.js after the city grid is built
  window.NYC.parkTreeSites = parkTreeSites;
  window.NYC.parkLampSites = lampMatrices.map((m) => ({ x: m.elements[12], y: m.elements[13] + 4.17, z: m.elements[14] }));
  window.NYC.pavedPlazaRects = pavedRects;
  window.NYC.sidewalkBlocks = blockSidewalks; // { cx, cz, w, d } raised sidewalk slabs (cross-street tree rows)

  // =========================================================================
  // 8. AUTHENTIC HUDSON RIVER & EAST RIVER WATERFRONT PIERS (29 Piers)
  // =========================================================================
  // Concrete decks on timber piles with fenders, railings & lanterns, plus each pier's real structures:
  // cruise terminals, Chelsea Piers, Pier 57, Little Island, Pier 40, the Intrepid, the 79th St Boat Basin,
  // Pier 17, the Wavertree, Pier 15, Pier 11 and the Staten Island Ferry Whitehall Terminal (see buildWaterfrontPiers)
  buildWaterfrontPiers(group);

  // 9 & 10. The East River bridges, harbor islands and the surrounding boroughs are built by boroughs.js

  // 11. Manhattan's waterfront edge: esplanades, shore highways & riverside park belts (see buildManhattanWaterfrontEdge)
  const highwayLanes = buildManhattanWaterfrontEdge(group, { blockSidewalks, parkTreeSites, lawnMat: cpLawnMat, curbMat, roadMat });

  // Batch static sub-meshes by material to reduce per-frame WebGPU draw calls
  batchStaticGroupMeshes(group, new Set([waterMat, roadMat, cpLawnMat, cpMeadowMat]));

  scene.add(group);

  // Raised sidewalk blocks bound the roads (the planted malls down Park Ave, Broadway & co. are obstacles in the
  // roadway, handed over with the footprints)
  const sidewalks = roadSidewalks;
  // Player colliders of the South Street Viaduct's columns, ramps and portal
  const colliders = (window.NYC.fdrViaduct && window.NYC.fdrViaduct.colliders) || [];
  return { group, sidewalks, footprints, highwayLanes, colliders };
}

// =====================================================================================================================
// 11. MANHATTAN'S WATERFRONT EDGE
// =====================================================================================================================

/**
 * Dresses the land strip between Manhattan's coastline and the first raised sidewalk blocks (bare roadway asphalt
 * that no AI traffic drives on) and the 6 m seawall coping beyond it, along both rivers from TriBeCa and the
 * Manhattan Bridge up to Harlem:
 * - The esplanade on the coping: iron railing along the water, the painted two-way greenway bikeway, NYC Parks
 *   lampposts and esplanade trees, with gaps where the pier decks meet the bulkhead
 * - Route 9A / the Henry Hudson Parkway and the FDR Drive: 2 + 2 lanes with edge and lane paint, a Jersey barrier
 *   median under twin-arm highway lights, and a barrier along the greenway wherever no park separates them
 * - Lawn belts with granite curbs wherever the strip is wide enough: Hudson River Park (Midtown West, the highway
 *   beside the blocks), Riverside Park's wooded belt behind a stone wall (Upper West Side, the parkway along the
 *   river), East River Park (Corlears Hook) and Carl Schurz Park (Yorkville); their trees are handed to
 *   street-details.js through parkTreeSites
 * The highway glides between the river side and the block side over ~100 m wherever the park changes sides.
 * South of the Williamsburg Bridge the FDR leaves the strip for the South Street Viaduct (buildSouthStreetViaduct).
 * Everything is merged into a handful of meshes and keeps clear of the bridge towers standing near the shore.
 */
function buildManhattanWaterfrontEdge(group, { blockSidewalks, parkTreeSites, lawnMat, curbMat, roadMat }) {
  const { createRoadPaintMaterial, createIronFenceMaterial, createParkLampGlobeMaterial, createParkWallMaterial, EAST_RIVER_BRIDGES } = window.NYC;
  const STEP = 3; // shore sampling (m of z)
  const HWY_W = 15.2; // 0.4 shoulder, 2 x 3.3 m lanes, 1.2 m median, 2 x 3.3 m lanes, 0.4 shoulder
  const COPING_Y = -0.04; // seawall coping top (section 2)
  const LAWN_Y = 0.2;
  const UP = new THREE.Vector3(0, 1, 0);
  const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const shoreX = (z, west) => { const b = getIslandBoundsAtZ(z); return west ? b.westX : b.eastX; };

  // Keep clear: footprints (+1.5 m) of the bridge piers / caissons and Manhattan anchorages near the shore (any d), the
  // pier decks reaching up to ~4 m inland, the 79th St Boat Basin gangways and Basketball City's shed on Pier 36 (gaps
  // block elements closer to the water than dMax)
  const towers = []; // oriented boxes { cx, cz, ux, uz, hl, hw } (u = along the bridge)
  for (const br of EAST_RIVER_BRIDGES) {
    const dx = br.b.x - br.a.x;
    const dz = br.b.z - br.a.z;
    const L = Math.hypot(dx, dz);
    const foot = br.type === 'cantilever' ? [18, br.width + 10] : br.type === 'brooklyn' ? [17, 40] : [16, br.width + 12];
    const keep = (t, len, wid) => {
      const cx = br.a.x + dx * t;
      const cz = br.a.z + dz * t;
      if (Math.abs(cx - getIslandBoundsAtZ(cz).eastX) < 70) towers.push({ cx, cz, ux: dx / L, uz: dz / L, hl: len / 2 + 1.5, hw: wid / 2 + 1.5 });
    };
    for (const t of br.towers) keep(t, foot[0], foot[1]);
    if (br.anchorage) keep(br.towers[0] - br.sideSpan / L, br.anchorage[0], br.width + br.anchorage[1]);
  }
  const z79 = window.NYC.streetZ(79);
  const gaps = [{ west: true, z0: z79 - 60, z1: z79 + 40, dMax: 4.5 }]; // the 79th St Boat Basin's gangways
  for (const p of WATERFRONT_PIERS) gaps.push({ west: p.side === 'west', z0: p.z - p.width / 2 - 2.5, z1: p.z + p.width / 2 + 2.5, dMax: 4.5 });
  const X = (r, d) => r.s + r.sgn * d;
  const H = (r, o) => r.d0 + o * r.k; // offset `o` across the highway section (squeezed where the strip is short)
  const inBox = (o, x, z) => {
    const dx = x - o.cx;
    const dz = z - o.cz;
    return Math.abs(dx * o.ux + dz * o.uz) < o.hl && Math.abs(dz * o.ux - dx * o.uz) < o.hw;
  };
  const blocked = (r, d) => towers.some((t) => inBox(t, X(r, d), r.z)) ||
    gaps.some((g) => g.west === r.west && r.z > g.z0 && r.z < g.z1 && d < g.dMax);

  // Rows every STEP m of z: shore x `s`, inland sign `sgn` (x = s + sgn * d) and the strip width W to the nearest raised
  // sidewalk block (cross-street gaps take their neighbours'), min-filtered then smoothed so lanes and belts flow along
  // the shore. landF(z) slides the highway from the river side (0) to the block side (1); the park belts take the rest.
  function sampleShore(west, z0, z1, landF) {
    const sgn = west ? 1 : -1;
    const edgeD = (b, s) => (west ? b.cx - b.w / 2 - s : s - b.cx - b.w / 2);
    const near = blockSidewalks.filter((b) => edgeD(b, shoreX(b.cz, west)) < 80);
    const rows = [];
    for (let z = z0; z <= z1 + 1e-6; z += STEP) {
      const s = shoreX(z, west);
      let W = 40;
      for (const b of near) if (Math.abs(z - b.cz) < b.d / 2 + 9) W = Math.min(W, edgeD(b, s));
      rows.push({ z, s, sgn, west, raw: W });
    }
    const n = rows.length;
    const at = (i) => rows[Math.min(n - 1, Math.max(0, i))];
    rows.forEach((r, i) => { let m = Infinity; for (let k = -8; k <= 8; k++) m = Math.min(m, at(i + k).raw); r.min = m; });
    rows.forEach((r, i) => {
      let sum = 0;
      for (let k = -5; k <= 5; k++) sum += at(i + k).min;
      r.W = sum / 11;
      r.d0 = 0.6 + Math.max(0, r.W - 0.4 - HWY_W - 0.6) * landF(r.z); // river-side edge of the highway
      r.k = Math.min(1, Math.max(0.85, (r.W - r.d0 - 0.05) / HWY_W)); // narrower lanes where the strip is short
      r.river = r.d0 - 0.5 - 0.4 >= 3.4 ? [0.4, r.d0 - 0.5] : null; // belt between the greenway and the highway
      r.land = r.W - 0.3 - (r.d0 + HWY_W + 0.5) >= 3.4 ? [r.d0 + HWY_W + 0.5, r.W - 0.3] : null; // belt by the blocks
    });
    // Short pinches (a block corner within ~10 m of the shore for less than ~60 m of the smoothed W) don't break the
    // highway: its markings, barrier and traffic lanes carry on there at the narrowest lane width, past the corner
    for (let i = 0; i < n;) {
      if (H(rows[i], HWY_W) <= rows[i].W + 0.1) { i++; continue; }
      let j = i;
      let rawMin = Infinity;
      for (; j < n && H(rows[j], HWY_W) > rows[j].W + 0.1; j++) rawMin = Math.min(rawMin, rows[j].raw);
      if (i > 0 && j < n && j - i <= 20 && rawMin >= 9.5) for (let k = i; k < j; k++) rows[k].W = H(rows[k], HWY_W) + 0.4;
      i = j;
    }
    // Where a block front stands well back from the smoothed strip (a receding front, the wider shore of a cove), the
    // belt by the blocks reaches out to its curb instead of leaving bare asphalt; not across the cross streets, and
    // not for small set-backs along Riverside Park's wall
    for (const r of rows) {
      let front = Infinity;
      for (const b of near) if (Math.abs(r.z - b.cz) < b.d / 2 - 1) front = Math.min(front, edgeD(b, r.s));
      const a = r.land ? r.land[0] : r.d0 + HWY_W + 0.5;
      if (front < Infinity && front - 1.2 - (r.land ? r.land[1] : a) >= (west && r.z < -350 ? 14 : 8)) r.land = [a, front - 1.2];
    }
    return rows;
  }

  // ---- Merged geometry accumulators -------------------------------------------------------------------------------
  const makeAcc = () => ({ pos: [], nor: [], uv: [] });
  const P = (r, d, y = 0) => new THREE.Vector3(X(r, d), y, r.z);
  const off = (p, n, w, h) => new THREE.Vector3(p.x + n.x * w, h, p.z + n.z * w);
  const _e1 = new THREE.Vector3();
  const _e2 = new THREE.Vector3();
  const _n = new THREE.Vector3();
  // Quad a-b-c-d (either winding) turned to face `hint`; uv.x runs u0..u1 along a->b, uv.y 0..1 from a-b to d-c
  function quad(A, a, b, c, d, hint, u0 = 0, u1 = 1) {
    _n.crossVectors(_e1.subVectors(b, a), _e2.subVectors(c, a)).normalize();
    let pts = [[a, u0, 0], [b, u1, 0], [c, u1, 1], [d, u0, 1]];
    if (_n.dot(hint) < 0) {
      pts = [pts[0], pts[3], pts[2], pts[1]];
      _n.negate();
    }
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [p, u, v] = pts[k];
      A.pos.push(p.x, p.y, p.z);
      A.nor.push(_n.x, _n.y, _n.z);
      A.uv.push(u, v);
    }
  }
  // Runs of consecutive usable rows: fn(i, a, b, startsRun, endsRun) for every segment between rows i and i + 1
  function runs(pts, fn) {
    for (let i = 0; i + 1 < pts.length; i++) {
      if (pts[i] && pts[i + 1]) fn(i, pts[i], pts[i + 1], !pts[i - 1], !pts[i + 2]);
    }
  }

  // Lane paint (createRoadPaintMaterial attributes, as in js/road-paint.js), dashes continuing along each run
  const WHITE = new THREE.Color(0xe6e2d6);
  const YELLOW = new THREE.Color(0xe8ad22);
  const paint = { pos: [], side: [], paint: [], col: [], idx: [] };
  function paintLine(rows, dOf, w, col, period = 1, duty = 1) {
    const pts = rows.map((r) => {
      const d = dOf(r);
      return d === null || d > r.W - 0.3 ? null : P(r, d, (d < 0 ? COPING_Y : 0) + 0.012);
    });
    let u = 0;
    runs(pts, (i, a, b, start) => {
      if (start) u = 0;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const sx = ((a.z - b.z) / len) * w * 0.5;
      const sz = ((b.x - a.x) / len) * w * 0.5;
      const k = paint.pos.length / 3;
      for (const [p, s, t] of [[a, -1, u], [a, 1, u], [b, 1, u + len], [b, -1, u + len]]) {
        paint.pos.push(p.x + sx * s, p.y, p.z + sz * s);
        paint.side.push(sx * s, sz * s);
        paint.paint.push(t, period, duty);
        paint.col.push(col.r, col.g, col.b);
      }
      paint.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      u += len;
    });
  }

  // New Jersey-shape concrete barrier (half-width, height profile) along dOf(row), capped at both ends of every run
  const concrete = makeAcc();
  const JERSEY = [[0.3, 0], [0.3, 0.08], [0.19, 0.33], [0.08, 0.82]];
  function jerseyCap(c, n, out) {
    for (let k = 0; k + 1 < JERSEY.length; k++) {
      const [w0, h0] = JERSEY[k];
      const [w1, h1] = JERSEY[k + 1];
      quad(concrete, off(c, n, -w0, h0), off(c, n, w0, h0), off(c, n, w1, h1), off(c, n, -w1, h1), out);
    }
  }
  function barrier(rows, dOf) {
    const pts = rows.map((r) => {
      const d = dOf(r);
      return d === null || d > r.W - 0.5 || blocked(r, d) ? null : P(r, d);
    });
    runs(pts, (i, a, b, start, end) => {
      const dir = new THREE.Vector3().subVectors(b, a).normalize();
      const n = new THREE.Vector3(-dir.z, 0, dir.x);
      for (const sd of [-1, 1]) {
        const hint = n.clone().multiplyScalar(sd).setY(0.3);
        for (let k = 0; k + 1 < JERSEY.length; k++) {
          const [w0, h0] = JERSEY[k];
          const [w1, h1] = JERSEY[k + 1];
          quad(concrete, off(a, n, sd * w0, h0), off(b, n, sd * w0, h0), off(b, n, sd * w1, h1), off(a, n, sd * w1, h1), hint);
        }
      }
      const [wt, ht] = JERSEY[JERSEY.length - 1];
      quad(concrete, off(a, n, -wt, ht), off(b, n, -wt, ht), off(b, n, wt, ht), off(a, n, wt, ht), UP);
      if (start) jerseyCap(a, n, dir.clone().negate());
      if (end) jerseyCap(b, n, dir);
    });
  }

  // Lawn belts raised on granite curbs (or behind a coursed stone wall on the block side), open ends capped
  const lawn = makeAcc();
  const curbs = makeAcc();
  const wall = makeAcc();
  const CURB_Y = LAWN_Y + 0.05;
  const WALL_Y = 1.05;
  function belt(rows, key, walled) {
    // Pier decks and gangways cut through the river belts
    const spans = rows.map((r) => (r[key] && !(key === 'river' && blocked(r, r[key][0])) ? r[key] : null));
    runs(spans, (i, sa, sb, start, end) => {
      const ra = rows[i];
      const rb = rows[i + 1];
      quad(lawn, P(ra, sa[0], LAWN_Y), P(rb, sb[0], LAWN_Y), P(rb, sb[1], LAWN_Y), P(ra, sa[1], LAWN_Y), UP);
      for (const k of [0, 1]) {
        const out = new THREE.Vector3(k === 0 ? -ra.sgn : ra.sgn, 0, 0);
        if (k === 1 && walled) {
          const ia = sa[1] - 0.5;
          const ib = sb[1] - 0.5;
          quad(wall, P(ra, ia, WALL_Y), P(rb, ib, WALL_Y), P(rb, sb[1], WALL_Y), P(ra, sa[1], WALL_Y), UP);
          quad(wall, P(ra, sa[1], 0), P(rb, sb[1], 0), P(rb, sb[1], WALL_Y), P(ra, sa[1], WALL_Y), out);
          quad(wall, P(ra, ia, LAWN_Y), P(rb, ib, LAWN_Y), P(rb, ib, WALL_Y), P(ra, ia, WALL_Y), out.clone().negate());
          continue;
        }
        const inset = k === 0 ? 0.3 : -0.3;
        quad(curbs, P(ra, sa[k], CURB_Y), P(rb, sb[k], CURB_Y), P(rb, sb[k] + inset, CURB_Y), P(ra, sa[k] + inset, CURB_Y), UP);
        quad(curbs, P(ra, sa[k], 0), P(rb, sb[k], 0), P(rb, sb[k], CURB_Y), P(ra, sa[k], CURB_Y), out);
      }
      for (const [r, s, cap, dz] of [[ra, sa, start, -1], [rb, sb, end, 1]]) {
        if (!cap) continue;
        const out = new THREE.Vector3(0, 0, dz);
        quad(curbs, P(r, s[0], 0), P(r, s[1], 0), P(r, s[1], CURB_Y), P(r, s[0], CURB_Y), out);
        if (walled) quad(wall, P(r, s[1] - 0.5, 0), P(r, s[1], 0), P(r, s[1], WALL_Y), P(r, s[1] - 0.5, WALL_Y), out);
      }
    });
  }

  // Black iron esplanade railing along the outer edge of the coping (alpha-tested pickets, uv.x = metres along)
  const fence = makeAcc();
  function railing(rows, d) {
    const pts = rows.map((r) => (blocked(r, d) ? null : P(r, d, COPING_Y)));
    let u = 0;
    runs(pts, (i, a, b, start) => {
      if (start) u = 0;
      const len = a.distanceTo(b);
      const top = COPING_Y + 1.1;
      quad(fence, a, b, b.clone().setY(top), a.clone().setY(top), new THREE.Vector3(-rows[i].sgn, 0, 0), u, u + len);
      u += len;
    });
  }

  // Trees: staggered, jittered rows across the belts (with glades), and a single row along the esplanade
  const MIX_PARK = [0.5, 0.3]; // London plane, honey locust, else elm / oak
  const MIX_RIVERSIDE = [0.35, 0.2];
  const pickSpecies = (h, mix) => (h < mix[0] ? 0 : (h < mix[0] + mix[1] ? 1 : 2));
  function plantBelt(rows, key, spacing, rowGap, mix, tier, s0, s1) {
    const z0 = rows[0].z;
    for (let zt = z0; zt <= rows[rows.length - 1].z; zt += spacing) {
      for (let k = 0; k < 8; k++) {
        const z = zt + (k % 2) * spacing * 0.5 + (hash(zt, k) - 0.5) * spacing * 0.45;
        const r = rows[Math.round((z - z0) / STEP)];
        if (!r || !r[key]) continue;
        const [a, b] = r[key];
        const d = a + 1.9 + k * rowGap + (hash(k, zt) - 0.5) * 1.0;
        if (d > b - 1.6) break;
        if (blocked(r, d) || (key === 'river' && blocked(r, a)) || hash(z, d) < 0.1) continue;
        parkTreeSites.push({ x: X(r, d), y: LAWN_Y, z, scale: s0 + hash(d, z) * (s1 - s0), species: pickSpecies(hash(z * 0.37, d), mix), tier });
      }
    }
  }
  const lampSpots = [];
  function esplanade(rows) {
    const z0 = rows[0].z;
    const z1 = rows[rows.length - 1].z;
    for (let zt = z0 + 4; zt <= z1; zt += 16) {
      const z = zt + (hash(zt, 3.1) - 0.5) * 3;
      const r = rows[Math.round((z - z0) / STEP)];
      if (!r || r.river || blocked(r, -4.4)) continue;
      parkTreeSites.push({ x: X(r, -4.4), y: COPING_Y, z, scale: 0.8 + hash(z, 7.7) * 0.25, species: hash(z, 1.9) < 0.6 ? 0 : 1, tier: 1 });
    }
    for (let z = z0 + 12; z <= z1; z += 26) {
      const r = rows[Math.round((z - z0) / STEP)];
      if (r && !blocked(r, -3.55)) lampSpots.push([X(r, -3.55), COPING_Y, r.z, 0]);
    }
  }

  // Twin-arm highway lights standing on the median barrier, arms across the carriageways
  const highwaySpots = [];
  function highwayLights(rows, offset) {
    const z0 = rows[0].z;
    for (let zt = z0 + offset; zt <= rows[rows.length - 1].z; zt += 39) {
      const i = Math.round((zt - z0) / STEP);
      const r = rows[i];
      if (!r || !rows[i - 1] || !rows[i + 1] || r.via) continue;
      const d = H(r, 7.6);
      if (d > r.W - 0.5 || blocked(r, d)) continue;
      const a = P(rows[i - 1], H(rows[i - 1], 7.6));
      const b = P(rows[i + 1], H(rows[i + 1], 7.6));
      highwaySpots.push([X(r, d), 0, r.z, Math.atan2(-(b.x - a.x), -(b.z - a.z))]);
    }
  }

  // ---- Both shores ------------------------------------------------------------------------------------------------
  // West: Route 9A beside the blocks with Hudson River Park toward the river south of 59th St, then the Henry Hudson
  // Parkway along the river with Riverside Park inland. East: the FDR along the esplanade, moving inland behind East
  // River Park (12th St to Montgomery St) and Carl Schurz Park (84th to 90th St).
  // (z ranges from the real geography: Route 9A beside the blocks south of 59th St; East River Park's & Carl Schurz
  // Park's extents from their NYC Parks outlines)
  const { streetZ: stZ, CUT_Z: Z_NORTH, GEO: GEO_W } = window.NYC;
  const parkZRange = (name, fallback) => {
    const pk = GEO_W.parks.find((q) => q.name === name);
    if (!pk) return fallback;
    let z0 = Infinity, z1 = -Infinity;
    for (const r of pk.rings) for (let i = 1; i < r.length; i += 2) { z0 = Math.min(z0, r[i]); z1 = Math.max(z1, r[i]); }
    return [z0, z1];
  };
  const [er0, er1] = parkZRange('John V. Lindsay East River Park', [stZ(12), 4150]);
  const [cs0, cs1] = [stZ(90), stZ(84)]; // Carl Schurz Park
  const WEST_END_Z = 6000; // Route 9A dives into the Battery Park Underpass at Battery Place
  const westRows = sampleShore(true, Z_NORTH + 40, WEST_END_Z, (z) => smooth(stZ(66), stZ(59) + 60, z));
  const eastRows = sampleShore(false, Z_NORTH + 40, 6150, (z) =>
    Math.max(smooth(er0 - 60, er0, z) * (1 - smooth(er1 - 50, er1, z)), smooth(cs0 - 40, cs0, z) * (1 - smooth(cs1, cs1 + 40, z))));
  // South of VIA_Z the FDR leaves the strip for the South Street Viaduct: no at-grade carriageway or park belts there,
  // the esplanade carries on
  const VIA_Z = 4250;
  for (const r of eastRows) {
    if (r.z <= VIA_Z) continue;
    r.via = true;
    r.river = r.land = null;
  }
  const hwy = (r, o) => (r.via ? null : H(r, o));
  for (const rows of [westRows, eastRows]) {
    const isWest = rows[0].west;
    railing(rows, -5.8);
    paintLine(rows, () => -0.45, 0.1, WHITE);
    paintLine(rows, () => -3.2, 0.1, WHITE);
    paintLine(rows, () => -1.82, 0.1, YELLOW, 6, 0.5);
    esplanade(rows);
    paintLine(rows, (r) => hwy(r, 0.3), 0.15, WHITE);
    paintLine(rows, (r) => hwy(r, 3.7), 0.13, WHITE, 12, 0.25);
    paintLine(rows, (r) => hwy(r, 7.05), 0.12, YELLOW);
    paintLine(rows, (r) => hwy(r, 8.15), 0.12, YELLOW);
    paintLine(rows, (r) => hwy(r, 11.5), 0.13, WHITE, 12, 0.25);
    paintLine(rows, (r) => hwy(r, HWY_W - 0.3), 0.15, WHITE);
    barrier(rows, (r) => hwy(r, 7.6));
    barrier(rows, (r) => (r.river || r.via ? null : r.d0 - 0.3));
    highwayLights(rows, isWest ? 10 : 25);
    belt(rows, 'river', false);
    belt(rows, 'land', isWest);
    plantBelt(rows, 'river', 9, 4.5, MIX_PARK, 1, 0.9, 1.2);
    plantBelt(rows, 'land', isWest ? 8.5 : 9, isWest ? 3.8 : 4.5, isWest ? MIX_RIVERSIDE : MIX_PARK, isWest ? 0 : 1, 1.0, 1.3);
  }

  // ---- The South Street Viaduct (buildSouthStreetViaduct) -----------------------------------------------------------
  // From the at-grade centre line at VIA_Z, clear of the bridge piers & anchorages near the shore and of the buildings
  // and sheds standing from ~1.5 m out along the East River piers; park trees in its way are dropped, buildings.js
  // keeps its lots clear
  const iJoin = eastRows.findIndex((r) => r.via) - 1;
  const join = P(eastRows[iJoin], H(eastRows[iJoin], 7.6));
  const pierBoxes = WATERFRONT_PIERS.filter((p) => p.side === 'east' && p.kind !== 'whitehall' && p.z > VIA_Z).map((p) => {
    const th = Math.atan2(shoreX(p.z + 14, false) - shoreX(p.z - 14, false), 28); // as the piers' own frames
    const ux = Math.cos(th);
    const uz = -Math.sin(th);
    const x0 = shoreX(p.z, false);
    return { cx: x0 + ux * (p.length / 2 + 0.5), cz: p.z + uz * (p.length / 2 + 0.5), ux, uz, hl: p.length / 2, hw: p.width / 2 + 1 };
  });
  const underSpots = [];
  // Its columns stand in the shore strip (short of the nearest block, as sampleShore's raw W) or on a block, never in a
  // street
  const inStrip = (x, z) => {
    const s = shoreX(z, false);
    let W = 40;
    for (const b of blockSidewalks) if (Math.abs(z - b.cz) < b.d / 2 + 9) W = Math.min(W, s - b.cx - b.w / 2);
    return s - x < W - 1;
  };
  const groundOK = (x, z) => inStrip(x, z) ||
    blockSidewalks.some((b) => Math.abs(x - b.cx) < b.w / 2 - 1 && Math.abs(z - b.cz) < b.d / 2 - 1);
  const viaduct = buildSouthStreetViaduct(group, {
    start: { x: join.x, z: join.z }, shoreX: (z) => shoreX(z, false), obstacles: towers.concat(pierBoxes), zEnd: 6330,
    quad, makeAcc, roadMat, lawnMat, paint, WHITE, YELLOW, lightSpots: highwaySpots, underSpots, groundOK
  });
  for (let i = parkTreeSites.length - 1; i >= 0; i--) {
    if (viaduct.keepOut(parkTreeSites[i].x, parkTreeSites[i].z, 2.5)) parkTreeSites.splice(i, 1);
  }
  for (let i = lampSpots.length - 1; i >= 0; i--) {
    if (viaduct.keepOut(lampSpots[i][0], lampSpots[i][2])) lampSpots.splice(i, 1); // where it swerves over the walk
  }
  window.NYC.fdrViaduct = viaduct;

  // ---- West St's Battery Park Underpass portal (buildUnderpassPortal) ---------------------------------------------
  // Over the last 42 m of Route 9A's carriageway, whose lanes go underground behind its dark screen and come up on the
  // South Street Viaduct (and vice versa); the park trees, lamps and highway lights in its way are dropped
  const zW = westRows[westRows.length - 1].z;
  const wFrames = westRows.filter((r) => r.z >= zW - 42 - 1e-6).map((r) => {
    const c = P(r, H(r, 7.6));
    return { x: c.x, z: c.z, nx: r.sgn, nz: 0, y: 0, half: 7.6 * r.k + 0.5 };
  });
  const wPortal = { conc: makeAcc(), roof: lawn, dark: makeAcc(), shade: makeAcc() };
  buildUnderpassPortal(wFrames, wPortal, quad, underSpots, viaduct.colliders);
  const inWestPortal = (x, z, m) => {
    let f = wFrames[0];
    for (const g of wFrames) if (Math.abs(g.z - z) < Math.abs(f.z - z)) f = g;
    return z > wFrames[0].z - m && z < zW + m && Math.abs(x - f.x) < f.half + 0.8 + m;
  };
  for (let i = parkTreeSites.length - 1; i >= 0; i--) {
    if (inWestPortal(parkTreeSites[i].x, parkTreeSites[i].z, 3)) parkTreeSites.splice(i, 1);
  }
  for (const spots of [lampSpots, highwaySpots]) {
    for (let i = spots.length - 1; i >= 0; i--) if (inWestPortal(spots[i][0], spots[i][2], 0.5)) spots.splice(i, 1);
  }

  // ---- Meshes -----------------------------------------------------------------------------------------------------
  const addMesh = (A, mat, cast = false) => {
    if (!A.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(A.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  addMesh(lawn, lawnMat);
  addMesh(curbs, curbMat);
  addMesh(wall, createParkWallMaterial(), true);
  addMesh(concrete, new THREE.MeshStandardNodeMaterial({ color: 0x7f7c76, roughness: 0.92, metalness: 0.0 }));
  addMesh(fence, createIronFenceMaterial());
  // West St's underpass portal in the South Street Viaduct portal's materials (its lawn roof went in with the lawns)
  addMesh(wPortal.conc, viaduct.portalMats.conc, true);
  addMesh(wPortal.dark, viaduct.portalMats.dark);
  const wShade = addMesh(wPortal.shade, viaduct.portalMats.shade);
  if (wShade) wShade.renderOrder = 1; // over the lane markings (renderOrder -1)

  if (paint.idx.length) {
    const g = new THREE.BufferGeometry();
    const normals = new Float32Array(paint.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute('position', new THREE.Float32BufferAttribute(paint.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(paint.col, 3));
    g.setAttribute('side', new THREE.Float32BufferAttribute(paint.side, 2));
    g.setAttribute('paint', new THREE.Float32BufferAttribute(paint.paint, 3));
    g.setIndex(paint.idx);
    const m = new THREE.Mesh(g, createRoadPaintMaterial());
    m.name = 'ShoreHighwayMarkings';
    m.receiveShadow = true;
    m.renderOrder = -1; // like the street markings (js/road-paint.js)
    group.add(m);
  }

  const dummy = new THREE.Object3D();
  const instanced = (geo, mat, spots) => {
    if (!spots.length) return;
    const inst = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, y, z, yaw], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  };
  const glowMat = createParkLampGlobeMaterial(); // milky by day, warm glow at dusk & night
  instanced(mergeGeometries([
    new THREE.CylinderGeometry(0.15, 0.2, 0.7, 8).translate(0, 0.35, 0),
    new THREE.CylinderGeometry(0.055, 0.085, 3.1, 8).translate(0, 2.25, 0),
    new THREE.CylinderGeometry(0.13, 0.07, 0.2, 8).translate(0, 3.85, 0)
  ]), new THREE.MeshStandardNodeMaterial({ color: 0x1c201d, roughness: 0.45, metalness: 0.6 }), lampSpots);
  instanced(new THREE.SphereGeometry(0.27, 12, 8).translate(0, 4.17, 0), glowMat, lampSpots);
  instanced(mergeGeometries([
    new THREE.CylinderGeometry(0.09, 0.16, 10, 8).translate(0, 5, 0),
    new THREE.BoxGeometry(6.6, 0.12, 0.14).translate(0, 9.92, 0)
  ]), new THREE.MeshStandardNodeMaterial({ color: 0x8c9093, roughness: 0.5, metalness: 0.7 }), highwaySpots);
  instanced(mergeGeometries([
    new THREE.BoxGeometry(0.8, 0.16, 0.36).translate(-3.3, 9.84, 0),
    new THREE.BoxGeometry(0.8, 0.16, 0.36).translate(3.3, 9.84, 0)
  ]), glowMat, highwaySpots);
  // Lamps hanging under the viaduct deck (and the underpass ceiling) ...
  instanced(new THREE.BoxGeometry(0.5, 0.14, 0.9).translate(0, -0.07, 0), glowMat, underSpots);
  // ... and the warm pools of the deck lamps' light on the ground below, just over the sidewalks' top (additive
  // decal, black by day)
  const poolSpots = underSpots.filter((s) => s[4] !== 'tunnel');
  if (poolSpots.length) {
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), window.NYC.createParkLampPoolMaterial(), poolSpots.length);
    const pm = new THREE.Matrix4();
    poolSpots.forEach(([x, , z], i) => pools.setMatrixAt(i, pm.makeTranslation(x, 0.27, z)));
    pools.instanceMatrix.needsUpdate = true;
    pools.computeBoundingSphere();
    group.add(pools);
  }

  // Lanes for the ambient highway traffic (js/traffic.js createHighwayTraffic): centre lines of the four lanes over
  // every run of rows where the whole carriageway fits the strip, listed in driving order. Right-hand traffic: the
  // west side's river pair and the east side's land pair run south (+z). [offset from d0, west-side direction, m/s]
  // West St's run reaching zW dips 4.5 m behind the underpass portal's screen, the east run reaching VIA_Z carries on
  // over the South Street Viaduct into the other portal, and each such pair is joined under the Battery below.
  const highwayLanes = [];
  const tunnelLanes = {}; // offset -> { west, east }: the lanes in and out of the Battery Park Underpass
  for (const rows of [westRows, eastRows]) {
    const side = rows[0].west ? 'west' : 'east';
    for (const [o, dirWest, speed] of [[2.05, 1, 15.5], [5.35, 1, 17.5], [9.85, -1, 17.5], [13.15, -1, 15.5]]) {
      const dir = rows[0].west ? dirWest : -dirWest;
      let run = [];
      const flush = (tunnel = false) => {
        if (run.length * STEP >= 240) {
          const lane = { pts: dir > 0 ? run : run.reverse(), speed };
          highwayLanes.push(lane);
          if (tunnel) (tunnelLanes[o] = tunnelLanes[o] || {})[side] = lane;
        }
        run = [];
      };
      for (const r of rows) {
        if (r.via) {
          const tunnel = run.length > 0;
          if (tunnel) run.push(...viaduct.lane(o));
          flush(tunnel);
        } else if (H(r, HWY_W) > r.W + 0.1) flush();
        else run.push(new THREE.Vector3(X(r, H(r, o)), r.west ? -4.5 * smooth(zW - 30, zW, r.z) : 0, r.z));
      }
      flush(rows[0].west); // a west run still open here ends at zW, in the portal
    }
  }
  // The underground link: a straight run (points every ~30 m) from the end of the lane going in to the start of the
  // one coming out (the river pair: West St south -> FDR north; the land pair: FDR south -> West St north)
  for (const { west, east } of Object.values(tunnelLanes)) {
    if (!west || !east) continue;
    const [a, b] = west.pts[west.pts.length - 1].z > west.pts[0].z ? [west, east] : [east, west];
    const p0 = a.pts[a.pts.length - 1];
    const p1 = b.pts[0];
    const n = Math.max(1, Math.round(p0.distanceTo(p1) / 30));
    for (let k = 1; k < n; k++) a.pts.push(new THREE.Vector3().lerpVectors(p0, p1, k / n));
    a.pts.push(...b.pts);
    highwayLanes.splice(highwayLanes.indexOf(b), 1);
  }
  return highwayLanes;
}

// =====================================================================================================================
// 11B. THE SOUTH STREET VIADUCT
// =====================================================================================================================

/**
 * The elevated FDR Drive along South Street. South of the Williamsburg Bridge the strip between the East River and the
 * blocks gets too narrow for the at-grade highway, so the FDR climbs (at up to ~6.5 %) onto a steel girder viaduct on
 * two-column bents a few metres inland of the esplanade, passes the Manhattan and Brooklyn Bridge towers and the
 * Seaport piers, comes back down to grade (~7 %) at Whitehall and dives into the Battery Park Underpass: a covered,
 * lawn-topped portal (buildUnderpassPortal) whose dark mouth swallows the cars; their lanes carry on underground to
 * West St's portal on the other side of the Battery (joined by buildManhattanWaterfrontEdge).
 * The centre line runs D0 m inland of the smoothed shore and swerves smoothly around the bridge piers, anchorages and
 * pier buildings in the way; it starts on the at-grade highway's centre line (`start`).
 * opts: { start {x, z}, shoreX(z), obstacles [oriented boxes {cx, cz, ux, uz, hl, hw}], zEnd, quad & makeAcc (from
 *   buildManhattanWaterfrontEdge), roadMat, lawnMat, paint (road paint accumulator), WHITE, YELLOW, lightSpots (median
 *   highway lights [x, y, z, yaw]), underSpots (lamps under the deck, same format; the tunnel's ceiling lights get a
 *   fifth element 'tunnel'), groundOK(x, z) (whether a column may stand there: not in a street) }
 * Returns { lane(o): centre line (Vector3s, southbound order, without the start point, 4.7 m down at the far end of
 *   the portal) of the lane `o` m from the river edge of the at-grade carriageway, boxes: keep-clear oriented boxes
 *   along the structure, keepOut(x, z, margin), colliders: player AABBs {minX, maxX, minZ, maxZ, maxY} of the columns,
 *   the ramps on fill and the portal, portalMats: the portal's { conc, dark, shade } materials }
 */
function buildSouthStreetViaduct(group, opts) {
  const { start, shoreX, obstacles, zEnd, quad, makeAcc, roadMat, lawnMat, paint, WHITE, YELLOW, lightSpots, underSpots } = opts;
  const groundOK = opts.groundOK || (() => true);
  const HALF = 7.9; // deck half-width: 2 + 2 lanes, median, shoulders and parapets
  const D0 = 9.0; // centre line inland of the shore: the river parapet stands ~1 m inland, the esplanade stays open
  const RISE = 7.6; // road level on the viaduct
  const FILL_Y = 4.0; // lower ramps run on retained fill between concrete walls
  const SLAB = 0.75; // concrete deck slab & fascia
  const GIRDER = 1.15; // steel plate girders under the slab
  const COVER = 42; // covered portal section at the south end (buildUnderpassPortal)
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const ss = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
  const inBox = (o, x, z, m = 0) => {
    const dx = x - o.cx;
    const dz = z - o.cz;
    return Math.abs(dx * o.ux + dz * o.uz) < o.hl + m && Math.abs(dz * o.ux - dx * o.uz) < o.hw + m;
  };

  // ---- Centre line ------------------------------------------------------------------------------------------------
  // Polylines of Vector2(x, z): even arc-length spacing, moving average (ends pinned), inland unit normals
  function resample(pts, step) {
    const out = [pts[0].clone()];
    let need = step;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const len = a.distanceTo(pts[i]);
      let at = 0;
      while (len - at >= need) {
        at += need;
        out.push(a.clone().lerp(pts[i], at / len));
        need = step;
      }
      need -= len - at;
    }
    return out;
  }
  function smoothPts(pts, r) {
    const n = pts.length;
    return pts.map((p, i) => {
      const w = Math.min(r, i, n - 1 - i);
      const c = new THREE.Vector2();
      for (let k = -w; k <= w; k++) c.add(pts[i + k]);
      return c.multiplyScalar(1 / (2 * w + 1));
    });
  }
  const normals = (pts) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const t = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
    return new THREE.Vector2(-t.y, t.x); // west of a southbound east shore: inland
  });

  // The shore every 2 m of arc, smoothed over ~±35 m
  let coast = [];
  for (let z = start.z; z <= zEnd; z += 1) coast.push(new THREE.Vector2(shoreX(z), z));
  coast = resample(coast, 2);
  for (let k = 0; k < 3; k++) coast = smoothPts(coast, 6);
  const nC = coast.length;
  const cn = normals(coast);

  // Offset each shore sample needs to keep the deck (+0.5 m) out of the obstacles: the feasible one nearest D0, with
  // the river parapet at most 3 m out over the seawall coping
  const req = coast.map((c, i) => {
    const near = obstacles.filter((o) => Math.hypot(o.cx - c.x, o.cz - c.y) < o.hl + o.hw + 70);
    if (!near.length) return 0;
    const fits = (D) => {
      for (let k = 0; k <= 20; k++) {
        const w = D - HALF - 0.5 + (k / 20) * (2 * HALF + 1);
        if (near.some((o) => inBox(o, c.x + cn[i].x * w, c.y + cn[i].y * w))) return false;
      }
      return true;
    };
    for (let k = 0; k <= 80; k++) {
      for (const D of k ? [D0 + k * 0.5, D0 - k * 0.5] : [D0]) if (D >= HALF - 3 && fits(D)) return D - D0;
    }
    return 0;
  });
  // ... spread into smooth swerves (full deviation within 12 m of a conflict, easing back over 75 m) ...
  const devP = new Float32Array(nC);
  const devN = new Float32Array(nC);
  req.forEach((r, i) => {
    if (!r) return;
    for (let j = Math.max(0, i - 44); j <= Math.min(nC - 1, i + 44); j++) {
      const f = r * (1 - ss((Math.abs(j - i) * 2 - 12) / 75));
      if (r > 0) devP[j] = Math.max(devP[j], f);
      else devN[j] = Math.min(devN[j], f);
    }
  });
  // ... blended in from the at-grade centre line over the first 50 m
  const dStart = (start.x - coast[0].x) * cn[0].x + (start.z - coast[0].y) * cn[0].y;
  let path = coast.map((c, j) => {
    const D = D0 + devP[j] + devN[j] + (dStart - D0) * (1 - ss((j * 2) / 50));
    return new THREE.Vector2(c.x + cn[j].x * D, c.y + cn[j].y * D);
  });
  path[0].set(start.x, start.z);
  path = smoothPts(resample(path, 3), 2);
  const nP = path.length;
  const pn = normals(path);
  const S = [0];
  for (let i = 1; i < nP; i++) S.push(S[i - 1] + path[i].distanceTo(path[i - 1]));
  const L = S[nP - 1];
  const iAt = (s) => { let i = 0; while (i < nP - 2 && S[i + 1] <= s) i++; return i; };
  const tan = (i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(nP - 1, i + 1)];
    return new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
  };

  // Road level: up from grade after the join, back down 6 m before the portal to just over the sidewalks' top (the
  // approach crosses a block's sidewalk slab near Whitehall) (smoothstep ramps)
  const sMouth = L - COVER;
  const up0 = 12;
  const up1 = up0 + 175;
  const dn1 = sMouth - 6;
  const dn0 = dn1 - 160;
  const END_Y = 0.26;
  const Y = S.map((s) => 0.03 + RISE * ss((s - up0) / (up1 - up0)) - (RISE + 0.03 - END_Y) * ss((s - dn0) / (dn1 - dn0)));
  const iMouth = iAt(sMouth);

  // ---- Structure --------------------------------------------------------------------------------------------------
  const deck = makeAcc(); // road surface
  const conc = makeAcc(); // parapets, fascia, soffit, ramp walls, abutments, pedestals, portal
  const steel = makeAcc(); // plate girders, cap beams, columns
  const roof = makeAcc(); // portal lawn
  const dark = makeAcc(); // tunnel mouth
  const shade = makeAcc(); // darkening layer over the tunnel's road, walls & ceiling (uv.x: 0 at the mouth, 1 deep in)
  const colliders = []; // columns, ramps on fill and the portal, for the player (js/controllers.js)
  const V = (i, w, y) => new THREE.Vector3(path[i].x + pn[i].x * w, y, path[i].y + pn[i].y * w);
  const side = (i, s, y = 0) => new THREE.Vector3(pn[i].x * s, y, pn[i].y * s);
  // Quad between samples i and i + 1 through cross-section points [w (inland +), h, abs]: h above the road, or above
  // the ground when abs
  const seg = (A, i, [w0, h0, a0], [w1, h1, a1], hint) => {
    const y = (k, h, abs) => (abs ? h : Y[k] + h);
    quad(A, V(i, w0, y(i, h0, a0)), V(i + 1, w0, y(i + 1, h0, a0)), V(i + 1, w1, y(i + 1, h1, a1)), V(i, w1, y(i, h1, a1)), hint);
  };
  // Box centred on (x, z) with half-sizes ht along the unit 2D direction t and hn across it, from y0 to y1
  function obox(A, x, z, t, ht, hn, y0, y1) {
    const P = (a, b, y) => new THREE.Vector3(x + t.x * a - t.y * b, y, z + t.y * a + t.x * b);
    const H = (a, b) => new THREE.Vector3(t.x * a - t.y * b, 0, t.y * a + t.x * b);
    quad(A, P(-ht, -hn, y0), P(ht, -hn, y0), P(ht, -hn, y1), P(-ht, -hn, y1), H(0, -1));
    quad(A, P(-ht, hn, y0), P(ht, hn, y0), P(ht, hn, y1), P(-ht, hn, y1), H(0, 1));
    quad(A, P(-ht, -hn, y0), P(-ht, hn, y0), P(-ht, hn, y1), P(-ht, -hn, y1), H(-1, 0));
    quad(A, P(ht, -hn, y0), P(ht, hn, y0), P(ht, hn, y1), P(ht, -hn, y1), H(1, 0));
    quad(A, P(-ht, -hn, y1), P(ht, -hn, y1), P(ht, hn, y1), P(-ht, hn, y1), UP);
    quad(A, P(-ht, -hn, y0), P(ht, -hn, y0), P(ht, hn, y0), P(-ht, hn, y0), DOWN);
  }

  // Deck, parapets (outer top edge -> Jersey foot) and the at-grade highway's Jersey median; under an elevated deck the
  // slab soffit and five plate girders, on fill the outer faces run down to the ground as retaining walls
  const PARAPET = [[7.9, 0.85], [7.7, 0.85], [7.56, 0.33], [7.42, 0.08], [7.38, 0]];
  const MEDIAN = [[0.3, 0], [0.3, 0.08], [0.19, 0.33], [0.08, 0.82]];
  const elevated = (i) => Y[i] >= FILL_Y && Y[i + 1] >= FILL_Y;
  for (let i = 0; i < iMouth; i++) {
    seg(deck, i, [-7.38, 0], [7.38, 0], UP);
    for (const sd of [-1, 1]) {
      for (let k = 0; k + 1 < PARAPET.length; k++) {
        seg(conc, i, [sd * PARAPET[k][0], PARAPET[k][1]], [sd * PARAPET[k + 1][0], PARAPET[k + 1][1]], k ? side(i, -sd, 0.3) : UP);
      }
      seg(conc, i, elevated(i) ? [sd * 7.9, -SLAB] : [sd * 7.9, 0, true], [sd * 7.9, 0.85], side(i, sd));
      for (let k = 0; k + 1 < MEDIAN.length; k++) {
        seg(conc, i, [sd * MEDIAN[k][0], MEDIAN[k][1]], [sd * MEDIAN[k + 1][0], MEDIAN[k + 1][1]], side(i, sd, 0.3));
      }
    }
    seg(conc, i, [-0.08, 0.82], [0.08, 0.82], UP);
    if (elevated(i)) {
      seg(conc, i, [-7.9, -SLAB], [7.9, -SLAB], DOWN);
      for (const g of [-6.2, -3.1, 0, 3.1, 6.2]) {
        for (const sd of [-1, 1]) seg(steel, i, [g + sd * 0.2, -SLAB], [g + sd * 0.2, -SLAB - GIRDER], side(i, sd));
        seg(steel, i, [g - 0.2, -SLAB - GIRDER], [g + 0.2, -SLAB - GIRDER], DOWN);
      }
    }
    // Abutment: where the fill ends, its end wall closes the space under the deck
    if (i > 0 && elevated(i) !== elevated(i - 1)) {
      const t = tan(i);
      const f = elevated(i) ? 1 : -1;
      quad(conc, V(i, -7.9, 0), V(i, 7.9, 0), V(i, 7.9, Y[i] - SLAB), V(i, -7.9, Y[i] - SLAB), new THREE.Vector3(t.x * f, 0, t.y * f));
    }
  }
  // Parapet & median ends where the viaduct leaves the at-grade highway
  {
    const t = tan(0);
    const back = new THREE.Vector3(-t.x, 0, -t.y);
    for (const sd of [-1, 1]) quad(conc, V(0, sd * 7.38, Y[0]), V(0, sd * 7.9, Y[0]), V(0, sd * 7.9, Y[0] + 0.85), V(0, sd * 7.7, Y[0] + 0.85), back);
    for (let k = 0; k + 1 < MEDIAN.length; k++) {
      const [w0, h0] = MEDIAN[k];
      const [w1, h1] = MEDIAN[k + 1];
      quad(conc, V(0, -w0, Y[0] + h0), V(0, w0, Y[0] + h0), V(0, w1, Y[0] + h1), V(0, -w1, Y[0] + h1), back);
    }
  }

  // Steel bents every ~22 m of the elevated span: a cap beam under the girders on two box columns standing on concrete
  // pedestals; lamps hang under the deck between them
  let iA = -1;
  let iB = -1;
  for (let i = 0; i < iMouth; i++) {
    if (!elevated(i)) continue;
    if (iA < 0) iA = i;
    iB = i + 1;
  }
  if (iA >= 0 && S[iB] - S[iA] > 30) {
    const at = (s) => {
      const i = iAt(s);
      const f = Math.min(1, Math.max(0, (s - S[i]) / (S[i + 1] - S[i])));
      const lerp = (a, b) => a + (b - a) * f;
      return { x: lerp(path[i].x, path[i + 1].x), z: lerp(path[i].y, path[i + 1].y), y: lerp(Y[i], Y[i + 1]), t: tan(i) };
    };
    const s0 = S[iA] + 9;
    const s1 = S[iB] - 9;
    const nB = Math.max(1, Math.round((s1 - s0) / 22));
    // A bent whose columns would stand in a street (not in the shore strip nor on a block) slides up to 6 m along
    const colsOK = (b) => [-5, 5].every((w) => groundOK(b.x - b.t.y * w, b.z + b.t.x * w));
    const bentS = [];
    for (let k = 0; k <= nB; k++) {
      const s = s0 + ((s1 - s0) * k) / nB;
      const ds = [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6].find((d) => colsOK(at(s + d)));
      bentS.push(s + (ds || 0));
    }
    bentS.forEach((sb, k) => {
      const b = at(sb);
      const capTop = b.y - SLAB - GIRDER;
      obox(steel, b.x, b.z, b.t, 0.6, 7.3, capTop - 1.0, capTop);
      for (const w of [-5, 5]) {
        const cx = b.x - b.t.y * w;
        const cz = b.z + b.t.x * w;
        obox(steel, cx, cz, b.t, 0.45, 0.45, 0.3, capTop - 1.0);
        obox(conc, cx, cz, b.t, 0.75, 0.75, -0.1, 0.3);
        colliders.push({ minX: cx - 0.8, maxX: cx + 0.8, minZ: cz - 0.8, maxZ: cz + 0.8, maxY: capTop });
      }
      if (k === nB) return;
      const m = at((sb + bentS[k + 1]) / 2);
      for (const w of [-4.65, 4.65]) underSpots.push([m.x - m.t.y * w, m.y - SLAB, m.z + m.t.x * w, Math.atan2(m.t.x, m.t.y)]);
    });
  }

  // Lane paint as on the at-grade highway (dashes continuing along the deck) into the tunnel mouth
  function line(w, width, col, period = 1, duty = 1) {
    let u = 0;
    for (let i = 0; i < Math.min(nP - 1, iMouth + 3); i++) {
      const a = V(i, w, Y[i] + 0.012);
      const b = V(i + 1, w, Y[i + 1] + 0.012);
      const flat = Math.hypot(b.x - a.x, b.z - a.z);
      const sx = ((a.z - b.z) / flat) * width * 0.5;
      const sz = ((b.x - a.x) / flat) * width * 0.5;
      const len = a.distanceTo(b);
      const k = paint.pos.length / 3;
      for (const [p, s, t] of [[a, -1, u], [a, 1, u], [b, 1, u + len], [b, -1, u + len]]) {
        paint.pos.push(p.x + sx * s, p.y, p.z + sz * s);
        paint.side.push(sx * s, sz * s);
        paint.paint.push(t, period, duty);
        paint.col.push(col.r, col.g, col.b);
      }
      paint.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      u += len;
    }
  }
  line(-7.05, 0.15, WHITE);
  line(-3.9, 0.13, WHITE, 12, 0.25);
  line(-0.55, 0.12, YELLOW);
  line(0.55, 0.12, YELLOW);
  line(3.9, 0.13, WHITE, 12, 0.25);
  line(7.05, 0.15, WHITE);

  // Twin-arm highway lights on the median, as at grade
  for (let s = 20; s < sMouth - 12; s += 39) {
    const i = iAt(s);
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(nP - 1, i + 1)];
    lightSpots.push([path[i].x, Y[i], path[i].y, Math.atan2(-(b.x - a.x), -(b.y - a.y))]);
  }

  // ---- Battery Park Underpass portal (buildUnderpassPortal) -------------------------------------------------------
  const portalFrames = [];
  for (let i = iMouth; i < nP; i++) portalFrames.push({ x: path[i].x, z: path[i].y, nx: pn[i].x, nz: pn[i].y, y: Y[i], half: HALF });
  buildUnderpassPortal(portalFrames, { deck, conc, roof, dark, shade }, quad, underSpots, colliders);

  // Player colliders: the ramps on fill once the road is ~0.35 m up (four boxes across every segment; the columns are
  // added with the bents, the portal's by buildUnderpassPortal)
  for (let i = 0; i < iMouth; i++) {
    if (elevated(i) || Math.max(Y[i], Y[i + 1]) < 0.35) continue;
    const hw = 7.9;
    const top = Math.max(Y[i], Y[i + 1]) + 0.85;
    for (let k = 0; k < 4; k++) {
      const w0 = -hw + (k * hw) / 2;
      const pts = [V(i, w0, 0), V(i, w0 + hw / 2, 0), V(i + 1, w0, 0), V(i + 1, w0 + hw / 2, 0)];
      colliders.push({
        minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
        minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z)), maxY: top
      });
    }
  }

  // ---- Meshes & keep-clear boxes ----------------------------------------------------------------------------------
  const addMesh = (A, mat, cast, name) => {
    if (!A.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(A.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // (the portal's materials are shared with West St's portal: portalMats)
  const portalMats = {
    conc: new THREE.MeshStandardNodeMaterial({ color: 0x8b877f, roughness: 0.9, metalness: 0.0 }),
    dark: new THREE.MeshBasicNodeMaterial({ color: 0x020203 }),
    shade: window.NYC.createTunnelShadeMaterial()
  };
  addMesh(deck, roadMat, false, 'SouthStreetViaductDeck');
  addMesh(conc, portalMats.conc, true, 'SouthStreetViaductConcrete');
  addMesh(steel, new THREE.MeshStandardNodeMaterial({ color: 0x55625b, roughness: 0.6, metalness: 0.3 }), true, 'SouthStreetViaductSteel');
  addMesh(roof, lawnMat, false, 'BatteryUnderpassRoof');
  addMesh(dark, portalMats.dark, false, 'BatteryUnderpassMouth');
  const shadeMesh = addMesh(shade, portalMats.shade, false, 'BatteryUnderpassShade');
  if (shadeMesh) shadeMesh.renderOrder = 1; // over the lane markings (renderOrder -1)

  // Buildings and trees keep 2.5 m clear of the deck edges (oriented boxes every ~12 m)
  const boxes = [];
  for (let i = 0; i < nP - 1; i += 4) {
    const j = Math.min(nP - 1, i + 4);
    const dx = path[j].x - path[i].x;
    const dz = path[j].y - path[i].y;
    const len = Math.hypot(dx, dz);
    boxes.push({ cx: (path[i].x + path[j].x) / 2, cz: (path[i].y + path[j].y) / 2, ux: dx / len, uz: dz / len, hl: len / 2 + 1, hw: HALF + 2.5 });
  }
  const lane = (o) => {
    const out = [];
    // ... going underground (4.7 m down over the last 30 m, past the dark screen) to join West St's lanes
    for (let i = 1; i < nP; i++) {
      const down = 4.7 * ss((S[i] - (L - 30)) / 30);
      out.push(new THREE.Vector3(path[i].x + pn[i].x * (o - 7.6), Y[i] - down, path[i].y + pn[i].y * (o - 7.6)));
    }
    return out;
  };
  return { lane, boxes, keepOut: (x, z, m = 0) => boxes.some((o) => inBox(o, x, z, m)), path, req, length: L, colliders, portalMats };
}

// =====================================================================================================================
// 11C. BATTERY PARK UNDERPASS PORTALS
// =====================================================================================================================

/**
 * A covered, lawn-topped portal of the Battery Park Underpass over a highway: thick concrete walls (inner faces at
 * ±half, outer at ±(half + 0.8)) under a lawn roof behind a low parapet, a headwall over the mouth, a dark screen ~7 m
 * in and an end wall at the far end. The bore darkens toward the screen (shade layer over road, walls & ceiling, uv.x =
 * fraction of the way to the screen) under two rows of ceiling lights; the traffic lanes dip underground behind it.
 * frames: cross-sections [{ x, z, nx, nz, y, half }] from the mouth to the far end: (nx, nz) the unit vector across the
 *   road, y the road level, half the half-width between the inner wall faces
 * acc: { deck (optional), conc, roof, dark, shade } accumulators for quad() (from buildManhattanWaterfrontEdge)
 * lights: the ceiling lights are pushed as [x, y, z, yaw, 'tunnel']; colliders: player AABBs (four across each segment)
 */
function buildUnderpassPortal(frames, acc, quad, lights, colliders) {
  const ROOF = 6.4; // lawn level
  const CEIL = ROOF - 0.8;
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const n = frames.length;
  const F = frames;
  // Point `e` m beyond the inner wall face on side sd (sd = 0: the centre line) of frame k, at height y
  const V = (k, sd, e, y) => {
    const w = sd * (F[k].half + e);
    return new THREE.Vector3(F[k].x + F[k].nx * w, y, F[k].z + F[k].nz * w);
  };
  const across = (k, s) => new THREE.Vector3(F[k].nx * s, 0, F[k].nz * s);
  const tan = (k) => {
    const a = F[Math.max(0, k - 1)];
    const b = F[Math.min(n - 1, k + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    return new THREE.Vector3((b.x - a.x) / l, 0, (b.z - a.z) / l);
  };
  const S = [0];
  for (let k = 1; k < n; k++) S.push(S[k - 1] + Math.hypot(F[k].x - F[k - 1].x, F[k].z - F[k - 1].z));
  // Quad between frames k and k + 1 through cross-section points [sd, e, y] (y absolute)
  const seg = (A, k, [s0, e0, y0], [s1, e1, y1], hint, u0, u1) =>
    quad(A, V(k, s0, e0, y0), V(k + 1, s0, e0, y0), V(k + 1, s1, e1, y1), V(k, s1, e1, y1), hint, u0, u1);

  for (let k = 0; k < n - 1; k++) {
    if (acc.deck) quad(acc.deck, V(k, -1, 0, F[k].y), V(k + 1, -1, 0, F[k + 1].y), V(k + 1, 1, 0, F[k + 1].y), V(k, 1, 0, F[k].y), UP);
    for (const sd of [-1, 1]) {
      seg(acc.conc, k, [sd, 0, 0], [sd, 0, CEIL], across(k, -sd));
      seg(acc.conc, k, [sd, 0.8, 0], [sd, 0.8, ROOF + 0.35], across(k, sd));
      seg(acc.conc, k, [sd, 0.8, ROOF + 0.35], [sd, 0.35, ROOF + 0.35], UP);
      seg(acc.conc, k, [sd, 0.35, ROOF], [sd, 0.35, ROOF + 0.35], across(k, -sd));
    }
    seg(acc.conc, k, [-1, 0, CEIL], [1, 0, CEIL], DOWN);
    seg(acc.roof, k, [-1, 0.35, ROOF], [1, 0.35, ROOF], UP);
  }

  // Mouth: wall ends, the headwall over the opening (0.7 m deep), the dark screen; the end wall at the far end
  const t0 = tan(0);
  const face = t0.clone().negate(); // toward the oncoming traffic
  for (const sd of [-1, 1]) quad(acc.conc, V(0, sd, 0, 0), V(0, sd, 0.8, 0), V(0, sd, 0.8, CEIL), V(0, sd, 0, CEIL), face);
  const hw = (a, sd, y) => V(0, sd, 0.8, y).addScaledVector(t0, a);
  for (const [a, hint] of [[0, face], [0.7, t0]]) quad(acc.conc, hw(a, -1, CEIL), hw(a, 1, CEIL), hw(a, 1, ROOF + 0.9), hw(a, -1, ROOF + 0.9), hint);
  quad(acc.conc, hw(0, -1, ROOF + 0.9), hw(0, 1, ROOF + 0.9), hw(0.7, 1, ROOF + 0.9), hw(0.7, -1, ROOF + 0.9), UP);
  quad(acc.conc, hw(0, -1, CEIL), hw(0, 1, CEIL), hw(0.7, 1, CEIL), hw(0.7, -1, CEIL), DOWN);
  for (const sd of [-1, 1]) quad(acc.conc, hw(0, sd, CEIL), hw(0.7, sd, CEIL), hw(0.7, sd, ROOF + 0.9), hw(0, sd, ROOF + 0.9), across(0, sd));
  let kO = 1;
  while (kO + 1 < n - 1 && S[kO + 1] <= 7) kO++;
  quad(acc.dark, V(kO, -1, 0, 0), V(kO, 1, 0, 0), V(kO, 1, 0, CEIL), V(kO, -1, 0, CEIL), face);
  quad(acc.conc, V(n - 1, -1, 0.8, 0), V(n - 1, 1, 0.8, 0), V(n - 1, 1, 0.8, ROOF + 0.35), V(n - 1, -1, 0.8, ROOF + 0.35), tan(n - 1));

  // Shade layer up to the screen and two rows of ceiling lights 1.6 & 4.2 m in
  const dO = S[kO];
  for (let k = 0; k < kO; k++) {
    const u0 = S[k] / dO;
    const u1 = S[k + 1] / dO;
    quad(acc.shade, V(k, -1, 0, F[k].y + 0.03), V(k + 1, -1, 0, F[k + 1].y + 0.03), V(k + 1, 1, 0, F[k + 1].y + 0.03), V(k, 1, 0, F[k].y + 0.03), UP, u0, u1);
    for (const sd of [-1, 1]) seg(acc.shade, k, [sd, -0.02, 0], [sd, -0.02, CEIL], across(k, -sd), u0, u1);
    seg(acc.shade, k, [-1, 0, CEIL - 0.02], [1, 0, CEIL - 0.02], DOWN, u0, u1);
  }
  for (const dd of [1.6, 4.2]) {
    if (dd > dO - 0.7) continue;
    let k = 0;
    while (k < kO - 1 && S[k + 1] <= dd) k++;
    const f = (dd - S[k]) / (S[k + 1] - S[k]);
    const t = tan(k);
    for (const w of [-3.9, 3.9]) {
      const x = F[k].x + (F[k + 1].x - F[k].x) * f + F[k].nx * w;
      const z = F[k].z + (F[k + 1].z - F[k].z) * f + F[k].nz * w;
      lights.push([x, CEIL, z, Math.atan2(t.x, t.z), 'tunnel']);
    }
  }

  // Player colliders: four boxes across every segment, up to the parapet
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < 4; j++) {
      const pts = [];
      for (const kk of [k, k + 1]) {
        const w = F[kk].half + 0.8;
        for (const a of [j, j + 1]) {
          const ww = -w + (a * w) / 2;
          pts.push(new THREE.Vector3(F[kk].x + F[kk].nx * ww, 0, F[kk].z + F[kk].nz * ww));
        }
      }
      colliders.push({
        minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
        minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z)), maxY: ROOF + 0.35
      });
    }
  }
  return { S, kO };
}

Object.assign(window.NYC, { buildCityGrid, batchStaticGroupMeshes });
})();
