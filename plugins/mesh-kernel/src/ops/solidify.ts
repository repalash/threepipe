/**
 * Solidify, the "shell" operator: give a surface thickness, so a sheet becomes a plate.
 *
 * Ported from `source/blender/modifiers/intern/MOD_solidify_extrude.cc`
 * (`MOD_solidify_extrude_modifyMesh`, `:150`), which is the Solidify modifier's **Simple** mode.
 *
 * Blender's other mode, **Complex** / non-manifold (`MOD_solidify_nonmanifold.cc`,
 * `MOD_solidify_nonmanifold_modifyMesh`), is **not ported here and nothing falls back to it**. It is
 * a different algorithm - it builds per-edge offset groups around every vertex and solves each group
 * against the planes of its faces - and stubbing it as "solidify with a flag" would be a lie. A mesh
 * with a three-face edge goes through this file the way Blender's Simple mode does, which is to say
 * the shell is built anyway and the thickness near that edge is whatever the vertex normals give.
 *
 * The shape of the port. Blender is building a new `Mesh` from arrays, so it allocates two blocks -
 * `[0, verts_num)` for the original surface and `[verts_num, 2 * verts_num)` for its copy - and every
 * decision in the file is expressed as an index into one block or the other. A BMesh has no blocks:
 * the originals stay where they are and the copy is made with {@link BMesh.vertCreate} and
 * {@link BMesh.faceCreate}. So "block 0" below means the input elements and "block 1" means their
 * duplicates, and the index arithmetic (`+ verts_num`, `+ edges_num`, `edge_order`, the `flip` bit
 * packed into `edge_users`) disappears into element references. Where that collapses two Blender
 * branches into one, the comment says so and says why the two agree.
 *
 * Three things are easy to get wrong and are called out where they happen:
 *
 * 1. **The inner surface must be wound backwards.** Blender reverses the copy's corners
 *    (`:429-455`); without it the result is a shell whose inside faces the same way as its outside,
 *    which validates, renders and is inside out.
 * 2. **`use_flip_normals` does not flip any face.** It swaps which of the two offsets lands on which
 *    block (`:403`), which moves the reversed surface to the outside. The effect is the same and the
 *    mechanism is not, so looking for a winding reversal here finds nothing.
 * 3. **`offset` is not a distance.** Blender's `offset_fac` picks where the shell sits relative to
 *    the input surface, through `ofs_orig` / `ofs_new` at `:182`. See {@link SolidifyOptions.offset}.
 *
 * Not ported, and deliberately: the vertex-group weighting (`defgrp_name`, `offset_fac_vg`,
 * `shell_defgrp_name`, `rim_defgrp_name`), because the kernel has no deform-vertex domain to weight
 * against. Everything else in `MOD_solidify_extrude.cc` is here, including the parts Blender keeps
 * behind extra flags: high-quality normals, the angle clamp, the material offsets, the three crease
 * values and `bevel_convex`.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists} from '../bmesh/structure'
import {copyElemAttrs, getComponent, setComponent} from '../bmesh/customdata'
import {AttrName, ElemFlag} from '../constants'
import {faceSelectSet, selectNone, vertSelectSet} from '../bmesh/marking'
import {Vec3, v3add, v3cross, v3dot, v3len, v3mul, v3normalize, v3sub} from '../math'

/** `FLT_EPSILON`. Blender clamps corner angles and the clamp offset against it. */
const FLT_EPSILON = 1.1920928955078125e-7
/** `SMALL_NUMBER` from `math_geom_inline.cc:18`, the guard inside the shell-distance helpers. */
const SMALL_NUMBER = 1e-8

// region Blender maths helpers

/** `safe_asinf`: `asin` with the argument clamped, so a rounding overshoot cannot produce NaN. */
function safeAsin(x: number): number {
    return Math.asin(Math.max(-1, Math.min(1, x)))
}

/**
 * Angle between two unit vectors. Port of `angle_normalized_v3v3` (`math_vector.cc:335`), which goes
 * through the chord length rather than `acos(dot)` because that loses precision near 0 and pi - and
 * near 0 is exactly where a nearly flat surface lives.
 */
function angleNormalized(a: Vec3, b: Vec3): number {
    if (v3dot(a, b) >= 0) return 2 * safeAsin(v3len(v3sub(a, b)) / 2)
    return Math.PI - 2 * safeAsin(v3len(v3add(a, b)) / 2)
}

/** `angle_v3v3` (`math_vector.cc:250`): normalise both, then {@link angleNormalized}. */
function angleV3V3(a: Vec3, b: Vec3): number {
    return angleNormalized(v3normalize(a), v3normalize(b))
}

/**
 * `shell_v3v3_normalized_to_dist` (`math_geom_inline.cc:133`): how far along the unit vector `a` you
 * must travel for the component along the unit vector `b` to be one unit, i.e. `1 / |cos|`.
 *
 * This single line is the whole of "even thickness". Offsetting a vertex along its own normal moves
 * it `cos(angle)` of the way off each of its faces, so a corner comes out thin; multiplying by
 * `1 / cos(angle)` puts it back.
 */
function shellNormalizedToDist(a: Vec3, b: Vec3): number {
    const angleCos = Math.abs(v3dot(a, b))
    return angleCos < SMALL_NUMBER ? 1 : 1 / angleCos
}

/** `project_plane_normalized_v3_v3v3`: the component of `v` perpendicular to the unit `axis`. */
function projectPlaneNormalized(v: Vec3, axis: Vec3): Vec3 {
    return v3sub(v, v3mul(axis, v3dot(v, axis)))
}

/**
 * `angle_signed_on_axis_v3v3_v3` (`math_vector.cc:379`): the angle from `v2` round to `v1` about
 * `axis`, in `0..2pi` rather than `0..pi`. Solidify feeds it two face normals and the shared edge, so
 * the result is a dihedral angle in which below pi means convex and above means concave - which is
 * the distinction both the angle clamp and `bevel_convex` are made of.
 */
