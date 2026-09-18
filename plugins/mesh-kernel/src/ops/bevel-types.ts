/**
 * The bevel working structures, ported from `source/blender/bmesh/tools/bmesh_bevel.cc:74-428`.
 *
 * Bevel does not edit the mesh as it goes. It first builds a complete description of what the
 * result should look like - one {@link BevVert} per beveled vertex, each holding an {@link EdgeHalf}
 * per incident edge and a {@link VMesh} whose boundary is a cycle of {@link BoundVert}s - and only
 * then instantiates `BMVert`s and faces from it. Everything in this file is that description.
 *
 * The one representational change from Blender is that `BoundVert`, `EdgeHalf` and friends are
 * objects rather than arena-allocated structs, and the cyclic `next`/`prev` links are plain
 * references. Blender's `BLI_memarena` exists to make thousands of small allocations cheap and to
 * free them in one call; neither concern survives into JS. Field names, defaults and the meaning of
 * every one of them are unchanged.
 *
 * Fields Blender only uses for features that are out of scope here are absent rather than present
 * and ignored - see the header of `bevel.ts` for the list and the reasons.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {M3, V3, nv3} from './bevel-math'

// region epsilons (`bmesh_bevel.cc:52-65`)

export const BEVEL_EPSILON_D = 1e-6
export const BEVEL_EPSILON = 1e-6
export const BEVEL_EPSILON_SQ = 1e-12
export const BEVEL_EPSILON_BIG = 1e-4
export const BEVEL_EPSILON_BIG_SQ = 1e-8
/** Two degrees. */
export const BEVEL_EPSILON_ANG = (2.0 * Math.PI) / 180
/** Ten degrees. */
export const BEVEL_SMALL_ANG = (10.0 * Math.PI) / 180
/** Difference in dot products corresponding to a 10 degree difference between vectors. */
export const BEVEL_SMALL_ANG_DOT = 1 - Math.cos(BEVEL_SMALL_ANG)
/** Difference in dot products corresponding to a 2 degree difference between vectors. */
export const BEVEL_EPSILON_ANG_DOT = 1 - Math.cos(BEVEL_EPSILON_ANG)
export const BEVEL_MAX_ADJUST_PCT = 10.0
export const BEVEL_MAX_AUTO_ADJUST_PCT = 300.0
export const BEVEL_MATCH_SPEC_WEIGHT = 0.2

/** `STD_UV_CONNECT_LIMIT` (`DNA_meshdata_types.h`), the UV-space merge tolerance. */
export const STD_UV_CONNECT_LIMIT = 0.0001

// endregion

// region the option enums (`intern/bmesh_operators.hh:99-138`)

/** `offset_type`. Five different meanings for one number; see `offset_meet`. */
export const BEVEL_AMT = {
    OFFSET: 0,
    WIDTH: 1,
    DEPTH: 2,
    PERCENT: 3,
    ABSOLUTE: 4,
} as const

export const BEVEL_PROFILE = {
    SUPERELLIPSE: 0,
    CUSTOM: 1,
} as const

export const BEVEL_MITER = {
    SHARP: 0,
    PATCH: 1,
    ARC: 2,
} as const

export const BEVEL_VMESH = {
    ADJ: 0,
    CUTOFF: 1,
} as const

export const BEVEL_AFFECT = {
    VERTICES: 0,
    EDGES: 1,
} as const

/** `PRO_*_R` (`bmesh_bevel.cc:158-161`) - superellipse exponents with a name. */
export const PRO_SQUARE_R = 1e4
export const PRO_CIRCLE_R = 2.0
export const PRO_LINE_R = 1.0
export const PRO_SQUARE_IN_R = 0.0

/**
 * `MeshKind` (`:256`) - which construction fills the corner between the profiles.
 */
export enum MeshKind {
    /** No polygon mesh needed. */
    NONE,
    /** A simple polygon. */
    POLY,
    /** The "adjacent edges" subdivision pattern. */
    ADJ,
    /** A simple polygon, fan filled. */
    TRI_FAN,
    /** A triangulated face at the end of each profile. */
    CUTOFF,
}

/**
 * `FKind` (`:309`) - how a face in the output mesh came to be.
 * Blender's note is load-bearing: the order `RECON > EDGE > VERT` is compared numerically.
 */
export enum FKind {
    /** Used when there is no face at all. */
    NONE,
    /** Original face, not touched. */
    ORIG,
    /** Face for construction around a vert. */
    VERT,
    /** Face for a beveled edge. */
    EDGE,
    /** Reconstructed original face with some new verts. */
    RECON,
}

