import {AViewerPluginSync, ICamera, OrbitControls3, PerspectiveCamera2, ThreeViewer, UndoManagerPlugin, Vector3} from 'threepipe'

/**
 * The editor's own camera, like the blueprint editor's: Edit mode looks through it, and it is never saved (it is in
 * the scene, outside the model root). It moves 1:1 with the pointer (no damping) and has no limits.
 *
 * The scene's default camera is the start view: what a visitor sees, with the file's controls (orbit limits, damping).
 * View mode looks through it; the toolbar's camera menu moves it to the editor view (SelectionUxPlugin.alignCameraToView).
 */
export class EditorCameraPlugin extends AViewerPluginSync {
    static readonly PluginType = 'EditorCameraPlugin'
    enabled = true
    readonly camera = new PerspectiveCamera2('orbit')

    /** The controls of the editor camera, as in the blueprint editor; the start view keeps the file's */
    static ControlProps: Partial<OrbitControls3> = {
        enableDamping: false,
        minDistance: 0.05,
        maxDistance: 1000,
        zoomSpeed: 0.5,
        maxZoomSpeed: 0.5,
        autoPushTarget: true,
        autoPullTarget: false,
        // threepipe's default: the same turn per pixel as the viewer (1 needed twice the mouse travel)
        rotateSpeed: 2,
        minPolarAngle: 0,
        maxPolarAngle: Math.PI,
        minAzimuthAngle: -1e6,
        maxAzimuthAngle: 1e6,
    }

    private _smooth = false
    /** Smooth orbit: a light damping (the view follows in about 0.1 s and glides a little after release). Off: 1:1. */
    get smooth() {
        return this._smooth
    }
    set smooth(v: boolean) {
        this._smooth = v
        try {
            localStorage.setItem('sux-editor-smooth-orbit', v ? '1' : '0')
        } catch (e) {
            // no storage: this page only
        }
        this._onMainCameraChange()
    }

    private _active = false
    /** The start view's pose while View mode orbits it: it goes back when you edit again, so viewing does not change it */
    private _startPose?: {position: Vector3, target: Vector3}

    constructor() {
        super()
        const c = this.camera
        c.name = 'Editor camera'
        c.userData.disableWidgets = true
        // made without a canvas, so the aspect does not follow it by itself
        c.autoAspect = true
        // the ground's "keep the camera above the ground" is for visitors (threepipe PR #78)
        c.userData.disableGroundLimit = true
        try {
            this._smooth = localStorage.getItem('sux-editor-smooth-orbit') === '1'
        } catch (e) {
            // no storage: 1:1
        }
        c.position.set(0, 0, 5)
        c.target.set(0, 0, 0)
    }

    /** The scene's default camera: the saved start view */
    get startCamera(): ICamera | undefined {
        return this._viewer?.scene.defaultCamera
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.scene.add(this.camera)
        viewer.scene.addEventListener('mainCameraChange', this._onMainCameraChange)
        viewer.assetManager.addEventListener('loadAsset', this._onLoad)
        this.copyStartView()
        this.setActive(true)
    }

    onRemove(viewer: ThreeViewer) {
        this.setActive(false)
        viewer.scene.removeEventListener('mainCameraChange', this._onMainCameraChange)
        viewer.assetManager.removeEventListener('loadAsset', this._onLoad)
        this.camera.removeFromParent()
        super.onRemove(viewer)
    }

    /**
     * In View mode: keep the camera where it is when you go back to Edit (the start view moves there, one undo step).
     * Off: View mode puts the start view back, so looking around does not change it.
     */
    keepViewMoves = false

    /** View mode: the start view as it was when View mode began */
    resetStartView() {
        const start = this._viewer?.scene.defaultCamera
        if (!start || !this._startPose) return
        const controls = start.controls as OrbitControls3 | undefined
        controls?.stopDamping?.()
        start.position.copy(this._startPose.position)
        start.target.copy(this._startPose.target)
        start.setDirty()
    }

    /** Edit mode (true) looks through the editor camera; View mode (false) through the start view, with its own controls */
    setActive(active: boolean) {
        const viewer = this._viewer
        if (!viewer || this._active === active) return
        this._active = active
        const start = viewer.scene.defaultCamera
        if (active) {
            const before = this._startPose
            if (before && this.keepViewMoves) {
                const controls = start.controls as OrbitControls3 | undefined
                controls?.stopDamping?.()
                const after = {position: start.position.clone(), target: start.target.clone()}
                const set = (p: typeof after) => {
                    start.position.copy(p.position)
                    start.target.copy(p.target)
                    start.setDirty()
                }
                if (!after.position.equals(before.position) || !after.target.equals(before.target))
                    viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: () => set(before), redo: () => set(after)})
                this._startPose = undefined
            } else if (before) {
                this.resetStartView()
                this._startPose = undefined
            }
            this.camera.activateMain()
        } else {
            this._startPose = {position: start.position.clone(), target: start.target.clone()}
            start.activateMain()
        }
    }

    /** The camera Edit mode goes back to (Esc or 0 after looking through a camera) */
    get homeCamera(): ICamera | undefined {
        return this._active ? this.camera : this._viewer?.scene.defaultCamera
    }

    /** The editor camera takes the start view */
    copyStartView() {
        const start = this.startCamera
        if (!start) return
        const c = this.camera
        c.position.copy(start.getWorldPosition(new Vector3()))
        c.target.copy(start.target)
        if ((start as PerspectiveCamera2).fov) c.fov = (start as PerspectiveCamera2).fov
        c.setDirty()
    }

    private _onMainCameraChange = () => {
        if (this._viewer?.scene.mainCamera !== this.camera) return
        // the controls are made when the camera becomes the main one
        const ctrl = this.camera.controls as OrbitControls3 | undefined
        if (ctrl) Object.assign(ctrl, EditorCameraPlugin.ControlProps, this._smooth ? {enableDamping: true, dampingFactor: 0.25} : {})
    }

    // a file with a viewer config brings its start view: begin editing from it
    private _onLoad = (e: {data?: any}) => {
        if (e.data?.importedViewerConfig) this.copyStartView()
    }
}
