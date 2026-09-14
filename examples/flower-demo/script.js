/**
 * Flower Demo — Procedural rose with bloom animation.
 *
 * Uses the graph-based flower generator (graph.ts) with full animation support.
 * The Bloom slider controls the flower state from bud (0) to full bloom (1).
 * Play button auto-animates the bloom over time.
 *
 * All modifier parameters are exposed as UI sliders with reactive recompute:
 * changing any parameter rebuilds only affected graph nodes.
 */
import { _testFinish, _testStart, BufferGeometry, DirectionalLight2, DoubleSide, Float32BufferAttribute, GBufferPlugin, Group2, HemisphereLight2, Mesh2, MeshStandardMaterial, PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { createRuntime, graphUiConfig, graphVisualizerButton } from '@threepipe/plugin-procedural-generation';
import { graphModule, gi, flower } from './graph';
// ─── Scene builder from vertex data ─────────────────────────────────
function buildFlowerScene(rt, mat) {
    const root = new Group2();
    root.name = 'Flower';
    // Get raw vertex data from graph
    const vertices = rt.get(flower, 'vertices');
    const iterations = rt.get(gi, 'iterations');
    const petalsPerRing = rt.get(gi, 'petalsPerRing');
    const nx = rt.get(gi, 'verticesX');
    const ny = rt.get(gi, 'verticesY');
    const N = nx * ny;
    // Reconstruct mesh per ring per petal
    // Vertices are ordered: ring 0 petal 0 all verts, ring 0 petal 1 all verts, ...
    let vi = 0;
    for (let ring = 0; ring < iterations; ring++) {
        for (let petal = 0; petal < petalsPerRing; petal++) {
            const geo = new BufferGeometry();
            const positions = new Float32Array(N * 3);
            for (let i = 0; i < N; i++) {
                const v = vertices[vi + i];
                positions[i * 3] = v[0];
                positions[i * 3 + 1] = v[1];
                positions[i * 3 + 2] = v[2];
            }
            geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
            const indices = [];
            for (let ix = 0; ix < nx - 1; ix++) {
                for (let iy = 0; iy < ny - 1; iy++) {
                    const a = ix * ny + iy, b = (ix + 1) * ny + iy;
                    const c = (ix + 1) * ny + (iy + 1), d = ix * ny + (iy + 1);
                    indices.push(a, b, d, b, c, d);
                }
            }
            geo.setIndex(indices);
            geo.computeVertexNormals();
            const mesh = new Mesh2(geo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            root.add(mesh);
            vi += N;
        }
    }
    // Blender Z-up -> three.js Y-up
    root.rotation.x = -Math.PI / 2;
    return root;
}
// ─── Init ───────────────────────────────────────────────────────────
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true, rgbm: false,
        plugins: [PickingPlugin, GBufferPlugin, SSAOPlugin],
    });
    const ssao = viewer.getPlugin(SSAOPlugin);
    if (ssao?.pass)
        ssao.pass.intensity = 0.5;
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', { setBackground: true });
    // Lights
    const sun = new DirectionalLight2(0xffeebb, 3);
    sun.position.set(5, 8, 5);
    sun.castShadow = true;
    sun.shadow.camera.left = -2;
    sun.shadow.camera.right = 2;
    sun.shadow.camera.top = 2;
    sun.shadow.camera.bottom = -2;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.bias = -0.0005;
    viewer.scene.addObject(sun);
    viewer.scene.addObject(new HemisphereLight2(0xddeeff, 0x332211, 0.6));
    // Ground
    const ground = new Mesh2(new PlaneGeometry(4, 4), new PhysicalMaterial({ color: 0x555550, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    viewer.scene.addObject(ground);
    // Material
    const mat = new MeshStandardMaterial({
        color: 0xcc3355,
        roughness: 0.6,
        side: DoubleSide,
    });
    // Create graph runtime
    const rt = createRuntime(graphModule.graphs[0].graph);
    rt.evaluate();
    // Build initial scene
    let flowerRoot = null;
    function rebuild() {
        // Dispose old
        if (flowerRoot) {
            flowerRoot.traverse((c) => { c.geometry?.dispose?.(); });
            flowerRoot.removeFromParent();
        }
        rt.evaluate();
        flowerRoot = buildFlowerScene(rt, mat);
        flowerRoot.position.y = 0.6;
        viewer.scene.addObject(flowerRoot);
        viewer.setDirty();
    }
    rebuild();
    // Camera
    viewer.scene.mainCamera.position.set(0.8, 1.2, 0.8);
    viewer.scene.mainCamera.target = new Vector3(0, 0.5, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI — graph parameters auto-generated
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.appendChild(graphUiConfig(rt, rebuild, 'Flower'));
    // Animation controls
    let playing = false;
    let animTime = 0;
    const animDuration = 3; // seconds for full bloom animation
    function animate() {
        if (!playing)
            return;
        animTime += 1 / 60; // approximate 60fps
        const bloom = Math.min(1, animTime / animDuration);
        rt.set(gi, 'bloom', bloom);
        rebuild();
        if (bloom >= 1) {
            playing = false;
            animTime = 0;
        }
        else {
            requestAnimationFrame(animate);
        }
    }
    ui.appendChild(graphVisualizerButton(graphModule));
    ui.appendChild({
        type: 'button',
        label: 'Play Bloom Animation',
        onChange: () => {
            if (playing)
                return;
            playing = true;
            animTime = 0;
            rt.set(gi, 'bloom', 0);
            rebuild();
            requestAnimationFrame(animate);
        },
    });
    ui.appendChild({
        type: 'button',
        label: 'Reset to Bud',
        onChange: () => {
            playing = false;
            animTime = 0;
            rt.set(gi, 'bloom', 0);
            rebuild();
        },
    });
    ui.appendChild({
        type: 'button',
        label: 'Full Bloom',
        onChange: () => {
            playing = false;
            rt.set(gi, 'bloom', 1);
            rebuild();
        },
    });
}
_testStart();
init().finally(_testFinish);
