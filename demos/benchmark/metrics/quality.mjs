// Geometry quality of a model, from its render triangles (every GLB) and, when the GLB carries
// `THREEPIPE_mesh_topology`, from its editable n-gon topology (quads, n-gons, poles).
//
// Triangle-level numbers are computed on positions welded at `weldEps` (mm), so a corner-indexed bake (one
// vertex per face corner, as threepipe and Blender's draw code emit) is measured as the surface it is, and a
// vertex that keeps several normals after welding is a shading seam: `splitVertexRatio` is the faceting.

const DEG = Math.PI / 180

function weld(P, eps) {
    const key = new Map(), id = new Int32Array(P.length / 3)
    const q = 1 / eps
    for (let i = 0; i < id.length; i++) {
        const k = Math.round(P[3 * i] * q) + ',' + Math.round(P[3 * i + 1] * q) + ',' + Math.round(P[3 * i + 2] * q)
        let w = key.get(k)
        if (w === undefined) { w = key.size; key.set(k, w) }
        id[i] = w
    }
    return {id, count: key.size}
}

/**
 * Triangle-level quality of one part (world positions, mm).
 * @param {{position: Float32Array, normal: Float32Array|null, index: Uint32Array, uv?: Float32Array|null}} part
 */
export function triangleQuality(part, {weldEps = 1e-3, splitAngle = 5, hardAngle = 30} = {}) {
    const P = part.position, I = part.index, N = part.normal
    const {id, count} = weld(P, weldEps)
    // shading seams
    let split = 0
    if (N) {
        const seen = new Map(), cos = Math.cos(splitAngle * DEG)
        for (let i = 0; i < id.length; i++) {
            const n = [N[3 * i], N[3 * i + 1], N[3 * i + 2]]
            const list = seen.get(id[i])
            if (!list) seen.set(id[i], [n])
            else if (!list.some(m => m[0] * n[0] + m[1] * n[1] + m[2] * n[2] > cos)) list.push(n)
        }
        for (const l of seen.values()) if (l.length > 1) split++
    }
    const nt = I.length / 3
    const fn = new Float64Array(nt * 3)
    const edges = new Map()
    let area = 0, slivers = 0, degenerate = 0
    const minAngles = new Float64Array(nt)
    for (let t = 0; t < nt; t++) {
        const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2]
        const A = [P[3 * a], P[3 * a + 1], P[3 * a + 2]], B = [P[3 * b], P[3 * b + 1], P[3 * b + 2]], C = [P[3 * c], P[3 * c + 1], P[3 * c + 2]]
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], w = [C[0] - B[0], C[1] - B[1], C[2] - B[2]]
        const cx = u[1] * v[2] - u[2] * v[1], cy = u[2] * v[0] - u[0] * v[2], cz = u[0] * v[1] - u[1] * v[0]
        const l2 = Math.hypot(cx, cy, cz)
        area += l2 / 2
        if (l2 > 0) { fn[3 * t] = cx / l2; fn[3 * t + 1] = cy / l2; fn[3 * t + 2] = cz / l2 }
        const lu = Math.hypot(...u), lv = Math.hypot(...v), lw = Math.hypot(...w)
        if (l2 <= 1e-12 || !lu || !lv || !lw) { degenerate++; minAngles[t] = 0 } else {
            // the smallest angle is opposite the shortest side; law of sines on the doubled area
            const ang = [Math.asin(Math.min(1, l2 / (lv * lw))), Math.asin(Math.min(1, l2 / (lu * lw))), Math.asin(Math.min(1, l2 / (lu * lv)))]
            minAngles[t] = Math.min(...ang) / DEG
            if (minAngles[t] < 10) slivers++
        }
        const W = [id[a], id[b], id[c]]
        for (let e = 0; e < 3; e++) {
            const i0 = W[e], i1 = W[(e + 1) % 3]
            if (i0 === i1) continue
            const k = i0 < i1 ? i0 * 4294967296 + i1 : i1 * 4294967296 + i0
            let r = edges.get(k)
            if (!r) { r = []; edges.set(k, r) }
            r.push(t)
        }
    }
    let boundary = 0, nonManifold = 0, hard = 0
    for (const f of edges.values()) {
        if (f.length === 1) { boundary++; continue }
        if (f.length > 2) { nonManifold++; continue }
        const d = fn[3 * f[0]] * fn[3 * f[1]] + fn[3 * f[0] + 1] * fn[3 * f[1] + 1] + fn[3 * f[0] + 2] * fn[3 * f[1] + 2]
        if (Math.acos(Math.max(-1, Math.min(1, d))) > hardAngle * DEG) hard++
    }
    // connected components over welded vertices
    const parent = Int32Array.from({length: count}, (_, i) => i)
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
    for (let t = 0; t < nt; t++) {
        const a = find(id[I[3 * t]]), b = find(id[I[3 * t + 1]]), c = find(id[I[3 * t + 2]])
        parent[b] = a; parent[find(c)] = a
    }
    const roots = new Set()
    for (let t = 0; t < nt; t++) roots.add(find(id[I[3 * t]]))
    const sorted = Float64Array.from(minAngles).sort()
    return {
        triangles: nt, vertices: count, area, components: roots.size,
        edges: edges.size, boundaryEdges: boundary, nonManifoldEdges: nonManifold, closed: boundary === 0 && nonManifold === 0,
        hardEdgeRatio: edges.size ? hard / edges.size : 0,
        splitVertices: split, splitVertexRatio: count ? split / count : 0,
        minAngleP5: nt ? sorted[Math.floor(0.05 * (nt - 1))] : NaN, sliverRatio: nt ? slivers / nt : 0, degenerate,
        uv: !!part.uv,
    }
}

