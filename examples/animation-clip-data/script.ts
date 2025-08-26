import {_testFinish, _testStart, GLTFAnimationPlugin, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {TimelineUiPlugin} from '@threepipe/plugin-timeline-ui'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, GLTFAnimationPlugin, new TimelineUiPlugin(false)],
    })
    viewer.scene.mainCamera.position.set(4, 2, 5)
    viewer.scene.mainCamera.fov = 70
    viewer.timeline.endTime = 2

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild(viewer.timeline.uiConfig, {expanded: true})
    ui.setupPluginUi(TimelineUiPlugin, {expanded: true})

    viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const anim = viewer.getPlugin(GLTFAnimationPlugin)!
    for (let i = 0; i < 10; i++) {
        const m1 = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/Horse.glb', {
            autoCenter: true,
            autoScale: true,
            i,
        })
        if (m1) {
            m1.position.set(i - 5, 0, 0)
            const a = anim.animations.find(a1=> a1.object === m1)
            if (a) {
                // clipData is setup by GLTFAnimationPlugin when the object with this animation is added to the scene above
                a.actions[0].clipData!.startTime = i * 0.15
                a.actions[0].clipData!.timeScale = 2.5
            }
        }
    }

    viewer.timeline.start()
}

_testStart()
init().finally(_testFinish)
