/**
 * Recovering a {@link MeshData} from renderable buffers.
 *
 * The inverse of `bake.ts`, and necessarily lossy in the other direction: a `BufferGeometry` is a
 * triangle soup with per-corner vertices, so the shared-vertex topology an editable mesh needs has to
 * be *recovered* by welding positions back together. Two corners at the same position become one
 * vertex; their differing UVs or normals stay per-corner, which is exactly what the corner domain is
 * for.
 *
 * Use this to enter edit mode on an imported asset. Meshes that came from the kernel should keep their
 * `MeshData` instead of round-tripping through here, because welding cannot know which coincident
 * vertices were deliberately separate.
 */

import {MeshData} from './MeshData'
import {AttrDomain, AttrName} from './constants'
import {bmFromMesh, bmToMesh} from './bmesh/convert'
import {joinFaceKillEdge} from './bmesh/euler'
import {edgeIsManifold} from './bmesh/structure'
import {BMFace} from './bmesh/types'

export interface UnbakeInput {
    /** Flat xyz triples. */
    position: ArrayLike<number>
    /** Triangle indices. When absent the positions are treated as a non-indexed triangle list. */
    index?: ArrayLike<number> | null
    /** Flat uv pairs, one per input vertex. Carried through to the corner domain. */
    uv?: ArrayLike<number> | null
    /** Material group runs over the index buffer, as three's `geometry.groups`. */
    groups?: {start: number, count: number, materialIndex?: number}[]
}

export interface UnbakeOptions {
    /**
     * Positions closer than this in every axis are welded into one vertex. The default matches
     * three's `mergeVertices` tolerance.
     */
    tolerance?: number
    /**
     * Merge coplanar triangles that share an edge back into n-gons. Off by default: it is a guess
     * about authoring intent, and a wrong guess is worse than an honest triangle mesh.
     */
    mergeCoplanar?: boolean
    /** Angle in radians below which two faces count as coplanar for {@link mergeCoplanar}. */
    coplanarAngle?: number
}

export interface UnbakeResult {
    mesh: MeshData
    /** Source vertex index for each welded vertex, for mapping attributes the caller still holds. */
    weldedFrom: Int32Array[]
    /** How many input vertices collapsed away. */
    weldedCount: number
}

/**
 * Build a `MeshData` from triangle buffers, welding coincident positions to recover shared vertices.
 *
 * Degenerate triangles, those using a vertex twice after welding, are dropped rather than producing an
 * invalid mesh. The count of dropped triangles is not currently reported; check the element counts if
 * it matters.
 */
export function meshDataFromTriangles(input: UnbakeInput, options: UnbakeOptions = {}): UnbakeResult {
    const tolerance = options.tolerance ?? 1e-4
    const position = input.position
    const inputVerts = Math.floor(position.length / 3)

    const indices: ArrayLike<number> = input.index ?? (() => {
        const seq = new Uint32Array(inputVerts)
        for (let i = 0; i < inputVerts; i++) seq[i] = i
        return seq
    })()

    // --- weld by quantised position ---
    // Quantising is O(n) and deterministic; a spatial hash would also work but buys nothing here
    // because the tolerance is fixed rather than adaptive.
    const decimals = Math.max(0, Math.round(Math.log10(1 / tolerance)))
    const factor = Math.pow(10, decimals)
    const keyToVert = new Map<string, number>()
    const oldToNew = new Int32Array(inputVerts)
    const newPositions: number[] = []
    const weldedFromLists: number[][] = []

    for (let i = 0; i < inputVerts; i++) {
        const x = position[i * 3], y = position[i * 3 + 1], z = position[i * 3 + 2]
        const key = `${Math.round(x * factor)},${Math.round(y * factor)},${Math.round(z * factor)}`
        let v = keyToVert.get(key)
        if (v === undefined) {
            v = newPositions.length / 3
            keyToVert.set(key, v)
            newPositions.push(x, y, z)
            weldedFromLists.push([i])
        } else {
            weldedFromLists[v].push(i)
        }
        oldToNew[i] = v
    }

    // --- faces, one per input triangle ---
    const faces: number[][] = []
    const faceSourceCorners: number[][] = []
    const materialIndices: number[] = []

    const materialForIndex = (indexPos: number): number => {
        if (!input.groups?.length) return 0
        for (const g of input.groups) {
            if (indexPos >= g.start && indexPos < g.start + g.count) return g.materialIndex ?? 0
        }
        return 0
    }

    for (let t = 0; t + 2 < indices.length; t += 3) {
        const a = oldToNew[indices[t]]
        const b = oldToNew[indices[t + 1]]
        const c = oldToNew[indices[t + 2]]
        // A triangle whose corners welded together has no area; keeping it would fail validation.
        if (a === b || b === c || a === c) continue
        faces.push([a, b, c])
        faceSourceCorners.push([indices[t], indices[t + 1], indices[t + 2]])
        materialIndices.push(materialForIndex(t))
    }

    const mesh = MeshData.fromFaces({
        positions: newPositions,
        faces,
        materialIndices: materialIndices.some(m => m !== 0) ? materialIndices : undefined,
    })

    // --- carry per-corner UVs from the source vertices ---
    if (input.uv) {
        const uv = mesh.attributes.add({name: 'uv', domain: AttrDomain.Corner, type: 'float2'})
        for (let f = 0; f < faces.length; f++) {
            const start = mesh.faceOffsets[f]
            for (let k = 0; k < 3; k++) {
                const src = faceSourceCorners[f][k]
                uv.data[(start + k) * 2] = input.uv[src * 2]
                uv.data[(start + k) * 2 + 1] = input.uv[src * 2 + 1]
            }
        }
    }

    const result: UnbakeResult = {
        mesh,
        weldedFrom: weldedFromLists.map(l => Int32Array.from(l)),
        weldedCount: inputVerts - newPositions.length / 3,
    }

    if (options.mergeCoplanar) mergeCoplanarFaces(mesh, options.coplanarAngle ?? 1e-4)

    return result
}

