/**
 * Flower Scatter V5 — Port of tmp/flower_scattering.blend
 *
 * Geometry Nodes graph: "Flower Field System"
 *
 * Top-level structure:
 *   GroupInput → Grass System (long + medium) + Flower System → Join Geometry
 *
 * Grass System:
 *   Two "Grass Scattering" groups with POISSON distribution:
 *   - Long grass: density*100/3, minDist=0.04, collection=EN-grass.long_NEW (3 members)
 *     seed passed directly from Grass System's seed input
 *   - Medium grass: density*100, minDist=0.01, collection=EN-grass.medium_NEW (4 members)
 *     seed = mainSeed + 1 (Math.002: ADD seed + 1)
 *   Each Grass Scattering sub-group:
 *     DPF(POISSON) → Instance on Points with collection (Separate Children=false)
 *     Rotation from "Random Orientation" sub-group:
 *       randomVector([-tilt,tilt], id, seed+37) → rotateEulerAxisAngle(LOCAL, Z-axis, randomFloat(0,2*PI,id,seed))
 *       Orientation seed = scatterSeed + 100 (Math.015 in Grass Scattering)
 *     Scale: (randomFloat(0.5,2.0, id, seed+40) + colorRamp(noise)) / 2
 *       ColorRamp: pos0=0.5082, pos1=0.8459 (black→white, LINEAR)
 *       NoiseTexture: 3D FBM, scale=1, detail=1.5, roughness=0.5, distortion=-3.1
 *
 * Flower System:
 *   DPF(POISSON, density*100, distance, seed) → Delete Geometry (density map) →
 *   Separate Geometry (bluebell mask) → two Instance on Points branches
 *   - Density map filter: Image Texture.002 (flowers-density_map.png) sampled at UV
 *     Math LESS_THAN: densityMapValue < randomFloat(0,1,id,0) → delete where true
 *   - Bluebell mask split: Image Texture.001 (bluebell-mask.png) sampled at UV
 *     Math.001 LESS_THAN: maskValue < randomFloat(0,1,id,seed+20) →
 *       Selection (true = low mask = dandelion area) → dandelions
 *       Inverted (false = high mask = bluebell area) → bluebells
 *   - Bluebells: Pick Instance (5 variants), scale randomFloat(1,2,id,seed+30), rotation from Random Orientation(tilt=0.1, seed+50)
 *   - Dandelions: Pick Instance (4 variants), scale randomFloat(1,2,id,seed+40), rotation from Random Orientation(tilt=0.1, seed+50)
 *   - Instance Index: Reroute.017/018 (default=0, not connected) → implicit index (point index)
 *
 * Verify: npx tsx --tsconfig plugins/procedural-generation/porting/scripts/tsconfig.json examples/flower-scatter-v5/verify.ts
 */
import { defineNodeType, defineGraph, connect, distributePointsOnFaces, fromLocRotScale, yUpToZUp, randomFloat, randomVector, rotateEulerAxisAngleLocal, sampleImageTexture, colorRampLinear2, interpolateScatterUVs, hash_to_float2, } from '@threepipe/plugin-procedural-generation/graph';
// ─── Random Orientation sub-group ──────────────────────────────────
/**
 * Port of the "Random Orientation" Blender node group.
 *
 * Node graph (from Grass Scattering/Group sub-tree):
 *   Math.008: MULTIPLY(tilt, -1) → min tilt = -tilt
 *   Math.007: RADIANS(360) → conceptually 2*PI (but actually a fixed constant)
 *     Looking at the node: Math.007 = RADIANS, value=360 → 360 * PI/180 = 2*PI
 *     But the property shows operation as... let me re-read.
 *     Actually: Math.007 has default_value=360 and output is linked.
 *     From the Random Orientation sub-tree, Math.007 computes max for the
 *     Z-axis random angle. Its inputs: Value=360, Value_001=0.5.
 *     Since the operation isn't specified beyond RADIANS in some versions...
 *     The existing implementation uses [0, 2*PI] which is RADIANS(360).
 *
 *   Random Value.005 (FLOAT_VECTOR): min=[-tilt,-tilt,-tilt], max=[tilt,tilt,tilt], seed=seed+37
 *   Random Value.004 (FLOAT): min=0, max=RADIANS(360)=2*PI, seed=seed
 *   Rotate Euler (AXIS_ANGLE, LOCAL): rotation=tiltVector, axis=[0,0,1], angle=zAngle
 *
 * Returns Euler XYZ rotation angles.
 */
