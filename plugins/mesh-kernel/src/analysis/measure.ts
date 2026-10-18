/**
 * Measured facts about a mesh, as plain data: counts, bounds, area, volume, and the topology an agent
 * needs before it trusts a render - boundary and non-manifold edges, winding consistency, Euler
 * characteristic, connected pieces and boundary loops.
 *
 * Everything here is computed, not inferred from a picture, so it is what a check should be written
 * against (`verifySpec`), and what an agent should read *before* it looks.
 */

import {MeshData} from '../MeshData'
import {AttrDomain, AttrName, attrDomainName} from '../constants'
import {bakeGeometry} from '../bake'

export type Mat4Like = ArrayLike<number>

export interface MeshMeasure {
    verts: number
    edges: number
    faces: number
    corners: number
    /** Triangles after tessellation (what the renderer draws). */
    tris: number
    /** Axis-aligned bounds in the space the matrix maps into (world, when one is given). */
    bounds: {min: number[], max: number[], size: number[], center: number[]} | null
    /** Total face area, after the matrix. */
    area: number
    /**
     * Enclosed volume by the divergence theorem over the tessellation, after the matrix. Only meaningful
     * when {@link closed} and {@link consistentWinding}; negative when the faces point inwards.
     */
    volume: number
    /** Edge counts by how many faces use them. */
    edgeUse: {wire: number, boundary: number, manifold: number, nonManifold: number}
    /** Vertices no edge uses. */
    looseVerts: number
    /** No boundary, wire or non-manifold edges: the surface encloses something. */
    closed: boolean
    /** Every two-face edge is walked in opposite directions by its faces. */
    consistentWinding: boolean
    /** Two-face edges walked the same way by both faces - a flipped face's border. */
    inconsistentEdges: number
    /** V - E + F. */
    eulerCharacteristic: number
    /** Connected pieces (by edges; loose verts count as pieces). */
    components: number
    /** Connected chains of boundary edges - the holes (two holes meeting at a vertex count as one). */
    boundaryLoops: number
    /** Derived from the Euler characteristic; only defined for a closed, consistently wound mesh. */
    genus: number | null
    /** Material slot names, and the slot indices faces actually use. */
    materialSlots: string[]
    usedMaterialIndices: number[]
    /** User attribute layers (internal `.`-prefixed ones and `position` are left out). */
    attributeLayers: {name: string, domain: string, type: string}[]
}

/** Apply a column-major 4x4 matrix (three.js `Matrix4.elements`) to a point. */
export function applyMat4(m: Mat4Like, x: number, y: number, z: number): [number, number, number] {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1
    return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ]
}

/** Positions after an optional matrix, as a fresh array. */
export function transformedPositions(mesh: MeshData, matrix?: Mat4Like | null): Float32Array {
    const pos = mesh.positions
    if (!matrix) return pos.slice()
    const out = new Float32Array(pos.length)
    for (let i = 0; i < mesh.vertsNum; i++) {
        const p = applyMat4(matrix, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
        out[i * 3] = p[0]
        out[i * 3 + 1] = p[1]
        out[i * 3 + 2] = p[2]
    }
    return out
}

class UnionFind {
    parent: Int32Array
    constructor(n: number) {
        this.parent = new Int32Array(n)
        for (let i = 0; i < n; i++) this.parent[i] = i
    }
    find(a: number): number {
        while (this.parent[a] !== a) {
            this.parent[a] = this.parent[this.parent[a]]
            a = this.parent[a]
        }
        return a
    }
    union(a: number, b: number): void {
        const ra = this.find(a)
        const rb = this.find(b)
        if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb)
    }
}

