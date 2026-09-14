/**
 * ForEach composition utilities — iterate over face groups or point clouds
 * and collect results into a Group.
 *
 * Maps to Blender's "For Each Geometry Element Zone" (Blender 4.3).
 * Iterates over groups (not individual elements) and runs a user callback per group.
 *
 * Reference: Blender foreach_geometry.cc
 * https://projects.blender.org/blender/blender/src/branch/main/source/blender/geometry/intern/foreach_geometry.cc
 */

import {Group2, type IObject3D} from 'threepipe'
import {SeededRandom} from '../utils/SeededRandom'
import type {FaceClassification, FaceInfo} from '../geo/FaceClassifier'
import type {PointCloud, ProcPoint} from '../points/types'

/**
 * Run a function for each classified face group, collect results into a Group.
 * The callback receives the group label, face indices, and precomputed face infos.
 * Return null from the callback to skip a group.
 *
 * This is how building generators process each wall/roof/floor group independently.
 */
export function perFaceGroup(
    classification: FaceClassification,
    fn: (label: string, faceIndices: number[], faceInfos: FaceInfo[]) => IObject3D | null,
): Group2 {
    const group = new Group2()
    group.name = 'ForEach_FaceGroups'

    for (const [label, faceIndices] of classification.groups) {
        const faceInfos = faceIndices.map(i => classification.faceInfos[i])
        const result = fn(label, faceIndices, faceInfos)
        if (result) {
            result.name = result.name || label
            group.add(result)
        }
    }

    return group
}

/**
 * Run a function for each point in a cloud, collect results into a Group.
 * Each invocation gets a forked SeededRandom for deterministic independence —
 * changing one point's output doesn't affect others.
 *
 * This is how city generators spawn a building at each block point.
 */
export function perPoint(
    cloud: PointCloud,
    fn: (pt: ProcPoint, index: number, rng: SeededRandom) => IObject3D | null,
    seed = 42,
): Group2 {
    const group = new Group2()
    group.name = 'ForEach_Points'
    const rng = new SeededRandom(seed)

    for (let i = 0; i < cloud.length; i++) {
        const childRng = rng.fork()
        const result = fn(cloud[i], i, childRng)
        if (result) {
            result.position.copy(cloud[i].position)
            group.add(result)
        }
    }

    return group
}
