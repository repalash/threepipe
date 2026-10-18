/**
 * `BLI_kdopbvh` (`blenlib/intern/BLI_kdopbvh.cc`): the k-DOP bounding volume hierarchy behind Blender's mesh and
 * point cloud BVH trees. Ported: `BLI_bvhtree_new` (:858), `BLI_bvhtree_insert` (:982), `BLI_bvhtree_balance`
 * (:940) with the implicit-tree build (`non_recursive_bvh_div_nodes` :779, `split_leafs` :665, the intro-sort
 * partition :248-323) and `BLI_bvhtree_find_nearest` (:1696, depth-first `dfs_find_nearest_dfs` :1551).
 *
 * The tree layout (which leaf ends up where after the partitions) and the traversal order are Blender's, so a
 * query that has several equally near elements returns the one Blender returns. Bounds are float32 like C.
 */

import {f32} from './f32'

const FLT_MAX = 3.4028234663852886e38
/** `FLT_EPSILON` (2^-23). */
const FLT_EPSILON = 1.1920928955078125e-7

/** `bvhtree_kdop_axes` (:171). */
const KDOP_AXES: readonly (readonly number[])[] = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [1, -1, 1], [1, 1, -1], [1, -1, -1],
    [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, -1, 0], [1, 0, -1], [0, 1, -1],
]

/** `bvhtree_kdop_axes_length` (:190), as floats. */
const KDOP_AXES_LENGTH = [1, 1, 1, 1.7320508075688772, 1.7320508075688772, 1.7320508075688772, 1.7320508075688772,
    1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951,
    1.4142135623730951].map(f32)

/** `BVHNode` (:67). */
export interface BVHNode {
    children: (BVHNode | null)[]
    parent: BVHNode | null
    bv: Float32Array
    index: number
    nodeNum: number
    mainAxis: number
}

/** `BVHTreeNearest` (`BLI_kdopbvh.hh:46`). */
export interface BVHTreeNearest {
    index: number
    co: [number, number, number]
    distSq: number
}

/** `BVHTree_NearestPointCallback`: updates `nearest` when the element is nearer. */
export type NearestPointCallback = (index: number, co: readonly number[], nearest: BVHTreeNearest) => void

const stdMin = (a: number, b: number) => (b < a ? b : a)
const stdMax = (a: number, b: number) => (a < b ? b : a)

/** `dot_v3v3` (`math_vector_inline.cc`), left to right in float. */
const dot3 = (a: ArrayLike<number>, ao: number, b: ArrayLike<number>) =>
    f32(f32(f32(a[ao] * b[0]) + f32(a[ao + 1] * b[1])) + f32(a[ao + 2] * b[2]))

/** `implicit_needed_branches` (:648). */
function implicitNeededBranches(treeType: number, leafs: number): number {
    return Math.max(1, Math.trunc((leafs + treeType - 3) / (treeType - 1)))
}

/** `BVHBuildHelper` (:561). */
interface BuildHelper {
    treeType: number
    leafsNum: number
    leafsPerChild: number[]
    branchesOnLevel: number[]
    remainLeafs: number
}

export class BVHTree {
    /** `tree->nodes`: leaves first (reordered by the build), then the branches. */
    private readonly nodes: BVHNode[] = []
    private readonly nodearray: BVHNode[]
    private leafNum = 0
    private branchNum = 0
    readonly epsilon: number
    private readonly startAxis: number
    private readonly stopAxis: number

    /** `BLI_bvhtree_new` (:858). */
    constructor(maxsize: number, epsilon: number, readonly treeType: number, readonly axis: number) {
        // Tree epsilon must be >= FLT_EPSILON so tangent rays still hit a bounding volume.
        this.epsilon = epsilon > FLT_EPSILON ? epsilon : FLT_EPSILON
        if (axis === 26) [this.startAxis, this.stopAxis] = [0, 13]
        else if (axis === 18) [this.startAxis, this.stopAxis] = [7, 13]
        else if (axis === 14) [this.startAxis, this.stopAxis] = [0, 7]
        else if (axis === 8) [this.startAxis, this.stopAxis] = [0, 4]
        else if (axis === 6) [this.startAxis, this.stopAxis] = [0, 3]
        else throw new Error(`BLI_bvhtree_new: unsupported k-DOP axis count ${axis}`)
        const numnodes = maxsize + implicitNeededBranches(treeType, maxsize) + treeType
        this.nodearray = []
        for (let i = 0; i < numnodes; i++) {
            this.nodearray.push({children: new Array(treeType).fill(null), parent: null, bv: new Float32Array(axis), index: 0, nodeNum: 0, mainAxis: 0})
        }
    }

