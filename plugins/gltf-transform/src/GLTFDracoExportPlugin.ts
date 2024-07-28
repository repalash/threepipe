import {
    AssetExporterPlugin,
    AViewerPluginSync,
    ClearcoatTintPlugin,
    CustomBumpMapPlugin,
    DRACOLoader2,
    generateUUID,
    GLTFLightExtrasExtension,
    GLTFMaterialExtrasExtension,
    GLTFMaterialsAlphaMapExtension,
    GLTFMaterialsBumpMapExtension,
    GLTFMaterialsDisplacementMapExtension,
    GLTFMaterialsLightMapExtension,
    GLTFObject3DExtrasExtension,
    NoiseBumpMaterialPlugin,
    ThreeViewer,
} from 'threepipe'
import {GLTFDracoExporter} from './GLTFDracoExporter'
import {UiObjectConfig} from 'uiconfig.js'
import {EncoderOptions} from '@gltf-transform/extensions/dist/khr-draco-mesh-compression/encoder'

export enum EncoderMethod {
    EDGEBREAKER = 1,
    SEQUENTIAL = 0
}

/**
 * GLTF Draco Export Plugin
 *
 * Overloads the default gltf exporter in the asset manager with GLTFDracoExporter. When exporting with compress = true, the output will be compressed.
 * Note - Only `glb` supported right now.
 *
 * @category Plugins
 */
export class GLTFDracoExportPlugin extends AViewerPluginSync<''> {
    public static readonly PluginType = 'GLTFDracoExportPlugin'
    enabled = true

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        const importer = viewer.assetManager.importer
        const exporter = viewer.assetManager.exporter

        const glbExporter = exporter.getExporter('glb')
        if (glbExporter) exporter.removeExporter(glbExporter)

        // todo remove exporter and add back the old one on plugin remove.
        exporter.addExporter({
            ...glbExporter || {
                ext: ['glb', 'gltf'],
                extensions: [],
            }, // for extensions
            ctor: (_, _exporter) => {
                const tempFile = generateUUID() + '.drc' // dummy
                const ex = new GLTFDracoExporter({},
                    // todo unregister on dispose
                    importer.registerFile(tempFile) as DRACOLoader2)
                ex.setup(viewer, _exporter.extensions)
                ex.createAndAddExtension(GLTFMaterialsBumpMapExtension.WebGiMaterialsBumpMapExtension, {
                    bumpTexture: 'R',
                })
                ex.createAndAddExtension(GLTFMaterialsLightMapExtension.WebGiMaterialsLightMapExtension, {
                    lightMapTexture: 'RGB',
                })
                ex.createAndAddExtension(GLTFMaterialsAlphaMapExtension.WebGiMaterialsAlphaMapExtension, {
                    alphaTexture: 'G',
                })
                ex.createAndAddExtension(GLTFMaterialsDisplacementMapExtension.WebGiMaterialsDisplacementMapExtension, {
                    displacementTexture: 'R',
                })
                ex.createAndAddExtension(CustomBumpMapPlugin.CUSTOM_BUMP_MAP_GLTF_EXTENSION, {
                    customBumpMap: 'RGB',
                })
                ex.createAndAddExtension(GLTFLightExtrasExtension.WebGiLightExtrasExtension)
                ex.createAndAddExtension(GLTFObject3DExtrasExtension.WebGiObject3DExtrasExtension)
                ex.createAndAddExtension(GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension)
                ex.createAndAddExtension(ClearcoatTintPlugin.CLEARCOAT_TINT_GLTF_EXTENSION)
                ex.createAndAddExtension(NoiseBumpMaterialPlugin.NOISE_BUMP_MATERIAL_GLTF_EXTENSION)
                // todo port
                // DiamondMaterialExtension
                // AnimationMarkersExtension
                // AnisotropyMaterialExtension
                // ThinFilmLayerMaterialExtension
                // TriplanarMappingMaterialExtension
                // SSBevelMaterialExtension
                return ex
            },
        })

        // for ui
        const exportPlugin = viewer.getPlugin(AssetExporterPlugin)
        if (exportPlugin) {
            Object.assign(exportPlugin.exportOptions, {
                compress: false,
                dracoOptions: {
                    encodeSpeed: 5,
                    method: EncoderMethod.EDGEBREAKER,
                    quantizationVolume: 'mesh',
                    quantizationBits: {
                        ['POSITION']: 14,
                        ['NORMAL']: 10,
                        ['COLOR']: 8,
                        ['TEX_COORD']: 12,
                        ['GENERIC']: 12,
                    },
                } as EncoderOptions,
            })
            const exportOptions = exportPlugin.uiConfig.children?.find(c => (c as UiObjectConfig).label === 'GLB Export') as UiObjectConfig
            if (exportOptions) {
                exportOptions.children = [this._makeUi(exportPlugin), ...exportOptions.children || []]
            } else {
                console.warn('GLTFDracoExportPlugin: Unable to setup UI')
            }
        }
    }

    protected _makeUi = (exporter: AssetExporterPlugin)=>[
        {
            type: 'checkbox',
            label: 'DRACO Compress',
            property: [exporter.exportOptions, 'compress'],
            onChange: ()=>exporter.uiConfig.uiRefresh?.(true),
        },
        {
            type: 'folder',
            hidden: ()=>!exporter.exportOptions.compress,
            label: 'DRACO Options',
            children: [
                {
                    type: 'slider',
                    label: 'Encode Speed',
                    bounds: [1, 10],
                    property: [exporter.exportOptions.dracoOptions, 'encodeSpeed'],
                },
                {
                    type: 'dropdown',
                    label: 'Encoder Method',
                    property: [exporter.exportOptions.dracoOptions, 'method'],
                    children: Object.entries(EncoderMethod).map(([k, v]) => ({label: k, value: v})),
                },
                {
                    type: 'dropdown',
                    label: 'Quantization Volume',
                    property: [exporter.exportOptions.dracoOptions, 'quantizationVolume'],
                    children: ['mesh', 'scene', 'bbox'].map(v => ({label: v})),
                },
                {
                    type: 'folder',
                    label: 'Quantization Bits',
                    children: Object.keys(exporter.exportOptions.dracoOptions?.quantizationBits || {}).map(k => ({
                        type: 'slider',
                        label: k,
                        bounds: [1, 16],
                        stepSize: 1,
                        property: [exporter.exportOptions.dracoOptions?.quantizationBits, k],
                    })),
                },
            ],
        },
    ]
}
