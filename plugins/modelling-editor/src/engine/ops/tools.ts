/**
 * Active tools for the left toolbar.
 *
 * Object mode: select / move / rotate / scale / transform drive `TransformControlsPlugin`'s gizmo mode.
 * Edit mode: `MeshEditPlugin` has no gizmo, only modal G/R/S, so the move/rotate/scale tools start
 * that modal when clicked (one-shot; the toolbar falls back to Select when the modal ends). Tools
 * that the engine does not implement yet are registered disabled, with the reason as their tooltip,
 * so the toolbar is honest about what exists.
 */

import type {LegacyEditorEngine} from '../legacyEngine'
import type {StatusHints, ToolDescriptor} from '../../registry'

const ORBIT: StatusHints = {lmb: 'Select (Shift: extend)', mmb: 'Zoom', rmb: 'Pan / context menu', keys: [{key: 'Drag', label: 'Orbit'}]}

export function registerTools(engine: LegacyEditorEngine): void {
    const tc = engine.transformControls
    const gizmo = (mode: 'translate' | 'rotate' | 'scale' | null) => {
        if (!tc) return
        if (!mode) {
            tc.disable('modelling-editor-tool')
            return
        }
        tc.enable('modelling-editor-tool')
        tc.transformControls?.setMode(mode)
    }
    const gizmoHints = (verb: string): StatusHints => ({
        lmb: `Drag a handle to ${verb}; click to select`, mmb: 'Zoom', rmb: 'Pan / context menu',
        keys: [{key: 'W / E / R', label: 'Move / Rotate / Scale'}, {key: 'Shift', label: 'Snap'}],
    })

    const tools: ToolDescriptor[] = [
        {
            id: 'select', label: 'Select', icon: 'select', shortcut: 'Q', group: 'select',
            description: 'Click to select; Shift+click to extend. In edit mode, click vertices, edges or faces.',
            activate: () => gizmo(null),
            deactivate: () => {},
            hints: ORBIT,
        },
        {
            id: 'object.move', label: 'Move', icon: 'move', shortcut: 'W', group: 'transform', modes: ['object'],
            description: 'Drag the arrows to move the selected object.',
            activate: () => gizmo('translate'),
            deactivate: () => gizmo(null),
            hints: gizmoHints('move'),
        },
        {
            id: 'object.rotate', label: 'Rotate', icon: 'refresh', shortcut: 'E', group: 'transform', modes: ['object'],
            description: 'Drag the rings to rotate the selected object.',
            activate: () => gizmo('rotate'),
            deactivate: () => gizmo(null),
            hints: gizmoHints('rotate'),
        },
        {
            id: 'object.scale', label: 'Scale', icon: 'maximize', shortcut: 'R', group: 'transform', modes: ['object'],
            description: 'Drag the handles to scale the selected object.',
            activate: () => gizmo('scale'),
            deactivate: () => gizmo(null),
            hints: gizmoHints('scale'),
        },
        {
            id: 'mesh.move', label: 'Move', icon: 'move', shortcut: 'G', group: 'transform', modes: ['edit'],
            description: 'Move the selected elements with the mouse. Click or Enter confirms, Esc cancels.',
            poll: ctx => (ctx.editObject && engine.meshEdit.state && engine.meshEdit.state.bm.totvertsel > 0) ? true : 'Select some elements first',
            activate: () => { engine.run('mesh.move') },
            deactivate: () => {},
        },
        {
            id: 'mesh.rotate', label: 'Rotate', icon: 'refresh', shortcut: 'R', group: 'transform', modes: ['edit'],
            description: 'Rotate the selected elements with the mouse. Click or Enter confirms, Esc cancels.',
            poll: ctx => (ctx.editObject && engine.meshEdit.state && engine.meshEdit.state.bm.totvertsel > 0) ? true : 'Select some elements first',
            activate: () => { engine.run('mesh.rotate') },
            deactivate: () => {},
        },
        {
            id: 'mesh.scale', label: 'Scale', icon: 'maximize', shortcut: 'S', group: 'transform', modes: ['edit'],
            description: 'Scale the selected elements with the mouse. Click or Enter confirms, Esc cancels.',
            poll: ctx => (ctx.editObject && engine.meshEdit.state && engine.meshEdit.state.bm.totvertsel > 0) ? true : 'Select some elements first',
            activate: () => { engine.run('mesh.scale') },
            deactivate: () => {},
        },
        {
            id: 'mesh.extrude', label: 'Extrude', icon: 'arrow-up', shortcut: 'E', group: 'modelling', modes: ['edit'],
            description: 'Extrude the selection and move the new geometry.',
            poll: ctx => (ctx.editObject && engine.meshEdit.state && engine.meshEdit.state.bm.totvertsel > 0) ? true : 'Select some elements first',
            activate: () => { engine.run('mesh.extrude') },
            deactivate: () => {},
        },
        {
            id: 'mesh.inset', label: 'Inset Faces', icon: 'inner-join', shortcut: 'I', group: 'modelling', modes: ['edit'],
            description: 'Inset the selected faces. Interactive inset arrives with the modelling-depth phase (P3).',
            poll: () => 'Interactive inset arrives with P3; use Mesh > Inset in object mode on a document object',
            activate: () => {}, deactivate: () => {},
        },
        {
            id: 'mesh.bevel', label: 'Bevel', icon: 'polygon-filter', shortcut: 'Ctrl+B', group: 'modelling', modes: ['edit'],
            description: 'Bevel the selected edges. Interactive bevel arrives with P3.',
            poll: () => 'Interactive bevel arrives with P3; use Mesh > Bevel in object mode on a document object',
            activate: () => {}, deactivate: () => {},
        },
        {
            id: 'mesh.loop_cut', label: 'Loop Cut', icon: 'horizontal-distribution', shortcut: 'Ctrl+R', group: 'modelling', modes: ['edit'],
            description: 'Cut a loop of edges around the mesh. Arrives with P3.',
            poll: () => 'Loop cut arrives with P3 (modelling depth)',
            activate: () => {}, deactivate: () => {},
        },
        {
            id: 'mesh.knife', label: 'Knife', icon: 'cut', shortcut: 'K', group: 'modelling', modes: ['edit'],
            description: 'Cut new edges by drawing on the surface. Arrives with P3.',
            poll: () => 'Knife arrives with P3 (modelling depth)',
            activate: () => {}, deactivate: () => {},
        },
    ]
    for (const t of tools) engine.tools.register(t)
}
