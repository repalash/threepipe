/**
 * The modal transform state machine, Blender's `TransInfo`, ported from `editors/transform/`
 * (`transform.cc`, `transform_generics.cc`, `transform_mode.cc`, `transform_mode_translate.cc`,
 * `transform_mode_rotate.cc`, `transform_mode_resize.cc`, `transform_convert_mesh.cc`,
 * `transform_convert_object.cc`).
 *
 * One `TransInfo` is one interactive move, rotate or scale: it snapshots the elements
 * (`TransData`), reads the mouse through {@link MouseInput}, numbers through {@link NumInput},
 * constraints, snapping and proportional editing through their modules, and recomputes every
 * element from its start position on each input. It knows nothing about the DOM or three.js: the
 * view is a {@link TransformView} and results are flushed through `flush()`.
 */

import {BMesh, BMVert, ElemFlag, SelectMode} from '@threepipe/mesh-kernel'
import {
    addV3,
    angleSignedOnAxisV3V3V3,
    axisAngleNormalizedToM3WithQuadrant,
    copyM3,
    copyV3,
    dotV3,
    invertM3,
    invertM4,
    isZeroV3,
    lenSquaredV3V3,
    lenV3,
    m3FromM4,
    m4Col,
    Mat3,
    Mat4,
    mulM3M3,
    mulM3V3,
    mulM4V3,
    mulV3Fl,
    normalizeM3,
    normalizeV3,
    projectV3V3V3,
    sizeToM3,
    subV3,
    unitM3,
    Vec2,
    Vec3,
} from './math'
import {TransformView} from './view'
import {applyMouseInput, initMouseInput, initMouseInputMode, MouseInput, MouseInputContext} from './input'
import {
    applyNumInput,
    handleNumInput,
    hasNumInput,
    initNumInput,
    NUM_AFFECT_ALL,
    NUM_NULL_ONE,
    NumInput,
    NumInputEvent,
    numInputIsInt,
    numinputDoubleIsInt,
    outputNumInput,
} from './numinput'
import {
    conApplyRot,
    conApplySize,
    conApplyVec,
    constraintNumInput,
    initSelectConstraint,
    newTransCon,
    postSelectConstraint,
    selectConstraint,
    setUserConstraint,
    stopConstraint,
    TransCon,
    transformEventModalConstraint,
} from './constraints'
import {calculateCenterFromAround, meshIslandsCalc, TransIslandData} from './pivot'
import {calculatePropRatio, meshConnectivityDistance, PROP_FALLOFF_ORDER, restoreElement, setPropDist} from './proportional'
import {calcOrientationFromType, createSpaceNormal, orientationSpaceName} from './orientation'
import {meshNormalsUpdate, vertNo} from './bmeshQuery'
import {
    CON_APPLY,
    CON_AXIS0,
    CON_AXIS1,
    CON_AXIS2,
    CTX_OBJECT,
    MOD_CONSTRAINT_SELECT_AXIS,
    MOD_CONSTRAINT_SELECT_PLANE,
    MOD_PRECISION,
    MOD_SNAP,
    MOD_SNAP_INVERT,
    O_DEFAULT,
    O_SCENE,
    O_SET,
    OrientationType,
    PivotType,
    PropFalloff,
    SnapSourceType,
    SnapTargetType,
    T_EDIT,
    T_INPUT_IS_VALUES_FINAL,
    T_MODAL,
    T_NO_CONSTRAINT,
    T_NULL_ONE,
    T_POINTS,
    T_PROP_CONNECTED,
    T_PROP_EDIT,
    T_PROP_EDIT_ALL,
    T_PROP_PROJECTED,
    T_RELEASE_CONFIRM,
    TD_SELECTED,
    TD_SKIP,
    TransData,
    TransDataContainer,
    TransDataExtension,
    TransformMode,
} from './types'
import {
    getSnapPoint,
    initSnappingMode,
    newTransSnap,
    resetSnapping,
    TRANSFORM_DIST_INVALID,
    transformSnapDistanceLenSquaredFn,
    transformSnapFlagFromModifiersSet,
    transformSnapIncrement,
    transformSnapIncrementEx,
    transformSnapIncrementGet,
    transformSnapMixedApply,
    TransSnap,
    validSnap,
} from '../snap/transformSnap'
import {gridViewScale, SnapContext} from '../snap/snap'
import {blenderTransformKeymap, ModalKeyEvent, TransformKeymap, TransformModalItem} from './keymap'

/** `T_PROP_SIZE_MIN/MAX` (`transform.hh:37`). */
const T_PROP_SIZE_MIN = 1e-6
const T_PROP_SIZE_MAX = 1e12

export interface ProportionalSettings {
    enabled: boolean
    connected: boolean
    projected: boolean
    size: number
    falloff: PropFalloff
}

export interface SnapSettings {
    /** The header magnet; Ctrl inverts it during a transform. */
    enabled: boolean
    targets: SnapTargetType[]
    source: SnapSourceType
    /** Increment snapping is absolute (to the world grid), not relative to the start. */
    absoluteGrid: boolean
    affect: {translate: boolean, rotate: boolean, resize: boolean}
    backfaceCulling: boolean
    /** Only visible geometry is a target (off with X-ray). */
    occlusion: boolean
}

/** An object to transform in object mode. */
export interface ObjectTransformTarget {
    id: unknown
    /** World matrix at the start (column-major). */
    matrixWorld: Mat4
    /** The parent's world matrix (identity when unparented). */
    parentMatrixWorld: Mat4
    /** The object's local scale, which resize multiplies. */
    localScale: Vec3
}

/** Per-object results, `TransDataExtension` plus what the caller writes back. */
export interface ObjectTransData extends TransDataExtension {
    iscale: Vec3
    /** World rotation at the start, unit axes. */
    irot: Mat3
    /** Results: world position in `td.loc`, this rotation and local scale. */
    rotWorld: Mat3
    scale: Vec3
}

export interface TransInfoOptions {
    mode: TransformMode
    view: TransformView
    /** The cursor in region pixels, y up. */
    mval: Vec2
    around: PivotType
    /** The 3D cursor, world space. */
    cursor?: Vec3
    cursorMatrix?: Mat3
    /** The scene's orientation (the header dropdown). */
    orientation: OrientationType
    /** An orientation set by the operator (extrude's normal, a gizmo): overrides the default. */
    orientationSet?: OrientationType | null
    /** The basis for `custom`. */
    customMatrix?: Mat3
    proportional?: Partial<ProportionalSettings>
    snap?: Partial<SnapSettings>
    snapContext?: SnapContext | null
    /** `CON_AXIS*` bits to start constrained with (gizmo handles). */
    constraint?: number
    releaseConfirm?: boolean
    precision?: boolean
    keymap?: TransformKeymap
    /** Edit mode: the mesh and its object's world matrix. */
    bm?: BMesh | null
    objectMatrix?: Mat4
    /** Object mode: the objects to move. */
    objects?: ObjectTransformTarget[]
    activeObjectCenter?: Vec3 | null
    /** Called after every apply, once the results are flushed. */
    onChange?: (t: TransInfo) => void
    /** Blender seeds its random falloff from the clock; tests pass a fixed source. */
    random?: () => number
}

export type TransState = 'starting' | 'running' | 'confirm' | 'cancel'

