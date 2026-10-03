import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * The loop tools of the modelling editor: Loop Cut and Slide (Ctrl+R), Edge Slide and Vertex Slide
 * (G G, Shift+V), Subdivide and Subdivide Edge-Ring, each with its redo panel.
 *
 * Tab into edit mode on the cube, hover an edge and press Ctrl+R: the ring under the cursor previews,
 * the wheel changes the number of cuts, a click cuts and starts sliding the new loop, a second click
 * places it (right-click keeps it centred).
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
