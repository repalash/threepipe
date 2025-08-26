import {
    _testFinish, _testStart,
    CameraView,
    CameraViewPlugin,
    EasingFunctions,
    LoadingScreenPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })
    const cameraViewPlugin = viewer.addPluginSync(CameraViewPlugin)
    console.log(cameraViewPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    // Get the current camera view and save it in a variable
    const initialView = cameraViewPlugin.getView()

    const topView = new CameraView(
        'topView',
        new Vector3(0, 6, 0),
        initialView.target,
    )

    const leftView = new CameraView(
        'leftView',
        new Vector3(-6, 0, 0),
        initialView.target,
    )

    const rightView = new CameraView(
        'rightView',
        new Vector3(6, 0, 0),
        initialView.target,
    )

    createSimpleButtons({
        ['Top View']: async() => cameraViewPlugin.animateToView(topView, 1000, EasingFunctions.easeInOutSine),
        ['Left View']: async() => cameraViewPlugin.animateToView(leftView, 1000, EasingFunctions.easeInOutSine),
        ['Right View']: async() => cameraViewPlugin.animateToView(rightView, 1000, EasingFunctions.easeInOutSine),

        ['Pan right/left']: async(btn) => {
            btn.disabled = true
            const currentView = cameraViewPlugin.getView()
            await cameraViewPlugin.animateToView(new CameraView(
                'view',
                currentView.position,
                new Vector3(4, 0, 0).sub(currentView.target),
            ))
            btn.disabled = false
        },
        ['Move up/down']: async(btn) => {
            btn.disabled = true
            const currentView = cameraViewPlugin.getView()
            await cameraViewPlugin.animateToView(new CameraView(
                'view',
                new Vector3(currentView.position.x, 5 - currentView.position.y, currentView.position.z),
                currentView.target,
            ))
            btn.disabled = false
        },

        ['Reset']: async() => cameraViewPlugin.animateToView(initialView, 1000, EasingFunctions.easeInOutSine),
    })

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.appendChild(viewer.scene.mainCamera.uiConfig)

    ui.setupPluginUi(CameraViewPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
