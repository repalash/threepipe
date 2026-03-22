/**
 * Procedural Building Example
 *
 * Demonstrates the full building generation pipeline:
 * - Box body with face classification (walls, roof, floor)
 * - Wall grid point distribution for facade module placement
 * - Rule-based instancing: doors on ground floor front, windows elsewhere
 * - ModuleKit for style-swappable architectural modules
 * - Multiple roof styles: flat (parapet), gabled, hipped
 * - Horizontal ledges between floors
 * - Per-building color variation
 *
 * How to test:
 * 1. A building with windows, door, and flat roof should appear
 * 2. Use "Building Params" to change dimensions:
 *    - Floors: 1-12, more floors = taller building
 *    - Width/Depth: changes footprint
 *    - BaysX/BaysZ: more bays = more windows per wall
 * 3. Switch Roof Style: Flat (parapet rim), Gabled (two slopes), Hipped (pyramid)
 * 4. Switch Style: Modern (dark frames, gray), Classical (white frames, cream), Industrial (metal, gray)
 * 5. Change Seed: different wall color and module variation
 * 6. Verify: door appears on the front wall ground floor center bay
 * 7. Verify: windows don't appear on the roof
 * 8. Verify: ledges appear between floors
 */

import {
    _testFinish,
    _testStart,
    DirectionalLight2,
    GBufferPlugin,
    HemisphereLight2,
    Object3DGeneratorPlugin,
    PickingPlugin,
    SSAOPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {
    BuildingGenerator,
    ProceduralGeneratorPlugin,
} from '@threepipe/plugin-procedural-generation'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: false,
        plugins: [PickingPlugin, Object3DGeneratorPlugin, GBufferPlugin, SSAOPlugin],
    })

    const ssao = viewer.getPlugin(SSAOPlugin)
    if (ssao) ssao.pass.intensity = 0.5

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })

    const sunLight = new DirectionalLight2(0xffeebb, 2.5)
    sunLight.position.set(20, 30, 25)
    sunLight.castShadow = true
    sunLight.shadow.camera.left = -20
    sunLight.shadow.camera.right = 20
    sunLight.shadow.camera.top = 25
    sunLight.shadow.camera.bottom = -5
    sunLight.shadow.mapSize.setScalar(2048)
    sunLight.shadow.bias = -0.0005
    viewer.scene.addObject(sunLight)

    const skyLight = new HemisphereLight2(0x88bbdd, 0x445522, 0.4)
    viewer.scene.addObject(skyLight)

    const procGen = viewer.addPluginSync(ProceduralGeneratorPlugin)
    procGen.generators.building = new BuildingGenerator()

    const building = procGen.generateObject('building', {
        width: 12,
        depth: 10,
        floors: 4,
        floorHeight: 3.0,
        groundFloorHeight: 3.8,
        baysX: 4,
        baysZ: 3,
        roofStyle: 'flat',
        style: 'modern',
        seed: 42,
    })
    viewer.scene.addObject(building)

    viewer.scene.mainCamera.position.set(15, 12, 20)
    viewer.scene.mainCamera.target = new Vector3(0, 6, 0)
    viewer.scene.mainCamera.setDirty?.()

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(SSAOPlugin)
    ui.setupPluginUi(ProceduralGeneratorPlugin)
    ui.setupPluginUi(PickingPlugin)

    const buildingUi = procGen.createUiConfig(building)
    if (buildingUi) ui.appendChild(buildingUi)
}

_testStart()
init().finally(_testFinish)
