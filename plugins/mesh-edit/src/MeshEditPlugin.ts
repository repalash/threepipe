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
    IObject3D,
    LineSegments,
    Mesh2,
    Object3D2,
    Points,
    ShaderMaterial,
    ThreeViewer,
    UnlitMaterial,
    Vector3,
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
    selectModeSet,
    selectNone,
    vertSelectSet,
    walkVertShell,
    extrudeSelection,
    averageFaceNormal,
    duplicateSelection,
    splitSelection,
    deleteSelection,
    mergeSelectedVerts,
    DeleteContext,
    bmToMesh,
} from '@threepipe/mesh-kernel'
import {Matrix4, Quaternion} from 'threepipe'
import {EditMeshState} from './EditMeshState'
import {ModalTransform, TransformMode} from './transform'
import {buildEdgeOverlay, buildFaceOverlay, buildVertexOverlay} from './overlays'
import {PickCycleState, pickElement, ProjectFn} from './picking'
import {createEdgeMaterial, createVertexMaterial, EditTheme, setOverlayPixelRatio} from './overlayMaterials'
import {SelectBuffer} from './select/SelectBuffer'
import {unifiedFindNearest} from './select/findNearest'
import {TransformView} from './transform/view'
import {ObjectTransformTarget, ProportionalSettings, SnapSettings, TransInfo} from './transform/TransInfo'
import {CON_AXIS2, OrientationType, PivotType} from './transform/types'
import type {Mat3, Mat4, Vec3} from './transform/math'
import {calcOrientationFromType} from './transform/orientation'
import {objectsPivotWorld, selectionPivotWorld} from './transform/pivot'
import {SnapContext} from './snap/snap'
import {snapTargetFromBMesh, snapTargetFromGeometry} from './snap/targets'
import {GizmoHandle, TransformGizmo} from './gizmo/TransformGizmo'
import {TransformOverlay} from './gizmo/TransformOverlay'
import type {ModalKeyEvent} from './transform/keymap'

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
    /** The element under the cursor changed: what a click would select. Null when nothing is. */
    preselectChanged: {element: BMVert | BMEdge | BMFace | null}
    /** Something the user tried could not be done. Show it; it used to go to the console only. */
    notice: {message: string, level: 'info' | 'warning'}
    /** Pivot, orientation, snapping or proportional settings changed. */
    transformSettingsChanged: {settings: TransformSettings}
    /** The gizmo handle under the cursor changed. */
    gizmoHoverChanged: {handle: GizmoHandle | null}
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
        for (const obj of [this._vertPoints, this._edgeLines, this._faceHighlight, this._facePreselect]) {
            const material = obj?.material as any
            if (!material) continue
            material.depthTest = !value
            material.needsUpdate = true
        }
        this._preselect = null
        this._refreshFlags()
    }

    private _xray = false

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
    private _edgeLines: LineSegments | null = null
    private _faceHighlight: Mesh2 | null = null
    private _facePreselect: Mesh2 | null = null
    private _cycle = new PickCycleState()
    private _transform: ModalTransform | null = null
    private _select: SelectBuffer | null = null
    private _selectDirty = true
    private _preselect: BMVert | BMEdge | BMFace | null = null
    private _press: {x: number, y: number} | null = null
    private _hoverFrame = 0
    private _liveFrame = 0
    /** The mesh as it was before the running operation, for its undo step. */
    private _undoBefore: MeshData | null = null
    /** The running transform follows a topology change (extrude, duplicate) that must stay undoable. */
    private _chained = false

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

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        window.addEventListener('keydown', this._onKeyDown)
        window.addEventListener('keyup', this._onKeyUp)
        viewer.canvas.addEventListener('pointerdown', this._onPointerDown)
        viewer.canvas.addEventListener('pointermove', this._onPointerMove)
        viewer.canvas.addEventListener('pointerleave', this._onPointerLeave)
        viewer.canvas.addEventListener('dblclick', this._onDoubleClick)
        viewer.canvas.addEventListener('wheel', this._onWheel, {passive: false})
        // Release can happen outside the canvas; listen where it will arrive.
        window.addEventListener('pointerup', this._onPointerUp)
        // The rotation rings are clipped to their front half with a clipping plane.
        ;(viewer.renderManager.renderer as any).localClippingEnabled = true
        viewer.scene.addObject(this.gizmo as never, {addToRoot: true})
        viewer.scene.addObject(this.overlay as never, {addToRoot: true})
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
        window.removeEventListener('pointerup', this._onPointerUp)
        if (this.isEditing) this.exit(false)
        if (this._objectTransform) this.cancelObjectTransform()
        viewer.scene.remove(this.gizmo as never)
        viewer.scene.remove(this.overlay as never)
        this.gizmo.dispose()
        this.overlay.dispose()
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
        this._selectDirty = true
        this._preselect = null

        this._suspendObjectModePlugins(true)
        this._buildOverlays()
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
        if (commit) this.applyToObject()
        this._destroyOverlays()
        this._select?.dispose()
        this._select = null
        this._preselect = null
        this._press = null
        cancelAnimationFrame(this._hoverFrame)
        cancelAnimationFrame(this._liveFrame)
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

    /** Bake the current topology into the edited object's geometry without leaving edit mode. */
    applyToObject(): void {
        if (!this.state || !this.editObject) return
        this.state.syncFromBMesh()
        this._bakeIntoObject(this.editObject, this.state)

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
    private _bakeIntoObject(object: IObject3D, state: EditMeshState): void {
        const {data} = state.bake()
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

        const edgeMaterial = createEdgeMaterial()
        edgeMaterial.depthTest = !this.xray
        this._edgeLines = new LineSegments(new BufferGeometry2(), edgeMaterial)
        this._edgeLines.renderOrder = 99
        this._edgeLines.frustumCulled = false

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

        root.add(this._vertPoints as never, this._edgeLines as never, this._faceHighlight as never,
            this._facePreselect as never)
        // Overlays live in the edited object's space, so they follow its transform for free.
        this.editObject.add(root as never)

        this.refreshOverlays()
    }

    private _destroyOverlays(): void {
        for (const obj of [this._vertPoints, this._edgeLines, this._faceHighlight, this._facePreselect]) {
            obj?.geometry?.dispose?.()
            ;(obj?.material as any)?.dispose?.()
        }
        this._root?.removeFromParent()
        this._root = null
        this._vertPoints = null
        this._edgeLines = null
        this._faceHighlight = null
        this._facePreselect = null
    }

    /** Rebuild every overlay buffer from the current BMesh. Call after positions or topology changed. */
    refreshOverlays(): void {
        if (!this.state) return
        // Elements may have moved, appeared or gone; the selection buffer is rebuilt before the next pick.
        this._selectDirty = true
        // A pre-selected element may no longer exist.
        if (this._preselect && !this._elementAlive(this._preselect)) this._preselect = null
        this._refreshFlags()
    }

    /** Redraw selection, active and hover state. Positions are re-read too; this is cheap per frame. */
    private _refreshFlags(): void {
        if (!this.state) return
        const bm = this.state.bm
        const active = bm.selectHistory.length
            ? bm.selectHistory[bm.selectHistory.length - 1].elem : undefined
        const pre = this.preselectHighlight ? this._preselect ?? undefined : undefined

        const showVerts = (bm.selectMode & SelectMode.Vertex) !== 0

        if (this._vertPoints) {
            this._vertPoints.visible = showVerts
            if (showVerts) {
                const data = buildVertexOverlay(bm, active, pre)
                const g = this._vertPoints.geometry
                g.setAttribute('position', new BufferAttribute(data.position, 3))
                g.setAttribute('aFlag', new BufferAttribute(data.flag, 1))
                g.computeBoundingSphere()
                setOverlayPixelRatio(this._vertPoints.material as ShaderMaterial, this._pixelRatio())
            }
        }

        if (this._edgeLines) {
            const data = buildEdgeOverlay(bm, active, pre)
            const g = this._edgeLines.geometry
            g.setAttribute('position', new BufferAttribute(data.position, 3))
            g.setAttribute('aFlag', new BufferAttribute(data.flag, 1))
            g.computeBoundingSphere()
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
        this._afterSelectionChange()
    }

    setSelectMode(mode: SelectModeMask): void {
        if (!this.state) return
        selectModeSet(this.state.bm, mode)
        this._preselect = null
        this._refreshFlags()
        this.dispatchEvent({type: 'elementSelectionChanged', state: this.state})
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

    /** Select everything connected to the current selection. Blender's `L`. */
    selectLinked(): void {
        const state = this.state
        if (!state) return
        const bm = state.bm
        const seeds = [...bm.verts].filter(v => v.hflag & ElemFlag.Select)
        for (const seed of seeds) {
            for (const v of walkVertShell(seed)) vertSelectSet(bm, v, true)
        }
        this._afterSelectionChange()
    }

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
        if (normal) this.startTransform('translate', {undoBefore: before, orientation: 'normal', constraint: CON_AXIS2})
        else this.startTransform('translate', {undoBefore: before})
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
        this.startTransform('translate', {undoBefore: before})
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
            bm: state.bm,
            objectMatrix,
            onChange: t => this._onTransformChange(t),
        })

        if (transform.isEmpty) {
            this._notice('Select something to ' + (mode === 'translate' ? 'move' : mode === 'rotate' ? 'rotate' : 'scale') + ' first.')
            // An extrude or duplicate that chained into this still happened; keep its undo step.
            if (opts.undoBefore) this._recordUndo(opts.undoBefore)
            return false
        }
        this._transform = transform
        this._undoBefore = opts.undoBefore ?? this._snapshot()
        this._chained = !!opts.undoBefore
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
        this._refreshFlags()
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
        this._transform.confirm()
        this._transform = null
        this._endTransformInput()
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
        this._chained = false
        // A plain move that was cancelled changed nothing; an extrude or duplicate underneath it did.
        if (before && chained) this._recordUndo(before)
    }

    /** Give the pointer back to the camera and the gizmo its handles. */
    private _endTransformInput(): void {
        this._gizmoDrag = null
        this.gizmo.active = null
        this._viewer?.scene.mainCamera.setInteractions(true, MeshEditPlugin.PluginType)
        this._viewer?.setDirty()
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

    /**
     * The element a click at this point means.
     *
     * Without X-ray this is Blender's `unified_findnearest` over the selection buffer: only visible
     * elements, a vertex beats an edge beats a face, 75 px reach. With X-ray it is the projected search,
     * which also sees through the surface and cycles on repeated clicks.
     */
    pickAt(x: number, y: number, cycle = false): BMVert | BMEdge | BMFace | null {
        const state = this.state
        const viewer = this._viewer
        const object = this.editObject
        const project = this._projectFn()
        if (!state || !viewer || !object || !project) return null

        if (this.xray || !this._select) {
            return pickElement(state.bm, x, y, project, {
                maxDistance: this.pickDistance,
                xray: true,
            }, cycle ? this._cycle : undefined).element
        }

        const select = this._select
        if (this._selectDirty) {
            select.update(state.bm)
            this._selectDirty = false
        }
        const rect = viewer.canvas.getBoundingClientRect()
        object.updateWorldMatrix(true, false)
        select.matrixWorld.copy(object.matrixWorld as never)
        select.setView(viewer.renderManager.renderer as any, viewer.scene.mainCamera as never, rect.width, rect.height)
        return unifiedFindNearest(state.bm, select.elements, select, x, y, project).element
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
        const running = this._running()
        if (running) {
            const rect = this._viewer!.canvas.getBoundingClientRect()
            running.handleEvent({type: 'mousemove', mval: [x, rect.height - y]})
            this._viewer?.setDirty()
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
            if (!this.isEditing || this._transform) return
            this._setPreselect(this.pickAt(this._pointerX, this._pointerY))
        })
    }

    private _onPointerLeave = (): void => {
        if (this.isEditing) this._setPreselect(null)
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
        // A press confirms or cancels a running transform rather than changing the selection; the
        // middle button picks the axis the mouse moves along (Blender's MMB), with Shift a plane.
        const running = this._running()
        if (running) {
            if (event.button === 0) {
                if (this._gizmoDrag) return
                if (this._transform) this.confirmTransform()
                else this.confirmObjectTransform()
            } else if (event.button === 2) {
                if (this._transform) this.cancelTransform()
                else this.cancelObjectTransform()
            } else if (event.button === 1) {
                running.handleEvent({type: 'modal', item: event.shiftKey ? 'autoConstraintPlane' : 'autoConstraint'})
                event.preventDefault()
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
        if (!this.isEditing) return
        // Selection waits for the release: a press that turns into a drag is an orbit, not a click.
        this._press = this._canvasPos(event)
    }

    private _onPointerUp = (event: PointerEvent): void => {
        if (this._gizmoDrag && event.button === 0) {
            // A gizmo drag confirms on release (Blender's `release_confirm`).
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
        if (!press || !this.isEditing || this.isDisabled() || this._transform || event.button !== 0) return
        const {x, y} = this._canvasPos(event)
        if (Math.abs(x - press.x) > this.dragThreshold || Math.abs(y - press.y) > this.dragThreshold) return

        const elem = this.pickAt(x, y, true)
        const extend = event.shiftKey || event.ctrlKey || event.metaKey
        // Clicking empty space deselects everything (Blender's `deselect_all` on click); Shift-clicking
        // empty space leaves the selection alone.
        if (!elem && extend) return
        this.selectElement(elem, extend)
    }

    /** Double-click a mesh to edit it, the way a Figma user drills into a group. */
    private _onDoubleClick = (event: MouseEvent): void => {
        if (this.isDisabled() || this.isEditing || event.button !== 0) return
        const picked = this._selectedMesh()
        if (picked) this.enter(picked)
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
        if (this.isDisabled() || this._isTypingTarget(event.target)) return
        this._transformKey(event, false)
    }

    /** The wheel resizes the proportional editing circle during a transform (Blender's `PROPORTIONAL_SIZE_UP/DOWN`). */
    private _onWheel = (event: WheelEvent): void => {
        const running = this._running()
        if (!running || this.isDisabled()) return
        event.preventDefault()
        if (running.handleEvent({type: 'modal', item: event.deltaY > 0 ? 'propsizeUp' : 'propsizeDown'})) this._viewer?.setDirty()
    }

    private _onKeyDown = (event: KeyboardEvent): void => {
        if (this.isDisabled()) return
        if (this._isTypingTarget(event.target)) return

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

        if (event.ctrlKey || event.metaKey) {
            if (event.code === 'KeyI') {
                event.preventDefault()
                this.invertSelection()
            }
            return
        }

        switch (event.code) {
        case 'Digit1':
            this.setSelectMode(SelectMode.Vertex)
            break
        case 'Digit2':
            this.setSelectMode(SelectMode.Edge)
            break
        case 'Digit3':
            this.setSelectMode(SelectMode.Face)
            break
        case 'KeyA':
            if (event.altKey) this.deselectAllElements()
            else this.selectAllElements()
            break
        case 'KeyL':
            this.selectLinked()
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
            // Outside a transform Esc does nothing, as in Blender: it must never throw away a session.
            return
        default:
            return
        }
        event.preventDefault()
    }

    // endregion
}
