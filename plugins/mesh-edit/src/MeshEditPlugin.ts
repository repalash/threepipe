/**
 * `MeshEditPlugin` - Blender-style edit mode for threepipe.
 *
 * Enter on a selected mesh and its topology is taken over by the kernel: vertices, edges and faces
 * become selectable elements drawn as overlays, and operators work on real n-gon topology rather than
 * on the triangle buffers. Leaving edit mode bakes the result back into the object's geometry.
 *
 * Named `MeshEditPlugin` rather than `EditModePlugin` because the latter is taken by the Threepipe
 * Editor, where it means the editor's viewport mode (cameras, grid, fly navigation).
 *
 * While edit mode is active the object-mode interaction plugins are disabled by key, so their
 * shortcuts and gizmos do not fight with the edit-mode ones. They are restored on exit.
 */

import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    BufferAttribute,
    BufferGeometry2,
    InstancedInterleavedBuffer,
    InterleavedBufferAttribute,
    IObject3D,
    LineSegments2,
    LineSegmentsGeometry,
    Mesh2,
    Object3D2,
    Points,
    ShaderMaterial,
    ThreeViewer,
    UnlitMaterial,
    Vector2,
    Vector3,
    Vector4,
} from 'threepipe'
import {
    BMEdge,
    BMesh,
    BMFace,
    BMVert,
    ElemFlag,
    edgeSelectSet,
    faceSelectSet,
    geometryDataToBufferGeometry,
    MeshData,
    selectAll,
    selectHistoryStore,
    selectInvert,
    SelectMode,
    SelectModeMask,
    selectModeFlush,
    selectModeSet,
    selectNone,
    vertSelectSet,
    extrudeSelection,
    averageFaceNormal,
    duplicateSelection,
    splitSelection,
    deleteSelection,
    mergeSelectedVerts,
    DeleteContext,
    bmToMesh,
    editMeshLoopCut,
    SubdFalloff,
} from '@threepipe/mesh-kernel'
import {Matrix4, Quaternion} from 'threepipe'
import {EditMeshState} from './EditMeshState'
import {ModalTransform, TransformMode, TransformSavedProps} from './transform'
import {
    buildEdgeOverlay,
    buildFaceDotOverlay,
    buildFaceOverlay,
    buildVertexOverlay,
    EdgeOverlayData,
    FaceDotOverlayData,
    refreshEdgeFlags,
    refreshEdgePositions,
    refreshFaceDotFlags,
    refreshFaceDotPositions,
    refreshVertexFlags,
    refreshVertexPositions,
    VertexOverlayData,
} from './overlays'
import {PickCycleState, pickElement, ProjectFn} from './picking'
import {
    createEdgeMaterial,
    createFaceDotMaterial,
    createVertexMaterial,
    edgeLineWidthPx,
    EditTheme,
    setOverlayPixelRatio,
} from './overlayMaterials'
import {SelectBuffer} from './select/SelectBuffer'
import {SELECT_DIST_PX, SelectDomain, unifiedFindNearest} from './select/findNearest'
import {SelectOp, selectOpAction, selectOpFromModifiers, selectOpUsePreDeselect} from './select/selectOp'
import {CanvasRect, meshTouchesRect} from './select/objectRegion'
import {LassoPoint, lassoBoundBox, ScreenRect} from './select/lasso'
import {regionSelect, RegionShape, RegionVisibility} from './select/regionSelect'
import {RegionOverlay} from './select/regionOverlay'
import {selectModeToggleMulti} from './select/selectMode'
import {LoopDelimit, loopSelectEdge, LoopSelectParams} from './select/loopSelect'
import {activeElemOrFace, PathSelectParams, shortestPathPick} from './select/path'
import {selectLess, selectMore} from './select/moreLess'
import {meshHide, meshReveal} from './select/hide'
import {LinkedDelimit, linkedDelimitDefault, selectLinkedAll, selectLinkedPick} from './select/linked'
import {TransformView} from './transform/view'
import {ObjectTransformTarget, ProportionalSettings, SnapSettings, TransInfo} from './transform/TransInfo'
import type {SlideProps} from './transform/slide'
import {CON_AXIS2, OrientationType, PivotType, T_RELEASE_CONFIRM} from './transform/types'
import type {Mat3, Mat4, Vec3} from './transform/math'
import {calcOrientationFromType} from './transform/orientation'
import {objectsPivotWorld, selectionPivotWorld} from './transform/pivot'
import {SnapContext} from './snap/snap'
import {snapTargetFromBMesh, snapTargetFromGeometry} from './snap/targets'
import {GizmoHandle, TransformGizmo} from './gizmo/TransformGizmo'
import {TransformOverlay} from './gizmo/TransformOverlay'
import type {ModalKeyEvent} from './transform/keymap'
import {LoopCutModal} from './loopcut'
import {LoopCutPreview} from './gizmo/LoopCutPreview'

/** Options for {@link MeshEditPlugin.startTransform}. */
export interface StartTransformOptions {
    /** The mesh before a topology change this transform is chained to (extrude, duplicate), for one undo step. */
    undoBefore?: MeshData
    /** `CON_AXIS*` bits to start constrained with, as a gizmo handle does. */
    constraint?: number
    /** An orientation set by the operator (`normal` for extrude, `custom` for a gizmo); overrides the default. */
    orientation?: OrientationType
    /** The basis for `custom`. */
    customMatrix?: Mat3
    /** Confirm when the button is released rather than on the next click (gizmo drags). */
    releaseConfirm?: boolean
    /** Where the drag starts, in canvas CSS pixels; defaults to the last pointer position. */
    mouse?: {x: number, y: number}
    /** The topology operator this transform completes, for the undo label and the redo panel. */
    chained?: 'extrude' | 'duplicate' | 'loopcut'
    /** Edge and vertex slide: the slide operator's properties (even, flipped, clamp). */
    slide?: SlideProps
}

/** The transform settings a header exposes: pivot, orientation, snapping, proportional editing. */
export interface TransformSettings {
    pivot: PivotType
    orientation: OrientationType
    snapping: SnapSettings
    proportional: ProportionalSettings
    /** The 3D cursor, world space. */
    cursor: Vec3
}

export interface MeshEditPluginEventMap extends AViewerPluginEventMap {
    /** Edit mode entered or left. */
    editModeChanged: {object: IObject3D | null}
    /** The element selection changed. Distinct from the viewer's object-level `selectedObjectChanged`. */
    elementSelectionChanged: {state: EditMeshState}
    /** The mesh topology or positions changed. */
    meshChanged: {state: EditMeshState}
    /** A modal transform started, updated or finished. Null when it ended. */
    transformChanged: {transform: ModalTransform | null}
    /**
     * A modal transform was confirmed, with what it did - Blender's `saveTransform`, which writes the
     * final value, constraint and orientation into the operator so the redo panel can re-run it.
     * `chained` names the topology change the move followed (`extrude`, `duplicate`), if any.
     * Dispatched before `transformChanged: null`, while `transform` still holds its final state.
     */
    transformCommitted: {transform: ModalTransform, chained: 'extrude' | 'duplicate' | 'loopcut' | null, saved: TransformSavedProps}
    /** The loop cut modal started, previewed another ring or cut count, or ended (null). */
    loopCutChanged: {loopCut: LoopCutModal | null}
    /**
     * A Loop Cut and Slide finished: the cut's properties and, when the slide that followed was
     * confirmed, the slide's (`null` when it was cancelled or could not start; the cut stays).
     */
    loopCutDone: {cut: LoopCutCutProps, slide: TransformSavedProps | null}
    /** The element under the cursor changed: what a click would select. Null when nothing is. */
    preselectChanged: {element: BMVert | BMEdge | BMFace | null}
    /** Something the user tried could not be done. Show it; it used to go to the console only. */
    notice: {message: string, level: 'info' | 'warning'}
    /** Pivot, orientation, snapping or proportional settings changed. */
    transformSettingsChanged: {settings: TransformSettings}
    /** The gizmo handle under the cursor changed. */
    gizmoHoverChanged: {handle: GizmoHandle | null}
    /** A box, lasso or circle select gesture started, moved or ended (`region` is null then). */
    regionChanged: {region: RegionShape | null}
    /** X-ray was toggled. */
    xrayChanged: {xray: boolean}
}

/** How a left-drag on the canvas behaves in edit mode. */
export type DragSelectTool = 'box' | 'lasso' | 'none'

/** When face dots are drawn in face mode. */
export type FaceDotMode = 'always' | 'xray' | 'never'

/** three.js `MOUSE` actions per button (`MOUSE.ROTATE` 0, `MOUSE.DOLLY` 1, `MOUSE.PAN` 2), or null for none. */
export interface OrbitButtons {
    LEFT?: number | null
    MIDDLE?: number | null
    RIGHT?: number | null
}

/**
 * Plugins disabled while edit mode is active, so their keys, clicks and gizmos do not collide.
 *
 * `Picking` is among them: left active, its keys acted on the object underneath edit mode - `Delete`
 * removed the whole object, `Esc` deselected it, `H` hid it - and its own click handler deselected the
 * object on every element click. Disabling it clears the object selection, so leaving edit mode selects
 * the edited object again, as Blender leaves it.
 */
const SUSPENDED_PLUGINS = ['Picking', 'TransformControlsPlugin', 'PivotControlsPlugin', 'PivotEditPlugin', 'Object3DWidgetsPlugin']

const DISABLE_KEY = 'meshEdit'

/** Undo-step labels, as Blender names the operators in its Undo History. */
const TRANSFORM_LABELS: Record<TransformMode, string> = {translate: 'Move', rotate: 'Rotate', resize: 'Scale', edgeSlide: 'Edge Slide', vertSlide: 'Vertex Slide'}
/** What to select when a transform has nothing to work on. */
const TRANSFORM_EMPTY: Record<TransformMode, string> = {
    translate: 'Select something to move first.',
    rotate: 'Select something to rotate first.',
    resize: 'Select something to scale first.',
    // `transform_mesh_edge_slide_data_create` returns nothing for anything but edge loops.
    edgeSlide: 'Select one or more edge loops to slide: each selected vertex needs one or two selected edges, each edge at most two faces.',
    vertSlide: 'Select vertices to slide first.',
}
const CHAIN_LABELS = {extrude: 'Extrude', duplicate: 'Duplicate', loopcut: 'Loop Cut and Slide'} as const

/**
 * What a loop cut ran with, for its redo: `MESH_OT_loopcut`'s `number_cuts`, `smoothness` and `falloff`,
 * and the hidden `edge_index` (`editmesh_loopcut.cc:767`), the edge's index in mesh order.
 */
export interface LoopCutCutProps {
    cuts: number
    smoothness: number
    falloff: SubdFalloff
    edgeIndex: number
}
const DELETE_LABELS: Partial<Record<DeleteContext, string>> = {
    verts: 'Delete Vertices', edges: 'Delete Edges', faces: 'Delete Faces',
    onlyFaces: 'Delete Only Faces', edgesFaces: 'Delete Edges & Faces',
}

export class MeshEditPlugin extends AViewerPluginSync<MeshEditPluginEventMap> {
    public static readonly PluginType = 'MeshEditPlugin'

    enabled = true
    dependencies = []

    /** Not serialised: edit mode is a transient interaction state, not scene configuration. */
    toJSON: any = undefined

    /** The object currently in edit mode, or null. */
    editObject: IObject3D | null = null

    /** The live editing session. Null outside edit mode. */
    state: EditMeshState | null = null

    /**
     * Sources of exact topology, consulted before falling back to welding triangles.
     *
     * Entering edit mode normally has to *recover* topology from a triangle buffer: weld by
     * position, guess at n-gons. That is lossy, and it is unnecessary when something else in the
     * scene already holds the real mesh - `ModellingPlugin` keeps a `MeshData` per object, n-gons
     * and vertex indices intact. A provider hands that over, so a lathed wheel opens in edit mode as
     * the quads it was built from rather than as a welded triangle soup with renumbered vertices.
     *
     * Register with `viewer.forPlugin('MeshEditPlugin', ...)` rather than importing this plugin, so
     * the dependency runs one way only.
     */
    readonly meshProviders: ((object: IObject3D) => MeshData | null | undefined)[] = []

    /**
     * Where a committed edit goes back to, besides the object's geometry.
     *
     * Without this, an object whose topology is owned elsewhere would have its hand edits silently
     * discarded the next time that owner re-baked it.
     */
    readonly meshSinks: ((object: IObject3D, mesh: MeshData) => void)[] = []

    /**
     * Pixel radius for X-ray element picking. Without X-ray, picking uses the selection buffer and
     * Blender's 75 px rule (`SELECT_DIST_PX`).
     */
    pickDistance = 24

    /**
     * Show and pick elements through the surface. Off is Blender's default: only what you can see is
     * drawn and clickable.
     */
    get xray(): boolean {
        return this._xray
    }

    set xray(value: boolean) {
        if (value === this._xray) return
        this._xray = value
        for (const obj of [this._vertPoints, this._edgeLines, this._faceDots, this._faceHighlight, this._facePreselect]) {
            const material = obj?.material as any
            if (!material) continue
            material.depthTest = !value
            material.needsUpdate = true
        }
        if (this._select) this._select.xray = value
        this._preselect = null
        this._refreshFlags()
        this.dispatchEvent({type: 'xrayChanged', xray: value})
    }

    private _xray = false

    /**
     * What a left-button drag over the canvas does in edit mode: box select (Blender's default
     * "Select Box" tool), lasso select, or nothing (the drag is left to the camera controls).
     *
     * While this is not `none`, the camera's orbit moves off the left button for the session: the
     * middle button orbits, as in Blender, and `Alt`+left drag orbits too (Blender's "emulate 3
     * button mouse"). Everything is restored on exit. An editor with its own navigation preset sets
     * this to `none` and drives {@link boxSelect} / {@link lassoSelect} itself.
     */
    get dragSelect(): DragSelectTool {
        return this._dragSelect
    }

    set dragSelect(value: DragSelectTool) {
        if (value === this._dragSelect) return
        this._dragSelect = value
        if (this.isEditing) {
            this._restoreOrbit()
            this._captureOrbit()
        }
    }

    private _dragSelect: DragSelectTool = 'box'

    /**
     * In object mode too, a left drag box-selects objects ({@link boxSelectObjects}), as Blender's Select
     * Box tool does. Off by default: without an app that frees the left button from orbiting (the editor
     * engine's keymap presets do), a left drag would orbit and select at once.
     */
    objectDragSelect = false

