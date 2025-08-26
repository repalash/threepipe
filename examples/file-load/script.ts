import {_testFinish, _testStart, LoadingScreenPlugin, ThreeViewer} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
    })

    viewer.addPluginSync(LoadingScreenPlugin)

    const env = 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'
    const url = 'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'

    const responses = await Promise.all([
        fetch(env),
        fetch(url),
    ])
    const envFile = new File([await responses[0].blob()], 'venice_sunset_1k.hdr')
    await viewer.setEnvironmentMap(envFile, {
        setBackground: true,
    })
    const blob = await responses[1].blob()
    const file = new File([blob], url) // Set the file name to the URL, so that internal textures can be resolved correctly from the base path
    const result = await viewer.load(file, {
        autoCenter: true,
        autoScale: true,
    })
    console.log(result)

}

_testStart()
init().finally(_testFinish)
