import {
    _testFinish, _testStart,
    DepthBufferPlugin,
    FilmicGrainPlugin,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
    TonemapPlugin,
    UnsignedByteType,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        tonemap: true, // this is true by default
        plugins: [LoadingScreenPlugin],
    })

    // A GBuffer(depth buffer here) is required for the `tonemapBackground` flag in TonemapPlugin to work
    viewer.addPluginSync(new DepthBufferPlugin(UnsignedByteType, true))

    // FilmicGrain off by default so the existing initial snapshot is unaffected; the
    // interactive test enables it to verify the post-tonemap priority order.
    viewer.addPluginSync(new FilmicGrainPlugin(false))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(TonemapPlugin)
    // FilmicGrain not surfaced in UI to keep the panel layout stable for snapshot tests;
    // the interactive test enables it programmatically via `viewer.getPlugin('FilmicGrain')`.

}

_testStart()
init().finally(_testFinish)