    /** `node_minmax_init` (:228). */
    private minmaxInit(node: BVHNode): void {
        for (let a = this.startAxis; a !== this.stopAxis; a++) {
            node.bv[2 * a] = FLT_MAX
            node.bv[2 * a + 1] = -FLT_MAX
        }
    }

    /** `BLI_bvhtree_insert` (:982) with `create_kdop_hull` (:348) and `bvhtree_node_inflate` (:972). */
    insert(index: number, co: ArrayLike<number>, numpoints: number): void {
        const node = this.nodearray[this.leafNum]
        this.nodes[this.leafNum] = node
        this.leafNum++
        this.minmaxInit(node)
        const bv = node.bv
        for (let k = 0; k < numpoints; k++) {
            for (let a = this.startAxis; a < this.stopAxis; a++) {
                const v = dot3(co, k * 3, KDOP_AXES[a])
                bv[2 * a] = stdMin(v, bv[2 * a])
                bv[2 * a + 1] = stdMax(v, bv[2 * a + 1])
            }
        }
        node.index = index
        for (let a = this.startAxis; a < this.stopAxis; a++) {
            const d = f32(this.epsilon * KDOP_AXES_LENGTH[a])
            bv[2 * a] = f32(bv[2 * a] - d)
            bv[2 * a + 1] = f32(bv[2 * a + 1] + d)
        }
    }

    get length(): number {
        return this.leafNum
    }

    // region build

    /** `refit_kdop_hull` (:374) over `tree->nodes[start, end)`. */
    private refitKdopHull(node: BVHNode, start: number, end: number): void {
        this.minmaxInit(node)
        const bv = node.bv
        for (let j = start; j < end; j++) {
            const nbv = this.nodes[j].bv
            for (let a = this.startAxis; a < this.stopAxis; a++) {
                bv[2 * a] = stdMin(nbv[2 * a], bv[2 * a])
                bv[2 * a + 1] = stdMax(nbv[2 * a + 1], bv[2 * a + 1])
            }
        }
    }

    /** `get_largest_axis` (:401): the index of the max bound of the widest of x, y, z. */
    private static largestAxis(bv: Float32Array): number {
        const x = f32(bv[1] - bv[0]), y = f32(bv[3] - bv[2]), z = f32(bv[5] - bv[4])
        if (x > y) return x > z ? 1 : 5
        return y > z ? 3 : 5
    }

    /** `bvh_insertionsort` (:248). */
    private insertionSort(a: BVHNode[], lo: number, hi: number, axis: number): void {
        for (let i = lo; i < hi; i++) {
            let j = i
            const t = a[i]
            while (j !== lo && t.bv[axis] < a[j - 1].bv[axis]) {
                a[j] = a[j - 1]
                j--
            }
            a[j] = t
        }
    }

    /** `bvh_partition` (:263). */
    private partition(a: BVHNode[], lo: number, hi: number, x: BVHNode, axis: number): number {
        let i = lo, j = hi
        const xv = x.bv[axis]
        for (;;) {
            while (a[i].bv[axis] < xv) i++
            j--
            while (xv < a[j].bv[axis]) j--
            if (!(i < j)) return i
            const t = a[i]
            a[i] = a[j]
            a[j] = t
            i++
        }
    }

    /** `bvh_medianof3` (:283). */
    private medianOf3(a: BVHNode[], lo: number, mid: number, hi: number, axis: number): BVHNode {
        const v = (k: number) => a[k].bv[axis]
        if (v(mid) < v(lo)) {
            if (v(hi) < v(mid)) return a[mid]
            if (v(hi) < v(lo)) return a[hi]
            return a[lo]
        }
        if (v(hi) < v(mid)) {
            if (v(hi) < v(lo)) return a[lo]
            return a[hi]
        }
        return a[mid]
    }

