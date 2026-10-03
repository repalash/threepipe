/**
 * Shell dialogs served by `uiRequest`: undo history, keyboard shortcuts (the cheat sheet) and about.
 */

import {Button, Dialog, DialogBody, DialogFooter} from '@blueprintjs/core'
import {useEditor, useEngineVersion} from './EditorContext'
import {HistoryList} from './HistoryList'
import {CheatSheet} from './CheatSheet'

export function HistoryDialog({isOpen, onClose}: {isOpen: boolean, onClose: () => void}) {
    const {engine} = useEditor()
    useEngineVersion('historyChanged')
    return <Dialog isOpen={isOpen} onClose={onClose} title="Undo History" className="me-dialog" icon="history">
        <DialogBody>
            <HistoryList />
            <div className="me-dialog-note">Click a step to go back (or forward) to it. The History tab next to the outliner shows the same list.</div>
        </DialogBody>
        <DialogFooter actions={<>
            <Button text="Undo" icon="undo" disabled={!engine.history.canUndo()} onClick={() => engine.history.undo()} />
            <Button text="Redo" icon="redo" disabled={!engine.history.canRedo()} onClick={() => engine.history.redo()} />
            <Button text="Close" onClick={onClose} />
        </>} />
    </Dialog>
}

/** The cheat sheet, under the name the shell has always exported. */
export const ShortcutsDialog = CheatSheet

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
