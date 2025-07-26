import {Camera, Euler, Object3D, OrthographicCamera, Quaternion, Vector3} from 'three'
import {generateUiConfig, uiInput, uiNumber, UiObjectConfig, uiToggle, uiVector} from 'uiconfig.js'
import {onChange, onChange2, onChange3, serialize} from 'ts-browser-helpers'
import type {ICamera, ICameraEventMap, ICameraUserData, TCameraControlsMode} from '../ICamera'
import {ICameraSetDirtyOptions} from '../ICamera'
import type {ICameraControls, TControlsCtor} from './ICameraControls'
import {OrbitControls3} from '../../three/controls/OrbitControls3'
import {IObject3D} from '../IObject'
import {ThreeSerialization} from '../../utils'
import {iCameraCommons} from '../object/iCameraCommons'
import {bindToValue} from '../../three/utils/decorators'
import {makeICameraCommonUiConfig, objectExtensionsUiConfig} from '../object/IObjectUi'

// todo: extract out common functions with perspective camera into iCameraCommons
// todo: maybe change domElement to some wrapper/base class of viewer
export class OrthographicCamera2<TE extends ICameraEventMap = ICameraEventMap> extends OrthographicCamera<TE&ICameraEventMap> implements ICamera<TE&ICameraEventMap> {
    assetType = 'camera' as const
    get controls(): ICameraControls | undefined {
        return this._controls
    }

    @uiInput('Name') declare name: string

    @serialize('camControls')
    private _controls?: ICameraControls
    private _currentControlsMode: TCameraControlsMode = '';
    ['_canvas']?: HTMLCanvasElement
    @onChange2(OrthographicCamera2.prototype.refreshCameraControls)
        controlsMode: TCameraControlsMode
    get isMainCamera(): boolean {
        return this.userData ? this.userData.__isMainCamera || false : false
    }

    @serialize()
        userData: ICameraUserData = {}

    @onChange3(OrthographicCamera2.prototype.setDirty)
    @uiNumber('Zoom')
    @serialize() declare zoom: number

    @onChange3(OrthographicCamera2.prototype.setDirty)
    @uiNumber<OrthographicCamera2>('Left', (t)=>({hidden: ()=>t._frustumSize !== undefined}))
    @serialize() declare left: number

    @onChange3(OrthographicCamera2.prototype.setDirty)
    @uiNumber<OrthographicCamera2>('Right', (t)=>({hidden: ()=>t._frustumSize !== undefined}))
    @serialize() declare right: number

    @onChange3(OrthographicCamera2.prototype.setDirty)
    @uiNumber<OrthographicCamera2>('Top', (t)=>({hidden: ()=>t._frustumSize !== undefined}))
    @serialize() declare top: number

    @onChange3(OrthographicCamera2.prototype.setDirty)
    @uiNumber<OrthographicCamera2>('Bottom', (t)=>({hidden: ()=>t._frustumSize !== undefined}))
    @serialize() declare bottom: number

    private _frustumSize: number | undefined = undefined

    /**
     * Frustum size of the camera. This is used to calculate bounds (left, right, top, bottom) based on aspect ratio.
     * Set to 0 (or negative) value to disable automatic, and to set the bounds manually.
     */
    @uiInput<OrthographicCamera2>('Frustum Size'/* , (t)=>({hidden: ()=>t.frustumSize === undefined})*/)
    get frustumSize(): number {
        return this._frustumSize ?? 0
    }

    set frustumSize(value: number) {
        this._frustumSize = value <= 0 ? undefined : value
        this.refreshFrustum(false)
        this.setDirty()
    }

    // @onChange3(OrthographicCamera2.prototype.setDirty)
    // @serialize() declare focus: number

    // @onChange3(OrthographicCamera2.prototype.setDirty)
    // @uiSlider('FoV Zoom', [0.001, 10], 0.001)
    // @serialize() declare zoom: number

