import {Matrix3, Plane as PlaneThree, Vector4, Vector4Tuple} from 'three'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {serialize} from 'ts-browser-helpers'
import {IMaterial, IMaterialUserData, IObject3D, PhysicalMaterial} from '../../core'
import {MaterialExtension, updateMaterialDefines} from '../../materials'
import {shaderReplaceString, ThreeSerialization} from '../../utils'
import {AssetManager, GLTFWriter2} from '../../assetmanager'
import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import FragmentClippingExtensionPluginPars from './shaders/FragmentClippingExtensionPlugin.pars.glsl'
import FragmentClippingExtensionPluginPatch from './shaders/FragmentClippingExtensionPlugin.patch.glsl'

/**
 * FragmentClipping Materials Extension
 * Adds a material extension to PhysicalMaterial to add support for fragment clipping.
 * Fragment clipping allows to clip fragments of the material in screen space or world space based on a circle, rectangle, plane, sphere, etc.
 * It uses fixed SDFs with params defined by the user for clipping.
 * It also adds a UI to the material to edit the settings.
 * It uses `WEBGI_materials_fragment_clipping_extension` glTF extension to save the settings in glTF files.
 * @category Plugins
 */
@uiFolderContainer('Fragment Clipping (MatExt)')
export class FragmentClippingExtensionPlugin extends AViewerPluginSync {
    static readonly PluginType = 'FragmentClippingExtensionPlugin1'

    @uiToggle('Enabled', (that: FragmentClippingExtensionPlugin)=>({onChange: that.setDirty}))
    @serialize() enabled = true

    private _defines: any = {
        ['FRAG_CLIPPING_DEBUG']: 0,
    }
    private _uniforms: any = {
        fragClippingPosition: {value: new Vector4()}, // point on plane, center of sphere, center of cylinder, etc
        fragClippingParams: {value: new Vector4()}, // normal of plane, radius of sphere, radius of cylinder, etc
        fragClippingCamAspect: {value: 1},
    }

    public static AddFragmentClipping(material: IMaterial, params?: IMaterialUserData['_fragmentClippingExt']): boolean {
        const ud = material?.userData
        if (!ud) return false
        if (!ud._fragmentClippingExt) {
            ud._fragmentClippingExt = {}
        }
        const tf = ud._fragmentClippingExt
        tf.clipEnabled = true
        if (tf.clipPosition === undefined) tf.clipPosition = [0, 0, 0, 0]
        if (tf.clipParams === undefined) tf.clipParams = [0, 0, 0, 0]
        if (tf.clipMode === undefined !== undefined) tf.clipMode = FragmentClippingMode.Circle
        if (tf.clipInvert === undefined !== undefined) tf.clipInvert = false
        params && Object.assign(tf, params)
        if (material.setDirty) material.setDirty()
        return true
    }

    private _plane = new PlaneThree()
    private _viewNormalMatrix = new Matrix3()
    private _v4 = new Vector4()

