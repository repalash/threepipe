/**
 * Procedural Terrain — Showcase
 *
 * Portfolio-quality terrain combining the best techniques from:
 * - THREE.Terrain: turbulence transform, island edge falloff, multi-pass composition
 * - threejs-ballooning: slope-based cliff/grass/sand coloring, Fresnel rim glow, valley rivers
 * - Our pipeline: domain warping, hydraulic + thermal erosion, terracing, flow maps
 *
 * Color palette inspired by cinematic landscape rendering:
 * - Deep saturated greens at low elevations (forest floor)
 * - Warm golden-green transition (sunlit meadow)
 * - Earth/ochre tones mid-elevation (exposed soil)
 * - Cool blue-gray rock at high elevation
 * - Warm snow with slight blue tint at peaks
 * - Turquoise-teal water with reflections
 *
 * Techniques combined:
 * 1. Ridged multifractal noise for dramatic mountain ridges
 * 2. Domain warping for organic, non-repetitive shapes
 * 3. Elevation redistribution (pow curve) for flat valleys + steep peaks
 * 4. Hydraulic erosion for river channels with flow visualization
 * 5. Thermal erosion for natural talus/scree slopes
 * 6. Light terracing for geological layering effect
 * 7. Height + slope + flow vertex coloring with 9 color bands
 * 8. Island edge falloff for clean ocean boundary
 * 9. Turbulence transform for dramatic cliff faces (from THREE.Terrain)
 * 10. SSAO + Bloom + SSR post-processing
 */