function randomOrientation(tilt, seed, id) {
    // Random Value.005 (FLOAT_VECTOR): tilt euler in [-tilt, tilt] per axis
    // Seed = Math.Value (seed + 37): Group Input.Input_4 -> Math (ADD, +37) -> Random Value.005.Seed
    const tiltEuler = randomVector([-tilt, -tilt, -tilt], [tilt, tilt, tilt], id, seed + 37);
    // Random Value.004 (FLOAT): Z-axis rotation angle in [0, 2*PI]
    // Seed = Group Input.Input_4 = seed (directly connected)
    // Max = Math.007 = RADIANS(360) = 2*PI
    const zAngle = randomFloat(0, Math.PI * 2, id, seed);
    // Rotate Euler (AXIS_ANGLE, LOCAL): apply Z rotation on top of tilt
    return rotateEulerAxisAngleLocal(tiltEuler, [0, 0, 1], zAngle);
}
// ─── ColorRamp constants ─────────────────────────────────────────
// Extracted from Blender: Grass Scattering/ColorRamp
// LINEAR interpolation, 2 stops: black at 0.5082, white at 0.8459
const COLORRAMP_POS0 = 0.508197009563446;
const COLORRAMP_POS1 = 0.8459020256996155;
// ─── Grass Scattering ──────────────────────────────────────────────
/**
 * Port of "Grass Scattering" Blender node group.
 *
 * Each scatter point instances the ENTIRE collection (Separate Children=false).
 * So each scatter point creates one GeneratedInstance per collection member.
 *
 * From node graph links in Grass Scattering sub-tree:
 *   Group Input → DPF(POISSON)
 *   Group Input.005 → Math.015 (ADD seed + 100) → Group (Random Orientation).Input_4
 *   Group Input.005 → Group (Random Orientation).Input_0 (Random Tilt = tilt passed through)
 *   Wait, re-reading:
 *     Group Input.005.Input_11 -> Math.015.Value (seed + 100) → the seed to Random Orientation
 *     Group Input.005.Input_15 -> Group.Input_0 (Random Tilt → passed to orientation)
 *   Group Input.001 → Math.011 (ADD seed + 40) → Random Value.Seed (scale random)
 *   Random Value (FLOAT, min=0.5, max=2.0)
 *   Noise Texture → ColorRamp → Math.009 (ADD random + colorRamp)
 *   Math.009 → Math.010 (DIVIDE by 2) → Instance on Points.Scale
 *
 * Scale computation:
 *   baseScale = randomFloat(0.5, 2.0, id, seed+40)
 *   noiseContrib = colorRampLinear2(noiseTextureSample, 0.5082, 0.8459)
 *   scale = (baseScale + noiseContrib) / 2
 *
 * Since we don't have an exact 3D NoiseTexture FBM port, we approximate the noise
 * contribution using hash^4 biased toward 0 (matching GT statistics). The actual
 * Noise Texture (FBM, distortion=-3.1) produces values mostly below the ColorRamp
 * threshold, giving a mean contribution of ~0.085. The hash^4 approximation
 * produces a similar distribution (mean ~0.094).
 */
