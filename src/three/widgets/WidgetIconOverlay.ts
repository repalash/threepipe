import {Camera, Color, Vector3} from 'three'
import {createStyles, now} from 'ts-browser-helpers'
import {ObjectPicker} from '../utils/ObjectPicker'
import {AHelperWidget} from './AHelperWidget'
import {getWidgetIconSvg, widgetIconLayout, WidgetKind} from './widgetKinds'
import styles from './WidgetIconOverlay.css?inline'

interface WidgetIconElement {
    el: HTMLDivElement
    kind: WidgetKind
    size: number
    transform: string
    color: string
    label: string
    clickable: boolean | undefined
    /** The depth of the object on screen (NDC z), for the stacking */
    depth: number
    zIndex: string
}

/** The pointer callbacks of a {@link WidgetIconOverlay} */
export interface WidgetIconOverlayOptions {
    /** A click or tap on the icon of a widget */
    click?: (widget: AHelperWidget, e: MouseEvent) => void
    /**
     * Whether a click on the icon of a widget does something (it selects the object). The icons that cannot be clicked
     * let the pointer through to the canvas (`pointer-events: none`). Checked when an icon is made and after
     * {@link WidgetIconOverlay.invalidateClickable}. Not set: all icons can be clicked.
     */
    canClick?: (widget: AHelperWidget) => boolean
    /** The pointer enters the icon of a widget, or leaves it (null) */
    hover?: (widget: AHelperWidget | null) => void
}

const tmp = new Vector3()

/** Whether the widget and all its parents are visible */
function visibleInScene(o: AHelperWidget) {
    for (let p: any = o; p; p = p.parent) if (!p.visible) return false
    return true
}

/**
 * The icons of light and camera widgets as DOM elements, for `Object3DWidgetsPlugin.iconMode = 'dom'`: an SVG for each
 * widget whose {@link AHelperWidget.iconMode} is `dom`, in a layer over the canvas in the viewer container.
 *
 * The SVG comes from the same shapes as the sprite texture ({@link getWidgetIconSvg}), so both modes look the same; it is
 * sharp at any pixel ratio and icon size, and never in a render, screenshot or recording of the canvas.
 * {@link update} places the icons with `transform` only (called after each render, with the camera of the render; the
 * layout is read again only after {@link invalidateViewport}), and hides an icon when its widget
 * or a parent is hidden, {@link AHelperWidget.hasIcon} is false, or the object is behind the camera or out of its
 * near and far range. An icon whose centre is just out of the canvas still shows the part of it that is on the canvas.
 * Where icons overlap, the nearer one is on top (and gets the click), as with sprites.
 *
 * The pointer: a click or tap on an icon calls {@link WidgetIconOverlayOptions.click} when it is a click for the canvas
 * too (shorter than `ObjectPicker.PointerClickMaxTime`, moved less than `ObjectPicker.PointerClickMaxDistance`), the
 * pointer entering and leaving an icon calls {@link WidgetIconOverlayOptions.hover}, and a wheel over an icon goes on to
 * the canvas, so the camera still zooms. An icon that cannot be clicked ({@link WidgetIconOverlayOptions.canClick}) lets
 * the pointer through to the canvas.
 *
 * The layer has `z-index` 8, under the other overlays on the canvas (UI layers in CONTRIBUTING.md).
 * Made by `Object3DWidgetsPlugin`.
 */
export class WidgetIconOverlay {
    /** The layer of the icons, over the canvas */
    readonly element: HTMLDivElement

    private _icons = new Map<AHelperWidget, WidgetIconElement>()
    private _container?: HTMLElement
    private _canvas?: HTMLElement
    private _sheet?: HTMLStyleElement
    private _rect = ''
    private _size = {width: 0, height: 0}
    private _viewportDirty = true
    private _clickableDirty = true

    private _press?: {time: number, x: number, y: number}

    constructor(public options: WidgetIconOverlayOptions = {}) {
        this.element = document.createElement('div')
        this.element.className = 'widget-icons-layer'
    }

    /** Adds the layer to `container`, over `canvas` (a child of the container) */
    attach(container: HTMLElement, canvas: HTMLElement) {
        if (this._container) this.detach()
        this._container = container
        this._canvas = canvas
        this._sheet = createStyles(styles, container)
        container.appendChild(this.element)
    }

    /** Removes the layer, its icons and its stylesheet */
    detach() {
        for (const icon of this._icons.values()) icon.el.remove()
        this._icons.clear()
        this.element.remove()
        this._sheet?.remove()
        this._sheet = undefined
        this._container = undefined
        this._canvas = undefined
        this._rect = ''
        this._viewportDirty = true
    }

    /**
     * Reads the place and the size of the canvas in the container again, at the next {@link update} (the layout is not
     * read on each frame). Call it when the canvas is resized or moved: `Object3DWidgetsPlugin` calls it on a resize of
     * the viewer.
     */
    invalidateViewport() {
        this._viewportDirty = true
    }

    /**
     * Checks again which icons can be clicked ({@link WidgetIconOverlayOptions.canClick}) at the next {@link update}
     * (the check is not run on each frame). `Object3DWidgetsPlugin` calls it on a change in the viewer (an `update`
     * event: the picking plugin, its options or the selection, the widget options) and when a plugin is added or
     * removed. A new icon is checked when it is made.
     */
    invalidateClickable() {
        this._clickableDirty = true
    }

    /** The icon element of a widget, while it has one */
    getIconElement(widget: AHelperWidget): HTMLDivElement | undefined {
        return this._icons.get(widget)?.el
    }

    /** Removes the icon of a widget (a widget that is removed); {@link update} also does it for the widgets not given */
    removeIcon(widget: AHelperWidget) {
        this._icons.get(widget)?.el.remove()
        this._icons.delete(widget)
    }

