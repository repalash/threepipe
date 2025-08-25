import {deepAccessObject, getOrCall, onChange, serializable, serialize, ValOrFunc} from 'ts-browser-helpers'
import {
    generateUiConfig,
    generateValueConfig,
    IUiConfigContainer,
    uiButton,
    uiDropdown,
    UiObjectConfig,
    UiObjectType,
    uiSlider,
    uiToggle,
} from 'uiconfig.js'
import {generateUUID} from '../three'
import {AnimationOptions, Easing} from '@repalash/popmotion'
import {EasingFunctions, EasingFunctionType} from './animation'
import type {ThreeViewer} from '../viewer'
import {ThreeSerialization} from './serialization'
import type {AnimationResult, PopmotionPlugin} from '../plugins'
import {EventDispatcher} from 'three'

const viewerOptions = {
    'None': '',
    ['Background Color']: 'scene.backgroundColor',
    ['Environment Rotation']: 'scene.environment.rotation',
    ['Environment Intensity']: 'scene.envMapIntensity',
    // '[Fixed Env Map Direction']: 'scene.fixedEnvMapDirection',
    ['Camera Position']: 'scene.mainCamera.position',
    ['Camera Rotation']: 'scene.mainCamera.rotation',
    ['Camera Zoom']: 'scene.mainCamera.zoom',
    ['Camera FOV']: 'scene.mainCamera.fov',
    // '[Directional Light Color']: 'plugins.RandomizedDirectionalLight.light.color',
    // - todo dosent update shadows every frame
    // '[Directional Light Direction']: 'plugins.RandomizedDirectionalLight.light.randomParams.direction',
    // '[Diamond Env Map Rotation']: 'plugins.Diamond.envMap.rotation',
    ['Tonemap Exposure']: 'plugins.Tonemap.exposure',
    ['Tonemap Saturation']: 'plugins.Tonemap.saturation',
    ['Tonemap Contrast']: 'plugins.Tonemap.contrast',
    ['Tonemap Tone Mapping']: 'plugins.Tonemap.toneMapping',
    ['SSR Intensity']: 'plugins.SSReflection.passes.ssr.passObject.intensity',
    ['SSR Boost']: 'plugins.SSReflection.passes.ssr.passObject.boost',
    ['Chromatic Aberration Intensity']: 'plugins.ChromaticAberration.intensity',
    ['Film Grain Intensity']: 'plugins.FilmicGrain.intensity',
    ['Vignette Color']: 'plugins.Vignette.color',
    ['Vignette Power']: 'plugins.Vignette.power',
    ['Depth of Field Focal Point']: 'plugins.DepthOfField._focalPointHit',
    ['Depth of Field Near Far Blur Scale X']: 'plugins.DepthOfField.pass.nearFarBlurScale.x',
    ['Depth of Field Near Far Blur Scale Y']: 'plugins.DepthOfField.pass.nearFarBlurScale.y',
    ['Depth of Field Focal Depth Range Y']: 'plugins.DepthOfField.pass.focalDepthRange.y',
    ['Bloom Intensity']: 'plugins.Bloom.pass.intensity',
    ['Bloom Radius']: 'plugins.Bloom.pass.radius',
    ['Bloom Power']: 'plugins.Bloom.pass.power',
}

export type TUpdaterType = (()=>void)

export interface IAnimationObject<V> {
    access?: string, // dot separated target accessor. 'model.rotation' will give this.model.rotation
    duration?: number,
    delay?: number,
    ease?: Easing|EasingFunctionType;
    updater?: (TUpdaterType)[]; // dispatch update, default none
    animSet?: IAnimSet,
    animSetParallel?: boolean,
    name?: string,
    options: AnimationOptions<V>,
    // to?: V | ((fromVal:V, target: any)=>V),
    // from?: V,
    values: V[]
    offsets?: number[],

    animate?: (delay?: number, canComplete?: boolean)=>AnimationResult,
    result?: AnimationResult
    uiRef?: UiObjectConfig,
    uiObjectType?: UiObjectType,
    targetObject?: Record<string, any>,
}
export type IAnimSet = (IAnimationObject<any>)[]

