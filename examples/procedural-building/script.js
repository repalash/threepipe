/**
 * Procedural Building Example
 *
 * A proper building with walls, windows, doors, floors, and roof.
 * Each window has: wall surround + recessed glass + frame + sill.
 * Ground floor has a door with thicker panel.
 * Horizontal ledges between floors, cornice at top, plinth at base.
 * Three roof types and three architectural styles.
 *
 * How to test:
 * 1. Building with visible windows (glass behind frame), door on front
 * 2. Change Floors → building gets taller with more rows of windows
 * 3. Change Front Bays → more/fewer windows per wall
 * 4. Switch Roof: Flat (parapet walls), Gabled (two slopes + gable infill), Hipped (pyramid)
 * 5. Switch Style: Modern (dark frames), Classical (white frames + 3-part cornice), Industrial (gray)
 * 6. Change Seed → wall color changes
 * 7. Orbit to see all 4 walls, look inside to see floor slabs
 */
import { _testFinish, _testStart, DirectionalLight2, GBufferPlugin, HemisphereLight2, Mesh2, Object3DGeneratorPlugin, PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { BuildingGenerator, ProceduralGeneratorPlugin, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        rgbm: false,
        plugins: [PickingPlugin, Object3DGeneratorPlugin, GBufferPlugin, SSAOPlugin],
    });
    const ssao = viewer.getPlugin(SSAOPlugin);
    if (ssao?.pass)
        ssao.pass.intensity = 0.5;
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', { setBackground: true });
    const sun = new DirectionalLight2(0xffeebb, 2.5);
    sun.position.set(15, 25, 20);
    sun.castShadow = true;
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -2;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.bias = -0.0005;
    viewer.scene.addObject(sun);
    viewer.scene.addObject(new HemisphereLight2(0x88bbdd, 0x443322, 0.4));
    // Ground plane
    const ground = new Mesh2(new PlaneGeometry(40, 40), new PhysicalMaterial({ color: 0x888880, roughness: 0.95, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'Ground';
    viewer.scene.addObject(ground);
    const procGen = viewer.addPluginSync(ProceduralGeneratorPlugin);
    procGen.generators.building = new BuildingGenerator();
    const building = procGen.generateObject('building', {
        width: 12,
        depth: 10,
        floors: 4,
        floorHeight: 3.0,
        groundFloorHeight: 3.8,
        baysPerWallFront: 4,
        baysPerWallSide: 3,
        roofStyle: 'flat',
        style: 'classical',
        seed: 42,
    });
    viewer.scene.addObject(building);
    viewer.scene.mainCamera.position.set(12, 10, 16);
    viewer.scene.mainCamera.target = new Vector3(0, 6, 0);
    viewer.scene.mainCamera.setDirty?.();
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    ui.setupPluginUi(ProceduralGeneratorPlugin);
    ui.setupPluginUi(PickingPlugin);
    const buildingUi = procGen.createUiConfig(building);
    if (buildingUi)
        ui.appendChild(buildingUi);
}
_testStart();
init().finally(_testFinish);
