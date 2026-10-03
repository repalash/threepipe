import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'

/**
 * The modelling editor shell: header, toolbar, viewport, outliner, properties, operator panel,
 * status bar and command palette (Ctrl/Cmd+K or F3), all rendered from the operator and tool
 * registries in `@threepipe/plugin-modelling-editor`.
 *
 * Starts with a cube, selected, so the first five minutes begin with something to edit: double-click
 * it (or press Tab, or the Edit button) to enter edit mode.
 */

async function init() {
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin]},
    })
    const {viewer, engine} = editor

    // The empty state is never empty: a cube to start with, selected, seen from the default three-quarter view.
    await engine.run('add.cube')

    // The scripting surface is the agent surface: everything the UI does is reachable from here.
    Object.assign(window as never, {viewer, editor, engine})
    console.log('Try: engine.operators.list().map(o => o.id); engine.run("mesh.extrude")')
}

_testStart()
init().finally(_testFinish)
