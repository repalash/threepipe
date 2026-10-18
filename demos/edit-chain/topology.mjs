/**
 * Mesh measurement and edit-locality checks for the edit-chain harness.
 *
 * Everything here works on a *lossless* dump of a `MeshData` (every attribute layer as raw bytes),
 * because the command API has nothing that returns one: `inspect {detail}` rounds positions to 1e-5,
 * caps the listing at 400 vertices and leaves out edges and attribute layers, and `measure` reports
 * only world bounding boxes. Topology statistics (Euler characteristic, boundary loops, non-manifold
 * edges, volume) and a claimed-versus-collateral `diff` are what the research survey's §5.2 asks the
 * API to provide (`measure(mesh)`, `diff(a, b)`); until it does, this module computes them, and
 * `issues/open/modelling-tools/chain-no-topology-measure.md` tracks moving them into the plugin.
 *
 * Plain ES module, no dependencies, so it runs in Node (the harness) and in a browser alike.
 */

// --- decoding ---------------------------------------------------------------------------------

/** The kernel's `ATTR_TYPE_INFO` (`mesh-kernel/src/constants.ts`): backing array, components, default. */
const TYPES = {
    bool: [Uint8Array, 1, 0], int8: [Int8Array, 1, 0], int32: [Int32Array, 1, 0],
    int32x2: [Int32Array, 2, 0], int16x2: [Int16Array, 2, 0], float: [Float32Array, 1, 0],
    float2: [Float32Array, 2, 0], float3: [Float32Array, 3, 0], float4: [Float32Array, 4, 0],
    byteColor: [Uint8Array, 4, 255], quaternion: [Float32Array, 4, 0],
}

