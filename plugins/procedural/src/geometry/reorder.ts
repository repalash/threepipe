/**
 * `geometry/intern/reorder.cc`: reordering one domain of a component (`reordered_component`, `reorder_mesh`,
 * `reorder_points`, `reorder_curves_geometry`, `reorder_instaces`) and `sort_indices_by_weights`.
 *
 * Each result is a new component with the source's parameters; attributes on the reordered domain are gathered by
 * `old_by_new_map`, the others copied, and the index attributes pointing into the reordered domain remapped through
 * the inverse permutation. Values are the same as Blender's; the order attributes are listed in may differ.
 */

import {AttrDomain, AttributeLayer, AttributeStorage, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {CurvesGeometry, Instances, PointCloud} from './components'
import {DATA_TYPES, DataType} from './dataTypes'
import {meshTagTopologyChanged} from './meshRuntime'
import {GVArray} from './varray'

/** `components_supported_reordering` (:13). */
export const SUPPORTED_REORDERING: Record<'mesh' | 'curves' | 'pointcloud' | 'instances', AttrDomain[]> = {
    mesh: [AttrDomain.Point, AttrDomain.Edge, AttrDomain.Face],
    curves: [AttrDomain.Curve],
    pointcloud: [AttrDomain.Point],
    instances: [AttrDomain.Instance],
}

/** `invert_permutation` (:68). */
function invertPermutation(p: ArrayLike<number>): Int32Array {
    const out = new Int32Array(p.length)
    for (let i = 0; i < p.length; i++) out[p[i]] = i
    return out
}

function components(layer: AttributeLayer): number {
    return DATA_TYPES[layer.type as DataType].components
}

/** `bke::gather_attributes` on one domain, in place: element `i` becomes old element `oldByNew[i]`. */
function gatherDomain(storage: AttributeStorage, domain: AttrDomain, oldByNew: ArrayLike<number>): void {
    for (const layer of storage.layersOnDomain(domain)) {
        const c = components(layer), src = layer.data.slice()
        for (let i = 0; i < oldByNew.length; i++) for (let k = 0; k < c; k++) layer.data[i * c + k] = src[oldByNew[i] * c + k]
    }
}

/** `offset_indices::gather_group_sizes` + `accumulate_counts_to_offsets`. */
function gatherOffsets(old: ArrayLike<number>, oldByNew: ArrayLike<number>): Int32Array {
    const out = new Int32Array(oldByNew.length + 1)
    for (let i = 0; i < oldByNew.length; i++) out[i + 1] = out[i] + (old[oldByNew[i] + 1] - old[oldByNew[i]])
    return out
}

/** `reorder_attributes_group_to_group` (:30): the groups of `domain` move with their owners. */
function gatherGroups(storage: AttributeStorage, domain: AttrDomain, oldOffsets: ArrayLike<number>, newOffsets: ArrayLike<number>, oldByNew: ArrayLike<number>): void {
    for (const layer of storage.layersOnDomain(domain)) {
        const c = components(layer), src = layer.data.slice()
        for (let i = 0; i < oldByNew.length; i++) {
            const s = oldOffsets[oldByNew[i]], n = oldOffsets[oldByNew[i] + 1] - s, d = newOffsets[i]
            for (let j = 0; j < n * c; j++) layer.data[d * c + j] = src[s * c + j]
        }
    }
}

/** `reorder_mesh` (:258): `copy_and_reorder_mesh_verts` (:78), `_edges` (:122), `_faces` (:158). */
export function reorderMesh(src: MeshData, oldByNew: ArrayLike<number>, domain: AttrDomain): MeshData {
    const dst = src.clone()
    meshTagTopologyChanged(dst)
    const storage = dst.attributes
    if (domain === AttrDomain.Point) {
        gatherDomain(storage, AttrDomain.Point, oldByNew)
        const newByOld = invertPermutation(oldByNew)
        const ev = dst.edgeVerts, cv = dst.cornerVerts
        for (let k = 0; k < ev.length; k++) ev[k] = newByOld[ev[k]]
        for (let k = 0; k < cv.length; k++) cv[k] = newByOld[cv[k]]
    } else if (domain === AttrDomain.Edge) {
        gatherDomain(storage, AttrDomain.Edge, oldByNew)
        const newByOld = invertPermutation(oldByNew)
        const ce = dst.cornerEdges
        for (let k = 0; k < ce.length; k++) ce[k] = newByOld[ce[k]]
    } else if (domain === AttrDomain.Face) {
        gatherDomain(storage, AttrDomain.Face, oldByNew)
        const oldOffsets = src.faceOffsets
        const newOffsets = gatherOffsets(oldOffsets, oldByNew)
        dst.faceOffsets.set(newOffsets)
        gatherGroups(storage, AttrDomain.Corner, oldOffsets, newOffsets, oldByNew)
    }
    return dst
}

/** `reorder_points` (:267). */
export function reorderPoints(src: PointCloud, oldByNew: ArrayLike<number>): PointCloud {
    const dst = src.clone()
    gatherDomain(dst.attributes, AttrDomain.Point, oldByNew)
    return dst
}

/** `reorder_curves_geometry` (:276) with `copy_and_reorder_curves` (:204); custom NURBS knots are not stored here. */
export function reorderCurves(src: CurvesGeometry, oldByNew: ArrayLike<number>): CurvesGeometry {
    const dst = src.clone()
    gatherDomain(dst.attributes, AttrDomain.Curve, oldByNew)
    const newOffsets = gatherOffsets(src.curveOffsets, oldByNew)
    dst.curveOffsets.set(newOffsets)
    gatherGroups(dst.attributes, AttrDomain.Point, src.curveOffsets, newOffsets, oldByNew)
    return dst
}

/** `reorder_instaces` (:296): attributes (transforms and reference handles included); the references stay. */
export function reorderInstances(src: Instances, oldByNew: ArrayLike<number>): Instances {
    const dst = src.clone()
    gatherDomain(dst.attributes, AttrDomain.Instance, oldByNew)
    return dst
}

/** `grouped_sort` (:355): stable by weight (ties by index), within each group. */
function groupedSort(offsets: ArrayLike<number>, weights: ArrayLike<number>, indices: Int32Array): void {
    for (let g = 0; g + 1 < offsets.length; g++) {
        const group = indices.subarray(offsets[g], offsets[g + 1])
        group.sort((a, b) => {
            const wa = weights[a], wb = weights[b]
            if (wa === wb) return a - b
            return wa < wb ? -1 : 1
        })
    }
}

/**
 * `identifiers_to_indices` (:383): each identifier becomes the rank of its value among the distinct values.
 * Returns the number of distinct values.
 */
function identifiersToIndices(ids: Int32Array): number {
    const distinct = [...new Set(ids)].sort((a, b) => a - b)
    const rank = new Map<number, number>()
    distinct.forEach((v, i) => rank.set(v, i))
    for (let i = 0; i < ids.length; i++) ids[i] = rank.get(ids[i])!
    return distinct.length
}

function isRange(indices: ArrayLike<number>): boolean {
    for (let i = 0; i < indices.length; i++) if (indices[i] !== i) return false
    return true
}

/**
 * `sort_indices_by_weights` (:399): the new order of the elements (old index per new index), or undefined when it
 * does not change. Unselected elements keep their places; selected ones are sorted by group ID, then weight, then
 * index.
 *
 * `find_points_by_group_index` fills each group with `reverse_indices_in_groups(..., sort = false)`, whose order
 * within a group is the threads' order when the selection has more than 1024 elements; it is ascending index order
 * here (Blender's single-threaded order). It only shows when the weight is a single value.
 */
export function sortIndicesByWeights(domainSize: number, mask: ArrayLike<number>, groupId: GVArray, weight: GVArray): Int32Array | undefined {
    if (groupId.isSingle && weight.isSingle) return undefined
    if (mask.length === 0) return undefined
    let gathered: Int32Array
    if (groupId.isSingle) {
        gathered = Int32Array.from(mask)
        const w = new Float32Array(domainSize)
        for (let k = 0; k < mask.length; k++) w[mask[k]] = f32(weight.get(mask[k]))
        groupedSort([0, mask.length], w, gathered)
    } else {
        const ids = Int32Array.from({length: mask.length}, (_, k) => groupId.get(mask[k]))
        const groups = identifiersToIndices(ids)
        // `build_reverse_offsets` + `reverse_indices_in_groups`: positions in the mask, by group.
        const offsets = new Int32Array(groups + 1)
        for (let k = 0; k < ids.length; k++) offsets[ids[k] + 1]++
        for (let g = 0; g < groups; g++) offsets[g + 1] += offsets[g]
        const fill = new Int32Array(groups)
        gathered = new Int32Array(mask.length)
        for (let k = 0; k < ids.length; k++) gathered[offsets[ids[k]] + fill[ids[k]]++] = k
        if (!weight.isSingle) {
            const w = Float32Array.from({length: mask.length}, (_, k) => weight.get(mask[k]))
            groupedSort(offsets, w, gathered)
        }
        for (let k = 0; k < gathered.length; k++) gathered[k] = mask[gathered[k]]
    }
    if (gathered.length === domainSize && isRange(gathered)) return undefined
    if (mask.length === domainSize) return gathered
    // Unselected elements stay where they are; selected positions take the sorted selection.
    const indices = Int32Array.from({length: domainSize}, (_, i) => i)
    for (let k = 0; k < mask.length; k++) indices[mask[k]] = gathered[k]
    if (isRange(indices)) return undefined
    return indices
}
