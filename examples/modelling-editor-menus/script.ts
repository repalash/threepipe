import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * The modelling editor's menus: Blender's 3D view header and context menus (`VIEW3D_MT_*` in
 * `space_view3d.py`) and the top bar's File / Edit / Help, ported as menu definitions in
 * `@threepipe/plugin-editor-engine` (`src/menus/menus.ts`) and drawn by the shell.
 *
 * Object mode has View / Select / Add / Object; edit mode (Tab) has View / Select / Add / Mesh /
 * Vertex / Edge / Face / UV. Ctrl+V / Ctrl+E / Ctrl+F, X, M, Shift+A and the right click open the
 * same definitions at the pointer. Entries Blender has and the editor does not yet are shown
 * disabled; hover one for "Not available yet".
 *
 * Try: `engine.resolveMenu('VIEW3D_MT_edit_mesh')`, `engine.headerMenus().map(m => m.label)`.
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