function grassScattering(groundGeometry, memberFiles, distanceMin, densityMax, randomTilt, seed) {
    if (!groundGeometry || densityMax <= 0)
        return [];
    const result = distributePointsOnFaces(groundGeometry, {
        method: 'POISSON',
        density: densityMax,
        minDistance: distanceMin,
        seed,
    });
    const instances = [];
    for (let i = 0; i < result.positions.length; i++) {
        const pos = result.positions[i];
        const id = result.ids[i];
        // Random Orientation: tilt + Z rotation
        // Math.015: seed + 100 is the orientation seed
        const rot = randomOrientation(randomTilt, seed + 100, id);
        // Scale computation:
        // Math.011: seed + 40 → Random Value seed
        // randomFloat(0.5, 2.0, id, seed+40) for base random scale
        // Noise Texture (3D FBM, scale=1, detail=1.5, roughness=0.5, distortion=-3.1)
        //   → colorRampLinear2(noiseValue, 0.5082, 0.8459) for noise contribution
        // Math.009 (ADD): baseScale + noiseContrib
        // Math.010 (DIVIDE by 2): (baseScale + noiseContrib) / 2
        //
        // We don't have an exact 3D FBM port. Approximate the noise texture
        // by hashing the point ID. The actual Blender Noise Texture (3D FBM,
        // scale=1, detail=1.5, roughness=0.5, distortion=-3.1) produces values
        // that are heavily biased toward the low end due to the large negative
        // distortion. After colorRampLinear2, the mean contribution is ~0.085
        // (from GT analysis). Using hash^4 approximates this distribution —
        // most values fall below the colorRamp threshold (0.508), producing 0,
        // with occasional higher values.
        const baseScale = randomFloat(0.5, 2.0, id, seed + 40);
        const noiseHash = hash_to_float2(id, seed + 99);
        const noiseApprox = noiseHash * noiseHash * noiseHash * noiseHash; // hash^4 bias
        const noiseContrib = colorRampLinear2(noiseApprox, COLORRAMP_POS0, COLORRAMP_POS1);
        const s = (baseScale + noiseContrib) / 2;
        // Convert Y-up (from GLB geometry) to Blender Z-up
        const [bx, by, bz] = yUpToZUp(pos.x, pos.y, pos.z);
        // Create one instance per collection member (Separate Children=false)
        for (const memberFile of memberFiles) {
            const wm = fromLocRotScale(bx, by, bz, rot[0], rot[1], rot[2], s, s, s);
            instances.push({ world_matrix: wm, object_name: memberFile });
        }
    }
    return instances;
}
// ─── Flower System ─────────────────────────────────────────────────
/**
 * Port of "Flower System" Blender node group.
 *
 * Pipeline:
 * 1. DPF POISSON on ground mesh
 *    - Math.004: density * 100 → DPF.Density Max
 *    - DPF.Distance Min = distance (Input_13)
 *    - DPF.Seed = seed (Input_5)
 *
 * 2. Delete Geometry: remove points where density map value < random
 *    - Image Texture.002: samples flowers-density_map at UV (Input_16)
 *    - Random Value (FLOAT, min=0, max=1): seed=0 (not connected to any seed Math node)
 *    - Math (LESS_THAN, use_clamp=true): densityValue < randomValue
 *    - Delete Geometry (mode=ALL, domain=POINT): removes where selection is true
 *
 * 3. Separate Geometry by bluebell mask:
 *    - Image Texture.001: samples bluebell-mask at UV (Input_16)
 *    - Random Value.001 (FLOAT, min=0, max=1): seed = seed + 20 (Math.011)
 *    - Math.001 (LESS_THAN): maskValue < randomValue
 *    - Separate Geometry:
 *      - Selection (where LESS_THAN is true = low mask = NOT bluebell) → dandelions
 *      - Inverted (where LESS_THAN is false = high mask = bluebell area) → bluebells
 *
 * 4. Two Instance on Points branches:
 *    - Bluebells (from Inverted/Reroute.004 → Instance on Points.001):
 *      Collection: GRP-bluebell (Separate Children=true, Pick Instance=true)
 *      Instance Index: Reroute.017 (default=0, not linked) → implicit index
 *      Scale: randomFloat(1.0, 2.0, id, seed+30) (Math.014: seed + 30)
 *      Rotation: Random Orientation(tilt=0.1, seed+50) via Reroute.014/015/Euler to Rotation
 *
 *    - Dandelions (from Selection/Reroute.002 → Instance on Points.002):
 *      Collection: GRP-dandelion (Separate Children=true, Pick Instance=true)
 *      Instance Index: Reroute.018 (default=0, not linked) → implicit index
 *      Scale: randomFloat(1.0, 2.0, id, seed+40) (Math.013: seed + 40)
 *      Rotation: Same Random Orientation via Reroute.014/016/Euler to Rotation.001
 */
