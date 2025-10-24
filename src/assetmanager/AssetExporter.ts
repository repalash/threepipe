import {EventDispatcher, WebGLRenderTarget} from 'three'
import {IMaterial, IObject3D, ITexture} from '../core'
import {BlobExt, ExportFileOptions, IAssetExporter, IExporter, IExportWriter} from './IExporter'
import {assetExportHook, AssetExportHooks, EXRExporter2, SimpleJSONExporter, SimpleTextExporter} from './export'
import {IRenderTarget} from '../rendering'
import {Zippable, zipSync} from 'three/examples/jsm/libs/fflate.module.js'

export interface AssetExporterEventMap {
    exporterCreate: {exporter: IExporter, parser: IExportWriter} // todo rename parser to writer
    exportFile: {
        obj: IObject3D|IMaterial|ITexture|IRenderTarget,
        state: 'processing'|'exporting'|'done'|'error',
        progress?: number, // between 0 and 1
        error?: any,
        exportOptions: ExportFileOptions
    }
}

/**
 * Asset Exporter
 *
 * Utility class to export objects, materials, textures, render targets, etc.
 * Used in {@link AssetManager} to export assets.
 * @category Asset Manager
 */
export class AssetExporter extends EventDispatcher<AssetExporterEventMap> implements IAssetExporter {
    readonly exporters: IExporter[] = [
        {ctor: ()=>new SimpleJSONExporter(), ext: ['json']},
        {ctor: ()=>new SimpleTextExporter(), ext: ['txt', 'text']},
        {ctor: ()=>new EXRExporter2(), ext: ['exr']},
        // {ctor: ()=>new EXRExporter2(), ext: ['png', 'jpeg', 'webp']}, // todo
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

    // this can be set from outside to add custom processing during export, apart from the exportFile event
    exportHooks: AssetExportHooks = {}

    constructor() {
        super()

        this.addEventListener('exportFile', (e)=>assetExportHook(e, this.exportHooks))
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
            const ext = processed?.typeExt || processed?.ext
            if (!processed || !ext) {
                console.error(processed, options, obj)
                throw new Error(`AssetExporter - Unable to preprocess before export ${ext}`)
            }
            if (processed.blob) res = processed.blob
            else {
                const writer = this._getWriter(ext)

                this.dispatchEvent({type: 'exportFile', obj, state:'exporting', exportOptions: options})
                res = await writer.parseAsync(processed.obj, {exportExt: processed.ext ?? ext, ...options}) as BlobExt
                res.ext = processed.ext
            }

            res = await this.processAfterExport(res, obj, options)

            this.dispatchEvent({type: 'exportFile', obj, state: 'done', exportOptions: options})

        } catch (e) {
            console.error('AssetExporter: Unable to Export file', obj)
            // console.error(e)
            this.dispatchEvent({type: 'exportFile', obj, state: 'error', error: e, exportOptions: options})
            throw e
            return undefined
        }

        // if (file) (file as any).__imported = res

        return res
    }

    private _createParser(ext: string): IExportWriter {
        const exporter = this.exporters.find(e => e.ext.includes(ext))
        if (!exporter)
            throw new Error(`No exporter found for extension ${ext}`)
        const writer = exporter?.ctor(this, exporter)
        if (!writer) throw new Error(`Unable to create writer for extension ${ext}`)
        this._cachedWriters.push({ext: exporter.ext, parser: writer})
        this.dispatchEvent({type: 'exporterCreate', exporter, parser: writer})
        return writer
    }
    private _cachedWriters: {parser: IExportWriter, ext: string[]}[] = []
    private _getWriter(ext: string): IExportWriter {
        return this._cachedWriters.find(e => e.ext.includes(ext))?.parser ?? this._createParser(ext)
    }

    public async processBeforeExport(obj: IObject3D|IMaterial|ITexture|IRenderTarget, options: ExportFileOptions = {}): Promise<{obj:any, ext:string, typeExt?:string, blob?: BlobExt}|undefined> {
        // if (obj.assetExporterProcessed && !options.forceExporterReprocess) return obj //todo;;;

        switch (obj.assetType) {
        case 'light':
            console.error('AssetExporter: light export not implemented')
            return undefined
        case 'model':
            return {obj, ext: options.exportExt ?? 'glb'}
            // return {obj, ext: 'gltf'}
        case 'material':
            return {obj: matToJson(obj as IMaterial), ext: options.exportExt || (obj as IMaterial).constructor?.TypeSlug, typeExt: 'json'}
        case 'texture':
            return options.exportExt ? {obj, ext: options.exportExt} : {obj: (obj as ITexture).toJSON(), ext: 'json'}
        case 'renderTarget':
            if (!obj.renderManager) return {obj, ext: 'exr'}
            else {
                const mime = (options.exportExt || '' !== '') && options.exportExt !== 'auto' ?
                    options.exportExt === 'exr' ? 'image/x-exr' : 'image/' + options.exportExt : 'auto'

                let blob
                if (obj.textures.length > 1) {
                    const zippa: Zippable = {}
                    for (let i = 0; i < obj.textures.length; i++) {
                        const expBlob = obj.renderManager!.exportRenderTarget(obj as WebGLRenderTarget, mime, i)
                        // zippa[(f as File).name] = new Uint8Array(await (f as File).arrayBuffer())
                        zippa[`texture_${i}.${expBlob.ext}`] = new Uint8Array(expBlob.__buffer || await expBlob.arrayBuffer())
                    }
                    const zipped = zipSync(zippa)
                    blob = new Blob([zipped], {type: 'application/zip'}) as any as BlobExt
                    blob.ext = 'zip'
                    blob.__buffer = zipped.buffer
                } else {
                    blob = obj.renderManager.exportRenderTarget(obj as WebGLRenderTarget, mime)
                }
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

    public async processAfterExport(blob: BlobExt, _obj: IObject3D|IMaterial|ITexture|IRenderTarget, _options: ExportFileOptions = {}): Promise<BlobExt> {
        return blob
    }

    dispose(): void {
        // todo
    }
}

export function matToJson(mat: IMaterial) {
    const json = mat.toJSON()
    return json
}
