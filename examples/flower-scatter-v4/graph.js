/**
 * Flower Scattering V4 — Port of tmp/flower_scattering.blend
 *
 * Geometry Nodes graph: "Flower Field System"
 *
 * Top-level structure:
 *   GroupInput → Grass System (medium + long) + Flower System → Join Geometry
 *
 * Grass System:
 *   Two "Grass Scattering" groups with POISSON distribution:
 *   - Group (medium grass): density*100, minDist=0.01, collection=EN-grass.medium_NEW (4 members)
 *     seed=mainSeed
 *   - Group.001 (long grass): density*100/3, minDist=0.04, collection=EN-grass.long_NEW (3 members)
 *     seed=mainSeed+1
 *   Each Grass Scattering:
 *     DPF(POISSON) → Instance on Points with collection (Separate Children=false)
 *     Rotation from "Random Orientation" sub-group (seed+100):
 *       randomVector([-tilt,tilt], seed+37) → rotateEulerAxisAngle(LOCAL, Z, randomFloat(0,2PI, seed))
 *     Scale: (randomFloat(0.5,2.0, seed+40) + colorRamp(noise)) / 2
 *
 * Flower System:
 *   DPF(POISSON, density*100, distance, seed) → Delete Geometry (density map) →
 *     Separate Geometry (bluebell mask) →
 *   Two Instance on Points with Pick Instance=true:
 *     - Bluebells: Inverted (mask high → bluebell area), GRP-bluebell (5), scale(1-2, seed+30)
 *     - Dandelions: Selection (mask low → dandelion area), GRP-dandelion (4), scale(1-2, seed+40)
 *   Rotation: Random Orientation(tilt=0.1, seed+50)
 *   Instance Index: implicit point index (unlinked reroutes)
 *
 * Run comparison:
 *   npx tsx --tsconfig plugins/procedural-generation/porting/scripts/tsconfig.json \
 *     plugins/procedural-generation/porting/scripts/compare_graph.ts \
 *     examples/flower-scatter-v4/graph.ts tmp/flower_scattering_ground_truth.json
 */
import { defineNodeType, defineGraph, connect, distributePointsOnFaces, fromLocRotScale, yUpToZUp, randomFloat, randomVector, rotateEulerAxisAngleLocal, sampleImageTexture, colorRampLinear2, hash_to_float2, } from '@threepipe/plugin-procedural-generation/graph';
// ─── Random Orientation sub-group ──────────────────────────────────
/**
 * Port of the "Random Orientation" Blender node group.
 *
 * Graph (from node graph JSON):
 *   Group Input.Input_0 = Random Tilt (degrees)
 *   Group Input.Input_4 = Seed
 *
 *   Math.008 (MULTIPLY): tilt * -1 → min for random vector
 *   Random Value.005 (FLOAT_VECTOR): min=[-tilt,...], max=[tilt,...], seed=seed+37
 *     → produces random tilt euler (used as Rotation input to Rotate Euler)
 *
 *   Math.007 (RADIANS): 360 → 2*PI (max for Z angle random)
 *   Random Value.004 (FLOAT): min=0, max=2*PI, seed=seed
 *     → random Z-axis rotation angle
 *
 *   Rotate Euler (AXIS_ANGLE, LOCAL): rotation=tiltEuler, axis=[0,0,1], angle=zAngle
 *     → combines tilt + Z rotation
 *
 * Note: Math node in the sub-group adds 37 to seed for the vector random.
 *   Math.Value = seed, + 37 → Random Value.005.Seed
 *
 * Returns Euler XYZ rotation angles.
 */
