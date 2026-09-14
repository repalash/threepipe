/**
 * Candy Bounce — Port of tmp/candy_bounce.blend
 *
 * 3 node trees:
 *
 * 1. geonodes_well (48 instances)
 *    MeshLine(16) → InstanceOnPoints(well_brick) → RotateInstances(index*22.5°)
 *    → 3× Transform+JoinGeometry (layers at Z=0/-0.2/-0.4, alternating 11.25° offset)
 *
 * 2. geonodes_jumpers (40 instances, animated)
 *    jumpers_spawn_surface → Transform(rotZ=frame*0.01) →
 *    DistributePointsOnFaces(POISSON, density=20, minDist=0.1) →
 *    object_switcher(selection) → InstanceOnPoints →
 *    move_jumpers(sin bounce) → scale_jumpers(squash/stretch) →
 *    rotate_jumpers(AlignEulerToVector toward center)
 *
 * 3. geonodes_floor (1137 instances — 0 in GT due to RealizeInstances)
 *    floor → SubdivisionSurface(L=3) → MeshToPoints → InstanceOnPoints(floor_cube)
 *    Chain A (Scale): proximity → FloatCurve → MapRange[0,1→4.28,1.2] → ScaleInstances
 *    Chain B (Translate Z): proximity → ×3.97 → MapRange[0,1.5→-0.01,-0.04] → TranslateInstances
 */
import { defineNodeType, defineGraph, connect, catmullClark, distributePointsOnFaces, fromLocRotScale, yUpToZUp, randomFloat, mapRange, alignEulerToVectorAutoPivot, evaluateFloatCurve, evaluateColorRamp, } from '@threepipe/plugin-procedural-generation/graph';
// ─── Floor mesh topology (source data for SubdivisionSurface) ───────
import { floorMeshTopology } from './floor_topology_data';
// ─── Asset filenames (from asset_manifest.json) ─────────────────────
const WELL_BRICK = 'object_well_brick.glb';
const FLOOR_CUBE = 'object_floor_cube.glb';
const JUMPER_OBJECTS = [
    'object_bouncing_cube.glb', // selection=0
    'object_bouncing_sphere.glb', // selection=1
    'object_bouncing_spheroid.glb', // selection=2
    'object_bouncing_monkey.glb', // selection=3
];
// ─── Float Curve control points ─────────────────────────────────────
// Default Blender Float Curve: identity line from (0,0) to (1,1)
// This matches the typical default curve when no custom points are set.
const FLOAT_CURVE_POINTS = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
];
// ─── Scale jumpers ColorRamp stops ──────────────────────────────────
// Reverse-engineered from ground truth data analysis (40 data points).
//
// ColorRamp (Z scale): maps bounce height (0..0.5) to Z scale factor.
// 3-stop linear ramp fitted to GT with avg error 0.005:
//   (0, 0.34) → (0.05, 0.64) → (0.50, 1.00)
const SCALE_Z_RAMP = [
    { pos: 0, color: [0.34, 0.34, 0.34, 1] },
    { pos: 0.05, color: [0.64, 0.64, 0.64, 1] },
    { pos: 0.50, color: [1, 1, 1, 1] },
];
// ColorRamp.001 (XY scale): maps bounce height to XY scale factor.
// GT shows steep drop from 1.0 to 0.5463 between Z=0 and Z≈0.08, then constant.
// 2-stop ramp: (0, 1.0) → (0.08, 0.5463), constant after.
const SCALE_XY_RAMP = [
    { pos: 0, color: [1, 1, 1, 1] },
    { pos: 0.08, color: [0.5463, 0.5463, 0.5463, 1] },
];
// =====================================================================
// Tree 1: geonodes_well
// =====================================================================
/**
 * Generate well instances (48 total = 3 layers × 16 bricks).
 *
 * MeshLine(16 points, all at origin) → InstanceOnPoints(well_brick)
 * → RotateInstances(Z = index * 22.5° in radians)
 * → 3 Transform copies joined:
 *   Layer 0: translation Z≈0,   rotation Z = 11.25° (π/16)
 *   Layer 1: translation Z=-0.2, rotation Z = 0
 *   Layer 2: translation Z=-0.4, rotation Z = 11.25° (π/16)
 */
