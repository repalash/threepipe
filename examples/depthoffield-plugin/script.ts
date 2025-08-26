import {
    _testFinish, _testStart,
    IObject3D,
    LoadingScreenPlugin,
    PhysicalMaterial,
    PickingPlugin,
    SSAAPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin, DepthOfFieldPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        // rgbm: false,
        plugins: [LoadingScreenPlugin, SSAAPlugin, BloomPlugin, PickingPlugin],
    })

    const dofPlugin = viewer.addPluginSync(DepthOfFieldPlugin)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
        autoScaleRadius: 15,
    })
    const model = result?.getObjectByName('node_damagedHelmet_-6514')
    const materials = (model?.materials || []) as PhysicalMaterial[]

    ui.setupPluginUi(dofPlugin)

    for (const material of materials) {
        ui.appendChild(material.uiConfig)
    }

    const target = new Vector3(3.8885332252383376, -1.7116614197503317, 5.3296364320040475)
    dofPlugin.setFocalPoint(target, false, true)
    dofPlugin.enableEdit = true
    viewer.scene.mainCamera.target.copy(target)
    viewer.scene.mainCamera.position.set(0, 0, -5)
    viewer.scene.mainCamera.setDirty()
}

_testStart()
init().then(_testFinish)