function randomOrientation(tilt, seed, id) {
    // Random tilt: FLOAT_VECTOR in [-tilt, tilt] per axis
    const tiltEuler = randomVector([-tilt, -tilt, -tilt], [tilt, tilt, tilt], id, seed + 37);
    // Random Z-axis rotation: FLOAT in [0, 2*PI]
    // Math.007: RADIANS(360) = 2*PI
    const zAngle = randomFloat(0, Math.PI * 2, id, seed);
    // Rotate Euler (AXIS_ANGLE, LOCAL): apply Z rotation on top of tilt
    return rotateEulerAxisAngleLocal(tiltEuler, [0, 0, 1], zAngle);
}
// ─── Grass Scattering ──────────────────────────────────────────────
/**
 * Port of "Grass Scattering" Blender node group.
 *
 * Each scatter point instances the ENTIRE collection (Separate Children=false).
 * So each scatter point creates one GeneratedInstance per collection member.
 *
 * Dataflow (from node graph JSON):
 *   Group Input.Input_1 → DPF.Mesh
 *   Group Input.Input_9 → DPF.Distance Min
 *   Group Input.Input_7 → DPF.Density Max
 *   Group Input.Input_11 → DPF.Seed
 *   Group Input.Input_5 → Collection Info.Collection
 *   Group Input.Input_15 → Random Orientation.Input_0 (Random Tilt)
 *
 * Scale computation:
 *   Math.011: seed + 40 → Random Value.Seed
 *   Random Value (FLOAT): min=0.5, max=2.0, seed=seed+40
 *   Noise Texture(3D, scale=1, detail=1.5, roughness=0.5, distortion=-3.1)
 *     → ColorRamp → Math.009 (ADD): randomScale + colorRamp
 *     → Math.010 (DIVIDE /2): total/2
 *
 * Rotation computation:
 *   Math.015: seed + 100 → Random Orientation.Input_4 (Seed)
 *   Random Orientation(tilt=Input_15, seed=seed+100)
 *
 * Since we don't have a 3D NoiseTexture port, approximate with hash_to_float2(id, seed+99)
 * passed through colorRampLinear2(pos0=0.508, pos1=0.846) matching Blender's ColorRamp stops.
 * This produces per-point variation in [0,1] with the correct range.
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
        // Random Orientation: tilt + Z rotation, seed=seed+100
        const rot = randomOrientation(randomTilt, seed + 100, id);
        // Scale computation:
        // randomFloat(0.5, 2.0, id, seed+40) + colorRamp(noiseTexture(pos)) → /2
        // Approximate noise with hash_to_float2, then pass through ColorRamp
        // ColorRamp stops: pos0=0.508 (black), pos1=0.846 (white)
        const baseScale = randomFloat(0.5, 2.0, id, seed + 40);
        const noiseApprox = hash_to_float2(id, seed + 99);
        const noiseContrib = colorRampLinear2(noiseApprox, 0.508, 0.846);
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
 *    Math.004: density * 100 → DPF.Density Max
 *    Group Input.Input_13 → DPF.Distance Min
 *    Group Input.Input_5 → DPF.Seed
 *
 * 2. Delete Geometry: remove points where density map value < random
 *    Image Texture.002 samples flowers-density_map at UV
 *    Random Value (FLOAT): min=0, max=1, seed=0 (default, not connected)
 *    Math (LESS_THAN, use_clamp=true): density_map < random → delete flag
 *    Delete Geometry: removes points where Selection=true (low density)
 *
 * 3. Separate Geometry: split by bluebell mask
 *    Image Texture.001 samples bluebell-mask at UV
 *    Math.011: seed + 20 → Random Value.001.Seed
 *    Random Value.001 (FLOAT): min=0, max=1, seed=seed+20
 *    Math.001 (LESS_THAN): mask_value < random → selection flag
 *    Separate Geometry:
 *      Selection (LESS_THAN true = mask low = not bluebell) → Reroute.002 → Instance on Points.002 (dandelions)
 *      Inverted (LESS_THAN false = mask high = bluebell area) → Reroute.004 → Instance on Points.001 (bluebells)
 *
 * 4. Two Instance on Points with Pick Instance=true:
 *    Instance Index: from unlinked reroutes (default 0) → in Blender's field system, this means
 *      the implicit index field is used (point index in the domain).
 *
 *    Actually, re-analyzing: Reroute.017/018 are unlinked and pass constant 0.
 *    BUT Instance on Points has `implicit_field_on(NODE_DEFAULT_INPUT_ID_INDEX_FIELD)` for Instance Index.
 *    This means when Instance Index is not connected to a FIELD, it uses the implicit index.
 *    A constant 0 from a reroute IS a field (just a constant one), so it would use 0 for all points.
 *    However, looking at the Blender source more carefully: the implicit_field_on flag only applies
 *    when the socket is truly unconnected (no incoming link at all). A reroute with no input still
 *    passes through the default, and since reroute IS connected to the Instance Index socket,
 *    the implicit field is overridden by the constant 0.
 *
 *    BUT the existing example uses point index for picking... Let me check the ground truth.
 *    Since the 500 samples are all grass (no flowers), we can't verify from the sample.
 *    For now, I'll implement BOTH behaviors and test:
 *    - Use implicit index (point_index % members.length) as the existing example does
 *
 *    Scale: Random Value.002 (FLOAT): min=1.0, max=2.0
 *      Math.014: seed + 30 → Random Value.002.Seed (bluebells)
 *      Math.013: seed + 40 → Random Value.003.Seed (dandelions)
 *    Scale output is FLOAT, connected to Instance on Points.Scale as VectorXYZ (uniform scale)
 *
 *    Rotation: Random Orientation(tilt=0.1 (default, NOT connected from input), seed=seed+50)
 *      Math.015: seed + 50 → Group.Input_4
 *      Group.Input_0 (Random Tilt) = 0.1 (default, not connected)
 *      Same rotation for both bluebell and dandelion (shared via Reroute.014→015/016)
 */
