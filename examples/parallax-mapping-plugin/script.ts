import {
    _testFinish, _testStart,
    BoxGeometry,
    ITexture,
    LoadingScreenPlugin,
    Mesh,
    ParallaxMappingPlugin,
    PhysicalMaterial,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [new SSAAPlugin(4), LoadingScreenPlugin],
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
    })

    const parallaxMapping = viewer.addPluginSync(ParallaxMappingPlugin)
    console.log(parallaxMapping)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.setupPluginUi(ParallaxMappingPlugin, {expanded: true})

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const cube = new Mesh(
        new BoxGeometry(1, 1, 1),
        new PhysicalMaterial({
            // roughness: 0,
            // metalness: 1,
        }))

    const maps = [
        'https://samples.threepipe.org/minimal/sprite0.png',
        'https://samples.threepipe.org/minimal/uv_grid_opengl.jpg',
        'https://samples.threepipe.org/minimal/style-css-inside-defs.svg',
        'https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/lookuptable.png',
        'https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/perlin3_cp.png',
        'https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/perlin4_cp.png',
        'https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/ObjectSheet.png',
        'https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/512x512_Texel_Density_Texture_1.png',
        'https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/toy_box_normal.png',
        'https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/example_1_texture.png',
    ]
    const bumps = [
        maps[0],
        maps[1],
        maps[2],
        maps[3],
        maps[4],
        maps[5],
        maps[6],
        maps[7],
        'https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/toy_box_disp.png',
        'https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/example_1_heightmap.png',
    ]

    cube.material.bumpMap = await viewer.load<ITexture>(bumps[0]) || null
    cube.material.map = await viewer.load<ITexture>(maps[0]) || null
    cube.material.bumpScale = 0.1
    viewer.scene.addObject(cube)
    ui.appendChild({
        type: 'dropdown',
        value: maps[0],
        label: 'Bump Texture',
        children: ['none', ...maps].map((url: string) => ({
            label: url.split('/').pop(),
            value: url,
        })),
        onChange: async(ev) => {
            console.log(ev.value)
            const url = ev.value
            const tex = await viewer.load<ITexture>(url) || null
            cube.material.map = tex
            const bumpUrl = bumps[maps.indexOf(url)]
            const bumpTex = await viewer.load<ITexture>(bumpUrl) || null
            cube.material.bumpMap = bumpTex
            cube.material.setDirty()
        },
    })
    ui.appendChild(cube.material.uiConfig)

}

_testStart()
init().finally(_testFinish)
