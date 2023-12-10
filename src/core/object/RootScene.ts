import {
    Color,
    EquirectangularReflectionMapping,
    EventListener,
    IUniform,
    Object3D,
    Scene,
    UVMapping,
    Vector3,
} from 'three'
import type {IObject3D, IObjectProcessor} from '../IObject'
import {type ICamera} from '../ICamera'
import {Box3B} from '../../three'
import {AnyOptions, onChange2, onChange3, serialize} from 'ts-browser-helpers'
import {PerspectiveCamera2} from '../camera/PerspectiveCamera2'
import {ThreeSerialization} from '../../utils'
import {ITexture} from '../ITexture'
import {AddObjectOptions, IScene, ISceneEvent, ISceneEventTypes, ISceneSetDirtyOptions, IWidget} from '../IScene'
import {iObjectCommons} from './iObjectCommons'
import {RootSceneImportResult} from '../../assetmanager'
import {uiColor, uiConfig, uiFolderContainer, uiImage, UiObjectConfig, uiSlider, uiToggle} from 'uiconfig.js'

@uiFolderContainer('Root Scene')
export class RootScene extends Scene<ISceneEvent, ISceneEventTypes> implements IScene<ISceneEvent, ISceneEventTypes> {
    readonly isRootScene = true

    assetType = 'model' as const
    uiConfig!: UiObjectConfig

    // private _processors = new ObjectProcessorMap<'environment' | 'background'>()
    // private _sceneObjects: ISceneObject[] = []
    private _mainCamera: ICamera | null = null
    /**
     * The root object where all imported objects are added.
     */
    readonly modelRoot: IObject3D

    @uiColor<RootScene>('Background Color', (s)=>({
        onChange: ()=>s?.onBackgroundChange(),
    }))
    @serialize() @onChange2(RootScene.prototype.onBackgroundChange)
        backgroundColor: Color | null = null // read in three.js WebGLBackground

    @onChange2(RootScene.prototype.onBackgroundChange)
    @serialize() @uiImage('Background Image')
        background: null | Color | ITexture | 'environment' = null
    /**
     * The intensity for the environment light.
     */
    @serialize() @onChange3(RootScene.prototype.setDirty)
    @uiSlider('Background Intensity', [0, 10], 0.01)
        backgroundIntensity = 1

    @uiImage('Environment')
    @serialize() @onChange2(RootScene.prototype._onEnvironmentChange)
        environment: ITexture | null = null

    /**
     * The intensity for the environment light.
     */
    @uiSlider('Environment Intensity', [0, 10], 0.01)
    @serialize() @onChange3(RootScene.prototype.setDirty)
        envMapIntensity = 1
    /**
     * Fixed direction environment reflections irrespective of camera position.
     */
    @uiToggle('Fixed Env Direction')
    @serialize() @onChange3(RootScene.prototype.setDirty)
        fixedEnvMapDirection = false

    /**
     * The default camera in the scene
     */
    @uiConfig() @serialize() readonly defaultCamera: ICamera

    // private _environmentLight?: IEnvironmentLight

    // required just because we don't want activeCamera to be null.
    private _dummyCam = new PerspectiveCamera2('') as ICamera

    get mainCamera(): ICamera {
        return this._mainCamera || this._dummyCam
    }
    set mainCamera(camera: ICamera | undefined) {
        const cam = this.mainCamera
        if (!camera) camera = this.defaultCamera
        if (cam === camera) return
        if (cam) {
            cam.deactivateMain(undefined, true)
            cam.removeEventListener('cameraUpdate', this._mainCameraUpdate)
        }
        if (camera) {
            this._mainCamera = camera
            camera.addEventListener('cameraUpdate', this._mainCameraUpdate)
            camera.activateMain(undefined, true)
        } else {
            this._mainCamera = null
        }
        this.dispatchEvent({type: 'activeCameraChange', lastCamera: cam, camera}) // deprecated
        this.dispatchEvent({type: 'mainCameraChange', lastCamera: cam, camera})
        this.setDirty()
    }

