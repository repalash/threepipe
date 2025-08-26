import {
    _testFinish, _testStart,
    BufferGeometry,
    BufferGeometry2,
    Color,
    GLTFLoader2,
    IMaterial,
    IObject3D,
    LineSegmentsGeometry,
    LineSegmentsGeometry2,
    LoadingScreenPlugin,
    Object3D,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Read more about the example - https://threepipe.org/notes/gltf-mesh-lines

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
        dropzone: true,
    })

    viewer.scene.autoNearFarEnabled = false

    GLTFLoader2.UseMeshLines = true

    viewer.scene.backgroundColor = new Color(0x333333)

    // await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const obj1 = await viewer.load<IObject3D>('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/refs/heads/main/Models/MeshPrimitiveModes/glTF/MeshPrimitiveModes.gltf', {
        autoScale: true,
        autoCenter: true,
        useMeshLines: true,
    })

    const obj2 = await viewer.load<IObject3D>('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/refs/heads/main/Models/MeshPrimitiveModes/glTF/MeshPrimitiveModes.gltf', {
        autoScale: true,
        autoCenter: true,
        useMeshLines: false,
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    const mats: IMaterial[] = []
    const o1: IObject3D[] = []
    const o2: IObject3D[] = []
    const p1 = viewer.scene.addObject(new Object3D()).translateY(0.75)
    const p2 = viewer.scene.addObject(new Object3D()).translateY(-0.75)
    p1.scale.setScalar(0.6)
    p2.scale.setScalar(0.6)
    obj1?.traverse(o=>{
        if (o.materials?.[0].isLineMaterial) {
            mats.push(o.materials[0])
            o1.push(o)
        }
    })
    obj2?.traverse(o=>{
        if (o.materials?.[0].isUnlitLineMaterial) {
            mats.push(o.materials[0])
            o2.push(o)
        }
    })
    o1.forEach(o=>p1.add(o))
    o2.forEach(o=>p2.add(o))
    obj1?.dispose(true)
    obj2?.dispose(true)

    mats.map(m=>{
        if (!m.appliedMeshes.size) return
        m.linewidth = 10
        ui.appendChild(m.uiConfig)
    })

    console.log(LineSegmentsGeometry)
    console.log(LineSegmentsGeometry2)
    console.log(BufferGeometry)
    console.log(BufferGeometry2)

}

_testStart()
init().finally(_testFinish)
