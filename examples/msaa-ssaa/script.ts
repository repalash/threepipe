import {
    _testFinish, _testStart, InteractionPromptPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PhysicalMaterial,
    ProgressivePlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        debug: true,
        msaa: true,
        rgbm: true,
        renderScale: 1,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
                importConfig: true,
            },
        },
        plugins: [LoadingScreenPlugin, InteractionPromptPlugin],
    })

    viewer.addPluginSync(new SSAAPlugin())

    await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        // viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/IridescenceLamp.glb', {
        //     autoCenter: true,
        //     autoScale: true,
        // }),
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/LittlestTokyo.glb', {
            autoCenter: true,
            autoScale: true,
        }),
    ])

    viewer.renderManager.renderPass.overrideMaterial = new PhysicalMaterial({
        color: 'white',
        roughness: 1,
        metalness: 0,
        wireframe: true,
    })

    viewer.scene.mainCamera.position.set(0, 0, 3.5)


    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild({
        type: 'toggle',
        label: 'Auto Rotate',
        property: [viewer.scene.mainCamera.controls, 'autoRotate'],
    })
    ui.setupPluginUi(SSAAPlugin, {
        expanded: true,
    })
    ui.setupPlugins(ProgressivePlugin)
    ui.appendChild(viewer.renderManager.uiConfig)

    await viewer.getPlugin(ProgressivePlugin)?.convergedPromise

    console.log('converged')
}

_testStart()
init().finally(_testFinish)