    /** `partition_nth_element` (:309). */
    private partitionNthElement(a: BVHNode[], begin: number, end: number, n: number, axis: number): void {
        while (end - begin > 3) {
            const cut = this.partition(a, begin, end, this.medianOf3(a, begin, Math.trunc((begin + end) / 2), end - 1, axis), axis)
            if (cut <= n) begin = cut
            else end = cut
        }
        this.insertionSort(a, begin, end, axis)
    }

    /** `split_leafs` (:665). */
    private splitLeafs(a: BVHNode[], nth: number[], partitions: number, axis: number): void {
        for (let i = 0; i < partitions - 1; i++) {
            if (nth[i] >= nth[partitions]) break
            this.partitionNthElement(a, nth[i], nth[partitions], nth[i + 1], axis)
        }
    }

    /** `build_implicit_tree_helper` (:574). */
    private buildHelper(): BuildHelper {
        const t = this.treeType
        const d: BuildHelper = {treeType: t, leafsNum: this.leafNum, leafsPerChild: new Array(32).fill(0), branchesOnLevel: new Array(32).fill(0), remainLeafs: 0}
        for (d.leafsPerChild[0] = 1; d.leafsPerChild[0] < d.leafsNum; d.leafsPerChild[0] *= t) { /* pass */ }
        d.branchesOnLevel[0] = 1
        for (let depth = 1; depth < 32 && d.leafsPerChild[depth - 1]; depth++) {
            d.branchesOnLevel[depth] = d.branchesOnLevel[depth - 1] * t
            d.leafsPerChild[depth] = Math.trunc(d.leafsPerChild[depth - 1] / t)
        }
        const remain = d.leafsNum - d.leafsPerChild[1]
        const nnodes = Math.trunc((remain + t - 2) / (t - 1))
        d.remainLeafs = remain + nnodes
        return d
    }

    /** `implicit_leafs_index` (:605). */
    private static leafsIndex(d: BuildHelper, depth: number, childIndex: number): number {
        const minLeafIndex = childIndex * d.leafsPerChild[depth - 1]
        if (minLeafIndex <= d.remainLeafs) return minLeafIndex
        if (d.leafsPerChild[depth]) return d.leafsNum - (d.branchesOnLevel[depth - 1] - childIndex) * d.leafsPerChild[depth]
        return d.remainLeafs
    }

