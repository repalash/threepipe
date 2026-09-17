/**
 * The array generator: repeat a piece of geometry along an offset, a length, or a curve.
 *
 * Ported from `source/blender/modifiers/intern/MOD_array.cc` (`arrayModifier_doArray`,
 * `dm_mvert_map_doubles`, `svert_from_mvert`, `mesh_merge_transform`), with the curve placement in
 * {@link arrayCurve} ported from `blenkernel/intern/curve_deform.cc` (`calc_curve_deform`,
 * `curve_deform_coords_impl`), `blenkernel/intern/anim_path.cc` (`BKE_anim_path_calc_data`,
 * `BKE_where_on_path`) and `blenkernel/intern/curve.cc` (`BKE_curve_bevelList_make`'s `CU_POLY`
 * branch and `make_bevel_list_3D_minimum_twist`).
 *
 * Three things about the modifier are easy to get wrong and are what this file is really about:
 *
 * 1. **The offset is a sum.** Constant, relative and object offset are not alternatives; Blender adds
 *    all the enabled ones into one matrix before anything else happens. The relative part is a
 *    fraction of the *input's* bounding box per axis, so it scales with the object.
 * 2. **The offset accumulates per copy.** `current_offset = current_offset * offset` once per copy,
 *    so copy `n` sits at `offset^n`. That is what turns a rotation offset into a radial array and
 *    what makes a scaled offset produce a spiral rather than a ruler.
 * 3. **The merge is a real weld**, not a cosmetic snap. Blender maps each copy's vertices onto the
 *    previous copy's within `merge_dist` (`dm_mvert_map_doubles`), resolves the chains that produces,
 *    and then runs a weld. Without it a chain of 88 track shoes is 88 loose boxes.
 *
 * Blender's array works on `Mesh` (index arrays), so its bookkeeping is all integer indices. The port
 * keeps that: the merge stage builds the same `full_doubles_map` over a flat index space laid out as
 * `[copy 0][copy 1]...[copy n-1][start cap][end cap]`, exactly as `result_nverts` is laid out, and
 * only translates to {@link BMVert} handles at the very end when handing the map to {@link weldVerts}.
 * Keeping the index space means `dm_mvert_map_doubles` and the chain resolution are line-for-line.
 *
 * A note on the overlap with `src/generate/sweep.ts`, which also computes rotation-minimising frames
 * along a polyline: the two are ports of *different* Blender subsystems and are not interchangeable.
 * `sweep.ts` follows the current curves system (`geometry/intern/curve_to_mesh.cc`,
 * `calculate_normals_minimum`), which works in tangents and normals. `calc_curve_deform` reads frames
 * off `BevPoint.quat`, produced by the legacy `BevList` code in `curve.cc`, and the two differ in
 * where the initial frame comes from and in how the cyclic twist residual is redistributed. Porting
 * the curve deform means porting the bevel list it reads, so the frame code below is deliberately its
 * own thing rather than a second copy of sweep's.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges, radialLoops} from '../bmesh/structure'
import {duplicateGeometry} from '../ops/duplicate'
import {weldVerts} from '../ops/weld'
import {getComponent, setComponent} from '../bmesh/customdata'
import {
    Mat4,
    Vec3,
    mat4Identity,
    mat4Invert,
    mat4Multiply,
    mat4RotationAxis,
    mat4ToSize,
    mat4TransformPoint,
    mat4Translation,
    v3cross,
    v3dot,
    v3len,
    v3mul,
    v3normalize,
    v3sub,
} from '../math'

/** How the number of copies is decided. Blender's `MOD_ARR_FIXEDCOUNT/FITLENGTH/FITCURVE`. */
export type ArrayFitType = 'fixedCount' | 'fitLength' | 'fitCurve'

/** Geometry handed to a generator. Faces pull in their edges and vertices automatically. */
export interface ArrayInput {
    verts?: Iterable<BMVert>
    edges?: Iterable<BMEdge>
    faces?: Iterable<BMFace>
}

export interface ArrayOptions {
    /** Default `fixedCount`, as in Blender. */
    fitType?: ArrayFitType
    /** Copies to make, including the original. Blender's `count`, default 2. */
    count?: number
    /** Distance to fill for `fitLength`. Blender's `length`. */
    length?: number
    /**
     * The path for `fitCurve`, as a polyline. Only its *length* is used here - the fit measures
     * `BKE_anim_path_get_length`, which is the accumulated length of the evaluated display list, and
     * divides it by the offset's translation. Orienting the copies to the path is a separate
     * modifier; see {@link arrayCurve}.
     */
    curve?: Vec3[]
    /** Whether {@link curve} closes back on itself, which adds the closing segment to its length. */
    curveClosed?: boolean

    /** Blender's `MOD_ARR_OFF_CONST`. */
    useConstantOffset?: boolean
    /** A fixed displacement per copy. Blender's `offset`, default `(1, 0, 0)`. */
    constantOffset?: Vec3
    /** Blender's `MOD_ARR_OFF_RELATIVE`, on by default exactly as the modifier is. */
    useRelativeOffset?: boolean
    /** A displacement in units of the input's bounding box per axis. Blender's `scale`, default `(1, 0, 0)`. */
    relativeOffset?: Vec3
    /** Blender's `MOD_ARR_OFF_OBJ`. */
    useObjectOffset?: boolean
    /**
     * An arbitrary per-copy transform, in the arrayed geometry's own space. Blender composes
     * `offset * inverse(object) * offset_ob` from two object matrices; with the arrayed object at the
     * origin that reduces to `offset * objectOffset`, which is what this takes.
     */
    objectOffset?: Mat4

    /** Weld each copy's vertices to the previous copy's. Blender's `MOD_ARR_MERGE`, default off. */
    useMerge?: boolean
    /** Also weld the last copy to the first, closing a ring. Blender's `MOD_ARR_MERGEFINAL`. */
    useMergeFirstLast?: boolean
    /** Blender's `merge_dist`, default 0.01. */
    mergeThreshold?: number

    /**
     * Geometry placed one step *before* the first copy, at `inverse(offset)`. Blender's `start_cap`
     * object. It is duplicated into place; the geometry given here stays where it is.
     */
    startCap?: ArrayInput
    /** Geometry placed one step *after* the last copy, at `final_offset * offset`. Blender's `end_cap`. */
    endCap?: ArrayInput

    /**
     * Shift every `float2` corner layer by this much per copy, so a texture can run along the array.
     * Blender's `uv_offset`.
     */
    uvOffset?: [number, number]
}

/** One copy's correspondence back to the input. Copy 0 maps every element to itself. */
export interface ArrayCopy {
    vertMap: Map<BMVert, BMVert>
    edgeMap: Map<BMEdge, BMEdge>
    faceMap: Map<BMFace, BMFace>
}

export interface ArrayResult {
    /** Every vertex of the array that survived the merge, the original chunk included. */
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
    /** Copies actually made after the fit was applied, always at least 1. Blender's `count`. */
    count: number
    /** `offset^(count-1)`, the transform of the last copy. Blender's `final_offset`. */
    finalOffset: Mat4
    /** The single-step offset the fit was computed from. */
    offset: Mat4
    /**
     * Per-copy element correspondence, in copy order; copy 0 maps the input to itself. These are the
     * maps as the copies were made, so after a merge some of them point at elements the weld
     * removed - check `bm.verts.has(...)` before using one on a merged array.
     */
    copies: ArrayCopy[]
    /** Vertices removed by the merge. Empty when `useMerge` is off or nothing was within range. */
    merged: BMVert[]
    /** Set when Blender would have raised a modifier error and fallen back to a single copy. */
    warning?: string
}

/** `FLT_EPSILON`, so the epsilon comparisons ported below keep their single-precision meaning. */
const FLT_EPSILON = 1.1920929e-7

