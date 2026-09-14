/**
 * Pebble Scattering — Port of tmp/pebble_scattering.blend
 *
 * Uses the exact Blender DistributePointsOnFaces algorithm (ported from
 * source/blender/nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc)
 * for deterministic, bit-accurate point placement.
 *
 * Node graph (from extract_geo_nodes.py):
 *
 * Large pebbles (GEO-pebble): POISSON distribution
 *   Math.003: Factor * 100 → Density Max
 *   DistributePointsOnFaces (POISSON): densityMax, densityFactor=pebbles_L, seed=0, minDist=0.02
 *   RandomRotation.001 (FLOAT_VECTOR): [-pi,pi], seed=0
 *   RandomValue (FLOAT): min=0.25, max=0.6, seed=0
 *   InstanceOnPoints → GEO-pebble
 *
 * Medium pebbles (GEO-pebble.004): RANDOM distribution
 *   Math.004: MediumMask * 100
 *   Math.005: Math.004 * Factor → Density
 *   DistributePointsOnFaces.001 (RANDOM): density from field, seed=0
 *   RandomRotation.002 (FLOAT_VECTOR): [-pi,pi], seed=0
 *   RandomValue.002 (FLOAT): min=0.25, max=0.45, seed=0
 *   InstanceOnPoints.001 → GEO-pebble.004
 *
 * Small pebbles (GEO-pebble.002): RANDOM distribution
 *   Math.006: Factor * 100
 *   Math.007: SmallMask * Math.006 → Density
 *   DistributePointsOnFaces.002 (RANDOM): density from field, seed=0
 *   RandomRotation (FLOAT_VECTOR): [-pi,pi], seed=0
 *   RandomValue.003 (FLOAT): min=0.1, max=0.35, seed=2
 *   InstanceOnPoints.002 → GEO-pebble.002
 *
 * All 3 pipelines join into a single GeometryNodeJoinGeometry output.
 * Also: Group Input.004 connects geometry directly to Join (the ground mesh itself).
 *
 * Modifier overrides (from summary.json):
 *   Input_12 (Large Mask): per-vertex attribute "pebbles_L"
 *   Input_7  (Factor): 5.0
 *   Input_13 (Medium Mask): per-vertex attribute "pebbles_M"
 *   Input_9  (Factor): 8.0
 *   Input_14 (Small Mask): per-vertex attribute "pebbles_S"
 *   Input_11 (Factor): 10.0
 *
 * Vertex group attributes (pebbles_L/M/S) are not available in the exported GLB.
 * We pass per-vertex density factors when available, otherwise use a uniform
 * average value. The density factor is applied inside distributePointsOnFaces.
 *
 * Verify: ./plugins/procedural-generation/porting/scripts/compare.sh \
 *           examples/pebble-scatter/graph.ts examples/pebble-scatter/ground_truth.json
 */
import { defineNodeType, defineGraph, connect, distributePointsOnFaces, fromLocRotScale, randomFloat, randomVector, } from '@threepipe/plugin-procedural-generation/graph';
// ─── Pebble scatter computation ──────────────────────────────────────
/**
 * Scatter pebbles on a ground mesh and produce GeneratedInstance[].
 *
 * Uses the exact Blender distributePointsOnFaces port for point placement.
 * For each scattered point:
 * 1. distributePointsOnFaces() generates positions using Blender's exact algorithm
 *    (LCG RNG, round_probabilistic, per-triangle seeding with noise::hash)
 * 2. randomVector() generates full 3D rotation (EulerXYZ in [-pi, pi])
 * 3. randomFloat() generates uniform scale
 * 4. fromLocRotScale() builds the 4x4 world matrix
 *
 * The point IDs from distributePointsOnFaces are used as the `id` parameter
 * for randomVector/randomFloat, matching Blender's implicit ID field behavior.
 */
function scatterPebbles(groundGeometry, method, density, densityFactor, minDistance, seed, scaleMin, scaleMax, scaleSeed, rotationSeed, objectName) {
    if (!groundGeometry)
        return [];
    if (density <= 0)
        return [];
    const options = {
        method,
        density,
        densityFactor: densityFactor ?? undefined,
        minDistance: method === 'POISSON' ? minDistance : undefined,
        seed,
    };
    const result = distributePointsOnFaces(groundGeometry, options);
    const instances = [];
    for (let i = 0; i < result.positions.length; i++) {
        const pt = result.positions[i];
        const id = result.ids[i];
        // Random rotation: full 3D EulerXYZ in [-PI, PI] per component
        // Blender uses FLOAT_VECTOR Random Value with min=[-pi,-pi,-pi], max=[pi,pi,pi]
        // The ID field from distribute is used as the per-point ID
        const rot = randomVector([-Math.PI, -Math.PI, -Math.PI], [Math.PI, Math.PI, Math.PI], id, rotationSeed);
        // Random uniform scale
        const s = randomFloat(scaleMin, scaleMax, id, scaleSeed);
        // Build world matrix in Blender Z-up coordinates.
        // The ground mesh geometry is in three.js Y-up (from glTF export).
        // Convert back to Blender Z-up: bx = x, by = -z, bz = y
        const bx = pt.x;
        const by = -pt.z;
        const bz = pt.y;
        const wm = fromLocRotScale(bx, by, bz, rot[0], rot[1], rot[2], s, s, s);
        instances.push({ world_matrix: wm, object_name: objectName });
    }
    return instances;
}
// ─── Graph nodes ─────────────────────────────────────────────────────
/**
 * Group Input — all user-facing parameters.
 * groundGeometry is set by the viewer at runtime (not a UI control).
 *
 * Parameters match the Blender modifier panel:
 * - Large: Factor (5), Mask (pebbles_L vertex group, avg ~0.286)
 * - Medium: Factor (8), Mask (pebbles_M vertex group, avg ~0.334)
 * - Small: Factor (10), Mask (pebbles_S vertex group, avg ~0.572)
 */
