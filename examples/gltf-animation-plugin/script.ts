import {_testFinish, _testStart, GLTFAnimationPlugin, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
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
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    const gltfAnimation = viewer.addPluginSync(GLTFAnimationPlugin)
    gltfAnimation.autoplayOnLoad = true

    const ui = viewer.addPluginSync(TweakpaneUiPlugin)
    ui.setupPluginUi(GLTFAnimationPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const result = await viewer.load('https://samples.threepipe.org/minimal/Horse.glb', {
        autoCenter: true,
        autoScale: true,
    })
    console.log(result)

}

_testStart()
init().finally(_testFinish)
