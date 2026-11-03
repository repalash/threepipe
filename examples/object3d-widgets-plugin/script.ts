import {
    _testFinish, _testStart,
    CameraViewPlugin,
    DirectionalLight2,
    LoadingScreenPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [CameraViewPlugin, Object3DGeneratorPlugin, LoadingScreenPlugin],
    })
    const widgets = viewer.addPluginSync(Object3DWidgetsPlugin)
    // click the icon (or the lines) of a light or a camera to select it
    const picking = viewer.addPluginSync(PickingPlugin)

    // icons are on by default (showIcons, iconSize in px); the frustum of shadow cameras is off by default
    widgets.showShadowFrustum = true

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(Object3DWidgetsPlugin)
    ui.setupPluginUi(PickingPlugin)

    viewer.scene.setBackgroundColor('#444466')

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    console.log(widgets.helpers)

    const generator = viewer.getPlugin(Object3DGeneratorPlugin)!
    let object

    object = generator.generate('camera-perspective', {
        position: new Vector3(5, 5, 0),
    })
    ui.appendChild(object?.uiConfig)
    object = generator.generate('camera-orthographic', {
        position: new Vector3(0, 4, -5),
    })
    ui.appendChild(object?.uiConfig)
    const sun = generator.generate('light-directional', {
        position: new Vector3(3, 2, 4),
    }) as DirectionalLight2 | undefined
    if (sun) { // casts shadows: its shadow camera frustum is drawn
        sun.castShadow = true
        sun.shadowFrustum = 4
        sun.shadowFar = 12
        sun.setDirty()
    }
    ui.appendChild(sun?.uiConfig)
    object = generator.generate('light-spot', {
        position: new Vector3(-5, 0, 5),
    })
    ui.appendChild(object?.uiConfig)
    object = generator.generate('light-point', {
        position: new Vector3(-5, 5, -5),
    })
    ui.appendChild(object?.uiConfig)

    picking.addEventListener('selectedObjectChanged', (e) => {
        console.log('Selected:', e.object?.name)
    })

    viewer.scene.mainCamera.position.z += 10
    viewer.scene.mainCamera.setDirty()

}

_testStart()
init().finally(_testFinish)