function angleSignedOnAxis(v1: Vec3, v2: Vec3, axis: Vec3): number {
    const v1Proj = projectPlaneNormalized(v1, axis)
    const v2Proj = projectPlaneNormalized(v2, axis)
    const angle = angleV3V3(v1Proj, v2Proj)
    if (v3dot(v3cross(v2Proj, v1Proj), axis) < 0) return 2 * Math.PI - angle
    return angle
}

/**
 * `mid_v3_v3v3_angle_weighted` (`math_vector.cc:227`): the bisector of two unit normals, scaled by
 * how far apart they are.
 *
 * Blender's constant looks wrong and is not: `M_2_PI` is `2/pi`, not `2*pi`, so the scale is
 * `(4/pi) * acos(|a + b| / 2)`, running 0 for parallel normals to 2 for opposed ones. Its own comment
 * says the point is a 0-1-ish factor rather than an angle. Only the high-quality normal pass uses it.
 */
function midAngleWeighted(a: Vec3, b: Vec3): Vec3 {
    const sum = v3add(a, b)
    const len = v3len(sum)
    const dir: Vec3 = len !== 0 ? [sum[0] / len, sum[1] / len, sum[2] / len] : [0, 0, 0]
    // `normalize_v3` returns the length it had before normalising, which is what `acosf` is given.
    const factor = (2 / Math.PI) * 2 * Math.acos(Math.max(-1, Math.min(1, len / 2)))
    return v3mul(dir, factor)
}

/**
 * Newell's normal for a face, normalised, with Blender's degenerate fallback of `+Z`.
 *
 * Port of `normal_calc_ngon` (`mesh_normals.cc:125`). `normals_calc_faces` uses it for every face
 * size, triangles and quads included, so there is no special case here either.
 */
