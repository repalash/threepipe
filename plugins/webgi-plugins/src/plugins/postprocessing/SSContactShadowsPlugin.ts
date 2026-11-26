import {
    AViewerPluginSync, BaseGroundPlugin,
    GBufferPlugin,
    glsl,
    IShaderPropertiesUpdater,
    IWebGLRenderer,
    matDefine,
    MaterialExtension,
    Matrix4,
    PhysicalMaterial,
    ProgressivePlugin,
    serialize,
    shaderReplaceString,
    ThreeViewer,
    uiFolderContainer,
    uiSlider,
    uiToggle,
    updateMaterialDefines,
    Vector2, uniform,
    Vector3, onChange, RenderManager,
} from 'threepipe'
import ssrtShader from './shaders/ssrt.glsl'

const ShaderChunk = RenderManager.ShaderChunk

/**
 * SS Contact Shadows Plugin
 * Adds a material extension to PhysicalMaterial screen space ray traced contact shadows.
 * It also adds a UI to the material to edit the settings.
 * todo - remove It uses WEBGI_materials_clearcoat_tint glTF extension to save the settings in glTF files.
 * @category Plugins
 */
@uiFolderContainer('SS Contact Shadows')
export class SSContactShadowsPlugin extends AViewerPluginSync {
    static readonly PluginType = 'SSContactShadows'
    static readonly OldPluginType = 'SSContactShadowsPlugin' // todo swap

    @uiToggle('Enabled')
    @serialize()
    @onChange(SSContactShadowsPlugin.prototype.setDirty)
        enabled = true

    private _uniforms: any = {
        sscsRadius: {value: 0.03},
        sscsIntensity: {value: 1},
        sscsTolerance: {value: 1.5},

        // tLastFrame: {value: null}, // not needed since we dont need color

        frameCount: {value: 0},

        projection: {value: new Matrix4()},
        cameraPositionWorld: {value: new Vector3()},
        cameraNearFar: {value: new Vector2(0.1, 1000)},

        sceneBoundingRadius: {value: 0},
    }

    @uniform({propKey: 'sscsRadius', onChange: SSContactShadowsPlugin.prototype.setDirty})
    @uiSlider('Radius', [0.0001, 0.1], 0.0001)
    @serialize() radius = 0.015
    @uniform({propKey: 'sscsIntensity', onChange: SSContactShadowsPlugin.prototype.setDirty})
    @uiSlider('Intensity', [0.0001, 1], 0.0001)
    @serialize() intensity = 1
    @uniform({propKey: 'sscsTolerance', onChange: SSContactShadowsPlugin.prototype.setDirty})
    @uiSlider('Tolerance', [0.1, 5])
    @serialize() tolerance = 1.5

    private _defines: any = {
        ['PERSPECTIVE_CAMERA']: 1, // set in PerspectiveCamera2
    }
    @matDefine('SSCS_DEBUG', undefined, true, SSContactShadowsPlugin.prototype.setDirty)
    @uiToggle('Debug only SSCS') @serialize() onlySSCSDebug = false

    @matDefine('SSCS_STEP_COUNT', undefined, true, SSContactShadowsPlugin.prototype.setDirty)
    @uiSlider('Step count', [1, 8], 1)
    @serialize() stepCount = 2

    dependencies = [GBufferPlugin]

    // private _defines: any = {
    //     // eslint-disable-next-line @typescript-eslint/naming-convention
    //     CLEARCOAT_TINT_DEBUG: false,
    // }

    // static AddSSContactShadows(material: PhysicalMaterial, params?: IMaterialUserData['_clearcoatTint']): IMaterialUserData['_clearcoatTint']|null {
    //     const ud = material?.userData
    //     if (!ud) return null
    //     if (!ud._clearcoatTint) ud._clearcoatTint = {}
    //     const tf = ud._clearcoatTint!
    //     tf.enableTint = true
    //     if (tf.tintColor === undefined) tf.tintColor = '#ffffff'
    //     if (tf.thickness === undefined) tf.thickness = 0.1
    //     if (tf.ior === undefined) tf.ior = 1.5
    //     params && Object.assign(tf, params)
    //     if (material.setDirty) material.setDirty()
    //     return tf
    // }

