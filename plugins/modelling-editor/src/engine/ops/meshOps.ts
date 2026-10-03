/**
 * Edit-mode operators over `MeshEditPlugin`'s methods.
 *
 * These are plain method calls today: no props, no undo, no re-execution. `merge` and `delete` carry
 * a schema for their one argument so the redo-last panel can show it, but `redo` is absent because
 * the plugin has no undo to pop; the panel says so. The rebuilt engine replaces all of this with
 * real operators.
 */

import type {LegacyEditorEngine} from '../legacyEngine'
import type {EditorContext, OperatorDescriptor} from '../../registry'

export function registerMeshOperators(engine: LegacyEditorEngine): void {
    const me = engine.meshEdit
    const editing = () => me.isEditing || 'Only in edit mode'
    const hasSelection = (_ctx: EditorContext) => {
        if (!me.state) return 'Only in edit mode'
        const bm = me.state.bm
        return bm.totvertsel > 0 || 'Select some vertices, edges or faces first'
    }
    const notModal = () => !me.activeTransform || 'Finish the current transform first'

    const simple = (id: string, label: string, icon: string, shortcut: string, description: string,
        exec: () => boolean | void, poll = hasSelection, extra: Partial<OperatorDescriptor> = {}): OperatorDescriptor => ({
        id, label, icon, shortcut, description, category: 'Mesh', modes: ['edit'], contextMenu: ['vertex', 'edge', 'face'],
        flags: {undo: true, register: true},
        poll: ctx => { const p = poll(ctx); return p === true ? notModal() : p },
        exec: (_ctx, props) => {
            const r = exec()
            if (r === false) return {ok: false, error: 'Nothing to do with the current selection'}
            engine.setLastOperation({operator: engine.operators.get(id)!, props: props ?? {}})
            return {ok: true}
        },
        ...extra,
    })

    const ops: OperatorDescriptor[] = [
        {
            id: 'mesh.exit_edit', label: 'Object Mode', icon: 'cube', shortcut: 'Tab', category: 'Mesh', modes: ['edit'],
            description: 'Leave edit mode and bake the changes into the object.',
            poll: editing,
            exec: () => ({ok: engine.setMode('object')}),
        },
        {
            id: 'mesh.exit_discard', label: 'Discard Edits', icon: 'cross', category: 'Mesh', modes: ['edit'],
            description: 'Leave edit mode without keeping the changes made in this session.',
            poll: editing,
            exec: () => { if (me.activeTransform) me.cancelTransform(); me.exit(false); return {ok: true} },
        },
        {
            id: 'mesh.apply', label: 'Apply to Object', icon: 'tick', category: 'Mesh', modes: ['edit'],
            description: 'Bake the current topology into the object without leaving edit mode.',
            poll: editing,
            exec: () => { me.applyToObject(); return {ok: true} },
        },
        {
            id: 'mesh.select_mode_vertex', label: 'Vertex Select', icon: 'dot', shortcut: '1', category: 'Select', modes: ['edit'],
            description: 'Select vertices.',
            exec: () => { engine.setSelectMode('vertex'); return {ok: true} },
        },
        {
            id: 'mesh.select_mode_edge', label: 'Edge Select', icon: 'minus', shortcut: '2', category: 'Select', modes: ['edit'],
            description: 'Select edges.',
            exec: () => { engine.setSelectMode('edge'); return {ok: true} },
        },
        {
            id: 'mesh.select_mode_face', label: 'Face Select', icon: 'square', shortcut: '3', category: 'Select', modes: ['edit'],
            description: 'Select faces.',
            exec: () => { engine.setSelectMode('face'); return {ok: true} },
        },
        {
            id: 'mesh.select_all', label: 'Select All', icon: 'select', shortcut: 'A', category: 'Select', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Select every element.',
            poll: editing,
            exec: () => { me.selectAllElements(); return {ok: true} },
        },
        {
            id: 'mesh.select_none', label: 'Select None', icon: 'disable', shortcut: 'Alt+A', category: 'Select', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Deselect every element.',
            poll: editing,
            exec: () => { me.deselectAllElements(); return {ok: true} },
        },
        {
            id: 'mesh.select_invert', label: 'Invert Selection', icon: 'exchange', shortcut: 'Ctrl+I', category: 'Select', modes: ['edit'],
            description: 'Swap selected and unselected elements.',
            poll: editing,
            exec: () => { me.invertSelection(); return {ok: true} },
        },
        {
            id: 'mesh.select_linked', label: 'Select Linked', icon: 'graph', shortcut: 'L', category: 'Select', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Grow the selection to everything connected to it.',
            poll: hasSelection,
            exec: () => { me.selectLinked(); return {ok: true} },
        },
        {
            id: 'mesh.move', label: 'Move', icon: 'move', shortcut: 'G', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Move the selection with the mouse; X/Y/Z locks an axis, type a number for an exact distance.',
            poll: ctx => { const p = hasSelection(ctx); return p === true ? notModal() : p },
            exec: () => ({ok: me.startTransform('translate')}),
        },
        {
            id: 'mesh.rotate', label: 'Rotate', icon: 'refresh', shortcut: 'R', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Rotate the selection with the mouse; X/Y/Z locks an axis, type degrees for an exact angle.',
            poll: ctx => { const p = hasSelection(ctx); return p === true ? notModal() : p },
            exec: () => ({ok: me.startTransform('rotate')}),
        },
        {
            id: 'mesh.scale', label: 'Scale', icon: 'maximize', shortcut: 'S', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Scale the selection with the mouse; X/Y/Z locks an axis, type a factor for an exact scale.',
            poll: ctx => { const p = hasSelection(ctx); return p === true ? notModal() : p },
            exec: () => ({ok: me.startTransform('resize')}),
        },
        simple('mesh.extrude', 'Extrude', 'arrow-up', 'E',
            'Extrude the selection and start moving it. Click or Enter to confirm, Esc to cancel the move.',
            () => me.extrude()),
        simple('mesh.duplicate', 'Duplicate', 'duplicate', 'Shift+D',
            'Copy the selected elements and start moving the copy.',
            () => me.duplicate()),
        simple('mesh.split', 'Split', 'fork', 'Y',
            'Detach the selection from the rest of the mesh, keeping it in place.',
            () => me.split()),
        simple('mesh.merge', 'Merge', 'group-objects', 'M',
            'Collapse the selected vertices into one.',
            () => me.merge(engine.lastOperation?.operator.id === 'mesh.merge' ? engine.lastOperation.props.mode as never : 'center'),
            hasSelection, {
                props: {type: 'object', properties: {
                    mode: {type: 'string', enum: ['center', 'first', 'last'], description: 'Where the merged vertex ends up.', default: 'center'},
                }},
                exec: (_ctx, props) => {
                    const mode = (props?.mode as 'center' | 'first' | 'last') ?? 'center'
                    if (!me.merge(mode)) return {ok: false, error: 'Select at least two vertices to merge'}
                    engine.setLastOperation({operator: engine.operators.get('mesh.merge')!, props: {mode}})
                    return {ok: true}
                },
            }),
        simple('mesh.delete', 'Delete', 'trash', 'X',
            'Delete the selected vertices, edges or faces.',
            () => me.deleteSelected(), hasSelection, {
                props: {type: 'object', properties: {
                    context: {type: 'string', enum: ['verts', 'edges', 'faces', 'only_faces', 'edges_faces'], description: 'What to delete.'},
                }},
                exec: (ctx, props) => {
                    const dflt = ctx.selectMode === 'face' ? 'faces' : ctx.selectMode === 'edge' ? 'edges' : 'verts'
                    const context = (props?.context as string) ?? dflt
                    if (!me.deleteSelected(context as never)) return {ok: false, error: 'Nothing selected to delete'}
                    engine.setLastOperation({operator: engine.operators.get('mesh.delete')!, props: {context}})
                    return {ok: true}
                },
            }),
        {
            id: 'mesh.toggle_xray', label: 'Toggle X-Ray', icon: 'eye-open', shortcut: 'Alt+Z', category: 'View', modes: ['edit'],
            description: 'See and select through the mesh.',
            exec: () => { me.xray = !me.xray; me.refreshOverlays(); engine.dispatchEvent({type: 'statusChanged', hints: engine.status}); return {ok: true} },
        },
    ]
    for (const op of ops) engine.operators.register(op)
}