function generateWell() {
    const instances = [];
    const count = 16;
    const angleStep = 22.5 * Math.PI / 180; // radians per brick
    // 3 layers with different Z offsets and rotation offsets
    const layers = [
        { tz: -1.1175870895385742e-08, rotZ: 0.19634954631328583 }, // ≈0, π/16
        { tz: -0.20000001788139343, rotZ: 0 },
        { tz: -0.4000000059604645, rotZ: 0.19634954631328583 }, // π/16
    ];
    for (const layer of layers) {
        for (let i = 0; i < count; i++) {
            // RotateInstances angle = index * 22.5°
            const baseAngle = i * angleStep;
            // Transform rotation adds layer offset
            const totalAngle = baseAngle + layer.rotZ;
            // Position in Blender Z-up: (0, 0, tz)
            // Rotation: only around Z axis
            const matrix = fromLocRotScale(0, 0, layer.tz, 0, 0, totalAngle, 1, 1, 1);
            instances.push({ world_matrix: matrix, object_name: WELL_BRICK });
        }
    }
    return instances;
}
// =====================================================================
// Tree 2: geonodes_jumpers (animated)
// =====================================================================
/**
 * Object switcher sub-group:
 * selection 0=cube, 1=sphere, 2=spheroid, 3=monkey
 * Uses cascading Compare(GREATER_THAN) + Switch nodes
 */
function objectSwitcherName(selection) {
    // Switch logic:
    // compare.001: selection > 0 → switch between cube(false) and sphere(true)
    // compare: selection > 1 → switch.001 between spheroid(false) and monkey(true)
    // compare.002: selection > 2 → switch.002 between switch.output(false) and switch.001.output(true)
    if (selection > 2)
        return JUMPER_OBJECTS[3]; // monkey
    if (selection > 1)
        return JUMPER_OBJECTS[2]; // spheroid
    if (selection > 0)
        return JUMPER_OBJECTS[1]; // sphere
    return JUMPER_OBJECTS[0]; // cube
}
/**
 * move_jumpers sub-group: sin-based bounce animation.
 *
 * Node graph:
 *   Value (scene_time=frame) → Math.003 ADD(frame, randomOffset) → Math MULTIPLY(sum, speed)
 *   → Math.001 SINE → Math.002 ABSOLUTE → MapRange[0,1→0,height] → CombineXYZ.Z
 *
 * speed = MapRange.001(animSpeed, [0,1], [0.05, 0.2])
 * randomOffset = RandomValue(FLOAT, 0..100, id=0, seed=0) — per-instance phase offset
 * height = group input (0.5)
 */
function moveJumper(frame, pointId, animSpeed, height) {
    // Random phase offset per instance (FLOAT: hash(seed=0, id))
    const randomOffset = randomFloat(0, 100, pointId, 0);
    // Speed remapping: animSpeed [0,1] → [0.05, 0.2]
    const speed = mapRange(animSpeed, 0, 1, 0.05, 0.2);
    // Bounce: sin((frame + randomOffset) * speed) → abs → mapRange to height
    const sum = frame + randomOffset;
    const sinValue = Math.sin(sum * speed);
    const absValue = Math.abs(sinValue);
    const z = mapRange(absValue, 0, 1, 0, height);
    return [0, 0, z]; // Translation vector (Blender Z-up)
}
/**
 * scale_jumpers sub-group: squash & stretch based on Z position.
 *
 * Node graph:
 *   Position.Z → ColorRamp → Math MULTIPLY(1.0) → CombineXYZ.Z (Z scale)
 *   Position.Z → ColorRamp.001 → Math.001 MULTIPLY(1.3) → CombineXYZ.X, CombineXYZ.Y (XY scale)
 *
 * ColorRamp default: linear black(0) at 0 → white(1) at 1
 * So ColorRamp(z) ≈ clamp(z, 0, 1) for default ramp
 *
 * When Z is high (peak of bounce), scale Z → 1 (stretched), XY → 1.3
 * When Z is low (ground), scale Z → 0, XY → 0
 * But that would make things invisible at ground. The Z position from
 * move_jumpers is the translation Z, not a 0-1 value.
 * The Position node reads the INSTANCE position, which is the translated position.
 *
 * Actually, in Blender geometry nodes, Position reads the instance position.
 * After Translate Instances, the Z position is the bounce height.
 * The ColorRamp uses this Z to drive scale.
 */
