/**
 * Procedural Terrain — Basic Example
 *
 * Demonstrates the procedural terrain generator with:
 * - Noise-based height displacement (FBM and ridged multifractal)
 * - Height-based vertex coloring (green valleys, gray rock, white peaks)
 * - Slope-based rock blending on steep surfaces
 * - Semi-transparent water plane
 * - Elevation redistribution (exponent) for realistic mountain profiles
 * - Edge falloff for island-like terrain shapes
 *
 * How to test:
 * 1. The terrain should appear with colored hills and a water plane
 * 2. Use the Tweakpane UI (right panel) to click "Generate terrain" to add more terrains
 * 3. Click on the terrain mesh to select it, then tweak "Generation Params":
 *    - Seed: changes the noise pattern (different terrain shape)
 *    - Resolution: 32-256, higher = more detail (watch for slowdown above 256)
 *    - Octaves: 1-8, more = finer detail
 *    - NoiseScale: 0.005-0.1, smaller = broader features
 *    - HeightScale: 5-50, taller mountains
 *    - WaterLevel: raise/lower the water
 *    - NoiseType: switch between 'fbm' (smooth hills) and 'ridged' (sharp mountains)
 *    - Exponent: 1.0 (no effect) to 3.0 (flat valleys, steep peaks)
 *    - EdgeFalloff: 0 (no edge) to 1.0 (island shape)
 * 4. Verify: same seed always produces the same terrain
 * 5. Verify: terrain has shadows (directional light)
 */
import { _testFinish, _testStart, DirectionalLight2, GBufferPlugin, HemisphereLight2, Object3DGeneratorPlugin, PickingPlugin, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { ProceduralGeneratorPlugin, TerrainGenerator } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        rgbm: false,
        plugins: [PickingPlugin, Object3DGeneratorPlugin, GBufferPlugin, SSAOPlugin],
    });
    const ssao = viewer.getPlugin(SSAOPlugin);
    if (ssao)
        ssao.pass.intensity = 0.5;
    const procGen = viewer.addPluginSync(ProceduralGeneratorPlugin);
    procGen.generators.terrain = new TerrainGenerator();
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', { setBackground: true });
    const dirLight = new DirectionalLight2(0xffeebb, 2.5);
    dirLight.position.set(50, 80, 30);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -60;
    dirLight.shadow.camera.right = 60;
    dirLight.shadow.camera.top = 60;
    dirLight.shadow.camera.bottom = -60;
    dirLight.shadow.mapSize.setScalar(2048);
    dirLight.shadow.bias = -0.0005;
    viewer.scene.addObject(dirLight);
    const hemiLight = new HemisphereLight2(0x88aacc, 0x554422, 0.4);
    viewer.scene.addObject(hemiLight);
    // Generate terrain and add to scene (use scene.addObject, not addToScene,
    // because we manage UI manually below via createUiConfig)
    const terrain = procGen.generateObject('terrain', {
        size: 100,
        resolution: 128,
        seed: 42,
        octaves: 6,
        noiseScale: 0.02,
        heightScale: 20,
        waterLevel: -2,
        noiseType: 'fbm',
    });
    viewer.scene.addObject(terrain);
    // Camera
    viewer.scene.mainCamera.position.set(40, 50, 60);
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    ui.setupPluginUi(ProceduralGeneratorPlugin);
    ui.setupPluginUi(PickingPlugin);
    // Add the terrain's generation params directly to the tweakpane panel
    const terrainUi = procGen.createUiConfig(terrain);
    if (terrainUi)
        ui.appendChild(terrainUi);
}
_testStart();
init().finally(_testFinish);
