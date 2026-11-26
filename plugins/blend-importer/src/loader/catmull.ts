// Catmull-Clark subdivision of a polygon cage — a faithful port of gl-catmull-clark (the Wikipedia scheme),
// with gl-vec3 / es6-set / gl-quads-to-tris inlined, plus boundary handling matching Blender's Subsurf
// default. Operates on `positions` (number[][] of xyz) and `cells` (number[][] of n-gon vertex indices).
// This is what Blender's Subsurf actually uses (OSD_SCHEME_CATMARK); the existing Loop subdivider is only
// an approximation on a triangulated cage.
//
// Interior rule (closed mesh): face points (face vertex average), edge points (avg of the edge's endpoints +
// adjacent face points), and repositioned vertex points ((F + 2R + (n-3)P)/n, F = avg adjacent face points,
// R = avg adjacent edge midpoints). Each n-gon face becomes n quads.
//
// Boundary rule (open edges — mesh borders, and later UV seams): a boundary is treated as a cubic B-spline
// curve, independent of the interior, so a flat plane stays flat instead of shrinking inward:
//   - boundary edge point  = midpoint of its two endpoints (no face-point pull)
//   - boundary vertex point = 1/8 prev + 6/8 self + 1/8 next along the boundary run (the 0.75 self + 0.25
//     midpoint form), EXCEPT a sharp corner (the two boundary edges meet at < ~150°, or a non-manifold
//     boundary vertex) is PINNED. This is the same "Keep Corners" rule the Loop subdivider uses, so a square
//     plane keeps its four right-angle corners (Blender's rendered output keeps them).

import {AttrDomain, AttrName, MeshData} from '@threepipe/mesh-kernel'

type V3 = number[]

interface PointObj { point: V3; faces: FaceObj[]; edges: Set<EdgeObj>; newPoint?: V3; _i?: number }
interface FaceObj { points: PointObj[]; edges: EdgeObj[]; facePoint: V3 }
interface EdgeObj { points: [PointObj, PointObj]; faces: FaceObj[]; edgePoint?: V3; midPoint?: V3; boundary?: boolean; _i?: number }