    /**
     * Create a scene instance. This is done automatically in the {@link ThreeViewer} and must not be created separately.
     * @param camera
     * @param objectProcessor
     */
    constructor(camera: ICamera, objectProcessor?: IObjectProcessor) {
        super()
        this.setDirty = this.setDirty.bind(this)

        iObjectCommons.upgradeObject3D.call(this, undefined, objectProcessor)

        // this is called from parentDispatch since scene is a parent.
        this.addEventListener('materialUpdate', ()=>this.dispatchEvent({type: 'sceneMaterialUpdate'}))
        this.addEventListener('objectUpdate', this.refreshScene)
        this.addEventListener('geometryUpdate', this.refreshScene)
        this.addEventListener('geometryChanged', this.refreshScene)

        this.defaultCamera = camera
        this.modelRoot = new Object3D() as IObject3D
        this.modelRoot.userData.rootSceneModelRoot = true
        this.modelRoot.name = 'Scene' // for the UI
        // this.modelRoot.addEventListener('update', this.setDirty) // todo: where was this dispatched from/used ?


        // eslint-disable-next-line deprecation/deprecation
        this.add(this.modelRoot as any)
        // this.addSceneObject(this.modelRoot as any, {addToRoot: true, autoScale: false})

        // this.addSceneObject(this.defaultCamera, {addToRoot: true})
        // eslint-disable-next-line deprecation/deprecation
        this.add(this.defaultCamera)

        this.mainCamera = this.defaultCamera

        // this.boxHelper = new Box3Helper(this.getBounds())
        // this.boxHelper.userData.bboxVisible = false
        // this.boxHelper.visible = false
        // this.add(this.boxHelper)
    }

    /**
     * Add a widget (non-physical/interactive) object to the scene. like gizmos, ui components etc.
     * @param model
     * @param options
     */
    // addWidget(model: IWidget, options: AnyOptions = {}): void {
    //     if (model.assetType !== 'widget') {
    //         console.warn('Invalid asset type for ', model, ', adding anyway')
    //     }
    //     this.add(model.modelObject)
    //
    //     // todo: dispatch event, add event listeners, etc
    // }

    /**
     * Add any processed object to the scene.
     * @param imported
     * @param options
     */
    addObject<T extends IObject3D|Object3D = IObject3D>(imported: T, options?: AddObjectOptions): T&IObject3D {
        if (options?.clearSceneObjects || options?.disposeSceneObjects) {
            this.clearSceneModels(options.disposeSceneObjects)
        }
        if (!imported) return imported
        if (!imported.isObject3D) {
            console.error('Invalid object, cannot add to scene.', imported)
            return imported as T&IObject3D
        }
        this._addObject3D(<IObject3D>imported, options)
        this.dispatchEvent({type: 'addSceneObject', object: <IObject3D>imported})
        return imported as T&IObject3D
    }

    /**
     Load model root scene exported to GLTF format. Used internally by {@link ThreeViewer.addSceneObject}.
     * @param obj
     * @param options
     */
    loadModelRoot(obj: RootSceneImportResult, options?: AddObjectOptions) {
        if (options?.clearSceneObjects || options?.disposeSceneObjects) {
            this.clearSceneModels(options.disposeSceneObjects)
        }
        if (!obj.userData?.rootSceneModelRoot) {
            console.error('Invalid model root scene object. Trying to add anyway.', obj)
        }
        if (obj.userData) {
            // todo deep merge all userdata?
            if (obj.userData.__importData)
                this.modelRoot.userData.__importData = {
                    ...this.modelRoot.userData.__importData,
                    ...obj.userData.__importData,
                }
            if (obj.userData.gltfAsset) {
                this.modelRoot.userData.__gltfAsset = { // todo: merge values?
                    ...this.modelRoot.userData.__gltfAsset,
                    ...obj.userData.gltfAsset,
                }
            }
            if (obj.userData.gltfExtras)
                this.modelRoot.userData.__gltfExtras = {
                    ...this.modelRoot.userData.__gltfExtras,
                    ...obj.userData.gltfExtras,
                }
        }
        if (obj.userData?.gltfAsset?.copyright) obj.children.forEach(c => !c.userData.license && (c.userData.license = obj.userData.gltfAsset?.copyright))
        if (obj.animations) {
            if (!this.modelRoot.animations) this.modelRoot.animations = []
            for (const animation of obj.animations) {
                if (this.modelRoot.animations.includes(animation)) continue
                this.modelRoot.animations.push(animation)
            }
        }
        return obj.children.map(c=>this.addObject(c, options))
    }

