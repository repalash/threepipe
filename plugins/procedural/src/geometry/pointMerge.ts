/**
 * `geometry::point_merge_by_distance` / `merge_points` (`geometry/intern/point_merge.cc`): selected points within the
 * distance are merged into groups found with `kdtree_calc_duplicates_fast`; unselected points come first, then one
 * point per group with its attributes mixed (`mix_groups`; `id` takes the group's first point).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {KDTree3} from '../blender/kdtree'
import {PointCloud} from './components'
import {DATA_TYPES, DataType} from './dataTypes'
import {mixIndices} from './mixIndices'

/** `merge_points` (:22). */
export function mergePoints(src: PointCloud, selection: number[], mergeIds: Int32Array): PointCloud {
    // Groups in order of first occurrence (`VectorSet`), indices ascending within each group.
    const groupOf = new Map<number, number>()
    const groups: number[][] = []
    for (const i of selection) {
        let g = groupOf.get(mergeIds[i])
        if (g === undefined) {
            groupOf.set(mergeIds[i], g = groups.length)
            groups.push([])
        }
        groups[g].push(i)
    }
    const selected = new Uint8Array(src.pointsNum)
    for (const i of selection) selected[i] = 1
    const unselected: number[] = []
    for (let i = 0; i < src.pointsNum; i++) if (!selected[i]) unselected.push(i)

    const dst = new PointCloud(unselected.length + groups.length)
    dst.materials = []
    const sa = src.accessor(), da = dst.accessor()
    for (const name of sa.names()) {
        const meta = sa.lookupMeta(name)!
        const type: DataType = meta.type
        const layer = src.attributes.get(name)!
        if (!da.contains(name)) da.add(name, AttrDomain.Point, type)
        const out = dst.attributes.get(name)!.data
        const c = DATA_TYPES[type].components
        unselected.forEach((s, d) => { for (let k = 0; k < c; k++) out[d * c + k] = layer.data[s * c + k] })
        const base = unselected.length
        if (name === 'id' && type === 'int32') {
            groups.forEach((g, i) => { out[base + i] = layer.data[g[0]] })
        } else {
            groups.forEach((g, i) => mixIndices(type, layer.data, g, out, base + i))
        }
    }
    return dst
}

/** `point_merge_by_distance` (:96). */
export function pointMergeByDistance(src: PointCloud, distance: number, selection: number[]): PointCloud {
    const positions = src.positions
    const tree = new KDTree3(selection.length)
    for (const i of selection) tree.insert(i, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    tree.balance()
    const roots = new Int32Array(src.pointsNum).fill(-1)
    tree.calcDuplicatesFast(distance, roots)
    for (let i = 0; i < roots.length; i++) if (roots[i] === -1) roots[i] = i
    return mergePoints(src, selection, roots)
}
