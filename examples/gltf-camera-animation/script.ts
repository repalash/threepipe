import {_testFinish, _testStart, GLTFAnimationPlugin, ICamera, LoadingScreenPlugin, ThreeViewer} from 'threepipe'

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
    gltfAnimation.autoplayOnLoad = false

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const result = await viewer.load('https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Blender-Exporter@master/polly/project_polly.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    console.log(result)

    const fileCamera = viewer.scene.getObjectByName<ICamera>('Correction__MovingCamera')
    if (!fileCamera) return

    fileCamera.userData.autoLookAtTarget = false
    fileCamera.activateMain()
    fileCamera.autoAspect = true

    gltfAnimation.loopAnimations = true
    gltfAnimation.playAnimation() // note no await here.

    console.log(gltfAnimation)

}

_testStart()
init().finally(_testFinish)
