import {Matrix3, SRGBColorSpace} from 'three'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {serialize} from 'ts-browser-helpers'
import {IMaterial, IObject3D, ITexture, PhysicalMaterial} from '../../core'
import {MaterialExtension, updateMaterialDefines} from '../../materials'
import {shaderReplaceString, ThreeSerialization} from '../../utils'
import {AssetManager, GLTFWriter2} from '../../assetmanager'
import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import CustomBumpMapPluginShader from './shaders/CustomBumpMapPlugin.glsl'
import {matDefine} from '../../three'
import {makeSamplerUi} from '../../ui/image-ui'

/**
 * Custom Bump Map Plugin
 * Adds a material extension to PhysicalMaterial to support custom bump maps.
 * A Custom bump map is similar to the built-in bump map, but allows using an extra bump map and scale to give a combined effect.
 * This plugin also has support for bicubic filtering of the custom bump map and is enabled by default.
 * It also adds a UI to the material to edit the settings.
 * It uses WEBGI_materials_custom_bump_map glTF extension to save the settings in glTF files.
 * @category Plugins
 */
@uiFolderContainer('Custom BumpMap (MatExt)')
export class CustomBumpMapPlugin extends AViewerPluginSync {
    static readonly PluginType = 'CustomBumpMapPlugin'

    @uiToggle('Enabled', (that: CustomBumpMapPlugin)=>({onChange: that.setDirty}))
    @serialize() enabled = true

    @uiToggle('Bicubic', (that: CustomBumpMapPlugin)=>({onChange: that.setDirty}))
    @matDefine('CUSTOM_BUMP_MAP_BICUBIC', undefined, true, CustomBumpMapPlugin.prototype.setDirty)
    @serialize() bicubicFiltering = true

    private _defines: any = {
        ['CUSTOM_BUMP_MAP_DEBUG']: false,
        ['CUSTOM_BUMP_MAP_BICUBIC']: true,
    }
    private _uniforms: any = {
        customBumpUvTransform: {value: new Matrix3()},
        customBumpScale: {value: 0.001},
        customBumpMap: {value: null},
    }

    public enableCustomBump(material: IMaterial, map?: ITexture, scale?: number): boolean {
        const ud = material?.userData
        if (!ud) return false
        if (ud._hasCustomBump === undefined) {
            const meshes = material.appliedMeshes
            let possible = true
            if (meshes) for (const {geometry} of meshes) {
                if (geometry && (!geometry.attributes.position || !geometry.attributes.normal || !geometry.attributes.uv)) {
                    possible = false
                }
                // if (possible && !geometry.attributes.tangent) {
                //     geometry.computeTangents()
                // }
            }
            if (!possible) {
                return false
            }
        }
        ud._hasCustomBump = true
        ud._customBumpScale = scale ?? ud._customBumpScale ?? 0.001
        ud._customBumpMap = map ?? ud._customBumpMap ?? null
        if (material.setDirty) material.setDirty()
        return true
    }