const GroupInputType = defineNodeType({
    groundGeometry: null,
    // Large pebbles (Poisson) — Blender: Density Max = Factor * 100
    // Density Factor = pebbles_L vertex group (per-vertex, avg ~0.286)
    largeFactor: { default: 5, ui: { label: 'Large Factor', bounds: [0, 20], stepSize: 0.5 } },
    largeMask: { default: 0.286, ui: { label: 'Large Mask (avg pebbles_L)', bounds: [0, 1], stepSize: 0.01 } },
    // Medium pebbles (Random) — Blender: Density = pebbles_M * 100 * Factor
    // pebbles_M is per-vertex (avg ~0.334). We use the average as a uniform scalar.
    mediumFactor: { default: 8, ui: { label: 'Medium Factor', bounds: [0, 20], stepSize: 0.5 } },
    mediumMask: { default: 0.334, ui: { label: 'Medium Mask (avg pebbles_M)', bounds: [0, 1], stepSize: 0.01 } },
    // Small pebbles (Random) — Blender: Density = pebbles_S * Factor * 100
    // pebbles_S is per-vertex (avg ~0.572). We use the average as a uniform scalar.
    smallFactor: { default: 10, ui: { label: 'Small Factor', bounds: [0, 20], stepSize: 0.5 } },
    smallMask: { default: 0.572, ui: { label: 'Small Mask (avg pebbles_S)', bounds: [0, 1], stepSize: 0.01 } },
    // Seed for distribution
    seed: { default: 0, ui: { label: 'Seed', bounds: [0, 999], stepSize: 1 } },
}, {
    groundGeometry: null,
    largeFactor: 0, largeMask: 0,
    mediumFactor: 0, mediumMask: 0,
    smallFactor: 0, smallMask: 0,
    seed: 0,
}, (inp) => ({ ...inp }));
/**
 * Large Pebbles — Poisson distribution.
 *
 * Blender node graph:
 *   Math.003: Factor * 100 → Density Max
 *   DistributePointsOnFaces (POISSON): densityMax, densityFactor=pebbles_L, minDist=0.02, seed=0
 *   Object: GEO-pebble, scale [0.25, 0.6], rotation seed=0, scale seed=0
 */
const LargePebblesType = defineNodeType({
    groundGeometry: null,
    largeFactor: 0,
    largeMask: 0,
    seed: 0,
}, { instances: [] }, (inp) => {
    // Math.003: Factor * 100 → Density Max
    const densityMax = inp.largeFactor * 100;
    // For POISSON mode:
    // - density = Density Max (for initial oversampling)
    // - densityFactor = pebbles_L vertex group (per-vertex)
    // Since we don't have per-vertex weights from the GLB, we create a
    // uniform density factor array filled with the average mask value.
    // This preserves the POISSON post-elimination rejection step.
    let densityFactor = null;
    if (inp.groundGeometry && inp.largeMask < 1.0) {
        const posAttr = inp.groundGeometry.getAttribute('position');
        if (posAttr) {
            densityFactor = new Float32Array(posAttr.count).fill(inp.largeMask);
        }
    }
    return {
        instances: scatterPebbles(inp.groundGeometry, 'POISSON', densityMax, // Density Max for oversampling
        densityFactor, // uniform density factor from avg pebbles_L weight
        0.02, // minDistance from node: 0.02
        inp.seed, // seed
        0.25, 0.6, // scale min/max
        0, // scale seed (Random Value, Seed=0)
        0, // rotation seed (Random Rotation.001, Seed=0)
        'object_GEO-pebble.glb'),
    };
});
/**
 * Medium Pebbles — Random distribution.
 *
 * Blender node graph:
 *   Math.004: MediumMask * 100
 *   Math.005: Math.004 * Factor → Density (per-vertex field in Blender)
 *   DistributePointsOnFaces.001 (RANDOM): density from field, seed=0
 *   Object: GEO-pebble.004, scale [0.25, 0.45], rotation seed=0, scale seed=0
 */
