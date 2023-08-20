import {
    _testFinish,
    Box3B,
    DirectionalLight,
    IObject3D,
    Mesh,
    PCFSoftShadowMap,
    PhysicalMaterial,
    PlaneGeometry,
    RenderTargetPreviewPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'

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

    const directionalLight = viewer.scene.addObject(new DirectionalLight(0xffffff, 4))
    directionalLight.position.set(2, 2, 2)
    directionalLight.lookAt(0, 0, 0)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.setScalar(1024)
    directionalLight.shadow.camera.near = 0.1
    directionalLight.shadow.camera.far = 10
    directionalLight.shadow.camera.top = 2
    directionalLight.shadow.camera.bottom = -2
    directionalLight.shadow.camera.left = -2
    directionalLight.shadow.camera.right = 2

    viewer.renderManager.renderer.shadowMap.type = PCFSoftShadowMap

    const rt = viewer.addPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(()=>directionalLight.shadow.map || undefined, 'shadow', true, true, true)

}

init().then(_testFinish)
