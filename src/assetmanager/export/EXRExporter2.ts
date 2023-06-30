import {WebGLRenderTarget} from 'three'
import {EXRExporter, EXRExporterParseOptions} from 'three/examples/jsm/exporters/EXRExporter.js'
import {IExportParser} from '../IExporter'
import {IRenderTarget} from '../../rendering'

export class EXRExporter2 extends EXRExporter implements IExportParser {
    async parseAsync(obj: IRenderTarget, options: EXRExporterParseOptions): Promise<Blob> {
        if (!obj.renderManager) throw new Error('No renderManager on renderTarget')
        if (obj.isWebGLMultipleRenderTargets) throw new Error('WebGLMultipleRenderTargets not supported')
        const res = this.parse(obj.renderManager.webglRenderer, obj as any as WebGLRenderTarget, options)
        return new Blob([res], {type: 'image/x-exr'})
    }
}
