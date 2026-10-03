/**
 * The undo history as a list you can jump around in, as Blender's Edit > Undo History: the first
 * row is the original state (Blender pushes an "Original" step, `undo_system.cc:369`), the current
 * step is marked, undone steps are dimmed, and clicking any row undoes or redoes until that step is
 * the current one (`undo_history_exec` → `ed_undo_step_by_index`, `ed_undo.cc:747`, :313-336).
 * Shared by the Edit > Undo History dialog and the History tab next to the outliner.
 */

import {useEffect, useRef} from 'react'
import {Button} from '@blueprintjs/core'
import {useEditor, useEngineVersion} from './EditorContext'

export function HistoryList({scrollToCurrent = true}: {scrollToCurrent?: boolean}) {
    const {engine} = useEditor()
    useEngineVersion('historyChanged')
    const entries = engine.history.entries()
    const position = engine.history.position
    const list = useRef<HTMLOListElement>(null)
    useEffect(() => {
        if (!scrollToCurrent) return
        list.current?.querySelector('.me-current')?.scrollIntoView({block: 'nearest'})
    }, [position, entries.length, scrollToCurrent])

    const row = (index: number, label: string) => {
        const current = index === position
        return <button type="button" className={'me-history-row' + (current ? ' me-current' : '') + (index > position ? ' me-undone' : '')}
            data-history-index={index} aria-current={current ? 'step' : undefined}
            title={current ? 'The current state' : index > position ? 'Click to redo up to here' : 'Click to undo back to here'}
            onMouseDown={e => e.preventDefault()}
            onClick={() => engine.history.jumpTo(index)}>{label}</button>
    }

    return <div className="me-history-list">
        <div className="me-history-original">{row(-1, 'Original')}</div>
        <ol className="me-history" data-history ref={list}>
            {entries.map((e, i) => <li key={i} className={(i === position ? 'me-current' : '') + (e.undone ? ' me-undone' : '')}>{row(i, e.label)}</li>)}
        </ol>
        {entries.length === 0 && <div className="me-empty">Nothing has been done yet. Every change you make lands here, and Ctrl+Z walks back through it.</div>}
    </div>
}

/** The History tab: the list, with undo / redo buttons. */
export function HistoryPanel() {
    const {engine} = useEditor()
    useEngineVersion('historyChanged')
    return <div className="me-panel me-history-panel" data-history-panel>
        <div className="me-panel-header">
            <span className="me-panel-title">History</span>
            <span className="me-panel-sub">click a step to go back to it</span>
            <span className="me-spacer" />
            <Button variant="minimal" size="small" icon="undo" aria-label="Undo" title="Undo" disabled={!engine.history.canUndo()}
                onMouseDown={e => e.preventDefault()} onClick={() => engine.history.undo()} />
            <Button variant="minimal" size="small" icon="redo" aria-label="Redo" title="Redo" disabled={!engine.history.canRedo()}
                onMouseDown={e => e.preventDefault()} onClick={() => engine.history.redo()} />
        </div>
        <div className="me-panel-body"><HistoryList /></div>
    </div>
}
