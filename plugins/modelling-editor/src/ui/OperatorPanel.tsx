/**
 * The redo-last ("Adjust Last Operation") panel, bottom-left of the viewport.
 *
 * Shows `engine.lastOperation`: its label and a form for its props. Editing a value calls
 * `redo(newProps)`, which the engine implements as pop-undo + re-exec (Blender's
 * `ED_undo_operator_repeat`). Operators without `redo` show their values read-only and say why.
 */

import {useEffect, useState} from 'react'
import {Button, Collapse} from '@blueprintjs/core'
import {useEditor, useEngineEvent, useEngineVersion} from './EditorContext'
import {PropsForm} from './PropsForm'

export function OperatorPanel() {
    const {engine} = useEditor()
    useEngineVersion('lastOperationChanged')
    const op = engine.lastOperation
    const [open, setOpen] = useState(false)
    const [values, setValues] = useState<Record<string, unknown>>({})
    const [busy, setBusy] = useState(false)

    useEffect(() => { setValues(op?.props ?? {}) }, [op])
    useEngineEvent('uiRequest', e => { if (e.request === 'operatorPanel') setOpen(true) })

    if (!op) return null
    const schema = op.operator.props
    const hasProps = !!schema && Object.keys(schema.properties ?? {}).length > 0

    const apply = async (next: Record<string, unknown>) => {
        setValues(next)
        if (!op.redo || busy) return
        setBusy(true)
        try { await op.redo(next) } finally { setBusy(false) }
    }

    return <div className={'me-operator-panel' + (open ? ' me-open' : '')} data-operator-panel={op.operator.id}>
        <Button variant="minimal" size="small" fill alignText="start"
            icon={open ? 'chevron-down' : 'chevron-right'} endIcon={op.operator.icon as never}
            text={op.operator.label}
            className="me-operator-title"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setOpen(!open)} />
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
