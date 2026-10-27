import {
    AViewerPluginSync,
    ICamera,
    onChange,
    OrbitControls3,
    PerspectiveCamera2,
    ThreeViewer,
    uiButton,
    uiFolderContainer,
    uiToggle,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'

/**
 * Editor Camera Plugin
 *
 * Gives an editor its own camera, separate from the scene's camera.
 *
 * - **Edit** ({@link editing} `true`): the view is through the editor camera. It moves 1:1 with the pointer (no damping)
 *   and has no orbit limits. It is added to the scene outside the model root, so it is not saved in a file or exported.
 * - **View** ({@link editing} `false`): the view is through the scene's default camera, the start view. This is what a
 *   visitor sees, with the controls of the file (orbit limits, damping).
 *
 * When a file with a viewer config loads, the editor camera takes its start view. {@link setStartViewFromEditor} moves
 * the start view to the editor view, as one undo step when the {@link UndoManagerPlugin} is present.
 *
 * The plugin is not saved with the viewer config ({@link serializeWithViewer} is `false`).
 *
 * @category Plugins
 */
@uiFolderContainer('Editor Camera')
export class EditorCameraPlugin extends AViewerPluginSync {
    static readonly PluginType = 'EditorCameraPlugin'
    serializeWithViewer = false

    /** Off: the view goes to the start view, and {@link editing} cannot be turned on */
    @onChange(EditorCameraPlugin.prototype._enabledChanged)
    @uiToggle('Enabled')
        enabled = true

    /** The editor camera. It is never saved. */
    readonly camera = new PerspectiveCamera2('orbit')

    /**
     * The controls of the editor camera, set each time it becomes the main camera.
     * The start view keeps the controls of the file.
     */
    static ControlProps: Partial<OrbitControls3> = {
        enableDamping: false,
        minDistance: 0.05,
        maxDistance: 1000,
        zoomSpeed: 0.5,
        maxZoomSpeed: 0.5,
        autoPushTarget: true,
        autoPullTarget: false,
        rotateSpeed: 2,
        minPolarAngle: 0,
        maxPolarAngle: Math.PI,
        minAzimuthAngle: -1e6,
        maxAzimuthAngle: 1e6,
    }

    /** Light damping on the editor camera: the view follows in about 0.1 s and glides a little after release. Off: 1:1. */
    @onChange(EditorCameraPlugin.prototype._refreshControls)
    @uiToggle('Smooth orbit')
        smooth = false

    /**
     * In View: when Edit starts again, the start view stays where the camera was moved (one undo step).
     * Off: the start view goes back to where it was when View started, so a look around does not change it.
     */
    @uiToggle('Keep view moves')
        keepViewMoves = false

    /**
     * Edit (`true`) looks through the editor camera, View (`false`) through the start view.
     * It stays `false` while the plugin is disabled.
     */
    @onChange(EditorCameraPlugin.prototype._refreshEditing)
    @uiToggle('Edit (off: View)')
        editing = true

    /** The value of {@link editing} that the cameras show now */
    private _shownEditing = false
    /** The start view when View started, to put it back (see {@link keepViewMoves}) */
    private _startPose?: {position: Vector3, target: Vector3}

    constructor() {
        super()
        const c = this.camera
        c.name = 'Editor camera'
        c.userData.disableWidgets = true
        // made without a canvas, so the aspect does not follow it by itself
        c.autoAspect = true
        // the ground's camera limit is for visitors
        c.userData.disableGroundLimit = true
        c.position.set(0, 0, 5)
        c.target.set(0, 0, 0)
    }

    /** The scene's default camera: the start view, saved in the file */
    get startCamera(): ICamera | undefined {
        return this._viewer?.scene.defaultCamera
    }

    /** The camera that Edit or View looks through: the editor camera in Edit, else the start view */
    get homeCamera(): ICamera | undefined {
        return this._shownEditing ? this.camera : this.startCamera
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // not addObject: the camera is not a scene object (no addSceneObject event, not in the model root, not saved)
        // eslint-disable-next-line deprecation/deprecation
        viewer.scene.add(this.camera)
        viewer.scene.addEventListener('mainCameraChange', this._onMainCameraChange)
        viewer.assetManager.addEventListener('loadAsset', this._onLoad)
        this.copyStartView()
        this._refreshEditing()
        // added in View: the start view now is the one to put back
        const start = viewer.scene.defaultCamera
        if (!this._shownEditing) this._startPose = {position: start.position.clone(), target: start.target.clone()}
    }

    onRemove(viewer: ThreeViewer) {
        // the start view is the main camera again, where it is now; editing keeps its value for the next add
        if (this._shownEditing) viewer.scene.defaultCamera.activateMain()
        this._shownEditing = false
        this._startPose = undefined
        viewer.scene.removeEventListener('mainCameraChange', this._onMainCameraChange)
        viewer.assetManager.removeEventListener('loadAsset', this._onLoad)
        this.camera.removeFromParent()
        super.onRemove(viewer)
    }

    private _refreshEditing() {
        // this sets editing again, and the second call applies it
        if (this.editing && !this.enabled) {
            this.editing = false
            return
        }
        const viewer = this._viewer
        const editing = this.editing
        if (!viewer || this._shownEditing === editing) return
        this._shownEditing = editing
        const start = viewer.scene.defaultCamera
        if (editing) {
            const before = this._startPose
            this._startPose = undefined
            if (before && this.keepViewMoves) {
                const controls = start.controls as OrbitControls3 | undefined
                controls?.stopDamping?.()
                this._recordStartView(before, {position: start.position.clone(), target: start.target.clone()})
            } else if (before) {
                this._setStartView(before)
            }
            this.camera.activateMain()
        } else {
            this._startPose = {position: start.position.clone(), target: start.target.clone()}
            start.activateMain()
        }
        this.uiConfig?.uiRefresh?.(true)
    }

    /** In View: put the start view back to where it was when View started */
    @uiButton('Reset start view', {sendArgs: false})
    resetStartView() {
        if (this._startPose) this._setStartView(this._startPose)
    }

    /** The editor camera takes the start view */
    @uiButton('Editor camera to start view', {sendArgs: false})
    copyStartView() {
        const start = this.startCamera
        if (!start) return
        const c = this.camera
        c.position.copy(start.getWorldPosition(new Vector3()))
        c.target.copy(start.target)
        if ((start as PerspectiveCamera2).fov) c.fov = (start as PerspectiveCamera2).fov
        c.setDirty()
    }

    /** The start view takes the editor view: one undo step when the {@link UndoManagerPlugin} is present */
    @uiButton('Set start view to this view', {sendArgs: false})
    setStartViewFromEditor() {
        const start = this.startCamera
        if (!start) return
        const before = {position: start.position.clone(), target: start.target.clone()}
        // the start view is a child of the scene, so the world pose of the editor camera is its local pose
        const after = {position: this.camera.getWorldPosition(new Vector3()), target: this.camera.target.clone()}
        this._moveStartView(after)
        this._recordStartView(before, after)
    }

    /** Moves the start view. In View, the pose to put back moves with it, so a later Edit or reset keeps the move. */
    private _moveStartView(pose: {position: Vector3, target: Vector3}) {
        this._setStartView(pose)
        if (this._startPose) this._startPose = pose
    }

    private _setStartView(pose: {position: Vector3, target: Vector3}) {
        const start = this.startCamera
        if (!start) return
        const controls = start.controls as OrbitControls3 | undefined
        controls?.stopDamping?.()
        start.position.copy(pose.position)
        start.target.copy(pose.target)
        start.setDirty()
    }

    private _recordStartView(before: {position: Vector3, target: Vector3}, after: {position: Vector3, target: Vector3}) {
        if (after.position.equals(before.position) && after.target.equals(before.target)) return
        this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager?.record({
            undo: () => this._moveStartView(before),
            redo: () => this._moveStartView(after),
        })
    }

    private _enabledChanged() {
        this.editing = this.enabled
    }

    private _onMainCameraChange = () => this._refreshControls()

    private _refreshControls() {
        if (this._viewer?.scene.mainCamera !== this.camera) return
        // the controls are made when the camera becomes the main one
        const ctrl = this.camera.controls as OrbitControls3 | undefined
        if (ctrl) Object.assign(ctrl, EditorCameraPlugin.ControlProps, this.smooth ? {enableDamping: true, dampingFactor: 0.25} : {})
    }

    // a file with a viewer config (in a model, or a viewer config file) brings its start view: begin to edit from it
    private _onLoad = (e: {data?: any}) => {
        if (!e.data?.importedViewerConfig && e.data?.assetType !== 'config') return
        this.copyStartView()
        // in View, the start view of the new file is the one to put back
        const start = this.startCamera
        if (start && this._startPose) this._startPose = {position: start.position.clone(), target: start.target.clone()}
    }
}