export function extractAnimationKey(o: IAnimationObject<any>, extraGetters?: Record<string, (key: string, acc: string[])=>{tar: any, acc: string[], onChange?: ()=>void}|undefined>) {
    let acc = Array.from((o.access ?? '').split(/(?<!\\)\./)) // split by dot, but not escaped dots
    let tar: any = o.targetObject
    let onChange1: undefined | (()=>void) = undefined

    const key = acc.pop()?.replace(/\\\./g, '.') // deep access till the last element, then bind
    if (!key || key.length === 0) return {key: undefined, tar}

    extraGetters = extraGetters ?? tar?._animGetters // _animGetters are set in AnimationObjectPlugin
    const getterType = acc.length >= 1 ? acc[0] : undefined
    const getterName = acc.length >= 2 ? acc[1]?.replace(/\\\./g, '.') : undefined
    if (extraGetters && getterType && getterType in extraGetters && getterName) {
        acc = acc.slice(2)
        const res = extraGetters[getterType](getterName, acc)
        if (!res) tar = res
        else {
            tar = res.tar
            // acc = acc.slice(res.i + 1)
            acc = res.acc
            onChange1 = res.onChange ?? onChange1
        }
    }
    tar = deepAccessObject(acc, tar)
    return {key, tar, onChange: onChange1}
}

export interface AnimationObjectEventMap {
    'animationAdd': {animation: AnimationObject}
    'animationRemove': {animation: AnimationObject, fromChild: boolean}
    'update': object
}

/**
 * AnimationObject - An object for containing keyframe-based animation for properties
 *
 * AnimationObject extends popmotion and interfaces with the {@link ThreeViewer} to provide a keyframe animation system that can animate any accessible property
 * on objects, materials, or the viewer itself. It supports complex timing, easing, and serialization.
 *
 * It is used in {@link AnimationObjectPlugin}.
 *
 * Key Features:
 * - **Property Access**: Uses dot-notation strings to access nested properties (e.g., 'position.x', 'material.roughness')
 * - **Keyframe System**: Define multiple keyframes with custom timing and values
 * - **Easing Support**: Built-in easing functions or custom easing functions
 * - **Timeline Integration**: Seamlessly works with viewer's global timeline
 * - **Serialization**: Automatically saves/loads with scene data
 * - **UI Integration**: Generates UI controls and supports interactive editing
 * - **Hierarchical**: Can contain child animations for complex choreography
 *
 * @example Basic Animation
 * ```typescript
 * const anim = new AnimationObject(myObject)
 * anim.access = 'position.y'
 * anim.values = [0, 5, 0]
 * anim.offsets = [0, 0.5, 1]
 * anim.duration = 2000
 * anim.ease = (x: number) => 1 - Math.cos(x * Math.PI / 2) // Custom easeOutSine
 * anim.updateTarget = true
 * ```
 *
 * @example Complex Animation with Multiple Keyframes
 * ```typescript
 * const colorAnim = new AnimationObject(material)
 * colorAnim.access = 'color'
 * colorAnim.values = ['#ff0000', '#00ff00', '#0000ff', '#ff0000']
 * colorAnim.offsets = [0, 0.33, 0.66, 1]
 * colorAnim.duration = 4000
 * anim.ease = 'easeInOutSine'
 * colorAnim.delay = 500
 * ```
 *
 */
@serializable('AnimationObject')
export class AnimationObject<V = any> extends EventDispatcher<AnimationObjectEventMap> implements IAnimationObject<V>, IUiConfigContainer {
    uuid = generateUUID()
    setDirty = () => {
        // console.log('update')
        this.updater = []
        if (this.options) {
            this.options.repeatType = this.repeatType
            this.options.repeat = this.repeat
        }
        if (!this._upfn) return
        if (this.updateScene) this.updater.push(this._upfn.scene)
        if (this.updateCamera) this.updater.push(this._upfn.camera)
        if (this.updateViewer) this.updater.push(this._upfn.viewer)
        if (this.updateTarget) this.updater.push(this._upfn.target)
        this.dispatchEvent({type: 'update'})
    }

    @serialize()
    @onChange('setDirty')
        // @uiInput()
        name = ''

    @serialize()
    // @uiInput()
    // @uiDropdown('Property', Object.entries(options).map(([label, value])=>({label, value})))
    @onChange(AnimationObject.prototype._onAccessChanged)
        access = '' // dot separated target accessor. 'scene.modelRoot.rotation' will give this.model.rotation

    // @uiConfig(undefined, {params: (t: AnimationObject)=>({onChange: t.setDirty})})
    // @serialize() from?: V
    //
    // @uiConfig(undefined, {params: (t: AnimationObject)=>({onChange: t.setDirty})})
    // @serialize()
    //     to?: V // | ((fromVal: V, target: any) => V)