    private _addObject3D(model: IObject3D|null, {autoCenter = false, autoScale = false, autoScaleRadius = 2., addToRoot = false, license}: AddObjectOptions = {}): void {
        const obj = model
        if (!obj) {
            console.error('Invalid object, cannot add to scene.')
            return
        }
        // eslint-disable-next-line deprecation/deprecation
        if (addToRoot) this.add(obj)
        else this.modelRoot.add(obj)

        if (autoCenter && !obj.userData.isCentered) {
            obj.autoCenter?.()
        } else {
            obj.userData.isCentered = true // mark as centered, so that autoCenter is not called again when file is reloaded.
        }
        if (autoScale && !obj.userData.autoScaled) {
            obj.autoScale?.(obj.userData.autoScaleRadius || autoScaleRadius)
        } else {
            obj.userData.autoScaled = true // mark as auto-scaled, so that autoScale is not called again when file is reloaded.
        }

        if (license) obj.userData.license = [obj.userData.license, license].filter(v=>v).join(', ')

        this.setDirty({refreshScene: true})
    }

    clearSceneModels(dispose = false, setDirty = true): void {
        if (dispose) return this.disposeSceneModels(setDirty)
        this.modelRoot.clear()
        this.modelRoot.children = []
        setDirty && this.setDirty({refreshScene: true})
    }

    disposeSceneModels(setDirty = true) {
        [...this.modelRoot.children].forEach(child => child.dispose ? child.dispose() : child.removeFromParent())
        this.modelRoot.clear()
        if (setDirty) this.setDirty({refreshScene: true})
    }

    private _onEnvironmentChange() {
        // console.warn('environment changed')
        if (this.environment?.mapping === UVMapping) {
            this.environment.mapping = EquirectangularReflectionMapping // for PMREMGenerator
            this.environment.needsUpdate = true
        }
        this.dispatchEvent({type: 'environmentChanged', environment: this.environment})
        this.setDirty({refreshScene: true, geometryChanged: false})
        this.refreshUi?.()
    }

    onBackgroundChange() {
        this.dispatchEvent({type: 'backgroundChanged', background: this.background, backgroundColor: this.backgroundColor})
        this.setDirty({refreshScene: true, geometryChanged: false})
        this.refreshUi?.()
    }

    /**
     * @deprecated Use {@link addObject}
     */
    add(...object: Object3D[]): this {
        super.add(...object)
        // this._onSceneUpdate() // this is not needed, since it will be bubbled up from the object3d and we will get event objectUpdate
        return this
    }

    /**
     * Sets the backgroundColor property from a string, number or Color, and updates the scene.
     * @param color
     */
    setBackgroundColor(color: string | number | Color | null) {
        this.backgroundColor = color ? new Color(color) : null
    }

    /**
     * Mark the scene dirty, and force render in the next frame.
     * @param options - set `refreshScene` to true to mark that any object transformations have changed. It might trigger effects like frame fade depening on plugins.
     * @returns {this}
     */
    setDirty(options?: ISceneSetDirtyOptions): this {
        // todo: for onChange calls -> check options.key for specific key that's changed and use it to determine refreshScene
        if (options?.sceneUpdate) {
            console.warn('sceneUpdate is deprecated, use refreshScene instead.')
            options.refreshScene = true
        }
        if (options?.refreshScene) {
            this.refreshScene(options)
        } else {
            this.dispatchEvent({type: 'update'}) // todo remove
            iObjectCommons.setDirty.call(this, {...options, scene: this})
        } // this sets dirty in the viewer
        return this
    }