/** `TransModeInfo` (`transform_mode.hh`). */
export interface TransformModeInfo {
    flags: number
    init(t: TransInfo): void
    transform(t: TransInfo): void
    snapDistance(t: TransInfo, p1: Vec3, p2: Vec3): number
    snapApply(t: TransInfo, vec: number[]): void
}

export type TransformEvent =
    | {type: 'mousemove', mval: Vec2}
    | {type: 'modal', item: TransformModalItem, delta?: number}
    | {type: 'key', event: ModalKeyEvent}
    | {type: 'propsizeDelta', dy: number}

export class TransInfo implements MouseInputContext {
    mode: TransformMode
    modeInfo: TransformModeInfo
    flag = 0
    modifiers = 0
    options = 0
    state: TransState = 'starting'

    readonly view: TransformView
    mval: Vec2
    readonly mouse = new MouseInput()
    readonly num = new NumInput()
    con: TransCon = newTransCon()

    values: Vec3 = [0, 0, 0]
    valuesFinal: Vec3 = [0, 0, 0]
    valuesModalOffset: Vec3 = [0, 0, 0]

    centerGlobal: Vec3 = [0, 0, 0]
    center2d: Vec2 = [0, 0]
    zfac = 1
    around: PivotType

    /** The three orientation slots (`O_DEFAULT`, `O_SCENE`, `O_SET`). */
    orient: {type: OrientationType, matrix: Mat3}[] = []
    orientCurr = O_DEFAULT
    /** Which axis of `spacemtx` an unconstrained rotation uses (Z of the view by default). */
    orientAxis = 2
    spacemtx: Mat3 = unitM3()
    spacemtxInv: Mat3 = unitM3()
    spacename = 'global'
    isOrientDefaultOverwrite = false

    propSize = 1
    propMode: PropFalloff = 'smooth'
    proptext = ''

    tsnap: TransSnap = newTransSnap()
    increment: Vec3 = [1, 1, 1]
    incrementPrecision = 0.1
    snapSpatial: Vec3 = [1, 1, 1]
    snapSpatialPrecision = 0.1

    idxMax = 2
    containers: TransDataContainer[] = []
    cursor: Vec3 = [0, 0, 0]
    readonly bm: BMesh | null
    readonly activeObjectCenter: Vec3 | null
    /** The resize matrix, for the gizmo. */
    mat: Mat3 = unitM3()
    rng: () => number
    keymap: TransformKeymap
    /** The header text, as Blender draws it. */
    header = ''
    /** The selection's bounds in world space at the start, for the gizmo and the helpline. */
    private _onChange: ((t: TransInfo) => void) | null
    private _orientationCtx: {objectMatrix: Mat4, cursorMatrix?: Mat3, customMatrix?: Mat3, objectMode: boolean}
    private _islands: TransIslandData | null = null
    private _snapTargets: Set<SnapTargetType>

    constructor(opts: TransInfoOptions) {
        this.mode = opts.mode
        this.modeInfo = modeInfoGet(opts.mode)
        this.view = opts.view
        this.mval = [opts.mval[0], opts.mval[1]]
        this.around = opts.around
        this.cursor = opts.cursor ? copyV3(opts.cursor) : [0, 0, 0]
        this.bm = opts.bm ?? null
        this.activeObjectCenter = opts.activeObjectCenter ?? null
        this.rng = opts.random ?? Math.random
        this.keymap = opts.keymap ?? blenderTransformKeymap
        this._onChange = opts.onChange ?? null
        this.flag = T_MODAL
        if (opts.releaseConfirm) this.flag |= T_RELEASE_CONFIRM

        const objectMatrix = opts.objectMatrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        this._orientationCtx = {objectMatrix, cursorMatrix: opts.cursorMatrix, customMatrix: opts.customMatrix, objectMode: !opts.bm}

        // Proportional editing flags come first: data creation depends on them.
        const prop = opts.proportional
        if (prop?.enabled) {
            this.flag |= T_PROP_EDIT
            if (prop.connected) this.flag |= T_PROP_CONNECTED
            if (prop.projected) this.flag |= T_PROP_PROJECTED
        }
        this.propSize = prop?.size ?? 1
        this.propMode = prop?.falloff ?? 'smooth'

        // `createTransData`.
        if (opts.bm) {
            this.flag |= T_EDIT | T_POINTS
            this.containers = createTransEditVerts(this, opts.bm, objectMatrix)
        } else if (opts.objects) {
            this.options |= CTX_OBJECT
            this.containers = createTransObjects(this, opts.objects)
        }
        if (this.flag & T_PROP_EDIT && this.dataLenAll > 0) {
            // `createTransData`: distances to the selection, then the falloff factors.
            setPropDist(this, !(this.flag & T_PROP_CONNECTED))
        }

        // Snapping (`initSnapping`).
        this._snapTargets = new Set(opts.snap?.targets ?? ['increment'])
        this.tsnap.sourceOperation = opts.snap?.source ?? 'closest'
        this.tsnap.absGrid = !!opts.snap?.absoluteGrid
        this.tsnap.affect = opts.snap?.affect ?? {translate: true, rotate: false, resize: false}
        this.tsnap.backfaceCulling = !!opts.snap?.backfaceCulling
        this.tsnap.occlusion = opts.snap?.occlusion ?? true
        this.tsnap.context = opts.snapContext ?? null
        if (opts.snap?.enabled) this.modifiers |= MOD_SNAP
        this.snapSpatial = [gridViewScale(this.view), gridViewScale(this.view), gridViewScale(this.view)]
        this.snapSpatialPrecision = 0.1
        this.increment = [1, 1, 1]
        this.incrementPrecision = 0.1
        this.transformSnapResetFromMode()

        // A constraint set by the caller (`initTransInfo`, `constraint_axis`).
        if (opts.constraint) this.con.mode = CON_APPLY | opts.constraint & (CON_AXIS0 | CON_AXIS1 | CON_AXIS2)

        this._initOrientations(opts.orientation, opts.orientationSet ?? null)

        this.calculateCenter()

        initMouseInput(this.mouse, this.center2d, this.mval, !!opts.precision)
        if (opts.precision) this.modifiers |= MOD_PRECISION

        this.transformModeInit(opts.mode)

        // Constraint init from the operator (`initTransform`).
        if (this.con.mode & CON_APPLY) setUserConstraint(this, this.con.mode, '%s')

        if (this.flag & T_PROP_EDIT) calculatePropRatio(this)
        else for (const tc of this.containers) for (const td of tc.data) td.factor = 1

        // The first apply, with the cursor where it is, so the header and the gizmo are right.
        this.values = applyMouseInput(this, this.mouse, this.mval)
        this.apply()
    }

    // region accessors

    get isEditMesh(): boolean {
        return this.bm !== null
    }

    get dataLenAll(): number {
        let n = 0
        for (const tc of this.containers) n += tc.data.length
        return n
    }

    get isEmpty(): boolean {
        return this.dataLenAll === 0
    }

    get isDone(): boolean {
        return this.state === 'confirm' || this.state === 'cancel'
    }

    /** `transform_snap_is_active`. */
    snapIsActive(): boolean {
        return this.tsnap.active
    }

    validSnap(): boolean {
        return validSnap(this)
    }

    // endregion

    // region setup