    @serialize()
        values: V[] = []
    @serialize()
        offsets: number[] = []

    @serialize()
        // @uiConfig()
        options: AnimationOptions<V> = { // extra options
        // onUpdate: (v: V)=>{
        //     console.log(v)
        // },
        // onPlay: ()=>{
        //     if (this.updateCamera) getOrCall(this.target)?.scene.mainCamera.setInteractions(false, this.uuid)
        // },
        // onStop: ()=>{
        //     if (this.updateCamera) getOrCall(this.target)?.scene.mainCamera.setInteractions(true, this.uuid)
        // },
        // onComplete: ()=>{
        //     if (this.updateCamera) getOrCall(this.target)?.scene.mainCamera.setInteractions(true, this.uuid)
        // },
        }

    @serialize()
    @uiSlider(undefined, [0, 10000], 1, (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        duration = 1000 // ms

    @serialize() @uiSlider(undefined, [0, 10000], 1, (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        delay = 0

    /**
     * Number of times to repeat the animation.
     * Doesn't work right now
     */
    @serialize()
    // @uiSlider(undefined, [0, 10], 1, (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        repeat = 0

    /**
     * Delay between repeats in milliseconds.
     * Doesn't work right now
     */
    @serialize()
    // @uiSlider(undefined, [0, 10], 1, (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        repeatDelay = 0

    /**
     * Type of repeat behavior.
     * - 'loop': repeats the animation from the beginning.
     * - 'reverse': plays the animation in reverse after it completes.
     * - 'mirror': plays the animation in reverse after it completes. todo only mirrors the time, not values?
     *
     * Doesn't work right now
     */
    @serialize()
    // @uiDropdown('repeatType', ['loop', 'reverse'/* , 'mirror'*/].map((label:string)=>({label})), (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        repeatType: 'loop' | 'reverse' | 'mirror' = 'reverse'

    @serialize() @uiDropdown('ease', Object.keys(EasingFunctions).map((label:string)=>({label})), (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        ease: EasingFunctionType = 'easeInOutSine'

    updater: TUpdaterType[] = []

    uiObjectType?: UiObjectType
    // targetObject?: Record<string, any>

    get targetObject(): Record<string, any>|undefined {
        return getOrCall(this.target) ?? this.parent?.targetObject
    }

    @serialize()
    @uiToggle(undefined, (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        updateScene = false

    @serialize()
    @uiToggle(undefined, (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        updateCamera = false

    @serialize()
    @uiToggle(undefined, (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        updateViewer = false

    @serialize()
    // @uiToggle(undefined, (t: AnimationObject)=>({hidden: ()=>!t.access}))
    @onChange('setDirty')
        updateTarget = false

    // uiConfig!: UiObjectConfig

    @onChange(AnimationObject.prototype._onAccessChanged)
        target?: Record<string, any>
    @onChange(AnimationObject.prototype._onAccessChanged)
    readonly viewer?: ValOrFunc<ThreeViewer|undefined>

    getViewer(): ThreeViewer|undefined {
        return this.viewer ? getOrCall(this.viewer) : this.parent?.getViewer()
    }

    constructor(target?: object|undefined, viewer?: ValOrFunc<ThreeViewer|undefined>, name = '') {
        super()
        this.target = target
        this.viewer = viewer
        this.name = name
        this.dispatchEvent = this.dispatchEvent.bind(this)
    }

    fromJSON(data1: any, meta?: any): this {
        let data = {...data1}
        if (data.access !== undefined) { // first set access so values are initialized
            this.access = data.access
            delete data.access
        }
        if (data.from !== undefined) { // old files with to/from
            data = {...data}
            data.values = [data.from, data.to]
            data.offsets = [0, 1]
            delete data.from
            delete data.to
        }
        ThreeSerialization.Deserialize(data, this, meta, true)
        this.animSet.map(i=>{
            i.parent = this
        })
        return this
    }

    private _lastAccess = ''
    private _lastTarget: any = undefined
    protected _onAccessChanged() {
        const tar = this.targetObject
        if (tar && tar === this.getViewer() && !Object.values(viewerOptions).includes(this.access)) this.access = '' // todo check for now...
        if (this.access !== this._lastAccess || !this.values.length || this._lastTarget !== tar && tar && this._lastTarget) {
            this._lastAccess = this.access
            const lastValues = this.values
            this.values = []
            this.offsets = []
            const clone = this._thisValueCloner()
            if (!clone) {
                this.refreshUi()
                return
            }
            this.values = [clone(), clone()]
            // todo improve merge. like it wont work with vectors right now. For that we need to check if primitive type is the same and/or call the .copy() function
            if (lastValues.length >= 2 && (
                typeof lastValues[0] === typeof this.values[0] && (typeof lastValues[0] !== 'object' || (lastValues[0] as any).type && (lastValues[0] as any).type === (this.values[0] as any)?.type)
            )) this.values = lastValues
            this.offsets = this.offsets.length === this.values.length ? this.offsets : [0, 1]
            this.refreshUi()
        }
    }
    private _thisValueCloner() {
        const {key, tar} = extractAnimationKey(this)
        const val = tar && key !== undefined ? tar[key] : null
        return val === undefined || val === null ? null : () => {
            if (!val) return val
            if (val.isColor) return '#' + val.getHexString()
            const res = typeof val.clone === 'function' ? val.clone() : typeof val === 'object' ? {...val} : val
            return res
        }
    }

    addKeyframe(time: number) {
        if (this.values.length < 2) {
            console.warn('AnimationObject: Values not initialized, cannot add keyframe', this)
            return
        }
        const value = this._thisValueCloner()
        if (!value) {
            console.warn('AnimationObject: No value to add keyframe for', this)
            return
        }
        const offsetTime = time - this.delay
        const duration = this.duration
        const delay = this.delay
        const offsets = [...this.offsets]
        const values = [...this.values]
        let offset = offsetTime / this.duration
        let index: number
        let newDuration = duration
        let newDelay = delay
        const newValues = [...this.values]
        const newOffsets = [...this.offsets]
        if (offset < 0) {
            const o = -offset
            offset = 0
            for (let i = 0; i < offsets.length; i++) {
                newOffsets[i] = (offsets[i] + o) / (1 + o)
            }
            newDuration = duration - offsetTime
            newDelay = delay + offsetTime
            index = 0
        } else if (offset > 1) {
            const o = offset - 1
            offset = 1
            for (let i = 0; i < offsets.length; i++) {
                newOffsets[i] = offsets[i] / (1 + o)
            }
            newDuration = offsetTime
            index = offsets.length
        } else {
            index = offsets.findIndex(o => o >= offset)
            if (index < 0) {
                index = this.offsets.length
            } else if (this.offsets[index] === offset) {
                console.warn('AnimationObject: Keyframe already exists at offset', offset, this)
                return
            }
        }
        const val = value()
        newValues.splice(index, 0, val)
        newOffsets.splice(index, 0, offset)
        const redo = ()=>{
            this.duration = newDuration
            this.delay = newDelay
            this.values = newValues
            this.offsets = newOffsets
            this.setDirty()
        }
        const undo = ()=>{
            this.duration = duration
            this.delay = delay
            this.values = values
            this.offsets = offsets
            this.setDirty()
        }
        redo()
        return {undo, redo}
    }

    updateKeyframe(index: number) {
        if (index < 0 || index >= this.values.length) {
            console.warn('AnimationObject: Invalid keyframe index', index, this)
            return
        }

        const value = this._thisValueCloner()
        if (!value) {
            console.warn('AnimationObject: No value to update keyframe for', this)
            return
        }
        const oldValue = this.values[index]
        const newValue = value()
        const redo = ()=>{
            this.values[index] = newValue
            this.setDirty()
        }
        const undo = ()=>{
            this.values[index] = oldValue
            this.setDirty()
        }
        redo()
        return {undo, redo}
    }

    isValueSame(index: number) {
        if (index < 0 || index >= this.values.length) {
            console.warn('AnimationObject: Invalid keyframe index', index, this)
            return false
        }

        const value = this._thisValueCloner()
        if (!value) {
            console.warn('AnimationObject: No value to update keyframe for', this)
            return false
        }
        const oldValue = this.values[index]
        const newValue = value()

        if (oldValue === newValue) return true
        if (typeof oldValue !== typeof newValue) return false
        if (typeof oldValue === 'object' && typeof newValue === 'object') {
            if ((oldValue as any)?.equals) {
                return (oldValue as any).equals(newValue)
            }
            if (newValue?.equals) {
                return newValue.equals(oldValue)
            }
        }
        return false
    }

    refreshUi() {
        this.setDirty()
        this.uiConfig?.uiRefresh?.(true, 'postFrame', 1)
    }

    parent?: AnimationObject

    add(o: AnimationObject) {
        this.animSet.push(o)
        o.parent = this
        this.dispatchEvent({type: 'animationAdd', animation: o})
        o.addEventListener('update', this.dispatchEvent)
        o.addEventListener('animationAdd', this.dispatchEvent)
        o.addEventListener('animationRemove', this.dispatchEvent)
        this.refreshUi()
    }
    remove(o: AnimationObject, fromChild = false) {
        const idx = this.animSet.indexOf(o)
        if (idx >= 0) {
            this.animSet.splice(idx, 1)
            o.parent = undefined
            this.dispatchEvent({type: 'animationRemove', animation: o, fromChild})
            o.removeEventListener('update', this.dispatchEvent)
            o.removeEventListener('animationAdd', this.dispatchEvent)
            o.removeEventListener('animationRemove', this.dispatchEvent)
            this.refreshUi()
        }
    }

    private _upfn = {
        viewer: () => this.getViewer()?.setDirty(),
        renderer: () => this.getViewer()?.renderManager.reset(),
        scene: () => {
            this.getViewer()?.scene.setDirty()
        },
        camera: () => this.getViewer()?.scene.mainCamera.setDirty(),
        target: () => {
            const t = this.targetObject
            if (t && typeof t.setDirty === 'function') {
                t.setDirty({frameFade: false, refreshScene: false, source: 'AnimationObject', key: this.access})
            }
        },
    }

    @uiButton('Animate')
    animate(delay = 0, canComplete = true): AnimationResult {
        // console.log('animate', this)
        if (typeof delay !== 'number' || isNaN(delay)) { // called from ui
            delay = 0
        }
        if (canComplete && this.result) {
            console.warn('AnimationObject: Already animating, stopping previous animation')
            this.stop()
        }
        const viewer = this.getViewer()
        const pop = viewer?.getPlugin<PopmotionPlugin>('PopmotionPlugin')
        if (!pop) {
            console.error(`AnimationObject: No ${!viewer ? 'viewer' : 'PopmotionPlugin'}`)
            const id = generateUUID()
            return {
                id,
                options: this.options,
                stop: () => {return},
                promise: Promise.resolve(id),
                anims: [],
                // completed: true,
            }
        }
        return pop.animateObject(this, 0, canComplete, undefined, delay)
    }

    result: AnimationResult|undefined

    // todo during reverse delay should be time - duration
    // @uiButton('Animate Reverse')
    // async animateReverse() {
    //     await this.animate(true)
    // }

    @uiButton('Stop')
    stop() {
        if (!this.result) return
        this.result.stop()
        this.result = undefined
    }

    @uiButton('Delete')
    async removeFromParent2() {
        const viewer = this.getViewer()
        if (this.parent && viewer) {
            const confirm = await viewer.dialog.confirm(`Delete: Are you sure you want to delete the animation ${this.name}?`)
            if (confirm) this.removeFromParent()
        }
    }

    removeFromParent() {
        if (this.parent) this.parent.remove(this, true)
    }

    @serialize()
        // @uiToggle()
        animSetParallel = false

    @serialize()
        // @uiConfig()
        animSet: AnimationObject[] = []

    // @uiButton('Add Animation')
    addAnimation() {
        const o = new AnimationObject(this.target)
        this.add(o)
        return o
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: ()=>this.name || this.access || 'Animation',
        children: [
            ()=>this.target ? null : {
                type: 'input',
                label: 'Property',
                property: [this, 'access'],
                children: Object.entries(viewerOptions).map(([label, value])=>({label, value})),
            },
            ()=> this.values.flatMap((val, i)=>[
                {
                    ...generateValueConfig(this.values, i + '', undefined, val),
                    label: i === 0 ? 'From' : i === this.values.length - 1 ? 'To' : 'Key ' + i,
                    onChange: ()=>this.setDirty(),
                },
                i > 0 && i < this.values.length - 1 ? {
                    type: 'number',
                    label: 'Offset ' + i,
                    property: [this.offsets, i + ''],
                    bounds: [0, 1],
                    onChange: ()=>this.setDirty(),
                } : null,
            ]),
            generateUiConfig(this),
        ],
        uuid: generateUUID(),
    }

}
