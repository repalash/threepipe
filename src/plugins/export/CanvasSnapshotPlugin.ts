import {serialize, timeout} from 'ts-browser-helpers'
import {AViewerPluginSync} from '../../viewer'
import {uiButton, uiConfig, uiFolderContainer, uiInput} from 'uiconfig.js'
import {CanvasSnapshot, CanvasSnapshotOptions} from '../../utils/canvas-snapshot'
import {ProgressivePlugin} from '../pipeline/ProgressivePlugin'

@uiFolderContainer('Canvas Snapshot (Image Export)')
export class CanvasSnapshotPlugin extends AViewerPluginSync<''> {
    static readonly PluginType = 'CanvasSnapshotPlugin'
    enabled = true

    constructor() {
        super()
        this.downloadSnapshot = this.downloadSnapshot.bind(this)
    }

    /**
     * Returns a File object with screenshot of the viewer canvas
     * @param filename default is {@link CanvasSnapshotPlugin.filename}
     * @param options waitForProgressive: wait for progressive rendering to finish, default: true
     */
    async getFile(filename?: string, options: CanvasSnapshotOptions&{waitForProgressive?: boolean} = {waitForProgressive: true}): Promise<File|undefined> {
        options.getDataUrl = false
        return await this._getFile(filename || this.filename, options) as File
    }

    /**
     * Returns a data url of the screenshot of the viewer canvas
     * @param options waitForProgressive: wait for progressive rendering to finish, default: true
     */
    async getDataUrl(options: CanvasSnapshotOptions&{waitForProgressive?: boolean} = {}): Promise<string> {
        options.getDataUrl = true
        return await this._getFile('', options) as string ?? ''
    }

    private async _getFile(filename: string, options: CanvasSnapshotOptions&{waitForProgressive?: boolean} = {}): Promise<File|string|undefined> {
        const viewer = this._viewer
        const canvas = this._viewer?.canvas
        if (!viewer || !canvas) return undefined
        const dpr = viewer.renderManager.renderScale
        if (options.displayPixelRatio !== undefined && options.displayPixelRatio !== dpr) {
            viewer.renderManager.renderScale = options.displayPixelRatio
        }
        if (options.timeout) await timeout(options.timeout)
        const progressive = viewer.getPlugin(ProgressivePlugin)
        if (options.waitForProgressive !== false && progressive) {
            // todo: disable interactions and all so that frameCount is not affected
            await new Promise<void>((res)=>{
                const listener = () => {
                    if (!progressive.isConverged(true)) return
                    viewer.removeEventListener('postFrame', listener)
                    res()
                }
                viewer.addEventListener('postFrame', listener)
            })
        } else await viewer.doOnce('postFrame')
        options.displayPixelRatio = 1
        const rect = options.rect
        if (rect && viewer.renderManager.renderScale !== 1) {
            options.rect = {
                ...rect,
                x: rect.x * viewer.renderManager.renderScale,
                y: rect.y * viewer.renderManager.renderScale,
                width: rect.width * viewer.renderManager.renderScale,
                height: rect.height * viewer.renderManager.renderScale,
            }
        }
        const file = await CanvasSnapshot.GetFile(canvas, filename, options)
        options.rect = rect
        options.displayPixelRatio = viewer.renderManager.renderScale
        viewer.renderManager.renderScale = dpr
        return file
    }

    @uiInput('Filename')
    @serialize()
        filename = 'snapshot.png'

    /**
     * Only for {@link downloadSnapshot} and functions using that
     */
    @uiConfig()
    @serialize()
        defaultOptions: CanvasSnapshotOptions&{waitForProgressive?: boolean} = {
            waitForProgressive: true,
            displayPixelRatio: window.devicePixelRatio,
            scale: 1,
            timeout: 0,
            quality: 0.9,
        }

    @uiButton('Download .png')
    async downloadSnapshot(filename?: string, options: CanvasSnapshotOptions&{waitForProgressive?: boolean} = {waitForProgressive: true}): Promise<void> {
        if (!this._viewer) return
        if (!options.mimeType && !filename) this.filename = this.filename.split('.').slice(0, -1).join('.') + '.png'
        const file = await this.getFile(filename, {...this.defaultOptions, ...options})
        if (file) await this._viewer.exportBlob(file, file.name)
    }

    @uiButton('Download .jpeg')
    protected async _downloadJpeg(): Promise<void> {
        this.filename = this.filename.split('.').slice(0, -1).join('.') + '.jpeg'
        return this.downloadSnapshot(undefined, {mimeType: 'image/jpeg'})
    }
    @uiButton('Download .webp')
    protected async _downloadWebp(): Promise<void> {
        this.filename = this.filename.split('.').slice(0, -1).join('.') + '.webp'
        return this.downloadSnapshot(undefined, {mimeType: 'image/webp'})
    }

}

/**
 * @deprecated - use {@link CanvasSnapshotPlugin}
 */
export class CanvasSnipperPlugin extends CanvasSnapshotPlugin {
    static readonly PluginType: any = 'CanvasSnipper'
    constructor() {
        super()
        console.warn('CanvasSnipperPlugin is deprecated, use CanvasSnapshotPlugin')
    }
}
