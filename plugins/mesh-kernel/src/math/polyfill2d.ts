/**
 * `BLI_polyfill_calc` - ear clipping of one 2D polygon into `n - 2` triangles.
 *
 * Port of `blenlib/intern/polyfill_2d.cc` (Blender 5.2.2) with the same build options Blender ships:
 * `USE_CLIP_EVEN`, `USE_CONVEX_SKIP`, `USE_CLIP_SWEEP`, `USE_KDTREE`, `USE_KDTREE_INDEX_CACHE` and
 * `USE_PRECOMPUTED_ISECT` (`polyfill_2d.cc:53-71`). The KD-tree of concave vertices and the
 * last-hit cache only accelerate the "is any concave vertex inside this ear" test; they are ported as
 * written so the traversal is the same, which the triangle output does not depend on but the cost does.
 *
 * Arithmetic is float32 like Blender's (`float`, built with `-ffp-contract=off`,
 * `build_files/cmake/platform/platform_unix.cmake:898`), so every product and sum is rounded with
 * `Math.fround` and the signs and ear choices match Blender's exactly.
 */

const f = Math.fround

const CONCAVE = -1
const TANGENTIAL = 0
const CONVEX = 1

const KDNODE_UNSET = 0xffffffff
const KDNODE_FLAG_REMOVED = 1
const KDTREE_INDEX_CACHE_UNSET = 0xffffffff
const INDEX_CACHE_DIRTY = 1

/** `PolyIndex` (`:153`): one vertex of the circular doubly linked list. */
interface PolyIndex {
    next: PolyIndex
    prev: PolyIndex
    index: number
    sign: number
    flag: number
    indexLastHit: number
}

/** `KDTreeNode2D` (`:111`). */
interface KDNode {
    neg: number
    pos: number
    index: number
    axis: number
    flag: number
    parent: number
}

interface KDTree {
    nodes: KDNode[]
    coords: Float32Array
    root: number
    nodeNum: number
    nodesMap: Uint32Array
}

interface PolyFill {
    indices: PolyIndex
    coords: Float32Array
    coordsNum: number
    coordsNumConcave: number
    tris: Uint32Array
    trisNum: number
    kdtree: KDTree
}

/** `signum_enum` (`:233`). */
function signumEnum(a: number): number {
    if (a > 0) return CONVEX
    if (a === 0) return TANGENTIAL
    return CONCAVE
}

/** `area_tri_signed_v2_alt_2x` (`:250`). */
function areaTriSignedV2Alt2x(c: Float32Array, v1: number, v2: number, v3: number): number {
    const d2x = f(c[v2 * 2] - c[v1 * 2]), d2y = f(c[v2 * 2 + 1] - c[v1 * 2 + 1])
    const d3x = f(c[v3 * 2] - c[v1 * 2]), d3y = f(c[v3 * 2 + 1] - c[v1 * 2 + 1])
    return f(f(d2x * d3y) - f(d3x * d2y))
}

/** `span_tri_v2_sign` (`:258`). */
function spanTriV2Sign(c: Float32Array, v1: number, v2: number, v3: number): number {
    return signumEnum(areaTriSignedV2Alt2x(c, v3, v2, v1))
}

/** `TriIsectPrecomputed` (`:184`) as 9 floats: edges[3][2] then c[3]. */
type TriIsect = Float32Array

/** `tri_isect_precomputed_init` (`:197`). */
function triIsectInit(c: Float32Array, vs: [number, number, number]): TriIsect {
    const t = new Float32Array(9)
    const [a, b, d] = vs
    t[0] = c[b * 2] - c[a * 2]
    t[1] = c[b * 2 + 1] - c[a * 2 + 1]
    t[2] = c[d * 2] - c[b * 2]
    t[3] = c[d * 2 + 1] - c[b * 2 + 1]
    t[4] = c[a * 2] - c[d * 2]
    t[5] = c[a * 2 + 1] - c[d * 2 + 1]
    t[6] = f(f(t[0] * c[a * 2 + 1]) - f(c[a * 2] * t[1]))
    t[7] = f(f(t[2] * c[b * 2 + 1]) - f(c[b * 2] * t[3]))
    t[8] = f(f(t[4] * c[d * 2 + 1]) - f(c[d * 2] * t[5]))
    return t
}

