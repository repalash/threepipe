import {_testFinish, CustomBumpMapPlugin, ITexture, Mesh, PhysicalMaterial, PlaneGeometry, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
    })

    const customBump = viewer.addPluginSync(CustomBumpMapPlugin)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    const model = new Mesh(new PlaneGeometry(4, 2), new PhysicalMaterial())
    const material = model.material
    viewer.scene.addObject(model)

    const bumpMap1 = await viewer.load<ITexture>('https://threejs.org/examples/textures/brick_bump.jpg')
    const bumpMap2 = await viewer.load<ITexture>('https://threejs.org/examples/textures/planets/earth_specular_2048.jpg')
    customBump.enableCustomBump(material, bumpMap2, -0.2)
    material.bumpMap = bumpMap1 || null
    material.bumpScale = -0.01
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

init().finally(_testFinish)
