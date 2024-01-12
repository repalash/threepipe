import {Color} from 'three'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {glsl, serialize} from 'ts-browser-helpers'
import {IMaterialUserData, PhysicalMaterial} from '../../core'
import {MaterialExtension, updateMaterialDefines} from '../../materials'
import {shaderReplaceString, ThreeSerialization} from '../../utils'
import {GLTFLoader2, GLTFWriter2} from '../../assetmanager'
import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader'

/**
 * Clearcoat Tint Plugin
 * Adds a material extension to PhysicalMaterial which adds tint and thickness to the built-in clearcoat properties.
 * It also adds a UI to the material to edit the settings.
 * It uses WEBGI_materials_clearcoat_tint glTF extension to save the settings in glTF files.
 * @category Plugins
 */
@uiFolderContainer('Clearcoat Tint (MatExt)')
export class ClearcoatTintPlugin extends AViewerPluginSync<''> {
    static readonly PluginType = 'ClearcoatTintPlugin'

    @uiToggle('Enabled', (that: ClearcoatTintPlugin)=>({onChange: that.setDirty}))
    @serialize() enabled = true

    // private _defines: any = {
    //     // eslint-disable-next-line @typescript-eslint/naming-convention
    //     CLEARCOAT_TINT_DEBUG: false,
    // }
    private _uniforms: any = {
        ccTintColor: {value: new Color()},
        ccThickness: {value: 0.},
        ccIor: {value: 0.},
    }

    static AddClearcoatTint(material: PhysicalMaterial, params?: IMaterialUserData['_clearcoatTint']): IMaterialUserData['_clearcoatTint']|null {
        const ud = material?.userData
        if (!ud) return null
        if (!ud._clearcoatTint) ud._clearcoatTint = {}
        const tf = ud._clearcoatTint!
        tf.enableTint = true
        if (tf.tintColor === undefined) tf.tintColor = '#ffffff'
        if (tf.thickness === undefined) tf.thickness = 0.1
        if (tf.ior === undefined) tf.ior = 1.5
        Object.assign(tf, params)
        if (material.setDirty) material.setDirty()
        return tf
    }

    // private _multiplyPass?: MultiplyPass
    readonly materialExtension: MaterialExtension = {
        parsFragmentSnippet: (_, material: PhysicalMaterial)=>{
            if (this.isDisabled() || !material?.userData._clearcoatTint?.enableTint || !(material.clearcoat > 0)) return ''
            return glsl`
uniform vec3 ccTintColor;
uniform float ccThickness;
uniform float ccIor;
vec3 clearcoatTint(const in float dotNV, const in float dotNL, const in float clearcoat) {
    vec3 tint = ( ccThickness > 0. ? 1. - ccTintColor : ccTintColor); // Set thickness < 0 for glow.
    tint = exp(tint * -(ccThickness * ((dotNL + dotNV) / max(dotNL * dotNV, 1e-3)))); // beer's law
    return mix(vec3(1.0), tint, clearcoat);
}
        `
        },
        shaderExtender: (shader, material: PhysicalMaterial) => {
            if (this.isDisabled() || !material?.userData._clearcoatTint?.enableTint || !(material.clearcoat > 0)) return

            // Note: clearcoat only considers specular, not diffuse

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                'float dotNVcc = saturate( dot( geometry.clearcoatNormal, geometry.viewDir ) );',
                'float dotNVcc = saturate( dot( geometry.clearcoatNormal, -refract(geometry.viewDir, geometry.clearcoatNormal, 1./ccIor) ) );')

            // todo: we are considering all light is coming from env map, but we should consider light coming from light sources by seperating light and env map attenuation
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                'outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + clearcoatSpecular * material.clearcoat;',
                'outgoingLight *= clearcoatTint(dotNVcc, dotNVcc, material.clearcoat);\n', {prepend: true})

