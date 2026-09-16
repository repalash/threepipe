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
    LineBasicMaterial,
    LineSegments,
    Mesh2,
    Object3D2,
    PhysicalMaterial,
    Points,
    PointsMaterial,
    ThreeViewer,
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
    selectAll,
    selectHistoryStore,
    selectInvert,
    SelectMode,
    SelectModeMask,
    selectModeSet,
    selectNone,
    vertSelectSet,
    walkVertShell,
} from '@threepipe/mesh-kernel'
import {EditMeshState} from './EditMeshState'
import {buildEdgeOverlay, buildFaceOverlay, buildVertexOverlay} from './overlays'
import {PickCycleState, pickElement, ProjectFn} from './picking'

export interface MeshEditPluginEventMap extends AViewerPluginEventMap {
    /** Edit mode entered or left. */
    editModeChanged: {object: IObject3D | null}
    /** The element selection changed. Distinct from the viewer's object-level `selectedObjectChanged`. */
    elementSelectionChanged: {state: EditMeshState}
    /** The mesh topology or positions changed. */
    meshChanged: {state: EditMeshState}
}

/** Plugins disabled while edit mode is active, so their keys and gizmos do not collide. */
const SUSPENDED_PLUGINS = ['TransformControlsPlugin', 'PivotControlsPlugin', 'PivotEditPlugin', 'Object3DWidgetsPlugin']

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

    /** Pixel radius for element picking. */
    pickDistance = 24

    /** Show elements through the surface. */
    xray = false

    private _root: Object3D2 | null = null
    private _vertPoints: Points | null = null
    private _edgeLines: LineSegments | null = null
    private _faceHighlight: Mesh2 | null = null
    private _cycle = new PickCycleState()

    get isEditing(): boolean {
        return this.state !== null
    }

    get selectMode(): SelectModeMask {
        return this.state?.selectMode ?? SelectMode.Vertex
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        window.addEventListener('keydown', this._onKeyDown)
        viewer.canvas.addEventListener('pointerdown', this._onPointerDown)
    }

    onRemove(viewer: ThreeViewer): void {
        window.removeEventListener('keydown', this._onKeyDown)
        viewer.canvas.removeEventListener('pointerdown', this._onPointerDown)
        if (this.isEditing) this.exit(false)
        super.onRemove(viewer)
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
            viewer.console.warn('MeshEditPlugin: select a mesh before entering edit mode')
            return false
        }

        const geometry = target.geometry as unknown as BufferGeometry2
        const position = geometry.getAttribute('position')
        if (!position) {
            viewer.console.warn('MeshEditPlugin: geometry has no position attribute')
            return false
        }
        const uv = geometry.getAttribute('uv')
        const index = geometry.getIndex()

        this.state = new EditMeshState({
            position: position.array as ArrayLike<number>,
            index: index ? (index.array as ArrayLike<number>) : null,
            uv: uv ? (uv.array as ArrayLike<number>) : null,
            groups: geometry.groups,
        })
        this.editObject = target

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

        if (commit) this.applyToObject()
        this._destroyOverlays()
        this._suspendObjectModePlugins(false)

        this.state = null
        this.editObject = null
        this._cycle.reset()

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
        const {data} = this.state.bake()
        const geometry = geometryDataToBufferGeometry<BufferGeometry2>(data, {
            BufferGeometry: BufferGeometry2,
            BufferAttribute,
        })
        const old = this.editObject.geometry
        this.editObject.geometry = geometry as never
        if (old && old !== geometry) old.dispose?.()
        this.dispatchEvent({type: 'meshChanged', state: this.state})
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

        const vertMaterial = new PointsMaterial({size: 7, sizeAttenuation: false, color: '#111118'})
        vertMaterial.depthTest = !this.xray
        this._vertPoints = new Points(new BufferGeometry2(), vertMaterial)
        this._vertPoints.renderOrder = 100
        this._vertPoints.frustumCulled = false

        const edgeMaterial = new LineBasicMaterial({color: '#222230'})
        edgeMaterial.depthTest = !this.xray
        this._edgeLines = new LineSegments(new BufferGeometry2(), edgeMaterial)
        this._edgeLines.renderOrder = 99
        this._edgeLines.frustumCulled = false

        const faceMaterial = new PhysicalMaterial({
            color: '#ffb400', transparent: true, opacity: 0.35, depthWrite: false,
        })
        faceMaterial.depthTest = !this.xray
        this._faceHighlight = new Mesh2(new BufferGeometry2(), faceMaterial)
        this._faceHighlight.renderOrder = 98
        this._faceHighlight.frustumCulled = false

        root.add(this._vertPoints as never, this._edgeLines as never, this._faceHighlight as never)
        // Overlays live in the edited object's space, so they follow its transform for free.
        this.editObject.add(root as never)

        this.refreshOverlays()
    }

    private _destroyOverlays(): void {
        for (const obj of [this._vertPoints, this._edgeLines, this._faceHighlight]) {
            obj?.geometry?.dispose?.()
            ;(obj?.material as any)?.dispose?.()
        }
        this._root?.removeFromParent()
        this._root = null
        this._vertPoints = null
        this._edgeLines = null
        this._faceHighlight = null
    }

    /** Rebuild every overlay buffer from the current BMesh. */
    refreshOverlays(): void {
        if (!this.state) return
        const bm = this.state.bm
        const active = bm.selectHistory.length
            ? bm.selectHistory[bm.selectHistory.length - 1].elem : undefined

        const showVerts = (bm.selectMode & SelectMode.Vertex) !== 0

        if (this._vertPoints) {
            this._vertPoints.visible = showVerts
            if (showVerts) {
                const data = buildVertexOverlay(bm, active)
                const g = this._vertPoints.geometry
                g.setAttribute('position', new BufferAttribute(data.position, 3))
                g.setAttribute('aFlag', new BufferAttribute(data.flag, 1))
                // Selected points are tinted by writing a colour attribute; the base material stays shared.
                g.setAttribute('color', new BufferAttribute(colorsFromFlags(data.flag), 3))
                ;(this._vertPoints.material as PointsMaterial).vertexColors = true
                g.computeBoundingSphere()
            }
        }

        if (this._edgeLines) {
            const data = buildEdgeOverlay(bm, active)
            const g = this._edgeLines.geometry
            g.setAttribute('position', new BufferAttribute(data.position, 3))
            g.setAttribute('color', new BufferAttribute(colorsFromFlags(data.flag), 3))
            ;(this._edgeLines.material as LineBasicMaterial).vertexColors = true
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

        this._viewer?.setDirty()
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
        this.refreshOverlays()
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
        this.refreshOverlays()
        if (this.state) this.dispatchEvent({type: 'elementSelectionChanged', state: this.state})
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

    private _onPointerDown = (event: PointerEvent): void => {
        if (!this.isEditing || this.isDisabled()) return
        if (event.button !== 0) return
        const project = this._projectFn()
        if (!project || !this.state) return

        const rect = this._viewer!.canvas.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        const result = pickElement(this.state.bm, x, y, project, {
            maxDistance: this.pickDistance,
            xray: this.xray,
        }, this._cycle)

        this.selectElement(result.element, event.shiftKey || event.ctrlKey || event.metaKey)
        // Consume the click so object-level picking does not also change the selection.
        event.stopPropagation()
    }

    private _onKeyDown = (event: KeyboardEvent): void => {
        if (this.isDisabled()) return
        const target = event.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

        // Tab toggles edit mode whether or not we are in it.
        if (event.code === 'Tab') {
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
        case 'Escape':
            this.exit(true)
            break
        default:
            return
        }
        event.preventDefault()
    }

    // endregion
}

/** Map overlay flags to per-vertex colours: black normally, orange selected, white active. */
function colorsFromFlags(flags: Float32Array): Float32Array {
    const out = new Float32Array(flags.length * 3)
    for (let i = 0; i < flags.length; i++) {
        const f = flags[i]
        let r = 0.07, g = 0.07, b = 0.09
        if (f & 1) {
            r = 1
            g = 0.62
            b = 0
        }
        if (f & 2) {
            r = 1
            g = 1
            b = 1
        }
        out[i * 3] = r
        out[i * 3 + 1] = g
        out[i * 3 + 2] = b
    }
    return out
}