/** Blender's `max_verts_num`: "About 67 million vertices max seems a decent limit for now." */
const MAX_VERTS_NUM = 1 << 26

// region chunk gathering

interface Chunk {
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
}

/**
 * Resolve an input selection into the closed set of elements a copy needs, in a stable order.
 *
 * The same closure {@link duplicateGeometry} applies - a listed face brings its edges and vertices
 * whether or not the caller listed them - so that the two agree element for element and the index
 * space below lines up with what the duplicate actually produced.
 */
function gatherChunk(input: ArrayInput | undefined): Chunk {
    const faces = new Set(input?.faces ?? [])
    const edges = new Set(input?.edges ?? [])
    const verts = new Set(input?.verts ?? [])

    for (const f of faces) {
        for (const l of f.eachLoop()) {
            verts.add(l.v)
            if (l.e) edges.add(l.e)
        }
    }
    for (const e of edges) {
        verts.add(e.v1)
        verts.add(e.v2)
    }

    return {verts: [...verts], edges: [...edges], faces: [...faces]}
}

/** The identity "copy 0": every element of the chunk maps to itself. */
function identityCopy(chunk: Chunk): ArrayCopy {
    return {
        vertMap: new Map(chunk.verts.map(v => [v, v])),
        edgeMap: new Map(chunk.edges.map(e => [e, e])),
        faceMap: new Map(chunk.faces.map(f => [f, f])),
    }
}

// endregion

// region doubles mapping - dm_mvert_map_doubles

/** `SortVertsElem`: an index, its coordinates and their sum, which is what the sort orders on. */
interface SortVertsElem {
    vertexNum: number
    co: Vec3
    sumCo: number
}

const sumV3 = (v: Vec3): number => v[0] + v[1] + v[2]

const lenSquaredV3V3 = (a: Vec3, b: Vec3): number => {
    const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]
    return x * x + y * y + z * z
}

/** Blender's `compare_len_v3v3`: within `limit` of each other. */
const compareLenV3V3 = (a: Vec3, b: Vec3, limit: number): boolean =>
    lenSquaredV3V3(a, b) <= limit * limit

/** `svert_from_mvert`: fill the sort array for one index range. */
function svertFromVert(positions: readonly Vec3[], iBegin: number, iEnd: number): SortVertsElem[] {
    const out: SortVertsElem[] = new Array(iEnd - iBegin)
    for (let i = iBegin; i < iEnd; i++) {
        out[i - iBegin] = {vertexNum: i, co: positions[i], sumCo: sumV3(positions[i])}
    }
    return out
}

/**
 * Map every vertex of the source range onto a vertex of the target range within `dist`, or -1.
 *
 * Port of `dm_mvert_map_doubles` (`MOD_array.cc:149`). Both ranges are sorted by the *sum* of their
 * coordinates, which bounds the real distance: two points within `dist` of each other cannot have
 * coordinate sums more than `sqrt(3) * dist` apart. That turns the quadratic all-pairs test into a
 * sliding window, and the low bound only ever moves forwards because the sources are sorted too.
 *
 * `doublesMap` is read as well as written: an entry that is already mapped is left alone (a vertex
 * cannot be a double twice), and a target that is itself mapped is followed to the end of its chain,
 * but only while the final target stays within `dist` of the source.
 */
function dmVertMapDoubles(
    doublesMap: Int32Array,
    positions: readonly Vec3[],
    targetStart: number,
    targetVertsNum: number,
    sourceStart: number,
    sourceVertsNum: number,
    dist: number,
): void {
    /* Just above `sqrt(3)`. */
    const dist3 = (1.7320508075688772 + 0.00005) * dist

    const sortedTarget = svertFromVert(positions, targetStart, targetStart + targetVertsNum)
    const sortedSource = svertFromVert(positions, sourceStart, sourceStart + sourceVertsNum)
    const bySum = (a: SortVertsElem, b: SortVertsElem) => a.sumCo - b.sumCo
    sortedTarget.sort(bySum)
    sortedSource.sort(bySum)

    let iTargetLowBound = 0
    let targetScanCompleted = false

    for (let iSource = 0; iSource < sourceVertsNum; iSource++) {
        const sveSource = sortedSource[iSource]
        let bestTargetVertex = -1
        let bestDistSq = dist * dist

        // Already assigned by an earlier call with other chunks.
        if (doublesMap[sveSource.vertexNum] !== -1) continue

        // Once the target list is exhausted nothing later can have a double either.
        if (targetScanCompleted) {
            doublesMap[sveSource.vertexNum] = -1
            continue
        }

        const sveSourceSumco = sumV3(sveSource.co)

        // Advance the shared low bound past every target too far below in terms of sumco.
        while (iTargetLowBound < targetVertsNum
            && sortedTarget[iTargetLowBound].sumCo < sveSourceSumco - dist3) {
            iTargetLowBound++
        }
        if (iTargetLowBound >= targetVertsNum) {
            doublesMap[sveSource.vertexNum] = -1
            targetScanCompleted = true
            continue
        }

        // Scan the [sumco - dist3, sumco + dist3] window and test real distances in it.
        let iTarget = iTargetLowBound
        while (iTarget < targetVertsNum && sortedTarget[iTarget].sumCo <= sveSourceSumco + dist3) {
            const distSq = lenSquaredV3V3(sveSource.co, sortedTarget[iTarget].co)
            if (distSq <= bestDistSq) {
                bestDistSq = distSq
                bestTargetVertex = sortedTarget[iTarget].vertexNum

                // Follow an already-mapped target only while its end of the chain stays close
                // enough; otherwise this source gets no mapping at all from this candidate.
                while (bestTargetVertex !== -1
                    && doublesMap[bestTargetVertex] !== -1
                    && doublesMap[bestTargetVertex] !== bestTargetVertex) {
                    if (compareLenV3V3(
                        positions[sveSource.vertexNum],
                        positions[doublesMap[bestTargetVertex]],
                        dist)) {
                        bestTargetVertex = doublesMap[bestTargetVertex]
                    } else {
                        bestTargetVertex = -1
                    }
                }
            }
            iTarget++
        }

        doublesMap[sveSource.vertexNum] = bestTargetVertex
    }
}

// endregion

/**
 * Repeat `input` along an accumulating offset. Blender's array modifier.
 *
 * The result includes the original geometry as copy 0, which is what the modifier produces: the
 * "count" is the total number of copies, not the number of extra ones.
 */
