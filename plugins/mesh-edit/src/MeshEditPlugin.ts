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
import {Matrix4} from 'threepipe'
import {EditMeshState} from './EditMeshState'
import {ModalTransform, TransformMode} from './transform'
import {buildEdgeOverlay, buildFaceOverlay, buildVertexOverlay} from './overlays'
import {PickCycleState, pickElement, ProjectFn} from './picking'
import {createEdgeMaterial, createVertexMaterial, EditTheme, setOverlayPixelRatio} from './overlayMaterials'
import {SelectBuffer} from './select/SelectBuffer'
import {unifiedFindNearest} from './select/findNearest'

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

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        window.addEventListener('keydown', this._onKeyDown)
        viewer.canvas.addEventListener('pointerdown', this._onPointerDown)
        viewer.canvas.addEventListener('pointermove', this._onPointerMove)
        viewer.canvas.addEventListener('pointerleave', this._onPointerLeave)
        viewer.canvas.addEventListener('dblclick', this._onDoubleClick)
        // Release can happen outside the canvas; listen where it will arrive.
        window.addEventListener('pointerup', this._onPointerUp)
    }

    onRemove(viewer: ThreeViewer): void {
        window.removeEventListener('keydown', this._onKeyDown)
        viewer.canvas.removeEventListener('pointerdown', this._onPointerDown)
        viewer.canvas.removeEventListener('pointermove', this._onPointerMove)
        viewer.canvas.removeEventListener('pointerleave', this._onPointerLeave)
        viewer.canvas.removeEventListener('dblclick', this._onDoubleClick)
        window.removeEventListener('pointerup', this._onPointerUp)
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
        if (!this.isEditing || this.isDisabled()) return
        const {x, y} = this._canvasPos(event)
        this._pointerX = x
        this._pointerY = y
        if (this._transform) {
            this._transform.setMousePosition(x, y)
            this._refreshFlags()
            this._scheduleLiveUpdate()
            this.dispatchEvent({type: 'transformChanged', transform: this._transform})
            return
        }
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
        if (event.button !== 0) return
        // Selection waits for the release: a press that turns into a drag is an orbit, not a click.
        this._press = this._canvasPos(event)
    }

    private _onPointerUp = (event: PointerEvent): void => {
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

    private _onKeyDown = (event: KeyboardEvent): void => {
        if (this.isDisabled()) return
        if (this._isTypingTarget(event.target)) return

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
            this.refreshOverlays()
            this.dispatchEvent({type: 'transformChanged', transform: this._transform})
            event.preventDefault()
            return
        }

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
