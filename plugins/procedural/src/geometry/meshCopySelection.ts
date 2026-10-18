/**
 * `geometry::mesh_copy_selection`, `mesh_copy_selection_keep_verts`, `mesh_copy_selection_keep_edges`
 * (`geometry/intern/mesh_copy_selection.cc`) with the selection helpers of `mesh_selection.cc`.
 *
 * Results: `undefined` = unchanged (Blender's `std::nullopt`), `null` = no mesh, else the new mesh.
 * Vertex groups (`MDeformVert`) are not part of the kernel mesh, so there is nothing to gather for them.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {DATA_TYPES, DataType} from './dataTypes'
import {GVArray} from './varray'
import {newMeshData} from './components'

type Mask = number[]

const fromBools = (b: ArrayLike<number | boolean>): Mask => {
    const out: Mask = []
    for (let i = 0; i < b.length; i++) if (b[i]) out.push(i)
    return out
}

function boolsOf(selection: GVArray): Uint8Array {
    const out = new Uint8Array(selection.size)
    for (let i = 0; i < selection.size; i++) out[i] = selection.get(i, 0) ? 1 : 0
    return out
}

// region mesh_selection.cc

/** `vert_selection_from_edge` (:12). */
function vertSelectionFromEdge(edges: Int32Array, edgeMask: Mask, vertsNum: number): Mask {
    const a = new Uint8Array(vertsNum)
    for (const i of edgeMask) {
        a[edges[i * 2]] = 1
        a[edges[i * 2 + 1]] = 1
    }
    return fromBools(a)
}

/** `mapped_corner_selection_from_face` (:28): `vert_selection_from_face` / `edge_selection_from_face`. */
function mappedCornerSelectionFromFace(faces: Int32Array, faceMask: Mask, cornerIndices: Int32Array, num: number): Mask {
    const a = new Uint8Array(num)
    for (const f of faceMask) for (let c = faces[f]; c < faces[f + 1]; c++) a[cornerIndices[c]] = 1
    return fromBools(a)
}

/** `edge_selection_from_vert` (:61). */
function edgeSelectionFromVert(edges: Int32Array, vertSel: Uint8Array): Mask {
    const out: Mask = []
    for (let i = 0; i < edges.length / 2; i++) if (vertSel[edges[i * 2]] && vertSel[edges[i * 2 + 1]]) out.push(i)
    return out
}

/** `face_selection_from_mapped_corner` (:72): faces whose every corner vertex/edge is selected. */
function faceSelectionFromMappedCorner(faces: Int32Array, facesNum: number, cornerIndices: Int32Array, sel: Uint8Array): Mask {
    const out: Mask = []
    for (let f = 0; f < facesNum; f++) {
        let all = true
        for (let c = faces[f]; c < faces[f + 1] && all; c++) if (!sel[cornerIndices[c]]) all = false
        if (all) out.push(f)
    }
    return out
}

// endregion

/** `bke::gather_attributes(src, domain, domain, filter, mask, dst)` for one domain. */
function gatherDomain(src: MeshData, dst: MeshData, domain: AttrDomain, mask: Mask, skip: readonly string[]): void {
    for (const layer of src.attributes.layersOnDomain(domain)) {
        if (skip.includes(layer.name)) continue
        const type = layer.type as DataType
        const c = DATA_TYPES[type].components
        const out = dst.attributes.get(layer.name) ?? dst.attributes.add({name: layer.name, domain, type})
        mask.forEach((s, d) => { for (let k = 0; k < c; k++) out.data[d * c + k] = layer.data[s * c + k] })
    }
}

/** `bke::copy_attributes(src, domain, domain, filter, dst)`. */
function copyDomain(src: MeshData, dst: MeshData, domain: AttrDomain, skip: readonly string[]): void {
    for (const layer of src.attributes.layersOnDomain(domain)) {
        if (skip.includes(layer.name)) continue
        const out = dst.attributes.get(layer.name) ?? dst.attributes.add({name: layer.name, domain, type: layer.type})
        out.data.set(layer.data)
    }
}