/** `tri_isect_precomputed_test` (`:213`): edge 1 first, as Blender does. */
function triIsectTest(t: TriIsect, x: number, y: number): boolean {
    return f(f(f(t[3] * x) - f(t[2] * y)) + t[7]) >= 0 &&
        f(f(f(t[5] * x) - f(t[4] * y)) + t[8]) >= 0 &&
        f(f(f(t[1] * x) - f(t[0] * y)) + t[6]) >= 0
}

/** `kdtree2d_init` (`:285`): one node per non-convex vertex, in list order. */
function kdtreeInit(tree: KDTree, coordsNum: number, first: PolyIndex): void {
    let pi = first
    for (let i = 0; i < coordsNum; i++, pi = pi.next) {
        if (pi.sign !== CONVEX) {
            tree.nodes.push({neg: KDNODE_UNSET, pos: KDNODE_UNSET, index: pi.index, axis: 0, flag: 0, parent: 0})
        }
    }
}

/**
 * `kdtree2d_balance_recursive` (`:303`): quick-select around the median on alternating axes. The swaps
 * exchange only the `KDTreeNode2D_head` part (`neg`, `pos`, `index`), as Blender's `SWAP` does.
 */
function kdtreeBalance(nodes: KDNode[], base: number, nodeNum: number, axis: number, coords: Float32Array, ofs: number): number {
    if (nodeNum <= 0) return KDNODE_UNSET
    if (nodeNum === 1) return ofs
    const swapHead = (a: number, b: number) => {
        const na = nodes[base + a], nb = nodes[base + b]
        const t0 = na.neg, t1 = na.pos, t2 = na.index
        na.neg = nb.neg
        na.pos = nb.pos
        na.index = nb.index
        nb.neg = t0
        nb.pos = t1
        nb.index = t2
    }
    const co = (k: number) => coords[nodes[base + k].index * 2 + axis]
    let neg = 0
    let pos = nodeNum - 1
    const median = nodeNum >>> 1
    while (pos > neg) {
        const pivot = co(pos)
        let i = neg - 1
        let j = pos
        while (true) {
            while (co(++i) < pivot) { /* pass */ }
            while (co(--j) > pivot && j > neg) { /* pass */ }
            if (i >= j) break
            swapHead(i, j)
        }
        swapHead(i, pos)
        if (i >= median) pos = i - 1
        if (i <= median) neg = i + 1
    }
    const node = nodes[base + median]
    node.axis = axis
    const next = axis ? 0 : 1
    node.neg = kdtreeBalance(nodes, base, median, next, coords, ofs)
    node.pos = kdtreeBalance(nodes, base + median + 1, nodeNum - (median + 1), next, coords, median + 1 + ofs)
    return median + ofs
}

/** `kdtree2d_init_mapping` (`:370`). */
function kdtreeInitMapping(tree: KDTree): void {
    for (let i = 0; i < tree.nodeNum; i++) {
        const node = tree.nodes[i]
        if (node.neg !== KDNODE_UNSET) tree.nodes[node.neg].parent = i
        if (node.pos !== KDNODE_UNSET) tree.nodes[node.pos].parent = i
        tree.nodesMap[node.index] = i
    }
    tree.nodes[tree.root].parent = KDNODE_UNSET
}

