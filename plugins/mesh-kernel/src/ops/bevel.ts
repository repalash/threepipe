/**
 * Bevel.
 *
 * Ported from `source/blender/bmesh/operators/bmo_bevel.cc` (the thin wrapper that decides what is
 * beveled) and `source/blender/bmesh/tools/bmesh_bevel.cc` (`BM_mesh_bevel`, the whole of it). This
 * file is the entry point; the port is split across eight modules because 8.5k lines of C do not
 * belong in one TypeScript file:
 *
 * | file | Blender range | what |
 * | --- | --- | --- |
 * | `bevel-math.ts` | `blenlib` | the float-array vector maths, in Blender's calling convention |
 * | `bevel-bmquery.ts` | `bmesh_query.cc`, `bmesh_polygon.cc` | BMesh queries `src/bmesh` lacks |
 * | `bevel-types.ts` | `:74-428` | `BevVert`, `EdgeHalf`, `BoundVert`, `VMesh`, `Profile`, ... |
 * | `bevel-offset.ts` | `:1643-2260` | `offset_meet` and the rest of the offset geometry |
 * | `bevel-profile.ts` | `:2262-2830`, `:7623-8010` | profile parameters, superellipse, spacing |
 * | `bevel-create.ts` | `:757-1170`, `:5259-5500` | `bev_create_ngon`, rep faces, the UV merge |
 * | `bevel-boundary.ts` | `:1309-1640`, `:2832-3000`, `:3182-3762` | `build_boundary` and the miters |
 * | `bevel-construct.ts` | `:6583-7115` | edge ordering and `bevel_vert_construct` |
 * | `bevel-vmesh.ts` | `:4347-6580` | the corner surface and all its special cases |
 * | `bevel-adjust.ts` | `:3942-4346` | the width-evening least-squares pass |
 * | `bevel-build.ts` | `:7117-7620`, `:8012-8236` | face rebuild, edge polygons, clamping |
 *
 * ## The shape of the algorithm
 *
 * Bevel does not edit as it goes. It builds a complete description of the answer first - one
 * `BevVert` per beveled vertex, each holding an `EdgeHalf` per incident edge and a cyclic boundary
 * of `BoundVert`s - then instantiates it. In order:
 *
 * 1. `bevelVertConstruct` orders each vertex's edges CCW and turns the requested offset into a
 *    per-side distance, which is where the five `offsetType`s stop meaning the same thing.
 * 2. `buildBoundary` places the boundary vertices, using `offsetMeet` on the angle bisector, or a
 *    point slid along an intervening edge when `loopSlide` applies.
 * 3. `bevelLimitOffset`, when `clampOverlap` is on, finds the largest offset at which nothing
 *    collides and rescales every spec by the same factor, then the boundaries are rebuilt.
 * 4. `adjustOffsets` evens out the widths across chains and cycles of dependent offsets.
 * 5. `buildVmesh` makes the BMVerts and fills each corner with the appropriate `MeshKind`.
 * 6. `bevelBuildEdgePolygons` bridges the two sides of each beveled edge.
 * 7. `bevelRebuildExistingPolygons` rebuilds every original face that touched a beveled vertex, and
 *    the originals are then killed.
 *
 * ## Out of scope
 *
 * Stated here rather than stubbed silently, as the brief requires:
 *
 * - **`bevel_harden_normals` (`:3006`) and `bevel_set_weighted_normal_face_strength` (`:3135`).**
 *   Both operate on `CD_CUSTOMLOOPNORMAL` through `BM_lnorspace_update` and the loop-normal space
 *   machinery, none of which exists in this kernel. `BevelOptions` has no `hardenNormals` or
 *   `faceStrengthMode` as a result. `bevel_edges_sharp_boundary` (`:2971`) *is* ported, in
 *   `bevel-boundary.ts`, because it only sets the edge smooth flag.
 * - **Vertex-group and bevel-weight offsets.** `BM_mesh_bevel`'s `dvert`, `vertex_group`,
 *   `use_weights`, `bweight_offset_vert` and `bweight_offset_edge` are absent. There is no
 *   deform-vertex domain here, and the bevel-weight attributes exist but nothing maintains them.
 *   Every place Blender multiplies by a weight is marked in the ported source; with weights off the
 *   factor is 1 and the multiplication drops out, so the arithmetic is unchanged, not approximated.
 * - **Custom profiles (`CurveProfile`).** The `Profile`/`ProfileSpacing` structures carry the
 *   `profileType` field and every `BEVEL_PROFILE_CUSTOM` branch is ported, but the *sampler* -
 *   `BKE_curveprofile_init` and the widget's Bezier table in `blenkernel/intern/curveprofile.cc` -
 *   is a separate several-hundred-line subsystem with its own data model, and it is not here.
 *   `setProfileSpacing` throws if asked for one. So the structures did not make it cheap, and it is
 *   not half-done: `BevelOptions` simply has no custom profile.
 * - **`adjust_the_cycle_or_chain_fast` (`:3859`)** is inside `#ifdef FAST_ADJUST_CODE`, which
 *   Blender never defines, and its own comment says its results are sometimes worse. Not ported.
 *
 * One further substitution, described in full in `bevel-adjust.ts`: the least-squares solve in
 * `adjustTheCycleOrChain` uses dense normal equations instead of Eigen. Eigen is a general numerical
 * library rather than a Blender algorithm, and the contract - the minimiser of `||Ax - b||` - is
 * identical.
 *
 * ## Divergences from Blender, all deliberate
 *
 * - **Normals are recomputed on entry.** Bevel reads `f->no` and `v->no` throughout and edit mode
 *   keeps them current; nothing in this kernel does, so `normalsUpdate` runs first. Same deliberate
 *   whole-mesh side effect as `ops/inset.ts`.
 * - **`VERT_OUT` / `EDGE_OUT` are sets, not an operator flag layer.** The kernel has no `BMO_*_flag`
 *   layer; `BevelParams.outVerts` / `outEdges` have exactly the same lifetime and meaning.
 * - **`BM_elem_attrs_copy`'s header rule is applied by hand.** See `bevel-create.ts`; this is the
 *   same local workaround `ops/inset.ts` carries, for the same open issue.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {edgeIsManifold} from '../bmesh/structure'
import {ElemFlag} from '../constants'
import {edgeSelectSet, faceSelectSet, selectNone, vertSelectSet} from '../bmesh/marking'
import {maxIi} from './bevel-math'
import {
    BEVEL_AFFECT, BEVEL_AMT, BEVEL_MITER, BEVEL_PROFILE, BEVEL_VMESH, BevelParams, FKind,
    PRO_CIRCLE_R, PRO_LINE_R, PRO_SQUARE_IN_R, PRO_SQUARE_R, findBevVert, getFaceKind,
    newProfileSpacing,
} from './bevel-types'
import {normalsUpdate} from './bevel-bmquery'
import {findProfileFullness, setProfileSpacing} from './bevel-profile'
import {bevelExtendEdgeData, buildBoundary, mathLayerInfoInit} from './bevel-boundary'
import {bevelMergeUvs, determineUvVertConnectivity, uvVertMapInit, uvVertMapPop} from './bevel-create'
import {bevelVertConstruct} from './bevel-construct'
import {buildVmesh} from './bevel-vmesh'
import {adjustOffsets, regularizeProfileOrientation} from './bevel-adjust'
import {
    bevelBuildEdgePolygons, bevelLimitOffset, bevelReattachWires, bevelRebuildExistingPolygons,
} from './bevel-build'

// region public API

/** How the `offset` number is measured. */
export type BevelOffsetType =
    /** The distance from the original edge, measured in each adjacent face. Blender's default. */
    | 'offset'
    /** The width of the new face itself: `offset / (2 sin(angle / 2))`. */
    | 'width'
    /** The perpendicular distance from the original edge to the new surface: `offset / cos(angle / 2)`. */
    | 'depth'
    /** A percentage of the length of each adjacent edge. */
    | 'percent'
    /** An absolute distance measured along each adjacent edge. */
    | 'absolute'

