import {
    BaseGroundPlugin,
    BasicShadowMap,
    bindToValue,
    Event,
    generateUiConfig,
    IGeometry,
    IMaterial,
    IRenderTarget,
    IScene,
    ISceneEventMap,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh2,
    NoColorSpace,
    onChange,
    PCFShadowMap,
    PCFSoftShadowMap,
    PlaneGeometry,
    RGBAFormat,
    serialize,
    ThreeViewer,
    UiObjectConfig,
    uiToggle,
    UnsignedByteType,
    VSMShadowMap,
} from 'threepipe'
import {SSReflectionPlugin} from '../postprocessing/SSReflectionPlugin'
import {Reflector2} from '../../utils/Reflector2'
import {ShadowMapBaker} from '../../utils/ShadowMapBaker'

export class AdvancedGroundPlugin extends BaseGroundPlugin {
    public static readonly PluginType: string = 'AdvancedGroundPlugin'

    get shadowBaker(): ShadowMapBaker | undefined {
        return this._shadowBaker
    }

    @onChange(AdvancedGroundPlugin.prototype._refresh3)
    @uiToggle('Baked Shadows') @serialize() bakedShadows = true
    @onChange(AdvancedGroundPlugin.prototype._refresh3)
    @uiToggle('Planar Reflections') @serialize() groundReflection = false
    @onChange(AdvancedGroundPlugin.prototype._refresh3)
    @uiToggle('Physical Reflections') @serialize() physicalReflections = false
    @onChange(AdvancedGroundPlugin.prototype._refresh3)
    @uiToggle('Auto Shadow Frustum Size') @serialize() autoFrustumSize = true

    // because of inheritance breaks onChange
    private _refresh3(): void {
        this.refresh()
    }

    @serialize('shadowBaker')
    private _shadowBaker?: ShadowMapBaker
    // private _showDebug: boolean

    /**
     * autoBakeShadows - when true, shadows are baked automatically on scene update(whenever any object in the scene changes), set it to `false` to trigger baking manually with {@see bakeShadows()}
     */
    autoBakeShadows = true

    /**
     * bake shadows manually, to be used with {@see autoBakeShadows} set to false
     */
    bakeShadows() {
        this._shadowBaker?.reset()
    }

    constructor() {
        super()
        this._onSceneUpdate = this._onSceneUpdate.bind(this)
        const generatedUi = generateUiConfig(this)
        const matUI = generatedUi.find(f=>typeof f === 'function')!
        this.uiConfig = {
            label: 'Ground',
            type: 'folder',
            children: [
                ...generatedUi.filter(f => f !== matUI),
                ...this._extraUiConfig(),
                matUI,
            ],
        }
    }

    protected _createMesh(mesh?: Mesh2<IGeometry & PlaneGeometry, IMaterial>) {
        if (mesh) throw new Error('AdvancedGroundPlugin - mesh should not be provided')
        // created once on first use and reused: Reflector2 asks for the target on every reflection update
        const reflector = new Reflector2<IGeometry&PlaneGeometry>(this._geometry, ()=>this._reflectionTarget ??= this._viewer?.renderManager.createTarget({
            // type: HalfFloatType,
            type: UnsignedByteType,
            format: RGBAFormat,
            colorSpace: NoColorSpace, // todo: we can do rgbm if only opaque objects will be reflected
            size: {width: 1024, height: 1024},
            generateMipmaps: true,
            depthBuffer: true,
            minFilter: LinearMipmapLinearFilter,
            magFilter: LinearFilter,
            // isAntialiased: this._viewer.isAntialiased,
        })!, 0, this._createMaterial())
        const superOnBeforeRender = reflector.onBeforeRender

        // todo why is this required?
        reflector.onBeforeRender = (...params) => {
            let ssr = this._viewer?.getPluginByType<SSReflectionPlugin>('SSReflectionPlugin')
            if (ssr && ssr.isDisabled()) ssr = undefined
            if (ssr) ssr.disable(reflector.uuid, false) // todo: do we need to disable ssao also?

            // todo  ssbevel
            // let ssbevel = this._viewer?.getPluginByType<SSBevelPlugin>('SSBevelPlugin')?.pass?.passObject
            // if (ssbevel && !ssbevel.enabled) ssbevel = undefined
            // if (ssbevel) ssbevel.enabled = false

            superOnBeforeRender(...params)

            if (ssr) ssr.enable(reflector.uuid, false)
            // if (ssbevel) ssbevel.enabled = true // todo ssbevel
        }
        return reflector
    }

