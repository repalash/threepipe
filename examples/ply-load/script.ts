import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, PLYLoadPlugin, ThreeViewer} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['ply', 'hdr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    viewer.addPluginSync(PLYLoadPlugin)

    const options = {
        autoCenter: true,
        autoScale: true,
    }
    await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        viewer.load<IObject3D>('https://threejs.org/examples/models/ply/ascii/dolphins_colored.ply', options),
        viewer.load<IObject3D>('https://threejs.org/examples/models/ply/binary/Lucy100k.ply', options),
    ])

}

_testStart()
init().finally(_testFinish)
