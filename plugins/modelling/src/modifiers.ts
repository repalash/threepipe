/**
 * A live modifier stack.
 *
 * The SU-152 report's fourth request, and the one with the clearest cost attached: it arrayed 88
 * track shoes along a spline, then found the master shoe wrong, and had to re-array by hand. The
 * same happened for wheel ribs and roof fasteners. Its words: "no live modifier system updated all
 * instances when one changed".
 *
 * So an object keeps two meshes. `mesh` is the master - the one vertex indices refer to, the one
 * `vertices` and `transform` edit, the one that stays small enough to reason about. `evaluated` is
 * what the renderer sees, rebuilt from the master through the stack on every change. Edit the one
 * shoe and all 88 follow, which is what Blender does and why its modifiers are non-destructive.
 *
 * `{op: 'modifier', object: 'shoe', apply: true}` bakes the stack down when the object is finished.
 */

import {
    arrayCurve,
    arrayLinear,
    arrayRadial,
    bmFromMesh,
    bmToMesh,
    mirrorGeometry,
    Vec3,
} from '@threepipe/mesh-kernel'
import type {MeshData} from '@threepipe/mesh-kernel'

export interface ArrayModifierSpec {
    type: 'array'
    mode: 'linear' | 'radial' | 'curve'
    count: number
    /** Linear: offset between copies. */
    step?: Vec3
    /** Radial: total sweep in radians, default a full turn. */
    angle?: number
    axis?: Vec3
    pivot?: Vec3
    /** Curve: the path copies follow. */
    path?: Vec3[]
    closed?: boolean
    merge?: boolean
    mergeThreshold?: number
}

export interface MirrorModifierSpec {
    type: 'mirror'
    axis: 'x' | 'y' | 'z'
    mergeDistance?: number
    center?: Vec3
}

export type ModifierSpec = ArrayModifierSpec | MirrorModifierSpec

/**
 * Run a master mesh through its stack.
 *
 * Each modifier is applied to the output of the one before it, in order, exactly as Blender
 * evaluates a stack - so an array of a mirror is two symmetric halves repeated, and a mirror of an
 * array is the repetition reflected. The order is visible and reorderable for that reason.
 */
export function evaluateModifiers(mesh: MeshData, modifiers: ModifierSpec[]): MeshData {
    if (!modifiers.length) return mesh
    let current = mesh
    for (const modifier of modifiers) {
        const bm = bmFromMesh(current)
        const input = {verts: [...bm.verts], edges: [...bm.edges], faces: [...bm.faces]}
        if (modifier.type === 'array') {
            const merge = modifier.merge !== false
            if (modifier.mode === 'radial') {
                arrayRadial(bm, input, {
                    count: modifier.count,
                    angle: modifier.angle ?? Math.PI * 2,
                    axis: modifier.axis ?? [0, 1, 0],
                    pivot: modifier.pivot ?? [0, 0, 0],
                    merge,
                })
            } else if (modifier.mode === 'curve') {
                arrayCurve(bm, input, {
                    path: modifier.path ?? [],
                    count: modifier.count,
                    closed: modifier.closed,
                })
            } else {
                arrayLinear(bm, input, {
                    count: modifier.count,
                    step: modifier.step ?? [0, 0, 0],
                    merge,
                    mergeThreshold: modifier.mergeThreshold,
                })
            }
        } else {
            mirrorGeometry(bm, input, {
                axis: modifier.axis,
                mergeDistance: modifier.mergeDistance ?? 0.001,
                matrix: modifier.center
                    ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...modifier.center, 1]
                    : undefined,
            })
        }
        current = bmToMesh(bm)
    }
    return current
}

/** Validate a modifier before it goes on a stack, so a bad one fails at the command, not at bake. */
export function checkModifier(spec: ModifierSpec): void {
    if (spec.type === 'array') {
        if (!Number.isInteger(spec.count) || spec.count < 1) {
            throw new Error('an array modifier needs a whole `count` of at least 1')
        }
        if (spec.mode === 'linear' && !spec.step) {
            throw new Error('a linear array modifier needs a `step` offset')
        }
        if (spec.mode === 'curve' && (!spec.path || spec.path.length < 2)) {
            throw new Error('a curve array modifier needs a `path` of at least 2 points')
        }
    } else if (spec.type === 'mirror') {
        if (!['x', 'y', 'z'].includes(spec.axis)) {
            throw new Error('a mirror modifier needs an `axis` of x, y or z')
        }
    } else {
        throw new Error(`unknown modifier type "${(spec as {type: string}).type}"`)
    }
}

/** A one-line description, for `inspect` and for a UI list. */
export function describeModifier(spec: ModifierSpec): string {
    if (spec.type === 'array') {
        const detail = spec.mode === 'radial'
            ? `${((spec.angle ?? Math.PI * 2) * 180 / Math.PI).toFixed(0)}° about [${(spec.axis ?? [0, 1, 0]).join(', ')}]`
            : spec.mode === 'curve'
                ? `along ${spec.path?.length ?? 0} path points`
                : `step [${(spec.step ?? [0, 0, 0]).join(', ')}]`
        return `array ${spec.mode} ×${spec.count}, ${detail}`
    }
    return `mirror ${spec.axis}`
}
