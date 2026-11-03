import {
    _testFinish, _testStart,
    BoxGeometry,
    Color,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    ThreeViewer,
    TonemapPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        rgbm: true,
        plugins: [LoadingScreenPlugin],
    })
    viewer.scene.backgroundColor = new Color().set('black')
    viewer.getPlugin(TonemapPlugin)!.exposure = 0.04
    // viewer.renderManager.screenPass.outputColorSpace = LinearSRGBColorSpace

    const box = new BoxGeometry(0.5, 0.5, 0.5)
    const material = new PhysicalMaterial({
        color: 'white',
        emissive: 'white',
        emissiveIntensity: 1,
    })
    const n = 5
    for (let i = 0; i < n * n; i++) {
        const mesh = new Mesh()
        const mat = material.clone()
        mat.emissiveIntensity = (1 - i / (n * n)) * 16
        mesh.material = mat
        mesh.geometry = box
        mesh.position.x = Math.floor(n / 2) - Math.floor(i % n)
        mesh.position.y = Math.floor(i / n) - Math.floor(n / 2)
        mesh.position.multiplyScalar(0.5)
        viewer.scene.addObject(mesh)
        console.log(mat.emissiveIntensity)
    }

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(TonemapPlugin)
    ui.appendChild(viewer.renderManager.screenPass.uiConfig)

}

_testStart()
init().finally(_testFinish)