export interface BevelOptions {
    /** How far to bevel. Nothing happens at or below zero, exactly as `BM_mesh_bevel` returns early. */
    offset?: number
    /** How {@link offset} is measured. Default `'offset'`. */
    offsetType?: BevelOffsetType
    /**
     * Profile shape, 0 to 1. `0.5` is a circular arc; towards 1 it squares outwards and towards 0 it
     * squares inwards. Converted to the superellipse exponent `r = -log(2) / log(sqrt(profile))`.
     */
    profile?: number
    /** Number of segments across the bevel. 1 is a flat chamfer. */
    segments?: number
    /**
     * Bevel the vertices themselves rather than the edges. Blender's `affect`.
     * Only {@link bevelSelection} reads this; {@link bevelEdges} and {@link bevelVerts} already say
     * which they are.
     */
    affectVerts?: boolean
    /** Limit the offset so the result does not self-intersect. Blender's `clamp_overlap`. */
    clampOverlap?: boolean
    /** Material slot for the new faces. Negative (the default) takes it from the adjacent faces. */
    materialIndex?: number
    /** Prefer sliding along an existing edge to keeping the requested widths. Default true. */
    loopSlide?: boolean
    /** Propagate UV seam marks across the bevel. */
    markSeam?: boolean
    /** Propagate sharp-edge marks across the bevel. */
    markSharp?: boolean
    /** Miter pattern on reflex corners. Default `'sharp'`. */
    miterOuter?: 'sharp' | 'patch' | 'arc'
    /** Miter pattern on non-reflex corners. Default `'sharp'`. */
    miterInner?: 'sharp' | 'arc'
    /** How far apart to spread an inside miter. */
    spread?: number
    /** How to fill the corner between profiles. Default `'adjacent'`. */
    vmeshMethod?: 'adjacent' | 'cutoff'
    /** Select the result and deselect everything else. Default true. */
    selectResult?: boolean
}