    // private _multiplyPass?: MultiplyPass
    readonly materialExtension: MaterialExtension = {
        uuid: SSContactShadowsPlugin.PluginType,
        priority: 5,
        shaderExtender: (shader, _material, _renderer) => {
            if (!(shader as any).defines.SSCS_ENABLED) return
            const rsS = 'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {'
            const lsS = glsl`
                #ifndef D_sceneBoundingRadius
                #define D_sceneBoundingRadius
                uniform float sceneBoundingRadius;
                #endif
                #ifndef D_frameCount
                #define D_frameCount
                uniform float frameCount;
                #endif
                float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, vec3 lightDirection ) {
                    vec3 ray_origin_view = -vViewPosition;
                    float rnd = interleavedGradientNoise(gl_FragCoord.xy, frameCount+34.);
                    float cameraDist = length(cameraPositionWorld);
                    // float radius = mix((cameraNearFar.y) + ray_origin_view.z, -ray_origin_view.z - cameraNearFar.x, rnd * 0.5 + 0.5)*sscsRadius;
                    float radius = mix((cameraDist + sceneBoundingRadius) + ray_origin_view.z, -ray_origin_view.z - max(0.0, cameraDist - sceneBoundingRadius), rnd * 0.5 + 0.5)*sscsRadius;
                    vec3 state = vec3(1.,(rnd+0.5)/float(SSCS_STEP_COUNT),2.);
                    traceRay(ray_origin_view, normalize(lightDirection) * radius, sscsTolerance * radius * 2., state, SSCS_STEP_COUNT);
                    state.z = state.z > 0.99 ? 1. : max(0.,min(state.z * state.z * (1.-sscsIntensity), 1.));
                    #if defined(SSCS_DEBUG) && SSCS_DEBUG > 0
                    return state.z;
                    #endif
            `
            const shadowChunk = `
#if SSCS_ENABLED

    uniform float sscsIntensity;
    uniform float sscsRadius;
    uniform float sscsTolerance;

    #define THREE_PACKING_INCLUDED // by threejs
    #include <cameraHelpers>
    #include <randomHelpers>
    ${ssrtShader}
  
#endif
            ` + shaderReplaceString(ShaderChunk.shadowmap_pars_fragment, rsS, `${lsS}\n`).replace('return mix( 1.0, shadow, shadowIntensity );', 'return mix( 1.0, min(shadow, state.z), shadowIntensity );')

            // todo shaderReplaceString
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <shadowmap_pars_fragment>', shadowChunk)

            // Because this frag is also patched in Anisotropy
            // no need for warning here.
            shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', ShaderChunk.lights_fragment_begin)

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
                'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ], directLight.direction ) : 1.0;'
            )
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;',
                'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ], directLight.direction ) : 1.0;')

            // todo: point light?
            // const rsL = ''
            // const lsL = 'directLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotShadowCoord[ i ], directLight.direction ) : 1.0;'
            // const lightsFragmentBegin = ShaderChunk.lights_fragment_begin.replace(rsL, lsL)

            // shader.fragmentShader = shader.fragmentShader.replace('#include <lightmap_fragment>', '')
            // ;(shader as any).defines.USE_UV = ''

