/**
 * Procedural Building — Buildify-style Generator
 *
 * Two modes:
 * 1. "reference" — loads the exact instance placements from the Buildify .blend file
 * 2. "procedural" — generates placements algorithmically from the footprint polygon
 *
 * The procedural mode replicates Buildify's exact algorithm:
 * - Split footprint edges at flat pillar positions into segments
 * - Resample each segment at moduleWidth intervals
 * - Ground floor: inset walls by PILLAR_OFFSET; upper floors: walls fill entire edge
 * - Variant selection: two-stage Jenkins hash matching Blender's Random Value nodes
 * - Floor seeds: ground=577, middle=704, trim=931
 */
import { _testFinish, _testStart, DirectionalLight2, GBufferPlugin, Group2, HemisphereLight2, Mesh2, PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAOPlugin, ThreeViewer, Vector3, } from 'threepipe';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
const MODULE_PATH = './modules/';
// ─── Buildify parameters (reverse-engineered from .blend) ───────────
const MESH_W = 3.02; // module mesh width in GLB files
const PILLAR_OFFSET = 0.5; // ground floor wall inset from segment ends
// Floor type config from building node group
const FLOOR_OFFSETS = { ground: 0.5, middle: 0, trim: 0 };
// L-shaped footprint (three.js coords)
const FOOTPRINT = [
    [-17.935, -5.423], [12.391, -5.423], [12.391, 18.448],
    [-2.382, 18.448], [-2.382, 6.513], [-17.935, 6.513],
];
// Flat pillars that split polygon edges
const FLAT_PILLARS = [
    [-10.159, -5.423], [-2.382, -5.423], [12.391, 6.513], [-10.159, 6.513],
];
// Blender point traversal order: [segmentIndex, reversed]
// Determined by Blender's Mesh-to-Curve edge processing order
const BLENDER_SEG_ORDER = [
    [3, false], [1, true], [0, true], [9, true], [8, true],
    [7, true], [6, true], [5, true], [4, true], [2, true],
];
// ─── Module collections ─────────────────────────────────────────────
const GROUND_WALLS = ['ground_floor_wall_01', 'ground_floor_wall_02', 'ground_floor_wall_03'];
const MIDDLE_WALLS = ['middle_floor_wall_01', 'middle_floor_wall_02', 'middle_floor_wall_03'];
const TRIM_WALLS = ['trimm'];
const ROOF_DETAILS = ['small_chimney_round', 'small_chimney_pointy', 'rotating_chimney',
    'air_vent_roof_a', 'antenna_a', 'Roof_door', 'roof_window_glass'];
const WALL_PROPS = ['air_vent_a', 'air_vent_b', 'satelite', 'street_sign_a', 'street_sign_b'];
const ALL_MODULES = [...new Set([
        ...GROUND_WALLS, ...MIDDLE_WALLS, ...TRIM_WALLS,
        'ground_floor_pillar_CV_0.5m', 'ground_floor_pillar', 'ground_floor_pillar_CC_0.5m',
        'middle_floor_pillar_CV', 'middle_floor_pillar', 'middle_floor_pillar_CC',
        'top_trim_pillar_CV', 'top_trim_pillar', 'top_trim_pillar_CC',
        ...ROOF_DETAILS, ...WALL_PROPS,
        'street_sign_a', 'street_sign_b', 'antenna_big', 'building_roof',
    ])];
