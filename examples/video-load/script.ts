import {
    _testFinish, _testStart,
    ITexture,
    LoadingScreenPlugin,
    Mesh,
    PlaneGeometry,
    SRGBColorSpace,
    ThreeViewer,
    UnlitMaterial,
    DoubleSide,
} from 'threepipe'
import {TimelineUiPlugin} from '@threepipe/plugin-timeline-ui'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'avif', 'ico'],
            addOptions: {
                disposeSceneObjects: false,
                autoSetEnvironment: false, // when hdr is dropped
                autoSetBackground: false,
            },
        },
        plugins: [LoadingScreenPlugin, TimelineUiPlugin],
    })

    viewer.scene.setBackgroundColor('#555555')

    const urls = [
        'https://samples.threepipe.org/minimal/sintel.mp4',
        'https://samples.threepipe.org/minimal/star.mp4',
        'https://samples.threepipe.org/minimal/big_buck_bunny_720p_1mb.mp4',
        'https://samples.threepipe.org/minimal/file_example_WEBM_480_900KB.webm',
        'https://samples.threepipe.org/minimal/file_example_MOV_480_700kB.mov',
        // todo ogg doesnt work?
        // 'https://samples.threepipe.org/minimal/file_example_OGG_480_1_7mg.ogg',
    ]

    const geometry = new PlaneGeometry(1, 1)
    let i = 0
    for (const url of urls) {
        // Load the url as a Texture
        const texture = await viewer.load<ITexture>(url)
        if (!texture) continue
        texture.colorSpace = SRGBColorSpace
        texture.name = url.split('/').pop()!
        const material = new UnlitMaterial({
            map: texture,
            transparent: true,
            side: DoubleSide,
        })
        const plane = new Mesh(geometry, material)
        plane.position.set(i % 3 - 1, -Math.floor(i / 3) + 1, 0)
        viewer.scene.addObject(plane)
        i++
    }

    // Listen to when a file is dropped
    viewer.assetManager.addEventListener('loadAsset', (e)=>{
        if (!e.data?.isTexture) return
        const texture = e.data as ITexture
        texture.colorSpace = SRGBColorSpace
        const material = new UnlitMaterial({
            map: texture,
            transparent: true,
            side: DoubleSide,
        })
        const plane = new Mesh(geometry, material)
        plane.position.set(i % 3 - 1, -Math.floor(i / 3) + 1, 0)
        viewer.scene.addObject(plane)
        i++
        viewer.timeline.reset()
    })

    viewer.timeline.resetOnEnd = true
    viewer.timeline.endTime = 10 // loop back after 10 secs
    viewer.timeline.start()

}

_testStart()
init().finally(_testFinish)
