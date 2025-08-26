import {
    _testFinish, _testStart,
    generateUiFolder,
    IGeometry,
    IMaterial,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    SimplifyModifierPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {SimplifyModifier} from 'three/examples/jsm/modifiers/SimplifyModifier.js'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

class SimplifyModifierPluginImpl extends SimplifyModifierPlugin {
    protected _simplify(geometry: IGeometry, count: number) {
        const res = new SimplifyModifier().modify(geometry, count) as IGeometry
        res.computeVertexNormals()
        return res
    }
    uiConfig = generateUiFolder('Simplify Modifier', this)
}
async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin, LoadingScreenPlugin],
    })

    const simplify = viewer.addPluginSync(SimplifyModifierPluginImpl)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const mats: IMaterial[] = []
    result?.traverse((obj) => {
        obj.materials?.map(m=>{
            if (!m) return
            m.wireframe = true
            mats.push(m)
        })
    })

    createSimpleButtons({
        ['Simplify']: async(_: HTMLButtonElement) => {
            await simplify.simplifyAll(result, {factor: 0.5})
        },
    })

    ui.setupPluginUi(SimplifyModifierPluginImpl)
    mats.forEach(m=>ui.appendChild(m.uiConfig, {expanded: false}))

}

_testStart()
init().finally(_testFinish)
