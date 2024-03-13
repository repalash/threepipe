import {_testFinish, IObject3D, ThreeFirstPersonControlsPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [ThreeFirstPersonControlsPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.appendChild(viewer.scene.mainCamera.uiConfig)

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const overlayEl = document.getElementById('firstPersonControlsOverlay') as HTMLDivElement
    overlayEl.addEventListener('click', () => {
        viewer.scene.mainCamera.controlsMode = 'threeFirstPerson'
        overlayEl.style.display = 'none'
    })

}

init().then(_testFinish)
