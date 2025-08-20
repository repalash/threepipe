import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IGeometry, iGeometryCommons, IMaterial, IScene, ISceneEventMap, Mesh2, PhysicalMaterial} from '../../core'
import {BufferAttribute, BufferGeometry, Euler, InterleavedBufferAttribute, PlaneGeometry, Vector3, Event} from 'three'
import {onChange, onChange2, serialize} from 'ts-browser-helpers'
import {bindToValue, OrbitControls3} from '../../three'
import {uiConfig, uiFolderContainer, uiNumber, uiToggle} from 'uiconfig.js'

@uiFolderContainer('Ground')
export class BaseGroundPlugin<TE extends AViewerPluginEventMap = AViewerPluginEventMap> extends AViewerPluginSync<TE> {
    public static readonly PluginType: string = 'BaseGroundPlugin'
    public static readonly OldPluginType: string = 'Ground'

    get enabled() {
        return this.visible
    }

    set enabled(value) {
        this.visible = value
    }

    protected _geometry: IGeometry&PlaneGeometry

    protected _mesh: Mesh2<IGeometry&PlaneGeometry, IMaterial>
    protected _defaultMaterial: IMaterial
    private _transformNeedRefresh = true

    constructor() {
        super()
        this._refreshMaterial = this._refreshMaterial.bind(this)
        this._refreshTransform = this._refreshTransform.bind(this)
        this._refreshCameraLimits = this._refreshCameraLimits.bind(this)
        this.refresh = this.refresh.bind(this)
        this._refresh2 = this._refresh2.bind(this)
        this._onSceneUpdate = this._onSceneUpdate.bind(this)
        this._preRender = this._preRender.bind(this)
        this._postFrame = this._postFrame.bind(this)
        this._geometry = iGeometryCommons.upgradeGeometry.call(new PlaneGeometry(1, 1, 1, 1))
        this._geometry.attributes.uv2 = (this._geometry.attributes.uv as any as BufferAttribute | InterleavedBufferAttribute).clone()
        this._geometry.attributes.uv2.needsUpdate = true
        this._mesh = this._createMesh()
        this._defaultMaterial = this._mesh.material
        this.refresh()
    }

    @uiToggle('Visible')
    @onChange(BaseGroundPlugin.prototype.refreshTransform)
    @serialize() visible = true

    @uiNumber('Size')
    @onChange2(BaseGroundPlugin.prototype._onSceneUpdate)
    @serialize() size = 8

    @uiNumber('Height (yOffset)')
    @onChange2(BaseGroundPlugin.prototype._onSceneUpdate)
    @serialize() yOffset = 0

    @uiToggle('Render to Depth')
    @onChange(BaseGroundPlugin.prototype._refresh2)
    @serialize() renderToDepth = true

    /**
     * If false, the ground will not be tonemapped in post processing.
     * note: this will only work when {@link GBufferPlugin} is being used. Also needs {@link renderToDepth} to be true.
     */
    @uiToggle('Tonemap Ground')
    @onChange(BaseGroundPlugin.prototype._refresh2)
    @serialize() tonemapGround = true

    /**
     * If true, the camera will be limited to not go below the ground.
     * note: this will only work when {@link OrbitControls3} or three.js OrbitControls are being used.
     */
    @uiToggle('Limit Camera Above Ground')
    @onChange(BaseGroundPlugin.prototype._refreshCameraLimits)
    @serialize() limitCameraAboveGround = false

    @uiToggle('Auto Adjust Transform')
    @onChange(BaseGroundPlugin.prototype.refreshTransform)
    @serialize() autoAdjustTransform = true

    @serialize('material')
    @uiConfig()
    @bindToValue({obj: 'mesh', key: 'material', allowUndefined: true})
    protected _material?: IMaterial

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        // if (viewer.getPlugin('TweakpaneUi')) console.error('TweakpaneUiPlugin must be added after Ground Plugin')

