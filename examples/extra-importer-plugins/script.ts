import {_testFinish, GLTFAnimationPlugin, HemisphereLight, ImportAddOptions, IObject3D, ThreeViewer} from 'threepipe'
import {
    AMFLoadPlugin,
    BVHLoadPlugin,
    ColladaLoadPlugin,
    GCodeLoadPlugin,
    LDrawLoadPlugin,
    MDDLoadPlugin,
    PCDLoadPlugin,
    TDSLoadPlugin,
    ThreeMFLoadPlugin,
    TiltLoadPlugin,
    VOXLoadPlugin,
    VRMLLoadPlugin,
    VTKLoadPlugin,
    XYZLoadPlugin,
} from '@threepipe/plugin-extra-importers'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
    })
    viewer.addPluginsSync([
        GLTFAnimationPlugin,

        TDSLoadPlugin,
        ThreeMFLoadPlugin,
        ColladaLoadPlugin,
        AMFLoadPlugin,
        GCodeLoadPlugin,
        BVHLoadPlugin,
        VOXLoadPlugin,
        MDDLoadPlugin,
        PCDLoadPlugin,
        TiltLoadPlugin,
        VRMLLoadPlugin,
        LDrawLoadPlugin,
        VTKLoadPlugin,
        XYZLoadPlugin,

    ])

    viewer.getPlugin(GLTFAnimationPlugin)!.autoplayOnLoad = true

    viewer.scene.mainCamera.autoNearFar = false

    viewer.scene.setBackgroundColor('#555555')
    viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 2))
    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    const urls = [
        'https://threejs.org/examples/models/3ds/portalgun/portalgun.3ds',
        'https://threejs.org/examples/models/3mf/cube_gears.3mf',
        'https://threejs.org/examples/models/collada/elf/elf.dae',
        'https://threejs.org/examples/models/amf/rook.amf',
        'https://threejs.org/examples/models/gcode/benchy.gcode',
        'https://threejs.org/examples/models/bvh/pirouette.bvh',
        'https://threejs.org/examples/models/vox/monu10.vox',
        'https://threejs.org/examples/models/mdd/cube.mdd',
        'https://threejs.org/examples/models/pcd/binary/Zaghetto.pcd',
        'https://threejs.org/examples/models/tilt/BRUSH_DOME.tilt',
        'https://threejs.org/examples/models/ldraw/officialLibrary/models/car.ldr_Packed.mpd',
        'https://threejs.org/examples/models/vtk/bunny.vtk',
        'https://threejs.org/examples/models/vtk/cube_binary.vtp',
        'https://threejs.org/examples/models/xyz/helix_201.xyz',
    ]

    const options: ImportAddOptions = {
        autoScale: true,
        autoCenter: true,
        autoScaleRadius: 0.5,
        clearSceneObjects: false,
    }
    const models = await Promise.allSettled(urls.map(async url =>
        viewer.load<IObject3D>(url, options).then(res => {
            if (!res) return
            const i = urls.indexOf(url)
            res.position.set(i % 4 - 1.5, 0, Math.floor(i / 4) - 1.5).multiplyScalar(1)
            res.setDirty()
            return res
        })))

    console.log(models)


}

init().finally(_testFinish)