    /**
     * The orientation slots (`initTransInfo`, `transform_generics.cc:412-520`): the scene's
     * orientation, the operator's (if any) and the alternative an axis key cycles to.
     */
    private _initOrientations(scene: OrientationType, set: OrientationType | null): void {
        let orientTypeApply = O_DEFAULT
        let orientTypeDefault: OrientationType = scene
        let orientTypeSet: OrientationType | null = set

        if (orientTypeSet !== null) {
            if (!(this.con.mode & CON_APPLY)) {
                // Only overwrite the default if not constrained.
                orientTypeDefault = orientTypeSet
                this.isOrientDefaultOverwrite = true
            }
        }
        if (orientTypeSet === null) {
            orientTypeSet = scene === 'global' ? 'local' : 'global'
            if (this.con.mode & CON_APPLY) orientTypeApply = O_SCENE
        } else {
            orientTypeApply = O_SET
        }

        const types: OrientationType[] = []
        types[O_DEFAULT] = orientTypeDefault
        types[O_SCENE] = scene
        types[O_SET] = orientTypeSet
        this.orient = types.map(type => ({type, matrix: this.calcOrientation(type)}))
        this.orientationsCurrentSet(orientTypeApply)
    }

    calcOrientation(type: OrientationType): Mat3 {
        return calcOrientationFromType(type, {
            objectMatrix: this._orientationCtx.objectMatrix,
            view: this.view,
            bm: this.bm,
            around: this.around,
            cursorMatrix: this._orientationCtx.cursorMatrix,
            customMatrix: this._orientationCtx.customMatrix,
            objectMode: this._orientationCtx.objectMode,
        })
    }

    /** `transform_orientations_current_set` (`transform_orientations.cc:859`). */
    orientationsCurrentSet(index: number): void {
        const slot = this.orient[index]
        this.spacename = orientationSpaceName(slot.type)
        this.spacemtx = copyM3(slot.matrix)
        this.spacemtxInv = invertM3(this.spacemtx)
        this.orientCurr = index
    }

    /** `transform_mode_default_modal_orientation_set` (`transform_mode.cc:1230`). */
    defaultModalOrientationSet(type: OrientationType): void {
        if (this.isOrientDefaultOverwrite) return
        if (!(this.flag & T_MODAL)) return
        if (this.orient[O_DEFAULT].type === type) return
        this.orient[O_DEFAULT] = {type, matrix: this.calcOrientation(type)}
        if (this.orientCurr === O_DEFAULT) this.orientationsCurrentSet(O_DEFAULT)
    }

    /** `calculateCenter` (`transform_generics.cc:1215`). */
    calculateCenter(): void {
        this.centerGlobal = calculateCenterFromAround({
            containers: this.containers,
            around: this.around,
            cursor: this.cursor,
            bm: this.bm,
            activeObjectCenter: this.activeObjectCenter,
        })
        // `calculateCenterLocal`.
        for (const tc of this.containers) {
            tc.centerLocal = tc.useLocalMat ? mulM4V3(tc.imat, this.centerGlobal) : copyV3(this.centerGlobal)
        }
        this.center2d = this.view.projectFloatViewOrCenter(this.centerGlobal)
        this.zfac = this.view.calcZfac(this.centerGlobal)
    }

    /** `transform_snap_reset_from_mode` (`transform_snap.cc:951`). */
    transformSnapResetFromMode(): void {
        resetSnapping(this)
        initSnappingMode(this, this._snapTargets)
        transformSnapFlagFromModifiersSet(this)
    }

    /** `transform_mode_init` (`transform_mode.cc:1207`). */
    transformModeInit(mode: TransformMode): void {
        this.mode = mode
        this.modeInfo = modeInfoGet(mode)
        this.flag |= this.modeInfo.flags
        this.modeInfo.init(this)
    }

    // endregion

    // region input

    /** `convertViewVec` (`transform.cc:185`). */
    convertViewVec(dx: number, dy: number): Vec3 {
        return this.view.winToDelta(dx, dy, this.zfac)
    }

    /** `transformApply` (`transform.cc:2243`): recompute everything from the current input. */
    apply(): void {
        if (this.isDone) return
        selectConstraint(this)
        this.modeInfo.transform(this)
        this.flushVerts()
        this._onChange?.(this)
    }

    /** `restoreTransObjects` (`transform_generics.cc:865`). */
    restoreTransObjects(): void {
        for (const tc of this.containers) {
            for (const td of tc.data) {
                restoreElement(td)
                if (td.ext) {
                    const ext = td.ext as unknown as ObjectTransData
                    ext.rotWorld = copyM3(ext.irot)
                    ext.scale = copyV3(ext.iscale)
                }
            }
        }
    }

    /** `transformEvent` (`transform.cc:1070`). Returns true when something changed. */
    handleEvent(ev: TransformEvent): boolean {
        if (this.isDone) return false
        switch (ev.type) {
        case 'mousemove':
            this.mval = [ev.mval[0], ev.mval[1]]
            if (this.state === 'starting') this.state = 'running'
            this.values = applyMouseInput(this, this.mouse, this.mval)
            this.apply()
            return true
        case 'key': {
            const e = ev.event
            // Handle modal numinput events first, if already activated.
            if (e.press && hasNumInput(this.num) && handleNumInput(this.num, keyToNumEvent(e))) {
                this.apply()
                return true
            }
            const item = this.keymap(e)
            if (item && this._handleModal(item)) return true
            // Try to init modal numinput now, if possible.
            if (e.press && handleNumInput(this.num, keyToNumEvent(e))) {
                this.apply()
                return true
            }
            return false
        }
        case 'modal':
            return this._handleModal(ev.item)
        case 'propsizeDelta':
            if (this.flag & T_PROP_EDIT) {
                const fac = 1 + 0.005 * ev.dy
                this.propSize *= fac
                this.propSize = Math.max(Math.min(this.propSize, T_PROP_SIZE_MAX), T_PROP_SIZE_MIN)
                calculatePropRatio(this)
                this.apply()
                return true
            }
            return false
        }
    }

