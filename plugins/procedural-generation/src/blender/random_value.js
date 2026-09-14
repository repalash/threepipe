/**
 * Port of Blender's Random Value geometry node (FunctionNodeRandomValue).
 *
 * Source: source/blender/nodes/function/nodes/node_fn_random_value.cc
 *
 * Each data type (INT, FLOAT, BOOL, VECTOR) uses the hash differently:
 *   INT:    hash(id, seed) % range + min           — integer modulo
 *   FLOAT:  hash_to_float(seed, id) * range + min  — float scale, SWAPPED args
 *   BOOL:   hash_to_float(id, seed) <= probability — compare, same arg order as INT
 *   VECTOR: hash_to_float(seed, id, component)     — per-component, SWAPPED args
 */
import { hash2, hash_to_float2, hash_to_float3 } from './noise';
// source/blender/nodes/function/nodes/node_fn_random_value.cc — case CD_PROP_INT32
/** Random integer in [min, max]. Uses hash(id, seed) with integer modulo. */
export function randomInt(min, max, id, seed) {
    if (min > max) {
        const t = min;
        min = max;
        max = t;
    }
    const h = hash2(id, seed);
    const range = ((max >>> 0) - (min >>> 0) + 1) >>> 0;
    const modulo = range === 0 ? h : (h % range) >>> 0;
    return ((min >>> 0) + modulo) | 0;
}
// source/blender/nodes/function/nodes/node_fn_random_value.cc — case CD_PROP_FLOAT
/** Random float in [min, max]. Uses hash_to_float(seed, id) — note swapped args. */
export function randomFloat(min, max, id, seed) {
    return hash_to_float2(seed, id) * (max - min) + min;
}
// source/blender/nodes/function/nodes/node_fn_random_value.cc — case CD_PROP_BOOL
/** Random boolean with given probability. Uses hash_to_float(id, seed). */
export function randomBool(probability, id, seed) {
    return hash_to_float2(id, seed) <= probability;
}
// source/blender/nodes/function/nodes/node_fn_random_value.cc — case CD_PROP_FLOAT3
/** Random 3D vector with components in [min, max]. Uses hash_to_float(seed, id, component). */
export function randomVector(min, max, id, seed) {
    return [
        hash_to_float3(seed, id, 0) * (max[0] - min[0]) + min[0],
        hash_to_float3(seed, id, 1) * (max[1] - min[1]) + min[1],
        hash_to_float3(seed, id, 2) * (max[2] - min[2]) + min[2],
    ];
}
