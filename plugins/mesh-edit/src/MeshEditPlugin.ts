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
} from 'threepipe'
import {
    BMEdge,
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
} from '@threepipe/mesh-kernel'
import {Matrix4} from 'threepipe'
import {EditMeshState} from './EditMeshState'
import {ModalTransform, TransformMode} from './transform'
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
import {SelectOp, selectOpFromModifiers} from './select/selectOp'
import {LassoPoint, lassoBoundBox, ScreenRect} from './select/lasso'
import {regionSelect, RegionShape, RegionVisibility} from './select/regionSelect'
import {RegionOverlay} from './select/regionOverlay'
import {selectModeToggleMulti} from './select/selectMode'
import {LoopDelimit, loopSelectEdge, LoopSelectParams} from './select/loopSelect'
import {activeElemOrFace, PathSelectParams, shortestPathPick} from './select/path'
import {selectLess, selectMore} from './select/moreLess'
import {meshHide, meshReveal} from './select/hide'
import {LinkedDelimit, linkedDelimitDefault, selectLinkedAll, selectLinkedPick} from './select/linked'

export interface MeshEditPluginEventMap extends AViewerPluginEventMap {
    /** Edit mode entered or left. */
    editModeChanged: {object: IObject3D | null}
    /** The element selection changed. Distinct from the viewer's object-level `selectedObjectChanged`. */
    elementSelectionChanged: {state: EditMeshState}
    /** The mesh topology or positions changed. */
    meshChanged: {state: EditMeshState}
    /** A modal transform started, updated or finished. Null when it ended. */
    transformChanged: {transform: ModalTransform | null}
    /** The element under the cursor changed: what a click would select. Null when nothing is. */
    preselectChanged: {element: BMVert | BMEdge | BMFace | null}
    /** Something the user tried could not be done. Show it; it used to go to the console only. */
    notice: {message: string, level: 'info' | 'warning'}
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
    private _chained = false

    get isEditing(): boolean {
        return this.state !== null
    }