function catmullClarkOnce(positions: V3[], cells: number[][]): {positions: V3[]; cells: number[][]} {
    const originalPoints: PointObj[] = []
    const faces: FaceObj[] = []
    const edges = new Map<string, EdgeObj>()
    const ekey = (a: number, b: number) => (a < b ? a + ',' + b : b + ',' + a)

    // Topology + face points.
    for (let ci = 0; ci < cells.length; ci++) {
        const cp = cells[ci]
        const face: FaceObj = {points: [], edges: [], facePoint: [0, 0, 0]}
        faces[ci] = face
        const fp: V3 = [0, 0, 0]
        for (let j = 0; j < cp.length; j++) {
            const pi = cp[j]
            let po = originalPoints[pi]
            if (!po) { po = originalPoints[pi] = {point: positions[pi], faces: [], edges: new Set()} }
            po.faces.push(face)
            face.points.push(po)
            fp[0] += po.point[0]; fp[1] += po.point[1]; fp[2] += po.point[2]
        }
        face.facePoint = [fp[0] / cp.length, fp[1] / cp.length, fp[2] / cp.length]
        for (let j = 0; j < cp.length; j++) {
            const a = cp[j], b = cp[(j + 1) % cp.length]
            const k = ekey(a, b)
            let eo = edges.get(k)
            if (!eo) { eo = {points: [originalPoints[a], originalPoints[b]], faces: []}; edges.set(k, eo) }
            eo.faces.push(face)
            eo.points[0].edges.add(eo); eo.points[1].edges.add(eo)
            face.edges.push(eo)
        }
    }

    // Edge points + midpoints. A boundary edge (one adjacent face) uses its midpoint (cubic B-spline boundary);
    // an interior edge uses the smooth (facePoints + endpoints)/count rule.
    for (const eo of edges.values()) {
        eo.boundary = eo.faces.length === 1
        eo.midPoint = [(eo.points[0].point[0] + eo.points[1].point[0]) / 2, (eo.points[0].point[1] + eo.points[1].point[1]) / 2, (eo.points[0].point[2] + eo.points[1].point[2]) / 2]
        if (eo.boundary) {
            eo.edgePoint = [eo.midPoint[0], eo.midPoint[1], eo.midPoint[2]]
        } else {
            const avg: V3 = [0, 0, 0]; let cnt = 0
            for (const f of eo.faces) { avg[0] += f.facePoint[0]; avg[1] += f.facePoint[1]; avg[2] += f.facePoint[2]; cnt++ }
            for (const p of eo.points) { avg[0] += p.point[0]; avg[1] += p.point[1]; avg[2] += p.point[2]; cnt++ }
            eo.edgePoint = [avg[0] / cnt, avg[1] / cnt, avg[2] / cnt]
        }
    }

    // Vertex points. Interior verts use (F + 2R + (n-3)P)/n. Boundary verts follow the boundary curve only
    // (1/8,6/8,1/8), with sharp corners pinned — independent of the interior so flat borders stay put.
    for (let i = 0; i < positions.length; i++) {
        const po = originalPoints[i]; if (!po) continue
        // Boundary neighbours: the far endpoint of each boundary edge incident to this vertex.
        const bn: PointObj[] = []
        for (const e of po.edges) if (e.boundary) bn.push(e.points[0] === po ? e.points[1] : e.points[0])
        if (bn.length) {
            let corner = bn.length !== 2 // non-manifold boundary vertex: pin it
            if (bn.length === 2) {
                const e1x = bn[0].point[0] - po.point[0], e1y = bn[0].point[1] - po.point[1], e1z = bn[0].point[2] - po.point[2]
                const e2x = bn[1].point[0] - po.point[0], e2y = bn[1].point[1] - po.point[1], e2z = bn[1].point[2] - po.point[2]
                const denom = (Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z)) || 1
                const cos = (e1x * e2x + e1y * e2y + e1z * e2z) / denom // straight ≈ -1, right-angle = 0
                corner = cos > -0.866 // sharper than ~150° between the two boundary edges
            }
            if (corner) {
                po.newPoint = [po.point[0], po.point[1], po.point[2]]
            } else {
                const mx = (bn[0].point[0] + bn[1].point[0]) / 2, my = (bn[0].point[1] + bn[1].point[1]) / 2, mz = (bn[0].point[2] + bn[1].point[2]) / 2
                po.newPoint = [po.point[0] * 0.75 + mx * 0.25, po.point[1] * 0.75 + my * 0.25, po.point[2] * 0.75 + mz * 0.25]
            }
            continue
        }
        const n = po.faces.length
        const np: V3 = [0, 0, 0]
        for (const f of po.faces) { np[0] += f.facePoint[0]; np[1] += f.facePoint[1]; np[2] += f.facePoint[2] }
        for (const e of po.edges) { np[0] += 2 * e.midPoint![0]; np[1] += 2 * e.midPoint![1]; np[2] += 2 * e.midPoint![2] }
        np[0] /= n; np[1] /= n; np[2] /= n
        np[0] += (n - 3) * po.point[0]; np[1] += (n - 3) * po.point[1]; np[2] += (n - 3) * po.point[2]
        np[0] /= n; np[1] /= n; np[2] /= n
        po.newPoint = np
    }

    // New faces — every original face vertex spawns a quad [prevEdgePt, vertexPt, nextEdgePt, facePt].
    const newPositions: V3[] = []; const newCells: number[][] = []; let idx = 0
    const getIndex = (p: any): number => { if (p._i === undefined) { p._i = idx++; newPositions.push([p[0], p[1], p[2]]) } return p._i }
    for (const face of faces) {
        const m = face.edges.length
        for (let ip = 0; ip < face.points.length; ip++) {
            const a = face.points[ip].newPoint as any
            const b = face.edges[ip].edgePoint as any
            const c = face.facePoint as any
            const d = face.edges[(ip + m - 1) % m].edgePoint as any
            newCells.push([getIndex(d), getIndex(a), getIndex(b), getIndex(c)])
        }
    }
    return {positions: newPositions, cells: newCells}
}

/** Apply `levels` of Catmull-Clark subdivision to a polygon cage. Returns subdivided positions + quad cells. */
export function catmullClark(positions: V3[], cells: number[][], levels: number): {positions: V3[]; cells: number[][]} {
    let obj = {positions, cells}
    for (let i = 0; i < levels; i++) obj = catmullClarkOnce(obj.positions, obj.cells)
    return obj
}

/** A polygon cage: the n-gon faces the subdivider runs on, with per-corner UVs and per-face slots. */
export interface Cage { positions: V3[]; faces: number[][]; uvs: number[][][] | null; materialIndices?: number[] | null }

/**
 * The cage view of an imported {@link MeshData}.
 *
 * Catmull-Clark needs the n-gon topology the render bake has tessellated away, which used to be kept
 * in a partial side-channel (`geometry.userData.__cage`) built only on the 3.6-4.x import path. The
 * `MeshData` the importer now attaches is that same information and more, on every path, so the cage
 * is derived from it instead - which is why a pre-3.6 or a 5.0 file gets faithful Catmull-Clark too.
 *
 * Positions are already in three's Y-up space (converted at import). UVs are read per corner from the
 * same layer the render bake picks, so the base mesh and the subdivided one agree. Material indices
 * are passed on only when there is more than one slot, matching what the bake does with groups.
 */
