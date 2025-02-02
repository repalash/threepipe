import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {downloadBlob} from 'ts-browser-helpers'

export interface FileTransferPluginEventMap extends AViewerPluginEventMap{
    transferFile: {
        path: string
        state: 'exporting'|'done'|'error'
        progress?: number
        name?: string
    }
}

/**
 * File Transfer Plugin
 *
 * Provides a way to extend the viewer.export functionality with custom actions. Used in `AWSClientPlugin` to upload files directly to S3.
 *
 * @category Plugins
 */
export class FileTransferPlugin extends AViewerPluginSync<FileTransferPluginEventMap> {
    enabled = true

    static readonly PluginType = 'FileTransferPlugin'

    toJSON: any = undefined

    async exportFile(file: File|Blob, name?: string) {
        name = name || (file as File).name || 'file_export'
        this.dispatchEvent({type: 'transferFile', path: name, state: 'exporting', progress: 0})
        await this.actions.exportFile(file, name, ({state, progress})=>{
            this.dispatchEvent({type: 'transferFile', path: name, state: state ?? 'exporting', progress})
        })
        this.dispatchEvent({type: 'transferFile', path: name, state: 'done'})
    }

    readonly defaultActions = {
        exportFile: async(blob: Blob, name: string, _onProgress?: (d: {state?: 'exporting'|'done'|'error', progress?: number})=>void)=>{
            downloadBlob(blob, name)
        },
    }


    constructor() {
        super()
        this._updateProcessState = this._updateProcessState.bind(this)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.addEventListener('transferFile', this._updateProcessState as any)
    }
    onRemove(viewer: ThreeViewer) {
        this.removeEventListener('transferFile', this._updateProcessState as any)
        super.onRemove(viewer)
    }

    protected _updateProcessState(data: {path: string, state: string, progress?: number}) {
        if (!this._viewer) return
        this._viewer.assetManager.setProcessState(data.path, data.state !== 'done' ? {
            state: data.state,
            progress: data.progress ? data.progress * 100 : undefined,
        } : undefined)
    }

    actions = {...this.defaultActions}
}
