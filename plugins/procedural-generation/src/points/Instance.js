/**
 * Instance objects at point cloud positions.
 * Maps to Blender's "Instance on Points" node.
 *
 * Creates InstancedMesh2 (threepipe's instanced mesh) for GPU-efficient rendering.
 * A city with 50 buildings × 200 windows = 10,000 objects becomes ~5 draw calls
 * (one InstancedMesh2 per unique geometry/material pair).
 *
 * Reference: Three.js InstancedMesh documentation
 * https://threejs.org/docs/#api/en/objects/InstancedMesh
 */
import { Euler, Group2, InstancedMesh2, Matrix4, Quaternion, Vector3 } from 'threepipe';
import { SeededRandom } from '../utils/SeededRandom';
// Reusable temporaries for matrix composition
const _matrix = new Matrix4();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);
/**
 * Create a single InstancedMesh2 with the same geometry/material at every point.
 * Most efficient when all instances share the same source.
 */
export function atPoints(cloud, source, options) {
    if (cloud.length === 0) {
        return new InstancedMesh2(source.geometry, source.material, 0);
    }
    const rng = options?.seed !== undefined ? new SeededRandom(options.seed) : new SeededRandom(42);
    const inst = new InstancedMesh2(source.geometry, source.material, cloud.length);
    inst.name = 'Instances';
    for (let i = 0; i < cloud.length; i++) {
        _composeMatrix(cloud[i], rng, options);
        inst.setMatrixAt(i, _matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingBox();
    inst.computeBoundingSphere();
    return inst;
}
/**
 * Randomly pick from multiple source geometries per point (weighted random).
 * Creates one InstancedMesh2 per unique source — each with only the points assigned to it.
 * Maps to Blender's "Collection Info + Pick Instance" pattern.
 */
export function pickFromCollection(cloud, sources, options) {
    const group = new Group2();
    group.name = 'InstanceCollection';
    if (cloud.length === 0 || sources.length === 0)
        return group;
    const rng = options?.seed !== undefined ? new SeededRandom(options.seed) : new SeededRandom(42);
    // Bin points by which source they pick
    const bins = sources.map(() => []);
    const totalWeight = sources.reduce((sum, s) => sum + (s.weight ?? 1), 0);
    for (let i = 0; i < cloud.length; i++) {
        // Weighted random selection
        let r = rng.next() * totalWeight;
        let chosen = 0;
        for (let j = 0; j < sources.length; j++) {
            r -= sources[j].weight ?? 1;
            if (r <= 0) {
                chosen = j;
                break;
            }
        }
        bins[chosen].push(i);
    }
    // Create one InstancedMesh2 per source that has at least one point
    for (let s = 0; s < sources.length; s++) {
        const indices = bins[s];
        if (indices.length === 0)
            continue;
        const src = sources[s];
        const inst = new InstancedMesh2(src.geometry, src.material, indices.length);
        inst.name = `Instances_${s}`;
        // Use a separate rng fork per source to keep instance variation deterministic
        const instRng = rng.fork();
        for (let i = 0; i < indices.length; i++) {
            _composeMatrix(cloud[indices[i]], instRng, options);
            inst.setMatrixAt(i, _matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingBox();
        inst.computeBoundingSphere();
        group.add(inst);
    }
    return group;
}
/**
 * Rule-based instancing: different sources for different point attributes.
 * Each rule has a match predicate and a set of sources. Points are tested
 * against rules in order — first match wins.
 */
export function byRules(cloud, rules, options) {
    const seed = options?.seed ?? 42;
    const group = new Group2();
    group.name = 'InstanceRules';
    if (cloud.length === 0 || rules.length === 0)
        return group;
    const rng = new SeededRandom(seed);
    // For each rule, collect matched points and pick a source per point
    // Structure: ruleIndex → sourceIndex → pointIndices[]
    const assignments = new Map(); // key: "ruleIdx_sourceIdx"
    for (let i = 0; i < cloud.length; i++) {
        const pt = cloud[i];
        for (let r = 0; r < rules.length; r++) {
            if (!rules[r].match(pt))
                continue;
            const ruleSources = rules[r].sources;
            if (ruleSources.length === 0)
                break;
            // Pick source (weighted random)
            let sourceIdx = 0;
            if (ruleSources.length > 1) {
                const totalW = ruleSources.reduce((s, src) => s + (src.weight ?? 1), 0);
                let rand = rng.next() * totalW;
                for (let j = 0; j < ruleSources.length; j++) {
                    rand -= ruleSources[j].weight ?? 1;
                    if (rand <= 0) {
                        sourceIdx = j;
                        break;
                    }
                }
            }
            const key = `${r}_${sourceIdx}`;
            if (!assignments.has(key))
                assignments.set(key, []);
            assignments.get(key).push(i);
            break; // first matching rule wins
        }
    }
    // Create one InstancedMesh2 per (rule, source) pair
    for (const [key, indices] of assignments) {
        const [ruleIdx, sourceIdx] = key.split('_').map(Number);
        const src = rules[ruleIdx].sources[sourceIdx];
        if (!src)
            continue;
        const inst = new InstancedMesh2(src.geometry, src.material, indices.length);
        inst.name = `Rule${ruleIdx}_Source${sourceIdx}`;
        const instRng = rng.fork();
        for (let i = 0; i < indices.length; i++) {
            _composeMatrix(cloud[indices[i]], instRng, options);
            inst.setMatrixAt(i, _matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingBox();
        inst.computeBoundingSphere();
        group.add(inst);
    }
    return group;
}
/**
 * Compose a transform matrix for a single instance from its ProcPoint + options.
 * Writes result to the module-level _matrix.
 */
function _composeMatrix(pt, rng, options) {
    _position.copy(pt.position);
    // Rotation
    if (pt.rotation) {
        _quaternion.setFromEuler(pt.rotation);
    }
    else if (options?.alignToNormal && pt.normal.lengthSq() > 0.001) {
        // Align Y-axis to normal
        _quaternion.setFromUnitVectors(_up, pt.normal);
    }
    else {
        _quaternion.identity();
    }
    if (options?.randomRotationY) {
        const yRot = rng.next() * Math.PI * 2;
        const yQuat = new Quaternion().setFromEuler(new Euler(0, yRot, 0));
        _quaternion.multiply(yQuat);
    }
    // Scale
    if (pt.scale) {
        _scale.copy(pt.scale);
    }
    else if (options?.scaleRange) {
        const s = rng.range(options.scaleRange[0], options.scaleRange[1]);
        _scale.set(s, s, s);
    }
    else {
        _scale.set(1, 1, 1);
    }
    _matrix.compose(_position, _quaternion, _scale);
}