export function cageFromMeshData(mesh: MeshData): Cage {
    const p = mesh.positions
    const positions: V3[] = new Array(mesh.vertsNum)
    for (let v = 0; v < mesh.vertsNum; v++) positions[v] = [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]

    const faces: number[][] = new Array(mesh.facesNum)
    for (let f = 0; f < mesh.facesNum; f++) faces[f] = mesh.faceVerts(f)

    const uvLayer = mesh.attributes.layersOnDomain(AttrDomain.Corner)
        .find(l => l.type === 'float2' && !l.name.startsWith('.'))
    let uvs: number[][][] | null = null
    if (uvLayer) {
        const d = uvLayer.data
        uvs = new Array(mesh.facesNum)
        for (let f = 0; f < mesh.facesNum; f++) {
            const start = mesh.faceOffsets[f], end = mesh.faceOffsets[f + 1]
            const fuv: number[][] = new Array(end - start)
            for (let c = start; c < end; c++) fuv[c - start] = [d[c * 2], d[c * 2 + 1]]
            uvs[f] = fuv
        }
    }

    const mat = mesh.attributes.get(AttrName.materialIndex)
    let materialIndices: number[] | null = null
    if (mat && mesh.materials.length > 1) {
        materialIndices = new Array(mesh.facesNum)
        for (let f = 0; f < mesh.facesNum; f++) materialIndices[f] = mat.data[f]
    }

    return {positions, faces, uvs, materialIndices}
}

/**
 * Subdivide a polygon cage with `levels` of Catmull-Clark and return a triangulated, indexed BufferGeometry
 * (position + smooth normal + face-varying uv) — the faithful replacement for the Loop approximation when a
 * Subsurf modifier is Catmull-Clark (subdivType==0).
 *
 * Face-varying UVs: a *parallel* uv mesh is built whose points are `(vertex, uv)` corners. Continuous corners
 * (same vertex, same uv) share a uv-point → smoothed like the interior; a UV **seam** (same vertex, different
 * uv) splits into separate uv-points, which turns the seam edges into boundaries in uv space → each side's UVs
 * interpolate as a boundary curve and don't smear across the seam (Blender's default "Keep Corners" uv smooth).
 * Both meshes have identical face structure, so CC produces index-aligned cells — position-points and uv-points
 * zip per output-quad corner.
 *
 * Normals are computed on the position mesh (welded by position index) and copied to the seam-split copies, so
 * a UV seam doesn't introduce a shading crease (both copies share the same smooth normal).
 */
