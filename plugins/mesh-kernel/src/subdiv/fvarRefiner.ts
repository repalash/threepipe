/**
 * UV maps through the refiner: Blender's UV-to-value grouping, OpenSubdiv's face-varying channel per level, and
 * face-varying interpolation and limit.
 *
 * - Values: `subdiv_converter_mesh.cc` `precalc_uv_layer` groups the corners of each vertex with
 *   `BKE_mesh_uv_vert_map_create(..., STD_UV_CONNECT_LIMIT = 1e-4, use_winding = true)` (`mesh_mapping.cc:39`):
 *   corners whose UVs are within 1e-4 per component of a group's first corner, and whose face has the same UV
 *   winding sign (`cross_poly_v2`, `math_geom.cc:153`), share a value; `subdiv_eval.cc:123` writes each corner's
 *   UV into its value in face order.
 * - Base channel: `TopologyRefinerFactoryBase::prepareFaceVaryingChannels` -> `FVarLevel::completeTopologyFromFaceValues`
 *   with a regular boundary valence of 2.
 * - `PrimvarRefiner::interpFVarFromFaces / FromEdges / FromVerts` (`primvarRefiner.h:636-985`) and `limitFVar` (`:1139`).
 */

import {MeshData} from '../MeshData'
import {FVarLevel, FVarRefinement, valueIsCorner, valueIsDepSharp, valueIsSemiSharp} from './fvar'
import {TopologyRefiner} from './refiner'
import {computeEdgeVertexMask, computeFaceVertexMask, computeVertexLimitMask, computeVertexVertexMask, Mask, Rule, VertexNeighborhood} from './sdc'

const STD_UV_CONNECT_LIMIT = 0.0001

/** Value index per corner and the UV of each value, as Blender hands a UV map to OpenSubdiv. */
export function uvValuesFromCorners(mesh: MeshData, uv: ArrayLike<number>): {cornerValues: Int32Array, values: Float64Array} {
    const F = mesh.facesNum, offsets = mesh.faceOffsets, cv = mesh.cornerVerts
    const f32 = Math.fround
    // winding of each face in UV space (cross_poly_v2 < 0), in float
    const winding = new Uint8Array(F)
    for (let f = 0; f < F; f++) {
        const s = offsets[f], e = offsets[f + 1]
        let cross = 0
        let prev = e - 1
        for (let c = s; c < e; c++) {
            cross = f32(cross + f32(f32(uv[2 * prev] - uv[2 * c]) * f32(uv[2 * c + 1] + uv[2 * prev + 1])))
            prev = c
        }
        winding[f] = cross < 0 ? 1 : 0
    }
    // per vertex, the corners in Blender's list order (each new corner pushed on the front)
    const lists: number[][] = Array.from({length: mesh.vertsNum}, () => [])
    const cornerFace = new Int32Array(mesh.cornersNum)
    for (let f = 0; f < F; f++) for (let c = offsets[f]; c < offsets[f + 1]; c++) { cornerFace[c] = f; lists[cv[c]].unshift(c) }

    const cornerValues = new Int32Array(mesh.cornersNum)
    let count = -1
    for (let v = 0; v < mesh.vertsNum; v++) {
        // the grouping loop of BKE_mesh_uv_vert_map_create, building `newvlist` front-first
        let vlist = lists[v]
        let newvlist: number[] = []
        const separate = new Set<number>()
        while (vlist.length) {
            const first = vlist[0]
            vlist = vlist.slice(1)
            newvlist.unshift(first)
            const u0 = uv[2 * first], v0 = uv[2 * first + 1]
            const rest: number[] = []
            for (const it of vlist) {
                if (Math.abs(u0 - uv[2 * it]) < STD_UV_CONNECT_LIMIT && Math.abs(v0 - uv[2 * it + 1]) < STD_UV_CONNECT_LIMIT
                    && winding[cornerFace[it]] === winding[cornerFace[first]]) newvlist.unshift(it)
                else rest.push(it)
            }
            vlist = rest
            separate.add(newvlist[0])
        }
        // precalc_uv_layer: a new value index at every `separate` entry, walking the final list
        for (const c of newvlist) {
            if (separate.has(c)) count++
            cornerValues[c] = count
        }
        newvlist = []
    }
    const numValues = count + 1
    const values = new Float64Array(numValues * 2)
    for (let c = 0; c < mesh.cornersNum; c++) { values[2 * cornerValues[c]] = uv[2 * c]; values[2 * cornerValues[c] + 1] = uv[2 * c + 1] }
    return {cornerValues, values}
}

