import {getOrCall, serialize} from 'ts-browser-helpers'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {generateUiConfig, UiObjectConfig} from 'uiconfig.js'
import {AnimationResult, PopmotionPlugin} from './PopmotionPlugin'
import {AnimationObject, AnimationObjectEventMap} from '../../utils/AnimationObject'
import {IMaterial, IObject3D} from '../../core'
import {createDiv, createStyles, UndoManagerPlugin} from '../../index'
import {Driver} from '@repalash/popmotion'
import {Event2} from 'three'

export interface AnimationObjectPluginEventMap extends AViewerPluginEventMap, AnimationObjectEventMap{
    rebuildTimeline: {timeline: [AnimationObject, AnimationResult][]}
    animationUpdate: {animation: AnimationObject}
}

/**
 * Animation Object Plugin
 *
 * This plugin allows you to create and manage animation objects for properties in the viewer, plugins, objects, materials etc.
 * Animation objects are serializable javascript objects that bind to a property, and can animate it over time across keyframes.
 *
 * Animation Object plugin adds support for creating animations bound to viewer and plugins and serializing them along with this plugin.
 * Also adds support for tracking and playback of animation objects in the userData of objects and materials.
 *
 * All the tracked animations are played on load and synced with the viewer timeline if its active.
 *
 * This plugin also adds trigger buttons for creating and editing animation objects, keyframes, for the ui config.
 */
// @uiFolder('Viewer Animations') // todo rename plugin to Property Animation plugin?
export class AnimationObjectPlugin extends AViewerPluginSync<AnimationObjectPluginEventMap> {
    public static readonly PluginType = 'AnimationObjectPlugin'
    enabled = true

    dependencies = [PopmotionPlugin]

    /**
     * Main animation with target = viewer for global properties
     */
    @serialize()
    // @uiConfig()
    readonly animation: AnimationObject = new AnimationObject(()=>this._viewer, ()=>this._viewer, 'Viewer Animation')

    readonly runtimeAnimation: AnimationObject = new AnimationObject(undefined, ()=>this._viewer, 'Runtime Animation')

    // /**
    //  * Animations that are tracked in the scene, bound to objects, materials etc
    //  */
    // animations: Set<AnimationObject> = new Set()

    getAllAnimations() {
        return [...this.animation.animSet, ...this.runtimeAnimation.animSet]
    }

    // private _fAnimationAdd = (e: Event2<'animationAdd', AnimationObjectEventMap, AnimationObject>)=>{
    //     this.rebuildTimeline()
    //     this.dispatchEvent(e)
    // }
    private _fAnimationAdd = (e: AnimationObjectEventMap['animationAdd'])=>{
        this.rebuildTimeline()
        this.dispatchEvent({...e, type: 'animationAdd'})
    }
    private _fAnimationRemove = (e: Event2<'animationRemove', AnimationObjectEventMap, AnimationObject>)=>{
        this.rebuildTimeline()
        this.dispatchEvent(e)

        if (e.fromChild && e.target === this.runtimeAnimation) {
            const obj = e.animation.target
            if (obj?.userData?.animationObjects) this._removeAnimationFromObject(e.animation, obj as any)
            const visibleBtns = this._visibleBtns.get(e.animation)
            if (visibleBtns) {
                visibleBtns.forEach(btn => this._refreshTriggerBtn(e.animation, btn))
            }
        } else {
            this._visibleBtns.delete(e.animation)
        }
    }
    private _fAnimationUpdate = (e: Event2<'update', AnimationObjectEventMap, AnimationObject>)=>{
        this.rebuildTimeline()
        this.dispatchEvent({...e, type: 'animationUpdate', animation: e.target})

        const visibleBtns = this._visibleBtns.get(e.target)
        if (visibleBtns) {
            visibleBtns.forEach(btn => this._refreshTriggerBtn(e.target, btn))
        }
    }
    private _viewerTimelineUpdate = ()=>{
        if (!this._viewer) return
        this._visibleBtns.forEach((btns, ao) => {
            btns.forEach(btn => this._refreshTriggerBtn(ao, btn))
        })
    }
    private _refreshTriggerBtn = (ao: AnimationObject, btn: HTMLElement) => {
        const activeIndex = this._getActiveIndex(ao)

        btn.dataset.activeIndex = activeIndex
        if (activeIndex.length) {
            btn.classList.add('anim-object-uic-trigger-active')
        } else {
            btn.classList.remove('anim-object-uic-trigger-active')
        }
    }