    private _mainCameraUpdate = () => {
        this.setDirty({refreshScene: false})
        this.refreshActiveCameraNearFar()
        this.dispatchEvent({type: 'mainCameraUpdate'})
        this.dispatchEvent({type: 'activeCameraUpdate'}) // deprecated
    }

    // cached values
    private _sceneBounds: Box3B = new Box3B
    private _sceneBoundingRadius = 0
    /**
     * For visualizing the scene bounds. API incomplete.
     * @type {Box3Helper}
     */
    // readonly boxHelper: Box3Helper

    refreshScene(event?: Partial<ISceneEvent> & ISceneSetDirtyOptions): this {
        if (event && event.type === 'objectUpdate' && event.object === this) return this // ignore self
        if (event?.sceneUpdate === false || event?.refreshScene === false) return this.setDirty(event) // so that it doesn't trigger frame fade, shadow refresh etc
        // console.warn(event)
        this.refreshActiveCameraNearFar()
        this._sceneBounds = this.getBounds(false, true)
        // this.boxHelper?.boxHelper?.copy?.(this._sceneBounds)
        this._sceneBoundingRadius = this._sceneBounds.getSize(new Vector3()).length() / 2.
        this.dispatchEvent({...event, type: 'sceneUpdate', hierarchyChanged: ['addedToParent', 'removedFromParent'].includes(event?.change || '')})
        iObjectCommons.setDirty.call(this, event)
        return this
    }

    refreshUi = iObjectCommons.refreshUi.bind(this)

    /**
     * Dispose the scene and clear all resources.
     * @warn Not fully implemented yet, just clears the scene.
     */
    dispose(): void {
        this.disposeSceneModels();
        [...this.children].forEach(child => child.dispose ? child.dispose() : child.removeFromParent())
        this.clear()

        // todo: dispose more stuff?
        this.environment?.dispose()
        if ((this.background as ITexture)?.isTexture) (this.background as ITexture)?.dispose?.()
        this.environment = null
        this.background = null
        return
    }

    /**
     * Returns the bounding box of the scene model root.
     * @param precise
     * @param ignoreInvisible
     * @param ignoreWidgets
     * @param ignoreObject
     * @returns {Box3B}
     */
    getBounds(precise = false, ignoreInvisible = true, ignoreWidgets = true, ignoreObject?: (obj: Object3D)=>boolean): Box3B {
        // See bboxVisible in userdata in Box3B
        return new Box3B().expandByObject(this, precise, ignoreInvisible, (o: any)=>{
            if (ignoreWidgets && ((o as IWidget).isWidget || o.assetType === 'widget')) return true
            return ignoreObject?.(o) ?? false
        })
    }

    private _v1 = new Vector3()
    private _v2 = new Vector3()

    /**
     * Refreshes the scene active camera near far values, based on the scene bounding box.
     * This is called automatically every time the camera is updated.
     */
    refreshActiveCameraNearFar(): void {
        const camera = this.mainCamera as ICamera
        if (!camera) return
        if (camera.userData.autoNearFar === false) {
            camera.near = camera.userData.minNearPlane ?? 0.5
            camera.far = camera.userData.maxFarPlane ?? 1000
            return
        }

        // todo check if this takes too much time with large scenes(when moving the camera and not animating), but we also need to support animations
        const bbox = this.getBounds(false) // todo: can we use this._sceneBounds or will it have some issue with animation?
        camera.getWorldPosition(this._v1).sub(bbox.getCenter(this._v2))
        const radius = 1.5 * bbox.getSize(this._v2).length() / 2.
        const dist = this._v1.length()

        // new way
        const dist1 = Math.max(0.1, -this._v1.normalize().dot(camera.getWorldDirection(new Vector3())))
        const near = Math.max(camera.userData.minNearPlane ?? 0.5, dist1 * (dist - radius))
        const far = Math.min(Math.max(near + radius, dist1 * (dist + radius)), camera.userData.maxFarPlane ?? 1000)

        // old way, has issues when panning very far from the camera target
        // const near = Math.max(camera.userData.minNearPlane ?? 0.2, dist - radius)
        // const far = Math.min(Math.max(near + 1, dist + radius), camera.userData.maxFarPlane ?? 1000)

        camera.near = near
        camera.far = far

        // todo try using minimum of all 6 endpoints of bbox.

        // camera.near = 3
        // camera.far = 20
    }