function fromBase64(b64) {
    if (typeof Buffer !== 'undefined') {
        const buf = Buffer.from(b64, 'base64')
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice()
    }
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

/**
 * Turn the page-side dump of one `MeshData` into typed arrays.
 * `raw` is `{faceOffsets, materials, layers: [{name, domain, type, bytes}]}` with base64 bytes.
 */
export function decodeMesh(raw) {
    const layers = new Map()
    for (const l of raw.layers) {
        const bytes = fromBase64(l.bytes)
        const Ctor = TYPES[l.type]?.[0] ?? Uint8Array
        const data = new Ctor(bytes.buffer, bytes.byteOffset, bytes.byteLength / Ctor.BYTES_PER_ELEMENT)
        layers.set(l.name, {name: l.name, domain: l.domain, type: l.type, data, bytes: l.bytes})
    }
    const fo = fromBase64(raw.faceOffsets)
    const faceOffsets = new Int32Array(fo.buffer, fo.byteOffset, fo.byteLength / 4)
    const positions = layers.get('position').data
    const edgeVerts = layers.get('.edge_verts').data
    const cornerVerts = layers.get('.corner_vert').data
    const cornerEdges = layers.get('.corner_edge').data
    return {
        raw, layers, faceOffsets, positions, edgeVerts, cornerVerts, cornerEdges,
        materials: raw.materials ?? [],
        vertsNum: positions.length / 3,
        edgesNum: edgeVerts.length / 2,
        facesNum: faceOffsets.length - 1,
        cornersNum: cornerVerts.length,
    }
}

/** Domain numbering of the kernel's `AttrDomain`. */
export const DOMAIN = {point: 0, edge: 1, face: 2, corner: 3}

/** Layers that are topology, not user data, or that a command is expected to rewrite (selection). */
const STRUCTURAL = new Set(['position', '.edge_verts', '.corner_vert', '.corner_edge'])
const isSelection = name => name.startsWith('.select_')

// --- basic geometry ---------------------------------------------------------------------------

export function faceVerts(m, f) {
    const out = []
    for (let c = m.faceOffsets[f]; c < m.faceOffsets[f + 1]; c++) out.push(m.cornerVerts[c])
    return out
}

export function vpos(m, v) {
    return [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]
}

/** Newell normal (unnormalised length = 2 * area for a planar polygon). */
export function faceNewell(m, f) {
    const vs = faceVerts(m, f)
    let nx = 0, ny = 0, nz = 0
    for (let i = 0; i < vs.length; i++) {
        const a = vpos(m, vs[i])
        const b = vpos(m, vs[(i + 1) % vs.length])
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    }
    return [nx, ny, nz]
}

export function faceNormal(m, f) {
    const n = faceNewell(m, f)
    const l = Math.hypot(n[0], n[1], n[2]) || 1
    return [n[0] / l, n[1] / l, n[2] / l]
}

export function faceCenter(m, f) {
    const vs = faceVerts(m, f)
    const c = [0, 0, 0]
    for (const v of vs) {
        const p = vpos(m, v)
        c[0] += p[0]
        c[1] += p[1]
        c[2] += p[2]
    }
    return c.map(x => x / vs.length)
}

// --- topology statistics --------------------------------------------------------------------

/** Faces using each edge, by the corner-edge table. */
export function edgeFaces(m) {
    const out = Array.from({length: m.edgesNum}, () => [])
    for (let f = 0; f < m.facesNum; f++) {
        for (let c = m.faceOffsets[f]; c < m.faceOffsets[f + 1]; c++) out[m.cornerEdges[c]].push(f)
    }
    return out
}

/**
 * Everything `measure(mesh)` in the survey's §5.2 lists that can be computed from topology alone:
 * counts, triangle count, quad share, Euler characteristic, boundary loops, non-manifold and wire
 * edges, shells, winding consistency, area, signed volume, bounds.
 */
export function measureMesh(m) {
    const ef = edgeFaces(m)
    let boundary = 0, nonManifold = 0, wire = 0
    const boundaryEdges = []
    for (let e = 0; e < m.edgesNum; e++) {
        const n = ef[e].length
        if (n === 0) wire++
        else if (n === 1) (boundary++, boundaryEdges.push(e))
        else if (n > 2) nonManifold++
    }

    // Boundary loops: connected components of the boundary-edge graph.
    const boundaryLoops = components(m.vertsNum, boundaryEdges.map(e => [m.edgeVerts[e * 2], m.edgeVerts[e * 2 + 1]]))

    // Shells: connected components over all edges (loose vertices count as their own shell).
    const allEdges = []
    for (let e = 0; e < m.edgesNum; e++) allEdges.push([m.edgeVerts[e * 2], m.edgeVerts[e * 2 + 1]])
    const shells = components(m.vertsNum, allEdges, true)

    // Winding: on a manifold edge the two faces must traverse it in opposite directions.
    let inconsistent = 0
    const dir = new Map()
    for (let f = 0; f < m.facesNum; f++) {
        const s = m.faceOffsets[f], n = m.faceOffsets[f + 1] - s
        for (let k = 0; k < n; k++) {
            const e = m.cornerEdges[s + k]
            const a = m.cornerVerts[s + k]
            const sign = m.edgeVerts[e * 2] === a ? 1 : -1
            const list = dir.get(e)
            if (list) list.push(sign)
            else dir.set(e, [sign])
        }
    }
    for (const [, list] of dir) if (list.length === 2 && list[0] === list[1]) inconsistent++

    let tris = 0, triFaces = 0, quads = 0, ngons = 0, area = 0, volume = 0, degenerate = 0
    for (let f = 0; f < m.facesNum; f++) {
        const n = m.faceOffsets[f + 1] - m.faceOffsets[f]
        tris += n - 2
        if (n === 3) triFaces++
        else if (n === 4) quads++
        else ngons++
        // Fan about the centroid: exact for planar faces, a consistent approximation otherwise.
        const vs = faceVerts(m, f)
        const c = faceCenter(m, f)
        let fa = 0
        for (let i = 0; i < vs.length; i++) {
            const a = vpos(m, vs[i]), b = vpos(m, vs[(i + 1) % vs.length])
            const u = [a[0] - c[0], a[1] - c[1], a[2] - c[2]]
            const w = [b[0] - c[0], b[1] - c[1], b[2] - c[2]]
            const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
            fa += Math.hypot(cr[0], cr[1], cr[2]) / 2
            // Signed tetra volume (origin, c, a, b).
            volume += (c[0] * (a[1] * b[2] - a[2] * b[1]) - c[1] * (a[0] * b[2] - a[2] * b[0])
                + c[2] * (a[0] * b[1] - a[1] * b[0])) / 6
        }
        if (fa < 1e-12) degenerate++
        area += fa
    }

    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let v = 0; v < m.vertsNum; v++) {
        for (let k = 0; k < 3; k++) {
            const x = m.positions[v * 3 + k]
            if (x < min[k]) min[k] = x
            if (x > max[k]) max[k] = x
        }
    }
    const euler = m.vertsNum - m.edgesNum + m.facesNum
    const closed = boundary === 0 && nonManifold === 0 && wire === 0
    // chi = 2s - 2g - b for an orientable surface with s shells and b boundary loops.
    const genus = nonManifold === 0 && inconsistent === 0 ? (2 * shells - boundaryLoops - euler) / 2 : null
    return {
        verts: m.vertsNum, edges: m.edgesNum, faces: m.facesNum, corners: m.cornersNum,
        tris, triFaces, quads, ngons,
        quadPct: m.facesNum ? +(100 * quads / m.facesNum).toFixed(1) : 0,
        euler, boundaryEdges: boundary, boundaryLoops, nonManifoldEdges: nonManifold, wireEdges: wire,
        shells, inconsistentWinding: inconsistent, degenerateFaces: degenerate, genus,
        closed, manifold: nonManifold === 0 && wire === 0 && inconsistent === 0,
        area: +area.toFixed(6), volume: +volume.toFixed(6),
        bbox: m.vertsNum ? {min, max} : null,
        layers: [...m.layers.keys()].filter(n => !STRUCTURAL.has(n)).sort(),
    }
}