/** `gather_attributes_group_to_group` on the corner domain: corners of the selected faces, in order. */
function gatherCorners(src: MeshData, dst: MeshData, faceMask: Mask, skip: readonly string[]): void {
    const so = src.faceOffsets
    for (const layer of src.attributes.layersOnDomain(AttrDomain.Corner)) {
        if (skip.includes(layer.name)) continue
        const c = DATA_TYPES[layer.type as DataType].components
        const out = dst.attributes.get(layer.name) ?? dst.attributes.add({name: layer.name, domain: AttrDomain.Corner, type: layer.type})
        let d = 0
        for (const f of faceMask) {
            for (let s = so[f]; s < so[f + 1]; s++, d++) for (let k = 0; k < c; k++) out.data[d * c + k] = layer.data[s * c + k]
        }
    }
}

/** `mesh_new_no_attributes` + `BKE_mesh_copy_parameters_for_eval` + `gather_selected_offsets`. */
function newMeshFor(src: MeshData, verts: number, edges: number, faceMask: Mask): MeshData {
    const dst = newMeshData()
    for (const layer of dst.attributes.layers()) dst.attributes.remove(layer.name)
    const so = src.faceOffsets
    let corners = 0
    for (const f of faceMask) corners += so[f + 1] - so[f]
    dst.resize({verts, edges, faces: faceMask.length, corners})
    let o = 0
    faceMask.forEach((f, i) => {
        dst.faceOffsets[i] = o
        o += so[f + 1] - so[f]
    })
    dst.faceOffsets[faceMask.length] = o
    dst.materials = src.materials.slice()
    return dst
}

/** `remap_edges` (:57): corner edges through the reverse map of the kept edges. */
function remapCornerEdges(src: MeshData, dst: MeshData, edgeMask: Mask, faceMask: Mask): void {
    const map = new Int32Array(src.edgesNum)
    edgeMask.forEach((s, d) => { map[s] = d })
    const sce = src.cornerEdges, so = src.faceOffsets
    const dce = dst.cornerEdges
    let d = 0
    for (const f of faceMask) for (let s = so[f]; s < so[f + 1]; s++) dce[d++] = map[sce[s]]
}

/** `mesh_copy_selection` (:118). */
export function meshCopySelection(src: MeshData, selection: GVArray, domain: AttrDomain): MeshData | null | undefined {
    if (selection.size === 0) return undefined
    if (selection.isSingle) return selection.single[0] ? undefined : null
    const edges = src.edgeVerts, faces = src.faceOffsets
    const sel = boolsOf(selection)
    let vertMask: Mask, edgeMask: Mask, faceMask: Mask
    if (domain === AttrDomain.Point) {
        vertMask = fromBools(sel)
        edgeMask = edgeSelectionFromVert(edges, sel)
        faceMask = faceSelectionFromMappedCorner(faces, src.facesNum, src.cornerVerts, sel)
    } else if (domain === AttrDomain.Edge) {
        edgeMask = fromBools(sel)
        vertMask = vertSelectionFromEdge(edges, edgeMask, src.vertsNum)
        faceMask = faceSelectionFromMappedCorner(faces, src.facesNum, src.cornerEdges, sel)
    } else if (domain === AttrDomain.Face) {
        faceMask = fromBools(sel)
        vertMask = mappedCornerSelectionFromFace(faces, faceMask, src.cornerVerts, src.vertsNum)
        edgeMask = mappedCornerSelectionFromFace(faces, faceMask, src.cornerEdges, src.edgesNum)
    } else {
        throw new Error('procedural: mesh_copy_selection: unsupported domain')
    }
    if (!vertMask.length) return null
    if (vertMask.length === src.vertsNum && edgeMask.length === src.edgesNum && faceMask.length === src.facesNum) return undefined

    const dst = newMeshFor(src, vertMask.length, edgeMask.length, faceMask)
    dst.attributes.add({name: '.edge_verts', domain: AttrDomain.Edge, type: 'int32x2'})
    dst.attributes.add({name: '.corner_vert', domain: AttrDomain.Corner, type: 'int32'})
    dst.attributes.add({name: '.corner_edge', domain: AttrDomain.Corner, type: 'int32'})
    // `remap_verts` (:21).
    const map = new Int32Array(src.vertsNum)
    vertMask.forEach((s, d) => { map[s] = d })
    const so = src.faceOffsets, scv = src.cornerVerts
    const dcv = dst.cornerVerts
    let d = 0
    for (const f of faceMask) for (let s = so[f]; s < so[f + 1]; s++) dcv[d++] = map[scv[s]]
    const de = dst.edgeVerts
    edgeMask.forEach((s, i) => {
        de[i * 2] = map[edges[s * 2]]
        de[i * 2 + 1] = map[edges[s * 2 + 1]]
    })
    remapCornerEdges(src, dst, edgeMask, faceMask)
    gatherDomain(src, dst, AttrDomain.Point, vertMask, [])
    gatherDomain(src, dst, AttrDomain.Edge, edgeMask, ['.edge_verts'])
    gatherDomain(src, dst, AttrDomain.Face, faceMask, [])
    gatherCorners(src, dst, faceMask, ['.corner_edge', '.corner_vert'])
    return dst
}

