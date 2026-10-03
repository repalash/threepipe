/**
 * The application: providers, layout, overlays and the shell's own keys (palette only - everything
 * else belongs to the engine's keymap).
 *
 * Provider stack follows `experiments/threepipe-blueprint-editor/src/App.tsx`: Blueprint →
 * VisualStyle (dark/light) → Dialog → ContextMenu, with the toaster overlay last.
 */

import React, {useEffect, useState} from 'react'
import {BlueprintProvider} from '@blueprintjs/core'
import {AppToaster, AppToasterOverlay, DialogComponent, DialogProvider, UiConfigRendererContext, VisualStyleProvider, useVisualStyle} from 'uiconfig-blueprint/lib/esm/lib'
import {EditorContextValue, EditorProvider, useEditor, useEngineEvent} from './EditorContext'
import {ContextMenuProvider} from './ContextMenuProvider'
import {WindowPanesLayout} from './WindowPanesLayout'
import {Header} from './Header'
import {Toolbar} from './Toolbar'
import {Viewport} from './Viewport'
import {Outliner} from './Outliner'
import {Properties} from './Properties'
import {OperatorPanel} from './OperatorPanel'
import {StatusBar} from './StatusBar'
import {CommandPalette} from './CommandPalette'
import {AboutDialog, HistoryDialog, ShortcutsDialog} from './Dialogs'

export interface ModellingEditorAppProps {
    value: EditorContextValue
    title?: string
}

/** Keeps one broken pane from blanking the whole editor; the error is shown in place. */
class PaneErrorBoundary extends React.Component<{name: string, children: React.ReactNode}, {error: Error | null}> {
    state = {error: null as Error | null}
    static getDerivedStateFromError(error: Error) { return {error} }
    componentDidCatch(error: Error) { console.error(`modelling-editor: ${this.props.name} failed to render`, error) }
    render() {
        if (this.state.error) return <div className="me-empty me-pane-error" data-pane-error={this.props.name}>
            <div><b>{this.props.name}</b> failed to render.</div>
            <div className="me-empty-hint">{this.state.error.message}</div>
        </div>
        return this.props.children
    }
}

function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el || !el.tagName) return false
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable
}

function Shell({title}: {title?: string}) {
    const {engine, ui} = useEditor()
    const [palette, setPalette] = useState(false)
    const [dialog, setDialog] = useState<'history' | 'shortcuts' | 'about' | null>(null)
    const visual = useVisualStyle()

    // The editor is dark by default; the theme menu can still switch it.
    useEffect(() => {
        if (localStorage.getItem('bpUiDarkMode') === null && !visual.darkMode) visual.setDarkMode(true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEngineEvent('message', e => {
        AppToaster().show({
            message: e.text,
            intent: e.level === 'error' ? 'danger' : e.level === 'warning' ? 'warning' : 'primary',
            icon: e.level === 'error' ? 'error' : e.level === 'warning' ? 'warning-sign' : 'info-sign',
            timeout: e.level === 'error' ? 6000 : 3500,
            isCloseButtonShown: true,
        })
    })
    useEngineEvent('uiRequest', e => {
        if (e.request === 'palette') setPalette(true)
        else if (e.request === 'history' || e.request === 'shortcuts' || e.request === 'about') setDialog(e.request)
    })

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey
            if ((mod && e.code === 'KeyK') || e.code === 'F3') {
                if (isTypingTarget(e.target) && !mod) return
                e.preventDefault()
                e.stopPropagation()
                setPalette(p => !p)
            } else if (e.code === 'F9' && !isTypingTarget(e.target)) {
                e.preventDefault()
                engine.run('edit.repeat_last')
            }
        }
        // capture phase: the palette must open even while the engine's own window listeners are live
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [engine])

    // uiconfig-blueprint components (outliner tree, property folders) read the renderer from this context
    return <UiConfigRendererContext.Provider value={ui as never}><div className="me-root" data-editor-root>
        <Header title={title} />
        <WindowPanesLayout
            left={<PaneErrorBoundary name="Toolbar"><Toolbar /></PaneErrorBoundary>}
            center={<PaneErrorBoundary name="Viewport"><Viewport /></PaneErrorBoundary>}
            centerOverlay={<PaneErrorBoundary name="Operator panel"><OperatorPanel /></PaneErrorBoundary>}
            rightTop={<PaneErrorBoundary name="Outliner"><Outliner /></PaneErrorBoundary>}
            rightBottom={<PaneErrorBoundary name="Properties"><Properties /></PaneErrorBoundary>}
        />
        <PaneErrorBoundary name="Status bar"><StatusBar /></PaneErrorBoundary>
        <CommandPalette isOpen={palette} onClose={() => setPalette(false)} />
        <HistoryDialog isOpen={dialog === 'history'} onClose={() => setDialog(null)} />
        <ShortcutsDialog isOpen={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
        <AboutDialog isOpen={dialog === 'about'} onClose={() => setDialog(null)} />
        <DialogComponent />
        <AppToasterOverlay />
    </div></UiConfigRendererContext.Provider>
}

export function ModellingEditorApp({value, title}: ModellingEditorAppProps) {
    return <BlueprintProvider>
        <VisualStyleProvider>
            <DialogProvider>
                <EditorProvider value={value}>
                    <ContextMenuProvider>
                        <Shell title={title} />
                    </ContextMenuProvider>
                </EditorProvider>
            </DialogProvider>
        </VisualStyleProvider>
    </BlueprintProvider>
}
