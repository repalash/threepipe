/**
 * Flower Scatter V4 — Browser viewer.
 *
 * Custom viewer that:
 * 1. Loads ground mesh, grass assets, flower assets, and textures
 * 2. Extracts ground mesh BufferGeometry and texture data
 * 3. Passes geometry + textures to the graph runtime via runtime.set()
 * 4. Builds the instanced scene using buildSceneFromInstances
 * 5. Wires up reactive UI via graphUiConfig
 *
 * Uses a custom viewer (not launchGraphViewer) because we need to:
 * - Load ground mesh geometry and pass it to the graph at runtime
 * - Load image textures and pass them as ImageTextureData
 * - Display the ground mesh in the scene
 */
import { _testFinish, _testStart, DirectionalLight2, GBufferPlugin, HemisphereLight2, Mesh2, PhysicalMaterial, PlaneGeometry, PickingPlugin, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { createRuntime, graphUiConfig, graphVisualizerButton, loadAssets, getWorldGeometry, buildSceneFromInstances, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { graphModule, groupInputNode } from './graph';
_testStart();
/**
 * Load an image as ImageTextureData for sampleImageTexture.
 */
async function loadImageTexture(url) {
    try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        return {
            data: imageData.data,
            width: img.width,
            height: img.height,
            channels: 4,
        };
    }
    catch (e) {
        console.warn('Failed to load texture:', url, e);
        return null;
    }
}
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
    // Ground plane (visual backing)
    const groundPlane = new Mesh2(new PlaneGeometry(20, 20), new PhysicalMaterial({ color: 0x4a7a3a, roughness: 0.95 }));
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = -0.01;
    groundPlane.receiveShadow = true;
    viewer.scene.addObject(groundPlane);
    // Load assets
    const basePath = graphModule.assetsPath ?? './assets/';
    const modules = await loadAssets(viewer, graphModule.assets, basePath);
    console.log(`Loaded ${modules.size}/${graphModule.assets.length} assets`);
    // Load textures
    const [densityMap, bluebellMask] = await Promise.all([
        loadImageTexture(basePath + 'texture_flowers-density_map.png'),
        loadImageTexture(basePath + 'texture_bluebell-mask.png'),
    ]);
    console.log(`Textures: densityMap=${densityMap ? `${densityMap.width}x${densityMap.height}` : 'null'}, bluebellMask=${bluebellMask ? `${bluebellMask.width}x${bluebellMask.height}` : 'null'}`);
    // Extract ground mesh geometry in world space (includes GLB node rotation/position)
    const groundGeometry = getWorldGeometry(modules, 'ground.glb');
    if (!groundGeometry)
        console.error('Failed to load ground mesh');
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
    // Create runtime and set initial data
    const runtime = createRuntime(graphModule.graphs[0].graph);
    runtime.set(groupInputNode, 'groundGeometry', groundGeometry);
    runtime.set(groupInputNode, 'textures', { densityMap, bluebellMask });
    runtime.evaluate();
    // Build scene from instances
    let instanceRoot = null;
    function rebuild() {
        // Dispose old InstancedMesh2 wrappers (not shared geometry/material)
        if (instanceRoot) {
            instanceRoot.removeFromParent();
            instanceRoot.traverse((c) => {
                if (c.isInstancedMesh) {
                    c.instanceMatrix?.dispose?.();
                    c.instanceColor?.dispose?.();
                }
            });
        }
        runtime.evaluate();
        const output = runtime.get(graphModule.graphs[0].outputs[0].node, graphModule.graphs[0].outputs[0].output);
        console.log(`Scatter: ${output.length} instances`);
        instanceRoot = buildSceneFromInstances(output, modules, { applyWorldMatrices: true });
        instanceRoot.name = 'Flower Field';
        viewer.scene.addObject(instanceRoot);
        viewer.setDirty();
    }
    rebuild();
    // Camera
    viewer.scene.mainCamera.position.set(5, 4, 5);
    viewer.scene.mainCamera.target = new Vector3(0, 0.5, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    ui.appendChild(graphUiConfig(runtime, rebuild, 'Flower Field'));
    ui.appendChild(graphVisualizerButton(graphModule));
    return { viewer, rebuild };
}
main().finally(_testFinish);