/** `AngleKind` (`:323`). */
export enum AngleKind {
    SMALLER = -1,
    STRAIGHT = 0,
    LARGER = 1,
}

// endregion

/** `NewVert` (`:75`) - a constructed vertex, instantiated as a `BMVert` only once positions are final. */
export interface NewVert {
    v: BMVert | null
    co: V3
}

export const newVert = (): NewVert => ({v: null, co: nv3()})

/**
 * `EdgeHalf` (`:84`) - one end of one edge incident to a beveled vertex.
 *
 * An edge that is beveled at both ends has two of these, one in each {@link BevVert}; they are found
 * from each other by `findOtherEndEdgeHalf`. `offsetL`/`offsetR` are the working offsets and
 * `offsetLSpec`/`offsetRSpec` the user's request, which differ once clamping or the offset
 * adjustment pass has run.
 */
export interface EdgeHalf {
    /** Other EdgeHalves connected to the same BevVert, in CCW order. */
    next: EdgeHalf
    prev: EdgeHalf
    /** Original mesh edge. */
    e: BMEdge
    /** Face between this edge and previous, if any. */
    fprev: BMFace | null
    /** Face between this edge and next, if any. */
    fnext: BMFace | null
    /** Left boundary vert, looking along the edge towards its far end. */
    leftv: BoundVert | null
    /** Right boundary vert, if beveled. */
    rightv: BoundVert | null
    /** Offset into the profile at which a non-beveled edge attaches. */
    profileIndex: number
    /** How many segments for the bevel. */
    seg: number
    /** Offset for this edge, on the left side. */
    offsetL: number
    /** Offset for this edge, on the right side. */
    offsetR: number
    /** User specification for {@link offsetL}. */
    offsetLSpec: number
    /** User specification for {@link offsetR}. */
    offsetRSpec: number
    /** Is this edge beveled? */
    isBev: boolean
    /** Is `e.v2` the vertex at this end? */
    isRev: boolean
    /** Is `e` a seam for custom loop data (for example UVs)? */
    isSeam: boolean
    /** Used during the custom profile orientation pass. */
    visitedRpo: boolean
}

/**
 * `Profile` (`:134`).
 *
 * The profile is a path with start, middle and end control points, projected onto the plane
 * `(planeCo, planeNo)` along `projDir`. Many interesting profiles are superellipses
 * `|x/a|^r + |y/b|^r = 1`: `r == 2` is an ellipse, `r == 1` a line, `r < 1` concave, `r > 1` bulging.
 * `r == 0` means straight inward and `r == 4` (in practice {@link PRO_SQUARE_R}) straight outward.
 *
 * `profCo` holds `seg + 1` points once {@link calculateProfile} has run; `profCo2` the same for the
 * next power of two at or above `seg`, which the ADJ subdivision needs.
 */
export interface Profile {
    /** Superellipse `r` parameter. */
    superR: number
    /** Height for profile cutoff face sides. */
    height: number
    /** Start control point. */
    start: V3
    /** Mid control point. */
    middle: V3
    /** End control point. */
    end: V3
    /** Normal of the plane to project to. */
    planeNo: V3
    /** A point on the plane to project to. */
    planeCo: V3
    /** Direction of the projection lines. */
    projDir: V3
    /** `seg + 1` profile coordinates, flattened as triples. */
    profCo: Float64Array | null
    /** Like {@link profCo} but for the power of two at or above `seg`. */
    profCo2: Float64Array | null
    /** Marks a special case, so these parameters are not reset with the others. */
    specialParams: boolean
}

export const newProfile = (): Profile => ({
    superR: PRO_LINE_R,
    height: 0,
    start: nv3(),
    middle: nv3(),
    end: nv3(),
    planeNo: nv3(),
    planeCo: nv3(),
    projDir: nv3(),
    profCo: null,
    profCo2: null,
    specialParams: false,
})

/**
 * `ProfileSpacing` (`:168`) - the untransformed 2D profile sample positions.
 *
 * For non-custom profiles this doubles as the cache for the expensive even-spacing solve in
 * `findEvenSuperellipseChords`, which is why it hangs off {@link BevelParams} rather than off each
 * profile: every profile in one bevel shares the same `seg` and `superR`.
 */
export interface ProfileSpacing {
    /** The profile's `seg + 1` x values. */
    xvals: Float64Array | null
    /** The profile's `seg + 1` y values. */
    yvals: Float64Array | null
    /** The profile's `seg2 + 1` x values. */
    xvals2: Float64Array | null
    /** The profile's `seg2 + 1` y values. */
    yvals2: Float64Array | null
    /** The power of two greater than or equal to the number of segments. */
    seg2: number
    /** How far "out" the profile is, used at the start of subdivision. */
    fullness: number
}

