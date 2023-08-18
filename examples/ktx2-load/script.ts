import {
    _testFinish,
    ITexture,
    KTX2LoadPlugin,
    Mesh,
    PlaneGeometry,
    SRGBColorSpace,
    ThreeViewer,
    UnlitMaterial,
} from 'threepipe'
import {BufferGeometry} from 'three'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['ktx2'],
        },
    })
    viewer.addPluginSync(KTX2LoadPlugin)

    viewer.scene.setBackgroundColor('#555555')

    const urls = [
        'https://threejs.org/examples/textures/compressed/sample_etc1s.ktx2',
        'https://threejs.org/examples/textures/compressed/sample_uastc.ktx2',
        'https://threejs.org/examples/textures/compressed/sample_uastc_zstd.ktx2',
    ]

    // PlaneGeometry UVs assume flipY=true, which compressed textures don't support.
    const geometry = flipY(new PlaneGeometry(1, 1))
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

init().then(_testFinish)

/** Correct UVs to be compatible with `flipY=false` textures. */
function flipY(geometry: BufferGeometry) {
    const uv = geometry.attributes.uv
    for (let i = 0; i < uv.count; i++) {
        uv.setY(i, 1 - uv.getY(i))
    }
    return geometry
}
