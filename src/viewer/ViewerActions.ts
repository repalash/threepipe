import {EventDispatcher} from 'three'
import type {UiObjectConfig} from 'uiconfig.js'
import {formatShortcut, isTargetKey, matchShortcut, parseShortcut} from '../utils/shortcuts'
import type {ThreeViewer} from './ThreeViewer'

/** What an action tells after it ran: an error or a warning for the person ({@link ViewerActions} shows it in a toast). */
export interface ViewerActionResult {
    error?: string
    warn?: string
}

/**
 * An action: a command that a person runs from a key, a toolbar, a menu or a command palette. A plugin defines it once
 * and registers it with `viewer.actions.register` ({@link ViewerActions.register}); a UI lists and runs it.
 */
export interface ViewerAction {
    /** Unique id, like `'undo'` or `'editorCamera.toggleEditing'`. A new action with the same id replaces the old one. */
    id: string
    /** The name in a menu or a tooltip */
    label: string
    /** An icon for a UI: an SVG string, or the name of an icon of the UI */
    icon?: string
    /**
     * The key, like `'Mod+Z'` (Mod: Cmd on a Mac, Ctrl on other platforms), `'Shift+D'` or `'Delete'`, or a list of keys
     * that run it (`['Delete', 'Backspace']`). See {@link parseShortcut} and {@link matchShortcut}. An app changes it
     * with {@link ViewerActions.setShortcut}.
     */
    shortcut?: string | string[]
    /** A group for a UI, like `'Edit'` or `'Camera'` ({@link ViewerActions.list}) */
    group?: string
    /** A held key runs the action again on each repeat of the key. Default: `false`, the action runs once per press. */
    repeat?: boolean
    /**
     * When two enabled actions have the same key, the one with the higher priority runs (then the one registered last).
     * Default: `0`. An action that ends a mode (Escape that ends the pivot edit) is above one that acts on the selection
     * (Escape that clears it).
     */
    priority?: number
    /**
     * The key runs before the handlers of the element with the focus (in the capture phase on the window), and the key
     * stops there. For a key of an open card that must win over a key of the canvas: the arrows of an open annotation
     * over the arrow keys of the camera controls. It runs only while the focus is in the viewer (its canvas, a card in
     * its container) or on the page, so a focused panel (a list) keeps its keys. Default: `false`, a focused element has
     * its keys first.
     */
    capture?: boolean
    /** The action can run now. Default: always. A key of a disabled action is left to other handlers. */
    enabled?(): boolean
    /** Runs the action. It can return (or resolve to) an error or a warning for the person. */
    run(): ViewerActionResult | void | Promise<ViewerActionResult | void>
}

export interface ViewerActionsEventMap {
    /** An action ran (from its key, {@link ViewerActions.run} or a UI). `result` is empty when the action told nothing. */
    actionRun: {action: ViewerAction, result: ViewerActionResult}
    /** Actions were registered or unregistered, or a key changed ({@link ViewerActions.setShortcut}) */
    actionsChange: object
}

/**
 * Runs an action and waits for it. The action starts at once (before the first `await`). An error that it throws is
 * logged and returned as the `error` of the result.
 */
async function runAction(action: ViewerAction): Promise<ViewerActionResult> {
    try {
        return await action.run() ?? {}
    } catch (e: any) {
        console.error(e)
        return {error: e?.message ?? String(e)}
    }
}

/** The keys of an action ({@link ViewerAction.shortcut}) as a list */
export function shortcutsOf(shortcut: string | string[] | null | undefined): string[] {
    return !shortcut ? [] : Array.isArray(shortcut) ? shortcut : [shortcut]
}

/**
 * The action of a key press, of the actions of that phase ({@link ViewerAction.capture}): of the enabled actions with
 * the key, the one with the highest {@link ViewerAction.priority}, then the one last in `actions`. A key that another
 * handler used (`defaultPrevented`), or that belongs to the element with the focus ({@link isTargetKey}: a text field,
 * Space on a button), has no action. A held key (`repeat`) has only an action with {@link ViewerAction.repeat}.
 */
