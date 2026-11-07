import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import type {UiObjectConfig} from 'uiconfig.js'
import {formatShortcut, isTextTarget, matchShortcut, parseShortcut} from '../../utils/shortcuts'

/** What an action tells after it ran: an error or a warning for the person ({@link CommandsPlugin} shows it in a toast). */
export interface CommandResult {
    error?: string
    warn?: string
}

/**
 * An action: a command that a person runs from a key, a toolbar, a menu or a command palette. A plugin defines it once
 * and registers it with {@link CommandsPlugin.register} (or {@link bindActions}); a UI lists and runs it.
 */
export interface CommandAction {
    /** Unique id, like `'undo'` or `'editorCamera.toggleEditing'`. A new action with the same id replaces the old one. */
    id: string
    /** The name in a menu or a tooltip */
    label: string
    /** An icon for a UI: an SVG string, or the name of an icon of the UI */
    icon?: string
    /**
     * The key, like `'Mod+Z'` (Mod: Cmd on a Mac, Ctrl on other platforms), `'Shift+D'` or `'Delete'`, or a list of keys
     * that run it (`['Delete', 'Backspace']`). See {@link parseShortcut} and {@link matchShortcut}. An app changes it
     * with {@link CommandsPlugin.setShortcut}.
     */
    shortcut?: string | string[]
    /** A group for a UI, like `'Edit'` or `'Camera'` ({@link CommandsPlugin.list}) */
    group?: string
    /** A held key runs the action again on each repeat of the key. Default: `false`, the action runs once per press. */
    repeat?: boolean
    /**
     * When two enabled actions have the same key, the one with the higher priority runs (then the one registered last).
     * Default: `0`. An action that ends a mode (Escape that ends the pivot edit) is above one that acts on the selection
     * (Escape that clears it).
     */
    priority?: number
    /** The action can run now. Default: always. A key of a disabled action is left to other handlers. */
    enabled?(): boolean
    /** Runs the action. It can return (or resolve to) an error or a warning for the person. */
    run(): CommandResult | void | Promise<CommandResult | void>
}

export interface CommandsPluginEventMap extends AViewerPluginEventMap {
    /** An action ran (from its key, {@link CommandsPlugin.run} or a UI). `result` is empty when the action told nothing. */
    actionRun: {action: CommandAction, result: CommandResult}
    /** Actions were registered or unregistered */
    actionsChange: object
}

/**
 * Runs an action and waits for it. The action starts at once (before the first `await`). An error that it throws is
 * logged and returned as the `error` of the result.
 */
async function runAction(action: CommandAction): Promise<CommandResult> {
    try {
        return await action.run() ?? {}
    } catch (e: any) {
        console.error(e)
        return {error: e?.message ?? String(e)}
    }
}

/** The keys of an action ({@link CommandAction.shortcut}) as a list */
export function shortcutsOf(shortcut: string | string[] | null | undefined): string[] {
    return !shortcut ? [] : Array.isArray(shortcut) ? shortcut : [shortcut]
}

type Keys = (action: CommandAction) => string | string[] | null | undefined

/**
 * The action of a key press: of the enabled actions with the key, the one with the highest
 * {@link CommandAction.priority}, then the one last in `actions`. A key that another handler used (`defaultPrevented`),
 * or that is typed in a text field ({@link isTextTarget}), has no action. A held key (`repeat`) has only an action with
 * {@link CommandAction.repeat}.
 */
function shortcutAction(event: KeyboardEvent, actions: readonly CommandAction[], keys: Keys = a => a.shortcut): CommandAction | undefined {
    if (event.defaultPrevented || isTextTarget(event.target)) return undefined
    let found: CommandAction | undefined
    for (const a of actions) {
        if (event.repeat && !a.repeat || !shortcutsOf(keys(a)).some(k => matchShortcut(event, k))) continue
        if (a.enabled && !a.enabled()) continue
        if (!found || (a.priority ?? 0) >= (found.priority ?? 0)) found = a
    }
    return found
}

