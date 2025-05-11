import {
    _testFinish, _testStart,
    Box3B,
    HemisphereLight2,
    IObject3D,
    LoadingScreenPlugin,
    Mesh,
    Object3DWidgetsPlugin,
    PhysicalMaterial,
    PlaneGeometry,
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
    const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/ShadowmappableMesh.glb', {
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
    viewer.scene.addObject(ground)

    const light = viewer.scene.addObject(new HemisphereLight2(0x0000ff, 0xff0000, 20))

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.appendChild(light.uiConfig, {expanded: true})
}

_testStart()
init().finally(_testFinish)