    updateShaderProperties(material: {defines: Record<string, string|number|undefined>, uniforms: {[name: string]: IUniform}}): this {
        if (material.uniforms.sceneBoundingRadius) material.uniforms.sceneBoundingRadius.value = this._sceneBoundingRadius
        else console.warn('BaseRenderer: no uniform: frameCount')
        return this
    }

    /**
     * Serialize the scene properties
     * @param meta
     * @returns {any}
     */
    toJSON(meta?: any): any {
        const o = ThreeSerialization.Serialize(this, meta, true)
        // console.log(o)
        return o
    }

    /**
     * Deserialize the scene properties
     * @param json - object from {@link toJSON}
     * @param meta
     * @returns {this<TCamera>}
     */
    fromJSON(json: any, meta?: any): this {
        const env = json.environment
        if (env !== undefined) {
            this.environment = ThreeSerialization.Deserialize(env, this.environment, meta, false)
            delete json.environment
        }
        ThreeSerialization.Deserialize(json, this, meta, true)
        json.environment = env
        return this
    }

    addEventListener<T extends ISceneEventTypes>(type: T, listener: EventListener<ISceneEvent, T, this>): void {
        if (type === 'activeCameraChange') console.error('activeCameraChange is deprecated. Use mainCameraChange instead.')
        if (type === 'activeCameraUpdate') console.error('activeCameraUpdate is deprecated. Use mainCameraUpdate instead.')
        if (type === 'sceneMaterialUpdate') console.error('sceneMaterialUpdate is deprecated. Use materialUpdate instead.')
        if (type === 'update') console.error('update is deprecated. Use sceneUpdate instead.')
        super.addEventListener(type, listener)
    }


    // region inherited type fixes
    // re-declaring from IObject3D because: https://github.com/microsoft/TypeScript/issues/16936

    traverse: (callback: (object: IObject3D) => void) => void
    traverseVisible: (callback: (object: IObject3D) => void) => void
    traverseAncestors: (callback: (object: IObject3D) => void) => void
    getObjectById: <T extends IObject3D = IObject3D>(id: number) => T | undefined
    getObjectByName: <T extends IObject3D = IObject3D>(name: string) => T | undefined
    getObjectByProperty: <T extends IObject3D = IObject3D>(name: string, value: string) => T | undefined
    copy: (source: this, recursive?: boolean, ...args: any[]) => this
    clone: (recursive?: boolean) => this
    remove: (...object: IObject3D[]) => this
    dispatchEvent: (event: ISceneEvent) => void
    parent: null
    children: IObject3D[]

    // endregion


    // region deprecated

    // /**
    //  * Set the scene environment map, this will be processed with PMREM automatically later.
    //  * @param asset
    //  * @returns {void}
    //  */
    // public setEnvironment(asset: ITexture|null|undefined): void {
    //     if (!asset) {
    //         // eslint-disable-next-line deprecation/deprecation
    //         this.environment = null
    //         this._onEnvironmentChange()
    //         return
    //     }
    //     if (!asset.isTexture) {
    //         console.error('Unknown Environment type', asset)
    //         return
    //     }
    //     if (asset.mapping === UVMapping) {
    //         asset.mapping = EquirectangularReflectionMapping // for PMREMGenerator
    //         asset.needsUpdate = true
    //     }
    //     // eslint-disable-next-line deprecation/deprecation
    //     this.environment = asset
    //     // eslint-disable-next-line deprecation/deprecation
    //     // this.background = texture // for testing.
    //     this._onEnvironmentChange()
    // }
    //
    // /**
    //  * Get the current scene environment map
    //  * @returns {ITexture<Texture>}
    //  */
    // getEnvironment(): ITexture | null {
    //     return this.environment || null
    // }