/** Connected components of an undirected graph over `n` vertices; `countIsolated` counts loners. */
function components(n, edges, countIsolated = false) {
    const parent = new Int32Array(n).map((_, i) => i)
    const find = x => {
        while (parent[x] !== x) x = parent[x] = parent[parent[x]]
        return x
    }
    const touched = new Uint8Array(n)
    for (const [a, b] of edges) {
        touched[a] = touched[b] = 1
        const ra = find(a), rb = find(b)
        if (ra !== rb) parent[ra] = rb
    }
    const roots = new Set()
    for (let i = 0; i < n; i++) if (countIsolated || touched[i]) roots.add(find(i))
    return roots.size
}

// --- exact comparison -----------------------------------------------------------------------

/** Every layer, the face offsets and the material list, byte for byte. Returns the differences. */
export function meshDiffExact(a, b) {
    const out = []
    if (!a || !b) return a === b ? out : [`one side has no mesh (${!!a} vs ${!!b})`]
    if (a.raw.faceOffsets !== b.raw.faceOffsets) out.push('faceOffsets differ')
    if (JSON.stringify(a.materials) !== JSON.stringify(b.materials)) out.push('material slots differ')
    const names = new Set([...a.layers.keys(), ...b.layers.keys()])
    for (const name of names) {
        const la = a.layers.get(name), lb = b.layers.get(name)
        if (!la || !lb) out.push(`layer ${name} only on ${la ? 'before' : 'after'}`)
        else if (la.domain !== lb.domain || la.type !== lb.type) out.push(`layer ${name} changed shape`)
        else if (la.bytes !== lb.bytes) out.push(`layer ${name} differs`)
    }
    return out
}