/**
 * Merge triangles that share an edge and lie in the same plane back into n-gons, using the Euler
 * operator that already knows how to do it safely.
 *
 * Opt-in, because it guesses at intent: a deliberately triangulated surface will be quietly turned
 * into quads. It runs on a BMesh and writes back, so all the legality checks in `joinFaceKillEdge`
 * apply and an illegal merge is simply skipped.
 */
export function mergeCoplanarFaces(mesh: MeshData, angleTolerance = 1e-4): number {
    const bm = bmFromMesh(mesh)
    let merged = 0
    const cosLimit = Math.cos(angleTolerance)

    for (const e of [...bm.edges]) {
        if (!bm.edges.has(e) || !edgeIsManifold(e)) continue
        const l1 = e.l!
        const l2 = l1.radialNext!
        const f1 = l1.f
        const f2 = l2.f
        if (f1 === f2) continue

        const n1 = bmFaceNormal(f1)
        const n2 = bmFaceNormal(f2)
        if (!n1 || !n2) continue
        const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
        if (dot < cosLimit) continue

        if (joinFaceKillEdge(bm, f1, f2, e)) merged++
    }

    if (merged) {
        const out = bmToMesh(bm)
        // Copy the merged topology back into the caller's mesh object.
        Object.assign(mesh, {faceOffsets: out.faceOffsets})
        mesh.attributes.resizeDomain(AttrDomain.Point, out.vertsNum)
        mesh.attributes.resizeDomain(AttrDomain.Edge, out.edgesNum)
        mesh.attributes.resizeDomain(AttrDomain.Face, out.facesNum)
        mesh.attributes.resizeDomain(AttrDomain.Corner, out.cornersNum)
        for (const layer of out.attributes.layers()) {
            const target = mesh.attributes.get(layer.name)
                ?? mesh.attributes.add({name: layer.name, domain: layer.domain, type: layer.type})
            target.data.set(layer.data as never)
        }
    }
    return merged
}

/** Newell normal of a BMesh face. Local, so the normals module is not pulled in here. */
function bmFaceNormal(f: BMFace): [number, number, number] | null {
    const verts = [...f.eachLoop()].map(l => l.v)
    let nx = 0, ny = 0, nz = 0
    for (let i = 0; i < verts.length; i++) {
        const a = verts[i]
        const b = verts[(i + 1) % verts.length]
        nx += (a.y - b.y) * (a.z + b.z)
        ny += (a.z - b.z) * (a.x + b.x)
        nz += (a.x - b.x) * (a.y + b.y)
    }
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-20) return null
    return [nx / len, ny / len, nz / len]
}

/** Does this geometry already carry a kernel mesh, stashed by a previous bake? */
export const MESH_DATA_USERDATA_KEY = 'meshKernelData'

/** Convenience: the built-in attribute names an importer should look for on a source geometry. */
export const IMPORT_ATTR_NAMES = {
    uv: 'uv',
    materialIndex: AttrName.materialIndex,
} as const