    readonly materialExtension: MaterialExtension = {
        parsFragmentSnippet: (_, material: PhysicalMaterial)=>{
            if (!this.enabled || !material?.userData._fragmentClippingExt?.clipEnabled) return ''
            return Object.entries(FragmentClippingMode)
                .map(v=>['FragmentClippingMode.' + v[0], '' + v[1]])// replace enum with integer values in the shader
                .reduce((a, v)=>a.replace(v[0], v[1]), FragmentClippingExtensionPluginPars)
        },
        shaderExtender: (shader, material: PhysicalMaterial) => {
            if (!this.enabled || !material?.userData._fragmentClippingExt?.clipEnabled) return
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#glMarker mainStart', Object.entries(FragmentClippingMode)
                .map(v=>['FragmentClippingMode.' + v[0], '' + v[1]]) // replace enum with integer values in the shader
                .reduce((a, v)=>a.replace(v[0], v[1]), '\n' + FragmentClippingExtensionPluginPatch), {append: true})
        },
        onObjectRender: (object: IObject3D, material) => {
            let tfUd = material.userData._fragmentClippingExt
            if (material.userData.isGBufferMaterial && object && object.material && !Array.isArray(object.material)) { // todo isGBufferMaterial
                tfUd = object.material?.userData._fragmentClippingExt
            }
            if (!tfUd?.clipEnabled) return

            if (Array.isArray(tfUd.clipPosition))
                this._uniforms.fragClippingPosition.value.fromArray(tfUd.clipPosition)
            else
                this._uniforms.fragClippingPosition.value.copy(tfUd.clipPosition)

            if (tfUd.clipMode === FragmentClippingMode.Plane && tfUd.clipParams) {
                const clipParams = Array.isArray(tfUd.clipParams) ? this._v4.fromArray(tfUd.clipParams) : this._v4.copy(tfUd.clipParams)
                const viewMatrix = this._viewer!.scene.mainCamera.matrixWorldInverse
                this._plane.normal.set(clipParams.x, clipParams.y, clipParams.z)
                this._plane.constant = clipParams.w
                this._viewNormalMatrix.getNormalMatrix(viewMatrix)
                this._plane.applyMatrix4(viewMatrix, this._viewNormalMatrix)
                this._uniforms.fragClippingParams.value.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant)
            } else {
                if (Array.isArray(tfUd.clipPosition))
                    this._uniforms.fragClippingParams.value.fromArray(tfUd.clipParams)
                else
                    this._uniforms.fragClippingParams.value.copy(tfUd.clipParams)
            }
            if (this._viewer?.scene.mainCamera.isPerspectiveCamera)
                this._uniforms.fragClippingCamAspect.value = this._viewer?.scene.mainCamera.aspect
            else this._uniforms.fragClippingCamAspect.value = 1.0

