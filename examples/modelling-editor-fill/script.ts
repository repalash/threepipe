import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * Fill and connect in the modelling editor: Fill (F), Bridge Edge Loops, Grid Fill, Connect Vertex
 * Path (J), the dissolve family (Ctrl+X, the X menu) and Merge by Distance (M > By Distance), each a
 * port of Blender's edit-mode operator with its redo-last panel.
 *
 * Starts with a cube, selected, on the Blender keymap (not persisted, so the real-input test always
 * starts there). Try: Tab, A, Shift+D, X, type 0.01, Enter, then M > By Distance and tick
 * "Use Unselected" in the panel at the bottom left.
 */

async function init() {
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin]},
        engine: {keymap: 'blender', storageKey: null},
    })
    const {viewer, engine} = editor

    await engine.run('add.cube')

    Object.assign(window as never, {viewer, editor, engine, modelling: viewer.getPlugin(ModellingPlugin)})
}

_testStart()
init().finally(_testFinish)
