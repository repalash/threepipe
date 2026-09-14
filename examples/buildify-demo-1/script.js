/**
 * Buildify Demo 1 — Uses the buildify_demo_1 module from the procedural generation plugin
 * to generate a building matching the Buildify 1.0 Blender addon output.
 */
import { _testFinish, _testStart, DirectionalLight2, GBufferPlugin, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { buildifyBuilding, buildifyToGroup, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
const MODULE_PATH = '../procedural-building-modular/modules/';
// ─── Default params matching the Buildify .blend ────────────────────
const params = {
    footprint: [
        [-17.935, -5.423], [12.391, -5.423], [12.391, 18.448],
        [-2.382, 18.448], [-2.382, 6.513], [-17.935, 6.513],
    ],
    flatPillars: [
        [-10.159, -5.423], [-2.382, -5.423], [12.391, 6.513], [-10.159, 6.513],
    ],
    segOrder: [
        [3, false], [1, true], [0, true], [9, true], [8, true],
        [7, true], [6, true], [5, true], [4, true], [2, true],
    ],
    moduleWidth: 3.5,
    moduleHeight: 3.02,
    meshWidth: 3.02,
    floors: 7,
    groundSeed: 577,
    middleSeed: 704,
    trimSeed: 931,
    propSeed: 258,
    signSeed: 235,
    groundWalls: ['ground_floor_wall_01', 'ground_floor_wall_02', 'ground_floor_wall_03'],
    middleWalls: ['middle_floor_wall_01', 'middle_floor_wall_02', 'middle_floor_wall_03'],
    trimWalls: ['trimm'],
    pillarSources: {
        ground: { cv: 'ground_floor_pillar_CV_0.5m', cc: 'ground_floor_pillar_CC_0.5m', flat: 'ground_floor_pillar' },
        middle: { cv: 'middle_floor_pillar_CV', cc: 'middle_floor_pillar_CC', flat: 'middle_floor_pillar' },
        trim: { cv: 'top_trim_pillar_CV', cc: 'top_trim_pillar_CC', flat: 'top_trim_pillar' },
    },
    propCollection: ['air_vent_a', 'air_vent_b', 'satelite'],
    signCollection: ['street_sign_a', 'street_sign_b'],
    roofDetails: ['small_chimney_round', 'small_chimney_pointy', 'rotating_chimney',
        'air_vent_roof_a', 'antenna_a', 'Roof_door', 'roof_window_glass'],
};
// ─── Module loading ─────────────────────────────────────────────────
const ALL_MODULES = [...new Set([
        ...params.groundWalls, ...params.middleWalls, ...params.trimWalls,
        ...Object.values(params.pillarSources).flatMap(v => Object.values(v)),
        ...params.propCollection, ...params.signCollection, ...params.roofDetails,
        'street_sign_a', 'street_sign_b', 'antenna_big', 'building_roof',
    ])];
async function loadModules(viewer) {
    const modules = new Map();
    for (const name of ALL_MODULES) {
        try {
            const obj = await viewer.load(MODULE_PATH + name + '.glb', {
                autoCenter: false, autoScale: false,
            });
            if (!obj)
                continue;
            const meshes = [];
            obj.traverse((child) => {
                if (child.isMesh && child.geometry)
                    meshes.push({ geometry: child.geometry, material: child.material });
            });
            if (meshes.length > 0)
                modules.set(name, { meshes });
            obj.removeFromParent();
        }
        catch { /* skip missing */ }
    }
    return modules;
}
// ─── Init ───────────────────────────────────────────────────────────
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        rgbm: false,
        plugins: [PickingPlugin, GBufferPlugin, SSAOPlugin],
    });
    const ssao = viewer.getPlugin(SSAOPlugin);
    if (ssao?.pass)
        ssao.pass.intensity = 0.5;
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', { setBackground: true });
    const sun = new DirectionalLight2(0xffeebb, 2.5);
    sun.position.set(20, 30, 25);
    sun.castShadow = true;
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -5;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.bias = -0.0005;
    viewer.scene.addObject(sun);
    viewer.scene.addObject(new HemisphereLight2(0x88bbdd, 0x443322, 0.4));
    const ground = new Mesh2(new PlaneGeometry(80, 80), new PhysicalMaterial({ color: 0x777770, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    viewer.scene.addObject(ground);
    const modules = await loadModules(viewer);
    console.log(`Loaded ${modules.size} modules`);
    // Generate building
    const result = buildifyBuilding(params);
    let building = buildifyToGroup(result, modules, params);
    viewer.scene.addObject(building);
    viewer.scene.mainCamera.position.set(25, 20, 30);
    viewer.scene.mainCamera.target = new Vector3(0, 9, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    const regenerate = () => {
        building.removeFromParent();
        const r = buildifyBuilding(params);
        building = buildifyToGroup(r, modules, params);
        viewer.scene.addObject(building);
        viewer.setDirty();
    };
    ui.appendChild({
        type: 'folder', label: 'Building', expanded: true, onChange: regenerate,
        children: [
            { type: 'slider', label: 'Module Width', property: [params, 'moduleWidth'], bounds: [2.5, 5.0], stepSize: 0.1 },
            { type: 'slider', label: 'Module Height', property: [params, 'moduleHeight'], bounds: [2.0, 5.0], stepSize: 0.1 },
            { type: 'slider', label: 'Floors', property: [params, 'floors'], bounds: [2, 10], stepSize: 1 },
            { type: 'slider', label: 'Ground Seed', property: [params, 'groundSeed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Middle Seed', property: [params, 'middleSeed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Trim Seed', property: [params, 'trimSeed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Props Seed', property: [params, 'propSeed'], bounds: [0, 999], stepSize: 1 },
            { type: 'slider', label: 'Signs Seed', property: [params, 'signSeed'], bounds: [0, 999], stepSize: 1 },
        ],
    });
}
_testStart();
init().finally(_testFinish);
