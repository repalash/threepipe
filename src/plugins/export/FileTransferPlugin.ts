import {AViewerPluginSync} from '../../viewer'
import {downloadBlob} from 'ts-browser-helpers'

export class FileTransferPlugin extends AViewerPluginSync<'transferFile'> {
    enabled = true

    static readonly PluginType = 'FileTransferPlugin'

    toJSON: any = undefined

    async exportFile(file: File|Blob, name?: string) {
        name = name || (file as File).name || 'file_export'
        this.dispatchEvent({type: 'transferFile', path: name, state: 'exporting'})
        await this.actions.exportFile(file, name, ({state, progress})=>{
            this.dispatchEvent({type: 'transferFile', path: name, state: state ?? 'exporting', progress})
        })
        this.dispatchEvent({type: 'transferFile', path: name, state: 'done'})
    }

    readonly defaultActions = {
        exportFile: async(blob: Blob, name: string, _onProgress?: (d: {state?: string, progress?: number})=>void)=>{
            downloadBlob(blob, name)
        },
    }

    actions = {...this.defaultActions}
}
