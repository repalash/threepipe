import {_testFinish, _testStart, LoadingScreenPlugin, PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {StickyNotesPlugin} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin],
    })

    // A post-it on the canvas: drag it by its header. Scene notes are saved in the viewer config (and in an exported
    // .glb), page notes in this browser.
    viewer.addPluginSync(new StickyNotesPlugin({
        pageKey: 'threepipe-example-sticky-notes',
        contextProvider: () => 'Sticky notes example', // extra text for the "+ Context" line
    }))

    // the settings of the note: show, colour, collapse, save in the file, reset position
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(StickyNotesPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)

    await viewer.load('https://samples.threepipe.org/demos/classic-watch.glb')
}

_testStart()
init().finally(_testFinish)