export function arrayGeometry(bm: BMesh, input: ArrayInput, opts: ArrayOptions = {}): ArrayResult {
    const chunk = gatherChunk(input)
    const chunkNverts = chunk.verts.length

    const useMerge = opts.useMerge === true
    const mergeDist = opts.mergeThreshold ?? 0.01

    const startCapChunk = opts.startCap ? gatherChunk(opts.startCap) : null
    const endCapChunk = opts.endCap ? gatherChunk(opts.endCap) : null
    const startCapNverts = startCapChunk?.verts.length ?? 0
    const endCapNverts = endCapChunk?.verts.length ?? 0

    // --- Build up the offset matrix, accumulating all settings options. ---

    const offset = mat4Identity()

    if (opts.useConstantOffset) {
        const c = opts.constantOffset ?? [1, 0, 0]
        offset[12] += c[0]
        offset[13] += c[1]
        offset[14] += c[2]
    }

    if (opts.useRelativeOffset) {
        const s = opts.relativeOffset ?? [1, 0, 0]
        const bounds = chunkBounds(chunk.verts)
        if (bounds) {
            for (let j = 0; j < 3; j++) offset[12 + j] += s[j] * (bounds.max[j] - bounds.min[j])
        }
    }

    // `mul_m4_series(result_mat, offset, obinv, offset_ob->object_to_world())`, with the arrayed
    // object at the origin so `obinv` is the identity.
    const offsetMat: Mat4 = opts.useObjectOffset && opts.objectOffset
        ? mat4Multiply(offset, opts.objectOffset)
        : offset

    // A scaling offset makes each gap a different size, which the merge shortcut below cannot assume
    // away. Blender's `mat4_to_size` + `is_one_v3`.
    const scale = mat4ToSize(offsetMat)
    const offsetHasScale = !(scale[0] === 1 && scale[1] === 1 && scale[2] === 1)

    // --- Decide how many copies. ---

    const fitType: ArrayFitType = opts.fitType ?? 'fixedCount'
    let length = opts.length ?? 0
    if (fitType === 'fitCurve' && opts.curve && opts.curve.length) {
        // `BKE_anim_path_get_length` is the last entry of the accumulated segment lengths.
        length = polylineLength(opts.curve, opts.curveClosed === true)
    }

    let count = opts.count ?? 2
    let warning: string | undefined

    if (fitType === 'fitLength' || fitType === 'fitCurve') {
        const floatEpsilon = 1e-6
        let offsetIsTooSmall = false
        const dist = v3len([offsetMat[12], offsetMat[13], offsetMat[14]])

        if (dist > floatEpsilon) {
            // "this gives length = first copy start to last copy end, add a tiny offset for
            // floating point rounding errors"
            count = Math.trunc((length + floatEpsilon) / dist) + 1

            if (count * chunkNverts + startCapNverts + endCapNverts > MAX_VERTS_NUM) {
                count = 1
                offsetIsTooSmall = true
            }
        } else {
            // "if the offset has no translation, just make one copy"
            count = 1
            offsetIsTooSmall = true
        }

        if (offsetIsTooSmall) {
            warning = 'The offset is too small, we cannot generate the amount of geometry it would require'
        }
    } else if (count * chunkNverts + startCapNverts + endCapNverts > MAX_VERTS_NUM) {
        count = 1
        warning = 'The amount of copies is too high, we cannot generate the amount of geometry it would require'
    }

    count = Math.max(count, 1)

    // --- The flat index space: [copy 0][copy 1]...[copy n-1][start cap][end cap]. ---

    const resultNverts = chunkNverts * count + startCapNverts + endCapNverts
    const positions: Vec3[] = new Array(resultNverts)
    const allVerts: (BMVert | null)[] = new Array(resultNverts).fill(null)

    const fullDoublesMap = useMerge ? new Int32Array(resultNverts).fill(-1) : null

    for (let i = 0; i < chunkNverts; i++) {
        const v = chunk.verts[i]
        positions[i] = [v.x, v.y, v.z]
        allVerts[i] = v
    }

    const copies: ArrayCopy[] = [identityCopy(chunk)]

    // Remember the first chunk, in case of cap merge.
    const firstChunkStart = 0
    const firstChunkNverts = chunkNverts

    let currentOffset = mat4Identity()

    for (let c = 1; c < count; c++) {
        // Recalculate the cumulative offset here: copy `c` sits at `offset^c`.
        currentOffset = mat4Multiply(currentOffset, offsetMat)

        const dup = duplicateGeometry(bm, {
            verts: chunk.verts, edges: chunk.edges, faces: chunk.faces,
        }, false)
        copies.push({vertMap: dup.vertMap, edgeMap: dup.edgeMap, faceMap: dup.faceMap})

        const vertOffset = c * chunkNverts
        for (let i = 0; i < chunkNverts; i++) {
            const src = chunk.verts[i]
            const nv = dup.vertMap.get(src)!
            // The duplicate sits on the original, so the offset applies to the original position.
            const p = mat4TransformPoint(currentOffset, [src.x, src.y, src.z])
            nv.setCo(p[0], p[1], p[2])
            positions[vertOffset + i] = p
            allVerts[vertOffset + i] = nv
        }

        // Handle merge between chunk n and n-1.
        if (fullDoublesMap && c >= 1) {
            if (!offsetHasScale && c >= 2) {
                // "Mapping chunk 3 to chunk 2 is a translation of mapping 2 to 1 ... that is except
                // if scaling makes the distance grow."
                let thisChunkIndex = c * chunkNverts
                let prevChunkIndex = (c - 1) * chunkNverts
                for (let k = 0; k < chunkNverts; k++, thisChunkIndex++, prevChunkIndex++) {
                    let target = fullDoublesMap[prevChunkIndex]
                    if (target !== -1) {
                        target += chunkNverts // translate mapping
                        while (target !== -1
                            && fullDoublesMap[target] !== -1
                            && fullDoublesMap[target] !== target) {
                            if (compareLenV3V3(
                                positions[thisChunkIndex],
                                positions[fullDoublesMap[target]],
                                mergeDist)) {
                                target = fullDoublesMap[target]
                            } else {
                                target = -1
                            }
                        }
                    }
                    fullDoublesMap[thisChunkIndex] = target
                }
            } else {
                dmVertMapDoubles(
                    fullDoublesMap, positions,
                    (c - 1) * chunkNverts, chunkNverts,
                    c * chunkNverts, chunkNverts,
                    mergeDist)
            }
        }
    }

    // --- UVs. Blender shifts every UV map of copy `c` by `c * uv_offset`. ---
    if (opts.uvOffset && (opts.uvOffset[0] !== 0 || opts.uvOffset[1] !== 0)) {
        applyUvOffset(bm, chunk, copies, opts.uvOffset)
    }

    const lastChunkStart = (count - 1) * chunkNverts
    const lastChunkNverts = chunkNverts
    const finalOffset = currentOffset

    if (fullDoublesMap && opts.useMergeFirstLast && count > 1) {
        // Merge first and last copies. Note the direction: the *first* copy's vertices are the
        // sources, so the survivors are the ones on the last copy.
        dmVertMapDoubles(
            fullDoublesMap, positions,
            lastChunkStart, lastChunkNverts,
            firstChunkStart, firstChunkNverts,
            mergeDist)
    }

    // --- Capping. ---

    if (startCapChunk) {
        const startCapStart = resultNverts - startCapNverts - endCapNverts
        const startOffset = mat4Invert(offsetMat)
        placeCap(bm, startCapChunk, startOffset, positions, allVerts, startCapStart)

        // Identify doubles with the first chunk.
        if (fullDoublesMap) {
            dmVertMapDoubles(
                fullDoublesMap, positions,
                firstChunkStart, firstChunkNverts,
                startCapStart, startCapNverts,
                mergeDist)
        }
    }

    if (endCapChunk) {
        const endCapStart = resultNverts - endCapNverts
        const endOffset = mat4Multiply(currentOffset, offsetMat)
        placeCap(bm, endCapChunk, endOffset, positions, allVerts, endCapStart)

        // Identify doubles with the last chunk.
        if (fullDoublesMap) {
            dmVertMapDoubles(
                fullDoublesMap, positions,
                lastChunkStart, lastChunkNverts,
                endCapStart, endCapNverts,
                mergeDist)
        }
    }

    // --- Handle merging. ---

    const merged: BMVert[] = []
    if (fullDoublesMap) {
        let totDoubles = 0
        for (let i = 0; i < resultNverts; i++) {
            let newI = fullDoublesMap[i]
            if (newI !== -1) {
                // Follow chains of doubles; merging start/end especially is likely to create some,
                // and the weld does not support them.
                while (fullDoublesMap[newI] !== -1 && fullDoublesMap[newI] !== newI) {
                    newI = fullDoublesMap[newI]
                }
                if (i === newI) {
                    fullDoublesMap[i] = -1
                } else {
                    fullDoublesMap[i] = newI
                    totDoubles++
                }
            }
        }

        if (totDoubles > 0) {
            const targetmap = new Map<BMVert, BMVert>()
            for (let i = 0; i < resultNverts; i++) {
                const t = fullDoublesMap[i]
                if (t === -1) continue
                const src = allVerts[i]
                const dst = allVerts[t]
                if (src && dst && src !== dst) targetmap.set(src, dst)
            }
            const weld = weldVerts(bm, targetmap)
            merged.push(...weld.killedVerts)
        }
    }

    // --- Collect what survived. ---
    //
    // The per-copy maps cannot be the whole answer: the weld replaces some edges and faces with
    // rebuilt ones that belong to no copy. What the array *is* is the set of surviving vertices plus
    // everything spanned entirely by them, so that is what gets collected, walking out from the
    // vertices rather than over the whole mesh.

    const verts: BMVert[] = []
    for (const v of allVerts) if (v && bm.verts.has(v)) verts.push(v)
    const vertSet = new Set(verts)

    const edges: BMEdge[] = []
    const seenE = new Set<BMEdge>()
    for (const v of verts) {
        for (const e of diskEdges(v)) {
            if (seenE.has(e)) continue
            seenE.add(e)
            if (vertSet.has(e.v1) && vertSet.has(e.v2)) edges.push(e)
        }
    }

    const faces: BMFace[] = []
    const seenF = new Set<BMFace>()
    for (const e of edges) {
        for (const l of radialLoops(e)) {
            const f = l.f
            if (seenF.has(f)) continue
            seenF.add(f)
            let all = true
            for (const fl of f.eachLoop()) {
                if (!vertSet.has(fl.v)) {
                    all = false
                    break
                }
            }
            if (all) faces.push(f)
        }
    }

    return {verts, edges, faces, count, finalOffset, offset: offsetMat, copies, merged, warning}
}

