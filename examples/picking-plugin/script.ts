import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const picking = viewer.addPluginSync(PickingPlugin)
    picking.hoverEnabled = true

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(PickingPlugin)

    // the events of the picking, shown in the card
    let hovered = '', selected = '', lastHit = ''
    const nameOf = (o?: {name?: string, uuid?: string} | null) => o ? o.name || o.uuid?.slice(0, 8) || '' : ''
    picking.addEventListener('hitObject', (e)=>{
        lastHit = nameOf(e.intersects.selectedObject)
        // set to null to prevent selection
        // e.intersects.selectedObject = null
    })
    picking.addEventListener('selectedObjectChanged', (e)=>{
        selected = e.objects?.length > 1 ? `${e.objects.length} objects` : nameOf(e.object ?? e.material)
    })
    picking.addEventListener('hoverObjectChanged', (e)=>{
        hovered = nameOf(e.object ?? e.material)
    })

    createExampleCard(viewer, {
        description: 'PickingPlugin selects the object under the pointer on a click and draws a box around it; hovering marks the object under the pointer. Shift or Ctrl/Cmd + click adds to the selection. The rows show its events.',
        actions: [
            {type: 'monitor', label: 'Hovered', getValue: () => hovered || '-'},
            {type: 'monitor', label: 'Selected', getValue: () => selected || '-'},
            {type: 'monitor', label: 'Last hit', getValue: () => lastHit || '-'},
            {type: 'checkbox', label: 'Hover', icon: 'eye', property: [picking, 'hoverEnabled']},
            {type: 'checkbox', label: 'Multi-select', icon: 'layers', property: [picking, 'multiSelectEnabled']},
        ],
    })

}

_testStart()
init().finally(_testFinish)