    /** `BLI_bvhtree_balance` (:940) with `non_recursive_bvh_div_nodes` (:779). */
    balance(): void {
        const leafs = this.nodes
        const leafsNum = this.leafNum
        // Blender never balances an empty tree (`bvhtree_new_common` returns no tree for zero elements).
        if (!leafsNum) return
        const t = this.treeType
        const offset = 2 - t
        // `branches_array = tree->nodearray + (leaf_num - 1)`: implicit branch i (root 1) is nodearray[leaf_num - 1 + i].
        const branch = (i: number) => this.nodearray[leafsNum - 1 + i]
        const branchesNum = implicitNeededBranches(t, leafsNum)
        const root = branch(1)
        root.parent = null
        if (leafsNum === 1) {
            this.refitKdopHull(root, 0, leafsNum)
            root.mainAxis = Math.trunc(BVHTree.largestAxis(root.bv) / 2)
            root.nodeNum = 1
            root.children[0] = leafs[0]
            leafs[0].parent = root
        } else {
            const data = this.buildHelper()
            for (let i = 1, depth = 1; i <= branchesNum; i = i * t + offset, depth++) {
                const firstOfNextLevel = i * t + offset
                const iStop = Math.min(firstOfNextLevel, branchesNum + 1)
                for (let j = i; j < iStop; j++) {
                    // `non_recursive_bvh_div_nodes_task_cb` (:695).
                    const parentLevelIndex = j - i
                    const parent = branch(j)
                    const begin = BVHTree.leafsIndex(data, depth, parentLevelIndex)
                    const end = BVHTree.leafsIndex(data, depth, parentLevelIndex + 1)
                    this.refitKdopHull(parent, begin, end)
                    const splitAxis = BVHTree.largestAxis(parent.bv)
                    parent.mainAxis = Math.trunc(splitAxis / 2)
                    const nth: number[] = new Array(t + 1)
                    nth[0] = begin
                    nth[t] = end
                    for (let k = 1; k < t; k++) {
                        const childIndex = j * t + offset + k
                        nth[k] = BVHTree.leafsIndex(data, depth + 1, childIndex - firstOfNextLevel)
                    }
                    this.splitLeafs(leafs, nth, t, splitAxis)
                    let k = 0
                    for (; k < t; k++) {
                        const childIndex = j * t + offset + k
                        const levelIndex = childIndex - firstOfNextLevel
                        const cb = BVHTree.leafsIndex(data, depth + 1, levelIndex)
                        const ce = BVHTree.leafsIndex(data, depth + 1, levelIndex + 1)
                        if (ce - cb > 1) {
                            parent.children[k] = branch(childIndex)
                            parent.children[k]!.parent = parent
                        } else if (ce - cb === 1) {
                            parent.children[k] = leafs[cb]
                            leafs[cb].parent = parent
                        } else {
                            break
                        }
                    }
                    parent.nodeNum = k
                }
            }
        }
        this.branchNum = branchesNum
        for (let i = 0; i < this.branchNum; i++) this.nodes[leafsNum + i] = this.nodearray[leafsNum + i]
    }

    // endregion

    // region find nearest

    /** `calc_nearest_point_squared` (:1534): squared distance from `proj` to the node's AABB. */
    private static nearestPointSquared(proj: readonly number[], node: BVHNode, nearest: number[]): number {
        const bv = node.bv
        for (let i = 0; i < 3; i++) {
            let val = proj[i]
            val = stdMax(bv[2 * i], val)
            val = stdMin(bv[2 * i + 1], val)
            nearest[i] = val
        }
        // `len_squared_v3v3(proj, nearest)`.
        const d0 = f32(nearest[0] - proj[0]), d1 = f32(nearest[1] - proj[1]), d2 = f32(nearest[2] - proj[2])
        return f32(f32(f32(d0 * d0) + f32(d1 * d1)) + f32(d2 * d2))
    }

    /**
     * `BLI_bvhtree_find_nearest` (:1696): depth-first search updating `nearest` (start with `index = -1`,
     * `distSq = FLT_MAX`). Without a callback a leaf is as near as its (inflated) bounds.
     */
    findNearest(co: readonly number[], nearest: BVHTreeNearest, callback?: NearestPointCallback): number {
        if (!this.leafNum) return nearest.index
        const root = this.nodes[this.leafNum]
        const proj: number[] = []
        for (let a = this.startAxis; a !== this.stopAxis; a++) proj[a] = dot3(co, 0, KDOP_AXES[a])
        const scratch = [0, 0, 0]
        const dfs = (node: BVHNode) => {
            if (node.nodeNum === 0) {
                if (callback) {
                    callback(node.index, co, nearest)
                } else {
                    nearest.index = node.index
                    const c = [0, 0, 0]
                    nearest.distSq = BVHTree.nearestPointSquared(proj, node, c)
                    nearest.co = [c[0], c[1], c[2]]
                }
                return
            }
            // `dfs_find_nearest_dfs` (:1551): dive first into the side the query is on.
            if (proj[node.mainAxis] <= node.children[0]!.bv[node.mainAxis * 2 + 1]) {
                for (let i = 0; i !== node.nodeNum; i++) {
                    if (BVHTree.nearestPointSquared(proj, node.children[i]!, scratch) >= nearest.distSq) continue
                    dfs(node.children[i]!)
                }
            } else {
                for (let i = node.nodeNum - 1; i >= 0; i--) {
                    if (BVHTree.nearestPointSquared(proj, node.children[i]!, scratch) >= nearest.distSq) continue
                    dfs(node.children[i]!)
                }
            }
        }
        // `dfs_find_nearest_begin` (:1591).
        if (BVHTree.nearestPointSquared(proj, root, scratch) < nearest.distSq) dfs(root)
        return nearest.index
    }

