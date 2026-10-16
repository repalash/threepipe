/**
 * Implicit domain interpolation on meshes - port of `blenkernel/intern/mesh_attributes.cc:25-660`
 * (`adapt_mesh_domain_*`, `can_simple_adapt_for_single`, `adapt_mesh_attribute_domain`).
 *
 * Every non-boolean type averages with its `DefaultMixer` in the order Blender iterates; booleans
 * have their own rule per direction (all / any), written next to each case as in the source.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {allocate, DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {GVArray} from './varray'
import {createDefaultMixer, mix2} from './mixers'
import {
    faceCornerNext,
    faceCornerPrev,
    faceFindCornerFromVert,
    looseEdges,
    looseVerts,
    vertsNoFace,
    vertToFaceMap,
} from './meshTopology'

/** Domain size on a mesh (`MeshComponent::attribute_domain_size`). */
export function meshDomainSize(mesh: MeshData, domain: AttrDomain): number {
    switch (domain) {
    case AttrDomain.Point: return mesh.vertsNum
    case AttrDomain.Edge: return mesh.edgesNum
    case AttrDomain.Face: return mesh.facesNum
    case AttrDomain.Corner: return mesh.cornersNum
    default: return 0
    }
}

type Src = {get(i: number, k?: number): number}

function elem(src: Src, i: number, c: number, out: number[]): number[] {
    for (let k = 0; k < c; k++) out[k] = src.get(i, k)
    return out
}