export const newProfileSpacing = (): ProfileSpacing => ({
    xvals: null, yvals: null, xvals2: null, yvals2: null, seg2: 0, fullness: 0,
})

/**
 * `MathLayerInfo` (`:196`).
 *
 * `faceComponent` is only filled in when there are UV layers *and* an odd number of segments,
 * because that is the only case where the centre segment can arbitrarily belong to either adjacent
 * face and an inconsistent choice shows up as a visible UV seam. "Connected component" means
 * connected in UV space: two faces are adjacent when they share an edge across which every
 * math-carrying loop layer is contiguous.
 */
export interface MathLayerInfo {
    /** A connected-component id per face, indexed by `BMFace.index`. */
    faceComponent: Int32Array | null
    /** Does the mesh have any UV-like loop layers? */
    hasMathLayers: boolean
}

/**
 * `UVFace` (`:209`) - a face `bev_create_ngon` made, plus the original face it is attached to in UV
 * space. Bevel faces sharing an `attachedFrep` must end up with their neighbouring UV verts merged.
 */
export interface UVFace {
    f: BMFace
    attachedFrep: BMFace | null
}

/**
 * `BoundVert` (`:220`) - one element of the cyclic boundary of a {@link VMesh}.
 *
 * There is one at each side of every beveled edge where a profile starts, and one at each side of a
 * miter. `profile` is the profile running from this bound vert to `next`.
 */
export interface BoundVert {
    /** In CCW order. */
    next: BoundVert
    prev: BoundVert
    nv: NewVert
    /** First of the edges attached here, in CCW order. */
    efirst: EdgeHalf | null
    elast: EdgeHalf | null
    /** The "edge between" this bound vert is on, in the `offsetOnEdgeBetween` case. */
    eon: EdgeHalf | null
    /** Beveled edge whose left side is attached here, if any. */
    ebev: EdgeHalf | null
    /** Used for vmesh indexing. */
    index: number
    /** When {@link eon} is set, the ratio of the sines of the angles to the `eon` edge. */
    sinratio: number
    /** Adjustment chain or cycle link pointer. */
    adjchain: BoundVert | null
    /** Edge profile between this and the next BoundVert. */
    profile: Profile
    /** Are any of the edges attached here seams? */
    anySeam: boolean
    /** Used during the delta adjust pass. */
    visited: boolean
    /** This bound vert begins an arc profile. */
    isArcStart: boolean
    /** This bound vert begins a patch profile. */
    isPatchStart: boolean
    /** Is this bound vert the side of the custom profile's start? */
    isProfileStart: boolean
    /** Length of the seam run from this bound vert to the next, CCW. */
    seamLen: number
    /** The same for sharp edges. */
    sharpLen: number
}

/**
 * `VMesh` (`:265`) - the mesh that replaces one original vertex.
 *
 * `mesh` is indexed `(i, j, k)` by {@link meshVert}: `i` the bound vert, `j` the ring and `k` the
 * segment. Not every slot is used and many share a `BMVert`.
 */
export interface VMesh {
    /** Allocated array; its size and meaning depend on {@link meshKind}. */
    mesh: NewVert[] | null
    /** Start of the boundary doubly linked list. */
    boundstart: BoundVert | null
    /** Number of vertices in the boundary. */
    count: number
    /** Common number of segments for segmented edges (the same as `bp.seg`). */
    seg: number
    /** The kind of mesh to build at this corner. */
    meshKind: MeshKind
}

export const newVMesh = (): VMesh => ({
    mesh: null, boundstart: null, count: 0, seg: 0, meshKind: MeshKind.NONE,
})

/** `BevVert` (`:281`) - everything known about one vertex being beveled. */
export interface BevVert {
    /** Original mesh vertex. */
    v: BMVert
    /** Total number of edges around the vertex, wire edges excluded when edge beveling. */
    edgecount: number
    /** Number of selected edges around the vertex. */
    selcount: number
    /** Count of wire edges. */
    wirecount: number
    /** Offset for this vertex, if this is a vertex-only bevel. */
    offset: number
    /** Any seams on attached edges? */
    anySeam: boolean
    /** Used in graph traversal for adjusting offsets. */
    visited: boolean
    /** Size {@link edgecount}, CCW order seen from the vertex normal side. */
    edges: EdgeHalf[]
    /** Size {@link wirecount}. */
    wireEdges: BMEdge[]
    /** Mesh structure replacing the vertex. */
    vmesh: VMesh
}

