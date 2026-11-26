import type {Vector2} from 'threepipe'
import {Ctx} from './ctx'

/**
 * Format-independent polygon mesh, in Blender's own (Z-up) space, read out of a `.blend` by
 * `geometry.ts`. Every Blender mesh layout (legacy MFace, MPoly/MLoop, 4.x CustomData layers,
 * 5.x attribute storage) is reduced to this, so triangulation and normals are done once, the way
 * Blender does them.
 */
export interface MeshSource {
    /** Vertex positions, xyz per vertex. Non-finite values must already be replaced. */
    positions: ArrayLike<number>
    vertCount: number
    /** Corner (loop) range of each face: face f uses corners [faceOffsets[f], faceOffsets[f + 1]). */
    faceOffsets: ArrayLike<number>
    faceCount: number
    /** Vertex index of each corner. */
    cornerVerts: ArrayLike<number>
    /** UV of each corner (2 per corner), or null. */
    cornerUVs?: ArrayLike<number> | null
    /** Material slot of each face, or null. */
    faceMat?: ArrayLike<number> | null
    /** Number of material slots; groups are written only when there is more than one. */
    materialSlots: number
    /** Per face: truthy when the face is flat shaded (Blender "Shade Flat"). Null means all smooth. */
    faceFlat?: ArrayLike<number | boolean> | null
    /** Edges marked sharp, as pairs of vertex indices (a0, b0, a1, b1, ...). */
    sharpEdges?: ArrayLike<number> | null
    /**
     * How smooth faces get their normals:
     * - `vertex`: one normal per vertex from all its faces; sharp edges are ignored. Blender before 4.1
     *   with Auto Smooth off.
     * - `split`: normals are split at sharp edges, at edges next to flat faces, at non-manifold edges and,
     *   when `autoSmoothAngle` is set, at edges whose faces meet at a larger angle. Blender before 4.1
     *   with Auto Smooth on, and Blender 4.1+ (where Auto Smooth became the "Smooth by Angle" modifier).
     */
    normalMode: 'vertex' | 'split'
    /** Split angle in radians, or null for none. */
    autoSmoothAngle?: number | null
}

// ── Small vector helpers on flat arrays ─────────────────────────────
function faceNormal(pos: ArrayLike<number>, cv: ArrayLike<number>, start: number, n: number, out: Float64Array, o: number) {
    // Newell's method: robust for non-planar and concave polygons.
    let nx = 0, ny = 0, nz = 0
    for (let k = 0; k < n; k++) {
        const a = cv[start + k] * 3, b = cv[start + (k + 1) % n] * 3
        const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
        const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
        nx += (ay - by) * (az + bz)
        ny += (az - bz) * (ax + bx)
        nz += (ax - bx) * (ay + by)
    }
    const l = Math.hypot(nx, ny, nz)
    if (l > 0) { out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l } else { out[o] = 0; out[o + 1] = 0; out[o + 2] = 1 }
}

// Interior angle at corner k of a face: Blender weights each face's normal by this angle when
// averaging vertex/corner normals (BKE mesh normals, "angle weighted").
function cornerAngle(pos: ArrayLike<number>, cv: ArrayLike<number>, start: number, n: number, k: number): number {
    const p = cv[start + (k + n - 1) % n] * 3, c = cv[start + k] * 3, x = cv[start + (k + 1) % n] * 3
    const ax = pos[p] - pos[c], ay = pos[p + 1] - pos[c + 1], az = pos[p + 2] - pos[c + 2]
    const bx = pos[x] - pos[c], by = pos[x + 1] - pos[c + 1], bz = pos[x + 2] - pos[c + 2]
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz)
    if (!(la > 0) || !(lb > 0)) return 0
    const d = (ax * bx + ay * by + az * bz) / (la * lb)
    return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d)
}

// ── Triangulation ───────────────────────────────────────────────────
/**
 * Triangulate one face, returning triangles as corner offsets within the face (0..n-1), wound like
 * the face. Matches Blender's tessellation: quads split along 0-2 unless that diagonal is outside the
 * quad (`is_quad_flip_v3_first_third_fast`), n-gons are ear-clipped in the plane of the face (so
 * concave faces don't get triangles across their gaps).
 */
