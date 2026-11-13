import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    ThreeFirstPersonControlsPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [ThreeFirstPersonControlsPlugin, LoadingScreenPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.appendChild(viewer.scene.mainCamera.uiConfig)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const overlayEl = document.getElementById('firstPersonControlsOverlay') as HTMLDivElement
    const camera = viewer.scene.mainCamera
    const setFirstPerson = (on: boolean) => {
        camera.controlsMode = on ? 'threeFirstPerson' : 'orbit'
        overlayEl.style.display = on ? 'none' : 'flex'
    }
    overlayEl.addEventListener('click', () => setFirstPerson(true))

    createExampleCard(viewer, {
        description: 'ThreeFirstPersonControlsPlugin (FirstPersonControls of three.js): the camera looks where the pointer is; hold the left button to move forward, the right one to move back. Click the canvas to start; switch back to orbit controls here.',
        actions: [
            {type: 'checkbox', label: 'First person controls', icon: 'eye', getValue: () => camera.controlsMode === 'threeFirstPerson', setValue: setFirstPerson},
        ],
    })

}

_testStart()
init().finally(_testFinish)