function shortcutAction(event: KeyboardEvent, actions: readonly ViewerAction[], capture: boolean, keys: (action: ViewerAction) => string | string[] | undefined): ViewerAction | undefined {
    if (event.defaultPrevented || isTargetKey(event)) return undefined
    let found: ViewerAction | undefined
    for (const a of actions) {
        if (!!a.capture !== capture || event.repeat && !a.repeat || !shortcutsOf(keys(a)).some(k => matchShortcut(event, k))) continue
        if (a.enabled && !a.enabled()) continue
        if (!found || (a.priority ?? 0) >= (found.priority ?? 0)) found = a
    }
    return found
}

/** The viewers whose actions listen to keys, and the one that had the last pointer press */
const keyViewers = new Set<ThreeViewer>()
let lastViewer: ThreeViewer | undefined

/** The viewers with actions that are on the page: a viewer that was dropped without a dispose takes no key */
const liveViewers = () => [...keyViewers].filter(v => v.container?.isConnected)
/** The viewer of the target of an event: its canvas, or an element in its container (the window is in none) */
const inViewer = (v: ThreeViewer, t: EventTarget) => {
    try {
        return v.canvas === t || v.container.contains(t as Node)
    } catch {
        return false
    }
}
/** The page: no element (the window, the document), the body or the root element. It belongs to no viewer, also when
 * a viewer has the body as its container. */
const isPageTarget = (t: EventTarget | null) => {
    const n = t as Node | null
    return !n || typeof n.nodeType !== 'number' || n.nodeType === 9 ||
        typeof document !== 'undefined' && (n === document.body || n === document.documentElement)
}
const viewerOf = (t: EventTarget | null) => {
    if (isPageTarget(t)) return undefined
    const live = liveViewers()
    // its canvas first: viewers can share a container (two canvases in one element)
    const own = live.find(v => v.canvas === t)
    if (own) return own
    // else the innermost container that has the target, for nested containers
    const found = live.filter(v => inViewer(v, t!))
    return found.find(v => found.every(o => o.container === v.container || !v.container.contains(o.container)))
}
/** The focus is in the viewer or on the page (the body, or no target): a capture action can take the key */
const focusForCapture = (viewer: ThreeViewer | undefined, e: KeyboardEvent) => {
    if (isPageTarget(e.target)) return true
    return !!viewer && inViewer(viewer, e.target!)
}
const onViewerPointerDown = (e: PointerEvent) => {
    lastViewer = viewerOf(e.target) ?? lastViewer
}

/**
 * The page has an open modal dialog (`<dialog>` opened with `showModal()`) that does not hold the container of this
 * viewer: the rest of the page is inert then, so its keys must not run the actions behind the dialog.
 */
function modalDialogOver(viewer: ThreeViewer | undefined): boolean {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return false
    let modals: ArrayLike<Element>
    try {
        modals = document.querySelectorAll('dialog:modal')
    } catch { // no :modal (Safari before 15.6): no check, suspend() still works
        return false
    }
    const container = viewer?.container
    return Array.from(modals).some(d => !container || !d.contains(container))
}

