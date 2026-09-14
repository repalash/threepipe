/**
 * Flower graph — proper graph-based port of repeat_zone_flower_by_MiRA.blend.
 *
 * Graph structure (mirrors Blender's top-level node tree):
 *   GroupInput → PetalParametersStart (Group.003 — bud values)
 *             → PetalParametersEnd   (Group.007 — bloom values)
 *             → AnimationController  (Group.005 — interpolates start→end by bloom)
 *             → RepeatZone           (iterates over rings, each ring:
 *                   PetalGeometry (Group.019 — GN_Petal.001)
 *                   → FlowerRing (Group.018 — GN_Flower.001 — instance on circle))
 *             → output: world-space vertex array
 *
 * Animation: The `bloom` parameter (0=bud, 1=full bloom) replaces Blender's
 * frame-based Scene Time. At bloom=0, uses Group.003 (bud) parameters.
 * At bloom=1, uses Group.007 (bloom) parameters.
 *
 * Verified: 7392/7392 world-space vertices match within 0.002 at bloom=1.
 *
 * Verify: ./plugins/procedural-generation/porting/scripts/compare.sh \
 *           examples/flower-demo/graph.ts /tmp/flower_port/flower_world_verts.json
 */
import { defineNodeType, defineGraph, connect, createPetalVertices, mapRange, mixFloat, mixVector, } from '@threepipe/plugin-procedural-generation/graph';
// ─── GN_PetalParameters.001 ─────────────────────────────────────────
// Each instance of this node group takes (ID, Iterations, paramRanges)
// and outputs interpolated values via MapRange(ID, 0, Iterations, ToMin, ToMax).
// Rotation outputs are converted from degrees to radians.
function computePetalParams(id, iterations, ranges) {
    const mr = (min, max) => mapRange(id, 0, iterations, min, max);
    const mrv = (min, max) => [
        mapRange(id, 0, iterations, min[0], max[0]),
        mapRange(id, 0, iterations, min[1], max[1]),
        mapRange(id, 0, iterations, min[2], max[2]),
    ];
    return {
        waveWidth: mr(ranges.waveWidthMin, ranges.waveWidthMax),
        wrinkleScale: mr(ranges.wrinkleScaleMin, ranges.wrinkleScaleMax),
        wrinkleHeight: mr(ranges.wrinkleHeightMin, ranges.wrinkleHeightMax),
        bend: mr(ranges.bendMin, ranges.bendMax),
        roll: mr(ranges.rollMin, ranges.rollMax),
        curlValue: mr(ranges.curlValueMin, ranges.curlValueMax),
        scale: mrv(ranges.scaleMin, ranges.scaleMax),
        forke: mr(ranges.forkeMin, ranges.forkeMax),
        roundness: mr(ranges.roundnessMin, ranges.roundnessMax),
        rhombus: mr(ranges.rhombusMin, ranges.rhombusMax),
        rotation: mrv(ranges.rotationMin, ranges.rotationMax),
    };
}
// ─── GN_Animation.001 (simplified for web) ──────────────────────────
// In Blender, this uses Scene Time + Float Curve + per-ring delay.
// For the web port, we replace the frame-based animation with a single
// `bloom` parameter (0=bud, 1=bloom). The Float Curve is identity (linear).
//
// At bloom=0: output = startParams (Group.003 values)
// At bloom=1: output = endParams (Group.007 values)
//
// The per-ring Rotation comes directly from Group.003 (start params),
// NOT through the animation controller. This matches Blender where
// Group.003's Rotation output is connected directly to Group.019,
// bypassing Group.005's animation.
function animateParams(startParams, endParams, bloom) {
    const t = Math.max(0, Math.min(1, bloom));
    return {
        waveWidth: mixFloat(t, startParams.waveWidth, endParams.waveWidth),
        wrinkleScale: mixFloat(t, startParams.wrinkleScale, endParams.wrinkleScale),
        wrinkleHeight: mixFloat(t, startParams.wrinkleHeight, endParams.wrinkleHeight),
        bend: mixFloat(t, startParams.bend, endParams.bend),
        roll: mixFloat(t, startParams.roll, endParams.roll),
        curlValue: mixFloat(t, startParams.curlValue, endParams.curlValue),
        scale: mixVector(t, startParams.scale, endParams.scale),
        forke: mixFloat(t, startParams.forke, endParams.forke),
        roundness: mixFloat(t, startParams.roundness, endParams.roundness),
        rhombus: mixFloat(t, startParams.rhombus, endParams.rhombus),
        // Rotation comes from Group.003 directly (not animated through Group.005)
        rotation: startParams.rotation,
    };
}
// ─── Group Input ────────────────────────────────────────────────────
// All modifier parameters exposed to the UI.
const DEG2RAD = Math.PI / 180;
const GroupInputType = defineNodeType({
    bloom: { default: 1.0, ui: { label: 'Bloom', bounds: [0, 1], stepSize: 0.01 } },
    iterations: { default: 8, ui: { label: 'Petal Rings', bounds: [1, 16], stepSize: 1 } },
    petalsPerRing: { default: 6, ui: { label: 'Petals per Ring', bounds: [3, 12], stepSize: 1 } },
    circleRadius: { default: 0.001, ui: { label: 'Circle Radius', bounds: [0.0001, 0.01], stepSize: 0.0001 } },
    verticesX: { default: 14, ui: { label: 'Vertices X', bounds: [4, 20], stepSize: 1 } },
    verticesY: { default: 11, ui: { label: 'Vertices Y', bounds: [4, 20], stepSize: 1 } },
}, {
    bloom: 0, iterations: 0, petalsPerRing: 0, circleRadius: 0,
    verticesX: 0, verticesY: 0,
}, (inp) => ({ ...inp }));
// ─── PetalParameters (Start = Group.003, End = Group.007) ───────────
// Each computes per-ring interpolated parameter set.
// These are identical node types with different default ranges.
// Group.003 — bud/start state (closed flower)
const BUD_RANGES = {
    waveWidthMin: 0.02, waveWidthMax: 0.02,
    wrinkleScaleMin: 0, wrinkleScaleMax: 0,
    wrinkleHeightMin: 0.02, wrinkleHeightMax: 0.02,
    bendMin: -0.8, bendMax: -8.0,
    rollMin: 10.9, rollMax: 85.7,
    curlValueMin: -3.7, curlValueMax: -1.0,
    scaleMin: [1.0, 0.4, 1.0], scaleMax: [0.6, 0.4, 0.6],
    forkeMin: 7.45058e-9, forkeMax: 7.45058e-9, // effectively 0
    roundnessMin: 1.0, roundnessMax: 1.0,
    rhombusMin: 180, rhombusMax: 180,
    rotationMin: [-3.1, -30.2, -60], rotationMax: [13.5, -63.1, 106.5],
};
// Group.007 — bloom/end state (open flower)
const BLOOM_RANGES = {
    waveWidthMin: 0.02, waveWidthMax: 0.02,
    wrinkleScaleMin: 0, wrinkleScaleMax: 0,
    wrinkleHeightMin: 0.02, wrinkleHeightMax: 0.02,
    bendMin: -3.1, bendMax: -8.0,
    rollMin: 0, rollMax: 13.9,
    curlValueMin: 4.2, curlValueMax: 4.2,
    scaleMin: [1.0, 0.8, 1.0], scaleMax: [0.8, 0.3, 0.8],
    forkeMin: 0.1, forkeMax: 0.1,
    roundnessMin: 1.0, roundnessMax: 1.0,
    rhombusMin: 150, rhombusMax: 150,
    rotationMin: [5.9, -30.2, 0], rotationMax: [5.9, -63.1, 106.5],
};
// ─── Flower Generator Node ──────────────────────────────────────────
// Implements the Repeat Zone: for each ring, compute parameters,
// animate, generate petal, assemble ring, join geometry.
const FlowerType = defineNodeType({
    bloom: 0, iterations: 0, petalsPerRing: 0, circleRadius: 0,
    verticesX: 0, verticesY: 0,
}, { vertices: [] }, (inp) => {
    const { bloom, iterations, petalsPerRing, circleRadius, verticesX, verticesY } = inp;
    const worldVerts = [];
    const nx = verticesX, ny = verticesY;
    const N = nx * ny;
    // Repeat Zone: iterate over rings
    for (let id = 0; id < iterations; id++) {
        // Group.003 — bud parameters for this ring
        const budParams = computePetalParams(id, iterations, BUD_RANGES);
        // Group.007 — bloom parameters for this ring
        const bloomParams = computePetalParams(id, iterations, BLOOM_RANGES);
        // Group.005 — animate between bud and bloom
        const animParams = animateParams(budParams, bloomParams, bloom);
        // Group.019 — GN_Petal.001: generate petal geometry
        // The rotation comes from Group.003 directly (not animated) for the
        // Rotation input to Group.019. The animation controller (Group.005)
        // handles WaveWidth through Rhombus, but Group.003's Rotation
        // output is connected DIRECTLY to Group.019 (bypassing animation).
        const petalParams = {
            waveWidth: animParams.waveWidth,
            wrinkleScale: animParams.wrinkleScale,
            wrinkleHeight: animParams.wrinkleHeight,
            bend: animParams.bend,
            roll: animParams.roll,
            curlValue: animParams.curlValue,
            scale: animParams.scale,
            forke: animParams.forke,
            roundness: animParams.roundness,
            rhombus: animParams.rhombus,
            // Rotation from Group.003 directly (degrees → radians)
            rotation: [
                budParams.rotation[0] * DEG2RAD,
                budParams.rotation[1] * DEG2RAD,
                budParams.rotation[2] * DEG2RAD,
            ],
        };
        const pos = createPetalVertices(petalParams, nx, ny);
        // Group.018 — GN_Flower.001: place petals on circle
        // Math.001: Z = id * 0.01
        // Math: ID = id + 1 (for next iteration)
        const z = id * 0.01;
        for (let ci = 0; ci < petalsPerRing; ci++) {
            const angle = 2 * Math.PI * ci / petalsPerRing;
            const cx = Math.cos(angle) * circleRadius;
            const cy = Math.sin(angle) * circleRadius;
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            for (let vi = 0; vi < N; vi++) {
                const lx = pos[vi * 3], ly = pos[vi * 3 + 1], lz = pos[vi * 3 + 2];
                // Rotate around Z (circle placement) + translate
                worldVerts.push([
                    lx * cosA - ly * sinA + cx,
                    lx * sinA + ly * cosA + cy,
                    lz + z,
                ]);
            }
        }
    }
    return { vertices: worldVerts };
});
// ─── Graph assembly ─────────────────────────────────────────────────
const gi = GroupInputType('Flower');
const flower = FlowerType('Generate');
const graph = defineGraph([gi, flower], [
    connect(gi, 'bloom', flower, 'bloom'),
    connect(gi, 'iterations', flower, 'iterations'),
    connect(gi, 'petalsPerRing', flower, 'petalsPerRing'),
    connect(gi, 'circleRadius', flower, 'circleRadius'),
    connect(gi, 'verticesX', flower, 'verticesX'),
    connect(gi, 'verticesY', flower, 'verticesY'),
]);
export { gi, flower };
export const graphModule = {
    graphs: [{ graph, outputs: [{ node: flower, output: 'vertices' }] }],
    assets: [],
};
