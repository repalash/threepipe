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

/**
 * The last `look` render - the agent's eyes - beside what it says it rendered.
 *
 * Opened by the `view.look` operator, and from the agent indicator, so a person watching an agent
 * work can see the same sheet the agent judged its work by.
 */
export function LookDialog({isOpen, onClose}: {isOpen: boolean, onClose: () => void}) {
    const {engine} = useEditor()
    useEngineVersion('lookChanged')
    const look = engine.lastLook
    const data = look?.data as {image?: string, style?: string, views?: {name: string, inFrame: string[], partial: string[], highlight?: {offscreen: number}}[], highlight?: {object: string, faces: number, edges: number, verts: number} | null} | undefined
    return <Dialog isOpen={isOpen} onClose={onClose} title="Look" className="me-dialog me-look-dialog" icon="eye-open">
        <DialogBody>
            {!look ? <div className="me-dialog-note">Nothing has been looked at yet. Run <b>Look (Agent View)</b> from the palette, or let an agent call <code>look</code>.</div> : <>
                {data?.image ? <img className="me-look-image" data-look-image src={data.image} alt="the last look render" /> : <div className="me-dialog-note">The last look was written to a file and not kept in the page.</div>}
                <div className="me-look-meta" data-look-meta>
                    <div><b>#{look.index}</b> <code>{JSON.stringify({...look.command, op: undefined})}</code></div>
                    <div>style <b>{data?.style}</b>{data?.highlight ? <> · highlight <b>{data.highlight.object}</b>: {data.highlight.faces} faces, {data.highlight.edges} edges, {data.highlight.verts} verts</> : null}</div>
                    {data?.views?.map(v => <div key={v.name}><b>{v.name}</b>: in frame {v.inFrame.join(', ') || 'nothing'}{v.partial.length ? `; cut by the frame: ${v.partial.join(', ')}` : ''}{v.highlight?.offscreen ? `; ${v.highlight.offscreen} highlighted off screen` : ''}</div>)}
                </div>
            </>}
        </DialogBody>
        <DialogFooter actions={<>
            <Button text="Look again" icon="eye-open" onClick={() => engine.run('view.look', (look?.command as Record<string, unknown> | undefined)?.view === 'angles' || !look ? {} : {view: (look.command as Record<string, unknown>).view, style: (look.command as Record<string, unknown>).style})} />
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
