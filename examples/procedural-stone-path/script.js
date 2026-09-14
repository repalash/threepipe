/**
 * Procedural Stone Path Example
 *
 * A winding stone path through a zen garden. Demonstrates:
 * - Curve-based distribution (stepping stones along a spline)
 * - Lateral offset (lanterns on both sides of the path)
 * - Grid distribution with jitter (pebbles/gravel fill)
 * - Noise-driven density for organic pebble clustering
 * - Multiple object types via instancing
 * - CatmullRomCurve3 for smooth path generation
 *
 * How to test:
 * 1. A winding stone path should appear on a flat sand garden
 * 2. Large stepping stones placed evenly along the path
 * 3. Small lantern-like posts on both sides of the path
 * 4. Pebbles scattered across the ground with organic clustering
 * 5. Change seed for different path shapes and stone arrangements
 * 6. Change stone spacing and lantern spacing independently
 */
import { _testFinish, _testStart, BufferAttribute, CatmullRomCurve3, Color, CurvePath3, CylinderGeometry, DirectionalLight2, Group2, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, SphereGeometry, ThreeViewer, Vector3, } from 'threepipe';
import { createNoise2D, Distribute, fbm, Instance, PrimGen, SeededRandom, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { mergeGeometries } from 'threepipe';
const params = {
    seed: 42,
    stoneSpacing: 2.5,
    lanternSpacing: 6,
    lanternOffset: 2.5,
    pebbleDensity: 2.0,
    pebbleFrequency: 0.08,
    pathCurviness: 8,
    pathLength: 50,
};
/** Create a flat, rounded stepping stone. */
function createSteppingStone(rng) {
    const rx = rng.range(0.5, 0.8);
    const rz = rng.range(0.4, 0.7);
    const h = rng.range(0.1, 0.2);
    const geo = new CylinderGeometry(rx, rz, h, 8);
    geo.scale(1, 1, rz / rx); // slightly elliptical
    // Warm stone vertex colors
    const positions = geo.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const baseColor = new Color().setHSL(rng.range(0.06, 0.1), rng.range(0.15, 0.3), rng.range(0.4, 0.55));
    const varColor = new Color();
    for (let i = 0; i < positions.count; i++) {
        varColor.copy(baseColor);
        varColor.offsetHSL(0, 0, (rng.next() - 0.5) * 0.1);
        varColor.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    const mat = new PhysicalMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    mat.name = 'Stone';
    return { geometry: geo, material: mat };
}
/** Create a small lantern post (cylinder + sphere cap). */
function createLantern(rng) {
    const postH = rng.range(0.6, 1.0);
    const postR = 0.04;
    const post = new CylinderGeometry(postR, postR * 1.3, postH, 5);
    post.translate(0, postH / 2, 0);
    const cap = new SphereGeometry(rng.range(0.08, 0.12), 5, 4);
    cap.translate(0, postH + 0.06, 0);
    const merged = mergeGeometries([post, cap]);
    post.dispose();
    cap.dispose();
    // Dark post with warm glowing cap
    if (merged) {
        const positions = merged.getAttribute('position');
        const colors = new Float32Array(positions.count * 3);
        const postColor = new Color(0x332211);
        const capColor = new Color(0xffcc66);
        for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i);
            const c = y > postH * 0.85 ? capColor : postColor;
            c.toArray(colors, i * 3);
        }
        merged.setAttribute('color', new BufferAttribute(colors, 3));
    }
    const mat = new PhysicalMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
    mat.name = 'Lantern';
    return { geometry: merged, material: mat };
}
/** Create a small pebble. */
function createPebble(rng) {
    const r = rng.range(0.05, 0.15);
    const geo = new SphereGeometry(r, 5, 3);
    geo.scale(1, rng.range(0.4, 0.7), rng.range(0.8, 1.2));
    const colors = new Float32Array(geo.getAttribute('position').count * 3);
    const c = new Color().setHSL(rng.range(0.05, 0.12), rng.range(0.1, 0.3), rng.range(0.3, 0.5));
    for (let i = 0; i < colors.length; i += 3) {
        c.toArray(colors, i);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    const mat = new PhysicalMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    mat.name = 'Pebble';
    return { geometry: geo, material: mat };
}
/** Generate a winding path curve from a seed. */
function generatePathCurve(seed, curviness, length) {
    const rng = new SeededRandom(seed);
    const points = [];
    const numPoints = 8;
    const segLen = length / numPoints;
    let x = -length / 2, z = 0;
    for (let i = 0; i <= numPoints; i++) {
        const wander = i === 0 || i === numPoints ? 0 : (rng.next() - 0.5) * curviness;
        points.push(new Vector3(x, 0, z + wander));
        x += segLen;
    }
    return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}
function generateGarden(viewer) {
    const root = new Group2();
    root.name = 'Stone Path Garden';
    const rng = new SeededRandom(params.seed);
    // Sand ground
    const groundSize = params.pathLength * 1.2;
    const groundGeo = PrimGen.grid(groundSize, groundSize * 0.6, 40, 25);
    const gPositions = groundGeo.getAttribute('position');
    // Gentle sand ripples
    const sandNoise = createNoise2D(params.seed + 50);
    for (let i = 0; i < gPositions.count; i++) {
        const x = gPositions.getX(i);
        const z = gPositions.getZ(i);
        gPositions.setY(i, fbm(sandNoise, x, z, { octaves: 2, scale: 0.05 }) * 0.3);
    }
    gPositions.needsUpdate = true;
    // Sand vertex colors with raked-pattern variation
    const gColors = new Float32Array(gPositions.count * 3);
    const sandA = new Color(0xd4c4a0);
    const sandB = new Color(0xc9b88a);
    const tempColor = new Color();
    for (let i = 0; i < gPositions.count; i++) {
        const x = gPositions.getX(i);
        const z = gPositions.getZ(i);
        const stripe = Math.sin(z * 3 + fbm(sandNoise, x + 200, z + 200, { octaves: 1, scale: 0.1 }) * 2) * 0.5 + 0.5;
        tempColor.copy(sandA).lerp(sandB, stripe);
        tempColor.toArray(gColors, i * 3);
    }
    groundGeo.setAttribute('color', new BufferAttribute(gColors, 3));
    groundGeo.computeVertexNormals();
    const groundMat = new PhysicalMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    groundMat.name = 'Sand';
    const groundMesh = new Mesh2(groundGeo, groundMat);
    groundMesh.name = 'Ground';
    groundMesh.receiveShadow = true;
    root.add(groundMesh);
    // Generate winding path curve
    const pathCurve = generatePathCurve(params.seed, params.pathCurviness, params.pathLength);
    // Wrap in CurvePath3 for Distribute.alongCurve
    const curvePath = new CurvePath3();
    curvePath.add(pathCurve);
    // Stepping stones along the path
    const stoneSources = [];
    for (let i = 0; i < 3; i++) {
        stoneSources.push({ ...createSteppingStone(rng), weight: 1 });
    }
    const stoneCloud = Distribute.alongCurve(curvePath, {
        spacing: params.stoneSpacing,
    });
    if (stoneCloud.length > 0) {
        const stones = Instance.pickFromCollection(stoneCloud, stoneSources, {
            randomRotationY: true,
            scaleRange: [0.8, 1.2],
            seed: params.seed + 10,
        });
        stones.name = 'Stepping Stones';
        stones.traverse((c) => { if (c.isInstancedMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
        } });
        root.add(stones);
    }
    // Lanterns on both sides of the path
    const lanternSources = [
        { ...createLantern(rng), weight: 1 },
    ];
    const lanternCloud = Distribute.alongCurve(curvePath, {
        spacing: params.lanternSpacing,
        offset: params.lanternOffset,
        side: 'both',
    });
    if (lanternCloud.length > 0) {
        const lanterns = Instance.pickFromCollection(lanternCloud, lanternSources, {
            scaleRange: [0.8, 1.1],
            seed: params.seed + 20,
        });
        lanterns.name = 'Lanterns';
        lanterns.traverse((c) => { if (c.isInstancedMesh)
            c.castShadow = true; });
        root.add(lanterns);
    }
    // Pebbles scattered across the ground
    const pebbleSources = [];
    for (let i = 0; i < 3; i++) {
        pebbleSources.push({ ...createPebble(rng), weight: 1 });
    }
    const pebbleNoise = createNoise2D(params.seed + 200);
    const pebbleCloud = Distribute.onGrid(groundSize, groundSize * 0.6, 1.0 / Math.sqrt(params.pebbleDensity), 1.0 / Math.sqrt(params.pebbleDensity), {
        jitter: 0.5,
        seed: params.seed + 30,
        mask: (x, z) => {
            // Noise-driven clustering
            const n = fbm(pebbleNoise, x, z, { octaves: 2, scale: params.pebbleFrequency });
            return n > 0.1;
        },
    });
    if (pebbleCloud.length > 0) {
        const pebbles = Instance.pickFromCollection(pebbleCloud, pebbleSources, {
            randomRotationY: true,
            scaleRange: [0.5, 1.5],
            seed: params.seed + 40,
        });
        pebbles.name = 'Pebbles';
        root.add(pebbles);
    }
    return root;
}
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        plugins: [PickingPlugin],
    });
    // HDR environment for soft natural lighting
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    });
    // Warm directional light for shadows
    const sunLight = new DirectionalLight2(0xfff5e0, 1.8);
    sunLight.position.set(20, 30, 15);
    sunLight.castShadow = true;
    sunLight.shadow.camera.left = -35;
    sunLight.shadow.camera.right = 35;
    sunLight.shadow.camera.top = 20;
    sunLight.shadow.camera.bottom = -20;
    sunLight.shadow.mapSize.setScalar(2048);
    viewer.scene.addObject(sunLight);
    const skyLight = new HemisphereLight2(0xbbccdd, 0x998866, 0.4);
    viewer.scene.addObject(skyLight);
    let garden = generateGarden(viewer);
    viewer.scene.addObject(garden);
    viewer.scene.mainCamera.position.set(5, 15, 20);
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0);
    viewer.scene.mainCamera.setDirty?.();
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(PickingPlugin);
    const regenerate = () => {
        const parent = garden.parent;
        garden.dispose?.(true);
        garden = generateGarden(viewer);
        parent?.add(garden);
        viewer.setDirty();
    };
    ui.appendChild({
        type: 'folder',
        label: 'Garden Params',
        expanded: true,
        onChange: regenerate,
        children: [
            { type: 'slider', label: 'Seed', property: [params, 'seed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Stone Spacing', property: [params, 'stoneSpacing'], bounds: [1, 6], stepSize: 0.1 },
            { type: 'slider', label: 'Lantern Spacing', property: [params, 'lanternSpacing'], bounds: [3, 15], stepSize: 0.5 },
            { type: 'slider', label: 'Lantern Offset', property: [params, 'lanternOffset'], bounds: [1, 5], stepSize: 0.1 },
            { type: 'slider', label: 'Pebble Density', property: [params, 'pebbleDensity'], bounds: [0.1, 5], stepSize: 0.1 },
            { type: 'slider', label: 'Path Curviness', property: [params, 'pathCurviness'], bounds: [0, 15], stepSize: 0.5 },
        ],
    });
}
_testStart();
init().finally(_testFinish);