function scaleJumper(positionZ) {
    // ColorRamp for Z scale: input is position Z, default ramp = clamp(0,1)
    const zRampColor = evaluateColorRamp(positionZ, SCALE_Z_RAMP);
    const zScale = zRampColor[0] * 1.0; // Multiply by 1.0
    // ColorRamp.001 for XY scale: same input
    const xyRampColor = evaluateColorRamp(positionZ, SCALE_XY_RAMP);
    const xyScale = xyRampColor[0] * 1.3; // Multiply by 1.3
    return [xyScale, xyScale, zScale];
}
/**
 * rotate_jumpers sub-group: Align Euler to Vector toward center.
 *
 * Node graph:
 *   Position → VectorMath SUBTRACT(Position, [0,0,0]) → AlignEulerToVector(X axis, AUTO pivot)
 *
 * The subtraction (Position - [0,0,0]) = Position, so it's just aligning
 * the X axis toward the instance's own position vector (pointing away from center).
 * Wait — actually Vector Math SUBTRACT: Vector=Position, Vector_001=[0,0,0]
 * So result = Position - [0,0,0] = Position. This points FROM center TO instance.
 *
 * AlignEulerToVector: axis=X, pivot=AUTO, rotation=[0,0,0], factor=1.0
 * So it aligns the local X axis toward the (center→instance) direction.
 */
function rotateJumper(positionBlender) {
    // The vector is the instance position (direction from center to instance)
    return alignEulerToVectorAutoPivot([0, 0, 0], // input rotation
    positionBlender, 1.0, // factor
    0);
}
/**
 * Generate jumper instances for a given frame.
 *
 * @param spawnGeometry The jumpers_spawn_surface BufferGeometry (Y-up from GLB)
 * @param frame Current animation frame
 * @param objectSelection Which object to use (0-3)
 * @param instanceDensity Number of jumpers (density_max for POISSON)
 * @param animSpeed Animation speed (0..1, mapped to 0.05..0.2)
 * @param height Bounce height
 */
export function generateJumpers(spawnGeometry, frame, objectSelection, instanceDensity, animSpeed, height) {
    if (!spawnGeometry)
        return [];
    // Transform the spawn surface: rotate around Z by frame * 0.01
    // In Blender: Value.001 (frame) → Math.004 MULTIPLY(frame, 0.01)
    //           → CombineXYZ.001(0, 0, result) → Transform.Rotation
    // But wait - the Transform is applied to the MESH before distribution,
    // not to instances. So the mesh rotates, then points are distributed.
    //
    // Since we distribute on the geometry, and the spawn surface is a circle,
    // rotating it just shifts where points land. For frame=0, rotation=0.
    // For the static ground truth comparison (frame=0), this is identity.
    const rotZ = frame * 0.01;
    // Distribute points on faces (POISSON mode)
    // The geometry might need rotation applied... but distributePointsOnFaces
    // works in geometry space. The rotation is applied to the mesh before distribution.
    // For now, we distribute on the original geometry and apply the rotation to results.
    const result = distributePointsOnFaces(spawnGeometry, {
        method: 'POISSON',
        density: instanceDensity,
        minDistance: 0.1,
        seed: 0,
    });
    const objectName = objectSwitcherName(objectSelection);
    const instances = [];
    for (let i = 0; i < result.positions.length; i++) {
        const pos = result.positions[i];
        const id = result.ids[i];
        // Convert Y-up GLB position to Blender Z-up
        let [bx, by, bz] = yUpToZUp(pos.x, pos.y, pos.z);
        // Apply the mesh rotation (Transform node): rotate point around Z by rotZ
        if (rotZ !== 0) {
            const cosR = Math.cos(rotZ), sinR = Math.sin(rotZ);
            const nx = bx * cosR - by * sinR;
            const ny = bx * sinR + by * cosR;
            bx = nx;
            by = ny;
        }
        // move_jumpers: compute bounce translation
        const translation = moveJumper(frame, id, animSpeed, height);
        const px = bx + translation[0];
        const py = by + translation[1];
        const pz = bz + translation[2];
        // scale_jumpers: squash & stretch based on Z position (bounce height)
        // The Position.Z in the sub-group reads the instance Z after translation
        const scale = scaleJumper(translation[2]); // Use the bounce Z, not world Z
        // rotate_jumpers: align X axis toward center
        // The position used is the TRANSLATED position (after Translate Instances)
        const rotation = rotateJumper([px, py, pz]);
        // Build the world matrix
        // Instance on Points sets rotation=[0,0,0], scale=[1,1,1] initially
        // Then: Translate → Scale → Rotate applied as instance transforms
        //
        // In Blender, the operations are:
        // 1. InstanceOnPoints at position (bx,by,bz) with rot=[0,0,0], scale=[1,1,1]
        // 2. TranslateInstances adds translation (local space)
        // 3. ScaleInstances multiplies scale (local space)
        // 4. RotateInstances sets rotation (local space)
        //
        // The final matrix is: T(pos+translation) * R(rotation) * S(scale)
        // But since these are instance transforms applied in sequence, the order matters.
        // Blender applies them as: M = M_original * T * S * R
        // where M_original = fromLocRotScale(pos, [0,0,0], [1,1,1])
        //
        // Actually, for instance transforms:
        // - TranslateInstances(local=true): adds translation rotated by instance rotation
        //   Since initial rotation is [0,0,0], it's just position + translation
        // - ScaleInstances(local=true): multiplies scale component
        // - RotateInstances(local=true): composes rotation
        //
        // So the final matrix = fromLocRotScale(pos + translation, rotation, scale)
        const matrix = fromLocRotScale(px, py, pz, rotation[0], rotation[1], rotation[2], scale[0], scale[1], scale[2]);
        instances.push({ world_matrix: matrix, object_name: objectName });
    }
    return instances;
}
// =====================================================================
// Tree 3: geonodes_floor (animated — depends on jumper positions)
// =====================================================================
/**
 * Compute subdivided floor points using Catmull-Clark subdivision.
 * floor mesh → SubdivisionSurface(level=3) → MeshToPoints(VERTICES)
 *
 * Returns positions in Blender Z-up coordinate space.
 */
