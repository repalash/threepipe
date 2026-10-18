/**
 * Attribute propagation through a subdivision, as Blender's `subdiv_mesh.cc` does it (5.2.2):
 * - point attributes are interpolated bilinearly over the coarse face at each new vertex's ptex coordinate
 *   (`vert_interpolation_from_face` / `_from_corner`, `:452`, `:498`), `position` and vertex groups excepted;
 * - edge attributes are copied to the edges lying along a coarse edge, inner edges get the type's default
 *   (`subdiv_copy_edge_data`, `:1199`);
 * - face attributes are copied from the coarse face (`subdiv_mesh_face`, `:1331`);
 * - corner attributes other than UV maps are interpolated bilinearly over the coarse face
 *   (`loop_interpolation_from_face` / `_from_corner`, `:611`, `:657`); UV maps go through face-varying
 *   subdivision (`fvarRefiner.ts`).
 *
 * Bilinear interpolation over a coarse face at the grid points equals linear subdivision applied level by level
 * (face point = mean of the face, edge point = midpoint, vertex = itself; within a ptex quad the same rules are a
 * bilinear patch), so values are carried down the refiner's levels with those rules. Mixing follows
 * `BKE_attribute_math.hh`: booleans are true if any contributor with positive weight is true (`mix_indices`,
 * `:478`), integers average in double and round once at the end.
 */

import {MeshData} from '../MeshData'
import {AttrDomain, AttrName, ATTR_TYPE_INFO} from '../constants'
import {AttributeLayer} from '../attributes'
import {TopologyRefiner} from './refiner'

const TOPOLOGY = new Set<string>([AttrName.position, AttrName.edgeVerts, AttrName.cornerVert, AttrName.cornerEdge])

/** Corner float2 layers Blender treats as UV maps (`Mesh::uv_map_names`): not internal (no leading dot). */
export function isUVMapLayer(layer: AttributeLayer): boolean {
    return layer.domain === AttrDomain.Corner && layer.type === 'float2' && !layer.name.startsWith('.')
}

interface Carried { layer: AttributeLayer, comps: number, bool: boolean, values: Float64Array }

/**
 * Carry `mesh`'s attributes down to level `levels` of `refiner` and write them onto `out` (whose vertices,
 * faces and corners are the level's, in order). `baseToMesh` maps base vertices to mesh vertices. UV maps are
 * left to the caller (face-varying subdivision).
 */
