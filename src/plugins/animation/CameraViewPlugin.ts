import {Object3D, Vector3} from 'three'
import {Easing} from '@repalash/popmotion'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {Box3B} from '../../three'
import {onChange, onChange3, serialize, timeout} from 'ts-browser-helpers'
import {generateUiConfig, uiButton, uiDropdown, uiInput, UiObjectConfig, uiSlider, uiToggle} from 'uiconfig.js'
import {EasingFunctions, EasingFunctionType} from '../../utils'
import {CameraView, createCameraPath, ICamera, ICameraView, IGeometry, IMaterial, IObject3D, ITexture} from '../../core'
import {AnimationResult, PopmotionPlugin} from './PopmotionPlugin'
import {InteractionPromptPlugin} from '../interaction/InteractionPromptPlugin'
import {getFittingDistance} from '../../three/utils/camera'

export interface CameraViewPluginOptions{duration?: number, ease?: EasingFunctionType, interpolateMode?: 'spherical'|'linear'}

export interface CameraViewPluginEventMap extends AViewerPluginEventMap{
    viewChange: {view: CameraView}
    startViewChange: {view: CameraView}

    viewAdd: {view: CameraView}
    viewDelete: {view: CameraView}
    viewUpdate: {view: CameraView}

    update: {key?: string}
}

/**
 * Camera View Plugin
 *
 * Provides API to save, interact and animate and loop between with multiple camera states/views using the {@link PopmotionPlugin}.
 *
 */
export class CameraViewPlugin extends AViewerPluginSync<CameraViewPluginEventMap> {
    static readonly PluginType = 'CameraViews'

    enabled = true

    // get dirty() { // todo: issue with recorder convergeMode?
    //     return this._animating
    // }

    constructor(options: CameraViewPluginOptions = {}) {
        super()
        this.addCurrentView = this.addCurrentView.bind(this)
        this.resetToFirstView = this.resetToFirstView.bind(this)
        this.animateAllViews = this.animateAllViews.bind(this)
        // this.recordAllViews = this.recordAllViews.bind(this)
        // this._wheel = this._wheel.bind(this)
        // this._pointerMove = this._pointerMove.bind(this)
        this._postFrame = this._postFrame.bind(this)
        this.setDirty = this.setDirty.bind(this)

        this.animDuration = options.duration ?? this.animDuration
        this.animEase = options.ease ?? this.animEase
        this.interpolateMode = options.interpolateMode ?? this.interpolateMode
    }



    @serialize('cameraViews')
    private _cameraViews: CameraView[] = []
    get cameraViews(): CameraView[] {
        return this._cameraViews
    }
    get camViews(): CameraView[] {
        return this._cameraViews
    }

    @onChange(CameraViewPlugin.prototype._animationLoop)
    /**
     * Loop all views indefinitely.
     */
    @serialize() @uiToggle('Loop All Views') viewLooping = false
    /**
     * Pauses time between view changes when animating all views or looping.
     */
    @onChange3('setDirty')
    @serialize() @uiInput('View Pause Time') viewPauseTime = 200

    /**
     * {@link EasingFunctions}
     */
    @onChange3('setDirty')
    @serialize() @uiDropdown('Ease', Object.keys(EasingFunctions).map((label:string)=>({label}))) animEase: EasingFunctionType = 'easeInOutSine' // ms
    @onChange3('setDirty')
    @serialize() @uiSlider('Duration', [10, 10000], 10) animDuration = 1000 // ms
    @onChange3('setDirty')
    @serialize() @uiDropdown('Interpolation', ['spherical', 'linear'/* , 'spline (dev)'*/].map((label:string)=>({label, value: label.split(' ')[0]})))
        interpolateMode: 'spherical'|'linear'|'spline' = 'spherical'
    // todo spline
    // @serialize() @uiDropdown('Spline Curve', ['centripetal', 'chordal', 'catmullrom'].map((label:string)=>({label})), (t: CameraViewPlugin)=>({hidden: ()=>t.interpolateMode !== 'spline', onChange: ()=>t.uiConfig?.uiRefresh?.()}))
    //     splineCurve: 'centripetal'|'chordal'|'catmullrom' = 'chordal'


