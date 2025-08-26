import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    PointerLockControlsPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
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
    viewer.scene.mainCamera.controls?.addEventListener('lock', ()=> overlayEl.style.display = 'none')
    viewer.scene.mainCamera.controls?.addEventListener('unlock', ()=> overlayEl.style.display = 'flex')

}

_testStart()
init().finally(_testFinish)
