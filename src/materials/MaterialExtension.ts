import {IUniform, Object3D, WebGLProgramParametersWithUniforms, WebGLRenderer} from 'three'
import {IMaterial, IWebGLRenderer} from '../core'
import {UiObjectConfig} from 'uiconfig.js'
import {ValOrFunc} from 'ts-browser-helpers'

export type MaterialExtensionShader = WebGLProgramParametersWithUniforms // ShaderLibShader & {defines: any} // todo

/**
 * @deprecated use {@link MaterialExtensionShader} or {@link WebGLProgramParametersWithUniforms} instead
 */
export type Shader = WebGLProgramParametersWithUniforms // ShaderLibShader & {defines: any} // todo

/**
 * Material extension interface
 * This is used to extend a three.js material satisfying the IMaterial interface, with extra uniforms, defines, shader code, etc.
 */
export interface MaterialExtension{
    /**
     * Extra uniforms to copy to material
     */
    extraUniforms?: {[uniform: string]: ValOrFunc<IUniform>};

    /**
     * Extra defines to copy to material
     * Note: boolean are converted to 0 and 1
     */
    extraDefines?: Record<string, ValOrFunc<number|string|undefined|boolean>>;

    /**
     * Custom callback to extend/modify/replace shader code and other shader properties
     * @param shader
     * @param material
     * @param renderer
     */
    shaderExtender?: (shader: MaterialExtensionShader, material: IMaterial, renderer: WebGLRenderer) => void,
    /**
     * Extra code to add to the top of the fragment shader
     * Value can be a string or a function that returns a string
     */
    parsFragmentSnippet?: string | ((renderer?: WebGLRenderer, material?:IMaterial)=>string),
    /**
     * Extra code to add to the top of the vertex shader
     * Value can be a string or a function that returns a string
     */
    parsVertexSnippet?: string | ((renderer?: WebGLRenderer, material?:IMaterial)=>string),

    // customCacheKey?: string, // same as computeCacheKey

    /**
     * Custom cache key to use for this material extension.
     * A different cache key will cause the shader to be recompiled.
     * Check three.js docs for more info.
     * Value can be a string or a function that returns a string
     * This will only be checked if `material.needsUpdate` is `true`, not on every render.
     * Note: extension might never be registered if an empty string is returned.
     */
    computeCacheKey?: string | ((material: IMaterial) => string)

    /**
     * Custom callback to run code before the material is rendered
     * Executes from `material.onBeforeRender` for each material for each object it's rendered on.
     * @param object
     * @param material
     * @param renderer
     */
    onObjectRender?: (object: Object3D, material: IMaterial, renderer: IWebGLRenderer) => void


    /**
     * Custom callback to run code after the material is rendered
     * Executes from `material.onAfterRender` for each material for each object it's rendered on.
     * @param object
     * @param material
     * @param renderer
     */
    onAfterRender?: (object: Object3D, material: IMaterial, renderer: IWebGLRenderer) => void

    /**
     * Custom callback to run code when the material is updated. (when `materialUpdate` event is dispatched on the material)
     * @param material - material that was updated
     */
    onMaterialUpdate?: (material: IMaterial) => void
    /**
     * Custom callback to run code when the material is added/applied to a mesh or any Object3D.
     * @param mesh - object/mesh applied to
     * @param material - material that was added
     */
    onAddToMesh?: (mesh: Object3D, material: IMaterial) => void
    /**
     * Custom callback to run code when the material is removed from a mesh or any Object3D.
     * @param mesh
     * @param material
     */
    onRemoveFromMesh?: (mesh: Object3D, material: IMaterial) => void

    /**
     * Custom callback to run code when this material extension is registered to a material.
     * @param material
     */
    onRegister?: (material: IMaterial) => void // when this extension is registered to a material
    /**
     * Custom callback to run code when this material extension is unregistered from a material.
     * @param material
     */
    onUnregister?: (material: IMaterial) => void // when this extension is registered to a material

    /**
     * Function to check if this material extension is compatible with the given material.
     * If not compatible, the material extension will not be added to the material.
     * This is only checked when the extension is registered.
     *
     * The extension is assumed to be compatible if this function is not defined
     * @param material
     */
    isCompatible?: (material: IMaterial) => boolean|undefined

    /**
     * List of shader properties updaters to run on the material.
     *
     */
    updaters?: IShaderPropertiesUpdater[]|(()=>IShaderPropertiesUpdater[])

    /**
     * Function to return the UI config for this material extension.
     * This is called once when the material extension is registered.
     * @param material
     */
    getUiConfig?: (material: IMaterial, refreshUi?: UiObjectConfig['uiRefresh']) => UiObjectConfig | undefined

    /**
     * Higher priority extensions are applied first. (or as they are added, depends on the type of extension)
     */
    priority?: number // default 0

    updateVersion?: number
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __setDirty?: () => void // set by MaterialExtender, this increments updateVersion, which ends up calling needsUpdate on all the materials with this extension
    uuid?: string
    setDirty?: ()=>void // this is set automatically if does not exists. calls __setDirty for all materials. //todo: also refresh UI.
}

export interface IShaderPropertiesUpdater {
    updateShaderProperties(material: {defines: Record<string, string | number | undefined>, uniforms: {[name: string]: IUniform}}): this;
}
