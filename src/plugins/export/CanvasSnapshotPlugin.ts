import {serialize, timeout} from 'ts-browser-helpers'
import {AViewerPluginSync} from '../../viewer'
import {uiButton, uiConfig, uiFolderContainer, uiInput} from 'uiconfig.js'
import {CanvasSnapshot, CanvasSnapshotOptions} from '../../utils/canvas-snapshot'
import {ProgressivePlugin} from '../pipeline/ProgressivePlugin'
import {Zippable, zipSync} from 'three/examples/jsm/libs/fflate.module.js'

export interface CanvasSnapshotPluginOptions extends CanvasSnapshotOptions{
    /**
     * If true, will wait for progressive rendering(requires {@link ProgressivePlugin}) to finish before taking snapshot
     * @default true
     */
    waitForProgressive?: boolean
    /**
     * Number of progressive frames to wait for before taking snapshot
     @default 64 or {@link ProgressivePlugin.maxFrameCount}, whichever is higher
     */
    progressiveFrames?: number
    /**
     * Time in ms to wait before taking the snapshot.
     * This timeout is applied before `waitForProgressive` if both are specified.
     */
    timeout?: number,
    /**
     * Number of tile rows to split the image into
     * @default 1
     */
    tileRows?: number
    /**
     * Number of tile columns to split the image into
     */
    tileColumns?: number
}

@uiFolderContainer('Image Export (Canvas Snapshot)')
export class CanvasSnapshotPlugin extends AViewerPluginSync {
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
    async getFile(filename?: string, options: CanvasSnapshotPluginOptions = {waitForProgressive: true}): Promise<File|undefined> {
        return await this._getFile(filename || this.filename, {...options, getDataUrl: false}) as File
    }

    /**
     * Returns a data url of the screenshot of the viewer canvas
     * @param options waitForProgressive: wait for progressive rendering to finish, default: true
     */
    async getDataUrl(options: CanvasSnapshotPluginOptions = {}): Promise<string> {
        return await this._getFile('', {...options, getDataUrl: true}) as string ?? ''
    }

    private async _getFile(filename: string, options: CanvasSnapshotPluginOptions = {}): Promise<File|string|string[]|undefined> {
        await this._viewer?.doOnce('postFrame')
        const viewer = this._viewer
        const canvas = this._viewer?.canvas
        if (!viewer || !canvas) return undefined
        viewer.scene.mainCamera.setInteractions(false, CanvasSnapshotPlugin.PluginType)

        const dpr = viewer.renderManager.renderScale
        if (options.displayPixelRatio !== undefined && options.displayPixelRatio !== dpr) {
            viewer.renderManager.renderScale = options.displayPixelRatio
        }
        if (options.timeout) await timeout(options.timeout)

        const progressive = viewer.getPlugin(ProgressivePlugin)
        let waitForProgressive = options.waitForProgressive ?? !!progressive
        if (waitForProgressive && !progressive) {
            viewer.console.warn('CanvasSnapshotPlugin: ProgressivePlugin required to wait for progressive rendering')
            waitForProgressive = false
        }
        if (options.progressiveFrames && !waitForProgressive) {
            viewer.console.warn('CanvasSnapshotPlugin: waitForProgressive must be true to use progressiveFrames')
        }
        const lastMaxFrames = progressive?.maxFrameCount

        if (waitForProgressive && progressive) {
            progressive.maxFrameCount = Math.max(options.progressiveFrames ?? 64, progressive.maxFrameCount)
            viewer.setDirty()
            await viewer.doOnce('postFrame')

            while (!progressive.isConverged(true)) {
                await viewer.doOnce('postFrame')
                // console.log(`rendering ${ 100 * this._viewer!.renderer.frameCount / progressive.maxFrameCount }%`)
            }
        } else {
            viewer.setDirty()
            await viewer.doOnce('postFrame')
        }


        delete options.displayPixelRatio
        // const rect = options.rect
        // if (rect && viewer.renderManager.renderScale !== 1) {
        //     options.rect = {
        //         ...rect,
        //         x: rect.x * viewer.renderManager.renderScale,
        //         y: rect.y * viewer.renderManager.renderScale,
        //         width: rect.width * viewer.renderManager.renderScale,
        //         height: rect.height * viewer.renderManager.renderScale,
        //     }
        // }

        let file
        if (options.tileRows && options.tileRows > 1 || options.tileColumns && options.tileColumns > 1) {
            const res = await CanvasSnapshot.GetTiledFiles(canvas, filename, Math.max(1, options.tileRows || 1), Math.max(1, options.tileColumns || 1), options)
            if (Array.isArray(res)) {
                if (res.length === 1) file = res[0]
                else if (res.length === 0) file = undefined
                else if (!options.getDataUrl) {
                    const zippa: Zippable = {}
                    for (const f of res) {
                        zippa[(f as File).name] = new Uint8Array(await (f as File).arrayBuffer())
                    }
                    const zipped = zipSync(zippa)
                    file = new File([zipped], filename + '.zip', {type: 'application/zip', lastModified: Date.now()})
                } else {
                    file = res as string[]
                }
            } else {
                file = res
            }
        } else {
            file = await CanvasSnapshot.GetFile(canvas, filename, options)
        }
        // const file = await CanvasSnapshot.GetFile(canvas, filename, options)

        // options.rect = rect
        options.displayPixelRatio = viewer.renderManager.renderScale
        if (progressive && lastMaxFrames !== undefined) {
            progressive.maxFrameCount = lastMaxFrames
        }
        viewer.scene.mainCamera.setInteractions(true, CanvasSnapshotPlugin.PluginType, false)
        viewer.renderManager.renderScale = dpr

        return file
    }