    private _handleModal(item: TransformModalItem): boolean {
        switch (item) {
        case 'cancel':
            this.cancel()
            return true
        case 'confirm':
            this.confirm()
            return true
        case 'translate':
        case 'rotate':
        case 'resize': {
            if (item === this.mode) return false
            // `TFM_MODAL_TRANSLATE/ROTATE/RESIZE`: restart in the other mode from the same input.
            this.restoreTransObjects()
            if (item === 'resize' && this.con.mode & CON_APPLY && this.orient[this.orientCurr].type === 'normal') {
                // Scale isn't normally very useful after extrude along normals, see #39756.
                stopConstraint(this)
            }
            this.flag &= ~(T_NO_CONSTRAINT | T_NULL_ONE)
            initNumInput(this.num)
            this.transformModeInit(item)
            this.transformSnapResetFromMode()
            this.values = applyMouseInput(this, this.mouse, this.mval)
            this.apply()
            return true
        }
        case 'snapInvOn':
            if (!(this.modifiers & MOD_SNAP_INVERT)) {
                this.modifiers |= MOD_SNAP_INVERT
                transformSnapFlagFromModifiersSet(this)
                this.apply()
            }
            return true
        case 'snapInvOff':
            if (this.modifiers & MOD_SNAP_INVERT) {
                this.modifiers &= ~MOD_SNAP_INVERT
                transformSnapFlagFromModifiersSet(this)
                this.apply()
            }
            return true
        case 'snapToggle':
            this.modifiers ^= MOD_SNAP
            transformSnapFlagFromModifiersSet(this)
            this.apply()
            return true
        case 'axisX':
        case 'axisY':
        case 'axisZ':
        case 'planeX':
        case 'planeY':
        case 'planeZ':
            if (transformEventModalConstraint(this, item)) {
                this.apply()
                return true
            }
            return false
        case 'consOff':
            if (!(this.flag & T_NO_CONSTRAINT)) {
                stopConstraint(this)
                this.apply()
                return true
            }
            return false
        case 'propsizeUp':
            if (this.flag & T_PROP_EDIT) {
                this.propSize *= this.modifiers & MOD_PRECISION ? 1.01 : 1.1
                this.propSize = Math.min(this.propSize, T_PROP_SIZE_MAX)
                calculatePropRatio(this)
                this.apply()
                return true
            }
            return false
        case 'propsizeDown':
            if (this.flag & T_PROP_EDIT) {
                this.propSize /= this.modifiers & MOD_PRECISION ? 1.01 : 1.1
                this.propSize = Math.max(this.propSize, T_PROP_SIZE_MIN)
                calculatePropRatio(this)
                this.apply()
                return true
            }
            return false
        case 'propFalloffCycle':
            if (this.flag & T_PROP_EDIT) {
                const i = PROP_FALLOFF_ORDER.indexOf(this.propMode)
                this.propMode = PROP_FALLOFF_ORDER[(i + 1) % PROP_FALLOFF_ORDER.length]
                calculatePropRatio(this)
                this.apply()
                return true
            }
            return false
        case 'propConnectedToggle':
            if (this.flag & T_PROP_EDIT) {
                this.flag ^= T_PROP_CONNECTED
                calculatePropRatio(this)
                this.apply()
                return true
            }
            return false
        case 'precisionOn':
            this.modifiers |= MOD_PRECISION
            // The mouse position during Snap to Grid is not affected by precision.
            if (!(this.snapIsActive() && this.validSnap() && this.tsnap.targetType === 'grid')) {
                this.mouse.precision = true
            }
            this.apply()
            return true
        case 'precisionOff':
            this.modifiers &= ~MOD_PRECISION
            this.mouse.precision = false
            this.apply()
            return true
        case 'autoConstraint':
        case 'autoConstraintPlane':
            if (this.flag & T_NO_CONSTRAINT) return false
            if (this.modifiers & (MOD_CONSTRAINT_SELECT_AXIS | MOD_CONSTRAINT_SELECT_PLANE)) {
                // Confirm.
                postSelectConstraint(this)
                this.modifiers &= ~(MOD_CONSTRAINT_SELECT_AXIS | MOD_CONSTRAINT_SELECT_PLANE)
            } else {
                this.modifiers |= item === 'autoConstraint' ? MOD_CONSTRAINT_SELECT_AXIS : MOD_CONSTRAINT_SELECT_PLANE
                if (this.con.mode & CON_APPLY) stopConstraint(this)
                initSelectConstraint(this)
            }
            this.apply()
            return true
        case 'incrementUp':
        case 'incrementDown':
            if (handleNumInput(this.num, {key: '', modal: item})) {
                this.apply()
                return true
            }
            return false
        default:
            return false
        }
    }

    /** Keep the current positions (`TRANS_CONFIRM`). */
    confirm(): void {
        if (this.isDone) return
        this.state = 'confirm'
    }

    /** Put everything back exactly (`TRANS_CANCEL`, `restoreTransObjects`). */
    cancel(): void {
        if (this.isDone) return
        this.restoreTransObjects()
        this.flushVerts()
        this.state = 'cancel'
        this._onChange?.(this)
    }

    // endregion

    // region results

    /** Write the vertex results into the mesh (`recalcData_mesh`, where `td->loc` is `v->co`). */
    flushVerts(): void {
        if (!this.bm) return
        for (const tc of this.containers) {
            for (const td of tc.data) {
                const v = td.extra as BMVert
                v.x = td.loc[0]
                v.y = td.loc[1]
                v.z = td.loc[2]
            }
        }
    }

    /** The object results, for the caller to write back. */
    objectResults(): {id: unknown, loc: Vec3, rotWorld: Mat3, scale: Vec3, parentInv: Mat4}[] {
        const out: {id: unknown, loc: Vec3, rotWorld: Mat3, scale: Vec3, parentInv: Mat4}[] = []
        for (const tc of this.containers) {
            for (const td of tc.data) {
                if (!td.ext) continue
                const ext = td.ext as unknown as ObjectTransData
                out.push({id: td.extra, loc: copyV3(td.loc), rotWorld: copyM3(ext.rotWorld), scale: copyV3(ext.scale), parentInv: ext.parentInv})
            }
        }
        return out
    }

    /** The island data, for callers drawing per-island pivots. */
    get islands(): TransIslandData | null {
        return this._islands
    }

    set islands(v: TransIslandData | null) {
        this._islands = v
    }

    // endregion
}

function keyToNumEvent(e: ModalKeyEvent): NumInputEvent {
    return {key: e.key, code: e.code, ctrl: e.ctrl, shift: e.shift, alt: e.alt}
}

/** `transdata_check_local_center` (`transform_mode.cc:58`). */
export function transdataCheckLocalCenter(t: TransInfo, around: PivotType): boolean {
    return around === 'individual' && ((t.options & CTX_OBJECT) !== 0 || t.isEditMesh)
}

// region data creation

/**
 * `createTransEditVerts` (`transform_convert_mesh.cc:1484`): one `TransData` per selected vertex,
 * or per visible vertex with proportional editing.
 */