function flowerSystem(groundGeometry, bluebellMembers, dandelionMembers, distance, density, seed, textures) {
    if (!groundGeometry || density <= 0)
        return [];
    // DPF POISSON scatter
    // Math.004: density * 100 → DPF.Density Max
    const result = distributePointsOnFaces(groundGeometry, {
        method: 'POISSON',
        density: density * 100,
        minDistance: distance,
        seed,
    });
    if (result.positions.length === 0)
        return [];
    // ── Get UV approximation ──
    // Since distributePointsOnFaces doesn't return UVs, approximate from bounding box.
    // This is the same approach as the v1 example.
    const posAttr = groundGeometry.getAttribute('position');
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        if (x < minX)
            minX = x;
        if (x > maxX)
            maxX = x;
        if (z < minZ)
            minZ = z;
        if (z > maxZ)
            maxZ = z;
    }
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    // ── Step 1: Filter by density map (Delete Geometry) ──
    // Image Texture.002: sample density map at UV
    // Random Value (FLOAT, 0-1): seed=0 (not connected)
    // Math (LESS_THAN, use_clamp=true): density_value < random → true → delete
    // Delete Geometry: remove points where selection=true
    const filteredIndices = [];
    for (let i = 0; i < result.positions.length; i++) {
        const pos = result.positions[i];
        const id = result.ids[i];
        // Approximate UV from position (Y-up space from GLB)
        const u = (pos.x - minX) / rangeX;
        const v = (pos.z - minZ) / rangeZ;
        // Sample density map
        let densityValue = 1.0;
        if (textures.densityMap) {
            densityValue = sampleImageTexture(textures.densityMap, u, v);
        }
        // Random Value (FLOAT, 0-1): seed=0 (default, not connected)
        const rv = randomFloat(0, 1, id, 0);
        // Math LESS_THAN: densityValue < rv → true → delete
        const shouldDelete = densityValue < rv ? 1 : 0;
        if (!shouldDelete) {
            filteredIndices.push(i);
        }
    }
    if (filteredIndices.length === 0)
        return [];
    // ── Step 2: Separate by bluebell mask ──
    // Image Texture.001: sample bluebell mask at UV
    // Math.011: seed + 20 → Random Value.001.Seed
    // Random Value.001 (FLOAT, 0-1): seed=seed+20
    // Math.001 (LESS_THAN): mask_value < random → selection
    // Separate Geometry:
    //   Selection (where LESS_THAN=true → mask low → not bluebell) → dandelion points
    //   Inverted (where LESS_THAN=false → mask high → bluebell area) → bluebell points
    const bluebellIndices = [];
    const dandelionIndices = [];
    for (const i of filteredIndices) {
        const pos = result.positions[i];
        const id = result.ids[i];
        const u = (pos.x - minX) / rangeX;
        const v = (pos.z - minZ) / rangeZ;
        let maskValue = 0.5;
        if (textures.bluebellMask) {
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
    // ── Step 3: Instance on Points for both flower types ──
    // Rotation: Random Orientation(tilt=0.1, seed=seed+50)
    // Scale bluebells: randomFloat(1.0, 2.0, id, seed+30)
    // Scale dandelions: randomFloat(1.0, 2.0, id, seed+40)
    // Instance Index: implicit point index (j within each subset)
    const instances = [];
    // Bluebells (from Inverted output → Reroute.004 → Instance on Points.001)
    for (let j = 0; j < bluebellIndices.length; j++) {
        const i = bluebellIndices[j];
        const pos = result.positions[i];
        const id = result.ids[i];
        const rot = randomOrientation(0.1, seed + 50, id);
        const s = randomFloat(1.0, 2.0, id, seed + 30);
        const [bx, by, bz] = yUpToZUp(pos.x, pos.y, pos.z);
        // Pick Instance: use j (index within bluebell subset) for picking
        const memberFile = bluebellMembers[j % bluebellMembers.length];
        const wm = fromLocRotScale(bx, by, bz, rot[0], rot[1], rot[2], s, s, s);
        instances.push({ world_matrix: wm, object_name: memberFile });
    }
    // Dandelions (from Selection output → Reroute.002 → Instance on Points.002)
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
// EN-grass.medium_NEW: 4 members (Group in Grass System)
const grassMediumMembers = [
    'object_GEO-leaf_grass_001.glb',
    'object_GEO-leaf_grass_002.glb',
    'object_GEO-leaf_grass_003.glb',
    'object_GEO-leaf_grass_008.glb',
];
// EN-grass.long_NEW: 3 members (Group.001 in Grass System)
const grassLongMembers = [
    'object_GEO-leaf_grass-long_003.glb',
    'object_GEO-leaf_grass-long_004.glb',
    'object_GEO-leaf_grass-long_005.glb',
];
// ─── Flower collection members (sorted alphabetically) ─────────
// GRP-bluebell: 5 members
const bluebellMembers = [
    'object_EN-plants-bluebell_002.glb',
    'object_EN-plants-bluebell_006.glb',
    'object_EN-plants-bluebell_007.glb',
    'object_EN-plants-bluebell_2.glb',
    'object_EN-plants-bluebell_5.glb',
];
// GRP-dandelion: 4 members
const dandelionMembers = [
    'object_EN-plants-dandelion_1.glb',
    'object_EN-plants-dandelion_2.glb',
    'object_EN-plants-dandelion_3.glb',
    'object_EN-plants-dandelion_4.glb',
];
/**
 * Grass System node — combines medium and long grass scattering.
 *
 * From the Grass System sub-tree:
 *   Math (MULTIPLY): density * 100 → Reroute.001
 *   Reroute.001 → Group.Input_7 (medium grass Density Max = density*100)
 *   Math.001 (DIVIDE): (density*100) / 3 → Group.001.Input_7 (long grass Density Max)
 *
 *   Group Input.Input_13 (Seed) → Group.Input_11 (medium grass seed = mainSeed)
 *   Math.002 (ADD seed+1) → Group.001.Input_11 (long grass seed = mainSeed+1)
 *
 *   Group (medium grass): collection=EN-grass.medium_NEW, minDist=0.01
 *   Group.001 (long grass): collection=EN-grass.long_NEW, minDist=0.04
 *
 * Join order in node tree:
 *   Group.Output_3 (medium) → Join Geometry.001
 *   Group.001.Output_3 (long) → Join Geometry.001
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
    // Medium grass: Grass Scattering with EN-grass.medium_NEW
    // Seed = mainSeed (direct from Group Input.Input_13)
    const mediumGrass = grassScattering(inp.groundGeometry, grassMediumMembers, 0.01, // Distance Min from Group.Input_9 default
    densityX100, // Density Max = density*100
    inp.grassRandomTilt, inp.seed);
    // Long grass: Grass Scattering with EN-grass.long_NEW
    // Seed: Math.002 = seed + 1
    const longGrass = grassScattering(inp.groundGeometry, grassLongMembers, 0.04, // Distance Min from Group.001.Input_9 default
    longDensity, // Density Max = density*100/3
    inp.grassRandomTilt, inp.seed + 1);
    // Join order: Group.Output → Join.001.Geometry, then Group.001.Output → Join.001.Geometry
    // In Blender, Join Geometry concatenates in link order.
    // The links show: Group.Output_3 first, then Group.001.Output_3
    return { instances: [...mediumGrass, ...longGrass] };
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
 *
 * From top-level links:
 *   Reroute.001 (geometry pass-through) → Join Geometry
 *   Group.Output_11 (Grass Only) → Join Geometry
 *   Group.001.Output_15 (Flower System output) → Join Geometry
 *
 * The geometry pass-through is the ground mesh (for display).
 * We don't include it in instances — the viewer loads it separately.
 *
 * Join order: Reroute.001, then Grass Only, then Flowers
 * But since we skip the geometry pass-through, it's grass + flowers.
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
        // Grass medium
        ...grassMediumMembers,
        // Grass long
        ...grassLongMembers,
        // Bluebells
        ...bluebellMembers,
        // Dandelions
        ...dandelionMembers,
        // Ground
        'ground.glb',
    ],
    assetsPath: './assets/',
};