/** `Mesh::bounds_min_max` over a vertex list. Null when there are no vertices, as Blender's is. */
function chunkBounds(verts: readonly BMVert[]): {min: Vec3, max: Vec3} | null {
    if (!verts.length) return null
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (const v of verts) {
        if (v.x < min[0]) min[0] = v.x
        if (v.y < min[1]) min[1] = v.y
        if (v.z < min[2]) min[2] = v.z
        if (v.x > max[0]) max[0] = v.x
        if (v.y > max[1]) max[1] = v.y
        if (v.z > max[2]) max[2] = v.z
    }
    return {min, max}
}

/**
 * Copy a cap into the result and transform it.
 *
 * Port of `mesh_merge_transform` reduced to what BMesh needs: the index fix-ups that function spends
 * most of its lines on (`cap_verts_index`, `cap_edges_index`, loop-start rebasing) exist only because
 * a `Mesh` addresses everything by index. Linked topology has no equivalent, so what is left is the
 * duplicate, the transform and the flat index bookkeeping for the merge.
 */
function placeCap(
    bm: BMesh,
    cap: Chunk,
    capOffset: Mat4,
    positions: Vec3[],
    allVerts: (BMVert | null)[],
    capVertsIndex: number,
): ArrayCopy {
    const dup = duplicateGeometry(bm, {verts: cap.verts, edges: cap.edges, faces: cap.faces}, false)
    for (let i = 0; i < cap.verts.length; i++) {
        const src = cap.verts[i]
        const nv = dup.vertMap.get(src)!
        const p = mat4TransformPoint(capOffset, [src.x, src.y, src.z])
        nv.setCo(p[0], p[1], p[2])
        positions[capVertsIndex + i] = p
        allVerts[capVertsIndex + i] = nv
    }
    return {vertMap: dup.vertMap, edgeMap: dup.edgeMap, faceMap: dup.faceMap}
}

/**
 * Shift every UV map of copy `c` by `c * uvOffset`.
 *
 * Port of the "handle UVs" block (`MOD_array.cc:692`). Blender takes every `float2` corner attribute
 * named as a UV map; the kernel has no UV-map registry, so every `float2` corner layer is treated as
 * one, which is the same set in practice.
 */
function applyUvOffset(
    bm: BMesh, chunk: Chunk, copies: readonly ArrayCopy[], uvOffset: readonly [number, number],
): void {
    const layers = bm.ldata.layers.filter(l => l.type === 'float2')
    if (!layers.length) return

    for (let c = 1; c < copies.length; c++) {
        const du = uvOffset[0] * c
        const dv = uvOffset[1] * c
        for (const f of chunk.faces) {
            const nf = copies[c].faceMap.get(f)
            if (!nf) continue
            for (const l of nf.eachLoop()) {
                for (const layer of layers) {
                    setComponent(l, bm.ldata, layer, 0, getComponent(l, layer, 0) + du)
                    setComponent(l, bm.ldata, layer, 1, getComponent(l, layer, 1) + dv)
                }
            }
        }
    }
}

// region convenience wrappers

/**
 * Blender's constant-offset array: `count` copies, each `step` further along than the last.
 *
 * This is the `array` command of the agent modelling API. It is the general
 * {@link arrayGeometry} with only `MOD_ARR_OFF_CONST` enabled.
 */
export function arrayLinear(
    bm: BMesh,
    input: ArrayInput,
    opts: {count: number, step: Vec3, merge?: boolean, mergeThreshold?: number},
): ArrayResult {
    return arrayGeometry(bm, input, {
        fitType: 'fixedCount',
        count: opts.count,
        useConstantOffset: true,
        constantOffset: opts.step,
        useMerge: opts.merge,
        mergeThreshold: opts.mergeThreshold,
    })
}

/**
 * A radial array: `count` copies spread over `angle` about the line `(pivot, axis)`.
 *
 * This is an object-offset array whose per-copy matrix is a rotation of `angle / count` about the
 * pivot. Because the array accumulates the offset, copy `n` lands at `n * angle / count` - so a full
 * turn brings copy `count` back onto copy 0, which is why merge also welds first to last here.
 *
 * `axis` defaults to `+Y`, the kernel's up axis.
 */
export function arrayRadial(
    bm: BMesh,
    input: ArrayInput,
    opts: {count: number, angle?: number, axis?: Vec3, pivot?: Vec3, merge?: boolean, mergeThreshold?: number},
): ArrayResult {
    const angle = opts.angle ?? Math.PI * 2
    const axis = opts.axis ?? [0, 1, 0]
    const pivot = opts.pivot ?? [0, 0, 0]
    const step = angle / Math.max(opts.count, 1)

    // Rotate about the pivot: translate it to the origin, rotate, translate back.
    const objectOffset = mat4Multiply(
        mat4Multiply(mat4Translation(pivot), mat4RotationAxis(axis, step)),
        mat4Translation(v3mul(pivot, -1)))

    return arrayGeometry(bm, input, {
        fitType: 'fixedCount',
        count: opts.count,
        useObjectOffset: true,
        objectOffset,
        useMerge: opts.merge,
        // A closed ring needs the seam welded too; when the copies do not meet, the threshold test
        // in `dm_mvert_map_doubles` finds nothing and this costs nothing.
        useMergeFirstLast: opts.merge,
        mergeThreshold: opts.mergeThreshold,
    })
}

/**
 * Lay copies along a path, each oriented to the local tangent.
 *
 * This is Blender's Array + Curve modifier pair, which is how the effect is actually built: the array
 * lays the copies end to end along `axis` with a relative offset of one object width (so the copies
 * touch), using `MOD_ARR_FITCURVE` to take the count from the path's length; the curve modifier then
 * bends the whole chain onto the path. The orientation of each copy is not a placement rule invented
 * here - it falls out of `calc_curve_deform`, which rotates each point by the path frame at its
 * parameter and offsets it by the point's distance from the path axis.
 *
 * `useDeformBounds` mirrors the curve's `CU_DEFORM_BOUNDS_OFF` flag, which Blender clears by default:
 * with bounds off (the default here too) a point's parameter along the path is its raw coordinate
 * divided by the path length, so geometry starting at the origin starts at the path's start.
 */
