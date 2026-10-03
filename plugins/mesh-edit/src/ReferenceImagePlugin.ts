/**
 * `ReferenceImagePlugin` - floating reference photos over the viewport.
 *
 * Modelling from reference is the workflow the kokraf demo is built around: several photographs of the
 * subject sit as picture-in-picture panels around the viewport, dragged and resized as the model comes
 * together. It is a small feature that shapes how the whole session feels, which is why it earns a
 * plugin rather than being left to the host app.
 *
 * Deliberately DOM rather than 3D. These are *reference* images, not textured image planes: they should
 * stay put when the camera orbits, never be occluded by geometry, and never appear in a render or an
 * export. A screen-space panel gets all of that for free. Image planes in the scene are a different
 * feature for a different purpose.
 */

import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer, uiButton, uiFolderContainer, uiSlider, uiToggle} from 'threepipe'
import {onChange, serialize} from 'ts-browser-helpers'

export interface ReferenceImageState {
    id: string
    src: string
    /** Fractions of the canvas, so a panel keeps its place when the viewport resizes. */
    x: number
    y: number
    width: number
    opacity: number
    locked: boolean
}

export interface ReferenceImagePluginEventMap extends AViewerPluginEventMap {
    referenceImagesChanged: {images: ReferenceImageState[]}
}

const MIN_WIDTH = 0.06

@uiFolderContainer('Reference Images')
export class ReferenceImagePlugin extends AViewerPluginSync<ReferenceImagePluginEventMap> {
    public static readonly PluginType = 'ReferenceImagePlugin'

    @uiToggle()
    @onChange('_refreshAll')
    @serialize()
        enabled = true

    /** Opacity applied to newly added images. */
    @uiSlider(undefined, [0.1, 1], 0.05)
    @serialize()
        defaultOpacity = 0.85

    /** Accept images dropped onto the viewport. */
    @uiToggle()
    @serialize()
        acceptDrop = true

    @serialize()
        images: ReferenceImageState[] = []

    dependencies = []

    private _container: HTMLDivElement | null = null
    private _panels = new Map<string, HTMLDivElement>()

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        const parent = viewer.canvas.parentElement ?? document.body
        const container = document.createElement('div')
        container.className = 'tp-reference-images'
        Object.assign(container.style, {
            position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden',
        })
        // The canvas may be positioned statically; a containing block is needed for `inset`.
        if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
        parent.appendChild(container)
        this._container = container

