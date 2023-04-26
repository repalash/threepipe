import {AnyOptions, IEventDispatcher} from 'ts-browser-helpers'
import {IObject3D} from '../core'
import {GLTFExporter2Options} from './export/GLTFExporter2'

export type BlobExt = Blob&{ext:string}

export interface IExportParser {
    // parse(obj: any, options: AnyOptions): any;
    parseAsync(obj: any, options: AnyOptions): Promise<Blob>
}
export interface IExporter {
    extensions?: any[]
    ext: string[];
    ctor: (assetExporter: IAssetExporter, exporter: IExporter)=>IExportParser|undefined;
}

export type ExportFileOptions = {
    /**
     * Extension to export to, default for object/scene = glb, default for viewerConfig = json, default for material = mat, otherwise determined by exporter
     */
    exportExt?: string,
    /**
     * Export the viewer config (scene settings).
     * only works for rootSceneModelRoot. default = true
     */
    viewerConfig?: boolean,
} & GLTFExporter2Options & AnyOptions

export interface IAssetExporter extends IEventDispatcher<'exportFile' | 'exporterCreate'>{
    getExporter(...ext: string[]): IExporter|undefined
    exportObject(obj?: IObject3D, options?: ExportFileOptions): Promise<BlobExt|undefined>
    // processors: ObjectProcessorMap<TAssetTypes>
}