/** Quads, n-gons, triangles and poles of an n-gon mesh (`THREEPIPE_mesh_topology`). */
export function topologyQuality(topo) {
    const {faceOffsets: F, cornerVerts: C} = topo
    const faces = Math.max(0, F.length - 1), verts = topo.positions.length / 3
    let tris = 0, quads = 0, ngons = 0
    const edgeFaces = new Map(), valence = new Int32Array(verts)
    for (let f = 0; f < faces; f++) {
        const n = F[f + 1] - F[f]
        if (n === 3) tris++; else if (n === 4) quads++; else ngons++
        for (let c = F[f]; c < F[f + 1]; c++) {
            const a = C[c], b = C[c + 1 < F[f + 1] ? c + 1 : F[f]]
            const k = a < b ? a * 4294967296 + b : b * 4294967296 + a
            edgeFaces.set(k, (edgeFaces.get(k) ?? 0) + 1)
        }
    }
    const boundaryVert = new Uint8Array(verts)
    let boundary = 0, nonManifold = 0
    for (const [k, n] of edgeFaces) {
        const a = Math.floor(k / 4294967296), b = k % 4294967296
        valence[a]++; valence[b]++
        if (n === 1) { boundary++; boundaryVert[a] = boundaryVert[b] = 1 }
        if (n > 2) nonManifold++
    }
    // poles: interior vertices whose valence is not 4 (3-poles and 5+-poles), the quad-flow defects
    let poles3 = 0, poles5 = 0, loose = 0
    for (let v = 0; v < verts; v++) {
        if (!valence[v]) { loose++; continue }
        if (boundaryVert[v]) continue
        if (valence[v] === 3) poles3++
        else if (valence[v] >= 5) poles5++
    }
    return {faces, tris, quads, ngons, quadRatio: faces ? quads / faces : 0, verts, edges: edgeFaces.size,
        boundaryEdges: boundary, nonManifoldEdges: nonManifold, poles3, poles5, looseVerts: loose,
        attributes: topo.attributes}
}

/** Sum the per-part numbers into a model total (ratios re-derived from the sums). */
export function modelQuality(parts, opts) {
    const per = parts.map(p => ({name: p.name, ...triangleQuality(p, opts), topology: p.topology ? topologyQuality(p.topology) : null}))
    const sum = k => per.reduce((a, r) => a + (r[k] || 0), 0)
    const tot = {
        parts: per.length, triangles: sum('triangles'), vertices: sum('vertices'), area: sum('area'), components: sum('components'),
        boundaryEdges: sum('boundaryEdges'), nonManifoldEdges: sum('nonManifoldEdges'), closedParts: per.filter(r => r.closed).length,
        splitVertexRatio: sum('splitVertices') / Math.max(1, sum('vertices')),
        // faceting where it matters: area-weighted over parts larger than 1 % of the model's area
        facetingLarge: 0,
        uvParts: per.filter(r => r.uv).length,
    }
    tot.degenerate = sum('degenerate')
    tot.sliverRatio = per.reduce((a, r) => a + r.sliverRatio * r.triangles, 0) / Math.max(1, tot.triangles)
    const big = per.filter(r => r.area > 0.01 * tot.area)
    const bigArea = big.reduce((a, r) => a + r.area, 0)
    tot.facetingLarge = bigArea ? big.reduce((a, r) => a + r.splitVertexRatio * r.area, 0) / bigArea : 0
    const topo = per.filter(r => r.topology).map(r => r.topology)
    if (topo.length) {
        const ts = k => topo.reduce((a, t) => a + t[k], 0)
        tot.topology = {parts: topo.length, faces: ts('faces'), quads: ts('quads'), tris: ts('tris'), ngons: ts('ngons'),
            quadRatio: ts('quads') / Math.max(1, ts('faces')), poles3: ts('poles3'), poles5: ts('poles5'),
            boundaryEdges: ts('boundaryEdges'), nonManifoldEdges: ts('nonManifoldEdges')}
    }
    return {total: tot, parts: per}
}
