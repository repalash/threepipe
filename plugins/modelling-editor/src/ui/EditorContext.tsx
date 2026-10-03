/**
 * React access to the engine. Components subscribe to engine events through `useEngineVersion` and
 * re-render from the engine's getters - no copy of the state lives in React.
 */

import React, {createContext, useContext, useEffect, useMemo, useReducer, useSyncExternalStore} from 'react'
import type {ThreeViewer} from 'threepipe'
import type {EditorEngine, EditorEngineEventMap} from '@threepipe/plugin-editor-engine'
import type {EditorUiPlugin} from './EditorUiPlugin'
import {OnboardingState, OnboardingStore} from '../onboarding/OnboardingStore'

export interface EditorContextValue {
    viewer: ThreeViewer
    engine: EditorEngine
    ui: EditorUiPlugin
    /** First-run state: welcome, hints, the redo panel's default. Absent: onboarding off, nothing remembered. */
    onboarding?: OnboardingStore
}

const Ctx = createContext<(EditorContextValue & {onboarding: OnboardingStore}) | undefined>(undefined)

export function EditorProvider({value, children}: {value: EditorContextValue, children: React.ReactNode}) {
    const full = useMemo(() => ({...value, onboarding: value.onboarding ?? new OnboardingStore({enabled: false, storageKey: null})}), [value])
    return <Ctx.Provider value={full}>{children}</Ctx.Provider>
}

export function useEditor(): EditorContextValue & {onboarding: OnboardingStore} {
    const v = useContext(Ctx)
    if (!v) throw new Error('useEditor: no EditorProvider above this component')
    return v
}

export function useEngine(): EditorEngine {
    return useEditor().engine
}

type EventName = keyof EditorEngineEventMap

/** Subscribe to one engine event. The listener is kept current without re-subscribing. */
export function useEngineEvent<K extends EventName>(type: K, listener: (e: EditorEngineEventMap[K] & {type: K}) => void): void {
    const engine = useEngine()
    const ref = React.useRef(listener)
    ref.current = listener
    useEffect(() => {
        const l = (e: any) => ref.current(e)
        engine.addEventListener(type as never, l as never)
        return () => engine.removeEventListener(type as never, l as never)
    }, [engine, type])
}

/** Re-render whenever any of the given events fires. Returns a counter, handy as a memo key. */
export function useEngineVersion(...events: EventName[]): number {
    const engine = useEngine()
    const [version, bump] = useReducer((v: number) => v + 1, 0)
    useEffect(() => {
        const l = () => bump()
        for (const e of events) engine.addEventListener(e as never, l as never)
        return () => { for (const e of events) engine.removeEventListener(e as never, l as never) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine, events.join('|')])
    return version
}

/** The onboarding store and its current state; re-renders when it changes. */
export function useOnboarding(): [OnboardingStore, OnboardingState] {
    const store = useEditor().onboarding
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
    return [store, state]
}

/** Platform-aware shortcut text: `Ctrl+Z` shows as `⌘Z` on a Mac. */
export function formatShortcut(shortcut: string | undefined): string {
    if (!shortcut) return ''
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    if (!mac) return shortcut
    return shortcut.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧')
}
