/**
 * The status bar: what the mouse buttons do right now, the running modal operator's text and keys,
 * and scene statistics.
 */

import {useMemo} from 'react'
import {useEditor, useEngineVersion, formatShortcut} from './EditorContext'

function Hint({button, text}: {button: string, text: string | undefined}) {
    if (!text) return null
    return <span className="me-hint"><span className="me-mouse">{button}</span>{text}</span>
}

export function StatusBar() {
    const {engine} = useEditor()
    const v = useEngineVersion('statusChanged', 'sceneChanged', 'selectionChanged', 'modeChanged', 'toolChanged', 'selectModeChanged')
    const status = engine.status
    const stats = useMemo(() => engine.stats(), [engine, v])
    const mode = engine.mode
    const fmt = (n: number) => n.toLocaleString()

    return <footer className="me-status-bar" data-status-bar>
        <div className="me-status-hints">
            {status?.modal
                ? <span className="me-modal" data-modal>{status.modal}</span>
                : null}
            <Hint button="LMB" text={status?.lmb} />
            <Hint button="MMB" text={status?.mmb} />
            <Hint button="RMB" text={status?.rmb} />
            {status?.keys?.map(k => <span key={k.key} className="me-hint"><kbd className="me-kbd">{formatShortcut(k.key)}</kbd>{k.label}</span>)}
        </div>
        <div className="me-status-stats" data-stats>
            <span className="me-stat me-stat-mode" data-mode={mode}>{mode === 'edit' ? `Edit · ${engine.selectMode}` : 'Object'}</span>
            {mode === 'edit'
                ? <>
                    <span className="me-stat">Verts <b>{fmt(stats.selected[0])}</b>/{fmt(stats.verts)}</span>
                    <span className="me-stat">Edges <b>{fmt(stats.selected[1])}</b>/{fmt(stats.edges)}</span>
                    <span className="me-stat">Faces <b>{fmt(stats.selected[2])}</b>/{fmt(stats.faces)}</span>
                </>
                : <>
                    <span className="me-stat">Objects <b>{fmt(stats.selected[0])}</b>/{fmt(stats.objects)}</span>
                    <span className="me-stat">Verts {fmt(stats.verts)}</span>
                    <span className="me-stat">Tris {fmt(stats.faces)}</span>
                </>}
        </div>
    </footer>
}
