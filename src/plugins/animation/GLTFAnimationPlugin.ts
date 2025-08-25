import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {absMax, now, onChange, onChange2, PointerDragHelper, serialize} from 'ts-browser-helpers'
import {uiButton, uiDropdown, uiFolderContainer, uiMonitor, UiObjectConfig, uiSlider, uiToggle} from 'uiconfig.js'
import {
    AnimationAction,
    AnimationClip,
    AnimationMixer,
    EventListener2,
    LoopOnce,
    LoopRepeat,
    Object3D,
    Scene,
} from 'three'
import {ProgressivePlugin} from '../pipeline/ProgressivePlugin'
import {IObject3D, ISceneEventMap} from '../../core'
import {generateUUID} from '../../three'
import type {FrameFadePlugin} from '../pipeline/FrameFadePlugin'

export interface GLTFAnimationPluginEventMap extends AViewerPluginEventMap{
    checkpointBegin: object
    checkpointEnd: object
    animationStep: {delta: number, time: number}
    addAnimation: {animation: IObjectAnimation}
    removeAnimation: {animation: IObjectAnimation}
}

export interface IObjectAnimation {
    object: Object3D
    mixer: AnimationMixer,
    clips: AnimationClip[],
    actions: AnimationAction[],
    duration: number
}


/**
 * Manages playback of GLTF animations.
 *
 * The GLTF animations can be created in any 3d software that supports GLTF export like Blender.
 * If animations from multiple files are loaded, they will be merged in a single root object and played together.
 *
 * The time playback is managed automatically, but can be controlled manually by setting {@link autoIncrementTime} to false and using {@link setTime} to set the time.
 *
 * This plugin is made for playing, pausing, stopping, all the animations at once, while it is possible to play individual animations, it is not recommended.
 *
 * To play individual animations, with custom choreography, use the {@link GLTFAnimationPlugin.animations} property to get reference to the animation clips and actions. Create your own mixers and control the animation playback like in three.js
 *
 * @category Plugins
 */
@uiFolderContainer('GLTF Animations')
export class GLTFAnimationPlugin extends AViewerPluginSync<GLTFAnimationPluginEventMap> {
    enabled = true
    declare uiConfig: UiObjectConfig

    static readonly PluginType = 'GLTFAnimation'

    protected readonly _animations: IObjectAnimation[] = []

    /**
     * List of GLTF animations loaded with the models.
     * The animations are standard threejs AnimationClip and their AnimationAction. Each set of actions also has a mixer.
     */
    get animations() {
        return [...this._animations]
    }

    /**
     * If true, the animation time will be automatically incremented by the time delta, otherwise it has to be set manually between 0 and the animationDuration using `setTime`. (default: true)
     * Set it to false when controlling the time manually like when using the timeline or other custom controls.
     *
     * Note that this is not serialized, so it will not be saved in the scene file and must be set manually in the code.
     */
    autoIncrementTime = true

    /**
     * Loop the complete animation. All actions are looped either individually or together based on {@link syncMaxDuration}.
     * This happens {@link loopRepetitions} times.
     *
     * Note - only applicable when {@link autoIncrementTime} is true.
     */
    @onChange2(GLTFAnimationPlugin.prototype._onPropertyChange)
    @uiToggle('Loop')
    @serialize() loopAnimations = true

    /**
     * Number of times to loop the animation. (not individual actions)
     * Only applicable when {@link loopAnimations} is true.
     * @default Infinity
     */
    @onChange2(GLTFAnimationPlugin.prototype._onPropertyChange)
    @serialize() loopRepetitions = Infinity

    /**
     * Timescale for the animation. (not individual actions)
     * If set to 0, it will be ignored.
     */
    @uiSlider('Timescale', [-2, 2], 0.01)
    @serialize() timeScale = 1

    /**
     * Speed of the animation. (not individual actions)
     * This can be set to 0.
     */
    @uiSlider('Speed', [0.1, 4], 0.1) @serialize() animationSpeed = 1

