import {
    _testFinish, _testStart,
    BasicShadowMap,
    Box3B,
    DirectionalLight2,
    IObject3D,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    PlaneGeometry,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    SSAAPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: false,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
                importConfig: true,
            },
        },
        plugins: [LoadingScreenPlugin],
    })
    viewer.addPluginSync(new ProgressivePlugin((window as any).TESTING ? 20 : 200))
    viewer.addPluginSync(new SSAAPlugin())

    // viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 10))
    const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/fbx/Samba Dancing.fbx', {
        autoCenter: true,
        autoScale: true,
    })

    const ground = new Mesh(
        new PlaneGeometry(100, 100)
            .rotateX(-Math.PI / 2)
            .translate(0, new Box3B().expandByObject(result!).getSize(new Vector3()).y / -2, 0),
        new PhysicalMaterial({
            color: '#ffffff',
        })
    )
    ground.castShadow = false
    ground.receiveShadow = true
    viewer.scene.addObject(ground)

    const directionalLight = viewer.scene.addObject(new DirectionalLight2(0xffffff, 4))
    directionalLight.position.set(2, 2, 2)
    directionalLight.lookAt(0, 0, 0)
    directionalLight.castShadow = true
    directionalLight.shadowMapSize.setScalar(1024)
    directionalLight.shadowNear = 0.1
    directionalLight.shadowFar = 10
    directionalLight.shadowFrustum = 4

    viewer.renderManager.renderer.shadowMap.type = BasicShadowMap

    viewer.scene.mainCamera.position.set(1, 2, 2.5)
    viewer.scene.mainCamera.target.set(0, 0.25, 0)
    viewer.scene.mainCamera.setDirty()

    const rt = viewer.addPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(()=>directionalLight.shadow.map || undefined, 'shadow', true, true, true)

    viewer.addEventListener('postFrame', ()=>{
        if (viewer.renderManager.frameCount < 1) return

        directionalLight.position.set(
            2 + Math.sin(viewer.renderManager.frameCount) / 5,
            2,
            2 + Math.cos(viewer.renderManager.frameCount) / 5
        )
        directionalLight.lookAt(0, 0, 0)
        viewer.renderManager.resetShadows()

    })

    viewer.addPluginSync(TweakpaneUiPlugin).setupPlugins(ProgressivePlugin)

    await viewer.getPlugin(ProgressivePlugin)?.convergedPromise

    console.log('converged')
}

_testStart()
init().finally(_testFinish)
