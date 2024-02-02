import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IRenderTarget} from '../../rendering'
import {createDiv, createStyles, getOrCall, onChange, ValOrArr, ValOrFunc} from 'ts-browser-helpers'
import {SRGBColorSpace, Vector4, WebGLRenderTarget} from 'three'
import styles from './RenderTargetPreviewPlugin.css?inline'
import {CustomContextMenu} from '../../utils'
import {uiFolderContainer, uiToggle} from 'uiconfig.js'
import {ITexture} from '../../core'

export interface RenderTargetBlock {
    target: ValOrFunc<IRenderTarget|{texture?: ValOrArr<ITexture>}|undefined>
    name: string
    visible: boolean
    transparent: boolean
    originalColorSpace: boolean
    div: HTMLDivElement
}
@uiFolderContainer('Render Target Preview Plugin')
export class RenderTargetPreviewPlugin<TEvent extends string> extends AViewerPluginSync<TEvent> {
    static readonly PluginType = 'RenderTargetPreviewPlugin'

    @uiToggle('Enabled')
    @onChange(RenderTargetPreviewPlugin.prototype.refreshUi) enabled = true
    toJSON: any = null

    mainDiv: HTMLDivElement = createDiv({id: 'RenderTargetPreviewPluginContainer', addToBody: false})
    stylesheet?: HTMLStyleElement

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

    targetBlocks: RenderTargetBlock[] = []

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

        for (const targetBlock of this.targetBlocks) {
            if (!targetBlock.visible) continue
            const rt = getOrCall(targetBlock.target)
            if (!rt) {
                // todo draw white or pink
                continue
            }
            const rect = targetBlock.div.getBoundingClientRect()
            let tex = rt.texture
            const canvasRect = this._viewer.canvas.getBoundingClientRect()
            rect.x = rect.x - canvasRect.x
            rect.y = canvasRect.height + canvasRect.y - rect.y - rect.height
            if (Array.isArray(tex)) {
                // todo support multi target
                this._viewer.console.warn('Multi target preview not supported yet, rendering just the first one')
                tex = tex[0]
            }
            const outputColorSpace = this._viewer.renderManager.webglRenderer.outputColorSpace
            if (!targetBlock.originalColorSpace) this._viewer.renderManager.webglRenderer.outputColorSpace = SRGBColorSpace
            this._viewer.renderManager.blit(null, {
                source: tex,
                clear: !targetBlock.transparent,
                respectColorSpace: !targetBlock.originalColorSpace,
                viewport: new Vector4(rect.x, rect.y, rect.width, rect.height),
            })
            this._viewer.renderManager.webglRenderer.outputColorSpace = outputColorSpace
        }
    }

    addTarget(target: RenderTargetBlock['target'], name: string, transparent = false, originalColorSpace = false, visible = true): this {
        if (!target) return this
        const div = document.createElement('div')
        const targetDef = {target, name, transparent, div, originalColorSpace, visible}
        div.classList.add('RenderTargetPreviewPluginTarget')
        if (!targetDef.visible) div.classList.add('RenderTargetPreviewPluginCollapsed')
        const header = document.createElement('div')
        header.classList.add('RenderTargetPreviewPluginTargetHeader')
        header.innerText = name
        header.onclick = () => {
            targetDef.visible = !targetDef.visible
            if (!targetDef.visible) div.classList.add('RenderTargetPreviewPluginCollapsed')
            else div.classList.remove('RenderTargetPreviewPluginCollapsed')
            this._viewer?.setDirty()
        }
        header.oncontextmenu = (e) => {
            e.preventDefault()
            e.stopPropagation()
            CustomContextMenu.Create({
                'Download': () => this.downloadTarget(target),
                'Remove': () => this.removeTarget(target),
            }, e.clientX, e.clientY)
        }
        div.appendChild(header)
        this.mainDiv.appendChild(div)
        this.targetBlocks.push(targetDef)
        this.refreshUi()
        return this
    }

    removeTarget(target: RenderTargetBlock['target']): this {
        const index = this.targetBlocks.findIndex(t => t.target === target)
        if (index >= 0) {
            const t = this.targetBlocks[index]
            this.targetBlocks.splice(index, 1)
            t.div.remove()
        }
        this.refreshUi()
        return this
    }
    downloadTarget(target1: RenderTargetBlock['target']): this {
        if (!this._viewer) return this
        const target = getOrCall(target1)
        if (!target) return this
        const tex = target.texture
        if (Array.isArray(tex)) {
            // todo support multi target
            this._viewer.dialog.alert('Multi target not supported yet')
            this._viewer.console.warn('support multi target export')
            return this
        }
        const canvas = this._viewer?.canvas
        if (!canvas) return this
        const blob = this._viewer.renderManager.exportRenderTarget(target as WebGLRenderTarget)
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        document.body.appendChild(link)
        link.style.display = 'none'
        link.href = url
        link.download = 'renderTarget.' + (blob.ext || 'png')
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
            this.removeTarget(target.target)
        }
        super.dispose()
    }

}
