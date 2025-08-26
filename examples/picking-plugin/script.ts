import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
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

    picking.addEventListener('hitObject', (e)=>{
        console.log('Hit object', e, e.intersects.selectedObject)
        // set to null to prevent selection
        // e.intersects.selectedObject = null
    })
    picking.addEventListener('selectedObjectChanged', (e)=>{
        console.log('Selected Object Changed', e)
    })

    picking.addEventListener('hoverObjectChanged', (e)=>{
        console.log('Hover Object Changed', e)
    })

}

_testStart()
init().finally(_testFinish)
