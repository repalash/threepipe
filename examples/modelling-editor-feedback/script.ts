import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin, parseCommands} from '@threepipe/plugin-modelling'
import {ThreepipeCloudPlugin} from '@threepipe/plugin-cloud'

/**
 * The modelling editor with Report a Problem and Send Feedback (`@threepipe/plugin-cloud`).
 *
 * Help > Report a Problem…, Help > Send Feedback…, the header's chat button and the Report action on an
 * error toast all open the same dialog. A report carries what its checkboxes say: a screenshot, the
 * page's warnings and errors (redacted), the browser and graphics card, the editor's state with the
 * modelling command transcript (`examples/modelling-replay` replays it), and the scene as .glb if asked.
 *
 * It goes to a threepipe-cloud worker: run one locally with `npm run dev:cloud` (port 9389) and open this
 * page with `?cloud=http://localhost:9389`, or another worker's URL. Without `?cloud=` the dialog can only
 * Download the report. Turnstile uses Cloudflare's test site key here, which always passes; the local
 * worker uses the matching test secret.
 */

async function init() {
    const params = new URLSearchParams(location.search)
    const cloud = new ThreepipeCloudPlugin({
        endpoint: params.get('cloud') || undefined,
        surface: 'modelling-editor',
        turnstileSiteKey: '1x00000000000000000000AA',
        versions: {app: '0.1.0'},
    })
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin]},
        plugins: [cloud],
        engine: {keymap: 'blender', storageKey: null},
        onboarding: false,
    })
    const {viewer, engine} = editor
    await engine.run('add.cube')
    engine.file.markClean()
    // parseCommands reads a report's transcript.json the way examples/modelling-replay does.
    Object.assign(window as never, {viewer, editor, engine, cloud, modelling: viewer.getPlugin(ModellingPlugin), parseCommands})
}

_testStart()
init().finally(_testFinish)
