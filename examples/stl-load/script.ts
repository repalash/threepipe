import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, STLLoadPlugin, ThreeViewer} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['stl', 'hdr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    viewer.addPluginSync(STLLoadPlugin)

    const options = {
        autoCenter: true,
        autoScale: true,
    }
    const res = await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        viewer.load<IObject3D>('https://threejs.org/examples/models/stl/ascii/slotted_disk.stl', options),
        viewer.load<IObject3D>('https://threejs.org/examples/models/stl/binary/pr2_head_pan.stl', options),
    ])
    console.log(res)

}

_testStart()
init().finally(_testFinish)
