/**
 * Buildify Demo 2 — Node Graph
 *
 * Same building as demo-1, but built using the reactive node graph framework.
 * Each Blender node group = a defineNode(). The graph evaluates selectively:
 * changing one seed only recomputes that wall group + the join node.
 */
import { _testFinish, _testStart, DirectionalLight2, GBufferPlugin, Group2, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { defineNode, defineNodeType, defineGraph, connect, createRuntime, graphUiConfig, meshToCurveSplitTrim, alignEulerToEdgeNormal, normalizeAngle, pointOnSegment, randomInt, randomFloat, randomBool, } from '@threepipe/plugin-procedural-generation';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
const MODULE_PATH = '../procedural-building-modular/modules/';
// ─── Buildify constants ─────────────────────────────────────────────
const FOOTPRINT = [
    [-17.935, -5.423], [12.391, -5.423], [12.391, 18.448],
    [-2.382, 18.448], [-2.382, 6.513], [-17.935, 6.513],
];
const FLAT_PILLARS = [
    [-10.159, -5.423], [-2.382, -5.423], [12.391, 6.513], [-10.159, 6.513],
];
const SEG_ORDER = [
    [3, false], [1, true], [0, true], [9, true], [8, true],
    [7, true], [6, true], [5, true], [4, true], [2, true],
];
const MESH_W = 3.02;
const PILLAR_SOURCES = {
    ground: { cv: 'ground_floor_pillar_CV_0.5m', cc: 'ground_floor_pillar_CC_0.5m', flat: 'ground_floor_pillar' },
    middle: { cv: 'middle_floor_pillar_CV', cc: 'middle_floor_pillar_CC', flat: 'middle_floor_pillar' },
    trim: { cv: 'top_trim_pillar_CV', cc: 'top_trim_pillar_CC', flat: 'top_trim_pillar' },
};
function computeWalls(segments, segOrder, moduleWidth, moduleHeight, meshWidth, wallCollection, pillarOffset, seed, numFloors, removeFromBottom, removeFromTop) {
    const placements = [];
    const segWalls = segments.map(seg => {
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const dirX = dx / len, dirZ = dz / len;
        const usable = len - 2 * pillarOffset;
        const n = Math.max(1, Math.round(usable / moduleWidth));
        const spacing = usable / n;
        const walls = [];
        for (let mi = 0; mi < n; mi++) {
            const t = pillarOffset + (mi + 0.5) * spacing;
            walls.push({ px: seg.from[0] + dirX * t, pz: seg.from[1] + dirZ * t });
        }
        return walls;
    });
    const pointOrder = [];
    for (const [segIdx, reversed] of segOrder) {
        const walls = segWalls[segIdx];
        if (reversed) {
            for (let i = walls.length - 1; i >= 0; i--)
                pointOrder.push({ segIdx, wallIdx: i });
        }
        else {
            for (let i = 0; i < walls.length; i++)
                pointOrder.push({ segIdx, wallIdx: i });
        }
    }
    function pickVariant(pointIdx) {
        if (wallCollection.length === 1)
            return wallCollection[0];
        const s1 = randomInt(0, 100, pointIdx, 0);
        const s2 = randomInt(0, 200, s1, seed);
        return wallCollection[s2 % wallCollection.length];
    }
    const maxFloor = Math.min(numFloors - 1, numFloors - removeFromTop);
    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const dirX = dx / len, dirZ = dz / len;
        const rotY = alignEulerToEdgeNormal(seg.from[0], seg.from[1], seg.to[0], seg.to[1]);
        const walls = segWalls[si];
        for (let mi = 0; mi < walls.length; mi++) {
            const pointIdx = pointOrder.findIndex(p => p.segIdx === si && p.wallIdx === mi);
            for (let floor = removeFromBottom; floor <= maxFloor; floor++) {
                const floorOffset = floor === 0 ? pillarOffset : 0;
                const usable = len - 2 * floorOffset;
                const n = Math.max(1, Math.round(usable / moduleWidth));
                const spacing = usable / n;
                const t = floorOffset + (mi + 0.5) * spacing;
                placements.push({
                    x: seg.from[0] + dirX * t, y: floor * moduleHeight, z: seg.from[1] + dirZ * t,
                    rotY, scaleX: spacing / meshWidth, source: pickVariant(pointIdx),
                });
            }
        }
    }
    return placements;
}
function computePillars(footprint, flatPillars, numFloors, moduleHeight) {
    const placements = [];
    const ft = (f) => f === 0 ? 'ground' : f === numFloors - 1 ? 'trim' : 'middle';
    for (let i = 0; i < footprint.length; i++) {
        const prev = footprint[(i - 1 + footprint.length) % footprint.length];
        const curr = footprint[i];
        const next = footprint[(i + 1) % footprint.length];
        const cross = (curr[0] - prev[0]) * (next[1] - curr[1]) - (curr[1] - prev[1]) * (next[0] - curr[0]);
        const type = cross > 0 ? 'cv' : 'cc';
        const rPrev = alignEulerToEdgeNormal(prev[0], prev[1], curr[0], curr[1]);
        const rCurr = alignEulerToEdgeNormal(curr[0], curr[1], next[0], next[1]);
        let a = rPrev, b = rCurr;
        while (a - b > Math.PI)
            a -= 2 * Math.PI;
        while (b - a > Math.PI)
            b -= 2 * Math.PI;
        const pillarRot = normalizeAngle((a + b) / 2 + Math.PI);
        for (let floor = 0; floor < numFloors; floor++)
            placements.push({ x: curr[0], y: floor * moduleHeight, z: curr[1], rotY: pillarRot, source: PILLAR_SOURCES[ft(floor)][type] });
    }
    for (const fp of flatPillars) {
        let fpRotY = 0;
        for (let i = 0; i < footprint.length; i++) {
            const j = (i + 1) % footprint.length;
            if (pointOnSegment(fp, footprint[i][0], footprint[i][1], footprint[j][0], footprint[j][1]) !== null) {
                fpRotY = normalizeAngle(alignEulerToEdgeNormal(footprint[i][0], footprint[i][1], footprint[j][0], footprint[j][1]) + Math.PI);
                break;
            }
        }
        for (let floor = 0; floor < numFloors; floor++)
            placements.push({ x: fp[0], y: floor * moduleHeight, z: fp[1], rotY: fpRotY, source: PILLAR_SOURCES[ft(floor)].flat });
    }
    return placements;
}
function computeProps(segments, segOrder, moduleWidth, moduleHeight, seed, collection, density, horizOffset, vertOffset, removeFromBottom, removeFromTop) {
    const placements = [];
    const wallInstances = [];
    for (const [segIdx, reversed] of segOrder) {
        const seg = segments[segIdx];
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const dirX = dx / len, dirZ = dz / len;
        const n = Math.max(1, Math.round(len / moduleWidth));
        const spacing = len / n;
        const rotY = alignEulerToEdgeNormal(seg.from[0], seg.from[1], seg.to[0], seg.to[1]);
        const positions = [];
        for (let mi = 0; mi < n; mi++) {
            const t = (mi + 0.5) * spacing;
            positions.push({ x: seg.from[0] + dirX * t, z: seg.from[1] + dirZ * t });
        }
        const ordered = reversed ? [...positions].reverse() : positions;
        for (let floor = 1; floor <= 5; floor++)
            for (const wp of ordered)
                wallInstances.push({ x: wp.x, y: floor * moduleHeight, z: wp.z, rotY, floor });
    }
    const filtered = wallInstances.filter(w => w.floor >= removeFromBottom && w.floor <= removeFromTop);
    for (let i = 0; i < filtered.length; i++) {
        if (randomBool(1 - density, i, seed + 5))
            continue;
        const w = filtered[i];
        const typeIdx = randomInt(0, 100, i, seed) % collection.length;
        const h = randomFloat(0, 1, i, seed + 1);
        const hOff = h * (2 * horizOffset) - horizOffset;
        const vOff = h * (2 * vertOffset) - vertOffset;
        const cr = Math.cos(w.rotY), sr = Math.sin(w.rotY);
        placements.push({ x: w.x + hOff * cr, y: w.y + vOff, z: w.z - hOff * sr, rotY: w.rotY, source: collection[typeIdx] });
    }
    return placements;
}
// ─── Define the node graph ──────────────────────────────────────────
const preprocess = defineNode('Preprocess', { floors: { default: 7, ui: { label: 'Number of floors', bounds: [2, 10], stepSize: 1 } },
    moduleWidth: { default: 3.5, ui: { label: 'Module width', bounds: [2.5, 5.0], stepSize: 0.1 } },
    moduleHeight: { default: 3.02, ui: { label: 'Module height', bounds: [2.0, 5.0], stepSize: 0.1 } } }, { segments: [], numFloors: 7, moduleWidth: 3.5, moduleHeight: 3.02,
    groundRemoveTop: 7, trimRemoveBottom: 6, propsRemoveTop: 5 }, (inp) => {
    const numFloors = Math.max(2, inp.floors);
    return {
        segments: meshToCurveSplitTrim(FOOTPRINT, FLAT_PILLARS),
        numFloors, moduleWidth: inp.moduleWidth, moduleHeight: inp.moduleHeight,
        groundRemoveTop: numFloors, trimRemoveBottom: numFloors - 1, propsRemoveTop: numFloors - 2,
    };
});
// ── "Walls" node type — defined ONCE, instantiated 3 times ──
const wallsNodeType = defineNodeType({
    segments: [], numFloors: 7, moduleWidth: 3.5, moduleHeight: 3.02,
    wallCollection: [],
    seed: { default: 0, ui: { label: 'Seed', bounds: [0, 999], stepSize: 1 } },
    pillarOffset: { default: 0, ui: { label: 'Offset from pillar', bounds: [0, 2], stepSize: 0.1 } },
    flatPillarThreshold: { default: 15, ui: { label: 'Flat pillar threshold', bounds: [0, 45], stepSize: 1 } },
    removeFromBottom: { default: 0, ui: { label: 'Remove from bottom', bounds: [0, 10], stepSize: 1 } },
    removeFromTop: { default: 0, ui: { label: 'Remove from top', bounds: [0, 10], stepSize: 1 } },
}, { walls: [] }, (inp) => ({
    walls: computeWalls(inp.segments, SEG_ORDER, inp.moduleWidth, inp.moduleHeight, MESH_W, inp.wallCollection, inp.pillarOffset, inp.seed, inp.numFloors, inp.removeFromBottom, inp.removeFromTop),
}));
const groundWalls = wallsNodeType('Ground Walls', {
    wallCollection: ['ground_floor_wall_01', 'ground_floor_wall_02', 'ground_floor_wall_03'],
    seed: 577, pillarOffset: 0.5, removeFromTop: 7,
});
const middleWalls = wallsNodeType('Middle Walls', {
    wallCollection: ['middle_floor_wall_01', 'middle_floor_wall_02', 'middle_floor_wall_03'],
    seed: 704, removeFromBottom: 1, removeFromTop: 2,
});
const trimWalls = wallsNodeType('Trim Walls', {
    wallCollection: ['trimm'],
    seed: 931, removeFromBottom: 6,
});
const pillars = defineNode('Pillars', { numFloors: 7, moduleHeight: 3.02,
    flatPillarThreshold: { default: 15, ui: { label: 'Flat pillar threshold', bounds: [0, 45], stepSize: 1 } } }, { pillars: [] }, (inp) => ({ pillars: computePillars(FOOTPRINT, FLAT_PILLARS, inp.numFloors, inp.moduleHeight) }));
