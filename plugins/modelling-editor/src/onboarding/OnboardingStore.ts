/**
 * What the first five minutes have shown the user so far: whether the welcome was seen, which of the
 * three start hints are done, how many operations the redo panel has opened for, and the user's own
 * choice about that panel. Kept in `localStorage` (one JSON entry) so a returning user is not greeted
 * again; Help > Welcome and Help > Show Hints Again bring things back.
 *
 * Blender's equivalent is the first-run Quick Setup on the splash screen, remembered in the user
 * preferences; the hints and the redo-panel rule follow the editor research (`ux-patterns.md` §7, §4.1).
 * Shell-side on purpose: none of it changes what an operator does, only what the shell shows.
 */

export type HintId = 'select' | 'edit' | 'move'

/** The hints in the order they are shown. */
export const HINT_ORDER: HintId[] = ['select', 'edit', 'move']

export interface OnboardingState {
    /** The welcome was finished or skipped. */
    welcomeDone: boolean
    /** A hint the user has done (`done`) or closed (`dismissed`). Missing means still to show. */
    hints: Partial<Record<HintId, 'done' | 'dismissed'>>
    /** Operations the redo panel has been shown for. */
    operations: number
    /** `auto`: open for the first operations, then collapsed. `open` / `closed`: the user's own choice. */
    redoPanel: 'auto' | 'open' | 'closed'
    /** The "trackpad detected" note was shown once. */
    trackpadNoticeShown: boolean
}

export interface OnboardingOptions {
    /** Show the welcome and the hints on a first run. Default true. */
    enabled?: boolean
    /** `localStorage` key. `null` keeps the state in memory only. Default `threepipe-editor-onboarding`. */
    storageKey?: string | null
    /** The redo panel opens on its own for this many operations. Default 5; 0 when onboarding is off. */
    redoPanelOperations?: number
}

const DEFAULT_STATE: OnboardingState = {
    welcomeDone: false,
    hints: {},
    operations: 0,
    redoPanel: 'auto',
    trackpadNoticeShown: false,
}

export class OnboardingStore {
    readonly enabled: boolean
    readonly redoPanelOperations: number
    private _key: string | null
    private _state: OnboardingState
    private _listeners = new Set<() => void>()

    constructor(options: OnboardingOptions | boolean = {}) {
        const o = typeof options === 'boolean' ? {enabled: options} : options
        this.enabled = o.enabled !== false
        this.redoPanelOperations = o.redoPanelOperations ?? (this.enabled ? 5 : 0)
        this._key = o.storageKey === undefined ? 'threepipe-editor-onboarding' : o.storageKey
        this._state = {...DEFAULT_STATE, ...this._load()}
    }

    get state(): Readonly<OnboardingState> {
        return this._state
    }

    /** For `useSyncExternalStore`. */
    subscribe = (listener: () => void): (() => void) => {
        this._listeners.add(listener)
        return () => this._listeners.delete(listener)
    }

    getSnapshot = (): OnboardingState => this._state

    /** Should the welcome open by itself now? */
    get showWelcome(): boolean {
        return this.enabled && !this._state.welcomeDone
    }

    finishWelcome(): void {
        this._set({welcomeDone: true})
    }

    /** The hint to show now, given what is still open; null when they are all done or closed. */
    get activeHint(): HintId | null {
        if (!this.enabled || !this._state.welcomeDone) return null
        return HINT_ORDER.find(h => !this._state.hints[h]) ?? null
    }

    completeHint(id: HintId): void {
        if (this._state.hints[id]) return
        this._set({hints: {...this._state.hints, [id]: 'done'}})
    }

    dismissHint(id: HintId): void {
        if (this._state.hints[id]) return
        this._set({hints: {...this._state.hints, [id]: 'dismissed'}})
    }

    dismissAllHints(): void {
        const hints = {...this._state.hints}
        for (const h of HINT_ORDER) hints[h] ??= 'dismissed'
        this._set({hints})
    }

    /** Help > Show Hints Again: every hint is shown again, from the first. */
    resetHints(): void {
        this._set({hints: {}, welcomeDone: true})
    }

    /** A new operation reached the redo panel. */
    noteOperation(): void {
        this._set({operations: this._state.operations + 1})
    }

    /** Whether the redo panel starts open for the current operation. */
    get redoPanelOpen(): boolean {
        const r = this._state.redoPanel
        if (r !== 'auto') return r === 'open'
        return this._state.operations <= this.redoPanelOperations
    }

    /** The user opened or closed the redo panel: from now on that is the rule. */
    setRedoPanel(open: boolean): void {
        this._set({redoPanel: open ? 'open' : 'closed'})
    }

    noteTrackpadNotice(): void {
        this._set({trackpadNoticeShown: true})
    }

    private _set(patch: Partial<OnboardingState>): void {
        this._state = {...this._state, ...patch}
        this._save()
        for (const l of [...this._listeners]) l()
    }

    private _load(): Partial<OnboardingState> {
        if (!this._key) return {}
        try {
            const raw = localStorage.getItem(this._key)
            const parsed = raw ? JSON.parse(raw) : {}
            return parsed && typeof parsed === 'object' ? parsed : {}
        } catch {
            return {}
        }
    }

    private _save(): void {
        if (!this._key) return
        try { localStorage.setItem(this._key, JSON.stringify(this._state)) } catch { /* private mode, quota */ }
    }
}