            updateMaterialDefines({
                ...this._defines,
                // ['FRAGMENT_CLIPPING_EXTENSION_ENABLED']: this.enabled,
                ['FRAG_CLIPPING_MODE']: +(tfUd.clipMode ?? FragmentClippingMode.Circle),
                ['FRAG_CLIPPING_INVERSE']: +(tfUd.clipInvert ?? false),
            }, material)
        },
        extraUniforms: {
            // ...this._uniforms, // done in constructor
        },
        computeCacheKey: (material1: PhysicalMaterial) => {
            return (this.enabled ? '1' : '0') + (material1.userData._fragmentClippingExt?.clipEnabled ? '1' : '0')
        },
        isCompatible: (material1: PhysicalMaterial) => {
            return material1.isPhysicalMaterial || material1.userData.isGBufferMaterial // todo isGBufferMaterial
        },
        getUiConfig: material => { // todo use uiConfigMaterialExtension
            const viewer = this._viewer!
            if (material.userData._fragmentClippingExt === undefined) material.userData._fragmentClippingExt = {}
            const state = material.userData._fragmentClippingExt
            const config: UiObjectConfig = {
                type: 'folder',
                label: 'Fragment Clipping',
                onChange: (ev)=>{
                    if (!ev.config) return
                    this.setDirty()
                },
                children: [
                    {
                        type: 'checkbox',
                        label: 'Enabled',
                        get value() {
                            return state.clipEnabled || false
                        },
                        set value(v) {
                            if (v === state.clipEnabled) return
                            if (v) {
                                if (!FragmentClippingExtensionPlugin.AddFragmentClipping(material))
                                    viewer.dialog.alert('Cannot add FragmentClippingExtension.')
                            } else {
                                state.clipEnabled = false
                                if (material.setDirty) material.setDirty()
                            }
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                    {
                        type: 'dropdown',
                        label: 'Mode',
                        children: Object.entries(FragmentClippingMode)
                            // .filter(key => !isNaN(Number(FragmentClippingMode[key])))
                            .map(v => ({label: v[0], value: v[1]})),
                        hidden: () => !state.clipEnabled,
                        property: [state, 'clipMode'],
                    },
                    {
                        type: 'vec4',
                        label: 'Position',
                        bounds: [-1, 1],
                        hidden: () => !state.clipEnabled,
                        property: [state, 'clipPosition'],
                    },
                    {
                        type: 'vec4',
                        label: 'Params',
                        bounds: [0, 1],
                        hidden: () => !state.clipEnabled,
                        property: [state, 'clipParams'],
                    },
                    {
                        type: 'toggle',
                        label: 'Invert',
                        hidden: () => !state.clipEnabled,
                        property: [state, 'clipInvert'],
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

    constructor() {
        super()
        Object.assign(this.materialExtension.extraUniforms!, this._uniforms)
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        // v.addEventListener('preRender', this._preRender)
        v.assetManager.materials.registerMaterialExtension(this.materialExtension)
        v.assetManager.registerGltfExtension(fragmentClippingGLTFExtension)
        // v.getPlugin(GBufferPlugin)?.material?.registerMaterialExtensions([this.materialExtension])

    }

    onRemove(v: ThreeViewer) {
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        v.assetManager.unregisterGltfExtension(fragmentClippingGLTFExtension.name)
        // v.getPlugin(GBufferPlugin)?.material?.unregisterMaterialExtensions([this.materialExtension])
        return super.onRemove(v)
    }

    /**
     * @deprecated use - use {@link fragmentClippingGLTFExtension}
     */
    public static readonly FRAGMENT_CLIPPING_EXTENSION_GLTF_EXTENSION = 'WEBGI_materials_fragment_clipping_extension'

}

declare module '../../core/IMaterial' {
    interface IMaterialUserData {
        _fragmentClippingExt?: {
            clipEnabled?: boolean
            clipPosition?: Vector4|Vector4Tuple
            clipParams?: Vector4|Vector4Tuple
            clipMode?: FragmentClippingMode
            clipInvert?: boolean
        }
    }
}


export enum FragmentClippingMode {
    Circle = 0,
    Ellipse = 1,
    Rectangle = 2,
    Plane = 3,
    Sphere = 4
}

/**
 * FragmentClipping Materials Extension
 *
 * Specification: https://threepipe.org/docs/gltf-extensions/WEBGI_materials_fragment_clipping_extension.html
 */
class GLTFMaterialsFragmentClippingExtensionImport implements GLTFLoaderPlugin {
    public name: string
    public parser: GLTFParser

    constructor(parser: GLTFParser) {
        this.parser = parser
        this.name = fragmentClippingGLTFExtension.name
    }

    async extendMaterialParams(materialIndex: number, materialParams: any) {
        const parser = this.parser
        const materialDef = parser.json.materials[materialIndex]
        if (!materialDef.extensions || !materialDef.extensions[this.name]) return
        const extension = materialDef.extensions[this.name]
        if (!materialParams.userData) materialParams.userData = {}
        FragmentClippingExtensionPlugin.AddFragmentClipping(materialParams)
        ThreeSerialization.Deserialize(extension, materialParams.userData._fragmentClippingExt)
    }
}

const glTFMaterialsFragmentClippingExtensionExport = (w: GLTFWriter2)=> ({
    writeMaterial: (material: any, materialDef: any) => {
        if (!material.isMeshStandardMaterial || !material.userData._fragmentClippingExt?.clipEnabled) return
        materialDef.extensions = materialDef.extensions || {}

        const extensionDef: any = ThreeSerialization.Serialize(material.userData._fragmentClippingExt)

        materialDef.extensions[ fragmentClippingGLTFExtension.name ] = extensionDef
        w.extensionsUsed[ fragmentClippingGLTFExtension.name ] = true
    },
})

export const fragmentClippingGLTFExtension = {
    name: 'WEBGI_materials_fragment_clipping',
    import: (p) => new GLTFMaterialsFragmentClippingExtensionImport(p),
    export: glTFMaterialsFragmentClippingExtensionExport,
    textures: undefined,
} satisfies AssetManager['gltfExtensions'][number]