            ;(shader as any).defines.USE_UV = ''

        },
        onObjectRender: (_, material) => {
            const tfUd = material.userData._clearcoatTint
            if (!tfUd?.enableTint) return

            this._uniforms.ccTintColor.value.set(tfUd.tintColor) // could be number or string also, apart from Color
            this._uniforms.ccThickness.value = tfUd.thickness
            this._uniforms.ccIor.value = tfUd.ior

            updateMaterialDefines({
                // ...this._defines,
                ['CLEARCOAT_TINT_ENABLED']: +!this.isDisabled(),
            }, material)
        },
        extraUniforms: {
            ...this._uniforms,
        },
        computeCacheKey: (material1: PhysicalMaterial) => {
            return (this.isDisabled() ? '0' : '1') + (material1.userData._clearcoatTint?.enableTint ? '1' : '0') + (material1.clearcoat > 0 ? '1' : '0')
        },
        isCompatible: (material1: PhysicalMaterial) => {
            return material1.isPhysicalMaterial
        },
        getUiConfig: (material: PhysicalMaterial) => {
            const viewer = this._viewer!
            if (material.userData._clearcoatTint === undefined) material.userData._clearcoatTint = {}
            const state = material.userData._clearcoatTint
            const config: UiObjectConfig = {
                type: 'folder',
                label: 'Clearcoat Tint',
                onChange: (ev)=>{
                    if (!ev.config) return
                    this.setDirty()
                },
                children: [
                    {
                        type: 'checkbox',
                        label: 'Enabled',
                        get value() {
                            return state.enableTint || false
                        },
                        set value(v) {
                            if (v === state.enableTint) return
                            if (v) {
                                if (!ClearcoatTintPlugin.AddClearcoatTint(material))
                                    viewer.dialog.alert('Cannot add clearcoat tint.')
                            } else {
                                state.enableTint = false
                                if (material.setDirty) material.setDirty()
                            }
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                    {
                        type: 'color',
                        label: 'Tint color',
                        hidden: () => !state.enableTint,
                        property: [state, 'tintColor'],
                    },
                    {
                        type: 'input',
                        label: 'Thickness',
                        hidden: () => !state.enableTint,
                        property: [state, 'thickness'],
                    },
                    {
                        type: 'slider',
                        bounds: [0.8, 2.5],
                        label: 'IOR',
                        hidden: () => !state.enableTint,
                        property: [state, 'ior'],
                    },
                ],
            }
            return config
        },

    }

    setDirty = (): void => {
        this.materialExtension.setDirty?.()
        this._viewer?.setDirty()
    }

    private _loaderCreate({loader}: {loader: GLTFLoader2}) {
        if (!loader.isGLTFLoader2) return
        loader.register((p) => new GLTFMaterialsClearcoatTintExtensionImport(p))
    }

    constructor() {
        super()
        this._loaderCreate = this._loaderCreate.bind(this)
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        // v.addEventListener('preRender', this._preRender)
        v.assetManager.materials.registerMaterialExtension(this.materialExtension)
        v.assetManager.importer.addEventListener('loaderCreate', this._loaderCreate as any)
        v.assetManager.exporter.getExporter('gltf', 'glb')?.extensions?.push(glTFMaterialsClearcoatTintExtensionExport)

    }

    onRemove(v: ThreeViewer) {
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        v.assetManager.importer?.removeEventListener('loaderCreate', this._loaderCreate as any)
        const exporter = v.assetManager.exporter.getExporter('gltf', 'glb')
        if (exporter) {
            const index = exporter.extensions?.indexOf(glTFMaterialsClearcoatTintExtensionExport)
            if (index !== undefined && index >= 0) exporter.extensions?.splice(index, 1)
        }
        return super.onRemove(v)
    }

    public static readonly CLEARCOAT_TINT_GLTF_EXTENSION = 'WEBGI_materials_clearcoat_tint'

}

declare module '../../core/IMaterial' {
    interface IMaterialUserData {
        _clearcoatTint?: {
            enableTint?: boolean
            tintColor?: Color|number|string
            thickness?: number
            ior?: number
        }
    }
}

/**
 * ClearcoatTint Materials Extension
 *
 * Specification: https://webgi.xyz/docs/gltf-extensions/WEBGI_materials_clearcoat_tint.html
 */
class GLTFMaterialsClearcoatTintExtensionImport implements GLTFLoaderPlugin {
    public name: string
    public parser: GLTFParser

    constructor(parser: GLTFParser) {
        this.parser = parser
        this.name = ClearcoatTintPlugin.CLEARCOAT_TINT_GLTF_EXTENSION
    }

    async extendMaterialParams(materialIndex: number, materialParams: any) {
        const parser = this.parser
        const materialDef = parser.json.materials[materialIndex]
        if (!materialDef.extensions || !materialDef.extensions[this.name]) return
        const extension = materialDef.extensions[this.name]
        if (!materialParams.userData) materialParams.userData = {}
        ClearcoatTintPlugin.AddClearcoatTint(materialParams)
        ThreeSerialization.Deserialize(extension, materialParams.userData._clearcoatTint)
    }
}

const glTFMaterialsClearcoatTintExtensionExport = (w: GLTFWriter2)=> ({
    writeMaterial: (material: any, materialDef: any) => {
        if (!material.isMeshStandardMaterial || !material.userData._clearcoatTint?.enableTint) return
        materialDef.extensions = materialDef.extensions || {}

        const extensionDef: any = ThreeSerialization.Serialize(material.userData._clearcoatTint)

        materialDef.extensions[ ClearcoatTintPlugin.CLEARCOAT_TINT_GLTF_EXTENSION ] = extensionDef
        w.extensionsUsed[ ClearcoatTintPlugin.CLEARCOAT_TINT_GLTF_EXTENSION ] = true
    },
})