/** A face-varying channel carried through every level of a refiner. */
export class FVarChannel {
    readonly refiner: TopologyRefiner
    readonly levels: FVarLevel[] = []
    readonly refinements: FVarRefinement[] = []

    /** Channel `channel` of a refiner (added with `TopologyRefiner.addFVarChannel` before refining). */
    constructor(refiner: TopologyRefiner, channel: number) {
        this.refiner = refiner
        for (const L of refiner.levels) this.levels.push(L.getFVarLevel(channel))
        for (const frs of refiner.fvarRefinements) this.refinements.push(frs[channel])
    }

    /** Face-varying values of level `level - 1` in, level `level` out (`stride` components). */
    interpolate(level: number, src: Float64Array, stride: number): Float64Array {
        const r = this.refiner.refinements[level - 1]
        const fr = this.refinements[level - 1]
        const P = r.parent, C = r.child, pF = this.levels[level - 1], cF = this.levels[level]
        const options = this.refiner.options
        const dst = new Float64Array(cF.valueCount * stride)
        const add = (d: number, s: Float64Array, si: number, w: number) => { for (let k = 0; k < stride; k++) dst[d * stride + k] += s[si * stride + k] * w }
        const mask = new Mask()
        const isLinear = pF.isLinear

        // interpFVarFromFaces
        for (let f = 0; f < P.numFaces; f++) {
            if (r.faceChildVert[f] < 0) continue
            const cVal = cF.getVertexValueOffset(r.faceChildVert[f])
            const fValues = pF.getFaceValues(f)
            computeFaceVertexMask(fValues.length, mask)
            for (let i = 0; i < fValues.length; i++) add(cVal, src, fValues[i], mask.vertex[i])
        }
        // interpFVarFromEdges
        for (let e = 0; e < P.numEdges; e++) {
            const cv = r.edgeChildVert[e]
            if (cv < 0) continue
            const cVals = cF.getVertexValues(cv)
            if (cF.valueTopologyMatches(cVals[0])) {
                if (isLinear) {
                    mask.set(2, 0, 0, false)
                    mask.vertex[0] = 0.5
                    mask.vertex[1] = 0.5
                } else computeEdgeVertexMask(options, P.edgeFaces.size(e), P.edgeSharpness[e], mask, P.edgeSharpness[e] > 0 ? Rule.Crease : Rule.Smooth, C.getVertexRule(cv))
                const [a, b] = pF.getEdgeFaceValues(e, 0)
                const cVal = cVals[0]
                add(cVal, src, a, mask.vertex[0])
                add(cVal, src, b, mask.vertex[1])
                if (mask.numFace > 0) {
                    const eFaces = P.getEdgeFaces(e)
                    for (let i = 0; i < eFaces.length; i++) add(cVal, dst, cF.getVertexValueOffset(r.faceChildVert[eFaces[i]]), mask.face[i])
                }
            } else {
                for (let i = 0; i < cVals.length; i++) {
                    const [a, b] = pF.getEdgeFaceValues(e, fr.getChildValueParentSource(cv, i))
                    add(cVals[i], src, a, 0.5)
                    add(cVals[i], src, b, 0.5)
                }
            }
        }
        // interpFVarFromVerts
        const hood: VertexNeighborhood & {sharpnessPerEdge: number[]} = {numEdges: 0, numFaces: 0, sharpness: 0, sharpnessPerEdge: [], childSharpness: 0}
        const edgeValues: number[] = []
        for (let v = 0; v < P.numVertices; v++) {
            const cv = r.vertChildVert[v]
            if (cv < 0) continue
            const pVals = pF.getVertexValues(v), cVals = cF.getVertexValues(cv)
            const matches = cF.valueTopologyMatches(cVals[0])
            if (isLinear && matches) { add(cVals[0], src, pVals[0], 1); continue }
            if (matches) {
                const vEdges = P.getVertexEdges(v), vFaces = P.getVertexFaces(v)
                hood.numEdges = vEdges.length
                hood.numFaces = vFaces.length
                hood.sharpness = P.vertSharpness[v]
                hood.sharpnessPerEdge.length = vEdges.length
                for (let i = 0; i < vEdges.length; i++) hood.sharpnessPerEdge[i] = P.edgeSharpness[vEdges[i]]
                hood.childSharpness = C.vertSharpness[cv]
                computeVertexVertexMask(options, hood, mask, P.getVertexRule(v), C.getVertexRule(cv))
                const cVal = cVals[0]
                if (mask.numFace > 0) for (let i = 0; i < vFaces.length; i++) add(cVal, dst, cF.getVertexValueOffset(r.faceChildVert[vFaces[i]]), mask.face[i])
                if (mask.numEdge > 0) {
                    pF.getVertexEdgeValues(v, edgeValues)
                    for (let i = 0; i < vEdges.length; i++) add(cVal, src, edgeValues[i], mask.edge[i])
                }
                add(cVal, src, pVals[0], mask.vertex[0])
            } else {
                const po = pF.vertSiblingOffsets[v]
                for (let cs = 0; cs < cVals.length; cs++) {
                    const ps = fr.getChildValueParentSource(cv, cs)
                    const pVal = pVals[ps], cVal = cVals[cs]
                    if (isLinear || valueIsCorner(cF.vertValueTags[cF.vertSiblingOffsets[cv] + cs])) { add(cVal, src, pVal, 1); continue }
                    const [e0, e1] = pF.getVertexCreaseEndValues(v, ps)
                    let vw = 0.75, ew = 0.125
                    const pTag = pF.vertValueTags[po + ps]
                    if (valueIsSemiSharp(pTag)) {
                        const wCorner = valueIsDepSharp(pTag) ? fr.getFractionalWeight(v, ps ? 0 : 1, cv) : fr.getFractionalWeight(v, ps, cv)
                        const wCrease = 1 - wCorner
                        vw = wCrease * 0.75 + wCorner
                        ew = wCrease * 0.125
                    }
                    add(cVal, src, e0, ew)
                    add(cVal, src, e1, ew)
                    add(cVal, src, pVal, vw)
                }
            }
        }
        return dst
    }

