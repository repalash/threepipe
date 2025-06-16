import {DataTexture, WebGLRenderTarget} from 'three'
import {EXRExporter, EXRExporterParseOptions} from 'three/examples/jsm/exporters/EXRExporter.js'
import {IExportWriter} from '../IExporter'
import {IRenderTarget} from '../../rendering'

export class EXRExporter2 extends EXRExporter implements IExportWriter {
    async parseAsync(obj: IRenderTarget|DataTexture, options: EXRExporterParseOptions): Promise<Blob> {
        const target = <IRenderTarget>obj
        if (target.isWebGLRenderTarget && !target.renderManager) throw new Error('No renderManager on renderTarget')
        if (!target.isWebGLRenderTarget && !(<DataTexture>obj).isDataTexture) throw new Error('Invalid object type')
        if (target.isWebGLMultipleRenderTargets && options.textureIndex === undefined)
            console.warn('No textureIndex specified for WebGLMultipleRenderTargets')
        const res = target.isWebGLRenderTarget ?
            this.parse(target.renderManager!.webglRenderer, <WebGLRenderTarget>target, options) :
            this.parse(<DataTexture>obj, options)
        return new Blob([res], {type: 'image/x-exr'})
    }
}