    // endregion

    // region ray cast

    /**
     * `BLI_bvhtree_ray_cast` (:2017) = `BLI_bvhtree_ray_cast_ex(..., BVH_RAYCAST_DEFAULT)` (watertight): depth-first
     * `dfs_raycast` (:1862) with the `fast_ray_nearest_hit` box test (:1840). `dir` must be normalized. Rays with a
     * radius (`ray_nearest_hit`, sphere casts) are not ported.
     */
    rayCast(co: readonly number[], dir: readonly number[], radius: number, hit: BVHTreeRayHit, callback?: RayCastCallback): number {
        if (radius !== 0) throw new Error('BLI_bvhtree_ray_cast: rays with a radius (ray_nearest_hit) are not ported')
        const root = this.leafNum ? this.nodes[this.leafNum] : undefined
        // `bvhtree_ray_cast_data_precalc` (:1930).
        const rayDotAxis: number[] = [], idotAxis: number[] = [], index: number[] = []
        for (let i = 0; i < 3; i++) {
            const ax = KDOP_AXES[i]
            rayDotAxis[i] = f32(f32(f32(dir[0] * ax[0]) + f32(dir[1] * ax[1])) + f32(dir[2] * ax[2]))
            if (Math.abs(rayDotAxis[i]) < FLT_EPSILON) {
                rayDotAxis[i] = 0
                idotAxis[i] = FLT_MAX
            } else {
                idotAxis[i] = f32(1 / rayDotAxis[i])
            }
            index[2 * i] = (idotAxis[i] < 0 ? 1 : 0) + 2 * i
            index[2 * i + 1] = 1 - (idotAxis[i] < 0 ? 1 : 0) + 2 * i
        }
        const ray: BVHTreeRay = {origin: co, direction: dir, radius, isectPrecalc: isectRayTriWatertightPrecalc(dir)}
        const fastRayNearestHit = (node: BVHNode): number => {
            const bv = node.bv
            const t1x = f32(f32(bv[index[0]] - co[0]) * idotAxis[0])
            const t2x = f32(f32(bv[index[1]] - co[0]) * idotAxis[0])
            const t1y = f32(f32(bv[index[2]] - co[1]) * idotAxis[1])
            const t2y = f32(f32(bv[index[3]] - co[1]) * idotAxis[1])
            const t1z = f32(f32(bv[index[4]] - co[2]) * idotAxis[2])
            const t2z = f32(f32(bv[index[5]] - co[2]) * idotAxis[2])
            if ((t1x > t2y || t2x < t1y || t1x > t2z || t2x < t1z || t1y > t2z || t2y < t1z) ||
                (t2x < 0 || t2y < 0 || t2z < 0) ||
                (t1x > hit.dist || t1y > hit.dist || t1z > hit.dist)) return FLT_MAX
            // `std::max({t1x, t1y, t1z})`: the first of the largest, by `<`.
            let m = t1x
            if (m < t1y) m = t1y
            if (m < t1z) m = t1z
            return m
        }
        const dfs = (node: BVHNode) => {
            const dist = fastRayNearestHit(node)
            if (dist >= hit.dist) return
            if (node.nodeNum === 0) {
                if (callback) {
                    callback(node.index, ray, hit)
                } else {
                    hit.index = node.index
                    hit.dist = dist
                    hit.co = [f32(co[0] + f32(dir[0] * dist)), f32(co[1] + f32(dir[1] * dist)), f32(co[2] + f32(dir[2] * dist))]
                }
                return
            }
            if (rayDotAxis[node.mainAxis] > 0) {
                for (let i = 0; i !== node.nodeNum; i++) dfs(node.children[i]!)
            } else {
                for (let i = node.nodeNum - 1; i >= 0; i--) dfs(node.children[i]!)
            }
        }
        if (root) dfs(root)
        return hit.index
    }

    // endregion
}