/** The viewers with actions, by the count of their bindings, and the one that had the last pointer press */
const keyViewers = new Map<ThreeViewer, number>()
let lastViewer: ThreeViewer | undefined

/** The viewers with actions that are on the page: a viewer that was dropped without a dispose takes no key */
const liveViewers = () => [...keyViewers.keys()].filter(v => v.container?.isConnected)
/** The viewer of the target of an event: its canvas, or an element in its container (the window is in none) */
const inViewer = (v: ThreeViewer, t: EventTarget) => {
    try {
        return v.canvas === t || v.container.contains(t as Node)
    } catch {
        return false
    }
}
const viewerOf = (t: EventTarget | null) => t ? liveViewers().find(v => inViewer(v, t)) : undefined
const onViewerPointerDown = (e: PointerEvent) => {
    lastViewer = viewerOf(e.target) ?? lastViewer
}

/** Counts a binding of actions of a viewer, for {@link viewerTakesKey}. @returns a function that takes it out */
function trackViewer(viewer: ThreeViewer | undefined): () => void {
    if (!viewer) return () => {}
    // the browser adds one listener once
    window.addEventListener('pointerdown', onViewerPointerDown, true)
    keyViewers.set(viewer, (keyViewers.get(viewer) ?? 0) + 1)
    let done = false
    return () => {
        if (done) return
        done = true
        const n = (keyViewers.get(viewer) ?? 1) - 1
        if (n > 0) return keyViewers.set(viewer, n)
        keyViewers.delete(viewer)
        if (lastViewer === viewer) lastViewer = undefined
        if (!liveViewers().length) window.removeEventListener('pointerdown', onViewerPointerDown, true)
    }
}

/**
 * The key press is for this viewer, when the page has more viewers with actions: the viewer that has the focus (the
 * target is in its container), else, when the focus is in no viewer (the page, a side panel), the viewer that had the
 * last pointer press (else the first one). With one viewer on the page, every key is for it. A viewer that is not on the
 * page takes a key only when no viewer with actions is.
 * @param viewer - the viewer, or `undefined`: every key
 */
export function viewerTakesKey(viewer: ThreeViewer | undefined, event: KeyboardEvent): boolean {
    if (!viewer) return true
    const live = liveViewers()
    if (!live.includes(viewer)) return !live.length
    if (live.length < 2) return true
    const last = lastViewer && live.includes(lastViewer) ? lastViewer : live[0]
    return (viewerOf(event.target) ?? last) === viewer
}

/**
 * Commands Plugin
 *
 * A registry of actions ({@link CommandAction}): an id, a label, an icon, a shortcut, a group, `enabled()` and `run()`.
 * Plugins register their actions and keys once; any UI (a toolbar, a context menu, a command palette) lists them with
 * {@link list}, shows their keys with {@link formatShortcut} and runs them with {@link run}. The plugin adds no element
 * to the page (its `uiConfig`, a `Commands` folder, lists the actions with their keys for a settings panel), so a plain
 * viewer gets the shortcuts too.
 *
 * - One `keydown` listener on the window runs the shortcuts of all the actions. It leaves a key typed in a text field
 *   (an input, a text area, a select, an editable element) and a key that another handler used (`defaultPrevented`). It
 *   calls `preventDefault` only when an action runs. When two enabled actions have the same key, the one with the
 *   higher {@link CommandAction.priority} runs, then the one registered last. While the plugin is disabled, the keys do
 *   nothing ({@link run} still runs an action).
 * - The app controls the keys here, in one place: {@link setShortcut} changes or removes the key of an action, and
 *   {@link enabled} turns all the keys off (for an app with its own keymap).
 * - With more viewers on the page, a key is for the viewer that has the focus, else for the one used last
 *   ({@link viewerTakesKey}).
 * - `actionRun` tells the result of each run ({@link CommandResult}), and `actionsChange` tells that the list changed.
 *   The `error` and the `warn` of a result show in a toast ({@link toastResults}, `viewer.dialog.toast`; the UI
 *   plugins show it over the canvas).
 * - Plugins that work with and without this plugin bind their actions with {@link bindActions}: registered here while
 *   the viewer has the plugin, else their own key listener runs them, with the same rules.
 *
 * The plugin is not saved with the viewer config ({@link serializeWithViewer} is `false`).
 *
 * @example
 * ```ts
 * const commands = viewer.addPluginSync(CommandsPlugin)
 * const unregister = commands.register({
 *     id: 'resetCamera', label: 'Reset camera', shortcut: 'Shift+R', group: 'Camera',
 *     run: () => {
 *         viewer.scene.mainCamera.position.set(0, 0, 5)
 *         viewer.scene.mainCamera.setDirty()
 *     },
 * })
 * commands.setShortcut('resetCamera', ['Shift+R', 'Home']) // the app sets the keys here
 * commands.list('Camera').map(a => a.label + ' ' + shortcutsOf(commands.shortcutOf(a.id)).map(k => formatShortcut(k)).join(', '))
 * await commands.run('resetCamera')
 * ```
 *
 * @category Plugins
 */
