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
    Quaternion,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'

/**
 * A pose of the start view. The rotation is kept too: a camera without controls can look away from its target. The zoom
 * is the framing of an orthographic camera (and the FoV zoom of a perspective one).
 */
interface StartPose {
    position: Vector3
    target: Vector3
    quaternion: Quaternion
    zoom: number
    /** The field of view of a perspective camera */
    fov?: number
}

/** The pose of a camera that is a child of the scene (its local pose is its world pose) */
function poseOf(camera: ICamera): StartPose {
    return {position: camera.position.clone(), target: camera.target.clone(), quaternion: camera.quaternion.clone(), zoom: camera.zoom, fov: (camera as PerspectiveCamera2).fov}
}

function samePose(a: StartPose, b: StartPose) {
    return a.position.equals(b.position) && a.target.equals(b.target) && a.quaternion.equals(b.quaternion) && a.zoom === b.zoom && a.fov === b.fov
}

/**
 * A loaded asset brings a start view: a viewer config (in a model, or a viewer config file) with the scene's default
 * camera. A plugin preset is a config too (`assetType` 'config'), but it has no start view.
 */
function hasStartView(data: any): boolean {
    const config = data?.importedViewerConfig ?? (data?.assetType === 'config' ? data : undefined)
    return !!config?.scene?.defaultCamera
}

/**
 * The point that a camera looks at, for orbit controls: its target, or, when it looks away from the target (a camera
 * without controls can), the point straight ahead at the same distance
 */
function lookTargetOf(camera: ICamera, position: Vector3): Vector3 {
    const forward = camera.getWorldDirection(new Vector3())
    const toTarget = camera.target.clone().sub(position)
    const distance = toTarget.length()
    if (distance > 1e-6 && toTarget.dot(forward) / distance > 0.9999) return camera.target.clone()
    return position.clone().addScaledVector(forward, distance > 1e-6 ? distance : 1)
}

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
    private _startPose?: StartPose

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
        if (!this._shownEditing) this._startPose = poseOf(start)
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

    /** Disposes the editor camera and its orbit controls (their pointer listeners on the canvas) */
    dispose() {
        this.camera.dispose()
        super.dispose()
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
                this._recordStartView(before, poseOf(start))
            } else if (before) {
                this._setStartView(before)
            }
            this.camera.activateMain()
        } else {
            this._startPose = poseOf(start)
            start.activateMain()
        }
        this.uiConfig?.uiRefresh?.(true)
    }

    /** In View: put the start view back to where it was when View started */
    @uiButton('Reset start view', {sendArgs: false})
    resetStartView() {
        if (this._startPose) this._setStartView(this._startPose)
    }

    /**
     * The editor camera takes the start view. It looks in the same direction, also when the start view looks away from
     * its target. The editor camera stays upright: a roll of the start view is not copied.
     */
    @uiButton('Editor camera to start view', {sendArgs: false})
    copyStartView() {
        const start = this.startCamera
        if (!start) return
        const c = this.camera
        const position = start.getWorldPosition(new Vector3())
        c.position.copy(position)
        c.target.copy(lookTargetOf(start, position))
        if ((start as PerspectiveCamera2).fov) c.fov = (start as PerspectiveCamera2).fov
        c.zoom = start.zoom
        c.setDirty()
    }

    /** The start view takes the editor view: one undo step when the {@link UndoManagerPlugin} is present */
    @uiButton('Set start view to this view', {sendArgs: false})
    setStartViewFromEditor() {
        const start = this.startCamera
        if (!start) return
        const before = poseOf(start)
        // the start view is a child of the scene, so the world pose of the editor camera is its local pose
        const after: StartPose = {
            position: this.camera.getWorldPosition(new Vector3()),
            target: this.camera.target.clone(),
            quaternion: this.camera.getWorldQuaternion(new Quaternion()),
            zoom: this.camera.zoom,
            fov: this.camera.fov,
        }
        this._moveStartView(after)
        this._recordStartView(before, after)
    }

    /** Moves the start view. In View, the pose to put back moves with it, so a later Edit or reset keeps the move. */
    private _moveStartView(pose: StartPose) {
        this._setStartView(pose)
        if (this._startPose) this._startPose = pose
    }

    private _setStartView(pose: StartPose) {
        const start = this.startCamera
        if (!start) return
        const controls = start.controls as OrbitControls3 | undefined
        controls?.stopDamping?.()
        // the projection first: a FOV change dollies a camera with dollyFov, and the position below replaces that move
        start.zoom = pose.zoom
        if (pose.fov !== undefined && (start as PerspectiveCamera2).fov !== undefined) (start as PerspectiveCamera2).fov = pose.fov
        start.updateProjectionMatrix()
        start.position.copy(pose.position)
        start.target.copy(pose.target)
        // a camera without controls or autoLookAtTarget does not turn by itself: its rotation is part of the pose
        start.quaternion.copy(pose.quaternion)
        start.setDirty()
    }

    private _recordStartView(before: StartPose, after: StartPose) {
        if (samePose(before, after)) return
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
    private _onLoad = (e: {data?: any, options?: {importConfig?: boolean}}) => {
        // loaded with importConfig false: the viewer config of the file was not imported, the start view did not change
        if (e.options?.importConfig === false || !hasStartView(e.data)) return
        this.copyStartView()
        // in View, the start view of the new file is the one to put back
        const start = this.startCamera
        if (start && this._startPose) this._startPose = poseOf(start)
    }
}