const PILLAR_SOURCES = {
    ground: { cv: 'ground_floor_pillar_CV_0.5m', cc: 'ground_floor_pillar_CC_0.5m', flat: 'ground_floor_pillar' },
    middle: { cv: 'middle_floor_pillar_CV', cc: 'middle_floor_pillar_CC', flat: 'middle_floor_pillar' },
    trim: { cv: 'top_trim_pillar_CV', cc: 'top_trim_pillar_CC', flat: 'top_trim_pillar' },
};
const params = {
    mode: 'procedural',
    moduleWidth: 3.5,
    moduleHeight: 3.02,
    floors: 7,
    groundSeed: 577,
    middleSeed: 704,
    trimSeed: 931,
    propSeed: 258,
    signSeed: 235,
};
// ─── Blender Jenkins hash (BLI_hash.hh) ─────────────────────────────
function rot(x, k) {
    return (x << k | x >>> 32 - k) >>> 0;
}
function jenkinsFinal(a, b, c) {
    c = (c ^ b) >>> 0;
    c = c - rot(b, 14) >>> 0;
    a = (a ^ c) >>> 0;
    a = a - rot(c, 11) >>> 0;
    b = (b ^ a) >>> 0;
    b = b - rot(a, 25) >>> 0;
    c = (c ^ b) >>> 0;
    c = c - rot(b, 16) >>> 0;
    a = (a ^ c) >>> 0;
    a = a - rot(c, 4) >>> 0;
    b = (b ^ a) >>> 0;
    b = b - rot(a, 14) >>> 0;
    c = (c ^ b) >>> 0;
    c = c - rot(b, 24) >>> 0;
    return c >>> 0;
}
function blenderHashFloat(kx, ky) {
    const c0 = 0xdeadbeef + (2 << 2) + 13 >>> 0;
    return jenkinsFinal(c0 + (kx >>> 0) >>> 0, c0 + (ky >>> 0) >>> 0, c0) / 0xFFFFFFFF;
}
function blenderRandomInt(min, max, id, seed) {
    return Math.floor(blenderHashFloat(id, seed) * (max - min + 1)) + min;
}
/** Blender FLOAT random uses swapped args: hash(seed, id) */
function blenderRandomFloat(min, max, id, seed) {
    return blenderHashFloat(seed, id) * (max - min) + min;
}
/** Buildify two-stage variant selection */
function wallVariant(pointIndex, floorSeed, numVariants) {
    const stage1 = blenderRandomInt(0, 100, pointIndex, 0);
    const stage2 = blenderRandomInt(0, 200, stage1, floorSeed);
    return stage2 % numVariants;
}
// ─── Geometry helpers ───────────────────────────────────────────────
function normalizeAngle(a) {
    while (a > Math.PI)
        a -= 2 * Math.PI;
    while (a < -Math.PI)
        a += 2 * Math.PI;
    return a;
}
function computeEdgeRotY(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    return normalizeAngle(Math.atan2(dz / len, -dx / len));
}
function pointOnSegment(fp, x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len2 = dx * dx + dz * dz;
    const t = ((fp[0] - x0) * dx + (fp[1] - z0) * dz) / len2;
    if (t < 0.01 || t > 0.99)
        return null;
    if (Math.abs(x0 + t * dx - fp[0]) > 0.01 || Math.abs(z0 + t * dz - fp[1]) > 0.01)
        return null;
    return t;
}
function buildSegments(corners, flatPillars) {
    const segs = [];
    for (let i = 0; i < corners.length; i++) {
        const j = (i + 1) % corners.length;
        const [x0, z0] = corners[i], [x1, z1] = corners[j];
        const splits = [];
        for (const fp of flatPillars) {
            const t = pointOnSegment(fp, x0, z0, x1, z1);
            if (t !== null)
                splits.push({ pos: fp, t });
        }
        splits.sort((a, b) => a.t - b.t);
        let sx = x0, sz = z0;
        for (const sp of splits) {
            segs.push({ from: [sx, sz], to: [sp.pos[0], sp.pos[1]] });
            sx = sp.pos[0];
            sz = sp.pos[1];
        }
        segs.push({ from: [sx, sz], to: [x1, z1] });
    }
    return segs;
}
// ─── Module loading ─────────────────────────────────────────────────
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
        catch { /* skip missing modules */ }
    }
    return modules;
}
function placeMod(parent, mod, x, y, z, rotY, scaleX = 1) {
    const group = new Group2();
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    group.scale.set(scaleX, 1, 1);
    for (const m of mod.meshes) {
        const mesh = new Mesh2(m.geometry, m.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    }
    parent.add(group);
}
function getMod(modules, name) {
    return modules.get(name) ?? null;
}
/** Place wall props using Buildify's algorithm */
function placeWallProps(root, modules, segments, _numFloors, seed, collection, density, horizOffset, vertOffset, removeBottom, removeTop) {
    // Build wall instance list in Blender's traversal order.
    // Each wall instance is a candidate point for prop placement.
    // Order: per segment (BLENDER_SEG_ORDER), per wall point (reversed if needed), per floor.
    const wallInstances = [];
    for (const [segIdx, reversed] of BLENDER_SEG_ORDER) {
        const seg = segments[segIdx];
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const dirX = dx / len, dirZ = dz / len;
        const n = Math.max(1, Math.round(len / params.moduleWidth));
        const spacing = len / n;
        const rotY = computeEdgeRotY(seg.from[0], seg.from[1], seg.to[0], seg.to[1]);
        // Wall center positions along segment (middle floor: no offset)
        const positions = [];
        for (let mi = 0; mi < n; mi++) {
            const t = (mi + 0.5) * spacing;
            positions.push({ x: seg.from[0] + dirX * t, z: seg.from[1] + dirZ * t });
        }
        const ordered = reversed ? [...positions].reverse() : positions;
        for (let floor = 1; floor <= 5; floor++) {
            for (const wp of ordered) {
                wallInstances.push({
                    x: wp.x, y: floor * params.moduleHeight, z: wp.z,
                    rotY, floor,
                });
            }
        }
    }
    // Filter by floor range
    const filtered = wallInstances.filter(w => w.floor >= removeBottom && w.floor <= removeTop);
    // Apply density filter, type selection, and offset
    for (let i = 0; i < filtered.length; i++) {
        // Density: delete if hash < (1 - density)
        if (blenderHashFloat(i, seed + 5) < 1 - density)
            continue;
        const w = filtered[i];
        const typeIdx = blenderRandomInt(0, 100, i, seed) % collection.length;
        const mod = getMod(modules, collection[typeIdx]);
        if (!mod)
            continue;
        // Offset: FLOAT random uses swapped hash args
        const h = blenderRandomFloat(0, 1, i, seed + 1);
        const hOff = h * (2 * horizOffset) - horizOffset;
        const vOff = h * (2 * vertOffset) - vertOffset;
        // Apply in wall's local space → three.js global
        // Local X (along wall) → global: (cos(rotY), 0, -sin(rotY))
        // Local Z (vertical) → global: (0, 1, 0)
        const cr = Math.cos(w.rotY), sr = Math.sin(w.rotY);
        placeMod(root, mod, w.x + hOff * cr, w.y + vOff, w.z - hOff * sr, w.rotY);
    }
}
// ─── Procedural generation ──────────────────────────────────────────
function generateProcedural(modules) {
    const root = new Group2();
    root.name = 'Procedural Building';
    const numFloors = Math.max(2, params.floors);
    const segments = buildSegments(FOOTPRINT, FLAT_PILLARS);
    function floorType(f) {
        if (f === 0)
            return 'ground';
        if (f === numFloors - 1)
            return 'trim';
        return 'middle';
    }
    // Compute wall positions per segment (using ground floor offset for count)
    const segWalls = segments.map(seg => {
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const dirX = dx / len, dirZ = dz / len;
        const usable = len - 2 * PILLAR_OFFSET;
        const n = Math.max(1, Math.round(usable / params.moduleWidth));
        const spacing = usable / n;
        const walls = [];
        for (let mi = 0; mi < n; mi++) {
            const t = PILLAR_OFFSET + (mi + 0.5) * spacing;
            walls.push({ px: seg.from[0] + dirX * t, pz: seg.from[1] + dirZ * t });
        }
        return walls;
    });
    // Build point index mapping following Blender's traversal order
    const pointOrder = [];
    for (const [segIdx, reversed] of BLENDER_SEG_ORDER) {
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
    // ── Walls ──
    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const dirX = dx / len, dirZ = dz / len;
        const rotY = computeEdgeRotY(seg.from[0], seg.from[1], seg.to[0], seg.to[1]);
        const walls = segWalls[si];
        for (let mi = 0; mi < walls.length; mi++) {
            // Find this wall's point index in Blender traversal order
            const pointIdx = pointOrder.findIndex(p => p.segIdx === si && p.wallIdx === mi);
            for (let floor = 0; floor < numFloors; floor++) {
                const ft = floorType(floor);
                const offset = FLOOR_OFFSETS[ft];
                const usable = len - 2 * offset;
                const n = Math.max(1, Math.round(usable / params.moduleWidth));
                const spacing = usable / n;
                const scaleX = spacing / MESH_W;
                // Compute position for this floor (offset differs ground vs upper)
                const t = offset + (mi + 0.5) * spacing;
                const px = seg.from[0] + dirX * t;
                const pz = seg.from[1] + dirZ * t;
                // Select variant using Blender's two-stage hash
                const wallList = ft === 'ground' ? GROUND_WALLS : ft === 'trim' ? TRIM_WALLS : MIDDLE_WALLS;
                const floorSeed = ft === 'ground' ? params.groundSeed
                    : ft === 'trim' ? params.trimSeed : params.middleSeed;
                let source;
                if (wallList.length === 1) {
                    source = wallList[0];
                }
                else {
                    source = wallList[wallVariant(pointIdx, floorSeed, wallList.length)];
                }
                const mod = getMod(modules, source);
                if (mod)
                    placeMod(root, mod, px, floor * params.moduleHeight, pz, rotY, scaleX);
            }
        }
    }
    // ── Corner pillars (CV or CC) ──
    for (let i = 0; i < FOOTPRINT.length; i++) {
        const prev = FOOTPRINT[(i - 1 + FOOTPRINT.length) % FOOTPRINT.length];
        const curr = FOOTPRINT[i];
        const next = FOOTPRINT[(i + 1) % FOOTPRINT.length];
        const cross = (curr[0] - prev[0]) * (next[1] - curr[1]) - (curr[1] - prev[1]) * (next[0] - curr[0]);
        const type = cross > 0 ? 'cv' : 'cc';
        const rPrev = computeEdgeRotY(prev[0], prev[1], curr[0], curr[1]);
        const rCurr = computeEdgeRotY(curr[0], curr[1], next[0], next[1]);
        let a = rPrev, b = rCurr;
        while (a - b > Math.PI)
            a -= 2 * Math.PI;
        while (b - a > Math.PI)
            b -= 2 * Math.PI;
        const pillarRot = normalizeAngle((a + b) / 2 + Math.PI);
        for (let floor = 0; floor < numFloors; floor++) {
            const ft = floorType(floor);
            const mod = getMod(modules, PILLAR_SOURCES[ft][type]);
            if (mod)
                placeMod(root, mod, curr[0], floor * params.moduleHeight, curr[1], pillarRot);
        }
    }
    // ── Flat pillars ──
    for (const fp of FLAT_PILLARS) {
        let fpRotY = 0;
        for (let i = 0; i < FOOTPRINT.length; i++) {
            const j = (i + 1) % FOOTPRINT.length;
            if (pointOnSegment(fp, FOOTPRINT[i][0], FOOTPRINT[i][1], FOOTPRINT[j][0], FOOTPRINT[j][1]) !== null) {
                fpRotY = normalizeAngle(computeEdgeRotY(FOOTPRINT[i][0], FOOTPRINT[i][1], FOOTPRINT[j][0], FOOTPRINT[j][1]) + Math.PI);
                break;
            }
        }
        for (let floor = 0; floor < numFloors; floor++) {
            const ft = floorType(floor);
            const mod = getMod(modules, PILLAR_SOURCES[ft].flat);
            if (mod)
                placeMod(root, mod, fp[0], floor * params.moduleHeight, fp[1], fpRotY);
        }
    }
    // ── Roof ──
    const roofY = numFloors * params.moduleHeight;
    const roofMod = getMod(modules, 'building_roof');
    if (roofMod) {
        placeMod(root, roofMod, 0, roofY, 0, 0);
    }
    else {
        const roofMat = new PhysicalMaterial({ color: 0x666660, roughness: 0.9 });
        const roofMesh = new Mesh2(new PlaneGeometry(30, 24), roofMat);
        roofMesh.rotation.x = -Math.PI / 2;
        roofMesh.position.y = roofY;
        roofMesh.receiveShadow = true;
        root.add(roofMesh);
    }
    // ── Wall props (vents, satellites, signs) ──
    // Buildify places props on wall faces: each wall instance is a candidate.
    // Density filter keeps ~20%, then a random prop is placed with an offset.
    // Two groups: middle floor props (seed=258) and first floor signs (seed=235).
    placeWallProps(root, modules, segments, numFloors, params.propSeed, ['air_vent_a', 'air_vent_b', 'satelite'], 0.2, 1.5, 0.5, 0, numFloors - 2);
    placeWallProps(root, modules, segments, numFloors, params.signSeed, ['street_sign_a', 'street_sign_b'], 0.2, 1.9, 0, 0, 2);
    // ── Roof details (chimneys, antennas) ──
    // Buildify subdivides the roof and places details at face centers.
    // This requires geometry subdivision data we don't have, so we scatter procedurally.
    const roofDetailSeed = 763;
    for (let i = 0; i < 25; i++) {
        const detailIdx = blenderRandomInt(0, ROOF_DETAILS.length - 1, i, roofDetailSeed);
        const mod = getMod(modules, ROOF_DETAILS[detailIdx]);
        if (mod) {
            const rx = blenderRandomFloat(-16, 12, i * 2, roofDetailSeed);
            const rz = blenderRandomFloat(-4, 18, i * 2 + 1, roofDetailSeed);
            if (rx < -2.382 && rz > 6.513)
                continue; // outside L-shape
            const rr = [0, Math.PI / 2, Math.PI, -Math.PI / 2][blenderRandomInt(0, 3, i, roofDetailSeed + 1)];
            placeMod(root, mod, rx, roofY, rz, rr);
        }
    }
    return root;
}
// ─── Reference mode ─────────────────────────────────────────────────
async function generateReference(modules) {
    const root = new Group2();
    root.name = 'Buildify Reference';
    const response = await fetch('./buildify_instances.json');
    const data = await response.json();
    for (const inst of data.instances) {
        const mod = getMod(modules, inst.source);
        if (!mod)
            continue;
        placeMod(root, mod, inst.pos[0], inst.pos[1], inst.pos[2], inst.rotY, inst.scl[0] !== 1 ? inst.scl[0] : undefined);
    }
    const roofMod = getMod(modules, 'building_roof');
    if (roofMod) {
        const group = new Group2();
        for (const m of roofMod.meshes) {
            const mesh = new Mesh2(m.geometry, m.material);
            mesh.receiveShadow = true;
            group.add(mesh);
        }
        group.name = 'Roof';
        root.add(group);
    }
    return root;
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
    let building;
    if (params.mode === 'reference') {
        building = await generateReference(modules);
    }
    else {
        building = generateProcedural(modules);
    }
    viewer.scene.addObject(building);
    viewer.scene.mainCamera.position.set(25, 20, 30);
    viewer.scene.mainCamera.target = new Vector3(0, 9, 0);
    viewer.scene.mainCamera.setDirty?.();
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    ui.setupPluginUi(SSAOPlugin);
    ui.setupPluginUi(PickingPlugin);
    const regenerate = async () => {
        building.removeFromParent();
        if (params.mode === 'reference') {
            building = await generateReference(modules);
        }
        else {
            building = generateProcedural(modules);
        }
        viewer.scene.addObject(building);
        viewer.setDirty();
    };
    ui.appendChild({
        type: 'folder', label: 'Building', expanded: true, onChange: regenerate,
        children: [
            { type: 'dropdown', label: 'Mode', property: [params, 'mode'], children: [
                    { label: 'Procedural', value: 'procedural' },
                    { label: 'Reference (Buildify)', value: 'reference' },
                ] },
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