function createTransEditVerts(t: TransInfo, bm: BMesh, objectMatrix: Mat4): TransDataContainer[] {
    const propMode = t.flag & T_PROP_EDIT ? t.flag & T_PROP_EDIT_ALL : 0

    // Note: ignore modes here, even in edge/face modes transform data is created by selected vertices.
    if ((!propMode || propMode & T_PROP_CONNECTED) && bm.totvertsel === 0) return []

    meshNormalsUpdate(bm)

    // Even for translation this is needed because of island orientation, see #51651.
    const isIslandCenter = t.around === 'individual'
    let islandData: TransIslandData | null = null
    if (isIslandCenter) {
        // In this specific case nearby vertices need to know the island of the nearest connected vertex.
        const calcSingleIslands = (propMode & T_PROP_CONNECTED) !== 0 && t.around === 'individual' && (bm.selectMode & SelectMode.Vertex) !== 0
        islandData = meshIslandsCalc(bm, calcSingleIslands, true, true)
        t.islands = islandData
    }

    const mtx = m3FromM4(objectMatrix)
    const smtx = invertM3(mtx)
    const mat3Unit = normalizeM3(mtx)

    // Connected distances: Blender only measures them when "connected" is on; measuring whenever
    // proportional editing is on lets Alt+C switch mid-transform without every factor dropping to 0.
    let dists: Float32Array | null = null
    let distsIndex: Int32Array | null = null
    if (propMode) {
        dists = new Float32Array(bm.totvert)
        if (isIslandCenter) distsIndex = new Int32Array(bm.totvert)
        meshConnectivityDistance(bm, mtx, dists, distsIndex)
    }
    bm.elemIndexEnsure()

    const data: TransData[] = []
    for (const v of bm.verts) {
        if (v.hflag & ElemFlag.Hidden) continue
        const selected = (v.hflag & ElemFlag.Select) !== 0
        if (!(propMode || selected)) continue

        let islandIndex = -1
        if (islandData) {
            let connected: BMVert = v
            if (distsIndex && distsIndex[v.index] !== -1 && distsIndex[v.index] !== v.index) {
                connected = bm.vertAt(distsIndex[v.index]) ?? v
            }
            islandIndex = islandData.islandVertMap.get(connected) ?? -1
        }

        // `VertsToTransData` (`transform_convert_mesh.cc:1435`).
        const iloc: Vec3 = [v.x, v.y, v.z]
        const no = vertNo(v)
        let center: Vec3
        if (islandData?.center && islandIndex !== -1) center = copyV3(islandData.center[islandIndex])
        else center = copyV3(iloc)

        let axismtx: Mat3
        if (islandIndex !== -1 && islandData?.axismtx) {
            axismtx = copyM3(islandData.axismtx[islandIndex])
        } else if (t.around === 'individual') {
            axismtx = createSpaceNormal(no) ?? unitM3()
        } else {
            axismtx = [[0, 0, 0], [0, 0, 0], no]
        }

        const td: TransData = {
            loc: copyV3(iloc), iloc, center, axismtx, mtx, smtx,
            factor: 1, dist: 0, rdist: 0, flag: 0, extra: v,
        }
        if (selected) td.flag |= TD_SELECTED
        // Blender stores FLT_MAX unless "connected" is on; the measured distance is kept so Alt+C
        // mid-transform has data (the falloff reads `rdist` when not connected, so nothing changes).
        if (propMode && dists) td.dist = dists[v.index]
        data.push(td)
    }

    const imat = invertM4(objectMatrix)
    return [{
        data,
        mat: objectMatrix.slice(),
        imat,
        mat3: mtx,
        imat3: smtx,
        mat3Unit,
        useLocalMat: true,
        centerLocal: [0, 0, 0],
        object: null,
    }]
}

/**
 * `createTransObject` / `ObjectToTransData` (`transform_convert_object.cc`): objects are
 * transformed in world space; the caller writes the world result back into the local transform.
 */
function createTransObjects(_t: TransInfo, objects: ObjectTransformTarget[]): TransDataContainer[] {
    const data: TransData[] = []
    for (const ob of objects) {
        const world = ob.matrixWorld
        const loc = m4Col(world, 3)
        const axismtx = normalizeM3(m3FromM4(world))
        const ext: ObjectTransData = {
            obmat: world.slice(),
            parentInv: invertM4(ob.parentMatrixWorld),
            iscale: copyV3(ob.localScale),
            irot: copyM3(axismtx),
            rotWorld: copyM3(axismtx),
            scale: copyV3(ob.localScale),
        }
        data.push({
            loc: copyV3(loc), iloc: copyV3(loc), center: copyV3(loc), axismtx,
            mtx: unitM3(), smtx: unitM3(), factor: 1, dist: 0, rdist: 0, flag: TD_SELECTED, extra: ob.id,
            ext,
        })
    }
    const identity: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    return [{
        data, mat: identity, imat: identity.slice(), mat3: unitM3(), imat3: unitM3(), mat3Unit: unitM3(),
        useLocalMat: false, centerLocal: [0, 0, 0], object: null,
    }]
}

// endregion

// region translate (`transform_mode_translate.cc`)

/** `translate_dist_to_str` (`transform_mode_translate.cc:162`). */
function translateDistToStr(val: number, highPrecision: boolean): string {
    return val.toFixed(highPrecision ? 6 : 4)
}

/** `BLI_string_pad_number_sign`: a leading space keeps positive numbers aligned with negative ones. */
function padNumberSign(s: string): string {
    return s.startsWith('-') ? s : ' ' + s
}

/** `headerTranslation` (`transform_mode_translate.cc:173`). */
function headerTranslation(t: TransInfo, vec: Vec3): string {
    const highPrecision = (t.modifiers & MOD_PRECISION) !== 0
    let dvecStr: string[]
    let dist: number
    if (hasNumInput(t.num)) {
        dvecStr = outputNumInput(t.num)
        dist = lenV3([t.num.val[0], t.num.val[1], t.num.val[2]])
    } else {
        const dvec = copyV3(vec)
        if (t.con.mode & CON_APPLY) {
            let i = 0
            if (t.con.mode & CON_AXIS0) dvec[i++] = dvec[0]
            if (t.con.mode & CON_AXIS1) dvec[i++] = dvec[1]
            if (t.con.mode & CON_AXIS2) dvec[i++] = dvec[2]
            while (i !== 3) dvec[i++] = 0
        }
        dist = lenV3(dvec)
        dvecStr = dvec.map(d => padNumberSign(translateDistToStr(d, highPrecision)))
    }
    const distStr = translateDistToStr(dist, highPrecision)

    let str = ''
    if (t.flag & T_PROP_EDIT_ALL) {
        str += `Proportional Size ${t.proptext}: ${translateDistToStr(t.propSize, highPrecision)}   `
    }
    if (t.con.mode & CON_APPLY) {
        switch (t.num.idxMax) {
        case 0:
            str += `D: ${dvecStr[0]} (${distStr})${t.con.text}`
            break
        case 1:
            str += `D: ${dvecStr[0]}   D: ${dvecStr[1]} (${distStr})${t.con.text}`
            break
        default:
            str += `D: ${dvecStr[0]}   D: ${dvecStr[1]}   D: ${dvecStr[2]} (${distStr})${t.con.text}`
            break
        }
    } else {
        str += `Dx: ${dvecStr[0]}   Dy: ${dvecStr[1]}   Dz: ${dvecStr[2]} (${distStr})${t.con.text}`
    }
    return str
}

/** `ApplySnapTranslation` (`transform_mode_translate.cc:326`). */
function applySnapTranslation(t: TransInfo, vec: number[]): void {
    const point = getSnapPoint(t)
    const d = subV3(point, t.tsnap.snapSource)
    vec[0] = d[0]
    vec[1] = d[1]
    vec[2] = d[2]
}

/** `translate_snap_increment_init` (`transform_mode_translate.cc:353`). */
function translateSnapIncrementInit(t: TransInfo): void {
    if (!t.tsnap.absGrid) return
    t.tsnap.snapTargetGrid = copyV3(t.centerGlobal)
}

/** `translate_snap_increment` (`transform_mode_translate.cc:376`). */
function translateSnapIncrement(t: TransInfo, val: number[]): boolean {
    const constrained = (t.con.mode & CON_APPLY) !== 0
    if (!transformSnapIncrementEx(t, constrained, val)) return false
    if (t.tsnap.absGrid) {
        const offset: number[] = copyV3(t.tsnap.snapTargetGrid)
        transformSnapIncrementEx(t, constrained, offset)
        offset[0] -= t.tsnap.snapTargetGrid[0]
        offset[1] -= t.tsnap.snapTargetGrid[1]
        offset[2] -= t.tsnap.snapTargetGrid[2]
        val[0] += offset[0]
        val[1] += offset[1]
        val[2] += offset[2]
        if (constrained) {
            const r = conApplyVec(t, null, null, [val[0], val[1], val[2]])
            val[0] = r[0]
            val[1] = r[1]
            val[2] = r[2]
        }
    }
    return true
}

