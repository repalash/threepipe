import {_testFinish, _testStart, LoadingScreenPlugin, ThreeViewer} from 'threepipe'

const models = [
    'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf',
    'https://threejs.org/examples/models/fbx/Samba Dancing.fbx',
    'https://threejs.org/examples/models/draco/bunny.drc',
    'https://samples.threepipe.org/demos/kira.glb',
]

async function init(i: number) {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas' + (i + 1)) as HTMLCanvasElement,
        msaa: true,
        debug: true,
        dropzone: {
            allowedExtensions: ['gltf', 'glb', 'hdr', 'bin', 'png', 'jpeg', 'webp', 'jpg', 'exr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        // setBackground: true,
    })
    const result = await viewer.load(models[i], {
        autoCenter: true,
        autoScale: true,
    })
    console.log(result)

}

_testStart()
Promise.all(new Array(4).fill(0).map(async(_, i) => init(i))).then(_testFinish)
