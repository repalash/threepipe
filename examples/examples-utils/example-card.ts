import {bindActions, CommandAction, CommandsPlugin, formatShortcut, shortcutsOf, ThreeViewer, UiObjectConfig} from 'threepipe'
import {lucideIcon, UiConfigForm} from '@threepipe/plugin-tweakpane-editor'

// TODO: move the bar and stack layouts of UiConfigForm to uiconfig.js (uiconfig-dom, repalash/uiconfig.js#15)

export interface ExampleCardOptions {
    /** The name of the example. Default: the title of the page */
    title?: string
    /** One or two sentences: what the example shows and what to try */
    description?: string
    /**
     * The controls, as uiconfig configs (the format of the Tweakpane panel): buttons, checkboxes (toggle buttons),
     * dropdowns, sliders or numbers (in a popover), monitors (a live value). A folder is a group.
     */
    actions?: UiObjectConfig[]
    /**
     * The example's own elements (a list of results, a table of stats, a legend), shown under the controls as they are.
     * The card does not change them: the example keeps updating them, and styles them in its page. An element already
     * on the page moves into the card.
     */
    content?: HTMLElement | HTMLElement[]
}

/** The actions of {@link exampleAction}, by their button */
const actionOf = new WeakMap<UiObjectConfig, CommandAction>()
const COLLAPSED_KEY = 'threepipe-example-card-collapsed'
const PHONE = '(max-width: 640px)'
let styled = false

/**
 * The card of an example, at the top left of the canvas: its title, what it shows, its controls, its own elements
 * (`content`, e.g. a list of results) and a link to its source. The controls are uiconfig configs drawn by
 * {@link UiConfigForm} (`stack` layout). The card reads their values again after each frame, so a toggle follows a
 * change in the Tweakpane panel too. The header collapses it; on a phone it is at the bottom and starts collapsed.
 *
 * ```ts
 * createExampleCard(viewer, {
 *     description: 'Animates the camera between saved views. Click a view or press 1–3.',
 *     actions: [
 *         exampleAction(viewer, {id: 'example.top', label: 'Top view', icon: 'arrow-up', shortcut: '1', run: () => ...}),
 *         {type: 'checkbox', label: 'Auto rotate', icon: 'rotate-3d', property: [controls, 'autoRotate']},
 *         {type: 'monitor', label: 'Triangles', property: [stats, 'triangles']},
 *     ],
 * })
 * ```
 */
