import {_testFinish, _testStart, LoadingScreenPlugin, PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {NotesPlugin} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin],
    })

    // Scene notes are saved in the viewer config (and in an exported .glb), page notes in this browser
    viewer.addPluginSync(new NotesPlugin({
        pageKey: 'threepipe-example-notes',
        contextProvider: () => 'Notes example', // extra text for the "+ Context" line
    }))

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(NotesPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)

    await viewer.load('https://samples.threepipe.org/demos/classic-watch.glb')
}

_testStart()
init().finally(_testFinish)
