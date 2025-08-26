import {
    _testFinish,
    _testStart,
    AnimationObjectPlugin,
    CameraViewPlugin,
    GLTFAnimationPlugin,
    LoadingScreenPlugin,
    OrbitControls3,
    PickingPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {TimelineUiPlugin} from '@threepipe/plugin-timeline-ui'
import {MaterialConfiguratorPlugin} from '@threepipe/plugin-configurator'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, CameraViewPlugin, MaterialConfiguratorPlugin, GLTFAnimationPlugin, AnimationObjectPlugin, TimelineUiPlugin, PickingPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(TimelineUiPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin, {expanded: true})

    await viewer.load('https://samples.threepipe.org/demos/classic-watch.glb')

    viewer.getPlugin(CameraViewPlugin)!.viewPauseTime = 0
    viewer.getPlugin(CameraViewPlugin)!.animEase = 'linear'
    viewer.timeline.endTime = 12
    const controls = viewer.scene.mainCamera.controls as OrbitControls3
    controls.maxPolarAngle = Math.PI // because it's limited in the glb file
}

_testStart()
init().finally(_testFinish)
