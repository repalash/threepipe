import {createStyles, type UiTooltipHook} from 'threepipe'
import tippy from 'tippy.js'
import tippyStyles from 'tippy.js/dist/tippy.css?inline'
import styles from './tooltips.css?inline'

/**
 * The look of the tooltips of the editor (the button bars, the mode bar, the frame, the camera pill, the sticky notes):
 * the `editor` theme, a small dark chip. On a touch screen a tap would show a tooltip until the next tap anywhere, so
 * it shows on a long press only.
 */
export const EDITOR_TOOLTIP_PROPS: {theme: string, touch: ['hold', number]} = {theme: 'editor', touch: ['hold', 500]}

/**
 * Where an editor tooltip goes: the element in full screen (the viewer container, see the full screen button), else the
 * page body, so the tooltip shows above the bars, the panel and the areas of the page frame (the canvas box is below
 * them). Use it as the tippy.js `appendTo`: `appendTo: tooltipParent`.
 */
export function tooltipParent(): Element {
    return document.fullscreenElement ?? document.body
}

let added = false

/** Adds the CSS of tippy.js and of the `editor` theme to the page, once */
export function addTooltipStyles() {
    if (added) return
    added = true
    createStyles(tippyStyles)
    createStyles(styles)
}

/**
 * The tooltip hook of the editor for every uiconfig renderer (`UiConfigRendererBase.Tooltip`, set while the
 * TweakpaneEditorPlugin is added): the icon-only buttons of a folder header or a form bar, the ⋮ buttons, a key at the
 * end of a label. A tippy.js tooltip with the `editor` theme, shown only while it adds something (`needed`).
 */
export const editorTooltip: UiTooltipHook = (element, text, {label, shortcut, needed}) => {
    addTooltipStyles()
    const content = document.createElement('span')
    content.textContent = label || text
    if (shortcut) {
        const k = document.createElement('kbd')
        k.className = 'ucf-kbd'
        k.textContent = shortcut
        content.appendChild(k)
    }
    const t = tippy(element, {
        ...EDITOR_TOOLTIP_PROPS,
        appendTo: tooltipParent,
        placement: 'top',
        content,
        onShow: () => needed() ? undefined : false,
    })
    return () => t.destroy()
}