/** `kdtree2d_node_remove` (`:390`). */
function kdtreeNodeRemove(tree: KDTree, index: number): void {
    let nodeIndex = tree.nodesMap[index]
    if (nodeIndex === KDNODE_UNSET) return
    tree.nodesMap[index] = KDNODE_UNSET
    let node = tree.nodes[nodeIndex]
    tree.nodeNum -= 1
    node.flag |= KDNODE_FLAG_REMOVED
    while (node.parent !== KDNODE_UNSET) {
        let child: number
        if (node.neg === KDNODE_UNSET) child = node.pos
        else if (node.pos === KDNODE_UNSET) child = node.neg
        else break
        const parent = tree.nodes[node.parent]
        if (parent.neg === nodeIndex) parent.neg = child
        else parent.pos = child
        if (child !== KDNODE_UNSET) tree.nodes[child].parent = node.parent
        if ((parent.flag & KDNODE_FLAG_REMOVED) === 0) break
        nodeIndex = node.parent
        node = parent
    }
}

/** `kdtree2d_isect_tri_recursive` (`:455`). */
function kdtreeIsectTriRecursive(
    tree: KDTree, tri: [number, number, number], isect: TriIsect,
    cx: number, cy: number, bounds: [number, number, number, number], node: KDNode,
): number {
    const c = tree.coords
    const x = c[node.index * 2], y = c[node.index * 2 + 1]
    if ((node.flag & KDNODE_FLAG_REMOVED) === 0) {
        if (triIsectTest(isect, x, y)) {
            if (node.index !== tri[0] && node.index !== tri[1] && node.index !== tri[2]) return node.index
        }
    }
    const coAxis = node.axis ? y : x
    const centerAxis = node.axis ? cy : cx
    const min = bounds[node.axis * 2], max = bounds[node.axis * 2 + 1]
    const recurseNeg = () => node.neg !== KDNODE_UNSET && coAxis >= min
        ? kdtreeIsectTriRecursive(tree, tri, isect, cx, cy, bounds, tree.nodes[node.neg]) : KDNODE_UNSET
    const recursePos = () => node.pos !== KDNODE_UNSET && coAxis <= max
        ? kdtreeIsectTriRecursive(tree, tri, isect, cx, cy, bounds, tree.nodes[node.pos]) : KDNODE_UNSET
    let result: number
    if (centerAxis > coAxis) {
        result = recursePos()
        if (result === KDNODE_UNSET) result = recurseNeg()
    } else {
        result = recurseNeg()
        if (result === KDNODE_UNSET) result = recursePos()
    }
    return result
}

/** `kdtree2d_isect_tri_single` (`:530`). */
function kdtreeIsectTriSingle(tree: KDTree, tri: [number, number, number], test: number): boolean {
    if (tree.nodesMap[test] !== KDNODE_UNSET && test !== tri[0] && test !== tri[1] && test !== tri[2]) {
        const isect = triIsectInit(tree.coords, tri)
        if (triIsectTest(isect, tree.coords[test * 2], tree.coords[test * 2 + 1])) return true
    }
    return false
}

/** `kdtree2d_isect_tri` (`:565`). */
function kdtreeIsectTri(tree: KDTree, tri: [number, number, number]): number {
    const c = tree.coords
    const xs = [c[tri[0] * 2], c[tri[1] * 2], c[tri[2] * 2]]
    const ys = [c[tri[0] * 2 + 1], c[tri[1] * 2 + 1], c[tri[2] * 2 + 1]]
    const bounds: [number, number, number, number] = [
        Math.min(xs[0], xs[1], xs[2]), Math.max(xs[0], xs[1], xs[2]),
        Math.min(ys[0], ys[1], ys[2]), Math.max(ys[0], ys[1], ys[2]),
    ]
    const third = f(1 / 3)
    const cx = f(f(f(xs[0] + xs[1]) + xs[2]) * third)
    const cy = f(f(f(ys[0] + ys[1]) + ys[2]) * third)
    const isect = triIsectInit(c, tri)
    return kdtreeIsectTriRecursive(tree, tri, isect, cx, cy, bounds, tree.nodes[tree.root])
}

