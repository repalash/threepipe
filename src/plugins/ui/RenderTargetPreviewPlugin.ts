import {ThreeViewer} from '../../viewer'
import {IRenderTarget} from '../../rendering'
import {createDiv, createStyles, getOrCall, onChange, ValOrFunc} from 'ts-browser-helpers'
import {Vector4} from 'three'
import styles from './RenderTargetPreviewPlugin.css'
import {AViewerPluginSync} from '../../viewer/AViewerPlugin'

export class RenderTargetPreviewPlugin <TEvent extends string> extends AViewerPluginSync<TEvent> {
    static readonly PluginType = 'RenderTargetPreviewPlugin'

    @onChange(RenderTargetPreviewPlugin.prototype.refreshUi) enabled = true
    toJSON: any = null

    mainDiv: HTMLDivElement = createDiv({id: 'RenderTargetPreviewPluginContainer'})
    stylesheet?: HTMLStyleElement

    constructor() {
        super()
    }

    targetBlocks: {
        target: ValOrFunc<IRenderTarget|undefined>
        name: string
        visible: boolean
        transparent: boolean
        originalColorSpace: boolean
        div: HTMLDivElement
    }[] = []

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
            if (!target.visible) return
            const rt = getOrCall(target.target)
            if (!rt) {
                // todo draw white or pink
                continue
            }
            const rect = target.div.getBoundingClientRect()
            const tex = rt.texture
            const canvasRect = this._viewer.canvas.getBoundingClientRect()
            rect.x = rect.x - canvasRect.x
            rect.y = canvasRect.height + canvasRect.y - rect.y - rect.height
            if (Array.isArray(tex)) {
                // todo support multi target
                console.warn('todo: multi target')
                continue
            }
            this._viewer.renderManager.blit(null, {
                source: tex,
                clear: !target.transparent,
                respectColorSpace: !target.originalColorSpace,
                viewport: new Vector4(rect.x, rect.y, rect.width, rect.height),
            })
        }
    }

    addTarget(target: ValOrFunc<IRenderTarget|undefined>, name: string, transparent = false, originalColorSpace = false, visible = true): this {
        const div = document.createElement('div')
        const targetDef = {target, name, transparent, div, originalColorSpace, visible}
        div.classList.add('RenderTargetPreviewPluginTarget')
        const header = document.createElement('div')
        header.classList.add('RenderTargetPreviewPluginTargetHeader')
        header.innerText = name
        header.onclick = () => {
            targetDef.visible = !targetDef.visible
            if (!targetDef.visible) div.classList.add('RenderTargetPreviewPluginCollapsed')
            else div.classList.remove('RenderTargetPreviewPluginCollapsed')
            this._viewer?.setDirty()
        }
        div.appendChild(header)
        this.mainDiv.appendChild(div)
        this.targetBlocks.push(targetDef)
        this.refreshUi()
        return this
    }

    removeTarget(target: ValOrFunc<IRenderTarget|undefined>): this {
        const index = this.targetBlocks.findIndex(t => t.target === target)
        if (index >= 0) {
            const t = this.targetBlocks[index]
            this.targetBlocks.splice(index, 1)
            t.div.remove()
        }
        this.refreshUi()
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
        this.mainDiv.style.display = this.enabled ? 'flex' : 'none'
        this.mainDiv.style.zIndex = parseInt(this._viewer.canvas.style.zIndex || '0') + 1 + ''
    }

    dispose() {
        for (const target of this.targetBlocks) {
            this.removeTarget(target.target)
        }
        super.dispose()
    }

}