export interface BevelResult {
    /** The faces bevel created, Blender's `faces.out`. */
    faces: BMFace[]
    /** The vertices bevel created, `verts.out`. */
    verts: BMVert[]
    /** The edges bevel created, `edges.out`. */
    edges: BMEdge[]
}

// endregion

const OFFSET_TYPES: Record<BevelOffsetType, number> = {
    offset: BEVEL_AMT.OFFSET,
    width: BEVEL_AMT.WIDTH,
    depth: BEVEL_AMT.DEPTH,
    percent: BEVEL_AMT.PERCENT,
    absolute: BEVEL_AMT.ABSOLUTE,
}

/**
 * Build the {@link BevelParams} exactly as `BM_mesh_bevel` (`:8239`) does, including its derivation
 * of the superellipse exponent and the four snapping tests that follow it.
 */
function makeParams(opts: BevelOptions, affectType: number): BevelParams {
    const offset = opts.offset ?? 0
    const offsetType = OFFSET_TYPES[opts.offsetType ?? 'offset']
    const seg = maxIi(opts.segments ?? 1, 1)
    const profile = opts.profile ?? 0.5

    const bp: BevelParams = {
        vertHash: new Map(),
        faceHash: new Map(),
        uvFaceHash: new Map(),
        uvVertMaps: [],
        proSpacing: newProfileSpacing(),
        proSpacingMiter: newProfileSpacing(),
        mathLayerInfo: {faceComponent: null, hasMathLayers: false},
        offset,
        offsetType,
        profileType: BEVEL_PROFILE.SUPERELLIPSE,
        affectType,
        affectVerticesOdd: affectType === BEVEL_AFFECT.VERTICES && seg % 2 === 1,
        seg,
        profile,
        proSuperR: -Math.log(2.0) / Math.log(Math.sqrt(profile)),
        loopSlide: opts.loopSlide ?? true,
        limitOffset: opts.clampOverlap ?? false,
        offsetAdjust: affectType !== BEVEL_AFFECT.VERTICES &&
            offsetType !== BEVEL_AMT.PERCENT && offsetType !== BEVEL_AMT.ABSOLUTE,
        markSeam: opts.markSeam ?? false,
        markSharp: opts.markSharp ?? false,
        matNr: opts.materialIndex ?? -1,
        miterOuter: opts.miterOuter === 'patch' ? BEVEL_MITER.PATCH
            : opts.miterOuter === 'arc' ? BEVEL_MITER.ARC : BEVEL_MITER.SHARP,
        miterInner: opts.miterInner === 'arc' ? BEVEL_MITER.ARC : BEVEL_MITER.SHARP,
        vmeshMethod: opts.vmeshMethod === 'cutoff' ? BEVEL_VMESH.CUTOFF : BEVEL_VMESH.ADJ,
        spread: opts.spread ?? 0.1,
        mathLayerNames: [],
        uvLayerNames: [],
        outVerts: new Set(),
        outEdges: new Set(),
    }

    /* Miters are disabled with the cutoff vertex mesh method; Blender's comment is that the
     * combination is not useful anyway, and `bevel_build_cutoff`'s TODOs say it does not work. */
    if (bp.vmeshMethod === BEVEL_VMESH.CUTOFF) {
        bp.miterOuter = BEVEL_MITER.SHARP
        bp.miterInner = BEVEL_MITER.SHARP
    }

    // Snap the exponent to the four special values, which have closed-form even spacing.
    if (profile >= 0.950) {
        // r would be about 692 here, so treat it as the square profile.
        bp.proSuperR = PRO_SQUARE_R
    } else if (Math.abs(bp.proSuperR - PRO_CIRCLE_R) < 1e-4) {
        bp.proSuperR = PRO_CIRCLE_R
    } else if (Math.abs(bp.proSuperR - PRO_LINE_R) < 1e-4) {
        bp.proSuperR = PRO_LINE_R
    } else if (bp.proSuperR < 1e-4) {
        bp.proSuperR = PRO_SQUARE_IN_R
    }

    return bp
}