export function createExampleCard(viewer: ThreeViewer, options: ExampleCardOptions = {}) {
    addStyles()
    const title = options.title ?? document.title
    const card = document.createElement('section')
    card.className = 'example-card'
    card.setAttribute('aria-label', title)

    const head = document.createElement('div')
    head.className = 'example-card-head'
    const h = document.createElement('h1')
    h.textContent = title
    head.appendChild(h)
    const name = location.pathname.match(/examples\/([^/]+)\//)?.[1]
    if (name) {
        const src = document.createElement('a')
        src.className = 'example-card-icon'
        src.href = `https://github.com/repalash/threepipe/blob/master/examples/${name}/script.ts`
        src.target = '_blank'
        src.rel = 'noopener'
        src.title = 'Source code'
        src.setAttribute('aria-label', 'Source code')
        src.innerHTML = lucideIcon('code') ?? '</>'
        head.appendChild(src)
    }
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'example-card-icon example-card-toggle'
    toggle.innerHTML = lucideIcon('chevron-down') ?? '▾'
    head.appendChild(toggle)
    card.appendChild(head)

    const body = document.createElement('div')
    body.className = 'example-card-body'
    body.id = 'example-card-body'
    toggle.setAttribute('aria-controls', body.id)
    if (options.description) {
        const p = document.createElement('p')
        p.textContent = options.description
        body.appendChild(p)
    }
    let form: UiConfigForm | undefined
    if (options.actions?.length) {
        form = new UiConfigForm(options.actions, {
            layout: 'stack',
            shortcutOf: (c) => {
                const action = actionOf.get(c)
                if (!action) return undefined
                const key = shortcutsOf(viewer.getPlugin(CommandsPlugin)?.shortcutOf(action.id) ?? action.shortcut)[0]
                return key ? formatShortcut(key) : undefined
            },
            // a control that throws: a toast on the viewer, like the actions of a CommandsPlugin
            onError: (e) => {
                console.error(e)
                viewer.dialog.toast?.(e instanceof Error ? e.message : String(e), {kind: 'error', container: viewer.container})
            },
        })
        body.appendChild(form.element)
        const f = form
        viewer.addEventListener('postFrame', () => f.refresh())
    }
    const content = options.content ? Array.isArray(options.content) ? options.content : [options.content] : []
    if (content.length) {
        const wrap = document.createElement('div')
        wrap.className = 'example-card-content'
        wrap.append(...content)
        body.appendChild(wrap)
    }
    card.appendChild(body)

    // collapsed: only the header shows; kept for the next example
    const setCollapsed = (collapsed: boolean) => {
        card.classList.toggle('example-card-collapsed', collapsed)
        toggle.setAttribute('aria-expanded', String(!collapsed))
        toggle.setAttribute('aria-label', collapsed ? 'Show the example card' : 'Hide the example card')
        toggle.title = collapsed ? 'Show' : 'Hide'
    }
    // a phone starts with the header only, so the canvas is clear; a desktop opens it as it was left last time
    const phone = window.matchMedia(PHONE).matches
    let collapsed = phone
    if (!phone) {
        try {
            collapsed = localStorage.getItem(COLLAPSED_KEY) === '1'
        } catch {
            // no storage (a sandboxed page)
        }
    }
    setCollapsed(collapsed)
    toggle.addEventListener('click', () => {
        collapsed = !collapsed
        setCollapsed(collapsed)
        // what is picked on a phone is not kept: a phone always starts collapsed
        if (window.matchMedia(PHONE).matches) return
        try {
            localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
        } catch {
            // no storage
        }
    })

    viewer.container.appendChild(card)
    /** `body`: the scrolling part of the card, to add more of the example's own elements later */
    return {element: card, body, form}
}

/**
 * A button of the example card that is also an action ({@link CommandAction}): its key works (with the
 * `CommandsPlugin` of the viewer when it has one, see {@link bindActions}), the tooltip shows the key, and it runs
 * through the `CommandsPlugin`, which shows an error in a toast.
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
    // the colours of the Tweakpane theme of the page, else light, or dark with the system
    style.textContent = `
.example-card {
    --ec-bg-0: #ffffff; --ec-fg-0: #1e1e1e; --ec-dim-0: #757575; --ec-line-0: #e6e6e6; --ec-shadow-0: rgba(0, 0, 0, 0.08);
    --ec-bg: var(--tp-base-background-color, var(--ec-bg-0));
    --ec-fg: var(--tp-container-foreground-color, var(--ec-fg-0));
    --ec-dim: var(--tp-label-foreground-color, var(--ec-dim-0));
    --ec-line: var(--tp-container-border-color, var(--ec-line-0));
    --ec-shadow: var(--tp-base-shadow-color, var(--ec-shadow-0));
    position: absolute; z-index: 10000; top: 16px; left: 16px; width: 280px; max-height: calc(100% - 32px);
    display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden;
    background: var(--ec-bg); color: var(--ec-fg); border-radius: 10px;
    box-shadow: 0 0 0 1px var(--ec-line), 0 6px 20px var(--ec-shadow);
    font: 400 12px/1.45 var(--tp-font-family, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif);
}
@media (prefers-color-scheme: dark) {
    body:not([class*='tpTheme-']) .example-card {
        --ec-bg-0: #2c2c2c; --ec-fg-0: #ffffff; --ec-dim-0: #b3b3b3; --ec-line-0: #444444; --ec-shadow-0: rgba(0, 0, 0, 0.3);
    }
}
.example-card-head { display: flex; align-items: center; gap: 2px; padding: 8px 6px 4px 12px; }
.example-card h1 { flex: 1; margin: 0; font-size: 13px; font-weight: 600; line-height: 1.3; }
.example-card-icon { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 5px; color: var(--ec-dim); cursor: pointer; flex-shrink: 0; }
.example-card-icon:hover { background: var(--tp-button-background-color-hover, rgba(127, 127, 127, 0.15)); color: var(--ec-fg); }
.example-card-icon:focus-visible { outline: 2px solid #0d99ff; outline-offset: -2px; }
.example-card-icon svg { width: 16px; height: 16px; }
.example-card-toggle svg { transition: transform .15s; transform: rotate(180deg); }
.example-card-collapsed .example-card-toggle svg { transform: none; }
.example-card-body { overflow-y: auto; padding: 0 6px 6px; }
.example-card-collapsed .example-card-body { display: none; }
.example-card p { margin: 0 6px 6px; color: var(--ec-dim); }
/* the example's own elements, under the controls */
.example-card-content { margin: 6px 6px 0; padding-top: 6px; border-top: 1px solid var(--ec-line); }
.example-card-content:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
/* the controls: the stack of UiConfigForm, flat in the card */
.example-card .ucf-stack { background: none; box-shadow: none; padding: 0; max-height: none; overflow: visible; }
/* a phone: at the bottom, as wide as the page */
@media (max-width: 640px) {
    .example-card { top: auto; bottom: 12px; left: 12px; right: 12px; width: auto; max-height: 40%; }
    .example-card p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
}
`
    document.head.appendChild(style)
}
