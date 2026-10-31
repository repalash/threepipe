import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    ICamera,
    onChange,
    OrbitControls3,
    OrthographicCamera2,
    PerspectiveCamera2,
    ThreeViewer,
    uiButton,
    uiFolderContainer,
    uiToggle,
    Quaternion,
    Vector3,
} from 'threepipe'
import type {UndoManagerPlugin} from 'threepipe'

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

/** An undo step of the start view */
interface StartMove {
    before: StartPose
    after: StartPose
}

/** The pose of a camera that is a child of the scene (its local pose is its world pose) */
function poseOf(camera: ICamera): StartPose {
    return {position: camera.position.clone(), target: camera.target.clone(), quaternion: camera.quaternion.clone(), zoom: camera.zoom, fov: (camera as PerspectiveCamera2).fov}
}

/**
 * The poses are the same, but for rounding: the orbit controls compute the position again on each update, so a camera
 * that did not move can differ in the last digits. The FoV is compared only when both poses have one (an orthographic
 * camera has none).
 */
function samePose(a: StartPose, b: StartPose) {
    const eps = 1e-6 * Math.max(1, a.position.length(), a.target.length())
    return a.position.distanceTo(b.position) <= eps && a.target.distanceTo(b.target) <= eps &&
        a.quaternion.angleTo(b.quaternion) <= 1e-4 && Math.abs(a.zoom - b.zoom) <= 1e-9 &&
        (a.fov === undefined || b.fov === undefined || Math.abs(a.fov - b.fov) <= 1e-9)
}

/** The zoom (and the FoV) of one camera means the same for the other: both are perspective, or both orthographic */
function sameProjection(a: ICamera, b: ICamera) {
    return !!(a as any).isOrthographicCamera === !!(b as any).isOrthographicCamera
}

