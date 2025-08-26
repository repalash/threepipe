import {_testFinish, _testStart, LoadingScreenPlugin, PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {HierarchyUiPlugin} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, HierarchyUiPlugin, PickingPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(HierarchyUiPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)

    await viewer.load('https://samples.threepipe.org/demos/classic-watch.glb')
}

_testStart()
init().finally(_testFinish)
