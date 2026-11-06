import {_testFinish, _testStart, getUrlQueryParam, LoadingScreenPlugin, PickingPlugin, ThreeViewer, ViewerUiConfigPlugin} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorFrame, EditorPageLayout, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    // The floating layout at the first visit (it shows the drag of the cards); the layout picked in the layout menu is
    // kept. ?layout=titlebar | statusbar | floating | classic sets one for this visit.
    TweakpaneEditorPlugin.DefaultLayout = 'floating'
    // its own keys in localStorage for the layout and the areas, so the other editor pages keep theirs
    TweakpaneEditorPlugin.LayoutStorageKey = 'tpEditorFrameAreasExampleLayout'
    EditorFrame.AreaStorageKey = 'tpEditorFrameAreasExampleAreas'

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin],
    })
    // after the viewer is made: it shows viewer.uiConfig
    viewer.addPluginSync(ViewerUiConfigPlugin)

    viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())
    editor.loadPlugins({
        ['Viewer']: [ViewerUiConfigPlugin],
        ['Interaction']: [PickingPlugin],
    })
    const layout = getUrlQueryParam('layout') as EditorPageLayout | null
    if (layout) editor.layout = layout

    // Panels in the places of the page frame. The panels of a place are a stack: the place is split between them, with
    // a line between two (in the floating layout each panel is a card, and the split is a gap with drag dots). Each panel
    // has an entry in the mode bar, after the modes, with a name, an icon and a colour: a tap shows or hides it, a
    // right-click (a long press on a touch screen) moves it to another place. The plugin keeps the panels when it makes
    // the frame again (a change of the layout); removePanel(id) takes one out.
    editor.addPanel('notes', sampleArea('Left area', [
        'Drag the inner edge to resize, past half of the smallest size to collapse; double-click it for the default size.',
        'Floating layout: drag the dots in the gap at the window edge to move the card; double-click them to put it back.',
        'Floating layout: drag the top or the bottom edge to make the card shorter; double-click it to fill the side.',
        'The entry in the mode bar shows or hides this panel; a right-click on it moves it to another place. In a narrow window, the places show in the place of the panel, one at a time.',
    ]), {name: 'Notes', icon: ICON_LIST, color: '#7c5cff', area: 'left'})
    editor.addPanel('second', sampleArea('Second panel', [
        'A stack: drag the line (the dots in the floating layout) above this panel to move the split; double-click it for equal sizes.',
    ]), {name: 'Second', icon: ICON_LIST, color: '#10b981', area: 'left'})
    editor.addPanel('timeline', sampleArea('Bottom place', [
        'A strip below the canvas, between the left place and the panel: a timeline, a console, a list of assets.',
    ], true), {name: 'Timeline', icon: ICON_CLOCK, color: '#f59e0b', area: 'bottom'})
    editor.addPanel('console', sampleArea('Console', ['The bottom place stacks its panels left to right.']), {name: 'Console', icon: ICON_LIST, color: '#ef4444', area: 'bottom'})

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {autoCenter: true, autoScale: true})
}

/** A sample element for an area: a title, lines of text and, for the bottom area, a ruler like a timeline */
function sampleArea(title: string, lines: string[], ruler = false) {
    const el = document.createElement('div')
    el.style.cssText = 'padding: 12px; font: 12px/1.5 system-ui, sans-serif; overflow: auto; box-sizing: border-box'
    const h = document.createElement('div')
    h.textContent = title
    h.style.cssText = 'font-weight: 600; margin-bottom: 8px'
    el.appendChild(h)
    for (const line of lines) {
        const p = document.createElement('p')
        p.textContent = line
        p.style.cssText = 'margin: 0 0 8px; opacity: .75'
        el.appendChild(p)
    }
    if (ruler) {
        const r = document.createElement('div')
        r.style.cssText = 'height: 24px; margin-top: 8px; opacity: .5; background: repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 40px) bottom / 100% 12px no-repeat, repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 8px) bottom / 100% 6px no-repeat'
        el.appendChild(r)
    }
    return el
}

const ICON_LIST = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5.5 4h7M5.5 8h7M5.5 12h7M3 4h.01M3 8h.01M3 12h.01"/></svg>'
const ICON_CLOCK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></svg>'

_testStart()
init().finally(_testFinish)