export function arrayCurve(
    bm: BMesh,
    input: ArrayInput,
    opts: {
        path: Vec3[],
        count?: number,
        closed?: boolean,
        axis?: 'x' | 'y' | 'z',
        useDeformBounds?: boolean,
    },
): ArrayResult {
    const axisIndex = opts.axis === 'y' ? 1 : opts.axis === 'z' ? 2 : 0
    const relativeOffset: Vec3 = [0, 0, 0]
    relativeOffset[axisIndex] = 1

    const result = arrayGeometry(bm, input, {
        fitType: opts.count === undefined ? 'fitCurve' : 'fixedCount',
        count: opts.count,
        curve: opts.path,
        curveClosed: opts.closed === true,
        useRelativeOffset: true,
        relativeOffset,
    })

    const path = curvePathFromPolyline(opts.path, opts.closed === true)
    if (path) curveDeformCoords(result.verts, path, axisIndex, opts.useDeformBounds === true)

    return result
}

// endregion

// region curve path - BevList, BKE_anim_path and the curve deform
//
// Everything below is what the Curve modifier needs from a curve object. The path is handed in as a
// polyline, which is exactly what a `CU_POLY` nurb evaluates to: `BKE_curve_bevelList_make`'s
// `CU_POLY` branch copies the control points into the bevel list verbatim, with tilt 0 and radius 1,
// and then `bevlist_firstlast_direction_calc_from_bpoint` fixes up the two end directions. So a
// polyline is not an approximation of a Blender curve here, it is one.

/** A quaternion in Blender's `float[4]` order: `[w, x, y, z]`. */
type Quat = [number, number, number, number]

/** `BevPoint`, reduced to the fields the deform reads. */
interface BevPoint {
    vec: Vec3
    dir: Vec3
    quat: Quat
    tilt: number
    radius: number
}

/** An evaluated path: the bevel list plus its accumulated segment lengths. */
export interface CurvePath {
    points: BevPoint[]
    cyclic: boolean
    /** `CurveCache.anim_path_accum_length`. One entry per segment. */
    accum: number[]
}

// --- quaternion and vector helpers, ported from `blenlib/intern/math_rotation_c.cc` ---

const qtUnit = (): Quat => [1, 0, 0, 0]

/** `mul_qt_qtqt`. */
function mulQtQtqt(a: Quat, b: Quat): Quat {
    const t0 = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3]
    const t1 = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2]
    const t2 = a[0] * b[2] + a[2] * b[0] + a[3] * b[1] - a[1] * b[3]
    const t3 = a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1]
    return [t0, t1, t2, t3]
}

/** `mul_qt_v3`: rotate a vector by a quaternion, Blender's two-step form. */
function mulQtV3(q: Quat, v: Vec3): Vec3 {
    const r: Vec3 = [v[0], v[1], v[2]]
    const t0 = -q[1] * r[0] - q[2] * r[1] - q[3] * r[2]
    let t1 = q[0] * r[0] + q[2] * r[2] - q[3] * r[1]
    let t2 = q[0] * r[1] + q[3] * r[0] - q[1] * r[2]
    r[2] = q[0] * r[2] + q[1] * r[1] - q[2] * r[0]
    r[0] = t1
    r[1] = t2

    t1 = t0 * -q[1] + r[0] * q[0] - r[1] * q[3] + r[2] * q[2]
    t2 = t0 * -q[2] + r[1] * q[0] - r[2] * q[1] + r[0] * q[3]
    r[2] = t0 * -q[3] + r[2] * q[0] - r[0] * q[2] + r[1] * q[1]
    r[0] = t1
    r[1] = t2
    return r
}

const dotQtQt = (a: Quat, b: Quat): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]

/** `normalize_qt`, including its "degenerate becomes (0,1,0,0)" fallback. */
function normalizeQt(q: Quat): Quat {
    const len = Math.sqrt(dotQtQt(q, q))
    if (len !== 0) {
        const s = 1 / len
        return [q[0] * s, q[1] * s, q[2] * s, q[3] * s]
    }
    return [0, 1, 0, 0]
}

/** `axis_angle_normalized_to_quat`. */
function axisAngleNormalizedToQuat(axis: Vec3, angle: number): Quat {
    const phi = 0.5 * angle
    const si = Math.sin(phi)
    return [Math.cos(phi), axis[0] * si, axis[1] * si, axis[2] * si]
}

/** `axis_angle_to_quat`, which falls back to the identity for a zero axis. */
function axisAngleToQuat(axis: Vec3, angle: number): Quat {
    const len = v3len(axis)
    if (len === 0) return qtUnit()
    return axisAngleNormalizedToQuat([axis[0] / len, axis[1] / len, axis[2] / len], angle)
}

/** `interp_dot_slerp` + `interp_qt_qtqt`: slerp around the shortest angle. */
function interpQtQtqt(a: Quat, b: Quat, t: number): Quat {
    const eps = 1e-4
    let cosom = dotQtQt(a, b)
    let quat: Quat
    if (cosom < 0) {
        cosom = -cosom
        quat = [-a[0], -a[1], -a[2], -a[3]]
    } else {
        quat = [a[0], a[1], a[2], a[3]]
    }

    let w0: number
    let w1: number
    if (1 - cosom > eps) {
        const omega = Math.acos(Math.min(1, Math.max(-1, cosom)))
        const sinom = Math.sin(omega)
        w0 = Math.sin((1 - t) * omega) / sinom
        w1 = Math.sin(t * omega) / sinom
    } else {
        w0 = 1 - t
        w1 = t
    }

    return [
        w0 * quat[0] + w1 * b[0],
        w0 * quat[1] + w1 * b[1],
        w0 * quat[2] + w1 * b[2],
        w0 * quat[3] + w1 * b[3],
    ]
}

/** `quat_to_mat3_no_error`, column-major: `m[0..2]` is the X basis, `m[3..5]` Y, `m[6..8]` Z. */
function quatToMat3(q: Quat): number[] {
    const s = Math.SQRT2
    const q0 = s * q[0], q1 = s * q[1], q2 = s * q[2], q3 = s * q[3]

    const qda = q0 * q1, qdb = q0 * q2, qdc = q0 * q3
    const qaa = q1 * q1, qab = q1 * q2, qac = q1 * q3
    const qbb = q2 * q2, qbc = q2 * q3, qcc = q3 * q3

    return [
        1 - qbb - qcc, qdc + qab, -qdb + qac,
        -qdc + qab, 1 - qaa - qcc, qda + qbc,
        qdb + qac, -qda + qbc, 1 - qaa - qbb,
    ]
}

const safeAcos = (a: number): number => Math.acos(Math.min(1, Math.max(-1, a)))
const safeAsin = (a: number): number => Math.asin(Math.min(1, Math.max(-1, a)))

/** `angle_normalized_v3v3`: acos of the dot, computed through asin for accuracy near 0 and pi. */
function angleNormalizedV3V3(v1: Vec3, v2: Vec3): number {
    if (v3dot(v1, v2) >= 0) return 2 * safeAsin(v3len(v3sub(v1, v2)) / 2)
    const v2n: Vec3 = [-v2[0], -v2[1], -v2[2]]
    return Math.PI - 2 * safeAsin(v3len(v3sub(v1, v2n)) / 2)
}

/** `bisect_v3_v3v3v3`: the normalised sum of the two normalised segment directions at `b`. */
function bisectV3V3V3(a: Vec3, b: Vec3, c: Vec3): Vec3 {
    const d12 = v3normalize(v3sub(b, a))
    const d23 = v3normalize(v3sub(c, b))
    return v3normalize([d12[0] + d23[0], d12[1] + d23[1], d12[2] + d23[2]])
}

