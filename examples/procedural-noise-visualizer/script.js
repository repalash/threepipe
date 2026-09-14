/**
 * Procedural Noise Visualizer Example
 *
 * Displays four noise types side-by-side as displaced colored grids:
 * - Perlin (raw simplex noise) — smooth, organic patterns
 * - FBM (6 octaves) — layered noise with fine detail
 * - Ridged multifractal — sharp mountain ridge patterns
 * - Voronoi (cellular) — cell-based patterns useful for city blocks, stone
 *
 * Also demonstrates how to create custom parameter UIs for any function using
 * uiconfig.js objects and TweakpaneUiPlugin.appendChild(). This pattern can be
 * used for any custom procedural tool, not just the built-in generators.
 *
 * How to test:
 * 1. Four displaced grids should appear in a 2x2 layout
 * 2. Each grid shows a different noise pattern with height displacement
 * 3. Colors range from dark blue (low) to warm yellow (high)
 * 4. Orbit the camera to see the 3D displacement
 * 5. Verify: Perlin is smooth, FBM has fine detail, Ridged has sharp ridges, Voronoi has cells
 * 6. Use the "Noise Params" panel on the right to change seed, frequency, height
 * 7. All four grids update when you change the shared params
 * 8. Click on any grid to select it — shows material/geometry info
 */
import { _testFinish, _testStart, BufferAttribute, Color, DirectionalLight2, HemisphereLight2, Mesh2, PickingPlugin, PhysicalMaterial, ThreeViewer, Vector3, } from 'threepipe';
import { createNoise2D, createVoronoi2D, fbm, PrimGen, ridged } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
// Shared params object — the UI binds directly to this
const params = {
    seed: 42,
    frequency: 0.1,
    heightScale: 3,
    octaves: 6,
    resolution: 64,
};
function generateGridMesh(noiseFn, heightScale, resolution) {
    const size = 20;
    const segs = Math.max(4, Math.min(256, Math.floor(resolution)));
    const geo = PrimGen.grid(size, size, segs, segs);
    const positions = geo.getAttribute('position');
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const y = noiseFn(x, z) * heightScale;
        positions.setY(i, y);
        if (y < minY)
            minY = y;
        if (y > maxY)
            maxY = y;
    }
    positions.needsUpdate = true;
    return { geo, minY, maxY };
}
function applyVertexColors(geo, minY, maxY) {
    const positions = geo.getAttribute('position');
    const colorA = new Color(0x1a3a5c);
    const colorB = new Color(0xffcc44);
    const colors = new Float32Array(positions.count * 3);
    const range = maxY - minY || 1;
    const tempColor = new Color();
    for (let i = 0; i < positions.count; i++) {
        const t = (positions.getY(i) - minY) / range;
        tempColor.copy(colorA).lerp(colorB, t);
        tempColor.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeVertexNormals();
}
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        plugins: [PickingPlugin],
    });
    viewer.scene.setBackgroundColor('#334455');
    const dirLight = new DirectionalLight2(0xffffff, 1.5);
    dirLight.position.set(10, 20, 10);
    viewer.scene.addObject(dirLight);
    const hemiLight = new HemisphereLight2(0x8888ff, 0x443322, 0.6);
    viewer.scene.addObject(hemiLight);
    // Noise type definitions — each has a label, noise function factory, and position
    const noiseTypes = [
        {
            label: 'Perlin (raw)',
            createFn: (seed, freq) => {
                const n = createNoise2D(seed);
                return (x, y) => n(x * freq, y * freq);
            },
            offset: [-15, -15],
        },
        {
            label: 'FBM',
            createFn: (seed, freq) => {
                const n = createNoise2D(seed);
                return (x, y) => fbm(n, x, y, { octaves: params.octaves, scale: freq });
            },
            offset: [15, -15],
        },
        {
            label: 'Ridged',
            createFn: (seed, freq) => {
                const n = createNoise2D(seed);
                return (x, y) => ridged(n, x, y, { octaves: params.octaves, scale: freq });
            },
            offset: [-15, 15],
        },
        {
            label: 'Voronoi',
            createFn: (seed, freq) => {
                const v = createVoronoi2D(seed);
                return (x, y) => 1.0 - v(x * freq * 1.5, y * freq * 1.5).distance;
            },
            offset: [15, 15],
        },
    ];
    // Create initial meshes
    const meshes = [];
    for (const nt of noiseTypes) {
        const noiseFn = nt.createFn(params.seed, params.frequency);
        const { geo, minY, maxY } = generateGridMesh(noiseFn, params.heightScale, params.resolution);
        applyVertexColors(geo, minY, maxY);
        const mat = new PhysicalMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0 });
        mat.name = nt.label + ' Material';
        const mesh = new Mesh2(geo, mat);
        mesh.name = nt.label;
        mesh.position.set(nt.offset[0], 0, nt.offset[1]);
        viewer.scene.addObject(mesh);
        meshes.push(mesh);
    }
    // Rebuild all grids from current params
    function regenerateAll() {
        for (let i = 0; i < noiseTypes.length; i++) {
            const nt = noiseTypes[i];
            const mesh = meshes[i];
            const noiseFn = nt.createFn(params.seed, params.frequency);
            const { geo, minY, maxY } = generateGridMesh(noiseFn, params.heightScale, params.resolution);
            applyVertexColors(geo, minY, maxY);
            // Replace geometry in-place (same Mesh2 object survives)
            const oldGeo = mesh.geometry;
            mesh.geometry = geo;
            oldGeo?.dispose();
            mesh.setDirty?.();
        }
        viewer.setDirty();
    }
    // Camera
    viewer.scene.mainCamera.position.set(0, 40, 50);
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI — demonstrates how to create custom param UIs for any function
    // This pattern works for any custom tool, not just ProceduralGeneratorPlugin
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(PickingPlugin);
    ui.appendChild({
        type: 'folder',
        label: 'Noise Params',
        expanded: true,
        onChange: regenerateAll,
        children: [
            { type: 'slider', label: 'Seed', property: [params, 'seed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Frequency', property: [params, 'frequency'], bounds: [0.01, 0.5], stepSize: 0.01 },
            { type: 'slider', label: 'Height Scale', property: [params, 'heightScale'], bounds: [0.5, 10], stepSize: 0.1 },
            { type: 'slider', label: 'Octaves', property: [params, 'octaves'], bounds: [1, 8], stepSize: 1 },
            { type: 'slider', label: 'Resolution', property: [params, 'resolution'], bounds: [8, 128], stepSize: 1 },
        ],
    });
}
_testStart();
init().finally(_testFinish);