    private _getActiveIndex(ao: AnimationObject<any>) {
        if (!ao.target) return ''
        const cTime = 1000 * (this._viewer?.timeline.time || 0) // current time in ui
        const localTime = (cTime - ao.delay) / ao.duration
        const offsetTimes = ao.offsets
        const closestIndex = offsetTimes.reduce((prev, curr, index) => {
            return Math.abs(curr - localTime) < Math.abs(offsetTimes[prev] - localTime) ? index : prev
        }, 0)
        const dist = Math.abs(offsetTimes[closestIndex] - localTime)
        const activeIndex = dist * ao.duration < 50 ? closestIndex.toString() : ''
        return activeIndex
    }

    private _triggerButtonsShown = false
    get triggerButtonsShown() {
        return this._triggerButtonsShown
    }
    set triggerButtonsShown(v: boolean) {
        this._triggerButtonsShown = v
        if (v) document.body.classList.add('aouic-triggers-visible')
        else document.body.classList.remove('aouic-triggers-visible')
    }
    showTriggers(v = true) {
        this.triggerButtonsShown = v
    }

    constructor() {
        super()
        this.animation.animSetParallel = true
        this.animation.uiConfig.uiRefresh = (...args)=>this.uiConfig.uiRefresh?.(...args)
        this.animation.addEventListener('animationAdd', this._fAnimationAdd)
        this.animation.addEventListener('animationRemove', this._fAnimationRemove)
        this.animation.addEventListener('update', this._fAnimationUpdate)
        this.runtimeAnimation.animSetParallel = true
        this.runtimeAnimation.uiConfig.uiRefresh = (...args)=>this.uiConfig.uiRefresh?.(...args)
        this.runtimeAnimation.addEventListener('animationAdd', this._fAnimationAdd)
        this.runtimeAnimation.addEventListener('animationRemove', this._fAnimationRemove)
        this.runtimeAnimation.addEventListener('update', this._fAnimationUpdate)
        this._fAnimationAdd({animation: this.animation})

        createStyles(`
        .anim-object-uic-trigger{
            padding: 4px;
            margin-top: -4px;
            cursor: pointer;
            color: var(--tp-label-foreground-color, #777);
            display: none;
        }
        .anim-object-uic-trigger-visible{
        }
        .anim-object-uic-trigger-active{
            color: red;
        }
        .aouic-triggers-visible .anim-object-uic-trigger{
            display: inline-block;
        }
        `)
    }

    // uiConfig = this.animation.uiConfig

    private _currentTimeline: [AnimationObject, AnimationResult][] = []
    private _refTimeline = false
    rebuildTimeline() {
        this._refTimeline = true
    }
    protected _viewerListeners = {
        postFrame: ()=>{
            const pop = this._viewer?.getPlugin(PopmotionPlugin)
            if (this._refTimeline && pop) {
                this._refTimeline = false
                this._currentTimeline.forEach(([_, r]) => r.stop())
                this._currentTimeline = this.getAllAnimations().map(o => [o, pop.animateObject(o, 0, false, this.popmotionDriver)])
                this.dispatchEvent({type: 'rebuildTimeline', timeline: this._currentTimeline})
            }
        },
        preFrame: ()=>{
            if (!this._viewer) return
            if (this.isDisabled() || Object.keys(this._updaters).length < 1) {
                this._lastFrameTime = 0
                return
            }

            const time = this._viewer.timeline.time * 1000
            // if (this._lastFrameTime < 1) this._lastFrameTime = time - 1.0 / 60.0
            const delta = time - this._lastFrameTime

            this._lastFrameTime = time

            if (Math.abs(delta) <= 0.0001) return

            this._updaters.forEach(u=>{
                let dt = delta
                if (u.time !== time) dt = time - u.time
                if (u.time + dt < 0) dt = -u.time
                u.time += dt
                if (Math.abs(dt) > 0.001) u.u(dt)
            })
        },
    }
    getTimeline() {
        return this._currentTimeline
    }