    /**
     * Override the camera mouse buttons used during edit mode. Null (the default) is Blender's
     * mapping while {@link dragSelect} is on: left selects, middle orbits, `Alt`+left orbits. An
     * editor with its own navigation preset passes the three.js `MOUSE` actions it wants (`null`
     * for a button that does nothing); the original buttons come back on exit or disable.
     */
    setOrbitButtons(buttons: OrbitButtons | null): void {
        this._orbitButtons = buttons ? {...buttons} : null
        this._applyOrbitButtons()
    }

    get orbitButtons(): OrbitButtons | null {
        return this._orbitButtons
    }

    private _orbitButtons: OrbitButtons | null = null

    /**
     * Face dots in face mode. Blender draws them only with X-ray on (or the "Center" overlay), where
     * they are the click target; `always` also draws them in solid shading, so it is visible that
     * faces are now the unit a click selects. That is the default here: discoverability for a
     * newcomer outweighs the small amount of clutter, and the dots are also the X-ray click target.
     */
    get faceDots(): FaceDotMode {
        return this._faceDotMode
    }

    set faceDots(value: FaceDotMode) {
        if (value === this._faceDotMode) return
        this._faceDotMode = value
        this._refreshFlags()
    }

    private _faceDotMode: FaceDotMode = 'always'

    /** Circle select radius in CSS pixels. Blender's default `radius` is 25. Changed with the wheel. */
    circleRadius = 25

    /**
     * Delimiters for Alt+click loop select: Blender's `mesh.loop_select` defaults, which stop a
     * boundary loop at outer corners (so one click on a grid's edge takes one side, the next the
     * whole boundary) and keep loops to quads.
     */
    loopDelimit: LoopDelimit = {delimitOuterCorners: true, delimitNgons: true}

    /** Delimiters for Ctrl+Alt+click ring select: Blender's `mesh.edgering_select` default. */
    ringDelimit: LoopDelimit = {delimitNgons: true}

    /**
     * Delimiters for select-linked (`L`, `Ctrl+L`). Null means Blender's mode-dependent default:
     * none in vertex and edge mode, seams in face mode.
     */
    linkedDelimit: LinkedDelimit | null = null

    /** Options for Ctrl+click shortest path. */
    pathOptions: Pick<PathSelectParams, 'useTopologyDistance' | 'useStepFace' | 'edgeMode'> = {}

    /**
     * Pixels the pointer may move between press and release and still count as a click. Blender's
     * `drag_threshold_mouse` default. Anything further is a drag - an orbit - and leaves the selection
     * alone.
     */
    dragThreshold = 3

    /** Highlight the element under the cursor. Not a Blender default; it is what makes picking legible. */
    preselectHighlight = true

    /**
     * Handle the keyboard here. On by default so the plugin works on its own; an interaction engine
     * that owns the viewport keymap (`@threepipe/plugin-editor-engine`) turns it off and forwards the
     * modal keys through {@link handleModalKey}.
     */
    keyHandling = true

    private _root: Object3D2 | null = null
    private _vertPoints: Points | null = null
    private _edgeLines: LineSegments2 | null = null
    private _faceDots: Points | null = null
    private _faceHighlight: Mesh2 | null = null
    private _facePreselect: Mesh2 | null = null
    /** The overlay buffers, kept so a selection change rewrites flags without rebuilding geometry. */
    private _vertData: VertexOverlayData | null = null
    private _edgeData: EdgeOverlayData | null = null
    private _faceDotData: FaceDotOverlayData | null = null
    private _regionOverlay: RegionOverlay | null = null
    /** The running box or lasso gesture. */
    private _region: {kind: 'box' | 'lasso', op: SelectOp, x0: number, y0: number, x1: number, y1: number, points: LassoPoint[]} | null = null
    /** The running circle-select modal (`C`). */
    private _circle: {painting: boolean, op: SelectOp, first: boolean} | null = null
    private _orbitSaved: {controls: any, mouseButtons: any} | null = null
    private _cycle = new PickCycleState()
    private _transform: ModalTransform | null = null
    private _select: SelectBuffer | null = null
    private _selectDirty = true
    private _preselect: BMVert | BMEdge | BMFace | null = null
    private _press: {x: number, y: number, shift: boolean, ctrl: boolean, alt: boolean} | null = null
    private _hoverFrame = 0
    private _liveFrame = 0
    /** The mesh as it was before the running operation, for its undo step. */
    private _undoBefore: MeshData | null = null
    /** The running transform follows a topology change (extrude, duplicate) that must stay undoable. */
    private _chained: 'extrude' | 'duplicate' | 'loopcut' | null = null
    private _loopCut: LoopCutModal | null = null
    /** The cut whose slide is running, reported by `loopCutDone` when the slide ends. */
    private _loopCutPending: LoopCutCutProps | null = null
    private _loopCutReleaseConfirm = false

    // region transform settings

    /** Where rotation and scaling happen about. Blender's header pivot selector. */
    pivot: PivotType = 'median'
    /** The space axis keys and the gizmo use. */
    orientation: OrientationType = 'global'
    /** Snapping, as the header magnet and its popover. Ctrl inverts it during a transform. */
    readonly snapping: SnapSettings = {
        enabled: false, targets: ['increment'], source: 'closest', absoluteGrid: false,
        affect: {translate: true, rotate: false, resize: false}, backfaceCulling: false, occlusion: true,
    }
    /** Proportional editing. The size changes with the wheel or PageUp/PageDown during a transform. */
    readonly proportional: ProportionalSettings = {enabled: false, connected: false, projected: false, size: 1, falloff: 'smooth'}
    /** The 3D cursor, world space: a pivot and the place new geometry appears. */
    readonly cursor: Vec3 = [0, 0, 0]

    /** The combined gizmo: arrows, plane squares, rings, scale boxes, centre circle. */
    readonly gizmo = new TransformGizmo()
    /** Constraint lines, helpline, proportional circle and snap glyph while a transform runs. */
    readonly overlay = new TransformOverlay()
    /** The ring a loop cut would make, while hovering. */
    readonly loopCutPreview = new LoopCutPreview()
    /**
     * Show the gizmo on the edit-mode selection. Off by default, as in Blender, where the gizmo
     * belongs to the Move/Rotate/Scale/Transform tools: a handle takes the click, so with a gizmo
     * up a vertex under it cannot be clicked. The tool (or an app) turns it on with {@link showGizmo}.
     */
    gizmoVisible = false
    /**
     * Show the gizmo on the picked objects in object mode and let it move them. Off by default:
     * threepipe's `TransformControlsPlugin` does that unless an app switches to this one.
     */
    objectGizmo = false
    /** Other scene meshes are snap targets too, not only the edited one. */
    snapToSceneObjects = true

    private _gizmoDrag: GizmoHandle | null = null
    private _objectTransform: TransInfo | null = null
    private _objectTargets: {object: IObject3D, start: {position: Vector3, quaternion: Quaternion, scale: Vector3}}[] = []

    // endregion

    get isEditing(): boolean {
        return this.state !== null
    }

    /** The running modal transform, if any. While this is set, input belongs to it. */
    get activeTransform(): ModalTransform | null {
        return this._transform
    }

    /** The running object-mode transform, if any. */
    get activeObjectTransform(): TransInfo | null {
        return this._objectTransform
    }

    get transformSettings(): TransformSettings {
        return {pivot: this.pivot, orientation: this.orientation, snapping: this.snapping, proportional: this.proportional, cursor: this.cursor}
    }

    get selectMode(): SelectModeMask {
        return this.state?.selectMode ?? SelectMode.Vertex
    }

    constructor() {
        super()
        // Disabling the plugin mid-session hands the camera buttons back; enabling takes them again.
        const baseDisable = this.disable
        const baseEnable = this.enable
        this.disable = (key: any, setDirty = true) => {
            baseDisable(key, setDirty)
            if (this.isDisabled()) {
                this._endRegion(false)
                this.endCircleSelect()
                this._restoreOrbit()
            }
        }
        this.enable = (key: any, setDirty = true) => {
            baseEnable(key, setDirty)
            if (!this.isDisabled() && this.isEditing) this._captureOrbit()
        }
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        window.addEventListener('keydown', this._onKeyDown)
        window.addEventListener('keyup', this._onKeyUp)
        viewer.canvas.addEventListener('pointerdown', this._onPointerDown)
        viewer.canvas.addEventListener('pointermove', this._onPointerMove)
        viewer.canvas.addEventListener('pointerleave', this._onPointerLeave)
        viewer.canvas.addEventListener('dblclick', this._onDoubleClick)
        viewer.canvas.addEventListener('wheel', this._onWheel, {passive: false})
        viewer.canvas.addEventListener('contextmenu', this._onContextMenu)
        // Release can happen outside the canvas; listen where it will arrive. So can a drag.
        window.addEventListener('pointerup', this._onPointerUp)
        window.addEventListener('pointermove', this._onWindowPointerMove)
        // The rotation rings are clipped to their front half with a clipping plane.
        ;(viewer.renderManager.renderer as any).localClippingEnabled = true
        viewer.scene.addObject(this.gizmo as never, {addToRoot: true})
        viewer.scene.addObject(this.overlay as never, {addToRoot: true})
        viewer.scene.addObject(this.loopCutPreview as never, {addToRoot: true})
        viewer.forPlugin<any>('Picking', (picking: any) => {
            picking.addEventListener('selectedObjectChanged', this._onObjectSelectionChanged)
        }, (picking: any) => {
            picking.removeEventListener('selectedObjectChanged', this._onObjectSelectionChanged)
        }, this)
    }

    onRemove(viewer: ThreeViewer): void {
        window.removeEventListener('keydown', this._onKeyDown)
        window.removeEventListener('keyup', this._onKeyUp)
        viewer.canvas.removeEventListener('pointerdown', this._onPointerDown)
        viewer.canvas.removeEventListener('pointermove', this._onPointerMove)
        viewer.canvas.removeEventListener('pointerleave', this._onPointerLeave)
        viewer.canvas.removeEventListener('dblclick', this._onDoubleClick)
        viewer.canvas.removeEventListener('wheel', this._onWheel)
        viewer.canvas.removeEventListener('contextmenu', this._onContextMenu)
        window.removeEventListener('pointerup', this._onPointerUp)
        window.removeEventListener('pointermove', this._onWindowPointerMove)
        if (this.isEditing) this.exit(false)
        if (this._objectTransform) this.cancelObjectTransform()
        viewer.scene.remove(this.gizmo as never)
        viewer.scene.remove(this.overlay as never)
        viewer.scene.remove(this.loopCutPreview as never)
        this.gizmo.dispose()
        this.overlay.dispose()
        this.loopCutPreview.dispose()
        super.onRemove(viewer)
    }

    protected _viewerListeners = {
        preRender: () => this._updateWidgets(),
    }

    /** Tell the user why something did not happen, on screen if the app listens for `notice`. */
    private _notice(message: string, level: 'info' | 'warning' = 'warning'): void {
        this._viewer?.console.warn('MeshEditPlugin: ' + message)
        this.dispatchEvent({type: 'notice', message, level})
    }

    // region enter and exit

    /**
     * Enter edit mode on an object. Its triangles are welded back into shared-vertex topology, which
     * is lossy for deliberately split vertices; `state.weldedCount` reports how many collapsed.
     */
    enter(object?: IObject3D): boolean {
        const viewer = this._viewer
        if (!viewer) return false
        if (this.isEditing) this.exit(true)

        const target = object ?? this._selectedMesh()
        if (!target?.geometry) {
            this._notice('Select a mesh first, then press Tab (or double-click it) to edit it.', 'info')
            return false
        }

        const geometry = target.geometry as unknown as BufferGeometry2
        const position = geometry.getAttribute('position')
        if (!position) {
            this._notice('This object has no editable geometry.')
            return false
        }
        const provided = this._providedMesh(target)
        if (provided) {
            this.state = EditMeshState.fromMeshData(provided.clone())
        } else {
            const uv = geometry.getAttribute('uv')
            const index = geometry.getIndex()
            this.state = new EditMeshState({
                position: position.array as ArrayLike<number>,
                index: index ? (index.array as ArrayLike<number>) : null,
                uv: uv ? (uv.array as ArrayLike<number>) : null,
                groups: geometry.groups,
            })
        }
        this.editObject = target
        this._select = new SelectBuffer()
        this._select.xray = this._xray
        this._selectDirty = true
        this._preselect = null

        this._suspendObjectModePlugins(true)
        this._captureOrbit()
        this._offsetSurface(target, true)
        this._buildOverlays()
        // Hidden faces are not drawn in edit mode; a mesh that comes in with some needs a bake now.
        let anyHidden = false
        for (const f of this.state.bm.faces) if (f.hflag & ElemFlag.Hidden) { anyHidden = true; break }
        if (anyHidden) this._bakeIntoObject(target, this.state, true)
        this.dispatchEvent({type: 'editModeChanged', object: target})
        viewer.setDirty()
        return true
    }

    /** Leave edit mode, baking the edited topology back into the object's geometry when committing. */
    exit(commit = true): void {
        if (!this.state || !this.editObject) return
        const viewer = this._viewer
        const object = this.editObject

        if (this._transform) {
            if (commit) this.confirmTransform()
            else this.cancelTransform()
        }
        this._endRegion(false)
        this.endCircleSelect()
        // Outside edit mode every face is drawn, hidden or not, as Blender's object mode does.
        if (commit) this.applyToObject(false)
        else this._bakeIntoObject(object, this.state, false)
        this._destroyOverlays()
        this._select?.dispose()
        this._select = null
        this._preselect = null
        this._press = null
        cancelAnimationFrame(this._hoverFrame)
        cancelAnimationFrame(this._liveFrame)
        this._restoreOrbit()
        this._offsetSurface(object, false)
        this._suspendObjectModePlugins(false)

        this.state = null
        this.editObject = null
        this._cycle.reset()

        // Suspending the picker cleared the object selection; leave the edited object selected. Not
        // an undo step: leaving edit mode is not a selection the user made.
        viewer?.getPlugin<any>('Picking')?.setSelectedObject?.(object, false, false)

        this.dispatchEvent({type: 'editModeChanged', object: null})
        viewer?.setDirty()
    }

    /** Toggle, which is what Tab does. */
    toggle(): void {
        if (this.isEditing) this.exit(true)
        else this.enter()
    }

    /**
     * Bake the current topology into the edited object's geometry without leaving edit mode.
     * Hidden faces are left out of the drawn surface (`skipHidden`), as Blender's edit mode draws it;
     * `exit` bakes them back in.
     */
    applyToObject(skipHidden = true): void {
        if (!this.state || !this.editObject) return
        this.state.syncFromBMesh()
        this._bakeIntoObject(this.editObject, this.state, skipHidden)

        // Hand the result back to whatever owns this object's topology, before anyone re-bakes it.
        for (const sink of this.meshSinks) {
            try {
                sink(this.editObject, this.state.mesh)
            } catch (e) {
                this._viewer?.console.error('MeshEditPlugin: a mesh sink threw', e)
            }
        }
        this.dispatchEvent({type: 'meshChanged', state: this.state})
    }