export function subdivideCage(cage: Cage, ctx: any, levels: number, maxTriangles = 400000): any {
    // Cap levels so the triangle count stays within budget (the Loop path caps the same way). Each cage face
    // of valence v → v quads at level 1, then ×4 per extra level; 1 quad = 2 triangles.
    let baseQuads = 0
    for (const f of cage.faces) baseQuads += f.length
    let lv = Math.max(1, levels)
    while (lv > 1 && baseQuads * (4 ** (lv - 1)) * 2 > maxTriangles) lv--
    if (lv < levels) console.warn(`BlendLoader - Catmull-Clark capped at ${lv} level(s) (from ${levels}) to stay within the triangle budget.`)
    levels = lv

    const pos = catmullClark(cage.positions, cage.faces, levels)

    // Per-output-quad material slot (only when the cage carries >1 slot): cage face fi → f.length quads at
    // level 1 (face-order), then each quad → 4 quads per extra level — matching catmullClarkOnce's cell order.
    let cellMat: number[] | null = null
    if (cage.materialIndices) {
        cellMat = []
        for (let fi = 0; fi < cage.faces.length; fi++) { const m = cage.materialIndices[fi] || 0; for (let j = 0; j < cage.faces[fi].length; j++) cellMat.push(m) }
        for (let l = 1; l < levels; l++) { const nm: number[] = []; for (const m of cellMat) { nm.push(m, m, m, m) } cellMat = nm }
    }

    // Parallel face-varying uv mesh (only when the cage carries UVs).
    let uv: {positions: V3[]; cells: number[][]} | null = null
    if (cage.uvs) {
        const uvPoints: V3[] = []
        const uvIndexOf = new Map<string, number>()
        const uvCells: number[][] = []
        for (let fi = 0; fi < cage.faces.length; fi++) {
            const f = cage.faces[fi], fuv = cage.uvs[fi] || []
            const cell: number[] = []
            for (let j = 0; j < f.length; j++) {
                const u = fuv[j]?.[0] ?? 0, w = fuv[j]?.[1] ?? 0
                // Key on (vertex, quantized uv): same vertex+uv merge (continuous); same vertex/different uv
                // split (seam); different vertices never merge. 1e6 quantum keeps float noise from splitting
                // continuous corners while never merging genuinely-different seam uvs.
                const key = f[j] + '|' + Math.round(u * 1e6) + ',' + Math.round(w * 1e6)
                let idx = uvIndexOf.get(key)
                if (idx === undefined) { idx = uvPoints.length; uvPoints.push([u, w, 0]); uvIndexOf.set(key, idx) }
                cell.push(idx)
            }
            uvCells.push(cell)
        }
        uv = catmullClark(uvPoints, uvCells, levels)
    }

    // Smooth normals on the position mesh (welded by position index → seam copies share a normal).
    const triFromQuads = (cells: number[][]) => {
        const idx: number[] = []
        for (const c of cells) { idx.push(c[0], c[1], c[2], c[0], c[2], c[3]) } // quad [d,a,b,c] → (d,a,b),(d,b,c)
        return idx
    }
    const posFlat = new Float32Array(pos.positions.length * 3)
    for (let i = 0; i < pos.positions.length; i++) { posFlat[i * 3] = pos.positions[i][0]; posFlat[i * 3 + 1] = pos.positions[i][1]; posFlat[i * 3 + 2] = pos.positions[i][2] }
    const posGeom = new ctx.BufferGeometry()
    posGeom.setAttribute('position', new ctx.BufferAttribute(posFlat, 3))
    const posTris = triFromQuads(pos.cells)
    posGeom.setIndex(new ctx.BufferAttribute(pos.positions.length > 65535 ? new Uint32Array(posTris) : new Uint16Array(posTris), 1))
    posGeom.computeVertexNormals()
    const nrm = posGeom.attributes.normal.array as Float32Array

    // Final geometry: vertices split at uv seams (key = posIdx|uvIdx), copying the smooth position-normal to
    // both copies; quads triangulated.
    const finalPos: number[] = [], finalNrm: number[] = [], finalUv: number[] = []
    const finalIdxOf = new Map<string, number>()
    const outIdx: number[] = []
    // Material groups: each quad's 2 triangles tagged with its slot, coalesced into contiguous runs.
    const groupRuns: {start: number, count: number, mat: number}[] = []
    const pushGroup = (start: number, count: number, mat: number) => {
        const last = groupRuns[groupRuns.length - 1]
        if (last && last.mat === mat && last.start + last.count === start) last.count += count
        else groupRuns.push({start, count, mat})
    }
    for (let ci = 0; ci < pos.cells.length; ci++) {
        const pc = pos.cells[ci], uc = uv ? uv.cells[ci] : null
        const fv: number[] = []
        for (let k = 0; k < 4; k++) {
            const pIdx = pc[k], uIdx = uc ? uc[k] : -1
            const key = pIdx + '|' + uIdx
            let fi = finalIdxOf.get(key)
            if (fi === undefined) {
                fi = finalPos.length / 3
                finalPos.push(pos.positions[pIdx][0], pos.positions[pIdx][1], pos.positions[pIdx][2])
                finalNrm.push(nrm[pIdx * 3], nrm[pIdx * 3 + 1], nrm[pIdx * 3 + 2])
                if (uv) finalUv.push(uv.positions[uIdx][0], uv.positions[uIdx][1])
                finalIdxOf.set(key, fi)
            }
            fv.push(fi)
        }
        const triStart = outIdx.length
        outIdx.push(fv[0], fv[1], fv[2], fv[0], fv[2], fv[3])
        if (cellMat) pushGroup(triStart, 6, cellMat[ci])
    }

    const geom = new ctx.BufferGeometry()
    geom.setAttribute('position', new ctx.BufferAttribute(new Float32Array(finalPos), 3))
    geom.setAttribute('normal', new ctx.BufferAttribute(new Float32Array(finalNrm), 3))
    if (uv) geom.setAttribute('uv', new ctx.BufferAttribute(new Float32Array(finalUv), 2))
    const vCount = finalPos.length / 3
    geom.setIndex(new ctx.BufferAttribute(vCount > 65535 ? new Uint32Array(outIdx) : new Uint16Array(outIdx), 1))
    if (cellMat) for (const g of groupRuns) geom.addGroup(g.start, g.count, g.mat)
    return geom
}
