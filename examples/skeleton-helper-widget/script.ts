import {
    _testFinish,
    _testStart,
    getUrlQueryParam,
    GLTFAnimationPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        renderScale: 'auto',
        plugins: [Object3DWidgetsPlugin, PickingPlugin, TransformControlsPlugin, GLTFAnimationPlugin],
        dropzone: false,
    })

    await viewer.setEnvironmentMap(getUrlQueryParam('env') ?? 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://threejs.org/examples/models/gltf/Soldier.glb', {
        autoScale: true,
        autoCenter: true,
        createUniqueNames: true, // because animations are set as such
    })
    // Set up UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.setupPluginUi(Object3DWidgetsPlugin)

    viewer.scene.mainCamera.position.set(0, 0, -4)

    const gltfAnim = viewer.getPlugin(GLTFAnimationPlugin)
    gltfAnim?.playAnimation()
}

_testStart()
init().finally(_testFinish)
