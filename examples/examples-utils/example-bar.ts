import {bindActions, CommandAction, CommandsPlugin, formatShortcut, shortcutsOf, ThreeViewer, UiObjectConfig} from 'threepipe'
import {UiConfigForm} from '@threepipe/plugin-tweakpane-editor'

// TODO: move the bar and stack layouts of UiConfigForm to uiconfig.js (uiconfig-dom, repalash/uiconfig.js#15)

export interface ExampleBarOptions {
    /** `bar`: a row at the bottom centre (default). `stack`: a column at the bottom right; a bar on a phone. */
    layout?: 'bar' | 'stack'
}

/** The actions of {@link exampleAction}, by their button */
const actionOf = new WeakMap<UiObjectConfig, CommandAction>()
const PHONE = '(max-width: 640px)'
let styled = false

/**
 * The buttons of an example over its canvas, from uiconfig configs ({@link UiConfigForm} in the `bar` or `stack`
 * layout): buttons, checkboxes as toggle buttons, dropdowns, and sliders or numbers in a popover. A folder is a group.
 * The bar reads the values again after each frame, so a toggle follows a change from the Tweakpane panel too.
 *
 * ```ts
 * createExampleBar(viewer, [
 *     {type: 'button', label: 'Download snapshot', icon: 'camera', value: async() => snapshot.downloadSnapshot('a.png')},
 *     {type: 'checkbox', label: 'Auto rotate', icon: 'rotate-3d', property: [controls, 'autoRotate']},
 *     exampleAction(viewer, {id: 'example.top', label: 'Top view', icon: 'arrow-up', shortcut: '1', run: () => ...}),
 * ])
 * ```
 */
export function createExampleBar(viewer: ThreeViewer, configs: UiObjectConfig[], options: ExampleBarOptions = {}) {
    addStyles()
    const layout = options.layout ?? 'bar'
    const phone = window.matchMedia(PHONE)
    const layoutNow = () => layout === 'stack' && !phone.matches ? 'stack' : 'bar'
    const form = new UiConfigForm(configs, {
        layout: layoutNow(),
        shortcutOf: (c) => {
            const action = actionOf.get(c)
            if (!action) return undefined
            const key = shortcutsOf(viewer.getPlugin(CommandsPlugin)?.shortcutOf(action.id) ?? action.shortcut)[0]
            return key ? formatShortcut(key) : undefined
        },
        // a button that throws: a toast on the viewer, like the actions of a CommandsPlugin
        onError: (e) => {
            console.error(e)
            viewer.dialog.toast?.(e instanceof Error ? e.message : String(e), {kind: 'error', container: viewer.container})
        },
    })
    const wrap = document.createElement('div')
    wrap.className = 'example-bar'
    wrap.dataset.layout = form.layout
    wrap.appendChild(form.element)
    viewer.container.appendChild(wrap)
    phone.addEventListener('change', () => wrap.dataset.layout = form.layout = layoutNow())
    viewer.addEventListener('postFrame', () => form.refresh())
    return form
}

/**
 * A button of the example bar that is also an action ({@link CommandAction}): its key works (with the `CommandsPlugin`
 * of the viewer when it has one, see {@link bindActions}), the tooltip shows the key, and it runs through the
 * `CommandsPlugin`, which shows an error in a toast.
 */
export function exampleAction(viewer: ThreeViewer, action: CommandAction): UiObjectConfig {
    bindActions(viewer, [action])
    const config: UiObjectConfig = {
        type: 'button',
        label: action.label,
        icon: action.icon,
        disabled: () => !!action.enabled && !action.enabled(),
        value: async() => {
            const commands = viewer.getPlugin(CommandsPlugin)
            const result = commands ? await commands.run(action.id) : await action.run()
            // the CommandsPlugin shows the error in a toast itself
            if (result?.error && !commands) throw new Error(result.error)
        },
    }
    actionOf.set(config, action)
    return config
}

function addStyles() {
    if (styled) return
    styled = true
    const style = document.createElement('style')
    style.textContent = `
.example-bar { position: absolute; z-index: 10000; bottom: 16px; display: flex; pointer-events: none; }
.example-bar > * { pointer-events: auto; }
.example-bar[data-layout="bar"] { left: 16px; right: 16px; justify-content: center; }
.example-bar[data-layout="stack"] { right: 16px; max-height: calc(100% - 32px); }
`
    document.head.appendChild(style)
}
