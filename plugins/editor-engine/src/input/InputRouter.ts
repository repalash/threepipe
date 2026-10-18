/**
 * The one owner of viewport keys.
 *
 * Listens for `keydown` on the window in the capture phase, so it sees a key before the plugins'
 * own listeners (`PickingPlugin`, `MeshEditPlugin`, `JSUndoManager`'s Ctrl+Z on the document) and
 * can stop it reaching them when the keymap consumed it. Those listeners are also switched off by
 * flag while the engine is present; the capture-phase stop is what guarantees one action per key
 * even for a plugin that does not know about the flag.
 *
 * Order of precedence, as in Blender's event system: a running modal operator owns every key; then
 * the active keymap for the current mode; then nothing (the event continues to the page).
 *
 * Focus-aware: keys typed into an input, textarea, select or contenteditable belong to it; Space and
 * Enter on a focused button activate the button. The host can add its own veto through `filter`
 * (the shell vetoes while a dialog is open) and can `suspend` the router outright.
 */

import type {EditorMode, InputApi, KeyBinding} from '../registry'
import {Keymap} from '../keymap/Keymap'

export interface InputRouterHost {
    /** The element whose keys belong to the viewport. Pointer position is tracked on it. */
    canvas: HTMLCanvasElement
    mode(): EditorMode
    keymap(): Keymap
    /** A modal operator owns the key: handle it and return true, or return false to fall through. */
    handleModalKey(event: KeyboardEvent): boolean
    /** Dispatch a binding (operator or tool). */
    dispatch(binding: KeyBinding, event: KeyboardEvent): void
    /** Space pressed / released (Figma pan); `null` when the preset does not use it. */
    onSpace?(down: boolean): void
}

function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el || !el.tagName) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function isButtonActivation(event: KeyboardEvent): boolean {
    const el = event.target as HTMLElement | null
    if (!el || !el.tagName) return false
    const tag = el.tagName
    const role = el.getAttribute?.('role')
    const buttonLike = tag === 'BUTTON' || tag === 'A' || role === 'button' || role === 'menuitem' || role === 'tab'
    return buttonLike && (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter')
}

export class InputRouter implements InputApi {
    private _suspenders = new Set<unknown>()
    private _spaceDown = false
    readonly pointer = {clientX: 0, clientY: 0}
    filter: ((event: KeyboardEvent) => boolean) | null = null

    constructor(private _host: InputRouterHost) {
        window.addEventListener('keydown', this._onKeyDown, true)
        window.addEventListener('keyup', this._onKeyUp, true)
        window.addEventListener('blur', this._onBlur)
        _host.canvas.addEventListener('pointermove', this._onPointerMove)
        _host.canvas.addEventListener('pointerdown', this._onPointerMove)
    }

    dispose(): void {
        window.removeEventListener('keydown', this._onKeyDown, true)
        window.removeEventListener('keyup', this._onKeyUp, true)
        window.removeEventListener('blur', this._onBlur)
        this._host.canvas.removeEventListener('pointermove', this._onPointerMove)
        this._host.canvas.removeEventListener('pointerdown', this._onPointerMove)
        if (this._spaceDown) this._setSpace(false)
    }

    suspend(key: unknown): void {
        this._suspenders.add(key)
    }

    resume(key: unknown): void {
        this._suspenders.delete(key)
    }

    get suspended(): boolean {
        return this._suspenders.size > 0
    }

    /** Would this event be handled by the viewport keymap at all? Exposed for tests and the shell. */
    accepts(event: KeyboardEvent): boolean {
        if (this.suspended) return false
        if (isTypingTarget(event.target) || isButtonActivation(event)) return false
        if (this.filter && !this.filter(event)) return false
        return true
    }

    /**
     * Route one key event. Returns the binding that ran, `'modal'` when a modal operator took it, or
     * null when nothing did. Split from the listener so it can be driven without a DOM.
     */
    route(event: KeyboardEvent): KeyBinding | 'modal' | null {
        if (!this.accepts(event)) return null

        if (this._host.handleModalKey(event)) {
            event.preventDefault()
            event.stopPropagation()
            return 'modal'
        }

        if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey && this._host.onSpace) {
            if (!event.repeat) this._setSpace(true)
            event.preventDefault()
            return null
        }

        const binding = this._host.keymap().lookup(event, this._host.mode())
        if (!binding) return null
        if (event.repeat && !binding.repeat) {
            event.preventDefault()
            return null
        }
        event.preventDefault()
        event.stopPropagation()
        this._host.dispatch(binding, event)
        return binding
    }

    private _onKeyDown = (event: KeyboardEvent): void => {
        this.route(event)
    }

    private _onKeyUp = (event: KeyboardEvent): void => {
        if (event.code === 'Space' && this._spaceDown) this._setSpace(false)
    }

    private _onBlur = (): void => {
        if (this._spaceDown) this._setSpace(false)
    }

    private _setSpace(down: boolean): void {
        this._spaceDown = down
        this._host.onSpace?.(down)
    }

    private _onPointerMove = (event: PointerEvent): void => {
        this.pointer.clientX = event.clientX
        this.pointer.clientY = event.clientY
    }
}
