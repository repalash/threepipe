import {
    ExtendedShaderPass,
    GBufferPlugin,
    getOrCall,
    getTexelDecoding,
    glsl,
    ICamera,
    IMaterial,
    IPassID,
    IPipelinePass,
    IRenderManager,
    IScene,
    IWebGLRenderer,
    matDefine,
    matDefineBool,
    MaterialExtension,
    Matrix4,
    PhysicalMaterial,
    PipelinePassPlugin,
    ProgressivePlugin,
    serialize,
    shaderReplaceString,
    shaderUtils,
    SSAAPlugin,
    SSAOPlugin,
    Texture,
    TextureDataType,
    ThreeViewer,
    uiConfig,
    uiConfigMaterialExtension,
    uiFolderContainer,
    uiImage,
    uiSlider,
    uiToggle,
    uniform,
    UnsignedByteType,
    ValOrFunc,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'
// import ssrtaoShader from './shaders/SSGIPlugin.pass.glsl' // todo
// import ssgiPatch from './shaders/SSGIPlugin.patch.glsl'
import samplePointHelpers from './shaders/samplePointHelpers.glsl'
import ssrtShader from './shaders/ssrt.glsl'
import ssgiPatch from './shaders/giPatch.glsl'
// import ssrtaoShader from './shaders/ssrtao.glsl'
import {BilateralFilterPass} from "../../passes/BilateralFilterPass";
import {getShaders} from "../../utils/shaders";
import {VelocityBufferPlugin} from "../buffer/VelocityBufferPlugin";

export type SSGIPluginTarget = WebGLRenderTarget

const passId = 'ssrtgi'
type SSGIPassId = typeof passId

/**
 * SSGI Plugin
 *
 * Adds screen space reflections to the scene.
 * @category Plugins
 */
@uiFolderContainer('SSGI Plugin')
export class SSGIPlugin
    extends PipelinePassPlugin<SSGIPluginPass, SSGIPassId> {

    readonly passId = passId
    public static readonly PluginType = 'SSGIPlugin'
    public static readonly OldPluginType = 'SSGI'

    dependencies = [GBufferPlugin, SSAAPlugin]

    target?: SSGIPluginTarget
    @uiImage('SSGI Buffer', {readOnly: true}) texture?: Texture

    @uiConfig(undefined, {unwrapContents: true}) declare protected _pass?: SSGIPluginPass

    // @onChange2(SSGIPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    // @onChange2(SSGIPlugin.prototype._createTarget)
    // @uiSlider('Buffer Size Multiplier', [0.25, 2.0], 0.25)
    readonly sizeMultiplier: number // cannot be changed after creation (for now)


    constructor(
        bufferType: TextureDataType = UnsignedByteType,
        sizeMultiplier = 1,
        enabled = true,
    ) {
        super()
        this.enabled = enabled
        this.bufferType = bufferType
        this.sizeMultiplier = sizeMultiplier
    }

    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()
        if (!this.target)
            this.target = this._viewer.renderManager.createTarget<SSGIPluginTarget>(
                {
                    depthBuffer: false,
                    type: this.bufferType,
                    sizeMultiplier: this.sizeMultiplier,
                    // magFilter: NearestFilter,
                    // minFilter: NearestFilter,
                    // generateMipmaps: false,
                    // encoding: LinearEncoding,
                })
        this.texture = this.target.texture
        this.texture.name = 'ssgiBuffer'

        // if (this._pass) this._pass.target = this.target
    }

    protected _disposeTarget() {
        if (!this._viewer) return
        if (this.target) {
            this._viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        this.texture = undefined
    }

    private _gbufferUnpackExtension = undefined as MaterialExtension|undefined
    private _gbufferUnpackExtensionChanged = ()=>{
        if (!this._pass || !this._viewer) throw new Error('SSGIPlugin: pass/viewer not created yet')
        const newExtension = this._viewer.renderManager.gbufferUnpackExtension
        if (this._gbufferUnpackExtension === newExtension) return
        if (this._gbufferUnpackExtension) this._pass.setGBufferUnpackExtension(undefined)
        this._gbufferUnpackExtension = newExtension
        if (this._gbufferUnpackExtension) this._pass.setGBufferUnpackExtension(this._gbufferUnpackExtension)
        else this._viewer.console.warn('SSGIPlugin: GBuffer unpack extension removed')
    }

    protected _createPass() {
        if (!this._viewer) throw new Error('SSGIPlugin: viewer not set')
        if (!this._viewer.renderManager.gbufferTarget || !this._viewer.renderManager.gbufferUnpackExtension)
            throw new Error('SSGIPlugin: GBuffer target not created. GBufferPlugin is required.')
        this._createTarget(true)
        return new SSGIPluginPass(this.passId, ()=>this.target)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // todo why?
        if (viewer.getPlugin('Ground') || viewer.getPlugin('BaseGroundPlugin')) console.warn('GroundPlugin must be added after SSGIPlugin')

        // todo updateGBufferFlags like in SSAOPlugin

        this._gbufferUnpackExtensionChanged()
        viewer.renderManager.addEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        viewer.forPlugin(VelocityBufferPlugin, (vbp) => {
            this._pass?.material.registerMaterialExtensions([vbp.unpackExtension])
        }, (vbp)=>{
            this._pass?.material?.unregisterMaterialExtensions([vbp.unpackExtension])
        }, this)
    }

    onRemove(viewer: ThreeViewer): void {
        this._disposeTarget()
        viewer.renderManager.removeEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        return super.onRemove(viewer)
    }

    fromJSON(data: any, meta?: any): this|null|Promise<this|null> {
        // legacy
        if (data.passes?.ssrtgi) {
            data = {...data}
            data.pass = data.passes.ssrtgi
            delete data.passes
            if (data.pass.enabled !== undefined) data.enabled = data.pass.enabled
        }
        return super.fromJSON(data, meta)
    }

    protected _beforeRender(_?: IScene, _1?: ICamera, _2?: IRenderManager): boolean {
        if (!this._viewer) return false
        const e = super._beforeRender(_, _1, _2)
        if (e) { // && !lastEnabled) {
            const ssao = this._viewer?.getPlugin<SSAOPlugin>('SSAOPlugin')
            if (ssao && !ssao.isDisabled()) {
                // const c = confirm('SSAO Plugin needs to be disabled to enable SSRTGI or SSRTAO. Disable now?')
                // if (!c) {
                //     this.enabled = false
                //     e = false // for lastEnabled
                // } else
                ssao.disable(SSGIPlugin.PluginType)
            }
        }
        // lastEnabled = e
        if(!e) return e

        const progressive = this._viewer.getPlugin(ProgressivePlugin)
        this._pass?.updateShaderProperties([progressive])

        return e
    }

    /**
     * @deprecated use {@link target} instead
     */
    get rtgiTarget() {
        console.warn('SSGIPlugin: rtgiTarget is deprecated, use target instead')
        return this.target
    }

}

@uiFolderContainer('SSGI Pass')
export class SSGIPluginPass extends ExtendedShaderPass implements IPipelinePass {
    before = ['render']
    after = ['gbuffer', 'depth']
    required = ['render', 'progressive'] // gbuffer required check done in plugin.

    @serialize() readonly bilateralPass: BilateralFilterPass

    @uiToggle('GI Enabled')
    @serialize()
    @matDefineBool('SSGI_ENABLED', undefined, undefined, SSGIPluginPass.prototype.setDirty, false)
    giEnabled = true // todo make getter/setter for legacy ssgiEnabled

    @uiSlider('Intensity', [0, 4])
    @serialize() @uniform() intensity = 2

    @uiSlider('Power', [0, 3])
    @serialize() @uniform() power = 1.1

    @uiToggle('Auto radius') @serialize() @uniform() autoRadius = true

    @uiSlider('Object Radius', [0.01, 10.0])
    @serialize() @uniform() objectRadius = 1

    @uiSlider('Tolerance', [0.1, 5])
    @serialize() @uniform() tolerance = 1

    @uiSlider('Bias', [-0.3, 0.3])
    @serialize() @uniform() bias = 0.001

    @uiSlider('Falloff', [0.0001, 4])
    @serialize() @uniform() falloff = 0.7

    // todo
    // @uiSlider('Roughness Factor', [0.1, 5])
    // @serialize() @uniform({propKey: 'ssgiRoughnessFactor'}) roughnessFactor = 1

    @uiSlider('Ray Count', [1, 5], 1, {tags: ['performance']})
    @serialize() @uniform() rayCount = 4

    @uiSlider('Step count', [1, 16], 1, {tags: ['performance']})
    @serialize()
    @matDefine('RTAO_STEP_COUNT', undefined, undefined, SSGIPluginPass.prototype.setDirty)
    stepCount = 8

    @uiToggle('Smooth Enabled')
    @serialize() smoothEnabled = true

    @uiToggle('Render with Camera')
    renderWithCamera = true

    // todo
    // @uiSlider('Low Quality Frames', [0, 4], 1)
    // @serialize()
    // @matDefine('SSRTAO_LOW_QUALITY_FRAMES', undefined, undefined, SSGIPluginPass.prototype.setDirty)
    // lowQualityFrames = 0
    //
    // @uiToggle('Ignore front rays')
    // @serialize()
    // @matDefineBool('SSRTAO_MASK_FRONT_RAYS', undefined, undefined, SSGIPluginPass.prototype.setDirty)
    // maskFrontRays = true
    //
    // @uiSlider('Mask front rays factor', [-1, 1], 0.01, (that: SSGIPluginPass)=>({hidden: () => !that.maskFrontRays}))
    // @serialize() @uniform() maskFrontFactor = -0.2

    @uiSlider('Split', [0, 1], 0.01, {tags: ['debug']})
    @serialize() @uniform({propKey: 'ssrtaoSplitX', onChange: SSGIPluginPass.prototype.setDirty})
    split = 0

    public readonly passId: IPassID

    constructor(pid: IPassID,
                public target?: ValOrFunc<WebGLRenderTarget|undefined>,
                giEnabled = true) {
        super({
            defines: {
                ['RTAO_STEP_COUNT']: 16,
                // ['SSRTAO_LOW_QUALITY_FRAMES']: 2,
                // ['SSRTAO_MASK_FRONT_RAYS']: true,
                ['PERSPECTIVE_CAMERA']: 1, // set in PerspectiveCamera2
                // ['CHECK_GBUFFER_FLAG']: 0, // todo like ssao plugin
            },
            uniforms: {
                // tDiffuse: {value: null},// todo
                // tNormalDepth: {value: null},// todo

                // smoothEnabled: {value: false},
                // smoothSigma: {value: new Vector4(0.5, 0.2, 4., 0.4)},
                // smoothScale: {value: new Vector4(1, 10, 1, 8)},

                tLastThis: {value: null},
                tLastFrame: {value: null}, // set in progressive plugin
                // TODO required?
                screenSize: {value: new Vector2(0, 0)}, // set in ExtendedRenderMaterial
                currentFrameCount: {value: 0}, // set in RenderManager
                frameCount: {value: 0}, // set in RenderManager
                cameraNearFar: {value: new Vector2(0.1, 1000)}, // set in PerspectiveCamera2
                cameraPositionWorld: {value: new Vector3()}, // set in PerspectiveCamera2
                projection: {value: new Matrix4()}, // set in PerspectiveCamera2
                // saoBiasEpsilon: {value: new Vector3(1, 1, 1)},

                opacity: {value: 1}, // todo?
                intensity: {value: 0.},
                objectRadius: {value: 0},
                autoRadius: {value: giEnabled ? false : true},
                rayCount: {value: 0.1},
                bias: {value: 0.015},
                falloff: {value: 0.7},
                power: {value: 1.1},
                // maskFrontFactor: {value: -0.1},
                tolerance: {value: 0},
                // ssrtaoRoughnessFactor: {value: 1},
                sceneBoundingRadius: {value: 0}, // todo do same in SSAO

                // reprojection/velocity
                currentProjectionViewMatrix: {value: new Matrix4()},
                lastProjectionViewMatrix: {value: new Matrix4()},
                inverseViewMatrix: {value: new Matrix4()},

                // split mode
                ssrtaoSplitX: {value: 0.5},
            },

            vertexShader: shaderUtils.defaultVertex,

            fragmentShader: `
varying vec2 vUv;

// for gbuffer
#include <packing>
#define THREE_PACKING_INCLUDED
#include <cameraHelpers>
#include <randomHelpers>
${samplePointHelpers}

${ssrtShader}

${getShaders().calculateGI}
            `,

        }, 'tDiffuse', 'tLastThis', 'tLastFrame')
        this.passId = pid
        this.needsSwap = true

        this.clear = true // todo
        // this._getUiConfig = this._getUiConfig.bind(this)

        this.giEnabled = giEnabled
        this.bilateralPass = new BilateralFilterPass(this.target, 'rgba')

        // this._multiplyPass = new GenericBlendTexturePass(this._target.texture as any, 'c = vec4((1.0-b.r) * a.xyz, a.a);')
        // this._multiplyPass = new GenericBlendTexturePass(this._target.texture as any, 'c = vec4(pow(a.rgb, vec3(a.a*10.)), 1.0);')
        // this._multiplyPass = new GenericBlendTexturePass(this._target.texture as any, 'c = vec4(b.rgb, 0.)+a;')
        // this._multiplyPass = new GenericBlendTexturePass(this._target.texture as any, 'c = a;')
        // this._multiplyPass = new GenericBlendTexturePass(this._target.texture as any, 'c = vec4(0.);')
        // this._multiplyPass = new GenericBlendTexturePass(this._target.texture as any, 'c = vec4(vec3(pow(max(0.,1.-b.r), b.g*10.)), b.a);')
    }

    render(renderer: IWebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        if (!this.enabled) return
        this.needsSwap = false
        // console.log(renderer.renderManager.frameCount)
        if (!this.renderWithCamera && renderer.renderManager.frameCount < 2) {
            return
        }

        const target = getOrCall(this.target)
        if (!target) {
            console.warn('SSGIPluginPass: target not defined.')
            return
        }

        renderer.renderManager.blit(writeBuffer, {
            source: target.texture,
        })
        if (!this.material.defines.HAS_GBUFFER) {
            console.warn('SSGIPluginPass: DepthNormalBuffer required for ssrtao/ssgi')
        }

        this.uniforms.tLastThis.value = writeBuffer.texture

        super.render(renderer, target, readBuffer, deltaTime, maskActive)

        if (this.smoothEnabled) {
            this.bilateralPass.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        }

        this.uniforms.lastProjectionViewMatrix.value.copy(this.uniforms.currentProjectionViewMatrix.value)

        // if (this._multiplyPass) {
        //     this._multiplyPass.uniforms.tDiffuse2.value = this._target.texture as any
        //     this._multiplyPass.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        //     this.needsSwap = true
        // }
    }

    beforeRender(scene: IScene, camera: ICamera, renderManager: IRenderManager) {
        if (!this.enabled) return
        this.updateShaderProperties([scene, camera, renderManager])
        this.uniforms.currentProjectionViewMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        this.uniforms.inverseViewMatrix.value.copy(camera.matrixWorld)
    }

    readonly materialExtension: MaterialExtension = { // todo set priority wrt ssr etc
        extraUniforms: {
            tSSGIMap: ()=>({value: getOrCall(this.target)?.texture ?? null}),
            ssaoPower: this.material.uniforms.power,
            ssgiIntensity: this.material.uniforms.intensity,
            ssrtaoSplitX: this.material.uniforms.ssrtaoSplitX,
            // ssrMaskFrontFactor: this.material.uniforms.maskFrontFactor,
        },
        extraDefines: {
            ['SSGI_ENABLED']: ()=>this.material.defines.SSGI_ENABLED,
            // ['RTAO_STEP_COUNT']: ()=>this.material.defines.SRTAOSTEP_COUNT,
            // ['SSRTAO_LOW_QUALITY_FRAMES']: ()=>this.material.defines.SSRTAO_LOW_QUALITY_FRAMES,
            // ['SSRTAO_MASK_FRONT_RAYS']: ()=>this.material.defines.SSRTAO_MASK_FRONT_RAYS,
            // ['PERSPECTIVE_CAMERA']: ()=>this.material.defines.PERSPECTIVE_CAMERA,
            // todo gbuffer stuff
        },
        shaderExtender: (shader, _material, _renderer) => {
            if (!shader.defines?.SSRTAO_ENABLED) return
            const ls = `
            
            ${ssgiPatch}
            
#if defined(SSGI_ENABLED) && SSGI_ENABLED > 0
            // reflectedLight.directDiffuse = vec3(0.);
            // reflectedLight.indirectDiffuse = vec3(0.);
            // reflectedLight.directSpecular = vec3(0.);
            // reflectedLight.indirectSpecular = vec3(0.);
#endif            
            `
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                'vec3 totalDiffuse =', ls, {prepend: true})

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <aomap_fragment>', '')

            // ;(shader as any).defines.USE_UV = '' // todo

            // this._gbufferUnpackExtension?.shaderExtender?.(shader, _material, _renderer)
        },
        onObjectRender: (_object, material, renderer: IWebGLRenderer) => {
            // const opaque = !material.transparent && (material as MeshPhysicalMaterial).transmission < 0.001
            let x: any = this.enabled// && opaque
            && (this.renderWithCamera || renderer.renderManager.frameCount > 1) &&
            renderer.userData.screenSpaceRendering !== false &&
            !material.userData?.pluginsDisabled &&
            !material.userData?.ssrtaoDisabled &&
            !material.userData?.ssaoDisabled ? this.split > 0 ? 2 : 1 : 0

            if (material.defines!.SSRTAO_ENABLED !== x) {
                material.defines!.SSRTAO_ENABLED = x
                material.needsUpdate = true
            }
            // x = material.userData?.ssreflNonPhysical ? 1 : 0
            // if (material.defines!.SSR_NON_PHYSICAL !== x) {
            //     material.defines!.SSR_NON_PHYSICAL = x
            //     material.needsUpdate = true
            // }
        },
        parsFragmentSnippet: (_renderer)=>glsl`
            #if defined(SSRTAO_ENABLED) && SSRTAO_ENABLED > 0
            uniform float ssaoPower;
            uniform float ssgiIntensity;
            uniform sampler2D tSSGIMap;
            #if defined(SSRTAO_ENABLED) && SSRTAO_ENABLED == 2
            uniform float ssrtaoSplitX;
            #endif
            ${getTexelDecoding('tSSGIMap', getOrCall(this.target)?.texture.colorSpace)}
            ${/*tLastFrame not requried in material extension
            // uniform sampler2D tLastFrame;
            ${getTexelDecoding('tLastFrame', this.material.uniforms!.tLastFrame.value?.colorSpace)}
            */''} 
            #include <simpleCameraHelpers>
            #endif
        `,
        computeCacheKey: () => {
            const tex = getOrCall(this.target)?.texture
            return (this.enabled ? '1' : '0') + tex?.colorSpace + tex?.uuid + Object.values(this.material.defines).map(v=>v + '').join(',')
        },
        uuid: SSGIPlugin.PluginType,
        ...uiConfigMaterialExtension(this._getUiConfig.bind(this), SSGIPlugin.PluginType),
        isCompatible: material => {
            return (material as PhysicalMaterial).isPhysicalMaterial
        },
    }

    /**
     * Returns a uiConfig to toggle SSGI on a material.
     * This uiConfig is added to each material by extension
     * @param material
     * @private
     */
    protected _getUiConfig(material: IMaterial) {
        return {
            type: 'folder',
            label: 'SSGI',
            children: [
                {
                    type: 'checkbox',
                    label: 'Enabled',
                    get value() {
                        return !(material.userData.ssgiDisabled ?? false)
                    },
                    set value(v) {
                        if (v === !(material.userData.ssgiDisabled ?? false)) return
                        material.userData.ssgiDisabled = !v
                        material.setDirty()
                    },
                    onChange: this.setDirty,
                },
                // todo ssao cast
                // {
                //     type: 'checkbox',
                //     label: 'Non Physical',
                //     get value() {
                //         return material.userData.ssreflNonPhysical ?? false
                //     },
                //     set value(v) {
                //         if (v === (material.userData.ssreflNonPhysical ?? false)) return
                //         material.userData.ssreflNonPhysical = v
                //         material.setDirty()
                //     },
                //     onChange: this.setDirty,
                // },
            ],
        }
    }

    set uniformsNeedUpdate(value: true) {
        this.material.uniformsNeedUpdate = value
        this.setDirty()
    }

    protected _gbufferUnpackExtension: MaterialExtension|undefined
    setGBufferUnpackExtension(extension: MaterialExtension|undefined) {
        if (this._gbufferUnpackExtension === extension) return
        if (this._gbufferUnpackExtension) {
            this.material.unregisterMaterialExtensions([this._gbufferUnpackExtension])
            this.bilateralPass.material.unregisterMaterialExtensions([this._gbufferUnpackExtension])
        }
        this._gbufferUnpackExtension = extension
        if (this._gbufferUnpackExtension) {
            this.material.registerMaterialExtensions([this._gbufferUnpackExtension])
            this.bilateralPass.material.registerMaterialExtensions([this._gbufferUnpackExtension])
        }

        if (!this._gbufferUnpackExtension) return

        // todo not possible to remove it?
        // Object.assign(this.materialExtension.extraUniforms!, this._gbufferUnpackExtension.extraUniforms)
        // Object.assign(this.materialExtension.extraDefines!, this._gbufferUnpackExtension.extraDefines)
    }

    // todo update gbuffer flag like in AO?

    setDirty() {
        this.materialExtension?.setDirty?.()
        super.setDirty();
    }

}

declare module 'threepipe' {
    interface IMaterialUserData {
        /**
         * Disable SSGIPlugin for this material.
         */
        ssgiDisabled?: boolean // default false
        ssreflNonPhysical?: boolean // default false
        // [SSGIPlugin.PluginType]?: {
        //     enable?: boolean
        //     nonPhysical?: boolean
        // }
    }
}
