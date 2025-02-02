import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {createDiv, createStyles, getOrCall, onChange, ValOrFunc} from 'ts-browser-helpers'
import styles from './GeometryUVPreviewPlugin.css?inline'
import {CustomContextMenu} from '../../utils'
import {uiFolderContainer, uiToggle} from 'uiconfig.js'
import {IGeometry} from '../../core'
import {UVsDebug} from 'three/examples/jsm/utils/UVsDebug.js'

export interface TargetBlock {
    target: ValOrFunc<IGeometry|undefined>
    name: string
    visible: boolean
    div: HTMLDivElement
    uvCanvas?: HTMLCanvasElement
}

@uiFolderContainer('Render Target Preview Plugin')
export class GeometryUVPreviewPlugin<TE extends AViewerPluginEventMap = AViewerPluginEventMap> extends AViewerPluginSync<TE> {
    static readonly PluginType = 'GeometryUVPreviewPlugin'

    @uiToggle('Enabled')
    @onChange(GeometryUVPreviewPlugin.prototype.refreshUi) enabled = true
    toJSON: any = null

    mainDiv: HTMLDivElement = createDiv({id: 'GeometryUVPreviewPluginContainer', addToBody: false})
    stylesheet?: HTMLStyleElement

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

    targetBlocks: TargetBlock[] = []

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)

        viewer.addEventListener('postRender', this._postRender)
        this.stylesheet = createStyles(styles, viewer.container)
        this.refreshUi()
    }

    onRemove(viewer: ThreeViewer): void {
        viewer.removeEventListener('postRender', this._postRender)
        this.stylesheet?.remove()
        this.stylesheet = undefined
        this.refreshUi()
        super.onRemove(viewer)
    }

    private _postRender = () => {
        if (!this._viewer) return

        for (const target of this.targetBlocks) {
            if (!target.visible) continue
            const geo = getOrCall(target.target)
            if (!geo?.attributes?.uv) {
                // todo draw white or pink
                continue
            }
            if (!target.uvCanvas) {
                target.uvCanvas = UVsDebug(geo, 1024)
                target.uvCanvas.style.width = '100%'
                target.uvCanvas.style.height = '100%'
            }
            if (target.uvCanvas && target.uvCanvas.parentElement !== target.div) target.div.appendChild(target.uvCanvas)
        }
    }

    addGeometry(target: ValOrFunc<IGeometry|undefined>, name: string, visible = true): this {
        if (!target) return this
        const div = document.createElement('div')
        const targetDef: TargetBlock = {target, name, div, visible}
        div.classList.add('GeometryUVPreviewPluginTarget')
        if (!targetDef.visible) div.classList.add('GeometryUVPreviewPluginCollapsed')
        const header = document.createElement('div')
        header.classList.add('GeometryUVPreviewPluginTargetHeader')
        header.innerText = name
        header.onclick = () => {
            targetDef.visible = !targetDef.visible
            if (!targetDef.visible) div.classList.add('GeometryUVPreviewPluginCollapsed')
            else div.classList.remove('GeometryUVPreviewPluginCollapsed')
            this._viewer?.setDirty()
        }
        header.oncontextmenu = (e) => {
            e.preventDefault()
            e.stopPropagation()
            CustomContextMenu.Create({
                'Download': () => this.downloadGeometryUV(targetDef),
                'Remove': () => this.removeGeometry(target),
            }, e.clientX, e.clientY)
        }
        div.appendChild(header)
        this.mainDiv.appendChild(div)
        this.targetBlocks.push(targetDef)
        this.refreshUi()
        return this
    }

    removeGeometry(target: ValOrFunc<IGeometry|undefined>): this {
        const index = this.targetBlocks.findIndex(t => t.target === target)
        if (index >= 0) {
            const t = this.targetBlocks[index]
            this.targetBlocks.splice(index, 1)
            t.div.remove()
        }
        this.refreshUi()
        return this
    }

    downloadGeometryUV(targetDef: TargetBlock): this {
        if (!this._viewer) return this
        if (!targetDef.uvCanvas) return this
        const canvas = targetDef.uvCanvas
        const url = canvas.toDataURL('image/png')
        const link = document.createElement('a')
        document.body.appendChild(link)
        link.style.display = 'none'
        link.href = url
        link.download = 'renderTarget.' + 'png'
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        return this
    }

    refreshUi(): void {
        if (!this.mainDiv) return
        if (!this._viewer) {
            if (this.mainDiv.parentElement) this.mainDiv.remove()
            this.mainDiv.style.display = 'none'
            this.mainDiv.style.zIndex = '1000'
            return
        }
        if (!this.mainDiv.parentElement) this._viewer.container?.appendChild(this.mainDiv)
        this.mainDiv.style.display = !this.isDisabled() ? 'flex' : 'none'
        this.mainDiv.style.zIndex = parseInt(this._viewer.canvas.style.zIndex || '0') + 1 + ''
        this._viewer?.setDirty()
    }

    setDirty() { // for enable/disable functions
        this.refreshUi()
    }

    dispose() {
        for (const target of this.targetBlocks) {
            this.removeGeometry(target.target)
        }
        super.dispose()
    }

}
