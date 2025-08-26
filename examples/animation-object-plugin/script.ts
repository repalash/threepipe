import {
    _testFinish,
    _testStart,
    AnimationObjectPlugin,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {TimelineUiPlugin} from '@threepipe/plugin-timeline-ui'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, AnimationObjectPlugin, new TimelineUiPlugin(true)],
    })
    viewer.timeline.endTime = 5 // 5 secs

    // Setup a basic UI for development
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild(viewer.timeline.uiConfig, {expanded: true})
    ui.setupPluginUi(TimelineUiPlugin, {expanded: false})

    viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const helmet = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    if (!helmet) {
        console.error('Unable to load model')
        return
    }

    const plugin = viewer.getPlugin(AnimationObjectPlugin)!

    viewer.scene.setBackgroundColor(0xffffff)

    // Create an animation bound to the helmet object and changes the position property.
    const animPosition = plugin.addAnimation('position', helmet)
    // basic properties
    animPosition.delay = 1000 // 2 secs
    animPosition.duration = 3000 // 1 sec
    // name for the ui
    animPosition.name = 'Object Position'
    // keyframes
    animPosition.values = [new Vector3(0, 0, 0), new Vector3(-1, 0, -1), new Vector3(-1, -1, 1), new Vector3(1, -1, -1), new Vector3(0, 0, 0)]
    animPosition.offsets = [0, 0.25, 0.5, 0.6, 1]
    animPosition.updateTarget = true // calls helmet.setDirty() on update

    // Create an animation to animate the background color in the viewer.
    // If no target is specified, the animation will be applied to the viewer. i.e in this case it will access viewer.scene.backgroundColor
    const anim1 = plugin.addAnimation('scene.backgroundColor')
    // or if you want to create the animation manually.
    // const anim1 = new AnimationObject()
    // anim1.access = 'scene.backgroundColor'
    // plugin.addAnimation(undefined, undefined, anim1)

    anim1.name = 'Background Color Animation'
    anim1.values = ['#ffffff', '#ff0000']
    anim1.delay = 0
    anim1.duration = 3000 // 1 sec
    anim1.updateViewer = true // calls viewer.setDirty() on update

    // play one animation manually
    await anim1.animate().promise

    // start the timeline with all the animations
    viewer.timeline.start()

}

_testStart()
init().finally(_testFinish)