function flowerSystem(groundGeometry, bluebellMembers, dandelionMembers, distance, density, seed, textures) {
    if (!groundGeometry || density <= 0)
        return [];
    // DPF POISSON scatter
    // Math.004: density * 100
    const result = distributePointsOnFaces(groundGeometry, {
        method: 'POISSON',
        density: density * 100,
        minDistance: distance,
        seed,
    });
    if (result.positions.length === 0)
        return [];
    // ── Step 1: Get UV coords for each scattered point ──
    // In Blender, Image Texture nodes sample at the scattered point's interpolated UV.
    // distributePointsOnFaces returns baryCoords and triIndices, which we use to
    // interpolate the mesh's UV attribute at each scatter point.
    const scatterUVs = interpolateScatterUVs(groundGeometry, result.baryCoords, result.triIndices);
    // ── Step 2: Filter by density map (Delete Geometry) ──
    // Image Texture.002: sample density map at UV
    // Random Value (FLOAT, 0-1): seed=0 (not connected to any seed offset Math node)
    // Math (LESS_THAN, use_clamp=true): densityValue < rv → true means low density → delete
    const filteredIndices = [];
    for (let i = 0; i < result.positions.length; i++) {
        const id = result.ids[i];
        // Sample density map at interpolated UV
        let densityValue = 1.0;
        if (textures.densityMap && scatterUVs) {
            const [u, v] = scatterUVs[i];
            densityValue = sampleImageTexture(textures.densityMap, u, v);
        }
        // Random Value (FLOAT, 0-1): seed=0
        const rv = randomFloat(0, 1, id, 0);
        // Math LESS_THAN: densityValue < rv → true means delete
        const shouldDelete = densityValue < rv;
        if (!shouldDelete) {
            filteredIndices.push(i);
        }
    }
    if (filteredIndices.length === 0)
        return [];
    // ── Step 3: Separate by bluebell mask ──
    // Image Texture.001: sample bluebell mask at UV
    // Random Value.001 (FLOAT, 0-1): seed = seed + 20 (Math.011: ADD seed + 20)
    // Math.001 (LESS_THAN): mask_value < random → true where mask is LOW (not bluebell)
    // Separate Geometry:
    //   Selection (where LESS_THAN is true) → dandelion points (Reroute.002)
    //   Inverted (where LESS_THAN is false) → bluebell points (Reroute.004)
    const bluebellIndices = [];
    const dandelionIndices = [];
    for (const i of filteredIndices) {
        const id = result.ids[i];
        // Sample bluebell mask at interpolated UV
        let maskValue = 0.5;
        if (textures.bluebellMask && scatterUVs) {
            const [u, v] = scatterUVs[i];
            maskValue = sampleImageTexture(textures.bluebellMask, u, v);
        }
        const rv = randomFloat(0, 1, id, seed + 20);
        const lessThan = maskValue < rv;
        if (lessThan) {
            // Selection → dandelions
            dandelionIndices.push(i);
        }
        else {
            // Inverted → bluebells
            bluebellIndices.push(i);
        }
    }
    // ── Step 4: Instance on Points for both flower types ──
    // Random Orientation: tilt=0.1 (Group.Input_0 default), seed=mainSeed+50
    //   Math.015 in Flower System: Group Input.005.Input_5 (seed) + 50 → Group.Input_4
    // Scale bluebells: randomFloat(1.0, 2.0, id, seed+30) — Math.014: seed + 30
    // Scale dandelions: randomFloat(1.0, 2.0, id, seed+40) — Math.013: seed + 40
    // Pick Instance: members[implicitIndex % members.length]
    //   Instance Index from Reroute.017/018 (default=0, not connected) → implicit index
    //   After SeparateGeometry, indices are reindexed 0-based for each output.
    const instances = [];
    // Bluebells (from Inverted → Reroute.004 → Instance on Points.001)
    for (let j = 0; j < bluebellIndices.length; j++) {
        const i = bluebellIndices[j];
        const pos = result.positions[i];
        const id = result.ids[i];
        const rot = randomOrientation(0.1, seed + 50, id);
        const s = randomFloat(1.0, 2.0, id, seed + 30);
        const [bx, by, bz] = yUpToZUp(pos.x, pos.y, pos.z);
        // Pick Instance: use j (index within the bluebell subset) for implicit index
        const memberFile = bluebellMembers[j % bluebellMembers.length];
        const wm = fromLocRotScale(bx, by, bz, rot[0], rot[1], rot[2], s, s, s);
        instances.push({ world_matrix: wm, object_name: memberFile });
    }
    // Dandelions (from Selection → Reroute.002 → Instance on Points.002)
    for (let j = 0; j < dandelionIndices.length; j++) {
        const i = dandelionIndices[j];
        const pos = result.positions[i];
        const id = result.ids[i];
        const rot = randomOrientation(0.1, seed + 50, id);
        const s = randomFloat(1.0, 2.0, id, seed + 40);
        const [bx, by, bz] = yUpToZUp(pos.x, pos.y, pos.z);
        const memberFile = dandelionMembers[j % dandelionMembers.length];
        const wm = fromLocRotScale(bx, by, bz, rot[0], rot[1], rot[2], s, s, s);
        instances.push({ world_matrix: wm, object_name: memberFile });
    }
    return instances;
}
// ─── Graph nodes ─────────────────────────────────────────────────
/** Group Input — all user-facing parameters from Blender's modifier panel. */
export const GroupInputType = defineNodeType({
    groundGeometry: null,
    textures: { densityMap: null, bluebellMask: null },
    // Grass parameters
    grassDensity: { default: 3.0, ui: { label: 'Grass Density', bounds: [0.1, 20], stepSize: 0.1 } },
    grassRandomTilt: { default: 0.2, ui: { label: 'Grass Random Tilt', bounds: [0, 1], stepSize: 0.01 } },
    // Flower parameters
    flowerDistance: { default: 0.05, ui: { label: 'Flower Distance', bounds: [0.01, 0.5], stepSize: 0.01 } },
    flowerDensity: { default: 0.1, ui: { label: 'Flower Density', bounds: [0.01, 1], stepSize: 0.01 } },
    // Seed
    seed: { default: 0, ui: { label: 'Seed', bounds: [0, 999], stepSize: 1 } },
}, {
    groundGeometry: null,
    textures: { densityMap: null, bluebellMask: null },
    grassDensity: 0, grassRandomTilt: 0,
    flowerDistance: 0, flowerDensity: 0,
    seed: 0,
}, (inp) => ({ ...inp }));
// ─── Grass collection members (sorted alphabetically) ──────────
// EN-grass.long_NEW: 3 members (Separate Children=false → all placed at each point)
const grassLongMembers = [
    'object_GEO-leaf_grass-long_003.glb',
    'object_GEO-leaf_grass-long_004.glb',
    'object_GEO-leaf_grass-long_005.glb',
];
// EN-grass.medium_NEW: 4 members (Separate Children=false → all placed at each point)
const grassMediumMembers = [
    'object_GEO-leaf_grass_001.glb',
    'object_GEO-leaf_grass_002.glb',
    'object_GEO-leaf_grass_003.glb',
    'object_GEO-leaf_grass_008.glb',
];
// ─── Flower collection members (sorted alphabetically by BLI_strcasecmp_natural) ──
// GRP-bluebell: 5 members (Separate Children=true, Pick Instance=true)
const bluebellMembers = [
    'object_EN-plants-bluebell_002.glb',
    'object_EN-plants-bluebell_006.glb',
    'object_EN-plants-bluebell_007.glb',
    'object_EN-plants-bluebell_2.glb',
    'object_EN-plants-bluebell_5.glb',
];
// GRP-dandelion: 4 members (Separate Children=true, Pick Instance=true)
const dandelionMembers = [
    'object_EN-plants-dandelion_1.glb',
    'object_EN-plants-dandelion_2.glb',
    'object_EN-plants-dandelion_3.glb',
    'object_EN-plants-dandelion_4.glb',
];
/**
 * Grass System node — combines long and medium grass scattering.
 *
 * From the Grass System sub-tree:
 *   Group Input.Input_7 (Density) → Math (MULTIPLY * 100) → Reroute.001
 *   Math.001 (DIVIDE): (density*100) / 3 → long grass Group.001.Input_7 (Density Max)
 *   Reroute.001 → medium grass Group.Input_7 (Density Max)
 *
 *   Long grass (Group): collection=EN-grass.long_NEW, minDist=0.04 (Input_9 default)
 *     seed = Group Input.Input_13 (mainSeed)
 *
 *   Medium grass (Group.001): collection=EN-grass.medium_NEW, minDist=0.01 (Input_9 default)
 *     seed = Math.002 (ADD mainSeed + 1)
 *
 *   Join order: Group.Output_3 → Join Geometry.001, Group.001.Output_3 → Join Geometry.001
 *   The first link (Group) comes first in the link list, then Group.001.
 *   Join Geometry.001 output → both Group Output.Output_3 and Group Output.Output_11 (Grass Only)
 */
