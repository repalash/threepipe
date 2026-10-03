/**
 * Edit-menu operators: undo, redo, history, adjust-last (F9), repeat-last (Shift+R), rename, the
 * keymap preset switch, and the Design preset's "back out one level" Escape.
 */

import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {OperatorDescriptor} from '../registry'

export function registerEditOperators(engine: EditorEnginePlugin): void {
    const viewer = engine.viewer
    const ops: OperatorDescriptor[] = [
        {
            id: 'edit.undo', label: 'Undo', icon: 'undo', category: 'Edit',
            description: 'Undo the last action.',
            poll: () => engine.history.canUndo() || 'Nothing to undo',
            exec: () => { engine.history.undo(); return {ok: true} },
        },
        {
            id: 'edit.redo', label: 'Redo', icon: 'redo', category: 'Edit',
            description: 'Redo the last undone action.',
            poll: () => engine.history.canRedo() || 'Nothing to redo',
            exec: () => { engine.history.redo(); return {ok: true} },
        },
        {
            id: 'edit.history', label: 'Undo History…', icon: 'history', category: 'Edit',
            description: 'Show the list of actions that can be undone.',
            exec: () => { engine.dispatchEvent({type: 'uiRequest', request: 'history'}); return {ok: true} },
        },
        {
            id: 'edit.repeat_last', label: 'Adjust Last Operation', icon: 'settings', category: 'Edit',
            description: 'Open the panel for the last operation\'s parameters.',
            poll: () => !!engine.lastOperation || 'No operation to adjust',
            exec: () => { engine.dispatchEvent({type: 'uiRequest', request: 'operatorPanel'}); return {ok: true} },
        },
        {
            id: 'edit.repeat', label: 'Repeat Last', icon: 'repeat', category: 'Edit',
            description: 'Run the last operation again with the same parameters (Blender\'s Shift+R).',
            poll: () => {
                const last = engine.lastOperation
                if (!last) return 'No operation to repeat'
                return engine.poll(last.operator).enabled || `${last.operator.label} cannot run now`
            },
            exec: async() => {
                const last = engine.lastOperation!
                return engine.run(last.operator.id, {...last.props})
            },
        },
        {
            id: 'edit.rename', label: 'Rename', icon: 'edit', category: 'Edit', modes: ['object'],
            contextMenu: ['object'],
            description: 'Rename the active object.',
            flags: {undo: true},
            poll: ctx => ctx.selectedObjects.length > 0 || 'Select an object first',
            async exec(ctx) {
                const obj = ctx.selectedObjects[ctx.selectedObjects.length - 1]
                const name = await viewer.dialog.prompt('Object name', obj.name, true)
                if (name === null || name === obj.name) return {ok: true}
                const old = obj.name
                const entry = engine.modelling?.document.find(obj.uuid)
                const apply = (n: string) => {
                    if (entry) engine.modelling!.document.rename(entry, n)
                    else obj.name = n
                    obj.setDirty?.({change: 'name'} as never)
                }
                apply(name)
                engine.record({label: `Rename to ${name}`, undo: () => apply(old), redo: () => apply(name)})
                return {ok: true}
            },
        },
        {
            id: 'edit.escape', label: 'Back Out', icon: 'cross', category: 'Edit',
            description: 'One level back: cancel a running tool, else clear the selection, else leave edit mode.',
            exec: ctx => {
                if (engine.propDrag) {
                    engine.propDrag.cancel()
                    return {ok: true}
                }
                if (engine.meshEdit.activeTransform) {
                    engine.meshEdit.cancelTransform()
                    return {ok: true}
                }
                if (ctx.mode === 'edit') {
                    const bm = engine.meshEdit.state?.bm
                    if (bm && bm.totvertsel > 0) engine.meshEdit.deselectAllElements()
                    else engine.setMode('object')
                    return {ok: true}
                }
                if (ctx.selectedObjects.length) engine.picking.clearSelection()
                return {ok: true}
            },
        },
        {
            id: 'edit.keymap', label: 'Keymap', icon: 'key', category: 'Edit',
            description: 'Choose the keyboard and mouse preset: Blender keys, or Design (Figma / trackpad).',
            props: {
                type: 'object',
                properties: {
                    preset: {type: 'string', enum: engine.keymap.presets.map(p => p.id), description: 'Which preset to use.'},
                },
            },
            exec: (_ctx, props) => {
                const id = props?.preset as string | undefined
                if (!id) {
                    engine.requestMenu('Keymap', engine.keymap.presets.map(p => ({
                        id: 'edit.keymap',
                        label: (p.id === engine.keymap.activePreset.id ? '● ' : '') + p.label,
                        props: {preset: p.id},
                    })))
                    return {ok: true}
                }
                if (!engine.keymap.presets.some(p => p.id === id)) return {ok: false, error: `No keymap preset "${id}"`}
                engine.keymap.setPreset(id)
                engine.message('info', `Keymap: ${engine.keymap.activePreset.label}`)
                return {ok: true}
            },
        },
    ]
    for (const op of ops) engine.operators.register(op)
    // The preset list can grow after registration (apps add their own); keep the enum current.
    engine.addEventListener('keymapChanged', () => {
        const op = engine.operators.get('edit.keymap')
        if (op?.props) op.props.properties.preset.enum = engine.keymap.presets.map(p => p.id)
    })
}