export function propagateAttributes(
    refiner: TopologyRefiner, levels: number, mesh: MeshData, baseToMesh: Int32Array, out: MeshData, warnings: string[],
): void {
    const base = refiner.levels[0]
    // UV maps go through face-varying subdivision (fvarRefiner.ts), not linear mixing
    const layers = mesh.attributes.layers().filter(l => !TOPOLOGY.has(l.name) && !isUVMapLayer(l))
    if (!layers.length) return

    // base-level values
    const meshEdgeOfBase = new Int32Array(base.numEdges).fill(-1)
    const ev = mesh.edgeVerts
    const meshToBase = new Int32Array(mesh.vertsNum).fill(-1)
    for (let b = 0; b < baseToMesh.length; b++) meshToBase[baseToMesh[b]] = b
    for (let e = 0; e < mesh.edgesNum; e++) {
        const a = meshToBase[ev[2 * e]], b = meshToBase[ev[2 * e + 1]]
        if (a < 0 || b < 0) continue
        const be = base.findEdge(a, b)
        if (be >= 0 && meshEdgeOfBase[be] < 0) meshEdgeOfBase[be] = e
    }

    const carried: Carried[] = []
    for (const layer of layers) {
        if (layer.type === 'quaternion') { warnings.push(`attribute "${layer.name}": quaternion mixing is not ported, dropped`); continue }
        const comps = ATTR_TYPE_INFO[layer.type].components
        const src = layer.data
        let n: number, idx: (i: number) => number
        if (layer.domain === AttrDomain.Point) { n = base.numVertices; idx = i => baseToMesh[i] }
        else if (layer.domain === AttrDomain.Edge) { n = base.numEdges; idx = i => meshEdgeOfBase[i] }
        else if (layer.domain === AttrDomain.Face) { n = base.numFaces; idx = i => i }
        else { n = base.faceVerts.indices.length; idx = i => i }
        const values = new Float64Array(n * comps)
        for (let i = 0; i < n; i++) {
            const j = idx(i)
            if (j < 0) continue
            for (let k = 0; k < comps; k++) values[i * comps + k] = src[j * comps + k]
        }
        carried.push({layer, comps, bool: layer.type === 'bool', values})
    }

    for (let l = 1; l <= levels; l++) {
        const r = refiner.refinements[l - 1]
        const P = r.parent, C = r.child
        for (const c of carried) {
            const {comps, bool} = c
            const src = c.values
            const mix = (dst: Float64Array, d: number, s: Float64Array, idx: ArrayLike<number>) => {
                for (let k = 0; k < comps; k++) {
                    let v = 0
                    for (let i = 0; i < idx.length; i++) {
                        const x = s[idx[i] * comps + k]
                        if (bool) { if (x) v = 1 } else v += x / idx.length
                    }
                    dst[d * comps + k] = v
                }
            }
            let dst: Float64Array
            if (c.layer.domain === AttrDomain.Point) {
                dst = new Float64Array(C.numVertices * comps)
                for (let f = 0; f < P.numFaces; f++) mix(dst, r.faceChildVert[f], src, P.getFaceVertices(f))
                for (let e = 0; e < P.numEdges; e++) mix(dst, r.edgeChildVert[e], src, P.getEdgeVertices(e))
                for (let v = 0; v < P.numVertices; v++) mix(dst, r.vertChildVert[v], src, [v])
            } else if (c.layer.domain === AttrDomain.Edge) {
                dst = new Float64Array(C.numEdges * comps) // edges inside faces: the type's default (0 / false)
                for (let ce = r.firstChildEdgeFromEdge; ce < C.numEdges; ce++) mix(dst, ce, src, [r.childEdgeParent[ce]])
            } else if (c.layer.domain === AttrDomain.Face) {
                dst = new Float64Array(C.numFaces * comps)
                for (let cf = 0; cf < C.numFaces; cf++) mix(dst, cf, src, [r.childFaceParent[cf]])
            } else {
                dst = new Float64Array(C.faceVerts.indices.length * comps)
                for (let pf = 0; pf < P.numFaces; pf++) {
                    const o = P.faceVerts.offsets[pf], n = P.faceVerts.counts[pf]
                    const all = Array.from({length: n}, (_, k) => o + k)
                    for (let j = 0; j < n; j++) {
                        const cf = r.faceChildFace(pf, j)
                        const jPrev = j ? j - 1 : n - 1, jNext = j + 1 < n ? j + 1 : 0
                        // positions in the child face, as QuadRefinement::populateFaceVerticesFromParentFaces lays them out
                        let iVert = 0, iNext = 1, iOpp = 2, iPrev = 3
                        if (n === 4) { iVert = j; iPrev = jPrev; iOpp = jPrev ? jPrev - 1 : 3; iNext = iOpp ? iOpp - 1 : 3 }
                        const co = C.faceVerts.offsets[cf]
                        mix(dst, co + iVert, src, [o + j])
                        mix(dst, co + iNext, src, [o + j, o + jNext])
                        mix(dst, co + iOpp, src, all)
                        mix(dst, co + iPrev, src, [o + jPrev, o + j])
                    }
                }
            }
            c.values = dst
        }
    }

    // write onto the output mesh; its edges were rebuilt by fromFaces, so match them to the level's by vertex pair
    const L = refiner.levels[levels]
    let levelEdgeOfOut: Int32Array | null = null
    for (const c of carried) {
        const {layer, comps} = c
        const target = out.attributes.ensure(layer.name, layer.domain, layer.type).data
        const integral = !(target instanceof Float32Array || target instanceof Float64Array)
        const put = (i: number, j: number) => {
            for (let k = 0; k < comps; k++) {
                const v = c.values[j * comps + k]
                target[i * comps + k] = integral ? Math.round(v) : v
            }
        }
        if (layer.domain === AttrDomain.Edge) {
            if (!levelEdgeOfOut) {
                levelEdgeOfOut = new Int32Array(out.edgesNum)
                const oev = out.edgeVerts
                for (let e = 0; e < out.edgesNum; e++) levelEdgeOfOut[e] = L.findEdge(oev[2 * e], oev[2 * e + 1])
            }
            for (let e = 0; e < out.edgesNum; e++) if (levelEdgeOfOut[e] >= 0) put(e, levelEdgeOfOut[e])
        } else {
            const n = layer.domain === AttrDomain.Point ? out.vertsNum : layer.domain === AttrDomain.Face ? out.facesNum : out.cornersNum
            for (let i = 0; i < n; i++) put(i, i)
        }
    }
}