/** `transdata_elem_translate` (`transform_mode_translate.cc:69`), without snap-to-normal rotation. */
function transdataElemTranslate(t: TransInfo, tc: TransDataContainer, td: TransData, vec: Vec3): void {
    let tvec = conApplyVec(t, tc, td, vec)
    tvec = mulM3V3(td.smtx, tvec)
    // Proportional editing falloff.
    tvec = mulV3Fl(tvec, td.factor)
    td.loc = addV3(td.iloc, tvec)
    if (td.ext) {
        const ext = td.ext as unknown as ObjectTransData
        ext.rotWorld = copyM3(ext.irot)
        ext.scale = copyV3(ext.iscale)
    }
}

/** `applyTranslationValue` (`transform_mode_translate.cc:403`). */
function applyTranslationValue(t: TransInfo, vec: Vec3): void {
    for (const tc of t.containers) {
        for (const td of tc.data) {
            if (td.flag & TD_SKIP) continue
            transdataElemTranslate(t, tc, td, vec)
        }
    }
}

/** `applyTranslation` (`transform_mode_translate.cc:497`). */
function applyTranslation(t: TransInfo): void {
    let globalDir: Vec3 = [0, 0, 0]

    if (t.flag & T_INPUT_IS_VALUES_FINAL) {
        globalDir = mulM3V3(t.spacemtx, t.values)
    } else if (applyNumInput(t.num, globalDir)) {
        if (t.con.mode & CON_APPLY) {
            if (t.con.mode & CON_AXIS0) globalDir = mulV3Fl(t.spacemtx[0], globalDir[0])
            else if (t.con.mode & CON_AXIS1) globalDir = mulV3Fl(t.spacemtx[1], globalDir[0])
            else if (t.con.mode & CON_AXIS2) globalDir = mulV3Fl(t.spacemtx[2], globalDir[0])
        } else {
            globalDir = mulM3V3(t.spacemtx, globalDir)
        }
    } else {
        globalDir = copyV3(t.values)
        if (!isZeroV3(t.valuesModalOffset)) {
            globalDir = addV3(globalDir, mulM3V3(t.spacemtx, t.valuesModalOffset))
        }

        transformSnapMixedApply(t, globalDir)

        if (t.con.mode & CON_APPLY) {
            globalDir = conApplyVec(t, null, null, copyV3(globalDir))
        }

        const incrDir: number[] = copyV3(globalDir)
        if (!(t.snapIsActive() && validSnap(t)) && translateSnapIncrement(t, incrDir)) {
            // Test for mixed snap with grid.
            let snapDistSq = Number.MAX_VALUE
            if (t.tsnap.targetType !== 'none') snapDistSq = lenSquaredV3V3(t.values, globalDir)
            if (snapDistSq === Number.MAX_VALUE || lenSquaredV3V3(globalDir, incrDir as Vec3) < snapDistSq) {
                globalDir = [incrDir[0], incrDir[1], incrDir[2]]
            }
        }
    }

    applyTranslationValue(t, globalDir)

    // Set the redo value.
    t.valuesFinal = mulM3V3(t.spacemtxInv, globalDir)
    t.header = headerTranslation(t, t.con.mode & CON_APPLY ? t.valuesFinal : globalDir)
}

/** `initTranslation` (`transform_mode_translate.cc:582`). */
function initTranslation(t: TransInfo): void {
    initMouseInputMode(t.mouse, 'vector')
    t.idxMax = 2
    t.num.flag = 0
    t.num.idxMax = t.idxMax
    t.increment = copyV3(t.snapSpatial)
    t.incrementPrecision = t.snapSpatialPrecision
    t.num.valInc = [t.increment[0], t.increment[0], t.increment[0]]
    t.num.unitType = ['length', 'length', 'length']
    t.defaultModalOrientationSet('global')
    translateSnapIncrementInit(t)
}

const TransModeTranslate: TransformModeInfo = {
    flags: 0,
    init: initTranslation,
    transform: applyTranslation,
    snapDistance: transformSnapDistanceLenSquaredFn,
    snapApply: applySnapTranslation,
}

// endregion

// region rotate (`transform_mode_rotate.cc`)

/** `transform_mode_rotation_axis_get` (`transform_mode.cc:1273`). */
export function transformModeRotationAxisGet(t: TransInfo): Vec3 {
    const con = conApplyRot(t, null, null)
    if (con) return con
    let axis = copyV3(t.spacemtx[t.orientAxis])
    // For unconstrained rotation in the 3D viewport, flip the axis so the rotation direction
    // matches the mouse movement in view space.
    if (t.mode === 'rotate' && !(t.con.mode & CON_APPLY)) axis = mulV3Fl(axis, -1)
    return axis
}

/** `transform_mode_is_axis_pointing_to_screen` (`transform_mode.cc:1290`). */
function transformModeIsAxisPointingToScreen(t: TransInfo, axis: Vec3): boolean {
    return dotV3(axis, t.view.viewVector(t.centerGlobal)) > 0
}

/** `RotationBetween` (`transform_mode_rotate.cc:165`): the angle between two points about the pivot. */
function rotationBetween(t: TransInfo, p1: Vec3, p2: Vec3): number {
    const start = subV3(p1, t.centerGlobal)
    const end = subV3(p2, t.centerGlobal)
    let angle: number
    const conAxis = conApplyRot(t, null, null)
    if (conAxis) {
        angle = -angleSignedOnAxisV3V3V3(start, end, conAxis)
    } else {
        const mtx = m3FromM4(t.view.viewmat)
        const e = mulM3V3(mtx, end)
        const s = mulM3V3(mtx, start)
        angle = Math.atan2(s[1], s[0]) - Math.atan2(e[1], e[0])
    }
    if (angle > Math.PI) angle -= 2 * Math.PI
    else if (angle < -Math.PI) angle = 2 * Math.PI + angle
    return angle
}

/** `ApplySnapRotation` (`transform_mode_rotate.cc:201`). */
function applySnapRotation(t: TransInfo, value: number[]): void {
    value[0] = rotationBetween(t, t.tsnap.snapSource, getSnapPoint(t))
}

/** `large_rotation_limit` (`transform_mode_rotate.cc:210`): at most 1001 turns. */
function largeRotationLimit(angle: number): number {
    const angleMax = Math.PI * 2000
    if (Math.abs(angle) > angleMax) {
        const sign = angle < 0 ? -1 : 1
        angle = sign * (Math.abs(angle) % (Math.PI * 2) + angleMax)
    }
    return angle
}

/** `transform_angle_to_quadrant_or_null` (`transform_mode_rotate_quadrants.cc:92`). */
function transformAngleToQuadrantOrNull(t: TransInfo, isLargeRotationLimited: boolean): number | null {
    if (isLargeRotationLimited) return null
    const fromDegrees = (degrees: number): number | null => {
        if (!numinputDoubleIsInt(degrees)) return null
        const deg = Math.trunc(degrees)
        if (deg % 90 !== 0) return null
        return ((deg / 90) % 4 + 4) % 4
    }
    if (hasNumInput(t.num)) {
        if (!numInputIsInt(t.num, 0)) return null
        return fromDegrees(t.num.valNoUnits[0])
    }
    // Only use the snap quadrant when increment snap was used (not geometry snap).
    if (t.snapIsActive() && !validSnap(t)) {
        const angle = t.valuesFinal[0]
        if (angle === 0) return fromDegrees(0)
        const snapIncrement = transformSnapIncrementGet(t)
        if (snapIncrement === 0) return null
        const incrementDeg = Math.round(snapIncrement * 180 / Math.PI)
        if (!numinputDoubleIsInt(incrementDeg) || incrementDeg === 0) return null
        const steps = Math.trunc(Math.round(angle / snapIncrement))
        return fromDegrees(steps * incrementDeg)
    }
    return null
}