// --- locality ---------------------------------------------------------------------------------

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)
/** Bit pattern of a float32, so -0 and 0 or two NaNs are told apart exactly. */
function bits(x) {
    f32[0] = x
    return u32[0].toString(16)
}
function vkey(m, v) {
    return `${bits(m.positions[v * 3])},${bits(m.positions[v * 3 + 1])},${bits(m.positions[v * 3 + 2])}`
}

/** One element's value on a layer, as a string. A layer the mesh lacks reads as the type default. */
function attrValue(m, spec, index) {
    const [, n, def] = TYPES[spec.type] ?? [null, 1, 0]
    const layer = m.layers.get(spec.name)
    const out = []
    for (let k = 0; k < n; k++) out.push(layer ? layer.data[index * n + k] : def)
    return out.join('/')
}

/** User-data layers on a domain across both meshes, as `{name, type}` (a missing layer reads as defaults). */
function userLayers(a, b, domain, ignore) {
    const specs = new Map()
    for (const m of [a, b]) {
        for (const [name, l] of m.layers) {
            if (l.domain === domain && !STRUCTURAL.has(name) && !isSelection(name) && !ignore.has(name)) {
                specs.set(name, {name, type: l.type})
            }
        }
    }
    return [...specs.values()].sort((x, y) => x.name < y.name ? -1 : 1)
}

/**
 * The edit-locality check (survey §3.4, §5.2 `diff`): which pre-step elements a command changed
 * that it did not claim.
 *
 * Elements are matched by their exact float32 positions, not by index, because every topology
 * operator renumbers. `claim` names, in the pre-step mesh:
 *   - `verts`: vertices allowed to move or disappear;
 *   - `faces`: faces allowed to change or disappear (any face using a claimed vertex is too);
 *   - `edges`: edges allowed to disappear or change flags;
 *   - `attrs`: attribute layer names allowed to change anywhere (e.g. `sharp_face` for shading);
 *   - `all`: everything is claimed (a whole-mesh operation) - the check is then vacuous.
 * Returns the collateral changes; empty means the edit stayed inside its claim.
 */
