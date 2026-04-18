import {PlatformIO, WebIO} from '@gltf-transform/core'
import {GLTFSpecGlossinessConverterPluginBase, gltfKhrPbrSpecularGlossinessConverterBase} from './GLTFSpecGlossinessConverterPluginBase'

// Re-export base for CLI consumers
export {GLTFSpecGlossinessConverterPluginBase, gltfKhrPbrSpecularGlossinessConverterBase} from './GLTFSpecGlossinessConverterPluginBase'

/**
 * GLTFSpecGlossinessConverterPlugin
 *
 * Browser-specific plugin that uses WebIO for spec-gloss to metal-rough conversion.
 *
 * To use this plugin, simply add it to the viewer and import a file with specular glossiness materials.
 * If `confirm` is set to true, a confirmation dialog will be shown before the conversion.
 */
export class GLTFSpecGlossinessConverterPlugin extends GLTFSpecGlossinessConverterPluginBase {
    protected _createIO(): PlatformIO {
        return new WebIO()
    }
}

/**
 * @deprecated Use {@link gltfKhrPbrSpecularGlossinessConverterBase} with an IO factory instead.
 */
export const gltfKhrPbrSpecularGlossinessConverter = (confirm?: (s: string)=>Promise<boolean>, extensions?: (typeof import('@gltf-transform/core').Extension)[]) =>
    gltfKhrPbrSpecularGlossinessConverterBase(() => new WebIO(), confirm, extensions)