    declare _mesh: Reflector2<IGeometry&PlaneGeometry>
    private _reflectionTarget?: IRenderTarget

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
    }

    protected _postFrame() {
        super._postFrame()
        if (!this._viewer) return
        if (!this.enabled) return
        if (this._shadowBaker && this.bakedShadows) {
            this._shadowBaker.autoUpdateShadow()
        }

    }
    protected _preRender() {
        super._preRender()
        if (!this._viewer) return
        this._mesh.reflectionTargetNeedsUpdate = this._viewer.renderManager.frameCount < 1
    }

    onRemove(viewer: ThreeViewer) {
        if (this._reflectionTarget) {
            viewer.renderManager.disposeTarget(this._reflectionTarget)
            this._reflectionTarget = undefined
        }
        return super.onRemove(viewer)
    }

    protected _removeMaterial() {
        if (!this._material) return
        if (this._shadowBaker && (this._material as any).groundMatExtension) {
            this._material.unregisterMaterialExtensions?.([this._shadowBaker.materialExtension])
            delete (this._material as any).groundMatExtension
        }
        if ((this._material as any).reflectorMatExtension) {
            const ext = this._mesh.materialExtension
            if (!ext) this._viewer?.console.warn('AdavancedGroundPlugin: unable to find the extension to unregister')
            this._material.unregisterMaterialExtensions?.([ext])
            delete (this._material as any).reflectorMatExtension
        }
        // todo: remove map or render target thats assigned

        super._removeMaterial()
    }

    protected _onSceneUpdate(event: ISceneEventMap['addSceneObject' | 'sceneUpdate'] & Event<'addSceneObject' | 'sceneUpdate', IScene>) {
        super._onSceneUpdate(event)
        // Skip widget/widgetRoot changes (e.g. selection widgets being added/removed)
        if (event?.object?.assetType === 'widget' || event?.object?.userData?.isWidgetRoot) return
        if (event.geometryChanged === false) return
        this.autoResetShadows()
    }

    autoResetShadows = () => {
        if (this.autoBakeShadows) this._shadowBaker?.reset()
    }

    public refresh(): void {
        if (!this._viewer) return
        if (!this.isDisabled()) {
            if (this.bakedShadows && !this._shadowBaker) {
                this._shadowBaker = new ShadowMapBaker(this._viewer)
                this._shadowBaker.attachedMesh = this._mesh
            } else if (!this.bakedShadows && this._shadowBaker) {
                this._shadowBaker.reset()
                this._shadowBaker.cleanupMaterial()
            }
            const ref = this._mesh
            if (ref.isReflector2) {
                ref.enabled = this.groundReflection
                ref.reflectorModePhysical = this.physicalReflections
            }
        }
        super.refresh()
        // this._viewer.setDirty(this)
    }

    protected _refreshTransform() {
        if (!super._refreshTransform()) return false
        if (this.autoFrustumSize) {
            const baker = this.shadowBaker
            if (baker) {
                const fs = this.size / 2
                if (fs !== baker.light.shadowParams.frustumSize) {
                    baker.light.shadowParams.frustumSize = fs
                    baker.light.updateShadowParams()
                    baker.reset()
                }
                // ground.bakeShadows()
            }
        }
        return true
    }

    // see BaseGroundPlugin
    fromJSON(data: any, meta?: any): this | null {
        if (!super.fromJSON(data, meta)) return null
        if (data.autoFrustumSize === undefined) this.autoFrustumSize = false // for files which were saved before this option was added.
        return this
    }

    protected _refreshMaterial() {
        if (!this._viewer) return false
        super._refreshMaterial()
        if (!this._material) return

        if (this.groundReflection && this._mesh.isReflector2 && !(this._material as any).reflectorMatExtension) {
            const ext = this._mesh.materialExtension
            ext.updaters = [this._viewer.scene, this._viewer.renderManager]
            this._material.registerMaterialExtensions?.([ext])
            ;(this._material as any).reflectorMatExtension = true
        }
        if (this.bakedShadows && this._shadowBaker && !(this._material as any).groundMatExtension) {
            this._material.registerMaterialExtensions?.([this._shadowBaker.materialExtension])
            ;(this._material as any).groundMatExtension = true
        }

        this._material.userData.ssreflDisabled = this.groundReflection
        this._material.userData.ssreflNonPhysical = !this.physicalReflections
        this._material.userData.ssaoDisabled = true
        this._material.userData.sscsDisabled = true
        this._viewer.setDirty(this)
    }

    uiConfig: UiObjectConfig
    protected _extraUiConfig(): (UiObjectConfig | (() => UiObjectConfig|UiObjectConfig[]))[] {
        return [
            {
                label: 'Shadow Frames',
                type: 'input',
                hidden: ()=> !this._shadowBaker,
                stepSize: 1,
                bounds: [1, 1000],
                property: ()=>[this._shadowBaker, 'maxFrameNumber'],
            },
            {
                label: 'Alpha Vignette',
                type: 'checkbox',
                hidden: ()=> !this._material || (this._material.transmission || 0) < 0.0001 && !this._material.transparent,
                property: ()=>[this._shadowBaker, 'alphaVignette'],
                limitedUi: true,
                onChange: ()=>this.uiConfig?.uiRefresh?.(true, 'postFrame'),
            },
            {
                label: 'Alpha Vignette Axis',
                type: 'dropdown',
                hidden: ()=> !this._shadowBaker?.alphaVignette || !this._material || (this._material.transmission || 0) < 0.0001 && !this._material.transparent,
                property: ()=>[this._shadowBaker, 'alphaVignetteAxis'],
                children: ['x', 'y', 'xy'].map(v => ({label: v, value: v})),
                limitedUi: true,
            },
            {
                label: 'Shadow type',
                type: 'dropdown',
                hidden: ()=> !this._shadowBaker,
                property: ()=>[this._shadowBaker, 'groundMapMode'],
                children: [
                    {label: 'aoMap'},
                    {label: 'map'},
                    {label: 'alphaMap'},
                ],
                limitedUi: true,
            },
            {
                label: 'Smooth Shadow',
                type: 'checkbox',
                property: ()=>[this._shadowBaker, 'smoothShadow'],
            },
            {
                label: 'Baked shadow type',
                type: 'dropdown',
                children: [['Basic', BasicShadowMap], ['PCF', PCFShadowMap], ['PCFSoft', PCFSoftShadowMap], ['VSM', VSMShadowMap]].map((v) => ({label: v[0].toString(), value: v[1]})),
                property: ()=>[this._shadowBaker, 'shadowMapType'],
            },
            {
                type: 'folder',
                label: 'Randomized Light',
                hidden: ()=> !this._shadowBaker,
                limitedUi: true,
                children: [
                    {
                        type: 'color',
                        label: 'Color',
                        property: ()=>[this._shadowBaker?.light, 'color'],
                    },
                    // {
                    //     type: 'slider',
                    //     label: 'Intensity',
                    //     bounds: [0, 100],
                    //     property: ()=>[this._shadowBaker?.light, 'intensity'],
                    // },
                    // {
                    //     type: 'checkbox',
                    //     label: 'Shadow Enabled',
                    //     property: ()=>[this._shadowBaker?.light?.shadowParams, 'enabled'],
                    //     onChange: [this._shadowBaker?.light?.updateShadowParams, this.autoResetShadows],
                    // },
                    {
                        type: 'slider',
                        bounds: [0.0, 1],
                        property: ()=>[this._shadowBaker?.light?.randomParams, 'focus'],
                        onChange: this.autoResetShadows,
                    },
                    {
                        type: 'slider',
                        bounds: [0.0, 1],
                        property: ()=>[this._shadowBaker?.light?.randomParams, 'spread'],
                        onChange: this.autoResetShadows,
                        limitedUi: true,
                    },
                    {
                        type: 'slider',
                        bounds: [0.01, 60],
                        property: ()=>[this._shadowBaker?.light?.randomParams, 'distanceScale'],
                        onChange: [this._shadowBaker?.light?.updateShadowParams, this.autoResetShadows],
                    },
                    {
                        type: 'vec3',
                        bounds: [-1, 1],
                        property: ()=>[this._shadowBaker?.light?.randomParams, 'direction'],
                        onChange: this.autoResetShadows,
                        limitedUi: true,
                    },
                    {
                        type: 'vec3',
                        bounds: [-1, 1],
                        property: ()=>[this._shadowBaker?.light?.randomParams, 'normalDirection'],
                        onChange: this.autoResetShadows,
                        limitedUi: true,
                    },
                    {
                        type: 'slider',
                        bounds: [0.01, 10],
                        property: ()=>[this._shadowBaker?.light?.shadowParams, 'radius'],
                        onChange: [this._shadowBaker?.light?.updateShadowParams, this.autoResetShadows],
                    },
                    {
                        type: 'input',
                        property: ()=>[this._shadowBaker?.light?.shadowParams, 'frustumSize'],
                        hidden: ()=> this.autoFrustumSize,
                        onChange: [this._shadowBaker?.light?.updateShadowParams, this.autoResetShadows],
                    },
                    {
                        type: 'slider',
                        bounds: [-0.1, 0.1],
                        property: ()=>[this._shadowBaker?.light?.shadowParams, 'bias'],
                        onChange: [this._shadowBaker?.light?.updateShadowParams, this.autoResetShadows],
                    },
                ],
            },
        ]
    }

    @bindToValue({key: 'groundReflection'})
        planarReflections: boolean
}

/**
 * @deprecated - use {@link AdvancedGroundPlugin} instead
 */
export const GroundPlugin = AdvancedGroundPlugin