    /** The running modal transform, if any. While this is set, input belongs to it. */
    get activeTransform(): ModalTransform | null {
        return this._transform
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
        super.onRemove(viewer)
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

        // Suspending the picker cleared the object selection; leave the edited object selected.
        viewer?.getPlugin<any>('Picking')?.setSelectedObject?.(object)

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
            const g = this._edgeLines.geometry as LineSegmentsGeometry
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
            if (r.kind === 'box') this.boxSelect({x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1}, r.op)
            else this.lassoSelect(r.points, r.op)
        }
        this.dispatchEvent({type: 'regionChanged', region: null})
    }

    // endregion

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
        this._commitTopologyChange(before)
        this.dispatchEvent({type: 'elementSelectionChanged', state})
        return true
    }

    /** Show every hidden element, selecting what comes back. Blender's `Alt+H`. */
    revealHidden(select = true): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        if (!meshReveal(state.bm, select)) return false
        this._commitTopologyChange(before)
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

        // Chain into a move constrained to the region's normal, which is what makes `E` push a face
        // straight out of the surface however it is oriented. An axis key overrides it. The undo step
        // covers both, and is recorded when the move ends - confirmed or cancelled, the extrusion stays.
        this.startTransform('translate', before)
        if (normal && this._transform) this._transform.setCustomAxis(normal)
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
        this.startTransform('translate', before)
        return true
    }

    /** Split the selection away from the rest of the mesh. Blender's `Y`. */
    split(): boolean {
        const state = this.state
        if (!state) return false
        const before = this._snapshot()
        if (!splitSelection(state.bm)) return false
        this._commitTopologyChange(before)
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
        this._commitTopologyChange(before)
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
        this._commitTopologyChange(before)
        return true
    }

    private _commitTopologyChange(before: MeshData): void {
        const state = this.state!
        state.syncFromBMesh()
        this.applyToObject()
        this.refreshOverlays()
        this.dispatchEvent({type: 'meshChanged', state})
        this._recordUndo(before)
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
    private _recordUndo(before: MeshData): void {
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
        undoManager.record({
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
     * cancelled with Escape. Axis keys and typed numbers refine it while it runs.
     */
    startTransform(mode: TransformMode, undoBefore?: MeshData): boolean {
        const viewer = this._viewer
        const state = this.state
        if (!viewer || !state) return false
        if (this._transform) this._transform.cancel()

        const camera = viewer.scene.mainCamera
        const object = this.editObject!
        object.updateWorldMatrix(true, false)

        // Camera basis expressed in the object's local space, so screen motion maps into the mesh
        // regardless of how the object is transformed.
        const toLocal = new Matrix4().copy(object.matrixWorld as never).invert()
        const camMatrix = new Matrix4().copy(camera.matrixWorld as never).premultiply(toLocal)
        const right: [number, number, number] = [camMatrix.elements[0], camMatrix.elements[1], camMatrix.elements[2]]
        const up: [number, number, number] = [camMatrix.elements[4], camMatrix.elements[5], camMatrix.elements[6]]
        const forward: [number, number, number] = [camMatrix.elements[8], camMatrix.elements[9], camMatrix.elements[10]]

        const rect = viewer.canvas.getBoundingClientRect()
        const unitsPerPixel = this._unitsPerPixel(rect.height)

        const transform = new ModalTransform(state.bm, {
            mode,
            startX: this._pointerX,
            startY: this._pointerY,
            unitsPerPixel,
            cameraRight: right,
            cameraUp: up,
            cameraForward: forward,
        })

        if (transform.isEmpty) {
            this._notice('Select something to ' + (mode === 'translate' ? 'move' : mode === 'rotate' ? 'rotate' : 'scale') + ' first.')
            // An extrude or duplicate that chained into this still happened; keep its undo step.
            if (undoBefore) this._recordUndo(undoBefore)
            return false
        }
        this._transform = transform
        this._undoBefore = undoBefore ?? this._snapshot()
        this._chained = !!undoBefore
        this._setPreselect(null)
        this.dispatchEvent({type: 'transformChanged', transform})
        return true
    }

    /**
     * World units per screen pixel at the selection's depth, so drags feel consistent at any zoom.
     * Measured at the selection's centre, not the object's origin, so a selection far from the origin
     * of a large object moves at the speed the cursor does.
     */
    private _unitsPerPixel(canvasHeight: number): number {
        const viewer = this._viewer!
        const camera = viewer.scene.mainCamera as any
        const object = this.editObject!
        const centre = this._selectionCentre() ?? new Vector3()
        const cw = centre.applyMatrix4(object.matrixWorld as never)
        const cp = new Vector3().setFromMatrixPosition(camera.matrixWorld)
        if (camera.isOrthographicCamera) {
            return (camera.top - camera.bottom) / (camera.zoom || 1) / Math.max(1, canvasHeight)
        }
        const dist = Math.max(0.001, cw.distanceTo(cp))
        const fov = (camera.fov ?? 45) * Math.PI / 180
        return (2 * Math.tan(fov / 2) * dist) / Math.max(1, canvasHeight)
    }

    /** Median point of the selected vertices, in the object's space. */
    private _selectionCentre(): Vector3 | null {
        const bm = this.state?.bm
        if (!bm) return null
        let x = 0, y = 0, z = 0, n = 0
        for (const v of bm.verts) {
            if (!(v.hflag & ElemFlag.Select)) continue
            x += v.x
            y += v.y
            z += v.z
            n++
        }
        return n ? new Vector3(x / n, y / n, z / n) : null
    }

    /** Finish the running transform, keeping the result. */
    confirmTransform(): void {
        if (!this._transform || !this.state) return
        this._transform.confirm()
        this._transform = null
        cancelAnimationFrame(this._liveFrame)
        this.state.syncFromBMesh()
        this.applyToObject()
        this.refreshOverlays()
        this.dispatchEvent({type: 'transformChanged', transform: null})
        const before = this._undoBefore
        this._undoBefore = null
        this._chained = false
        if (before) this._recordUndo(before)
    }

    /**
     * Abandon the running transform, restoring the starting positions exactly. If it was chained from an
     * extrude or duplicate, that part stays - as in Blender - and is still one undo step.
     */
    cancelTransform(): void {
        if (!this._transform) return
        this._transform.cancel()
        this._transform = null
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
        this._chained = false
        // A plain move that was cancelled changed nothing; an extrude or duplicate underneath it did.
        if (before && chained) this._recordUndo(before)
    }

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

    // endregion

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
        if (!this.isEditing || this.isDisabled()) return
        const {x, y} = this._canvasPos(event)
        this._pointerX = x
        this._pointerY = y
        if (this._transform) {
            this._transform.setMousePosition(x, y)
            this._refreshOverlayPositions()
            this._scheduleLiveUpdate()
            this.dispatchEvent({type: 'transformChanged', transform: this._transform})
            return
        }
        if (this._circle) {
            this._drawCircle()
            if (this._circle.painting) this.circleSelect(x, y, this.circleRadius, this._circle.op)
            return
        }
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
        if (!press || !this.isEditing || this.isDisabled() || this._transform || this._circle) return
        if (!(event.buttons & 1)) return
        const {x, y} = this._canvasPos(event)
        if (!this._region) {
            if (this._dragSelect === 'none' || press.alt) return
            if (Math.abs(x - press.x) <= this.dragThreshold && Math.abs(y - press.y) <= this.dragThreshold) return
            // The modifiers at the press decide the mode, as Blender's gesture reads them at its start.
            const op = selectOpFromModifiers(press.shift, press.ctrl)
            this._region = this._dragSelect === 'lasso'
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
    }

    private _onPointerDown = (event: PointerEvent): void => {
        if (!this.isEditing || this.isDisabled()) return
        // A press confirms or cancels a running transform rather than changing the selection. The
        // middle button stays free for navigating mid-transform, as in Blender.
        if (this._transform) {
            if (event.button === 0) this.confirmTransform()
            else if (event.button === 2) this.cancelTransform()
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
        // Selection waits for the release: a press that turns into a drag is a box select, or an orbit.
        const {x, y} = this._canvasPos(event)
        this._press = {x, y, shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey}
    }

    private _onPointerUp = (event: PointerEvent): void => {
        const press = this._press
        this._press = null
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

    /** The wheel resizes the circle while circle select runs; otherwise it zooms as usual. */
    private _onWheel = (event: WheelEvent): void => {
        if (!this._circle || this.isDisabled()) return
        event.preventDefault()
        event.stopImmediatePropagation()
        // Blender steps the gesture radius by a fixed amount per wheel click.
        this.circleRadius = Math.max(1, this.circleRadius + (event.deltaY < 0 ? 5 : -5))
        this._drawCircle()
    }

    /** The right button ends circle select rather than opening the browser's menu. */
    private _onContextMenu = (event: MouseEvent): void => {
        if (this._circle) event.preventDefault()
    }

    /** Keys typed into a form control belong to it, not to the viewport. */
    private _isTypingTarget(target: EventTarget | null): boolean {
        const el = target as HTMLElement | null
        if (!el || !el.tagName) return false
        const tag = el.tagName
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || el.isContentEditable
    }

    private _onKeyUp = (event: KeyboardEvent): void => {
        if (event.key === 'Alt' && this._altHeld) {
            this._altHeld = false
            this._applyOrbitButtons()
        }
    }

    private _onKeyDown = (event: KeyboardEvent): void => {
        if (this.isDisabled()) return
        if (this._isTypingTarget(event.target)) return

        // Alt held makes the left button orbit (Blender's "emulate 3 button mouse"), since the plain
        // left drag is the box select.
        if (event.key === 'Alt' && !this._altHeld) {
            this._altHeld = true
            this._applyOrbitButtons()
        }

        // Tab toggles edit mode whether or not we are in it. Only when focus is not on a control, so
        // keyboard navigation of the rest of the page still works.
        if (event.code === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.repeat) return
            event.preventDefault()
            this.toggle()
            return
        }
        if (!this.isEditing) return

        // A running transform owns the keyboard, exactly as in Blender.
        if (this._transform) {
            const t = this._transform
            if (event.code === 'Escape') {
                this.cancelTransform()
            } else if (event.code === 'Enter' || event.code === 'NumpadEnter') {
                this.confirmTransform()
            } else if (event.code === 'KeyX') {
                t.setAxis(0, event.shiftKey)
            } else if (event.code === 'KeyY') {
                t.setAxis(1, event.shiftKey)
            } else if (event.code === 'KeyZ') {
                t.setAxis(2, event.shiftKey)
            } else if (event.code === 'KeyC') {
                t.clearConstraint()
            } else if (t.handleNumericKey(event.key)) {
                // consumed by the numeric buffer
            } else {
                return
            }
            t.precision = event.shiftKey
            this._refreshOverlayPositions()
            this.dispatchEvent({type: 'transformChanged', transform: this._transform})
            event.preventDefault()
            return
        }

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