/** Adds a viewer to {@link keyViewers}, for {@link viewerTakesKey}. @returns a function that takes it out */
function trackViewer(viewer: ThreeViewer): () => void {
    // the browser adds one listener once
    window.addEventListener('pointerdown', onViewerPointerDown, true)
    keyViewers.add(viewer)
    return () => {
        keyViewers.delete(viewer)
        if (lastViewer === viewer) lastViewer = undefined
        if (!keyViewers.size) window.removeEventListener('pointerdown', onViewerPointerDown, true)
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

function warnInvalid(id: string, shortcut: string | string[] | null | undefined) {
    for (const k of shortcutsOf(shortcut)) if (!parseShortcut(k)) console.warn(`ViewerActions: the shortcut "${k}" of "${id}" is not valid`)
}

/**
 * The actions of a viewer (`viewer.actions`): a registry of {@link ViewerAction}s, each with an id, a label, an icon, a
 * shortcut, a group, `enabled()` and `run()`. Plugins register their actions and keys once (in `onAdded`, and remove
 * them in `onRemove`); any UI (a toolbar, a context menu, a command palette, a sheet of the keys) lists them with
 * {@link list}, shows their keys with {@link formatShortcut} and runs them with {@link run}. Each viewer has one, and it
 * adds no element to the page. Its {@link uiConfig} (an `Actions` folder: the keys on or off, and the actions with their
 * keys) shows only where an app or a UI adds it.
 *
 * - A `keydown` listener on the window runs the shortcuts of the actions, while it has actions. It leaves a
 *   key typed in a text field (an input, a text area, a select, an editable element) and a key that another handler
 *   used (`defaultPrevented`). It calls `preventDefault` only when an action runs. When two enabled actions have the
 *   same key, the one with the higher {@link ViewerAction.priority} runs, then the one registered last.
 * - The app controls the keys here, in one place: {@link setShortcut} changes or removes the key of an action, and
 *   {@link enabled} turns all the keys off (for an app with its own keymap; {@link run} still runs an action).
 * - With more viewers on the page, a key is for the viewer that has the focus, else for the one used last
 *   ({@link viewerTakesKey}).
 * - `actionRun` tells the result of each run ({@link ViewerActionResult}), and `actionsChange` tells that the list or a
 *   key changed. The `error` and the `warn` of a result show in a toast ({@link toastResults}, `viewer.dialog.toast`).
 * - {@link suspend} and {@link resume} turn the keys off for a while (an app's own modal UI); while the page has an
 *   open modal `<dialog>` the keys are also off, without code ({@link suspended}).
 * - Without a viewer (`new ViewerActions()`), for a UI that is not part of one: it takes every key and shows no toast.
 *
 * @example
 * ```ts
 * const unregister = viewer.actions.register({
 *     id: 'resetCamera', label: 'Reset camera', shortcut: 'Shift+R', group: 'Camera',
 *     run: () => {
 *         viewer.scene.mainCamera.position.set(0, 0, 5)
 *         viewer.scene.mainCamera.setDirty()
 *     },
 * })
 * viewer.actions.setShortcut('resetCamera', ['Shift+R', 'Home']) // the app sets the keys here
 * viewer.actions.list('Camera').map(a => a.label + ' ' + shortcutsOf(viewer.actions.shortcutOf(a.id)).map(k => formatShortcut(k)).join(', '))
 * await viewer.actions.run('resetCamera')
 * ```
 */
export class ViewerActions extends EventDispatcher<ViewerActionsEventMap> {
    /** The keys run the actions. Off: no key runs an action ({@link run} still does). */
    enabled = true

    /** Show the `error` and the `warn` of each run of an action in a toast (`viewer.dialog.toast`) */
    toastResults = true

    /** The viewer, or `undefined` for actions that are not part of one (they take every key) */
    readonly viewer?: ThreeViewer

    /** The actions, in the order they were registered */
    private _actions: ViewerAction[] = []
    /** The keys that the app set ({@link setShortcut}), by the id of the action; `null`: no key */
    private _shortcuts = new Map<string, string | string[] | null>()
    /** The key listeners are on the window: while it has actions, until {@link dispose} */
    private _listening = false
    private _untrack?: () => void
    private _disposed = false
    private _suspends = 0

    /** For a settings panel: the keys on or off, the toasts on or off, and a button for each action with its key */
    readonly uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Actions',
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

    constructor(viewer?: ThreeViewer) {
        super()
        this.viewer = viewer
    }

    /**
     * Adds actions. An action with the id of a registered one replaces it. A shortcut that does not parse
     * ({@link parseShortcut}) is a warning, and its key does nothing.
     * @returns a function that removes these actions (not an action that replaced one of them later)
     */
    register(action: ViewerAction | ViewerAction[]): () => void {
        const actions = Array.isArray(action) ? action : [action]
        for (const a of actions) {
            warnInvalid(a.id, a.shortcut)
            this._actions = this._actions.filter(b => b.id !== a.id)
            this._actions.push(a)
        }
        this._listen()
        this._changed()
        return () => this._remove(a => actions.includes(a))
    }

    /** Removes the action with this id */
    unregister(id: string) {
        this._remove(a => a.id === id)
    }

    get(id: string): ViewerAction | undefined {
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

    /** The key or the keys of an action now: the one set with {@link setShortcut}, else its own; `undefined`: no key */
    shortcutOf(id: string): string | string[] | undefined {
        const set = this._shortcuts.get(id)
        return set === null ? undefined : set ?? this.get(id)?.shortcut
    }

    /**
     * The actions, in the order they were registered
     * @param group - only the actions of this group
     */
    list(group?: string): ViewerAction[] {
        return group === undefined ? [...this._actions] : this._actions.filter(a => a.group === group)
    }

    /**
     * Runs an action and sends `actionRun` with its result. An action that throws has the error in its result.
     * @returns the result, or `undefined` when there is no such action or it is not enabled (it does not run then)
     */
    async run(id: string): Promise<ViewerActionResult | undefined> {
        const action = this.get(id)
        if (!action || action.enabled && !action.enabled()) return undefined
        return this._run(action)
    }

    /**
     * Turns the keys off until {@link resume} (for a modal UI that is not a `<dialog>`). The calls are counted: the keys
     * run again after one `resume` for each `suspend`. {@link run} still runs an action.
     */
    suspend() {
        this._suspends++
    }

    /** Ends one {@link suspend} */
    resume() {
        if (this._suspends > 0) this._suspends--
    }

    /**
     * No key runs an action now: a {@link suspend} is not resumed, or the page has an open modal `<dialog>` (one opened
     * with `showModal()`) that does not hold the container of the viewer. Not {@link enabled}, which the app sets.
     */
    get suspended(): boolean {
        return this._suspends > 0 || modalDialogOver(this.viewer)
    }

    /** Removes the key listeners. Called by the viewer when it is disposed. */
    dispose() {
        this._disposed = true
        this._stopListening()
    }

    private _remove(match: (a: ViewerAction) => boolean) {
        const before = this._actions.length
        this._actions = this._actions.filter(a => !match(a))
        if (this._actions.length === before) return
        // no actions: no listeners, and with more viewers on the page this one takes no key (viewerTakesKey)
        if (!this._actions.length) this._stopListening()
        this._changed()
    }

    private _stopListening() {
        if (!this._listening) return
        window.removeEventListener('keydown', this._onKeyDown)
        window.removeEventListener('keydown', this._onKeyDownCapture, true)
        this._untrack?.()
        this._untrack = undefined
        this._listening = false
    }

    private _listen() {
        if (this._listening || this._disposed || typeof window === 'undefined') return
        this._listening = true
        if (this.viewer) this._untrack = trackViewer(this.viewer)
        window.addEventListener('keydown', this._onKeyDown)
        window.addEventListener('keydown', this._onKeyDownCapture, true)
    }

    private async _run(action: ViewerAction) {
        const result = await runAction(action)
        this.dispatchEvent({type: 'actionRun', action, result})
        const viewer = this.viewer
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

    private _onKey(e: KeyboardEvent, capture: boolean) {
        if (!this.enabled || !viewerTakesKey(this.viewer, e) || capture && !focusForCapture(this.viewer, e)) return
        // the key of each action now: the one that the app set, else its own (no search by id for each action)
        const action = shortcutAction(e, this._actions, capture, a => {
            const set = this._shortcuts.get(a.id)
            return set === null ? undefined : set ?? a.shortcut
        })
        // the modal check last: a query of the page, only for a key of an action
        if (!action || this.suspended) return
        e.preventDefault()
        if (capture) e.stopPropagation()
        this._run(action)
    }

    private _onKeyDown = (e: KeyboardEvent) => this._onKey(e, false)
    private _onKeyDownCapture = (e: KeyboardEvent) => this._onKey(e, true)
}