function triangulateFace(pos: ArrayLike<number>, cv: ArrayLike<number>, start: number, n: number, fn: Float64Array, fo: number, ctx: Ctx): number[] {
    if (n === 3) return [0, 1, 2]
    if (n === 4) {
        const v1 = cv[start] * 3, v2 = cv[start + 1] * 3, v3 = cv[start + 2] * 3, v4 = cv[start + 3] * 3
        const d12x = pos[v2] - pos[v1], d12y = pos[v2 + 1] - pos[v1 + 1], d12z = pos[v2 + 2] - pos[v1 + 2]
        const d13x = pos[v3] - pos[v1], d13y = pos[v3 + 1] - pos[v1 + 1], d13z = pos[v3 + 2] - pos[v1 + 2]
        const d14x = pos[v4] - pos[v1], d14y = pos[v4 + 1] - pos[v1 + 1], d14z = pos[v4 + 2] - pos[v1 + 2]
        const ax = d12y * d13z - d12z * d13y, ay = d12z * d13x - d12x * d13z, az = d12x * d13y - d12y * d13x
        const bx = d14y * d13z - d14z * d13y, by = d14z * d13x - d14x * d13z, bz = d14x * d13y - d14y * d13x
        const flip = ax * bx + ay * by + az * bz > 0
        return flip ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3]
    }
    // n-gon: project onto the face plane and ear-clip.
    const nx = fn[fo], ny = fn[fo + 1], nz = fn[fo + 2]
    // Any vector not parallel to the normal -> orthonormal basis (u, w) of the plane.
    let ux = 0, uy = 0, uz = 0
    if (Math.abs(nx) < 0.9) { ux = 0; uy = nz; uz = -ny } else { ux = -nz; uy = 0; uz = nx }
    const ul = Math.hypot(ux, uy, uz) || 1
    ux /= ul; uy /= ul; uz /= ul
    const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux
    const contour: Vector2[] = []
    for (let k = 0; k < n; k++) {
        const p = cv[start + k] * 3
        contour.push(new ctx.Vector2(pos[p] * ux + pos[p + 1] * uy + pos[p + 2] * uz, pos[p] * wx + pos[p + 1] * wy + pos[p + 2] * wz))
    }
    let tris: number[] = []
    try {
        for (const t of ctx.ShapeUtils.triangulateShape(contour, [])) tris.push(t[0], t[1], t[2])
    } catch (e) {
        tris = []
    }
    if (!tris.length) { // degenerate polygon: fall back to a fan so the face is not lost
        for (let k = 1; k < n - 1; k++) tris.push(0, k, k + 1)
        return tris
    }
    // Earcut's output winding is not tied to the input's: wind every triangle like the face.
    for (let t = 0; t < tris.length; t += 3) {
        const a = contour[tris[t]], b = contour[tris[t + 1]], c = contour[tris[t + 2]]
        // (u, w, n) is right-handed, so a positive 2D area means the triangle faces along n.
        if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) { const s = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = s }
    }
    return tris
}

// ── Corner normals ──────────────────────────────────────────────────
function findRoot(parent: Int32Array, i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
}

/**
 * One normal per corner, computed like Blender: flat faces use the face normal; smooth faces use the
 * angle-weighted average of the faces around the vertex, either all of them (`vertex` mode) or only the
 * ones reachable without crossing a sharp edge (`split` mode, Blender's "smooth fans").
 */
