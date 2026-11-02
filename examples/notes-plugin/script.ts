import {_testFinish, _testStart, LoadingScreenPlugin, PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {NotesPlugin, StickyNotesUiPlugin} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin],
    })

    // The notes and where they are kept: in the file (the viewer config, so an exported .glb) and in this browser.
    // An app can add its own store, for example new HttpNotesStore('/api/notes') for a server.
    viewer.addPluginSync(new NotesPlugin({
        browser: 'threepipe-example-notes',
        contextProvider: () => 'Notes example', // extra text for the "+ Context" line
    }))
    // The notes as post-its over the canvas: a post-it per note (board), or one post-it with all of them (stack)
    // false: show the post-its at once (the plugin starts them minimized by default)
    viewer.addPluginSync(new StickyNotesUiPlugin('threepipe-example-sticky-notes', false))

    // the settings of the notes and of the post-its
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(StickyNotesUiPlugin, {expanded: true})
    ui.setupPluginUi(NotesPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)

    await viewer.load('https://samples.threepipe.org/demos/classic-watch.glb')
}

_testStart()
init().finally(_testFinish)
