import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * Inset and bevel as Blender does them, from the keyboard or the tool shelf.
 *
 * Tab into edit mode, press 3 for faces and click one, then:
 * - I insets it: move the mouse towards the face's centre for a thicker rim, or type a value
 *   (`I 0.2 Enter`). O, B and I toggle outset, boundary and individual while it runs; Enter or a click
 *   confirms, Esc or a right click cancels.
 * - Ctrl+B bevels the selected edges the same way; the wheel adds segments.
 * - The Inset Faces and Bevel tools on the shelf start the same interaction.
 *
 * Ports of Blender's `MESH_OT_inset` and `MESH_OT_bevel` modals (`editmesh_inset.cc`,
 * `editmesh_bevel.cc`); the redo panel adjusts the result afterwards.
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