/** A bucket of loops whose UV coordinates should end up identical. `UVVertBucket` (`:333`). */
export type UVVertBucket = Set<BMLoop>

/** `UVVertMap` (`:336`) - per vertex, the buckets its loops fall into for one UV layer. */
export type UVVertMap = Map<BMVert, UVVertBucket[]>

/**
 * `BevelParams` (`:339`) - the options plus everything computed once for the whole run.
 *
 * `memArena` and the vertex-group fields are gone; see the `bevel.ts` header. `faceHash` is not
 * optional here because there is no modifier path that leaves it unset.
 */
export interface BevelParams {
    /** Records the BevVerts made. */
    vertHash: Map<BMVert, BevVert>
    /** Records the kind of each new face. */
    faceHash: Map<BMFace, FKind>
    /** Records the `UVFace`s made. */
    uvFaceHash: Map<BMFace, UVFace>
    /** UV vert connectivity, one map per UV layer. */
    uvVertMaps: UVVertMap[]
    /** Profile vertex locations and spacings. */
    proSpacing: ProfileSpacing
    /** The same for the miter profiles, when they need their own. */
    proSpacingMiter: ProfileSpacing
    /** Information about 'math' loop layers, like UVs. */
    mathLayerInfo: MathLayerInfo
    /** Units to offset each side of a beveled edge. */
    offset: number
    /** How {@link offset} is measured. One of {@link BEVEL_AMT}. */
    offsetType: number
    /** One of {@link BEVEL_PROFILE}. */
    profileType: number
    /** One of {@link BEVEL_AFFECT}. */
    affectType: number
    /**
     * Vertex bevel with an odd segment count needs special UV handling: it has no edge with
     * `isBev`, so `frepForCenterPoly` would find no representative face at all. Blender keeps this
     * as a field purely to avoid repeating the condition inline.
     */
    affectVerticesOdd: boolean
    /** Number of segments in the beveled edge profile. */
    seg: number
    /** The user's profile setting, 0 to 1. */
    profile: number
    /** Superellipse parameter for the edge profile, derived from {@link profile}. */
    proSuperR: number
    /** Should bevel prefer to slide along edges rather than keep widths to spec? */
    loopSlide: boolean
    /** Should offsets be limited by collisions? */
    limitOffset: boolean
    /** Should offsets be adjusted to try to get even widths? */
    offsetAdjust: boolean
    /** Should seam edge markings be propagated? */
    markSeam: boolean
    /** Should sharp edge markings be propagated? */
    markSharp: boolean
    /** If >= 0, the material slot for new faces; otherwise it comes from the adjacent faces. */
    matNr: number
    /** What kind of miter pattern to use on reflex angles. One of {@link BEVEL_MITER}. */
    miterOuter: number
    /** What kind of miter pattern to use on non-reflex angles. */
    miterInner: number
    /** One of {@link BEVEL_VMESH}. */
    vmeshMethod: number
    /** Amount to spread when doing an inside miter. */
    spread: number
    /** The loop layers that interpolate like UVs, resolved once. See {@link MathLayerInfo}. */
    mathLayerNames: string[]
    /** The UV (float2) loop layer names, in order, one entry per {@link uvVertMaps} slot. */
    uvLayerNames: string[]
}

/**
 * `add_new_bound_vert` (`:814`) - append to the cyclic boundary list and return the new element.
 *
 * Blender relies on `BLI_memarena_use_calloc` to zero the struct and then sets the handful of fields
 * whose zero value is wrong; both halves are written out here.
 */
export function addNewBoundVert(vm: VMesh, co: readonly number[]): BoundVert {
    const ans: BoundVert = {
        next: null as unknown as BoundVert,
        prev: null as unknown as BoundVert,
        nv: newVert(),
        efirst: null,
        elast: null,
        eon: null,
        ebev: null,
        index: 0,
        sinratio: 1.0,
        adjchain: null,
        profile: newProfile(),
        anySeam: false,
        visited: false,
        isArcStart: false,
        isPatchStart: false,
        isProfileStart: false,
        seamLen: 0,
        sharpLen: 0,
    }
    ans.nv.co[0] = co[0]
    ans.nv.co[1] = co[1]
    ans.nv.co[2] = co[2]

    if (!vm.boundstart) {
        ans.index = 0
        vm.boundstart = ans
        ans.next = ans
        ans.prev = ans
    } else {
        const tail = vm.boundstart.prev
        ans.index = tail.index + 1
        ans.prev = tail
        ans.next = vm.boundstart
        tail.next = ans
        vm.boundstart.prev = ans
    }
    ans.profile.superR = PRO_LINE_R
    vm.count++
    return ans
}

