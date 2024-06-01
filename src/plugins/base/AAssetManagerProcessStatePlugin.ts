import {createDiv, onChange, serialize} from 'ts-browser-helpers'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiToggle} from 'uiconfig.js'
import {FileTransferPlugin} from '../export/FileTransferPlugin'

export abstract class AAssetManagerProcessStatePlugin<T extends string = ''> extends AViewerPluginSync<T> {
    @uiToggle('Enabled')
    @onChange(AAssetManagerProcessStatePlugin.prototype._onEnabledChange)
    @serialize() enabled = true

    protected _mainDiv: HTMLDivElement
    protected _contentDiv: HTMLDivElement | undefined

    private _onEnabledChange() {
        if (!this.enabled) this._mainDiv.style.display = 'none'
    }

    protected constructor(suffix: string, public readonly container?: HTMLElement) {
        super()
        this._mainDiv = createDiv({
            id: 'assetManager' + suffix,
            addToBody: false,
            innerHTML: '',
        })
        this._contentDiv = createDiv({
            id: 'assetManager' + suffix + 'Content',
            addToBody: false,
            innerHTML: '',
        })
        if (!this.enabled) {
            this._mainDiv.style.display = 'none'
        }
        this._mainDiv.appendChild(this._contentDiv)
    }

    protected abstract _updateMainDiv(processState: Map<string, {state: string, progress?: number|undefined}>): void

    processState: Map<string, {state: string, progress: number|undefined}> = new Map()
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        ;(this.container ?? viewer.container).appendChild(this._mainDiv)
        this._updateMainDiv(this.processState)

        // todo remove all these listeners onRemove
        viewer.assetManager.importer.addEventListener('importFile', (data: any) => {
            if (data.state !== 'done') {
                this.processState.set(data.path, {
                    state: data.state,
                    progress: data.progress ? data.progress * 100 : undefined,
                })
            } else {
                this.processState.delete(data.path)
            }
            // console.log('importFile', data)
            this._updateMainDiv(this.processState)
        })
        viewer.assetManager.importer.addEventListener('processRawStart', (data: any) => {
            this.processState.set(data.path, {
                state: 'processing',
                progress: undefined,
            })
            this._updateMainDiv(this.processState)
        })
        viewer.assetManager.importer.addEventListener('processRaw', (data: any) => {
            this.processState.delete(data.path)
            this._updateMainDiv(this.processState)
        })
        viewer.assetManager.exporter.addEventListener('exportFile', (data: any) => {
            if (data.state !== 'done') {
                this.processState.set(data.obj.name, {
                    state: data.state,
                    progress: data.progress ? data.progress * 100 : undefined,
                })
            } else {
                this.processState.delete(data.obj.name)
            }
            this._updateMainDiv(this.processState)
        })
        viewer.getPlugin<FileTransferPlugin>('FileTransferPlugin')?.addEventListener('transferFile', (data: any) => {
            if (data.state !== 'done') {
                this.processState.set(data.path, {
                    state: data.state,
                    progress: data.progress ? data.progress * 100 : undefined,
                })
            } else {
                this.processState.delete(data.path)
            }
            this._updateMainDiv(this.processState)
        })

        // todo; remove or move to plugin
        viewer.getPlugin/* <MaterialConfiguratorPlugin>*/('MaterialConfiguratorPlugin')?.addEventListener('progress' as any, (data: any) => {
            if (data.state !== 'done') {
                this.processState.set('MatpreviewGeneration', {
                    state: data.state,
                    progress: 0,
                })
            } else {
                this.processState.delete('MatpreviewGeneration')
            }
            this._updateMainDiv(this.processState)
        })
        viewer.getPlugin/* <SwitchNodePlugin>*/('SwitchNodePlugin')?.addEventListener('progress' as any, (data: any) => {
            if (data.state !== 'done') {
                this.processState.set('SwitchNodeGeneration', {
                    state: data.state,
                    progress: 0,
                })
            } else {
                this.processState.delete('SwitchNodeGeneration')
            }
            this._updateMainDiv(this.processState)
        })
        viewer.getPlugin('ThemePlugin')?.addEventListener('progress' as any, (data: any) => {
            if (data.state !== 'done') {
                this.processState.set('ThemeInit', {
                    state: data.state,
                    progress: 0,
                })
            } else {
                this.processState.delete('ThemeInit')
            }
            this._updateMainDiv(this.processState)
        })

    }

    onRemove(viewer: ThreeViewer) {
        this._mainDiv.remove()
        this._contentDiv?.remove()
        this.processState.clear()
        return super.onRemove(viewer)
    }
}
