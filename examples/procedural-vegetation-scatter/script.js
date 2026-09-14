/**
 * Procedural Vegetation Scatter Example
 *
 * Demonstrates the full Distribute → Instance pipeline:
 * - Generates a terrain using TerrainGenerator (Phase 1)
 * - Scatters vegetation on the terrain surface using VegetationScatterGenerator
 * - Poisson disk distribution for even, non-overlapping placement
 * - Slope filtering: no trees on steep cliffs (>35 degrees)
 * - Height filtering: no trees below water level or on peaks
 * - Multiple vegetation types (2 tree variants + bush) with weighted random
 * - Random scale and Y-rotation for natural variation
 * - All instances rendered via InstancedMesh2 for performance
 *
 * How to test:
 * 1. A terrain should appear with trees and bushes scattered on it
 * 2. Trees should NOT appear on steep cliff faces or underwater
 * 3. Use "Terrain Params" to modify the terrain shape
 * 4. Use "Vegetation Params" to change density, slope limits, method
 * 5. Switch method between 'Poisson Disk' (even spacing) and 'Random' (clumpy)
 * 6. Verify: changing vegetation seed changes tree layout
 * 7. Verify: increasing density adds more trees
 * 8. Verify: changing slope max to 0 removes all vegetation
 */
import { _testFinish, _testStart, DirectionalLight2, HemisphereLight2, Object3DGeneratorPlugin, PickingPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { ProceduralGeneratorPlugin, TerrainGenerator, VegetationScatterGenerator, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        plugins: [PickingPlugin, Object3DGeneratorPlugin],
    });
    const procGen = viewer.addPluginSync(ProceduralGeneratorPlugin);
    const terrainGen = new TerrainGenerator();
    const vegGen = new VegetationScatterGenerator();
    procGen.generators.terrain = terrainGen;
    procGen.generators.vegetation = vegGen;
    // Scene setup
    viewer.scene.setBackgroundColor('#87CEEB');
    const dirLight = new DirectionalLight2(0xffffff, 2);
    dirLight.position.set(50, 80, 30);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -60;
    dirLight.shadow.camera.right = 60;
    dirLight.shadow.camera.top = 60;
    dirLight.shadow.camera.bottom = -60;
    dirLight.shadow.mapSize.setScalar(2048);
    viewer.scene.addObject(dirLight);
    const hemiLight = new HemisphereLight2(0x8888ff, 0x443322, 0.8);
    viewer.scene.addObject(hemiLight);
    // Generate terrain (don't use addToScene — we'll manage UI manually)
    const terrain = procGen.generateObject('terrain', {
        size: 100,
        resolution: 128,
        seed: 42,
        octaves: 6,
        noiseScale: 0.02,
        heightScale: 15,
        waterLevel: -3,
        noiseType: 'fbm',
        exponent: 1.3,
    });
    viewer.scene.addObject(terrain);
    // Generate vegetation on the terrain
    const findTerrainMesh = () => terrain.children.find((c) => c.name === 'Terrain Mesh');
    vegGen.targetMesh = findTerrainMesh() || null;
    const vegetation = procGen.generateObject('vegetation', {
        density: 0.3,
        method: 'poisson',
        slopeMax: 35,
        heightMin: -2,
        heightMax: 12,
        seed: 123,
        scaleMin: 0.6,
        scaleMax: 1.4,
    });
    viewer.scene.addObject(vegetation);
    // Camera
    viewer.scene.mainCamera.position.set(40, 35, 50);
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(PickingPlugin);
    // Terrain params — on change, also update vegetation's target mesh reference
    ui.appendChild({
        type: 'folder',
        label: 'Terrain Params',
        expanded: true,
        onChange: () => {
            procGen.regenerateObject(terrain);
            // After terrain regenerates, update vegetation's target mesh reference
            vegGen.targetMesh = findTerrainMesh() || null;
            procGen.regenerateObject(vegetation);
        },
        children: terrainGen.createUiConfig(terrain),
    });
    ui.appendChild({
        type: 'folder',
        label: 'Vegetation Params',
        expanded: true,
        onChange: () => procGen.regenerateObject(vegetation),
        children: vegGen.createUiConfig(vegetation),
    });
}
_testStart();
init().finally(_testFinish);
