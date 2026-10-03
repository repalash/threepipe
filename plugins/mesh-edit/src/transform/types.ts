/**
 * Shared types and flags of the transform port, mirroring `editors/transform/transform.hh`.
 *
 * Names keep Blender's spelling (`T_PROP_EDIT`, `CON_AXIS0`, `TD_SELECTED`) so the ported functions
 * read against the original.
 */

import type {Mat3, Mat4, Vec3} from './math'

/** `TFM_TRANSLATION`, `TFM_ROTATION`, `TFM_RESIZE`, `TFM_EDGE_SLIDE`, `TFM_VERT_SLIDE` (`transform.hh`). */
export type TransformMode = 'translate' | 'rotate' | 'resize' | 'edgeSlide' | 'vertSlide'

/** `V3D_AROUND_*`: what the transform pivots on. */
export type PivotType = 'median' | 'active' | 'individual' | 'bounds' | 'cursor'

/** `V3D_ORIENT_*`. `custom` is a matrix the caller supplies (extrude's region normal, a gizmo). */
export type OrientationType = 'global' | 'local' | 'normal' | 'view' | 'cursor' | 'custom'

/** `PROP_*` falloffs (`DNA_scene_types.h:2004`). */
export type PropFalloff = 'smooth' | 'sphere' | 'root' | 'sharp' | 'linear' | 'constant' | 'random' | 'inverseSquare'

/** `SCE_SNAP_TO_*` targets this port supports. */
export type SnapTargetType = 'increment' | 'grid' | 'vertex' | 'edge' | 'edgeMidpoint' | 'face'

/** `SCE_SNAP_SOURCE_*`: which point of the moving selection snaps. */
export type SnapSourceType = 'closest' | 'center' | 'median' | 'active'

// region TransInfo.flag (`transform.hh:130`)

export const T_EDIT = 1 << 0
/** Transform points (verts), not objects. */
export const T_POINTS = 1 << 1
export const T_PROP_EDIT = 1 << 2
export const T_PROP_CONNECTED = 1 << 3
export const T_PROP_PROJECTED = 1 << 4
/** Values default to one, not zero (resize). */
export const T_NULL_ONE = 1 << 5
export const T_NO_CONSTRAINT = 1 << 6
export const T_MODAL = 1 << 7
/** Confirm when the launching button is released (gizmo drags). */
export const T_RELEASE_CONFIRM = 1 << 8
export const T_INPUT_IS_VALUES_FINAL = 1 << 9
/** Alt held, or a mode's alternative behaviour (edge and vertex slide: unclamped). */
export const T_ALT_TRANSFORM = 1 << 10
/** `T_ALL_RESTRICTIONS`: what `resetTransRestrictions` clears when the mode changes. */
export const T_ALL_RESTRICTIONS = T_NO_CONSTRAINT | T_NULL_ONE
export const T_PROP_EDIT_ALL = T_PROP_EDIT | T_PROP_CONNECTED | T_PROP_PROJECTED

// endregion

// region TransInfo.modifiers (`transform.hh:199`)

export const MOD_CONSTRAINT_SELECT_AXIS = 1 << 0
export const MOD_PRECISION = 1 << 1
export const MOD_SNAP = 1 << 2
export const MOD_SNAP_INVERT = 1 << 3
export const MOD_CONSTRAINT_SELECT_PLANE = 1 << 4
export const MOD_SNAP_FORCED = 1 << 5

// endregion

// region TransInfo.options (`transform.hh`)

export const CTX_OBJECT = 1 << 0
export const CTX_NO_PET = 1 << 1

// endregion

// region TransCon.mode (`transform.hh:233`)

export const CON_APPLY = 1 << 0
export const CON_AXIS0 = 1 << 1
export const CON_AXIS1 = 1 << 2
export const CON_AXIS2 = 1 << 3
export const CON_SELECT = 1 << 4
/** Set by the user (key), not by an operator. */
export const CON_USER = 1 << 5

// endregion

// region TransData.flag (`transform.hh`)

export const TD_SELECTED = 1 << 0
export const TD_NOCENTER = 1 << 1
export const TD_SKIP = 1 << 2

// endregion

// region orientation slots (`transform.hh:274`)

/** The mode's default orientation: global for move and scale, view for rotate. */
export const O_DEFAULT = 0
/** The scene's chosen orientation (the header dropdown). */
export const O_SCENE = 1
/** The alternative an axis key cycles to: local when the scene is global, otherwise global. */
export const O_SET = 2

// endregion

/** One element being transformed, Blender's `TransData` (`transform.hh`). */
export interface TransData {
    /** Live location, written to the element on every apply. Local space for mesh verts. */
    loc: Vec3
    /** Initial location. */
    iloc: Vec3
    /** Centre the element pivots on with individual origins (its island), else `iloc`. */
    center: Vec3
    /** Local axes of the element (its normal frame), for the normal orientation. */
    axismtx: Mat3
    /** Local to global 3x3 (`copy_m3_m4(mtx, obmat)`). */
    mtx: Mat3
    /** Global to local, the inverse of `mtx`. */
    smtx: Mat3
    /** Proportional falloff factor, 1 for the selection itself. */
    factor: number
    /** Connected (geodesic) distance to the selection, for proportional editing. */
    dist: number
    /** Real (Euclidean) distance to the selection. */
    rdist: number
    flag: number
    /** The vertex or object this data drives. */
    extra: unknown
    /** Object-mode extras (`TransDataExtension`): the world matrix at the start. */
    ext?: TransDataExtension
}

export interface TransDataExtension {
    /** World matrix when the transform started. */
    obmat: Mat4
    /** Inverse of the parent's world matrix, to write the result back as a local transform. */
    parentInv: Mat4
}

/** `TransDataContainer`: the elements of one object, with its matrices. */
export interface TransDataContainer {
    data: TransData[]
    /** Object to world. */
    mat: Mat4
    /** World to object. */
    imat: Mat4
    mat3: Mat3
    imat3: Mat3
    /** `mat3` with unit-length axes, the rotation only. */
    mat3Unit: Mat3
    /** True when `data[].loc` is in the object's space (edit mode). */
    useLocalMat: boolean
    /** The pivot in the container's local space. */
    centerLocal: Vec3
    /** The object, for callers that write results back. */
    object: unknown
    /** `tc->custom.mode.data`: the mode's per-container data (edge and vertex slide), freed on a mode change. */
    customMode?: unknown
}

/** `TransSnapPoint` results and state (`TransSnap` in `transform.hh`). */
export const SNAP_RESETTED = 0
export const SNAP_SOURCE_FOUND = 1 << 0
export const SNAP_TARGET_FOUND = 1 << 1
