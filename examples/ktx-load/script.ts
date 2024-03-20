import {
    _testFinish,
    ITexture,
    KTXLoadPlugin,
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
            allowedExtensions: ['ktx'],
        },
    })
    viewer.addPluginSync(KTXLoadPlugin)

    viewer.scene.setBackgroundColor('#555555')

    const urls = []

    // Checking which ktx formats are supported by the browser
    const formats = {
        astc: viewer.renderManager.renderer.extensions.has('WEBGL_compressed_texture_astc'),
        etc1: viewer.renderManager.renderer.extensions.has('WEBGL_compressed_texture_etc1'),
        s3tc: viewer.renderManager.renderer.extensions.has('WEBGL_compressed_texture_s3tc'),
        pvrtc: viewer.renderManager.renderer.extensions.has('WEBGL_compressed_texture_pvrtc'),
    }

    if (formats.pvrtc) urls.push(
        'https://threejs.org/examples/textures/compressed/disturb_PVR2bpp.ktx',
        'https://threejs.org/examples/textures/compressed/lensflare_PVR4bpp.ktx'
    )
    if (formats.s3tc) urls.push(
        'https://threejs.org/examples/textures/compressed/disturb_BC1.ktx',
        'https://threejs.org/examples/textures/compressed/lensflare_BC3.ktx'
    )
    if (formats.etc1) urls.push(
        'https://threejs.org/examples/textures/compressed/disturb_ETC1.ktx'
    )

    if (formats.astc) urls.push(
        'https://threejs.org/examples/textures/compressed/disturb_ASTC4x4.ktx',
        'https://threejs.org/examples/textures/compressed/lensflare_ASTC8x8.ktx'
    )

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
        if (!e.data.isTexture) return
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

init().finally(_testFinish)