export class CommandsPlugin extends AViewerPluginSync<CommandsPluginEventMap> {
    static readonly PluginType = 'CommandsPlugin'
    enabled = true
    serializeWithViewer = false

    /** Show the `error` and the `warn` of each run of an action in a toast (`viewer.dialog.toast`) */
    toastResults = true

    /** The actions, in the order they were registered */
    private _actions: CommandAction[] = []
    /** The keys that the app set ({@link setShortcut}), by the id of the action; `null`: no key */
    private _shortcuts = new Map<string, string | string[] | null>()
    private _untrack?: () => void

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Commands',
        children: [
            {type: 'checkbox', label: 'Shortcuts', property: [this, 'enabled']},
            {type: 'checkbox', label: 'Toast results', property: [this, 'toastResults']},
            () => this._actions.map(a => ({
                type: 'button',
                label: [a.label, ...shortcutsOf(this.shortcutOf(a.id)).slice(0, 1).map(k => `(${formatShortcut(k)})`)].join(' '),
                disabled: () => !!a.enabled && !a.enabled(),
                value: () => {
                    this.run(a.id)
                },
            })),
        ],
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._untrack = trackViewer(viewer)
        window.addEventListener('keydown', this._onKeyDown)
    }

    onRemove(viewer: ThreeViewer) {
        window.removeEventListener('keydown', this._onKeyDown)
        this._untrack?.()
        this._untrack = undefined
        super.onRemove(viewer)
    }

    /**
     * Adds actions. An action with the id of a registered one replaces it. A shortcut that does not parse
     * ({@link parseShortcut}) is a warning, and its key does nothing.
     * @returns a function that removes these actions (not an action that replaced one of them later)
     */
    register(action: CommandAction | CommandAction[]): () => void {
        const actions = Array.isArray(action) ? action : [action]
        for (const a of actions) {
            warnInvalid(a.id, a.shortcut)
            this._actions = this._actions.filter(b => b.id !== a.id)
            this._actions.push(a)
        }
        this._changed()
        return () => {
            const before = this._actions.length
            this._actions = this._actions.filter(a => !actions.includes(a))
            if (this._actions.length !== before) this._changed()
        }
    }

    /** Removes the action with this id */
    unregister(id: string) {
        const before = this._actions.length
        this._actions = this._actions.filter(a => a.id !== id)
        if (this._actions.length !== before) this._changed()
    }

    get(id: string): CommandAction | undefined {
        return this._actions.find(a => a.id === id)
    }

    /**
     * Changes the key of an action, also of one that is registered later or again. It is the one place where an app
     * sets the keys: another key, more keys, or none.
     * @param id - the id of the action
     * @param shortcut - the key or the keys; `null`: no key; `undefined`: the key of the action again
     */
    setShortcut(id: string, shortcut: string | string[] | null | undefined) {
        if (shortcut === undefined) this._shortcuts.delete(id)
        else {
            warnInvalid(id, shortcut)
            this._shortcuts.set(id, shortcut)
        }
        this._changed()
    }

    /** The key or the keys of an action now: the one set with {@link setShortcut}, else its own */
    shortcutOf(id: string): string | string[] | undefined {
        const set = this._shortcuts.get(id)
        return set === null ? undefined : set ?? this.get(id)?.shortcut
    }

    /**
     * The actions, in the order they were registered
     * @param group - only the actions of this group
     */
    list(group?: string): CommandAction[] {
        return group === undefined ? [...this._actions] : this._actions.filter(a => a.group === group)
    }

    /**
     * Runs an action and sends `actionRun` with its result. An action that throws has the error in its result.
     * @returns the result, or `undefined` when there is no such action or it is not enabled (it does not run then)
     */
    async run(id: string): Promise<CommandResult | undefined> {
        const action = this.get(id)
        if (!action || action.enabled && !action.enabled()) return undefined
        return this._run(action)
    }

    private async _run(action: CommandAction) {
        const result = await runAction(action)
        this.dispatchEvent({type: 'actionRun', action, result})
        const viewer = this._viewer
        if (this.toastResults && viewer) {
            if (result.error) viewer.dialog.toast?.(result.error, {kind: 'error', container: viewer.container})
            if (result.warn) viewer.dialog.toast?.(result.warn, {kind: 'warn', container: viewer.container})
        }
        return result
    }

    private _changed() {
        this.dispatchEvent({type: 'actionsChange'})
        this.uiConfig.uiRefresh?.(true)
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        if (this.isDisabled() || !viewerTakesKey(this._viewer, e)) return
        const action = shortcutAction(e, this._actions, a => this.shortcutOf(a.id))
        if (!action) return
        e.preventDefault()
        this._run(action)
    }
}

