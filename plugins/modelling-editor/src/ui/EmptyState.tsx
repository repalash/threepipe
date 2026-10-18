/**
 * The empty scene teaches instead of showing nothing: "Add a shape" with one button per primitive
 * (the Add operators from the registry, so a new primitive shows up here by itself), and where else
 * a model can come from. Shown over the viewport while the scene has no objects in object mode -
 * after File > New, or after deleting everything.
 */

import {Button, Icon} from '@blueprintjs/core'
import {formatShortcut, useEditor, useEngineVersion} from './EditorContext'

export function EmptyState() {
    const {engine} = useEditor()
    useEngineVersion('sceneChanged', 'modeChanged', 'registryChanged', 'keymapChanged')
    if (engine.mode !== 'object' || engine.modelObjects().length > 0) return null
    const ctx = engine.context()
    const shapes = engine.operators.list(op => op.category === 'Add' && !op.hidden && (!op.modes || op.modes.includes('object')) && engine.poll(op, ctx).enabled)
    const addKey = engine.keymap.shortcutFor('add.menu')
    const openKey = engine.keymap.shortcutFor('file.open')
    return <div className="me-empty-state" data-empty-state>
        <div className="me-empty-state-title"><Icon icon="cube-add" /> Add a shape</div>
        <div className="me-empty-state-sub">Start from a primitive and shape it in Edit mode.</div>
        <div className="me-empty-state-shapes">
            {shapes.map(op => <Button key={op.id} icon={op.icon as never} text={op.label} data-empty-add={op.id}
                title={op.description} onMouseDown={e => e.preventDefault()} onClick={() => void engine.run(op.id)} />)}
        </div>
        <div className="me-empty-state-more">
            {addKey ? <>Later, <kbd className="me-kbd">{formatShortcut(addKey)}</kbd> over the viewport opens this list. </> : null}
            Or drop a .glb, .obj or .stl file here, or open one with File &gt; Open{openKey ? <> (<kbd className="me-kbd">{formatShortcut(openKey)}</kbd>)</> : null}.
        </div>
    </div>
}
