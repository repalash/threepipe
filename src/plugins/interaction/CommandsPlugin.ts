import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import type {UiObjectConfig} from 'uiconfig.js'
import {formatShortcut, isTextTarget, matchShortcut, parseShortcut} from '../../utils/shortcuts'

/** What an action tells after it ran: an error or a warning for the person (an editor shows it in a toast). */
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
    /** The key, like `'Mod+Z'` (Mod: Cmd on a Mac, Ctrl on other platforms), `'Shift+D'` or `'Delete'`. See {@link parseShortcut} and {@link matchShortcut}. */
    shortcut?: string
    /** A group for a UI, like `'Edit'` or `'Camera'` ({@link CommandsPlugin.list}) */
    group?: string
    /** A held key runs the action again on each repeat of the key. Default: `false`, the action runs once per press. */
    repeat?: boolean
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

/**
 * The action of a key press: the last one in `actions` that has the shortcut of the key and is enabled. A key that
 * another handler used (`defaultPrevented`), or that is typed in a text field ({@link isTextTarget}), has no action. A
 * held key (`repeat`) has only an action with {@link CommandAction.repeat}.
 */
function shortcutAction(event: KeyboardEvent, actions: readonly CommandAction[]): CommandAction | undefined {
    if (event.defaultPrevented || isTextTarget(event.target)) return undefined
    for (let i = actions.length - 1; i >= 0; i--) {
        const a = actions[i]
        if (!a.shortcut || event.repeat && !a.repeat || !matchShortcut(event, a.shortcut)) continue
        if (!a.enabled || a.enabled()) return a
    }
    return undefined
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
 *   calls `preventDefault` only when an action runs. When two enabled actions have the same key, the one registered
 *   last runs. While the plugin is disabled, the keys do nothing ({@link run} still runs an action).
 * - `actionRun` tells the result of each run ({@link CommandResult}: an error or a warning for the person; the
 *   tweakpane editor shows it in a toast), and `actionsChange` tells that the list changed.
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
 * commands.addEventListener('actionRun', ({action, result}) => result.error && alert(result.error))
 * commands.list('Camera').map(a => a.label + ' ' + formatShortcut(a.shortcut ?? ''))
 * await commands.run('resetCamera')
 * ```
 *
 * @category Plugins
 */
export class CommandsPlugin extends AViewerPluginSync<CommandsPluginEventMap> {
    static readonly PluginType = 'CommandsPlugin'
    enabled = true
    serializeWithViewer = false

    /** The actions, in the order they were registered */
    private _actions: CommandAction[] = []

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Commands',
        children: [
            {type: 'checkbox', label: 'Shortcuts', property: [this, 'enabled']},
            () => this._actions.map(a => ({
                type: 'button',
                label: a.shortcut ? `${a.label} (${formatShortcut(a.shortcut)})` : a.label,
                disabled: () => !!a.enabled && !a.enabled(),
                value: () => {
                    this.run(a.id)
                },
            })),
        ],
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        window.addEventListener('keydown', this._onKeyDown)
    }

    onRemove(viewer: ThreeViewer) {
        window.removeEventListener('keydown', this._onKeyDown)
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
            if (a.shortcut && !parseShortcut(a.shortcut)) console.warn(`CommandsPlugin: the shortcut "${a.shortcut}" of "${a.id}" is not valid`)
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
        return result
    }

    private _changed() {
        this.dispatchEvent({type: 'actionsChange'})
        this.uiConfig.uiRefresh?.(true)
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        if (this.isDisabled()) return
        const action = shortcutAction(e, this._actions)
        if (!action) return
        e.preventDefault()
        this._run(action)
    }
}

/**
 * Binds the actions of a plugin or a UI to a viewer, for the code that works with and without a {@link CommandsPlugin}.
 * While the viewer has a `CommandsPlugin` (also one added or removed later), the actions are registered there: a UI
 * lists them, its key listener runs them and sends `actionRun`. Else a key listener on the window runs their shortcuts,
 * with the same rules (text fields, `defaultPrevented`, `enabled()`, `repeat`, `preventDefault` only when an action
 * runs). So each key has one implementation.
 * @param viewer - the viewer, or `undefined` for the own key listener only
 * @param actions - the actions. To change a shortcut, unbind and bind again: a `CommandsPlugin` then sends
 * `actionsChange` for its UIs.
 * @returns a function that removes the actions and the listeners
 */
export function bindActions(viewer: ThreeViewer | undefined, actions: CommandAction[]): () => void {
    let unbind: (() => void) | undefined
    const listen = () => {
        const onKeyDown = (e: KeyboardEvent) => {
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
    }
}
