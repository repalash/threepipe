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
import {AppToaster, AppToasterOverlay, DialogComponent, DialogProvider, UiConfigRendererContext, VisualStyleProvider, useDialog, useDialogPrompt, useVisualStyle} from 'uiconfig-blueprint/lib/esm/lib'
import {IDialogWrapper, ThreeViewer, windowDialogWrapper} from 'threepipe'
import {EditorContextValue, EditorProvider, useEditor, useEngineEvent, useOnboarding} from './EditorContext'
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
import {Welcome} from './Welcome'
import {Hints} from './Hints'
import {EmptyState} from './EmptyState'
import {HistoryPanel} from './HistoryList'

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

/**
 * `viewer.dialog` (File > New's "unsaved changes" question, Save As's name, Rename) as the editor's own
 * Blueprint dialog instead of the browser's `confirm` / `prompt` boxes, the way `BlueprintJsUiPlugin`
 * swaps in its HTML wrapper. Only while the default window wrapper is in place; restored on unmount.
 */
function useDialogBridge(): void {
    const {prompt} = useDialogPrompt()
    useEffect(() => {
        const previous = ThreeViewer.Dialog
        if (previous !== windowDialogWrapper) return
        const wrapper: IDialogWrapper = {
            alert: async message => {
                await prompt({title: 'Note', message, showInput: false, closeButtonText: 'Close', submitButtonText: 'OK'})
            },
            confirm: async message => (await prompt({title: 'Are you sure?', message, showInput: false, closeButtonText: 'Cancel', submitButtonText: 'OK'})) !== null,
            prompt: async(message, value) => prompt({title: 'Name', message, value: value ?? '', closeButtonText: 'Cancel', submitButtonText: 'OK'}),
            confirmSync: message => previous.confirmSync(message),
        }
        ThreeViewer.Dialog = wrapper
        return () => { if (ThreeViewer.Dialog === wrapper) ThreeViewer.Dialog = previous }
    }, [prompt])
}

/** The right-top pane: the outliner, and the undo history as a tab beside it. */
function SideTabs() {
    const [tab, setTab] = useState<'outliner' | 'history'>(() => {
        try { return localStorage.getItem('meSideTab') === 'history' ? 'history' : 'outliner' } catch { return 'outliner' }
    })
    const pick = (t: 'outliner' | 'history') => {
        setTab(t)
        try { localStorage.setItem('meSideTab', t) } catch { /* private mode */ }
    }
    return <div className="me-side-tabs">
        <div className="me-side-tab-list" role="tablist">
            {(['outliner', 'history'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t}
                className="me-side-tab" data-side-tab={t} onMouseDown={e => e.preventDefault()} onClick={() => pick(t)}>
                {t === 'outliner' ? 'Outliner' : 'History'}
            </button>)}
        </div>
        <div className="me-side-tab-body" role="tabpanel">
            {tab === 'outliner'
                ? <PaneErrorBoundary name="Outliner"><Outliner /></PaneErrorBoundary>
                : <PaneErrorBoundary name="History"><HistoryPanel /></PaneErrorBoundary>}
        </div>
    </div>
}

function Shell({title}: {title?: string}) {
    const {engine, ui} = useEditor()
    const [onboarding] = useOnboarding()
    const contextMenu = useContextMenu()
    const [palette, setPalette] = useState(false)
    const [dialog, setDialog] = useState<'history' | 'shortcuts' | 'about' | null>(null)
    // Blender opens its Quick Setup on the splash while no preferences have been saved (wm_splash_screen.cc:349).
    const [welcome, setWelcome] = useState(() => onboarding.showWelcome)
    const visual = useVisualStyle()
    useDialogBridge()
    const appDialog = useDialog().dialog.isOpen

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
        else if (e.request === 'welcome') setWelcome(true)
        else if (e.request === 'hints') onboarding.resetHints()
        else if (e.request === 'menu') {
            // Where the engine last saw the pointer; a keyboard-opened menu with no pointer yet lands mid-viewport.
            const fallback = engine.viewer.canvas.getBoundingClientRect()
            const clientX = e.clientX || fallback.left + fallback.width / 2
            const clientY = e.clientY || fallback.top + fallback.height / 2
            contextMenu.showItems({clientX, clientY}, e.items, e.title)
        }
    })

    // A trackpad is told once what its gestures do (the welcome's cards show them if it is open).
    useEngineEvent('navigationChanged', e => {
        if (e.source !== 'detected' || e.device !== 'trackpad' || welcome || onboarding.state.trackpadNoticeShown) return
        onboarding.noteTrackpadNotice()
        const g = engine.navigation.gestures('trackpad')
        engine.message('info', `Trackpad detected: ${g.map(x => `${x.gesture.toLowerCase()} to ${x.label.toLowerCase()}`).join(', ')}. Edit > Input Device switches to mouse hints.`)
    })

    // Blender asks before quitting with unsaved changes (wm_quit_with_optional_confirmation_prompt,
    // wm_window.cc:434, on `wm->file_saved`); the page's equivalent is beforeunload.
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!engine.file.dirty || !engine.modelObjects().length) return
            e.preventDefault()
            e.returnValue = ''
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [engine])

    // A dialog or the palette owns the keyboard while it is open; the engine's keymap stands down.
    useEffect(() => {
        if (!dialog && !palette && !welcome && !appDialog) return
        engine.input.suspend('me-overlay')
        return () => engine.input.resume('me-overlay')
    }, [engine, dialog, palette, welcome, appDialog])

    // uiconfig-blueprint components (outliner tree, property folders) read the renderer from this context
    return <UiConfigRendererContext.Provider value={ui as never}><div className="me-root" data-editor-root>
        <Header title={title} />
        <WindowPanesLayout
            left={<PaneErrorBoundary name="Toolbar"><Toolbar /></PaneErrorBoundary>}
            center={<PaneErrorBoundary name="Viewport"><Viewport /></PaneErrorBoundary>}
            centerOverlay={<>
                <PaneErrorBoundary name="Empty state"><EmptyState /></PaneErrorBoundary>
                <PaneErrorBoundary name="Operator panel"><OperatorPanel /></PaneErrorBoundary>
            </>}
            rightTop={<SideTabs />}
            rightBottom={<PaneErrorBoundary name="Properties"><Properties /></PaneErrorBoundary>}
        />
        <PaneErrorBoundary name="Status bar"><StatusBar /></PaneErrorBoundary>
        <CommandPalette isOpen={palette} onClose={() => setPalette(false)} />
        <HistoryDialog isOpen={dialog === 'history'} onClose={() => setDialog(null)} />
        <ShortcutsDialog isOpen={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
        <AboutDialog isOpen={dialog === 'about'} onClose={() => setDialog(null)} />
        <Welcome isOpen={welcome} onClose={() => {
            setWelcome(false)
            onboarding.finishWelcome()
        }} />
        {!welcome && !dialog && !palette && <PaneErrorBoundary name="Hints"><Hints /></PaneErrorBoundary>}
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
