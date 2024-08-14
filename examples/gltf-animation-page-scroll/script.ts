import {_testFinish, GLTFAnimationPlugin, ICamera, LoadingScreenPlugin, ThreeViewer} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const gltfAnimation = viewer.addPluginSync(GLTFAnimationPlugin)
    gltfAnimation.autoplayOnLoad = false

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load('https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Blender-Exporter@master/polly/project_polly.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const fileCamera = viewer.scene.getObjectByName<ICamera>('Correction__MovingCamera')
    if (!fileCamera) return

    fileCamera.autoAspect = true
    fileCamera.userData.autoLookAtTarget = false
    fileCamera.activateMain()

    gltfAnimation.loopAnimations = false
    gltfAnimation.animateOnPageScroll = true
    gltfAnimation.pageScrollAnimationDamping = 0.1

    gltfAnimation.playAnimation()

}

init().finally(_testFinish)