/** `adapt_mesh_domain_corner_to_point` (`mesh_attributes.cc:25-86`). */
function cornerToPoint(mesh: MeshData, src: GVArray): GVArray {
    const out = allocate(src.type, mesh.vertsNum, false)
    if (src.type === 'bool') {
        // A vertex is selected if all connected face corners were selected and it is not loose.
        out.fill(1)
        const cv = mesh.cornerVerts
        for (let k = 0; k < mesh.cornersNum; k++) if (!src.get(k)) out[cv[k]] = 0
        const loose = looseVerts(mesh).mask
        for (let v = 0; v < mesh.vertsNum; v++) if (loose[v]) out[v] = 0
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const v2f = vertToFaceMap(mesh)
    const tmp: number[] = []
    // One mixer per vertex in Blender (`DefaultMixer<T> mixer({&r_dst[vert], 1})`); a single mixer over
    // the whole buffer is the same arithmetic per element.
    const mixer = createDefaultMixer(src.type, out)
    for (let v = 0; v < mesh.vertsNum; v++) {
        for (let j = v2f.offsets[v]; j < v2f.offsets[v + 1]; j++) {
            const corner = faceFindCornerFromVert(mesh, v2f.indices[j], v)
            mixer.mixIn(v, elem(src, corner, c, tmp), 0)
        }
    }
    mixer.finalize()
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_point_to_corner` (`:88`): each corner copies its vertex. */
function pointToCorner(mesh: MeshData, src: GVArray): GVArray {
    const c = DATA_TYPES[src.type].components
    const out = allocate(src.type, mesh.cornersNum, false)
    const cv = mesh.cornerVerts
    for (let k = 0; k < mesh.cornersNum; k++) for (let j = 0; j < c; j++) out[k * c + j] = src.get(cv[k], j)
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_corner_to_face` (`:102`). */
function cornerToFace(mesh: MeshData, src: GVArray): GVArray {
    const fo = mesh.faceOffsets
    const out = allocate(src.type, mesh.facesNum, false)
    if (src.type === 'bool') {
        // A face is selected if all of its corners were selected.
        for (let f = 0; f < mesh.facesNum; f++) {
            let all = 1
            for (let k = fo[f]; k < fo[f + 1]; k++) if (!src.get(k)) { all = 0; break }
            out[f] = all
        }
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const tmp: number[] = []
    const mixer = createDefaultMixer(src.type, out)
    for (let f = 0; f < mesh.facesNum; f++) {
        for (let k = fo[f]; k < fo[f + 1]; k++) mixer.mixIn(f, elem(src, k, c, tmp), 0)
    }
    mixer.finalize()
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_corner_to_edge` (`:140-197`). */
function cornerToEdge(mesh: MeshData, src: GVArray): GVArray {
    const fo = mesh.faceOffsets
    const ce = mesh.cornerEdges
    const out = allocate(src.type, mesh.edgesNum, false)
    if (src.type === 'bool') {
        // An edge is selected if all corners on adjacent faces were selected.
        out.fill(1)
        for (let f = 0; f < mesh.facesNum; f++) {
            const s = fo[f], e = fo[f + 1]
            for (let k = s; k < e; k++) {
                const next = faceCornerNext(s, e, k)
                if (!src.get(k) || !src.get(next)) out[ce[k]] = 0
            }
        }
        const loose = looseEdges(mesh).mask
        for (let i = 0; i < mesh.edgesNum; i++) if (loose[i]) out[i] = 0
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const tmp: number[] = []
    const mixer = createDefaultMixer(src.type, out)
    for (let f = 0; f < mesh.facesNum; f++) {
        const s = fo[f], e = fo[f + 1]
        for (let k = s; k < e; k++) {
            const next = faceCornerNext(s, e, k)
            mixer.mixIn(ce[k], elem(src, k, c, tmp), 0)
            mixer.mixIn(ce[k], elem(src, next, c, tmp), 0)
        }
    }
    mixer.finalize()
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_face_to_point` (`:203`). */
function faceToPoint(mesh: MeshData, src: GVArray): GVArray {
    const v2f = vertToFaceMap(mesh)
    const out = allocate(src.type, mesh.vertsNum, false)
    if (src.type === 'bool') {
        // A vertex is selected if any of the connected faces were selected.
        for (let v = 0; v < mesh.vertsNum; v++) {
            let any = 0
            for (let j = v2f.offsets[v]; j < v2f.offsets[v + 1]; j++) if (src.get(v2f.indices[j])) { any = 1; break }
            out[v] = any
        }
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const tmp: number[] = []
    const mixer = createDefaultMixer(src.type, out)
    for (let v = 0; v < mesh.vertsNum; v++) {
        for (let j = v2f.offsets[v]; j < v2f.offsets[v + 1]; j++) mixer.mixIn(v, elem(src, v2f.indices[j], c, tmp), 0)
    }
    mixer.finalize()
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_face_to_corner` (`:239`): each corner copies its face. */
function faceToCorner(mesh: MeshData, src: GVArray): GVArray {
    const c = DATA_TYPES[src.type].components
    const out = allocate(src.type, mesh.cornersNum, false)
    const fo = mesh.faceOffsets
    for (let f = 0; f < mesh.facesNum; f++) {
        for (let k = fo[f]; k < fo[f + 1]; k++) for (let j = 0; j < c; j++) out[k * c + j] = src.get(f, j)
    }
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_face_to_edge` (`:267-318`). */
function faceToEdge(mesh: MeshData, src: GVArray): GVArray {
    const fo = mesh.faceOffsets
    const ce = mesh.cornerEdges
    const out = allocate(src.type, mesh.edgesNum, false)
    if (src.type === 'bool') {
        // An edge is selected if any connected face was selected.
        out.fill(0)
        for (let f = 0; f < mesh.facesNum; f++) {
            if (!src.get(f)) continue
            for (let k = fo[f]; k < fo[f + 1]; k++) out[ce[k]] = 1
        }
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const tmp: number[] = []
    const mixer = createDefaultMixer(src.type, out)
    for (let f = 0; f < mesh.facesNum; f++) {
        elem(src, f, c, tmp)
        for (let k = fo[f]; k < fo[f + 1]; k++) mixer.mixIn(ce[k], tmp, 0)
    }
    mixer.finalize()
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_point_to_face` (`:320`). */
function pointToFace(mesh: MeshData, src: GVArray): GVArray {
    const fo = mesh.faceOffsets
    const cv = mesh.cornerVerts
    const out = allocate(src.type, mesh.facesNum, false)
    if (src.type === 'bool') {
        // A face is selected if all of its vertices were selected.
        for (let f = 0; f < mesh.facesNum; f++) {
            let all = 1
            for (let k = fo[f]; k < fo[f + 1]; k++) if (!src.get(cv[k])) { all = 0; break }
            out[f] = all
        }
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const tmp: number[] = []
    const mixer = createDefaultMixer(src.type, out)
    for (let f = 0; f < mesh.facesNum; f++) {
        for (let k = fo[f]; k < fo[f + 1]; k++) mixer.mixIn(f, elem(src, cv[k], c, tmp), 0)
    }
    mixer.finalize()
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_point_to_edge` (`:359`): `mix2(0.5, v0, v1)`; booleans need both. */
function pointToEdge(mesh: MeshData, src: GVArray): GVArray {
    const ev = mesh.edgeVerts
    const out = allocate(src.type, mesh.edgesNum, false)
    if (src.type === 'bool') {
        // An edge is selected if both of its vertices were selected.
        for (let e = 0; e < mesh.edgesNum; e++) out[e] = src.get(ev[e * 2]) && src.get(ev[e * 2 + 1]) ? 1 : 0
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const a: number[] = [], b: number[] = []
    for (let e = 0; e < mesh.edgesNum; e++) {
        mix2(src.type, 0.5, elem(src, ev[e * 2], c, a), 0, elem(src, ev[e * 2 + 1], c, b), 0, out, e)
    }
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_edge_to_corner` (`:387-450`). */
function edgeToCorner(mesh: MeshData, src: GVArray): GVArray {
    const fo = mesh.faceOffsets
    const ce = mesh.cornerEdges
    const out = allocate(src.type, mesh.cornersNum, false)
    if (src.type === 'bool') {
        // A corner is selected if its two adjacent edges were selected.
        out.fill(0)
        for (let f = 0; f < mesh.facesNum; f++) {
            const s = fo[f], e = fo[f + 1]
            for (let k = s; k < e; k++) {
                const prev = faceCornerPrev(s, e, k)
                if (src.get(ce[k]) && src.get(ce[prev])) out[k] = 1
            }
        }
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const tmp: number[] = []
    const mixer = createDefaultMixer(src.type, out)
    for (let f = 0; f < mesh.facesNum; f++) {
        const s = fo[f], e = fo[f + 1]
        for (let k = s; k < e; k++) {
            const prev = faceCornerPrev(s, e, k)
            mixer.mixIn(k, elem(src, ce[k], c, tmp), 0)
            mixer.mixIn(k, elem(src, ce[prev], c, tmp), 0)
        }
    }
    mixer.finalize()
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_edge_to_point` (`:453-505`). */
function edgeToPoint(mesh: MeshData, src: GVArray): GVArray {
    const ev = mesh.edgeVerts
    const out = allocate(src.type, mesh.vertsNum, false)
    if (src.type === 'bool') {
        // A vertex is selected if any connected edge was selected.
        out.fill(0)
        for (let e = 0; e < mesh.edgesNum; e++) {
            if (src.get(e)) {
                out[ev[e * 2]] = 1
                out[ev[e * 2 + 1]] = 1
            }
        }
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const tmp: number[] = []
    const mixer = createDefaultMixer(src.type, out)
    for (let e = 0; e < mesh.edgesNum; e++) {
        elem(src, e, c, tmp)
        mixer.mixIn(ev[e * 2], tmp, 0)
        mixer.mixIn(ev[e * 2 + 1], tmp, 0)
    }
    mixer.finalize()
    return GVArray.fromArray(src.type, out)
}

/** `adapt_mesh_domain_edge_to_face` (`:507`). */
function edgeToFace(mesh: MeshData, src: GVArray): GVArray {
    const fo = mesh.faceOffsets
    const ce = mesh.cornerEdges
    const out = allocate(src.type, mesh.facesNum, false)
    if (src.type === 'bool') {
        // A face is selected if all of its edges are selected.
        for (let f = 0; f < mesh.facesNum; f++) {
            let all = 1
            for (let k = fo[f]; k < fo[f + 1]; k++) if (!src.get(ce[k])) { all = 0; break }
            out[f] = all
        }
        return GVArray.fromArray('bool', out)
    }
    const c = DATA_TYPES[src.type].components
    const tmp: number[] = []
    const mixer = createDefaultMixer(src.type, out)
    for (let f = 0; f < mesh.facesNum; f++) {
        for (let k = fo[f]; k < fo[f + 1]; k++) mixer.mixIn(f, elem(src, ce[k], c, tmp), 0)
    }
    mixer.finalize()
    return GVArray.fromArray(src.type, out)
}

/** `can_simple_adapt_for_single` (`:533`). */
function canSimpleAdaptForSingle(mesh: MeshData, from: AttrDomain, to: AttrDomain): boolean {
    switch (from) {
    case AttrDomain.Point:
        return true
    case AttrDomain.Edge:
        if (to === AttrDomain.Point) return looseVerts(mesh).count === 0
        return true
    case AttrDomain.Face:
        if (to === AttrDomain.Point) return vertsNoFace(mesh).count === 0
        if (to === AttrDomain.Edge) return looseEdges(mesh).count === 0
        return true
    case AttrDomain.Corner:
        if (to === AttrDomain.Point) return vertsNoFace(mesh).count === 0
        if (to === AttrDomain.Edge) return looseEdges(mesh).count === 0
        return true
    default:
        return false
    }
}

/**
 * `adapt_mesh_attribute_domain` (`mesh_attributes.cc:582`): `varray` on `from` as seen on `to`.
 * Returns undefined for an empty input, as Blender returns an empty `GVArray`.
 */
export function adaptMeshDomain(mesh: MeshData, varray: GVArray, from: AttrDomain, to: AttrDomain): GVArray | undefined {
    if (varray.size === 0) return undefined
    if (from === to) return varray
    if (varray.isSingle && canSimpleAdaptForSingle(mesh, from, to)) {
        return GVArray.fromSingle(varray.type, meshDomainSize(mesh, to), varray.single)
    }
    switch (from) {
    case AttrDomain.Corner:
        if (to === AttrDomain.Point) return cornerToPoint(mesh, varray)
        if (to === AttrDomain.Face) return cornerToFace(mesh, varray)
        if (to === AttrDomain.Edge) return cornerToEdge(mesh, varray)
        break
    case AttrDomain.Point:
        if (to === AttrDomain.Corner) return pointToCorner(mesh, varray)
        if (to === AttrDomain.Face) return pointToFace(mesh, varray)
        if (to === AttrDomain.Edge) return pointToEdge(mesh, varray)
        break
    case AttrDomain.Face:
        if (to === AttrDomain.Point) return faceToPoint(mesh, varray)
        if (to === AttrDomain.Corner) return faceToCorner(mesh, varray)
        if (to === AttrDomain.Edge) return faceToEdge(mesh, varray)
        break
    case AttrDomain.Edge:
        if (to === AttrDomain.Corner) return edgeToCorner(mesh, varray)
        if (to === AttrDomain.Point) return edgeToPoint(mesh, varray)
        if (to === AttrDomain.Face) return edgeToFace(mesh, varray)
        break
    }
    return undefined
}

export type {DataType, TypedArray}