/**
 * `vec_to_quat`: the rotation taking the given axis onto `vec`, with `upflag` picking the roll.
 *
 * `axis` is 0..5 for +X, +Y, +Z, -X, -Y, -Z. The bevel list calls it with `(dir, 5, 1)`.
 */
function vecToQuat(vec: Vec3, axisIn: number, upflag: number): Quat {
    const eps = 1e-4
    let q = qtUnit()

    const len = v3len(vec)
    if (len === 0) return q

    // Rotate to axis.
    let axis = axisIn
    let tvec: Vec3
    if (axis > 2) {
        tvec = [vec[0], vec[1], vec[2]]
        axis = axis - 3
    } else {
        tvec = [-vec[0], -vec[1], -vec[2]]
    }

    // "nasty! I need a good routine for this... problem is a rotation of an Y axis to the negative
    // Y-axis for example."
    let nor: Vec3
    let co: number
    if (axis === 0) {
        nor = [0, -tvec[2], tvec[1]]
        if (Math.abs(tvec[1]) + Math.abs(tvec[2]) < eps) nor[1] = 1
        co = tvec[0]
    } else if (axis === 1) {
        nor = [tvec[2], 0, -tvec[0]]
        if (Math.abs(tvec[0]) + Math.abs(tvec[2]) < eps) nor[2] = 1
        co = tvec[1]
    } else {
        nor = [-tvec[1], tvec[0], 0]
        if (Math.abs(tvec[0]) + Math.abs(tvec[1]) < eps) nor[0] = 1
        co = tvec[2]
    }
    co /= len

    nor = v3normalize(nor)
    q = axisAngleNormalizedToQuat(nor, safeAcos(co))

    if (axis !== upflag) {
        const mat = quatToMat3(q)
        // Blender reads `mat[2]`, the Z basis column.
        const fp = [mat[6], mat[7], mat[8]]
        let angle: number
        if (axis === 0) {
            angle = upflag === 1 ? 0.5 * Math.atan2(fp[2], fp[1]) : -0.5 * Math.atan2(fp[1], fp[2])
        } else if (axis === 1) {
            angle = upflag === 0 ? -0.5 * Math.atan2(fp[2], fp[0]) : 0.5 * Math.atan2(fp[0], fp[2])
        } else {
            angle = upflag === 0 ? 0.5 * Math.atan2(-fp[1], -fp[0]) : -0.5 * Math.atan2(-fp[0], -fp[1])
        }

        const cs = Math.cos(angle)
        const si = Math.sin(angle) / len
        const q2: Quat = [cs, tvec[0] * si, tvec[1] * si, tvec[2] * si]
        q = mulQtQtqt(q2, q)
    }

    return q
}

const SQRT1_2 = Math.SQRT1_2

/** The `quat_track` table from `quat_apply_track`, hard coded to match {@link vecToQuat}. */
const QUAT_TRACK: Quat[] = [
    [SQRT1_2, 0, -SQRT1_2, 0], // pos-y90
    [0.5, 0.5, 0.5, 0.5], // Quaternion((1,0,0), 90) * Quaternion((0,1,0), 90)
    [SQRT1_2, 0, 0, SQRT1_2], // pos-z90
    [SQRT1_2, 0, SQRT1_2, 0], // neg-y90
    [0.5, -0.5, -0.5, 0.5], // Quaternion((1,0,0), -90) * Quaternion((0,1,0), -90)
    [0, SQRT1_2, SQRT1_2, 0], // no rotation
]

/** `quat_apply_track`. */
function quatApplyTrack(quatIn: Quat, axisIn: number, upflag: number): Quat {
    let quat = mulQtQtqt(quatIn, QUAT_TRACK[axisIn])

    let axis = axisIn
    if (axis > 2) axis = axis - 3

    // "there are 2 possible up-axis for each axis used, the 'quat_track' applies so the first up
    // axis is used X->Y, Y->X, Z->X, if this first up axis isn't used then rotate 90d"
    if (upflag !== (2 - axis) >> 1) {
        const q: Quat = [SQRT1_2, 0, 0, 0]
        q[axis + 1] = axis === 1 ? SQRT1_2 : -SQRT1_2 // flip non Y axis
        quat = mulQtQtqt(quat, q)
    }
    return quat
}

/** `vec_apply_track`. */
function vecApplyTrack(vec: Vec3, axis: number): Vec3 {
    const t = vec
    switch (axis) {
    case 0: // POS-X
        return [t[0], t[2], -t[1]]
    case 1: // POS-Y
        return [t[0], t[1], t[2]]
    case 2: // POS-Z
        return [t[0], t[1], t[2]]
    case 3: // NEG-X
        return [t[0], t[2], -t[1]]
    case 4: // NEG-Y
        return [-t[2], t[1], t[0]]
    case 5: // NEG-Z
        return [-t[0], -t[1], t[2]]
    default:
        return [t[0], t[1], t[2]]
    }
}

// --- `key_curve_position_weights` (`blenkernel/intern/key.cc:307`) ---

/** `KEY_LINEAR` position weights. A `CU_POLY` curve interpolates its points linearly. */
const keyCurvePositionWeightsLinear = (t: number): number[] => [0, -t + 1, t, 0]

// --- the bevel list ---

/** `get_bevlist_seg_array_size`: a cyclic list has one more segment than it has gaps. */
const segArraySize = (nr: number, cyclic: boolean): number => (cyclic ? nr : nr - 1)

/**
 * The total length of a polyline, which is what `MOD_ARR_FITCURVE` measures.
 *
 * `BKE_anim_path_get_length` returns the last entry of `anim_path_accum_length`, and
 * `BKE_anim_path_calc_data` builds that by walking the bevel points - for a `CU_POLY` curve, the
 * control points themselves.
 */
export function polylineLength(path: readonly Vec3[], closed = false): number {
    const accum = animPathCalcData(path, closed)
    return accum.length ? accum[accum.length - 1] : 0
}

/** Port of `BKE_anim_path_calc_data` (`anim_path.cc:61`). */
function animPathCalcData(path: readonly Vec3[], cyclic: boolean): number[] {
    const nr = path.length
    if (nr === 0) return []
    const segSize = segArraySize(nr, cyclic)
    if (segSize <= 0) return []

    const lenData: number[] = new Array(segSize)
    let prevLen = 0
    for (let i = 0; i < nr - 1; i++) {
        prevLen += v3len(v3sub(path[i], path[i + 1]))
        lenData[i] = prevLen
    }
    if (cyclic) lenData[segSize - 1] = prevLen + v3len(v3sub(path[0], path[nr - 1]))
    return lenData
}

/** Port of `bevel_list_calc_bisect` (`curve.cc:2041`), with the `CU_POLY` end-direction fix-up. */
function bevelListCalcBisect(points: BevPoint[], cyclic: boolean): void {
    const nrTotal = points.length
    if (cyclic) {
        // bevp2 = [0], bevp1 = [nr-1], bevp0 = [nr-2], nr iterations.
        let i2 = 0
        let i1 = nrTotal - 1
        let i0 = nrTotal - 2
        for (let n = 0; n < nrTotal; n++) {
            points[i1].dir = bisectV3V3V3(points[i0].vec, points[i1].vec, points[i2].vec)
            i0 = i1
            i1 = i2
            i2 = i2 + 1
        }
    } else {
        // bevp0 = [0], bevp1 = [1], bevp2 = [2], nr - 2 iterations, so the ends keep the directions
        // `bevlist_firstlast_direction_calc_from_bpoint` gave them.
        let i0 = 0
        let i1 = 1
        let i2 = 2
        for (let n = 0; n < nrTotal - 2; n++) {
            points[i1].dir = bisectV3V3V3(points[i0].vec, points[i1].vec, points[i2].vec)
            i0 = i1
            i1 = i2
            i2 = i2 + 1
        }

        // "In the unlikely situation that handles define a zeroed direction, calculate it from the
        // adjacent points."
        if (isZeroV3(points[0].dir)) {
            const d = v3sub(points[1].vec, points[0].vec)
            points[0].dir = v3len(d) === 0 ? [...points[1].dir] as Vec3 : v3normalize(d)
        }
        const last = nrTotal - 1
        if (isZeroV3(points[last].dir)) {
            const d = v3sub(points[last].vec, points[last - 1].vec)
            points[last].dir = v3len(d) === 0 ? [...points[last - 1].dir] as Vec3 : v3normalize(d)
        }
    }
}