const GrassSystemType = defineNodeType({
    groundGeometry: null,
    grassDensity: 0,
    grassRandomTilt: 0,
    seed: 0,
}, { instances: [] }, (inp) => {
    // Math: density * 100
    const densityX100 = inp.grassDensity * 100;
    // Math.001: densityX100 / 3 (for long grass)
    const longDensity = densityX100 / 3;
    // Long grass (Group): Grass Scattering with EN-grass.long_NEW
    // seed = mainSeed (directly connected)
    const longGrass = grassScattering(inp.groundGeometry, grassLongMembers, 0.04, // Distance Min default from Grass Scattering Group Input (Input_9=0.04)
    longDensity, // Density Max = density*100/3
    inp.grassRandomTilt, inp.seed);
    // Medium grass (Group.001): Grass Scattering with EN-grass.medium_NEW
    // Seed: Math.002 = seed + 1
    const mediumGrass = grassScattering(inp.groundGeometry, grassMediumMembers, 0.01, // Distance Min from Grass Scattering (Group.001's Input_9 value)
    densityX100, // Density Max = density*100
    inp.grassRandomTilt, inp.seed + 1);
    // Join order: links show Group.Output first, then Group.001.Output
    // So: long grass first, then medium grass
    return { instances: [...longGrass, ...mediumGrass] };
});
/**
 * Flower System node — scatter bluebells and dandelions with texture-based filtering.
 */