/**
 * `BM_mesh_bevel` (`:8239`) - the whole operator, over whatever is tagged with {@link ElemFlag.Tag}.
 *
 * The caller is responsible for the tagging, which is what `bmo_bevel_exec` does; see
 * {@link tagInput}.
 */
function meshBevel(bm: BMesh, bp: BevelParams): void {
    if (bp.offset <= 0) {
        return
    }

    // Get the 2D profile point locations from the superellipse.
    setProfileSpacing(bp, bp.proSpacing, false)

    // The "fullness" of the profile, for the ADJ vertex mesh method.
    if (bp.seg > 1) {
        bp.proSpacing.fullness = findProfileFullness(bp)
    }

    mathLayerInfoInit(bp, bm)
    uvVertMapInit(bp, bm)

    // Analyse the input vertices, sorting edges and assigning initial new vertex positions.
    for (const v of [...bm.verts]) {
        if (v.testFlag(ElemFlag.Tag)) {
            const bv = bevelVertConstruct(bm, bp, v)
            if (!bp.limitOffset && bv) {
                buildBoundary(bp, bv, true, bm)
                determineUvVertConnectivity(bp, bm, v)
            }
        }
    }

    // Perhaps clamp the offset to avoid geometry collisions.
    if (bp.limitOffset) {
        bevelLimitOffset(bp, bm)

        for (const v of [...bm.verts]) {
            if (v.testFlag(ElemFlag.Tag)) {
                const bv = findBevVert(bp, v)
                if (bv) {
                    buildBoundary(bp, bv, true, bm)
                    determineUvVertConnectivity(bp, bm, v)
                }
            }
        }
    }

    // Perhaps do a pass to even out the widths.
    if (bp.offsetAdjust) {
        adjustOffsets(bp, bm)
    }

    // Keep orientations consistent for asymmetric custom profiles.
    if (bp.profileType === BEVEL_PROFILE.CUSTOM) {
        for (const e of [...bm.edges]) {
            if (e.testFlag(ElemFlag.Tag)) {
                regularizeProfileOrientation(bp, e)
            }
        }
    }

    // Build the meshes around the vertices, now that the positions are final.
    for (const v of [...bm.verts]) {
        if (v.testFlag(ElemFlag.Tag)) {
            const bv = findBevVert(bp, v)
            if (bv) {
                buildVmesh(bp, bm, bv)
            }
        }
    }

    // Build the polygons for the edges.
    if (bp.affectType !== BEVEL_AFFECT.VERTICES) {
        for (const e of [...bm.edges]) {
            if (e.testFlag(ElemFlag.Tag)) {
                bevelBuildEdgePolygons(bm, bp, e)
            }
        }
    }

    // Extend edge data such as sharp edges.
    for (const v of [...bm.verts]) {
        if (v.testFlag(ElemFlag.Tag)) {
            const bv = findBevVert(bp, v)
            if (bv) {
                bevelExtendEdgeData(bv)
            }
        }
    }

    // Rebuild the face polygons around the affected vertices.
    const rebuiltOrigFaces = new Set<BMFace>()
    for (const v of [...bm.verts]) {
        if (v.testFlag(ElemFlag.Tag)) {
            bevelRebuildExistingPolygons(bm, bp, v, rebuiltOrigFaces)
            bevelReattachWires(bm, bp, v)
        }
    }

    for (const f of rebuiltOrigFaces) {
        bm.faceKill(f)
    }

    for (const v of [...bm.verts]) {
        if (v.testFlag(ElemFlag.Tag)) {
            uvVertMapPop(bp, v)
            bm.vertKill(v)
        }
    }

    bevelMergeUvs(bp, bm)

    /* Clear the long-loop tags, which were only set on some edges of F_EDGE faces. Blender does this
     * over every face in the mesh, testing the face kind; reproduced. */
    for (const f of bm.faces) {
        if (getFaceKind(bp, f) !== FKind.EDGE) {
            continue
        }
        for (const l of f.eachLoop()) {
            l.setFlag(ElemFlag.TagAlt, false)
        }
    }
}