    readonly materialExtension: MaterialExtension = {
        parsFragmentSnippet: (_, material: PhysicalMaterial)=>{
            if (this.isDisabled() || !material?.userData._hasCustomBump) return ''
            return CustomBumpMapPluginShader
        },
        shaderExtender: (shader, material: PhysicalMaterial) => {
            if (this.isDisabled() || !material?.userData._hasCustomBump) return
            const customBumpMap = material.userData._customBumpMap
            if (!customBumpMap) return

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#glMarker beforeAccumulation',
                `
#if defined(CUSTOM_BUMP_MAP_ENABLED) && CUSTOM_BUMP_MAP_ENABLED > 0
    normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd_cb(), faceDirection );
#endif
                `, {prepend: true}
            )

            shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <uv_pars_vertex>',
                `
#if defined(CUSTOM_BUMP_MAP_ENABLED) && CUSTOM_BUMP_MAP_ENABLED > 0
    varying vec2 vCustomBumpUv;
    uniform mat3 customBumpUvTransform;
#endif
                `, {prepend: true},
            )
            shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <uv_vertex>',
                `
#if defined(CUSTOM_BUMP_MAP_ENABLED) && CUSTOM_BUMP_MAP_ENABLED > 0
    vCustomBumpUv = ( customBumpUvTransform * vec3( uv, 1 ) ).xy;
#endif
                `, {prepend: true},
            )

            shader.defines && (shader.defines.USE_UV = '')
        },
        onObjectRender: (object: IObject3D, material) => {
            const userData = material.userData
            if (!userData?._hasCustomBump) return
            if (!object.isMesh || !object.geometry) return
            const tex = userData._customBumpMap?.isTexture ? userData._customBumpMap : null
            this._uniforms.customBumpMap.value = tex
            this._uniforms.customBumpScale.value = tex ? userData._customBumpScale ?? 0 : 0
            if (tex) {
                tex.updateMatrix()
                this._uniforms.customBumpUvTransform.value.copy(tex.matrix)
            }
            updateMaterialDefines({
                ...this._defines,
                ['CUSTOM_BUMP_MAP_ENABLED']: +this.enabled,
            }, material)
        },
        extraUniforms: {
            // ...this._uniforms, // done in constructor
        },
        computeCacheKey: (material1: PhysicalMaterial) => {
            return (this.enabled ? '1' : '0') + (material1.userData._hasCustomBump ? '1' : '0') + material1.userData?._customBumpMap?.uuid
        },
        isCompatible: (material1: PhysicalMaterial) => material1.isPhysicalMaterial,
        getUiConfig: material => { // todo use uiConfigMaterialExtension
            const viewer = this._viewer!
            const enableCustomBump = this.enableCustomBump.bind(this)
            const state = material.userData
            const config: UiObjectConfig = {
                type: 'folder',
                label: 'CustomBumpMap',
                onChange: (ev)=>{
                    if (!ev.config) return
                    this.setDirty()
                },
                children: [
                    {
                        type: 'checkbox',
                        label: 'Enabled',
                        get value() {
                            return state._hasCustomBump || false
                        },
                        set value(v) {
                            if (v === state._hasCustomBump) return
                            if (v) {
                                if (!enableCustomBump(material))
                                    viewer.dialog.alert('CustomBumpMapPlugin - Cannot add CustomBumpMap.')
                            } else {
                                state._hasCustomBump = false
                                if (material.setDirty) material.setDirty()
                            }
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                    {
                        type: 'slider',
                        label: 'Bump Scale',
                        bounds: [-20, 20],
                        stepSize: 0.001,
                        hidden: () => !state._hasCustomBump,
                        property: [state, '_customBumpScale'],
                        // onChange: this.setDirty,
                    },
                    {
                        type: 'image',
                        label: 'Bump Map',
                        hidden: () => !state._hasCustomBump,
                        property: [state, '_customBumpMap'],
                        onChange: ()=>{
                            if (material.setDirty) material.setDirty()
                        },
                    },
                    makeSamplerUi(state as any, '_customBumpMap', 'Sampler', ()=>!state._hasCustomBump, ()=>material.setDirty && material.setDirty()),
                ],
            }
            return config
        },

    }

    setDirty = (): void => {
        this.materialExtension.setDirty?.()
        this._viewer?.setDirty()
    }

    constructor() {
        super()
        Object.assign(this.materialExtension.extraUniforms!, this._uniforms)
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        // v.addEventListener('preRender', this._preRender)
        v.assetManager.materials.registerMaterialExtension(this.materialExtension)
        v.assetManager.registerGltfExtension(customBumpMapGLTFExtension)
        // v.getPlugin(GBufferPlugin)?.material?.registerMaterialExtensions([this.materialExtension])
    }

    onRemove(v: ThreeViewer) {
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        v.assetManager.unregisterGltfExtension(customBumpMapGLTFExtension.name)
        // v.getPlugin(GBufferPlugin)?.material?.unregisterMaterialExtensions([this.materialExtension])
        return super.onRemove(v)
    }

    /**
     * @deprecated use {@link customBumpMapGLTFExtension}
     */
    public static readonly CUSTOM_BUMP_MAP_GLTF_EXTENSION = 'WEBGI_materials_custom_bump_map'

}

declare module '../../core/IMaterial' {
    interface IMaterialUserData {
        _hasCustomBump?: boolean
        _customBumpMap?: ITexture | null
        _customBumpScale?: number
    }
}


