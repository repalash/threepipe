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
            allowedExtensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'avif', 'ico'],
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
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/textures/sprite0.png',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/textures/uv_grid_opengl.jpg',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/svg/style-css-inside-defs.svg',
        'https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/textures/tiltbrush/Light.webp',
        // todo: avif
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
        viewer.scene.addObject(plane)
        i++
    })
}

_testStart()
init().finally(_testFinish)