const isZeroV3 = (v: Vec3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0

/** Port of `minimum_twist_between_two_points` (`curve.cc:2214`). */
function minimumTwistBetweenTwoPoints(curr: BevPoint, prev: BevPoint): void {
    const angle = angleNormalizedV3V3(prev.dir, curr.dir)
    if (angle > 0) {
        const q = axisAngleToQuat(v3cross(prev.dir, curr.dir), angle)
        curr.quat = mulQtQtqt(q, prev.quat)
    } else {
        // Otherwise we can keep as is.
        curr.quat = [...prev.quat] as Quat
    }
}

/**
 * Port of `make_bevel_list_3D_minimum_twist` (`curve.cc:2230`), Blender's default twist mode.
 *
 * This is the rotation-minimising frame: each point's frame is the previous one rotated by the
 * shortest rotation between their tangents, so the frame never spins about the path. A cyclic path
 * additionally spreads the leftover twist between its last and first point over the whole loop, so
 * the frames match up where the path closes.
 */
function makeBevelList3DMinimumTwist(points: BevPoint[], cyclic: boolean): void {
    const nrTotal = points.length
    // "For non-cyclic curves only initialize the first direction (via `vec_to_quat`) ... Otherwise
    // initialize the first and second points before propagating rotation forward."
    const nrInit = nrTotal - (cyclic ? 1 : 2)

    bevelListCalcBisect(points, cyclic)

    let i2 = 0
    let i1 = nrTotal - 1
    let i0 = nrTotal - 2

    for (let nr = nrTotal - 1; nr >= 0; nr--) {
        if (nr >= nrInit) {
            points[i1].quat = vecToQuat(points[i1].dir, 5, 1)
        } else {
            minimumTwistBetweenTwoPoints(points[i1], points[i0])
        }
        i0 = i1
        i1 = i2
        i2 = i2 + 1
    }

    if (cyclic) {
        // "Need to correct for the start/end points not matching, do this by calculating the tilt
        // angle difference, then apply the rotation gradually over the entire curve. Note that the
        // split is between last and second last, rather than first/last as you'd expect."
        const bevpFirst = points[nrTotal - 1]
        const bevpLast = points[nrTotal - 2]

        let vec1: Vec3 = mulQtV3(bevpFirst.quat, [0, 1, 0])
        let vec2: Vec3 = mulQtV3(bevpLast.quat, [0, 1, 0])
        vec1 = v3normalize(vec1)
        vec2 = v3normalize(vec2)

        // "align the vector ... better to align the angle quat roll's before comparing"
        {
            const crossTmp = v3cross(bevpLast.dir, bevpFirst.dir)
            const a = angleNormalizedV3V3(bevpFirst.dir, bevpLast.dir)
            const q = axisAngleToQuat(crossTmp, a)
            vec2 = mulQtV3(q, vec2)
        }

        let angle = angleNormalizedV3V3(vec1, vec2)

        // Flip rotation if needs be.
        const crossTmp = v3normalize(v3cross(vec1, vec2))
        if (angleNormalizedV3V3(bevpFirst.dir, crossTmp) < Math.PI / 2) angle = -angle

        i2 = 0
        i1 = nrTotal - 1
        i0 = nrTotal - 2
        for (let nr = nrTotal - 1; nr >= 0; nr--) {
            const angFac = angle * (1 - nr / nrTotal)
            const q = axisAngleToQuat(points[i1].dir, angFac)
            points[i1].quat = mulQtQtqt(q, points[i1].quat)
            i0 = i1
            i1 = i2
            i2 = i2 + 1
        }
    } else {
        // "Need to correct quat for the first/last point, this is so because previously it was only
        // calculated using its own direction, which might not correspond the twist of neighbor point."
        minimumTwistBetweenTwoPoints(points[0], points[1])
        minimumTwistBetweenTwoPoints(points[nrTotal - 1], points[nrTotal - 2])
    }
}

/** Port of `make_bevel_list_segment_3D` (`curve.cc:2423`), the two-point case. */
function makeBevelListSegment3D(points: BevPoint[]): void {
    const bevp2 = points[0]
    const bevp1 = points[1]

    bevp1.dir = v3normalize(v3sub(bevp1.vec, bevp2.vec))
    bevp1.quat = normalizeQt(mulQtQtqt(axisAngleToQuat(bevp1.dir, bevp1.tilt), vecToQuat(bevp1.dir, 5, 1)))

    bevp2.dir = [...bevp1.dir] as Vec3
    bevp2.quat = normalizeQt(mulQtQtqt(axisAngleToQuat(bevp2.dir, bevp2.tilt), vecToQuat(bevp2.dir, 5, 1)))
}

/** Port of `bevel_list_apply_tilt` (`curve.cc:2124`). A polyline has tilt 0, so this is a normalise. */
function bevelListApplyTilt(points: BevPoint[]): void {
    for (const p of points) {
        p.quat = normalizeQt(mulQtQtqt(axisAngleToQuat(p.dir, p.tilt), p.quat))
    }
}

/**
 * Evaluate a polyline into a path with a frame at every point.
 *
 * Port of the `CU_POLY` branch of `BKE_curve_bevelList_make` (`curve.cc:2640`) followed by
 * `make_bevel_list_3D` with Blender's default twist mode (`CU_TWIST_MINIMUM`) and its default twist
 * smoothing of 0, which skips `bevel_list_smooth` entirely.
 */
export function curvePathFromPolyline(path: readonly Vec3[], cyclic: boolean): CurvePath | null {
    const nr = path.length
    if (nr < 2) return null

    const points: BevPoint[] = path.map(p => ({
        vec: [p[0], p[1], p[2]] as Vec3,
        dir: [0, 0, 0] as Vec3,
        quat: qtUnit(),
        tilt: 0,
        // `BPoint.radius` defaults to 1, so `CU_PATH_RADIUS` scaling is the identity for a polyline.
        radius: 1,
    }))

    if (!cyclic) {
        // `bevlist_firstlast_direction_calc_from_bpoint`: the end directions come from the handles,
        // which for a poly nurb are the adjacent control points.
        points[0].dir = v3normalize(v3sub(path[1], path[0]))
        points[nr - 1].dir = v3normalize(v3sub(path[nr - 1], path[nr - 2]))
    }

    if (nr === 2) {
        makeBevelListSegment3D(points)
    } else {
        makeBevelList3DMinimumTwist(points, cyclic)
        bevelListApplyTilt(points)
    }

    return {points, cyclic, accum: animPathCalcData(path, cyclic)}
}

/** Port of `get_curve_points_from_idx` (`anim_path.cc:105`). */
function getCurvePointsFromIdx(idx: number, points: BevPoint[], cyclic: boolean): BevPoint[] {
    const nr = points.length

    // First segment.
    if (idx === 0) {
        const p1 = points[0]
        const p0 = cyclic ? points[nr - 1] : p1
        const p2 = points[1]
        const p3 = nr > 2 ? points[2] : p2
        return [p0, p1, p2, p3]
    }

    // Last segment (or next to last in a cyclic curve).
    if (idx === nr - 2) {
        const p0 = points[idx - 1]
        const p1 = points[idx]
        const p2 = points[idx + 1]
        const p3 = cyclic ? points[0] : p2
        return [p0, p1, p2, p3]
    }

    if (idx === nr - 1) {
        // Last segment in a cyclic curve: the extra segment between the end and the start point.
        return [points[idx - 1], points[idx], points[0], points[1]]
    }

    return [points[idx - 1], points[idx], points[idx + 1], points[idx + 2]]
}

/** Port of `binary_search_anim_path` (`anim_path.cc:176`). */
function binarySearchAnimPath(
    accum: readonly number[], segSize: number, goalLen: number,
): {idx: number, frac: number} | null {
    if (segSize === 1) return {idx: 0, frac: goalLen / accum[0]}

    let curIdx = 0
    let curBase = 0
    let curStep = segSize - 1

    for (;;) {
        curIdx = curBase + Math.trunc(curStep / 2)
        const leftLen = accum[curIdx]
        const rightLen = accum[curIdx + 1]

        if (leftLen <= goalLen && rightLen > goalLen) {
            return {idx: curIdx + 1, frac: (goalLen - leftLen) / (rightLen - leftLen)}
        }
        if (curIdx === 0) {
            // "We ended up at the first segment. The point must be in here."
            return {idx: 0, frac: goalLen / accum[0]}
        }
        if (curStep === 0) return null

        if (leftLen < goalLen) {
            curBase = curIdx + 1
            curStep--
        }
        curStep = Math.trunc(curStep / 2)
    }
}

/**
 * Position, frame and radius at a fraction along the path.
 *
 * Port of `BKE_where_on_path` (`anim_path.cc:232`), for a `CU_POLY` curve. Blender also returns a
 * direction from the B-spline tangent weights; the curve deform only reads it when `no_rot_axis` is
 * set, which `init_curve_deform` never does, so it is not computed here.
 */
export function whereOnPath(
    path: CurvePath, ctimeIn: number,
): {loc: Vec3, quat: Quat, radius: number} | null {
    const points = path.points
    const nr = points.length
    if (nr < 2) return null

    let ctime = ctimeIn
    if (path.cyclic && (ctime < 0 || ctime > 1)) ctime -= Math.floor(ctime)

    const segSize = segArraySize(nr, path.cyclic)
    const accum = path.accum
    const goalLen = ctime * accum[segSize - 1]

    let quad: BevPoint[]
    let frac: number

    if (ctime <= 0 || ctime >= 1) {
        const clampTime = Math.min(1, Math.max(0, ctime))
        const idx = Math.trunc(clampTime * (segSize - 1))
        quad = getCurvePointsFromIdx(idx, points, path.cyclic)
        frac = idx === 0
            ? goalLen / accum[0]
            : (goalLen - accum[idx - 1]) / (accum[idx] - accum[idx - 1])
    } else {
        const found = binarySearchAnimPath(accum, segSize, goalLen)
        if (!found) return null
        frac = found.frac
        quad = getCurvePointsFromIdx(found.idx, points, path.cyclic)
    }

    const [p0, p1, p2, p3] = quad

    // A `CU_POLY` nurb takes `KEY_LINEAR` position weights, so the first and last frame are included.
    const w = keyCurvePositionWeightsLinear(frac)

    const loc: Vec3 = [
        w[0] * p0.vec[0] + w[1] * p1.vec[0] + w[2] * p2.vec[0] + w[3] * p3.vec[0],
        w[0] * p0.vec[1] + w[1] * p1.vec[1] + w[2] * p2.vec[1] + w[3] * p3.vec[1],
        w[0] * p0.vec[2] + w[1] * p1.vec[2] + w[2] * p2.vec[2] + w[3] * p3.vec[2],
    ]

    // "Clamp weights to 0-1 as we don't want to extrapolate other values than position."
    for (let i = 0; i < 4; i++) w[i] = Math.min(1, Math.max(0, w[i]))

    let quat: Quat
    {
        let totfac = w[0] + w[3]
        const q1 = totfac > FLT_EPSILON
            ? interpQtQtqt(p0.quat, p3.quat, w[3] / totfac)
            : [...p1.quat] as Quat

        totfac = w[1] + w[2]
        const q2 = totfac > FLT_EPSILON
            ? interpQtQtqt(p1.quat, p2.quat, w[2] / totfac)
            : [...p3.quat] as Quat

        totfac = w[0] + w[1] + w[2] + w[3]
        quat = totfac > FLT_EPSILON
            ? interpQtQtqt(q1, q2, (w[1] + w[2]) / totfac)
            : q2
    }

    const radius = w[0] * p0.radius + w[1] * p1.radius + w[2] * p2.radius + w[3] * p3.radius

    return {loc, quat, radius}
}

/**
 * Bend a set of vertices onto a path. Blender's Curve modifier.
 *
 * Port of `calc_curve_deform` (`curve_deform.cc:64`) driven by `curve_deform_coords_impl`. A point's
 * parameter along the path is its coordinate on the deform axis divided by the path length; the point
 * is then flattened onto the plane through the path point (its axis coordinate is zeroed), rotated by
 * the path frame there, and translated to the path. `vec_apply_track`/`quat_apply_track` are the
 * axis-relabelling Blender does so that every deform axis produces a consistently wound result.
 *
 * `useDeformBounds` is Blender's `CU_DEFORM_BOUNDS_OFF` inverted, which the curve clears by default:
 * with it off the bounds are the dummy `[0, 1]` and a point's parameter is its raw coordinate.
 */
export function curveDeformCoords(
    verts: readonly BMVert[], path: CurvePath, axis: number, useDeformBounds = false,
): void {
    const isNegAxis = axis > 2
    const index = isNegAxis ? axis - 3 : axis

    let dmin: Vec3
    let dmax: Vec3
    if (!useDeformBounds) {
        // Dummy bounds. "Negative, these bounds give a good rest position."
        dmin = isNegAxis ? [-1, -1, -1] : [0, 0, 0]
        dmax = isNegAxis ? [0, 0, 0] : [1, 1, 1]
    } else {
        const bounds = chunkBounds(verts)
        if (!bounds) return
        dmin = bounds.min
        dmax = bounds.max
    }

    const totdist = path.accum.length ? path.accum[path.accum.length - 1] : 0
    const upflag = (axis === 0 || axis === 2) ? 1 : 0

    for (const v of verts) {
        const co: Vec3 = [v.x, v.y, v.z]

        // `CU_STRETCH` is off by default, so the divisor is the path length, not the bounds span.
        let fac: number
        if (isNegAxis) fac = totdist > FLT_EPSILON ? -(co[index] - dmax[index]) / totdist : 0
        else fac = totdist > FLT_EPSILON ? (co[index] - dmin[index]) / totdist : 0

        const w = whereOnPath(path, fac)
        if (!w) continue

        // The block of text in `calc_curve_deform` explaining why `co` is copied to `cent` applies
        // to exactly these three lines.
        let quat = quatApplyTrack(w.quat, axis, upflag)
        let cent = vecApplyTrack(co, axis)
        cent[index] = 0

        // `CU_PATH_RADIUS`, which the curve sets by default. A polyline has radius 1 throughout.
        cent = v3mul(cent, w.radius)

        quat = normalizeQt(quat)
        cent = mulQtV3(quat, cent)

        v.setCo(cent[0] + w.loc[0], cent[1] + w.loc[1], cent[2] + w.loc[2])
    }
}

// endregion