/** `BVHTreeRay` (`BLI_kdopbvh.hh:61`) with the watertight precalculation (`USE_KDOPBVH_WATERTIGHT`, :22). */
export interface BVHTreeRay {
    origin: readonly number[]
    direction: readonly number[]
    radius: number
    isectPrecalc: IsectRayPrecalc
}

/** `BVHTreeRayHit` (`BLI_kdopbvh.hh:73`). */
export interface BVHTreeRayHit {
    index: number
    co: [number, number, number]
    no: [number, number, number]
    dist: number
}

/** `BVHTree_RayCastCallback`. */
export type RayCastCallback = (index: number, ray: BVHTreeRay, hit: BVHTreeRayHit) => void

/** `IsectRayPrecalc` (`BLI_math_geom.h`). */
export interface IsectRayPrecalc {
    kx: number
    ky: number
    kz: number
    sx: number
    sy: number
    sz: number
}

/** `axis_dominant_v3_single` (`math_geom_inline.cc:86`). */
function axisDominantSingle(v: readonly number[]): number {
    const x = Math.abs(v[0]), y = Math.abs(v[1]), z = Math.abs(v[2])
    return x > y ? (x > z ? 0 : 2) : (y > z ? 1 : 2)
}

/** `isect_ray_tri_watertight_v3_precalc` (`math_geom.cc:1897`). */
export function isectRayTriWatertightPrecalc(dir: readonly number[]): IsectRayPrecalc {
    const kz = axisDominantSingle(dir)
    let kx = kz !== 2 ? kz + 1 : 0
    let ky = kx !== 2 ? kx + 1 : 0
    if (dir[kz] < 0) [kx, ky] = [ky, kx]
    const invDirZ = f32(1 / dir[kz])
    return {kx, ky, kz, sx: f32(dir[kx] * invDirZ), sy: f32(dir[ky] * invDirZ), sz: invDirZ}
}

/** `isect_ray_tri_watertight_v3` (`math_geom.cc:1924`): the hit distance, or undefined. */
export function isectRayTriWatertight(origin: readonly number[], pre: IsectRayPrecalc, v0: ArrayLike<number>, v1: ArrayLike<number>, v2: ArrayLike<number>): number | undefined {
    const {kx, ky, kz, sx, sy, sz} = pre
    const a = [f32(v0[0] - origin[0]), f32(v0[1] - origin[1]), f32(v0[2] - origin[2])]
    const b = [f32(v1[0] - origin[0]), f32(v1[1] - origin[1]), f32(v1[2] - origin[2])]
    const c = [f32(v2[0] - origin[0]), f32(v2[1] - origin[1]), f32(v2[2] - origin[2])]
    const ax = f32(a[kx] - f32(sx * a[kz])), ay = f32(a[ky] - f32(sy * a[kz]))
    const bx = f32(b[kx] - f32(sx * b[kz])), by = f32(b[ky] - f32(sy * b[kz]))
    const cx = f32(c[kx] - f32(sx * c[kz])), cy = f32(c[ky] - f32(sy * c[kz]))
    const u = f32(f32(cx * by) - f32(cy * bx))
    const v = f32(f32(ax * cy) - f32(ay * cx))
    const w = f32(f32(bx * ay) - f32(by * ax))
    if ((u < 0 || v < 0 || w < 0) && (u > 0 || v > 0 || w > 0)) return undefined
    const det = f32(f32(u + v) + w)
    if (det === 0 || !Number.isFinite(det)) return undefined
    const t = f32(f32(f32(f32(u * a[kz]) + f32(v * b[kz])) + f32(w * c[kz])) * sz)
    // `xor_fl(t, sign_det)`: t with its sign flipped when det is negative (sign bit, so -0 too).
    const signT = det < 0 || Object.is(det, -0) ? -t : t
    if (signT < 0) return undefined
    const invDet = f32(1 / det)
    return f32(t * invDet)
}

/** A fresh `BVHTreeNearest` as the callers initialise it (`index = -1`, `dist_sq = FLT_MAX`). */
export function newNearest(): BVHTreeNearest {
    return {index: -1, co: [0, 0, 0], distSq: FLT_MAX}
}