            this._gbufferUnpackExtension?.shaderExtender?.(shader, _material, _renderer)
        },
        onObjectRender: (_, material, renderer: IWebGLRenderer) => {
            const enabled: any = this.enabled &&
            renderer.userData.screenSpaceRendering !== false &&
            !material.userData?.pluginsDisabled &&
            !material.userData?.sscsDisabled ? 1 : 0

            // const tfUd = material.userData._clearcoatTint
            // if (!tfUd?.enableTint) return
            //
            // this._uniforms.ccTintColor.value.set(tfUd.tintColor) // could be number or string also, apart from Color
            // this._uniforms.ccThickness.value = tfUd.thickness
            // this._uniforms.ccIor.value = tfUd.ior
            updateMaterialDefines({
                ...this._defines,
                ['SSCS_ENABLED']: enabled,
            }, material)
        },
        extraUniforms: {
            ...this._uniforms, // todo should not be static because of multiple viewers
        },
        extraDefines: {},
        computeCacheKey: (_: PhysicalMaterial) => {
            return this.isDisabled() ? '0' : '1'
        },
        isCompatible: (material1: PhysicalMaterial) => {
            return material1.isPhysicalMaterial
        },
        // getUiConfig: (material: PhysicalMaterial) => {
        //     const viewer = this._viewer!
        //     if (material.userData._clearcoatTint === undefined) material.userData._clearcoatTint = {}
        //     const state = material.userData._clearcoatTint
        //     const config: UiObjectConfig = {
        //         type: 'folder',
        //         label: 'Clearcoat Tint',
        //         onChange: (ev)=>{
        //             if (!ev.config) return
        //             this.setDirty()
        //         },
        //         children: [
        //             {
        //                 type: 'checkbox',
        //                 label: 'Enabled',
        //                 get value() {
        //                     return state.enableTint || false
        //                 },
        //                 set value(v) {
        //                     if (v === state.enableTint) return
        //                     if (v) {
        //                         if (!SSContactShadowsPlugin.AddSSContactShadows(material))
        //                             viewer.dialog.alert('Cannot add clearcoat tint.')
        //                     } else {
        //                         state.enableTint = false
        //                         if (material.setDirty) material.setDirty()
        //                     }
        //                     config.uiRefresh?.(true, 'postFrame')
        //                 },
        //             },
        //             {
        //                 type: 'color',
        //                 label: 'Tint color',
        //                 hidden: () => !state.enableTint,
        //                 property: [state, 'tintColor'],
        //             },
        //             {
        //                 type: 'input',
        //                 label: 'Thickness',
        //                 hidden: () => !state.enableTint,
        //                 property: [state, 'thickness'],
        //             },
        //             {
        //                 type: 'slider',
        //                 bounds: [0.8, 2.5],
        //                 label: 'IOR',
        //                 hidden: () => !state.enableTint,
        //                 property: [state, 'ior'],
        //             },
        //         ],
        //     }
        //     return config
        // },
        updaters: ()=>
            [
                // this._viewer?.getPlugin(GBufferPlugin),
                this._viewer?.getPlugin(ProgressivePlugin),
                this._viewer?.scene.renderCamera,
                this._viewer?.renderManager,
                this._viewer?.scene,
            ] as IShaderPropertiesUpdater[],
    }

    setDirty() {
        this.materialExtension?.setDirty?.()
        this._viewer?.setDirty()
    }

    // private _loaderCreate({loader}: {loader: GLTFLoader2}) {
    //     if (!loader.isGLTFLoader2) return
    //     loader.register((p) => new GLTFMaterialsSSContactShadowsExtensionImport(p))
    // }

    constructor(enabled = true) {
        super()
        // this._loaderCreate = this._loaderCreate.bind(this)
        this.enabled = enabled

        // // for tweakpane UI. todo
        // ;(this as any).userData = {setDirty: ()=>{
        //         this._viewer?.setDirty()
        // }}
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        // v.addEventListener('preRender', this._preRender)
        v.assetManager.materials.registerMaterialExtension(this.materialExtension)
        if (v.getPlugin(BaseGroundPlugin)) v.getPlugin(BaseGroundPlugin)!.material!.userData.sscsDisabled = false // todo remove after threepipe update
        this._gbufferUnpackExtensionChanged()
        v.renderManager.addEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        // v.assetManager.importer.addEventListener('loaderCreate', this._loaderCreate as any)
        // v.assetManager.exporter.getExporter('gltf', 'glb')?.extensions?.push(glTFMaterialsSSContactShadowsExtensionExport)

    }

    onRemove(v: ThreeViewer) {
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        v.renderManager.removeEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        // v.assetManager.importer?.removeEventListener('loaderCreate', this._loaderCreate as any)
        // const exporter = v.assetManager.exporter.getExporter('gltf', 'glb')
        // if (exporter) {
        //     const index = exporter.extensions?.indexOf(glTFMaterialsSSContactShadowsExtensionExport)
        //     if (index !== undefined && index >= 0) exporter.extensions?.splice(index, 1)
        // }
        return super.onRemove(v)
    }

    private _gbufferUnpackExtension = undefined as MaterialExtension|undefined

    private _gbufferUnpackExtensionChanged = ()=>{
        if (!this._viewer) throw new Error('SSContactShadowPlugin: pass/viewer not created yet')
        const newExtension = this._viewer.renderManager.gbufferUnpackExtension
        if (this._gbufferUnpackExtension === newExtension) return
        if (this._gbufferUnpackExtension) this.setGBufferUnpackExtension(undefined)
        this._gbufferUnpackExtension = newExtension
        if (this._gbufferUnpackExtension) this.setGBufferUnpackExtension(this._gbufferUnpackExtension)
        else this._viewer.console.warn('SSContactShadowPlugin: GBuffer unpack extension removed')
    }

    setGBufferUnpackExtension(extension: MaterialExtension|undefined) {
        this._gbufferUnpackExtension = extension
        if (!this._gbufferUnpackExtension) return

        // todo not possible to remove it?
        Object.assign(this.materialExtension.extraUniforms!, this._gbufferUnpackExtension.extraUniforms)
        Object.assign(this.materialExtension.extraDefines!, this._gbufferUnpackExtension.extraDefines)
    }
    // public static readonly CLEARCOAT_TINT_GLTF_EXTENSION = 'WEBGI_materials_clearcoat_tint'

}

