/**
 * Port of Blender math/utility nodes used in geometry node graphs.
 *
 * These are shared across Blender's shader and geometry node systems.
 * The ShaderNode* prefix indicates where the node was originally defined,
 * not that it's shader-specific.
 *
 * Source references point to the Blender source tree at:
 *   .repos/blender-source/source/blender/
 */
// ─── ShaderNodeMapRange ─────────────────────────────────────────────
// source: nodes/shader/nodes/node_shader_map_range.cc
/**
 * Remap a value from one range to another. Equivalent to Blender's Map Range node (LINEAR).
 * Blender's Map Range clamps by default (Clamp checkbox enabled).
 * Source: nodes/shader/nodes/node_shader_map_range.cc
 * @param clamp If true (default), clamp t to [0,1] before interpolating.
 */
export function mapRange(value, fromMin, fromMax, toMin, toMax, clamp = true) {
    if (fromMax === fromMin)
        return toMin;
    let t = (value - fromMin) / (fromMax - fromMin);
    if (clamp)
        t = Math.max(0, Math.min(1, t));
    return toMin + t * (toMax - toMin);
}
/** Map Range with STEPPED interpolation. */
export function mapRangeStepped(value, fromMin, fromMax, toMin, toMax, steps) {
    if (fromMax === fromMin || steps <= 0)
        return toMin;
    const t = (value - fromMin) / (fromMax - fromMin);
    const stepped = Math.floor(t * (steps + 1)) / steps;
    return toMin + stepped * (toMax - toMin);
}
/** Map Range with SMOOTHSTEP interpolation. */
export function mapRangeSmoothstep(value, fromMin, fromMax, toMin, toMax) {
    if (fromMax === fromMin)
        return toMin;
    let t = (value - fromMin) / (fromMax - fromMin);
    t = Math.max(0, Math.min(1, t));
    t = t * t * (3 - 2 * t); // smoothstep
    return toMin + t * (toMax - toMin);
}
// ─── ShaderNodeClamp ────────────────────────────────────────────────
// source: nodes/shader/nodes/node_shader_clamp.cc
/** Clamp a value to [min, max]. */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
// ─── ShaderNodeMix ──────────────────────────────────────────────────
// source: nodes/shader/nodes/node_shader_mix.cc
/** Linear interpolation between two values. Equivalent to Blender's Mix node (FLOAT). */
export function mixFloat(factor, a, b) {
    return a * (1 - factor) + b * factor;
}
/** Linear interpolation between two 3D vectors. Equivalent to Blender's Mix node (VECTOR). */
export function mixVector(factor, a, b) {
    return [
        a[0] * (1 - factor) + b[0] * factor,
        a[1] * (1 - factor) + b[1] * factor,
        a[2] * (1 - factor) + b[2] * factor,
    ];
}
// ─── FunctionNodeCompare ────────────────────────────────────────────
// source: nodes/function/nodes/node_fn_compare.cc
/** Compare two values. Operation matches Blender's Compare node `operation` enum. */
export function compare(a, b, operation) {
    switch (operation) {
        case 'LESS_THAN': return a < b;
        case 'LESS_EQUAL': return a <= b;
        case 'GREATER_THAN': return a > b;
        case 'GREATER_EQUAL': return a >= b;
        case 'EQUAL': return a === b;
        case 'NOT_EQUAL': return a !== b;
        default: return false;
    }
}
/** Compare with epsilon (for FLOAT data_type with ELEMENT mode). */
export function compareFloat(a, b, operation, epsilon = 0.0001) {
    switch (operation) {
        case 'LESS_THAN': return a < b;
        case 'LESS_EQUAL': return a <= b;
        case 'GREATER_THAN': return a > b;
        case 'GREATER_EQUAL': return a >= b;
        case 'EQUAL': return Math.abs(a - b) <= epsilon;
        case 'NOT_EQUAL': return Math.abs(a - b) > epsilon;
        default: return false;
    }
}
// ─── FunctionNodeBooleanMath ────────────────────────────────────────
// source: nodes/function/nodes/node_fn_boolean_math.cc
/** Boolean math operations matching Blender's Boolean Math node `operation` enum. */
export function booleanMath(a, b, operation) {
    switch (operation) {
        case 'AND': return a && b;
        case 'OR': return a || b;
        case 'NOT': return !a;
        case 'NAND': return !(a && b);
        case 'NOR': return !(a || b);
        case 'XNOR': return a === b;
        case 'XOR': return a !== b;
        case 'IMPLY': return !a || b;
        case 'NIMPLY': return a && !b;
        default: return false;
    }
}
// ─── ShaderNodeMath (operation enum) ────────────────────────────────
// source: nodes/shader/nodes/node_shader_math.cc
//
// Not a single function — each operation maps to inline JS.
// This lookup is provided for convenience when processing extracted node graphs.
/** Evaluate a ShaderNodeMath operation. Matches Blender's Math node `operation` enum. */
export function mathOp(operation, a, b = 0, c = 0) {
    switch (operation) {
        case 'ADD': return a + b;
        case 'SUBTRACT': return a - b;
        case 'MULTIPLY': return a * b;
        case 'DIVIDE': return b !== 0 ? a / b : 0;
        case 'MULTIPLY_ADD': return a * b + c;
        case 'POWER': return Math.pow(a, b);
        case 'LOGARITHM': return b > 0 ? Math.log(a) / Math.log(b) : 0;
        case 'SQRT': return Math.sqrt(a);
        case 'INVERSE_SQRT': return a > 0 ? 1 / Math.sqrt(a) : 0;
        case 'ABSOLUTE': return Math.abs(a);
        case 'EXPONENT': return Math.exp(a);
        case 'MINIMUM': return Math.min(a, b);
        case 'MAXIMUM': return Math.max(a, b);
        case 'LESS_THAN': return a < b ? 1 : 0;
        case 'GREATER_THAN': return a > b ? 1 : 0;
        case 'SIGN': return Math.sign(a);
        case 'COMPARE': return Math.abs(a - b) <= c ? 1 : 0;
        case 'SMOOTH_MIN': return smoothMin(a, b, c);
        case 'SMOOTH_MAX': return -smoothMin(-a, -b, c);
        case 'ROUND': return Math.round(a);
        case 'FLOOR': return Math.floor(a);
        case 'CEIL': return Math.ceil(a);
        case 'TRUNC': return Math.trunc(a);
        case 'FRACT': return a - Math.floor(a);
        case 'MODULO': return b !== 0 ? ((a % b) + b) % b : 0; // Blender modulo is always positive
        case 'FLOORED_MODULO': return b !== 0 ? a - Math.floor(a / b) * b : 0;
        // Source: blenlib/intern/math_base_inline.cc:271 — wrapf(value, max, min)
        case 'WRAP': {
            const range = b - c;
            return range !== 0 ? a - range * Math.floor((a - c) / range) : c;
        }
        case 'SNAP': return b !== 0 ? Math.floor(a / b) * b : a;
        case 'PINGPONG': return b !== 0 ? Math.abs(((a % (2 * b)) + 2 * b) % (2 * b) - b) : 0;
        case 'SINE': return Math.sin(a);
        case 'COSINE': return Math.cos(a);
        case 'TANGENT': return Math.tan(a);
        case 'ARCSINE': return Math.asin(clamp(a, -1, 1));
        case 'ARCCOSINE': return Math.acos(clamp(a, -1, 1));
        case 'ARCTANGENT': return Math.atan(a);
        case 'ARCTAN2': return Math.atan2(a, b);
        case 'SINH': return Math.sinh(a);
        case 'COSH': return Math.cosh(a);
        case 'TANH': return Math.tanh(a);
        case 'RADIANS': return a * Math.PI / 180;
        case 'DEGREES': return a * 180 / Math.PI;
        default: return 0;
    }
}
function smoothMin(a, b, k) {
    if (k <= 0)
        return Math.min(a, b);
    const h = Math.max(0, Math.min(1, (b - a + k) / (2 * k)));
    return a * h + b * (1 - h) - k * h * (1 - h);
}
