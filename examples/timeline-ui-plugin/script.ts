import {
    _testFinish,
    _testStart,
    CameraViewPlugin,
    GLTFAnimationPlugin,
    LoadingScreenPlugin,
    MaterialConfiguratorBasePlugin, OrbitControls3,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {TimelineUiPlugin} from '@threepipe/plugin-timeline-ui'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, CameraViewPlugin, MaterialConfiguratorBasePlugin, GLTFAnimationPlugin, TimelineUiPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(TimelineUiPlugin, {expanded: true})

    await viewer.load('https://asset-samples.threepipe.org/demos/classic-watch.glb')

    viewer.getPlugin(CameraViewPlugin)!.viewPauseTime = 0
    viewer.getPlugin(CameraViewPlugin)!.animEase = 'linear'
    viewer.timeline.endTime = 12
    const controls = viewer.scene.mainCamera.controls as OrbitControls3
    controls.maxPolarAngle = Math.PI
}

_testStart()
init().finally(_testFinish)