import { _testFinish, _testStart, BufferAttribute, Color, DirectionalLight2, DoubleSide, GBufferPlugin, Group2, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAAPlugin, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { createDomainWarp, createNoise2D, DerivedAttributes, Displace, fbm, HeightmapOps, PrimGen, ridged, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { BloomPlugin, SSReflectionPlugin, TemporalAAPlugin } from '@threepipe/webgi-plugins';
const params = {
    // Base noise — ridged multifractal for dramatic mountain ridges
    seed: 77,
    size: 80,
    resolution: 220,
    heightScale: 18,
    noiseScale: 0.025,
    octaves: 6,
    exponent: 1.6,
    noiseType: 'ridged',
    // Domain warp — organic, swirling terrain shapes
    enableWarp: true,
    warpAmount: 12,
    warpScale: 0.018,
    // Island falloff — smooth edges for ocean boundary
    edgeFalloff: 0.7,
    // Turbulence — absolute value transform for dramatic cliff faces (THREE.Terrain technique)
    enableTurbulence: true,
    turbulenceStrength: 0.3,
    // Hydraulic erosion — carve river channels
    enableHydraulic: true,
    droplets: 30000,
    maxSteps: 40,
    brushRadius: 3,
    erodeSpeed: 0.25,
    sedimentCapacity: 3,
    // Thermal erosion — natural talus/scree
    enableThermal: true,
    thermalIterations: 25,
    talusThreshold: 0.6,
    // Terracing — subtle geological layering
    enableTerracing: true,
    terraceLevels: 12,
    terraceSharpness: 0.25,
    // Post-processing
    smoothPasses: 2,
    // Visualization
    flowTint: 0.5,
    waterLevel: 2.5,
};
function generateTerrain() {
    const root = new Group2();
    root.name = 'Showcase Terrain';
    const segs = Math.max(32, Math.min(256, Math.floor(params.resolution)));
    const verts = segs + 1;
    const cellSize = params.size / segs;
    const halfSize = params.size / 2;
    const geo = PrimGen.grid(params.size, params.size, segs, segs);
    const positions = geo.getAttribute('position');
    // Step 1: Base noise — ridged multifractal for mountain ridges
    const baseNoise = createNoise2D(params.seed);
    const fbmOpts = { octaves: params.octaves, scale: params.noiseScale };
    // Step 2: Domain warping for organic shapes
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
    // Step 3: Displacement with pow redistribution, edge falloff, and turbulence
    const exponent = Math.max(0.5, params.exponent);
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        let h = (noiseFn(x, z) + 1) * 0.5; // normalize to 0..1
        // Elevation redistribution — flat valleys, steep peaks
        h = Math.pow(Math.max(0, h), exponent);
        // Turbulence transform (from THREE.Terrain) — abs value creates dramatic cliff faces
        if (params.enableTurbulence && params.turbulenceStrength > 0) {
            const turbH = Math.abs(h * 2 - 1);
            h = h * (1 - params.turbulenceStrength) + turbH * params.turbulenceStrength;
        }
        // Island edge falloff — smooth boundary to ocean
        if (params.edgeFalloff > 0) {
            const dx = Math.abs(x) / halfSize;
            const dz = Math.abs(z) / halfSize;
            const edgeDist = Math.max(dx, dz);
            const falloff = 1.0 - Math.pow(Math.min(1, edgeDist), 2.5);
            h *= 1.0 - params.edgeFalloff + params.edgeFalloff * falloff;
        }
        positions.setY(i, h * params.heightScale);
    }
    positions.needsUpdate = true;
    // Extract heightmap for grid-based operations
    let heightmap = Displace.extractHeightmap(geo, verts, verts);
    // Step 4: Hydraulic erosion — carve realistic river channels
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
    // Step 5: Thermal erosion — natural scree and talus at cliff bases
    if (params.enableThermal && params.thermalIterations > 0) {
        Displace.thermalErode(heightmap, verts, verts, {
            iterations: Math.floor(params.thermalIterations),
            talusThreshold: params.talusThreshold,
            cellSize,
        });
    }
    // Step 6: Subtle terracing — geological layering effect
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
    // Smooth normals to reduce SSAO faceting artifacts at ridges
    DerivedAttributes.smoothAttribute(geo, 'normal', 1);
    // Step 8: Cinematic vertex coloring — 9 bands with slope + flow blending
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
    // Cinematic color palette — saturated, warm, inspired by landscape photography
    // and the ballooning project's grass/cliff/sand approach
    const deepForest = new Color(0x1a5c2a); // dark forest floor
    const richGreen = new Color(0x2d7a3a); // lush forest
    const meadow = new Color(0x5a9e3e); // bright sunlit meadow
    const goldenGrass = new Color(0x8aaa40); // golden-green transitional grass
    const warmEarth = new Color(0xa89050); // warm ochre exposed earth
    const dryRock = new Color(0x8a8070); // warm gray-brown rock
    const coolRock = new Color(0x7a8088); // cool blue-gray high rock
    const alpineRock = new Color(0x9a9aa0); // pale blue-gray alpine
    const snowLine = new Color(0xd0d5da); // blue-tinted snow transition
    const snowPeak = new Color(0xf0f2f5); // bright white-blue snow
    const cliff = new Color(0x5a5550); // dark warm cliff face
    const waterTint = new Color(0x1a5580); // deep blue flow tint
    const sandColor = new Color(0xb09060); // beach sand at water edge
    // Normalize flow map
    let maxFlow = 0;
    if (flowMap)
        for (let i = 0; i < flowMap.length; i++) {
            if (flowMap[i] > maxFlow)
                maxFlow = flowMap[i];
        }
    for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i);
        const t = (y - minY) / hRange;
        // Water-edge sand (inspired by ballooning's sand/grass transition at water height)
        const waterT = (params.waterLevel - minY) / hRange;
        const nearWater = Math.max(0, 1 - Math.abs(t - waterT) / 0.04);
        // Height bands — cinematic gradient with 9 color stops
        if (t < 0.08)
            tc.copy(deepForest).lerp(richGreen, t / 0.08);
        else if (t < 0.18)
            tc.copy(richGreen).lerp(meadow, (t - 0.08) / 0.10);
        else if (t < 0.30)
            tc.copy(meadow).lerp(goldenGrass, (t - 0.18) / 0.12);
        else if (t < 0.42)
            tc.copy(goldenGrass).lerp(warmEarth, (t - 0.30) / 0.12);
        else if (t < 0.55)
            tc.copy(warmEarth).lerp(dryRock, (t - 0.42) / 0.13);
        else if (t < 0.68)
            tc.copy(dryRock).lerp(coolRock, (t - 0.55) / 0.13);
        else if (t < 0.80)
            tc.copy(coolRock).lerp(alpineRock, (t - 0.68) / 0.12);
        else if (t < 0.92)
            tc.copy(alpineRock).lerp(snowLine, (t - 0.80) / 0.12);
        else
            tc.copy(snowLine).lerp(snowPeak, Math.min(1, (t - 0.92) / 0.08));
        // Sand near water edge (ballooning technique)
        if (nearWater > 0) {
            tc.lerp(sandColor, nearWater * 0.6);
        }
        // Slope-based cliff coloring (steeper angles = more cliff)
        // Ballooning uses a sharp step function; we use a smooth ramp starting at 30 degrees
        nv.set(normals.getX(i), normals.getY(i), normals.getZ(i));
        const slope = Math.acos(Math.min(1, Math.max(-1, nv.dot(up)))) * (180 / Math.PI);
        if (slope > 30) {
            const cliffBlend = Math.min(1, (slope - 30) / 30);
            tc.lerp(cliff, cliffBlend * 0.65);
        }
        // Flow map tinting — blue river channels from hydraulic erosion
        if (flowMap && maxFlow > 0) {
            const flow = Math.min(1, flowMap[i] / (maxFlow * 0.15));
            if (flow > 0.02) {
                tc.lerp(waterTint, flow * params.flowTint);
            }
        }
        tc.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    // PBR terrain material
    const mat = new PhysicalMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    mat.name = 'Terrain';
    const mesh = new Mesh2(geo, mat);
    mesh.name = 'Terrain Mesh';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    // Water plane — turquoise-teal with reflections
    if (params.waterLevel > minY) {
        const wg = new PlaneGeometry(params.size * 1.5, params.size * 1.5);
        const wm = new PhysicalMaterial({
            color: 0x1a7a8a,
            roughness: 0.02,
            metalness: 0.15,
            transparent: true,
            opacity: 0.7,
            side: DoubleSide,
        });
        wm.name = 'Water';
        const water = new Mesh2(wg, wm);
        water.rotation.x = -Math.PI / 2;
        water.position.y = params.waterLevel;
        water.receiveShadow = true;
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
    // Post-processing — tuned for cinematic look
    const ssao = viewer.getPlugin(SSAOPlugin);
    if (ssao?.pass)
        ssao.pass.intensity = 0.6;
    const bloom = viewer.getPlugin(BloomPlugin);
    if (bloom?.pass)
        bloom.pass.intensity = 0.25;
    // HDR environment — golden hour sunset
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', { setBackground: true });
    // Main directional light — warm golden sun at low angle for dramatic shadows
    const sun = new DirectionalLight2(0xffe8c0, 3.0);
    sun.position.set(35, 45, 50);
    sun.castShadow = true;
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.bias = -0.0004;
    viewer.scene.addObject(sun);
    // Hemisphere light — sky blue above, warm earth below
    // Creates soft ambient fill that separates shadows from pure black
    viewer.scene.addObject(new HemisphereLight2(0x8ab4d8, 0x6a5a40, 0.5));
    let terrain = generateTerrain();
    viewer.scene.addObject(terrain);
    // Camera — cinematic 3/4 view looking slightly down at the terrain
    viewer.scene.mainCamera.position.set(38, 28, 45);
    viewer.scene.mainCamera.target = new Vector3(-2, 2, -5);
    viewer.scene.mainCamera.setDirty?.();
    // UI
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
        type: 'folder', label: 'Shape', expanded: false, onChange: regenerate,
        children: [
            { type: 'slider', label: 'Edge Falloff', property: [params, 'edgeFalloff'], bounds: [0, 1], stepSize: 0.05 },
            { type: 'checkbox', label: 'Turbulence', property: [params, 'enableTurbulence'] },
            { type: 'slider', label: 'Turbulence Strength', property: [params, 'turbulenceStrength'], bounds: [0, 1], stepSize: 0.05 },
        ],
    });
    ui.appendChild({
        type: 'folder', label: 'Hydraulic Erosion', expanded: false, onChange: regenerate,
        children: [
            { type: 'checkbox', label: 'Enabled', property: [params, 'enableHydraulic'] },
            { type: 'slider', label: 'Droplets', property: [params, 'droplets'], bounds: [0, 60000], stepSize: 1000 },
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
        type: 'folder', label: 'Visual', expanded: false, onChange: regenerate,
        children: [
            { type: 'slider', label: 'Smooth Passes', property: [params, 'smoothPasses'], bounds: [0, 5], stepSize: 1 },
            { type: 'slider', label: 'Flow Tint', property: [params, 'flowTint'], bounds: [0, 1], stepSize: 0.05 },
            { type: 'slider', label: 'Water Level', property: [params, 'waterLevel'], bounds: [-10, 12], stepSize: 0.5 },
        ],
    });
}
_testStart();
init().finally(_testFinish);