    @uiInput('Filename')
    @serialize()
        filename = 'snapshot'

    // @uiInput('Frame Count')
    // @serialize()
    //     progressiveFrames = 64
    //
    // @uiInput('Tile Rows')
    // @serialize()
    //     tileRows = 1
    //
    // @uiInput('Tile Columns')
    // @serialize()
    //     tileColumns = 1
    //
    // @uiVector('Crop Rect (x, y, w, h)', [0, 1], 0.001)
    // @serialize()
    //     rect = new Vector4(0, 0, 1, 1)

    private _downloading = false

    /**
     * Only for {@link downloadSnapshot} and functions using that
     */
    @uiConfig(undefined, {label: 'Options'})
    @serialize()
        defaultOptions: CanvasSnapshotPluginOptions = {
            waitForProgressive: true,
            displayPixelRatio: window.devicePixelRatio,
            scale: 1,
            timeout: 0,
            quality: 0.9,
            tileRows: 1,
            tileColumns: 1,
            progressiveFrames: 64,
            rect: {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                normalized: true,
                assumeClientRect: false,
            },
        }

    // @uiButton('Download .png', {sendArgs: false})
    async downloadSnapshot(filename?: string, options: CanvasSnapshotPluginOptions = {waitForProgressive: true}): Promise<void> {
        if (!this._viewer) return
        while (this._downloading) {
            console.warn('CanvasSnipperPlugin: Another rendering already in progress, waiting...')
            await timeout(100)
        }
        this._downloading = true
        // if (!options.mimeType && !filename) this.filename = this.filename.split('.').slice(0, -1).join('.') + '.png'
        const file = await this.getFile(filename, {...this.defaultOptions, ...options}).catch(e=>{
            this._viewer?.console.error('CanvasSnapshotPlugin: Error exporting file', e)
            return null
        })

        if (file) await this._viewer.exportBlob(file, file.name)
        this._downloading = false
    }

    @uiButton('Download .png')
    protected async _downloadPng(): Promise<void> {
        // this.filename = this.filename.split('.').slice(0, -1).join('.') + '.png'
        return this.downloadSnapshot(undefined, {mimeType: 'image/png'})
    }
    @uiButton('Download .jpeg')
    protected async _downloadJpeg(): Promise<void> {
        // this.filename = this.filename.split('.').slice(0, -1).join('.') + '.jpeg'
        return this.downloadSnapshot(undefined, {mimeType: 'image/jpeg'})
    }
    @uiButton('Download .webp')
    protected async _downloadWebp(): Promise<void> {
        // this.filename = this.filename.split('.').slice(0, -1).join('.') + '.webp'
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
