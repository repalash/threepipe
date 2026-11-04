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
    Texture,
    TextureDataType,
    ThreeViewer,
    uiConfig,
    uiConfigMaterialExtension,
    uiFolderContainer,
    uiImage,
    uiSlider,
    uiToggle,
    uiVector,
    uniform,
    UnsignedByteType,
    ValOrFunc,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'
// import ssreflPass from './shaders/SSReflectionPlugin.pass.glsl' // todo
// import ssreflPatch from './shaders/SSReflectionPlugin.patch.glsl'
import samplePointHelpers from './shaders/samplePointHelpers.glsl'
import ssrtShader from './shaders/ssrt.glsl'
// import ssrShader from './shaders/ssreflection.glsl'
import ssreflPatch from './shaders/ssrPatch.glsl'
import ssrShaderMain from './shaders/ssreflectionMain.glsl'
import {getShaders} from "../../utils/shaders";
import {VelocityBufferPlugin} from "../buffer/VelocityBufferPlugin";

export type SSReflectionPluginTarget = WebGLRenderTarget

const passId = 'ssrefl'
type SSReflectionPassId = typeof passId

/**
 * SSReflection Plugin
 *
 * Adds screen space reflections to the scene.
 * @category Plugins
 */
@uiFolderContainer('SSReflection Plugin')
export class SSReflectionPlugin
    extends PipelinePassPlugin<SSReflectionPluginPass, SSReflectionPassId> {

    readonly passId = passId
    public static readonly PluginType = 'SSReflectionPlugin'
    public static readonly OldPluginType = 'SSReflection'

    dependencies = [GBufferPlugin, SSAAPlugin]

    target?: SSReflectionPluginTarget
    @uiImage('SSReflection Buffer', {readOnly: true, hideOnEmpty: true}) texture?: Texture

    @uiConfig(undefined, {unwrapContents: true}) declare protected _pass?: SSReflectionPluginPass

    // @onChange2(SSReflectionPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    // @onChange2(SSReflectionPlugin.prototype._createTarget)
    // @uiSlider('Buffer Size Multiplier', [0.25, 2.0], 0.25)
    readonly sizeMultiplier: number // cannot be changed after creation (for now)


    constructor(
        // previously inlineSSR
        public readonly inlineShaderRayTrace = true, // todo: we need roughness in gbuffer for proper inline. this has other advantages also like we can do blurring and denoising etc
        bufferType: TextureDataType = UnsignedByteType, // only when inline is false
        sizeMultiplier = 1, // only when inline is false
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
        if (this.inlineShaderRayTrace) return // no need to create.
        if (!this.target)
            this.target = this._viewer.renderManager.createTarget<SSReflectionPluginTarget>(
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
        this.texture.name = 'ssreflBuffer'

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
        if (!this._pass || !this._viewer) throw new Error('SSReflectionPlugin: pass/viewer not created yet')
        const newExtension = this._viewer.renderManager.gbufferUnpackExtension
        if (this._gbufferUnpackExtension === newExtension) return
        if (this._gbufferUnpackExtension) this._pass.setGBufferUnpackExtension(undefined)
        this._gbufferUnpackExtension = newExtension
        if (this._gbufferUnpackExtension) this._pass.setGBufferUnpackExtension(this._gbufferUnpackExtension)
        else this._viewer.console.warn('SSReflectionPlugin: GBuffer unpack extension removed')
    }

    protected _createPass() {
        if (!this._viewer) throw new Error('SSReflectionPlugin: viewer not set')
        if (!this._viewer.renderManager.gbufferTarget || !this._viewer.renderManager.gbufferUnpackExtension)
            throw new Error('SSReflectionPlugin: GBuffer target not created. GBufferPlugin is required.')
        this._createTarget(true)
        return new SSReflectionPluginPass(this.passId, ()=>this.target, this.inlineShaderRayTrace)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // todo why?
        if (viewer.getPlugin('Ground') || viewer.getPlugin('BaseGroundPlugin')) console.warn('GroundPlugin must be added after SSReflectionPlugin')
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

    protected _beforeRender(_?: IScene, _1?: ICamera, _2?: IRenderManager): boolean {
        if (!this._viewer) return false
        const e = super._beforeRender(_, _1, _2)
        if(!e) return e
        const progressive = this._viewer.getPlugin(ProgressivePlugin)
        this._pass?.updateShaderProperties([progressive])
        return e
    }

    /**
     * @deprecated use {@link target} instead
     */
    get ssrTarget() {
        console.warn('SSReflectionPlugin: ssrTarget is deprecated, use target instead')
        return this.target
    }

    fromJSON(data: any, meta?: any): this|null|Promise<this|null> {
        // legacy
        if (data.passes?.ssr) {
            data = {...data}
            data.pass = data.passes.ssr
            delete data.passes
            if (data.pass.enabled !== undefined) data.enabled = data.pass.enabled
        }
        return super.fromJSON(data, meta)
    }

    _viewerListeners = {
        preRender: ()=>{
            if(!this._viewer || this.isDisabled()) return
            if(!this._pass) return

            const renderCamera = this._viewer.scene.renderCamera
            this._pass.uniforms.currentProjectionViewMatrix.value.multiplyMatrices(renderCamera.projectionMatrix, renderCamera.matrixWorldInverse)
            this._pass.uniforms.inverseViewMatrix.value.copy(renderCamera.matrixWorld)
        },
        postRender: ()=>{
            if(!this._viewer || this.isDisabled()) return
            if(!this._pass) return

            this._pass.uniforms.lastProjectionViewMatrix.value.copy(this._pass.uniforms.currentProjectionViewMatrix.value)
        }
    }

}

@uiFolderContainer('SSReflection Pass')
export class SSReflectionPluginPass extends ExtendedShaderPass implements IPipelinePass {
    before = ['render']
    after = ['gbuffer', 'depth']
    required = ['render', 'progressive'] // gbuffer required check done in plugin.

    @uiSlider('Intensity', [0, 4])
    @serialize() @uniform() intensity = 1

    @uiVector('Boost')
    @serialize() @uniform() boost = new Vector3(1, 1, 1)

    @uiSlider('Object Radius', [0.01, 2.])
    @serialize() @uniform() objectRadius = 1

    @uiToggle('Auto radius') @serialize() @uniform() autoRadius = true

    @uiSlider('Power', [0, 3])
    @serialize() @uniform() power = 1.1

    @uiSlider('Tolerance', [0.1, 5])
    @serialize() @uniform() tolerance = 0.5

    @uiSlider('Roughness Factor', [0.1, 1.25])
    @serialize() @uniform({propKey: 'ssrRoughnessFactor'}) roughnessFactor = 1

    @uiSlider('Step count', [1, 32], 1, {tags: ['performance']})
    @serialize()
    @matDefine('SSR_STEP_COUNT', undefined, undefined, SSReflectionPluginPass.prototype.setDirty)
        stepCount = 16

    @uiSlider('Ray count', [1, 8], 1, {tags: ['performance']})
    @serialize()
    @matDefine('SSR_RAY_COUNT', undefined, undefined, SSReflectionPluginPass.prototype.setDirty)
        rayCount = 1

    @uiToggle('Ray Blend MAX')
    @serialize()
    @matDefineBool('SSR_RAY_BLEND_MAX', undefined, undefined, SSReflectionPluginPass.prototype.setDirty, true)
        rayBlendMax = false

    setDirty() {
        this.materialExtension?.setDirty?.()
        super.setDirty();
    }

    @uiSlider('Low Quality Frames', [0, 4], 1)
    @serialize()
    @matDefine('SSR_LOW_QUALITY_FRAMES', undefined, undefined, SSReflectionPluginPass.prototype.setDirty)
        lowQualityFrames = 0

    @uiToggle('Ignore front rays')
    @serialize()
    @matDefineBool('SSR_MASK_FRONT_RAYS', undefined, undefined, SSReflectionPluginPass.prototype.setDirty)
        maskFrontRays = true

    @uiSlider('Mask front rays factor', [-1, 1], 0.01, (that: SSReflectionPluginPass)=>({hidden: () => !that.maskFrontRays}))
    @serialize() @uniform() maskFrontFactor = -0.2
    public readonly passId: IPassID

    @uiSlider('Split', [0, 1], 0.01, {tags: ['debug']})
    @serialize() @uniform({propKey: 'ssrSplitX', onChange: SSReflectionPluginPass.prototype.setDirty})
    split = 0

    constructor(pid: IPassID,
                public target?: ValOrFunc<WebGLRenderTarget|undefined>,
                public readonly inlineShaderRayTrace = true) {
        super({
            defines: {
                ['SSR_STEP_COUNT']: 16,
                ['SSR_RAY_COUNT']: 4,
                ['SSR_RAY_BLEND_MAX']: 0,
                ['SSR_LOW_QUALITY_FRAMES']: 0, // todo: only on mobile
                ['SSR_INLINE']: inlineShaderRayTrace ? '1' : '0',
                // ['SSR_NON_PHYSICAL']: '0', only in inline, so it should not be here
                ['SSR_MASK_FRONT_RAYS']: true,
                ['PERSPECTIVE_CAMERA']: 1, // set in PerspectiveCamera2
                // ['SSREFL_PACKING']: 1, // 1 is (r: ssrefl, gba: depth), 2 is (rgb: ssrefl, a: 1), 3 is (rgba: packed_ssrefl), 4 is (rgb: packed_ssrefl, a: 1)
            },
            uniforms: {
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
                boost: {value: new Vector3(0, 0, 0)},
                objectRadius: {value: 0},
                autoRadius: {value: false},
                power: {value: 0},
                maskFrontFactor: {value: -0.1},
                tolerance: {value: 0},
                ssrRoughnessFactor: {value: 1},
                sceneBoundingRadius: {value: 0}, // todo do same in SSAO

                // reprojection/velocity
                currentProjectionViewMatrix: {value: new Matrix4()},
                lastProjectionViewMatrix: {value: new Matrix4()},
                inverseViewMatrix: {value: new Matrix4()},

                // split mode
                ssrSplitX: {value: 0.5},
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

${getShaders().ssReflection}

${ssrShaderMain}
            `,

        }, 'tDiffuse', 'tLastThis', 'tLastFrame')
        this.passId = pid

        this.needsSwap = false
        this.clear = true // todo

        if (inlineShaderRayTrace) {
            // inline... todo test non inline
            Object.assign(this.materialExtension.extraUniforms!, {
                tNormalDepth: this.material.uniforms.tNormalDepth,
                tLastFrame: this.material.uniforms.tLastFrame,
                objectRadius: this.material.uniforms.objectRadius,
                autoRadius: this.material.uniforms.autoRadius,
                tolerance: this.material.uniforms.tolerance,
                ssrRoughnessFactor: this.material.uniforms.ssrRoughnessFactor,
                frameCount: this.material.uniforms.frameCount,
                currentFrameCount: this.material.uniforms.currentFrameCount,
                projection: this.material.uniforms.projection,
                cameraPositionWorld: this.material.uniforms.cameraPositionWorld,
                cameraNearFar: this.material.uniforms.cameraNearFar,

                sceneBoundingRadius: this.material.uniforms.sceneBoundingRadius,

                // reprojection
                currentProjectionViewMatrix: this.material.uniforms.currentProjectionViewMatrix,
                lastProjectionViewMatrix: this.material.uniforms.lastProjectionViewMatrix,
                inverseViewMatrix: this.material.uniforms.inverseViewMatrix,

                ssrSplitX: this.material.uniforms.ssrSplitX,
            })
        }
        // this._getUiConfig = this._getUiConfig.bind(this)
    }

    render(renderer: IWebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        if (!this.enabled) return
        if (this.inlineShaderRayTrace) {
            this.needsSwap = false
            return
        }
        const target = getOrCall(this.target)
        if (!target) {
            console.warn('SSReflectionPluginPass: target not defined. It must be set when inlineShaderRayTrace is false')
            return
        }
        // this._updateParameters()
        if (!this.material.defines.HAS_GBUFFER) {
            console.warn('SSReflectionPluginPass: DepthNormalBuffer required for ssrefl')
        }
        renderer.renderManager.blit(writeBuffer, {
            source: target.texture,
        })
        this.uniforms.tLastThis.value = writeBuffer.texture
        super.render(renderer, target, readBuffer, deltaTime, maskActive)

        this.needsSwap = false
    }

    beforeRender(scene: IScene, camera: ICamera, renderManager: IRenderManager) {
        if (!this.enabled) return
        this.updateShaderProperties([scene, camera, renderManager])
    }

    readonly materialExtension: MaterialExtension = {
        extraUniforms: {
            tSSReflMap: ()=>({value: getOrCall(this.target)?.texture ?? null}),
            ssrPower: this.material.uniforms.power,
            ssrIntensity: this.material.uniforms.intensity,
            ssrMaskFrontFactor: this.material.uniforms.maskFrontFactor,
            ssrBoost: this.material.uniforms.boost,
        },
        extraDefines: {
            ['SSR_STEP_COUNT']: ()=>this.material.defines.SSR_STEP_COUNT,
            ['SSR_RAY_COUNT']: ()=>this.material.defines.SSR_RAY_COUNT,
            ['SSR_RAY_BLEND_MAX']: ()=>this.material.defines.SSR_RAY_BLEND_MAX,
            ['SSR_LOW_QUALITY_FRAMES']: ()=>this.material.defines.SSR_LOW_QUALITY_FRAMES,
            ['SSR_INLINE']: ()=>this.material.defines.SSR_INLINE,
            ['SSR_MASK_FRONT_RAYS']: ()=>this.material.defines.SSR_MASK_FRONT_RAYS,
            ['PERSPECTIVE_CAMERA']: ()=>this.material.defines.PERSPECTIVE_CAMERA,
            // todo gbuffer stuff
        },
        shaderExtender: (shader, _material, _renderer) => {
            if (!shader.defines?.SSREFL_ENABLED) return
            const ls = `
            
            ${ssreflPatch}
            
            // reflectedLight.directDiffuse = vec3(0.);
            // reflectedLight.indirectDiffuse = vec3(0.);
            // reflectedLight.directSpecular = vec3(0.);
            // reflectedLight.indirectSpecular = vec3(0.);
            
            `
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                '#glMarker beforeModulation', ls, {prepend: true})

            this._gbufferUnpackExtension?.shaderExtender?.(shader, _material, _renderer)
        },
        onObjectRender: (_object, material, renderer: IWebGLRenderer) => {
            let x: any = this.enabled &&
            renderer.userData.screenSpaceRendering !== false &&
            !material.userData?.pluginsDisabled &&
            !material.userData?.ssreflDisabled ? this.split > 0 ? 2 : 1 : 0

            if (material.defines!.SSREFL_ENABLED !== x) {
                material.defines!.SSREFL_ENABLED = x
                material.needsUpdate = true
            }
            x = material.userData?.ssreflNonPhysical ? 1 : 0
            if (material.defines!.SSR_NON_PHYSICAL !== x) {
                material.defines!.SSR_NON_PHYSICAL = x
                material.needsUpdate = true
            }
        },
        parsFragmentSnippet: ()=>glsl`
            #if defined(SSREFL_ENABLED) && SSREFL_ENABLED > 0
            uniform float ssrPower;
            uniform float ssrIntensity;
            uniform float ssrMaskFrontFactor;
            uniform vec3 ssrBoost;
            uniform sampler2D tSSReflMap;
            uniform sampler2D tLastFrame;
            ${getTexelDecoding('tSSReflMap', getOrCall(this.target)?.texture.colorSpace)}
            ${getTexelDecoding('tLastFrame', this.material.uniforms!.tLastFrame.value?.colorSpace)}
            ${!this.inlineShaderRayTrace ? '' : `
#define THREE_PACKING_INCLUDED // by threejs
#include <cameraHelpers>
#include <randomHelpers>
${samplePointHelpers}
${ssrtShader}
${getShaders().ssReflection}
            `}
            #include <simpleCameraHelpers>
            #endif
        `,
        computeCacheKey: () => {
            return (this.enabled ? '1' : '0') + getOrCall(this.target)?.texture?.colorSpace + Object.values(this.material.defines).map(v=>v + '').join(',')
        },
        uuid: SSReflectionPlugin.PluginType,
        ...uiConfigMaterialExtension(this._getUiConfig.bind(this), SSReflectionPlugin.PluginType),
        isCompatible: material => {
            return (material as PhysicalMaterial).isPhysicalMaterial
        },
    }

    /**
     * Returns a uiConfig to toggle SSReflection on a material.
     * This uiConfig is added to each material by extension
     * @param material
     * @private
     */
    protected _getUiConfig(material: IMaterial) {
        return {
            type: 'folder',
            label: 'SSReflection',
            children: [
                {
                    type: 'checkbox',
                    label: 'Enabled',
                    get value() {
                        return !(material.userData.ssreflDisabled ?? false)
                    },
                    set value(v) {
                        if (v === !(material.userData.ssreflDisabled ?? false)) return
                        material.userData.ssreflDisabled = !v
                        material.setDirty()
                    },
                    onChange: this.setDirty,
                },
                {
                    type: 'checkbox',
                    label: 'Non Physical',
                    get value() {
                        return material.userData.ssreflNonPhysical ?? false
                    },
                    set value(v) {
                        if (v === (material.userData.ssreflNonPhysical ?? false)) return
                        material.userData.ssreflNonPhysical = v
                        material.setDirty()
                    },
                    onChange: this.setDirty,
                },
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
        if (this._gbufferUnpackExtension) this.material.unregisterMaterialExtensions([this._gbufferUnpackExtension])
        this._gbufferUnpackExtension = extension
        if (this._gbufferUnpackExtension) this.material.registerMaterialExtensions([this._gbufferUnpackExtension])

        if (!this._gbufferUnpackExtension) return

        // todo not possible to remove it?
        Object.assign(this.materialExtension.extraUniforms!, this._gbufferUnpackExtension.extraUniforms)
        Object.assign(this.materialExtension.extraDefines!, this._gbufferUnpackExtension.extraDefines)
    }
}

declare module 'threepipe' {
    interface IMaterialUserData {
        /**
         * Disable SSReflectionPlugin for this material.
         */
        ssreflDisabled?: boolean // default false
        ssreflNonPhysical?: boolean // default false
        // [SSReflectionPlugin.PluginType]?: {
        //     enable?: boolean
        //     nonPhysical?: boolean
        // }
    }
}
