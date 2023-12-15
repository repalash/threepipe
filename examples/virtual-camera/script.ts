import {
    _testFinish,
    IObject3D,
    Mesh,
    PerspectiveCamera2,
    PhysicalMaterial,
    PlaneGeometry,
    PopmotionPlugin,
    ProgressivePlugin,
    Texture,
    ThreeViewer,
    VirtualCamerasPlugin,
} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        debug: true,
        plugins: [new ProgressivePlugin(16)],
    })
    const virtualCameras = viewer.addPluginSync(VirtualCamerasPlugin)
    const popmotion = viewer.addPluginSync(PopmotionPlugin)

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const ground = new Mesh(
        new PlaneGeometry(5, 5)
            .translate(0, 0, -4),
        new PhysicalMaterial({
            color: '#ffffff',
        })
    )
    ground.castShadow = false
    ground.receiveShadow = true
    viewer.scene.addObject(ground)

    const camera = new PerspectiveCamera2('', viewer.canvas, false, 45, 1)
    camera.position.set(0, 0, 5)
    camera.target.set(0, 0.25, 0)
    camera.userData.autoLookAtTarget = true
    camera.near = 1
    camera.far = 10
    camera.setDirty()
    const vCam = virtualCameras.addCamera(camera)
    ground.material.map = vCam.target.texture as Texture

    popmotion.animate({
        from: 0,
        to: 1,
        repeat: Infinity,
        duration: 6000,
        onUpdate: (v)=>{
            // Set camera position xz in a circle around the target
            const angle = v * Math.PI * 2 + Math.PI / 2
            const radius = 5
            camera.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
            camera.setDirty()
            viewer.setDirty() // since camera is not in the scene
        },
    })

}

init().then(_testFinish)