    /** Replace an object's geometry with a bake of the session's mesh. */
    private _bakeIntoObject(object: IObject3D, state: EditMeshState, skipHidden = false): void {
        const {data} = state.bake(skipHidden)
        const geometry = geometryDataToBufferGeometry<BufferGeometry2>(data, {
            BufferGeometry: BufferGeometry2,
            BufferAttribute,
        })
        const old = object.geometry
        object.geometry = geometry as never
        if (old && old !== geometry) old.dispose?.()
    }

    /** The first provider that recognises this object, if any. */
    private _providedMesh(object: IObject3D): MeshData | undefined {
        for (const provider of this.meshProviders) {
            try {
                const mesh = provider(object)
                if (mesh) return mesh
            } catch (e) {
                this._viewer?.console.error('MeshEditPlugin: a mesh provider threw', e)
            }
        }
        return undefined
    }

    /**
     * Push the edited surface back by its own depth slope while edit mode draws over it.
     *
     * A fat edge is a screen-space quad with the edge's depth across its whole width, but the
     * surface it lies on tilts across those pixels, so without this the surface wins on one side of
     * every edge and the line comes out one pixel wide and dashed - worse the more grazing the view.
     * Slope-scaled polygon offset (`glPolygonOffset(1, 1)`) is the standard answer for "wireframe
     * over solid": each surface fragment moves back by its own slope over one pixel, which is
     * exactly the depth difference the quad's flat depth is missing. The materials' settings are
     * put back on exit.
     */
    private _offsetSurface(object: IObject3D, on: boolean): void {
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
        for (const m of materials as any[]) {
            if (on) {
                if (m.userData.__meshEditOffset) continue
                m.userData.__meshEditOffset = {
                    polygonOffset: m.polygonOffset, factor: m.polygonOffsetFactor, units: m.polygonOffsetUnits,
                }
                m.polygonOffset = true
                m.polygonOffsetFactor = 1
                m.polygonOffsetUnits = 1
            } else {
                const saved = m.userData.__meshEditOffset
                if (!saved) continue
                delete m.userData.__meshEditOffset
                m.polygonOffset = saved.polygonOffset
                m.polygonOffsetFactor = saved.factor
                m.polygonOffsetUnits = saved.units
            }
            m.needsUpdate = true
        }
    }

    private _selectedMesh(): IObject3D | undefined {
        const picking = this._viewer?.getPlugin<any>('Picking')
        const selected = picking?.getSelectedObject?.() as IObject3D | undefined
        return selected?.geometry ? selected : undefined
    }

    private _suspendObjectModePlugins(suspend: boolean): void {
        const viewer = this._viewer
        if (!viewer) return
        for (const type of SUSPENDED_PLUGINS) {
            const plugin = viewer.getPlugin<any>(type)
            if (!plugin) continue
            // Keyed disable, so the editor's own bookkeeping is not clobbered.
            if (suspend) plugin.disable?.(DISABLE_KEY)
            else plugin.enable?.(DISABLE_KEY)
        }
    }

    // endregion

    // region overlays

    private _pixelRatio(): number {
        return (this._viewer?.renderManager.renderer as any)?.getPixelRatio?.() ?? window.devicePixelRatio ?? 1
    }

    private _buildOverlays(): void {
        const viewer = this._viewer
        if (!viewer || !this.state || !this.editObject) return

        const root = new Object3D2()
        root.name = 'MeshEdit Overlays'
        root.userData.isWidgetRoot = true
        root.userData.excludeFromExport = true
        root.userData.userSelectable = false
        root.assetType = 'widget' as never
        this._root = root

        const vertMaterial = createVertexMaterial(this._pixelRatio())
        vertMaterial.depthTest = !this.xray
        this._vertPoints = new Points(new BufferGeometry2(), vertMaterial)
        this._vertPoints.renderOrder = 100
        this._vertPoints.frustumCulled = false

        // Fat lines: an instanced screen-space quad per edge, as Blender's edge overlay draws them.
        const edgeMaterial = createEdgeMaterial()
        edgeMaterial.depthTest = !this.xray
        this._edgeLines = new LineSegments2(new LineSegmentsGeometry(), edgeMaterial as never)
        this._edgeLines.renderOrder = 99
        this._edgeLines.frustumCulled = false
        // The quad is expanded in NDC, where the full height is whatever is being rendered into: the
        // render target's size, in device pixels, and the width in device pixels to match.
        // (`LineSegments2.onBeforeRender` uses the renderer's viewport, which is the canvas in CSS
        // pixels and not the target threepipe renders the scene into; the lines came out 1.5 px.)
        const size = new Vector2()
        this._edgeLines.onBeforeRender = (renderer: any) => {
            const target = renderer.getRenderTarget()
            if (target) size.set(target.width, target.height)
            else renderer.getDrawingBufferSize(size)
            edgeMaterial.uniforms.resolution.value.copy(size)
            edgeMaterial.uniforms.linewidth.value = edgeLineWidthPx() * this._pixelRatio()
        }

        // Face dots: the click target of a face, drawn in face mode.
        const dotMaterial = createFaceDotMaterial(this._pixelRatio())
        dotMaterial.depthTest = !this.xray
        this._faceDots = new Points(new BufferGeometry2(), dotMaterial)
        this._faceDots.renderOrder = 101
        this._faceDots.frustumCulled = false
        this._faceDots.visible = false

        // Selected faces: Blender's `face_select`, a translucent tint that does not hide the shading.
        const faceMaterial = new UnlitMaterial({
            color: EditTheme.faceSelect, transparent: true, opacity: EditTheme.faceSelectAlpha * 1.5,
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        })
        faceMaterial.toneMapped = false
        faceMaterial.depthTest = !this.xray
        this._faceHighlight = new Mesh2(new BufferGeometry2(), faceMaterial)
        this._faceHighlight.renderOrder = 98
        this._faceHighlight.frustumCulled = false

        // The face under the cursor in face mode, so it is clear faces are what a click picks.
        const preMaterial = new UnlitMaterial({
            color: EditTheme.preselect, transparent: true, opacity: 0.3,
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        })
        preMaterial.toneMapped = false
        preMaterial.depthTest = !this.xray
        this._facePreselect = new Mesh2(new BufferGeometry2(), preMaterial)
        this._facePreselect.renderOrder = 97
        this._facePreselect.frustumCulled = false
        this._facePreselect.visible = false

        // Overlays are drawing only. The object picker's raycaster walks every child of the scene,
        // and `LineSegments2.raycast` expects a `LineMaterial`; a widget must not answer at all.
        for (const obj of [this._vertPoints, this._edgeLines, this._faceDots, this._faceHighlight, this._facePreselect]) {
            obj.raycast = () => { /* not pickable */ }
        }
        root.add(this._vertPoints as never, this._edgeLines as never, this._faceDots as never,
            this._faceHighlight as never, this._facePreselect as never)
        // Overlays live in the edited object's space, so they follow its transform for free.
        this.editObject.add(root as never)

        this._regionOverlay = new RegionOverlay(viewer.canvas)

        this.refreshOverlays()
    }

    private _destroyOverlays(): void {
        for (const obj of [this._vertPoints, this._edgeLines, this._faceDots, this._faceHighlight, this._facePreselect]) {
            obj?.geometry?.dispose?.()
            ;(obj?.material as any)?.dispose?.()
        }
        this._root?.removeFromParent()
        this._root = null
        this._vertPoints = null
        this._edgeLines = null
        this._faceDots = null
        this._faceHighlight = null
        this._facePreselect = null
        this._vertData = null
        this._edgeData = null
        this._faceDotData = null
        this._regionOverlay?.dispose()
        this._regionOverlay = null
    }

    /**
     * Rebuild every overlay buffer from the current BMesh. Call after topology changed, or elements
     * were hidden or revealed. Selection and hover changes only need {@link _refreshFlags}, and a
     * running transform only {@link _refreshOverlayPositions}.
     */
    refreshOverlays(): void {
        if (!this.state) return
        // Elements may have moved, appeared or gone; the selection buffer is rebuilt before the next pick.
        this._selectDirty = true
        // A pre-selected element may no longer exist.
        if (this._preselect && !this._elementAlive(this._preselect)) this._preselect = null
        this._rebuildOverlayGeometry()
        this._refreshFlags()
    }

    /** New buffers for the current elements: positions and flags, and the element lists behind them. */
    private _rebuildOverlayGeometry(): void {
        const bm = this.state!.bm

        if (this._vertPoints) {
            const data = this._vertData = buildVertexOverlay(bm)
            const g = this._vertPoints.geometry
            g.setAttribute('position', new BufferAttribute(data.position, 3))
            g.setAttribute('aFlag', new BufferAttribute(data.flag, 1))
            g.computeBoundingSphere()
        }

        if (this._edgeLines) {
            const data = this._edgeData = buildEdgeOverlay(bm)
            // A new geometry every rebuild: three.js caches an instanced geometry's draw limit the first
            // time it binds its attributes (`_maxInstanceCount`, WebGLBindingStates.js), so reusing the old
            // one after an extrude drew only as many edges as the mesh had before - the new edges vanished.
            const old = this._edgeLines.geometry
            const g = new LineSegmentsGeometry()
            this._edgeLines.geometry = g as never
            old.dispose()
            g.setPositions(data.position)
            // The two flags per edge, interleaved, so a selection change rewrites one array in place.
            const flags = new InstancedInterleavedBuffer(data.flag, 2, 1)
            g.setAttribute('instanceFlagStart', new InterleavedBufferAttribute(flags, 1, 0))
            g.setAttribute('instanceFlagEnd', new InterleavedBufferAttribute(flags, 1, 1))
            g.instanceCount = data.elements.length
        }

        if (this._faceDots) {
            const data = this._faceDotData = buildFaceDotOverlay(bm)
            const g = this._faceDots.geometry
            g.setAttribute('position', new BufferAttribute(data.position, 3))
            g.setAttribute('aFlag', new BufferAttribute(data.flag, 1))
            g.computeBoundingSphere()
        }
    }

    /** Re-read the vertex positions into the existing buffers; the topology is unchanged. */
    private _refreshOverlayPositions(): void {
        if (!this.state) return
        this._selectDirty = true
        if (this._vertPoints && this._vertData) {
            refreshVertexPositions(this._vertData)
            const g = this._vertPoints.geometry
            g.getAttribute('position').needsUpdate = true
            g.computeBoundingSphere()
        }
        if (this._edgeLines && this._edgeData) {
            refreshEdgePositions(this._edgeData)
            const g = this._edgeLines.geometry as LineSegmentsGeometry
            const start = g.getAttribute('instanceStart') as InterleavedBufferAttribute
            start.data.needsUpdate = true
            g.computeBoundingSphere()
        }
        if (this._faceDots && this._faceDotData) {
            refreshFaceDotPositions(this._faceDotData)
            const g = this._faceDots.geometry
            g.getAttribute('position').needsUpdate = true
            g.computeBoundingSphere()
        }
        this._refreshFlags()
    }

    /** Whether face dots are drawn right now, from the mode, {@link faceDots} and X-ray. */
    get faceDotsVisible(): boolean {
        if (!this.state || !(this.state.bm.selectMode & SelectMode.Face)) return false
        return this.faceDots === 'always' || this.faceDots === 'xray' && this.xray
    }

    /** Redraw selection, active and hover state. Rewrites the flag attributes only; cheap per frame. */
    private _refreshFlags(): void {
        if (!this.state) return
        const bm = this.state.bm
        const active = bm.selectHistory.length
            ? bm.selectHistory[bm.selectHistory.length - 1].elem : undefined
        const pre = this.preselectHighlight ? this._preselect ?? undefined : undefined

        const vertexMode = (bm.selectMode & SelectMode.Vertex) !== 0

        if (this._vertPoints && this._vertData) {
            this._vertPoints.visible = vertexMode
            if (vertexMode) {
                refreshVertexFlags(this._vertData, active, pre)
                this._vertPoints.geometry.getAttribute('aFlag').needsUpdate = true
                setOverlayPixelRatio(this._vertPoints.material as ShaderMaterial, this._pixelRatio())
            }
        }

        if (this._edgeLines && this._edgeData) {
            refreshEdgeFlags(this._edgeData, active, pre, vertexMode)
            const g = this._edgeLines.geometry as LineSegmentsGeometry
            const flags = g.getAttribute('instanceFlagStart') as InterleavedBufferAttribute
            flags.data.needsUpdate = true
        }

        if (this._faceDots && this._faceDotData) {
            const show = this.faceDotsVisible
            this._faceDots.visible = show
            if (show) {
                refreshFaceDotFlags(this._faceDotData, active, pre)
                this._faceDots.geometry.getAttribute('aFlag').needsUpdate = true
                setOverlayPixelRatio(this._faceDots.material as ShaderMaterial, this._pixelRatio(), EditTheme.facedotSizePx)
            }
        }

        if (this._faceHighlight) {
            const data = buildFaceOverlay(bm)
            const g = this._faceHighlight.geometry
            g.setAttribute('position', new BufferAttribute(data.position, 3))
            g.setIndex(new BufferAttribute(data.index, 1))
            this._faceHighlight.visible = data.elements.length > 0
            g.computeBoundingSphere()
        }

        if (this._facePreselect) {
            const face = pre instanceof BMFace ? pre : null
            this._facePreselect.visible = !!face
            if (face) {
                const data = buildFaceOverlay(bm, face)
                const g = this._facePreselect.geometry
                g.setAttribute('position', new BufferAttribute(data.position, 3))
                g.setIndex(new BufferAttribute(data.index, 1))
                g.computeBoundingSphere()
            }
        }

        this._viewer?.setDirty()
    }

    private _elementAlive(elem: BMVert | BMEdge | BMFace): boolean {
        const bm = this.state?.bm
        if (!bm) return false
        if (elem instanceof BMVert) return bm.verts.has(elem)
        if (elem instanceof BMEdge) return bm.edges.has(elem)
        return bm.faces.has(elem)
    }

    // region camera buttons

    /** three's `MOUSE.ROTATE`. */
    private static readonly MOUSE_ROTATE = 0

    private _controls(): any {
        return (this._viewer?.scene.mainCamera as any)?.controls
    }

    /**
     * Take the left button away from the camera while edit mode drag-selects: the middle button
     * orbits (Blender's default) and so does `Alt`+left (Blender's "emulate 3 button mouse").
     * Restored by {@link _restoreOrbit} on exit.
     */
    private _captureOrbit(): void {
        const controls = this._controls()
        if (!controls || !controls.mouseButtons || this._orbitSaved) return
        this._orbitSaved = {controls, mouseButtons: {...controls.mouseButtons}}
        this._applyOrbitButtons()
    }