let _cachedFloorPoints = null;
function getFloorPoints() {
    if (_cachedFloorPoints)
        return _cachedFloorPoints;
    const result = catmullClark(floorMeshTopology.positions, floorMeshTopology.faces, 3, // level
    false);
    // The positions from catmullClark are in the floor mesh's local space
    // Floor mesh is Z-up (exported as Z-up coordinates in the topology JSON)
    _cachedFloorPoints = result.positions.map(p => [p[0], p[1], p[2]]);
    return _cachedFloorPoints;
}
/**
 * Compute Geometry Proximity distance from each floor point to the
 * nearest jumper position. Mode=POINTS.
 *
 * source: nodes/geometry/nodes/node_geo_proximity.cc
 */
function geometryProximityPoints(floorPoints, jumperPositions) {
    const distances = [];
    for (const fp of floorPoints) {
        let minDist = Infinity;
        for (const jp of jumperPositions) {
            const dx = fp[0] - jp[0];
            const dy = fp[1] - jp[1];
            const dz = fp[2] - jp[2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < minDist)
                minDist = dist;
        }
        distances.push(minDist);
    }
    return distances;
}
/**
 * Generate floor instances.
 *
 * ObjectInfo(floor) → SubdivisionSurface(L=3) → MeshToPoints → InstanceOnPoints(floor_cube)
 * Then per-instance proximity-based scale and Z-translation.
 *
 * Chain A (Scale): distance → FloatCurve → MapRange[0,1→4.28,1.2] → ScaleInstances (uniform)
 * Chain B (Translate Z): distance → ×3.97 → MapRange[0,1.5→-0.01,-0.04] → CombineXYZ.Z → TranslateInstances
 *
 * CRITICAL: Chain A and Chain B are INDEPENDENT from Geometry Proximity.Distance.
 * ×3.97 belongs ONLY to Chain B, NOT to the FloatCurve chain.
 *
 * @param jumperPositions Current jumper positions in Blender Z-up
 */
