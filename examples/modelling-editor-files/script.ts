import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * Files in the modelling editor: File > New / Open / Import / Save / Save As, Export GLB / OBJ / STL,
 * drag-and-drop, Open Recent and the document name with its unsaved-changes dot in the header.
 *
 * Save writes a .glb through the asset exporter with `ModellingPlugin`'s `THREEPIPE_mesh_topology`
 * extension, so a saved model opens again editable: n-gons stay n-gons (the cylinder's 32-sided caps
 * here), not the triangles the mesh primitive stores. A browser cannot write back to a file, so Save
 * downloads `<name>.glb`; the recent list keeps names and sizes only, never contents.
 */

async function init() {
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin]},
        engine: {keymap: 'blender'},
        onboarding: false,
    })
    const {viewer, engine} = editor

    // A cylinder: its caps are 32-gons, the topology a plain glTF round trip would lose.
    await engine.run('add.cylinder')
    engine.file.markClean()

    Object.assign(window as never, {viewer, editor, engine, modelling: viewer.getPlugin(ModellingPlugin)})
    console.log('Try: engine.run("file.save"); engine.run("file.open")')
}

_testStart()
init().finally(_testFinish)
