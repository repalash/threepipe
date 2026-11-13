import {_testFinish, _testStart, formatShortcut, IObject3D, LoadingScreenPlugin, shortcutsOf, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {
    // The actions of the viewer: one key listener for all their shortcuts. It has no UI of its own.
    const actions = viewer.actions

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const camera = viewer.scene.mainCamera
    actions.register([{
        id: 'autoRotate', label: 'Auto rotate', group: 'View', shortcut: 'Shift+R',
        run: () => {
            if (!camera.controls) return {warn: 'The camera has no controls'}
            camera.controls.autoRotate = !camera.controls.autoRotate
            return undefined
        },
    }, {
        id: 'resetView', label: 'Reset view', group: 'View', shortcut: 'Shift+V',
        run: () => {
            camera.position.set(0, 0, 5)
            camera.target.set(0, 0, 0)
            camera.setDirty()
        },
    }, {
        id: 'toggleModel', label: 'Hide or show the model', group: 'Model', shortcut: 'H',
        enabled: () => !!model,
        run: () => {
            if (!model) return
            model.visible = !model.visible
            model.setDirty?.()
        },
    }, {
        // an action can tell an error or a warning; an editor shows it in a toast
        id: 'upload', label: 'Upload (fails)', group: 'Model', shortcut: 'Shift+U',
        run: async() => ({error: 'No server in this example'}),
    }])

    // Any UI renders the actions: here a list with the keys (⌘ on a Mac), and the result of each run
    const list = document.getElementById('list')!
    const result = document.getElementById('result')!
    for (const action of actions.list()) {
        const button = document.createElement('button')
        // the keys now: the ones that the app set with setShortcut, else the action's own
        button.innerHTML = `<span></span><kbd>${shortcutsOf(actions.shortcutOf(action.id)).map(k => formatShortcut(k)).join(', ')}</kbd>`
        button.firstElementChild!.textContent = action.label
        button.onclick = () => {
            actions.run(action.id)
        }
        list.appendChild(button)
    }
    actions.addEventListener('actionRun', ({action, result: r}) => {
        result.textContent = `${action.label}: ${r.error ?? r.warn ?? 'done'}`
    })

    createExampleCard(viewer, {
        description: 'viewer.actions: the actions of the viewer and their keys, in one place. Any UI can list and run them; below is a small one made by this example (a menu or a command palette works the same). Press a key or click an action.',
        content: document.getElementById('commands')!,
    })

    // Its Actions folder lists the actions too (the editor shows it in its settings)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild(actions.uiConfig, {expanded: true})
}

_testStart()
init().finally(_testFinish)
