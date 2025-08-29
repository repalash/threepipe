import {
    _testFinish,
    _testStart,
    DepthBufferPlugin,
    Euler,
    GBufferPlugin,
    InstancedMesh2,
    IObject3D,
    LoadingScreenPlugin,
    Matrix4,
    PickingPlugin,
    Quaternion,
    RenderTargetPreviewPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        rgbm: false,
        debug: true,
        plugins: [LoadingScreenPlugin, DepthBufferPlugin, PickingPlugin],
    })

    viewer.scene.mainCamera.autoNearFar = false
    viewer.scene.mainCamera.minNearPlane = 0.1
    viewer.scene.mainCamera.maxFarPlane = 100
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const object = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const mesh = object?.getObjectByName('node_damagedHelmet_-6514')
    if (mesh) {
        const instancedMesh = new InstancedMesh2(mesh.geometry, mesh.material, 20)
        mesh.parent!.add(instancedMesh)
        mesh.removeFromParent()
        for (let i = 0; i < instancedMesh.count; i++) {
            const position = new Vector3(
                (Math.random() - 0.5) * 6,
                (Math.random() - 0.5) * 6,
                (Math.random() - 0.5) * 6,
            )
            const scale = 0.7 + Math.random() * 0.3
            const quat = new Quaternion().setFromEuler(new Euler(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI,
            ))
            const matrix = new Matrix4().compose(position, quat, new Vector3(scale, scale, scale))
            instancedMesh.setMatrixAt(i, matrix)
        }
        viewer.getPlugin(PickingPlugin)?.setSelectedObject(instancedMesh)
    }

    viewer.scene.backgroundColor?.set(0x222222)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    // ui.appendChild(obj.uiConfig)
    ui.setupPluginUi(PickingPlugin)

    // todo bounding box is not correct for instanced mesh
    viewer.fitToView(undefined, 4)

    const gbufferPlugin = viewer.getOrAddPluginSync(GBufferPlugin)!
    const getNormalDepth = ()=>({texture: gbufferPlugin.normalDepthTexture})
    const getFlags = ()=>({texture: gbufferPlugin.flagsTexture})
    const getDepthTexture = ()=>({texture: viewer.getPlugin(DepthBufferPlugin)?.texture})

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(getNormalDepth, 'normalDepth')
    targetPreview.addTarget(getFlags, 'gBufferFlags')
    targetPreview.addTarget(getDepthTexture, 'depthTexture')
}

_testStart()
init().finally(_testFinish)

