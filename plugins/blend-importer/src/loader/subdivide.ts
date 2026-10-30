import {Ctx} from './ctx'

// Loop subdivision of an indexed triangle BufferGeometry: each triangle -> 4, with new edge vertices
// positioned by the Loop weights (3/8 of the edge endpoints + 1/8 of the two opposite vertices) and the
// original vertices repositioned toward the limit surface by valence-weighted beta. This smooths the base
// cage (matching what Blender's Subdivision Surface modifier does for rendering) and densifies it so a
// `displacementMap` actually has geometry to move. UVs are interpolated linearly (split at UV seams is not
// handled — fine for the contiguous UV layouts these previews use). Returns a new geometry; falls back to
// the input unchanged if it isn't an indexed triangle mesh.
function subdivideOnce(pos: Float32Array, uv: Float32Array | null, index: Uint32Array | Uint16Array, ctx: Ctx, simple: boolean) {
    const vCount = pos.length / 3
    // Per-undirected-edge: the two endpoint verts + up to two opposite verts (for the 3/8+1/8 weights),
    // and the index of the inserted midpoint vertex.
    const edgeKey = (a: number, b: number) => a < b ? a * vCount + b : b * vCount + a
    const edges = new Map<number, {a: number, b: number, opp: number[], mid: number}>()
    const getEdge = (a: number, b: number) => {
        const k = edgeKey(a, b)
        let e = edges.get(k)
        if (!e) { e = {a, b, opp: [], mid: -1}; edges.set(k, e) }
        return e
    }
    // First pass: collect edges + their opposite verts, and per-vertex neighbours (for repositioning).
    const neighbours: Set<number>[] = Array.from({length: vCount}, () => new Set<number>())
    for (let t = 0; t < index.length; t += 3) {
        const a = index[t], b = index[t + 1], c = index[t + 2]
        getEdge(a, b).opp.push(c); getEdge(b, c).opp.push(a); getEdge(c, a).opp.push(b)
        neighbours[a].add(b); neighbours[a].add(c)
        neighbours[b].add(a); neighbours[b].add(c)
        neighbours[c].add(a); neighbours[c].add(b)
    }

    const outPos: number[] = []
    const outUv: number[] | null = uv ? [] : null

    // Reposition original vertices (Loop): interior vert with valence n uses beta; boundary verts (an edge
    // with only one adjacent face) use the 1/8,3/4,1/8 boundary mask.
    const isBoundaryVert = new Uint8Array(vCount)
    for (const e of edges.values()) if (e.opp.length === 1) { isBoundaryVert[e.a] = 1; isBoundaryVert[e.b] = 1 }
    for (let v = 0; v < vCount; v++) {
        const nb = neighbours[v]; const n = nb.size
        let x = 0, y = 0, z = 0, u = 0, w = 0
        if (simple) {
            // SUBSURF_TYPE_SIMPLE: linear subdivision — original vertices are kept in place (no smoothing).
            x = pos[v * 3]; y = pos[v * 3 + 1]; z = pos[v * 3 + 2]
            if (uv) { u = uv[v * 2]; w = uv[v * 2 + 1] }
        } else if (isBoundaryVert[v]) {
            // Collect this boundary vertex's boundary neighbours (the verts across its boundary edges).
            const bn: number[] = []
            for (const e of edges.values()) {
                if (e.opp.length === 1 && (e.a === v || e.b === v)) bn.push(e.a === v ? e.b : e.a)
            }
            // "Keep Corners" (Blender Subsurf default): a boundary vertex whose two boundary edges meet at a
            // sharp angle is a CORNER — keep it fixed so a flat plane stays a square (the smooth boundary
            // rule otherwise pulls every corner inward, rounding the plane into a shrunken disc). Only the
            // ~collinear boundary run uses the 1/8,6/8,1/8 cubic rule (a no-op on straight edges).
            let corner = bn.length !== 2 // non-manifold boundary vertex: pin it
            if (bn.length === 2) {
                const e1x = pos[bn[0] * 3] - pos[v * 3], e1y = pos[bn[0] * 3 + 1] - pos[v * 3 + 1], e1z = pos[bn[0] * 3 + 2] - pos[v * 3 + 2]
                const e2x = pos[bn[1] * 3] - pos[v * 3], e2y = pos[bn[1] * 3 + 1] - pos[v * 3 + 1], e2z = pos[bn[1] * 3 + 2] - pos[v * 3 + 2]
                const denom = (Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z)) || 1
                const cos = (e1x * e2x + e1y * e2y + e1z * e2z) / denom // straight ≈ -1, right-angle = 0
                corner = cos > -0.866 // sharper than ~150° between the two edges
            }
            if (corner) {
                x = pos[v * 3]; y = pos[v * 3 + 1]; z = pos[v * 3 + 2]
                if (uv) { u = uv[v * 2]; w = uv[v * 2 + 1] }
            } else {
                const mx = (pos[bn[0] * 3] + pos[bn[1] * 3]) / 2, my = (pos[bn[0] * 3 + 1] + pos[bn[1] * 3 + 1]) / 2, mz = (pos[bn[0] * 3 + 2] + pos[bn[1] * 3 + 2]) / 2
                x = pos[v * 3] * 0.75 + mx * 0.25; y = pos[v * 3 + 1] * 0.75 + my * 0.25; z = pos[v * 3 + 2] * 0.75 + mz * 0.25
                if (uv) {
                    const mu = (uv[bn[0] * 2] + uv[bn[1] * 2]) / 2, mw = (uv[bn[0] * 2 + 1] + uv[bn[1] * 2 + 1]) / 2
                    u = uv[v * 2] * 0.75 + mu * 0.25; w = uv[v * 2 + 1] * 0.75 + mw * 0.25
                }
            }
        } else {
            const beta = n === 3 ? 3 / 16 : 3 / (8 * n)
            let sx = 0, sy = 0, sz = 0, su = 0, sw = 0
            for (const o of nb) {
                sx += pos[o * 3]; sy += pos[o * 3 + 1]; sz += pos[o * 3 + 2]
                if (uv) { su += uv[o * 2]; sw += uv[o * 2 + 1] }
            }
            x = pos[v * 3] * (1 - n * beta) + sx * beta
            y = pos[v * 3 + 1] * (1 - n * beta) + sy * beta
            z = pos[v * 3 + 2] * (1 - n * beta) + sz * beta
            if (uv) { u = uv[v * 2] * (1 - n * beta) + su * beta; w = uv[v * 2 + 1] * (1 - n * beta) + sw * beta }
        }
        outPos.push(x, y, z)
        if (outUv) outUv.push(u, w)
    }

    // Insert edge (midpoint) vertices.
    for (const e of edges.values()) {
        e.mid = outPos.length / 3
        const {a, b, opp} = e
        let x: number, y: number, z: number, u = 0, w = 0
        if (opp.length === 2 && !simple) {
            const [c, d] = opp
            x = (pos[a * 3] + pos[b * 3]) * 3 / 8 + (pos[c * 3] + pos[d * 3]) / 8
            y = (pos[a * 3 + 1] + pos[b * 3 + 1]) * 3 / 8 + (pos[c * 3 + 1] + pos[d * 3 + 1]) / 8
            z = (pos[a * 3 + 2] + pos[b * 3 + 2]) * 3 / 8 + (pos[c * 3 + 2] + pos[d * 3 + 2]) / 8
        } else { // SUBSURF_TYPE_SIMPLE or boundary edge → plain midpoint (no smoothing)
            x = (pos[a * 3] + pos[b * 3]) / 2; y = (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2; z = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2
        }
        if (uv) { u = (uv[a * 2] + uv[b * 2]) / 2; w = (uv[a * 2 + 1] + uv[b * 2 + 1]) / 2 }
        outPos.push(x, y, z)
        if (outUv) outUv.push(u, w)
    }

    // Build the 4 sub-triangles per original triangle.
    const outIdx: number[] = []
    for (let t = 0; t < index.length; t += 3) {
        const a = index[t], b = index[t + 1], c = index[t + 2]
        const ab = edges.get(edgeKey(a, b))!.mid
        const bc = edges.get(edgeKey(b, c))!.mid
        const ca = edges.get(edgeKey(c, a))!.mid
        outIdx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
    }

    const geom = new ctx.BufferGeometry()
    geom.setAttribute('position', new ctx.BufferAttribute(new Float32Array(outPos), 3))
    if (outUv) geom.setAttribute('uv', new ctx.BufferAttribute(new Float32Array(outUv), 2))
    geom.setIndex(new ctx.BufferAttribute(outPos.length / 3 > 65535 ? new Uint32Array(outIdx) : new Uint16Array(outIdx), 1))
    return geom
}

