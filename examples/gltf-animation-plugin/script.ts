import {_testFinish, GLTFAnimationPlugin, ThreeViewer} from 'threepipe'

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
    })

    const gltfAnimation = viewer.addPluginSync(GLTFAnimationPlugin)

    if (!(window as any).TESTING) // todo: seek animation to a few seconds for testing.
        gltfAnimation.autoplayOnLoad = true

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    const result = await viewer.load('https://threejs.org/examples/models/gltf/Horse.glb', {
        autoCenter: true,
        autoScale: true,
    })
    console.log(result)

}

init().finally(_testFinish)
