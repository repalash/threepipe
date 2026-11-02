/** The panels that {@link raiseOnPress} keeps in order, front last */
const panels: HTMLElement[] = []

/**
 * Brings a floating panel above the other registered panels when it is pressed (a click or the start of a drag
 * anywhere in it), as windows on a desktop. Each panel gets its place in the order, 0 for the back, in the CSS variable
 * `--ui-raise`. Its CSS adds it to the z-index of its UI layer, so the panels stay in their layer (see UI layers in
 * CONTRIBUTING.md), and a state that must stay lower can leave the variable out:
 * ```css
 * .my-panel { z-index: calc(150 + var(--ui-raise, 0)); }
 * ```
 * A panel registered later starts in front. Returns a function that unregisters the panel.
 * @param panel - the panel element (a press on any element in it counts)
 */
export function raiseOnPress(panel: HTMLElement): () => void {
    const raise = () => {
        if (panels[panels.length - 1] === panel) return
        panels.splice(panels.indexOf(panel), 1)
        panels.push(panel)
        restack()
    }
    panels.push(panel)
    restack()
    panel.addEventListener('pointerdown', raise, true) // capture: also a press that a child stops
    return () => {
        panel.removeEventListener('pointerdown', raise, true)
        const i = panels.indexOf(panel)
        if (i < 0) return
        panels.splice(i, 1)
        panel.style.removeProperty('--ui-raise')
        restack()
    }
}

/** Gives each registered panel its place in the order */
function restack() {
    panels.forEach((p, i) => p.style.setProperty('--ui-raise', String(i)))
}
