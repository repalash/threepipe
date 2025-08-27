import {
    _testFinish, _testStart,
    CustomBumpMapPlugin,
    ITexture,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    PlaneGeometry,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const customBump = viewer.addPluginSync(CustomBumpMapPlugin)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const model = new Mesh(new PlaneGeometry(4, 2), new PhysicalMaterial())
    const material = model.material
    viewer.scene.addObject(model)

    const bumpMap1 = await viewer.load<ITexture>('https://samples.threepipe.org/minimal/brick_bump.webp')
    const bumpMap2 = await viewer.load<ITexture>('https://samples.threepipe.org/minimal/planets/earth_specular_2048.jpg')
    customBump.enableCustomBump(material, bumpMap2, -4)
    material.bumpMap = bumpMap1 || null
    material.bumpScale = -3
    material.setDirty()

    // set properties like this or from the UI
    // material.userData._customBumpMat = texture
    // material.setDirty()

    // to disable
    // material.userData._hasCustomBump = false
    // material.setDirty()

    ui.setupPluginUi(CustomBumpMapPlugin)
    const config = material.uiConfig!
    ui.appendChild(customBump.materialExtension.getUiConfig?.(material), {expanded: true})
    ui.appendChild(config)

}

_testStart()
init().finally(_testFinish)
