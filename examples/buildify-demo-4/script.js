/**
 * Buildify Demo 4 — Interactive footprint editor.
 *
 * Corner handles (red): drag to move vertices.
 * Midpoint handles (green +): click to insert a new vertex.
 * Select a corner handle + press Delete: removes that vertex.
 * Parameter sliders on the right panel.
 */
import { _testFinish, _testStart, DirectionalLight2, GBufferPlugin, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, PlaneGeometry, SphereGeometry, SSAOPlugin, ThreeViewer, TransformControlsPlugin, Vector3, } from 'threepipe';
import { Shape, ShapeGeometry } from 'three';
import { createRuntime, graphUiConfig, graphVisualizerButton, loadAssets, buildSceneFromInstances, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { graphModule, groupInputNode, FOOTPRINT, FLAT_PILLARS } from './graph';
// ─── Shared geometry/materials ──────────────────────────────────────
const HANDLE_Y = 0.5;
const cornerGeo = new SphereGeometry(0.8, 16, 12);
const midGeo = new SphereGeometry(0.5, 12, 8);
const cornerMat = new PhysicalMaterial({ color: 0xff4444, roughness: 0.2, metalness: 0.8 });
const midMat = new PhysicalMaterial({ color: 0x44cc44, roughness: 0.2, metalness: 0.8 });
const roofMat = new PhysicalMaterial({ color: 0x666660, roughness: 0.9 });
// ─── Procedural roof mesh ───────────────────────────────────────────
function createRoofMesh(footprint, roofY) {
    const shape = new Shape();
    shape.moveTo(footprint[0][0], -footprint[0][1]);
    for (let i = 1; i < footprint.length; i++)
        shape.lineTo(footprint[i][0], -footprint[i][1]);
    shape.closePath();
    const geo = new ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, roofY, 0);
    const mesh = new Mesh2(geo, roofMat);
    mesh.receiveShadow = true;
    mesh.name = 'roof-plane';
    return mesh;
}
// ─── Main ───────────────────────────────────────────────────────────
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true, rgbm: false,
        assetManager: { simpleCache: false, storage: false },
        plugins: [PickingPlugin, GBufferPlugin, SSAOPlugin, TransformControlsPlugin],
    });
    const ssao = viewer.getPlugin(SSAOPlugin);
    if (ssao?.pass)
        ssao.pass.intensity = 0.5;
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', { setBackground: true });
    const sun = new DirectionalLight2(0xffeebb, 2.5);
    sun.position.set(30, 40, 35);
    sun.castShadow = true;
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -5;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.bias = -0.0005;
    viewer.scene.addObject(sun);
    viewer.scene.addObject(new HemisphereLight2(0x88bbdd, 0x443322, 0.4));
    const ground = new Mesh2(new PlaneGeometry(100, 100), new PhysicalMaterial({ color: 0x777770, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    viewer.scene.addObject(ground);
    // Load assets
    const basePath = graphModule.assetsPath ?? './assets/';
    const modules = await loadAssets(viewer, graphModule.assets, basePath);
    console.log(`Loaded ${modules.size}/${graphModule.assets.length} assets`);
    // Graph runtime
    const { graph } = graphModule.graphs[0];
    const rt = createRuntime(graph);
    rt.evaluate();
    const outputRef = graphModule.graphs[0].outputs[0];
    const numFloors = 5;
    const moduleHeight = 3;
    let buildingRoot = buildSceneFromInstances(rt.get(outputRef.node, outputRef.output), modules);
    buildingRoot.name = 'Building';
    viewer.scene.addObject(buildingRoot);
    let roofMesh = createRoofMesh(FOOTPRINT, (numFloors - 1) * moduleHeight);
    viewer.scene.addObject(roofMesh);
    // ── Footprint state ──
    const footprint = FOOTPRINT.map(v => [...v]);
    let cornerHandles = [];
    let midHandles = [];
    // TransformControls setup
    const tc = viewer.getPlugin(TransformControlsPlugin);
    const tctl = tc.transformControls;
    tctl.setMode('translate');
    tctl.showX = true;
    tctl.showY = false;
    tctl.showZ = true;
    const picking = viewer.getPlugin(PickingPlugin);
    // ── Handle management ───────────────────────────────────────────
    function clearHandles() {
        for (const h of cornerHandles)
            h.removeFromParent();
        for (const h of midHandles)
            h.removeFromParent();
        cornerHandles = [];
        midHandles = [];
    }
    function rebuildHandles() {
        clearHandles();
        // Corner handles (red) — one per footprint vertex
        for (const [x, z] of footprint) {
            const h = new Mesh2(cornerGeo, cornerMat);
            h.position.set(x, HANDLE_Y, z);
            h.name = 'corner-handle';
            h.castShadow = false;
            h.receiveShadow = false;
            viewer.scene.addObject(h);
            cornerHandles.push(h);
        }
        // Midpoint handles (green) — one between each adjacent pair
        for (let i = 0; i < footprint.length; i++) {
            const j = (i + 1) % footprint.length;
            const mx = (footprint[i][0] + footprint[j][0]) / 2;
            const mz = (footprint[i][1] + footprint[j][1]) / 2;
            const h = new Mesh2(midGeo, midMat);
            h.position.set(mx, HANDLE_Y, mz);
            h.name = 'mid-handle';
            h.castShadow = false;
            h.receiveShadow = false;
            viewer.scene.addObject(h);
            midHandles.push(h);
        }
    }
    rebuildHandles();
    // ── Throttled rebuild ───────────────────────────────────────────
    let needsRebuild = false;
    let isBuilding = false;
    function doRebuild() {
        if (isBuilding)
            return;
        isBuilding = true;
        needsRebuild = false;
        // Sync corner handle positions → footprint
        for (let i = 0; i < cornerHandles.length; i++) {
            footprint[i] = [cornerHandles[i].position.x, cornerHandles[i].position.z];
        }
        // Update midpoint handle positions
        for (let i = 0; i < midHandles.length; i++) {
            const j = (i + 1) % footprint.length;
            midHandles[i].position.set((footprint[i][0] + footprint[j][0]) / 2, HANDLE_Y, (footprint[i][1] + footprint[j][1]) / 2);
        }
        // Update graph
        rt.set(groupInputNode, 'footprint', footprint);
        rt.set(groupInputNode, 'flatPillars', FLAT_PILLARS);
        rt.evaluate();
        // Rebuild building
        buildingRoot.removeFromParent();
        const instances = rt.get(outputRef.node, outputRef.output);
        buildingRoot = buildSceneFromInstances(instances, modules);
        buildingRoot.name = 'Building';
        viewer.scene.addObject(buildingRoot);
        // Rebuild roof
        roofMesh.removeFromParent();
        roofMesh.geometry.dispose();
        const nf = rt.get(groupInputNode, 'numFloors') || numFloors;
        const mh = rt.get(groupInputNode, 'moduleHeight') || moduleHeight;
        roofMesh = createRoofMesh(footprint, (nf - 1) * mh);
        viewer.scene.addObject(roofMesh);
        isBuilding = false;
    }
    function requestRebuild() {
        needsRebuild = true;
        viewer.setDirty();
    }
    viewer.addEventListener('postFrame', () => {
        if (needsRebuild)
            doRebuild();
    });
    // Drag corner → rebuild
    tctl.addEventListener('objectChange', requestRebuild);
    // ── Click midpoint handle → insert vertex ───────────────────────
    picking.addEventListener('selectedObjectChanged', (event) => {
        const obj = event.object;
        if (!obj)
            return;
        const midIdx = midHandles.indexOf(obj);
        if (midIdx >= 0) {
            // Insert new vertex after index midIdx
            const insertAt = midIdx + 1;
            const newVert = [obj.position.x, obj.position.z];
            footprint.splice(insertAt, 0, newVert);
            // Deselect the midpoint, rebuild handles, select the new corner
            tctl.detach();
            rebuildHandles();
            requestRebuild();
            // Select the new corner handle
            setTimeout(() => {
                picking.setSelectedObject(cornerHandles[insertAt]);
            }, 50);
        }
    });
    // ── Delete key → remove selected corner vertex ──────────────────
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace')
            return;
        if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA')
            return;
        const selected = picking.getSelectedObject();
        if (!selected)
            return;
        const cornerIdx = cornerHandles.indexOf(selected);
        if (cornerIdx < 0)
            return;
        // Don't allow fewer than 3 vertices
        if (footprint.length <= 3)
            return;
        e.preventDefault();
        footprint.splice(cornerIdx, 1);
        tctl.detach();
        rebuildHandles();
        requestRebuild();
    });
    // Camera
    viewer.scene.mainCamera.position.set(25, 20, 30);
    viewer.scene.mainCamera.target = new Vector3(0, 9, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.appendChild(graphUiConfig(rt, requestRebuild, 'Building'));
    ui.appendChild(graphVisualizerButton(graphModule));
}
_testStart();
init().finally(_testFinish);
