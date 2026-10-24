import {
    BasicShadowMap,
    BufferGeometry,
    glsl,
    IDisposable,
    Layers,
    MaterialExtension,
    Mesh,
    NoBlending,
    NoColorSpace,
    onChange,
    PhysicalMaterial, RenderManager,
    RGBAFormat,
    serialize,
    ShaderMaterial2,
    shaderReplaceString, shaderUtils,
    SimpleEventDispatcher,
    Texture,
    ThreeSerialization,
    ThreeViewer,
    UnsignedByteType,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'
import {RandomizedDirectionalLight} from "./RandomizedDirectionalLight";
import {FSShadowMaterial} from "./FSShadowMaterial";
import seperableShadowBlur from './shaders/seperableShadowBlur.glsl'

const ShaderChunk = RenderManager.ShaderChunk

export class ShadowMapBaker extends SimpleEventDispatcher<'shadowBaking'|'shadowBaked'> implements IDisposable {
    enabled = true // do not serialize // this is to disable baking for a while, toggling this does not reset the baked shadow map

    get attachedMesh(): Mesh<BufferGeometry, PhysicalMaterial> | undefined {
        return this._attachedMesh
    }

    set attachedMesh(value: Mesh<BufferGeometry, PhysicalMaterial> | undefined) {
        if (this._attachedMesh !== value) {
            this._attachedMesh && this.cleanupMaterial()
            this._attachedMesh = value
            this._attachedMesh && this._updateMaterial()
        }
    }
    private _shadowMat: FSShadowMaterial
    private _shadowBlurMat: ShaderMaterial2

    get target(): WebGLRenderTarget | undefined {
        return this._target
    }

    private _target?: WebGLRenderTarget

    get light(): RandomizedDirectionalLight {
        return this._light
    }

    @serialize('randomizedLight') private readonly _light: RandomizedDirectionalLight
    private readonly _lightLayer = 5 // todo: get free one from the viewer.
    private _viewer: ThreeViewer

    constructor(viewer: ThreeViewer) {
        super()
        this._viewer = viewer
        const light = new RandomizedDirectionalLight(0xffffff, 10, {
            near: 1.5,
            far: 20,
            bias: 0.0,
            frustumSize: 4,
            width: 1024,
            height: 1024,
            enabled: true,
            radius: 10,
            normalBias: 0,
        }, {
            direction: new Vector3(0.2, 1, 0.2).normalize(),
            spread: 0.9,
            focus: 1.0,
            distanceScale: 20,
            minDistanceScale: new Vector3(10, 10, 10),
            normalDirection: new Vector3(0, 1, 0),
        })
        light.shadow.camera.updateProjectionMatrix()
        light.layers.disableAll()
        light.layers.set(this._lightLayer)

        this._light = light
        viewer.scene.addObject(this._light, {addToRoot: true})

        this._shadowMat = new FSShadowMaterial({
            color: '#ffffff',
            toneMapped: false,
            depthWrite: false,
            depthTest: false,
            premultipliedAlpha: false,
            opacity: 1,
            transparent: false,
            blending: NoBlending,
        })

        this._shadowBlurMat = new ShaderMaterial2({
            uniforms: {
                'colorTexture': {value: null},
                'step': {value: 0.1},
                'size': {value: new Vector2(0.5, 0.5)},
                'direction': {value: new Vector2(0.5, 0.5)},
            },

            vertexShader: shaderUtils.defaultVertex,

            fragmentShader: seperableShadowBlur,
        })
    }

    dispose() {
        // todo: dispose everything and remove light from scene.
        this._shadowMat.dispose()
        this._target = undefined
        this.reset()
    }

    public cleanupMaterial() {
        this._updateMaterial(true)
    }

    private _frameNumber = 0

    @onChange(ShadowMapBaker.prototype.reset)
    @serialize() maxFrameNumber = 400

    @onChange(ShadowMapBaker.prototype.reset)
    @serialize() smoothShadow = false

    @serialize()
    @onChange(ShadowMapBaker.prototype.reset)
    shadowMapType = BasicShadowMap // this is fine since we are randomizing

    private _attachedMesh: Mesh<BufferGeometry, PhysicalMaterial> | undefined

    @onChange(ShadowMapBaker.prototype._groundMapModeChanged)
    @serialize() groundMapMode: 'aoMap' | 'map' | 'alphaMap' = 'aoMap'

    @serialize()
    @onChange(ShadowMapBaker.prototype._alphaVignetteChanged)
    alphaVignette = true // only works for transparent and transmissive materials.

    @serialize()
    @onChange(ShadowMapBaker.prototype._alphaVignetteChanged)
    alphaVignetteAxis = 'xy' // x or y or xy.

    private _groundMapModeChanged() {
        if (this._attachedMesh) {
            this.cleanupMaterial()
            this._updateMaterial()
            if (this.groundMapMode === 'alphaMap') this._attachedMesh.material.transparent = true
            else this._attachedMesh.material.transparent = false
        }
        this.reset()
    }
    private _alphaVignetteChanged() {
        this.materialExtension?.setDirty?.()
        this._viewer?.setDirty()
    }

    fromJSON(data: any, meta?: any, _internal: boolean = false): this {
        if(!_internal) {
            return ThreeSerialization.Deserialize(data, this, meta, false)
        }else {
            ThreeSerialization.Deserialize(data, this, meta, true)
            this.reset()
        }
        return this
    }

    reset(): void {
        // this._updateMaterial()
        this._frameNumber = 0
    }

    get frameNumber() {
        return this._frameNumber
    }

    shadowAutoUpdate = true

    private _bakeCounter = 0

    @serialize() maxBakeCount = Infinity

    autoUpdateShadow(): boolean {
        if (this.shadowAutoUpdate) {
            if (this._bakeCounter >= this.maxBakeCount) return false
            if (!this.updateShadow()) return false
            if (this._frameNumber === this.maxFrameNumber) {
                this.dispatchEvent({type: 'shadowBaked', bakeCount: ++this._bakeCounter})
            } else if (this._frameNumber > 0 && this._frameNumber < this.maxFrameNumber) {
                this.dispatchEvent({type: 'shadowBaking', progress: this._frameNumber / this.maxFrameNumber, bakeCount: this._bakeCounter})
            }
            return true
        }
        return false
    }

    updateShadow(): boolean {
        if (!this.enabled) return false
        const mesh = this._attachedMesh
        if (!mesh) return false
        if (++this._frameNumber > this.maxFrameNumber) return false

        const customSize = 1024
        if (!this._target) {
            this._target = this._viewer.renderManager.createTarget({ // todo: dispose somewhere
                // type: HalfFloatType,
                type: UnsignedByteType,
                depthBuffer: false,
                size: customSize ? new Vector2(customSize, customSize) : undefined,
                sizeMultiplier: customSize ? undefined : 1,
                // encoding: sRGBEncoding,
                colorSpace: NoColorSpace,
                format: RGBAFormat,
            }) as WebGLRenderTarget
            // this._target.texture.userData.serializableRenderTarget = true // not working properly and exported image size is high, see BaseRenderer
        }

        if (this._frameNumber < 3)
            this._light.randomizePosition(0, 1, 0)
        else
            this._light.randomizePosition(this._frameNumber)
        mesh.castShadow = false
        const renderer = this._viewer.renderManager.renderer
        const shadowMap = renderer.shadowMap

        const shadowMapType = shadowMap.type
        const shadowMapNeedsUpdate = shadowMap.needsUpdate
        const shadowMapAutoUpdate = shadowMap.autoUpdate
        shadowMap.type = this.shadowMapType
        shadowMap.needsUpdate = true
        shadowMap.autoUpdate = false

        const scene = this._viewer.scene
        // disable all other lights
        const sceneLightLayer = new Layers()
        sceneLightLayer.disableAll()
        scene.traverse((o: any) => {
            if (o.isLight && o !== this._light) {
                o.userData.__gp_layers = o.layers
                o.layers = sceneLightLayer
            }
        })
        const cam = scene.mainCamera
        if ((cam.layers.mask & 1 << this._lightLayer) !== 0) throw 'Camera can render pseudo directional light, check layers'

        cam.layers.enable(this._lightLayer)
        mesh.layers.disable(this._lightLayer)

        // scene.modelObject.traverse((o: any)=>{
        //     if (o.assetType === 'widget') {
        //         o.traverse((o1: any)=> {
        //             o1.castShadow = false
        //         })
        //     }
        // })

        renderer.renderWithModes({
            shadowMapRender:true,
            backgroundRender:false,
            sceneRender:false,
        }, ()=> renderer.render(scene, scene.mainCamera))
        // scene.modelObject.traverse((o: any)=>{
        //     if (o.assetType === 'widget') {
        //         o.castShadow = false
        //     }
        // })

        cam.layers.disable(this._lightLayer)

        // Only render light layer
        const camLayers = cam.layers.mask
        cam.layers.set(this._lightLayer)
        mesh.layers.enable(this._lightLayer)

        const lastThisTarget = (customSize ? this._viewer.renderManager.getTempTarget({
            type: UnsignedByteType,
            depthBuffer: false,
            size: new Vector2(customSize, customSize),
            // encoding: sRGBEncoding,
            colorSpace: NoColorSpace,
            format: RGBAFormat,
        }) : this._viewer.renderManager.composerTarget) as WebGLRenderTarget

        const texture = lastThisTarget.texture as Texture
        const lastThisTargetColorSpace = texture.colorSpace
        texture.colorSpace = NoColorSpace

        this._viewer.renderManager.blit(lastThisTarget, {clear: true, source: this._target.texture})

        {

            // const currentEnvironment = scene.modelObject.environment
            // const currentBackground = scene.modelObject.background
            const currentMaterial = mesh.material
            const currentFrustumCulled = mesh.frustumCulled
            const currentRt = renderer.getRenderTarget()
            const activeCubeFace = renderer.getActiveCubeFace()
            const activeMipLevel = renderer.getActiveMipmapLevel()
            // scene.modelObject.background = null
            // scene.modelObject.environment = null
            mesh.material = this._shadowMat as any
            mesh.frustumCulled = false
            renderer.setRenderTarget(this._target)

            const useMovingAverage = false
            this._shadowMat.opacity = useMovingAverage ? 1. / this.maxFrameNumber : Math.max(1. / this.maxFrameNumber, 1. / this._frameNumber)
            this._shadowMat.lastFrameTexture = lastThisTarget.texture
            this._shadowMat.needsUpdate = true

            renderer.renderWithModes({
                shadowMapRender:false,
                backgroundRender:false,
                opaqueRender:true,
                transparentRender:false,
                transmissionRender:false,
            }, ()=> renderer.render(scene, scene.mainCamera))

            renderer.setRenderTarget(currentRt, activeCubeFace, activeMipLevel)
            mesh.frustumCulled = currentFrustumCulled
            mesh.material = currentMaterial
            // scene.modelObject.environment = currentEnvironment
            // scene.modelObject.background = currentBackground

            if (this.smoothShadow)
                this._applySmoothFilter(this._target, lastThisTarget as WebGLRenderTarget)
        }

        lastThisTarget.texture.colorSpace = lastThisTargetColorSpace
        if (customSize) {
            this._viewer.renderManager.releaseTempTarget(lastThisTarget)
        }

        mesh.layers.disable(this._lightLayer)
        cam.layers.mask = camLayers

        // enable all other lights
        scene.modelObject.traverse((o: any) => {
            if (o.isLight && o !== this._light.lightObject) {
                o.layers = o.userData.__gp_layers
                delete o.userData.__gp_layers
            }
        })

        shadowMap.type = shadowMapType
        shadowMap.needsUpdate = shadowMapNeedsUpdate
        shadowMap.autoUpdate = shadowMapAutoUpdate

        mesh.castShadow = true

        if (this._frameNumber < 3 || this._frameNumber > Math.min(100, this.maxFrameNumber)
            && this._frameNumber % 4 === 0
        ) {
            // if (this._attachedMesh)
            //     this.materialExtension.extraUniforms!.transitionOpacity.value = Math.min(1, 4. * this._frameNumber / this.maxFrameNumber)

            this._updateMaterial()
            // this._viewer.setDirty()
            // mesh.dispatchEvent({type: 'materialUpdate'})
            mesh.material.setDirty()
        }

        return true
    }

    private _updateMaterial(isNull = false) {
        if (!this._attachedMesh) return
        if (isNull) {
            if (this._attachedMesh.material.alphaMap === this._target?.texture) {
                this._attachedMesh.material.alphaMap = null
            }
            if (this._attachedMesh.material.aoMap === this._target?.texture) {
                this._attachedMesh.material.aoMap = null
            }
            if (this._attachedMesh.material.map === this._target?.texture) {
                this._attachedMesh.material.map = null
            }

        } else if (this._target) {
            if (this.groundMapMode === 'alphaMap') {
                this._attachedMesh.material.alphaMap = this._target.texture
            }
            if (this.groundMapMode === 'aoMap') {
                this._attachedMesh.material.aoMap = this._target.texture
            }
            if (this.groundMapMode === 'map') {
                this._attachedMesh.material.map = this._target.texture
            }
        }

        // needed in DepthNormalPass when rendering to depth
        if (this._attachedMesh.material) {
            this._attachedMesh.material.userData.ALPHA_I_RGBA_PACKING = !isNull && this.groundMapMode === 'alphaMap'
            this._attachedMesh.material.alphaTest = !isNull && this.groundMapMode === 'alphaMap' ? 0.01 : 0

            this._attachedMesh.material.needsUpdate = true
        }
        // console.log(this._attachedMesh.material, target)
    }

    private _applySmoothFilter(shadowReadBuffer: WebGLRenderTarget, shadowWriteBuffer: WebGLRenderTarget) {
        this._shadowBlurMat.uniforms.colorTexture.value = shadowReadBuffer.texture
        this._shadowBlurMat.uniforms.direction.value.set(1, 0)
        this._shadowBlurMat.uniforms.size.value.set(shadowReadBuffer.width, shadowReadBuffer.height)
        this._viewer.renderManager.blit(shadowWriteBuffer, {material: this._shadowBlurMat})

        this._shadowBlurMat.uniforms.colorTexture.value = shadowWriteBuffer.texture
        this._shadowBlurMat.uniforms.direction.value.set(0, 1)
        this._shadowBlurMat.uniforms.size.value.set(shadowWriteBuffer.width, shadowWriteBuffer.height)
        this._viewer.renderManager.blit(shadowReadBuffer, {material: this._shadowBlurMat})
    }

    readonly materialExtension: MaterialExtension = {

        parsFragmentSnippet: (_renderer, _material)=> {
            return glsl`
            uniform float transitionOpacity;
            `
        },

        extraUniforms: {
            transitionOpacity: {
                value: 1,
            },
        },

        shaderExtender: (shader, _material, renderer) => {
            if (this.groundMapMode === 'aoMap') {

                shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                    '#include <aomap_fragment>',
                    shaderReplaceString(ShaderChunk.aomap_fragment,
                        'float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;',
                        'float ambientOcclusion = ( mix(1., unpackRGBAToDepth(texture2D( aoMap, vAoMapUv ) ), transitionOpacity) - 1.0) * aoMapIntensity + 1.0;'
                    ))
                // material.materialObject.transparent = false

            } else if (this.groundMapMode === 'map') {

                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <map_fragment>',
                    shaderReplaceString(ShaderChunk.map_fragment,
                        'diffuseColor *= sampledDiffuseColor',
                        'float groundShadow = mix(1., unpackRGBAToDepth(sampledDiffuseColor), transitionOpacity); diffuseColor.rgb *= groundShadow; diffuseColor.a *= max(0., 1.-groundShadow) * transitionOpacity;'
                    ))
                // material.materialObject.transparent = false

            } else if (this.groundMapMode === 'alphaMap') {

                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <alphamap_fragment>',
                    shaderReplaceString(ShaderChunk.alphamap_fragment,
                        'texture2D( alphaMap, vAlphaMapUv ).g',
                        '1. - unpackRGBAToDepth( texture2D( alphaMap, vAlphaMapUv ) )',
                        {replaceAll: true},
                    ))
                // material.materialObject.transparent = true

            }

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <opaque_fragment>',
                glsl`#include <opaque_fragment>
                #ifndef OPAQUE
                    #ifdef USE_AOMAP
                        #if NUM_DIR_LIGHT_SHADOWS > 0
                            // TODO find a better solution
                            float alphaMod = length(reflectedLight.directDiffuse)*4./float(NUM_DIR_LIGHT_SHADOWS);
                        #else
                            float alphaMod = 1.;
                        #endif
                        float t1 = 1. - ambientOcclusion;
                        float t2 = max(1. - alphaMod, 0.);
                        float t = t1 + t2;
                        gl_FragColor.a *= max(t, 0.);
                    #endif
                #endif
            `)

            if (this.alphaVignette && renderer.capabilities.isWebGL2) {
                (shader as any).defines.USE_UV = ''
                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <opaque_fragment>',
                    glsl`#include <opaque_fragment>
                    #ifndef OPAQUE
                    float weight = 0.;
                    #ifdef USE_UV // why are we checking for this? this is always supposed to be true
                    weight = 2.*abs(length(0.5 - vUv.${this.alphaVignetteAxis}));
                    #endif
                    #if defined(USE_LIGHTMAP) || defined(USE_AOMAP)
                    weight = 2.*abs(length(0.5 - vAoMapUv.${this.alphaVignetteAxis}));
                    #endif
                    weight = min(1., max(0., weight))-0.5;
                    weight = min(1., max(0., 1.0-2.*weight));
                    weight = pow(weight, 1.5);
                    gl_FragColor.a *= weight;
                    //gl_FragColor.rgb /= max(0.01, weight);
                    gl_FragColor = saturate(gl_FragColor);
                    //gl_FragColor.a = 0.5;
                    #endif
                    `)
            }
        },
        computeCacheKey: ()=>{
            return this.groundMapMode + '.' + this.alphaVignette + '.' + this.alphaVignetteAxis
        },
        onObjectRender: (_object, material) => {
            if (material.userData.gMapMode !== this.groundMapMode) {
                material.userData.gMapMode = this.groundMapMode
                material.needsUpdate = true
            }
        },
        isCompatible: material => {
            return (material).isPhysicalMaterial
        },
    }

    // render(mesh: Mesh<BufferGeometry, PhysicalMaterial) {
    //     this._viewer.renderManager.renderModel(mesh, this._viewer.scene.activeCamera!)
    // }
}

