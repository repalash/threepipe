import {
    _testFinish,
    Box3B,
    IObject3D,
    Mesh,
    Object3DWidgetsPlugin,
    PCFSoftShadowMap,
    PhysicalMaterial,
    PlaneGeometry,
    RenderTargetPreviewPlugin,
    SpotLight2,
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
        plugins: [Object3DWidgetsPlugin],
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

    const light = viewer.scene.addObject(new SpotLight2(0xffffff, 10))
    light.position.set(2, 2, 2)
    light.lookAt(0, 0, 0)
    light.angle = 0.5
    light.penumbra = 0.2
    light.distance = 5
    light.decay = 0.5
    light.castShadow = true
    light.shadow.mapSize.setScalar(1024)
    light.shadow.camera.near = 0.1
    light.shadow.camera.far = 10
    light.shadow.camera.aspect = 1
    light.shadow.camera.fov = 45

    viewer.renderManager.renderer.shadowMap.type = PCFSoftShadowMap

    const rt = viewer.addPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(()=>light.shadow.map || undefined, 'shadow', true, true, true)

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.appendChild(light.uiConfig, {expanded: true})
}

init().then(_testFinish)