    /**
     * Automatically track mouse wheel events to seek animations
     * Control damping/smoothness with {@link scrollAnimationDamping}
     * See also {@link animateOnPageScroll}. {@link animateOnDrag}
     */
    @uiToggle() @serialize() animateOnScroll = false

    /**
     * Damping for the scroll animation, when {@link animateOnScroll} is true.
     */
    @uiSlider('Scroll Damping', [0, 1]) @serialize() scrollAnimationDamping = 0.1

    /**
     * Automatically track scroll event in window and use `window.scrollY` along with {@link pageScrollHeight} to seek animations
     * Control damping/smoothness with {@link pageScrollAnimationDamping}
     * See also {@link animateOnDrag}, {@link animateOnScroll}
     */
    @uiToggle() @serialize() animateOnPageScroll = false

    /**
     * Damping for the scroll animation, when {@link animateOnPageScroll} is true.
     */
    @uiSlider('Page Scroll Damping', [0, 1]) @serialize() pageScrollAnimationDamping = 0.1

    /**
     * Automatically track drag events in either x or y axes to seek animations
     * Control axis with {@link dragAxis} and damping/smoothness with {@link dragAnimationDamping}
     */
    @uiToggle() @serialize() animateOnDrag = false

    /**
     * Axis to track for drag events, when {@link animateOnDrag} is true.
     * `x` will track horizontal drag, `y` will track vertical drag.
     */
    @uiDropdown('Drag Axis', [{label: 'x'}, {label: 'y'}])
    @serialize() dragAxis: 'x'|'y' = 'y'

    /**
     * Damping for the drag animation, when {@link animateOnDrag} is true.
     */
    @uiSlider('Drag Damping', [0, 1]) @serialize() dragAnimationDamping = 0.3

    /**
     * If true, the animation will be played automatically when the model(any model with animations) is loaded.
     */
    @uiToggle() @serialize() autoplayOnLoad = false

    /**
     * Force (not serialized) version of {@link autoplayOnLoad}, this will play the animation even if it {@link autoplayOnLoad} is disabled inside the saved file.
     */
    autoplayOnLoadForce = false

    /**
     * Sync the duration of all clips based on the max duration, helpful for things like timeline markers
     */
    @uiToggle('syncMaxDuration(dev)') @serialize() syncMaxDuration = false

    /**
     * Get the current state of the animation. (read only)
     * use {@link playAnimation}, {@link pauseAnimation}, {@link stopAnimation} to change the state.
     */
    @uiMonitor() get animationState(): 'none' | 'playing' | 'paused' | 'stopped' {
        return this._animationState
    }

    /**
     * Get the current animation time. (read only)
     * The time is managed automatically.
     * To manage the time manually set {@link autoIncrementTime} to false and use {@link setTime} to change the time.
     */
    @uiMonitor() get animationTime(): number {
        return this._animationTime
    }

    /**
     * Get the current animation duration (max of all animations). (read only)
     */
    @uiMonitor() get animationDuration(): number {
        return this._animationDuration
    }


    @uiButton('Play/Pause', (that: GLTFAnimationPlugin)=>({
        label:()=> that.animationState === 'playing' ? 'Pause' : 'Play',
    }))
    playPauseAnimation() {
        this._animationState === 'playing' ? this.pauseAnimation() : this.playAnimation()
    }

    @onChange(GLTFAnimationPlugin.prototype.onStateChange)
    protected _animationState: 'none' | 'playing' | 'paused' | 'stopped' = 'none'

    private _lastAnimationTime = 0
    private _animationTime = 0
    private _animationDuration = 0
    private _scrollAnimationState = 0
    private _pageScrollAnimationState = 0
    private _dragAnimationState = 0
    private _pointerDragHelper = new PointerDragHelper()
    private _lastFrameTime = 0
    private _fadeDisabled = false