    /**
     * Places the icons of `widgets` for `camera`, makes the icons of new widgets and removes the icons of widgets that
     * are no longer in the list or no longer in `dom` mode. Writes the DOM only where something changed.
     */
    update(widgets: readonly unknown[], camera: Camera) {
        const container = this._container, canvas = this._canvas
        if (!container || !canvas) return
        // the layer covers the canvas, which can be smaller than the container (viewer.setRenderSize)
        if (this._viewportDirty) {
            this._viewportDirty = false
            const c = container.getBoundingClientRect()
            const cr = canvas.getBoundingClientRect()
            this._size = {width: cr.width, height: cr.height}
            const rect = `${cr.left - c.left - container.clientLeft}|${cr.top - c.top - container.clientTop}|${cr.width}|${cr.height}`
            if (rect !== this._rect) {
                this._rect = rect
                const [x, y, w, h] = rect.split('|')
                Object.assign(this.element.style, {left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px'})
            }
        }
        const r = this._size
        const checkClickable = this._clickableDirty
        this._clickableDirty = false
        const dpr = globalThis.devicePixelRatio || 1
        const snap = (v: number) => Math.round(v * dpr) / dpr // whole device pixels, so the SVG is not resampled
        const seen = new Set<AHelperWidget>()
        const shownIcons: WidgetIconElement[] = []
        for (const widget of widgets) {
            if (!(widget instanceof AHelperWidget) || widget.iconMode !== 'dom' || !widget.hasIcon || !widget.kind) continue
            seen.add(widget)
            let icon = this._icons.get(widget)
            if (icon && icon.kind !== widget.kind) {
                icon.el.remove()
                icon = undefined
            }
            if (!icon) icon = this._create(widget, widget.kind)
            const el = icon.el
            if (checkClickable || icon.clickable === undefined) {
                const clickable = !!this.options.click && (this.options.canClick?.(widget) ?? true)
                if (clickable !== icon.clickable) {
                    icon.clickable = clickable
                    el.className = clickable ? 'widget-icon' : 'widget-icon widget-icon-static'
                }
            }

            const size = widget.iconSize * widgetIconLayout.box / widgetIconLayout.diameter
            tmp.setFromMatrixPosition(widget.matrixWorld).project(camera)
            const x = (tmp.x + 1) / 2 * r.width, y = (1 - tmp.y) / 2 * r.height
            const shown = visibleInScene(widget) && tmp.z >= -1 && tmp.z <= 1 && // behind the camera: z > 1
                x > -size && x < r.width + size && y > -size && y < r.height + size
            if (el.hidden === shown) el.hidden = !shown
            if (!shown) continue
            icon.depth = tmp.z
            shownIcons.push(icon)

            if (size !== icon.size) {
                icon.size = size
                el.style.width = el.style.height = size + 'px'
            }
            const transform = `translate(${snap(x - size / 2)}px, ${snap(y - size / 2)}px)`
            if (transform !== icon.transform) el.style.transform = icon.transform = transform
            const objColor = (widget.object as {color?: Color} | undefined)?.color
            const color = objColor?.isColor ? '#' + objColor.getHexString() : ''
            if (color !== icon.color) el.style.color = icon.color = color
            const label = widget.object?.name || widget.kind
            if (label !== icon.label) {
                icon.label = label
                el.title = label
                el.setAttribute('aria-label', label)
            }
        }
        // the nearer icon on top where icons overlap, as the sprites are drawn (far to near) and picked (near first)
        shownIcons.sort((a, b) => b.depth - a.depth)
        shownIcons.forEach((icon, i) => {
            const zIndex = String(i + 1)
            if (zIndex !== icon.zIndex) icon.el.style.zIndex = icon.zIndex = zIndex
        })
        for (const [widget, icon] of this._icons) {
            if (seen.has(widget)) continue
            icon.el.remove()
            this._icons.delete(widget)
        }
    }

    private _create(widget: AHelperWidget, kind: WidgetKind) {
        const el = document.createElement('div')
        el.className = 'widget-icon'
        el.setAttribute('role', 'button')
        el.innerHTML = getWidgetIconSvg(kind)
        el.addEventListener('pointerdown', (e: PointerEvent) => {
            this._press = e.isPrimary === false ? this._press : {time: now(), x: e.clientX, y: e.clientY}
        })
        el.addEventListener('click', (e: MouseEvent) => {
            const press = this._press
            this._press = undefined
            // a click as the canvas counts one (ObjectPicker): a long press or a drag on an icon is not a click
            if (press && !this._isClick(press, e)) return
            this.options.click?.(widget, e)
        })
        el.addEventListener('pointerenter', () => this.options.hover?.(widget))
        el.addEventListener('pointerleave', () => this.options.hover?.(null))
        el.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault()
            this._canvas?.dispatchEvent(new WheelEvent('wheel', e))
        }, {passive: false})
        this.element.appendChild(el)
        const icon: WidgetIconElement = {el, kind, size: 0, transform: '', color: '', label: '', clickable: undefined, depth: 0, zIndex: ''}
        this._icons.set(widget, icon)
        return icon
    }

    private _isClick(press: {time: number, x: number, y: number}, e: MouseEvent) {
        if (now() - press.time >= ObjectPicker.PointerClickMaxTime) return false
        const {width: w, height: h} = this._size
        // the distance in the units of the picker: the canvas is 2 wide and 2 high
        return Math.hypot((e.clientX - press.x) / (w / 2 || 1), (e.clientY - press.y) / (h / 2 || 1)) < ObjectPicker.PointerClickMaxDistance
    }

    dispose() {
        this.detach()
        this.options = {}
    }
}
