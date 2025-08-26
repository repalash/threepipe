import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, ThreeViewer, USDZLoadPlugin} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['usdz', 'usda', 'hdr', 'exr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    viewer.addPluginSync(USDZLoadPlugin)

    const options = {
        autoCenter: true,
        autoScale: true,
    }
    await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        viewer.load<IObject3D>('https://threejs.org/examples/models/usdz/saeukkang.usdz', options),
    ])

}

_testStart()
init().finally(_testFinish)
