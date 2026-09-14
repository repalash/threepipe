/**
 * Procedural Terrain — Advanced Example
 *
 * Full terrain generation pipeline combining all techniques:
 * 1. Base noise (FBM with configurable octaves)
 * 2. Domain warping (swirling organic patterns via Inigo Quilez technique)
 * 3. Elevation redistribution (pow curve for realistic mountain profiles)
 * 4. Hydraulic erosion (Beyer/Lague particle droplet algorithm)
 * 5. Thermal erosion (talus-angle material crumbling)
 * 6. Terracing (stepped mesa-like terrain)
 * 7. Post-erosion smoothing
 * 8. Height + slope + flow map vertex coloring
 * 9. Water plane
 *
 * How to test:
 * 1. Terrain with multiple erosion effects and flow visualization
 * 2. Domain Warp > 0: terrain becomes swirly/organic instead of straight noise
 * 3. Hydraulic droplets: blue-tinted river channels flowing downhill
 * 4. Thermal iterations: smoothed cliffs with talus/scree at base
 * 5. Terrace levels > 0: visible stepped horizontal bands
 * 6. Exponent: 1.0 = raw noise, 2.0+ = flat valleys with steep peaks
 * 7. Smooth passes: removes noise artifacts after erosion
 * 8. Each effect can be toggled independently (set to 0 to disable)
 *
 * Reference implementations:
 * - Hydraulic erosion: .repos/hydraulic-erosion-lague/Assets/Scripts/Erosion.cs
 * - Domain warping: https://iquilezles.org/articles/warp/
 * - Thermal erosion: Olsen (2004) "Realtime Procedural Terrain Generation"
 */