    /**
     * Find objects by name exact match in the complete hierarchy.
     * @deprecated Use {@link getObjectByName} instead.
     * @param name - name
     * @param parent - optional root node to start search from
     * @returns Array of found objects
     */
    public findObjectsByName(name: string, parent?: IObject3D): IObject3D[] {
        const o: IObject3D[] = [];
        (parent ?? this).traverse(object => {
            if (object.name === name) o.push(object)
        })
        return o
    }

    /**
     * @deprecated
     * Sets the camera pointing towards the object at a specific distance.
     * @param rootObject - The object to point at.
     * @param centerOffset - The distance offset from the object to point at.
     * @param targetOffset - The distance offset for the target from the center of object to point at.
     * @param options - Not used yet.
     */
    resetCamera(rootObject:Object3D|undefined = undefined, centerOffset = new Vector3(1, 1, 1), targetOffset = new Vector3(0, 0, 0)): void {
        if (this._mainCamera) {
            this.matrixWorldNeedsUpdate = true
            this.updateMatrixWorld(true)
            const bounds = rootObject ? new Box3B().expandByObject(rootObject, true, true) : this.getBounds(true)
            const center = bounds.getCenter(new Vector3())
            const radius = bounds.getSize(new Vector3()).length() * 0.5

            center.add(targetOffset.clone().multiplyScalar(radius))

            this._mainCamera.position = new Vector3( // todo: for nested cameras?
                center.x + centerOffset.x * radius,
                center.y + centerOffset.y * radius,
                center.z + centerOffset.z * radius,
            )
            this._mainCamera.target = center
            // this.scene.mainCamera.controls?.targetOffset.set(0, 0, 0)
            this.setDirty()
        }

    }


    /**
     * Minimum Camera near plane
     * @deprecated - use camera.minNearPlane instead
     */
    get minNearDistance(): number {
        console.error('minNearDistance is deprecated. Use camera.userData.minNearPlane instead')
        return this.mainCamera.userData.minNearPlane ?? 0.02
    }
    /**
     * @deprecated - use camera.minNearPlane instead
     */
    set minNearDistance(value: number) {
        console.error('minNearDistance is deprecated. Use camera.userData.minNearPlane instead')
        if (this.mainCamera)
            this.mainCamera.userData.minNearPlane = value
    }


    /**
     * @deprecated
     */
    get activeCamera(): ICamera {
        console.error('activeCamera is deprecated. Use mainCamera instead.')
        return this.mainCamera
    }

    /**
     * @deprecated
     */
    set activeCamera(camera: ICamera | undefined) {
        console.error('activeCamera is deprecated. Use mainCamera instead.')
        this.mainCamera = camera
    }

    /**
     * Get the threejs scene object
     * @deprecated
     */
    get modelObject(): this {
        return this as any
    }

    /**
     * @deprecated use {@link envMapIntensity} instead
     */
    get environmentIntensity(): number {
        return this.envMapIntensity
    }

    /**
     * @deprecated use {@link envMapIntensity} instead
     */
    set environmentIntensity(value: number) {
        this.envMapIntensity = value
    }

    /**
     * Add any processed scene object to the scene.
     * @deprecated renamed to {@link addObject}
     * @param imported
     * @param options
     */
    addSceneObject<T extends IObject3D|Object3D = IObject3D>(imported: T, options?: AddObjectOptions): T {
        return this.addObject(imported, options)
    }

    /**
     * Equivalent to setDirty({refreshScene: true}), dispatches 'sceneUpdate' event with the specified options.
     * @deprecated use refreshScene
     * @param options
     */
    updateScene(options?: AnyOptions): this {
        console.warn('updateScene is deprecated. Use refreshScene instead')
        return this.refreshScene(options || {})
    }

    /**
     * @deprecated renamed to {@link clearSceneModels}
     */
    removeSceneModels() {
        this.clearSceneModels()
    }

    // endregion
}