/**
 * FragmentClipping Materials Extension
 *
 * Specification: https://threepipe.org/docs/gltf-extensions/WEBGI_materials_fragment_clipping_extension.html
 */
class GLTFMaterialsCustomBumpMapImport implements GLTFLoaderPlugin {
    public name: string
    public parser: GLTFParser

    constructor(parser: GLTFParser, private _viewer?: ThreeViewer) {
        this.parser = parser
        this.name = customBumpMapGLTFExtension.name
    }

    async extendMaterialParams(materialIndex: number, materialParams: any) {
        const parser = this.parser
        const materialDef = parser.json.materials[materialIndex]
        if (!materialDef.extensions || !materialDef.extensions[this.name]) return
        const extension = materialDef.extensions[this.name]

        if (!materialParams.userData) materialParams.userData = {}
        materialParams.userData._hasCustomBump = true // single _ so that its saved when cloning but not when saving
        materialParams.userData._customBumpScale = extension.customBumpScale ?? 0.0

        const resources = extension.resources ? await this._viewer?.assetManager?.importConfigResources(extension.resources) : undefined

        const pending = []
        const tex = extension.customBumpMap
        if (tex) {
            if (tex && tex.resource && typeof tex.resource === 'string') {
                materialParams.userData._customBumpMap = ThreeSerialization.Deserialize(tex, null, resources, false)
            } else if (tex && tex.index !== undefined) {
                pending.push(parser.assignTexture(materialParams.userData, '_customBumpMap', tex).then((t: any) => {
                    // t.format = RGBFormat
                    t.colorSpace = SRGBColorSpace
                }))
            } else {
                console.warn('CustomBumpMapPlugin: Invalid Texture Map in extension', tex, materialDef.name)
                materialParams.userData._customBumpMap = null
            }
        }
        return Promise.all(pending)
    }

    // do any mesh or geometry processing here
    // afterRoot(result: GLTF): Promise<void> | null {
    //     result.scene.traverse((object: any) => {
    //         const mat = object.material?.userData?._hasCustomBump
    //         if (!mat) return
    //         const geom = object.geometry
    //         if (!geom.attributes.tangent) {
    //             geom.computeTangents()
    //             geom.attributes.tangent.needsUpdate = true
    //         }
    //     })
    //     return null
    // }
}

const glTFMaterialsCustomBumpMapExport = (w: GLTFWriter2)=> ({
    writeMaterial: (material: any, materialDef: any) => {
        if (!material.isMeshStandardMaterial || !material.userData._hasCustomBump) return
        if ((material.userData._customBumpScale || 0) < 0.001) return // todo: is this correct?

        materialDef.extensions = materialDef.extensions || {}

        const meta = {images: {}, textures: {}}
        const extensionDef: any = {}

        extensionDef.customBumpScale = material.userData._customBumpScale || 1.0

        const rootPath = material.userData._customBumpMap?.userData.rootPath
        // this is required because gltf transform doesnt support data uris or external urls
        if (rootPath && (rootPath.startsWith('http') || rootPath.startsWith('data:'))) {
            extensionDef.customBumpMap = ThreeSerialization.Serialize(material.userData._customBumpMap, meta, false)
        }

        if (w.checkEmptyMap(material.userData._customBumpMap) && extensionDef.customBumpMap === undefined) {

            const customBumpMapDef = {index: w.processTexture(material.userData._customBumpMap)}
            w.applyTextureTransform(customBumpMapDef, material.userData._customBumpMap)
            extensionDef.customBumpMap = customBumpMapDef

        }

        if (Object.keys(meta.textures).length || Object.keys(meta.images).length)
            extensionDef.resources = meta

        materialDef.extensions[ customBumpMapGLTFExtension.name ] = extensionDef
        w.extensionsUsed[ customBumpMapGLTFExtension.name ] = true
    },
})

export const customBumpMapGLTFExtension = {
    name: 'WEBGI_materials_custom_bump_map',
    import: (p, v) => new GLTFMaterialsCustomBumpMapImport(p, v),
    export: glTFMaterialsCustomBumpMapExport,
    textures: {
        customBumpMap: 'RGB',
    },
} satisfies AssetManager['gltfExtensions'][number]