const MediumPebblesType = defineNodeType({
    groundGeometry: null,
    mediumMask: 0,
    mediumFactor: 0,
    seed: 0,
}, { instances: [] }, (inp) => {
    // Math.004: pebbles_M * 100
    // Math.005: Math.004 * Factor
    // In Blender, pebbles_M is a per-vertex attribute. Without per-vertex data,
    // we use the average weight as a uniform scalar.
    // density = avg_pebbles_M * 100 * factor
    const density = inp.mediumMask * 100 * inp.mediumFactor;
    return {
        instances: scatterPebbles(inp.groundGeometry, 'RANDOM', density, // uniform density: avg_mask * 100 * factor
        null, // no per-vertex densityFactor for RANDOM
        0, // minDistance (not used in RANDOM mode)
        inp.seed, // seed
        0.25, 0.45, // scale min/max
        0, // scale seed (Random Value.002, Seed=0)
        0, // rotation seed (Random Rotation.002, Seed=0)
        'object_GEO-pebble_004.glb'),
    };
});
/**
 * Small Pebbles — Random distribution.
 *
 * Blender node graph:
 *   Math.006: Factor * 100
 *   Math.007: SmallMask * Math.006 → Density (per-vertex field in Blender)
 *   DistributePointsOnFaces.002 (RANDOM): density from field, seed=0
 *   Object: GEO-pebble.002, scale [0.1, 0.35], rotation seed=0, **scale seed=2**
 */
const SmallPebblesType = defineNodeType({
    groundGeometry: null,
    smallFactor: 0,
    smallMask: 0,
    seed: 0,
}, { instances: [] }, (inp) => {
    // Math.006: Factor * 100
    // Math.007: pebbles_S * Math.006
    // In Blender, pebbles_S is per-vertex. density = avg_pebbles_S * factor * 100
    const density = inp.smallMask * inp.smallFactor * 100;
    return {
        instances: scatterPebbles(inp.groundGeometry, 'RANDOM', density, // uniform density: avg_mask * factor * 100
        null, // no per-vertex densityFactor for RANDOM
        0, // minDistance (not used in RANDOM mode)
        inp.seed, // seed
        0.1, 0.35, // scale min/max
        2, // scale seed (Random Value.003, Seed=2)
        0, // rotation seed (Random Rotation, Seed=0)
        'object_GEO-pebble_002.glb'),
    };
});
/**
 * Join Geometry — concatenate all 3 pebble types.
 * Matches GeometryNodeJoinGeometry order: Large → Medium → Small
 * (from the link order in the node tree).
 */
const JoinType = defineNodeType({
    large: [],
    medium: [],
    small: [],
}, { instances: [] }, (inp) => ({
    instances: [...inp.large, ...inp.medium, ...inp.small],
}));
// ─── Build graph ─────────────────────────────────────────────────────
export const groupInputNode = GroupInputType('Group Input');
const largePebbles = LargePebblesType('Large Pebbles');
const mediumPebbles = MediumPebblesType('Medium Pebbles');
const smallPebbles = SmallPebblesType('Small Pebbles');
const joinNode = JoinType('Join Geometry');
const graph = defineGraph([groupInputNode, largePebbles, mediumPebbles, smallPebbles, joinNode], [
    // Ground geometry to all scatter nodes
    connect(groupInputNode, 'groundGeometry', largePebbles, 'groundGeometry'),
    connect(groupInputNode, 'groundGeometry', mediumPebbles, 'groundGeometry'),
    connect(groupInputNode, 'groundGeometry', smallPebbles, 'groundGeometry'),
    // Large pebble params
    connect(groupInputNode, 'largeFactor', largePebbles, 'largeFactor'),
    connect(groupInputNode, 'largeMask', largePebbles, 'largeMask'),
    connect(groupInputNode, 'seed', largePebbles, 'seed'),
    // Medium pebble params
    connect(groupInputNode, 'mediumMask', mediumPebbles, 'mediumMask'),
    connect(groupInputNode, 'mediumFactor', mediumPebbles, 'mediumFactor'),
    connect(groupInputNode, 'seed', mediumPebbles, 'seed'),
    // Small pebble params
    connect(groupInputNode, 'smallFactor', smallPebbles, 'smallFactor'),
    connect(groupInputNode, 'smallMask', smallPebbles, 'smallMask'),
    connect(groupInputNode, 'seed', smallPebbles, 'seed'),
    // Join all
    connect(largePebbles, 'instances', joinNode, 'large'),
    connect(mediumPebbles, 'instances', joinNode, 'medium'),
    connect(smallPebbles, 'instances', joinNode, 'small'),
]);
// ─── Export ──────────────────────────────────────────────────────────
export const graphModule = {
    graphs: [{
            graph,
            outputs: [{ node: joinNode, output: 'instances' }],
        }],
    assets: [
        'object_GEO-pebble.glb',
        'object_GEO-pebble_004.glb',
        'object_GEO-pebble_002.glb',
        'ground.glb',
    ],
    assetsPath: './assets/',
};
