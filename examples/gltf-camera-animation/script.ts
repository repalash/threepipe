import {_testFinish, GLTFAnimationPlugin, ICamera, ThreeViewer} from 'threepipe'

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
    gltfAnimation.autoplayOnLoad = false

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    const result = await viewer.load('https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Blender-Exporter@master/polly/project_polly.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    console.log(result)


    const fileCamera = viewer.scene.getObjectByName<ICamera>('Correction__MovingCamera')
    if (!fileCamera) return

    fileCamera.autoAspect = true
    fileCamera.userData.autoLookAtTarget = false
    fileCamera.activateMain()
    viewer.scene.mainCamera.refreshAspect()

    gltfAnimation.loopAnimations = false
    gltfAnimation.playAnimation()

    console.log(gltfAnimation)

}

init().then(_testFinish)
