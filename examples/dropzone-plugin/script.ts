import {
    _testFinish, _testStart,
    DropzonePlugin,
    LoadingScreenPlugin,
    PickingPlugin,
    Rhino3dmLoadPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        dropzone: { // this can also be set to true and configured by getting a reference to the DropzonePlugin
            allowedExtensions: ['gltf', 'glb', 'hdr', 'bin', 'png', 'jpeg', 'webp', 'jpg', 'exr', 'fbx', 'obj', '3dm'], // only allow these file types. If undefined, all files are allowed.
            addOptions: {
                disposeSceneObjects: true, // auto dispose of old scene objects
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true, // when any image is dropped
                autoCenter: true, // auto center the object
                autoScale: true, // auto scale according to radius
                autoScaleRadius: 2,
                license: 'Imported from dropzone', // Any license to set on imported objects
                importConfig: true, // import config from file
            },
        },
        plugins: [LoadingScreenPlugin, PickingPlugin, Rhino3dmLoadPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const dropzone = viewer.getPlugin(DropzonePlugin)!
    dropzone.addEventListener('drop', (e: any) => {
        if (!e.assets?.length) return // no assets imported
        console.log('Dropped Event:', e)
        const promptDiv = document.getElementById('prompt-div')!
        promptDiv.style.display = 'none'
    })

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    // ui.appendChild(dropzone.uiConfig)
    ui.setupPluginUi(DropzonePlugin)
    ui.setupPluginUi(PickingPlugin)

}

_testStart()
init().finally(_testFinish)
