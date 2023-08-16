import {BaseEvent, EventDispatcher, WebGLRenderTarget} from 'three'
import {IMaterial, IObject3D, ITexture} from '../core'
import {BlobExt, ExportFileOptions, IAssetExporter, IExporter, IExportParser} from './IExporter'
import {EXRExporter2, SimpleJSONExporter, SimpleTextExporter} from './export'
import {IRenderTarget} from '../rendering'

/**
 * Asset Exporter
 *
 * Utility class to export objects, materials, textures, render targets, etc.
 * Used in {@link AssetManager} to export assets.
 * @category Asset Manager
 */
export class AssetExporter extends EventDispatcher<BaseEvent, 'exporterCreate' | 'exportFile'> implements IAssetExporter {
    readonly exporters: IExporter[] = [
        {ctor: ()=>new SimpleJSONExporter(), ext: ['json']},
        {ctor: ()=>new SimpleTextExporter(), ext: ['txt', 'text']},
        {ctor: ()=>new EXRExporter2(), ext: ['exr']},
        // {ctor: ()=>new GLTFDracoExporter(), ext: ['gltf', 'glb']},
    ]

    addExporter(...exporters: IExporter[]) {
        for (const exporter of exporters) {
            if (this.exporters.includes(exporter)) {
                console.warn('Exporter already added', exporter)
                return
            }
            this.exporters.push(exporter)
        }
    }
    removeExporter(...exporters: IExporter[]) {
        for (const exporter of exporters) {
            const i = this.exporters.indexOf(exporter)
            if (i >= 0) this.exporters.splice(i, 1)
        }
    }

    getExporter(...ext: string[]): IExporter|undefined {
        return this.exporters.find(e=>e.ext.some(e1=>ext.includes(e1)))
    }

    constructor() {
        super()
    }

    public async exportObject(obj?: IObject3D|IMaterial|ITexture|IRenderTarget, options: ExportFileOptions = {}): Promise<BlobExt|undefined> {
        if (!obj?.assetType) {
            console.error('Object has no asset type')
            return undefined
        }
        const excluded: IObject3D[] = []
        if (obj.assetType === 'model') {
            obj.traverse((o)=>{
                if (o.userData.excludeFromExport && o.visible) {
                    o.visible = false
                    excluded.push(o)
                }
            })
        }
        const blob = await this._exportFile(obj, options)
        if (obj.assetType === 'model') {
            excluded.forEach((o: any)=>o.visible = true)
        }
        if ((obj as any)?.userData?.rootSceneModelRoot && options.viewerConfig === false) {
            delete (obj as any)!.userData!.__exportViewerConfig
        }
        return blob
    }

    // export to blob
    private async _exportFile(obj: IObject3D|IMaterial|ITexture|IRenderTarget, options: ExportFileOptions = {}): Promise<BlobExt|undefined> {
        // if ((file as any)?.__imported) return (file as any).__imported // todo: cache exports?

        let res: BlobExt
        try {
            this.dispatchEvent({type: 'exportFile', obj, state:'processing', exportOptions: options})

            const processed = await this.processBeforeExport(obj, options)
            const ext = options.exportExt || processed?.typeExt || processed?.ext
            if (!processed || !ext) {
                console.error(processed, options, obj)
                throw new Error(`Unable to preprocess before export ${ext}`)
            }
            if (processed.blob) res = processed.blob
            else {
                const parser = this._getParser(ext)

                this.dispatchEvent({type: 'exportFile', obj, state:'exporting'})
                res = await parser.parseAsync(processed.obj, {exportExt: processed.ext ?? ext, ...options}) as BlobExt
                res.ext = processed.ext
            }

            this.dispatchEvent({type: 'exportFile', obj, state: 'done'})

        } catch (e) {
            console.error('AssetExporter: Unable to Export file', obj)
            // console.error(e)
            this.dispatchEvent({type: 'exportFile', obj, state: 'error', error: e})
            throw e
            return undefined
        }

        // if (file) (file as any).__imported = res

        return res
    }

    private _createParser(ext: string): IExportParser {
        const exporter = this.exporters.find(e => e.ext.includes(ext))
        if (!exporter)
            throw new Error(`No exporter found for extension ${ext}`)
        const parser = exporter?.ctor(this, exporter)
        if (!parser) throw new Error(`Unable to create parser for extension ${ext}`)
        this._cachedParsers.push({ext: exporter.ext, parser})
        this.dispatchEvent({type: 'exporterCreate', exporter, parser})
        return parser
    }
    private _cachedParsers: {parser: IExportParser, ext: string[]}[] = []
    private _getParser(ext: string): IExportParser {
        return this._cachedParsers.find(e => e.ext.includes(ext))?.parser ?? this._createParser(ext)
    }

    public async processBeforeExport(obj: IObject3D|IMaterial|ITexture|IRenderTarget, options: ExportFileOptions = {}): Promise<{obj:any, ext:string, typeExt?:string, blob?: BlobExt}|undefined> {
        // if (obj.assetExporterProcessed && !options.forceExporterReprocess) return obj //todo;;;

        switch (obj.assetType) {
        case 'light':
            console.error('AssetExporter: light export not implemented')
            return undefined
        case 'model':
            return {obj, ext: 'glb'}
            // return {obj, ext: 'gltf'}
        case 'material':
            return {obj: (obj as IMaterial).toJSON(), ext: (obj as IMaterial).constructor?.TypeSlug || 'json', typeExt: 'json'}
        case 'texture':
            return options.exportExt ? {obj, ext: options.exportExt} : {obj: (obj as ITexture).toJSON(), ext: 'json'}
        case 'renderTarget':
            if (obj.isWebGLMultipleRenderTargets) console.error('AssetExporter: WebGLMultipleRenderTargets export not supported')
            else if (!obj.renderManager) return {obj, ext: 'exr'}
            else {
                const blob = obj.renderManager.exportRenderTarget(obj as WebGLRenderTarget,
                    (options.exportExt || '' !== '') && options.exportExt !== 'auto' ?
                        options.exportExt === 'exr' ? 'image/x-exr' : 'image/' + options.exportExt : 'auto')
                return {
                    obj, ext: blob.ext, blob,
                }
            }
            break
        default:
            console.error('AssetExporter: unknown asset type', obj.assetType)
        }
        return undefined
    }

    dispose(): void {
        // todo
    }


}
