import {serialize} from 'ts-browser-helpers'
import {BlobExt, ExportFileOptions} from '../../assetmanager'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {UiObjectConfig} from 'uiconfig.js'
import {PickingPlugin} from '../interaction/PickingPlugin'

// export enum EncoderMethod {
//     EDGEBREAKER = 1,
//     SEQUENTIAL = 0
// }

export interface ExportAssetOptions extends ExportFileOptions {
    convertMeshToIndexed?: boolean // convert mesh to indexed geometry
    name?: string
    compress?: boolean,
}

// todo deprecate the plugin and add functionality to AssetManager maybe
/**
 * Asset Exporter Plugin
 * Provides options and methods to export the scene, object GLB or Viewer Config.
 * All the functionality is available in the viewer directly, this provides only a ui-config and maintains state of the options.
 */
export class AssetExporterPlugin extends AViewerPluginSync<''> {
    public static readonly PluginType = 'AssetExporterPlugin'
    enabled = true

    constructor() {
        super()
        this.exportScene = this.exportScene.bind(this)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // todo Convert all non-indexed geometries to indexed geometries, because DRACO compression requires indexed geometry.
        // this.exporter.processors.add('model', {
        //     forAssetType: 'model',
        //     processAsync: async(obj: IObject3D, options) => {
        //         if (options.convertMeshToIndexed)
        //             obj?.traverse((o: IObject3D)=>{
        //                 if (!o.geometry) return
        //                 if (o.geometry.attributes.index) return
        //                 o.geometry = toIndexedGeometry(o.geometry)
        //             })
        //         return obj
        //     },
        // })
    }

    onRemove(viewer: ThreeViewer) {
        return super.onRemove(viewer)
    }

    @serialize() exportOptions: ExportAssetOptions = {
        name: 'scene',
        viewerConfig: true,
        encodeUint16Rgbe: false,
        convertMeshToIndexed: false,
        embedUrlImagePreviews: false,
        embedUrlImages: false,
        // compress: false,
        // dracoOptions: {
        //     encodeSpeed: 5,
        //     method: EncoderMethod.EDGEBREAKER,
        //     quantizationVolume: 'mesh',
        //     quantizationBits: {
        //         ['POSITION']: 14,
        //         ['NORMAL']: 10,
        //         ['COLOR']: 8,
        //         ['TEX_COORD']: 12,
        //         ['GENERIC']: 12,
        //     },
        // } as EncoderOptions,
        encrypt: false,
        encryptKey: '',
    }

    async exportScene(options?: ExportAssetOptions): Promise<BlobExt | undefined> {
        return this._viewer?.assetManager.exporter?.exportObject(this._viewer?.scene.modelRoot, options || {...this.exportOptions})
    }

    async downloadSceneGlb() {
        const blob = await this.exportScene(this.exportOptions)
        if (blob) await this._viewer?.exportBlob(blob, this.exportOptions.name + '.' + blob.ext)
    }

    async exportSelected(options?: ExportAssetOptions, download = true) {
        const selected = this._viewer?.getPlugin<PickingPlugin>('PickingPlugin')?.getSelectedObject() as any
        if (!selected) {
            alert('Nothing selected')
            return
        }
        const blob = await this._viewer!.assetManager.exporter.exportObject(selected, options ?? this.exportOptions)
        if (blob && download) await this._viewer?.exportBlob(blob, 'object.' + blob.ext)
        return blob
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Asset Export',
        children: [
            {
                type: 'input',
                property: [this.exportOptions, 'name'],
            },
            {
                type: 'folder',
                label: 'GLB Export',
                children: [
                    // compress ? {
                    //     type: 'checkbox',
                    //     label: 'DRACO Compress',
                    //     property: [this.exportOptions, 'compress'],
                    //     onChange: ()=>this.uiConfig.uiRefresh?.(true),
                    // } : {},
                    // compress && this.exportOptions.dracoOptions ? {
                    //     type: 'folder',
                    //     hidden: ()=>!this.exportOptions.compress,
                    //     label: 'DRACO Options',
                    //     children: [
                    //         {
                    //             type: 'slider',
                    //             label: 'Encode Speed',
                    //             bounds: [1, 10],
                    //             property: [this.exportOptions.dracoOptions, 'encodeSpeed'],
                    //         },
                    //         {
                    //             type: 'dropdown',
                    //             label: 'Encoder Method',
                    //             property: [this.exportOptions.dracoOptions, 'method'],
                    //             children: Object.entries(EncoderMethod).map(([k, v]) => ({label: k, value: v})),
                    //         },
                    //         {
                    //             type: 'dropdown',
                    //             label: 'Quantization Volume',
                    //             property: [this.exportOptions.dracoOptions, 'quantizationVolume'],
                    //             children: ['mesh', 'scene', 'bbox'].map(v => ({label: v})),
                    //         },
                    //         {
                    //             type: 'folder',
                    //             label: 'Quantization Bits',
                    //             children: Object.keys(this.exportOptions.dracoOptions.quantizationBits!).map(k => ({
                    //                 type: 'slider',
                    //                 label: k,
                    //                 bounds: [1, 16],
                    //                 stepSize: 1,
                    //                 property: [this.exportOptions.dracoOptions.quantizationBits, k],
                    //             })),
                    //         },
                    //     ],
                    // } : {},
                    {
                        type: 'checkbox',
                        label: 'Viewer Config (All Settings)',
                        property: [this.exportOptions, 'viewerConfig'],
                        onChange: ()=>this.uiConfig.uiRefresh?.(true),
                    },
                    {
                        type: 'checkbox',
                        label: 'Embed Image Previews',
                        property: [this.exportOptions, 'embedUrlImagePreviews'],
                    },
                    {
                        type: 'checkbox',
                        label: 'Encrypt',
                        property: [this.exportOptions, 'encrypt'],
                        onChange: ()=>this.uiConfig.uiRefresh?.(true),
                    },
                    {
                        type: 'checkbox',
                        label: 'Encrypt Password',
                        hidden: ()=>!this.exportOptions.encrypt,
                        property: [this.exportOptions, 'encryptKey'],
                    },
                    {
                        type: 'checkbox',
                        label: 'Compress hdr env maps',
                        hidden: ()=>!this.exportOptions.viewerConfig,
                        property: [this.exportOptions, 'encodeUint16Rgbe'],
                    },
                    // { // todo
                    //     type: 'checkbox',
                    //     label: 'Convert to indexed',
                    //     property: [this.exportOptions, 'convertMeshToIndexed'],
                    // },
                    {
                        type: 'button',
                        label: 'Export GLB',
                        property: [this, 'downloadSceneGlb'],
                    },
                ],
            },
            {
                type: 'button',
                label: 'Export Viewer Config',
                value: async()=>{
                    const blob = new Blob([JSON.stringify(this._viewer?.exportConfig(false), null, 2)], {type: 'application/json'})
                    if (blob) await this._viewer?.exportBlob(blob, this.exportOptions.name + '.' + ThreeViewer.ConfigTypeSlug)
                },
            },
            {
                type: 'button',
                label: 'Export Selected',
                hidden: ()=>!this._viewer?.getPlugin<PickingPlugin>('PickingPlugin'),
                value: async()=>this.exportSelected(this.exportOptions, true),
            },
        ],
    }
}
