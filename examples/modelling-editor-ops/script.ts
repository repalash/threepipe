import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * The modelling editor's edit-mode operators that are ports of Blender's `MESH_OT_*` over
 * `@threepipe/mesh-kernel` (Poke, Triangulate, Beautify, Wireframe, Solidify, Fill, Mark Seam / Sharp,
 * Flip and Recalculate Normals, Delete Loose, Degenerate Dissolve, Merge, Collapse, Rotate Edge, Edge
 * Split, Spin, Shrink/Fatten and the extrude macros), each reached from its menu entry - Tab into
 * edit mode on the cube, then the Mesh / Vertex / Edge / Face menus, Ctrl+V / Ctrl+E / Ctrl+F, M, X,
 * Alt+E, or the keys (Ctrl+T, Alt+F, Shift+N, Alt+S). The redo panel (bottom left) adjusts the last
 * one.
 *
 * Try: `engine.run('mesh.poke', {offset: 0.3})`, `engine.resolveMenu('VIEW3D_MT_edit_mesh_faces')`.
 */

async function init() {
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin]},
        engine: {keymap: 'blender', storageKey: null},
        onboarding: false,
    })
    const {viewer, engine} = editor

    // A cube to start with, selected.
    await engine.run('add.cube')
    engine.file.markClean()

    Object.assign(window as never, {viewer, editor, engine, modelling: viewer.getPlugin(ModellingPlugin)})
}

_testStart()
init().finally(_testFinish)
