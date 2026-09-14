/**
 * Flowers on Building — Composition demo.
 *
 * All computation is Node-safe (no three.js imports in graph evaluation).
 * Outputs:
 * - Building: GeneratedInstance[] (walls, pillars, props from GLB assets)
 * - Flower scatter: {vertices, indices, placements}[] (procedural mesh + positions)
 *
 * The viewer converts mesh data to BufferGeometry.
 * The comparison script verifies vertices.
 */
import { defineNodeType, defineGraph, connect, meshToCurveSplitTrim, randomBool, fromLocRotScale, } from '@threepipe/plugin-procedural-generation/graph';
// Flower petal math (Node-safe, from the package)
import { getParamsForRing, createPetalVertices } from '@threepipe/plugin-procedural-generation/graph';
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
// ─── Building node (uses buildify functions inline — all Node-safe) ─
import { normalizeAngle, alignEulerToEdgeNormal, pointOnSegment, randomInt, } from '@threepipe/plugin-procedural-generation/graph';
const PILLAR_SOURCES = {
    ground: { cv: 'ground_floor_pillar_CV_0.5m', cc: 'ground_floor_pillar_CC_0.5m', flat: 'ground_floor_pillar' },
    middle: { cv: 'middle_floor_pillar_CV', cc: 'middle_floor_pillar_CC', flat: 'middle_floor_pillar' },
    trim: { cv: 'top_trim_pillar_CV', cc: 'top_trim_pillar_CC', flat: 'top_trim_pillar' },
};
function computeWalls(segments, moduleWidth, moduleHeight, wallCollection, pillarOffset, seed, numFloors, removeFromBottom, removeFromTop) {
    const placements = [];
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
    const pointOrder = [];
    for (const [segIdx, reversed] of SEG_ORDER) {
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
    const pickVariant = (pointIdx) => {
        if (wallCollection.length === 1)
            return wallCollection[0];
        return wallCollection[randomInt(0, 200, randomInt(0, 100, pointIdx, 0), seed) % wallCollection.length];
    };
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
            placements.push({ x: curr[0], y: floor * moduleHeight, z: curr[1], rotY: pillarRot, scaleX: 1, source: PILLAR_SOURCES[ft(floor)][type] });
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
            placements.push({ x: fp[0], y: floor * moduleHeight, z: fp[1], rotY: fpRotY, scaleX: 1, source: PILLAR_SOURCES[ft(floor)].flat });
    }
    return placements;
}
// ─── Graph nodes ────────────────────────────────────────────────────
const GroupInputType = defineNodeType({
    numFloors: { default: 5, ui: { label: 'Floors', bounds: [2, 10], stepSize: 1 } },
    moduleWidth: { default: 3.5, ui: { label: 'Module width', bounds: [2, 5], stepSize: 0.1 } },
    moduleHeight: { default: 3.02, ui: { label: 'Module height', bounds: [2, 5], stepSize: 0.1 } },
    groundSeed: { default: 577, ui: { label: 'Ground seed', bounds: [0, 999], stepSize: 1 } },
    middleSeed: { default: 704, ui: { label: 'Middle seed', bounds: [0, 999], stepSize: 1 } },
    trimSeed: { default: 931, ui: { label: 'Trim seed', bounds: [0, 999], stepSize: 1 } },
    flowerIterations: { default: 6, ui: { label: 'Flower rings', bounds: [1, 12], stepSize: 1 } },
    flowerDensity: { default: 0.15, ui: { label: 'Flower density', bounds: [0, 1], stepSize: 0.05 } },
    flowerSeed: { default: 42, ui: { label: 'Flower seed', bounds: [0, 999], stepSize: 1 } },
    flowerScale: { default: 2.0, ui: { label: 'Flower scale', bounds: [0.5, 5], stepSize: 0.1 } },
}, {
    numFloors: 0, moduleWidth: 0, moduleHeight: 0,
    groundSeed: 0, middleSeed: 0, trimSeed: 0,
    flowerIterations: 0, flowerDensity: 0, flowerSeed: 0, flowerScale: 0,
}, (inp) => ({ ...inp }));
// Building node — GeneratedInstance[]
const BuildingType = defineNodeType({ numFloors: 0, moduleWidth: 0, moduleHeight: 0, groundSeed: 0, middleSeed: 0, trimSeed: 0 }, { instances: [] }, (inp) => {
    const segments = meshToCurveSplitTrim(FOOTPRINT, FLAT_PILLARS);
    const nf = Math.max(2, inp.numFloors);
    const gw = computeWalls(segments, inp.moduleWidth, inp.moduleHeight, ['ground_floor_wall_01', 'ground_floor_wall_02', 'ground_floor_wall_03'], 0.5, inp.groundSeed, nf, 0, nf);
    const mw = computeWalls(segments, inp.moduleWidth, inp.moduleHeight, ['middle_floor_wall_01', 'middle_floor_wall_02', 'middle_floor_wall_03'], 0, inp.middleSeed, nf, 1, 2);
    const tw = computeWalls(segments, inp.moduleWidth, inp.moduleHeight, ['trimm'], 0, inp.trimSeed, nf, nf - 1, 0);
    const pillars = computePillars(FOOTPRINT, FLAT_PILLARS, nf, inp.moduleHeight);
    return { instances: [...gw, ...mw, ...tw, ...pillars].map(p => ({
            world_matrix: fromLocRotScale(p.x, -p.z, p.y, 0, 0, p.rotY, p.scaleX, 1, 1),
            object_name: p.source + '.glb',
        })) };
});
// Flower scatter node — vertex data + placement positions (all Node-safe)
const FlowerScatterType = defineNodeType({
    iterations: 0, density: 0, seed: 0, scale: 0,
    numFloors: 0, moduleWidth: 0, moduleHeight: 0,
}, { scatter: null }, (inp) => {
    const iterations = Math.max(1, inp.iterations);
    const segments = meshToCurveSplitTrim(FOOTPRINT, FLAT_PILLARS);
    const nf = Math.max(2, inp.numFloors);
    const topFloorY = (nf - 1) * inp.moduleHeight;
    const rings = [];
    const circleVerts = 6;
    const circleRadius = 0.001;
    for (let id = 0; id < iterations; id++) {
        const pp = getParamsForRing(id, iterations);
        const verts = createPetalVertices(pp);
        const nx = 14, ny = 11;
        // Build indices
        const indices = [];
        for (let ix = 0; ix < nx - 1; ix++) {
            for (let iy = 0; iy < ny - 1; iy++) {
                const a = ix * ny + iy, b = (ix + 1) * ny + iy;
                const c = (ix + 1) * ny + (iy + 1), d = ix * ny + (iy + 1);
                indices.push(a, b, d, b, c, d);
            }
        }
        // Compute scatter placements for this ring
        const z = id * 0.01;
        const placements = [];
        const rotations = [];
        for (let si = 0; si < segments.length; si++) {
            const seg = segments[si];
            const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1];
            const len = Math.sqrt(dx * dx + dz * dz);
            const dirX = dx / len, dirZ = dz / len;
            const n = Math.max(1, Math.round(len / inp.moduleWidth));
            const spacing = len / n;
            for (let mi = 0; mi < n; mi++) {
                const pointId = si * 1000 + mi;
                if (!randomBool(inp.density, pointId, inp.seed))
                    continue;
                const t = (mi + 0.5) * spacing;
                const wx = seg.from[0] + dirX * t;
                const wz = seg.from[1] + dirZ * t;
                // For each petal on the circle
                for (let ci = 0; ci < circleVerts; ci++) {
                    const angle = (2 * Math.PI * ci) / circleVerts;
                    const cx = Math.cos(angle) * circleRadius;
                    const cy = Math.sin(angle) * circleRadius;
                    // Position: building wall position (three.js Y-up) + circle offset + ring Z
                    placements.push([wx + cx, topFloorY + inp.moduleHeight * 0.3 + z, wz + cy]);
                    rotations.push(angle);
                }
            }
        }
        // Convert Float64Array to plain number[] for serializability
        const vertsArray = Array.from(verts);
        rings.push({ vertices: vertsArray, indices, verticesX: nx, verticesY: ny, placements, rotations });
    }
    return { scatter: { rings, material: { color: 0xcc3355, doubleSided: true }, scale: inp.scale } };
});
// ─── Build graph ────────────────────────────────────────────────────
const gi = GroupInputType('Scene');
const building = BuildingType('Building');
const flowerScatter = FlowerScatterType('Flower Scatter');
const graph = defineGraph([gi, building, flowerScatter], [
    connect(gi, 'numFloors', building, 'numFloors'),
    connect(gi, 'moduleWidth', building, 'moduleWidth'),
    connect(gi, 'moduleHeight', building, 'moduleHeight'),
    connect(gi, 'groundSeed', building, 'groundSeed'),
    connect(gi, 'middleSeed', building, 'middleSeed'),
    connect(gi, 'trimSeed', building, 'trimSeed'),
    connect(gi, 'flowerIterations', flowerScatter, 'iterations'),
    connect(gi, 'flowerDensity', flowerScatter, 'density'),
    connect(gi, 'flowerSeed', flowerScatter, 'seed'),
    connect(gi, 'flowerScale', flowerScatter, 'scale'),
    connect(gi, 'numFloors', flowerScatter, 'numFloors'),
    connect(gi, 'moduleWidth', flowerScatter, 'moduleWidth'),
    connect(gi, 'moduleHeight', flowerScatter, 'moduleHeight'),
]);
// ─── Export ─────────────────────────────────────────────────────────
const assets = [
    'ground_floor_wall_01.glb', 'ground_floor_wall_02.glb', 'ground_floor_wall_03.glb',
    'middle_floor_wall_01.glb', 'middle_floor_wall_02.glb', 'middle_floor_wall_03.glb', 'trimm.glb',
    'ground_floor_pillar_CV_0.5m.glb', 'ground_floor_pillar.glb', 'ground_floor_pillar_CC_0.5m.glb',
    'middle_floor_pillar_CV.glb', 'middle_floor_pillar.glb', 'middle_floor_pillar_CC.glb',
    'top_trim_pillar_CV.glb', 'top_trim_pillar.glb', 'top_trim_pillar_CC.glb',
    'air_vent_a.glb', 'air_vent_b.glb', 'satelite.glb', 'street_sign_a.glb', 'street_sign_b.glb',
];
export const graphModule = {
    graphs: [{
            graph,
            outputs: [
                { node: building, output: 'instances' },
                { node: flowerScatter, output: 'scatter' },
            ],
        }],
    assets,
    assetsPath: '../procedural-building-modular/modules/',
};