    private _restoreOrbit(): void {
        const saved = this._orbitSaved
        if (!saved) return
        this._orbitSaved = null
        Object.assign(saved.controls.mouseButtons, saved.mouseButtons)
    }

    private _applyOrbitButtons(): void {
        const saved = this._orbitSaved
        if (!saved) return
        const mb = saved.controls.mouseButtons
        if (this._circle) {
            // Circle select paints with the left and middle buttons; neither may orbit meanwhile.
            mb.LEFT = null
            mb.MIDDLE = null
            mb.RIGHT = saved.mouseButtons.RIGHT
        } else if (this._orbitButtons) {
            Object.assign(mb, saved.mouseButtons, this._orbitButtons)
        } else if (this._dragSelect === 'none') {
            Object.assign(mb, saved.mouseButtons)
        } else {
            mb.LEFT = this._altHeld ? MeshEditPlugin.MOUSE_ROTATE : null
            mb.MIDDLE = MeshEditPlugin.MOUSE_ROTATE
            mb.RIGHT = saved.mouseButtons.RIGHT
        }
    }

    private _altHeld = false

    // endregion

    // endregion

    // region selection

    /** Select a single element, or add to the selection. */
    selectElement(elem: BMVert | BMEdge | BMFace | null, extend = false): void {
        const state = this.state
        if (!state) return
        const bm = state.bm

        if (!extend) selectNone(bm)
        if (elem) {
            const alreadySelected = (elem.hflag & ElemFlag.Select) !== 0
            const select = !(extend && alreadySelected)
            if (elem instanceof BMVert) vertSelectSet(bm, elem, select)
            else if (elem instanceof BMEdge) edgeSelectSet(bm, elem, select)
            else faceSelectSet(bm, elem, select)
            if (select) selectHistoryStore(bm, elem)
        }
        // `EDBM_select_pick` ends with the mode flush: two selected vertices select their edge, four
        // corners their face, which is what lets a vertex-mode selection be extruded as a face.
        selectModeFlush(bm)
        this._afterSelectionChange()
    }

    /** Set the select mode outright, converting the selection (`EDBM_selectmode_set`). */
    setSelectMode(mode: SelectModeMask): void {
        if (!this.state) return
        selectModeSet(this.state.bm, mode)
        this._preselect = null
        this._afterSelectionChange()
    }

    /**
     * The 1 / 2 / 3 keys and the header buttons (`EDBM_selectmode_toggle_multi`, Blender's
     * `mesh.select_mode` operator): `extend` (Shift) adds the mode to the current ones or removes
     * it, `expand` (Ctrl) converts the selection so elements touching it come along when going up.
     * Returns whether the mode changed.
     */
    toggleSelectMode(mode: SelectModeMask, opts: {extend?: boolean, expand?: boolean} = {}): boolean {
        if (!this.state) return false
        const changed = selectModeToggleMulti(this.state.bm, mode, 2, !!opts.extend, !!opts.expand)
        if (!changed) return false
        this._preselect = null
        this._afterSelectionChange()
        return true
    }

    selectAllElements(): void {
        if (!this.state) return
        selectAll(this.state.bm)
        this._afterSelectionChange()
    }

    deselectAllElements(): void {
        if (!this.state) return
        selectNone(this.state.bm)
        this._afterSelectionChange()
    }

    invertSelection(): void {
        if (!this.state) return
        selectInvert(this.state.bm)
        this._afterSelectionChange()
    }

    /**
     * Grow every selected element to its connected piece. Blender's `Ctrl+L` (`mesh.select_linked`).
     * `delimit` defaults to {@link linkedDelimit}, or Blender's mode-dependent default.
     */
    selectLinked(delimit?: LinkedDelimit): void {
        const state = this.state
        if (!state) return
        selectLinkedAll(state.bm, delimit ?? this.linkedDelimit ?? linkedDelimitDefault(state.bm))
        this._afterSelectionChange()
    }

    /**
     * Select what is connected to the element under the cursor. Blender's `L`
     * (`mesh.select_linked_pick`); `deselect` is `Shift+L`. Returns false when nothing is there.
     */
    selectLinkedPick(x: number, y: number, opts: {deselect?: boolean, delimit?: LinkedDelimit} = {}): boolean {
        const state = this.state
        if (!state) return false
        const elem = this.pickAt(x, y)
        if (!elem) return false
        selectLinkedPick(state.bm, elem, !opts.deselect, opts.delimit ?? this.linkedDelimit ?? linkedDelimitDefault(state.bm))
        this._afterSelectionChange()
        return true
    }

    /** Grow the selection by one step. Blender's `Ctrl+Numpad+` (`mesh.select_more`). */
    selectMore(faceStep = false): void {
        if (!this.state) return
        selectMore(this.state.bm, faceStep)
        this._afterSelectionChange()
    }

    /** Shrink the selection by one step. Blender's `Ctrl+Numpad-` (`mesh.select_less`). */
    selectLess(faceStep = false): void {
        if (!this.state) return
        selectLess(this.state.bm, faceStep)
        this._afterSelectionChange()
    }

    /**
     * Loop select from the edge under the cursor: the edge loop, or with `ring` the edge ring, or
     * in face mode the face loop. Blender's `Alt+click` / `Ctrl+Alt+click` (`mesh.loop_select`,
     * `mesh.edgering_select`). Returns false when no edge is near the cursor.
     */
    selectLoop(x: number, y: number, params: Omit<LoopSelectParams, 'cursor'> = {}): boolean {
        const state = this.state
        const project = this._projectFn()
        if (!state || !project) return false
        const edge = this.pickEdgeAt(x, y)
        if (!edge) return false
        const delimit = params.delimit ?? (params.ring ? this.ringDelimit : this.loopDelimit)
        loopSelectEdge(state.bm, edge, {...params, delimit, cursor: {x, y, project}})
        this._afterSelectionChange()
        return true
    }

    /**
     * Select the shortest path from the active element to the element of the same kind under the
     * cursor, toggling it off when the whole path was selected. Blender's `Ctrl+click`
     * (`mesh.shortest_path_pick`). With nothing selected it selects the element under the cursor.
     */
    selectShortestPath(x: number, y: number, params: PathSelectParams = {}): boolean {
        const state = this.state
        if (!state) return false
        const bm = state.bm
        if (bm.totvertsel === 0) {
            // Nothing to path from: select the picked element, as Blender does.
            const picked = this.pickAt(x, y)
            if (!picked) return false
            this.selectElement(picked, true)
            return true
        }
        const src = activeElemOrFace(bm)
        if (!src) return false
        const dst = this._findNearestOfType(src, x, y)
        if (!dst) return false
        const ok = shortestPathPick(bm, src, dst, {trackActive: true, ...this.pathOptions, ...params})
        if (ok) this._afterSelectionChange()
        return ok
    }

    // region region select

    /**
     * Box select in canvas pixels (`view3d.select_box`). `op`: `set` replaces, `add` extends,
     * `sub` subtracts, `and` intersects, `xor` toggles. Returns whether the selection changed.
     */
    boxSelect(rect: {x0: number, y0: number, x1: number, y1: number}, op: SelectOp = 'set'): boolean {
        const r: ScreenRect = {
            xmin: Math.floor(Math.min(rect.x0, rect.x1)), ymin: Math.floor(Math.min(rect.y0, rect.y1)),
            xmax: Math.floor(Math.max(rect.x0, rect.x1)), ymax: Math.floor(Math.max(rect.y0, rect.y1)),
        }
        return this._applyRegion({kind: 'rect', rect: r}, op)
    }

    /** Lasso select from a polyline of canvas pixels (`view3d.select_lasso`). */
    lassoSelect(points: readonly (readonly [number, number])[], op: SelectOp = 'set'): boolean {
        if (points.length < 3) return false
        const ints: LassoPoint[] = points.map(p => [Math.round(p[0]), Math.round(p[1])])
        return this._applyRegion({kind: 'lasso', points: ints}, op)
    }

    /** Circle select around a canvas point (`view3d.select_circle`); `sub` deselects, anything else selects. */
    circleSelect(x: number, y: number, radius = this.circleRadius, op: SelectOp = 'add'): boolean {
        return this._applyRegion({kind: 'circle', x, y, radius}, op)
    }

    /**
     * The region tools over the selection buffer (`do_mesh_box_select` and friends). Without X-ray,
     * the buffer says which elements have pixels in the region, so only visible ones take part;
     * with X-ray everything is projected and tested.
     */
    private _applyRegion(shape: RegionShape, op: SelectOp): boolean {
        const state = this.state
        const viewer = this._viewer
        const project = this._projectFn()
        if (!state || !viewer || !project) return false
        const bm = state.bm

        let elements: SelectBuffer['elements']
        let visibility: RegionVisibility | null = null
        const select = this.xray ? null : this._prepareSelect()
        if (select) {
            elements = select.elements
            const canvas = viewer.canvas.getBoundingClientRect()
            const W = Math.max(1, Math.floor(canvas.width))
            const H = Math.max(1, Math.floor(canvas.height))
            const none = new Uint8Array(0)
            const bitmap = (domain: SelectDomain): Uint8Array => {
                if (shape.kind === 'circle') return select.bitmapFromCircle(domain, shape.x, shape.y, shape.radius + 1)
                const rect = shape.kind === 'rect' ? shape.rect : lassoBoundBox(shape.points)
                // Keep the read inside the canvas; the buffer cannot be read off its edges.
                const clamped: ScreenRect = {
                    xmin: Math.max(0, rect.xmin), ymin: Math.max(0, rect.ymin),
                    xmax: Math.min(W - 1, rect.xmax), ymax: Math.min(H - 1, rect.ymax),
                }
                if (clamped.xmax < clamped.xmin || clamped.ymax < clamped.ymin) return new Uint8Array(select.elements[domain === 'vert' ? 'verts' : domain === 'edge' ? 'edges' : 'faces'].length)
                return shape.kind === 'rect'
                    ? select.bitmapFromRect(domain, clamped)
                    : select.bitmapFromPoly(domain, shape.points, clamped)
            }
            const mode = bm.selectMode
            visibility = {
                verts: mode & SelectMode.Vertex ? bitmap('vert') : none,
                edges: mode & SelectMode.Edge ? bitmap('edge') : none,
                faces: mode & SelectMode.Face ? bitmap('face') : none,
            }
        } else {
            const visible = (e: {hflag: number}) => !(e.hflag & ElemFlag.Hidden)
            elements = {
                verts: [...bm.verts].filter(visible),
                edges: [...bm.edges].filter(visible),
                faces: [...bm.faces].filter(visible),
            }
        }

        const changed = regionSelect(bm, elements, shape, op, project, visibility)
        if (changed) this._afterSelectionChange()
        return changed
    }

    /** The running box or lasso gesture, for an app that wants to draw its own marquee. */
    get activeRegion(): RegionShape | null {
        const r = this._region
        if (!r) return null
        if (r.kind === 'box') {
            return {kind: 'rect', rect: {xmin: Math.min(r.x0, r.x1), ymin: Math.min(r.y0, r.y1), xmax: Math.max(r.x0, r.x1), ymax: Math.max(r.y0, r.y1)}}
        }
        return {kind: 'lasso', points: r.points}
    }

    /** Whether the circle-select modal (`C`) is running. */
    get isCircleSelecting(): boolean {
        return this._circle !== null
    }

    /**
     * Start Blender's circle select modal (`C`): the circle follows the cursor, the left button
     * paints a selection, the middle button (or `Shift`+left) deselects, the wheel resizes it, and
     * `Esc`, `Enter` or the right button end it.
     */
    startCircleSelect(): void {
        if (!this.isEditing || this._circle) return
        this._endRegion(false)
        this._circle = {painting: false, op: 'add', first: true}
        this._applyOrbitButtons()
        this._setPreselect(null)
        this._drawCircle()
    }

    endCircleSelect(): void {
        if (!this._circle) return
        this._circle = null
        this._regionOverlay?.clear()
        this._applyOrbitButtons()
        this.dispatchEvent({type: 'regionChanged', region: null})
    }

    private _drawCircle(): void {
        this._regionOverlay?.circle(this._pointerX, this._pointerY, this.circleRadius)
        this.dispatchEvent({type: 'regionChanged', region: {kind: 'circle', x: this._pointerX, y: this._pointerY, radius: this.circleRadius}})
    }

    private _endRegion(apply: boolean): void {
        const r = this._region
        if (!r) return
        this._region = null
        this._regionOverlay?.clear()
        if (apply) {
            if (!this.isEditing) this.boxSelectObjects({x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1}, r.op)
            else if (r.kind === 'box') this.boxSelect({x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1}, r.op)
            else this.lassoSelect(r.points, r.op)
        }
        this.dispatchEvent({type: 'regionChanged', region: null})
    }

    // endregion

    /**
     * Box-select objects, as Blender's `do_object_box_select`: every selectable object with any triangle
     * inside the rectangle, occluded or not (`GPU_SELECT_ALL`), combined with the current selection by
     * `op` (`ED_select_op_action_deselected`). The selection goes through the viewer's picking plugin, so
     * it is the same selection a click makes, with its undo step.
     */
    boxSelectObjects(rect: CanvasRect, op: SelectOp = 'set'): IObject3D[] {
        const viewer = this._viewer
        const picking = viewer?.getPlugin<any>('Picking')
        const picker = picking?.picker
        if (!viewer || !picker) return []
        const camera = viewer.scene.mainCamera
        camera.updateMatrixWorld()
        const viewProj = new Matrix4().multiplyMatrices((camera as any).projectionMatrix, (camera as any).matrixWorldInverse)
        const canvas = viewer.canvas.getBoundingClientRect()
        const v = new Vector4()

        const candidates: IObject3D[] = []
        viewer.scene.modelRoot.traverseVisible((o: IObject3D) => {
            if (!(o as any).isMesh || !o.geometry) return
            if ((o as any).assetType === 'widget' || o.userData?.isWidgetRoot) return
            if (picker.selectionCondition && !picker.selectionCondition(o)) return
            candidates.push(o)
        })

        const inside = new Set<IObject3D>()
        for (const o of candidates) {
            const geometry = o.geometry as unknown as BufferGeometry2
            const position = geometry.getAttribute('position')
            if (!position) continue
            o.updateWorldMatrix(true, false)
            const m = new Matrix4().multiplyMatrices(viewProj, o.matrixWorld as never)
            const project = (x: number, y: number, z: number): [number, number] | null => {
                v.set(x, y, z, 1).applyMatrix4(m)
                if (v.w <= 0) return null
                return [(v.x / v.w * 0.5 + 0.5) * canvas.width, (-v.y / v.w * 0.5 + 0.5) * canvas.height]
            }
            const index = geometry.getIndex()
            if (meshTouchesRect(position.array as ArrayLike<number>, index ? index.array as ArrayLike<number> : null, project, rect)) inside.add(o)
        }

        const current = new Set<IObject3D>((picker.selectedObjects ?? []) as IObject3D[])
        // `SEL_OP_USE_PRE_DESELECT` deselects everything first, so each object is then judged unselected.
        const preDeselect = selectOpUsePreDeselect(op)
        const next = new Set<IObject3D>(preDeselect ? [] : current)
        for (const o of candidates) {
            const action = selectOpAction(op, !preDeselect && current.has(o), inside.has(o))
            if (action === 1) next.add(o)
            else if (action === 0) next.delete(o)
        }
        const result = [...next]
        picker.setSelected(result.length === 0 ? null : result.length === 1 ? result[0] : result, true)
        viewer.setDirty()
        return result
    }

