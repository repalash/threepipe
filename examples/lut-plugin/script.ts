import {
    _testFinish,
    _testStart,
    BoxGeometry,
    Color,
    GBufferPlugin,
    GeometryGeneratorPlugin,
    IMaterial,
    IObject3D,
    LoadingScreenPlugin,
    LUTCubeTextureWrapper,
    LUTPlugin,
    Mesh,
    PhysicalMaterial,
    SphereGeometry,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {FontLibrary, GeometryGeneratorExtrasPlugin} from '@threepipe/plugin-geometry-generator'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        // GBufferPlugin is required for per-material LUT selection (bit flags read by the shader).
        // Without it, LUTPlugin still works as a single global LUT (slot 0 only).
        plugins: [LoadingScreenPlugin, GBufferPlugin],
    })

    const generator = viewer.addPluginSync(GeometryGeneratorPlugin)
    viewer.addPluginSync(GeometryGeneratorExtrasPlugin)
    await FontLibrary.Init

    const lut = viewer.addPluginSync(new LUTPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    viewer.scene.setBackgroundColor('#2d3436')

    // Load three distinct LUTs in parallel — warm / cinematic / teal-punch.
    // Sourced from three.js's example LUTs dir.
    const lutBase = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/luts/'
    const [lut0, lut1, lut2] = await Promise.all([
        viewer.load(lutBase + 'Bourbon%2064.CUBE') as Promise<LUTCubeTextureWrapper | undefined>,
        viewer.load(lutBase + 'Cubicle%2099.CUBE') as Promise<LUTCubeTextureWrapper | undefined>,
        viewer.load(lutBase + 'Remy%2024.CUBE') as Promise<LUTCubeTextureWrapper | undefined>,
    ])
    lut.lutMap = lut0
    lut.lutMap1 = lut1
    lut.lutMap2 = lut2

    // Three objects spaced wide enough for labels not to collide.
    const xPositions = [-3.6, 0, 3.6]

    // Helmet on the left — uses slot 0 (the default for materials without a per-material config)
    const helmet = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: false,
    })
    helmet?.position.set(xPositions[0], 0, 0)

    // Sphere in the middle — uses slot 1 (cinematic)
    const sphereMat = new PhysicalMaterial({color: new Color(0xffaa55), metalness: 0.1, roughness: 0.4})
    const sphere = new Mesh(new SphereGeometry(1, 48, 24), sphereMat) as any as IObject3D
    sphere.position.set(xPositions[1], 0, 0)
    viewer.scene.addObject(sphere)
    lut.setMaterialLUT(sphereMat, {slot: 1})

    // Cube on the right — uses slot 2 (teal-punch)
    const cubeMat = new PhysicalMaterial({color: new Color(0x4488ff), metalness: 0.3, roughness: 0.5})
    const cube = new Mesh(new BoxGeometry(1.6, 1.6, 1.6), cubeMat) as any as IObject3D
    cube.position.set(xPositions[2], 0, 0)
    viewer.scene.addObject(cube)
    lut.setMaterialLUT(cubeMat, {slot: 2})

    viewer.scene.mainCamera.position.set(0, 1.4, 9)
    viewer.scene.mainCamera.target.set(0, 0, 0)

    // 3D extruded text labels using threepipe's GeometryGeneratorPlugin (same pattern
    // as examples/shape-tube-extrude). No external CDN — fonts ship with the plugin.
    // Label text is excluded from LUT grading so it stays consistent across slots.
    // Two lines per label — name on top, slot info below — to keep them compact.
    const labels: [string, string, Vector3][] = [
        ['Bourbon 64', 'slot 0 (default) — warm', new Vector3(xPositions[0], 1.5, 0)],
        ['Cubicle 99', 'slot 1 — cool',            new Vector3(xPositions[1], 1.5, 0)],
        ['Remy 24',    'slot 2 — desaturated',     new Vector3(xPositions[2], 1.5, 0)],
    ]
    for (const [name, slotText, pos] of labels) {
        const nameLabel = generator.generateObject('text', {
            text: name, size: 0.2, depth: 0.03,
            alignX: 0.5, alignY: 0.5, curveSegments: 12, bevelEnabled: false,
        })
        nameLabel.position.copy(pos)
        const nameMat = nameLabel.material as IMaterial
        nameMat.color?.setStyle('#ffffff')
        nameMat.roughness = 0.7
        lut.setMaterialLUT(nameMat, {enable: false})
        viewer.scene.addObject(nameLabel)

        const slotLabel = generator.generateObject('text', {
            text: slotText, size: 0.13, depth: 0.02,
            alignX: 0.5, alignY: 0.5, curveSegments: 8, bevelEnabled: false,
        })
        slotLabel.position.set(pos.x, pos.y - 0.28, pos.z)
        const slotMat = slotLabel.material as IMaterial
        slotMat.color?.setStyle('#a0a0a0')
        slotMat.roughness = 0.8
        lut.setMaterialLUT(slotMat, {enable: false})
        viewer.scene.addObject(slotLabel)
    }

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(LUTPlugin)

}

_testStart()
init().finally(_testFinish)
