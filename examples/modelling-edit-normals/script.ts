import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * The edit session keeps the mesh's normals current, as Blender's edit mode does: computed on entry
 * and after an undo step, and once after every committed operator or modal transform (`EDBM_update`
 * with `calc_normals`) - not on every frame of a drag. Operators that read normals on entry (grid fill,
 * bridge, subdivide's smoothing, the normal orientation) see the mesh as it is.
 *
 * Try it: Tab, 3 (faces), click the top face, E 0.5 Enter, G X 0.3 Enter. The new side faces shade
 * like the cube's own, and `engine.meshEdit.state.bm` has current `f.nx/ny/nz` and `v.nx/ny/nz`.
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
    await engine.run('add.cube')
    engine.file.markClean()
    Object.assign(window as never, {viewer, editor, engine, modelling: viewer.getPlugin(ModellingPlugin)})
}

_testStart()
init().finally(_testFinish)
