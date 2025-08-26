import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    OrbitControls3,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import * as THREE from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: true,
        plugins: [LoadingScreenPlugin, PickingPlugin, TransformControlsPlugin],
        stencil: true,
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPlugins(PickingPlugin, TransformControlsPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const model = result?.getObjectByName('node_damagedHelmet_-6514')
    const config = model?.uiConfig
    if (config) ui.appendChild(config)

    const maskMaterial = new THREE.MeshBasicMaterial({
        color: 0x222222,
        stencilRef: 1,
        depthWrite: false,
        stencilWrite: true,
        depthTest: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp,
    })
    const maskPlane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), maskMaterial)
    viewer.scene.addObject(maskPlane)

    const maskCube = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 20), new THREE.MeshBasicMaterial({
        color: 0xffffff,
        stencilRef: 1,
        depthWrite: false,
        stencilWrite: true,
        depthTest: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp,
        colorWrite: false,
    }))
    maskCube.userData.bboxVisible = false
    maskCube.userData.userSelectable = false
    maskCube.position.set(0, 0, 10)
    viewer.scene.addObject(maskCube)
    maskPlane.addEventListener('objectUpdate', ()=>{
        maskCube.position.set(maskPlane.position.x, maskPlane.position.y, maskPlane.position.z + 10)
    })

    const mat = model?.materials?.[0]
    if (mat && model) {
        mat.stencilWrite = true
        mat.stencilRef = 1
        mat.stencilFunc = THREE.LessEqualStencilFunc
        model.renderOrder = 2
        model.position.z = -0.4
    }

    viewer.getPlugin(PickingPlugin)?.setSelectedObject(model)

    const controls = viewer.scene.mainCamera.controls as OrbitControls3
    controls.minAzimuthAngle = -1.5
    controls.maxAzimuthAngle = 1.5

}

_testStart()
init().finally(_testFinish)
