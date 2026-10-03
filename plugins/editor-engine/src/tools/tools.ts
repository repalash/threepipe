/**
 * Active tools for the tool shelf.
 *
 * Object mode: select / move / rotate / scale drive `TransformControlsPlugin`'s gizmo mode. Edit
 * mode: Move, Rotate, Scale and Transform are sticky tools that show `MeshEditPlugin`'s gizmo with
 * just their handles, as Blender's tools do (`VIEW3D_GGT_xform_gizmo` with the tool's
 * `drag_action`); `G`/`R`/`S` stay one-shot modal operators in the keymap. Extrude is one-shot.
 * Inset and bevel are interactive through {@link PropDragModal}: run with defaults, drag to set the
 * thickness/width, wheel for segments, click to confirm.
 */

import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, StatusHints, ToolDescriptor} from '../registry'
import {PropDragModal} from './PropDragModal'

export function registerTools(engine: EditorEnginePlugin): void {
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
        lmb: `Drag a handle to ${verb}; click to select`,
        keys: [{key: 'Shift', label: 'Snap'}],
    })
    const hasElements = (ctx: EditorContext) => (ctx.editObject && engine.meshEdit.state && engine.meshEdit.state.bm.totvertsel > 0) ? true : 'Select some elements first'
    const hasFaces = (ctx: EditorContext) => (ctx.editObject && engine.meshEdit.state && engine.meshEdit.state.bm.totfacesel > 0) ? true : 'Select some faces first'
    /** Show the edit-mode gizmo with only the given handles; null hides it. */
    const elementGizmo = (handles: {translate: boolean, rotate: boolean, scale: boolean} | null) => {
        const me = engine.meshEdit
        if (handles) Object.assign(me.gizmo.show, handles)
        me.showGizmo(!!handles)
        engine.viewer.setDirty()
    }
    const elementGizmoHints = (verb: string): StatusHints => ({
        lmb: `Drag a handle to ${verb}; click to select; drag empty space to box select`,
        keys: [{key: 'Ctrl', label: 'Snap'}, {key: 'Shift', label: 'Precision'}, {key: 'type', label: 'Exact value'}],
    })
    const oneShot = (run: () => void) => () => {
        // Back to Select once the modal ends; the transformChanged/toolChanged listeners do the rest.
        run()
    }

    const tools: ToolDescriptor[] = [
        {
            id: 'select', label: 'Select', icon: 'select', group: 'select',
            description: 'Click to select; Shift+click to extend. In edit mode, click vertices, edges or faces.',
            activate: () => gizmo(null),
            deactivate: () => {},
            hints: {lmb: 'Select (Shift: extend)'},
        },
        {
            id: 'object.move', label: 'Move', icon: 'move', group: 'transform', modes: ['object'],
            description: 'Drag the arrows to move the selected object.',
            activate: () => gizmo('translate'),
            deactivate: () => gizmo(null),
            hints: gizmoHints('move'),
        },
        {
            id: 'object.rotate', label: 'Rotate', icon: 'refresh', group: 'transform', modes: ['object'],
            description: 'Drag the rings to rotate the selected object.',
            activate: () => gizmo('rotate'),
            deactivate: () => gizmo(null),
            hints: gizmoHints('rotate'),
        },
        {
            id: 'object.scale', label: 'Scale', icon: 'maximize', group: 'transform', modes: ['object'],
            description: 'Drag the handles to scale the selected object.',
            activate: () => gizmo('scale'),
            deactivate: () => gizmo(null),
            hints: gizmoHints('scale'),
        },
        {
            id: 'mesh.move', label: 'Move', icon: 'move', group: 'transform', modes: ['edit'],
            description: 'Drag the arrows to move the selection along an axis, the squares along a plane, the centre freely. G moves without the tool.',
            activate: () => elementGizmo({translate: true, rotate: false, scale: false}),
            deactivate: () => elementGizmo(null),
            hints: elementGizmoHints('move'),
        },
        {
            id: 'mesh.rotate', label: 'Rotate', icon: 'refresh', group: 'transform', modes: ['edit'],
            description: 'Drag a ring to rotate the selection about that axis. R rotates without the tool.',
            activate: () => elementGizmo({translate: false, rotate: true, scale: false}),
            deactivate: () => elementGizmo(null),
            hints: elementGizmoHints('rotate'),
        },
        {
            id: 'mesh.scale', label: 'Scale', icon: 'maximize', group: 'transform', modes: ['edit'],
            description: 'Drag a handle to scale the selection along that axis, the centre to scale evenly. S scales without the tool.',
            activate: () => elementGizmo({translate: false, rotate: false, scale: true}),
            deactivate: () => elementGizmo(null),
            hints: elementGizmoHints('scale'),
        },
        {
            id: 'mesh.transform', label: 'Transform', icon: 'move', group: 'transform', modes: ['edit'],
            description: 'Move, rotate and scale handles together.',
            activate: () => elementGizmo({translate: true, rotate: true, scale: true}),
            deactivate: () => elementGizmo(null),
            hints: elementGizmoHints('transform'),
        },
        {
            id: 'mesh.extrude', label: 'Extrude', icon: 'arrow-up', group: 'modelling', modes: ['edit'],
            description: 'Extrude the selection and move the new geometry along its normal.',
            poll: hasElements,
            activate: oneShot(() => { void engine.run('mesh.extrude') }),
            deactivate: () => {},
        },
        {
            id: 'mesh.inset', label: 'Inset Faces', icon: 'inner-join', group: 'modelling', modes: ['edit'],
            description: 'Inset the selected faces; drag to set the thickness, click to confirm.',
            poll: hasFaces,
            activate: oneShot(() => {
                void new PropDragModal(engine, {operatorId: 'mesh.inset', prop: 'thickness', min: 0, initial: {thickness: 0.05}}).start()
                    .then(ok => { if (!ok) engine.setActiveTool('select') })
            }),
            deactivate: () => {},
        },
        {
            id: 'mesh.bevel', label: 'Bevel', icon: 'polygon-filter', group: 'modelling', modes: ['edit'],
            description: 'Bevel the selected edges; drag to set the width, wheel for segments, click to confirm.',
            poll: hasElements,
            activate: oneShot(() => {
                void new PropDragModal(engine, {operatorId: 'mesh.bevel', prop: 'offset', min: 0, wheelProp: 'segments', initial: {offset: 0.1, segments: 1}}).start()
                    .then(ok => { if (!ok) engine.setActiveTool('select') })
            }),
            deactivate: () => {},
        },
        {
            id: 'mesh.loop_cut', label: 'Loop Cut', icon: 'horizontal-distribution', group: 'modelling', modes: ['edit'],
            description: 'Cut a loop of edges around the mesh. Arrives with P3.',
            poll: () => 'Loop cut arrives with P3 (modelling depth)',
            activate: () => {}, deactivate: () => {},
        },
        {
            id: 'mesh.knife', label: 'Knife', icon: 'cut', group: 'modelling', modes: ['edit'],
            description: 'Cut new edges by drawing on the surface. Arrives with P3.',
            poll: () => 'Knife arrives with P3 (modelling depth)',
            activate: () => {}, deactivate: () => {},
        },
    ]
    for (const t of tools) engine.tools.register(t)

    // A prop-drag modal that ended hands the shelf back to Select, like the transform modals.
    engine.addEventListener('toolChanged', () => {
        if (!engine.propDrag && engine.activeTool && (engine.activeTool.id === 'mesh.inset' || engine.activeTool.id === 'mesh.bevel')) {
            engine.setActiveTool('select')
        }
    })
}