/**
 * Apply `iterations` of subdivision to an indexed triangle geometry, capped so the triangle count doesn't
 * exceed `maxTriangles`. With `simple` (SUBSURF_TYPE_SIMPLE) it's linear — original verts kept, plain edge
 * midpoints, no smoothing (a Simple-subsurf cube stays a cube); otherwise it smooths (Loop approximation of
 * Blender's Catmull-Clark). Recomputes smooth vertex normals. Groups are preserved (ranges ×4 per iteration).
 */
export function subdivideGeometry(geometry: any, ctx: Ctx, iterations: number, maxTriangles = 400000, simple = false): any {
    if (iterations <= 0 || !geometry.index || !geometry.attributes.position) return geometry
    let pos = geometry.attributes.position.array as Float32Array
    let uv = geometry.attributes.uv ? geometry.attributes.uv.array as Float32Array : null
    let index = geometry.index.array as Uint32Array | Uint16Array
    const groups = geometry.groups && geometry.groups.length ? geometry.groups.map((g: any) => ({...g})) : null

    let out = geometry
    for (let i = 0; i < iterations; i++) {
        if (index.length / 3 * 4 > maxTriangles) break // stop before exceeding the triangle budget
        out = subdivideOnce(pos, uv, index, ctx, simple)
        pos = out.attributes.position.array
        uv = out.attributes.uv ? out.attributes.uv.array : null
        index = out.index.array
        if (groups) for (const g of groups) { g.start *= 4; g.count *= 4 }
    }
    if (out === geometry) return geometry
    if (groups) for (const g of groups) out.addGroup(g.start, g.count, g.materialIndex)
    out.computeVertexNormals()
    out.name = geometry.name
    return out
}