function faceNormalCalc(f: BMFace): Vec3 {
    let nx = 0
    let ny = 0
    let nz = 0
    const loops = [...f.eachLoop()]
    let prev = loops[loops.length - 1].v
    for (const l of loops) {
        const curr = l.v
        nx += (prev.y - curr.y) * (prev.z + curr.z)
        ny += (prev.z - curr.z) * (prev.x + curr.x)
        nz += (prev.x - curr.x) * (prev.y + curr.y)
        prev = curr
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    // "Other axis are already set to zero" - a face with no area gets an arbitrary but unit normal.
    if (len === 0) return [0, 0, 1]
    return [nx / len, ny / len, nz / len]
}

// endregion

export interface SolidifyOptions {
    /**
     * How thick the shell is, in object units. Blender's `smd->offset`, which the UI and the Python
     * API both call `thickness`; the DNA field is named `offset` for historical reasons and this is
     * *not* the same thing as {@link offset}. Default 0.01, Blender's.
     *
     * Negative values are allowed and put the shell on the other side, exactly as Blender does.
     */
    thickness?: number
    /**
     * Where the shell sits relative to the input surface, in `-1..1`. Blender's `smd->offset_fac`,
     * the UI's "Offset", default -1.
     *
     * It is a placement, not a distance. Blender turns it into the pair of displacements at
     * `MOD_solidify_extrude.cc:182`:
     *
     * ```text
     * ofs_orig = -(((-offset_fac + 1) * 0.5) * thickness)
     * ofs_new  = thickness + ofs_orig
     * ```
     *
     * so at -1 the input surface is the outer one and the shell grows inward (`0` and `-t`), at +1 it
     * is the inner one and the shell grows outward (`+t` and `0`), and at 0 the shell straddles it
     * (`+t/2` and `-t/2`). The thickness is `thickness` in every case; only the placement moves.
     */
    offset?: number
    /**
     * Shrink the offset near small geometry, so a thick shell on a fine mesh does not turn itself
     * inside out. Blender's `smd->offset_clamp`, the UI's "Clamp", default 0 which means off.
     *
     * The clamp distance is `|thickness| * offsetClamp`; a vertex whose shortest edge is shorter than
     * that has its offset scaled down in proportion (`:646`). So 1 means "never offset a vertex
     * further than its shortest edge", and 0.5 means half that.
     */
    offsetClamp?: number
    /**
     * Also clamp by how sharply the surface folds, not only by edge length. Blender's
     * `MOD_SOLIDIFY_OFFSET_ANGLE_CLAMP` ("Angle Clamp"), default off, and only meaningful together
     * with {@link offsetClamp}.
     *
     * Beyond {@link SolidifyOptions} as the task defined it, but it is half of what `do_clamp` means
     * in the source and leaving it out would have made `offsetClamp` a partial port.
     */
    useAngleClamp?: boolean
    /**
     * Correct the offset at corners so the shell keeps its thickness there. Blender's
     * `MOD_SOLIDIFY_EVEN` ("Even Thickness"), default off, which is the DNA default
     * (`flag = MOD_SOLIDIFY_RIM`).
     *
     * Without it a vertex is pushed `thickness` along its own normal, which at a fold clears each
     * adjoining face by only `thickness * cos(half the fold angle)` - a 90 degree fold comes out 29%
     * thin. With it the push is scaled by `1 / cos`, averaged over the vertex's corners and weighted
     * by corner angle, so the perpendicular thickness is right on every face at once.
     */
    useEvenOffset?: boolean
    /**
     * Compute the vertex normals from angle-weighted *edge* normals rather than from face normals.
     * Blender's `MOD_SOLIDIFY_NORMAL_CALC` ("High Quality Normals"), default off.
     *
     * Also beyond the requested option set; it is `mesh_calc_hq_normal` (`:59`), it changes the
     * offset direction at every vertex, and it is what switches on Blender's non-manifold workaround
     * in the even-offset weighting.
     */
    useHighQualityNormals?: boolean
    /**
     * Bridge the two surfaces with quads along the open boundary, closing the result.
     * Blender's `MOD_SOLIDIFY_RIM` ("Fill Rim"), default **on**.
     *
     * With it, solidifying an open grid gives a closed solid. Without it you get two separate open
     * shells facing away from each other.
     */
    useRim?: boolean
    /**
     * Emit only the rim, leaving the input surface alone instead of copying it. Blender's
     * `MOD_SOLIDIFY_NOSHELL` ("Only Rim"), default off. Ignored unless {@link useRim} is on, which is
     * Blender's `do_shell = !(do_rim && NOSHELL)` (`:194`).
     *
     * The input surface is still displaced; what you get is that surface plus a skirt hanging off its
     * border, which is what Blender gives you.
     */
    useRimOnly?: boolean
    /**
     * Turn the finished shell inside out. Blender's `MOD_SOLIDIFY_FLIP` ("Flip Normals"), default off.
     *
     * It reverses no windings. It swaps which block each offset lands on (`:403`), so the reversed
     * copy ends up on the outside of the same volume. Same result, and worth knowing when reading
     * this file looking for a face flip that is not there.
     */
    flipNormals?: boolean
    /**
     * Added to the inner surface's material slot. Blender's `smd->mat_ofs`, and like Blender it does
     * nothing unless the mesh has more than one material slot, and clamps to the last one (`:437`).
     */
    materialOffset?: number
    /** The same for the rim faces. Blender's `smd->mat_ofs_rim` (`:1109`). */
    materialOffsetRim?: number
    /** Edge crease written on the new edges joining the two surfaces. Blender's `crease_rim`. */
    creaseRim?: number
    /** Edge crease added to the input surface's boundary edges. Blender's `crease_outer`. */
    creaseOuter?: number
    /** Edge crease added to the inner surface's boundary edges. Blender's `crease_inner`. */
    creaseInner?: number
    /**
     * Bevel weight added to edges by how convex they are. Blender's `smd->bevel_convex`, default 0.
     * Positive weights convex edges of the outer surface (and concave ones of the inner), negative
     * the other way round. Writes `bevel_weight_edge`; it moves no geometry.
     */
    bevelConvex?: number
    /**
     * Select the result and deselect everything else, the way the rest of `ops/` hands its output
     * back. Defaults to true. The "result" is the whole shell - the input faces, the inner copy and
     * the rim - because that is the object the operator made, not just the half of it that is new.
     */
    selectResult?: boolean
}

export interface SolidifyResult {
    /** Every face created: the inner surface first, then the rim. */
    faces: BMFace[]
    /** Every vertex created, which is the copy of the input surface. */
    verts: BMVert[]
    /** Every edge created, in creation order. */
    edges: BMEdge[]
    /** The reversed copy of the input surface. Empty under {@link SolidifyOptions.useRimOnly}. */
    innerFaces: BMFace[]
    /** The quads bridging the two surfaces along the input's open boundary. */
    rimFaces: BMFace[]
    /** Input vertex to its copy on the other surface. Only the rim verts under `useRimOnly`. */
    vertMap: Map<BMVert, BMVert>
}

/**
 * Give `faces` thickness.
 *
 * `faces` plays the part of Blender's whole mesh: its vertices, edges and corners are the arrays the
 * modifier walks. One consequence is worth stating, because it is the only place this port is not a
 * transcription. Blender decides an edge is on the rim by counting *all* the faces that use it; here
 * only the faces in `faces` count, so an edge shared with a face outside the input is a rim edge and
 * gets a rim quad. That matches `extrudeFaceRegion`, which draws its boundary the same way, and
 * it is the only reading that makes a region argument mean anything.
 *
 * Returns empty lists when `faces` is empty.
 */
export function solidify(bm: BMesh, faces: BMFace[], opts: SolidifyOptions = {}): SolidifyResult {
    const region: BMFace[] = []
    const regionSet = new Set<BMFace>()
    for (const f of faces) {
        if (!bm.faces.has(f) || regionSet.has(f)) continue
        regionSet.add(f)
        region.push(f)
    }
    if (!region.length) {
        return {faces: [], verts: [], edges: [], innerFaces: [], rimFaces: [], vertMap: new Map()}
    }

    // Blender's `orig_vert_positions` / `orig_edges` / `orig_faces` and the indices into them. Order
    // is the region's corner order, which is the only order available; nothing depends on it beyond
    // reproducing Blender's "walk vertices 0..verts_num" rim-vertex ordering.
    const verts: BMVert[] = []
    const vertIndex = new Map<BMVert, number>()
    const edges: BMEdge[] = []
    const edgeIndex = new Map<BMEdge, number>()
    const faceIndex = new Map<BMFace, number>()
    /** The region corners at each vertex, which is Blender's `vert_to_face_map` with the loop kept. */
    const vertCorners: BMLoop[][] = []
    for (const f of region) {
        faceIndex.set(f, faceIndex.size)
        for (const l of f.eachLoop()) {
            let vi = vertIndex.get(l.v)
            if (vi === undefined) {
                vi = verts.length
                vertIndex.set(l.v, vi)
                verts.push(l.v)
                vertCorners.push([])
            }
            vertCorners[vi].push(l)
            const e = l.e!
            if (!edgeIndex.has(e)) {
                edgeIndex.set(e, edges.length)
                edges.push(e)
            }
        }
    }
    const vertsNum = verts.length

    // `smd` unpacked, `:180-197`.
    const thickness = opts.thickness ?? 0.01
    const offsetFac = opts.offset ?? -1
    const offsetClamp = opts.offsetClamp ?? 0
    // `mat_nr_max = ctx->object->totcol > 1 ? totcol - 1 : 0`, and the offsets are dropped entirely
    // when there is nothing to offset into.
    const matNrMax = bm.materials.length > 1 ? bm.materials.length - 1 : 0
    const matOfs = matNrMax ? Math.trunc(opts.materialOffset ?? 0) : 0
    const matOfsRim = matNrMax ? Math.trunc(opts.materialOffsetRim ?? 0) : 0
    const creaseRim = opts.creaseRim ?? 0
    const creaseOuter = opts.creaseOuter ?? 0
    const creaseInner = opts.creaseInner ?? 0
    const bevelConvex = opts.bevelConvex ?? 0

    const ofsOrig = -(((-offsetFac + 1) * 0.5) * thickness)
    const ofsNew = thickness + ofsOrig
    const doFlip = opts.flipNormals === true
    const doClamp = offsetClamp !== 0
    const doAngleClamp = doClamp && opts.useAngleClamp === true
    const doBevelConvex = bevelConvex !== 0
    const doRim = opts.useRim !== false
    const doShell = !(doRim && opts.useRimOnly === true)
    const doEven = opts.useEvenOffset === true
    const doHqNormals = opts.useHighQualityNormals === true

    const newEdgesBefore = new Set(bm.edges)

    // region normals

    // `need_face_normals` is effectively always true for this port, because every path below wants
    // face normals; Blender only guards it to skip the computation on the cheapest settings.
    const faceNormals: Vec3[] = region.map(faceNormalCalc)

    /**
     * `mesh->vert_normals_true()` - `normals_calc_verts` (`mesh_normals.cc:194`): each face normal
     * weighted by the interior angle of that face's corner at this vertex.
     *
     * Blender weights with `math::safe_acos_approx`, a float32 polynomial with up to 4.5e-5 of error
     * that exists to make normal recalculation fast on million-vertex meshes. Doubles here, and an
     * exact `acos`, are strictly closer to the value the approximation is approximating.
     *
     * Note the convention: this is the *interior* angle, unlike the corner weight the even-offset
     * pass uses further down, which is `pi` minus it. Both are ported as found.
     */
    const vertNormals: Vec3[] = new Array(vertsNum)
    for (let i = 0; i < vertsNum; i++) {
        const v = verts[i]
        let acc: Vec3 = [0, 0, 0]
        for (const l of vertCorners[i]) {
            const dirPrev = v3normalize([l.prev.v.x - v.x, l.prev.v.y - v.y, l.prev.v.z - v.z])
            const dirNext = v3normalize([l.next.v.x - v.x, l.next.v.y - v.y, l.next.v.z - v.z])
            const factor = Math.acos(Math.max(-1, Math.min(1, v3dot(dirPrev, dirNext))))
            acc = v3add(acc, v3mul(faceNormals[faceIndex.get(l.f)!], factor))
        }
        vertNormals[i] = v3normalize(acc)
    }

    /**
     * `edge_tmp_tag`, the `USE_NONMANIFOLD_WORKAROUND` bitmap (`:42`, for #35710): edges with three
     * or more faces, whose "shell thickness" is meaningless. Only `mesh_calc_hq_normal` fills it, so
     * it is only consulted when high-quality normals are on - Blender's `check_non_manifold`.
     */
    const edgeTmpTag: boolean[] = new Array(edges.length).fill(false)

    /**
     * `mesh_calc_hq_normal` (`:59`): accumulate an *edge* normal into both of its endpoints, where a
     * manifold edge contributes the angle-weighted bisector of its two faces and a boundary edge
     * contributes its single face normal. A vertex that accumulates nothing falls back to the plain
     * vertex normal.
     */
    const vertNors: Vec3[] = doHqNormals ? new Array(vertsNum) : vertNormals
    if (doHqNormals) {
        // `EdgeFaceRef`: up to two face users per edge, then -1/-1 for "3+ faces, can't handle".
        const edgeRef: (number[] | null)[] = new Array(edges.length).fill(null)
        for (const f of region) {
            const fi = faceIndex.get(f)!
            for (const l of f.eachLoop()) {
                const ei = edgeIndex.get(l.e!)!
                const ref = edgeRef[ei]
                if (ref === null) edgeRef[ei] = [fi, -1]
                else if (ref[0] !== -1 && ref[1] === -1) ref[1] = fi
                else {
                    ref[0] = -1
                    ref[1] = -1
                    edgeTmpTag[ei] = true
                }
            }
        }
        const acc: Vec3[] = new Array(vertsNum)
        for (let i = 0; i < vertsNum; i++) acc[i] = [0, 0, 0]
        for (let ei = 0; ei < edges.length; ei++) {
            const ref = edgeRef[ei]
            if (!ref || ref[0] === -1) continue
            const edgeNormal = ref[1] !== -1
                ? midAngleWeighted(faceNormals[ref[0]], faceNormals[ref[1]])
                : faceNormals[ref[0]]
            const e = edges[ei]
            const i1 = vertIndex.get(e.v1)!
            const i2 = vertIndex.get(e.v2)!
            acc[i1] = v3add(acc[i1], edgeNormal)
            acc[i2] = v3add(acc[i2], edgeNormal)
        }
        for (let i = 0; i < vertsNum; i++) {
            // `if (normalize_v3(r_vert_nors[i]) == 0.0f) copy_v3_v3(r_vert_nors[i], vert_normals[i])`.
            vertNors[i] = v3len(acc[i]) === 0 ? vertNormals[i] : v3normalize(acc[i])
        }
    }

    // endregion

    // region rim scan

    /**
     * Blender's `edge_users` / `edge_order` (`:255-281`), which between them say "exactly one face
     * uses this edge, it is this face, it walks the edge this way round, and the edge starts at this
     * corner of it". A BMesh loop is all four facts at once, so the rim loop is stored directly and
     * `INVALID_PAIR` becomes `null` with `edgePaired` set.
     */
    const rimLoop: (BMLoop | null)[] = new Array(edges.length).fill(null)
    const edgePaired: boolean[] = new Array(edges.length).fill(false)
    if (doRim) {
        for (const f of region) {
            for (const l of f.eachLoop()) {
                const ei = edgeIndex.get(l.e!)!
                if (edgePaired[ei]) continue
                if (rimLoop[ei] === null) rimLoop[ei] = l
                else {
                    rimLoop[ei] = null
                    edgePaired[ei] = true
                }
            }
        }
    }

    /** `new_edge_arr`: the rim edges, in edge order. */
    const rimEdgeIndices: number[] = []
    /** `new_vert_arr` / `old_vert_arr`: the vertices on a rim edge, in vertex order. */
    const rimVertIndices: number[] = []
    if (doRim) {
        const rimVertTag: boolean[] = new Array(vertsNum).fill(false)
        for (let ei = 0; ei < edges.length; ei++) {
            if (rimLoop[ei] === null) continue
            rimEdgeIndices.push(ei)
            rimVertTag[vertIndex.get(edges[ei].v1)!] = true
            rimVertTag[vertIndex.get(edges[ei].v2)!] = true
        }
        for (let i = 0; i < vertsNum; i++) if (rimVertTag[i]) rimVertIndices.push(i)
    }

    // endregion

    // region build the second surface

    // `vert_interp.copy(0, verts_num, verts_num)`, or under `use_rim_only` the sparse copy at `:369`
    // that duplicates only the rim vertices. `vertCreate(..., example)` is the interpolator's copy:
    // it brings the vertex's attribute block and header flags across.
    const dupVerts: (BMVert | null)[] = new Array(vertsNum).fill(null)
    const vertMap = new Map<BMVert, BMVert>()
    const duplicateVert = (i: number): void => {
        const v = verts[i]
        const nv = bm.vertCreate(v.x, v.y, v.z, v)
        nv.hflag &= ~ElemFlag.Select
        dupVerts[i] = nv
        vertMap.set(v, nv)
    }
    if (doShell) for (let i = 0; i < vertsNum; i++) duplicateVert(i)
    else for (const i of rimVertIndices) duplicateVert(i)

    /**
     * The inner surface: the input faces copied with their winding reversed.
     *
     * Blender does it by copying corner `j` of the original to corner `loop_end - j_prev` of the copy
     * (`:441`), which is `dst[0] = src[0]` and `dst[n - j] = src[j]` - the first vertex stays put and
     * the rest run backwards, "ensures the diagonals in the new face match the original". That is the
     * same ordering as `bke::mesh_flip_faces`, which `generate/mirror.ts` already ports. The corner
     * *edge* rotation that follows it in Blender (`:461`) has no equivalent: `faceCreate` derives each
     * corner's edge from the corner order it is given.
     *
     * Without this reversal the copy faces the same way the input does, so the finished shell has its
     * lining pointing the same way as its skin. It validates and it renders; it is inside out.
     */
    const innerFaces: BMFace[] = []
    if (doShell) {
        for (const f of region) {
            const src = [...f.eachLoop()]
            const order = [src[0], ...src.slice(1).reverse()]
            const nf = bm.faceCreate(order.map(l => dupVerts[vertIndex.get(l.v)!]!), f)
            nf.hflag &= ~ElemFlag.Select
            const dst = [...nf.eachLoop()]
            for (let i = 0; i < order.length; i++) copyElemAttrs(order[i], dst[i], bm.ldata)
            // `dst_material_index.span[faces_num + i] += mat_ofs; CLAMP(..., 0, mat_nr_max)`.
            if (matOfs) nf.matNr = Math.max(0, Math.min(matNrMax, nf.matNr + matOfs))
            innerFaces.push(nf)
        }
    }

    // endregion

    // region offsets

    /**
     * Port of the `INIT_VERT_ARRAY_OFFSETS(test)` macro (`:403`), which is where `use_flip_normals`
     * lives and where the two offsets are handed to the two surfaces.
     *
     * `((ofs_new >= ofs_orig) == do_flip) == test` decides whether this offset lands on the input
     * block or on the copy. Unflipped and with a positive thickness, `ofs_new` goes to the *input*
     * vertices and `ofs_orig` to the copies - which reads backwards until you notice that the larger
     * of the two always goes to the block whose faces are wound outward. Flipping swaps them, so the
     * reversed copy is the one that ends up outside, and the shell is inside out without a single
     * face having been touched.
     *
     * `fn` is given the vertex to move and two indices: `i`, the input vertex the normal and the
     * clamp belong to, and `iOrig`, Blender's loop counter. They differ only in the `use_rim_only`
     * case, where the loop runs over `new_vert_arr` instead of over every vertex.
     */
    const forEachOffsetTarget = (test: boolean, fn: (target: BMVert, i: number, iOrig: number) => void): void => {
        if (((ofsNew >= ofsOrig) === doFlip) === test) {
            // `i_end = verts_num; do_shell_align = true; vert_index = 0`.
            for (let i = 0; i < vertsNum; i++) fn(verts[i], i, i)
        } else if (doShell) {
            // `i_end = verts_num; do_shell_align = true; vert_index = verts_num`.
            for (let i = 0; i < vertsNum; i++) fn(dupVerts[i]!, i, i)
        } else {
            // `i_end = newVerts; do_shell_align = false; vert_index = verts_num`.
            for (let iOrig = 0; iOrig < rimVertIndices.length; iOrig++) {
                const i = rimVertIndices[iOrig]
                fn(dupVerts[i]!, i, iOrig)
            }
        }
    }

    const madd = (v: BMVert, n: Vec3, s: number): void => {
        v.x += n[0] * s
        v.y += n[1] * s
        v.z += n[2] * s
    }

    /**
     * `vert_lens` / `vert_lens_sq`: the squared length of the shortest edge at each vertex, which is
     * what {@link SolidifyOptions.offsetClamp} measures against. Read before anything moves, which is
     * also when Blender reads it - both blocks still hold the input positions at that point.
     */
    const shortestEdgeSq = (): number[] => {
        const out: number[] = new Array(vertsNum).fill(Infinity)
        for (const e of edges) {
            const dx = e.v1.x - e.v2.x
            const dy = e.v1.y - e.v2.y
            const dz = e.v1.z - e.v2.z
            const lenSq = dx * dx + dy * dy + dz * dz
            const i1 = vertIndex.get(e.v1)!
            const i2 = vertIndex.get(e.v2)!
            if (lenSq < out[i1]) out[i1] = lenSq
            if (lenSq < out[i2]) out[i2] = lenSq
        }
        return out
    }

    /**
     * `edge_user_pairs` (`:497` and `:800`): the two faces on an edge, kept apart by which way round
     * each of them walks it, so that the dihedral angle between them has a sign.
     *
     * Blender picks the slot with `(prev_vert_i > vert_i) == (edge[0] < edge[1])`, which is an index
     * comparison standing in for a direction: work it through for both orderings of `edge` and it is
     * exactly "this face walks the edge from `v2` to `v1`". A BMesh loop says that directly.
     *
     * Returns `null` per edge unless both slots are filled by exactly one face each.
     */
    const edgeUserPairs = (): (number[] | null)[] => {
        const pairs: (number[] | null)[] = new Array(edges.length)
        for (let i = 0; i < edges.length; i++) pairs[i] = [-1, -1]
        for (const f of region) {
            const fi = faceIndex.get(f)!
            for (const l of f.eachLoop()) {
                const e = l.e!
                const ei = edgeIndex.get(e)!
                const pair = pairs[ei]
                if (pair === null) continue
                const flip = l.v === e.v2 ? 1 : 0
                if (pair[flip] === -1) pair[flip] = fi
                else pairs[ei] = null
            }
        }
        for (let i = 0; i < edges.length; i++) {
            const pair = pairs[i]
            if (pair && (pair[0] === -1 || pair[1] === -1)) pairs[i] = null
        }
        return pairs
    }

    /**
     * `vert_angs` for the angle clamp and `edge_angs` for `bevel_convex`, both built from the same
     * pass over the edge pairs. `signedAngles` picks the `angle_signed_on_axis_v3v3_v3` form the
     * non-even branch uses (`:551`) over the `M_PI - angle_normalized_v3v3` form the even branch uses
     * (`:869`); they are different measures of the same fold and each branch wants its own.
     */
    const edgeAngles = (signedAngles: boolean): {vertAngs: number[], edgeAngs: number[], paired: boolean[]} => {
        const vertAngs: number[] = new Array(vertsNum).fill(0.5 * Math.PI)
        const edgeAngs: number[] = new Array(edges.length).fill(0)
        const paired: boolean[] = new Array(edges.length).fill(false)
        const pairs = edgeUserPairs()
        for (let ei = 0; ei < edges.length; ei++) {
            const pair = pairs[ei]
            if (!pair) continue
            const e = edges[ei]
            const n0 = faceNormals[pair[0]]
            const n1 = faceNormals[pair[1]]
            paired[ei] = true
            const i1 = vertIndex.get(e.v1)!
            const i2 = vertIndex.get(e.v2)!
            if (signedAngles || doBevelConvex) {
                const axis = v3normalize([e.v1.x - e.v2.x, e.v1.y - e.v2.y, e.v1.z - e.v2.z])
                edgeAngs[ei] = angleSignedOnAxis(n0, n1, axis)
            }
            if (doAngleClamp) {
                const angle = signedAngles ? edgeAngs[ei] : Math.PI - angleNormalized(n0, n1)
                if (angle > vertAngs[i1]) vertAngs[i1] = angle
                if (angle > vertAngs[i2]) vertAngs[i2] = angle
            }
        }
        return {vertAngs, edgeAngs, paired}
    }

    /**
     * `bevel_convex`'s write-out (`:669` and `:905`), shared by both branches.
     *
     * One deliberate divergence, and the only one in this file that is not a BMesh/array difference.
     * Blender gates the write on `edge_users[i] == INVALID_PAIR` and reads the angle from
     * `edge_angs[i]`, but under `!do_rim` it allocates *both* arrays with
     * `MEM_new_array_uninitialized` and writes only the entries of edges that have a valid face pair
     * (`:531` and `:560`). Any edge without one - a boundary edge, a three-face edge - therefore
     * decides its bevel weight from uninitialised memory. That is a bug, not a behaviour, and there
     * is no faithful way to port it. The write happens here for exactly the edges whose angle was
     * computed, which is what the guarded path means to say.
     */
    const applyBevelConvex = (edgeAngs: number[], paired: boolean[]): void => {
        const layer = bm.addLayer('edge', AttrName.bevelWeightEdge, 'float')
        const convexAdd = Math.max(0, Math.min(1, bevelConvex))
        const concaveAdd = Math.max(-1, Math.min(0, bevelConvex))
        for (let ei = 0; ei < edges.length; ei++) {
            if (!paired[ei]) continue
            const angle = edgeAngs[ei]
            const e = edges[ei]
            const outer = Math.max(0, Math.min(1,
                getComponent(e, layer) + (angle < Math.PI ? convexAdd : concaveAdd)))
            setComponent(e, bm.edata, layer, 0, outer)
            if (doShell) {
                // The same edge on the inner surface, which folds the other way, hence the flipped test.
                const inner = diskEdgeExists(dupVerts[vertIndex.get(e.v1)!]!, dupVerts[vertIndex.get(e.v2)!]!)
                if (inner) {
                    const w = Math.max(0, Math.min(1,
                        getComponent(inner, layer) + (angle > Math.PI ? convexAdd : concaveAdd)))
                    setComponent(inner, bm.edata, layer, 0, w)
                }
            }
        }
    }

    if (!doEven) {
        // `(smd->flag & MOD_SOLIDIFY_EVEN) == 0` - "no even thickness, very simple" (`:476`).
        const vertLens = doClamp ? shortestEdgeSq() : null
        const offset = Math.abs(thickness) * offsetClamp
        const offsetSq = offset * offset

        let vertAngs: number[] | null = null
        if (doAngleClamp || doBevelConvex) {
            const built = edgeAngles(true)
            if (doAngleClamp) vertAngs = built.vertAngs
            if (doBevelConvex) applyBevelConvex(built.edgeAngs, built.paired)
        }

        /**
         * One vertex of one of the two offset loops (`:576` and `:619`). They are the same code twice
         * in Blender apart from the angle-clamp expression, which differs because the signed dihedral
         * angle is measured from the outer side: the outer surface sees `2pi - angle`, the inner sees
         * `angle`.
         */
        const move = (target: BMVert, i: number, iOrig: number, amount: number, isOrig: boolean): void => {
            let ofs = amount
            if (doClamp && offset > FLT_EPSILON) {
                if (doAngleClamp) {
                    // Blender indexes `vert_angs` with `i_orig` in the `ofs_orig` loop and with `i` in
                    // the `ofs_new` one (`:642` against `:606`). The two agree except under
                    // `use_rim_only`, where `i_orig` counts rim vertices and `i` counts vertices, so
                    // the inner loop reads a different vertex's angle. Ported as written - it is
                    // Blender's behaviour, not a transcription slip, and second-guessing it here would
                    // make this file disagree with the modifier it claims to be.
                    const ang = isOrig ? vertAngs![iOrig] : vertAngs![i]
                    const cosAng = Math.cos((isOrig ? ang : (2 * Math.PI) - ang) * 0.5)
                    if (cosAng > 0) {
                        const maxOff = Math.sqrt(vertLens![i]) * 0.5 / cosAng
                        if (maxOff < offset * 0.5) ofs *= maxOff / offset * 2
                    }
                } else if (vertLens![i] < offsetSq) {
                    ofs *= Math.sqrt(vertLens![i]) / offset
                }
            }
            madd(target, vertNors[i], ofs)
        }

        if (ofsNew !== 0) {
            forEachOffsetTarget(false, (t, i, iOrig) => move(t, i, iOrig, ofsNew, false))
        }
        if (ofsOrig !== 0) {
            forEachOffsetTarget(true, (t, i, iOrig) => move(t, i, iOrig, ofsOrig, true))
        }
    } else {
        // `MOD_SOLIDIFY_EVEN` (`:695`). Every corner of every face votes on how far its vertex has to
        // travel along the vertex normal for the surface to clear *that* face by the full thickness;
        // the votes are averaged, weighted by corner angle.
        const vertAngles: number[] = new Array(vertsNum).fill(0)
        const vertAccum: number[] = new Array(vertsNum).fill(0)
        // `check_non_manifold`: the 3+-face workaround only has data to work from under HQ normals.
        const checkNonManifold = doHqNormals

        for (const f of region) {
            const fi = faceIndex.get(f)!
            const loops = [...f.eachLoop()]
            const n = loops.length
            // `bke::mesh::face_angles_calc` inlined (`mesh_evaluate.cc:201`). Note what it returns:
            // `nor_prev` runs from the corner to its predecessor and `nor_next` from the corner to
            // its successor *reversed*, so the angle is `pi` minus the interior angle. `angle_quad_v3`
            // in the same library subtracts it from `pi` to get the interior angle and this does not.
            // The weights are what they are in Blender; they are not the vertex-normal weights above.
            let iCurr = n - 1
            let iNext = 0
            let norPrev = v3normalize([
                loops[iCurr - 1].v.x - loops[iCurr].v.x,
                loops[iCurr - 1].v.y - loops[iCurr].v.y,
                loops[iCurr - 1].v.z - loops[iCurr].v.z,
            ])
            while (iNext < n) {
                const norNext = v3normalize([
                    loops[iCurr].v.x - loops[iNext].v.x,
                    loops[iCurr].v.y - loops[iNext].v.y,
                    loops[iCurr].v.z - loops[iNext].v.z,
                ])
                // `angle = std::max(angle, FLT_EPSILON)` - a zero weight would drop the corner.
                const angle = Math.max(angleNormalized(norPrev, norNext), FLT_EPSILON)
                const vidx = vertIndex.get(loops[iCurr].v)!
                vertAccum[vidx] += angle

                const eCurr = edgeIndex.get(loops[iCurr].e!)!
                const eNext = edgeIndex.get(loops[iNext].e!)!
                if (!checkNonManifold || (!edgeTmpTag[eCurr] && !edgeTmpTag[eNext])) {
                    vertAngles[vidx] += shellNormalizedToDist(vertNors[vidx], faceNormals[fi]) * angle
                } else {
                    // "skip shell thickness for non-manifold edges, see #35710" - a weight of 1 means
                    // this corner asks for no correction at all.
                    vertAngles[vidx] += angle
                }

                norPrev = norNext
                iCurr = iNext
                iNext++
            }
        }

        let vertAngs: number[] | null = null
        if (doAngleClamp || doBevelConvex) {
            const built = edgeAngles(false)
            if (doAngleClamp) vertAngs = built.vertAngs
            if (doBevelConvex) applyBevelConvex(built.edgeAngs, built.paired)
        }

        if (doClamp) {
            // `:882`. The angle clamp widens the clamp distance by the offset placement, because with
            // the shell pushed to one side the far surface has further to go before it self-crosses.
            const clampFac = 1 + (doAngleClamp ? Math.abs(offsetFac) : 0)
            const offset = Math.abs(thickness) * offsetClamp * clampFac
            if (offset > FLT_EPSILON) {
                const vertLensSq = shortestEdgeSq()
                const offsetSq = offset * offset
                if (doAngleClamp) {
                    for (let i = 0; i < vertsNum; i++) {
                        const cosAng = Math.cos(vertAngs![i] * 0.5)
                        if (cosAng > 0) {
                            const maxOff = Math.sqrt(vertLensSq[i]) * 0.5 / cosAng
                            if (maxOff < offset * 0.5) vertAngles[i] *= maxOff / offset * 2
                        }
                    }
                } else {
                    for (let i = 0; i < vertsNum; i++) {
                        if (vertLensSq[i] < offsetSq) {
                            vertAngles[i] *= Math.sqrt(vertLensSq[i]) / offset
                        }
                    }
                }
            }
        }

        // `:931` and `:948`. `vert_accum` is zero only for a vertex no face voted on, which cannot
        // happen for a region vertex; the guard is Blender's and is kept because it is free.
        const move = (target: BMVert, i: number, amount: number): void => {
            if (!vertAccum[i]) return
            madd(target, vertNors[i], amount * (vertAngles[i] / vertAccum[i]))
        }
        if (ofsNew !== 0) forEachOffsetTarget(false, (t, i) => move(t, i, ofsNew))
        if (ofsOrig !== 0) forEachOffsetTarget(true, (t, i) => move(t, i, ofsOrig))
    }

    // endregion

    // region rim

    const rimFaces: BMFace[] = []
    if (doRim) {
        const creaseLayer = (creaseRim || creaseOuter || creaseInner)
            ? bm.addLayer('edge', AttrName.creaseEdge, 'float')
            : null
        const vertBweight = bm.vdata.get(AttrName.bevelWeightVert)
        const edgeBweight = vertBweight ? bm.addLayer('edge', AttrName.bevelWeightEdge, 'float') : null

        for (const ei of rimEdgeIndices) {
            const l = rimLoop[ei]!
            const e = edges[ei]
            // `a -> b` is how the one region face on this edge walks it.
            const a = l.v
            const b = l.next.v
            const a2 = dupVerts[vertIndex.get(a)!]!
            const b2 = dupVerts[vertIndex.get(b)!]!

            /**
             * `:1063-1094`, both arms of Blender's `flip`. They look like two windings and are one:
             * the unflipped arm emits `edge[0], edge[1], edge[1]', edge[0]'` for a face that walks
             * `edge[1] -> edge[0]`, and the flipped arm emits `edge[1], edge[0], edge[0]', edge[1]'`
             * for a face that walks `edge[0] -> edge[1]`. Both are "cross the shared edge against the
             * region face, then come back along the copy", which in loop terms is this one line. The
             * `flip` bit exists because Blender stored a face index and needed somewhere to put the
             * direction; a loop carries it.
             *
             * The winding matters twice over. Against the input face, which walks `a -> b`, the rim
             * walks `b -> a`, so the two agree across the edge. Against the inner face, which walks
             * `b' -> a'` because it was reversed, the rim walks `a' -> b'`, so they agree too. Get it
             * backwards and the rim is the only part of the shell facing inward.
             */
            const rim = bm.faceCreate([b, a, a2, b2], l.f)
            rim.hflag &= ~ElemFlag.Select
            // `corner_interp.copy(k2/k1/k1/k2, ...)` at `:1057`: `k2` is the corner the edge arrives
            // at and `k1` the one it leaves from, which are `l.next` and `l`.
            const dst = [...rim.eachLoop()]
            const src = [l.next, l, l, l.next]
            for (let i = 0; i < 4; i++) copyElemAttrs(src[i], dst[i], bm.ldata)
            if (matOfsRim) rim.matNr = Math.max(0, Math.min(matNrMax, rim.matNr + matOfsRim))
            rimFaces.push(rim)

            const vertical = [diskEdgeExists(a, a2), diskEdgeExists(b, b2)]
            if (edgeBweight && vertBweight) {
                // `result_edge_bweight.span[new_edge_index] = orig_vert_bweight[new_vert_arr[i]]`:
                // the new edge across the shell inherits the weight of the vertex it springs from.
                for (const [v, ve] of [[a, vertical[0]], [b, vertical[1]]] as [BMVert, BMEdge | null][]) {
                    if (ve) setComponent(ve, bm.edata, edgeBweight, 0, getComponent(v, vertBweight))
                }
            }
            if (creaseLayer && creaseRim) {
                for (const ve of vertical) {
                    if (ve) setComponent(ve, bm.edata, creaseLayer, 0, creaseRim)
                }
            }
            // "crease += crease_outer; without wrapping".
            if (creaseLayer && creaseOuter) {
                setComponent(e, bm.edata, creaseLayer, 0,
                    Math.min(1, getComponent(e, creaseLayer) + creaseOuter))
            }
            if (creaseLayer && creaseInner) {
                const inner = diskEdgeExists(a2, b2)
                if (inner) {
                    setComponent(inner, bm.edata, creaseLayer, 0,
                        Math.min(1, getComponent(inner, creaseLayer) + creaseInner))
                }
            }
        }
    }

    // endregion

    const newEdges = [...bm.edges].filter(e => !newEdgesBefore.has(e))
    const newFaces = [...innerFaces, ...rimFaces]

    if (opts.selectResult !== false) {
        selectNone(bm)
        for (const f of region) faceSelectSet(bm, f, true)
        for (const f of newFaces) faceSelectSet(bm, f, true)
        for (const v of verts) vertSelectSet(bm, v, true)
        for (const v of vertMap.values()) vertSelectSet(bm, v, true)
    }

    return {
        faces: newFaces,
        verts: [...vertMap.values()],
        edges: newEdges,
        innerFaces,
        rimFaces,
        vertMap,
    }
}

/**
 * Solidify the selected faces.
 *
 * Returns null when nothing is selected, which is the only thing the modifier has no equivalent for -
 * it always runs on the whole mesh.
 */
export function solidifySelection(bm: BMesh, opts: SolidifyOptions = {}): SolidifyResult | null {
    const faces = [...bm.faces].filter(f => f.hflag & ElemFlag.Select)
    if (!faces.length) return null
    return solidify(bm, faces, opts)
}
