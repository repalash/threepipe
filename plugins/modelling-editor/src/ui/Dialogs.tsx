/**
 * Shell dialogs served by `uiRequest`: undo history, keyboard shortcuts and about.
 */


import {Button, Dialog, DialogBody, DialogFooter} from '@blueprintjs/core'
import {useEditor, useEngineVersion, formatShortcut} from './EditorContext'

export function HistoryDialog({isOpen, onClose}: {isOpen: boolean, onClose: () => void}) {
    const {engine} = useEditor()
    useEngineVersion('historyChanged')
    const entries = engine.history.entries()
    return <Dialog isOpen={isOpen} onClose={onClose} title="Undo History" className="me-dialog" icon="history">
        <DialogBody>
            {entries.length === 0 && <div className="me-empty">Nothing has been done yet.</div>}
            <ol className="me-history" data-history>
                {entries.map((e, i) => <li key={i} className={e.undone ? 'me-undone' : ''}>{e.label}</li>)}
            </ol>
        </DialogBody>
        <DialogFooter actions={<>
            <Button text="Undo" icon="undo" disabled={!engine.history.canUndo()} onClick={() => engine.history.undo()} />
            <Button text="Redo" icon="redo" disabled={!engine.history.canRedo()} onClick={() => engine.history.redo()} />
            <Button text="Close" onClick={onClose} />
        </>} />
    </Dialog>
}

export function ShortcutsDialog({isOpen, onClose}: {isOpen: boolean, onClose: () => void}) {
    const {engine} = useEditor()
    useEngineVersion('registryChanged')
    const ops = engine.operators.list(op => !!op.shortcut)
    const tools = engine.tools.list(t => !!t.shortcut)
    const groups = new Map<string, {label: string, shortcut: string, description?: string}[]>()
    for (const op of ops) {
        const c = op.category ?? 'Other'
        if (!groups.has(c)) groups.set(c, [])
        groups.get(c)!.push({label: op.label, shortcut: op.shortcut!, description: op.description})
    }
    groups.set('Tools', tools.map(t => ({label: t.label, shortcut: t.shortcut!, description: t.description})))
    return <Dialog isOpen={isOpen} onClose={onClose} title="Keyboard Shortcuts" className="me-dialog me-dialog-wide" icon="key">
        <DialogBody>
            <div className="me-shortcuts">
                {[...groups.entries()].map(([c, list]) => <div key={c} className="me-shortcut-group">
                    <h6 className="bp5-heading">{c}</h6>
                    {list.map(s => <div key={s.label + s.shortcut} className="me-shortcut-row" title={s.description}>
                        <span>{s.label}</span><kbd className="me-kbd">{formatShortcut(s.shortcut)}</kbd>
                    </div>)}
                </div>)}
            </div>
            <div className="me-dialog-note">Keys are handled by the interaction engine; this list is generated from the operator registry.</div>
        </DialogBody>
        <DialogFooter actions={<Button text="Close" onClick={onClose} />} />
    </Dialog>
}

export function AboutDialog({isOpen, onClose}: {isOpen: boolean, onClose: () => void}) {
    return <Dialog isOpen={isOpen} onClose={onClose} title="About" className="me-dialog" icon="info-sign">
        <DialogBody>
            <p><b>threepipe modelling editor</b> - shell 0.1.0 (<code>@threepipe/plugin-modelling-editor</code>).</p>
            <p>A browser modelling editor built on threepipe, <code>@threepipe/mesh-kernel</code> (a BMesh port),
                <code> @threepipe/plugin-mesh-edit</code> and <code>@threepipe/plugin-modelling</code>.</p>
            <p>The toolbar, menus, palette, context menus and the last-operation panel all render from one operator
                registry, which is also the scripting and agent API.</p>
            <p className="bp5-text-muted">Interactive inset, bevel, loop cut and knife, pivot/orientation/snapping and
                proportional editing arrive with the next engine phases.</p>
        </DialogBody>
        <DialogFooter actions={<Button text="Close" onClick={onClose} />} />
    </Dialog>
}
