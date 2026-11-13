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
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
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

    createExampleCard(viewer, {
        description: 'DepthOfFieldPlugin (webgi-plugins) blurs what is nearer or farther than the focal point, like a camera lens. With Click to focus on, click an object to move the focus to it. Turn the effect off to compare.',
        actions: [
            {type: 'checkbox', label: 'Depth of field', icon: 'focus', property: [dofPlugin, 'enabled']},
            {type: 'checkbox', label: 'Click to focus', icon: 'circle-dot', property: [dofPlugin, 'enableEdit']},
            {type: 'slider', label: 'Near blur', bounds: [0, 1], stepSize: 0.01, property: [dofPlugin.pass!, 'nearBlurScale']},
            {type: 'slider', label: 'Far blur', bounds: [0, 1], stepSize: 0.01, property: [dofPlugin.pass!, 'farBlurScale']},
        ],
    })
}

_testStart()
init().finally(_testFinish)
