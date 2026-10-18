import {_testFinish, _testStart, LoadingScreenPlugin, PickingPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ThreepipeCloudPlugin} from '@threepipe/plugin-cloud'
import {CLOUD_ENDPOINT, CLOUD_TURNSTILE_SITE_KEY} from '../globals.js'

/**
 * The modelling editor shell: header, toolbar, viewport, outliner, properties, operator panel,
 * status bar and command palette (Ctrl/Cmd+K or F3), all rendered from the operator and tool
 * registries in `@threepipe/plugin-modelling-editor`.
 *
 * First run: a welcome asks "Have you used Blender?" (Blender or Design keys) and shows how to orbit,
 * pan and zoom with your mouse or trackpad; then three hints walk through select, edit and move.
 * Both are remembered in localStorage; Help > Welcome and Help > Show Hints Again bring them back.
 *
 * The start scene, like Blender's: a cube on the grid seen from a three-quarter view, not selected
 * yet - clicking it is the first hint.
 *
 * Help > Report a Problem / Send Feedback goes to threepipe-cloud when the examples' .env sets TP_EX_CLOUD_ENDPOINT
 * and TP_EX_CLOUD_TURNSTILE_SITE_KEY (the hosted build, CLOUDFLARE.md); without them the editor has no cloud plugin.
 */

async function init() {
    const cloud = CLOUD_ENDPOINT ? new ThreepipeCloudPlugin({
        endpoint: CLOUD_ENDPOINT,
        turnstileSiteKey: CLOUD_TURNSTILE_SITE_KEY || undefined,
        surface: 'modelling-editor',
    }) : undefined
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin]},
        plugins: cloud ? [cloud] : [],
    })
    const {viewer, engine} = editor

    // The scene is never empty to start with: a cube, seen from the default three-quarter view.
    await engine.run('add.cube')
    viewer.getPlugin(PickingPlugin)?.setSelectedObject(undefined, false, false)
    // The start scene is the "home file": nothing to save yet.
    engine.file.markClean()

    // The scripting surface is the agent surface: everything the UI does is reachable from here.
    Object.assign(window as never, {viewer, editor, engine})
    console.log('Try: engine.operators.list().map(o => o.id); engine.run("mesh.extrude")')
}

_testStart()
init().finally(_testFinish)