/** `ElementRotation_ex` + `ElementRotation` (`transform_mode.cc:593`, `:846`). */
function elementRotation(t: TransInfo, tc: TransDataContainer, td: TransData, mat: Mat3, around: PivotType): void {
    // Local constraint shouldn't alter centre.
    const center = transdataCheckLocalCenter(t, around) ? td.center : tc.centerLocal
    if (t.flag & T_POINTS) {
        const totmat = mulM3M3(mat, td.mtx)
        const smat = mulM3M3(td.smtx, totmat)
        let vec = subV3(td.iloc, center)
        vec = mulM3V3(smat, vec)
        td.loc = addV3(vec, center)
        return
    }
    // Objects: translation about the pivot, then the rotation itself.
    let vec = subV3(td.center, center)
    vec = mulM3V3(mat, vec)
    vec = addV3(vec, center)
    vec = subV3(vec, td.center)
    vec = mulM3V3(td.smtx, vec)
    td.loc = addV3(td.iloc, vec)
    if (td.ext) {
        const ext = td.ext as unknown as ObjectTransData
        ext.rotWorld = mulM3M3(mat, ext.irot)
        ext.scale = copyV3(ext.iscale)
    }
}

/** `transdata_elem_rotate` (`transform_mode_rotate.cc:92`). */
function transdataElemRotate(t: TransInfo, tc: TransDataContainer, td: TransData, axis: Vec3, angle: number, quadrant: number | null): void {
    let axisFinal = axis
    let angleFinal = angle
    let quadrantFinal = quadrant
    if (t.con.mode & CON_APPLY) {
        const conAxis = conApplyRot(t, tc, td)
        if (conAxis) axisFinal = conAxis
        angleFinal = angle * td.factor
        if (td.factor !== 1) quadrantFinal = null
    } else if (t.flag & T_PROP_EDIT) {
        angleFinal = angle * td.factor
        if (td.factor !== 1) quadrantFinal = null
    }
    const mat = axisAngleNormalizedToM3WithQuadrant(axisFinal, angleFinal, quadrantFinal)
    elementRotation(t, tc, td, mat, t.around)
}

/** `applyRotationValue` (`transform_mode_rotate.cc:222`). */
function applyRotationValue(t: TransInfo, angle: number, axis: Vec3, isLargeRotation: boolean, quadrant: number | null): void {
    if (isLargeRotation) angle = largeRotationLimit(angle)
    for (const tc of t.containers) {
        for (const td of tc.data) {
            if (td.flag & TD_SKIP) continue
            transdataElemRotate(t, tc, td, axis, angle, quadrant)
        }
    }
}

/** `headerRotation` (`transform_mode.cc:566`). */
function headerRotation(t: TransInfo, final: number): string {
    let str: string
    if (hasNumInput(t.num)) {
        str = `Rotation: ${outputNumInput(t.num)[0]}${t.con.text} ${t.proptext}`
    } else {
        str = `Rotation: ${(final * 180 / Math.PI).toFixed(2)}${t.con.text} ${t.proptext}`
    }
    if (t.flag & T_PROP_EDIT_ALL) str += ` Proportional size: ${t.propSize.toFixed(2)}`
    return str
}

/** `applyRotation` (`transform_mode_rotate.cc:320`). */
function applyRotation(t: TransInfo): void {
    const axisFinal = transformModeRotationAxisGet(t)

    const num: number[] = [0]
    let final: number
    let isLargeRotationLimited = false
    if (applyNumInput(t.num, num)) {
        const finalUnlimited = num[0]
        final = largeRotationLimit(finalUnlimited)
        isLargeRotationLimited = final !== finalUnlimited
    } else {
        final = t.values[0] + t.valuesModalOffset[0]
        if (!(t.flag & T_INPUT_IS_VALUES_FINAL) && transformModeIsAxisPointingToScreen(t, axisFinal)) {
            // Flip rotation direction if axis is pointing to screen.
            final = -final
        }
        const v = [final]
        transformSnapMixedApply(t, v)
        if (!(t.snapIsActive() && validSnap(t))) transformSnapIncrement(t, v)
        final = v[0]
    }

    t.valuesFinal[0] = final
    const quadrant = transformAngleToQuadrantOrNull(t, isLargeRotationLimited)
    const isLargeRotation = hasNumInput(t.num)
    applyRotationValue(t, final, axisFinal, isLargeRotation, quadrant)
    t.header = headerRotation(t, t.valuesFinal[0])
}

/** `initSnapAngleIncrements` (`transform_snap.cc:1089`) with Blender's defaults: 5 degrees, 1 with precision. */
function initSnapAngleIncrements(t: TransInfo): void {
    const increment = 5 * Math.PI / 180
    const incrementPrecision = 1 * Math.PI / 180
    t.increment[0] = increment
    t.incrementPrecision = increment !== 0 ? incrementPrecision / increment : 1
}

/** `initRotation` (`transform_mode_rotate.cc:390`). */
function initRotation(t: TransInfo): void {
    initMouseInputMode(t.mouse, 'angle')
    t.idxMax = 0
    t.num.idxMax = 0
    initSnapAngleIncrements(t)
    const inc = t.increment[0] * t.incrementPrecision
    t.num.valInc = [inc, inc, inc]
    t.num.unitUseRadians = false
    t.num.unitType = ['rotation', 'none', 'none']
    t.defaultModalOrientationSet('view')
}

const TransModeRotate: TransformModeInfo = {
    flags: 0,
    init: initRotation,
    transform: applyRotation,
    snapDistance: rotationBetween,
    snapApply: applySnapRotation,
}

// endregion

// region resize (`transform_mode_resize.cc`)

/** `ResizeBetween` (`transform_mode_resize.cc:43`): the scale that takes `p1` to `p2` about the pivot. */
function resizeBetween(t: TransInfo, p1: Vec3, p2: Vec3): number {
    let d1 = subV3(p1, t.centerGlobal)
    let d2 = subV3(p2, t.centerGlobal)
    if (t.con.mode & CON_APPLY) {
        d1 = mulM3V3(t.con.pmtx, d1)
        d2 = mulM3V3(t.con.pmtx, d2)
    }
    d1 = projectV3V3V3(d1, d2)
    const lenD1 = lenV3(d1)
    // Use 'invalid' when the centre equals p1 (after projecting), see #46503.
    return lenD1 !== 0 ? lenV3(d2) / lenD1 : TRANSFORM_DIST_INVALID
}

/** `ApplySnapResize` (`transform_mode_resize.cc:65`). */
function applySnapResize(t: TransInfo, vec: number[]): void {
    const dist = resizeBetween(t, t.tsnap.snapSource, getSnapPoint(t))
    if (dist !== TRANSFORM_DIST_INVALID) {
        vec[0] = dist
        vec[1] = dist
        vec[2] = dist
    }
}