function computeCornerNormals(src: MeshSource, valid: Uint8Array, fn: Float64Array): Float32Array {
    const {positions: pos, cornerVerts: cv, faceOffsets: fo, faceCount, vertCount, faceFlat} = src
    const loopCount = cv.length
    const out = new Float32Array(loopCount * 3)
    const isFlat = (f: number) => !!(faceFlat && faceFlat[f])

    // Angle-weighted face normal contribution of each corner.
    const weight = new Float64Array(loopCount)
    for (let f = 0; f < faceCount; f++) {
        if (!valid[f]) continue
        const s = fo[f], n = fo[f + 1] - s
        for (let k = 0; k < n; k++) weight[s + k] = cornerAngle(pos, cv, s, n, k)
    }

    if (src.normalMode === 'vertex') {
        const vn = new Float64Array(vertCount * 3)
        for (let f = 0; f < faceCount; f++) {
            if (!valid[f]) continue
            const s = fo[f], e = fo[f + 1]
            for (let c = s; c < e; c++) {
                const v = cv[c] * 3, w = weight[c]
                vn[v] += fn[f * 3] * w; vn[v + 1] += fn[f * 3 + 1] * w; vn[v + 2] += fn[f * 3 + 2] * w
            }
        }
        for (let f = 0; f < faceCount; f++) {
            if (!valid[f]) continue
            const s = fo[f], e = fo[f + 1], flat = isFlat(f)
            for (let c = s; c < e; c++) {
                const v = cv[c] * 3
                let x = fn[f * 3], y = fn[f * 3 + 1], z = fn[f * 3 + 2]
                if (!flat) {
                    const l = Math.hypot(vn[v], vn[v + 1], vn[v + 2])
                    if (l > 0) { x = vn[v] / l; y = vn[v + 1] / l; z = vn[v + 2] / l }
                }
                out[c * 3] = x; out[c * 3 + 1] = y; out[c * 3 + 2] = z
            }
        }
        return out
    }

    // split mode: union the corners of a vertex across every smooth edge, then average per group.
    const sharp = new Set<number>()
    const edgeKey = (a: number, b: number) => a < b ? a * vertCount + b : b * vertCount + a
    const se = src.sharpEdges
    if (se) for (let i = 0; i + 1 < se.length; i += 2) sharp.add(edgeKey(se[i], se[i + 1]))
    const cosAngle = src.autoSmoothAngle !== null && src.autoSmoothAngle !== undefined ? Math.cos(src.autoSmoothAngle) : -2

    // edge -> the (up to 2) corners that start it. More than 2 => non-manifold => sharp.
    const edgeFirst = new Map<number, number>() // key -> corner index, or -1 once non-manifold
    const edgeSecond = new Map<number, number>()
    const cornerFace = new Int32Array(loopCount).fill(-1)
    const nextCorner = new Int32Array(loopCount)
    for (let f = 0; f < faceCount; f++) {
        if (!valid[f]) continue
        const s = fo[f], n = fo[f + 1] - s
        for (let k = 0; k < n; k++) {
            const c = s + k, c2 = s + (k + 1) % n
            cornerFace[c] = f
            nextCorner[c] = c2
            if (isFlat(f)) continue // edges of flat faces never join smooth fans
            const key = edgeKey(cv[c], cv[c2])
            const first = edgeFirst.get(key)
            if (first === undefined) edgeFirst.set(key, c)
            else if (first >= 0 && !edgeSecond.has(key)) edgeSecond.set(key, c)
            else { edgeFirst.set(key, -1); edgeSecond.delete(key) }
        }
    }

    const parent = new Int32Array(loopCount)
    for (let i = 0; i < loopCount; i++) parent[i] = i
    const union = (a: number, b: number) => { const ra = findRoot(parent, a), rb = findRoot(parent, b); if (ra !== rb) parent[ra] = rb }
    for (const [key, c1] of edgeSecond) {
        const c0 = edgeFirst.get(key)!
        if (c0 < 0 || sharp.has(key)) continue
        const f0 = cornerFace[c0], f1 = cornerFace[c1]
        if (f0 === f1) continue
        // Neighbours must traverse the edge in opposite directions; otherwise their normals point
        // opposite ways (flipped winding) and Blender splits there.
        if (cv[c0] === cv[c1]) continue
        if (cosAngle > -2 && fn[f0 * 3] * fn[f1 * 3] + fn[f0 * 3 + 1] * fn[f1 * 3 + 1] + fn[f0 * 3 + 2] * fn[f1 * 3 + 2] < cosAngle) continue
        // c0 runs a -> b and c1 runs b -> a: join the two corners at a, and the two at b.
        union(c0, nextCorner[c1])
        union(nextCorner[c0], c1)
    }

    const acc = new Float64Array(loopCount * 3)
    for (let c = 0; c < loopCount; c++) {
        const f = cornerFace[c]
        if (f < 0) continue
        const r = findRoot(parent, c), w = weight[c] || 1e-12
        acc[r * 3] += fn[f * 3] * w; acc[r * 3 + 1] += fn[f * 3 + 1] * w; acc[r * 3 + 2] += fn[f * 3 + 2] * w
    }
    for (let c = 0; c < loopCount; c++) {
        const f = cornerFace[c]
        if (f < 0) continue
        const r = findRoot(parent, c)
        let x = acc[r * 3], y = acc[r * 3 + 1], z = acc[r * 3 + 2]
        const l = Math.hypot(x, y, z)
        if (l > 0) { x /= l; y /= l; z /= l } else { x = fn[f * 3]; y = fn[f * 3 + 1]; z = fn[f * 3 + 2] }
        out[c * 3] = x; out[c * 3 + 1] = y; out[c * 3 + 2] = z
    }
    return out
}

/**
 * A mesh with no faces (loose edges or points only, e.g. a geometry-nodes input) renders nothing in
 * Blender. three's renderer needs a `position` attribute on every geometry it draws, so give it an empty
 * one rather than none.
 */
export function withEmptyPosition(geometry: any, ctx: Ctx) {
    if (!geometry.attributes.position) geometry.setAttribute('position', new ctx.BufferAttribute(new Float32Array(0), 3))
    return geometry
}

/**
 * Build a three.js BufferGeometry from a {@link MeshSource}: triangulates every face like Blender,
 * computes Blender's corner normals, and splits vertices wherever corners that share a Blender vertex
 * differ in normal or UV (hard edges, flat faces, UV seams). Triangles are ordered by material slot so a
 * multi-material mesh has one group per slot. Converts Blender Z-up to three.js Y-up.
 */
