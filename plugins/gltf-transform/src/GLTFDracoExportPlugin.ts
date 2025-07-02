import {
    AssetExporterPlugin,
    AViewerPluginSync,
    DRACOLoader2,
    generateUUID,
    GLTFLightExtrasExtension,
    GLTFMaterialExtrasExtension,
    GLTFMaterialsAlphaMapExtension,
    GLTFMaterialsBumpMapExtension,
    GLTFMaterialsDisplacementMapExtension,
    GLTFMaterialsLightMapExtension,
    GLTFObject3DExtrasExtension,
    IExporter,
    ThreeViewer,
    clearCoatTintGLTFExtension,
    customBumpMapGLTFExtension,
    noiseBumpMaterialGLTFExtension,
    fragmentClippingGLTFExtension,
} from 'threepipe'
import {
    createGenericExtensionClass,
    GLTFDracoExporter,
    GLTFViewerConfigExtensionGP,
} from './GLTFDracoExporter'
import {UiObjectConfig} from 'uiconfig.js'
import {EncoderOptions} from '@gltf-transform/extensions/dist/khr-draco-mesh-compression/encoder'
import {Extension} from '@gltf-transform/core'

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
export class GLTFDracoExportPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'GLTFDracoExportPlugin'
    enabled = true

    /**
     * These are added here, but also added as plugins. Added here by default so that the data is not lost if some plugin is not added in an app.
     * To explicitly remove the data, use `removeExtension` with the name of the extension
     */
    extraExtensions = [ // its array because we want to keep the order of extensions
        [GLTFMaterialsBumpMapExtension.WebGiMaterialsBumpMapExtension, GLTFMaterialsBumpMapExtension.Textures],
        [GLTFMaterialsLightMapExtension.WebGiMaterialsLightMapExtension, GLTFMaterialsLightMapExtension.Textures],
        [GLTFMaterialsAlphaMapExtension.WebGiMaterialsAlphaMapExtension, GLTFMaterialsAlphaMapExtension.Textures],
        [GLTFMaterialsDisplacementMapExtension.WebGiMaterialsDisplacementMapExtension, GLTFMaterialsDisplacementMapExtension.Textures],
        [customBumpMapGLTFExtension.name, customBumpMapGLTFExtension.textures],
        [GLTFLightExtrasExtension.WebGiLightExtrasExtension, GLTFLightExtrasExtension.Textures],
        [GLTFObject3DExtrasExtension.WebGiObject3DExtrasExtension, GLTFObject3DExtrasExtension.Textures],
        [GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension, GLTFMaterialExtrasExtension.Textures],
        [clearCoatTintGLTFExtension.name, clearCoatTintGLTFExtension.textures],
        [noiseBumpMaterialGLTFExtension.name, noiseBumpMaterialGLTFExtension.textures],
        [fragmentClippingGLTFExtension.name, fragmentClippingGLTFExtension.textures],

        // extenal plugins

        // AnisotropyMaterialExtension
        ['WEBGI_materials_anisotropy', {
            anisotropyDirection: 'RGB',
        }],
        // todo port
        // DiamondMaterialExtension
        // AnimationMarkersExtension
        // ThinFilmLayerMaterialExtension
        // TriplanarMappingMaterialExtension
        // SSBevelMaterialExtension
    ] as [string, Record<string, string|number>|undefined][]

    get gltfTransformExtensions(): (typeof Extension)[] {
        return [GLTFViewerConfigExtensionGP, ...this.extraExtensions.map(e => createGenericExtensionClass(e[0], e[1]))]
    }

    addExtension(name: string, textures?: Record<string, string|number>) {
        const ext = this.extraExtensions.findIndex(e => e[0] === name)
        if (ext >= 0) this.extraExtensions[ext] = [name, textures]
        else this.extraExtensions.push([name, textures])
    }

    /**
     * Note - don't remove an extension when removing a plugin.
     *
     * extensions can be removed if you don't want to save the data of some plugin when transforming glb. But since this is not desirable in most cases, it is not recommended.
     * @param name
     */
    removeExtension(name: string) {
        const ext = this.extraExtensions.findIndex(e => e[0] === name)
        if (ext >= 0) this.extraExtensions.splice(ext, 1)
    }

    private _lastExporter?: IExporter['ctor'] = undefined

    protected _ctor: IExporter['ctor'] = (_, _exporter) => {
        if (!this._viewer) throw new Error('Viewer not set')
        const tempFile = generateUUID() + '.drc' // dummy
        const ex = new GLTFDracoExporter({},
            // todo unregister on dispose
            this._viewer.assetManager.importer.registerFile(tempFile) as DRACOLoader2)
        ex.setup(this._viewer, _exporter.extensions)
        ex.addExtension(...this.gltfTransformExtensions)
        return ex
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        const exporter = viewer.assetManager.exporter

        let glbExporter = exporter.getExporter('glb')
        this._lastExporter = glbExporter?.ctor
        if (!glbExporter) {
            console.error('GLTFDracoExportPlugin: GLB exporter not found in AssetManager.exporter, creating a new one.')
            glbExporter = {
                ext: ['glb', 'gltf'],
                extensions: [],
                ctor: this._ctor,
            }
            exporter.addExporter(glbExporter)
        } else {
            glbExporter.ctor = this._ctor
        }

        // for ui. todo use viewer.forPlugin
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

    onRemove(viewer: ThreeViewer) {
        const exporter = viewer.assetManager.exporter
        const glbExporter = exporter.getExporter('glb')
        if (glbExporter && this._lastExporter) {
            glbExporter.ctor = this._lastExporter
        }
        super.onRemove(viewer)
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