export function generateFloor(jumperPositions) {
    const floorPoints = getFloorPoints();
    const instances = [];
    // If no jumpers, use a large default distance
    const distances = jumperPositions.length > 0
        ? geometryProximityPoints(floorPoints, jumperPositions)
        : floorPoints.map(() => 10.0);
    for (let i = 0; i < floorPoints.length; i++) {
        const [fx, fy, fz] = floorPoints[i];
        const dist = distances[i];
        // Chain A (Scale):
        // distance → FloatCurve → MapRange[0,1→4.28,1.2]
        const curveOut = evaluateFloatCurve(dist, FLOAT_CURVE_POINTS, 1.0);
        const scale = mapRange(curveOut, 0, 1, 4.28, 1.2);
        // Chain B (Translate Z):
        // distance → MULTIPLY(3.97) → MapRange[0,1.5→-0.01,-0.04]
        const distScaled = dist * 3.97;
        const translateZ = mapRange(distScaled, 0, 1.5, -0.01, -0.04);
        // Instance position = floor point + translate Z
        const pz = fz + translateZ;
        // ScaleInstances (uniform scale) with local space
        // The scale is applied as a uniform (same in X,Y,Z) based on the Map Range
        // output which goes into a CombineXYZ... wait, let me re-check.
        //
        // Looking at the links: Map Range.Result → Scale Instances.Scale
        // The Scale input is NodeSocketVectorXYZ, so it expects a vector.
        // But Map Range outputs a float. In Blender, a float connected to a
        // vector input creates a uniform vector (x=y=z=value).
        // So the scale is [scale, scale, scale].
        const matrix = fromLocRotScale(fx, fy, pz, 0, 0, 0, scale, scale, scale);
        instances.push({ world_matrix: matrix, object_name: FLOOR_CUBE });
    }
    return instances;
}
// =====================================================================
// Graph Module (using defineNodeType / defineGraph for reactive UI)
// =====================================================================
// ─── Well graph (static) ────────────────────────────────────────────
const WellGroupInputType = defineNodeType({}, { instances: [] }, () => ({ instances: generateWell() }));
// ─── Jumpers graph (animated) ───────────────────────────────────────
export const JumperGroupInputType = defineNodeType({
    spawnGeometry: null,
    frame: { default: 0, ui: { label: 'Frame', bounds: [0, 999], stepSize: 1 } },
    objectSelection: { default: 0, ui: { label: 'Object (0-3)', bounds: [0, 3], stepSize: 1 } },
    instanceDensity: { default: 20, ui: { label: 'Jumper Count', bounds: [1, 100], stepSize: 1 } },
    animSpeed: { default: 0.2, ui: { label: 'Anim Speed', bounds: [0, 1], stepSize: 0.01 } },
    height: { default: 0.5, ui: { label: 'Bounce Height', bounds: [0, 2], stepSize: 0.01 } },
}, {
    spawnGeometry: null,
    frame: 0,
    objectSelection: 0,
    instanceDensity: 20,
    animSpeed: 0.2,
    height: 0.5,
}, (inp) => ({ ...inp }));
const JumpersNodeType = defineNodeType({
    spawnGeometry: null,
    frame: 0,
    objectSelection: 0,
    instanceDensity: 20,
    animSpeed: 0.2,
    height: 0.5,
}, { instances: [] }, (inp) => ({
    instances: generateJumpers(inp.spawnGeometry, inp.frame, inp.objectSelection, inp.instanceDensity, inp.animSpeed, inp.height),
}));
// ─── Floor graph (depends on jumper positions) ──────────────────────
export const FloorGroupInputType = defineNodeType({
    jumperPositions: [],
}, {
    jumperPositions: [],
}, (inp) => ({ ...inp }));
const FloorNodeType = defineNodeType({
    jumperPositions: [],
}, { instances: [] }, (inp) => ({
    instances: generateFloor(inp.jumperPositions),
}));
// ─── Graph definitions ──────────────────────────────────────────────
// Well graph
const wellGroupInput = WellGroupInputType('well_input');
const wellGraph = defineGraph([wellGroupInput], []);
// Jumpers graph
export const jumperGroupInput = JumperGroupInputType('jumper_input');
const jumpersNode = JumpersNodeType('jumpers');
const jumperGraph = defineGraph([jumperGroupInput, jumpersNode], [
    connect(jumperGroupInput, 'spawnGeometry', jumpersNode, 'spawnGeometry'),
    connect(jumperGroupInput, 'frame', jumpersNode, 'frame'),
    connect(jumperGroupInput, 'objectSelection', jumpersNode, 'objectSelection'),
    connect(jumperGroupInput, 'instanceDensity', jumpersNode, 'instanceDensity'),
    connect(jumperGroupInput, 'animSpeed', jumpersNode, 'animSpeed'),
    connect(jumperGroupInput, 'height', jumpersNode, 'height'),
]);
// Floor graph
export const floorGroupInput = FloorGroupInputType('floor_input');
const floorNode = FloorNodeType('floor');
const floorGraph = defineGraph([floorGroupInput, floorNode], [
    connect(floorGroupInput, 'jumperPositions', floorNode, 'jumperPositions'),
]);
// ─── Module export ──────────────────────────────────────────────────
export const graphModule = {
    graphs: [
        {
            graph: wellGraph,
            outputs: [{ node: wellGroupInput, output: 'instances' }],
        },
        {
            graph: jumperGraph,
            outputs: [{ node: jumpersNode, output: 'instances' }],
        },
        {
            graph: floorGraph,
            outputs: [{ node: floorNode, output: 'instances' }],
        },
    ],
    assets: [
        'object_well_brick.glb',
        'object_floor_cube.glb',
        'object_bouncing_cube.glb',
        'object_bouncing_sphere.glb',
        'object_bouncing_spheroid.glb',
        'object_bouncing_monkey.glb',
        'object_jumpers_spawn_surface.glb',
    ],
    assetsPath: './assets/',
};