    // region hide and reveal

    /** Hide the selected elements, or with `unselected` everything else. Blender's `H` / `Shift+H`. */
    hideSelected(unselected = false): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        if (!meshHide(state.bm, unselected)) {
            this._notice(unselected ? 'Nothing to hide: everything is selected.' : 'Select something to hide first.', 'info')
            return false
        }
        this._preselect = null
        this._commitTopologyChange(before, 'Hide')
        this.dispatchEvent({type: 'elementSelectionChanged', state})
        return true
    }

    /** Show every hidden element, selecting what comes back. Blender's `Alt+H`. */
    revealHidden(select = true): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        if (!meshReveal(state.bm, select)) return false
        this._commitTopologyChange(before, 'Reveal')
        this.dispatchEvent({type: 'elementSelectionChanged', state})
        return true
    }

    // endregion

    private _afterSelectionChange(): void {
        this._refreshFlags()
        if (this.state) this.dispatchEvent({type: 'elementSelectionChanged', state: this.state})
    }

    // endregion

    // region operators

    /**
     * Extrude the selection and immediately start moving it.
     *
     * This is Blender's `MESH_OT_extrude_region_move` macro: the topology change happens once, up
     * front, and the following drag only moves vertices. Cancelling the move leaves the extrusion in
     * place, which is Blender's behaviour too and is what makes a mistaken `E` recoverable with undo
     * rather than surprising.
     */
    extrude(): boolean {
        const state = this.state
        if (!state) return false
        // The normal has to be measured before the topology changes, from the faces being extruded.
        const selectedFaces = [...state.bm.faces].filter(f => f.hflag & ElemFlag.Select)
        const normal = selectedFaces.length ? averageFaceNormal(selectedFaces) : null

        const before = this._snapshot()
        const result = extrudeSelection(state.bm)
        if (!result) {
            this._notice('Select something to extrude first.')
            return false
        }
        state.syncFromBMesh()
        this.applyToObject()
        this.refreshOverlays()
        this.dispatchEvent({type: 'meshChanged', state})

        // Chain into a move along the region's normal, which is what makes `E` push a face straight
        // out of the surface however it is oriented: Blender's `extrude_region_move` runs the
        // translate with `orient_type = NORMAL` and `constraint_axis = (0, 0, 1)`. An axis key
        // overrides it. The undo step covers both, and is recorded when the move ends - confirmed or
        // cancelled, the extrusion stays.
        if (normal) this.startTransform('translate', {undoBefore: before, orientation: 'normal', constraint: CON_AXIS2, chained: 'extrude'})
        else this.startTransform('translate', {undoBefore: before, chained: 'extrude'})
        return true
    }

    /**
     * Extrude the selection and move it as a finished extrude-and-move did: what the redo panel re-runs
     * (Blender's `MESH_OT_extrude_region_move` repeated, extrude then `TRANSFORM_OT_translate` exec with
     * its saved properties). One undo step, labelled `Extrude`.
     */
    extrudeBy(move: TransformSavedProps): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        if (!extrudeSelection(state.bm)) {
            this._notice('Select something to extrude first.')
            return false
        }
        this._runTransform(move)
        this._commitTopologyChange(before, 'Extrude')
        return true
    }

    /**
     * Duplicate the selection and start moving it. Blender's `Shift+D`, and the operation the
     * kit-bashing workflow leans on most: copy a piece, place it, repeat.
     */
    duplicate(): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        const result = duplicateSelection(state.bm)
        if (!result) {
            this._notice('Select something to duplicate first.')
            return false
        }
        state.syncFromBMesh()
        this.applyToObject()
        this.refreshOverlays()
        this.dispatchEvent({type: 'meshChanged', state})
        this.startTransform('translate', {undoBefore: before, chained: 'duplicate'})
        return true
    }

    /** Duplicate the selection and move the copy as a finished duplicate-and-move did (the redo-panel re-run). */
    duplicateBy(move: TransformSavedProps): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        if (!duplicateSelection(state.bm)) {
            this._notice('Select something to duplicate first.')
            return false
        }
        this._runTransform(move)
        this._commitTopologyChange(before, 'Duplicate')
        return true
    }

    /**
     * Move, rotate or scale the selection with a finished transform's saved properties, no modal: the
     * redo panel's re-run (`initTransInfo` with `T_INPUT_IS_VALUES_FINAL`). The same transform system as
     * the interactive one, so pivot, orientation, constraint and proportional editing apply identically.
     * One undo step.
     */
    applyTransformValues(saved: TransformSavedProps): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        if (!this._runTransform(saved)) {
            this._notice(TRANSFORM_EMPTY[saved.mode])
            return false
        }
        this._commitTopologyChange(before, TRANSFORM_LABELS[saved.mode])
        return true
    }

    /** Run a transform non-modally from saved properties and confirm it. False when nothing is selected. */
    private _runTransform(saved: TransformSavedProps): boolean {
        const viewer = this._viewer
        const state = this.state
        if (!viewer || !state || !this.editObject) return false
        this.editObject.updateWorldMatrix(true, false)
        const objectMatrix = Array.from(this.editObject.matrixWorld.elements)
        const t = new ModalTransform({
            mode: saved.mode,
            view: this._transformView(),
            // Deliberate deviation for the slides (`SlideSavedProps`): Blender's exec uses (0, 0); the
            // first run's cursor makes a redo pick the same reference vertex and loop sides.
            mval: saved.slide ? saved.slide.mval : [0, 0],
            around: this.pivot,
            cursor: this.cursor,
            orientation: this.orientation,
            orientType: saved.orientType,
            orientMatrix: saved.orientMatrix,
            orientMatrixType: saved.orientMatrixType,
            orientAxis: saved.orientAxis,
            constraintAxis: saved.constraintAxis,
            value: saved.value,
            modal: false,
            proportional: saved.proportional,
            snap: {...this.snapping, enabled: false},
            slide: saved.slide ?? null,
            xray: this.xray,
            bm: state.bm,
            objectMatrix,
        })
        // Empty, or a slide that cannot run on this selection (`TRANS_CANCEL` from its init).
        if (t.isEmpty || t.isDone) return false
        t.confirm()
        return true
    }

    /** Split the selection away from the rest of the mesh. Blender's `Y`. */
    split(): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        if (!splitSelection(state.bm)) return false
        this._commitTopologyChange(before, 'Split')
        return true
    }

    /** Delete the selection with the given context. Blender's `X` menu. */
    deleteSelected(context: DeleteContext = 'verts'): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        const removed = deleteSelection(state.bm, context)
        if (!removed) {
            this._notice('Nothing selected to delete.', 'info')
            return false
        }
        this._commitTopologyChange(before, DELETE_LABELS[context] ?? 'Delete')
        return true
    }

    /** Merge the selected vertices. Blender's `M`. */
    merge(mode: 'center' | 'first' | 'last' = 'center'): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        if (!mergeSelectedVerts(state.bm, mode)) {
            this._notice('Select two or more vertices to merge.', 'info')
            return false
        }
        this._commitTopologyChange(before, 'Merge')
        return true
    }

    private _commitTopologyChange(before: MeshData, label: string): void {
        const state = this.state!
        state.syncFromBMesh()
        this.applyToObject()
        this.refreshOverlays()
        this.dispatchEvent({type: 'meshChanged', state})
        this._recordUndo(before, label)
    }

    /**
     * The session mesh as it is now, for callers that change `state.bm` themselves and then
     * {@link commit}. The pair is how an operator outside this plugin (the editor engine's loop
     * select, dissolve, ...) gets the same bake, overlay refresh and labelled undo step as the
     * built-in ones.
     */
    snapshot(): MeshData | null {
        return this.state ? this._snapshot() : null
    }

    /** Bake a change made directly to `state.bm`, refresh overlays and record one undo step from `before`. */
    commit(before: MeshData, label: string): void {
        if (!this.state) return
        this._commitTopologyChange(before, label)
    }

    /**
     * Rebuild the session from the mesh provider (the modelling document), keeping the select mode.
     *
     * For when the document changed underneath the session: a document command ran on the edited
     * object, or such a step was undone. Without this the session would keep editing a stale copy
     * and bake it back over the newer one on the next commit.
     */
    reload(): boolean {
        const object = this.editObject
        const state = this.state
        if (!object || !state) return false
        const provided = this._providedMesh(object)
        if (!provided) return false
        if (this._transform) this.cancelTransform()
        const mode = state.selectMode
        this.state = EditMeshState.fromMeshData(provided.clone())
        selectModeSet(this.state.bm, mode)
        this._preselect = null
        this._cycle.reset()
        this.refreshOverlays()
        this.dispatchEvent({type: 'meshChanged', state: this.state})
        this.dispatchEvent({type: 'elementSelectionChanged', state: this.state})
        return true
    }

    /**
     * Select elements by index - the numbering `bmToMesh` and the modelling commands use (set order).
     * How a command's result (`insetFaces`, `capFaces`, ...) becomes the new selection.
     */
    selectElements(kind: 'vertex' | 'edge' | 'face', indices: number[], extend = false): void {
        const state = this.state
        if (!state) return
        const bm = state.bm
        if (!extend) selectNone(bm)
        const pool = kind === 'vertex' ? [...bm.verts] : kind === 'edge' ? [...bm.edges] : [...bm.faces]
        let last: BMVert | BMEdge | BMFace | undefined
        for (const i of indices) {
            const el = pool[i]
            if (!el) continue
            if (el instanceof BMVert) vertSelectSet(bm, el, true)
            else if (el instanceof BMEdge) edgeSelectSet(bm, el, true)
            else faceSelectSet(bm, el, true)
            last = el
        }
        if (last) selectHistoryStore(bm, last)
        this._afterSelectionChange()
    }

    // endregion

    // region undo

    /**
     * The mesh as it is now, selection included. Blender's edit-mode undo stores a full mesh per step
     * (`editors/mesh/editmesh_undo.cc`, via `BM_mesh_bm_to_me`); this is the same, without the chunked
     * de-duplication yet.
     */
    private _snapshot(): MeshData {
        return bmToMesh(this.state!.bm)
    }

    /**
     * Record one undo step from `before` to the current mesh, on the viewer's `UndoManagerPlugin`, so
     * edit-mode steps share Ctrl+Z with everything else.
     */
    private _recordUndo(before: MeshData, label: string): void {
        const object = this.editObject
        const state = this.state
        if (!object || !state) return
        const after = state.mesh.clone()
        const undoManager = this._viewer?.getPlugin<any>('UndoManagerPlugin')?.undoManager
        if (!undoManager) {
            if (!this._warnedNoUndo) {
                this._warnedNoUndo = true
                this._viewer?.console.warn('MeshEditPlugin: add UndoManagerPlugin to the viewer for undo in edit mode')
            }
            return
        }
        // `label` is what a history list shows; `JSUndoManager` itself ignores it.
        undoManager.record({
            label,
            undo: () => this._restore(object, before),
            redo: () => this._restore(object, after),
        })
    }
    private _warnedNoUndo = false

    /** Put an object's mesh back to a recorded state, in edit mode or out of it. */
    private _restore(object: IObject3D, mesh: MeshData): void {
        if (this.editObject === object && this.state) {
            if (this._transform) this.cancelTransform()
            this.state = EditMeshState.fromMeshData(mesh.clone())
            this._preselect = null
            this.applyToObject()
            this.refreshOverlays()
            this.dispatchEvent({type: 'elementSelectionChanged', state: this.state})
            return
        }
        // Out of edit mode: bake straight into the object and tell whoever owns its topology.
        const state = EditMeshState.fromMeshData(mesh.clone())
        this._bakeIntoObject(object, state)
        for (const sink of this.meshSinks) {
            try {
                sink(object, state.mesh)
            } catch (e) {
                this._viewer?.console.error('MeshEditPlugin: a mesh sink threw', e)
            }
        }
        this._viewer?.setDirty()
    }

    // endregion

    // region modal transform

    /**
     * Begin a modal move, rotate or scale on the current selection.
     *
     * Mirrors Blender: the transform owns the input until it is confirmed with a click or Enter, or
     * cancelled with Escape. Axis keys, typed numbers, Ctrl (snap), Shift (precision) and the wheel
     * (proportional size) refine it while it runs. The maths is Blender's, see `transform/TransInfo.ts`.
     */
    startTransform(mode: TransformMode, opts: StartTransformOptions = {}): boolean {
        const viewer = this._viewer
        const state = this.state
        if (!viewer || !state) return false
        if (this._transform) this.cancelTransform()
        if (this._objectTransform) this.cancelObjectTransform()

        const object = this.editObject!
        object.updateWorldMatrix(true, false)
        const objectMatrix = Array.from(object.matrixWorld.elements)
        const rect = viewer.canvas.getBoundingClientRect()
        const mouse = opts.mouse ?? {x: this._pointerX, y: this._pointerY}

        const transform = new ModalTransform({
            mode,
            view: this._transformView(),
            // Region pixels, y up, as Blender measures.
            mval: [mouse.x, rect.height - mouse.y],
            around: this.pivot,
            cursor: this.cursor,
            orientation: this.orientation,
            orientationSet: opts.orientation ?? null,
            customMatrix: opts.customMatrix,
            proportional: this.proportional,
            snap: this.snapping,
            snapContext: this._snapContext(state.bm, objectMatrix),
            constraint: opts.constraint,
            releaseConfirm: opts.releaseConfirm,
            slide: opts.slide ?? null,
            xray: this.xray,
            bm: state.bm,
            objectMatrix,
            onChange: t => this._onTransformChange(t),
        })

        // Empty, or a slide that cannot run on this selection (`TRANS_CANCEL` from its init).
        if (transform.isEmpty || transform.isDone) {
            // A loop cut of a lone edge leaves no edges to slide; Blender's macro just ends there.
            if (opts.chained !== 'loopcut') this._notice(TRANSFORM_EMPTY[mode])
            // An extrude or duplicate that chained into this still happened; keep its undo step.
            if (opts.undoBefore) this._recordUndo(opts.undoBefore, CHAIN_LABELS[opts.chained ?? 'extrude'])
            return false
        }
        this._transform = transform
        this._undoBefore = opts.undoBefore ?? this._snapshot()
        this._chained = opts.undoBefore ? opts.chained ?? 'extrude' : null
        this._setPreselect(null)
        // The transform owns the pointer until it ends: no orbiting, panning or zooming underneath it.
        viewer.scene.mainCamera.setInteractions(false, MeshEditPlugin.PluginType)
        this.dispatchEvent({type: 'transformChanged', transform})
        viewer.setDirty()
        return true
    }

    /** The camera as the transform maths sees it. */
    private _transformView(): TransformView {
        const viewer = this._viewer!
        const camera = viewer.scene.mainCamera as any
        camera.updateMatrixWorld(true)
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
        const rect = viewer.canvas.getBoundingClientRect()
        return TransformView.fromCamera(camera, rect.width, rect.height)
    }

    /** Flush the transform's results into the mesh and the view; called on every input. */
    private _onTransformChange(t: TransInfo): void {
        // Positions only: topology and selection do not change while a transform runs.
        this._refreshOverlayPositions()
        this._scheduleLiveUpdate()
        if (this._transform && this._transform.t === t) this.dispatchEvent({type: 'transformChanged', transform: this._transform})
    }

    /**
     * Snap targets for a transform: the edited mesh minus what is moving (Blender's
     * `bm_*_is_snap_target` filters), and the other scene meshes.
     */
    private _snapContext(bm: BMesh | null, objectMatrix: Mat4 | null, moving?: Set<IObject3D>): SnapContext {
        const ctx = new SnapContext()
        const geom = this.snapping.targets.some(x => x === 'vertex' || x === 'edge' || x === 'edgeMidpoint' || x === 'face')
        if (!geom) return ctx
        if (bm && objectMatrix) ctx.targets.push(snapTargetFromBMesh(bm, objectMatrix, true, this.editObject))
        if (this.snapToSceneObjects && this._viewer) {
            this._viewer.scene.modelRoot.traverse((o: IObject3D) => {
                if (o === this.editObject || moving?.has(o) || !o.visible) return
                if ((o as any).assetType === 'widget' || o.userData?.isWidgetRoot) return
                const geometry = o.geometry as unknown as BufferGeometry2 | undefined
                const position = geometry?.getAttribute?.('position')
                if (!position) return
                o.updateWorldMatrix(true, false)
                ctx.targets.push(snapTargetFromGeometry(position.array as ArrayLike<number>, geometry!.getIndex()?.array as ArrayLike<number> ?? null, Array.from(o.matrixWorld.elements), o))
            })
        }
        return ctx
    }

    /** Finish the running transform, keeping the result. */
    confirmTransform(): void {
        if (!this._transform || !this.state) return
        const transform = this._transform
        const chained = this._chained
        transform.confirm()
        this._transform = null
        this._endTransformInput()
        cancelAnimationFrame(this._liveFrame)
        this.state.syncFromBMesh()
        this.applyToObject()
        this.refreshOverlays()
        const before = this._undoBefore
        this._undoBefore = null
        this._chained = null
        if (before) this._recordUndo(before, chained ? CHAIN_LABELS[chained] : TRANSFORM_LABELS[transform.mode])
        const saved = transform.saved()
        this.dispatchEvent({type: 'transformCommitted', transform, chained, saved})
        this.dispatchEvent({type: 'transformChanged', transform: null})
        if (chained === 'loopcut') this._loopCutDone(saved)
    }

    /**
     * Abandon the running transform, restoring the starting positions exactly. If it was chained from an
     * extrude or duplicate, that part stays - as in Blender - and is still one undo step.
     */
    cancelTransform(): void {
        if (!this._transform) return
        this._transform.cancel()
        this._transform = null
        this._endTransformInput()
        cancelAnimationFrame(this._liveFrame)
        if (this.state) {
            this.state.syncFromBMesh()
            this.applyToObject()
        }
        this.refreshOverlays()
        this.dispatchEvent({type: 'transformChanged', transform: null})
        const before = this._undoBefore
        const chained = this._chained
        this._undoBefore = null
        this._chained = null
        // A plain move that was cancelled changed nothing; an extrude or duplicate underneath it did.
        if (before && chained) this._recordUndo(before, CHAIN_LABELS[chained])
        if (chained === 'loopcut') this._loopCutDone(null)
    }

    /** Give the pointer back to the camera and the gizmo its handles. */
    private _endTransformInput(): void {
        this._gizmoDrag = null
        this.gizmo.active = null
        this._viewer?.scene.mainCamera.setInteractions(true, MeshEditPlugin.PluginType)
        this._viewer?.setDirty()
    }

    // endregion

    // region loop cut and slide

    /** The loop cut modal while it previews rings, before the click that cuts. */
    get activeLoopCut(): LoopCutModal | null {
        return this._loopCut
    }

    /**
     * Begin Loop Cut and Slide: Blender's `MESH_OT_loopcut_slide` (`mesh_ops.cc:221`), the loop cut modal
     * (`editmesh_loopcut.cc`) followed by an edge slide. Hovering an edge previews the ring it would cut;
     * the wheel, PageUp/PageDown or a typed number set the cuts (Alt: the smoothness); a click cuts and
     * starts sliding the new loops, a second click places them (right-click leaves them centred). Esc or a
     * right-click before the cut cancels. `releaseConfirm` ends the slide on the button's release, as the
     * Loop Cut tool does (Blender's tool keymap sets it on the slide).
     */
    startLoopCut(opts: {mouse?: {x: number, y: number}, cuts?: number, smoothness?: number, falloff?: SubdFalloff, releaseConfirm?: boolean} = {}): boolean {
        const viewer = this._viewer
        if (!viewer || !this.state) return false
        if (this._transform) this.cancelTransform()
        if (this._loopCut) this.cancelLoopCut()
        const mouse = opts.mouse ?? {x: this._pointerX, y: this._pointerY}
        this._loopCut = new LoopCutModal({
            pickEdge: (x, y) => this.pickEdgeAt(x, y),
            cuts: opts.cuts,
            smoothness: opts.smoothness,
            falloff: opts.falloff,
        }, mouse.x, mouse.y)
        this._loopCutReleaseConfirm = !!opts.releaseConfirm
        this._setPreselect(null)
        // The modal owns the pointer and the wheel: no orbiting or zooming underneath it.
        viewer.scene.mainCamera.setInteractions(false, MeshEditPlugin.PluginType)
        this.dispatchEvent({type: 'loopCutChanged', loopCut: this._loopCut})
        viewer.setDirty()
        return true
    }

    /** Abandon the loop cut before it cut anything (`ringcut_cancel`). */
    cancelLoopCut(): void {
        if (!this._loopCut) return
        this._loopCut = null
        this._viewer?.scene.mainCamera.setInteractions(true, MeshEditPlugin.PluginType)
        this.dispatchEvent({type: 'loopCutChanged', loopCut: null})
        this._viewer?.setDirty()
    }

    /** After an event the modal handled: cut, cancel, or show the new preview. */
    private _loopCutInput(): void {
        const lc = this._loopCut
        if (!lc) return
        if (lc.state === 'confirm') this._finishLoopCut()
        else if (lc.state === 'cancel') this.cancelLoopCut()
        else {
            this.dispatchEvent({type: 'loopCutChanged', loopCut: lc})
            this._viewer?.setDirty()
        }
    }

    /**
     * `loopcut_finish` (`editmesh_loopcut.cc:527`): cut the previewed ring (`ringsel_finish`), then, as
     * the macro's second operator, slide the new loops. One undo step, `Loop Cut and Slide`, recorded
     * when the slide ends; cancelling the slide keeps the cut, centred.
     */
    private _finishLoopCut(): void {
        const lc = this._loopCut
        const state = this.state
        if (!lc || !state) return
        if (!lc.edge) {
            this.cancelLoopCut()
            return
        }
        this._loopCut = null
        const bm = state.bm
        // `set for redo`: the edge's index in mesh order.
        const cut: LoopCutCutProps = {cuts: lc.numberCuts, smoothness: lc.smoothness, falloff: lc.falloff, edgeIndex: [...bm.edges].indexOf(lc.edge)}
        const before = this._snapshot()
        editMeshLoopCut(bm, lc.edge, {numberCuts: cut.cuts, smoothness: cut.smoothness, falloff: cut.falloff, isMacro: true})
        state.syncFromBMesh()
        this.applyToObject()
        this.refreshOverlays()
        this.dispatchEvent({type: 'meshChanged', state})
        this._afterSelectionChange()
        this._loopCutPending = cut
        const sliding = this.startTransform('edgeSlide', {undoBefore: before, chained: 'loopcut', releaseConfirm: this._loopCutReleaseConfirm})
        if (sliding) {
            // Announced once the slide runs, so listeners see the hand-over rather than a cancel.
            this.dispatchEvent({type: 'loopCutChanged', loopCut: null})
            return
        }
        // Nothing to slide (a lone edge was cut); the cut is recorded as the step.
        this._viewer?.scene.mainCamera.setInteractions(true, MeshEditPlugin.PluginType)
        this._loopCutDone(null)
        // A sticky tool may have started the next loop cut already.
        if (!this._loopCut) this.dispatchEvent({type: 'loopCutChanged', loopCut: null})
    }

    private _loopCutDone(slide: TransformSavedProps | null): void {
        const cut = this._loopCutPending
        this._loopCutPending = null
        if (cut) this.dispatchEvent({type: 'loopCutDone', cut, slide})
    }

    /**
     * Loop Cut and Slide as the redo panel re-runs it: the cut through the edge at `cut.edgeIndex`, then
     * the slide with its saved properties (Blender repeats the macro's two operators with theirs). One
     * undo step. False when the edge is gone.
     */
    loopCutBy(cut: LoopCutCutProps, slide: TransformSavedProps | null): boolean {
        const state = this.state
        if (!state) return false
        const edge = [...state.bm.edges][cut.edgeIndex]
        if (!edge) {
            this._notice('The edge this loop cut was made from no longer exists.')
            return false
        }
        const before = this._snapshot()
        editMeshLoopCut(state.bm, edge, {numberCuts: cut.cuts, smoothness: cut.smoothness, falloff: cut.falloff, isMacro: true})
        if (slide) this._runTransform(slide)
        this._commitTopologyChange(before, CHAIN_LABELS.loopcut)
        this._afterSelectionChange()
        return true
    }

    // endregion

    // region transform settings

    /** Set the pivot point. Blender's `.` pie: median, active, individual origins, bounds, cursor. */
    setPivot(pivot: PivotType): void {
        if (pivot === this.pivot) return
        this.pivot = pivot
        this._settingsChanged()
    }

    /** Set the transform orientation. Blender's `,` pie: global, local, normal, view, cursor. */
    setOrientation(orientation: OrientationType): void {
        if (orientation === this.orientation) return
        this.orientation = orientation
        this._settingsChanged()
    }

    /** Change snapping: the magnet, the targets, the source, grid mode, what it affects. */
    setSnapping(opts: Partial<SnapSettings>): void {
        Object.assign(this.snapping, opts)
        if (opts.affect) this.snapping.affect = {...this.snapping.affect, ...opts.affect}
        this._settingsChanged()
    }

    /** Change proportional editing: on/off, falloff, size, connected, projected. */
    setProportional(opts: Partial<ProportionalSettings>): void {
        Object.assign(this.proportional, opts)
        this._settingsChanged()
    }

    /** Place the 3D cursor (world space). */
    setCursor(x: number, y: number, z: number): void {
        this.cursor[0] = x
        this.cursor[1] = y
        this.cursor[2] = z
        this._settingsChanged()
    }

    /** Show or hide the gizmo on the edit-mode selection. */
    showGizmo(show: boolean): void {
        this.gizmoVisible = show
        this._viewer?.setDirty()
    }

    private _settingsChanged(): void {
        this.dispatchEvent({type: 'transformSettingsChanged', settings: this.transformSettings})
        this._viewer?.setDirty()
    }

    // endregion

    // region object-mode transform

    /**
     * Move, rotate or scale whole objects with the same backend as the edit-mode transform: the
     * same pivot, orientation, snapping, proportional editing and keys. Objects default to the
     * picking selection. One undo step on `UndoManagerPlugin` per confirmed transform.
     */
    startObjectTransform(mode: TransformMode, opts: StartTransformOptions & {objects?: IObject3D[]} = {}): boolean {
        const viewer = this._viewer
        if (!viewer || this.isEditing) return false
        if (this._objectTransform) this.cancelObjectTransform()

        const picking = viewer.getPlugin<any>('Picking')
        const objects = (opts.objects ?? picking?.getSelectedObjects?.() ?? []).filter((o: any) => o?.isObject3D) as IObject3D[]
        if (!objects.length) {
            this._notice('Select an object to ' + (mode === 'translate' ? 'move' : mode === 'rotate' ? 'rotate' : 'scale') + ' first.', 'info')
            return false
        }
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        const targets: ObjectTransformTarget[] = objects.map(o => {
            o.updateWorldMatrix(true, false)
            return {
                id: o,
                matrixWorld: Array.from(o.matrixWorld.elements),
                parentMatrixWorld: o.parent ? Array.from(o.parent.matrixWorld.elements) : identity,
                localScale: [o.scale.x, o.scale.y, o.scale.z],
            }
        })
        this._objectTargets = objects.map(o => ({object: o, start: {position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone()}}))

        const active = (picking?.getSelectedObject?.() as IObject3D | undefined) ?? objects[0]
        active.updateWorldMatrix(true, false)
        const activeMatrix = Array.from(active.matrixWorld.elements)
        const rect = viewer.canvas.getBoundingClientRect()
        const mouse = opts.mouse ?? {x: this._pointerX, y: this._pointerY}

        const t = new TransInfo({
            mode,
            view: this._transformView(),
            mval: [mouse.x, rect.height - mouse.y],
            around: this.pivot,
            cursor: this.cursor,
            orientation: this.orientation,
            orientationSet: opts.orientation ?? null,
            customMatrix: opts.customMatrix,
            proportional: this.proportional,
            snap: this.snapping,
            snapContext: this._snapContext(null, null, new Set(objects)),
            constraint: opts.constraint,
            releaseConfirm: opts.releaseConfirm,
            objects: targets,
            objectMatrix: activeMatrix,
            activeObjectCenter: [activeMatrix[12], activeMatrix[13], activeMatrix[14]],
            onChange: tt => this._onObjectTransformChange(tt),
        })
        this._objectTransform = t
        viewer.scene.mainCamera.setInteractions(false, MeshEditPlugin.PluginType)
        this._onObjectTransformChange(t)
        this.dispatchEvent({type: 'transformChanged', transform: null})
        return true
    }

    private _onObjectTransformChange(t: TransInfo): void {
        const p = new Vector3(), q = new Quaternion(), s = new Vector3()
        for (const r of t.objectResults()) {
            const obj = r.id as IObject3D
            const rot = new Matrix4().set(
                r.rotWorld[0][0], r.rotWorld[1][0], r.rotWorld[2][0], 0,
                r.rotWorld[0][1], r.rotWorld[1][1], r.rotWorld[2][1], 0,
                r.rotWorld[0][2], r.rotWorld[1][2], r.rotWorld[2][2], 0,
                0, 0, 0, 1,
            )
            const world = new Matrix4().compose(new Vector3(r.loc[0], r.loc[1], r.loc[2]), q.setFromRotationMatrix(rot), s.set(1, 1, 1))
            const local = new Matrix4().fromArray(r.parentInv).multiply(world)
            local.decompose(p, q, s)
            obj.position.copy(p)
            obj.quaternion.copy(q)
            obj.scale.set(r.scale[0], r.scale[1], r.scale[2])
            obj.updateMatrixWorld(true)
            obj.setDirty?.({change: 'transform', frameFade: false})
        }
        this._viewer?.setDirty()
    }

    /** Finish the object transform and record its undo step. */
    confirmObjectTransform(): void {
        const t = this._objectTransform
        if (!t) return
        t.confirm()
        this._objectTransform = null
        this._endTransformInput()
        const targets = this._objectTargets
        this._objectTargets = []
        const ends = targets.map(x => ({position: x.object.position.clone(), quaternion: x.object.quaternion.clone(), scale: x.object.scale.clone()}))
        const changed = targets.some((x, i) => !x.start.position.equals(ends[i].position) || !x.start.quaternion.equals(ends[i].quaternion) || !x.start.scale.equals(ends[i].scale))
        const undoManager = this._viewer?.getPlugin<any>('UndoManagerPlugin')?.undoManager
        if (!changed || !undoManager) {
            this.dispatchEvent({type: 'transformChanged', transform: null})
            return
        }
        const apply = (states: {position: Vector3, quaternion: Quaternion, scale: Vector3}[]) => {
            targets.forEach((x, i) => {
                x.object.position.copy(states[i].position)
                x.object.quaternion.copy(states[i].quaternion)
                x.object.scale.copy(states[i].scale)
                x.object.updateMatrixWorld(true)
                x.object.setDirty?.({change: 'transform', frameFade: false})
            })
            this._viewer?.setDirty()
        }
        undoManager.record({undo: () => apply(targets.map(x => x.start)), redo: () => apply(ends)})
        this.dispatchEvent({type: 'transformChanged', transform: null})
    }

    /** Abandon the object transform, restoring every object exactly. */
    cancelObjectTransform(): void {
        const t = this._objectTransform
        if (!t) return
        t.cancel()
        this._objectTransform = null
        this._objectTargets = []
        this._endTransformInput()
        this.dispatchEvent({type: 'transformChanged', transform: null})
    }

    // endregion

    // region gizmo and overlay

    private _onObjectSelectionChanged = (): void => {
        this._viewer?.setDirty()
    }

    /** The transform that currently owns the input, in either mode. */
    private _running(): TransInfo | null {
        return this._transform?.t ?? this._objectTransform
    }

    /** Place the gizmo on the pivot each frame and draw the transform's lines. */
    private _updateWidgets(): void {
        const viewer = this._viewer
        if (!viewer || this.isDisabled()) {
            this.gizmo.visible = false
            this.overlay.visible = false
            this.loopCutPreview.visible = false
            return
        }
        const camera = viewer.scene.mainCamera as any
        const rect = viewer.canvas.getBoundingClientRect()
        const running = this._running()

        let pivot: Vec3 | null = null
        let orientation: Mat3 | null = null
        // A keyboard-started transform hides the gizmo; a gizmo drag keeps its active handle.
        const showGizmo = !running || this._gizmoDrag !== null
        if (showGizmo && this.isEditing && this.state && this.gizmoVisible) {
            const object = this.editObject!
            object.updateWorldMatrix(true, false)
            const objectMatrix = Array.from(object.matrixWorld.elements)
            pivot = selectionPivotWorld(this.state.bm, this.pivot, objectMatrix, this.cursor)
            if (pivot) {
                orientation = calcOrientationFromType(this.orientation, {
                    objectMatrix, view: this._transformView(), bm: this.state.bm, around: this.pivot,
                })
            }
        } else if (showGizmo && !this.isEditing && this.objectGizmo) {
            const picking = viewer.getPlugin<any>('Picking')
            const objects = ((picking?.getSelectedObjects?.() ?? []) as IObject3D[]).filter(o => o?.isObject3D)
            const positions: Vec3[] = objects.map(o => {
                o.updateWorldMatrix(true, false)
                const e = o.matrixWorld.elements
                return [e[12], e[13], e[14]]
            })
            const active = (picking?.getSelectedObject?.() as IObject3D | undefined) ?? objects[0]
            const activePos = active ? positions[objects.indexOf(active)] ?? positions[0] : null
            pivot = objectsPivotWorld(positions, this.pivot, activePos ?? null, this.cursor)
            if (pivot && active) {
                orientation = calcOrientationFromType(this.orientation, {
                    objectMatrix: Array.from(active.matrixWorld.elements), view: this._transformView(), around: this.pivot, objectMode: true,
                })
            }
        }
        this.gizmo.visible = !!pivot && !!orientation
        if (pivot && orientation) {
            this.gizmo.setPivot(pivot, orientation)
            this.gizmo.update(camera, rect.height)
        }

        let mouseWorld: Vec3 | null = null
        let pixelSize = 1
        if (running) {
            const view = running.view
            pixelSize = view.pixelSize(running.centerGlobal)
            // The cursor at the pivot's depth, for the helpline.
            const ndc = new Vector3(running.centerGlobal[0], running.centerGlobal[1], running.centerGlobal[2]).project(camera)
            const m = new Vector3(this._pointerX / rect.width * 2 - 1, -(this._pointerY / rect.height * 2 - 1), ndc.z).unproject(camera)
            mouseWorld = [m.x, m.y, m.z]
        }
        this.overlay.update(running, camera, mouseWorld, pixelSize)

        // `EDBM_preselect_edgering_draw`: the ring the loop cut would make; points the size of a vertex.
        const lc = this._loopCut
        const object = this.editObject
        if (lc && object && (lc.preview.edges.length || lc.preview.verts.length)) {
            object.updateWorldMatrix(true, false)
            const p = lc.preview.edges[0]?.[0] ?? lc.preview.verts[0]
            const world = new Vector3(p[0], p[1], p[2]).applyMatrix4(object.matrixWorld as never)
            const size = this._transformView().pixelSize([world.x, world.y, world.z]) * 3
            this.loopCutPreview.update(lc.preview, object.matrixWorld as never, camera, size)
        } else {
            this.loopCutPreview.update(null, null, camera, 0)
        }
    }

    // endregion

    /** Re-bake the surface once per frame while a transform runs, so the shading follows the drag. */
    private _scheduleLiveUpdate(): void {
        if (this._liveFrame) return
        this._liveFrame = requestAnimationFrame(() => {
            this._liveFrame = 0
            if (!this._transform || !this.state || !this.editObject) return
            this.state.syncFromBMesh()
            this._bakeIntoObject(this.editObject, this.state)
            this._viewer?.setDirty()
        })
    }

    // region input

    private _projectFn(): ProjectFn | null {
        const viewer = this._viewer
        const object = this.editObject
        if (!viewer || !object) return null
        const camera = viewer.scene.mainCamera
        const canvas = viewer.canvas
        const rect = canvas.getBoundingClientRect()
        const v = new Vector3()
        object.updateWorldMatrix(true, false)
        const matrixWorld = object.matrixWorld

        return (x: number, y: number, z: number) => {
            v.set(x, y, z).applyMatrix4(matrixWorld).project(camera as never)
            if (v.z > 1) return null
            return {
                x: (v.x * 0.5 + 0.5) * rect.width,
                y: (-v.y * 0.5 + 0.5) * rect.height,
                depth: v.z,
            }
        }
    }

    private _pointerX = 0
    private _pointerY = 0

    /** Cursor position in canvas CSS pixels. */
    private _canvasPos(event: {clientX: number, clientY: number}): {x: number, y: number} {
        const rect = this._viewer!.canvas.getBoundingClientRect()
        return {x: event.clientX - rect.left, y: event.clientY - rect.top}
    }

    /** The selection buffer, up to date with the mesh and the view, or null with X-ray or outside edit mode. */
    private _prepareSelect(): SelectBuffer | null {
        const state = this.state
        const viewer = this._viewer
        const object = this.editObject
        const select = this._select
        if (!state || !viewer || !object || !select) return null
        if (this._selectDirty) {
            select.update(state.bm)
            this._selectDirty = false
        }
        const rect = viewer.canvas.getBoundingClientRect()
        object.updateWorldMatrix(true, false)
        select.matrixWorld.copy(object.matrixWorld as never)
        select.setView(viewer.renderManager.renderer as any, viewer.scene.mainCamera as never, rect.width, rect.height)
        return select
    }

    /**
     * The element a click at this point means.
     *
     * Without X-ray this is Blender's `unified_findnearest` over the selection buffer: only visible
     * elements, a vertex beats an edge beats a face, 75 px reach. With X-ray it is the projected search,
     * which also sees through the surface and cycles on repeated clicks.
     */
    pickAt(x: number, y: number, cycle = false): BMVert | BMEdge | BMFace | null {
        const state = this.state
        const project = this._projectFn()
        if (!state || !project) return null

        const select = this.xray ? null : this._prepareSelect()
        if (!select) {
            return pickElement(state.bm, x, y, project, {
                maxDistance: this.pickDistance,
                xray: true,
            }, cycle ? this._cycle : undefined).element
        }
        return unifiedFindNearest(state.bm, select.elements, select, x, y, project).element
    }

    /**
     * The edge nearest the cursor whatever the select mode, as loop select needs it
     * (`edbm_select_loop_or_ring_pick` switches the mode to edges for the pick).
     */
    pickEdgeAt(x: number, y: number): BMEdge | null {
        const state = this.state
        if (!state) return null
        const bm = state.bm
        const saved = bm.selectMode
        bm.selectMode = SelectMode.Edge
        try {
            const e = this.pickAt(x, y)
            return e instanceof BMEdge ? e : null
        } finally {
            bm.selectMode = saved
        }
    }

    /**
     * `edbm_elem_find_nearest` (`editmesh_path.cc:701`): the nearest element of `src`'s kind within
     * Blender's 75 px, from the buffer, or projected with X-ray.
     */
    private _findNearestOfType(src: BMVert | BMEdge | BMFace, x: number, y: number): BMVert | BMEdge | BMFace | null {
        const state = this.state
        const project = this._projectFn()
        if (!state || !project) return null
        const bm = state.bm
        const domain: SelectDomain = src instanceof BMVert ? 'vert' : src instanceof BMEdge ? 'edge' : 'face'
        const domainMode = domain === 'vert' ? SelectMode.Vertex : domain === 'edge' ? SelectMode.Edge : SelectMode.Face
        if (!(bm.selectMode & domainMode)) return null

        const select = this.xray ? null : this._prepareSelect()
        if (select) {
            if (domain === 'face') {
                const index = select.samplePoint('face', x, y)
                return index === null ? null : select.elements.faces[index] ?? null
            }
            const found = select.findNearest(domain, x, y, SELECT_DIST_PX)
            if (!found || found.dist >= SELECT_DIST_PX) return null
            return (domain === 'vert' ? select.elements.verts[found.index] : select.elements.edges[found.index]) ?? null
        }
        const saved = bm.selectMode
        bm.selectMode = domainMode
        try {
            return pickElement(bm, x, y, project, {maxDistance: SELECT_DIST_PX, xray: true}).element
        } finally {
            bm.selectMode = saved
        }
    }

    private _setPreselect(elem: BMVert | BMEdge | BMFace | null): void {
        if (elem === this._preselect) return
        this._preselect = elem
        this._refreshFlags()
        this.dispatchEvent({type: 'preselectChanged', element: elem})
    }

    private _onPointerMove = (event: PointerEvent): void => {
        if (this.isDisabled()) return
        const {x, y} = this._canvasPos(event)
        this._pointerX = x
        this._pointerY = y
        if (this._loopCut) {
            this._loopCut.mouseMove(x, y)
            this._loopCutInput()
            return
        }
        const running = this._running()
        if (running) {
            const rect = this._viewer!.canvas.getBoundingClientRect()
            running.handleEvent({type: 'mousemove', mval: [x, rect.height - y]})
            this._viewer?.setDirty()
            return
        }
        if (this._circle) {
            this._drawCircle()
            if (this._circle.painting) this.circleSelect(x, y, this.circleRadius, this._circle.op)
            return
        }
        // The gizmo under the cursor highlights; it takes precedence over element preselection.
        if (this.gizmo.visible && event.buttons === 0) {
            const handle = this._pickGizmo(x, y)
            if (handle !== this.gizmo.hovered) {
                this.gizmo.hovered = handle
                this.dispatchEvent({type: 'gizmoHoverChanged', handle})
                this._viewer?.setDirty()
            }
            if (handle) {
                if (this.isEditing) this._setPreselect(null)
                return
            }
        }
        if (!this.isEditing) return
        // Hover: what would a click here select? Not while a button is held - that is an orbit or a drag.
        if (!this.preselectHighlight || event.buttons !== 0) return
        if (this._hoverFrame) return
        this._hoverFrame = requestAnimationFrame(() => {
            this._hoverFrame = 0
            if (!this.isEditing || this._transform || this._region || this._circle) return
            this._setPreselect(this.pickAt(this._pointerX, this._pointerY))
        })
    }

    /** A box or lasso drag carries on outside the canvas; follow it from the window. */
    private _onWindowPointerMove = (event: PointerEvent): void => {
        const press = this._press
        if (!press || this.isDisabled() || this._running() || this._circle) return
        if (!this.isEditing && !this.objectDragSelect) return
        if (!(event.buttons & 1)) return
        const {x, y} = this._canvasPos(event)
        if (!this._region) {
            if (this._dragSelect === 'none' || press.alt) return
            if (Math.abs(x - press.x) <= this.dragThreshold && Math.abs(y - press.y) <= this.dragThreshold) return
            // The modifiers at the press decide the mode, as Blender's gesture reads them at its start.
            const op = selectOpFromModifiers(press.shift, press.ctrl)
            // Objects are box-selected only; lasso is an edit-mode gesture here.
            this._region = this._dragSelect === 'lasso' && this.isEditing
                ? {kind: 'lasso', op, x0: press.x, y0: press.y, x1: x, y1: y, points: [[Math.round(press.x), Math.round(press.y)]]}
                : {kind: 'box', op, x0: press.x, y0: press.y, x1: x, y1: y, points: []}
            this._setPreselect(null)
        }
        const r = this._region
        r.x1 = x
        r.y1 = y
        if (r.kind === 'box') {
            this._regionOverlay?.box(r.x0, r.y0, r.x1, r.y1)
        } else {
            const last = r.points[r.points.length - 1]
            const px = Math.round(x)
            const py = Math.round(y)
            if (Math.abs(px - last[0]) >= 2 || Math.abs(py - last[1]) >= 2) r.points.push([px, py])
            this._regionOverlay?.lasso(r.points)
        }
        this.dispatchEvent({type: 'regionChanged', region: this.activeRegion})
    }

    private _onPointerLeave = (): void => {
        if (this.isEditing && !this._region) this._setPreselect(null)
        if (this.gizmo.hovered && !this._gizmoDrag) {
            this.gizmo.hovered = null
            this.dispatchEvent({type: 'gizmoHoverChanged', handle: null})
            this._viewer?.setDirty()
        }
    }

    /** The gizmo handle under a canvas position, or null. */
    private _pickGizmo(x: number, y: number): GizmoHandle | null {
        const viewer = this._viewer
        if (!viewer) return null
        // The gizmo follows the selection on the next render; a click right after a selection change
        // must see the current pivot, not last frame's.
        this._updateWidgets()
        if (!this.gizmo.visible) return null
        const rect = viewer.canvas.getBoundingClientRect()
        return this.gizmo.pick(x / rect.width * 2 - 1, -(y / rect.height * 2 - 1), viewer.scene.mainCamera as never)
    }

    /** A press on a gizmo handle starts the handle's transform; the release confirms it. */
    private _startGizmoDrag(handle: GizmoHandle, event: PointerEvent): void {
        const info = this.gizmo.handleInfo(handle)
        // The gizmo is built from the scene orientation, so an axis handle constrains in that space
        // (Blender passes the gizmo matrix as `orient_matrix` with the scene's `orient_matrix_type`).
        const opts: StartTransformOptions = {
            constraint: info.constraint || undefined,
            orientation: info.constraint ? this.orientation : undefined,
            releaseConfirm: true,
            mouse: this._canvasPos(event),
        }
        const ok = this.isEditing ? this.startTransform(info.mode, opts) : this.startObjectTransform(info.mode, opts)
        if (!ok) return
        this._gizmoDrag = handle
        this.gizmo.active = handle
        event.preventDefault()
    }

    private _onPointerDown = (event: PointerEvent): void => {
        if (this.isDisabled()) return
        if (this._loopCut) {
            const {x, y} = this._canvasPos(event)
            this._pointerX = x
            this._pointerY = y
            this._loopCut.pointerDown(event.button)
            // The modal took the press: nothing else on the canvas (the shell's right-click menu) acts on it.
            event.preventDefault()
            event.stopImmediatePropagation()
            this._loopCutInput()
            return
        }
        // A press confirms or cancels a running transform rather than changing the selection; the
        // middle button picks the axis the mouse moves along (Blender's MMB), with Shift a plane.
        const running = this._running()
        if (running) {
            if (event.button === 0) {
                if (this._gizmoDrag) return
                if (this._transform) this.confirmTransform()
                else this.confirmObjectTransform()
                event.stopImmediatePropagation()
            } else if (event.button === 2) {
                if (this._transform) this.cancelTransform()
                else this.cancelObjectTransform()
                // The cancel is the press's whole meaning: no right-click menu from the shell as well.
                event.stopImmediatePropagation()
            } else if (event.button === 1) {
                running.handleEvent({type: 'modal', item: event.shiftKey ? 'autoConstraintPlane' : 'autoConstraint'})
                event.preventDefault()
            }
            return
        }
        if (this._circle) {
            if (event.button === 0 || event.button === 1) {
                // Left paints a selection, middle (or Shift+left) a deselection.
                this._circle.op = event.button === 1 || event.shiftKey ? 'sub' : 'add'
                this._circle.painting = true
                const {x, y} = this._canvasPos(event)
                this.circleSelect(x, y, this.circleRadius, this._circle.op)
                event.preventDefault()
            } else if (event.button === 2) {
                this.endCircleSelect()
            }
            return
        }
        if (event.button !== 0) return
        if (this.gizmo.visible) {
            const handle = this._pickGizmo(this._canvasPos(event).x, this._canvasPos(event).y)
            if (handle) {
                this._startGizmoDrag(handle, event)
                return
            }
        }
        if (!this.isEditing) {
            // Object mode: remember the press, so a drag can become an object box select.
            if (this.objectDragSelect && this._dragSelect !== 'none') {
                const p = this._canvasPos(event)
                this._press = {x: p.x, y: p.y, shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey}
            }
            return
        }
        // Selection waits for the release: a press that turns into a drag is a box select, or an orbit.
        const {x, y} = this._canvasPos(event)
        this._press = {x, y, shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey}
    }

    private _onPointerUp = (event: PointerEvent): void => {
        const releaseConfirm = !!(this._running() && this._running()!.flag & T_RELEASE_CONFIRM)
        if ((this._gizmoDrag || releaseConfirm) && event.button === 0) {
            // A gizmo drag, or a transform started with `release_confirm` (the Loop Cut tool's slide),
            // confirms on release.
            if (this._transform) this.confirmTransform()
            else if (this._objectTransform) this.confirmObjectTransform()
            return
        }
        if (this._running() && event.button === 1) {
            this._running()!.handleEvent({type: 'modal', item: event.shiftKey ? 'autoConstraintPlane' : 'autoConstraint'})
            return
        }
        const press = this._press
        this._press = null
        if (!this.isEditing && this._region && !this.isDisabled()) {
            // Object mode box select. This runs after the object picker's own click handling on the
            // canvas, so its result is what stays.
            if (event.button === 0) this._endRegion(true)
            return
        }
        if (!this.isEditing || this.isDisabled()) return
        if (this._circle) {
            this._circle.painting = false
            return
        }
        if (this._region) {
            if (event.button === 0) this._endRegion(true)
            return
        }
        if (!press || this._transform || event.button !== 0) return
        const {x, y} = this._canvasPos(event)
        if (Math.abs(x - press.x) > this.dragThreshold || Math.abs(y - press.y) > this.dragThreshold) return

        const shift = event.shiftKey
        const ctrl = event.ctrlKey || event.metaKey
        const alt = event.altKey

        // Blender's click variants: Alt is a loop (Ctrl+Alt a ring, Shift toggles it), Ctrl is the
        // shortest path from the active element, Shift toggles the element.
        if (alt) {
            this.selectLoop(x, y, {ring: ctrl, toggle: shift})
            return
        }
        if (ctrl) {
            this.selectShortestPath(x, y)
            return
        }
        const elem = this.pickAt(x, y, true)
        // Clicking empty space deselects everything (Blender's `deselect_all` on click); Shift-clicking
        // empty space leaves the selection alone.
        if (!elem && shift) return
        this.selectElement(elem, shift)
    }

    /** Double-click a mesh to edit it, the way a Figma user drills into a group. */
    private _onDoubleClick = (event: MouseEvent): void => {
        if (this.isDisabled() || this.isEditing || event.button !== 0) return
        const picked = this._selectedMesh()
        if (picked) this.enter(picked)
    }

    /**
     * The wheel resizes the proportional editing circle during a transform (Blender's
     * `PROPORTIONAL_SIZE_UP/DOWN`) and the brush while circle select runs; otherwise it zooms as usual.
     */
    private _onWheel = (event: WheelEvent): void => {
        if (this.isDisabled()) return
        if (this._loopCut) {
            event.preventDefault()
            event.stopImmediatePropagation()
            this._loopCut.wheel(event.deltaY < 0, event.altKey)
            this._loopCutInput()
            return
        }
        const running = this._running()
        if (running) {
            event.preventDefault()
            if (running.handleEvent({type: 'modal', item: event.deltaY > 0 ? 'propsizeUp' : 'propsizeDown'})) this._viewer?.setDirty()
            return
        }
        if (!this._circle) return
        event.preventDefault()
        event.stopImmediatePropagation()
        // Blender steps the gesture radius by a fixed amount per wheel click.
        this.circleRadius = Math.max(1, this.circleRadius + (event.deltaY < 0 ? 5 : -5))
        this._drawCircle()
    }

    /** The right button ends circle select rather than opening the browser's menu. */
    private _onContextMenu = (event: MouseEvent): void => {
        // The right button cancels a loop cut or a transform, not a menu.
        if (this._circle || this._loopCut || this._running()) event.preventDefault()
    }

    /** Keys typed into a form control belong to it, not to the viewport. */
    private _isTypingTarget(target: EventTarget | null): boolean {
        const el = target as HTMLElement | null
        if (!el || !el.tagName) return false
        const tag = el.tagName
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || el.isContentEditable
    }

    /** A DOM key event as the transform's modal keymap reads it. */
    private _modalKey(event: KeyboardEvent, press: boolean): ModalKeyEvent {
        return {code: event.code, key: event.key, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey, press, repeat: event.repeat}
    }

    /** A running transform owns the keyboard, exactly as in Blender. Returns true when it took the key. */
    private _transformKey(event: KeyboardEvent, press: boolean): boolean {
        if (this._loopCut) {
            // Every key is the loop cut modal's (`loopcut_modal` returns `RUNNING_MODAL`).
            this._loopCut.key(this._modalKey(event, press))
            event.preventDefault()
            this._loopCutInput()
            return true
        }
        const running = this._running()
        if (!running) return false
        const consumed = running.handleEvent({type: 'key', event: this._modalKey(event, press)})
        if (running.state === 'confirm') {
            if (this._transform) this.confirmTransform()
            else this.confirmObjectTransform()
        } else if (running.state === 'cancel') {
            if (this._transform) this.cancelTransform()
            else this.cancelObjectTransform()
        } else if (consumed) {
            this._viewer?.setDirty()
        }
        // Tab belongs to the numeric input while a transform runs; it must not toggle edit mode.
        if (consumed || event.code === 'Tab') event.preventDefault()
        return true
    }

    private _onKeyUp = (event: KeyboardEvent): void => {
        if (event.key === 'Alt' && this._altHeld) {
            this._altHeld = false
            this._applyOrbitButtons()
        }
        if (this.isDisabled() || this._isTypingTarget(event.target)) return
        this._transformKey(event, false)
    }

    /**
     * Forward a key to the running transform, for an input router outside this plugin that owns the
     * keymap ({@link keyHandling} off). The transform's own modal keymap decides what it means, exactly
     * as when this plugin listens itself. Returns true when a transform is running and took the key.
     */
    handleModalKey(event: KeyboardEvent, press = true): boolean {
        if (!this._running() && !this._loopCut) return false
        return this._transformKey(event, press)
    }

    private _onKeyDown = (event: KeyboardEvent): void => {
        if (this.isDisabled() || !this.keyHandling) return
        if (this._isTypingTarget(event.target)) return

        // Alt held makes the left button orbit (Blender's "emulate 3 button mouse"), since the plain
        // left drag is the box select.
        if (event.key === 'Alt' && !this._altHeld) {
            this._altHeld = true
            this._applyOrbitButtons()
        }
        if (this._transformKey(event, true)) return

        // Tab toggles edit mode whether or not we are in it. Only when focus is not on a control, so
        // keyboard navigation of the rest of the page still works.
        if (event.code === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.repeat) return
            event.preventDefault()
            this.toggle()
            return
        }
        if (!this.isEditing) return

        // So does circle select: the keys that end it, and nothing else.
        if (this._circle) {
            if (event.code === 'Escape' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'KeyC') {
                this.endCircleSelect()
                event.preventDefault()
            }
            return
        }

        const modeKey = event.code === 'Digit1' ? SelectMode.Vertex
            : event.code === 'Digit2' ? SelectMode.Edge
                : event.code === 'Digit3' ? SelectMode.Face : 0

        if (event.ctrlKey || event.metaKey) {
            switch (event.code) {
            case 'KeyI':
                this.invertSelection()
                break
            case 'KeyL':
                this.selectLinked()
                break
            case 'NumpadAdd':
            case 'Equal':
                this.selectMore()
                break
            case 'NumpadSubtract':
            case 'Minus':
                this.selectLess()
                break
            case 'Digit1':
            case 'Digit2':
            case 'Digit3':
                // Ctrl expands the selection on the way up the modes.
                this.toggleSelectMode(modeKey, {extend: event.shiftKey, expand: true})
                break
            default:
                return
            }
            event.preventDefault()
            return
        }

        switch (event.code) {
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
            // Shift combines modes.
            this.toggleSelectMode(modeKey, {extend: event.shiftKey})
            break
        case 'KeyA':
            if (event.altKey) this.deselectAllElements()
            else this.selectAllElements()
            break
        case 'KeyL':
            // Linked under the cursor; Shift+L deselects it.
            this.selectLinkedPick(this._pointerX, this._pointerY, {deselect: event.shiftKey})
            break
        case 'KeyB':
            this.dragSelect = 'box'
            this._notice('Drag to box select. Shift adds, Ctrl subtracts.', 'info')
            break
        case 'KeyC':
            this.startCircleSelect()
            break
        case 'KeyH':
            if (event.altKey) this.revealHidden()
            else this.hideSelected(event.shiftKey)
            break
        case 'KeyZ':
            if (!event.altKey) return
            this.xray = !this.xray
            break
        case 'KeyG':
            this.startTransform('translate')
            break
        case 'KeyR':
            this.startTransform('rotate')
            break
        case 'KeyS':
            this.startTransform('resize')
            break
        case 'KeyE':
            this.extrude()
            break
        case 'KeyD':
            if (event.shiftKey) this.duplicate()
            else return
            break
        case 'KeyY':
            this.split()
            break
        case 'KeyM':
            this.merge()
            break
        case 'KeyX':
        case 'Delete':
        case 'Backspace':
            // Face mode deletes faces, edge mode edges, vertex mode vertices - which is the
            // sensible default for each; the full context menu comes with the operator UI.
            this.deleteSelected(
                this.selectMode & SelectMode.Face ? 'faces'
                    : this.selectMode & SelectMode.Edge ? 'edges' : 'verts')
            break
        case 'Escape':
            // Esc ends a box or lasso drag; outside a modal it does nothing, as in Blender: it must
            // never throw away a session.
            if (this._region) {
                this._endRegion(false)
                this._press = null
                break
            }
            return
        default:
            return
        }
        event.preventDefault()
    }

    // endregion
}
