/**
 * Pebble Scattering — Browser viewer.
 *
 * Custom viewer that:
 * 1. Loads the ground mesh and pebble assets
 * 2. Extracts the ground mesh BufferGeometry
 * 3. Passes it to the graph runtime via runtime.set()
 * 4. Builds the instanced scene using buildSceneFromInstances
 * 5. Wires up reactive UI via graphUiConfig
 *
 * Uses a custom viewer (not launchGraphViewer) because we need to:
 * - Load ground mesh geometry and pass it to the graph at runtime
 * - Display the ground mesh in the scene
 */
import { _testFinish, _testStart, DirectionalLight2, GBufferPlugin, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { createRuntime, graphUiConfig, graphVisualizerButton, loadAssets, buildSceneFromInstances, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { graphModule, groupInputNode } from './graph';
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
    sun.position.set(5, 8, 5);
    sun.castShadow = true;
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.bias = -0.0005;
    viewer.scene.addObject(sun);
    viewer.scene.addObject(new HemisphereLight2(0x88bbdd, 0x443322, 0.4));
    // Ground plane (visual, larger than the ground mesh)
    const groundPlane = new Mesh2(new PlaneGeometry(20, 20), new PhysicalMaterial({ color: 0x777770, roughness: 0.95 }));
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    viewer.scene.addObject(groundPlane);
    // Load assets
    const basePath = graphModule.assetsPath ?? './assets/';
    const modules = await loadAssets(viewer, graphModule.assets, basePath);
    console.log(`Loaded ${modules.size}/${graphModule.assets.length} assets`);
    // Extract ground mesh BufferGeometry
    let groundGeometry = null;
    const groundData = modules.get('ground.glb');
    if (groundData && groundData.meshes.length > 0) {
        groundGeometry = groundData.meshes[0].geometry;
        console.log('Ground mesh geometry extracted');
    }
    else {
        console.error('Failed to load ground mesh');
    }
    // Also show the ground mesh in the scene
    const groundObj = await viewer.load(basePath + 'ground.glb', { autoCenter: false, autoScale: false });
    if (groundObj) {
        groundObj.traverse((child) => {
            if (child.isMesh) {
                child.receiveShadow = true;
                child.castShadow = false;
            }
        });
        viewer.scene.addObject(groundObj);
    }
    // Create runtime and set ground geometry
    const runtime = createRuntime(graphModule.graphs[0].graph);
    runtime.set(groupInputNode, 'groundGeometry', groundGeometry);
    runtime.evaluate();
    // Build scene from instances
    let instanceRoot = null;
    function rebuild() {
        // Remove old instances — geometry is shared with loaded assets, don't dispose it.
        // Only dispose the InstancedMesh2 wrappers (frees instanceMatrix GPU buffer).
        if (instanceRoot) {
            instanceRoot.removeFromParent();
            instanceRoot.traverse((c) => {
                if (c.isInstancedMesh)
                    c.dispose?.();
            });
        }
        // Re-evaluate
        runtime.evaluate();
        // Get output
        const output = runtime.get(graphModule.graphs[0].outputs[0].node, graphModule.graphs[0].outputs[0].output);
        console.log(`Scatter: ${output.length} instances`);
        // Build scene
        instanceRoot = buildSceneFromInstances(output, modules);
        instanceRoot.name = 'Pebbles';
        viewer.scene.addObject(instanceRoot);
        viewer.setDirty();
    }
    rebuild();
    // Camera
    viewer.scene.mainCamera.position.set(5, 4, 5);
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    ui.appendChild(graphUiConfig(runtime, rebuild, 'Pebble Scatter'));
    ui.appendChild(graphVisualizerButton(graphModule));
    return { viewer, rebuild };
}
main().finally(_testFinish);
