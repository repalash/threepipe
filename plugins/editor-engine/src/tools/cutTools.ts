/**
 * The Knife and Bisect tools on the shelf - Blender's `builtin.knife` and `builtin.bisect` tools
 * (`blender_default.py`: `km_3d_view_tool_edit_mesh_knife`, `km_3d_view_tool_edit_mesh_bisect`).
 *
 * Both stay active until another tool is picked, as in Blender, and act on a left press in the
 * viewport through `MeshEditPlugin.toolPress`:
 * - Knife: the press is the first cut point (`mesh.knife_tool` with `wait_for_input=False`); keep
 *   clicking, Enter or Space to apply. The next press starts a new knife.
 * - Bisect: press and drag a line (`mesh.bisect` on the tool's tweak event); the release cuts. A click
 *   without a drag selects, as the tool falls through to selection.
 */

import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, ToolDescriptor} from '../registry'
import type {CutActions} from '../ops/cutOps'

export function registerCutTools(engine: EditorEnginePlugin, cut: CutActions): void {
    const me = engine.meshEdit
    const inEdit = (ctx: EditorContext) => !!ctx.editObject || 'Only in edit mode'
    const tools: ToolDescriptor[] = [
        {
            id: 'mesh.knife', label: 'Knife', icon: 'cut', group: 'modelling', modes: ['edit'],
            description: 'Click points on the surface to cut new edges; Enter applies. Snaps to vertices and edges (Shift: midpoints, Ctrl: off), C cuts through, X/Y/Z lock an axis, A snaps the angle.',
            poll: inEdit,
            activate: () => {
                me.toolPress = press => me.startKnife({waitForInput: false, mouse: {x: press.x, y: press.y}})
            },
            deactivate: () => {
                me.toolPress = null
                if (me.activeKnife) me.cancelKnife()
            },
            hints: {lmb: 'Start a cut (click points, Enter to apply)'},
        },
        {
            id: 'mesh.bisect', label: 'Bisect', icon: 'slash', group: 'modelling', modes: ['edit'],
            description: 'Drag a line across the mesh to cut the selection along that plane. Fill and Clear Inner/Outer are in the panel after.',
            poll: inEdit,
            activate: () => {
                me.toolPress = press => cut.startBisectGesture(press)
            },
            deactivate: () => {
                me.toolPress = null
            },
            hints: {lmb: 'Drag a line to cut the selection; click to select'},
        },
    ]
    for (const t of tools) engine.tools.register(t)
}