const FlowerSystemType = defineNodeType({
    groundGeometry: null,
    textures: { densityMap: null, bluebellMask: null },
    flowerDistance: 0,
    flowerDensity: 0,
    seed: 0,
}, { instances: [] }, (inp) => {
    return {
        instances: flowerSystem(inp.groundGeometry, bluebellMembers, dandelionMembers, inp.flowerDistance, inp.flowerDensity, inp.seed, inp.textures),
    };
});
/**
 * Join Geometry — combines grass + flowers.
 * From top-level links:
 *   Reroute.001 (geometry pass-through) → Join Geometry (for display, not included in instances)
 *   Group.Output_11 (Grass Only) → Join Geometry
 *   Group.001.Output_15 (Flowers Only) → Join Geometry
 */
const JoinType = defineNodeType({
    grass: [],
    flowers: [],
}, { instances: [] }, (inp) => ({
    instances: [...inp.grass, ...inp.flowers],
}));
// ─── Build graph ─────────────────────────────────────────────────
export const groupInputNode = GroupInputType('Group Input');
const grassSystem = GrassSystemType('Grass System');
const flowerSystem_ = FlowerSystemType('Flower System');
const joinNode = JoinType('Join Geometry');
const graph = defineGraph([groupInputNode, grassSystem, flowerSystem_, joinNode], [
    // Ground geometry
    connect(groupInputNode, 'groundGeometry', grassSystem, 'groundGeometry'),
    connect(groupInputNode, 'groundGeometry', flowerSystem_, 'groundGeometry'),
    // Textures
    connect(groupInputNode, 'textures', flowerSystem_, 'textures'),
    // Grass params
    connect(groupInputNode, 'grassDensity', grassSystem, 'grassDensity'),
    connect(groupInputNode, 'grassRandomTilt', grassSystem, 'grassRandomTilt'),
    connect(groupInputNode, 'seed', grassSystem, 'seed'),
    // Flower params
    connect(groupInputNode, 'flowerDistance', flowerSystem_, 'flowerDistance'),
    connect(groupInputNode, 'flowerDensity', flowerSystem_, 'flowerDensity'),
    connect(groupInputNode, 'seed', flowerSystem_, 'seed'),
    // Join
    connect(grassSystem, 'instances', joinNode, 'grass'),
    connect(flowerSystem_, 'instances', joinNode, 'flowers'),
]);
// ─── Export ──────────────────────────────────────────────────────
export const graphModule = {
    graphs: [{
            graph,
            outputs: [{ node: joinNode, output: 'instances' }],
        }],
    assets: [
        // Grass long
        ...grassLongMembers,
        // Grass medium
        ...grassMediumMembers,
        // Bluebells
        ...bluebellMembers,
        // Dandelions
        ...dandelionMembers,
        // Ground
        'ground.glb',
    ],
    assetsPath: './assets/',
};
// ─── Node.js runtime init (for compare_graph.ts) ────────────────
/**
 * Called by compare_graph.ts to set up external inputs (ground geometry, textures).
 * Only runs in Node.js — browser viewer handles this in script.ts.
 */