/** `adjust_bound_vert` (`:838`). */
export function adjustBoundVert(bv: BoundVert, co: readonly number[]): void {
    bv.nv.co[0] = co[0]
    bv.nv.co[1] = co[1]
    bv.nv.co[2] = co[2]
}

/**
 * `mesh_vert` (`:854`) - the `(i, j, k)` slot of a VMesh's vertex array.
 *
 * `i` is the bound vert index, `j` the ring (0 at the boundary), `k` the segment. Blender returns a
 * pointer into one flat array; this returns the same element out of an array of objects, which is
 * why callers mutate `nv.co` in place rather than reassigning it.
 */
export function meshVert(vm: VMesh, i: number, j: number, k: number): NewVert {
    const nj = Math.floor(vm.seg / 2) + 1
    const nk = vm.seg + 1
    return vm.mesh![i * nk * nj + j * nk + k]
}

/** `copy_mesh_vert` (`:870`). */
export function copyMeshVert(
    vm: VMesh, ito: number, jto: number, kto: number, ifrom: number, jfrom: number, kfrom: number,
): void {
    const nvto = meshVert(vm, ito, jto, kto)
    const nvfrom = meshVert(vm, ifrom, jfrom, kfrom)
    nvto.v = nvfrom.v
    nvto.co[0] = nvfrom.co[0]
    nvto.co[1] = nvfrom.co[1]
    nvto.co[2] = nvfrom.co[2]
}

/** `find_edge_half` (`:879`). */
export function findEdgeHalf(bv: BevVert, bme: BMEdge): EdgeHalf | null {
    for (let i = 0; i < bv.edgecount; i++) {
        if (bv.edges[i].e === bme) return bv.edges[i]
    }
    return null
}

/** `find_bevvert` (`:890`). */
export function findBevVert(bp: BevelParams, bmv: BMVert): BevVert | null {
    return bp.vertHash.get(bmv) ?? null
}

/** `find_uv_face` (`:896`). */
export function findUVFace(bp: BevelParams, bmf: BMFace): UVFace | null {
    return bp.uvFaceHash.get(bmf) ?? null
}

/**
 * `find_other_end_edge_half` (`:906`) - the EdgeHalf for the far end of the same edge.
 *
 * Returns null when the far end's BevVert has not been constructed yet, which is a normal state
 * during the first pass rather than an error.
 */
export function findOtherEndEdgeHalf(
    bp: BevelParams, e: EdgeHalf, rBvOther?: {bv: BevVert | null},
): EdgeHalf | null {
    const bvo = findBevVert(bp, e.isRev ? e.e.v1 : e.e.v2)
    if (bvo) {
        if (rBvOther) rBvOther.bv = bvo
        return findEdgeHalf(bvo, e.e)
    }
    if (rBvOther) rBvOther.bv = null
    return null
}

/**
 * `next_bev` (`:925`) - the next beveled EdgeHalf after `fromE` going CCW.
 * With `fromE` null it finds the first beveled edge, by starting one before `edges[0]`.
 */
export function nextBev(bv: BevVert, fromE: EdgeHalf | null): EdgeHalf | null {
    if (fromE === null) {
        fromE = bv.edges[bv.edgecount - 1]
    }
    let e = fromE
    do {
        if (e.isBev) return e
        e = e.next
    } while (e !== fromE)
    return null
}

/** `count_ccw_edges_between` (`:940`). */
export function countCcwEdgesBetween(e1: EdgeHalf, e2: EdgeHalf): number {
    let count = 0
    let e = e1
    do {
        if (e === e2) break
        e = e.next
        count++
    } while (e !== e1)
    return count
}

/** `record_face_kind` (`:780`). */
export function recordFaceKind(bp: BevelParams, f: BMFace | null, fkind: FKind): void {
    if (f) bp.faceHash.set(f, fkind)
}

/** `get_face_kind` (`:787`). A face bevel never saw is an original. */
export function getFaceKind(bp: BevelParams, f: BMFace): FKind {
    return bp.faceHash.get(f) ?? FKind.ORIG
}

/** Scratch 3x3 for callers that want one without allocating at the call site. */
export const newM3 = (): M3 => [0, 0, 0, 0, 0, 0, 0, 0, 0]