    constructor() {
        super()
        this.playClips = this.playClips.bind(this)
        this.playClip = this.playClip.bind(this)
        this.playAnimation = this.playAnimation.bind(this)
        this.playPauseAnimation = this.playPauseAnimation.bind(this)
        this.pauseAnimation = this.pauseAnimation.bind(this)
        this.stopAnimation = this.stopAnimation.bind(this)
        this.resetAnimation = this.resetAnimation.bind(this)
        this._onPropertyChange = this._onPropertyChange.bind(this)
        this._postFrame = this._postFrame.bind(this)
        this._wheel = this._wheel.bind(this)
        this._scroll = this._scroll.bind(this)
        this._pointerDragHelper.addEventListener('drag', this._drag.bind(this))
    }

    setTime(time: number) {
        this._animationTime = Math.max(0, Math.min(time, this._animationDuration))
    }


    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        viewer.object3dManager.getObjects().forEach(object=>this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
        viewer.scene.addEventListener('sceneUpdate', this._sceneUpdate)
        viewer.addEventListener('postFrame', this._postFrame)
        window.addEventListener('wheel', this._wheel)
        window.addEventListener('scroll', this._scroll)
        this._pointerDragHelper.element = viewer.canvas
    }

    onRemove(viewer: ThreeViewer): void {
        while (this._animations.length) this._animations.pop()
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object=>this._objectRemove({object}))
        viewer.scene.removeEventListener('sceneUpdate', this._sceneUpdate)
        viewer.removeEventListener('postFrame', this._postFrame)
        window.removeEventListener('wheel', this._wheel)
        window.removeEventListener('scroll', this._scroll)
        this._pointerDragHelper.element = undefined
        return super.onRemove(viewer)
    }

    public onStateChange(): void {
        this.uiConfig?.uiRefresh?.(true, 'postFrame')
        // this.uiConfig?.children?.map(value => value && getOrCall(value)).flat(2).forEach(v=>v?.uiRefresh?.())
    }

    /**
     * This will play a single clip by name
     * It might reset all other animations, this is a bug; https://codepen.io/repalash/pen/mdjgpvx
     * @param name
     * @param resetOnEnd
     */
    async playClip(name: string, resetOnEnd = false) {
        return this.playClips([name], resetOnEnd)
    }
    async playClips(names: string[], resetOnEnd = false) {
        const anims: AnimationAction[] = []
        this._animations.forEach(({actions})=>{
            actions.forEach((action)=>{
                if (names.includes(action.getClip().name)) {
                    anims.push(action)
                }
            })
        })
        return this.playAnimation(resetOnEnd, anims)
    }

    private _lastAnimId = ''
    /**
     * If true, will stop the animation when the animation ends. (when not looping)
     */
    stopOnCheckpointEnd = true

    autoUnpauseActions = true
    autoEnableActions = true
    activeActionWeight: number | null = 1
    inactiveActionWeight: number | null = 0

    /**
     * Starts all the animations and returns a promise that resolves when all animations are done.
     * @param resetOnEnd - if true, will reset the animation to the start position when it ends.
     * @param animations - play specific animations, otherwise play all animations. Note: the promise returned (if this is set) from this will resolve before time if the animations was ever paused, or converged mode is on in recorder.
     */
    async playAnimation(resetOnEnd = false, animations?: AnimationAction[]): Promise<void> {
        if (this.isDisabled()) return
        let wasPlaying = false
        if (this._animationState === 'playing') {
            this.stopAnimation(false) // stop and play again. reset is done below.
            wasPlaying = true
        }
        // safeSetProperty(this._viewer?.getPlugin<PickingPlugin>('Picking')?.transformControls, 'enabled', false)
        let duration = 0
        const isAllAnimations = !animations
        if (!animations) {
            animations = []
            this._animations.forEach(({actions}) => {
                // console.log(mixer, actions, clips)
                animations!.push(...actions)
            })
        }
        if (wasPlaying)
            this.resetAnimation()
        else if (this.animationState !== 'paused') {
            animations.forEach((ac)=>{
                ac.reset()
            })
            this._animationTime = 0
        }

        const id = generateUUID()
        this._lastAnimId = id // todo: check logic
        for (const ac of animations) {
            // if (Math.abs(this.timeScale) > 0) {
            //     if (!(ac as any)._tTimeScale) (ac as any)._tTimeScale = ac.timeScale
            //     ac.timeScale = this.timeScale
            // } else if ((ac as any)._tTimeScale) ac.timeScale = (ac as any)._tTimeScale
            ac.setLoop(this.loopAnimations ? LoopRepeat : LoopOnce, this.loopRepetitions)
            ac.play()
            duration = Math.max(duration, ac.getClip().duration / Math.abs(ac.timeScale))
            // if (!this._playingActions.includes(ac)) this._playingActions.push(ac)
            // console.log(ac)
        }
        this._animationState = 'playing'
        this._viewer?.setDirty()
        if (!isAllAnimations) {
            const loops = this.loopAnimations ? this.loopRepetitions : 1
            duration *= loops
            if (!isFinite(duration)) {
                // infinite animation
                return
            }

            await new Promise<void>((resolve) => {
                const listen = (e: any) => {
                    if (e.time >= duration) {
                        this.removeEventListener('animationStep', listen)
                        resolve()
                    }
                }
                this.addEventListener('animationStep', listen)
            })

            // const animDuration = 1000 * duration - this._animationTime / this.animationSpeed + 0.01
            //
            // if (animDuration > 0) {
            //     await timeout(animDuration)
            //     return
            // } // todo: handle pausing/early stop, converge mode for single animation playback
        } else {
            if (!isFinite(this._animationDuration)) {
                // infinite animation
                return
            }
            await new Promise<void>((resolve) => {
                const listen = () => {
                    this.removeEventListener('checkpointEnd', listen)
                    resolve()
                }
                this.addEventListener('checkpointEnd', listen)
            })
        }
        if (id === this._lastAnimId && this.stopOnCheckpointEnd) { // in-case multiple animations are started.
            this.stopAnimation(resetOnEnd)
        }
        return
    }

    pauseAnimation() {
        if (this._animationState !== 'playing') {
            console.warn('pauseAnimation called when animation was not playing.')
            return
        }
        this._animationState = 'paused'
        // safeSetProperty(this._viewer?.getPlugin<PickingPlugin>('Picking')?.transformControls, 'enabled', true)
        this._viewer?.setDirty()
        // this._lastAnimId = '' // this disables stop on timeout end, for now.
    }
    resumeAnimation() {
        if (this._animationState !== 'paused') {
            console.warn('resumeAnimation called when animation was not paused.')
            return
        }
        this._animationState = 'playing'
        // safeSetProperty(this._viewer?.getPlugin<PickingPlugin>('Picking')?.transformControls, 'enabled', true)
        this._viewer?.setDirty()
    }

    @uiButton('Stop', {sendArgs: false})
    stopAnimation(reset = false) {
        this._animationState = 'stopped'
        // safeSetProperty(this._viewer?.getPlugin<PickingPlugin>('Picking'), 'enabled', true)
        if (reset) this.resetAnimation()
        else this._viewer?.setDirty()
        this._lastAnimId = ''

        if (this._viewer && this._fadeDisabled) {
            this._viewer.getPlugin<FrameFadePlugin>('FrameFade')?.enable(this)
            this._fadeDisabled = false
        }

    }

    @uiButton('Reset', {sendArgs: false})
    resetAnimation() {
        if (this._animationState !== 'stopped' && this._animationState !== 'none') {
            this.stopAnimation(true) // reset and stop
            return
        }
        this._animations.forEach(({mixer}) => {
            // console.log(mixer, actions, clips)
            mixer.stopAllAction()
            mixer.setTime(0)
        })
        this._animationTime = 0
        this._viewer?.setDirty()
    }


    protected _postFrame() {
        if (!this._viewer) return

        const scrollAnimate = this.animateOnScroll //  && this._animationState === 'paused'
        const pageScrollAnimate = this.animateOnPageScroll //  && this._animationState === 'paused'
        const dragAnimate = this.animateOnDrag //  && this._animationState === 'paused'
        // const timelineRunning = this._viewer.timeline.shouldRun()

        if (this.isDisabled() || this._animations.length < 1 || this._animationState !== 'playing'/* && !scrollAnimate && !dragAnimate && !pageScrollAnimate && !timelineRunning*/) {
            this._lastFrameTime = 0
            // console.log('not anim')
            if (this._fadeDisabled) {
                this._viewer.getPlugin<FrameFadePlugin>('FrameFade')?.enable(this)
                this._fadeDisabled = false
            }
            return
        }

        const animTime1 = this._animationTime

        if (this.autoIncrementTime || pageScrollAnimate || scrollAnimate || dragAnimate) {
            const time = now() / 1000.0
            if (this._lastFrameTime < 1) this._lastFrameTime = time - 1.0 / 30.0
            let delta = time - this._lastFrameTime
            delta *= this.animationSpeed

            this._lastFrameTime = time

            if (pageScrollAnimate) delta *= this._pageScrollAnimationState
            else if (scrollAnimate && dragAnimate) delta *= absMax(this._scrollAnimationState, this._dragAnimationState)
            else if (scrollAnimate) delta *= this._scrollAnimationState
            else if (dragAnimate) delta *= this._dragAnimationState

            // if (Math.abs(delta) < 0.0001) return

            const d = this._viewer.getPlugin<ProgressivePlugin>('Progressive')?.postFrameConvergedRecordingDelta()
            if (d && d > 0) delta = d
            if (d === 0) delta = 0 // not converged yet.
            // if d < 0: not recording, do nothing

            const ts = Math.abs(this.timeScale)
            this._animationTime += delta * (ts > 0 ? ts : 1)
        } else {
            const time = now() / 1000.0
            // if (this._lastFrameTime < 1) this._lastFrameTime = time - 1.0 / 30.0
            // let delta = time - this._lastFrameTime
            // delta *= this.animationSpeed

            this._lastFrameTime = time

            // const d = this._viewer.timeline.delta
            // if (d < 0.0001 && this._viewer.timeline.running) return // no delta, no animation

            // todo animationSpeed
            // this._animationTime = this._viewer.timeline.time
            const ts = Math.abs(this.timeScale) * this.animationSpeed
            // if (d > 0.0001) {
            //     this._animationTime += d * (ts > 0 ? ts : 1)
            // } else {
            this._animationTime = this._viewer.timeline.time * (ts > 0 ? ts : 1)
            // }

            // const time = this._viewer.timeline.time
            // if (this._lastFrameTime < 1) this._lastFrameTime = Math.min(time - 1.0 / 60.0, time - this._viewer.timeline.delta)
            // let delta = time - this._lastFrameTime
            // delta *= this.animationSpeed
            //
            // this._lastFrameTime = time
            //
            // if (pageScrollAnimate) delta *= this._pageScrollAnimationState
            // else if (scrollAnimate && dragAnimate) delta *= absMax(this._scrollAnimationState, this._dragAnimationState)
            // else if (scrollAnimate) delta *= this._scrollAnimationState
            // else if (dragAnimate) delta *= this._dragAnimationState
            //
            // // if (Math.abs(delta) < 0.0001) return
            //
            // // const d = this._viewer.getPlugin<ProgressivePlugin>('Progressive')?.postFrameConvergedRecordingDelta()
            // // if (d && d > 0) delta = d
            // // if (d === 0) delta = 0 // not converged yet.
            // // if d < 0: not recording, do nothing
            //
            // const ts = Math.abs(this.timeScale)
            // this._animationTime += delta * (ts > 0 ? ts : 1)

        }

        const animDelta = this._animationTime - this._lastAnimationTime

        this._lastAnimationTime = this._animationTime

        if (Math.abs(animDelta) < 0.0001) return

        if (animTime1 < 0.0001) {
            this.dispatchEvent({type: 'checkpointBegin'})
        }

        const t = this.timeScale < 0 ?
            (isFinite(this._animationDuration) ? this._animationDuration : 0) - this._animationTime :
            this._animationTime

        this._animations.map(a=>{
            a.actions.forEach(a1=>{
                const startTime = a1.clipData?.startTime || 0
                if (a1.clipData?.timeScale !== undefined) {
                    a1.timeScale = a1.clipData.timeScale
                }
                if (startTime !== undefined && a1._startTime === null || a1._startTime !== startTime) {
                    // a1.startAt(startTime)
                    a1._startTime = startTime
                }

                let clipDuration = a1.getClip().duration
                if (this.autoIncrementTime && this.loopAnimations) {
                    clipDuration *= this.loopRepetitions
                }

                const isActive = t >= startTime && (!isFinite(clipDuration) || t < clipDuration / Math.abs(a1.timeScale) + startTime)

                if (this.autoUnpauseActions && a1.paused && isActive) {
                    a1.paused = false
                }
                if (this.autoEnableActions && !a1.enabled && isActive) {
                    a1.enabled = true
                }
                if (this.inactiveActionWeight !== null && !isActive && a1.weight) {
                    a1.setEffectiveWeight(this.inactiveActionWeight)
                } else if (this.activeActionWeight !== null && isActive && !a1.weight) {
                    a1.setEffectiveWeight(this.activeActionWeight)
                }
                // if (a.paused) {
                //     console.warn(a)
                // }
            })
            a.mixer.setTime(t)
        })

        // if (this._animationTime > this._animationDuration) this._animationTime -= this._animationDuration
        // if (this._animationTime < 0) this._animationTime += this._animationDuration

        this._pageScrollAnimationState = this.pageScrollTime - this._animationTime
        if (Math.abs(this._pageScrollAnimationState) < 0.001) this._pageScrollAnimationState = 0
        else this._pageScrollAnimationState *= 1.0 - this.pageScrollAnimationDamping

        if (Math.abs(this._scrollAnimationState) < 0.001) this._scrollAnimationState = 0
        else this._scrollAnimationState *= 1.0 - this.scrollAnimationDamping

        if (Math.abs(this._dragAnimationState) < 0.001) this._dragAnimationState = 0
        else this._dragAnimationState *= 1.0 - this.dragAnimationDamping

        this.dispatchEvent({type: 'animationStep', delta: animDelta, time: t})

        // todo: this is now checked preFrame in ThreeViewer.ts
        // if (this._viewer.scene.mainCamera.userData.isAnimating) { // if camera is animating
        // this._viewer.scene.mainCamera.setDirty()
        // console.log(this._viewer.scene.mainCamera, this._viewer.scene.mainCamera.getWorldPosition(new Vector3()))
        // }

        this._viewer.renderManager.resetShadows()
        this._viewer.setDirty()

        if (!this._fadeDisabled) {
            const ff = this._viewer.getPlugin<FrameFadePlugin>('FrameFade')
            if (ff) {
                ff.disable(GLTFAnimationPlugin.PluginType)
                this._fadeDisabled = true
            }
        }

        if (this._animationTime >= this._animationDuration) {
            this.dispatchEvent({type: 'checkpointEnd'})
        }
    }

    // protected _rootClips: Set<AnimationClip> = new Set()

    private _objectAdd = (ev: {object?: IObject3D})=>{
        const object = ev.object
        if (!this._viewer || !object) return
        let changed = false
        // const isInRoot = ev.options?.addToRoot // for model stage etc

        const s = this._refreshAnimations(object, object)
        if (s) changed = true

        // this.playAnimation()
        if (changed) {
            this._onPropertyChange(!this.autoplayOnLoad)
            if (this.autoplayOnLoad || this.autoplayOnLoadForce || this._animationState === 'playing') {
                // note play animation also resets the time to 0 if autoIncrementTime is true, todo is this idea?
                this.playAnimation()
            }
        }
    }

    private _objectRemove = (ev: {object: IObject3D})=>{
        const object = ev.object as IObject3D
        if (!this._viewer || !object) return
        const animation = this._animations.find(a => a.object === object)
        if (!animation) return

        animation.mixer.stopAllAction()

        this._animations.splice(this._animations.indexOf(animation), 1)
        this.dispatchEvent({type: 'removeAnimation', animation})

    }

    private _refreshAnimations(obj: IObject3D, root: IObject3D) {
        if (!this._viewer) return false
        const clips: AnimationClip[] = obj.animations
        if (clips.length < 1) return false

        let animation = this._animations.find(a => a.object === obj)

        animation = animation || {
            object: obj,
            mixer: new AnimationMixer(root),
            clips: [],
            actions: [],
            duration: 0,
        }
        animation.clips = clips

        animation.duration = Math.max(...clips.map(an => an.duration))

        //  so that looping works in sync
        if (root.userData.gltfAnim_SyncMaxDuration ?? this.syncMaxDuration) {
            clips.forEach(cp => cp.duration = animation.duration)
            root.userData.gltfAnim_SyncMaxDuration = true
        }

        const actions = clips.flatMap(clip => {
            if (!clip.userData.clipActions) {
                clip.userData.clipActions = {}
            }
            const existing = clip.userData.clipActions?.[obj.uuid]
            if (existing && existing.length) {
                const r = []
                for (const data of existing) {
                    const a = animation.actions.find(a1=>a1.clipData?.uid === data.uid)
                    if (a) r.push(a)
                }
                if (r.length) return r
            }
            if (!existing) {
                clip.userData.clipActions[obj.uuid] = []
            }

            const action = animation.mixer.clipAction(clip)
            action.clipData = {
                uid: generateUUID(),
                name: clip.name,
                startTime: 0,
                timeScale: 1,
            }
            action.setLoop(this.loopAnimations ? LoopRepeat : LoopOnce, this.loopRepetitions)
            clip.userData.clipActions[obj.uuid].push(action.clipData)
            return action
        })

        animation.actions = actions

        animation.actions.forEach(ac => ac.clampWhenFinished = true)

        this._animations.push(animation)
        this.dispatchEvent({type: 'addAnimation', animation})
        // todo remove on object dispose/remove

        return true
    }

    protected _sceneUpdate: EventListener2<'sceneUpdate', ISceneEventMap, Scene> = (_ev)=>{
        if (!this._viewer) return
        const changed = this._refreshAnimations(this._viewer.scene.modelRoot, this._viewer.scene.modelRoot)
        if (changed) {
            this._onPropertyChange(!this.autoplayOnLoad)
            if (this.autoplayOnLoad || this.autoplayOnLoadForce || this._animationState === 'playing') this.playAnimation()
        }

    }

    private _onPropertyChange(replay = true): void {
        this._animationDuration = Math.max(...this._animations.map(({duration})=>duration)) * (this.loopAnimations ? this.loopRepetitions : 1)
        if (this._animationState === 'playing' && replay !== false) {
            this.playAnimation()
        }
    }

    get pageScrollTime() {
        const scrollMax = this.pageScrollHeight()
        const time = window.scrollY / scrollMax * (this.animationDuration - 0.05)
        return time
    }

    private _scroll() {
        if (this.isDisabled()) return
        this._pageScrollAnimationState = this.pageScrollTime - this.animationTime
    }

    private _wheel({deltaY}: any | WheelEvent) {
        if (this.isDisabled()) return
        if (Math.abs(deltaY) > 0.001)
            this._scrollAnimationState = -1. * Math.sign(deltaY)
    }

    private _drag(ev: any) {
        if (this.isDisabled() || !this._viewer) return
        this._dragAnimationState = this.dragAxis === 'x' ?
            ev.delta.x * this._viewer.canvas.width / 4 :
            ev.delta.y * this._viewer.canvas.height / 4
    }


    pageScrollHeight = () => Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
    ) - window.innerHeight


}

declare module 'three'{
    interface AnimationAction{
        _startTime: number | null
        clipData?: { // serialized data
            uid: string
            name: string
            startTime: number
            timeScale: number
        }
    }
}