export function localityDiff(pre, post, claim = {}) {
    if (claim.all) return {collateral: [], checked: {verts: 0, faces: 0, edges: 0}, vacuous: true}
    const ignore = new Set(claim.attrs ?? [])
    const mutV = new Set(claim.verts ?? [])
    const mutF = new Set(claim.faces ?? [])
    const mutE = new Set(claim.edges ?? [])
    const collateral = []

    // Vertices: position plus point-domain user data.
    const pointLayers = userLayers(pre, post, DOMAIN.point, ignore)
    const vSig = (m, v) => vkey(m, v) + '|' + pointLayers.map(l => attrValue(m, l, v)).join(';')
    const postV = countMap(post.vertsNum, v => vSig(post, v))
    const postVPos = countMap(post.vertsNum, v => vkey(post, v))
    let checkedV = 0
    for (let v = 0; v < pre.vertsNum; v++) {
        if (mutV.has(v)) continue
        checkedV++
        const sig = vSig(pre, v)
        if (take(postV, sig)) continue
        const moved = !postVPos.has(vkey(pre, v))
        collateral.push({kind: 'vert', index: v, at: vpos(pre, v).map(r6),
            what: moved ? 'moved or removed' : 'attribute changed'})
    }

    // Faces: the cycle of vertex positions (rotation-normalised, orientation kept), with face and
    // corner user data carried along the same rotation.
    const faceLayers = userLayers(pre, post, DOMAIN.face, ignore)
    const cornerLayers = userLayers(pre, post, DOMAIN.corner, ignore)
    const fSig = (m, f, withAttrs) => {
        const s = m.faceOffsets[f], n = m.faceOffsets[f + 1] - s
        const keys = []
        for (let k = 0; k < n; k++) {
            const c = s + k
            keys.push(vkey(m, m.cornerVerts[c])
                + (withAttrs ? '#' + cornerLayers.map(l => attrValue(m, l, c)).join(';') : ''))
        }
        let best = null
        for (let r = 0; r < n; r++) {
            const rot = keys.slice(r).concat(keys.slice(0, r)).join(' ')
            if (best === null || rot < best) best = rot
        }
        return best + (withAttrs ? '|' + faceLayers.map(l => attrValue(m, l, f)).join(';') : '')
    }
    const postF = countMap(post.facesNum, f => fSig(post, f, true))
    const postFGeo = countMap(post.facesNum, f => fSig(post, f, false))
    let checkedF = 0
    for (let f = 0; f < pre.facesNum; f++) {
        if (mutF.has(f)) continue
        if (faceVerts(pre, f).some(v => mutV.has(v))) continue
        checkedF++
        if (take(postF, fSig(pre, f, true))) continue
        const geo = fSig(pre, f, false)
        const flipped = (() => {
            const vs = faceVerts(pre, f).reverse()
            const keys = vs.map(v => vkey(pre, v))
            for (let r = 0; r < keys.length; r++) {
                if (postFGeo.has(keys.slice(r).concat(keys.slice(0, r)).join(' '))) return true
            }
            return false
        })()
        collateral.push({kind: 'face', index: f, center: faceCenter(pre, f).map(r6), size: faceVerts(pre, f).length,
            what: postFGeo.has(geo) ? 'attribute changed' : flipped ? 'winding flipped' : 'reshaped or removed'})
    }

    // Edges used by an unclaimed face, or loose: both ends' positions plus edge user data.
    const edgeLayers = userLayers(pre, post, DOMAIN.edge, ignore)
    const eSig = (m, e, withAttrs) => {
        const a = vkey(m, m.edgeVerts[e * 2]), b = vkey(m, m.edgeVerts[e * 2 + 1])
        return (a < b ? a + ' ' + b : b + ' ' + a)
            + (withAttrs ? '|' + edgeLayers.map(l => attrValue(m, l, e)).join(';') : '')
    }
    const preEF = edgeFaces(pre)
    const postE = countMap(post.edgesNum, e => eSig(post, e, true))
    const postEGeo = countMap(post.edgesNum, e => eSig(post, e, false))
    let checkedE = 0
    for (let e = 0; e < pre.edgesNum; e++) {
        if (mutE.has(e)) continue
        const a = pre.edgeVerts[e * 2], b = pre.edgeVerts[e * 2 + 1]
        if (mutV.has(a) || mutV.has(b)) continue
        const faces = preEF[e]
        const anchored = faces.length === 0
            || faces.some(f => !mutF.has(f) && !faceVerts(pre, f).some(v => mutV.has(v)))
        if (!anchored) continue
        checkedE++
        if (take(postE, eSig(pre, e, true))) continue
        collateral.push({kind: 'edge', index: e, verts: [a, b],
            what: postEGeo.has(eSig(pre, e, false)) ? 'flag changed' : 'removed'})
    }

    return {collateral, checked: {verts: checkedV, faces: checkedF, edges: checkedE}, vacuous: false}
}

function countMap(n, keyOf) {
    const map = new Map()
    for (let i = 0; i < n; i++) {
        const k = keyOf(i)
        map.set(k, (map.get(k) ?? 0) + 1)
    }
    return map
}
function take(map, key) {
    const n = map.get(key)
    if (!n) return false
    if (n === 1) map.delete(key)
    else map.set(key, n - 1)
    return true
}
const r6 = x => Math.round(x * 1e6) / 1e6

// --- selection helpers for the chain ---------------------------------------------------------

/**
 * A query object over one decoded mesh, for writing selections as geometry rather than as indices
 * that would go stale the moment a step is inserted earlier in the chain.
 */
