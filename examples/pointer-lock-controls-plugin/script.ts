import {_testFinish, IObject3D, PointerLockControlsPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PointerLockControlsPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.appendChild(viewer.scene.mainCamera.uiConfig)

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    viewer.scene.mainCamera.controlsMode = 'pointerLock'

    const overlayEl = document.getElementById('pointerLockOverlay') as HTMLDivElement
    viewer.scene.mainCamera.controls?.addEventListener('lock', ()=> overlayEl.style.display = 'none')
    viewer.scene.mainCamera.controls?.addEventListener('unlock', ()=> overlayEl.style.display = 'flex')

}

init().finally(_testFinish)