// declare module '../../core/IMaterial' {
//     interface IMaterialUserData {
//         _clearcoatTint?: {
//             enableTint?: boolean
//             tintColor?: Color|number|string
//             thickness?: number
//             ior?: number
//         }
//     }
// }

/**
 * SSContactShadows Materials Extension
 *
 * Specification: https://webgi.xyz/docs/gltf-extensions/WEBGI_materials_clearcoat_tint.html
 */
// class GLTFMaterialsSSContactShadowsExtensionImport implements GLTFLoaderPlugin {
//     public name: string
//     public parser: GLTFParser
//
//     constructor(parser: GLTFParser) {
//         this.parser = parser
//         this.name = SSContactShadowsPlugin.CLEARCOAT_TINT_GLTF_EXTENSION
//     }
//
//     async extendMaterialParams(materialIndex: number, materialParams: any) {
//         const parser = this.parser
//         const materialDef = parser.json.materials[materialIndex]
//         if (!materialDef.extensions || !materialDef.extensions[this.name]) return
//         const extension = materialDef.extensions[this.name]
//         if (!materialParams.userData) materialParams.userData = {}
//         SSContactShadowsPlugin.AddSSContactShadows(materialParams)
//         ThreeSerialization.Deserialize(extension, materialParams.userData._clearcoatTint)
//     }
// }
//
// const glTFMaterialsSSContactShadowsExtensionExport = (w: GLTFWriter2)=> ({
//     writeMaterial: (material: any, materialDef: any) => {
//         if (!material.isMeshStandardMaterial || !material.userData._clearcoatTint?.enableTint) return
//         materialDef.extensions = materialDef.extensions || {}
//
//         const extensionDef: any = ThreeSerialization.Serialize(material.userData._clearcoatTint)
//
//         materialDef.extensions[ SSContactShadowsPlugin.CLEARCOAT_TINT_GLTF_EXTENSION ] = extensionDef
//         w.extensionsUsed[ SSContactShadowsPlugin.CLEARCOAT_TINT_GLTF_EXTENSION ] = true
//     },
// })