/** Measure a mesh. `matrix` (column-major 4x4) maps it into the space bounds, area and volume are given in. */
export function measureMesh(mesh: MeshData, options: {matrix?: Mat4Like | null} = {}): MeshMeasure {
    const pos = transformedPositions(mesh, options.matrix)
    const vertsNum = mesh.vertsNum
    const edgesNum = mesh.edgesNum

    // bounds
    let bounds: MeshMeasure['bounds'] = null
    if (vertsNum) {
        const min = [Infinity, Infinity, Infinity]
        const max = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < vertsNum; i++) {
            for (let k = 0; k < 3; k++) {
                const v = pos[i * 3 + k]
                if (v < min[k]) min[k] = v
                if (v > max[k]) max[k] = v
            }
        }
        bounds = {
            min, max,
            size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
            center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
        }
    }

    // area and volume from the tessellation the renderer draws
    const {data, triangleToFace} = bakeGeometry(mesh, {uvLayer: null})
    const cornerVerts = mesh.cornerVerts
    let area = 0
    let volume = 0
    const idx = data.index
    for (let t = 0; t < triangleToFace.length; t++) {
        // bake emits one position per corner, so an index is a corner index
        const a = cornerVerts[idx[t * 3]] * 3
        const b = cornerVerts[idx[t * 3 + 1]] * 3
        const c = cornerVerts[idx[t * 3 + 2]] * 3
        const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
        const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
        const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2]
        const ux = bx - ax, uy = by - ay, uz = bz - az
        const vx = cx - ax, vy = cy - ay, vz = cz - az
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
        area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2
        volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    }

    // edge use and winding
    const use = new Int32Array(edgesNum)
    const forward = new Int32Array(edgesNum) // +1 per corner walking v1 -> v2, -1 for v2 -> v1
    const ev = mesh.edgeVerts
    const cornerEdges = mesh.cornerEdges
    for (let f = 0; f < mesh.facesNum; f++) {
        const start = mesh.faceOffsets[f]
        const end = mesh.faceOffsets[f + 1]
        for (let c = start; c < end; c++) {
            const e = cornerEdges[c]
            use[e]++
            forward[e] += cornerVerts[c] === ev[e * 2] ? 1 : -1
        }
    }
    const edgeUse = {wire: 0, boundary: 0, manifold: 0, nonManifold: 0}
    let inconsistentEdges = 0
    const vertHasEdge = new Uint8Array(vertsNum)
    const uf = new UnionFind(vertsNum)
    const boundaryUf = new UnionFind(vertsNum)
    const onBoundary = new Uint8Array(vertsNum)
    for (let e = 0; e < edgesNum; e++) {
        const a = ev[e * 2]
        const b = ev[e * 2 + 1]
        vertHasEdge[a] = vertHasEdge[b] = 1
        uf.union(a, b)
        const n = use[e]
        if (n === 0) edgeUse.wire++
        else if (n === 1) {
            edgeUse.boundary++
            boundaryUf.union(a, b)
            onBoundary[a] = onBoundary[b] = 1
        } else if (n === 2) {
            edgeUse.manifold++
            if (forward[e] !== 0) inconsistentEdges++
        } else edgeUse.nonManifold++
    }
    let looseVerts = 0
    const roots = new Set<number>()
    const boundaryRoots = new Set<number>()
    for (let v = 0; v < vertsNum; v++) {
        if (!vertHasEdge[v]) looseVerts++
        roots.add(uf.find(v))
        if (onBoundary[v]) boundaryRoots.add(boundaryUf.find(v))
    }

    const closed = vertsNum > 0 && edgeUse.boundary === 0 && edgeUse.wire === 0 && edgeUse.nonManifold === 0
    const consistentWinding = inconsistentEdges === 0
    const euler = vertsNum - edgesNum + mesh.facesNum
    const components = roots.size
    // Each closed orientable piece has chi = 2 - 2g, so the summed genus is components - chi / 2.
    const genus = closed && consistentWinding && looseVerts === 0 ? components - euler / 2 : null

    const materialIndex = mesh.attributes.get(AttrName.materialIndex)
    const used = new Set<number>()
    if (materialIndex && materialIndex.domain === AttrDomain.Face) {
        for (let f = 0; f < mesh.facesNum; f++) used.add(materialIndex.data[f])
    } else if (mesh.facesNum) used.add(0)

    return {
        verts: vertsNum,
        edges: edgesNum,
        faces: mesh.facesNum,
        corners: mesh.cornersNum,
        tris: triangleToFace.length,
        bounds,
        area,
        volume,
        edgeUse,
        looseVerts,
        closed,
        consistentWinding,
        inconsistentEdges,
        eulerCharacteristic: euler,
        components,
        boundaryLoops: boundaryRoots.size,
        genus,
        materialSlots: [...mesh.materials],
        usedMaterialIndices: [...used].sort((a, b) => a - b),
        attributeLayers: mesh.attributes.layers()
            .filter(l => !l.name.startsWith('.') && l.name !== AttrName.position)
            .map(l => ({name: l.name, domain: attrDomainName(l.domain), type: l.type})),
    }
}