/** `pf_coord_remove` (`:618`). */
function pfCoordRemove(pf: PolyFill, pi: PolyIndex): void {
    if (pf.kdtree.nodeNum) kdtreeNodeRemove(pf.kdtree, pi.index)
    pi.next.prev = pi.prev
    pi.prev.next = pi.next
    if (pf.indices === pi) pf.indices = pi.next
    pf.coordsNum -= 1
}

/** `pf_coord_sign_calc` (`:752`). */
function pfCoordSignCalc(pf: PolyFill, pi: PolyIndex): void {
    pi.sign = spanTriV2Sign(pf.coords, pi.prev.index, pi.index, pi.next.index)
}

/** `pf_ear_tip_check` (`:839`), the `USE_KDTREE` + `USE_KDTREE_INDEX_CACHE` branch. */
function pfEarTipCheck(pf: PolyFill, tip: PolyIndex, signAccept: number): boolean {
    if (pf.coordsNumConcave === 0) return true
    if (tip.sign !== signAccept) return false
    const ind: [number, number, number] = [tip.index, tip.next.index, tip.prev.index]
    const cached = tip.indexLastHit
    if (cached !== KDTREE_INDEX_CACHE_UNSET) {
        if ((tip.flag & INDEX_CACHE_DIRTY) === 0) {
            if (pf.kdtree.nodesMap[cached] !== KDNODE_UNSET) return false
        } else if (kdtreeIsectTriSingle(pf.kdtree, ind, cached)) {
            tip.flag &= ~INDEX_CACHE_DIRTY
            return false
        }
    }
    const hit = kdtreeIsectTri(pf.kdtree, ind)
    if (hit !== KDNODE_UNSET) {
        tip.indexLastHit = hit
        tip.flag &= ~INDEX_CACHE_DIRTY
        return false
    }
    return true
}

/** `pf_ear_tip_find` (`:761`) with `USE_CLIP_EVEN` and `USE_CLIP_SWEEP`. */
function pfEarTipFind(pf: PolyFill, earInit: PolyIndex, reverse: boolean): PolyIndex {
    const coordsNum = pf.coordsNum
    let ear: PolyIndex
    for (let signAccept = CONVEX; signAccept >= TANGENTIAL; signAccept--) {
        ear = earInit
        let i = coordsNum
        while (i--) {
            if (pfEarTipCheck(pf, ear, signAccept)) return ear
            ear = reverse ? ear.prev : ear.next
        }
    }
    // Desperate mode: a convex or tangential vertex if one exists, else the last one visited.
    ear = earInit
    let i = coordsNum
    while (i--) {
        if (ear.sign !== CONCAVE) return ear
        ear = ear.next
    }
    return ear
}

/** `pf_ear_tip_cut` (`:938`). */
function pfEarTipCut(pf: PolyFill, tip: PolyIndex): void {
    const t = pf.trisNum++ * 3
    pf.tris[t] = tip.prev.index
    pf.tris[t + 1] = tip.index
    pf.tris[t + 2] = tip.next.index
    pfCoordRemove(pf, tip)
}

