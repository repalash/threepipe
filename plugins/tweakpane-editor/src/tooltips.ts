import {createStyles} from 'threepipe'
import tippyStyles from 'tippy.js/dist/tippy.css?inline'
import styles from './tooltips.css?inline'

/**
 * The look of the tooltips of the editor (the button bars, the mode bar, the frame, the camera pill, the sticky notes):
 * the `editor` theme, a small dark chip. On a touch screen a tap would show a tooltip until the next tap anywhere, so
 * it shows on a long press only.
 *
 * Typed without the `Props` of tippy.js: tippy.js is bundled (a devDependency), so the declarations must not import it.
 */
export const EDITOR_TOOLTIP_PROPS: {theme: string, touch: ['hold', number]} = {theme: 'editor', touch: ['hold', 500]}

let added = false

/** Adds the CSS of tippy.js and of the `editor` theme to the page, once */
export function addTooltipStyles() {
    if (added) return
    added = true
    createStyles(tippyStyles)
    createStyles(styles)
}
