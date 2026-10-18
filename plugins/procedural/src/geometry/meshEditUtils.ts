/**
 * Helpers shared by the ported mesh-editing geometry nodes (Extrude Mesh, Split Edges, Duplicate Elements):
 * growing a mesh in place (`expand_mesh`, `node_geo_extrude_mesh.cc:133`), the attribute gathers and propagation
 * mixes they apply to the new elements, and the topology maps they build (`bke::mesh::build_*_map`,
 * `blenkernel/intern/mesh_mapping.cc`, groups sorted ascending).
 *
 * Blender skips attributes stored as a single value (`AttrStorageType::Single`) in these transfers because a resized
 * single attribute keeps its value; the kernel stores every attribute as an array, so here they are transferred
 * like the rest (see `issues/open/modelling-tools/procedural-attribute-single-storage.md`).
 */

import {AttrDomain, AttributeLayer, MeshData} from '@threepipe/mesh-kernel'
import {DATA_TYPES, DataType} from './dataTypes'
import {createPropagationMixer} from './mixers'
import {tagTopologyChanged} from './meshTopology'
import {GroupedIndices} from './meshTopology'

/** `expand_mesh` (`node_geo_extrude_mesh.cc:133`): grow every domain, keeping existing data; new face offsets are the caller's. */
export function expandMesh(mesh: MeshData, vertExpand: number, edgeExpand: number, faceExpand: number, cornerExpand: number): void {
    const corners = mesh.cornersNum + cornerExpand
    if (vertExpand) mesh.resizeDomain(AttrDomain.Point, mesh.vertsNum + vertExpand)
    if (edgeExpand) mesh.resizeDomain(AttrDomain.Edge, mesh.edgesNum + edgeExpand)
    if (faceExpand) {
        mesh.resizeDomain(AttrDomain.Face, mesh.facesNum + faceExpand)
        mesh.faceOffsets[0] = 0
        mesh.faceOffsets[mesh.facesNum] = corners
    }
    if (cornerExpand) mesh.resizeDomain(AttrDomain.Corner, corners)
}

/** `Mesh::tag_topology_changed` (`mesh_runtime.cc:410`): every runtime cache (`meshRuntime.ts`) is stale. */
export function tagMeshChanged(mesh: MeshData): void {
    tagTopologyChanged(mesh)
}

/** `get_transfer_attribute_names` (`node_geo_extrude_mesh.cc:276`): attribute layers per domain, minus `skip`. */
export function transferLayers(mesh: MeshData, skip: readonly string[]): Record<number, AttributeLayer[]> {
    const out: Record<number, AttributeLayer[]> = {[AttrDomain.Point]: [], [AttrDomain.Edge]: [], [AttrDomain.Face]: [], [AttrDomain.Corner]: []}
    for (const layer of mesh.attributes.layers()) {
        if (skip.includes(layer.name)) continue
        out[layer.domain]?.push(layer)
    }
    return out
}

/** `bke::attribute_math::gather(span, indices, span.slice(range))` within one layer. */
export function gatherInLayer(layer: AttributeLayer, indices: ArrayLike<number>, dstStart: number): void {
    const c = DATA_TYPES[layer.type as DataType].components
    const d = layer.data
    for (let i = 0; i < indices.length; i++) {
        const s = indices[i] * c, o = (dstStart + i) * c
        for (let k = 0; k < c; k++) d[o + k] = d[s + k]
    }
}

/**
 * `copy_with_mixing` (`node_geo_extrude_mesh.cc:205-271`): element `i` of the destination range mixes the
 * source elements of group `selection[i]` with `DefaultPropagationMixer` ("or" for booleans).
 */
export function mixGroupsInLayer(layer: AttributeLayer, groups: GroupedIndices, selection: ArrayLike<number>, dstStart: number, count = selection.length): void {
    const type = layer.type as DataType
    const c = DATA_TYPES[type].components
    const out = new DATA_TYPES[type].array(count * c)
    const mixer = createPropagationMixer(type, out)
    for (let i = 0; i < count; i++) {
        const g = selection[i]
        for (let j = groups.offsets[g]; j < groups.offsets[g + 1]; j++) mixer.mixIn(i, layer.data, groups.indices[j])
    }
    mixer.finalize()
    layer.data.set(out as never, dstStart * c)
}

/** `save_selection_as_attribute` (`node_geo_extrude_mesh.cc:91`): a new boolean attribute true on `indices`. */
export function saveSelectionAsAttribute(mesh: MeshData, name: string, domain: AttrDomain, indices: Iterable<number>): void {
    const layer = mesh.attributes.add({name, domain, type: 'bool'})
    for (const i of indices) layer.data[i] = 1
}

export function range(start: number, size: number): number[] {
    return Array.from({length: size}, (_, i) => start + i)
}

/** Ascending groups from `(group, element)` pairs listed in element order (`reverse_indices_in_groups` + `sort_groups`). */
function groupsFrom(size: number, pairs: (emit: (group: number, element: number) => void) => void): GroupedIndices {
    const counts = new Int32Array(size + 1)
    pairs(g => { counts[g + 1]++ })
    for (let i = 0; i < size; i++) counts[i + 1] += counts[i]
    const offsets = counts.slice()
    const fill = counts.slice(0, size)
    const indices = new Int32Array(offsets[size])
    pairs((g, e) => { indices[fill[g]++] = e })
    for (let g = 0; g < size; g++) indices.subarray(offsets[g], offsets[g + 1]).sort()
    return {offsets, indices}
}

/** `bke::mesh::build_vert_to_edge_map` (`mesh_mapping.cc:298`) over the edges in `edgeMask` (all when omitted), as original edge indices. */
export function buildVertToEdgeMap(edges: Int32Array, vertsNum: number, edgeMask?: ArrayLike<number>): GroupedIndices {
    const n = edgeMask ? edgeMask.length : edges.length / 2
    return groupsFrom(vertsNum, emit => {
        for (let i = 0; i < n; i++) {
            const e = edgeMask ? edgeMask[i] : i
            emit(edges[e * 2], e)
            emit(edges[e * 2 + 1], e)
        }
    })
}

/** `bke::mesh::build_edge_to_face_map` (`mesh_mapping.cc:365`). */
export function buildEdgeToFaceMap(faceOffsets: Int32Array, cornerEdges: Int32Array, edgesNum: number, facesNum: number): GroupedIndices {
    return groupsFrom(edgesNum, emit => {
        for (let f = 0; f < facesNum; f++) for (let c = faceOffsets[f]; c < faceOffsets[f + 1]; c++) emit(cornerEdges[c], f)
    })
}

/** `bke::mesh::build_vert_to_face_map` (`mesh_mapping.cc:329`). */
export function buildVertToFaceMap(faceOffsets: Int32Array, cornerVerts: Int32Array, vertsNum: number, facesNum: number): GroupedIndices {
    return groupsFrom(vertsNum, emit => {
        for (let f = 0; f < facesNum; f++) for (let c = faceOffsets[f]; c < faceOffsets[f + 1]; c++) emit(cornerVerts[c], f)
    })
}

/** `bke::mesh::build_vert_to_corner_map` (`mesh_mapping.cc:349`). */
export function buildVertToCornerMap(cornerVerts: Int32Array, vertsNum: number): GroupedIndices {
    return groupsFrom(vertsNum, emit => {
        for (let c = 0; c < cornerVerts.length; c++) emit(cornerVerts[c], c)
    })
}