        viewer.scene.addObject(this._mesh, {addToRoot: true})
        viewer.scene.addEventListener('sceneUpdate', this._onSceneUpdate) // todo: refresh when update...
        // todo use object3dmanager here instead of addSceneObject
        viewer.scene.addEventListener('addSceneObject', this._onSceneUpdate)
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postFrame', this._postFrame)
        this.refresh()
    }

    onRemove(viewer: ThreeViewer): void {
        this._mesh?.dispose(true)
        this._removeMaterial()
        viewer.scene.removeEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.removeEventListener('addSceneObject', this._onSceneUpdate)
        viewer.removeEventListener('postFrame', this._postFrame)
        viewer.removeEventListener('preRender', this._preRender)
        return super.onRemove(viewer)
    }

    protected _postFrame() {
        if (this._transformNeedRefresh) this._refreshTransform()
        if (!this._viewer) return
    }

    protected _preRender() {
        if (!this._viewer) return
    }

    dispose(): void {
        this._removeMaterial()
        this._geometry.dispose()
        this._material?.dispose() // todo
        this._mesh?.dispose?.()
        super.dispose()
    }

    protected _removeMaterial() {
        if (!this._material || this._material === this._defaultMaterial) return
        // this._manager?.materials?.unregisterMaterial(this._material)
        this._material.userData.renderToDepth = this._material.userData.__renderToDepth
        this._material.userData.__renderToDepth = undefined
        // todo reset gBufferData.tonemapEnabled also
        this._material = this._defaultMaterial
    }

    protected _onSceneUpdate(event?: ISceneEventMap['addSceneObject' | 'sceneUpdate'] & Event<'addSceneObject' | 'sceneUpdate', IScene>) {
        if (event?.geometryChanged === false) return
        if (event?.updateGround !== false)
            this.refreshTransform()
    }

    /**
     * Extra flag for plugins to disable transform refresh like when animating or dragging
     */
    enableRefreshTransform = true

    refreshTransform(): void {
        if (!this.enableRefreshTransform) return
        this._transformNeedRefresh = true
    }

    public refresh(): void {
        if (!this._viewer) return
        this._refreshMaterial()
        this.refreshTransform()
        this._refreshCameraLimits()
    }

    // because of inheritance breaks onChange
    private _refresh2(): void {
        this.refresh()
    }


    private _cameraLimitsSet = false
    private _cameraLastMaxPolarAngle = Math.PI
    private _refreshCameraLimits() {
        const orbit = this._viewer?.scene.mainCamera.controls as OrbitControls3
        if (!orbit) return
        if (orbit.maxPolarAngle === undefined) {
            console.warn('refreshCameraLimits only available with orbit controls.')
            return
        }
        if (this.limitCameraAboveGround) {
            if (!this._cameraLimitsSet) this._cameraLastMaxPolarAngle = orbit.maxPolarAngle
            orbit.maxPolarAngle = Math.PI / 2
            this._cameraLimitsSet = true
        } else if (this._cameraLimitsSet) {
            orbit.maxPolarAngle = this._cameraLastMaxPolarAngle
            this._cameraLimitsSet = false
        }

    }

    // not serialized. this can be controlled by other plugins like ModelStagePlugin and serialized there
    useModelBounds = true

    protected _refreshTransform() {
        if (!this._mesh) return false
        if (!this._viewer) return false
        let updated = false
        if (this.visible !== this._mesh.visible) {
            this._mesh.visible = this.visible
            updated = true
        }
        if (this.isDisabled()) {
            if (updated) this._viewer?.scene.setDirty()
            return false
        }
        if (this.autoAdjustTransform) {
            this._mesh.userData.bboxVisible = false

            const bbox = this.useModelBounds ?
                this._viewer.scene.getModelBounds(true, true, true) :
                this._viewer.scene.getBounds(true, true, true)

            this._mesh.userData.bboxVisible = true
            const v = bbox.getCenter(
                new Vector3()).sub(new Vector3(0,
                bbox.getSize(new Vector3()).y / 2 + this.yOffset,
                0))
            updated = updated || v.clone().sub(this._mesh.position).length() > 0.0001
            if (updated) {
                this._mesh.position.copy(v)
            }
        }
        updated = updated || Math.abs(this._mesh.scale.x - this.size) > 0.0001
        // todo: check rotation, someone could externally change it
        if (updated) {
            this._mesh.scale.setScalar(this.size)
            // this._mesh.lookAt(new Vector3().fromArray(this._options.up))
            this._mesh.setRotationFromEuler(new Euler(-Math.PI / 2., 0, this._mesh.rotation.z))
            this._mesh.matrixWorldNeedsUpdate = true
            this._mesh.setDirty({refreshScene: false, source: BaseGroundPlugin.PluginType})
            // this._viewer.scene.setDirty()
        }
        this._transformNeedRefresh = false
        return true
    }


    protected _createMesh(mesh?: Mesh2<IGeometry&PlaneGeometry, IMaterial>): Mesh2<IGeometry&PlaneGeometry, IMaterial> {
        if (!mesh) mesh = new Mesh2(this._geometry, this._createMaterial())
        else mesh.geometry = this._geometry
        if (mesh) {
            mesh.userData.physicsMass = 0
            mesh.userData.userSelectable = false
            mesh.userData.isGroundMesh = true
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.name = 'Ground Plane'
        }
        return mesh
    }

    setGeometry(g?: BufferGeometry) {
        if (!g) g = this._geometry
        else if (this._geometry) this._geometry.dispose()
        if (!g) return
        iGeometryCommons.upgradeGeometry.call(g)
        if (!this._geometry.attributes.uv2) {
            this._geometry.attributes.uv2 = (this._geometry.attributes.uv as any as BufferAttribute | InterleavedBufferAttribute).clone()
            this._geometry.attributes.uv2.needsUpdate = true
        }
        if (this._mesh) this._mesh.geometry = this._geometry
    }


    protected _createMaterial(material?: PhysicalMaterial): PhysicalMaterial {
        if (!material) material = new PhysicalMaterial({
            name: 'BaseGroundMaterial',
            color: 0xffffff,
            roughness: 0.8,
            metalness: 0.5,
        })
        material.userData.runtimeMaterial = true
        return material
    }

    protected _refreshMaterial() {
        if (!this._viewer) return
        if (this.isDisabled()) return
        if (!this._material) { // new material
            // this._removeMaterial()
            this._material = this._defaultMaterial
            // const id = this._material?.uuid
            // if (!id) console.warn('No material found for ground')
            this._viewer.scene.setDirty()
            // if (this._mesh && this._material) {
            //     this._mesh.material = this._material // must be set even if same, for update event handlers.
            // }
        }
        if (this._material.userData.__renderToDepth === undefined) {
            this._material.userData.__renderToDepth = this._material.userData.renderToDepth
        }
        if (this._material.userData.renderToDepth !== this.renderToDepth) {
            this._material.userData.renderToDepth = this.renderToDepth // required to work with SSR, SSAO etc when the ground is transparent / transmissive
        }
        if (!this._material.userData.gBufferData) this._material.userData.gBufferData = {}
        if (this._material.userData.gBufferData.__tonemapEnabled === undefined) {
            this._material.userData.gBufferData.__tonemapEnabled = this._material.userData.gBufferData.tonemapEnabled
        }
        if (this._material.userData.gBufferData.tonemapEnabled !== this.tonemapGround) {
            this._material.userData.gBufferData.tonemapEnabled = this.tonemapGround
        }
        // this._material.userData.ssaoDisabled = true //todo should be in BakedGroundPlugin
        // this._material.userData.sscsDisabled = true //todo should be in BakedGroundPlugin

        // if (this._material.userData.__postTonemap === undefined) {
        //     this._material.userData.__postTonemap = this._material.userData.postTonemap
        // }
        // if (this._material.userData.postTonemap !== this.tonemapGround) {
        //     this._material.userData.postTonemap = this.tonemapGround
        // }
        this._viewer.setDirty(this) // todo: something else also?
        return
    }

    get material() {
        return this._material
    }

    get mesh() {
        return this._mesh
    }

    fromJSON(data: any, meta?: any): this | null {
        if (data.options) {
            console.error('todo: support old webgi v0 file')
        }
        if (!super.fromJSON(data, meta)) return null
        // if (this._material && this._material.transmission >= 0.01) this._material.transparent = true
        this.refresh()
        // Note: baked shadow reset is done in ShadowMapBaker.fromJSON
        return this
    }

}

declare module '../../core/IScene' {
    interface ISceneSetDirtyOptions {
        updateGround?: boolean
    }
}