    addAnimation(access?: string, target?: any, anim?: AnimationObject) {
        anim = anim || new AnimationObject()
        if (access !== undefined) anim.access = access
        if (!target?.userData) {
            if (!this.animation.animSet.includes(anim))
                this.animation.add(anim)
        } else {
            if (!target.userData.animationObjects) target.userData.animationObjects = []
            if (!target.userData.animationObjects.includes(anim)) {
                target.userData.animationObjects.push(anim)
                this._addAnimationObject(anim, target)
                this._setupUiConfig(target)
            }
        }
        return anim
    }
    removeAnimation(anim: AnimationObject, target?: any) {
        if (!target?.userData) {
            this.animation.remove(anim)
        } else {
            this._removeAnimationFromObject(anim, target)
            this._removeAnimationObject(anim)
            this._cleanUpUiConfig(target)
        }
    }

    private _objectAdd = (e: {object?: IObject3D})=>{
        const obj = e.object
        if (!obj) return
        if (Array.isArray(obj.userData.animationObjects)) {
            obj.userData.animationObjects.forEach(ao=> this._addAnimationObject(ao, obj))
        }
        this._setupUiConfig(obj)
    }

    private _objectRemove = (e: {object?: IObject3D})=>{
        const obj = e.object
        if (!obj) return
        if (Array.isArray(obj.userData.animationObjects)) {
            obj.userData.animationObjects.forEach(ao=> this._removeAnimationObject(ao))
        }
        this._cleanUpUiConfig(obj)
    }

    private _materialAdd = (e: {material?: IMaterial})=>{
        const obj = e.material
        if (!obj) return
        if (Array.isArray(obj.userData.animationObjects)) {
            obj.userData.animationObjects.forEach(ao=> this._addAnimationObject(ao, obj))
        }
        this._setupUiConfig(obj)
    }

    private _materialRemove = (e: {material?: IMaterial})=>{
        const obj = e.material
        if (!obj) return
        if (Array.isArray(obj.userData.animationObjects)) {
            obj.userData.animationObjects.forEach(ao=> this._removeAnimationObject(ao))
        }
        this._cleanUpUiConfig(obj)
    }

    private _addAnimationObject(ao: AnimationObject, obj: IObject3D|IMaterial) {
        ao.target = obj
        this.runtimeAnimation.add(ao)
    }

    private _removeAnimationObject(ao: AnimationObject) {
        this.runtimeAnimation.remove(ao)
        ao.target = undefined
    }
    private _removeAnimationFromObject(ao: AnimationObject, obj: IObject3D|IMaterial) {
        ao.target = undefined
        if (!obj.userData.animationObjects) return
        const ind = obj.userData.animationObjects.indexOf(ao)
        if (ind >= 0) {
            obj.userData.animationObjects.splice(ind, 1)
            if (obj.userData.animationObjects.length < 1) {
                delete obj.userData.animationObjects
            }
        }
    }

    private _visibleBtns = new Map<AnimationObject, Set<HTMLElement>>()
    private _iObservers = new Map<string, Set<IntersectionObserver>>()

