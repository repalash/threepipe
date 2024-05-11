import {IMaterial, IMaterialUserData} from '../core'
import {getOrCall, objectMap} from 'ts-browser-helpers'
import {shaderReplaceString, shaderUtils} from '../utils'
import {Object3D, Shader, ShaderChunk, WebGLRenderer} from 'three'
import {MaterialExtension} from './MaterialExtension'
import {generateUUID} from '../three/utils'

export class MaterialExtender {

    static {
        Object.assign(ShaderChunk, shaderUtils) // for #include in the shaders
    }

    static VoidMain = 'void main()'

    static ApplyMaterialExtensions(material: IMaterial, shader: Shader, materialExtensions: MaterialExtension[], renderer: WebGLRenderer) {
        for (const materialExtension of materialExtensions) {
            this.ApplyMaterialExtension(material, shader, materialExtension, renderer)
        }
    }

    static ApplyMaterialExtension(material: IMaterial, shader: Shader, materialExtension: MaterialExtension, renderer: WebGLRenderer) {
        // Add parsFragmentSnippet just before void main in fragment shader
        let a = getOrCall(materialExtension.parsFragmentSnippet, renderer, material) ?? ''
        if (a.length) {
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, this.VoidMain, '\n' + a + '\n', {prepend: true})
        }
        // Add parsVertexSnippet just before void main in vertex shader
        a = getOrCall(materialExtension.parsVertexSnippet, renderer, material) ?? ''
        if (a.length) {
            shader.vertexShader = shaderReplaceString(shader.vertexShader, this.VoidMain, '\n' + a + '\n', {prepend: true})
        }
        // Add extra uniforms
        if (materialExtension.extraUniforms) {
            shader.uniforms = Object.assign(shader.uniforms, objectMap(materialExtension.extraUniforms, (v)=>getOrCall(v, shader) || {value: null}))
        }
        // Add extra defines and set needsUpdate to true if needed
        if (materialExtension.extraDefines)
            updateMaterialDefines(materialExtension.extraDefines, material)

        // Call shaderExtender if defined
        materialExtension.shaderExtender?.(shader as any, material, renderer)
        // Save last shader so that it can be used to check if shader has changed in extensions
        material.lastShader = shader
    }

    static CacheKeyForExtensions(material: IMaterial, materialExtensions: MaterialExtension[]): string {
        let r = ''
        for (const materialExtension of materialExtensions) {
            r += this.CacheKeyForExtension(material, materialExtension)
        }
        return r
    }

    static CacheKeyForExtension(material: IMaterial, materialExtension: MaterialExtension): string {
        let r = ''
        if (materialExtension.computeCacheKey) r += getOrCall(materialExtension.computeCacheKey, material)
        else r += materialExtension.uuid
        if (materialExtension.extraDefines) r += Object.values(materialExtension.extraDefines).map(v=>getOrCall(v) ?? '').join('')
        return r
    }

    static RegisterExtensions(material: IMaterial, customMaterialExtensions?: MaterialExtension[]): MaterialExtension[] {
        const exts = []
        if (!Array.isArray(material.materialExtensions)) material.materialExtensions = []
        if (customMaterialExtensions)
            for (const ext of customMaterialExtensions) {
                if (!ext.isCompatible || !ext.isCompatible(material) || material.materialExtensions.includes(ext)) continue
                exts.push(ext)
                if (!ext.uuid) ext.uuid = generateUUID()
                if (!ext.__setDirty) ext.__setDirty = ()=>{
                    if (!ext.updateVersion) ext.updateVersion = 0
                    ext.updateVersion++
                }
                if (!ext.setDirty) ext.setDirty = ext.__setDirty
            }

        if (!exts.length) return []

        material.materialExtensions = [...material.materialExtensions || [], ...exts]
            .sort((a, b)=>(b.priority || 0) - (a.priority || 0))

        if (!(material as any).__ext_beforeRenderListen) {
            (material as any).__ext_beforeRenderListen = true
            material.addEventListener('beforeRender', materialBeforeRender)
        }
        if (!(material as any).__ext_afterRenderListen) {
            (material as any).__ext_afterRenderListen = true
            material.addEventListener('afterRender', materialAfterRender)
        }

        material.needsUpdate = true
        return exts
    }

    static UnregisterExtensions(material: IMaterial, customMaterialExtensions?: MaterialExtension[]) {
        if (customMaterialExtensions) {
            material.materialExtensions = material.materialExtensions?.filter((v)=>!customMaterialExtensions.includes(v)) || []
        }
        if (!material.materialExtensions?.length) {
            material.removeEventListener('beforeRender', materialBeforeRender)
            material.removeEventListener('afterRender', materialAfterRender)
            ;(material as any).__ext_beforeRenderListen = false
            ;(material as any).__ext_afterRenderListen = false
        }
    }
}

export function updateMaterialDefines(defines: MaterialExtension['extraDefines'], material: IMaterial) {
    if (!defines || !material) return
    if (material.defines === undefined || material.defines === null) { // required for some three.js materials
        material.defines = {}
    }
    let flag = false
    const entries = Object.entries(defines)
    for (const [key, valF] of entries) {
        const val = getOrCall(valF)
        if (val === undefined) {
            if (material.defines[key] !== undefined) {
                delete material.defines[key]
                flag = true
            }
        } else if (material.defines[key] !== val) {
            material.defines[key] = typeof val === 'boolean' ? +val : val
            flag = true
        }
    }
    if (flag) material.needsUpdate = true
}

function materialBeforeRender({target, object, renderer}:{object?: Object3D, renderer?: WebGLRenderer, target: IMaterial}) {
    const material = target
    if (!material || !object || !renderer) throw new Error('Invalid material, object or renderer')
    if (!material.materialExtensions) return
    for (const value of material.materialExtensions) {
        value.onObjectRender?.(object, material, renderer)

        if ((material as any).lastShader) {
            const updater = getOrCall(value.updaters) || []
            for (const v2 of updater) v2 && v2.updateShaderProperties((material as any).lastShader)
        }
        const udVersion: keyof IMaterialUserData = '_' + value.uuid + '_version' as any
        if (value.updateVersion !== material.userData[udVersion]) {
            material.userData[udVersion] = value.updateVersion
            material.needsUpdate = true
        }
    }
}

function materialAfterRender({target, object, renderer}:{object?: Object3D, renderer?: WebGLRenderer, target: IMaterial}) {
    const material = target
    if (!material || !object || !renderer) throw new Error('Invalid material, object or renderer')
    if (!material.materialExtensions) return
    for (const value of material.materialExtensions) {
        value.onAfterRender?.(object, material, renderer)
    }
}


/**
 * Creates a {@link MaterialExtension} with getUiConfig that also caches the config for the material based on uuid
 * @param getUiConfig - function that returns a ui config. make sure its static.
 * @param uuid uuid to use.
 */
export function uiConfigMaterialExtension(getUiConfig: Required<MaterialExtension>['getUiConfig'], uuid?: string) {
    const uuid1 = uuid || generateUUID()
    return {
        uuid: uuid1,

        // todo clean code.
        getUiConfig: material => {
            if (!(material as any).__uiConfigs) (material as any).__uiConfigs = {} as any // todo remove reference sometime after plugin removed
            if ((material as any).__uiConfigs[uuid1]) return (material as any).__uiConfigs[uuid1]
            const config = getUiConfig(material);
            (material as any).__uiConfigs[uuid1] = config
            return config
        },

        isCompatible: () => true,
    } as MaterialExtension
}
