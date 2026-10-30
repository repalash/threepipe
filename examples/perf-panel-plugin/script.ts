import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, PerfPanelPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {
    // An FPS pill in the corner. Click it for the card: frame times, render time, draws, GPU and warnings.
    // The same numbers are in code: perf.stats, and the 'update' event 4 times per second
    viewer.addPluginSync(new PerfPanelPlugin({position: 'bottom-left'}))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(PerfPanelPlugin, {expanded: true})
    // The viewer renders only when something changes: auto rotate makes it render every frame
    ui.appendChild({
        type: 'checkbox',
        label: 'Auto Rotate',
        property: [viewer.scene.mainCamera.controls, 'autoRotate'],
    })
}

_testStart()
init().finally(_testFinish)
