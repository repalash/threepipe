import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * The redo panel and the keyboard: the viewport takes the keys whenever the pointer is over it.
 *
 * Tab, A, `S 2 Enter`, then in the Scale panel type 1.5 into X and press Enter: the scale re-runs
 * once, with the value as typed, and the field lets go of the keyboard. Move the pointer back over the
 * cube and G moves it - no click needed (a click would change the selection). The same after ticking
 * a checkbox in the panel. As in Blender, keys go to the area under the pointer; only a text field
 * that is being typed into keeps them.
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

    // A cube to start with, selected, as in the editor example.
    await engine.run('add.cube')

    Object.assign(window as never, {viewer, editor, engine, modelling: viewer.getPlugin(ModellingPlugin)})
}

_testStart()
init().finally(_testFinish)
