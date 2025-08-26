import {
    _testFinish, _testStart,
    FrameFadePlugin,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {WatchHandsPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin, PickingPlugin, FrameFadePlugin, SSAAPlugin, TemporalAAPlugin, SSReflectionPlugin],
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
    })

    // To get the watch to show the correct hands, we need to set the offsets
    // These offsets can also be set in the editor, so you can load with the watch model without setting them here.
    const wh = viewer.addPluginSync(WatchHandsPlugin)
    wh.invertAxis = true
    wh.hourOffset = 10
    wh.minuteOffset = 7
    wh.secondOffset = 38
    wh.analog = true

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(WatchHandsPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)
    ui.appendChild(viewer.uiConfig)

    // environment map is set in the editor, but you can also set it here
    // await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    await viewer.load<IObject3D>('https://samples.threepipe.org/demos/classic-watch.glb')

}

_testStart()
init().finally(_testFinish)