    private _setupUiConfig(obj: IObject3D | IMaterial) {
        const type = (obj as IObject3D).isObject3D ? 'objects' : (obj as IMaterial).isMaterial ? 'materials' : undefined
        if (!type) return
        obj.uiConfig?.children?.push({
            type: 'folder',
            label: 'Property Animations',
            tags: ['animation', AnimationObjectPlugin.PluginType],
            children: [()=>obj.userData.animationObjects?.map(ao=>ao.uiConfig)],
        })
        const components = this._animatableUiConfigs(obj)
        for (const config of components) {
            const prop = getOrCall(config.property) // todo use uiconfigmethods
            if (!prop) continue
            const [tar, key] = prop
            if (!tar || typeof key !== 'string') continue
            const btn = createDiv({innerHTML: '◆', classList: ['anim-object-uic-trigger']})
            btn.dataset.isAnimObjectTrigger = '1'
            btn.title = 'Add Animation for ' + getOrCall(config.label, key) // todo use uiconfigmethods

            const getAo = () => {
                if (!obj.userData.animationObjects) obj.userData.animationObjects = []
                return obj.userData.animationObjects.find(o => o.access === key)
            }
            btn.addEventListener('click', () => {
                const undo = this._viewer?.getPlugin(UndoManagerPlugin) // todo use uiconfigmethods
                let ao = getAo()
                const cTime = 1000 * (this._viewer?.timeline.time || 0) // current time in ui
                if (!ao) {
                    ao = new AnimationObject()
                    // ao.access = type + '.' + obj.uuid + '.' + key
                    ao.access = key
                    ao.name = obj.name + ' ' + (getOrCall(config.label, key) || key)
                    ao.updateTarget = true // calls setDirty on obj on any change
                    ao.delay = cTime // current time in ui
                    ao.duration = 2000
                    const cao = ao
                    const c = {
                        redo: ()=>{
                            if (!obj.userData.animationObjects) obj.userData.animationObjects = []
                            obj.userData.animationObjects.push(cao)
                            this._addAnimationObject(cao, obj)
                            this._refreshTriggerBtn(cao, btn)
                        },
                        undo: ()=>{
                            cao.removeFromParent() // this will dispatch with fromChild = true
                            this._refreshTriggerBtn(cao, btn)
                        },
                    }
                    c.redo()
                    undo?.undoManager?.record(c)
                } else if (ao.values.length > 1) {
                    const cao = ao
                    const shownActiveIndex = btn.dataset.activeIndex || ''
                    const activeIndex = this._getActiveIndex(ao)
                    if (activeIndex === shownActiveIndex) {
                        const index = parseInt(activeIndex || '-1')
                        const ref = ()=> this._refreshTriggerBtn(cao, btn)
                        if (undo) {
                            if (index < 0) undo.performAction(ao, ao.addKeyframe, [cTime], 'addKeyframe-' + ao.access, ref)
                            else undo.performAction(ao, ao.updateKeyframe, [index], 'editKeyframe-' + ao.access, ref)
                            ref()
                        } else {
                            if (index < 0) ao.addKeyframe(cTime)
                            else ao.updateKeyframe(index)
                            ref()
                        }

                    } else {
                        // todo something else is shown in ui, maybe user didnt want this
                        console.error('Active index mismatch', activeIndex, shownActiveIndex)
                    }
                }
                // btn.remove()
                // config.domChildren = !config.domChildren || Array.isArray(config.domChildren) ? config.domChildren?.filter(d => d !== btn) || [] : config.domChildren
            })

            const btnObserver = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    if (entry.target !== btn) continue
                    const ao = getAo()
                    if (!ao) continue
                    if (!this._visibleBtns.has(ao)) this._visibleBtns.set(ao, new Set())
                    const btns = this._visibleBtns.get(ao)!
                    // console.log(entry.isIntersecting)
                    if (entry.isIntersecting) {
                        if (!btns.has(btn)) {
                            btn.classList.add('anim-object-uic-trigger-visible')
                            btns.add(btn)
                            // timeline time change
                            // animation object change
                        }
                    } else {
                        btn.classList.remove('anim-object-uic-trigger-visible')
                        btns.delete(btn)
                    }
                }
            })
            btnObserver.observe(btn)
            if (!this._iObservers.has(obj.uuid)) this._iObservers.set(obj.uuid, new Set())
            this._iObservers.get(obj.uuid)?.add(btnObserver)

            const ao = getAo()
            if (ao) this._refreshTriggerBtn(ao, btn)

            config.domChildren = !config.domChildren || Array.isArray(config.domChildren) ? [...config.domChildren || [], btn] : config.domChildren
        }
    }

    private _cleanUpUiConfig(obj: IObject3D | IMaterial) {
        const components = this._animatableUiConfigs(obj)
        const observers = this._iObservers.get(obj.uuid)
        for (const config of components) {
            config.domChildren = Array.isArray(config.domChildren) ? config.domChildren?.filter(d => !(d instanceof HTMLElement && d.dataset.isAnimObjectTrigger)) || [] : config.domChildren
        }
        if (observers) {
            observers.forEach(o => o.disconnect())
            observers.clear()
            this._iObservers.delete(obj.uuid)
        }
    }

    private _animatableUiConfigs(obj: IObject3D | IMaterial) {
        return obj.uiConfig?.children?.filter(c =>
            typeof c === 'object' && c.type &&
            ['vec3', 'color', 'number', 'checkbox', 'toggle'].includes(c.type) &&
            Array.isArray(c.property) && c.property[0] === obj
        ) as UiObjectConfig[] || []
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.addEventListener('materialAdd', this._materialAdd)
        viewer.object3dManager.addEventListener('materialRemove', this._materialRemove)
        viewer.timeline.addEventListener('update', this._viewerTimelineUpdate)

        ;(viewer as any)._animGetters = { // used in extractAnimationKey
            objects: (name: string, acc: string[])=>{
                if (!viewer) return undefined
                const obj = viewer.object3dManager.findObject(name)
                return {tar: obj, acc, onChange: obj ? ()=>{
                    obj.setDirty && obj.setDirty({refreshScene: false, frameFade: false})
                } : undefined}
            },
            materials: (name: string, acc: string[])=>{
                if (!viewer) return undefined
                const mat = viewer.object3dManager.findMaterial(name)
                return {tar: mat, acc, onChange: mat ? ()=>{
                    mat.setDirty && mat.setDirty({frameFade: false})
                } : undefined}
            },
        }
    }

    onRemove(viewer: ThreeViewer) {
        super.onRemove(viewer)
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.removeEventListener('materialAdd', this._materialAdd)
        viewer.object3dManager.removeEventListener('materialRemove', this._materialRemove)

        delete (viewer as any)._animGetters

    }

    fromJSON(data: any, meta?: any): this | null {
        if (!super.fromJSON(data, meta)) return null
        // this.animation.setTarget(() => this._viewer)
        return this
    }

    private _lastFrameTime = 0 // for post frame, in ms
    private _updaters: {u: ((timestamp: number) => void), time: number}[] = []

    readonly popmotionDriver: Driver = (update)=> ({
        start: () => this._updaters.push({u: update, time: 0}),
        stop: () => {
            this._updaters.splice(this._updaters.findIndex(u => u.u === update), 1)
        },
    })

    // override ui config for flatten hierarchy (for now)
    uiConfig: UiObjectConfig = {
        label: 'Viewer Animations',
        type: 'folder',
        children: [
            generateUiConfig(this.animation).filter(c=>{
                const label = getOrCall((c as UiObjectConfig)?.label) ?? '' as any
                // if (label === ('animSet' as (keyof AnimationObject))) return c.children
                return ['Animate', 'Stop', 'Animate Reverse'].includes(label)
            }) ?? [],
            ()=> {
                const c = generateUiConfig(this.animation.animSet)
                return c.map(d=>getOrCall(d)).filter(Boolean)
            },
            {
                type: 'checkbox',
                label: 'Run in Parallel',
                property: [this.animation, 'animSetParallel'],
            },
            {
                type: 'button',
                label: 'Add Animation',
                value: ()=>{
                    this.animation.addAnimation()
                    this.uiConfig.uiRefresh?.(true, 'postFrame', 1)
                },
            },
            {
                type: 'checkbox',
                label: 'Show Triggers',
                property: [this, 'triggerButtonsShown'],
            },
            // {
            //     type: 'button',
            //     label: 'Clear Animations',
            //     value: ()=>{
            //         this.animation.animSet = []
            //         this.animation.refreshUi()
            //     },
            // }
        ],
    }
}

declare module '../../assetmanager/IAssetImporter'{
    export interface IImportResultUserData{
        animationObjects?: AnimationObject[]
    }
}
