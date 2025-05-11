import {
    _testFinish,
    _testStart,
    DeviceOrientationControlsPlugin,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [DeviceOrientationControlsPlugin, LoadingScreenPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.appendChild(viewer.scene.mainCamera.uiConfig)

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const overlayEl = document.getElementById('deviceOrientationOverlay') as HTMLDivElement
    overlayEl.addEventListener('click', () => {
        viewer.scene.mainCamera.controlsMode = 'deviceOrientation'
        overlayEl.style.display = 'none'
    })

}

_testStart()
init().finally(_testFinish)
