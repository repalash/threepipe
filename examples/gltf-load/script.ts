import {_testFinish, _testStart, LoadingScreenPlugin, ThreeViewer} from 'threepipe'

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
        // add optional plugins to load gltf with extensions like meshopt_compression, ktx2 etc
        // plugins: [GLTFMeshOptDecodePlugin, KTX2LoadPlugin, GLTFKHRMaterialVariantsPlugin, ...],
    })

    viewer.addPluginSync(LoadingScreenPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    console.log(result)

}

_testStart()
init().finally(_testFinish)