// ── "Wall props" node type — defined ONCE, instantiated 2 times ──
const propsNodeType = defineNodeType({
    segments: [], numFloors: 7, moduleWidth: 3.5, moduleHeight: 3.02,
    collection: [],
    seed: { default: 0, ui: { label: 'Seed', bounds: [0, 999], stepSize: 1 } },
    density: { default: 0.2, ui: { label: 'Props density', bounds: [0, 1], stepSize: 0.05 } },
    horizOffset: { default: 0, ui: { label: 'Random horizontal offset', bounds: [0, 3], stepSize: 0.1 } },
    vertOffset: { default: 0, ui: { label: 'Random vertical offset', bounds: [0, 2], stepSize: 0.1 } },
    removeFromBottom: { default: 0, ui: { label: 'Remove from bottom', bounds: [0, 10], stepSize: 1 } },
    removeFromTop: { default: 0, ui: { label: 'Remove from top', bounds: [0, 10], stepSize: 1 } },
}, { props: [] }, (inp) => ({
    props: computeProps(inp.segments, SEG_ORDER, inp.moduleWidth, inp.moduleHeight, inp.seed, inp.collection, inp.density, inp.horizOffset, inp.vertOffset, inp.removeFromBottom, inp.removeFromTop),
}));
const middleProps = propsNodeType('Middle Props', {
    collection: ['air_vent_a', 'air_vent_b', 'satelite'],
    seed: 258, horizOffset: 1.5, vertOffset: 0.5, removeFromTop: 5,
});
const signProps = propsNodeType('Sign Props', {
    collection: ['street_sign_a', 'street_sign_b'],
    seed: 235, horizOffset: 1.9, removeFromTop: 2,
});
const join = defineNode('Join', { gw: [], mw: [], tw: [],
    pillars: [], mp: [], sp: [] }, { walls: [], pillars: [], props: [] }, (inp) => ({
    walls: [...inp.gw, ...inp.mw, ...inp.tw],
    pillars: inp.pillars,
    props: [...inp.mp, ...inp.sp],
}));
const graph = defineGraph([preprocess, groundWalls, middleWalls, trimWalls, pillars, middleProps, signProps, join], [
    connect(preprocess, 'segments', groundWalls, 'segments'),
    connect(preprocess, 'segments', middleWalls, 'segments'),
    connect(preprocess, 'segments', trimWalls, 'segments'),
    connect(preprocess, 'segments', middleProps, 'segments'),
    connect(preprocess, 'segments', signProps, 'segments'),
    connect(preprocess, 'numFloors', groundWalls, 'numFloors'),
    connect(preprocess, 'numFloors', middleWalls, 'numFloors'),
    connect(preprocess, 'numFloors', trimWalls, 'numFloors'),
    connect(preprocess, 'numFloors', pillars, 'numFloors'),
    connect(preprocess, 'numFloors', middleProps, 'numFloors'),
    connect(preprocess, 'numFloors', signProps, 'numFloors'),
    connect(preprocess, 'moduleWidth', groundWalls, 'moduleWidth'),
    connect(preprocess, 'moduleWidth', middleWalls, 'moduleWidth'),
    connect(preprocess, 'moduleWidth', trimWalls, 'moduleWidth'),
    connect(preprocess, 'moduleWidth', middleProps, 'moduleWidth'),
    connect(preprocess, 'moduleWidth', signProps, 'moduleWidth'),
    connect(preprocess, 'moduleHeight', groundWalls, 'moduleHeight'),
    connect(preprocess, 'moduleHeight', middleWalls, 'moduleHeight'),
    connect(preprocess, 'moduleHeight', trimWalls, 'moduleHeight'),
    connect(preprocess, 'moduleHeight', pillars, 'moduleHeight'),
    connect(preprocess, 'moduleHeight', middleProps, 'moduleHeight'),
    connect(preprocess, 'moduleHeight', signProps, 'moduleHeight'),
    // Dynamic removeFrom* — computed from numFloors in preprocess
    connect(preprocess, 'groundRemoveTop', groundWalls, 'removeFromTop'),
    connect(preprocess, 'trimRemoveBottom', trimWalls, 'removeFromBottom'),
    connect(preprocess, 'propsRemoveTop', middleProps, 'removeFromTop'),
    connect(groundWalls, 'walls', join, 'gw'),
    connect(middleWalls, 'walls', join, 'mw'),
    connect(trimWalls, 'walls', join, 'tw'),
    connect(pillars, 'pillars', join, 'pillars'),
    connect(middleProps, 'props', join, 'mp'),
    connect(signProps, 'props', join, 'sp'),
]);
// ─── Scene builder ──────────────────────────────────────────────────
function buildScene(rt, modules) {
    const root = new Group2();
    root.name = 'Buildify Building (Graph)';
    function place(name, x, y, z, rotY, scaleX = 1) {
        const mod = modules.get(name);
        if (!mod)
            return;
        const g = new Group2();
        g.position.set(x, y, z);
        g.rotation.y = rotY;
        g.scale.set(scaleX, 1, 1);
        for (const m of mod.meshes) {
            const mesh = new Mesh2(m.geometry, m.material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            g.add(mesh);
        }
        root.add(g);
    }
    const walls = rt.get(join, 'walls');
    const pls = rt.get(join, 'pillars');
    const props = rt.get(join, 'props');
    for (const w of walls)
        place(w.source, w.x, w.y, w.z, w.rotY, w.scaleX);
    for (const p of pls)
        place(p.source, p.x, p.y, p.z, p.rotY);
    for (const p of props)
        place(p.source, p.x, p.y, p.z, p.rotY);
    // Roof
    const numFloors = rt.get(preprocess, 'numFloors');
    const moduleHeight = rt.get(preprocess, 'moduleHeight');
    const roofY = numFloors * moduleHeight;
    const roofMod = modules.get('building_roof');
    if (roofMod) {
        place('building_roof', 0, roofY, 0, 0);
    }
    else {
        const roofMesh = new Mesh2(new PlaneGeometry(30, 24), new PhysicalMaterial({ color: 0x666660, roughness: 0.9 }));
        roofMesh.rotation.x = -Math.PI / 2;
        roofMesh.position.y = roofY;
        roofMesh.receiveShadow = true;
        root.add(roofMesh);
    }
    return root;
}
// ─── Module loading ─────────────────────────────────────────────────
const ALL_MODULES = [
    'ground_floor_wall_01', 'ground_floor_wall_02', 'ground_floor_wall_03',
    'middle_floor_wall_01', 'middle_floor_wall_02', 'middle_floor_wall_03', 'trimm',
    'ground_floor_pillar_CV_0.5m', 'ground_floor_pillar', 'ground_floor_pillar_CC_0.5m',
    'middle_floor_pillar_CV', 'middle_floor_pillar', 'middle_floor_pillar_CC',
    'top_trim_pillar_CV', 'top_trim_pillar', 'top_trim_pillar_CC',
    'air_vent_a', 'air_vent_b', 'satelite', 'street_sign_a', 'street_sign_b',
    'building_roof',
];
async function loadModules(viewer) {
    const modules = new Map();
    for (const name of ALL_MODULES) {
        try {
            const obj = await viewer.load(MODULE_PATH + name + '.glb', { autoCenter: false, autoScale: false });
            if (!obj)
                continue;
            const meshes = [];
            obj.traverse((child) => { if (child.isMesh && child.geometry)
                meshes.push({ geometry: child.geometry, material: child.material }); });
            if (meshes.length > 0)
                modules.set(name, { meshes });
            obj.removeFromParent();
        }
        catch { /* skip */ }
    }
    return modules;
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
    // Create runtime and first evaluate
    const rt = createRuntime(graph);
    const computed = rt.evaluate();
    console.log(`Initial evaluate: ${computed} nodes computed`);
    let building = buildScene(rt, modules);
    viewer.scene.addObject(building);
    viewer.scene.mainCamera.position.set(25, 20, 30);
    viewer.scene.mainCamera.target = new Vector3(0, 9, 0);
    viewer.scene.mainCamera.setDirty?.();
    // UI — bind sliders directly to runtime.set()
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    const rebuild = () => {
        const n = rt.evaluate();
        console.log(`Evaluated: ${n} nodes recomputed`);
        building.removeFromParent();
        building = buildScene(rt, modules);
        viewer.scene.addObject(building);
        viewer.setDirty();
    };
    // Auto-generated UI from node definitions — one folder per node with settable inputs
    ui.appendChild(graphUiConfig(rt, rebuild, 'Building (Node Graph)'));
}
_testStart();
init().finally(_testFinish);