/** `headerResize` (`transform_mode.cc:872`). */
function headerResize(t: TransInfo, vec: number[]): string {
    const tvec = hasNumInput(t.num) ? outputNumInput(t.num) : vec.map(v => v.toFixed(4))
    while (tvec.length < 3) tvec.push('')
    let str: string
    if (t.con.mode & CON_APPLY) {
        switch (t.num.idxMax) {
        case 0:
            str = `Scale: ${tvec[0]}${t.con.text} ${t.proptext}`
            break
        case 1:
            str = `Scale: ${tvec[0]} : ${tvec[1]}${t.con.text} ${t.proptext}`
            break
        default:
            str = `Scale: ${tvec[0]} : ${tvec[1]} : ${tvec[2]}${t.con.text} ${t.proptext}`
            break
        }
    } else {
        str = `Scale X: ${tvec[0]}   Y: ${tvec[1]}  Z: ${tvec[2]}${t.con.text} ${t.proptext}`
    }
    if (t.flag & T_PROP_EDIT_ALL) str += ` Proportional size: ${t.propSize.toFixed(2)}`
    return str
}

/** `mat3_to_rot_size` (`math_matrix_c.cc`): sizes from the column lengths, with a flip for negative determinants. */
function mat3ToRotSize(mat3: Mat3): {rot: Mat3, size: Vec3} {
    const rot = copyM3(mat3)
    const size: Vec3 = [normalizeV3(rot[0]), normalizeV3(rot[1]), normalizeV3(rot[2])]
    // `is_negative_m3`: the determinant sign.
    if (dotV3(crossV3Local(rot[0], rot[1]), rot[2]) < 0) {
        for (let i = 0; i < 3; i++) {
            rot[i] = mulV3Fl(rot[i], -1)
            size[i] = -size[i]
        }
    }
    return {rot, size}
}

function crossV3Local(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** `TransMat3ToSize` (`transform_mode.cc:949`): the sign flip is crucial. */
function transMat3ToSize(mat: Mat3, smat: Mat3): Vec3 {
    const {rot, size} = mat3ToRotSize(mat)
    if (dotV3(rot[0], smat[0]) < 0) size[0] = -size[0]
    if (dotV3(rot[1], smat[1]) < 0) size[1] = -size[1]
    if (dotV3(rot[2], smat[2]) < 0) size[2] = -size[2]
    return size
}

/** `ElementResize` (`transform_mode.cc:967`). */
function elementResize(t: TransInfo, tc: TransDataContainer, td: TransData, mat: Mat3): void {
    let tmat: Mat3
    if (t.flag & T_EDIT) {
        const smat = mulM3M3(mat, td.mtx)
        tmat = mulM3M3(td.smtx, smat)
    } else {
        tmat = copyM3(mat)
    }
    tmat = conApplySize(t, tc, td, tmat)

    // Local constraint shouldn't alter centre.
    const center = transdataCheckLocalCenter(t, t.around) ? td.center : tc.centerLocal

    if (td.ext) {
        const ext = td.ext as unknown as ObjectTransData
        // Reorient the size matrix to fit the oriented object.
        const obScaleMat = mulM3M3(tmat, td.axismtx)
        const fscale = transMat3ToSize(obScaleMat, td.axismtx)
        ext.scale = [
            ext.iscale[0] * (1 + (fscale[0] - 1) * td.factor),
            ext.iscale[1] * (1 + (fscale[1] - 1) * td.factor),
            ext.iscale[2] * (1 + (fscale[2] - 1) * td.factor),
        ]
        ext.rotWorld = copyM3(ext.irot)
    }

    // For individual element centres, edit mode needs to use iloc.
    const from = t.flag & T_POINTS ? td.iloc : td.center
    let vec = subV3(from, center)
    vec = mulM3V3(tmat, vec)
    vec = addV3(vec, center)
    vec = subV3(vec, from)
    vec = mulV3Fl(vec, td.factor)
    if (t.options & CTX_OBJECT) vec = mulM3V3(td.smtx, vec)
    td.loc = addV3(td.iloc, vec)
}

/** `applyResize` (`transform_mode_resize.cc:169`). */
function applyResize(t: TransInfo): void {
    if (t.flag & T_INPUT_IS_VALUES_FINAL) {
        t.valuesFinal = copyV3(t.values)
    } else {
        const ratio = t.values[0]
        const vf: number[] = [ratio, ratio, ratio]
        vf[0] += t.valuesModalOffset[0]
        vf[1] += t.valuesModalOffset[1]
        vf[2] += t.valuesModalOffset[2]
        transformSnapIncrement(t, vf)
        if (applyNumInput(t.num, vf)) constraintNumInput(t, vf as Vec3)
        transformSnapMixedApply(t, vf)
        t.valuesFinal = [vf[0], vf[1], vf[2]]
    }

    let mat = sizeToM3(t.valuesFinal)
    if (t.con.mode & CON_APPLY) {
        mat = conApplySize(t, null, null, mat)
        // Only so we have a re-usable value with redo.
        const pvec: number[] = []
        for (let i = 0; i < 3; i++) {
            if (!(t.con.mode & CON_AXIS0 << i)) t.valuesFinal[i] = 1
            else pvec.push(t.valuesFinal[i])
        }
        t.header = headerResize(t, pvec)
    } else {
        t.header = headerResize(t, t.valuesFinal)
    }

    t.mat = copyM3(mat) // Used in the gizmo.

    for (const tc of t.containers) {
        for (const td of tc.data) {
            if (td.flag & TD_SKIP) continue
            elementResize(t, tc, td, mat)
        }
    }
}

/** `initResize` (`transform_mode_resize.cc:261`). */
function initResize(t: TransInfo): void {
    initMouseInputMode(t.mouse, 'springFlip')
    t.num.valFlag[0] |= NUM_NULL_ONE
    t.num.valFlag[1] |= NUM_NULL_ONE
    t.num.valFlag[2] |= NUM_NULL_ONE
    t.num.flag |= NUM_AFFECT_ALL
    t.idxMax = 2
    t.num.idxMax = 2
    t.increment = [0.1, 0.1, 0.1]
    t.incrementPrecision = 0.1
    t.num.valInc = [0.1, 0.1, 0.1]
    t.num.unitType = ['none', 'none', 'none']
    t.defaultModalOrientationSet('global')
}

const TransModeResize: TransformModeInfo = {
    flags: T_NULL_ONE,
    init: initResize,
    transform: applyResize,
    snapDistance: resizeBetween,
    snapApply: applySnapResize,
}

// endregion

/** `mode_info_get` (`transform_mode.cc:1131`). */
export function modeInfoGet(mode: TransformMode): TransformModeInfo {
    switch (mode) {
    case 'translate': return TransModeTranslate
    case 'rotate': return TransModeRotate
    case 'resize': return TransModeResize
    }
}

/** The constrained axes as world directions, for drawing. */
export function transformConstraintLines(t: TransInfo): Vec3[] {
    const out: Vec3[] = []
    if (!(t.con.mode & CON_APPLY)) return out
    if (t.con.mode & CON_AXIS0) out.push(copyV3(t.spacemtx[0]))
    if (t.con.mode & CON_AXIS1) out.push(copyV3(t.spacemtx[1]))
    if (t.con.mode & CON_AXIS2) out.push(copyV3(t.spacemtx[2]))
    return out
}
