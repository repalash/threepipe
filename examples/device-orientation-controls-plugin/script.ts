import {
    _testFinish,
    _testStart,
    DeviceOrientationControlsPlugin,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [DeviceOrientationControlsPlugin, LoadingScreenPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.appendChild(viewer.scene.mainCamera.uiConfig)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const overlayEl = document.getElementById('deviceOrientationOverlay') as HTMLDivElement
    const camera = viewer.scene.mainCamera
    const setDeviceOrientation = (on: boolean) => {
        camera.controlsMode = on ? 'deviceOrientation' : 'orbit'
        overlayEl.style.display = on ? 'none' : 'flex'
    }
    overlayEl.addEventListener('click', () => setDeviceOrientation(true))

    createExampleCard(viewer, {
        description: 'DeviceOrientationControlsPlugin: the camera turns with the phone or tablet (its gyroscope). Tap the canvas to start (the browser may ask for motion access); switch back to orbit controls here.',
        actions: [
            {type: 'checkbox', label: 'Device orientation controls', icon: 'rotate-3d', getValue: () => camera.controlsMode === 'deviceOrientation', setValue: setDeviceOrientation},
        ],
    })

}

_testStart()
init().finally(_testFinish)
