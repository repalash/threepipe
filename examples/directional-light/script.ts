import {
    _testFinish, _testStart,
    Box3B,
    DirectionalLight2,
    IObject3D,
    LoadingScreenPlugin,
    Mesh,
    Object3DWidgetsPlugin,
    PCFSoftShadowMap,
    PhysicalMaterial,
    PlaneGeometry,
    RenderTargetPreviewPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['gltf', 'glb', 'hdr', 'obj', 'fbx', 'bin', 'png', 'jpeg', 'webp', 'jpg', 'exr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr/exr is dropped
            },
        },
        plugins: [Object3DWidgetsPlugin, LoadingScreenPlugin],
    })

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

    const light = viewer.scene.addObject(new DirectionalLight2(0xffffff, 4))
    light.position.set(2, 2, 2)
    light.lookAt(0, 0, 0)
    light.castShadow = true
    light.shadowMapSize.setScalar(1024)
    light.shadowNear = 0.1
    light.shadowFar = 10
    light.shadowFrustum = 4

    viewer.renderManager.renderer.shadowMap.type = PCFSoftShadowMap

    const rt = viewer.addPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(()=>light.shadow.map || undefined, 'shadow', true, true, true)

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.appendChild(light.uiConfig, {expanded: true})
}

_testStart()
init().finally(_testFinish)