/** `pf_triangulate` (`:642`). */
function pfTriangulate(pf: PolyFill): void {
    let earInit = pf.indices
    let reverse = false
    while (pf.coordsNum > 3) {
        const ear = pfEarTipFind(pf, earInit, reverse)
        if (ear.sign !== CONVEX) pf.coordsNumConcave -= 1
        const prev = ear.prev
        const next = ear.next
        pfEarTipCut(pf, ear)
        prev.flag |= INDEX_CACHE_DIRTY
        next.flag |= INDEX_CACHE_DIRTY
        const signPrev = prev.sign
        const signNext = next.sign
        if (signPrev !== CONVEX) {
            pfCoordSignCalc(pf, prev)
            if (prev.sign === CONVEX) {
                pf.coordsNumConcave -= 1
                kdtreeNodeRemove(pf.kdtree, prev.index)
            }
        }
        if (signNext !== CONVEX) {
            pfCoordSignCalc(pf, next)
            if (next.sign === CONVEX) {
                pf.coordsNumConcave -= 1
                kdtreeNodeRemove(pf.kdtree, next.index)
            }
        }
        earInit = reverse ? prev.prev : next.next
        if (earInit.sign !== CONVEX) {
            earInit = reverse ? earInit.prev : earInit.next
            reverse = !reverse
        }
    }
    if (pf.coordsNum === 3) {
        const t = pf.trisNum++ * 3
        let ear = pf.indices
        pf.tris[t] = ear.index
        ear = ear.next
        pf.tris[t + 1] = ear.index
        ear = ear.next
        pf.tris[t + 2] = ear.index
    }
}

/** `cross_poly_v2` (`blenlib/intern/math_geom.cc:153`): twice the signed area, trapezium rule. */
export function crossPolyV2(coords: ArrayLike<number>, n: number): number {
    let cross = 0
    let px = coords[(n - 1) * 2], py = coords[(n - 1) * 2 + 1]
    for (let a = 0; a < n; a++) {
        const x = coords[a * 2], y = coords[a * 2 + 1]
        cross = f(cross + f(f(px - x) * f(y + py)))
        px = x
        py = y
    }
    return cross
}

/**
 * `BLI_polyfill_calc(coords, coords_num, coords_sign, r_tris)` (`polyfill_2d.cc:1124`).
 *
 * @param coords flat `[x0, y0, x1, y1, ...]`, read as float32.
 * @param coordsSign 1 for clockwise, -1 for counter-clockwise, 0 to detect it.
 * @returns `(n - 2) * 3` local vertex indices.
 */
export function polyfillCalc(coords: ArrayLike<number>, coordsNum: number, coordsSign = 0): Uint32Array {
    const c = coords instanceof Float32Array ? coords : Float32Array.from(coords as ArrayLike<number>)
    const tris = new Uint32Array(Math.max(0, coordsNum - 2) * 3)
    if (coordsNum < 3) return tris

    // `polyfill_prepare` (`:956`).
    if (coordsSign === 0) coordsSign = crossPolyV2(c, coordsNum) <= 0 ? 1 : -1
    const list: PolyIndex[] = new Array(coordsNum)
    for (let i = 0; i < coordsNum; i++) {
        list[i] = {
            next: null as unknown as PolyIndex, prev: null as unknown as PolyIndex,
            index: coordsSign === 1 ? i : coordsNum - 1 - i,
            sign: 0, flag: 0, indexLastHit: KDTREE_INDEX_CACHE_UNSET,
        }
    }
    for (let i = 0; i < coordsNum; i++) {
        list[i].next = list[(i + 1) % coordsNum]
        list[i].prev = list[(i - 1 + coordsNum) % coordsNum]
    }
    const pf: PolyFill = {
        indices: list[0], coords: c, coordsNum, coordsNumConcave: 0, tris, trisNum: 0,
        kdtree: {nodes: [], coords: c, root: KDNODE_UNSET, nodeNum: 0, nodesMap: new Uint32Array(coordsNum).fill(KDNODE_UNSET)},
    }
    for (let i = 0; i < coordsNum; i++) {
        pfCoordSignCalc(pf, list[i])
        if (list[i].sign !== CONVEX) pf.coordsNumConcave += 1
    }

    // `polyfill_calc` (`:1035`).
    if (pf.coordsNumConcave) {
        const tree = pf.kdtree
        tree.nodeNum = pf.coordsNumConcave
        kdtreeInit(tree, coordsNum, pf.indices)
        tree.root = kdtreeBalance(tree.nodes, 0, tree.nodeNum, 0, c, 0)
        kdtreeInitMapping(tree)
    }
    pfTriangulate(pf)
    return tris
}
