/**
 * Graph definition for Buildify 1.0 building (edge-based).
 * Ported from tmp/buildify_1.0.blend using the full porting framework.
 *
 * Key parameters from the .blend modifier:
 *   BLOSM=true, Randomize=true, Min floors=4, Max floors=6
 *   Module width=3, Module height=3
 *   → numFloors = randomInt(4, 6, 0, 0) = 5
 *
 * Critical: Blender's Resample Curve (LENGTH mode) uses floor(), not round().
 *   Source: geometry/intern/resample_curves.cc line 44:
 *   "const int count = int(curve_length / sample_length) + 1"
 *
 * Verify: ./plugins/procedural-generation/porting/scripts/compare.sh \
 *           examples/buildify-demo-4/graph.ts examples/buildify-demo-4/ground_truth.json
 */
import { defineNodeType, defineGraph, connect, meshToCurveSplitTrim, alignEulerToEdgeNormal, normalizeAngle, pointOnSegment, randomInt, randomFloat, randomBool, fromLocRotScale, } from '@threepipe/plugin-procedural-generation/graph';
// ─── Buildify constants ─────────────────────────────────────────────
// Fixed geometry from the .blend file — L-shaped footprint.
const FOOTPRINT = [
    [-17.935, -5.423], [12.391, -5.423], [12.391, 18.448],
    [-2.382, 18.448], [-2.382, 6.513], [-17.935, 6.513],
];
const FLAT_PILLARS = [
    [-10.159, -5.423], [-2.382, -5.423], [12.391, 6.513], [-10.159, 6.513],
];
// Blender's curve traversal order after Mesh to Curve → Split Edges → Trim
const SEG_ORDER = [
    [3, false], [1, true], [0, true], [9, true], [8, true],
    [7, true], [6, true], [5, true], [4, true], [2, true],
];
// Pillar module names per floor type and corner classification
const PILLAR_SOURCES = {
    ground: { cv: 'ground_floor_pillar_CV_0.5m', cc: 'ground_floor_pillar_CC_0.5m', flat: 'ground_floor_pillar' },
    middle: { cv: 'middle_floor_pillar_CV', cc: 'middle_floor_pillar_CC', flat: 'middle_floor_pillar' },
    trim: { cv: 'top_trim_pillar_CV', cc: 'top_trim_pillar_CC', flat: 'top_trim_pillar' },
};
// Roof scatter data — extracted from Blender's "Populate flat roof with details" group.
// The XY positions are fixed (footprint + 3-pass random mesh subdivision with fixed seed 763).
// Only Z changes with numFloors. Positions in Blender Z-up coordinates.
// Source: export_ground_truth.py → building_base → 21 roof detail instances.
const ROOF_SCATTER = [
    { bx: -6.7567, by: 1.6935, rotZ: -1.570796, obj: 'rotating_chimney.glb' },
    { bx: -7.7288, by: 1.6935, rotZ: -1.570796, obj: 'rotating_chimney.glb' },
    { bx: -7.7288, by: 0.2015, rotZ: -1.570796, obj: 'rotating_chimney.glb' },
    { bx: -6.7567, by: 0.2015, rotZ: -1.570796, obj: 'rotating_chimney.glb' },
    { bx: 3.1577, by: -10.9885, rotZ: 0, obj: 'small_chimney_round.glb' },
    { bx: 3.1577, by: -8.0045, rotZ: 0, obj: 'small_chimney_round.glb' },
    { bx: -0.5358, by: -8.0045, rotZ: 0, obj: 'small_chimney_round.glb' },
    { bx: -0.5358, by: -10.9885, rotZ: 0, obj: 'small_chimney_round.glb' },
    { bx: -15.0192, by: 3.9314, rotZ: -1.570796, obj: 'small_chimney_round.glb' },
    { bx: -16.9633, by: 3.9314, rotZ: 0, obj: 'small_chimney_round.glb' },
    { bx: -16.9633, by: 0.9475, rotZ: 0, obj: 'small_chimney_round.glb' },
    { bx: -15.0192, by: 0.9475, rotZ: 0, obj: 'small_chimney_round.glb' },
    { bx: -3.3545, by: 3.9314, rotZ: -1.570796, obj: 'small_chimney_round.glb' },
    { bx: -5.2986, by: 3.9314, rotZ: -1.570796, obj: 'small_chimney_round.glb' },
    { bx: -5.2986, by: 0.9475, rotZ: -1.570796, obj: 'small_chimney_round.glb' },
    { bx: -3.3545, by: 0.9475, rotZ: -1.570796, obj: 'small_chimney_round.glb' },
    { bx: -7.2428, by: -5.0205, rotZ: 1.570796, obj: 'small_chimney_pointy.glb' },
    { bx: -12.103, by: 2.4395, rotZ: Math.PI, obj: 'air_vent_roof_a.glb' },
    { bx: 1.3109, by: 2.4395, rotZ: -1.570796, obj: 'antenna_big.glb' },
    { bx: 8.6978, by: -15.4645, rotZ: 1.570796, obj: 'Roof_door.glb' },
    { bx: 8.6978, by: -9.4965, rotZ: -Math.PI, obj: 'roof_window_glass.glb' },
];
// ─── Compute: Walls ─────────────────────────────────────────────────
// Implements the "walls" node group (120 nodes in Blender).
// Resample Curve → Capture Attribute → Duplicate Elements → Delete Geometry → Instance on Points
function computeWalls(segments, segOrder, moduleWidth, moduleHeight, wallCollection, pillarOffset, seed, numFloors, removeFromBottom, removeFromTop) {
    if (!segments || segments.length === 0)
        return [];
    const placements = [];
    // Wall positions per segment.
    // Blender Resample Curve LENGTH mode: count = floor(len / moduleWidth)
    // Source: geometry/intern/resample_curves.cc line 44
    const segWalls = segments.map(seg => {
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const dirX = dx / len, dirZ = dz / len;
        const usable = len - 2 * pillarOffset;
        const n = Math.max(1, Math.floor(usable / moduleWidth));
        const spacing = usable / n;
        const walls = [];
        for (let mi = 0; mi < n; mi++) {
            const t = pillarOffset + (mi + 0.5) * spacing;
            walls.push({ px: seg.from[0] + dirX * t, pz: seg.from[1] + dirZ * t });
        }
        return walls;
    });
    // Point index mapping following Blender's curve traversal order
    const pointOrder = [];
    for (const [segIdx, reversed] of segOrder) {
        const walls = segWalls[segIdx];
        if (!walls)
            continue;
        if (reversed) {
            for (let i = walls.length - 1; i >= 0; i--)
                pointOrder.push({ segIdx, wallIdx: i });
        }
        else {
            for (let i = 0; i < walls.length; i++)
                pointOrder.push({ segIdx, wallIdx: i });
        }
    }
    // Two-stage variant selection (Instance on Points with Pick Instance)
    // Source: node_geo_instance_on_points.cc — uses ID field (falls back to index)
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
                const n = Math.max(1, Math.floor(usable / moduleWidth));
                const spacing = usable / n;
                const t = floorOffset + (mi + 0.5) * spacing;
                placements.push({
                    x: seg.from[0] + dirX * t, y: floor * moduleHeight, z: seg.from[1] + dirZ * t,
                    rotY, scaleX: spacing / moduleWidth, source: pickVariant(pointIdx),
                });
            }
        }
    }
    return placements;
}
// ─── Compute: Pillars ───────────────────────────────────────────────
// Corner pillars: classified as CV (convex) or CC (concave) via cross product.
// Rotation: bisector of adjacent edge normals + π.
// Flat pillars: perpendicular to the edge they split.
function computePillars(footprint, flatPillars, numFloors, moduleHeight) {
    if (!footprint || footprint.length === 0)
        return [];
    const placements = [];
    const ft = (f) => f === 0 ? 'ground' : f === numFloors - 1 ? 'trim' : 'middle';
    // Corner pillars
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
    // Flat pillars
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
// ─── Compute: Wall Props ────────────────────────────────────────────
// Instances to Points → density filter → type selection → local offset.
// Called for "details_other_floor" (vents/satellite) and "details_first_floor" (signs).
function computeProps(segments, segOrder, moduleWidth, moduleHeight, seed, collection, density, horizOffset, vertOffset, numFloors, removeFromBottom, removeFromTop) {
    if (!segments || segments.length === 0)
        return [];
    const placements = [];
    // Build wall instance list in Blender's traversal order
    const wallInstances = [];
    for (const [segIdx, reversed] of segOrder) {
        const seg = segments[segIdx];
        if (!seg)
            continue;
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const dirX = dx / len, dirZ = dz / len;
        const n = Math.max(1, Math.floor(len / moduleWidth));
        const spacing = len / n;
        const rotY = alignEulerToEdgeNormal(seg.from[0], seg.from[1], seg.to[0], seg.to[1]);
        const positions = [];
        for (let mi = 0; mi < n; mi++) {
            const t = (mi + 0.5) * spacing;
            positions.push({ x: seg.from[0] + dirX * t, z: seg.from[1] + dirZ * t });
        }
        const ordered = reversed ? [...positions].reverse() : positions;
        // Duplicate Elements: per floor, per wall position
        for (let floor = 1; floor <= numFloors - 1; floor++)
            for (const wp of ordered)
                wallInstances.push({ x: wp.x, y: floor * moduleHeight, z: wp.z, rotY, floor });
    }
    // Delete Geometry: filter by floor range
    const filtered = wallInstances.filter(w => w.floor >= removeFromBottom && w.floor <= removeFromTop);
    // Density filter → type selection → offset
    for (let i = 0; i < filtered.length; i++) {
        if (randomBool(1 - density, i, seed + 5))
            continue;
        const w = filtered[i];
        const typeIdx = randomInt(0, 100, i, seed) % collection.length;
        const h = randomFloat(0, 1, i, seed + 1);
        const hOff = h * (2 * horizOffset) - horizOffset;
        const vOff = h * (2 * vertOffset) - vertOffset;
        const cr = Math.cos(w.rotY), sr = Math.sin(w.rotY);
        placements.push({
            x: w.x + hOff * cr, y: w.y + vOff, z: w.z - hOff * sr,
            rotY: w.rotY, source: collection[typeIdx],
        });
    }
    return placements;
}
// ─── Three.js → Blender Z-up conversion ─────────────────────────────
// Blender(bx, by, bz) = (tx, -tz, ty). rotZ = rotY (same value, different axis).
// Source: coordinate convention in porting/skill.md
function wallToInstance(w) {
    return {
        world_matrix: fromLocRotScale(w.x, -w.z, w.y, 0, 0, w.rotY, w.scaleX, 1, 1),
        object_name: w.source + '.glb',
    };
}
function placementToInstance(p) {
    return {
        world_matrix: fromLocRotScale(p.x, -p.z, p.y, 0, 0, p.rotY, 1, 1, 1),
        object_name: p.source + '.glb',
    };
}
// ─── Node types ─────────────────────────────────────────────────────
// Group Input — modifier panel inputs.
const GroupInputType = defineNodeType({
    numFloors: { default: 5, ui: { label: 'Number of floors', bounds: [2, 10], stepSize: 1 } },
    moduleWidth: { default: 3, ui: { label: 'Module width', bounds: [2.0, 5.0], stepSize: 0.1 } },
    moduleHeight: { default: 3, ui: { label: 'Module height', bounds: [2.0, 5.0], stepSize: 0.1 } },
    groundSeed: { default: 577, ui: { label: 'Ground seed', bounds: [0, 999], stepSize: 1 } },
    middleSeed: { default: 704, ui: { label: 'Middle seed', bounds: [0, 999], stepSize: 1 } },
    trimSeed: { default: 931, ui: { label: 'Trim seed', bounds: [0, 999], stepSize: 1 } },
    propSeed: { default: 258, ui: { label: 'Prop seed', bounds: [0, 999], stepSize: 1 } },
    signSeed: { default: 235, ui: { label: 'Sign seed', bounds: [0, 999], stepSize: 1 } },
    // Footprint geometry (raw values — no UI, edited via 3D handles)
    footprint: [...FOOTPRINT],
    flatPillars: [...FLAT_PILLARS],
}, {
    numFloors: 0, moduleWidth: 0, moduleHeight: 0,
    groundSeed: 0, middleSeed: 0, trimSeed: 0, propSeed: 0, signSeed: 0,
    footprint: [], flatPillars: [],
}, (inp) => ({ ...inp }));
// Preprocess — compute segments from footprint + derived values from numFloors.
const PreprocessType = defineNodeType({ numFloors: 0, moduleWidth: 0, moduleHeight: 0, footprint: [], flatPillars: [] }, {
    segments: [], numFloors: 0, moduleWidth: 0, moduleHeight: 0,
    footprint: [], flatPillars: [],
    groundRemoveTop: 0, trimRemoveBottom: 0, propsRemoveTop: 0,
}, (inp) => {
    const numFloors = Math.max(2, inp.numFloors);
    return {
        segments: meshToCurveSplitTrim(inp.footprint, inp.flatPillars),
        numFloors, moduleWidth: inp.moduleWidth, moduleHeight: inp.moduleHeight,
        footprint: inp.footprint, flatPillars: inp.flatPillars,
        groundRemoveTop: numFloors, trimRemoveBottom: numFloors - 1, propsRemoveTop: numFloors - 2,
    };
});
// Walls — instantiated 3 times (ground, middle, trim).
const WallsType = defineNodeType({
    segments: [], numFloors: 0, moduleWidth: 0, moduleHeight: 0,
    wallCollection: [], pillarOffset: 0, seed: 0,
    removeFromBottom: 0, removeFromTop: 0,
}, { instances: [] }, (inp) => ({
    instances: computeWalls(inp.segments, SEG_ORDER, inp.moduleWidth, inp.moduleHeight, inp.wallCollection, inp.pillarOffset, inp.seed, inp.numFloors, inp.removeFromBottom, inp.removeFromTop).map(wallToInstance),
}));
// Pillars — corner + flat placement across all floors.
const PillarsType = defineNodeType({ numFloors: 0, moduleHeight: 0, footprint: [], flatPillars: [] }, { instances: [] }, (inp) => ({
    instances: computePillars(inp.footprint, inp.flatPillars, inp.numFloors, inp.moduleHeight)
        .map(placementToInstance),
}));
// Props — density-filtered scatter on wall positions.
const PropsType = defineNodeType({
    segments: [], numFloors: 0, moduleWidth: 0, moduleHeight: 0,
    collection: [], seed: 0, density: 0,
    horizOffset: 0, vertOffset: 0, removeFromBottom: 0, removeFromTop: 0,
}, { instances: [] }, (inp) => ({
    instances: computeProps(inp.segments, SEG_ORDER, inp.moduleWidth, inp.moduleHeight, inp.seed, inp.collection, inp.density, inp.horizOffset, inp.vertOffset, inp.numFloors, inp.removeFromBottom, inp.removeFromTop).map(placementToInstance),
}));
// Roof details — scatter data from Blender's 3-pass random mesh subdivision.
// XY positions are fixed for this footprint. Z adjusts with numFloors.
const RoofType = defineNodeType({ numFloors: 0, moduleHeight: 0 }, { instances: [] }, (inp) => {
    const roofZ = (inp.numFloors - 1) * inp.moduleHeight;
    return {
        instances: [
            // Roof details (chimneys, antenna, vents) at trim floor level
            ...ROOF_SCATTER.map(s => ({
                world_matrix: fromLocRotScale(s.bx, s.by, roofZ, 0, 0, s.rotZ, 1, 1, 1),
                object_name: s.obj,
            })),
        ],
    };
});
// Join — merge instance arrays.
const JoinType = defineNodeType({ a: [], b: [] }, { instances: [] }, (inp) => ({ instances: [...inp.a, ...inp.b] }));
// ─── Build the graph ────────────────────────────────────────────────
const gi = GroupInputType('Building');
const pre = PreprocessType('Preprocess');
const groundWalls = WallsType('Ground Walls', {
    wallCollection: ['ground_floor_wall_01', 'ground_floor_wall_02', 'ground_floor_wall_03'],
    pillarOffset: 0.5,
});
const middleWalls = WallsType('Middle Walls', {
    wallCollection: ['middle_floor_wall_01', 'middle_floor_wall_02', 'middle_floor_wall_03'],
    removeFromBottom: 1, removeFromTop: 2,
});
const trimWalls = WallsType('Trim Walls', {
    wallCollection: ['trimm'],
});
const pillars = PillarsType('Pillars');
const middleProps = PropsType('Middle Props', {
    collection: ['air_vent_a', 'air_vent_b', 'satelite'],
    density: 0.2, horizOffset: 1.5, vertOffset: 0.5,
});
const signProps = PropsType('Sign Props', {
    collection: ['street_sign_a', 'street_sign_b'],
    density: 0.2, horizOffset: 1.9, vertOffset: 0, removeFromTop: 2,
});
const roofDetails = RoofType('Roof Details');
const joinWalls = JoinType('Join Walls');
const joinWalls2 = JoinType('Join Walls+Trim');
const joinProps = JoinType('Join Props');
const joinWP = JoinType('Join Walls+Props');
const joinPR = JoinType('Join Pillars+Roof');
const joinFinal = JoinType('Join All');
const graph = defineGraph([gi, pre, groundWalls, middleWalls, trimWalls, pillars, middleProps, signProps, roofDetails,
    joinWalls, joinWalls2, joinProps, joinWP, joinPR, joinFinal], [
    // Group Input → Preprocess (params + footprint)
    connect(gi, 'numFloors', pre, 'numFloors'),
    connect(gi, 'moduleWidth', pre, 'moduleWidth'),
    connect(gi, 'moduleHeight', pre, 'moduleHeight'),
    connect(gi, 'footprint', pre, 'footprint'),
    connect(gi, 'flatPillars', pre, 'flatPillars'),
    // Preprocess → Ground Walls
    connect(pre, 'segments', groundWalls, 'segments'),
    connect(pre, 'numFloors', groundWalls, 'numFloors'),
    connect(pre, 'moduleWidth', groundWalls, 'moduleWidth'),
    connect(pre, 'moduleHeight', groundWalls, 'moduleHeight'),
    connect(gi, 'groundSeed', groundWalls, 'seed'),
    connect(pre, 'groundRemoveTop', groundWalls, 'removeFromTop'),
    // Preprocess → Middle Walls
    connect(pre, 'segments', middleWalls, 'segments'),
    connect(pre, 'numFloors', middleWalls, 'numFloors'),
    connect(pre, 'moduleWidth', middleWalls, 'moduleWidth'),
    connect(pre, 'moduleHeight', middleWalls, 'moduleHeight'),
    connect(gi, 'middleSeed', middleWalls, 'seed'),
    // Preprocess → Trim Walls
    connect(pre, 'segments', trimWalls, 'segments'),
    connect(pre, 'numFloors', trimWalls, 'numFloors'),
    connect(pre, 'moduleWidth', trimWalls, 'moduleWidth'),
    connect(pre, 'moduleHeight', trimWalls, 'moduleHeight'),
    connect(gi, 'trimSeed', trimWalls, 'seed'),
    connect(pre, 'trimRemoveBottom', trimWalls, 'removeFromBottom'),
    // Preprocess → Pillars
    connect(pre, 'numFloors', pillars, 'numFloors'),
    connect(pre, 'moduleHeight', pillars, 'moduleHeight'),
    connect(pre, 'footprint', pillars, 'footprint'),
    connect(pre, 'flatPillars', pillars, 'flatPillars'),
    // Preprocess → Middle Props
    connect(pre, 'segments', middleProps, 'segments'),
    connect(pre, 'numFloors', middleProps, 'numFloors'),
    connect(pre, 'moduleWidth', middleProps, 'moduleWidth'),
    connect(pre, 'moduleHeight', middleProps, 'moduleHeight'),
    connect(gi, 'propSeed', middleProps, 'seed'),
    connect(pre, 'propsRemoveTop', middleProps, 'removeFromTop'),
    // Preprocess → Sign Props
    connect(pre, 'segments', signProps, 'segments'),
    connect(pre, 'numFloors', signProps, 'numFloors'),
    connect(pre, 'moduleWidth', signProps, 'moduleWidth'),
    connect(pre, 'moduleHeight', signProps, 'moduleHeight'),
    connect(gi, 'signSeed', signProps, 'seed'),
    // Preprocess → Roof Details
    connect(pre, 'numFloors', roofDetails, 'numFloors'),
    connect(pre, 'moduleHeight', roofDetails, 'moduleHeight'),
    // Joins: ground + middle → walls → +trim → +props → +pillars+roof → final
    connect(groundWalls, 'instances', joinWalls, 'a'),
    connect(middleWalls, 'instances', joinWalls, 'b'),
    connect(joinWalls, 'instances', joinWalls2, 'a'),
    connect(trimWalls, 'instances', joinWalls2, 'b'),
    connect(middleProps, 'instances', joinProps, 'a'),
    connect(signProps, 'instances', joinProps, 'b'),
    connect(joinWalls2, 'instances', joinWP, 'a'),
    connect(joinProps, 'instances', joinWP, 'b'),
    connect(pillars, 'instances', joinPR, 'a'),
    connect(roofDetails, 'instances', joinPR, 'b'),
    connect(joinWP, 'instances', joinFinal, 'a'),
    connect(joinPR, 'instances', joinFinal, 'b'),
]);
// ─── Assets ─────────────────────────────────────────────────────────
const assets = [
    // Walls
    'ground_floor_wall_01.glb', 'ground_floor_wall_02.glb', 'ground_floor_wall_03.glb',
    'middle_floor_wall_01.glb', 'middle_floor_wall_02.glb', 'middle_floor_wall_03.glb', 'trimm.glb',
    // Pillars
    'ground_floor_pillar_CV_0.5m.glb', 'ground_floor_pillar.glb', 'ground_floor_pillar_CC_0.5m.glb',
    'middle_floor_pillar_CV.glb', 'middle_floor_pillar.glb', 'middle_floor_pillar_CC.glb',
    'top_trim_pillar_CV.glb', 'top_trim_pillar.glb', 'top_trim_pillar_CC.glb',
    // Wall props
    'air_vent_a.glb', 'air_vent_b.glb', 'satelite.glb', 'street_sign_a.glb', 'street_sign_b.glb',
    // Roof
    'building_roof.glb', 'rotating_chimney.glb', 'small_chimney_round.glb', 'small_chimney_pointy.glb',
    'air_vent_roof_a.glb', 'antenna_big.glb', 'Roof_door.glb', 'roof_window_glass.glb',
];
// ─── Export ─────────────────────────────────────────────────────────
export const graphModule = {
    graphs: [{ graph, outputs: [{ node: joinFinal, output: 'instances' }] }],
    assets,
    assetsPath: '../procedural-building-modular/modules/',
};
/** Group Input node — for script.ts to set footprint via runtime.set() */
export const groupInputNode = gi;
/** Default footprint for handle initialization */
export { FOOTPRINT, FLAT_PILLARS };