    /** `PrimvarRefiner::limitFVar` (`primvarRefiner.h:1139`) at the last level. */
    limit(src: Float64Array, stride: number): Float64Array {
        const L = this.refiner.levels[this.refiner.maxLevel], F = this.levels[this.levels.length - 1]
        const dst = new Float64Array(F.valueCount * stride)
        const add = (d: number, si: number, w: number) => { for (let k = 0; k < stride; k++) dst[d * stride + k] += src[si * stride + k] * w }
        const mask = new Mask()
        const hood: VertexNeighborhood & {sharpnessPerEdge: number[]} = {numEdges: 0, numFaces: 0, sharpness: 0, sharpnessPerEdge: [], childSharpness: 0}
        const edgeValues: number[] = []
        for (let v = 0; v < L.numVertices; v++) {
            const vEdges = L.getVertexEdges(v), vVals = F.getVertexValues(v)
            if (vEdges.length === 0 || F.isLinear) { for (const x of vVals) add(x, x, 1); continue }
            if (F.valueTopologyMatches(vVals[0])) {
                const vFaces = L.getVertexFaces(v)
                hood.numEdges = vEdges.length
                hood.numFaces = vFaces.length
                hood.sharpness = L.vertSharpness[v]
                hood.sharpnessPerEdge.length = vEdges.length
                for (let i = 0; i < vEdges.length; i++) hood.sharpnessPerEdge[i] = L.edgeSharpness[vEdges[i]]
                computeVertexLimitMask(hood, mask, L.getVertexRule(v))
                const val = vVals[0]
                if (mask.numFace > 0) {
                    const vInFace = L.getVertexFaceLocalIndices(v)
                    for (let i = 0; i < vFaces.length; i++) {
                        const fv = F.getFaceValues(vFaces[i])
                        let opp = vInFace[i] + 2
                        if (opp >= fv.length) opp -= fv.length
                        add(val, fv[opp], mask.face[i])
                    }
                }
                if (mask.numEdge > 0) {
                    F.getVertexEdgeValues(v, edgeValues)
                    for (let i = 0; i < vEdges.length; i++) add(val, edgeValues[i], mask.edge[i])
                }
                add(val, val, mask.vertex[0])
            } else {
                for (let i = 0; i < vVals.length; i++) {
                    const val = vVals[i]
                    if (valueIsCorner(F.vertValueTags[val])) { add(val, val, 1); continue }
                    const [e0, e1] = F.getVertexCreaseEndValues(v, i)
                    add(val, e0, 1 / 6)
                    add(val, e1, 1 / 6)
                    add(val, val, 2 / 3)
                }
            }
        }
        return dst
    }
}

