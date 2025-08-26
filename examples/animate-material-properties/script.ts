import {
    _testFinish,
    _testStart,
    BoxGeometry,
    CameraViewPlugin,
    Color,
    ITexture,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    PopmotionPlugin,
    ThreeViewer,
    timeout,
    Vector2,
} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: true,
        plugins: [LoadingScreenPlugin, CameraViewPlugin],
    })
    const popmotion = viewer.getOrAddPluginSync(PopmotionPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    viewer.scene.mainCamera.position.set(1.4, 0.097, 2.1)
    let state = 0

    const images = await Promise.all([
        'https://samples.threepipe.org/minimal/planets/earth_specular_2048.jpg',
        'https://samples.threepipe.org/minimal/uv_grid_opengl.jpg',
    ].map(async i=> viewer.load<ITexture>(i)))
    if (!images[0]) {
        throw new Error('Failed to load images for animation')
    }

    const cube = viewer.scene.addObject(new Mesh(
        new BoxGeometry(2, 2 * images[0].image.height / images[0].image.width, 2),
        new PhysicalMaterial({
            color: new Color(state === 0 ? 0x00ffff : 0xffffff),
            map: images[state],
            normalMap: images[1 - state],
            metalness: state,
            roughness: 1. - state,
            normalScale: new Vector2(1, 1).multiplyScalar(state ? 1 : -1),
        })
    ))

    const squareFov = 70// viewer.scene.mainCamera.fov!
    function refreshFov() {
        const size = viewer.renderManager.renderSize.clone()
        const camera = viewer.scene.mainCamera
        // Adjust the camera fov to based on the aspect ratio
        camera.fov = squareFov * (size.y / size.x)
        camera.updateProjectionMatrix()
    }

    async function animate() {
        state = state === 0 ? 1 : 0
        await popmotion.animateNumber({
            duration: 2000,
            onUpdate: (v, dv) => {
                cube.material.setValues({
                    color: new Color(state === 0 ? 0x00ffff : 0xffffff),
                    map: images[state],
                    normalMap: images[1 - state],
                    metalness: state,
                    roughness: 1. - state,
                    normalScale: new Vector2(1, 1).multiplyScalar(state ? 1 : -1),
                }, true, undefined, {
                    t: v, dt: dv, // 0 to 1
                    rm: viewer.renderManager,
                })
            },
        }).promise
    }

    refreshFov()
    await viewer.fitToView(undefined, 1.3)
    await timeout(500)
    await animate()

    createSimpleButtons({
        ['Animate']: async(btn) => {
            btn.disabled = true
            animate()
            btn.disabled = false
        },
    })

    viewer.renderManager.addEventListener('resize', () => {
        refreshFov()
    })

}

_testStart()
init().finally(_testFinish)