/** `mesh_copy_selection_keep_verts` (:283). */
export function meshCopySelectionKeepVerts(src: MeshData, selection: GVArray, domain: AttrDomain): MeshData | null | undefined {
    if (selection.size === 0) return undefined
    const edges = src.edgeVerts, faces = src.faceOffsets
    const sel = boolsOf(selection)
    let edgeMask: Mask, faceMask: Mask
    if (domain === AttrDomain.Point) {
        edgeMask = edgeSelectionFromVert(edges, sel)
        faceMask = faceSelectionFromMappedCorner(faces, src.facesNum, src.cornerVerts, sel)
    } else if (domain === AttrDomain.Edge) {
        edgeMask = fromBools(sel)
        faceMask = faceSelectionFromMappedCorner(faces, src.facesNum, src.cornerEdges, sel)
    } else if (domain === AttrDomain.Face) {
        faceMask = fromBools(sel)
        edgeMask = mappedCornerSelectionFromFace(faces, faceMask, src.cornerEdges, src.edgesNum)
    } else {
        throw new Error('procedural: mesh_copy_selection_keep_verts: unsupported domain')
    }
    if (edgeMask.length === src.edgesNum && faceMask.length === src.facesNum) return undefined
    const dst = newMeshFor(src, src.vertsNum, edgeMask.length, faceMask)
    dst.attributes.add({name: '.corner_edge', domain: AttrDomain.Corner, type: 'int32'})
    remapCornerEdges(src, dst, edgeMask, faceMask)
    copyDomain(src, dst, AttrDomain.Point, [])
    gatherDomain(src, dst, AttrDomain.Edge, edgeMask, [])
    gatherDomain(src, dst, AttrDomain.Face, faceMask, [])
    gatherCorners(src, dst, faceMask, ['.corner_edge'])
    return dst
}

/** `mesh_copy_selection_keep_edges` (:395). */
export function meshCopySelectionKeepEdges(src: MeshData, selection: GVArray, domain: AttrDomain): MeshData | null | undefined {
    if (selection.size === 0) return undefined
    const faces = src.faceOffsets
    const sel = boolsOf(selection)
    let faceMask: Mask
    if (domain === AttrDomain.Point) faceMask = faceSelectionFromMappedCorner(faces, src.facesNum, src.cornerVerts, sel)
    else if (domain === AttrDomain.Edge) faceMask = faceSelectionFromMappedCorner(faces, src.facesNum, src.cornerEdges, sel)
    else if (domain === AttrDomain.Face) faceMask = fromBools(sel)
    else throw new Error('procedural: mesh_copy_selection_keep_edges: unsupported domain')
    if (faceMask.length === src.facesNum) return undefined
    const dst = newMeshFor(src, src.vertsNum, src.edgesNum, faceMask)
    dst.attributes.add({name: '.corner_vert', domain: AttrDomain.Corner, type: 'int32'})
    dst.attributes.add({name: '.corner_edge', domain: AttrDomain.Corner, type: 'int32'})
    copyDomain(src, dst, AttrDomain.Point, [])
    copyDomain(src, dst, AttrDomain.Edge, [])
    gatherDomain(src, dst, AttrDomain.Face, faceMask, [])
    gatherCorners(src, dst, faceMask, [])
    return dst
}
