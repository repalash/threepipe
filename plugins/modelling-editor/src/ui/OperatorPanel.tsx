/**
 * The redo-last ("Adjust Last Operation") panel, bottom-left of the viewport.
 *
 * Shows `engine.lastOperation`: its label and a form for its props. Editing a value calls
 * `redo(newProps)`, which the engine implements as pop-undo + re-exec (Blender's
 * `ED_undo_operator_repeat`). Operators without `redo` show their values read-only and say why.
 *
 * Open or collapsed: Blender keeps the panel open, which is what makes "you don't have to get the
 * numbers right the first time" discoverable (`ux-patterns.md` §4.1) but crowds the view later. So
 * it opens by itself for the first few operations (the onboarding store counts them), then stays
 * collapsed - unless the user opened or closed it by hand, which from then on is the rule. F9
 * (Adjust Last Operation) opens it for the current operation either way.
 */

import {useEffect, useRef, useState} from 'react'
import {Button, Collapse} from '@blueprintjs/core'
import type {LastOperation} from '@threepipe/plugin-editor-engine'
import {useEditor, useEngineEvent, useEngineVersion, useOnboarding} from './EditorContext'
import {PropsForm} from './PropsForm'

export function OperatorPanel() {
    const {engine} = useEditor()
    const [store, onboarding] = useOnboarding()
    useEngineVersion('lastOperationChanged')
    const op = engine.lastOperation
    const [forcedFor, setForcedFor] = useState<LastOperation | null>(null)
    // The operation the "first few" rule opened the panel for. Decided once, when the operation is
    // counted: reading the count while rendering raced the count's own update, so the panel flashed
    // open for the first operation past the few.
    const [autoOpenFor, setAutoOpenFor] = useState<LastOperation | null>(null)
    const [values, setValues] = useState<Record<string, unknown>>({})
    const [busy, setBusy] = useState(false)
    const rerunning = useRef(false)

    useEffect(() => { setValues(op?.props ?? {}) }, [op])
    useEngineEvent('lastOperationChanged', e => {
        if (!e.operation) return
        // The panel's own re-run of the last operation stays as it was.
        if (rerunning.current) return setAutoOpenFor(prev => prev ? e.operation! : null)
        // A new operation counts towards the first few.
        store.noteOperation()
        setAutoOpenFor(store.redoPanelOpen ? e.operation : null)
    })
    useEngineEvent('uiRequest', e => { if (e.request === 'operatorPanel') setForcedFor(engine.lastOperation) })
    const open = (!!op && forcedFor === op) ||
        (onboarding.redoPanel === 'auto' ? !!op && autoOpenFor === op : store.redoPanelOpen)

    if (!op) return null
    const schema = op.operator.props
    const hasProps = !!schema && Object.keys(schema.properties ?? {}).length > 0

    const apply = async (next: Record<string, unknown>) => {
        setValues(next)
        if (!op.redo || busy) return
        setBusy(true)
        rerunning.current = true
        try {
            const result = await op.redo(next)
            // The re-run is a new LastOperation for the same operator: keep an F9-opened panel open.
            if (forcedFor && result.ok) setForcedFor(engine.lastOperation)
        } finally {
            rerunning.current = false
            setBusy(false)
        }
    }

    return <div className={'me-operator-panel' + (open ? ' me-open' : '')} data-operator-panel={op.operator.id}>
        <Button variant="minimal" size="small" fill alignText="start"
            icon={open ? 'chevron-down' : 'chevron-right'} endIcon={op.operator.icon as never}
            text={op.operator.label}
            className="me-operator-title"
            onMouseDown={e => e.preventDefault()}
            data-open={open}
            onClick={() => {
                setForcedFor(null)
                store.setRedoPanel(!open)
            }} />
        <Collapse isOpen={open} keepChildrenMounted={false}>
            <div className="me-operator-body">
                {hasProps
                    ? <PropsForm schema={schema!} values={values} onChange={apply} disabled={!op.redo || busy} />
                    : <div className="me-props-empty">No adjustable parameters.</div>}
                {hasProps && !op.redo && <div className="me-operator-note">
                    This operation cannot be re-run yet: the current engine has no undo for it. Values shown as used.
                </div>}
            </div>
        </Collapse>
    </div>
}
