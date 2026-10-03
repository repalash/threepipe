/**
 * The application: providers, layout and overlays. The shell has no keys of its own: the palette,
 * F9 and everything else are bindings in the engine's keymap, and the engine asks for the shell's
 * surfaces through `uiRequest`.
 *
 * Provider stack follows `experiments/threepipe-blueprint-editor/src/App.tsx`: Blueprint →
 * VisualStyle (dark/light) → Dialog → ContextMenu, with the toaster overlay last.
 */

import React, {useEffect, useState} from 'react'
import {BlueprintProvider} from '@blueprintjs/core'
import {AppToaster, AppToasterOverlay, DialogComponent, DialogProvider, UiConfigRendererContext, VisualStyleProvider, useVisualStyle} from 'uiconfig-blueprint/lib/esm/lib'
import {EditorContextValue, EditorProvider, useEditor, useEngineEvent} from './EditorContext'
import {ContextMenuProvider, useContextMenu} from './ContextMenuProvider'
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

function Shell({title}: {title?: string}) {
    const {engine, ui} = useEditor()
    const contextMenu = useContextMenu()
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
        if (e.request === 'palette') setPalette(p => !p)
        else if (e.request === 'history' || e.request === 'shortcuts' || e.request === 'about') setDialog(e.request)
        else if (e.request === 'menu') {
            // Where the engine last saw the pointer; a keyboard-opened menu with no pointer yet lands mid-viewport.
            const fallback = engine.viewer.canvas.getBoundingClientRect()
            const clientX = e.clientX || fallback.left + fallback.width / 2
            const clientY = e.clientY || fallback.top + fallback.height / 2
            contextMenu.showItems({clientX, clientY}, e.items, e.title)
        }
    })

    // A dialog or the palette owns the keyboard while it is open; the engine's keymap stands down.
    useEffect(() => {
        if (!dialog && !palette) return
        engine.input.suspend('me-overlay')
        return () => engine.input.resume('me-overlay')
    }, [engine, dialog, palette])

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