/**
 * `bmo_bevel_exec` (`bmo_bevel.cc:14`) - flush the input geometry into `BM_ELEM_TAG`.
 *
 * Note the manifold test: a selected edge is only tagged when `BM_edge_is_manifold` holds, so a
 * non-manifold or boundary edge is *declined* rather than beveled, and the rest of the mesh is
 * untouched. Vertices are tagged unconditionally, and both endpoints of every tagged edge are tagged
 * too in case the caller passed only edges.
 */
function tagInput(bm: BMesh, verts: readonly BMVert[], edges: readonly BMEdge[]): void {
    for (const v of bm.verts) v.setFlag(ElemFlag.Tag, false)
    for (const e of bm.edges) e.setFlag(ElemFlag.Tag, false)
    for (const f of bm.faces) f.setFlag(ElemFlag.Tag, false)

    for (const v of verts) {
        v.setFlag(ElemFlag.Tag, true)
    }
    for (const e of edges) {
        if (edgeIsManifold(e)) {
            e.setFlag(ElemFlag.Tag, true)
            // In case the verts were not also included in the input.
            e.v1.setFlag(ElemFlag.Tag, true)
            e.v2.setFlag(ElemFlag.Tag, true)
        }
    }
}

/**
 * Collect the output. `bmo_bevel_exec` fills `faces.out` from `BM_ELEM_TAG` on faces and the vert
 * and edge slots from the `VERT_OUT` / `EDGE_OUT` operator flags; those are the two sets on
 * {@link BevelParams} here.
 */