        viewer.canvas.addEventListener('dragover', this._onDragOver)
        viewer.canvas.addEventListener('drop', this._onDrop)
        this._refreshAll()
    }

    onRemove(viewer: ThreeViewer): void {
        viewer.canvas.removeEventListener('dragover', this._onDragOver)
        viewer.canvas.removeEventListener('drop', this._onDrop)
        this._container?.remove()
        this._container = null
        this._panels.clear()
        super.onRemove(viewer)
    }

    /** Add a reference image from a URL, data URL or object URL. */
    @uiButton('Add from URL…')
    async addImagePrompt(): Promise<void> {
        const url = await ThreeViewer.Dialog.prompt('Reference image URL', '', true)
        if (url) this.addImage(url)
    }

    addImage(src: string, state: Partial<ReferenceImageState> = {}): ReferenceImageState {
        // Stagger new panels so several dropped at once do not land exactly on top of each other.
        const n = this.images.length
        const entry: ReferenceImageState = {
            id: `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            src,
            x: 0.02 + (n % 3) * 0.03,
            y: 0.62 - (n % 3) * 0.03,
            width: 0.26,
            opacity: this.defaultOpacity,
            locked: false,
            ...state,
        }
        this.images.push(entry)
        this._createPanel(entry)
        this._emit()
        return entry
    }

    removeImage(id: string): void {
        const i = this.images.findIndex(img => img.id === id)
        if (i < 0) return
        // An object URL created by the drop handler would leak if it is not released.
        const src = this.images[i].src
        if (src.startsWith('blob:')) URL.revokeObjectURL(src)
        this.images.splice(i, 1)
        this._panels.get(id)?.remove()
        this._panels.delete(id)
        this._emit()
    }

    @uiButton('Clear all')
    clearImages(): void {
        for (const img of [...this.images]) this.removeImage(img.id)
    }

    private _emit(): void {
        this.dispatchEvent({type: 'referenceImagesChanged', images: this.images})
        this.setDirty?.()
    }

    private _refreshAll(): void {
        if (!this._container) return
        this._container.style.display = this.isDisabled() ? 'none' : ''
        for (const [id, panel] of this._panels) {
            if (!this.images.find(i => i.id === id)) {
                panel.remove()
                this._panels.delete(id)
            }
        }
        for (const image of this.images) {
            if (!this._panels.has(image.id)) this._createPanel(image)
            else this._layout(image)
        }
    }

    private _layout(image: ReferenceImageState): void {
        const panel = this._panels.get(image.id)
        if (!panel) return
        panel.style.left = `${image.x * 100}%`
        panel.style.top = `${image.y * 100}%`
        panel.style.width = `${image.width * 100}%`
        panel.style.opacity = String(image.opacity)
    }

    private _createPanel(image: ReferenceImageState): void {
        if (!this._container) return

        const panel = document.createElement('div')
        Object.assign(panel.style, {
            position: 'absolute', pointerEvents: 'auto', cursor: 'move',
            border: '1px solid rgba(255,255,255,0.25)', borderRadius: '4px',
            boxShadow: '0 4px 18px rgba(0,0,0,0.45)', background: '#111',
            userSelect: 'none', touchAction: 'none',
        })

        const img = document.createElement('img')
        img.src = image.src
        img.draggable = false
        Object.assign(img.style, {display: 'block', width: '100%', height: 'auto', borderRadius: '3px'})
        panel.appendChild(img)

        const close = document.createElement('button')
        close.textContent = '×'
        close.title = 'Remove reference'
        Object.assign(close.style, {
            position: 'absolute', top: '2px', right: '2px', width: '18px', height: '18px',
            lineHeight: '14px', padding: '0', border: 'none', borderRadius: '3px',
            background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: '14px',
        })
        close.addEventListener('pointerdown', e => e.stopPropagation())
        close.addEventListener('click', () => this.removeImage(image.id))
        panel.appendChild(close)

        const grip = document.createElement('div')
        grip.title = 'Resize'
        Object.assign(grip.style, {
            position: 'absolute', right: '0', bottom: '0', width: '14px', height: '14px',
            cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.5) 50%)',
        })
        panel.appendChild(grip)

        this._attachDrag(panel, grip, image)
        this._container.appendChild(panel)
        this._panels.set(image.id, panel)
        this._layout(image)
    }

    /** Pointer-capture drag for moving the panel and resizing it from the corner grip. */
    private _attachDrag(panel: HTMLDivElement, grip: HTMLDivElement, image: ReferenceImageState): void {
        let mode: 'move' | 'resize' | null = null
        let startX = 0, startY = 0, startLeft = 0, startTop = 0, startWidth = 0

        const rect = () => this._container!.getBoundingClientRect()

        const begin = (e: PointerEvent, kind: 'move' | 'resize') => {
            if (image.locked) return
            mode = kind
            startX = e.clientX
            startY = e.clientY
            startLeft = image.x
            startTop = image.y
            startWidth = image.width
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            e.stopPropagation()
            e.preventDefault()
        }

        const move = (e: PointerEvent) => {
            if (!mode) return
            const r = rect()
            const dx = (e.clientX - startX) / r.width
            const dy = (e.clientY - startY) / r.height
            if (mode === 'move') {
                // Clamp so a panel can never be dragged entirely off screen and lost.
                image.x = Math.min(0.99 - MIN_WIDTH, Math.max(-startWidth + MIN_WIDTH, startLeft + dx))
                image.y = Math.min(0.98, Math.max(-0.2, startTop + dy))
            } else {
                image.width = Math.max(MIN_WIDTH, Math.min(0.95, startWidth + dx))
            }
            this._layout(image)
            e.stopPropagation()
        }

        const end = (e: PointerEvent) => {
            if (!mode) return
            mode = null
            try {
                (e.target as HTMLElement).releasePointerCapture(e.pointerId)
            } catch {
                // The pointer may already have been released; nothing to do.
            }
            this._emit()
        }

        panel.addEventListener('pointerdown', e => begin(e, 'move'))
        grip.addEventListener('pointerdown', e => begin(e, 'resize'))
        panel.addEventListener('pointermove', move)
        grip.addEventListener('pointermove', move)
        panel.addEventListener('pointerup', end)
        grip.addEventListener('pointerup', end)
        panel.addEventListener('pointercancel', end)
    }

    private _onDragOver = (event: DragEvent): void => {
        if (!this.acceptDrop || this.isDisabled()) return
        if (!event.dataTransfer?.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
    }

    private _onDrop = (event: DragEvent): void => {
        if (!this.acceptDrop || this.isDisabled()) return
        const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
        if (!files.length) return
        // Only images are claimed here; anything else falls through to the asset dropzone.
        event.preventDefault()
        event.stopPropagation()
        for (const file of files) this.addImage(URL.createObjectURL(file))
    }
}
