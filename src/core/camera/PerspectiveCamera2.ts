import {Camera, Event, IUniform, Object3D, PerspectiveCamera, Vector3} from 'three'
import {generateUiConfig, uiInput, UiObjectConfig, uiSlider, uiVector} from 'uiconfig.js'
import {onChange, onChange2, onChange3, serialize} from 'ts-browser-helpers'
import type {ICamera, ICameraEvent, ICameraUserData, TCameraControlsMode} from '../ICamera'
import {ICameraSetDirtyOptions} from '../ICamera'
import type {ICameraControls, TControlsCtor} from './ICameraControls'
import {OrbitControls3} from '../../three'
import {IObject3D} from '../IObject'
import {ThreeSerialization} from '../../utils'
import {iCameraCommons} from '../object/iCameraCommons'

// todo: maybe change domElement to some wrapper/base class of viewer
export class PerspectiveCamera2 extends PerspectiveCamera implements ICamera {
    assetType = 'camera' as const
    get controls(): ICameraControls | undefined {
        return this._controls
    }

    @uiInput('Name') name: string

    @serialize('camControls')
    private _controls?: ICameraControls
    private _currentControlsMode: TCameraControlsMode = ''
    @onChange2(PerspectiveCamera2.prototype.refreshCameraControls)
        controlsMode: TCameraControlsMode
    /**
     * It should be the canvas actually
     * @private
     */
    private _canvas?: HTMLCanvasElement
    get isMainCamera(): boolean {
        return this.userData.__isMainCamera || false
    }

    @serialize()
        userData: ICameraUserData = {}

    @onChange3(PerspectiveCamera2.prototype.setDirty)
    @uiSlider('Field Of View', [1, 180], 0.001)
    @serialize() fov: number

    @onChange3(PerspectiveCamera2.prototype.setDirty)
    @serialize() focus: number

    @onChange3(PerspectiveCamera2.prototype.setDirty)
    // @uiSlider('Zoom', [0.001, 20], 0.001)
    @serialize() zoom: number

    @uiVector('Position')
    @serialize() readonly position: Vector3

    @onChange3(PerspectiveCamera2.prototype.setDirty)
    @uiVector('Target')
    @serialize() readonly target: Vector3 = new Vector3(0, 0, 0)

    @serialize()
    @onChange2(PerspectiveCamera2.prototype.refreshAspect)
        autoAspect: boolean

    /**
     * Near clipping plane. This is managed by RootScene for active cameras
     */
    @onChange2(PerspectiveCamera2.prototype._nearFarChanged)
        near = 0.01

    /**
     * Far clipping plane. This is managed by RootScene for active cameras
     */
    @onChange2(PerspectiveCamera2.prototype._nearFarChanged)
        far = 50