export function query(m) {
    const ef = edgeFaces(m)
    const q = {
        m,
        get verts() { return m.vertsNum },
        pos: v => vpos(m, v),
        faceVerts: f => faceVerts(m, f),
        faceCenter: f => faceCenter(m, f),
        faceNormal: f => faceNormal(m, f),
        faceSize: f => m.faceOffsets[f + 1] - m.faceOffsets[f],
        edgeVerts: e => [m.edgeVerts[e * 2], m.edgeVerts[e * 2 + 1]],
        edgeFaces: e => ef[e],
        /** Indices of faces satisfying `pred(info)`, info = {f, c (centre), n (normal), size, r (radial xz), a (angle)}. */
        faces(pred) {
            const out = []
            for (let f = 0; f < m.facesNum; f++) {
                const c = faceCenter(m, f)
                const info = {f, c, n: faceNormal(m, f), size: m.faceOffsets[f + 1] - m.faceOffsets[f],
                    r: Math.hypot(c[0], c[2]), a: angleXZ(c)}
                if (pred(info)) out.push(f)
            }
            return out
        },
        verts_(pred) {
            const out = []
            for (let v = 0; v < m.vertsNum; v++) {
                const p = vpos(m, v)
                if (pred({v, p, r: Math.hypot(p[0], p[2]), a: angleXZ(p)})) out.push(v)
            }
            return out
        },
        /** Edges satisfying `pred(info)`, info = {e, a, b (positions), mid, faces (count), dy (|ya-yb|)}. */
        edges(pred) {
            const out = []
            for (let e = 0; e < m.edgesNum; e++) {
                const a = vpos(m, m.edgeVerts[e * 2]), b = vpos(m, m.edgeVerts[e * 2 + 1])
                const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
                const info = {e, a, b, mid, faces: ef[e].length, dy: Math.abs(a[1] - b[1]),
                    r: Math.hypot(mid[0], mid[2]), ra: Math.hypot(a[0], a[2]), rb: Math.hypot(b[0], b[2])}
                if (pred(info)) out.push(e)
            }
            return out
        },
        /** All vertices used by the listed faces. */
        vertsOfFaces(faces) {
            const s = new Set()
            for (const f of faces) for (const v of faceVerts(m, f)) s.add(v)
            return [...s]
        },
        vertsOfEdges(edges) {
            const s = new Set()
            for (const e of edges) (s.add(m.edgeVerts[e * 2]), s.add(m.edgeVerts[e * 2 + 1]))
            return [...s]
        },
        /** Edges of the listed faces. */
        edgesOfFaces(faces) {
            const s = new Set()
            for (const f of faces) for (let c = m.faceOffsets[f]; c < m.faceOffsets[f + 1]; c++) s.add(m.cornerEdges[c])
            return [...s]
        },
        /** Faces using any of the listed vertices. */
        facesOfVerts(verts) {
            const set = new Set(verts)
            const out = []
            for (let f = 0; f < m.facesNum; f++) if (faceVerts(m, f).some(v => set.has(v))) out.push(f)
            return out
        },
        /** Vertices strictly inside a set of faces (not on its outline). */
        interiorVerts(faces) {
            const inF = new Set(faces)
            const ef2 = ef
            const boundary = new Set()
            for (const f of faces) {
                for (let c = m.faceOffsets[f]; c < m.faceOffsets[f + 1]; c++) {
                    const e = m.cornerEdges[c]
                    if (ef2[e].some(g => !inF.has(g)) || ef2[e].length === 1) {
                        boundary.add(m.edgeVerts[e * 2])
                        boundary.add(m.edgeVerts[e * 2 + 1])
                    }
                }
            }
            return q.vertsOfFaces(faces).filter(v => !boundary.has(v))
        },
        boundaryEdges: () => q.edges(i => i.faces === 1),
    }
    return q
}

/** Angle of a point about the Y axis, degrees in [0, 360), measured from +Z towards +X. */
export function angleXZ(p) {
    const a = Math.atan2(p[0], p[2]) * 180 / Math.PI
    return a < 0 ? a + 360 : a
}
