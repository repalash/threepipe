/**
 * Procedural Flower Meadow Example
 *
 * A gentle rolling hillside covered in clusters of colorful wildflowers.
 * Inspired by Studio Ghibli landscapes. Demonstrates:
 * - Terrain with gentle noise displacement
 * - Grid-based distribution with jitter for natural flower coverage
 * - Noise-driven density field for organic clustering (flowers grow in patches)
 * - Multiple flower species via pickFromCollection (poppies, daisies, lavender)
 * - Random Y-rotation and scale for natural variation
 * - Warm golden-hour lighting
 *
 * How to test:
 * 1. A green hillside with scattered flowers should appear
 * 2. Flowers cluster in organic patches (not uniform grid)
 * 3. Multiple flower colors: red poppies, white daisies, purple lavender, yellow buttercups
 * 4. No flowers on steep slopes
 * 5. Change seed to get different flower arrangements
 * 6. Change density to add/remove flowers
 * 7. Frequency controls patch size (lower = larger patches)
 */
import { _testFinish, _testStart, BufferAttribute, Color, ConeGeometry, CylinderGeometry, DirectionalLight2, Group2, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, SphereGeometry, ThreeViewer, Vector3, } from 'threepipe';
import { createNoise2D, Distribute, fbm, Instance, PrimGen, SeededRandom, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { mergeGeometries } from 'threepipe';
const params = {
    seed: 42,
    density: 1.5,
    frequency: 0.06,
    patchThreshold: 0.15,
    scaleMin: 0.5,
    scaleMax: 1.2,
    terrainSize: 80,
    terrainHeight: 4,
};
/** Create a simple flower: thin stem + colored cap. */
function createFlower(capColor, capShape, rng) {
    const stemH = rng.range(0.3, 0.6);
    const stemR = 0.02;
    const stem = new CylinderGeometry(stemR, stemR, stemH, 4);
    stem.translate(0, stemH / 2, 0);
    let cap;
    if (capShape === 'sphere') {
        cap = new SphereGeometry(rng.range(0.08, 0.14), 6, 4);
        cap.translate(0, stemH + 0.05, 0);
    }
    else if (capShape === 'cone') {
        cap = new ConeGeometry(rng.range(0.06, 0.12), rng.range(0.1, 0.2), 5);
        cap.translate(0, stemH + 0.08, 0);
    }
    else {
        // Flat disc (daisy-like)
        cap = new CylinderGeometry(rng.range(0.1, 0.16), rng.range(0.1, 0.16), 0.02, 7);
        cap.translate(0, stemH + 0.01, 0);
    }
    const merged = mergeGeometries([stem, cap]);
    stem.dispose();
    cap.dispose();
    // Vertex color: stem is green, cap gets the flower color
    if (merged) {
        const positions = merged.getAttribute('position');
        const colors = new Float32Array(positions.count * 3);
        const stemColor = new Color(0x2d5e1e);
        for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i);
            const c = y > stemH * 0.8 ? capColor : stemColor;
            c.toArray(colors, i * 3);
        }
        merged.setAttribute('color', new BufferAttribute(colors, 3));
    }
    const material = new PhysicalMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0,
    });
    material.name = 'Flower';
    return { geometry: merged, material };
}
function generateMeadow(viewer) {
    const root = new Group2();
    root.name = 'Flower Meadow';
    const rng = new SeededRandom(params.seed);
    // Gentle terrain
    const geo = PrimGen.grid(params.terrainSize, params.terrainSize, 100, 100);
    const positions = geo.getAttribute('position');
    const noise = createNoise2D(params.seed);
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const y = fbm(noise, x, z, { octaves: 4, scale: 0.015 }) * params.terrainHeight;
        positions.setY(i, y);
    }
    positions.needsUpdate = true;
    // Green terrain vertex colors with subtle variation
    const colors = new Float32Array(positions.count * 3);
    const grassA = new Color(0x3a7d2c);
    const grassB = new Color(0x5a9e3a);
    const tempColor = new Color();
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const t = (fbm(noise, x + 500, z + 500, { octaves: 2, scale: 0.04 }) + 1) * 0.5;
        tempColor.copy(grassA).lerp(grassB, t);
        tempColor.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrainMat = new PhysicalMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.02 });
    terrainMat.name = 'Grass';
    const terrainMesh = new Mesh2(geo, terrainMat);
    terrainMesh.name = 'Ground';
    terrainMesh.receiveShadow = true;
    root.add(terrainMesh);
    // Flower species
    const flowerSources = [
        { ...createFlower(new Color(0xdd2222), 'sphere', rng), weight: 2 }, // red poppy
        { ...createFlower(new Color(0xeeeeee), 'flat', rng), weight: 2 }, // white daisy
        { ...createFlower(new Color(0x7733aa), 'cone', rng), weight: 1.5 }, // purple lavender
        { ...createFlower(new Color(0xeecc22), 'sphere', rng), weight: 1.5 }, // yellow buttercup
        { ...createFlower(new Color(0xff7799), 'flat', rng), weight: 1 }, // pink cosmos
    ];
    // Distribute flowers on the terrain using the terrain geometry
    const flowerNoise = createNoise2D(params.seed + 100);
    const cloud = Distribute.onFaces(geo, {
        method: 'random',
        density: params.density,
        seed: params.seed,
        // Noise-driven density field creates organic clustering
        densityField: (pos) => {
            const n = fbm(flowerNoise, pos.x, pos.z, { octaves: 3, scale: params.frequency });
            // Only place flowers where noise > threshold (creates patches)
            return n > params.patchThreshold ? 1 : 0;
        },
    });
    // Filter out steep slopes (flowers don't grow on cliffs)
    const up = new Vector3(0, 1, 0);
    const filtered = Distribute.filter(cloud, (pt) => {
        const dot = Math.min(1, Math.max(-1, pt.normal.dot(up)));
        const slope = Math.acos(dot) * (180 / Math.PI);
        return slope < 25;
    });
    if (filtered.length > 0) {
        const flowers = Instance.pickFromCollection(filtered, flowerSources, {
            alignToNormal: false, // flowers grow upward
            randomRotationY: true,
            scaleRange: [params.scaleMin, params.scaleMax],
            seed: params.seed + 2,
        });
        flowers.name = 'Flowers';
        flowers.traverse((child) => {
            if (child.isInstancedMesh)
                child.castShadow = true;
        });
        root.add(flowers);
    }
    return root;
}
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        plugins: [PickingPlugin],
    });
    // HDR sky for natural lighting
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    });
    // Golden hour sun
    const sunLight = new DirectionalLight2(0xffeebb, 2.0);
    sunLight.position.set(30, 40, 20);
    sunLight.castShadow = true;
    sunLight.shadow.camera.left = -50;
    sunLight.shadow.camera.right = 50;
    sunLight.shadow.camera.top = 50;
    sunLight.shadow.camera.bottom = -50;
    sunLight.shadow.mapSize.setScalar(2048);
    viewer.scene.addObject(sunLight);
    const skyLight = new HemisphereLight2(0x88bbdd, 0x445522, 0.5);
    viewer.scene.addObject(skyLight);
    let meadow = generateMeadow(viewer);
    viewer.scene.addObject(meadow);
    // Camera — slightly above, looking across the meadow
    viewer.scene.mainCamera.position.set(15, 12, 25);
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0);
    viewer.scene.mainCamera.setDirty?.();
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(PickingPlugin);
    const regenerate = () => {
        const parent = meadow.parent;
        meadow.dispose?.(true);
        meadow = generateMeadow(viewer);
        parent?.add(meadow);
        viewer.setDirty();
    };
    ui.appendChild({
        type: 'folder',
        label: 'Meadow Params',
        expanded: true,
        onChange: regenerate,
        children: [
            { type: 'slider', label: 'Seed', property: [params, 'seed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Flower Density', property: [params, 'density'], bounds: [0.1, 5], stepSize: 0.1 },
            { type: 'slider', label: 'Patch Frequency', property: [params, 'frequency'], bounds: [0.01, 0.2], stepSize: 0.005 },
            { type: 'slider', label: 'Patch Threshold', property: [params, 'patchThreshold'], bounds: [-0.5, 0.8], stepSize: 0.05 },
            { type: 'slider', label: 'Scale Min', property: [params, 'scaleMin'], bounds: [0.2, 1.5], stepSize: 0.05 },
            { type: 'slider', label: 'Scale Max', property: [params, 'scaleMax'], bounds: [0.5, 2.5], stepSize: 0.05 },
            { type: 'slider', label: 'Terrain Height', property: [params, 'terrainHeight'], bounds: [0, 15], stepSize: 0.5 },
        ],
    });
}
_testStart();
init().finally(_testFinish);