    // not used
    @serialize()
    // @onChange3('setDirty')
    // @uiSlider('RotationOffset', [0.2, 0.75], 0.01)
        rotationOffset = 0.25

    private _animating = false
    get animating(): boolean {
        return this._animating
    }

    dependencies = [PopmotionPlugin]

    // private _updaters: {u: ((timestamp: number) => void), time: number}[] = []
    // private _lastFrameTime = 0 // for post frame

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)

        // todo: move to PopmotionPlugin
        // todo: remove event listener
        viewer.addEventListener('preFrame', (_: any)=>{
            // console.log(ev.deltaTime)

            // this._updaters.forEach(u=>{
            //     let dt = ev.deltaTime
            //     if (u.time + dt < 0) dt = -u.time
            //     u.time += dt
            //     if (Math.abs(dt) > 0.001)
            //         u.u(dt)
            // })

        })

        viewer.addEventListener('postFrame', this._postFrame)
        // window.addEventListener('wheel', this._wheel)
        // window.addEventListener('pointermove', this._pointerMove)

    }

    onRemove(viewer: ThreeViewer): void {

        viewer.removeEventListener('postFrame', this._postFrame)
        // window.removeEventListener('wheel', this._wheel)
        // window.removeEventListener('pointermove', this._pointerMove)

        return super.onRemove(viewer)
    }

    @uiButton('Reset To First View', {sendArgs: false})
    public async resetToFirstView(duration = 100) {
        if (this.isDisabled()) return
        this._currentView = undefined
        await this.animateToView(0, duration)
        await timeout(2)
    }

    @uiButton('Add Current View')
    async addCurrentView() {
        if (this.isDisabled()) return
        const camera = this._viewer?.scene.mainCamera
        if (!camera) return
        const view = this.getView(camera)
        this.addView(view)
        view.name = 'View ' + this._cameraViews.length
        return view
    }

    addView(view: CameraView, force = false) {
        view.addEventListener('setView', this._viewSetView as any)
        view.addEventListener('updateView', this._viewUpdateView as any)
        view.addEventListener('deleteView', this._viewDeleteView as any)
        view.addEventListener('animateView', this._viewAnimateView as any)
        view.addEventListener('update', this._viewUpdated)
        const incl = this._cameraViews.includes(view)
        if (!incl || force) {
            if (!incl) this._cameraViews.push(view)
            this.setDirty({key: 'cameraViews', change: 'viewAdd'})
            this.dispatchEvent({type: 'viewAdd', view})
        }
    }

    deleteView(view: CameraView, force = false) {
        const i = this._cameraViews.indexOf(view)
        view.removeEventListener('setView', this._viewSetView as any)
        view.removeEventListener('updateView', this._viewUpdateView as any)
        view.removeEventListener('deleteView', this._viewDeleteView as any)
        view.removeEventListener('animateView', this._viewAnimateView as any)
        view.removeEventListener('update', this._viewUpdated)
        if (i >= 0 || force) {
            if (i >= 0) this._cameraViews.splice(i, 1)
            this.setDirty({key: 'cameraViews', change: 'viewDelete'})
            this.dispatchEvent({type: 'viewDelete', view})
        }
    }


    getView(camera?: ICamera, worldSpace = true, view?: CameraView) {
        camera = camera || this._viewer?.scene.mainCamera
        if (!camera) return view ?? new CameraView()
        return camera.getView(worldSpace, view)
    }

    setView(view: ICameraView, camera?: ICamera) {
        camera = camera || this._viewer?.scene.mainCamera
        if (!camera) return
        camera.setView(view)
    }

    private _currentView: CameraView | undefined

    @uiButton('Focus Next', {sendArgs: false}) focusNext = (wrap = true)=>{
        if (this._animating) return
        if (this._cameraViews.length < 2) return
        let index = this._cameraViews.findIndex(v=>v === this._currentView)
        if (index < 0) index = -1 // first view
        index = index + 1
        if (!wrap) index = Math.min(index, this._cameraViews.length - 1)
        else index = index % this._cameraViews.length
        this.animateToView(index)
    }
    @uiButton('Focus Previous', {sendArgs: false}) focusPrevious = (wrap = true)=> {
        if (this._animating) return
        if (this._cameraViews.length < 2 || !this._currentView) return
        let index = this._cameraViews.findIndex(v=>v === this._currentView)
        if (index < 0) index = 0 // last view
        index = index - 1
        if (!wrap) index = Math.max(index, 0)
        else index = (index + this._cameraViews.length) % this._cameraViews.length
        this.animateToView(index)
    }

    private _popAnimations: AnimationResult[] = []

    async animateToView(_view: CameraView|number|string, duration?: number, easing?: Easing|EasingFunctionType, camera?: ICamera, throwOnStop = false) {
        camera = camera || this._viewer?.scene.mainCamera
        if (!camera) return
        // if (this._currentView === view) return // todo: also check if the camera is at the correct position and orientation, till then use resetToFirstView to reset current view
        if (this._animating) {
            this._popAnimations.forEach(a=>a?.stop && a.stop()) // don't call stopAllAnimations here, as it sets viewLooping to false and changes config.
            this._popAnimations = []
            let i = 0
            while (this._animating) {
                await timeout(100)
                if (i++ > 20) { // 2s timeout
                    break
                }
            }
            if (this._animating) {
                console.warn('Unable to stop all animations, maybe because of viewLooping?')
                return
            }
        }
        const view = typeof _view === 'number' ? this._cameraViews[_view] :
            typeof _view === 'string' ? this._cameraViews.find(v=>v.name === _view) :
                _view
        if (!view) {
            this._viewer?.console.warn('Invalid view', _view)
            return
        }

        const interactionPrompt = this._viewer?.getPlugin(InteractionPromptPlugin)
        if (interactionPrompt && interactionPrompt.animationRunning) {
            await interactionPrompt.stopAnimation({reset: true})
        }

        this._currentView = view
        this._animating = true

        this._viewer?.scene.mainCamera.setInteractions(false, CameraViewPlugin.PluginType) // todo: also for seekOnScroll

        this.dispatchEvent({type: 'startViewChange', view})

        const popmotion = this._viewer?.getPlugin(PopmotionPlugin)
        if (!popmotion) throw new Error('PopmotionPlugin not found')

        if (duration === undefined) duration = this.animDuration
        const ease: any = (typeof easing === 'function' ? easing : EasingFunctions[easing || this.animEase]) as (x: number) => number
        // const ease = (x:number)=>x
        // const driver = this._driver
        this._popAnimations = []

        // const viewIndex = this.camViews.indexOf(view)
        // let interpolateMode = this.interpolateMode
        // if (viewIndex < 0) {
        //     if (interpolateMode === 'spline') {
        //         console.warn('CameraViewPlugin - Cannot animate along a spline with external camera view, fallback to spherical')
        //         interpolateMode = 'spherical'
        //     }
        // }
        //
        // if (interpolateMode === 'spline') {
        //     const points = this.camViews.map(c=>c.position.clone())
        //     const spline = new CatmullRomCurve3(points, true, this.splineCurve)
        //
        //     const getPosition = (t: number)=>{
        //         const v = new Vector3()
        //         const ip = 1. / points.length
        //         const i = viewIndex === 0 ? points.length : viewIndex
        //         const d = (i - 1) * ip
        //         spline.getPointAt(d + t * ip, v)
        //         return v
        //     }
        //
        //     pms.push(animateAsync({
        //         // from: camera.position.clone(),
        //         // to: view.position.clone(),
        //         from: 0,
        //         to: 1,
        //         duration, ease, driver,
        //         onUpdate: (v) => camera.position = getPosition(v),
        //         onComplete: () => camera.position = getPosition(1), // camera.position = view.position,
        //         onStop: ()=> {
        //             throw new Error('Animation stopped')
        //         },
        //     }, popAnimations))
        //     // if (new Vector3().subVectors(camera.cameraObject.up, view.up).length() > 0.1)
        //     // pms.push(animateAsync({
        //     //     from: camera.cameraObject.up.clone(),
        //     //     to: view.up.clone(),
        //     //     duration, ease, driver,
        //     //     onUpdate: (v) => camera.cameraObject.up.copy(v),
        //     //     onComplete: () => camera.cameraObject.up.copy(view.up),
        //     // }))
        //     // if (new Vector3().subVectors(camera.target, view.target).length() > 0.1)
        //     pms.push(animateAsync({
        //         from: camera.target.clone(),
        //         to: view.target.clone(),
        //         duration, ease, driver,
        //         onUpdate: (v) => {
        //             camera.target = v
        //             camera.targetUpdated()
        //         },
        //         onComplete: () => {
        //             camera.target = view.target
        //             camera.targetUpdated()
        //         },
        //     }, popAnimations))
        // }

        await popmotion.animateCameraAsync(camera, view, this.interpolateMode === 'spherical', {ease, duration}, this._popAnimations)
            .catch((e)=>{
                // console.error(e)
                if (throwOnStop) throw e
            })

        this._viewer?.scene.mainCamera.setInteractions(true, CameraViewPlugin.PluginType)
        this._animating = false

        this._viewer?.setDirty()

        this.dispatchEvent({type: 'viewChange', view})

        await timeout(10)
    }

    @uiButton('Animate All Views')
    async animateAllViews() {
        if (this.isDisabled()) return
        if (this.viewLooping || this._cameraViews.length < 2) return
        while (this._viewQueue.length > 0) this._viewQueue.pop()
        this._viewQueue.push(...this._cameraViews)
        this._viewQueue.push(this._viewQueue.shift()!)
        this._infiniteLooping = false
        await this._animationLoop()
        this._infiniteLooping = true
    }

    @uiButton('Stop All Animations')
    async stopAllAnimations() {
        this.viewLooping = false
        this._popAnimations.forEach(a => a?.stop?.())
        this._popAnimations = []
        while (this._animating || this._animationLooping) {
            await timeout(100)
        }
    }

    fromJSON(data: any, meta?: any): this | null {
        this._cameraViews.forEach(v=>this.deleteView(v)) // deserialize pushes to the existing array
        if (super.fromJSON(data, meta)) {
            this._cameraViews.forEach(v=>this.addView(v, true))
            this.uiConfig?.uiRefresh?.()
            return this
        }
        return null
    }

    setDirty(ops?: any): any {
        this.uiConfig?.uiRefresh?.(false, 'postFrame')
        this.dispatchEvent({...ops, type: 'update'})
    }

    public async animateToObject(selected?: Object3D, distanceMultiplier = 4, duration?: number, ease?: Easing|EasingFunctionType, distanceBounds = {min: 0.5, max: 5.0}) {
        if (!this._viewer) return
        const bbox = new Box3B().expandByObject(selected || this._viewer.scene.modelRoot, false, true)
        const center = bbox.getCenter(new Vector3())
        const size = bbox.getSize(new Vector3())
        const radius = size.length() / 2
        await this.animateToTarget(Math.min(distanceBounds.max, Math.max(distanceBounds.min, radius * distanceMultiplier)), center, duration, ease)
    }

    public async animateToFitObject(selected?: Object3D|Object3D[]|IMaterial|IMaterial[]|ITexture|ITexture[]|IGeometry|IGeometry[], distanceMultiplier = 1.5, duration = 1000, ease?: Easing|EasingFunctionType, distanceBounds = {min: 0.5, max: 50.0}) {
        if (!this._viewer) return
        const selectedArray = (Array.isArray(selected) ? selected : selected ? [selected] : [])
            .flatMap(o =>
                (o as ITexture)?.isTexture ? [...(o as ITexture).appliedObjects?.values() || []] : o)
            .flatMap(o =>
                (o as IMaterial)?.isMaterial ? [...(o as IMaterial).appliedMeshes?.values() || []] :
                    (o as IGeometry)?.isBufferGeometry ? [...(o as IGeometry).appliedMeshes?.values() || []] :
                    o as IObject3D)
            .filter(Boolean)

        const bbox = new Box3B().expandByObject(!selectedArray.length ? this._viewer.scene.modelRoot : selectedArray[0], false, true)
        for (let i = 1; i < selectedArray.length; i++) {
            bbox.expandByObject(selectedArray[i], false, true)
        }
        const cameraZ = getFittingDistance(this._viewer.scene.mainCamera, bbox)
        const center = bbox.getCenter(new Vector3()) // world position
        await this.animateToTarget(Math.min(distanceBounds.max, Math.max(distanceBounds.min, cameraZ * distanceMultiplier)), center, duration, ease)
    }

    /**
     *
     * @param distanceFromTarget - in world units
     * @param center - target (center) of the view in world coordinates
     * @param duration - in milliseconds
     * @param ease
     */
    public async animateToTarget(distanceFromTarget: number, center: Vector3, duration?: number, ease?: Easing|EasingFunctionType) {
        const view = this.getView() // world space
        view.target.copy(center)
        const direction = new Vector3().subVectors(view.target, view.position).normalize()
        view.position.copy(direction.multiplyScalar(-distanceFromTarget).add(view.target))
        await this.animateToView(view, duration, ease)
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Camera Views',
        // expanded: true,
        children: [
            ()=>[...this._cameraViews.map(view => view.uiConfig)],
            ...generateUiConfig(this) || [],
        ],
    }

    get animationLooping(): boolean {
        return this._animationLooping
    }
    private _viewQueue: CameraView[] = []
    private _animationLooping = false
    private _infiniteLooping = true
    private async _animationLoop() {
        if (this._animationLooping) return
        this._animationLooping = true
        while (this.viewLooping || !this._infiniteLooping) {
            if (this.isDisabled()) break
            if (this._cameraViews.length < 1) break
            if (this._viewQueue.length === 0) {
                if (this._infiniteLooping) this._viewQueue.push(...this._cameraViews)
                else break
            }
            await this.animateToView(this._viewQueue.shift()!)
            await timeout(2 + this.viewPauseTime) // ms delay
        }
        this._animationLooping = false
    }


    protected _viewSetView = ({view, camera}: {view?: CameraView, camera?: ICamera}) => {
        if (!view) {
            this._viewer?.console.warn('Invalid view', view)
            return
        }
        this.setView(view, camera)
    }

    protected _viewUpdateView = ({view, camera}: {view: CameraView, camera?: ICamera}) => {
        if (!view) {
            this._viewer?.console.warn('Invalid view', view)
            return
        }
        const name = view.name
        this.getView(camera, view.isWorldSpace ?? true, view)
        view.name = name
    }

    protected _viewDeleteView = ({view}: {view: CameraView}) => {
        if (!view) {
            this._viewer?.console.warn('Invalid view', view)
            return
        }
        this.deleteView(view)
    }

    protected _viewAnimateView = async({view, camera, duration, easing, throwOnStop}: {view: CameraView, camera?: ICamera, duration?: number, easing?: Easing|EasingFunctionType, throwOnStop?: boolean}) => {
        if (!view) {
            this._viewer?.console.warn('Invalid view', view)
            return
        }
        return this.animateToView(view, duration || this.animDuration, easing || this.animEase, camera, throwOnStop)
    }

    protected _viewUpdated = async(e: {target: ICameraView, key?: string}) => {
        if (!this._cameraViews.includes(e.target as any)) return
        this.dispatchEvent({type: 'viewUpdate', view: e.target as CameraView})
        this.setDirty({key: 'cameraViews', change: 'viewUpdate'})
    }


    // region deprecated

    /**
     * @deprecated - renamed to {@link getView} or {@link ICamera.getView}
     * @param camera
     * @param worldSpace
     */
    getCurrentCameraView(camera?: ICamera, worldSpace = true) {
        return this.getView(camera, worldSpace)
    }

    /**
     * @deprecated - renamed to {@link setView} or {@link ICamera.setView}
     * @param view
     */
    setCurrentCameraView(view: CameraView) {
        return this.setView(view)
    }


    /**
     * @deprecated - use {@link animateToView} instead
     * @param view
     */
    async focusView(view: CameraView) {
        return this.animateToView(view)
    }

    // endregion

    private _lastAnimTime = -1

    protected _postFrame() {
        if (!this.enabled || !this._viewer) return
        const camera = this._viewer.scene.mainCamera
        if (!camera) return
        if (!this._viewer.timeline.shouldRun() || !this._cameraViews.length) {
            camera.setInteractions(true, CameraViewPlugin.PluginType + '-postFrame')
            this._lastAnimTime = -1
            return
        }
        camera.setInteractions(false, CameraViewPlugin.PluginType + '-postFrame')

        const time = this._viewer.timeline.time
        // const delta = this._viewer.timeline.delta || 0

        if (time == this._lastAnimTime) return
        this._lastAnimTime = time

        const timeline = []
        const viewDuration = this.animDuration || 1000
        const pauseTime = this.viewPauseTime || 0
        const views = this._cameraViews
        let time1 = 0
        for (let i = 0; i < views.length; i++) {
            const view = views[i]
            const duration = Math.max(2, view.duration * viewDuration) / 1000
            timeline.push({
                time: time1,
                index: i,
                duration: duration,
            })
            time1 += duration + pauseTime / 1000
        }
        const selectedTime = timeline
            .sort((a, b) => -a.time + b.time)
            .find(t => t.time <= time)
        if (!selectedTime) return // todo?

        const viewIndex = selectedTime.index

        const start = selectedTime.time
        const duration = selectedTime.duration ?? 0.5

        const t = duration < 1e-6 ? 1 : (time - start) / duration
        // const dt = duration < 1e-6 ? 0 : delta / duration

        if (t > 1) return // todo?

        // todo cache path
        const {getPosition, getTarget} = createCameraPath(this.camViews)

        getPosition(t, viewIndex, camera.position)
        getTarget(t, viewIndex, camera.target)
        camera.setDirty()

        return true
    }

    // region to be ported to other plugins

    // /**
    //  * For slight rotation of camera when seekOnScroll is enabled
    //  */
    // private _pointerMove(ev: PointerEvent) {
    //     if (this.isDisabled()) return
    //     if (!this._animating && this.seekOnScroll) {
    //         const cam = this._viewer?.scene.mainCamera
    //         if (!cam) return
    //         const s = new Spherical()
    //         const p = cam.position
    //         const t = cam.target
    //         const q = new Quaternion().setFromUnitVectors(cam.cameraObject.up, new Vector3(0, 1, 0))
    //         const qi = q.clone().invert()
    //         const offset = p.clone().sub(t)
    //         offset.applyQuaternion(q)
    //         s.setFromVector3(offset)
    //         s.theta += this.rotationOffset * ev.movementX / this._viewer!.canvas!.clientWidth
    //         s.phi += this.rotationOffset * ev.movementY / this._viewer!.canvas!.clientHeight
    //         s.makeSafe()
    //         offset.setFromSpherical(s)
    //         offset.applyQuaternion(qi)
    //         p.copy(t).add(offset)
    //         cam.setDirty()
    //     }
    // }

    // // @uiToggle() @serialize()
    // animateOnScroll = false // buggy
    //
    // @uiToggle() @serialize()
    // seekOnScroll = false

    // private _scrollAnimationState = 0
    // scrollAnimationDamping = 0.1
    // private _wheel(ev: any | WheelEvent) {
    //     if (this.isDisabled()) return
    //     if (this.seekOnScroll && !this._animating) {
    //         // if (ev.deltaY > 0) this.focusNext(false)
    //         // else this.focusPrevious(false)
    //     } else if (Math.abs(ev.deltaY) > 0.001) {
    //         this._scrollAnimationState = -1. * Math.sign(ev.deltaY)
    //     }
    // }


    // private _driver: Driver = (update)=>{
    //     return {
    //         start: ()=>this._updaters.push({u:update, time:0}),
    //         stop: ()=> this._updaters.splice(this._updaters.findIndex(u=>u.u === update), 1),
    //     }
    // }

    // private _fadeDisabled = false

    // todo: same code used in PopmotionPlugin, merge somehow
    // private _postFrame() {
    //     if (!this._viewer) return
    //     if (this.isDisabled() || !this._animating) {
    //         this._lastFrameTime = 0
    //         if (this._fadeDisabled) {
    //             this._viewer.getPluginByType<FrameFadePlugin>('FrameFade')?.enable(CameraViewPlugin.PluginType)
    //             this._fadeDisabled = false
    //         }
    //         // console.log('not anim')
    //         return
    //     }
    //     const time = now() / 1000.0
    //     if (this._lastFrameTime < 1) this._lastFrameTime = time - 1.0 / 60.0
    //     let delta = time - this._lastFrameTime
    //     this._lastFrameTime = time
    //     delta = delta * (this.animateOnScroll ? this._scrollAnimationState : 1)
    //
    //     const d = this._viewer.getPluginByType<ProgressivePlugin>('Progressive')?.postFrameConvergedRecordingDelta()
    //     if (d && d > 0) delta = d
    //     if (d === 0) return // not converged yet.
    //     // if d < 0: not recording, do nothing
    //
    //     delta *= 1000
    //
    //     // delta = 16.666
    //
    //     // console.log(delta)
    //     // console.log(dt)
    //     //
    //
    //     if (delta <= 0) return
    //
    //     this._updaters.forEach(u=>{
    //         let dt = delta
    //         if (u.time + dt < 0) dt = -u.time
    //         u.time += dt
    //         if (Math.abs(dt) > 0.001)
    //             u.u(dt)
    //     })
    //     if (this._scrollAnimationState < 0.001) this._scrollAnimationState = 0
    //     else this._scrollAnimationState *= 1.0 - this.scrollAnimationDamping
    //
    //     if (!this._fadeDisabled) {
    //         const ff = this._viewer.getPluginByType<FrameFadePlugin>('FrameFade')
    //         if (ff) {
    //             ff.disable(CameraViewPlugin.PluginType)
    //             this._fadeDisabled = true
    //         }
    //     }
    // }

    // @uiButton('Record All Views')
    // public async recordAllViews(onStart?: ()=>void, downloadOnEnd = true) {
    //     if (this.isDisabled()) return
    //     const recorder = this._viewer?.getPluginByType<CanvasRecorderPlugin>('CanvasRecorder')
    //     if (!recorder || !recorder.enabled) return
    //     if (this._cameraViews.length < 1) return
    //     if (recorder.isRecording()) {
    //         console.error('CanvasRecorderPlugin is already recording')
    //         return
    //     }
    //     let looping = false
    //     if (this.viewLooping) {
    //         looping = true
    //         this.viewLooping = false
    //     }
    // await this.resetToFirstView()
    //     return new Promise<Blob|undefined>((resolve, reject) => {
    //         const listener2 = ()=>{
    //             recorder.removeEventListener('start', listenerStart)
    //             recorder.removeEventListener('stop', listener2)
    //             recorder.removeEventListener('error', listenerError)
    //         }
    //         const listenerStart = async() => {
    //             listener2()
    //             onStart?.()
    //             await this.animateAllViews()
    //             const blob = await recorder.stopRecording()
    //             if (looping) this.viewLooping = true
    //             if (downloadOnEnd) {
    //                 const name = await this._viewer?.prompt('Canvas Recorder: Save file as', 'recording.mp4')
    //                 if (name !== null && blob) await this._downloadBlob(blob, name || 'recording.mp4')
    //             }
    //             resolve(blob)
    //         }
    //         const listenerError = async() => {
    //             listener2()
    //             reject()
    //         }
    //         recorder.addEventListener('start', listenerStart)
    //         recorder.addEventListener('stop', listener2)
    //         recorder.addEventListener('error', listenerError)
    //         if (!recorder.startRecording()) {
    //             console.error('cannot start recording')
    //             return
    //         }
    //     })
    // }

    // private async _downloadBlob(blob: Blob, name: string) {
    //     const tr = this._viewer?.getPluginByType<FileTransferPlugin>('FileTransferPlugin')
    //     if (!tr) {
    //         this._viewer?.console.error('FileTransferPlugin required to export/download file')
    //         return
    //     }
    //     await tr.exportFile(blob, name)
    // }

    // endregion
}