/** Sets the pose of a camera that is a child of the scene */
function setPose(camera: ICamera, pose: StartPose) {
    const controls = camera.controls as OrbitControls3 | undefined
    // a glide after a drag would move it on
    controls?.stopDamping?.()
    // the projection first: a FOV change dollies a camera with dollyFov, and the position below replaces that move
    camera.zoom = pose.zoom
    if (pose.fov !== undefined && (camera as PerspectiveCamera2).fov !== undefined) (camera as PerspectiveCamera2).fov = pose.fov
    camera.updateProjectionMatrix()
    camera.position.copy(pose.position)
    camera.target.copy(pose.target)
    // a camera without controls or autoLookAtTarget does not turn by itself: its rotation is part of the pose
    camera.quaternion.copy(pose.quaternion)
    camera.setDirty()
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

export interface EditorCameraPluginEventMap extends AViewerPluginEventMap {
    /**
     * The view changed between Edit (`editing` true: the editor camera) and View (the start view), or the plugin was
     * turned off or on (disabled, enabled, added, removed; `editing` is false while it is off)
     */
    editingChange: {editing: boolean}
    /** {@link EditorCameraPlugin.startViewMoved} changed: in View, the view was moved away from the start view, saved or put back */
    startViewMovedChange: {moved: boolean}
    /**
     * The saved start view (the pose of the scene's default camera) changed: a save, a sync, an undo, a load, or a change
     * in the camera panel. With {@link EditorCameraPlugin.syncStartView}, it is sent on each frame of a move.
     */
    startViewChange: {camera: ICamera}
    /** {@link EditorCameraPlugin.syncStartView} changed (in the code, a panel, a UI) */
    syncStartViewChange: {sync: boolean}
}

/**
 * Editor Camera Plugin
 *
 * Gives an editor its own camera, separate from the scene's camera.
 *
 * - **Edit** ({@link editing} `true`): the view is through the editor camera. It moves 1:1 with the pointer (no damping)
 *   and has no orbit limits.
 * - **View** ({@link editing} `false`): the view is through the {@link previewCamera}, a copy of the scene's default
 *   camera (the start view, saved in the file). This is what a visitor sees, with the controls of the file (orbit
 *   limits, damping). With {@link syncStartView} (on by default), each move in View changes the start view as it
 *   happens (one undo step per move). With it off, a move in View is a preview: {@link saveStartView} keeps it,
 *   {@link resetStartView} goes back. So an export in View always has the saved start view.
 *
 * The editor camera and the preview camera are added to the scene outside the model root: they are not saved in a file
 * or exported.
 *
 * The C key ({@link hotkey}) switches between Edit and View, and the `editingChange` event tells a UI (like the start
 * view card of the `TweakpaneEditorPlugin`) when the view changes. `startViewChange` tells it when the saved start view
 * changes, and `startViewMovedChange` when the view in View moves away from it.
 *
 * When a file with a viewer config loads, the editor camera takes its start view. {@link setStartViewFromEditor} moves
 * the start view to the editor view. Each change of the start view is one undo step when the {@link UndoManagerPlugin}
 * is present.
 *
 * The plugin is not saved with the viewer config ({@link serializeWithViewer} is `false`).
 *
 * @category Plugins
 */
@uiFolderContainer('Editor Camera')
export class EditorCameraPlugin extends AViewerPluginSync<EditorCameraPluginEventMap> {
    static readonly PluginType = 'EditorCameraPlugin'
    serializeWithViewer = false

    /**
     * Off: the view goes to the scene's default camera (as without the plugin), and {@link editing} cannot be turned on.
     * `disable(key)` does the same until `enable(key)`, as for the other plugins: the plugin is off while `isDisabled()`.
     */
    @onChange(EditorCameraPlugin.prototype._enabledChanged)
    @uiToggle('Enabled')
        enabled = true

    /**
     * The editor camera. It is never saved.
     * Its orbit controls are made in {@link onAdded}, on the canvas of the viewer.
     */
    readonly camera = new PerspectiveCamera2()

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

    /**
     * A user gesture on the controls of the preview camera (in View) goes on after the pointer is up, for the glide of
     * damping: it ends after this time in ms without a change, with the pointer up (and at least three frames, for a
     * slow frame rate). With `autoRotate` on the controls, it ends this time after the pointer is up. With {@link syncStartView}, a gesture is one undo step, recorded when it starts and changed while
     * it goes on. A drag that starts this time or later after the last one is a new step.
     */
    static SyncGestureDelay = 300

    /** Light damping on the editor camera: the view follows in about 0.1 s and glides a little after release. Off: 1:1. */
    @onChange(EditorCameraPlugin.prototype._refreshControls)
    @uiToggle('Smooth orbit')
        smooth = false

    /**
     * In View: each move of the view changes the saved start view at once (one undo step per move). On by default.
     * Off: a move in View is a preview only, kept with {@link saveStartView}.
     * Turned on in View after a move, it saves the view.
     *
     * Only a user gesture on the controls of the preview camera is a move: from their `start` event to their `end`
     * event, and the glide after it (see {@link SyncGestureDelay}). A change that the user did not make, like a clamp of
     * the orbit limits (a start view outside them) or an animation of the camera by another plugin, is not synced.
     * The keyboard pan of `OrbitControls` sends no `start` and `end` events, so it is not a move either.
     */
    @onChange(EditorCameraPlugin.prototype._syncChanged)
    @uiToggle('Sync start view (in View)')
        syncStartView = true

    /**
     * Edit (`true`) looks through the editor camera, View (`false`) through the preview of the start view.
     * It stays `false` while the plugin is disabled (`isDisabled()`).
     */
    @onChange(EditorCameraPlugin.prototype._refreshEditing)
    @uiToggle('Edit (off: View)')
        editing = true

    /**
     * The key that switches between Edit and View, as a `KeyboardEvent.code` (`'KeyC'`: the C key). An empty string
     * turns it off. The key does nothing in a text field, with Ctrl, Cmd, Alt or Shift, held down, or when another
     * handler used it.
     */
    hotkey = 'KeyC'

    /** What the cameras show now: Edit, View, or nothing (not added, or disabled: the default camera is the main camera) */
    private _mode?: 'edit' | 'view'
    /** The last value of {@link startViewMoved} that was sent in `startViewMovedChange` */
    private _moved = false
    /** The start view when `startViewChange` was last sent */
    private _lastStart?: StartPose
    private _preview?: PerspectiveCamera2 | OrthographicCamera2
    /** The controls of the preview camera that the plugin listens to (start and end of a drag) */
    private _previewControls?: OrbitControls3
    /** The preview camera is set by the plugin: not a move */
    private _applying = false
    /** With {@link syncStartView}: the undo step of the current gesture */
    private _syncMove?: StartMove
    /** A user gesture on the controls of the preview goes on: from their start event to the end of the glide after their end event */
    private _gesture = false
    /** The time of the last change of the preview in the gesture (`Date.now()`) and the frames without a change since */
    private _gestureChangeTime = 0
    private _gestureQuietFrames = 0
    /** The time of the last end event of the controls of the preview camera (`Date.now()`) */
    private _dragEndTime = 0
    /** The pointer is down on the preview (between the start and end events of its controls) */
    private _dragging = false
    /** A user gesture moved the preview since View started, or since the last save, reset, undo or load, and the move is not saved */
    private _userMoved = false
    /** The undo manager of the {@link UndoManagerPlugin}, while it is added */
    private _undoManager?: UndoManagerPlugin['undoManager']

    constructor() {
        super()
        const c = this.camera
        c.name = 'Editor camera'
        c.userData.disableWidgets = true
        // made without a canvas (it gets the viewer canvas in onAdded), so the aspect does not follow it by itself
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

    /**
     * The camera that View looks through: a copy of the start camera with its controls (orbit limits, damping), made
     * again from it each time View starts. It is not saved or exported, and has no camera widget. Made when the plugin
     * is added.
     */
    get previewCamera(): ICamera | undefined {
        return this._preview
    }

    /**
     * In View: a user gesture moved the view away from the saved start view, and the move is not saved
     * ({@link syncStartView} is off). {@link saveStartView} keeps the move, {@link resetStartView} goes back. Always
     * `false` in Edit. A change that the user did not make (a clamp of the orbit limits, an animation of the camera by
     * another plugin) is not a move, see {@link syncStartView}.
     */
    get startViewMoved(): boolean {
        const start = this.startCamera
        return this._mode === 'view' && this._userMoved && !!this._preview && !!start && !samePose(poseOf(this._preview), poseOf(start))
    }

    /**
     * The view shows the saved start view now: in View when it was not moved, in Edit when the editor camera is at the
     * start view (after a load, {@link copyStartView} or {@link setStartViewFromEditor}). A UI can take a picture of
     * the start view from the canvas then.
     */
    get showsStartView(): boolean {
        const viewer = this._viewer
        const start = this.startCamera
        if (!viewer || !start) return false
        const main = viewer.scene.mainCamera
        if (this._mode === 'view') return main === this._preview && !this.startViewMoved
        if (this._mode === 'edit') return main === this.camera && samePose(poseOf(this.camera), poseOf(start))
        return main === start
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // the orbit controls listen on the viewer canvas. A camera made with them and without a canvas makes them on
        // document.body (which then gets a tabIndex)
        this.camera.setCanvas(viewer.canvas, false)
        if (!this.camera.controlsMode) this.camera.controlsMode = 'orbit'
        const start = viewer.scene.defaultCamera
        const preview = this._makePreview(start, viewer.canvas)
        // not addObject: the cameras are not scene objects (no addSceneObject event, not in the model root, not saved)
        // eslint-disable-next-line deprecation/deprecation
        viewer.scene.add(this.camera)
        // eslint-disable-next-line deprecation/deprecation
        viewer.scene.add(preview)
        viewer.scene.addEventListener('mainCameraChange', this._onMainCameraChange)
        viewer.assetManager.addEventListener('loadAsset', this._onLoad)
        viewer.addEventListener('postFrame', this._onPostFrame)
        start.addEventListener('cameraUpdate', this._onStartUpdate)
        preview.addEventListener('cameraUpdate', this._onPreviewUpdate)
        window.addEventListener('keydown', this._onKeyDown)
        // by its type name, as the PickingPlugin: the plugin works without it
        viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um) => {
            this._undoManager = um.undoManager
        }, () => {
            this._undoManager = undefined
        }, this)
        this._lastStart = poseOf(start)
        this.copyStartView()
        this._refreshEditing()
    }

    onRemove(viewer: ThreeViewer) {
        this._stopGesture()
        // the start view is the main camera again; editing keeps its value for the next add.
        // Another main camera (made the main camera while in Edit) stays.
        const main = viewer.scene.mainCamera
        if (main === this.camera || main === this._preview) viewer.scene.defaultCamera.activateMain()
        const wasOn = !!this._mode
        this._mode = undefined
        viewer.scene.removeEventListener('mainCameraChange', this._onMainCameraChange)
        viewer.assetManager.removeEventListener('loadAsset', this._onLoad)
        viewer.removeEventListener('postFrame', this._onPostFrame)
        viewer.scene.defaultCamera.removeEventListener('cameraUpdate', this._onStartUpdate)
        this._preview?.removeEventListener('cameraUpdate', this._onPreviewUpdate)
        window.removeEventListener('keydown', this._onKeyDown)
        this._watchPreviewControls(undefined)
        this._undoManager = undefined
        if (wasOn) this.dispatchEvent({type: 'editingChange', editing: false})
        this._checkMoved()
        this.camera.removeFromParent()
        this._preview?.removeFromParent()
        this.uiConfig?.uiRefresh?.(true)
        super.onRemove(viewer)
    }

    /** Disposes the editor camera and the preview camera, with their orbit controls (their pointer listeners on the canvas) */
    dispose() {
        this._stopGesture()
        this.camera.dispose()
        this._watchPreviewControls(undefined)
        this._preview?.dispose()
        this._preview = undefined
        super.dispose()
    }

    /** The preview camera, of the type of the start camera, on the viewer canvas */
    private _makePreview(start: ICamera, canvas: HTMLCanvasElement): PerspectiveCamera2 | OrthographicCamera2 {
        const ortho = !!(start as any).isOrthographicCamera
        const old = this._preview
        if (old && !!(old as any).isOrthographicCamera === ortho) {
            // added again to another viewer: its controls go to the new canvas
            if (old._canvas !== canvas) old.setCanvas(canvas)
            return old
        }
        if (old) {
            this._watchPreviewControls(undefined)
            old.dispose()
        }
        // no controls yet: _copyStartToPreview gives it the controls mode of the start camera each time View starts
        const preview = ortho ? new OrthographicCamera2('', canvas) : new PerspectiveCamera2('', canvas)
        preview.name = 'Start view (preview)'
        preview.userData.disableWidgets = true
        this._preview = preview
        return preview
    }

    /** Runs a change of the preview camera that is not a move of the view */
    private _apply(change: () => void) {
        const applying = this._applying
        this._applying = true
        try {
            change()
        } finally {
            this._applying = applying
        }
    }

    /** The preview camera takes the start camera: its controls, projection and settings, and its pose. */
    private _copyStartToPreview() {
        const start = this.startCamera
        const preview = this._preview
        if (!start || !preview) return
        this._apply(() => {
            // the controls first, so that the controls settings in the data apply to them
            const mode = start.controlsMode ?? ''
            if (preview.controlsMode !== mode) preview.controlsMode = mode
            // not the uuid or the name
            preview.fromJSON(start.toJSON())
            // not serialized: the frustum size of an orthographic camera (0: none, the bounds are set by hand)
            if (start instanceof OrthographicCamera2 && preview instanceof OrthographicCamera2) preview.frustumSize = start.frustumSize
            preview.userData.disableWidgets = true
            setPose(preview, poseOf(start))
        })
        this._watchPreviewControls(preview.controls as OrbitControls3 | undefined)
    }

    /**
     * The preview takes the start camera and becomes the main camera, when View starts or a start view loads in View.
     *
     * The copy runs before the main camera changes, so what plugins set on the main camera change (like the ground
     * limit of BaseGroundPlugin) applies over it. A preview that is the main camera already (a load in View) changes
     * to the editor camera and back for that. A controls plugin (as `ACameraControlsPlugin`) gives the constructor of
     * its mode to the main camera only: for such a mode the copy, which makes the controls, runs after the change.
     */
    private _showPreview() {
        const start = this.startCamera
        const preview = this._preview
        if (!start || !preview) return
        const mode = start.controlsMode ?? ''
        // the preview can have the controls of the mode before it is the main camera
        const ready = () => !mode || preview.controlsMode === mode && !!preview.controls || !!preview.controlsCtors?.has(mode)
        this._apply(() => {
            // a load in View: the preview is the main camera already. It changes to the editor camera and back, so that
            // what plugins set on a main camera change (like a ground limit) applies over the controls of the new file
            if (preview.isMainCamera) this.camera.activateMain()
            const copied = ready()
            if (copied) this._copyStartToPreview()
            preview.activateMain()
            if (!copied || mode && !preview.controls) this._copyStartToPreview()
        })
    }

    private _setPreviewPose(pose: StartPose) {
        const preview = this._preview
        if (preview) this._apply(() => setPose(preview, pose))
    }

    private _refreshEditing() {
        const disabled = this.isDisabled()
        // this sets editing again, and the second call applies it
        if (this.editing && disabled) {
            this.editing = false
            return
        }
        const viewer = this._viewer
        if (!viewer) return
        const mode = disabled ? undefined : this.editing ? 'edit' : 'view'
        if (this._mode === mode) {
            this._checkMoved()
            return
        }
        this._stopGesture()
        this._userMoved = false
        this._mode = mode
        if (mode === 'edit') {
            this.camera.activateMain()
        } else if (mode === 'view') {
            // the settings of the start camera may have changed since the last View
            this._showPreview()
        } else {
            viewer.scene.defaultCamera.activateMain()
        }
        this.uiConfig?.uiRefresh?.(true)
        // also from View to off and back: a UI hides while the plugin is off
        this.dispatchEvent({type: 'editingChange', editing: mode === 'edit'})
        this._checkMoved()
    }

    /** Sends `startViewMovedChange` when {@link startViewMoved} changed */
    private _checkMoved = () => {
        const moved = this.startViewMoved
        if (moved === this._moved) return
        this._moved = moved
        this.dispatchEvent({type: 'startViewMovedChange', moved})
    }

    /**
     * The start camera changed (by the plugin, the camera panel, a load): sends `startViewChange` when its pose did.
     * In View, a view that the user did not move follows it.
     */
    private _onStartUpdate = () => {
        const start = this.startCamera
        if (!start) return
        const pose = poseOf(start)
        const last = this._lastStart
        if (last && samePose(last, pose)) return this._checkMoved()
        this._lastStart = pose
        if (this._mode === 'view' && !this._gesture && !this._userMoved) this._setPreviewPose(pose)
        this.dispatchEvent({type: 'startViewChange', camera: start})
        this._checkMoved()
    }

    /**
     * The preview camera changed. Only a change in a user gesture is a move: with sync, it changes the start view at
     * once (the gesture is one undo step); without, it is a move that is not saved. A change out of a gesture (a clamp of
     * the orbit limits, an animation by another plugin) is neither.
     */
    private _onPreviewUpdate = () => {
        if (this._mode !== 'view' || this._applying || !this._preview) return
        const start = this.startCamera
        if (this._gesture && start) {
            // the glide of damping after the pointer is up keeps the gesture on; an auto rotation does not (it does not
            // stop), so the gesture ends after the delay
            if (this._dragging || !this._previewControls?.autoRotate) {
                this._gestureChangeTime = Date.now()
                this._gestureQuietFrames = 0
            }
            const pose = poseOf(this._preview)
            const saved = poseOf(start)
            if (this.syncStartView) {
                if (!samePose(pose, saved)) {
                    this._setStartView(pose)
                    if (this._syncMove) this._syncMove.after = pose
                    else this._syncMove = this._recordStartView(saved, pose)
                }
                // saved
                this._userMoved = false
            } else if (!samePose(pose, saved)) this._userMoved = true
        }
        this._checkMoved()
    }

    private _onDragStart = () => {
        this._dragging = true
        this._gesture = true
        this._gestureChangeTime = Date.now()
        this._gestureQuietFrames = 0
        // a new drag is a new step, also during the glide of the last one; wheel steps (a start and an end each) close
        // together are one
        if (Date.now() - this._dragEndTime >= EditorCameraPlugin.SyncGestureDelay) this._endSyncMove()
    }

    private _onDragEnd = () => {
        this._dragging = false
        this._gestureChangeTime = this._dragEndTime = Date.now()
    }

    /** After each frame: a gesture (and its synced move) ends when the pointer is up and the view did not move for a while */
    private _onPostFrame = () => {
        if (!this._gesture || this._dragging) return
        this._gestureQuietFrames++
        if (this._gestureQuietFrames > 2 && Date.now() - this._gestureChangeTime >= EditorCameraPlugin.SyncGestureDelay) this._endGesture()
    }

    private _watchPreviewControls(controls?: OrbitControls3) {
        const old = this._previewControls
        if (old === controls) return
        old?.removeEventListener?.('start', this._onDragStart)
        old?.removeEventListener?.('end', this._onDragEnd)
        controls?.addEventListener?.('start', this._onDragStart)
        controls?.addEventListener?.('end', this._onDragEnd)
        this._previewControls = controls
        this._stopGesture()
    }

    /** Ends a synced move: the next change of the start view is a new undo step */
    private _endSyncMove() {
        this._syncMove = undefined
    }

    /**
     * The plugin set the view (a reset, an undo, a load) or stopped its glide (a save): the gesture ends, unless the
     * pointer is still down. A clamp of the orbit limits after it is not a move.
     */
    private _endGesture() {
        this._gesture = this._dragging
        this._endSyncMove()
    }

    /** The gesture ends, also with the pointer down: View ends, or the controls of the preview change */
    private _stopGesture() {
        this._dragging = false
        this._endGesture()
    }

    /** `enabled` or `disable(key)` / `enable(key)` changed: Edit when the plugin is on again, off while it is disabled */
    private _enabledChanged() {
        const enabled = !this.isDisabled()
        if (this.editing !== enabled) this.editing = enabled
        else this._refreshEditing()
    }

    /** Called by `disable(key)` and `enable(key)`: applies {@link isDisabled}, as a change of {@link enabled} */
    setDirty() {
        this._enabledChanged()
    }

    private _syncChanged() {
        if (this.syncStartView) this.saveStartView()
        else this._endSyncMove()
        this.uiConfig?.uiRefresh?.(true)
        this.dispatchEvent({type: 'syncStartViewChange', sync: this.syncStartView})
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        if (!this.hotkey || e.code !== this.hotkey || this.isDisabled()) return
        if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
        const target = e.target as HTMLElement | null
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable) return
        e.preventDefault()
        this.editing = !this.editing
    }

    /** In View: the view goes back to the saved start view (a move that was not saved is dropped) */
    @uiButton('Back to start view (in View)', {sendArgs: false})
    resetStartView() {
        const start = this.startCamera
        if (this._mode === 'view' && start) {
            this._endGesture()
            this._userMoved = false
            this._setPreviewPose(poseOf(start))
        }
        this._checkMoved()
    }

    /**
     * In View: the start view takes the view (one undo step), as the view that visitors see. It does nothing in Edit, or
     * when the view was not moved ({@link startViewMoved}: a change that the user did not make, like a clamp of the orbit
     * limits, is not saved).
     */
    @uiButton('Save start view (in View)', {sendArgs: false})
    saveStartView() {
        const start = this.startCamera
        const preview = this._preview
        if (!this.startViewMoved || !start || !preview) return
        // a glide after the drag would move it on after the save
        const controls = preview.controls as OrbitControls3 | undefined
        controls?.stopDamping?.()
        this._endGesture()
        const before = poseOf(start)
        const after = poseOf(preview)
        this._userMoved = false
        this._setStartView(after)
        this._recordStartView(before, after)
        this._checkMoved()
    }

    /**
     * The editor camera takes the start view. It looks in the same direction, also when the start view looks away from
     * its target. The editor camera stays upright: a roll of the start view is not copied. The FoV and the zoom are
     * copied from a perspective start camera only (the editor camera is perspective).
     */
    @uiButton('Editor camera to start view', {sendArgs: false})
    copyStartView() {
        const start = this.startCamera
        if (!start) return
        const c = this.camera
        // a glide of the editor camera (smooth) would move it on from the start view
        ;(c.controls as OrbitControls3 | undefined)?.stopDamping?.()
        const position = start.getWorldPosition(new Vector3())
        c.position.copy(position)
        c.target.copy(lookTargetOf(start, position))
        // the orbit controls turn the camera only while it is the main camera: in View, turn it here
        c.lookAt(c.target)
        if (sameProjection(start, c)) {
            c.fov = (start as PerspectiveCamera2).fov
            c.zoom = start.zoom
        }
        c.setDirty()
    }

    /**
     * The start view takes the editor view: one undo step when the {@link UndoManagerPlugin} is present. An
     * orthographic start camera keeps its zoom (the editor camera is perspective).
     */
    @uiButton('Set start view to this view', {sendArgs: false})
    setStartViewFromEditor() {
        const start = this.startCamera
        if (!start) return
        const before = poseOf(start)
        const same = sameProjection(start, this.camera)
        // the start view is a child of the scene, so the world pose of the editor camera is its local pose
        const after: StartPose = {
            position: this.camera.getWorldPosition(new Vector3()),
            target: this.camera.target.clone(),
            quaternion: this.camera.getWorldQuaternion(new Quaternion()),
            zoom: same ? this.camera.zoom : start.zoom,
            fov: same ? this.camera.fov : undefined,
        }
        this._moveStartView(after)
        this._recordStartView(before, after)
    }

    /** Moves the start view (an undo, a redo, set from the editor). In View, the view goes there too. */
    private _moveStartView(pose: StartPose) {
        // a synced move ends, and its glide stops (setPose)
        this._endGesture()
        this._userMoved = false
        this._setStartView(pose)
        if (this._mode === 'view') this._setPreviewPose(pose)
        this._checkMoved()
    }

    private _setStartView(pose: StartPose) {
        const start = this.startCamera
        if (!start) return
        setPose(start, pose)
        // setDirty sends the camera update; this also covers a camera that does not send it
        this._onStartUpdate()
    }

    /** Records an undo step (with the {@link UndoManagerPlugin}). Its `after` can change until it is undone. */
    private _recordStartView(before: StartPose, after: StartPose): StartMove | undefined {
        const undoManager = this._undoManager
        if (!undoManager || samePose(before, after)) return undefined
        const move: StartMove = {before, after}
        undoManager.record({
            undo: () => this._moveStartView(move.before),
            redo: () => this._moveStartView(move.after),
        })
        return move
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
        // a synced move that goes on is a new undo step from the new start view
        this._endGesture()
        this._userMoved = false
        this.copyStartView()
        // in View, the view is the start view of the new file, with its controls
        if (this._mode === 'view') this._showPreview()
        this._onStartUpdate()
    }
}
