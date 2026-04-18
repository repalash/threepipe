import {WebIO} from '@gltf-transform/core'
import type {EncoderOptions} from '@gltf-transform/extensions/dist/khr-draco-mesh-compression/encoder'
import {DRACOLoader2} from 'threepipe'
import {GLTFDracoExporterBase} from './GLTFDracoExporterBase'

// Re-export everything from base so existing imports keep working
export {GLTFDracoExporterBase, GLTFViewerConfigExtensionGP, createGenericExtensionClass} from './GLTFDracoExporterBase'

/**
 * GLTF Draco Exporter
 *
 * Browser-specific extension of GLTFDracoExporterBase that uses WebIO.
 */
export class GLTFDracoExporter extends GLTFDracoExporterBase {
    constructor(encoderOptions?: EncoderOptions, loader?: DRACOLoader2) {
        super(new WebIO(), encoderOptions, loader)
    }
}
