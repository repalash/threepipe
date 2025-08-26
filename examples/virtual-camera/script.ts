import {
    _testFinish,
    IObject3D,
    LinearToneMapping,
    LoadingScreenPlugin,
    Mesh,
    PerspectiveCamera2,
    PlaneGeometry,
    PopmotionPlugin,
    ProgressivePlugin, shaderReplaceString,
    Texture,
    ThreeViewer,
    ToneMapping,
    TonemapPlugin,
    UnlitMaterial,
    VirtualCamerasPlugin,
    ShaderChunk, _testStart,
} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        debug: true,
        rgbm: true,
        msaa: true,
        plugins: [new ProgressivePlugin(16), LoadingScreenPlugin],
    })
    const virtualCameras = viewer.addPluginSync(VirtualCamerasPlugin)
    const popmotion = viewer.addPluginSync(PopmotionPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const aspect = 2
    const plane = new Mesh(
        new PlaneGeometry(5 * aspect, 5)
            .translate(0, 0, -3),
        new UnlitMaterial({
            color: '#ffffff',
        })
    )
    plane.castShadow = false
    plane.receiveShadow = true
    viewer.scene.addObject(plane)

    const camera = new PerspectiveCamera2('', viewer.canvas, false, 45, aspect)
    camera.position.set(0, 0, 5)
    camera.target.set(0, 0.25, 0)
    camera.userData.autoLookAtTarget = true
    camera.near = 1
    camera.far = 10
    camera.setDirty()
    const vCam = virtualCameras.addCamera(camera)
    plane.material.map = vCam.target.texture as Texture

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

    // We need to disable tonemapping when rendering the virtual camera, otherwise the tonemapping will be applied multiple times.
    let lastTonemapping: ToneMapping = LinearToneMapping
    const tonemap = viewer.getPlugin(TonemapPlugin)!
    virtualCameras.addEventListener('preRenderCamera', ()=>{
        lastTonemapping = tonemap.toneMapping
        // Comment this and see what happens to the color in the plane
        tonemap.toneMapping = LinearToneMapping
    })
    virtualCameras.addEventListener('postRenderCamera', ()=>{
        tonemap.toneMapping = lastTonemapping
    })


    // (Extra optional) extension decoding rgbm render target when using rgbm
    if (viewer.renderManager.rgbm) {
        plane.material.registerMaterialExtensions([{
            shaderExtender: (shader, material) => {
                if (material.map?.colorSpace !== 'rgbm-16') return
                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <map_fragment>', ShaderChunk.map_fragment)
                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, 'texture2D( map, vMapUv )', 'RGBM16ToLinear(texture2D( map, vMapUv ))', {replaceAll: true})
            },
            computeCacheKey: (material) => material.map?.colorSpace === 'rgbm-16' ? 'rgbm' : '',
        }])
    }

}

_testStart()
init().finally(_testFinish)
