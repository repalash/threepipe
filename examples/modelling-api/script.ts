import {
    _testFinish,
    _testStart,
    CameraViewPlugin,
    LoadingScreenPlugin,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {MeshEditPlugin, ReferenceImagePlugin} from '@threepipe/plugin-mesh-edit'
import {Command, ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * The modelling command API, driven by hand.
 *
 * Everything in this page goes through `modelling.run({op, ...})` - the same entry point a script or
 * an agent uses. The console below takes a command as JSON and prints the result; the list on the
 * left is `describeCommands()`, which is also what an agent receives as its tool list. Nothing here
 * is a private path into the plugin.
 *
 * `MeshEditPlugin` is loaded alongside it, so anything built by command can then be edited by hand
 * with Tab, and anything edited by hand can be inspected by command.
 */

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin, TransformControlsPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    // Saved camera views come from threepipe's own plugin; `getOrAdd` because TransformControls
    // already depends on it and adding it twice logs a warning.
    viewer.getOrAddPluginSync(CameraViewPlugin)

    const modelling = viewer.addPluginSync(ModellingPlugin)
    viewer.addPluginSync(MeshEditPlugin)
    viewer.addPluginSync(ReferenceImagePlugin)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(TransformControlsPlugin)
    ui.setupPluginUi(ReferenceImagePlugin)

    // --- console ------------------------------------------------------------------------------

    const logEl = document.getElementById('log')!
    const inputEl = document.getElementById('input') as HTMLTextAreaElement

    function print(text: string, cls = '') {
        const line = document.createElement('div')
        line.className = cls
        line.textContent = text
        logEl.appendChild(line)
        logEl.scrollTop = logEl.scrollHeight
    }

    async function send(command: Command) {
        print('> ' + JSON.stringify(command), 'cmd')
        const result = await modelling.run(command)
        if (!result.ok) {
            print(`  error: ${result.error}`, 'err')
            return result
        }
        for (const w of result.warnings ?? []) print(`  warning: ${w}`, 'warn')
        const summary = result.data === undefined ? '' : ' ' + shorten(JSON.stringify(result.data))
        print(`  ok ${result.ms}ms${summary}`, 'ok')
        return result
    }

    const shorten = (s: string) => s.length > 260 ? s.slice(0, 260) + '…' : s

    async function runInput() {
        const text = inputEl.value.trim()
        if (!text) return
        let parsed: Command | Command[]
        try {
            // Accept a bare list of commands as well as one command.
            parsed = JSON.parse(text.startsWith('[') ? text : text)
        } catch (e) {
            print(`  not valid JSON: ${(e as Error).message}`, 'err')
            return
        }
        for (const command of Array.isArray(parsed) ? parsed : [parsed]) await send(command)
    }

    document.getElementById('run')!.addEventListener('click', runInput)
    inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            runInput()
        }
    })
    document.getElementById('undo')!.addEventListener('click', () => send({op: 'undo'}))
    document.getElementById('capture')!.addEventListener('click', async() => {
        const result = await send({op: 'capture'})
        const url = (result.data as {dataUrl?: string} | undefined)?.dataUrl
        if (url) window.open(url, '_blank')
    })
    document.getElementById('demo')!.addEventListener('click', () => runDemo(send))

    // --- the command list, straight from the plugin --------------------------------------------

    const opList = document.getElementById('op-list')!
    opList.textContent = ''
    for (const {name, description} of modelling.describeCommands()) {
        const row = document.createElement('div')
        row.className = 'op'
        row.innerHTML = `<code>${name}</code> <em>${description.split('\n')[0]}</em>`
        row.title = 'click to put a skeleton command in the console'
        row.addEventListener('click', () => {
            const def = modelling.commands.get(name)!
            const example: Record<string, unknown> = {op: name}
            for (const key of def.schema.required ?? []) example[key] = null
            inputEl.value = JSON.stringify(example, null, 0)
            inputEl.focus()
        })
        opList.appendChild(row)
    }

    document.getElementById('doc-id')!.textContent = modelling.document.documentId

    modelling.addEventListener('documentChanged', () => viewer.setDirty())

    // Start with something on screen, through the API like everything else.
    await modelling.run({op: 'primitive', type: 'cube', name: 'hull', width: 2.4, height: 0.9, depth: 6})
    await modelling.run({op: 'camera', view: 'iso', fit: '*'})
    print('ready - type a command, or click one on the left', 'ok')

    Object.assign(window as never, {viewer, modelling})
}

/** A short build that exercises the four generators, so the page shows what the API is for. */
async function runDemo(send: (c: Command) => Promise<unknown>) {
    const wheelProfile = [[0, -0.06], [0.28, -0.06], [0.32, -0.02], [0.32, 0.02], [0.28, 0.06], [0, 0.06]]
    await send({op: 'delete', object: '*'})
    await send({op: 'primitive', type: 'cube', name: 'hull', width: 2.4, height: 0.9, depth: 6,
        position: [0, 0.75, 0], color: '#5d6b53'})
    await send({op: 'lathe', name: 'wheel', profile: wheelProfile, axis: 'x', segments: 24,
        position: [-1.25, 0.35, -2.1], color: '#3f463a'})
    await send({op: 'array', object: 'wheel', count: 6, step: [0, 0, 0.84], merge: false})
    await send({op: 'duplicate', object: 'wheel', name: 'wheel-right', scale: [-1, 1, 1]})
    await send({op: 'sweep', name: 'rail', radius: 0.03, steps: 8, color: '#8a8f86',
        path: [[-1.1, 1.25, -2.4], [-1.1, 1.45, -1.6], [-1.1, 1.45, 0.4], [-1.1, 1.25, 1.2]]})
    await send({op: 'camera', view: 'iso', fit: '*'})
    await send({op: 'selftest'})
}

_testStart()
init().finally(_testFinish)
