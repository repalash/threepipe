import {createDiv, onChange, serialize} from 'ts-browser-helpers'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiToggle} from 'uiconfig.js'

export abstract class AAssetManagerProcessStatePlugin<TE extends AViewerPluginEventMap = AViewerPluginEventMap> extends AViewerPluginSync<TE> {
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
        this._onProcessStateUpdate = this._onProcessStateUpdate.bind(this)
    }

    protected abstract _updateMainDiv(processState: Map<string, {state: string, progress?: number|undefined}>): void

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        ;(this.container ?? viewer.container).appendChild(this._mainDiv)
        this._updateMainDiv(viewer.assetManager.processState)
        viewer.assetManager.addEventListener('processStateUpdate', this._onProcessStateUpdate)
    }

    protected _onProcessStateUpdate() {
        if (!this._viewer) return
        this._updateMainDiv(this._viewer.assetManager.processState)
    }

    onRemove(viewer: ThreeViewer) {
        this._mainDiv.remove()
        // this._contentDiv?.remove()
        viewer.assetManager.removeEventListener('processStateUpdate', this._onProcessStateUpdate)
        return super.onRemove(viewer)
    }
}
