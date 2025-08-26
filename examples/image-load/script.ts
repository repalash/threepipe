import {
    _testFinish, _testStart,
    ITexture,
    LoadingScreenPlugin,
    Mesh,
    PlaneGeometry,
    SRGBColorSpace,
    ThreeViewer,
    UnlitMaterial,
} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'avif', 'ico', 'exr', 'hdr'],
            addOptions: {
                disposeSceneObjects: false,
                autoSetEnvironment: false, // when hdr is dropped
                autoSetBackground: false,
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    viewer.scene.setBackgroundColor('#555555')

    const urls = [
        'https://samples.threepipe.org/minimal/sprite0.png',
        'https://samples.threepipe.org/minimal/uv_grid_opengl.jpg',
        'https://samples.threepipe.org/minimal/style-css-inside-defs.svg',
        'https://samples.threepipe.org/minimal/1_webp_ll.webp',
        'https://samples.threepipe.org/minimal/plum-blossom-large.profile0.8bpc.yuv420.alpha-full.avif',
        // todo
        // 'https://raw.githubusercontent.com/link-u/avif-sample-images/refs/heads/master/red-at-12-oclock-with-color-profile-12bpc.avif',
        'https://threepipe.org/favicon.ico',
    ]

    const geometry = new PlaneGeometry(1, 1)
    let i = 0
    for (const url of urls) {
        // Load the url as a Texture
        const texture = await viewer.load<ITexture>(url)
        if (!texture) continue
        texture.colorSpace = SRGBColorSpace
        const material = new UnlitMaterial({
            map: texture,
            transparent: true,
        })
        const plane = new Mesh(geometry, material)
        plane.position.set(i % 3 - 1, -Math.floor(i / 3) + 1, 0)
        const aspect = texture.image.width / texture.image.height
        plane.scale.set(aspect >= 1 ? 1 : aspect, aspect >= 1 ? 1 / aspect : 1, 1)
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
        })
        const plane = new Mesh(geometry, material)
        plane.position.set(i % 3 - 1, -Math.floor(i / 3) + 1, 0)
        const aspect = texture.image.width / texture.image.height
        plane.scale.set(aspect >= 1 ? 1 : aspect, aspect >= 1 ? 1 / aspect : 1, 1)
        viewer.scene.addObject(plane)
        i++
    })
}

_testStart()
init().finally(_testFinish)
