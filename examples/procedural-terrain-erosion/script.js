/**
 * Procedural Terrain with Erosion Example
 *
 * Demonstrates hydraulic erosion with flow map visualization:
 * - Base terrain from FBM noise
 * - Hydraulic erosion carving river channels (Beyer/Lague algorithm)
 * - Flow map overlay: blue tint shows where water traveled
 * - Erosion map overlay: darker where material was removed
 * - Height + slope + flow based vertex coloring
 *
 * How to test:
 * 1. Terrain with visible erosion features and blue-tinted water channels
 * 2. Increase Droplets (5000-30000) for more erosion
 * 3. Decrease Brush Radius (1-2) for sharper, narrower channels
 * 4. Increase Brush Radius (3-5) for smoother, wider valleys
 * 5. Increase Erode Speed for deeper cuts
 * 6. Increase Sediment Capacity for longer-distance sediment transport
 * 7. Flow Tint controls how visible the water channel overlay is
 *
 * Reference: Sebastian Lague "Hydraulic Erosion"
 * https://www.youtube.com/watch?v=eaXk97ujbPQ
 * Code: .repos/hydraulic-erosion-lague/Assets/Scripts/Erosion.cs
 */
import { _testFinish, _testStart, BufferAttribute, Color, DirectionalLight2, DoubleSide, GBufferPlugin, Group2, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { createNoise2D, DerivedAttributes, Displace, fbm, PrimGen, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
const params = {
    // Base terrain
    seed: 42,
    size: 60,
    resolution: 200,
    heightScale: 15,
    noiseScale: 0.03,
    octaves: 5,
    // Erosion — tuned for visible channels:
    // Many gentle droplets at high resolution produces channel patterns.
    // Reference values from Lague: erodeSpeed=0.3, depositSpeed=0.3, capacity=4
    // We use lower capacity (shorter transport) and smaller brush for sharper channels.
    droplets: 20000,
    maxSteps: 30,
    brushRadius: 2,
    erodeSpeed: 0.2,
    depositSpeed: 0.2,
    sedimentCapacity: 2,
    inertia: 0.05,
    gravity: 6,
    // Visualization
    flowTint: 0.6,
    waterLevel: 3,
};
function generateTerrain() {
    const root = new Group2();
    root.name = 'Eroded Terrain';
    const segs = Math.max(16, Math.min(256, Math.floor(params.resolution)));
    const verts = segs + 1;
    const geo = PrimGen.grid(params.size, params.size, segs, segs);
    const positions = geo.getAttribute('position');
    const noise = createNoise2D(params.seed);
    const opts = { octaves: params.octaves, scale: params.noiseScale };
    // Base noise displacement
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const h = (fbm(noise, x, z, opts) + 1) * 0.5;
        positions.setY(i, Math.pow(Math.max(0, h), 1.4) * params.heightScale);
    }
    positions.needsUpdate = true;
    // Erosion — capture flow map for visualization
    let flowMap = null;
    let erosionMap = null;
    if (params.droplets > 0) {
        const heightmap = Displace.extractHeightmap(geo, verts, verts);
        const result = Displace.hydraulicErode(heightmap, verts, verts, {
            droplets: Math.floor(params.droplets),
            maxSteps: Math.floor(params.maxSteps),
            brushRadius: Math.floor(params.brushRadius),
            seed: params.seed + 100,
            erodeSpeed: params.erodeSpeed,
            depositSpeed: params.depositSpeed,
            sedimentCapacity: params.sedimentCapacity,
            inertia: params.inertia,
            gravity: params.gravity,
        });
        flowMap = result.flowMap;
        erosionMap = result.erosionMap;
        Displace.applyHeightmap(geo, heightmap);
    }
    geo.computeVertexNormals();
    DerivedAttributes.smoothAttribute(geo, 'normal', 1);
    // Vertex coloring: height + slope + flow map overlay
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
    const deepGreen = new Color(0x1a6b30);
    const grass = new Color(0x3a8c3a);
    const dryGrass = new Color(0x8a9a3a);
    const earth = new Color(0x9a8a60);
    const rock = new Color(0x7a7a72);
    const snow = new Color(0xf5f5f0);
    const cliff = new Color(0x6a6a62);
    const waterBlue = new Color(0x2255aa);
    const erodeRed = new Color(0x553322);
    // Normalize flow map for visualization
    let maxFlow = 0;
    let maxErosion = 0;
    if (flowMap)
        for (let i = 0; i < flowMap.length; i++) {
            if (flowMap[i] > maxFlow)
                maxFlow = flowMap[i];
        }
    if (erosionMap)
        for (let i = 0; i < erosionMap.length; i++) {
            if (erosionMap[i] > maxErosion)
                maxErosion = erosionMap[i];
        }
    for (let i = 0; i < positions.count; i++) {
        const t = (positions.getY(i) - minY) / hRange;
        // Height-based color — vibrant palette
        if (t < 0.15)
            tc.copy(deepGreen).lerp(grass, t / 0.15);
        else if (t < 0.35)
            tc.copy(grass).lerp(dryGrass, (t - 0.15) / 0.2);
        else if (t < 0.55)
            tc.copy(dryGrass).lerp(earth, (t - 0.35) / 0.2);
        else if (t < 0.75)
            tc.copy(earth).lerp(rock, (t - 0.55) / 0.2);
        else
            tc.copy(rock).lerp(snow, (t - 0.75) / 0.25);
        // Slope → cliff
        nv.set(normals.getX(i), normals.getY(i), normals.getZ(i));
        const slope = Math.acos(Math.min(1, Math.max(-1, nv.dot(up)))) * (180 / Math.PI);
        if (slope > 35) {
            tc.lerp(cliff, Math.min(1, (slope - 35) / 35) * 0.6);
        }
        // Flow map overlay — blue tint where water traveled
        if (flowMap && maxFlow > 0) {
            const flow = Math.min(1, flowMap[i] / (maxFlow * 0.3)); // exaggerate low values
            if (flow > 0.01) {
                tc.lerp(waterBlue, flow * params.flowTint);
            }
        }
        // Erosion map overlay — darker where material was removed
        if (erosionMap && maxErosion > 0) {
            const erosion = Math.min(1, erosionMap[i] / (maxErosion * 0.5));
            if (erosion > 0.01) {
                tc.lerp(erodeRed, erosion * 0.3);
            }
        }
        tc.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    const mat = new PhysicalMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    mat.name = 'Eroded Terrain';
    const mesh = new Mesh2(geo, mat);
    mesh.name = 'Terrain Mesh';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (params.waterLevel > minY) {
        const wg = new PlaneGeometry(params.size * 1.2, params.size * 1.2);
        const wm = new PhysicalMaterial({ color: 0x3388aa, roughness: 0.1, transparent: true, opacity: 0.6, side: DoubleSide });
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
        plugins: [PickingPlugin, GBufferPlugin, SSAOPlugin],
    });
    const ssao = viewer.getPlugin(SSAOPlugin);
    if (ssao)
        ssao.pass.intensity = 0.5;
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', { setBackground: true });
    const sun = new DirectionalLight2(0xffeebb, 2.5);
    sun.position.set(40, 60, 30);
    sun.castShadow = true;
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.bias = -0.0005;
    viewer.scene.addObject(sun);
    viewer.scene.addObject(new HemisphereLight2(0x88aacc, 0x554422, 0.4));
    let terrain = generateTerrain();
    viewer.scene.addObject(terrain);
    viewer.scene.mainCamera.position.set(35, 35, 45);
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0);
    viewer.scene.mainCamera.setDirty?.();
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    ui.setupPluginUi(PickingPlugin);
    const regenerate = () => {
        const parent = terrain.parent;
        terrain.dispose?.(true);
        terrain = generateTerrain();
        parent?.add(terrain);
        viewer.setDirty();
    };
    ui.appendChild({
        type: 'folder', label: 'Terrain', expanded: true, onChange: regenerate,
        children: [
            { type: 'slider', label: 'Seed', property: [params, 'seed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Resolution', property: [params, 'resolution'], bounds: [32, 200], stepSize: 1 },
            { type: 'slider', label: 'Height Scale', property: [params, 'heightScale'], bounds: [5, 40], stepSize: 0.5 },
            { type: 'slider', label: 'Noise Scale', property: [params, 'noiseScale'], bounds: [0.005, 0.08], stepSize: 0.001 },
        ],
    });
    ui.appendChild({
        type: 'folder', label: 'Erosion', expanded: true, onChange: regenerate,
        children: [
            { type: 'slider', label: 'Droplets', property: [params, 'droplets'], bounds: [0, 50000], stepSize: 1000 },
            { type: 'slider', label: 'Max Steps', property: [params, 'maxSteps'], bounds: [10, 64], stepSize: 1 },
            { type: 'slider', label: 'Brush Radius', property: [params, 'brushRadius'], bounds: [1, 6], stepSize: 1 },
            { type: 'slider', label: 'Erode Speed', property: [params, 'erodeSpeed'], bounds: [0.05, 0.9], stepSize: 0.05 },
            { type: 'slider', label: 'Deposit Speed', property: [params, 'depositSpeed'], bounds: [0.05, 0.9], stepSize: 0.05 },
            { type: 'slider', label: 'Sediment Capacity', property: [params, 'sedimentCapacity'], bounds: [1, 12], stepSize: 0.5 },
            { type: 'slider', label: 'Inertia', property: [params, 'inertia'], bounds: [0, 0.3], stepSize: 0.01 },
            { type: 'slider', label: 'Gravity', property: [params, 'gravity'], bounds: [1, 10], stepSize: 0.5 },
        ],
    });
    ui.appendChild({
        type: 'folder', label: 'Visualization', expanded: true, onChange: regenerate,
        children: [
            { type: 'slider', label: 'Flow Tint', property: [params, 'flowTint'], bounds: [0, 1], stepSize: 0.05 },
            { type: 'slider', label: 'Water Level', property: [params, 'waterLevel'], bounds: [-15, 10], stepSize: 0.5 },
        ],
    });
}
_testStart();
init().finally(_testFinish);
