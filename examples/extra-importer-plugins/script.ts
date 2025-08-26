import {
    _testFinish, _testStart,
    GLTFAnimationPlugin,
    HemisphereLight,
    ImportAddOptions,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'
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
} from '@threepipe/plugins-extra-importers'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin],
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
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const urls = [
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/3ds/portalgun/portalgun.3ds', // todo - to load textures there should be a way to set basepath to portalgun/textures
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/3mf/cube_gears.3mf',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/collada/elf/elf.dae',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/amf/rook.amf',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/gcode/benchy.gcode',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/bvh/pirouette.bvh',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/vox/monu10.vox',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/mdd/cube.mdd',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/pcd/binary/Zaghetto.pcd',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/tilt/BRUSH_DOME.tilt',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/ldraw/officialLibrary/models/car.ldr_Packed.mpd',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/vtk/bunny.vtk',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/vtk/cube_binary.vtp',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/xyz/helix_201.xyz',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/vrml/meshWithTexture.wrl',
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

_testStart()
init().finally(_testFinish)