/**
 * Binds the actions of a plugin or a UI to a viewer, for the code that works with and without a {@link CommandsPlugin}.
 * While the viewer has a `CommandsPlugin` (also one added or removed later), the actions are registered there: a UI
 * lists them, its key listener runs them and sends `actionRun`. Else a key listener on the window runs their shortcuts,
 * with the same rules (text fields, `defaultPrevented`, `enabled()`, `repeat`, `priority`, the viewer that takes the
 * key, `preventDefault` only when an action runs). So each key has one implementation.
 * @param viewer - the viewer, or `undefined` for the own key listener only
 * @param actions - the actions. To change a shortcut, unbind and bind again: a `CommandsPlugin` then sends
 * `actionsChange` for its UIs.
 * @returns a function that removes the actions and the listeners
 */
export function bindActions(viewer: ThreeViewer | undefined, actions: CommandAction[]): () => void {
    let unbind: (() => void) | undefined
    const untrack = trackViewer(viewer)
    const listen = () => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!viewerTakesKey(viewer, e)) return
            const action = shortcutAction(e, actions)
            if (!action) return
            e.preventDefault()
            runAction(action)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }
    // by its type name: code that only binds actions does not keep the class in a bundle
    const type = 'CommandsPlugin'
    const attach = () => {
        unbind?.()
        const commands = viewer?.getPlugin<CommandsPlugin>(type)
        unbind = commands ? commands.register(actions) : listen()
    }
    // the plugin is still in the viewer during its remove event
    const detach = () => {
        unbind?.()
        unbind = listen()
    }
    attach()
    viewer?.addPluginListener('add', attach, type)
    viewer?.addPluginListener('remove', detach, type)
    return () => {
        viewer?.removePluginListener('add', attach)
        viewer?.removePluginListener('remove', detach)
        unbind?.()
        unbind = undefined
        untrack()
    }
}

function warnInvalid(id: string, shortcut: string | string[] | null | undefined) {
    for (const k of shortcutsOf(shortcut)) if (!parseShortcut(k)) console.warn(`CommandsPlugin: the shortcut "${k}" of "${id}" is not valid`)
}
