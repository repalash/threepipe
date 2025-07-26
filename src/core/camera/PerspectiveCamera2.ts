import {Camera, Euler, Object3D, PerspectiveCamera, Quaternion, Vector3} from 'three'
import {generateUiConfig, uiInput, uiNumber, UiObjectConfig, uiSlider, uiToggle, uiVector} from 'uiconfig.js'
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

// todo: maybe change domElement to some wrapper/base class of viewer
/**
 * A camera class that extends {@link PerspectiveCamera} with additional features and built-in control support.
 */
export class PerspectiveCamera2<TE extends ICameraEventMap = ICameraEventMap> extends PerspectiveCamera<TE&ICameraEventMap> implements ICamera<TE&ICameraEventMap> {
    assetType = 'camera' as const
    get controls(): ICameraControls | undefined {
        return this._controls
    }

    @uiInput('Name') declare name: string

    @serialize('camControls')
    private _controls?: ICameraControls
    private _currentControlsMode: TCameraControlsMode = '';
    ['_canvas']?: HTMLCanvasElement
    @onChange2(PerspectiveCamera2.prototype.refreshCameraControls)
        controlsMode: TCameraControlsMode
    get isMainCamera(): boolean {
        return this.userData ? this.userData.__isMainCamera || false : false
    }

    @serialize()
        userData: ICameraUserData = {}

    @onChange3(PerspectiveCamera2.prototype.setDirty)
    @uiSlider('Field Of View', [1, 180], 0.001)
    @serialize() declare fov: number

    @onChange3(PerspectiveCamera2.prototype.setDirty)
    @serialize() declare focus: number

    @onChange3(PerspectiveCamera2.prototype.setDirty)
    @uiNumber('FoV Zoom')
    @serialize() declare zoom: number

