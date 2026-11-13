import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    PointerLockControls2,
    PointerLockControlsPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PointerLockControlsPlugin, LoadingScreenPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.appendChild(viewer.scene.mainCamera.uiConfig)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    viewer.scene.mainCamera.controlsMode = 'pointerLock'

    const overlayEl = document.getElementById('pointerLockOverlay') as HTMLDivElement
    const controls = viewer.scene.mainCamera.controls as PointerLockControls2 | undefined
    let locked = false
    controls?.addEventListener('lock', ()=> {
        locked = true
        overlayEl.style.display = 'none'
    })
    controls?.addEventListener('unlock', ()=> {
        locked = false
        overlayEl.style.display = 'flex'
    })

    createExampleCard(viewer, {
        description: 'PointerLockControlsPlugin: click the canvas to lock the pointer, then move the mouse to look around, like a first-person game. Esc unlocks the pointer.',
        actions: [
            {type: 'monitor', label: 'Pointer', getValue: () => locked ? 'Locked: move the mouse to look' : 'Free: click the canvas'},
        ],
    })

}

_testStart()
init().finally(_testFinish)
