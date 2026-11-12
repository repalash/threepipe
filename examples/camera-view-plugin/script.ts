import {
    _testFinish, _testStart,
    CameraView,
    CameraViewPlugin,
    EasingFunctions,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createExampleBar, exampleAction} from '../examples-utils/example-bar.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })
    const cameraViewPlugin = viewer.addPluginSync(CameraViewPlugin)
    console.log(cameraViewPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
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

    const animateTo = async(view: CameraView) => cameraViewPlugin.animateToView(view, 1000, EasingFunctions.easeInOutSine)

    // The buttons at the bottom: uiconfig configs, the same format as the Tweakpane panel on the right.
    // exampleAction also gives a button a key (shown in its tooltip).
    createExampleBar(viewer, [{
        type: 'folder', label: 'Views', children: [
            exampleAction(viewer, {id: 'example.topView', label: 'Top View', icon: 'arrow-up', shortcut: '1', run: async() => animateTo(topView)}),
            exampleAction(viewer, {id: 'example.leftView', label: 'Left View', icon: 'arrow-left', shortcut: '2', run: async() => animateTo(leftView)}),
            exampleAction(viewer, {id: 'example.rightView', label: 'Right View', icon: 'arrow-right', shortcut: '3', run: async() => animateTo(rightView)}),
            exampleAction(viewer, {id: 'example.resetView', label: 'Reset', icon: 'house', shortcut: '0', run: async() => animateTo(initialView)}),
        ],
    }, {
        type: 'folder', label: 'Move', children: [
            // an async button is disabled while its promise runs
            {type: 'button', label: 'Pan right/left', icon: 'move-horizontal', value: async() => {
                const currentView = cameraViewPlugin.getView()
                await animateTo(new CameraView('view', currentView.position, new Vector3(4, 0, 0).sub(currentView.target)))
            }},
            {type: 'button', label: 'Move up/down', icon: 'move-vertical', value: async() => {
                const currentView = cameraViewPlugin.getView()
                await animateTo(new CameraView(
                    'view',
                    new Vector3(currentView.position.x, 5 - currentView.position.y, currentView.position.z),
                    currentView.target,
                ))
            }},
        ],
    }, {
        // Fit to object examples
        type: 'folder', label: 'Fit', children: [
            {type: 'button', label: 'Fit (animated)', icon: 'scan', value: async() => cameraViewPlugin.animateToFitObject(model, 1.5, 1000, EasingFunctions.easeInOutSine)},
            {type: 'button', label: 'Fit (instant)', icon: 'focus', value: () => viewer.fitToView(model, 1.5, 0)},
            {type: 'button', label: 'camera.fitObject', value: () => viewer.scene.mainCamera.fitObject(model!)},
        ],
    }])

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.appendChild(viewer.scene.mainCamera.uiConfig)

    ui.setupPluginUi(CameraViewPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
