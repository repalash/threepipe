import {
    AssetManager,
    AViewerPluginSync,
    getTexelDecoding,
    glsl,
    GLTF,
    GLTFLoaderPlugin,
    GLTFParser,
    GLTFWriter2,
    IMaterial,
    IObject3D,
    IShaderPropertiesUpdater,
    ITexture,
    makeSamplerUi,
    MaterialExtension,
    Matrix3,
    PhysicalMaterial,
    serialize,
    RenderManager,
    shaderReplaceString,
    SRGBColorSpace,
    ThreeViewer,
    uiFolderContainer,
    UiObjectConfig,
    uiToggle,
    updateMaterialDefines
} from "threepipe";
import anisotropyBsdf from './shaders/anisotropyBsdf.glsl' // todo rename
import anisotropyTBN from './shaders/anisotropyTBN.glsl'

const ShaderChunk = RenderManager.ShaderChunk
// shaders similar to Filament: https://github.com/google/filament/tree/v1.12.0/shaders/src
// Filament, Apache License 2.0, Copyright (C) 2015 The Android Open Source Project

/**
 * Anisotropy Plugin
 * Adds a material extension to PhysicalMaterial to support anisotropy maps.
 * Anisotropy is a directional material property that causes the material to reflect light differently depending on the direction of the surface. This is useful for materials like brushed metal, fabric, etc.
 * This is a separate implementation than the anisotropy property in three.js which satisfies `KHR_materials_anisotropy` glTF extension. It includes some additional properties like support for both rotation and directional maps(like Blender), noise, interfacing with the progressive plugin etc.
 *
 * It also adds a UI to the material to edit the settings.
 * It uses WEBGI_materials_anisotropy glTF extension to save the settings in glTF files.
 * @category Plugins
 */
@uiFolderContainer('Anisotropy (MatExt)')
export class AnisotropyPlugin extends AViewerPluginSync {
    static readonly PluginType = 'AnisotropyPlugin'

    @uiToggle('Enabled', (that: AnisotropyPlugin)=>({onChange: that.setDirty}))
    @serialize() enabled = true

    // todo add support for bicubic filtering?
    // @uiToggle('Bicubic', (that: AnisotropyPlugin)=>({onChange: that.setDirty}))
    // @matDefine('CUSTOM_BUMP_MAP_BICUBIC', undefined, true, AnisotropyPlugin.prototype.setDirty)
    // @serialize() bicubicFiltering = true

    private _defines: any = {
        // ['ANISOTROPY_BICUBIC']: false,
    }
    private _uniforms: any = {
        anisotropyFactor: {value: 1},
        anisotropyNoise: {value: 1},
        anisotropyDirection: {value: 1},
        anisotropyDirectionMap: {value: null},
        anisotropy2MapUvTransform: {value: new Matrix3()},
        frameCount: {value: 0},
    }

    public enableAnisotropy(material: IMaterial, map?: ITexture, factor?: number, noise?: number, directionMode?: 'CONSTANT' | 'ROTATION' | 'DIRECTION'): boolean {
        const ud = material?.userData
        if (!ud) return false
        if (ud._isAnisotropic === undefined) {
            const meshes = material.appliedMeshes
            let possible = true
            if (meshes) for (const {geometry} of meshes) {
                if (geometry && (!geometry.attributes.position || !geometry.attributes.normal || !geometry.attributes.uv)) {
                    possible = false
                }
                if (possible && geometry && !geometry.attributes.tangent) {
                    geometry.computeTangents()
                }
            }
            if (!possible) {
                return false
            }
        }
        ud._isAnisotropic = true
        ud._anisotropyFactor = factor ?? ud._anisotropyFactor ?? 1
        ud._anisotropyNoise = noise ?? ud._anisotropyNoise ?? 0
        ud._anisotropyDirection = /*direction ?? */ ud._anisotropyDirection ?? 1 // direction when map is not used
        ud._anisotropyDirectionMode = directionMode ?? ud._anisotropyDirectionMode ?? 'DIRECTION'
        ud._anisotropyDirectionMap = map ?? ud._anisotropyDirectionMap ?? null
        if (material.setDirty) material.setDirty()
        return true
    }

