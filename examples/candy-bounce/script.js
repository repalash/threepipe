/**
 * Candy Bounce — Browser viewer with auto-animation.
 *
 * Loads all assets, builds the scene from 3 graphs (well, jumpers, floor),
 * and runs an animation loop that increments the frame counter.
 *
 * Static instances (well) are built once.
 * Dynamic instances (jumpers + floor) are rebuilt every frame.
 */
import { _testFinish, _testStart, DirectionalLight2, GBufferPlugin, HemisphereLight2, PickingPlugin, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { createRuntime, graphUiConfig, graphVisualizerButton, loadAssets, buildSceneFromInstances, getWorldGeometry, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { graphModule, jumperGroupInput, floorGroupInput, } from './graph';
_testStart();
async function main() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true, rgbm: false,
        assetManager: { simpleCache: false, storage: false },
        plugins: [PickingPlugin, GBufferPlugin, SSAOPlugin],
    });
    const ssao = viewer.getPlugin(SSAOPlugin);
    if (ssao?.pass)
        ssao.pass.intensity = 0.5;
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', { setBackground: true });
    // Lights
    const sun = new DirectionalLight2(0xffeebb, 2.5);
    sun.position.set(3, 5, 3);
    sun.castShadow = true;
    sun.shadow.camera.left = -3;
    sun.shadow.camera.right = 3;
    sun.shadow.camera.top = 3;
    sun.shadow.camera.bottom = -3;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.bias = -0.0005;
    viewer.scene.addObject(sun);
    viewer.scene.addObject(new HemisphereLight2(0x88bbdd, 0x443322, 0.4));
    // Load assets
    const basePath = graphModule.assetsPath ?? './assets/';
    const modules = await loadAssets(viewer, graphModule.assets, basePath);
    console.log(`Loaded ${modules.size}/${graphModule.assets.length} assets`);
    // Extract spawn surface geometry for jumpers
    const spawnGeometry = getWorldGeometry(modules, 'object_jumpers_spawn_surface.glb');
    if (!spawnGeometry) {
        console.error('Failed to load jumpers_spawn_surface geometry');
    }
    // Create runtimes
    const wellRuntime = createRuntime(graphModule.graphs[0].graph);
    const jumperRuntime = createRuntime(graphModule.graphs[1].graph);
    const floorRuntime = createRuntime(graphModule.graphs[2].graph);
    // Set initial jumper inputs
    jumperRuntime.set(jumperGroupInput, 'spawnGeometry', spawnGeometry);
    // Build well (static — done once)
    wellRuntime.evaluate();
    const wellInstances = wellRuntime.get(graphModule.graphs[0].outputs[0].node, graphModule.graphs[0].outputs[0].output);
    const wellRoot = buildSceneFromInstances(wellInstances, modules);
    wellRoot.name = 'Well';
    viewer.scene.addObject(wellRoot);
    console.log(`Well: ${wellInstances.length} instances`);
    // Dynamic scene roots
    let jumperRoot = null;
    let floorRoot = null;
    let isAnimating = true;
    function rebuildDynamic() {
        jumperRuntime.evaluate();
        const jumperInstances = jumperRuntime.get(graphModule.graphs[1].outputs[0].node, graphModule.graphs[1].outputs[0].output);
        // Extract jumper positions for floor proximity
        const jumperPositions = jumperInstances.map(inst => {
            const m = inst.world_matrix;
            return [m[12], m[13], m[14]];
        });
        // Set floor input
        floorRuntime.set(floorGroupInput, 'jumperPositions', jumperPositions);
        floorRuntime.evaluate();
        const floorInstances = floorRuntime.get(graphModule.graphs[2].outputs[0].node, graphModule.graphs[2].outputs[0].output);
        // Rebuild jumper scene
        if (jumperRoot) {
            jumperRoot.removeFromParent();
            jumperRoot.traverse((c) => {
                if (c.isInstancedMesh)
                    c.dispose?.();
            });
        }
        jumperRoot = buildSceneFromInstances(jumperInstances, modules);
        jumperRoot.name = 'Jumpers';
        viewer.scene.addObject(jumperRoot);
        // Rebuild floor scene
        if (floorRoot) {
            floorRoot.removeFromParent();
            floorRoot.traverse((c) => {
                if (c.isInstancedMesh)
                    c.dispose?.();
            });
        }
        floorRoot = buildSceneFromInstances(floorInstances, modules);
        floorRoot.name = 'Floor';
        viewer.scene.addObject(floorRoot);
        viewer.setDirty();
    }
    // Initial build
    rebuildDynamic();
    // Animation loop — increment the runtime's frame input directly
    function animate() {
        if (!isAnimating)
            return;
        const currentFrame = jumperRuntime.get(jumperGroupInput, 'frame');
        jumperRuntime.set(jumperGroupInput, 'frame', currentFrame + 1);
        rebuildDynamic();
        requestAnimationFrame(animate);
    }
    // Start animation
    requestAnimationFrame(animate);
    // Camera
    viewer.scene.mainCamera.position.set(2.5, 2, 2.5);
    viewer.scene.mainCamera.target = new Vector3(0, -0.1, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    // Jumper UI controls
    const jumperUi = graphUiConfig(jumperRuntime, () => {
        // On manual parameter change, rebuild with current frame
        rebuildDynamic();
    }, 'Jumpers');
    ui.appendChild(jumperUi);
    ui.appendChild(graphVisualizerButton(graphModule));
    // Space to toggle animation
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            isAnimating = !isAnimating;
            if (isAnimating)
                requestAnimationFrame(animate);
            console.log(isAnimating ? 'Playing' : 'Paused');
        }
    });
    return { viewer, rebuildDynamic };
}
main().finally(_testFinish);
