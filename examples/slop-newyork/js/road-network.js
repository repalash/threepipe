(function () {
// js/road-network.js
// Drivable road graph derived from the ground layout that city-grid.js actually builds: avenue corridors
// between the raised curbs, cross-street gaps between curb rows, lanes that keep clear of medians, plazas
// and steam stacks, intersections (signalized where street-details.js mounts signal heads) and the
// lane-to-lane curves used to drive straight through them or turn.
//
// Conventions: north = -z, east = +x. Every directed edge has a unit direction (dx, dz) and a right normal
// (rx, rz) = (-dz, dx). Lanes are lateral offsets to the right of the centreline, sorted left to right.

const { ALL_AVENUES, ALL_STREETS, AVENUES, STREETS, ISLAND_BOUNDS, getIslandBoundsAtZ } = window.NYC;

const CELL = 32;
const Z_MIN = Math.floor(ISLAND_BOUNDS.minZ) - 20; // the detailed island, ~129th St to the Battery
const Z_MAX = Math.ceil(ISLAND_BOUNDS.maxZ) + 20;
const LANE_CLEAR = 1.2; // half width each lane keeps free of obstacles
const CROSSWALK = 2.5; // depth between an intersection box and its stop lines
const SHORE_MARGIN = 6;

function buildRoadNetwork(sidewalks, obstacles) {
  // 1. Spatial hash of ground footprints: curbs bound the roads, everything else also blocks pedestrians
  const hash = new Map();
  const cellKey = (ix, iz) => (ix + 512) * 1024 + iz + 512;

  function insert(r) {
    for (let ix = Math.floor(r.minX / CELL); ix <= Math.floor(r.maxX / CELL); ix++) {
      for (let iz = Math.floor(r.minZ / CELL); iz <= Math.floor(r.maxZ / CELL); iz++) {
        const k = cellKey(ix, iz);
        if (!hash.has(k)) hash.set(k, []);
        hash.get(k).push(r);
      }
    }
  }
  for (const r of sidewalks) insert({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, curb: true });
  for (const r of obstacles) insert(r);

  // Calls fn(rect) for every footprint overlapping the box until fn returns true
  function query(minX, maxX, minZ, maxZ, fn) {
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const list = hash.get(cellKey(ix, iz));
        if (!list) continue;
        for (const r of list) {
          if (r.minX < maxX && r.maxX > minX && r.minZ < maxZ && r.maxZ > minZ && fn(r)) return true;
        }
      }
    }
    return false;
  }

  function onLand(minX, maxX, minZ, maxZ) {
    for (const z of [minZ, maxZ]) {
      const shore = getIslandBoundsAtZ(z);
      if (minX < shore.westX + SHORE_MARGIN || maxX > shore.eastX - SHORE_MARGIN) return false;
    }
    return true;
  }

  const blocked = (minX, maxX, minZ, maxZ) => !onLand(minX, maxX, minZ, maxZ) || query(minX, maxX, minZ, maxZ, () => true);
  const walkable = (minX, maxX, minZ, maxZ) => onLand(minX, maxX, minZ, maxZ) && !query(minX, maxX, minZ, maxZ, (r) => !r.curb);
  const onSidewalk = (x, z) => query(x, x, z, z, (r) => r.curb);
  // The same test for the centreline streets (4b), which follow the real streets: the rectangles standing in for
  // irregular sidewalks may reach a little past their curbs, a whole park's bounds take in the streets around it and a
  // median mall's bounds (Allen St, Chrystie St...) both its roadways, so only a curb right at (x, z), median malls by
  // their real outline and other obstacles under 50 m across count
  const MEDIANS = window.NYC.BLOCKS.filter((b) => b.median);
  const medianBox = (r) => MEDIANS.some((b) => Math.abs(b.minX - r.minX) < 0.6 && Math.abs(b.maxX - r.maxX) < 0.6 && Math.abs(b.minZ - r.minZ) < 0.6 && Math.abs(b.maxZ - r.maxZ) < 0.6);
  const medianCells = new Map(); // 64 m cells -> the medians reaching into them
  for (const b of MEDIANS) {
    for (let ix = Math.floor((b.minX - 2) / 64); ix <= Math.floor((b.maxX + 2) / 64); ix++) {
      for (let iz = Math.floor((b.minZ - 2) / 64); iz <= Math.floor((b.maxZ + 2) / 64); iz++) {
        const k = ix * 100000 + iz;
        if (!medianCells.has(k)) medianCells.set(k, []);
        medianCells.get(k).push(b);
      }
    }
  }
  function nearMedian(x, z, clear) {
    for (const b of medianCells.get(Math.floor(x / 64) * 100000 + Math.floor(z / 64)) || []) {
      if (x < b.minX - clear || x > b.maxX + clear || z < b.minZ - clear || z > b.maxZ + clear) continue;
      let inside = false;
      const P = b.poly;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const a = P[i];
        const c = P[j];
        if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside;
        const ex = c.x - a.x;
        const ez = c.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
        if (Math.hypot(a.x + ex * t - x, a.z + ez * t - z) < clear) return true;
      }
      if (inside) return true;
    }
    return false;
  }
  const blockedOnStreet = (x, z, clear) => !onLand(x - clear, x + clear, z - clear, z + clear) ||
    query(x - 0.3, x + 0.3, z - 0.3, z + 0.3, (r) => r.curb) ||
    nearMedian(x, z, clear) ||
    query(x - clear, x + clear, z - clear, z + clear, (r) => !r.curb && (r.maxX - r.minX < 50 || r.maxZ - r.minZ < 50) && !medianBox(r));

  // 2. Avenue corridors: the most common curb-to-curb gap around each avenue's nominal x along its own stretches
  //    (CSCL: an avenue only exists between its ends, e.g. Irving Pl 14th-20th St, so it never claims a neighbour's
  //    roadway), and the stretches of z (at least 30 m long) where at least one of its lanes is clear. Each stretch
  //    keeps its real direction: two-way stretches (Central Park West, West End Ave, York Ave...) carry half of the
  //    lanes each way
  const laneOffsets = (half) => (half >= 10.0 ? [-7.2, -3.6, 0, 3.6, 7.2]
    : half >= 8.5 ? [-5.4, -1.8, 1.8, 5.4]
      : half >= 6.8 ? [-3.6, 0, 3.6]
        : half >= 4.4 ? [-1.8, 1.8] : null);
  const avenues = [];
  for (const ave of ALL_AVENUES) {
    if (ave.isHighway) continue;
    const segs = ave.segs || [{ z0: ave.minZ, z1: ave.maxZ, dir: ave.dir }];
    // the avenue's stretch at z (or the nearest one within an intersection's reach of its ends)
    const segAt = (z) => {
      let best = null;
      let bestD = 15;
      for (const s of segs) {
        const d = z < s.z0 ? s.z0 - z : z > s.z1 ? z - s.z1 : 0;
        if (d <= bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    };
    const votes = new Map();
    for (let z = Z_MIN; z <= Z_MAX; z += 2) {
      if (!segAt(z)) continue;
      let left = -Infinity;
      let right = Infinity;
      let inside = false;
      query(ave.x - 20, ave.x + 20, z, z, (r) => {
        if (!r.curb) return false;
        if (r.maxX <= ave.x) left = Math.max(left, r.maxX);
        else if (r.minX >= ave.x) right = Math.min(right, r.minX);
        else inside = true;
        return false;
      });
      if (inside || left === -Infinity || right === Infinity) continue;
      const k = `${left}:${right}`;
      votes.set(k, (votes.get(k) || 0) + 1);
    }
    let best = null;
    for (const [k, n] of votes) if (!best || n > votes.get(best)) best = k;
    if (!best) continue;
    const [left, right] = best.split(':').map(Number);
    const half = (right - left) / 2;

    // Physical lane offsets from the corridor centre for southbound (+z) and northbound (-z) traffic, by direction
    // of the stretch (1: southbound, -1: northbound, 0: two-way)
    let byDir;
    if (ave.hasMedian) {
      // Park Ave: three lanes each way either side of the planted malls (lanes in the malls drop out below)
      const both = { south: [-11.4, -7.8, -4.2], north: [4.2, 7.8, 11.4] };
      byDir = { 1: both, '-1': both, 0: both };
    } else {
      // Real curb-to-curb roadways (CSCL): 21.3 m (8th, 3rd, 1st, 11th Aves) carry five lanes, 18.3 m (7th, 9th,
      // 10th, 2nd Aves) four, 14.6-15.8 m (5th, Madison, Lexington Aves) three
      const lanes = laneOffsets(half);
      if (!lanes) continue;
      byDir = {
        1: { south: lanes, north: [] },
        '-1': { south: [], north: lanes },
        0: { south: lanes.filter((o) => o < -0.5), north: lanes.filter((o) => o > 0.5) }
      };
    }
    const lanesAt = (z) => {
      const s = segAt(z);
      return s ? byDir[Math.sign(s.dir || 0)] : null;
    };

    const x = (left + right) / 2;
    const free = new Uint8Array(Z_MAX - Z_MIN + 1);
    for (let i = 0; i < free.length; i++) {
      const z = Z_MIN + i;
      const set = lanesAt(z);
      if (!set) continue;
      free[i] = [...set.south, ...set.north].some((o) => !blocked(x + o - LANE_CLEAR, x + o + LANE_CLEAR, z - 0.5, z + 0.5)) ? 1 : 0;
    }
    for (let i = 0; i < free.length;) {
      let j = i;
      while (j < free.length && free[j] === free[i]) j++;
      if (free[i] && j - i < 30) free.fill(0, i, j);
      i = j;
    }
    avenues.push({ index: avenues.length, name: ave.short, x, half, lanesAt, free, nodes: [] });
  }
  avenues.sort((a, b) => a.x - b.x);
  if (window.NYC.DEBUG_ROADS !== false) {
    console.info('[roads] avenues', avenues.map((a) => `${a.name} x=${a.x.toFixed(1)} half=${a.half.toFixed(1)} free=${(a.free.reduce((s, v) => s + v, 0) / 1000).toFixed(1)}km`).join(' | '));
  }

  // 3. Cross streets: free z intervals of the line joining two neighbouring active avenue corridors
  const pieces = [];
  const runs = new Map();
  for (let i = 0; i <= Z_MAX - Z_MIN; i++) {
    const z = Z_MIN + i;
    const seen = new Set();
    let prev = null;
    for (const a of avenues) {
      if (!a.free[i]) continue;
      if (prev && !blocked(prev.x + prev.half, a.x - a.half, z - 0.5, z + 0.5)) {
        const k = prev.index * 64 + a.index;
        seen.add(k);
        if (!runs.has(k)) runs.set(k, { a: prev, b: a, z0: z });
      }
      prev = a;
    }
    for (const [k, run] of runs) {
      if (seen.has(k)) continue;
      runs.delete(k);
      const gap = z - run.z0;
      if (gap >= 7) pieces.push({ a: run.a, b: run.b, z: (run.z0 + z - 1) / 2, gap }); // streets are ~9-10 m curb to curb
    }
  }

  // One-way or two-way from the nearest named street inside the gap (majors and wide gaps are two-way)
  for (const p of pieces) {
    let st = null;
    for (const s of ALL_STREETS) {
      if (Math.abs(s.z - p.z) <= p.gap / 2 && (!st || Math.abs(s.z - p.z) < Math.abs(st.z - p.z))) st = s;
    }
    const twoWay = !st || st.dir === 0 || p.gap >= 20;
    const pair = p.gap >= 17 ? [1.8, 5.4] : [1.8];
    p.east = twoWay ? pair : st.dir > 0 ? [-1.8, 1.8] : [];
    p.west = twoWay ? pair : st.dir < 0 ? [-1.8, 1.8] : [];
  }

  // 4. Intersections: street ends on avenue corridors (merged within 6 m)
  let nodes = [];
  function nodeAt(a, z) {
    for (const n of a.nodes) if (Math.abs(n.z - z) < 6) return n;
    const n = { x: a.x, z, avenue: a, hx: a.half, hz: 0, signal: false, in: [], out: [] };
    a.nodes.push(n);
    nodes.push(n);
    return n;
  }
  for (const p of pieces) {
    p.half = (p.gap + 1) / 2; // the gap counts the free 1 m steps between the curbs
    p.from = nodeAt(p.a, p.z);
    p.to = nodeAt(p.b, p.z);
    for (const n of [p.from, p.to]) n.hz = Math.max(n.hz, Math.abs(p.z - n.z) + Math.min(p.half, 13));
  }

  // 4b. Where the grid ends: Lower Manhattan's streets (south of 14th St and Houston St, Broadway below 10th St...) from
  //     the street centreline graph (GEO.roadGraph, tools/geo-roadgraph.mjs), minus the links the grid corridors above
  //     already carry. Its junctions join the grid where they meet it (at a grid intersection, on an avenue corridor or a
  //     cross street); a street's bends get shape nodes, so every edge stays straight.
  const genRuns = centrelineStreets();
  function centrelineStreets() {
    const RG = window.NYC.GEO.roadGraph;
    const runs = [];
    if (!RG) return runs;
    const pos = [];
    for (let i = 0; i < RG.nodes.length; i += 2) pos.push({ x: RG.nodes[i], z: RG.nodes[i + 1] });
    const pieceRows = new Map();
    for (const p of pieces) {
      const k = Math.floor(p.z / 16);
      for (const kk of [k - 1, k, k + 1]) {
        if (!pieceRows.has(kk)) pieceRows.set(kk, []);
        pieceRows.get(kk).push(p);
      }
    }
    // The grid corridor at (x, z): an avenue's free stretch, or a cross street between two avenues (`inner`: clear of
    // the avenues' roadways)
    const aveAt = (x, z, margin) => {
      const i = Math.round(z) - Z_MIN;
      for (const a of avenues) if (Math.abs(x - a.x) <= a.half + margin && i >= 0 && i < a.free.length && a.free[i]) return a;
      return null;
    };
    const pieceAt = (x, z, margin, inner) => {
      for (const p of pieceRows.get(Math.floor(z / 16)) || []) {
        if (Math.abs(z - p.z) > p.half + margin) continue;
        if (inner ? x > p.a.x + p.a.half + 4 && x < p.b.x - p.b.half - 4 : x > p.a.x - 2 && x < p.b.x + 2) return p;
      }
      return null;
    };
    // Points every 4 m along a polyline, 7 m clear of its ends, with the direction there
    function samples(pts, fn) {
      let total = 0;
      for (let k = 0; k + 1 < pts.length; k++) total += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z);
      const from = Math.min(7, total / 2);
      let s0 = 0;
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 1e-6) continue;
        for (let s = Math.max(from, Math.ceil(s0 / 4) * 4); s <= Math.min(s0 + L, total - from); s += 4) {
          const t = (s - s0) / L;
          fn(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, (b.x - a.x) / L, (b.z - a.z) / L);
        }
        s0 += L;
      }
      return total;
    }
    // Links the grid already carries: most of their length runs along an avenue (north-south) or a cross street
    const links = [];
    for (const [a, b, ni, w, lanes, dir, inner] of RG.links) {
      const pts = [pos[a]];
      for (let k = 0; k < inner.length; k += 2) pts.push({ x: inner[k], z: inner[k + 1] });
      pts.push(pos[b]);
      let n = 0;
      let hit = 0;
      const len = samples(pts, (x, z, dx, dz) => {
        n++;
        if ((Math.abs(dz) > 0.94 && aveAt(x, z, 1.5)) || (Math.abs(dx) > 0.94 && pieceAt(x, z, 1.5, false))) hit++;
      });
      if (n && hit > n * 0.5) continue;
      links.push({ a, b, name: RG.names[ni], w, lanes, dir, pts, len });
    }
    // Junctions a few metres apart (divided roads, offset corners) are one: collapse links under 14 m
    const parent = pos.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const l of links) if (l.len < 14) parent[find(l.a)] = find(l.b);
    const sum = new Map();
    const counted = new Set();
    for (const l of links) {
      for (const i of [l.a, l.b]) {
        if (counted.has(i)) continue;
        counted.add(i);
        const r = find(i);
        const s = sum.get(r) || { x: 0, z: 0, n: 0 };
        s.x += pos[i].x;
        s.z += pos[i].z;
        s.n++;
        sum.set(r, s);
      }
    }
    // A junction joins the grid at a grid intersection within 12 m, on an avenue corridor or a cross street it lies on,
    // or stands on its own
    const junctions = new Map();
    const gridCells = new Map(); // 32 m cells -> grid nodes
    const indexNode = (g) => {
      const k = Math.floor(g.x / 32) * 100000 + Math.floor(g.z / 32);
      if (!gridCells.has(k)) gridCells.set(k, []);
      gridCells.get(k).push(g);
    };
    for (const g of nodes) indexNode(g);
    function junction(r) {
      if (junctions.has(r)) return junctions.get(r);
      const s = sum.get(r);
      const x = s.x / s.n;
      const z = s.z / s.n;
      let node = null;
      let bd = 12;
      for (let ix = Math.floor((x - 12) / 32); ix <= Math.floor((x + 12) / 32); ix++) {
        for (let iz = Math.floor((z - 12) / 32); iz <= Math.floor((z + 12) / 32); iz++) {
          for (const g of gridCells.get(ix * 100000 + iz) || []) {
            const d = Math.hypot(g.x - x, g.z - z);
            if (d < bd) {
              bd = d;
              node = g;
            }
          }
        }
      }
      if (!node) {
        const a = aveAt(x, z, 3);
        if (a) {
          node = nodeAt(a, z);
          node.hz = Math.max(node.hz, 7);
          indexNode(node);
        }
      }
      if (!node) {
        const p = pieceAt(x, z, 3, true);
        if (p) {
          node = { x, z: p.z, hx: 7, hz: p.half, signal: false, in: [], out: [] };
          nodes.push(node);
          (p.mids || (p.mids = [])).push(node);
          indexNode(node);
        }
      }
      if (!node) {
        node = { x, z, hx: 0, hz: 0, signal: false, in: [], out: [], general: true };
        nodes.push(node);
      }
      junctions.set(r, node);
      return node;
    }
    // Lanes by the street's real curb-to-curb width and direction of travel: one-way streets as wide as the grid's
    // (two lanes from ~9 m), two-way ones a lane each way (two each way from 17 m). Wide or named avenues are major.
    const MAJOR = /\bAVE\b|AVENUE|BROADWAY|BOWERY|BLVD|PARK ROW/;
    function lanesOf(l) {
      const w = l.w > 3 ? l.w : MAJOR.test(l.name) ? 18 : 9.1;
      const half = w / 2;
      const axis = w >= 14.5 || l.lanes >= 3 || MAJOR.test(l.name) ? 'ave' : 'st';
      if (l.dir !== 0) {
        const lanes = laneOffsets(half) || [0];
        return { half, axis, fwd: l.dir > 0 ? lanes : [], back: l.dir < 0 ? lanes : [] };
      }
      const each = half >= 8.5 ? [1.8, 5.4] : [1.8];
      return { half, axis, fwd: each, back: each };
    }
    const DEG = Math.PI / 180;
    for (const l of links) {
      const A = junction(find(l.a));
      const B = junction(find(l.b));
      if (A === B) continue;
      const pts = [{ x: A.x, z: A.z }, ...l.pts.slice(1, -1), { x: B.x, z: B.z }];
      // stations along it: the ends and every bend over 12° at least 15 m from the last station and from the far end
      const stations = [A];
      let last = pts[0];
      let rest = l.len;
      for (let k = 1; k < pts.length - 1; k++) {
        const p1 = pts[k];
        const p2 = pts[k + 1];
        const d0 = Math.hypot(p1.x - last.x, p1.z - last.z);
        rest -= Math.hypot(p1.x - pts[k - 1].x, p1.z - pts[k - 1].z);
        let turn = Math.abs(Math.atan2(p2.z - p1.z, p2.x - p1.x) - Math.atan2(p1.z - last.z, p1.x - last.x));
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (turn < 12 * DEG || d0 < 15 || rest < 15) continue;
        const s = { x: p1.x, z: p1.z, hx: 0, hz: 0, signal: false, in: [], out: [], general: true, shape: true };
        nodes.push(s);
        stations.push(s);
        last = p1;
      }
      stations.push(B);
      const lanes = lanesOf(l);
      for (let k = 0; k + 1 < stations.length; k++) runs.push({ from: stations[k], to: stations[k + 1], ...lanes });
    }
    if (window.NYC.DEBUG_ROADS !== false) console.info(`[roads] centreline streets: ${links.length} links not on the grid, ${runs.length} straight runs`);
    return runs;
  }

  // 5. Directed edges between intersections, keeping only the lanes clear of obstacles node to node
  let edges = [];
  function addEdge(from, to, axis, x0, z0, x1, z1, lanes, half) {
    const span = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / span;
    const dz = (z1 - z0) / span;
    const open = lanes.filter((o) => {
      const ax = x0 - dz * o;
      const az = z0 + dx * o;
      const cx = Math.abs(dz) * LANE_CLEAR;
      const cz = Math.abs(dx) * LANE_CLEAR;
      return !blocked(Math.min(ax, ax + dx * span) - cx, Math.max(ax, ax + dx * span) + cx,
        Math.min(az, az + dz * span) - cz, Math.max(az, az + dz * span) + cz);
    });
    if (!open.length) return;
    edges.push({ from, to, axis, x0, z0, dx, dz, rx: -dz, rz: dx, span, half, lanes: open.sort((p, q) => p - q), moves: [] });
  }
  for (const a of avenues) {
    a.nodes.sort((m, n) => m.z - n.z);
    for (let k = 0; k + 1 < a.nodes.length; k++) {
      const n0 = a.nodes[k];
      const n1 = a.nodes[k + 1];
      let connected = true;
      for (let z = Math.ceil(n0.z); z <= n1.z && connected; z++) connected = a.free[z - Z_MIN] === 1;
      if (!connected) continue;
      const set = a.lanesAt((n0.z + n1.z) * 0.5) || a.lanesAt(n0.z) || a.lanesAt(n1.z);
      if (!set) continue;
      addEdge(n0, n1, 'ave', a.x, n0.z, a.x, n1.z, set.south.map((o) => -o), a.half);
      addEdge(n1, n0, 'ave', a.x, n1.z, a.x, n0.z, set.north, a.half);
    }
  }
  for (const p of pieces) {
    // a cross street runs between its two avenue nodes, through any centreline junctions on it (see 4b)
    const chain = [p.from, ...(p.mids || []).sort((m, n) => m.x - n.x), p.to];
    for (let k = 0; k + 1 < chain.length; k++) {
      const m = chain[k];
      const n = chain[k + 1];
      addEdge(m, n, 'st', m.x, p.z, n.x, p.z, p.east, p.half);
      addEdge(n, m, 'st', n.x, p.z, m.x, p.z, p.west, p.half);
    }
  }
  // Centreline streets: any direction, so their lanes are checked for obstacles every 2.5 m (clear of the junctions,
  // where neighbouring corners would get in the way of the test) instead of over one bounding box
  const laneOpen = (x0, z0, dx, dz, span, o) => {
    const clear = Math.min(12, span / 2);
    for (let t = clear; t <= span - clear + 1e-6; t += 2.5) {
      if (blockedOnStreet(x0 + dx * t - dz * o, z0 + dz * t + dx * o, LANE_CLEAR)) return false;
    }
    return true;
  };
  function addEdgeGeneral(from, to, axis, lanes, half, divided) {
    const x0 = from.x;
    const z0 = from.z;
    const span = Math.hypot(to.x - x0, to.z - z0);
    if (span < 8) return;
    const dx = (to.x - x0) / span;
    const dz = (to.z - z0) / span;
    const open = lanes.filter((o) => laneOpen(x0, z0, dx, dz, span, o));
    if (!open.length) return;
    edges.push({ from, to, axis, x0, z0, dx, dz, rx: -dz, rz: dx, span, half, lanes: open.sort((p, q) => p - q), moves: [], general: true, cand: lanes, divided: !!divided });
  }
  // A divided road drawn as two one-way roadways between the same two junctions (most of the Bowery) runs both ways
  // along one centreline here: each way keeps to the right of it, as on a two-way street, and the road is as wide as
  // both roadways
  const travel = (r) => (r.fwd.length ? [r.from, r.to] : [r.to, r.from]);
  const oneWays = new Map(); // node -> next node -> the one-way run from one to the other
  for (const r of genRuns) {
    if (!r.fwd.length === !r.back.length) continue;
    const [a, b] = travel(r);
    if (!oneWays.has(a)) oneWays.set(a, new Map());
    oneWays.get(a).set(b, r);
  }
  for (const r of genRuns) {
    if (!r.fwd.length === !r.back.length || r.divided) continue;
    const [a, b] = travel(r);
    const o = oneWays.has(b) && oneWays.get(b).get(a);
    if (!o || o.divided) continue;
    for (const q of [r, o]) {
      const lanes = q.fwd.length ? q.fwd : q.back;
      const right = lanes.map((x) => x - lanes[0] + 1.8); // as on a two-way street, from 1.8 m right of the centreline
      if (q.fwd.length) q.fwd = right;
      else q.back = right;
      q.divided = true;
    }
    r.half = o.half = r.half + o.half;
    if (r.half >= 7.25) r.axis = o.axis = 'ave'; // as wide as a major road (see lanesOf)
  }
  for (const r of genRuns) {
    if (r.fwd.length) addEdgeGeneral(r.from, r.to, r.axis, r.fwd, r.half, r.divided);
    if (r.back.length) addEdgeGeneral(r.to, r.from, r.axis, r.back, r.half, r.divided);
  }
  // Two edges from one node to the same next one (a service road whose ends were drawn onto its main road's junctions)
  // would drive through each other: keep the grid's, else the one with the most lanes
  const keptEdge = new Map();
  const edgeRank = (e) => (e.general ? 0 : 1000) + e.lanes.length * 10 + e.half / 100;
  for (const e of edges) {
    let to = keptEdge.get(e.from);
    if (!to) keptEdge.set(e.from, (to = new Map()));
    const o = to.get(e.to);
    if (!o || edgeRank(e) > edgeRank(o)) to.set(e.to, e);
  }
  edges = edges.filter((e) => keptEdge.get(e.from).get(e.to) === e);
  // ...and where only some of the junctions on both sides of its median became one (Pike St), the stretches of its two
  // roadways that run on top of each other the same way
  {
    const oneWay = edges.filter((e) => e.general && !e.divided && e.cand[0] <= 0); // lanes about its centreline
    const cells = new Map(); // 16 m cells -> the one-way edges passing within 4 m
    oneWay.forEach((e, i) => {
      e.oneWay = i;
      for (let t = 0; t <= e.span; t += 8) {
        const x = e.x0 + e.dx * t;
        const z = e.z0 + e.dz * t;
        for (let ix = Math.floor((x - 4) / 16); ix <= Math.floor((x + 4) / 16); ix++) {
          for (let iz = Math.floor((z - 4) / 16); iz <= Math.floor((z + 4) / 16); iz++) {
            const k = (ix + 4096) * 8192 + (iz + 4096);
            const list = cells.get(k);
            if (!list) cells.set(k, [e]);
            else if (list[list.length - 1] !== e) list.push(e);
          }
        }
      }
    });
    // metres of e along f whose lanes come within 3 m of f's (e's right is f's left)
    const onTop = (e, f) => {
      let hits = 0;
      for (let t = 0; t <= e.span; t += 2) {
        const px = e.x0 + e.dx * t - f.x0;
        const pz = e.z0 + e.dz * t - f.z0;
        const u = px * f.dx + pz * f.dz;
        if (u < 0 || u > f.span) continue;
        const side = px * f.rx + pz * f.rz;
        if (e.lanes.some((a) => f.lanes.some((b) => Math.abs(side - a - b) < 3))) hits += 2;
      }
      return hits;
    };
    const partner = new Map(); // edge -> half width of the widest roadway running the other way on top of it
    const tested = new Set();
    for (const list of cells.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const e = list[i];
          const f = list[j];
          if (e.dx * f.dx + e.dz * f.dz > -0.94) continue; // the other way, within 20°
          const key = Math.min(e.oneWay, f.oneWay) * 65536 + Math.max(e.oneWay, f.oneWay);
          if (tested.has(key)) continue;
          tested.add(key);
          if (Math.max(onTop(e, f), onTop(f, e)) < 6) continue;
          partner.set(e, Math.max(partner.get(e) || 0, f.half));
          partner.set(f, Math.max(partner.get(f) || 0, e.half));
        }
      }
    }
    for (const [e, other] of partner) {
      e.lanes = e.cand.map((o) => o - e.cand[0] + 1.8).filter((o) => laneOpen(e.x0, e.z0, e.dx, e.dz, e.span, o));
      e.half += other;
      if (e.half >= 7.25) e.axis = 'ave'; // as wide as a major road (see lanesOf)
      e.divided = true;
    }
    edges = edges.filter((e) => e.lanes.length);
  }
  // Edges no vehicle could both reach and leave (dead ends, and roads reached only from them) are dropped once the
  // moves are known (7.); know them already, so that no road keeps clear of a dead one merging with it or forking off it
  {
    const outsOf = new Map();
    for (const e of edges) {
      if (!outsOf.has(e.from)) outsOf.set(e.from, []);
      outsOf.get(e.from).push(e);
    }
    const live = largestComponent(edges, (e) => (outsOf.get(e.to) || []).filter((f) => f.to !== e.from && e.dx * f.dx + e.dz * f.dz >= -0.5));
    for (const e of edges) e.live = live.has(e);
  }
  const liveArm = (a) => !!((a.in && a.in.live) || (a.out && a.out.live));

  // The roads meeting at each node ("arms": one per direction a road leaves it in), from the edges into and out of it:
  // { ux, uz } (unit, away from the node), half (the widest roadway's half width), ave (a major road's), and its edge
  // `in` and edge `out`, if any. The two ways of a two-way street share an arm, and so do the two one-way roadways of a
  // divided road (within 20° of each other); a second road arriving or leaving within 20° of another (where streets
  // merge or fork) gets an arm of its own. With `only`, for just the nodes in that set.
  function computeArms(list, only = null) {
    for (const n of only || nodes) n.arms = [];
    const ends = new Map(); // node -> the edge ends there, in the order the edges come
    list.forEach((e, i) => {
      for (const [n, role, ux, uz] of [[e.from, 'out', e.dx, e.dz], [e.to, 'in', -e.dx, -e.dz]]) {
        if (only && !only.has(n)) continue;
        if (role === 'out') e.outArm = null;
        else e.inArm = null;
        if (!ends.has(n)) ends.set(n, []);
        ends.get(n).push({ e, role, ux, uz, order: 2 * i + (role === 'in' ? 1 : 0) });
      }
    });
    const armed = (q) => (q.role === 'out' ? q.e.outArm : q.e.inArm);
    for (const [n, at] of ends) {
      // arms in the order of their first edge end, each pointing along it
      const newArm = (q) => {
        const a = { ux: q.ux, uz: q.uz, half: 0, ave: false, in: null, out: null, order: q.order };
        n.arms.push(a);
        return a;
      };
      const join = (a, q) => {
        a[q.role] = q.e;
        if (q.role === 'out') q.e.outArm = a;
        else q.e.inArm = a;
        a.half = Math.max(a.half, q.e.half);
        a.ave = a.ave || q.e.axis === 'ave';
        a.order = Math.min(a.order, q.order);
      };
      // both ways of a two-way street
      for (const q of at) {
        if (q.role !== 'out') continue;
        const r = at.find((p) => p.role === 'in' && p.e.from === q.e.to);
        if (!r) continue;
        const a = newArm(q.order < r.order ? q : r);
        join(a, q);
        join(a, r);
      }
      // one-way roadways within 20°, one each way: a divided road's, the best aligned first
      const pairs = [];
      for (const q of at) {
        if (q.role !== 'out' || armed(q)) continue;
        for (const r of at) {
          const d = q.ux * r.ux + q.uz * r.uz;
          if (r.role === 'in' && !armed(r) && d > 0.94) pairs.push([d, q, r]);
        }
      }
      pairs.sort((p, q) => q[0] - p[0]);
      for (const [, q, r] of pairs) {
        if (armed(q) || armed(r)) continue;
        const a = newArm(q.order < r.order ? q : r);
        join(a, q);
        join(a, r);
      }
      // and every other road alone
      for (const q of at) if (!armed(q)) join(newArm(q), q);
      n.arms.sort((a, b) => a.order - b.order);
      // an arm within 20° of an earlier one (where roads merge or fork) crosses the other roads as one with it (its
      // lead), as wide as the widest of them
      for (const a of n.arms) {
        a.lead = n.arms.find((b) => b.lead === b && b.ux * a.ux + b.uz * a.uz > 0.94) || a;
        a.lead.wide = Math.max(a.lead === a ? 0 : a.lead.wide, a.half);
      }
    }
  }
  computeArms(edges);
  // A centreline node where just one road goes on, bending less than 35°, is a shape node: no corner to stop at (nor a
  // fork: a road splitting in two live ones within 20°)
  const bends = (n) => {
    const leads = n.arms.filter((a) => a.lead === a);
    const forks = leads.some((l) => n.arms.filter((a) => a.lead === l && liveArm(a)).length > 1);
    return leads.length === 2 && leads[0].ux * leads[1].ux + leads[0].uz * leads[1].uz < -0.82 && !forks;
  };
  for (const n of nodes) if (n.general && !n.shape && bends(n)) n.shape = true;
  // Where two roads leave a node within 20° of each other (they merge or fork there), how far out every lane of one
  // first keeps 3 m (a car's width and some) from every lane of the other
  const lanesOut = (a, r, out) => {
    out.length = 0;
    for (const e of [a.in, a.out]) {
      if (!e || !e.live) continue;
      const t = e === a.out ? r : e.span - r; // r from its start leaving, r before its end arriving
      for (const o of e.lanes) out.push(e.x0 + e.dx * t + e.rx * o, e.z0 + e.dz * t + e.rz * o);
    }
    return out;
  };
  const lanesA = [];
  const lanesB = [];
  function apart(a, b) {
    for (let r = 2; r < 45; r++) {
      lanesOut(a, r, lanesA);
      lanesOut(b, r, lanesB);
      let near = Infinity;
      for (let i = 0; i < lanesA.length; i += 2) {
        for (let j = 0; j < lanesB.length; j += 2) near = Math.min(near, Math.hypot(lanesA[i] - lanesB[j], lanesA[i + 1] - lanesB[j + 1]));
      }
      if (near >= 3) return r;
    }
    return 45;
  }
  // How far before node n an edge arriving along `arm` stops: clear of every road crossing it (at whatever angle: its
  // curb corner reaches past the crossing road's far side by half its own width over the tangent) plus the crosswalk,
  // and clear of the lanes of a road merging with it or forking off it
  const goesOn = (p, q) => p.ux * q.ux + p.uz * q.uz < 0 && Math.abs(p.ux * q.uz - p.uz * q.ux) < 0.26; // q within 15° of straight on from p
  function stopBack(n, arm) {
    if (n.shape) return 1;
    const a = arm.lead;
    let ext = 0;
    let fork = 0;
    for (const b of n.arms) {
      if (b === arm) continue;
      if (b.lead === a) {
        if (liveArm(arm) && liveArm(b)) fork = Math.max(fork, apart(arm, b) + 1); // side by side rather than across
        continue;
      }
      if (b.lead !== b) continue; // crossing as one with its lead
      // the same road going on (into either of two roads forking there, or out of either of two merging)
      if (n.arms.some((p) => p.lead === a && n.arms.some((q) => q.lead === b && goesOn(p, q)))) continue;
      const cos = a.ux * b.ux + a.uz * b.uz;
      const sin = Math.abs(a.ux * b.uz - a.uz * b.ux);
      ext = Math.max(ext, (b.wide + a.wide * Math.abs(cos)) / sin);
    }
    return Math.max(ext > 0 ? Math.min(ext, 20) + CROSSWALK : 2, fork);
  }
  // nodes where grid and centreline roads meet: grid edges stop no closer than the centreline arms need either
  for (const e of edges) if (e.general) e.from.mixed = e.to.mixed = true;

  // Edges run between stop lines: past the intersection box and its crosswalk at both ends (grid edges by the box,
  // centreline ones by the roads crossing them; where both meet, the further of the two). On a short centreline link
  // between acute corners the two pull in together, keeping at least 10 m (or half the link) to queue on.
  function place(e) {
    const back = (n, arm) => {
      if (e.general) return stopBack(n, arm);
      const grid = (e.axis === 'ave' ? n.hz : n.hx) + CROSSWALK;
      return n.mixed && !n.general ? Math.max(grid, stopBack(n, arm)) : grid;
    };
    let b0 = back(e.from, e.outArm);
    let b1 = back(e.to, e.inArm);
    const keep = Math.min(10, e.span * 0.5);
    e.squeezed = false;
    if (e.general && e.span - b0 - b1 < keep) {
      const k = (e.span - keep) / (b0 + b1);
      b0 *= k;
      b1 *= k;
      e.squeezed = !e.to.shape; // its stop line closer to the roads crossing ahead than they need (see the end of 6.)
    }
    e.sx = e.x0 + e.dx * b0;
    e.sz = e.z0 + e.dz * b0;
    e.len = e.span - b0 - b1;
  }
  for (const e of edges) place(e);
  const placed = edges; // (see 7.)
  const genCreated = edges.filter((e) => e.general).length;
  edges = edges.filter((e) => e.len > (e.general ? 4 : 6));

  // 6. Movements at each intersection (no U-turns) and the lane each lane leads to, along obstacle-free curves:
  //    straight on, lane i keeps to lane i + k ahead, k chosen to use as many lanes there as possible with the least
  //    sideways shift; turns go from the lane nearest the turn into the lane nearest it. Lanes left with no way on
  //    (where the road ends or narrows) turn alongside the turn lane, or merge. Across the road, lanes always run
  //    left turns, straight on, right turns, into lanes in the same order, so no two paths from one approach cross.
  const lateral = (e, i) => e.x0 * e.rx + e.z0 * e.rz + e.lanes[i];
  const ORDER = { L: 0, S: 1, R: 2 };
  function pathClear(e, i, f, j) {
    const c = makeCurve(e, i, f, j);
    const p = { x: 0, z: 0, dx: 0, dz: 0 };
    const street = e.general || f.general; // through a centreline junction: tested like its lanes
    for (let k = 1; k < 10; k++) {
      curvePoint(c, c.len * k / 10, p);
      if (street ? blockedOnStreet(p.x, p.z, 0.8) : blocked(p.x - 1, p.x + 1, p.z - 1, p.z + 1)) return false;
    }
    return true;
  }
  function inOrder(e, m, i, j) {
    for (const o of e.moves) {
      for (let k = 0; k < e.lanes.length; k++) {
        if (k === i || o.out[k] < 0) continue;
        // o from k is right of m from i: by its kind of turn, then (two of a kind, where a road forks) by how far right
        // it bends
        const right = ORDER[o.turn] - ORDER[m.turn] || (o === m ? o.out[k] - j : Math.sign(o.cross - m.cross));
        if (k < i ? right > 0 : right < 0) return false;
      }
    }
    return true;
  }
  function nearestLane(e, i, f) {
    let j = 0;
    for (let k = 1; k < f.lanes.length; k++) {
      if (Math.abs(lateral(f, k) - lateral(e, i)) < Math.abs(lateral(f, j) - lateral(e, i))) j = k;
    }
    return j;
  }
  // Let lane i of e make move m into lane j of its edge (clamped to the lanes there), if the way is clear
  function link(e, m, i, j) {
    j = Math.max(0, Math.min(m.to.lanes.length - 1, j));
    if (m.out[i] < 0 && inOrder(e, m, i, j) && pathClear(e, i, m.to, j)) m.out[i] = j;
    return m.out[i] >= 0;
  }
  function serveEveryLane(e) {
    const n = e.lanes.length;
    for (let i = 0; i < n; i++) {
      if (e.moves.some((m) => m.out[i] >= 0)) continue;
      const turnLane = (m, k) => link(e, m, i, m.turn === 'L' ? k : m.to.lanes.length - 1 - k);
      const side = (m) => (m.turn === 'L' ? i : n - 1 - i); // lanes between i and the turn's side of the road
      e.moves.some((m) => m.turn !== 'S' && side(m) <= (n - 1) / 2 && turnLane(m, side(m))) ||
        e.moves.some((m) => m.turn === 'S' && link(e, m, i, nearestLane(e, i, m.to))) ||
        e.moves.some((m) => m.turn !== 'S' && turnLane(m, side(m))) ||
        e.moves.some((m) => m.to.lanes.some((_, j) => link(e, m, i, j)));
    }
    e.moves = e.moves.filter((m) => m.out.some((j) => j >= 0));
  }
  for (const e of edges) e.from.out.push(e);
  for (const e of edges) {
    const n = e.lanes.length;
    for (const f of e.to.out) {
      if (f.to === e.from || e.dx * f.dx + e.dz * f.dz < -0.5) continue;
      const cross = e.dx * f.dz - e.dz * f.dx;
      e.moves.push({ to: f, turn: cross > 0.5 ? 'R' : cross < -0.5 ? 'L' : 'S', cross, out: new Array(n).fill(-1) });
    }
    // the straightest first: where a road forks, the branch going most nearly straight on keeps most of its lanes
    const ahead = (m) => e.dx * m.to.dx + e.dz * m.to.dz;
    for (const m of e.moves.slice().sort((p, q) => ahead(q) - ahead(p))) {
      const f = m.to;
      if (m.turn === 'L') link(e, m, 0, 0);
      else if (m.turn === 'R') link(e, m, n - 1, f.lanes.length - 1);
      else {
        let best = 0;
        let bestScore = -Infinity;
        for (let k = 1 - n; k < f.lanes.length; k++) {
          const used = new Set();
          let score = 0;
          for (let i = 0; i < n; i++) {
            const j = Math.max(0, Math.min(f.lanes.length - 1, i + k));
            used.add(j);
            score -= Math.abs(lateral(f, j) - lateral(e, i));
          }
          score += 100 * used.size;
          if (score > bestScore) {
            bestScore = score;
            best = k;
          }
        }
        for (let i = 0; i < n; i++) link(e, m, i, i + best);
      }
    }
    serveEveryLane(e);
  }

  // Sides & right-of-way groups of node n's arms (see 9.)
  const CARD = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function sidesAndGroups(n) {
    const arms = n.arms;
    let next = 4;
    for (const a of arms) a.side = -1;
    if (!n.general) {
      // each compass side goes to the arm best aligned with it, within 15°
      CARD.forEach(([cx, cz], c) => {
        let best = null;
        let bd = 0.966;
        for (const a of arms) {
          const d = a.ux * cx + a.uz * cz;
          if (a.side < 0 && d > bd) {
            bd = d;
            best = a;
          }
        }
        if (best) best.side = c;
      });
    }
    for (const a of arms) if (a.side < 0) a.side = next++;
    n.sideCount = Math.max(4, next);
    // roads: arms paired with the one most nearly opposite (beyond 145°), the likeliest pairs first: the straightest,
    // and of two about as straight, the one about as wide (a side street merging into a road nearly head on doesn't
    // take over the road's other side)
    const pairs = [];
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const d = arms[i].ux * arms[j].ux + arms[i].uz * arms[j].uz;
        if (d < -0.82) pairs.push([d + 0.02 * Math.abs(arms[i].half - arms[j].half), arms[i], arms[j]]);
      }
    }
    pairs.sort((p, q) => p[0] - q[0]);
    const mates = new Map();
    for (const [, a, b] of pairs) {
      if (mates.has(a) || mates.has(b)) continue;
      mates.set(a, b);
      mates.set(b, a);
    }
    const roads = [];
    const done = new Set();
    for (const a of arms) {
      if (done.has(a)) continue;
      done.add(a);
      const mate = mates.get(a);
      if (mate) done.add(mate);
      const members = mate ? [a, mate] : [a];
      roads.push({ members, group: -1, rank: Math.max(...members.map((m) => (m.ave ? 100 : 0) + m.half)) });
    }
    let groups = 0;
    if (!n.general) {
      // on the grid the road with a north-south arm is the avenue (0), the one with an east-west arm the street (1)
      for (const r of roads) {
        if (r.members.some((m) => m.side === 2 || m.side === 3)) r.group = 0;
        else if (r.members.some((m) => m.side === 0 || m.side === 1)) r.group = 1;
      }
      groups = 2;
    }
    roads.sort((p, q) => q.rank - p.rank);
    for (const r of roads) if (r.group < 0) r.group = groups++;
    for (const r of roads) for (const m of r.members) m.group = r.group;
    n.groupCount = Math.max(2, groups);
  }

  // A short link squeezed between two corners may leave its stop line inside the road crossing ahead, where whoever
  // waits on it stands in the way of the traffic crossing there (of other roads, which share the junction with it).
  // Where the link comes off a bend (a shape node: nothing crosses there), its stop line goes back as far as that
  // takes, as long as a car waiting there still stands on the link (not around the bend, in the way of the next);
  // a link that can't keep clear even so is dropped.
  const inOf = new Map();
  for (const e of edges) {
    if (!inOf.has(e.to)) inOf.set(e.to, []);
    inOf.get(e.to).push(e);
  }
  const HALF_CAR = 2.3;
  const HALF_WIDE = 0.95;
  const pathPt = { x: 0, z: 0, dx: 0, dz: 1 };
  function inTheWay(e) {
    const n = e.to;
    sidesAndGroups(n);
    // a car standing at each of its lanes' stop line
    const cars = e.lanes.map((o) => [e.sx + e.dx * (e.len - HALF_CAR) + e.rx * o, e.sz + e.dz * (e.len - HALF_CAR) + e.rz * o]);
    for (const o of inOf.get(n)) {
      if (o === e || o.inArm.group === e.inArm.group) continue;
      for (const m of o.moves) {
        for (let i = 0; i < o.lanes.length; i++) {
          if (m.out[i] < 0) continue;
          const c = makeCurve(o, i, m.to, m.out[i]);
          for (let s = 0; s <= c.len; s += 1) {
            curvePoint(c, s, pathPt);
            for (const [cx, cz] of cars) {
              const dx = pathPt.x - cx;
              const dz = pathPt.z - cz;
              if (dx * dx + dz * dz > 36) continue;
              // how deep a car on the path overlaps it (separating axes)
              let depth = Infinity;
              for (const [ax, az] of [[e.dx, e.dz], [e.rx, e.rz], [pathPt.dx, pathPt.dz], [-pathPt.dz, pathPt.dx]]) {
                const ra = HALF_CAR * Math.abs(e.dx * ax + e.dz * az) + HALF_WIDE * Math.abs(e.rx * ax + e.rz * az);
                const rb = HALF_CAR * Math.abs(pathPt.dx * ax + pathPt.dz * az) + HALF_WIDE * Math.abs(pathPt.dz * ax - pathPt.dx * az);
                depth = Math.min(depth, ra + rb - Math.abs(dx * ax + dz * az));
              }
              if (depth > 0.25) return true;
            }
          }
        }
      }
    }
    return false;
  }
  const inTheWayOut = new Set();
  for (const e of edges) {
    if (!e.squeezed || !e.from.shape || !inTheWay(e)) continue;
    while (e.len > 6 && inTheWay(e)) e.len = Math.max(5.5, e.len - 1);
    if (inTheWay(e)) inTheWayOut.add(e); // even so
  }
  if (inTheWayOut.size) {
    edges = edges.filter((e) => !inTheWayOut.has(e));
    for (const e of edges) e.moves = e.moves.filter((m) => !inTheWayOut.has(m.to));
  }

  // 7. Keep the largest strongly connected set of edges so no vehicle can ever reach a dead end
  edges.forEach((e, i) => (e.id = i));
  const visited = new Uint8Array(edges.length);
  const order = [];
  for (const root of edges) {
    if (visited[root.id]) continue;
    visited[root.id] = 1;
    const stack = [[root, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const e = top[0];
      if (top[1] < e.moves.length) {
        const f = e.moves[top[1]++].to;
        if (!visited[f.id]) {
          visited[f.id] = 1;
          stack.push([f, 0]);
        }
      } else {
        order.push(e);
        stack.pop();
      }
    }
  }
  const incoming = edges.map(() => []);
  for (const e of edges) for (const m of e.moves) incoming[m.to.id].push(e);
  const comp = new Int32Array(edges.length).fill(-1);
  let bestComp = -1;
  let bestSize = 0;
  for (let k = order.length - 1, c = 0; k >= 0; k--) {
    if (comp[order[k].id] >= 0) continue;
    const stack = [order[k]];
    comp[order[k].id] = c;
    let size = 0;
    while (stack.length) {
      const e = stack.pop();
      size++;
      for (const p of incoming[e.id]) {
        if (comp[p.id] < 0) {
          comp[p.id] = c;
          stack.push(p);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestComp = c;
    }
    c++;
  }
  const genShortKept = edges.filter((e) => e.general).length;
  const genLost = edges.filter((e) => e.general && comp[e.id] !== bestComp);
  edges = edges.filter((e) => comp[e.id] === bestComp);
  // Roads kept clear of a road merging with them or forking off them that is gone now (too short, or no way on from it
  // after all) get their stop lines placed again without it
  const kept = new Set(edges);
  const dropped = placed.filter((e) => e.live && !kept.has(e));
  if (dropped.length) {
    const redo = new Set();
    for (const e of dropped) {
      e.live = false;
      redo.add(e.from).add(e.to);
    }
    computeArms(placed, redo);
    for (const n of redo) if (n.general && !n.shape && bends(n)) n.shape = true;
    for (const e of edges) if (redo.has(e.from) || redo.has(e.to)) place(e);
  }
  if (window.NYC.DEBUG_ROADS !== false) {
    console.info(`[roads] centreline edges: ${genCreated} with clear lanes, ${genShortKept} long enough, ${genShortKept - genLost.length} connected`);
  }
  for (const e of edges) {
    e.moves = e.moves.filter((m) => comp[m.to.id] === bestComp);
    serveEveryLane(e);
    // Lanes still leading nowhere (every curve out of them grazes a curb or obstacle): send them on to the nearest lane
    // of the straightest move anyway, so every lane always has a way on
    for (let i = 0; i < e.lanes.length; i++) {
      if (!e.moves.length || e.moves.some((m) => m.out[i] >= 0)) continue;
      const m = e.moves.find((q) => q.turn === 'S') || e.moves[0];
      m.out[i] = nearestLane(e, i, m.to);
    }
  }
  edges.forEach((e, i) => (e.id = i));

  for (const n of nodes) n.in = n.out = null;
  for (const e of edges) {
    (e.from.out || (e.from.out = [])).push(e);
    (e.to.in || (e.to.in = [])).push(e);
  }
  nodes = nodes.filter((n) => n.in && n.out);
  nodes.forEach((n, i) => (n.id = i));

  // 8. Signalized intersections are exactly the ones with signal heads (street-details.js)
  for (const a of AVENUES) {
    for (const s of STREETS) {
      const n = nodes.find((m) => Math.abs(m.x - a.x) < 4 && Math.abs(m.z - s.z) < 4);
      if (n) n.signal = true;
    }
  }

  // 9. Sides & right of way at each node, for traffic.js. Its arms are its sides (one crosswalk and approach each): a
  //    grid intersection keeps east 0, west 1, south 2, north 3, any other arm counts from 4. The arms of one road (on
  //    opposite sides) form a group: vehicles of different groups never share the intersection box, and group 0 has
  //    the right of way at unsignalised corners (and the avenue phase at signals): the avenue on the grid (north-south
  //    arms 0, east-west 1), the widest road at a centreline junction.
  computeArms(edges);
  for (const n of nodes) sidesAndGroups(n);
  for (const e of edges) {
    e.inSide = e.inArm.side; // the side of e.to it arrives over
    e.outSide = e.outArm.side; // the side of e.from it leaves over
    e.axisIndex = e.inArm.group; // its right-of-way group at e.to
    // lateral axis of its road, the same both ways (+x across north-south roads, +z across east-west ones)
    const flip = e.rx < -1e-6 || (Math.abs(e.rx) <= 1e-6 && e.rz < 0);
    e.clx = flip ? -e.rx : e.rx;
    e.clz = flip ? -e.rz : e.rz;
  }
  for (const e of edges) {
    e.opposite = e.to.in.find((o) => o !== e && o.axisIndex === e.axisIndex && o.dx * e.dx + o.dz * e.dz < -0.7) || null;
  }

  // Lane-to-lane curves are built on first use and cached
  const curves = new Map();
  function connector(e, i, f, j) {
    const k = ((e.id * 8 + i) * 16384 + f.id) * 8 + j;
    let c = curves.get(k);
    if (!c) curves.set(k, (c = makeCurve(e, i, f, j)));
    return c;
  }

  return { nodes, edges, connector, curvePoint, walkable, onSidewalk };
}

// The largest strongly connected set of `list` (a Set), going on from item e to the items next(e)
function largestComponent(list, next) {
  const index = new Map(list.map((e, i) => [e, i]));
  const succ = list.map((e) => next(e).map((f) => index.get(f)).filter((j) => j !== undefined));
  const pred = list.map(() => []);
  succ.forEach((s, i) => {
    for (const j of s) pred[j].push(i);
  });
  // Kosaraju: finishing order going forwards, then components going backwards from the last finished
  const visited = new Uint8Array(list.length);
  const order = [];
  for (let root = 0; root < list.length; root++) {
    if (visited[root]) continue;
    visited[root] = 1;
    const stack = [[root, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top[1] < succ[top[0]].length) {
        const j = succ[top[0]][top[1]++];
        if (!visited[j]) {
          visited[j] = 1;
          stack.push([j, 0]);
        }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  }
  const comp = new Int32Array(list.length).fill(-1);
  let best = -1;
  let bestSize = 0;
  for (let k = order.length - 1, c = 0; k >= 0; k--) {
    if (comp[order[k]] >= 0) continue;
    const stack = [order[k]];
    comp[order[k]] = c;
    let size = 0;
    while (stack.length) {
      const i = stack.pop();
      size++;
      for (const p of pred[i]) {
        if (comp[p] < 0) {
          comp[p] = c;
          stack.push(p);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = c;
    }
    c++;
  }
  return new Set(list.filter((_, i) => comp[i] === best));
}

// Cubic Bézier from the end of lane i on edge e to the start of lane j on edge f: a quarter-circle-like
// arc around the corner for turns, an S-bend for straight lane shifts. Includes an arc-length table and
// the sharpest curvature along it (1 / tightest radius).
function makeCurve(e, i, f, j) {
  const x0 = e.sx + e.dx * e.len + e.rx * e.lanes[i];
  const z0 = e.sz + e.dz * e.len + e.rz * e.lanes[i];
  const x3 = f.sx + f.rx * f.lanes[j];
  const z3 = f.sz + f.rz * f.lanes[j];
  const cross = e.dx * f.dz - e.dz * f.dx;
  let k0;
  let k3;
  if (Math.abs(cross) < 0.5) {
    k0 = k3 = Math.hypot(x3 - x0, z3 - z0) / 3;
  } else {
    const t = ((x3 - x0) * f.dz - (z3 - z0) * f.dx) / cross;
    k0 = 0.552 * Math.abs(t);
    k3 = 0.552 * Math.hypot(x3 - (x0 + e.dx * t), z3 - (z0 + e.dz * t));
  }
  const c = {
    x0, z0, x3, z3,
    x1: x0 + e.dx * k0, z1: z0 + e.dz * k0,
    x2: x3 - f.dx * k3, z2: z3 - f.dz * k3,
    lut: new Float32Array(17),
    len: 0,
    curv: 0
  };
  let px = x0;
  let pz = z0;
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * x3;
    const z = u * u * u * z0 + 3 * u * u * t * c.z1 + 3 * u * t * t * c.z2 + t * t * t * z3;
    c.len += Math.hypot(x - px, z - pz);
    c.lut[k] = c.len;
    px = x;
    pz = z;
    const dx = 3 * u * u * (c.x1 - x0) + 6 * u * t * (c.x2 - c.x1) + 3 * t * t * (x3 - c.x2);
    const dz = 3 * u * u * (c.z1 - z0) + 6 * u * t * (c.z2 - c.z1) + 3 * t * t * (z3 - c.z2);
    const ddx = 6 * u * (c.x2 - 2 * c.x1 + x0) + 6 * t * (x3 - 2 * c.x2 + c.x1);
    const ddz = 6 * u * (c.z2 - 2 * c.z1 + z0) + 6 * t * (z3 - 2 * c.z2 + c.z1);
    c.curv = Math.max(c.curv, Math.abs(dx * ddz - dz * ddx) / Math.max(1e-6, Math.hypot(dx, dz) ** 3));
  }
  return c;
}

// Position and unit tangent at arc length s along a curve
function curvePoint(c, s, out) {
  let k = 1;
  while (k < 16 && c.lut[k] < s) k++;
  const s0 = c.lut[k - 1];
  const s1 = c.lut[k];
  const t = (k - 1 + Math.min(1, Math.max(0, (s - s0) / (s1 - s0 || 1)))) / 16;
  const u = 1 - t;
  out.x = u * u * u * c.x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x3;
  out.z = u * u * u * c.z0 + 3 * u * u * t * c.z1 + 3 * u * t * t * c.z2 + t * t * t * c.z3;
  const dx = 3 * u * u * (c.x1 - c.x0) + 6 * u * t * (c.x2 - c.x1) + 3 * t * t * (c.x3 - c.x2);
  const dz = 3 * u * u * (c.z1 - c.z0) + 6 * u * t * (c.z2 - c.z1) + 3 * t * t * (c.z3 - c.z2);
  const l = Math.hypot(dx, dz) || 1;
  out.dx = dx / l;
  out.dz = dz / l;
  return out;
}

Object.assign(window.NYC, { buildRoadNetwork, CROSSWALK });
})();