function collectResult(bm: BMesh, bp: BevelParams): BevelResult {
    const faces: BMFace[] = []
    for (const f of bm.faces) {
        if (f.testFlag(ElemFlag.Tag)) faces.push(f)
    }
    const verts: BMVert[] = []
    for (const v of bm.verts) {
        if (bp.outVerts.has(v)) verts.push(v)
    }
    const edges: BMEdge[] = []
    for (const e of bm.edges) {
        if (bp.outEdges.has(e)) edges.push(e)
    }
    return {faces, verts, edges}
}

function finishSelection(bm: BMesh, res: BevelResult, selectResult: boolean): void {
    if (!selectResult) return
    selectNone(bm)
    for (const f of res.faces) faceSelectSet(bm, f, true)
    for (const e of res.edges) edgeSelectSet(bm, e, true)
    for (const v of res.verts) vertSelectSet(bm, v, true)
}

/** Clear the scratch tags bevel leaves behind so a second call starts clean. */
function clearTags(bm: BMesh): void {
    for (const f of bm.faces) f.setFlag(ElemFlag.Tag, false)
    for (const v of bm.verts) v.setFlag(ElemFlag.Tag, false)
    for (const e of bm.edges) e.setFlag(ElemFlag.Tag, false)
}

function run(
    bm: BMesh, verts: readonly BMVert[], edges: readonly BMEdge[], opts: BevelOptions, affectType: number,
): BevelResult {
    const bp = makeParams(opts, affectType)
    if (bp.offset <= 0) {
        return {faces: [], verts: [], edges: []}
    }
    /* Bevel reads `f->no` and `v->no` everywhere and nothing here maintains them; see the file
     * header. This is a side effect on the whole mesh, not just the beveled part. */
    normalsUpdate(bm)
    tagInput(bm, verts, edges)
    meshBevel(bm, bp)
    const res = collectResult(bm, bp)
    clearTags(bm)
    finishSelection(bm, res, opts.selectResult ?? true)
    return res
}

/**
 * Bevel `edges`.
 *
 * Each edge must be manifold - exactly two faces - or it is silently skipped, which is Blender's
 * behaviour and is what stops a non-manifold edge from corrupting the mesh.
 */
export function bevelEdges(bm: BMesh, edges: readonly BMEdge[], opts: BevelOptions = {}): BevelResult {
    return run(bm, [], edges, opts, BEVEL_AFFECT.EDGES)
}

/**
 * Bevel `verts` - each corner is replaced by a face across its incident edges rather than the edges
 * being widened.
 */
export function bevelVerts(bm: BMesh, verts: readonly BMVert[], opts: BevelOptions = {}): BevelResult {
    return run(bm, verts, [], opts, BEVEL_AFFECT.VERTICES)
}

/**
 * Bevel whatever is selected - the editor-facing entry, like `extrudeSelection`.
 *
 * With {@link BevelOptions.affectVerts} the selected vertices are beveled; otherwise the selected
 * edges are, and an edge counts as selected when both its vertices are, which is how edit mode
 * derives an edge selection from a vertex selection. Returns null when nothing is selected.
 */
export function bevelSelection(bm: BMesh, opts: BevelOptions = {}): BevelResult | null {
    if (opts.affectVerts) {
        const verts: BMVert[] = []
        for (const v of bm.verts) {
            if (v.testFlag(ElemFlag.Select)) verts.push(v)
        }
        if (verts.length === 0) return null
        return bevelVerts(bm, verts, opts)
    }
    const edges: BMEdge[] = []
    for (const e of bm.edges) {
        if (e.testFlag(ElemFlag.Select) || (e.v1.testFlag(ElemFlag.Select) && e.v2.testFlag(ElemFlag.Select))) {
            edges.push(e)
        }
    }
    if (edges.length === 0) return null
    return bevelEdges(bm, edges, opts)
}