    constructor(controlsMode?: TCameraControlsMode, domElement?: HTMLCanvasElement, autoAspect?: boolean, fov?: number, aspect?: number) {
        super(fov, aspect)
        this._canvas = domElement
        this.autoAspect = autoAspect || !!domElement

        iCameraCommons.upgradeCamera.call(this) // todo: test if autoUpgrade = false works as expected if we call upgradeObject3D externally after constructor, because we have setDirty, refreshTarget below.

        this.controlsMode = controlsMode || ''

        this.refreshTarget(undefined, false)

        // if (!camera)
        //     this.targetUpdated(false)
        this.setDirty()


        // if (domElement)
        //     domElement.style.touchAction = 'none' // this is done in orbit controls anyway


        // const ae = this._canvas.addEventListener
        // todo: this breaks UI.
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
    private _interactionsEnabled = true

    get canUserInteract() {
        return this._interactionsEnabled && this.isMainCamera && this.controlsMode !== ''
    }

    get interactionsEnabled(): boolean {
        return this._interactionsEnabled
    }

    set interactionsEnabled(value: boolean) {
        if (this._interactionsEnabled !== value) {
            this._interactionsEnabled = value
            this.refreshCameraControls(true)
        }
    }

    // endregion

    // region refreshing

    setDirty(options?: ICameraSetDirtyOptions|Event): void {
        if (!this._positionWorld) return // class not initialized

        if (options?.key === 'fov') this.updateProjectionMatrix()

        this.getWorldPosition(this._positionWorld)

        iCameraCommons.setDirty.call(this, options)

        this._camUi.forEach(u=>u?.uiRefresh?.(false, 'postFrame', 1)) // because camera changes a lot. so we dont want to deep refresh ui on every change
    }

    /**
     * when aspect ratio is set to auto it must be refreshed on resize, this is done by the viewer for the main camera.
     * @param setDirty
     */
    refreshAspect(setDirty = true): void {
        if (this.autoAspect) {
            if (!this._canvas) console.error('cannot calculate aspect ratio without canvas/container')
            else {
                this.aspect = this._canvas.clientWidth / this._canvas.clientHeight
                this.updateProjectionMatrix?.()
            }
        }
        if (setDirty) this.setDirty()
        // console.log('refreshAspect', this._options.aspect)
    }

    protected _nearFarChanged() {
        if (this.view === undefined) return // not initialized yet
        this.updateProjectionMatrix?.()
    }

    refreshUi = iCameraCommons.refreshUi
    refreshTarget = iCameraCommons.refreshTarget
    activateMain = iCameraCommons.activateMain
    deactivateMain = iCameraCommons.deactivateMain

    // endregion

    // region controls

    // todo: move orbit to a plugin maybe? so that its not forced
    private _controlsCtors = new Map<string, TControlsCtor>([['orbit', (object, domElement)=>{
        const controls = new OrbitControls3(object, domElement ? !domElement.ownerDocument ? domElement.documentElement : domElement : document.body)
        // this._controls.enabled = false

        // this._controls.listenToKeyEvents(window as any) // optional // todo: this breaks keyboard events in UI like cursor left/right, make option for this
        // this._controls.enableKeys = true
        controls.screenSpacePanning = true
        return controls
    }]])
    setControlsCtor(key: string, ctor: TControlsCtor, replace = false): void {
        if (!replace && this._controlsCtors.has(key)) {
            console.error(key + ' already exists.')
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
        if (!this._controls && mode !== '') console.error('Unable to create controls with mode ' + mode + '. Are you missing a plugin?')
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
            if (this._currentControlsMode !== this.controlsMode || this !== this._controls.object) { // in-case camera changed or mode changed
                this._disposeCameraControls()
                this._initCameraControls()
            }
        } else {
            this._initCameraControls()
        }

        // todo: only for orbit control like controls?
        if (this._controls) {
            const ce = this.interactionsEnabled
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
     * @param baseOnly - Calls only super.toJSON, does internal three.js serialization. Set it to true only if you know what you are doing.
     */
    toJSON(meta?: any, baseOnly = false): any {
        if (baseOnly) return super.toJSON(meta)
        // todo add camOptions for backwards compatibility?
        return ThreeSerialization.Serialize(this, meta, true)
    }

    fromJSON(data: any, meta?: any): this | null {
        if (data.camOptions) {
            // todo
            console.error('todo: old file camOptions')
        }
        if (data.aspect === 'auto') {
            data.aspect = this.aspect
            this.autoAspect = true
        }
        // if (data.cameraObject) this._camera.fromJSON(data.cameraObject)
        // todo: add check for OrbitControls being not deserialized(inited properly) if it doesn't exist yet (if it is not inited properly)
        // console.log(JSON.parse(JSON.stringify(data)))
        ThreeSerialization.Deserialize(data, this, meta, true)
        this.setDirty({change: 'deserialize'})
        return this
    }

    // endregion

    // region utils/others

    // for shader prop updater
    private _positionWorld = new Vector3()
    updateShaderProperties(material: {defines: Record<string, string | number | undefined>; uniforms: {[p: string]: IUniform}}): this {
        material.uniforms.cameraPositionWorld?.value?.copy(this._positionWorld)
        material.uniforms.cameraNearFar?.value?.set(this.near, this.far)
        if (material.uniforms.projection) material.uniforms.projection.value = this.projectionMatrix // todo: rename to projectionMatrix2?
        material.defines.PERSPECTIVE_CAMERA = this.type === 'PerspectiveCamera' ? '1' : '0'
        // material.defines.ORTHOGRAPHIC_CAMERA = this.type === 'OrthographicCamera' ? '1' : '0' // todo
        return this
    }

    dispose(): void {
        this._disposeCameraControls()
        // todo: anything else?
        // iObjectCommons.dispose and dispatch event dispose is called automatically because of updateObject3d
    }

    // endregion

    // region ui

    private _camUi: UiObjectConfig[] = [
        ...generateUiConfig(this),
        {
            type: 'input',
            label: 'Min Near',
            getValue: () => this.userData.minNearPlane ?? 0.2,
            setValue: (v) => this.userData.minNearPlane = v,
            onChange: () => this.setDirty(),
        },
        {
            type: 'input',
            label: 'Max Far',
            getValue: () => this.userData.maxFarPlane ?? 1000,
            setValue: (v) => this.userData.maxFarPlane = v,
            onChange: () => this.setDirty(),
        },
        ()=>({ // because _controlsCtors can change
            type: 'dropdown',
            label: 'Controls Mode',
            property: [this, 'controlsMode'],
            children: ['', 'orbit', ...this._controlsCtors.keys()].map(v=>({label: v === '' ? 'none' : v, value:v})),
            onChange: () => this.refreshCameraControls(),
        }),
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
                value: ()=>{
                    (this._controls as OrbitControls3)?.zoomIn(1)
                },
            } : {},
            ()=>(this._controls as OrbitControls3)?.zoomOut ? {
                type: 'button',
                label: 'Zoom out',
                value: ()=>{
                    (this._controls as OrbitControls3)?.zoomOut(1)
                },
            } : {},
            ()=>this._controls?.uiConfig,
        ],
    }

    // endregion

    // region deprecated/old

    @onChange((k: string, v: boolean)=>{
        if (!v) console.warn('Setting camera invisible is not supported', k, v)
    })
        visible: boolean

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
     * @deprecated
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

    // for ortho
    // private _frustumSize: number | undefined = undefined
    //
    // get frustumSize(): number | undefined {
    //     return this._frustumSize
    // }
    //
    // set frustumSize(value: number | undefined) {
    //     this._frustumSize = value
    //     if (value !== undefined) {
    //         cam.top = value / 2
    //         cam.bottom = -value / 2
    //         cam.left = aspect * value / 2
    //         cam.right = -aspect * value / 2
    //     }
    //     this.setDirty()
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
    copy: (source: ICamera|Camera, recursive?: boolean, distanceFromTarget?: number) => this
    clone: (recursive?: boolean) => this
    add: (...object: IObject3D[]) => this
    remove: (...object: IObject3D[]) => this
    dispatchEvent: (event: ICameraEvent) => void
    parent: IObject3D | null
    children: IObject3D[]

    // endregion

}