    @uiVector<PerspectiveCamera2>('Position', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'position'})}))
    @serialize() declare readonly position: Vector3

    @uiVector<PerspectiveCamera2>('Up', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'up'})}))
    @serialize() declare readonly up: Vector3

    // todo serialize?
    // @uiVector<PerspectiveCamera2>('Quaternion', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'quaternion'}), disabled: ()=>t.autoLookAtTarget}))
    /* @serialize() */declare readonly quaternion: Quaternion

    @uiVector<PerspectiveCamera2>('Rotation', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'rotation'}), disabled: ()=>t.autoLookAtTarget}))
    /* @serialize()*/ declare readonly rotation: Euler

    /**
     * The target position of the camera (where the camera looks at). Also syncs with the controls.target, so it's not required to set that separately.
     * Note: this is always in world-space
     * Note: {@link autoLookAtTarget} must be set to `true` to make the camera look at the target when no controls are enabled
     */
    @uiVector<PerspectiveCamera2>('Target', undefined, undefined, (t)=>({onChange: ()=>t.setDirty({change: 'target'}), disabled: ()=>!t.autoLookAtTarget}))
    @serialize() readonly target: Vector3 = new Vector3(0, 0, 0)

    /**
     * Automatically manage aspect ratio based on window/canvas size.
     * Defaults to `true` if {@link domElement}(canvas) is set.
     */
    @serialize()
    @onChange2('refreshAspect')
    @uiToggle('Auto Aspect')
        autoAspect: boolean

    @serialize()
    @onChange2('refreshAspect')
    @uiNumber<PerspectiveCamera2>('Aspect Ratio', (t)=>({hidden: ()=>t.autoAspect}))
    declare aspect: number

    /**
     * Near clipping plane.
     * This is managed by RootScene for active cameras
     * To change the minimum that's possible set {@link minNearPlane}
     * To use a fixed value set {@link autoNearFar} to false and set {@link minNearPlane}
     */
    @onChange2(PerspectiveCamera2.prototype._nearFarChanged)
        near = 0.01

    /**
     * Far clipping plane.
     * This is managed by RootScene for active cameras
     * To change the maximum that's possible set {@link maxFarPlane}
     * To use a fixed value set {@link autoNearFar} to false and set {@link maxFarPlane}
     */
    @onChange2(PerspectiveCamera2.prototype._nearFarChanged)
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
     * Used in RootScene when {@link autoNearFar} is `true`.
     */
    @bindToValue({obj: 'userData', onChange: 'setDirty'})
        maxFarPlane = 1000

    /**
     * Automatically move the camera(dolly) when the field of view(fov) changes.
     * Works when controls are enabled or `autoLookAtTarget` is `true`.
     *
     * Note - this is not exact
     */
    @bindToValue({obj: 'userData'})
        dollyFov = false // bound to userData so that it's saved in the glb.

    constructor(controlsMode?: TCameraControlsMode, domElement?: HTMLCanvasElement, autoAspect?: boolean, fov?: number, aspect?: number) {
        super(fov, aspect)
        this._canvas = domElement
        this.autoAspect = autoAspect ?? !!domElement

        iCameraCommons.upgradeCamera.call(this) // todo: test if autoUpgrade = false works as expected if we call upgradeObject3D externally after constructor, because we have setDirty, refreshTarget below.

        this.controlsMode = controlsMode || ''

        this.refreshTarget(undefined, false)

        // if (!camera)
        //     this.targetUpdated(false)
        this.setDirty()


        // if (domElement)
        //     domElement.style.touchAction = 'none' // this is done in orbit controls anyway


        // const ae = this._canvas.addEventListener
        // todo: this breaks tweakpane UI.
        // this._canvas.addEventListener = (type: string, listener: any, options1: any) => { // see https://github.com/mrdoob/three.js/pull/19782
        //     ae(type, listener, type === 'wheel' && typeof options1 !== 'boolean' ? {
        //         ...typeof options1 === 'object' ? options1 : {},
        //         capture: false,
        //         passive: false,
        //     } : options1)
        // }

        // this.refreshCameraControls() // this is done on set controlsMode
        // const target = this.target

    }

    // @serialize('camOptions') //todo handle deserialization of this

    // region interactionsEnabled

    // private _interactionsEnabled = true
    //
    // get interactionsEnabled(): boolean {
    //     return this._interactionsEnabled
    // }
    //
    // set interactionsEnabled(value: boolean) {
    //     if (this._interactionsEnabled !== value) {
    //         this._interactionsEnabled = value
    //         this.refreshCameraControls(true)
    //     }
    // }

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

    setInteractions(enabled: boolean, by: string, setDirty = true): void {
        const size = this._interactionsDisabledBy.size
        if (enabled) {
            this._interactionsDisabledBy.delete(by)
        } else {
            this._interactionsDisabledBy.add(by)
        }
        if (size !== this._interactionsDisabledBy.size) this.refreshCameraControls(setDirty)
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

    refreshUi = iCameraCommons.refreshUi
    refreshTarget = iCameraCommons.refreshTarget
    activateMain = iCameraCommons.activateMain
    deactivateMain = iCameraCommons.deactivateMain
    // @ts-expect-error ts issue
    updateShaderProperties = iCameraCommons.updateShaderProperties

    protected _nearFarChanged() {
        if (this.view === undefined) return // not initialized yet
        this.updateProjectionMatrix && this.updateProjectionMatrix()
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
            console.error('PerspectiveCamera2: ' + key + ' already exists.')
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
        if (!this._controls && mode !== '') console.error('PerspectiveCamera2 - Unable to create controls with mode ' + mode + '. Are you missing a plugin?')
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
        // todo add camOptions for backwards compatibility?
        return ThreeSerialization.Serialize(this, meta, false) // this will call toJSON again, but with _internal=true, that's why we set isThis to false.
    }

    fromJSON(data: any, meta?: any): this | null {
        if (data.camOptions || data.aspect === 'auto')
            data = {...data}
        if (data.camOptions) {
            const op = data.camOptions
            if (op.fov) data.fov = op.fov
            if (op.focus) data.focus = op.focus
            if (op.zoom) data.zoom = op.zoom
            if (op.aspect) data.aspect = op.aspect
            if (op.controlsMode) data.controlsMode = op.controlsMode
            // todo: add support for this
            // if (op.left) data.left = op.left
            // if (op.right) data.right = op.right
            // if (op.top) data.top = op.top
            // if (op.bottom) data.bottom = op.bottom
            // if (op.frustumSize) data.frustumSize = op.frustumSize
            // if (op.controlsEnabled) data.controlsEnabled = op.controlsEnabled
            delete data.camOptions
        }
        if (data.aspect === 'auto') {
            data.aspect = this.aspect
            this.autoAspect = true
        }
        // if (data.cameraObject) this._camera.fromJSON(data.cameraObject)
        // todo: add check for OrbitControls being not deserialized(inited properly) if it doesn't exist yet (if it is not inited properly)
        // console.log(JSON.parse(JSON.stringify(data)))
        ThreeSerialization.Deserialize(data, this, meta, true)
        this.refreshAspect(false)
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
        {
            type: 'input',
            label: 'Auto Near Far',
            property: [this, 'autoNearFar'],
        },
        {
            type: 'input',
            label: 'Dolly FoV',
            property: [this, 'dollyFov'],
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
            // todo hack for zoom in and out for now.
            ()=>(this._controls as OrbitControls3)?.zoomIn ? {
                type: 'button',
                label: 'Zoom in',
                value: ()=> (this._controls as OrbitControls3)?.zoomIn(1),
            } : {},
            ()=>(this._controls as OrbitControls3)?.zoomOut ? {
                type: 'button',
                label: 'Zoom out',
                value: ()=> (this._controls as OrbitControls3)?.zoomOut(1),
            } : {},
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

    // setCameraOptions<T extends Partial<IPerspectiveCameraOptions | IOrthographicCameraOptions>>(value: T, setDirty = true): void {
    //     const ops: any = {...value}
    //
    //     this._refreshCameraOptions(false)
    //     this.refreshCameraControls(false)
    //     if (setDirty) this.setDirty()
    // }

    // not to be used
    // private _changeType(setDirty = true) {
    //     // let cam = this._camera.modelObject
    //
    //     // change of type, not supported now.
    //     // if (this._options.type !== cam.type) {
    //     //     const cam2 = this._options.type === 'PerspectiveCamera' ? new PerspectiveCamera() : new OrthographicCamera()
    //     //     cam2.name = this._camera.name
    //     //     cam2.near = this._camera.modelObject.near
    //     //     cam2.far = this._camera.modelObject.far
    //     //     cam2.zoom = this._camera.modelObject.zoom
    //     //     cam2.scale.copy(this._camera.modelObject.scale)
    //     //
    //     //     const isActive = this._isMainCamera
    //     //     if (isActive) this.deactivateMain()
    //     //     this._camera = this._setCameraObject(cam2)
    //     //     cam = this._camera.modelObject
    //     //     if (isActive) this.activateMain()
    //     //     this._camera.modelObject.updateProjectionMatrix()
    //     // }
    //
    //     // this._nearFarChanged() // this updates projection matrix todo: move to setDirty
    //
    //     if (setDirty) this.setDirty()
    // }


    // private _cameraObjectUpdate = (e: any)=>{
    //     this.setDirty(e)
    // }
    // private _setCameraObject(cam: OrthographicCamera | PerspectiveCamera) {
    //     if (this._camera) this._camera.removeEventListener('objectUpdate', this._cameraObjectUpdate)
    //     this._camera = setupIModel(cam as any)
    //     this._camera.addEventListener('objectUpdate', this._cameraObjectUpdate)
    //     return this._camera
    // }

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
 * Empty class with the constructor same as PerspectiveCamera in three.js.
 * This can be used to remain compatible with three.js construct signature.
 */
export class PerspectiveCamera0 extends PerspectiveCamera2 {
    constructor(fov?: number, aspect?: number, near?: number, far?: number) {
        super(undefined, undefined, undefined, fov, aspect || 1)
        this.dollyFov = false
        if (near || far) {
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
