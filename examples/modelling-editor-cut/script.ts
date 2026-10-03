import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * Cutting in the modelling editor: the Knife (K) and Bisect.
 *
 * - Knife: Tab into edit mode, press K (or pick Knife on the shelf), click points on the cube - they
 *   snap to vertices and edges - and press Enter. Shift snaps to edge midpoints, Ctrl turns snapping
 *   off, C cuts through to the back, X/Y/Z lock an axis, A snaps the angle, Ctrl+Z or Backspace takes
 *   back the last segment, right click or E starts another cut, Esc cancels.
 * - Bisect: select what to cut (A), pick Bisect on the shelf (or search "bisect" with F3) and drag a
 *   line across the cube. The panel then edits the plane, Fill and Clear Inner/Outer.
 *
 * Both are ports of Blender's (`editmesh_knife.cc`, `bmesh_bisect_plane.cc`), checked against
 * Blender's own results; see `plugins/mesh-kernel/tests/knife-bisect-parity.test.ts`.
 */

async function init() {
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin]},
        engine: {keymap: 'blender', storageKey: null},
    })
    const {viewer, engine} = editor

    // A cube to start with, selected, as in the editor example.
    await engine.run('add.cube')

    Object.assign(window as never, {viewer, editor, engine, modelling: viewer.getPlugin(ModellingPlugin)})
}

_testStart()
init().finally(_testFinish)
