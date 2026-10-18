import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {AgentSocketPlugin, ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * The modelling editor with an agent driving it over the agent socket.
 *
 * Start a relay - `npm run modelling -- relay` prints its URL and token - then File > Connect Agent… (or
 * open this page with `?agent=<url>&agentToken=<token>`). Every command the agent sends runs through
 * `ModellingPlugin.run`, lands in the undo history beside your own steps, and shows in the header's
 * agent indicator; Ctrl+Z undoes an agent's step like any other. An MCP client reaches the same socket
 * through `@threepipe/modelling-mcp`.
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
    engine.file.markClean()
    Object.assign(window as never, {
        viewer, editor, engine,
        modelling: viewer.getPlugin(ModellingPlugin),
        agentSocket: viewer.getPlugin(AgentSocketPlugin),
    })
}

_testStart()
init().finally(_testFinish)