import { _testFinish, _testStart, BufferAttribute, Color, DirectionalLight2, DoubleSide, GBufferPlugin, Group2, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAAPlugin, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { createDomainWarp, createNoise2D, DerivedAttributes, Displace, fbm, HeightmapOps, PrimGen, ridged, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { BloomPlugin, SSReflectionPlugin, TemporalAAPlugin } from '@threepipe/webgi-plugins';
const params = {
    // Base noise — same as erosion example for comparison
    seed: 42,
    size: 60,
    resolution: 200,
    heightScale: 15,
    noiseScale: 0.03,
    octaves: 5,
    exponent: 1.4,
    noiseType: 'fbm',
    // Domain warp
    enableWarp: true,
    warpAmount: 8,
    warpScale: 0.02,
    // Hydraulic erosion
    enableHydraulic: true,
    droplets: 20000,
    maxSteps: 30,
    brushRadius: 2,
    erodeSpeed: 0.2,
    sedimentCapacity: 2,
    // Thermal erosion
    enableThermal: true,
    thermalIterations: 20,
    talusThreshold: 0.7,
    // Terracing
    enableTerracing: true,
    terraceLevels: 8,
    terraceSharpness: 0.5,
    // Post-processing
    smoothPasses: 1,
    // Visualization
    flowTint: 0.6,
    waterLevel: 3,
};
function generateTerrain() {
    const root = new Group2();
    root.name = 'Advanced Terrain';
    const segs = Math.max(32, Math.min(256, Math.floor(params.resolution)));
    const verts = segs + 1;
    const cellSize = params.size / segs;
    const geo = PrimGen.grid(params.size, params.size, segs, segs);
    const positions = geo.getAttribute('position');
    // Step 1: Base noise
    const baseNoise = createNoise2D(params.seed);
    const fbmOpts = { octaves: params.octaves, scale: params.noiseScale };
    // Step 2: Optional domain warping
    let noiseFn;
    const baseNoiseTyped = params.noiseType === 'ridged'
        ? (x, y) => ridged(baseNoise, x, y, fbmOpts)
        : (x, y) => fbm(baseNoise, x, y, fbmOpts);
    if (params.enableWarp && params.warpAmount > 0) {
        noiseFn = createDomainWarp(baseNoiseTyped, params.seed + 5077, params.warpAmount, params.warpScale);
    }
    else {
        noiseFn = baseNoiseTyped;
    }
    // Step 3: Displacement with elevation redistribution
    const exponent = Math.max(0.5, params.exponent);
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        let h = (noiseFn(x, z) + 1) * 0.5; // normalize to 0..1
        h = Math.pow(Math.max(0, h), exponent);
        positions.setY(i, h * params.heightScale);
    }
    positions.needsUpdate = true;
    // Extract heightmap for grid-based operations
    let heightmap = Displace.extractHeightmap(geo, verts, verts);
    // Step 4: Hydraulic erosion
    let flowMap = null;
    if (params.enableHydraulic && params.droplets > 0) {
        const result = Displace.hydraulicErode(heightmap, verts, verts, {
            droplets: Math.floor(params.droplets),
            maxSteps: Math.floor(params.maxSteps),
            brushRadius: Math.max(1, Math.floor(params.brushRadius)),
            seed: params.seed + 100,
            erodeSpeed: params.erodeSpeed,
            depositSpeed: 0.2,
            sedimentCapacity: params.sedimentCapacity,
            inertia: 0.05,
            gravity: 6,
        });
        heightmap = result.heightmap;
        flowMap = result.flowMap;
    }
    // Step 5: Thermal erosion
    if (params.enableThermal && params.thermalIterations > 0) {
        Displace.thermalErode(heightmap, verts, verts, {
            iterations: Math.floor(params.thermalIterations),
            talusThreshold: params.talusThreshold,
            cellSize,
        });
    }
    // Step 6: Terracing
    if (params.enableTerracing && params.terraceLevels > 0) {
        Displace.terrace(heightmap, verts, verts, Math.floor(params.terraceLevels), params.terraceSharpness);
    }
    // Step 7: Post-erosion smoothing
    if (params.smoothPasses > 0) {
        heightmap = HeightmapOps.smooth(heightmap, verts, verts, Math.floor(params.smoothPasses), 'mean');
    }
    // Apply heightmap back to geometry
    Displace.applyHeightmap(geo, heightmap);
    geo.computeVertexNormals();
    // Smooth normals to reduce faceting artifacts visible in SSAO.
    // Without this, sharp ridges in the terrain show hard edge lines
    // because adjacent triangle normals differ significantly at peaks.
    DerivedAttributes.smoothAttribute(geo, 'normal', 1);
    // Step 8: Vertex coloring
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i);
        if (y < minY)
            minY = y;
        if (y > maxY)
            maxY = y;
    }
    const hRange = maxY - minY || 1;
    const normals = geo.getAttribute('normal');
    const colors = new Float32Array(positions.count * 3);
    const up = new Vector3(0, 1, 0);
    const nv = new Vector3();
    const tc = new Color();
    // Color palette — vibrant, matching TerrainGenerator's updated bands
    const deepGreen = new Color(0x1a6b30);
    const grass = new Color(0x3a8c3a);
    const brightGrass = new Color(0x6aaa42);
    const dryGrass = new Color(0x8a9a3a);
    const earth = new Color(0x9a8a60);
    const rock = new Color(0x7a7a72);
    const highRock = new Color(0x9a9a95);
    const snow = new Color(0xf5f5f0);
    const cliff = new Color(0x6a6a62);
    const waterBlue = new Color(0x2255aa);
    // Normalize flow map
    let maxFlow = 0;
    if (flowMap)
        for (let i = 0; i < flowMap.length; i++) {
            if (flowMap[i] > maxFlow)
                maxFlow = flowMap[i];
        }
    for (let i = 0; i < positions.count; i++) {
        const t = (positions.getY(i) - minY) / hRange;
        // Height bands — more bands for richer color transitions
        if (t < 0.12)
            tc.copy(deepGreen).lerp(grass, t / 0.12);
        else if (t < 0.25)
            tc.copy(grass).lerp(brightGrass, (t - 0.12) / 0.13);
        else if (t < 0.4)
            tc.copy(brightGrass).lerp(dryGrass, (t - 0.25) / 0.15);
        else if (t < 0.55)
            tc.copy(dryGrass).lerp(earth, (t - 0.4) / 0.15);
        else if (t < 0.7)
            tc.copy(earth).lerp(rock, (t - 0.55) / 0.15);
        else if (t < 0.85)
            tc.copy(rock).lerp(highRock, (t - 0.7) / 0.15);
        else if (t < 0.95)
            tc.copy(highRock).lerp(snow, (t - 0.85) / 0.1);
        else
            tc.copy(snow);
        // Slope → cliff color (gentler blend, starts at steeper angle)
        nv.set(normals.getX(i), normals.getY(i), normals.getZ(i));
        const slope = Math.acos(Math.min(1, Math.max(-1, nv.dot(up)))) * (180 / Math.PI);
        if (slope > 35) {
            tc.lerp(cliff, Math.min(1, (slope - 35) / 35) * 0.6);
        }
        // Flow map → blue tint
        if (flowMap && maxFlow > 0) {
            const flow = Math.min(1, flowMap[i] / (maxFlow * 0.2));
            if (flow > 0.02) {
                tc.lerp(waterBlue, flow * params.flowTint);
            }
        }
        tc.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    const mat = new PhysicalMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    mat.name = 'Terrain';
    const mesh = new Mesh2(geo, mat);
    mesh.name = 'Terrain Mesh';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    // Water
    if (params.waterLevel > minY) {
        const wg = new PlaneGeometry(params.size * 1.3, params.size * 1.3);
        const wm = new PhysicalMaterial({ color: 0x2277aa, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.65, side: DoubleSide });
        wm.name = 'Water';
        const water = new Mesh2(wg, wm);
        water.rotation.x = -Math.PI / 2;
        water.position.y = params.waterLevel;
        root.add(water);
    }
    return root;
}
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        rgbm: false,
        plugins: [
            PickingPlugin,
            GBufferPlugin,
            SSAAPlugin,
            SSAOPlugin,
            BloomPlugin,
            SSReflectionPlugin,
            TemporalAAPlugin,
        ],
    });
    // Post-processing setup
    const ssao = viewer.getPlugin(SSAOPlugin);
    if (ssao?.pass)
        ssao.pass.intensity = 0.5;
    const bloom = viewer.getPlugin(BloomPlugin);
    if (bloom?.pass)
        bloom.pass.intensity = 0.3;
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', { setBackground: true });
    // Sun with high quality shadows
    const sun = new DirectionalLight2(0xffeebb, 2.5);
    sun.position.set(40, 60, 30);
    sun.castShadow = true;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.bias = -0.0005;
    viewer.scene.addObject(sun);
    // Warm fill from below for valley detail
    viewer.scene.addObject(new HemisphereLight2(0x88aacc, 0x554422, 0.4));
    let terrain = generateTerrain();
    viewer.scene.addObject(terrain);
    viewer.scene.mainCamera.position.set(30, 30, 40);
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0);
    viewer.scene.mainCamera.setDirty?.();
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    ui.setupPluginUi(BloomPlugin);
    ui.setupPluginUi(SSReflectionPlugin);
    ui.setupPluginUi(PickingPlugin);
    const regenerate = () => {
        const parent = terrain.parent;
        terrain.dispose?.();
        terrain = generateTerrain();
        parent?.add(terrain);
        viewer.setDirty();
    };
    ui.appendChild({
        type: 'folder', label: 'Base Terrain', expanded: false, onChange: regenerate,
        children: [
            { type: 'slider', label: 'Seed', property: [params, 'seed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Resolution', property: [params, 'resolution'], bounds: [64, 256], stepSize: 1 },
            { type: 'slider', label: 'Height Scale', property: [params, 'heightScale'], bounds: [5, 35], stepSize: 0.5 },
            { type: 'slider', label: 'Noise Scale', property: [params, 'noiseScale'], bounds: [0.005, 0.08], stepSize: 0.001 },
            { type: 'slider', label: 'Octaves', property: [params, 'octaves'], bounds: [1, 8], stepSize: 1 },
            { type: 'slider', label: 'Exponent', property: [params, 'exponent'], bounds: [0.5, 3.0], stepSize: 0.1 },
            { type: 'dropdown', label: 'Noise Type', property: [params, 'noiseType'], children: [
                    { label: 'FBM', value: 'fbm' }, { label: 'Ridged', value: 'ridged' },
                ] },
        ],
    });
    ui.appendChild({
        type: 'folder', label: 'Domain Warp', expanded: false, onChange: regenerate,
        children: [
            { type: 'checkbox', label: 'Enabled', property: [params, 'enableWarp'] },
            { type: 'slider', label: 'Warp Amount', property: [params, 'warpAmount'], bounds: [0, 25], stepSize: 0.5 },
            { type: 'slider', label: 'Warp Scale', property: [params, 'warpScale'], bounds: [0.005, 0.06], stepSize: 0.001 },
        ],
    });
    ui.appendChild({
        type: 'folder', label: 'Hydraulic Erosion', expanded: true, onChange: regenerate,
        children: [
            { type: 'checkbox', label: 'Enabled', property: [params, 'enableHydraulic'] },
            { type: 'slider', label: 'Droplets', property: [params, 'droplets'], bounds: [0, 50000], stepSize: 1000 },
            { type: 'slider', label: 'Max Steps', property: [params, 'maxSteps'], bounds: [10, 64], stepSize: 1 },
            { type: 'slider', label: 'Brush Radius', property: [params, 'brushRadius'], bounds: [1, 5], stepSize: 1 },
            { type: 'slider', label: 'Erode Speed', property: [params, 'erodeSpeed'], bounds: [0.05, 0.8], stepSize: 0.05 },
            { type: 'slider', label: 'Sediment Capacity', property: [params, 'sedimentCapacity'], bounds: [1, 10], stepSize: 0.5 },
        ],
    });
    ui.appendChild({
        type: 'folder', label: 'Thermal Erosion', expanded: false, onChange: regenerate,
        children: [
            { type: 'checkbox', label: 'Enabled', property: [params, 'enableThermal'] },
            { type: 'slider', label: 'Iterations', property: [params, 'thermalIterations'], bounds: [0, 100], stepSize: 1 },
            { type: 'slider', label: 'Talus Threshold', property: [params, 'talusThreshold'], bounds: [0.1, 2.0], stepSize: 0.05 },
        ],
    });
    ui.appendChild({
        type: 'folder', label: 'Terracing', expanded: false, onChange: regenerate,
        children: [
            { type: 'checkbox', label: 'Enabled', property: [params, 'enableTerracing'] },
            { type: 'slider', label: 'Levels', property: [params, 'terraceLevels'], bounds: [2, 20], stepSize: 1 },
            { type: 'slider', label: 'Sharpness', property: [params, 'terraceSharpness'], bounds: [0, 1], stepSize: 0.05 },
        ],
    });
    ui.appendChild({
        type: 'folder', label: 'Post-Processing & View', expanded: false, onChange: regenerate,
        children: [
            { type: 'slider', label: 'Smooth Passes', property: [params, 'smoothPasses'], bounds: [0, 5], stepSize: 1 },
            { type: 'slider', label: 'Flow Tint', property: [params, 'flowTint'], bounds: [0, 1], stepSize: 0.05 },
            { type: 'slider', label: 'Water Level', property: [params, 'waterLevel'], bounds: [-10, 12], stepSize: 0.5 },
        ],
    });
}
_testStart();
init().finally(_testFinish);