    @uiVector<OrthographicCamera2>('Position', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'position'})}))
    @serialize() declare readonly position: Vector3

    @uiVector<OrthographicCamera2>('Up', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'up'})}))
    @serialize() declare readonly up: Vector3

    // todo serialize?
    // @uiVector<OrthographicCamera2>('Quaternion', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'quaternion'}), disabled: ()=>t.autoLookAtTarget}))
    /* @serialize() */declare readonly quaternion: Quaternion

    @uiVector<OrthographicCamera2>('Rotation', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'rotation'}), disabled: ()=>t.autoLookAtTarget}))
    /* @serialize()*/ declare readonly rotation: Euler

    /**
     * The target position of the camera (where the camera looks at). Also syncs with the controls.target, so it's not required to set that separately.
     * Note: this is always in world-space
     * Note: {@link autoLookAtTarget} must be set to `true` to make the camera look at the target when no controls are enabled
     */
    @uiVector<OrthographicCamera2>('Target', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'target'}), disabled: ()=>!t.autoLookAtTarget}))
    @serialize() readonly target: Vector3 = new Vector3(0, 0, 0)

    /**
     * Automatically manage aspect ratio based on window/canvas size.
     * Defaults to `true` if {@link domElement}(canvas) is set.
     */
    @serialize()
    @onChange2('refreshAspect')
    @uiToggle('Auto Aspect')
        autoAspect: boolean

    /**
     * Aspect ratio to use when {@link frustumSize} is defined
     */
    @serialize()
    @onChange2('refreshAspect')
    @uiNumber<OrthographicCamera2>('Aspect Ratio', (t)=>({hidden: ()=>t.autoAspect}))
        aspect: number

    /**
     * Near clipping plane.
     * This is managed by RootScene for active cameras
     * To change the minimum that's possible set {@link minNearPlane}
     * To use a fixed value set {@link autoNearFar} to false and set {@link minNearPlane}
     */
    @onChange2(OrthographicCamera2.prototype._nearFarChanged)
        near = 0.01

    /**
     * Far clipping plane.
     * This is managed by RootScene for active cameras
     * To change the maximum that's possible set {@link maxFarPlane}
     * To use a fixed value set {@link autoNearFar} to false and set {@link maxFarPlane}
     */
    @onChange2(OrthographicCamera2.prototype._nearFarChanged)
        far = 50

    /**
     * Automatically make the camera look at the {@link target} on {@link setDirty} call
     * Defaults to false. Note that this must be set to true to make the camera look at the target without any controls
     */
    @bindToValue({obj: 'userData', onChange: 'setDirty'})
        autoLookAtTarget = false // bound to userData so that it's saved in the glb.

    /**
     * Automatically manage near and far clipping planes based on scene size.
     */
    @bindToValue({obj: 'userData', onChange: 'setDirty'})
        autoNearFar = true // bound to userData so that it's saved in the glb.

    /**
     * Minimum near clipping plane allowed. (Distance from camera)
     * Used in RootScene when {@link autoNearFar} is true.
     * @default 0.2
     */
    @bindToValue({obj: 'userData', onChange: 'setDirty'})
        minNearPlane = 0.5

    /**
     * Maximum far clipping plane allowed. (Distance from camera)
     * Used in RootScene when {@link autoNearFar} is true.
     */
    @bindToValue({obj: 'userData', onChange: 'setDirty'})
        maxFarPlane = 1000

    constructor(controlsMode?: TCameraControlsMode, domElement?: HTMLCanvasElement, autoAspect?: boolean, frustumSize?: number, left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number, aspect?: number) {
        super(left, right, top, bottom, near, far)
        this._canvas = domElement
        this.aspect = aspect || 1
        this._frustumSize = frustumSize ?? 4
        this.autoAspect = autoAspect ?? !!domElement

        iCameraCommons.upgradeCamera.call(this) // todo: test if autoUpgrade = false works as expected if we call upgradeObject3D externally after constructor, because we have setDirty, refreshTarget below.

        this.controlsMode = controlsMode || ''

        this.refreshTarget(undefined, false)
        this.refreshFrustum(false)

        // if (!camera)
        //     this.targetUpdated(false)
        this.setDirty()


        // if (domElement)
        //     domElement.style.touchAction = 'none' // this is done in orbit controls anyway

        // this.refreshCameraControls() // this is done on set controlsMode
        // const target = this.target

    }

    private _interactionsDisabledBy = new Set<string>()

    /**
     * If interactions are enabled for this camera. It can be disabled by some code or plugin.
     * see also {@link setInteractions}
     * @deprecated use {@link canUserInteract} to check if the user can interact with this camera
     * @readonly
     */
    get interactionsEnabled(): boolean {
        return this._interactionsDisabledBy.size === 0
    }

    setInteractions(enabled: boolean, by: string): void {
        const size = this._interactionsDisabledBy.size
        if (enabled) {
            this._interactionsDisabledBy.delete(by)
        } else {
            this._interactionsDisabledBy.add(by)
        }
        if (size !== this._interactionsDisabledBy.size) this.refreshCameraControls(true)
    }

    get canUserInteract() {
        return this._interactionsDisabledBy.size === 0 && this.isMainCamera && this.controlsMode !== ''
    }

    // endregion

    // region refreshing

    setDirty(options?: ICameraSetDirtyOptions): void {
        iCameraCommons.setDirty.call(this, options)

        if (options?.last !== false)
            this._camUi?.forEach(u=>u?.uiRefresh?.(false, 'postFrame', 1)) // because camera changes a lot. so we dont want to deep refresh ui on every change
    }

    /**
     * when aspect ratio is set to auto it must be refreshed on resize, this is done by the viewer for the main camera.
     * @param setDirty
     */
    refreshAspect = iCameraCommons.refreshAspect

    protected _nearFarChanged() {
        if (this.view === undefined) return // not initialized yet
        this.updateProjectionMatrix && this.updateProjectionMatrix()
    }

    refreshUi = iCameraCommons.refreshUi
    refreshTarget = iCameraCommons.refreshTarget
    activateMain = iCameraCommons.activateMain
    deactivateMain = iCameraCommons.deactivateMain
    // @ts-expect-error ts issue
    updateShaderProperties = iCameraCommons.updateShaderProperties

    refreshFrustum(setDirty = true) {
        if (this._frustumSize === undefined) return
        this.top = this._frustumSize / 2
        this.bottom = -this.top
        this.left = this.bottom * this.aspect
        this.right = this.top * this.aspect
        setDirty && this.setDirty()
    }

    // endregion

    // region controls

    // todo: move orbit to a plugin maybe? so that its not forced
    private _controlsCtors = new Map<string, TControlsCtor>([['orbit', (object, domElement)=>{
        const elem = domElement ? !domElement.ownerDocument ? domElement.documentElement : domElement : document.body
        const controls = new OrbitControls3(object, elem)
        // this._controls.enabled = false

        // set tab index so that we get keyboard events
        if (elem.tabIndex === -1) {
            elem.tabIndex = 1000
            // disable focus outline
            elem.style.outline = 'none'
        }

        controls.listenToKeyEvents(elem) // optional // todo: make option for this
        // controls.enableKeys = true
        controls.screenSpacePanning = true
        return controls
    }]])
    setControlsCtor(key: string, ctor: TControlsCtor, replace = false): void {
        if (!replace && this._controlsCtors.has(key)) {
            console.error('OrthographicCamera2: ' + key + ' already exists.')
            return
        }
        this._controlsCtors.set(key, ctor)
    }
    removeControlsCtor(key: string): void {
        this._controlsCtors.delete(key)
    }

    private _controlsChanged = ()=>{
        if (this._controls && this._controls.target) this.refreshTarget(undefined, false)
        this.setDirty({change: 'controls'})
    }
    private _initCameraControls() {
        const mode = this.controlsMode
        this._controls = this._controlsCtors.get(mode)?.(this, this._canvas) ?? undefined
        if (!this._controls && mode !== '') console.error('OrthographicCamera2 - Unable to create controls with mode ' + mode + '. Are you missing a plugin?')
        this._controls?.addEventListener('change', this._controlsChanged)
        this._currentControlsMode = this._controls ? mode : ''
        // todo maybe set target like this:
        //  if (this._controls) this._controls.target = this.target
    }

    private _disposeCameraControls() {
        if (this._controls) {
            if (this._controls.target === this.target) this._controls.target = new Vector3() // just in case
            this._controls?.removeEventListener('change', this._controlsChanged)
            this._controls?.dispose()
        }
        this._currentControlsMode = ''
        this._controls = undefined
    }

    refreshCameraControls(setDirty = true): void {
        if (!this._controlsCtors) return // class not initialized
        if (this._controls) {
            if (this._currentControlsMode !== this.controlsMode ||
                this !== this._controls.object ||
                this._controls.domElement && this._canvas !== this._controls.domElement
            ) { // in-case camera changed or mode changed
                this._disposeCameraControls()
                this._initCameraControls()
            }
        } else {
            this._initCameraControls()
        }

        // todo: only for orbit control like controls?
        if (this._controls) {
            const ce = this.canUserInteract
            this._controls.enabled = ce
            if (ce) this.up.copy(Object3D.DEFAULT_UP)
        }

        if (setDirty) this.setDirty()
        this.refreshUi()
    }

    // endregion

    // region serialization

    /**
     * Serializes this camera with controls to JSON.
     * @param meta - metadata for serialization
     * @param _internal - Calls only super.toJSON, does internal three.js serialization and `@serialize` tags. Set it to true only if you know what you are doing. This is used in Serialization->serializer
     */
    toJSON(meta?: any, _internal = false): any {
        if (_internal) return {
            ...super.toJSON(meta),
            ...ThreeSerialization.Serialize(this, meta, true), // this will serialize the properties of this class(like defined with @serialize and @serialize attribute)
        }
        return ThreeSerialization.Serialize(this, meta, false) // this will call toJSON again, but with _internal=true, that's why we set isThis to false.
    }

    fromJSON(data: any, meta?: any): this | null {
        ThreeSerialization.Deserialize(data, this, meta, true)
        this.setDirty({change: 'deserialize'})
        return this
    }

    // endregion

    // region camera views

    getView = iCameraCommons.getView
    setView = iCameraCommons.setView
    setViewFromCamera = iCameraCommons.setViewFromCamera
    setViewToMain = iCameraCommons.setViewToMain;

    // endregion

    // region utils/others

    // for shader prop updater
    ['_positionWorld'] = new Vector3()

    dispose(): void {
        this._disposeCameraControls()
        // todo: anything else?
        // iObjectCommons.dispose and dispatch event dispose is called automatically because of updateObject3d
    }

    setCanvas(canvas: HTMLCanvasElement|undefined, refresh = true) {
        this._canvas = canvas
        if (!refresh) return
        this.refreshCameraControls()
        this.refreshAspect(false)
    }

    // endregion

    // region ui

    private _camUi: UiObjectConfig[] = [
        ...generateUiConfig(this) || [],
        {
            type: 'input',
            label: ()=>(this.autoNearFar ? 'Min' : '') + ' Near',
            property: [this, 'minNearPlane'],
        },
        {
            type: 'input',
            label: ()=>(this.autoNearFar ? 'Max' : '') + ' Far',
            property: [this, 'maxFarPlane'],
        },
        ()=>({ // because _controlsCtors can change
            type: 'dropdown',
            label: 'Controls Mode',
            property: [this, 'controlsMode'],
            children: ['', 'orbit', ...this._controlsCtors.keys()].map(v=>({label: v === '' ? 'none' : v, value:v})),
            onChange: () => this.refreshCameraControls(),
        }),
        ()=>makeICameraCommonUiConfig.call(this, this.uiConfig),
        objectExtensionsUiConfig.call(this),
    ]

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: ()=>this.name || 'Camera',
        children: [
            ...this._camUi,
            ()=>this._controls?.uiConfig,
        ],
    }

    // endregion

    // region deprecated/old

    @onChange((k: string, v: boolean)=>{
        if (!v) console.warn('Setting camera invisible is not supported', k, v)
    })
    declare visible: boolean

    get isActiveCamera(): boolean {
        return this.isMainCamera
    }
    /**
     * @deprecated use `<T>camera.controls` instead
     */
    getControls<T extends ICameraControls>(): T|undefined {
        return this._controls as any as T
    }

    /**
     * @deprecated use `this` instead
     */
    get cameraObject(): this {
        return this
    }

    /**
     * @deprecated use `this` instead
     */
    get modelObject(): this {
        return this
    }

    /**
     * @deprecated - use setDirty directly
     * @param setDirty
     */
    targetUpdated(setDirty = true): void {
        if (setDirty) this.setDirty()
    }

    // endregion

    // region inherited type fixes
    // re-declaring from IObject3D because: https://github.com/microsoft/TypeScript/issues/16936

    traverse: (callback: (object: IObject3D) => void) => void
    traverseVisible: (callback: (object: IObject3D) => void) => void
    traverseAncestors: (callback: (object: IObject3D) => void) => void
    getObjectById: <T extends IObject3D = IObject3D>(id: number) => T | undefined
    getObjectByName: <T extends IObject3D = IObject3D>(name: string) => T | undefined
    getObjectByProperty: <T extends IObject3D = IObject3D>(name: string, value: string) => T | undefined
    copy: (source: ICamera|Camera|IObject3D, recursive?: boolean, distanceFromTarget?: number, worldSpace?: boolean) => this
    clone: (recursive?: boolean) => this
    add: (...object: IObject3D[]) => this
    remove: (...object: IObject3D[]) => this
    // dispatchEvent: (event: ICameraEvent) => void
    declare parent: IObject3D | null
    declare children: IObject3D[]

    // endregion

}

/**
 * Empty class with the constructor same as OrthographicCamera in three.js.
 * This can be used to remain compatible with three.js construct signature.
 */
export class OrthographicCamera0 extends OrthographicCamera2 {
    constructor(left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number) {
        super(undefined, undefined, undefined, undefined, left, right, top, bottom, near, far, 1)
        if (near !== undefined || far) {
            this.autoNearFar = false
            if (near) {
                this.near = near
                this.minNearPlane = near
            }
            if (far) {
                this.far = far
                this.maxFarPlane = far
            }
        }
    }
}
