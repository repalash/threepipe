/**
 * Procedural Asteroid Field Example
 *
 * A dense cloud of rocky asteroids floating in space with varying sizes,
 * irregular shapes, and subtle color variation. Demonstrates:
 * - Poisson disk distribution on a sphere surface for even spacing
 * - Multiple asteroid LODs instanced via pickFromCollection
 * - Procedural rock geometry (displaced icosahedron)
 * - Vertex coloring for material variation (dark rock with lighter patches)
 * - Dramatic space lighting
 *
 * How to test:
 * 1. A field of ~500 asteroids should appear against a dark background
 * 2. Asteroids vary in size, shape, and color
 * 3. No two asteroids overlap (Poisson disk spacing)
 * 4. Use params to change density, seed, size range
 * 5. Orbit camera to see depth of the field
 */
import { _testFinish, _testStart, BufferAttribute, Color, DirectionalLight2, Group2, HemisphereLight2, IcosahedronGeometry, PhysicalMaterial, PickingPlugin, SphereGeometry, ThreeViewer, Vector3, } from 'threepipe';
import { createNoise3D, Distribute, Instance, SeededRandom, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
const params = {
    seed: 77,
    count: 500,
    fieldRadius: 40,
    minDistance: 3,
    scaleMin: 0.3,
    scaleMax: 2.5,
    roughness: 0.6,
};
/**
 * Create a procedural rock geometry by displacing an icosahedron's vertices with 3D noise.
 * Each rock is unique based on its seed.
 */
function createRockGeometry(seed, detail) {
    const geo = new IcosahedronGeometry(1, detail);
    const positions = geo.getAttribute('position');
    const noise = createNoise3D(seed);
    const rng = new SeededRandom(seed);
    // Displace vertices with noise for irregular rocky shape
    const noiseScale = rng.range(1.5, 3.0);
    const noiseAmp = rng.range(0.15, 0.35);
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const displacement = 1.0 + noise(x * noiseScale, y * noiseScale, z * noiseScale) * noiseAmp;
        positions.setXYZ(i, x * displacement, y * displacement, z * displacement);
    }
    positions.needsUpdate = true;
    // Vertex colors — dark gray with lighter patches
    const colors = new Float32Array(positions.count * 3);
    const baseColor = new Color().setHSL(0, 0, rng.range(0.12, 0.22));
    const patchColor = new Color().setHSL(rng.range(0.05, 0.12), rng.range(0.1, 0.3), rng.range(0.25, 0.4));
    const tempColor = new Color();
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const patchNoise = (noise(x * 2.5 + 100, y * 2.5 + 100, z * 2.5 + 100) + 1) * 0.5;
        tempColor.copy(baseColor).lerp(patchColor, patchNoise * 0.5);
        tempColor.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
}
function generateField(viewer) {
    const root = new Group2();
    root.name = 'Asteroid Field';
    const rng = new SeededRandom(params.seed);
    // Create several rock variants at different detail levels
    const sources = [];
    for (let i = 0; i < 5; i++) {
        const detail = i < 2 ? 2 : 1; // first 2 are higher detail
        const geo = createRockGeometry(rng.int(0, 99999), detail);
        const mat = new PhysicalMaterial({
            vertexColors: true,
            roughness: rng.range(0.5, 0.9),
            metalness: rng.range(0.05, 0.3),
        });
        mat.name = `Rock Material ${i}`;
        sources.push({ geometry: geo, material: mat, weight: 1 });
    }
    // Distribute points on an invisible sphere surface
    const sphereGeo = new SphereGeometry(params.fieldRadius, 32, 32);
    // Use onFaces with the sphere geometry for distribution
    const cloud = Distribute.onFaces(sphereGeo, {
        method: 'poisson',
        count: params.count,
        minDistance: params.minDistance,
        seed: params.seed,
    });
    sphereGeo.dispose();
    // Also add points inside the sphere (not just on surface) by scaling positions
    for (const pt of cloud) {
        const r = rng.range(0.3, 1.0); // random radius factor
        pt.position.multiplyScalar(r);
        // Random orientation (asteroids tumble)
        pt.normal.set(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5).normalize();
    }
    const instances = Instance.pickFromCollection(cloud, sources, {
        alignToNormal: true,
        randomRotationY: true,
        scaleRange: [params.scaleMin, params.scaleMax],
        seed: params.seed + 1,
    });
    instances.name = 'Asteroids';
    // Enable shadow on each instanced mesh
    instances.traverse((child) => {
        if (child.isInstancedMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    root.add(instances);
    return root;
}
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        plugins: [PickingPlugin],
    });
    // Dark space with subtle HDR environment for rock reflections
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr');
    viewer.scene.setBackgroundColor('#050510');
    if (viewer.scene.environment)
        viewer.scene.environmentIntensity = 0.15;
    // Key light — strong single directional for dramatic shadows
    const keyLight = new DirectionalLight2(0xffeedd, 3.0);
    keyLight.position.set(30, 20, 40);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.setScalar(2048);
    viewer.scene.addObject(keyLight);
    // Blue rim light for depth
    const rimLight = new DirectionalLight2(0x3344aa, 0.8);
    rimLight.position.set(-20, -10, -30);
    viewer.scene.addObject(rimLight);
    const ambient = new HemisphereLight2(0x0a0a15, 0x000000, 0.2);
    viewer.scene.addObject(ambient);
    let field = generateField(viewer);
    viewer.scene.addObject(field);
    // Camera
    viewer.scene.mainCamera.position.set(30, 20, 45);
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(PickingPlugin);
    const regenerate = () => {
        const parent = field.parent;
        field.dispose?.(true);
        field = generateField(viewer);
        parent?.add(field);
        viewer.setDirty();
    };
    ui.appendChild({
        type: 'folder',
        label: 'Asteroid Field',
        expanded: true,
        onChange: regenerate,
        children: [
            { type: 'slider', label: 'Seed', property: [params, 'seed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Count', property: [params, 'count'], bounds: [50, 2000], stepSize: 10 },
            { type: 'slider', label: 'Field Radius', property: [params, 'fieldRadius'], bounds: [10, 80], stepSize: 1 },
            { type: 'slider', label: 'Min Distance', property: [params, 'minDistance'], bounds: [1, 10], stepSize: 0.5 },
            { type: 'slider', label: 'Scale Min', property: [params, 'scaleMin'], bounds: [0.1, 2], stepSize: 0.05 },
            { type: 'slider', label: 'Scale Max', property: [params, 'scaleMax'], bounds: [0.5, 5], stepSize: 0.1 },
            { type: 'slider', label: 'Roughness', property: [params, 'roughness'], bounds: [0, 1], stepSize: 0.05 },
        ],
    });
}
_testStart();
init().finally(_testFinish);
