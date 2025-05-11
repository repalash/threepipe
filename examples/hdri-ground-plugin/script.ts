import {_testFinish, _testStart, CameraViewPlugin, HDRiGroundPlugin, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['gltf', 'glb', 'hdr', 'bin', 'png', 'jpeg', 'webp', 'jpg', 'exr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        plugins: [CameraViewPlugin, LoadingScreenPlugin],
    })
    const hdriGround = viewer.addPluginSync(HDRiGroundPlugin)

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    await viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
        autoScaleRadius: 10,
    })

    viewer.scene.background = 'environment' // this is not really required since setBackground is also set to true above

    hdriGround.worldRadius = 50
    hdriGround.tripodHeight = 10

    const bounds = viewer.scene.getBounds(true, true)
    bounds.getCenter(hdriGround.originPosition)
    hdriGround.originPosition.y -= (bounds.max.y - bounds.min.y) / 2

    hdriGround.enabled = true

    console.log(hdriGround)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(HDRiGroundPlugin)

    await viewer.fitToView(undefined, 2.5)

}

_testStart()
init().finally(_testFinish)