export function buildGeometry(src: MeshSource, name: string, ctx: Ctx) {
    const geometry = new ctx.BufferGeometry()
    geometry.name = name
    const {positions: pos, cornerVerts: cv, faceOffsets: fo, faceCount, vertCount} = src
    const loopCount = cv.length
    if (!vertCount || !faceCount) return withEmptyPosition(geometry, ctx)

    // Skip faces that reference missing corners/vertices (corrupt or partial data) instead of failing.
    const valid = new Uint8Array(faceCount)
    const fn = new Float64Array(faceCount * 3)
    for (let f = 0; f < faceCount; f++) {
        const s = fo[f], e = fo[f + 1]
        if (!(e - s >= 3 && s >= 0 && e <= loopCount)) continue
        let ok = true
        for (let c = s; c < e; c++) { const v = cv[c]; if (!(v >= 0 && v < vertCount)) { ok = false; break } }
        if (!ok) continue
        valid[f] = 1
        faceNormal(pos, cv, s, e - s, fn, f * 3)
    }

    const cn = computeCornerNormals(src, valid, fn)
    const uv = src.cornerUVs && src.cornerUVs.length >= loopCount * 2 ? src.cornerUVs : null

    // Weld corners into output vertices: same Blender vertex + same normal + same UV.
    const cornerOut = new Int32Array(loopCount).fill(-1)
    const perVert: number[][] = new Array(vertCount)
    const outPos: number[] = [], outNor: number[] = [], outUv: number[] = []
    const EPS = 1e-5
    for (let f = 0; f < faceCount; f++) {
        if (!valid[f]) continue
        for (let c = fo[f]; c < fo[f + 1]; c++) {
            const v = cv[c]
            const nx = cn[c * 3], ny = cn[c * 3 + 1], nz = cn[c * 3 + 2]
            const u = uv ? uv[c * 2] : 0, w = uv ? uv[c * 2 + 1] : 0
            let list = perVert[v]
            let found = -1
            if (list) {
                for (const o of list) {
                    if (Math.abs(outNor[o * 3] - nx) < EPS && Math.abs(outNor[o * 3 + 1] - ny) < EPS && Math.abs(outNor[o * 3 + 2] - nz) < EPS
                        && (!uv || Math.abs(outUv[o * 2] - u) < EPS && Math.abs(outUv[o * 2 + 1] - w) < EPS)) { found = o; break }
                }
            } else list = perVert[v] = []
            if (found < 0) {
                found = outPos.length / 3
                list.push(found)
                outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
                outNor.push(nx, ny, nz)
                if (uv) outUv.push(Number.isFinite(u) ? u : 0, Number.isFinite(w) ? w : 0)
            }
            cornerOut[c] = found
        }
    }

    // Triangles, bucketed by material slot.
    const useGroups = src.materialSlots > 1 && !!src.faceMat
    const buckets = new Map<number, number[]>()
    for (let f = 0; f < faceCount; f++) {
        if (!valid[f]) continue
        const s = fo[f], n = fo[f + 1] - s
        const mat = useGroups ? src.faceMat![f] || 0 : 0
        let b = buckets.get(mat)
        if (!b) buckets.set(mat, b = [])
        const tris = triangulateFace(pos, cv, s, n, fn, f * 3, ctx)
        for (const t of tris) b.push(cornerOut[s + t])
    }
    const mats = [...buckets.keys()].sort((a, b) => a - b)
    let total = 0
    for (const m of mats) total += buckets.get(m)!.length
    const vCount = outPos.length / 3
    const index = vCount > 65535 ? new Uint32Array(total) : new Uint16Array(total)
    let off = 0
    for (const m of mats) {
        const b = buckets.get(m)!
        index.set(b, off)
        if (useGroups) geometry.addGroup(off, b.length, m)
        off += b.length
    }

    // Blender Z-up (x, y, z) -> three.js Y-up (x, z, -y). A rotation, so winding is preserved.
    const P = new Float32Array(vCount * 3), N = new Float32Array(vCount * 3)
    for (let i = 0; i < vCount; i++) {
        P[i * 3] = outPos[i * 3]; P[i * 3 + 1] = outPos[i * 3 + 2]; P[i * 3 + 2] = -outPos[i * 3 + 1]
        N[i * 3] = outNor[i * 3]; N[i * 3 + 1] = outNor[i * 3 + 2]; N[i * 3 + 2] = -outNor[i * 3 + 1]
    }
    geometry.setAttribute('position', new ctx.BufferAttribute(P, 3))
    geometry.setAttribute('normal', new ctx.BufferAttribute(N, 3))
    // Blender and three.js share the same UV origin (bottom-left), so no V flip.
    if (uv) geometry.setAttribute('uv', new ctx.BufferAttribute(new Float32Array(outUv), 2))
    geometry.setIndex(new ctx.BufferAttribute(index, 1))
    return geometry
}