export async function initRuntime(rt, assetsDir) {
    const fs = await import('fs');
    const path = await import('path');
    // Load ground geometry
    const groundPath = path.join(assetsDir, 'ground.glb');
    if (!fs.existsSync(groundPath)) {
        console.warn('initRuntime: ground.glb not found at', groundPath);
        return;
    }
    const { DummyRenderManager } = await import('../../plugins/procedural-generation/src/utils/node-polyfill');
    const { ThreeViewer } = await import('threepipe');
    const canvas = globalThis.document.createElement('canvas');
    canvas.id = 'init-rt';
    const viewer = new ThreeViewer({ canvas, rmClass: DummyRenderManager, tonemap: false });
    const buffer = fs.readFileSync(groundPath);
    const file = new File([buffer], 'ground.glb', { type: 'model/gltf-binary' });
    const result = await viewer.assetManager.addAsset(file);
    const obj = Array.isArray(result) ? result[0] : result;
    let groundGeometry = null;
    if (obj?.traverse) {
        const { Matrix4 } = await import('threepipe');
        const identity = new Matrix4();
        // Apply world matrix to match browser's getWorldGeometry behavior
        obj.updateMatrixWorld(true);
        obj.traverse((child) => {
            if (child.isMesh && child.geometry && !groundGeometry) {
                const wm = child.matrixWorld;
                if (wm && !wm.equals(identity)) {
                    groundGeometry = child.geometry.clone();
                    groundGeometry.applyMatrix4(wm);
                }
                else {
                    groundGeometry = child.geometry;
                }
            }
        });
    }
    viewer.dispose();
    if (!groundGeometry) {
        console.warn('initRuntime: Could not extract geometry from ground.glb');
        return;
    }
    // Load textures using sharp
    let textures = { densityMap: null, bluebellMask: null };
    try {
        const sharp = (await import('sharp')).default;
        for (const [key, filename] of [
            ['densityMap', 'texture_flowers-density_map.png'],
            ['bluebellMask', 'texture_bluebell-mask.png'],
        ]) {
            const texPath = path.join(assetsDir, filename);
            if (fs.existsSync(texPath)) {
                const img = sharp(texPath);
                const meta = await img.metadata();
                const { data } = await img.raw().toBuffer({ resolveWithObject: true });
                textures[key] = {
                    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
                    width: meta.width,
                    height: meta.height,
                    channels: meta.channels ?? 4,
                };
            }
        }
    }
    catch (e) {
        console.warn('initRuntime: Failed to load textures (sharp not available?)', e);
    }
    rt.set(groupInputNode, 'groundGeometry', groundGeometry);
    rt.set(groupInputNode, 'textures', textures);
}