    readonly materialExtension: MaterialExtension = {
        uuid: AnisotropyPlugin.PluginType,
        priority: 10, // more than sscs(which is 5)
        shaderExtender: (shader, material, _renderer) => {
            if (this.isDisabled() || !material?.userData._isAnisotropic) return
            const rotMap: ITexture | undefined | null = material.userData?._anisotropyDirectionMap

            const bsdfs = glsl`
                //#if ANISOTROPY_ENABLED
                #include <randomHelpers>
                #ifndef D_frameCount
                #define D_frameCount
                uniform float frameCount;
                #endif
                ${rotMap ? getTexelDecoding('anisotropyDirectionMap', rotMap?.colorSpace) : ''}\n
            `
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <common>', bsdfs, {append: true})

            // Because this frag is also patched in SSCS. todo set priority wrt sscs.
            shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', ShaderChunk.lights_fragment_begin)

            shader.fragmentShader = shaderReplaceString(
                shaderReplaceString(shader.fragmentShader,
                    'IncidentLight directLight;', anisotropyTBN, {prepend: true}),
                'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight )',
                'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight, anisotropicT, anisotropicB )', {replaceAll: true})

            // eslint-disable-next-line @typescript-eslint/naming-convention
            let lights_physical_pars_fragment = shaderReplaceString(ShaderChunk.lights_physical_pars_fragment,
                'void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {',
                'void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight, const in vec3 anisotropicT, const in vec3 anisotropicB ) {')
            lights_physical_pars_fragment = shaderReplaceString(lights_physical_pars_fragment,
                'vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {',
                anisotropyBsdf + '\n', {prepend: true})
            lights_physical_pars_fragment = shaderReplaceString(lights_physical_pars_fragment,
                'BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material )',
                'BRDF_GGX_Anisotropy( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularF90, material.roughness, anisotropicT, anisotropicB )')

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <lights_physical_pars_fragment>', lights_physical_pars_fragment)

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <normal_fragment_begin>', ShaderChunk.normal_fragment_begin)

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                '#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )',
                '#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) || defined( USE_TANGENT )')

            // eslint-disable-next-line @typescript-eslint/naming-convention
            let lights_fragment_maps = glsl`
                #if defined( USE_ENVMAP )
                vec3 anisotropyBentNormal = indirectAnisotropyBentNormal(geometryNormal, geometryViewDir, material.roughness, anisotropicT, anisotropicB);
                #endif
            ` + ShaderChunk.lights_fragment_maps
            lights_fragment_maps = shaderReplaceString(lights_fragment_maps,
                'getIBLIrradiance( geometryNormal )',
                'getIBLIrradiance( anisotropyBentNormal )')
            lights_fragment_maps = shaderReplaceString(lights_fragment_maps,
                'getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )',
                'getIBLRadiance( geometryViewDir, anisotropyBentNormal, material.roughness )')

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <lights_fragment_maps>', lights_fragment_maps)

            shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <uv_pars_vertex>',
                `
#if defined(ANISOTROPY_ENABLED) && ANISOTROPY_ENABLED > 0
    varying vec2 vAnisotropy2MapUv;
    uniform mat3 anisotropy2MapUvTransform;
#endif
                `, {prepend: true},
            )
            shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <uv_vertex>',
                `
#if defined(ANISOTROPY_ENABLED) && ANISOTROPY_ENABLED > 0
    vAnisotropy2MapUv = ( anisotropy2MapUvTransform * vec3( uv, 1 ) ).xy;
#endif
                `, {prepend: true},
            )

            if(!shader.defines) shader.defines = {}
            shader.defines.USE_ANISOTROPY_BRDF = '' // for getting the brdf functions in shader
            shader.defines.USE_UV = ''
            shader.vertexTangents = true
        },
        onObjectRender: (object: IObject3D, material) => {
            const userData = material.userData
            if (!userData?._isAnisotropic) return
            if (!object.isMesh || !object.geometry) return
            if (!object.geometry.attributes.tangent) {
                this._viewer?.console.error('AnisotropyPlugin - No tangents on the geometry, cannot use anisotropy. Make sure the tangents are computed before rendering the model. The model will render as black.', object)
                // throw new Error('AnisotropyPlugin: No tangents on the geometry')
                // mesh.geometry.computeTangents() // tangents must be set before onBeforeRender call, otherwise it's not set in the program.
            }
            this._uniforms.anisotropyFactor.value = userData._anisotropyFactor ?? 1
            this._uniforms.anisotropyNoise.value = userData._anisotropyNoise ?? 0
            this._uniforms.anisotropyDirection.value = userData._anisotropyDirection ?? 1
            const tex = userData._anisotropyDirectionMap?.isTexture ? userData._anisotropyDirectionMap : null
            this._uniforms.anisotropyDirectionMap.value = tex
            if (tex) {
                tex.updateMatrix()
                this._uniforms.anisotropy2MapUvTransform.value.copy(tex.matrix)
            }
            updateMaterialDefines({
                ...this._defines,
                ['ANISOTROPY_ENABLED']: +this.enabled,
                // CONSTANT | ROTATION | DIRECTION
                ['ANISOTROPY_TEX_MODE']: !tex ? 0 : userData._anisotropyDirectionMode === 'DIRECTION' ? 2 : userData._anisotropyDirectionMode === 'ROTATION' ? 1 : 0,
            }, material)
        },
        extraUniforms: {
            // ...this._uniforms, // done in constructor
        },
        computeCacheKey: material1 => {
            return (this.enabled ? '1' : '0') + (material1.userData?._isAnisotropic ? '1' : '0') + material1.userData?._anisotropyDirectionMap?.uuid // todo: srgb ext + material1.userData?._anisotropyDirectionMap?.encoding
        },
        isCompatible: (material1: PhysicalMaterial) => material1.isPhysicalMaterial,
        updaters: () =>
            [
                // this._viewer?.getPlugin(ProgressivePlugin),
                // this._viewer?.scene.mainCamera,
                this._viewer?.renderManager,
            ] as IShaderPropertiesUpdater[],
        getUiConfig: material => {
            const viewer = this._viewer!
            const enableAnisotropy = this.enableAnisotropy.bind(this)
            const state = material.userData
            const config: UiObjectConfig = {
                type: 'folder',
                label: 'Anisotropy',
                onChange: (ev)=>{
                    if (!ev.config) return
                    this.setDirty()
                },
                children: [
                    {
                        type: 'checkbox',
                        label: 'Enabled',
                        get value() {
                            return state._isAnisotropic || false
                        },
                        set value(v) {
                            if (v === state._isAnisotropic) return
                            if (v) {
                                if (!enableAnisotropy(material))
                                    viewer.dialog.alert('AnisotropyPlugin - One or more geometries cannot be made anisotropic.')
                            } else {
                                state._isAnisotropic = false
                                if (material.setDirty) material.setDirty()
                            }
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                    {
                        type: 'slider',
                        label: 'Factor',
                        bounds: [-2, 2],
                        hidden: () => !state._isAnisotropic,
                        property: [state, '_anisotropyFactor'],
                        // onChange: this.setDirty,
                    },
                    {
                        type: 'slider',
                        label: 'Noise',
                        bounds: [0, 2],
                        hidden: () => !state._isAnisotropic,
                        property: [state, '_anisotropyNoise'],
                        // onChange: this.setDirty,
                    },
                    {
                        type: 'dropdown',
                        label: 'Mode',
                        hidden: () => !state._isAnisotropic,
                        property: [state, '_anisotropyDirectionMode'],
                        children: ([
                            'CONSTANT',
                            'ROTATION',
                            'DIRECTION',
                        ] as string[]).map(value => ({
                            label: value,
                        })),
                        onChange: ()=>{
                            if (material.setDirty) material.setDirty()
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                    {
                        type: 'slider',
                        label: 'Direction',
                        bounds: [0, 5],
                        hidden: () => state._anisotropyDirectionMode === 'CONSTANT' || !state._isAnisotropic,
                        property: [state, '_anisotropicDirection'],
                        // onChange: this.setDirty,
                    },
                    {
                        type: 'image',
                        label: 'Texture',
                        hidden: () => !state._isAnisotropic || state._anisotropyDirectionMode === 'CONSTANT',
                        property: [state, '_anisotropyDirectionMap'],
                        onChange: ()=>{
                            if (material.setDirty) material.setDirty()
                        },
                    },
                    makeSamplerUi(state as any, '_anisotropyDirectionMap', 'Sampler',() => !state._isAnisotropic || state._anisotropyDirectionMode === 'CONSTANT', ()=>material.setDirty && material.setDirty()),
                ],
            }
            return config
        },

        // todo errors will be fixed on threepipe update
        onMaterialUpdate: (material)=>{
            if (!material.userData?._isAnisotropic) return
            material.userData.__appliedMeshes?.forEach((m: any)=> this.tryComputeTangents(m, [material]))
        },
        onRegister: (material)=>{
            if (!material.userData?._isAnisotropic) return
            material.userData.__appliedMeshes?.forEach((m: any)=> this.tryComputeTangents(m, [material]))
        },
        onAddToMesh: (mesh: IObject3D)=>{
            if(!mesh.isMesh) return
            const m = mesh
            const mats = Array.isArray(m.material) ? m.material : [m.material]
            if (!mats.find(m1=>m1?.userData?._isAnisotropic)) return
            this.tryComputeTangents(m, mats as any)
        },
    }

    tryComputeTangents(m: IObject3D, mats: IMaterial[]) {
        if (m.geometry && !m.geometry.attributes.tangent) {
            let possible = true
            if (!m.geometry.index || !m.geometry.attributes.position || !m.geometry.attributes.normal || !m.geometry.attributes.uv) {
                possible = false
            }
            if (possible) m.geometry.computeTangents()
            else mats.map(m1=>{
                if (m1?.userData?._isAnisotropic) m1.userData._isAnisotropic = false
            })
        }
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
        v.assetManager.materials.registerMaterialExtension(this.materialExtension)
        v.assetManager.registerGltfExtension(anisotropyGLTFExtension)
    }

    onRemove(v: ThreeViewer) {
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        v.assetManager.unregisterGltfExtension(anisotropyGLTFExtension.name)
        return super.onRemove(v)
    }

    // @uiButton('Enable Anisotropy (selected)', (that: AnisotropyPlugin)=>({hidden: ()=>!that._viewer?.getPlugin(PickingPlugin)}))
    // makeSelectedAnisotropic = (): boolean => {
    //     const material = (this._viewer?.getPlugin(PickingPlugin)?.getSelectedObject() as any)?.material as IMaterial
    //     if (material?.assetType !== 'material') return false
    //     return this.enableAnisotropy(material)
    // }

    /**
     * @deprecated use {@link anisotropyGLTFExtension}
     */
    public static readonly ANISOTROPY_GLTF_EXTENSION = 'WEBGI_materials_anisotropy'


    /**
     * @deprecated - use {@link enableAnisotropy} instead
     * @param material
     */
    public makeAnisotropic(material: IMaterial): boolean {
        return this.enableAnisotropy(material)
    }
}

declare module 'threepipe' {
    interface IMaterialUserData {
        /**
         * Is the material anisotropic
         */
        _isAnisotropic?: boolean
        /**
         * Anisotropy factor
         */
        _anisotropyFactor?: number
        /**
         * Anisotropy noise factor
         */
        _anisotropyNoise?: number
        /**
         * Anisotropy direction mode
         */
        _anisotropyDirectionMode?: 'CONSTANT' | 'ROTATION' | 'DIRECTION'
        /**
         * Anisotropy direction map, when mode is ROTATION or DIRECTION
         */
        _anisotropyDirectionMap?: ITexture | null
        /**
         * Direction when map is not used, when mode is CONSTANT
         */
        _anisotropyDirection?: number
    }
}

/**
 * Anisotropy Materials Extension
 *
 * Specification: https://webgi.xyz/docs/gltf-extensions/WEBGI_materials_anisotropy.html
 */

class GLTFMaterialsAnisotropyExtensionImport implements GLTFLoaderPlugin {
    public name: string
    public parser: GLTFParser

    constructor(parser: GLTFParser) {

        this.parser = parser
        this.name = anisotropyGLTFExtension.name

    }

    async extendMaterialParams(materialIndex: number, materialParams: any) {

        const parser = this.parser
        const materialDef = parser.json.materials[materialIndex]

        if (!materialDef.extensions || !materialDef.extensions[this.name]) {

            return Promise.resolve()

        }

        const pending = []

        const extension = materialDef.extensions[this.name]

        if (!materialParams.userData) materialParams.userData = {}
        materialParams.userData._isAnisotropic = true // single _ so that its saved when cloning( and tojson) but not when saving glb
        materialParams.userData._anisotropyFactor = extension.anisotropyFactor ?? 0.0
        materialParams.userData._anisotropyNoise = extension.anisotropyNoiseFactor ?? extension.anisotropyNoise ?? 0.

        let {anisotropyDirectionMode, anisotropyDirection} = extension

        // backwards compatibility. todo: make changes to blender plugin.
        if (!anisotropyDirectionMode) anisotropyDirectionMode = extension.anisotropyTextureMode
        if (!anisotropyDirection) anisotropyDirection = extension.anisotropyRotation

        materialParams.userData._anisotropyDirectionMode = anisotropyDirectionMode && typeof anisotropyDirection?.index === 'number' ? anisotropyDirectionMode : 'CONSTANT'
        if (anisotropyDirectionMode === 'ROTATION' || anisotropyDirectionMode === 'DIRECTION') {
            pending.push(parser.assignTexture(materialParams.userData, '_anisotropyDirectionMap', anisotropyDirection).then((t: any) => {
                // t.format = RGBFormat
                t.colorSpace = SRGBColorSpace
            }))
            // pending.push(parser.assignTexture(materialParams, 'map', anisotropyDirection))
        } else {
            materialParams.userData._anisotropyDirection = anisotropyDirection ?? 0
        }
        return Promise.all(pending)
    }

    afterRoot(result: GLTF): Promise<void> | null {
        result.scene?.traverse((object: any) => {
            const mat = object.material?.userData?._isAnisotropic
            if (!mat) return
            const geom = object.geometry
            if (!geom.attributes.tangent) {
                geom.computeTangents()
                geom.attributes.tangent.needsUpdate = true
            }

        })
        return null
    }

}


const glTFMaterialsAnisotropyExtensionExport = (w: GLTFWriter2)=> ({
    writeMaterialAsync: async(material: any, materialDef: any) => {
        if (!material.isMeshStandardMaterial || !material.userData._isAnisotropic) return

        if ((material.userData._anisotropyFactor || 0) < 0.001) return // todo: is this correct?

        materialDef.extensions = materialDef.extensions || {}

        const extensionDef: any = {}

        extensionDef.anisotropyFactor = material.userData._anisotropyFactor || 1.0
        extensionDef.anisotropyNoiseFactor = material.userData._anisotropyNoise || 0.0
        extensionDef.anisotropyDirectionMode = material.userData._anisotropyDirectionMode || 'CONSTANT'

        if (w.checkEmptyMap(material.userData._anisotropyDirectionMap) && extensionDef.anisotropyDirectionMode !== 'CONSTANT') {

            const anisotropyDirectionMapDef = {index: await w.processTextureAsync(material.userData._anisotropyDirectionMap)}
            w.applyTextureTransform(anisotropyDirectionMapDef, material.userData._anisotropyDirectionMap)
            extensionDef.anisotropyDirection = anisotropyDirectionMapDef

        } else {

            extensionDef.anisotropyDirectionMode = 'CONSTANT'
            extensionDef.anisotropyDirection = material.userData._anisotropyDirection || 0.0

        }

        materialDef.extensions[ anisotropyGLTFExtension.name ] = extensionDef
        w.extensionsUsed[ anisotropyGLTFExtension.name ] = true
    },
})

export const anisotropyGLTFExtension = {
    name: 'WEBGI_materials_anisotropy',
    import: (p) => new GLTFMaterialsAnisotropyExtensionImport(p),
    export: glTFMaterialsAnisotropyExtensionExport,
    textures: {
        anisotropyDirection: 'RGB',
    },
} satisfies AssetManager['gltfExtensions'][number]
