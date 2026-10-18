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
    BM_FROM_MESH_NORMALS,
    bmFromMesh,
    bmToMesh,
    mirrorGeometry,
    subdivisionSurface,
    Vec3,
    weightedNormal,
    wireframe,
} from '@threepipe/mesh-kernel'
import type {SubdivBoundarySmooth, SubdivUVSmooth, WeightedNormalMode} from '@threepipe/mesh-kernel'
import {MeshData} from '@threepipe/mesh-kernel'
import type {ModellingDocument, ModellingEntry} from './document'

export interface ArrayModifierSpec {
    type: 'array'
    mode: 'linear' | 'radial' | 'curve'
    count: number
    /** Linear: offset between copies. Radial: offset added per copy as it turns (Blender's constant offset). */
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

/**
 * Blender's Wireframe modifier (`MOD_wireframe.cc`): every edge of the evaluated mesh becomes a
 * strut, through the same `BM_mesh_wireframe` the `wireframe` command runs.
 *
 * A field left out takes the *modifier's* default (`WireframeModifierData`, `DNA_modifier_types.h`:
 * thickness 0.02, offset 0, replace and even offset on, boundary off, crease weight 1), which is not
 * the edit-mode operator's. The `wireframe` command with `live: true` writes every field explicitly,
 * so a live wireframe and a baked one from the same command are the same geometry.
 */
export interface WireframeModifierSpec {
    type: 'wireframe'
    /** Strut thickness, `wmd->offset`. Default 0.02. */
    thickness?: number
    /** Placement in -1..1, `wmd->offset_fac`. Default 0. */
    offset?: number
    /** `MOD_WIREFRAME_REPLACE`: remove the original faces. Default true. */
    replace?: boolean
    /** `MOD_WIREFRAME_BOUNDARY`: strut the open boundary too. Default false. */
    boundary?: boolean
    /** `MOD_WIREFRAME_OFS_EVEN`: keep strut widths true at sharp corners. Default true. */
    evenOffset?: boolean
    /** `MOD_WIREFRAME_OFS_RELATIVE`: scale thickness by local edge length. Default false. */
    relativeOffset?: boolean
    /** `MOD_WIREFRAME_CREASE`: crease the hub edges. Default false. */
    crease?: boolean
    /** `wmd->crease_weight`. Default 1. */
    creaseWeight?: number
    /** `wmd->mat_ofs`, added to new faces' material index. Default 0. */
    materialOffset?: number
}

/**
 * Blender's Subdivision Surface modifier (`MOD_subsurf.cc`, settings per `subdiv_modifier.cc:31-39`), evaluated by
 * the kernel's OpenSubdiv port. Defaults are `SubsurfModifierData`'s (`DNA_modifier_types.h`): levels 1, quality 3,
 * limit surface on, creases on, boundary smooth ALL, UV smooth PRESERVE_BOUNDARIES, Catmull-Clark.
 */
export interface SubsurfModifierSpec {
    type: 'subsurf'
    levels?: number
    quality?: number
    useLimitSurface?: boolean
    useCreases?: boolean
    boundarySmooth?: SubdivBoundarySmooth
    uvSmooth?: SubdivUVSmooth
    /** `CATMULL_CLARK` or `SIMPLE`. */
    subdivisionType?: 'CATMULL_CLARK' | 'SIMPLE'
}

/**
 * Blender's Weighted Normal modifier (`MOD_weighted_normal.cc`), through the kernel's port: custom normals that
 * mix each vertex's (or smooth fan's) face normals by area and/or corner angle, so big faces stay flat and bevels
 * take the bend. Defaults are `WeightedNormalModifierData`'s: face area, weight 50, threshold 0.01.
 */
export interface WeightedNormalModifierSpec {
    type: 'weightedNormal'
    mode?: WeightedNormalMode
    weight?: number
    threshold?: number
    keepSharp?: boolean
    useFaceInfluence?: boolean
}

/** The modifiers this package implements. */
export type BuiltinModifierSpec = ArrayModifierSpec | MirrorModifierSpec | WireframeModifierSpec | SubsurfModifierSpec | WeightedNormalModifierSpec

/**
 * A modifier of a type another package registered with {@link registerModifierType} - for example
 * `@threepipe/plugin-procedural`'s `{type: 'geometryNodes', group, inputs}`. Plain JSON, so it survives
 * snapshots and the glTF extension unchanged.
 */
export interface CustomModifierSpec {
    type: string
    [key: string]: unknown
}

export type ModifierSpec = BuiltinModifierSpec | CustomModifierSpec

/** What a modifier's evaluation sees besides its input mesh. */
export interface ModifierContext {
    /**
     * The document, for modifiers that read document data or other objects. Absent when a stack is
     * evaluated outside a document (`evaluateModifiers(mesh, specs)`); such modifiers throw then.
     */
    doc?: ModellingDocument
    /** The object whose stack is evaluated, when there is one. */
    entry?: ModellingEntry
    /** Position of the modifier in the stack. */
    index: number
    /**
     * The previous modifier's output, when it carried more than a mesh: a geometry-nodes modifier reads the whole
     * geometry (instances, points, curves) as Blender passes the geometry set down the stack.
     */
    previous?: ModifierResult
    /**
     * State a modifier keeps between evaluations of this entry (caches, incremental evaluators). Keyed
     * by the modifier type's choice; cleared when the entry's stack changes shape.
     */
    state: Map<string, unknown>
}

/**
 * A modifier's output: the mesh the next modifier (and the renderer) receives, and optionally richer
 * geometry the type's own package knows how to draw (instances, points, curves). Mesh-only modifiers after it
 * change the mesh and pass the rest on, as Blender's stack does for non-node modifiers after a geometry-nodes one;
 * the stack's last `geometry` is kept as `ModellingEntry.evaluatedGeometry`.
 */
export interface ModifierResult {
    mesh: MeshData
    geometry?: unknown
    /**
     * The mesh applying the stack bakes, from the stack's final mesh, when it is more than that mesh (a
     * geometry-nodes modifier realizes its instances, as Blender's apply does). Default: the final mesh.
     */
    realize?(mesh: MeshData): MeshData
    /**
     * Vertex and triangle counts of the geometry besides {@link mesh} (instances, points), for scene statistics:
     * Blender's statistics count the evaluated instances too. Called lazily.
     */
    stats?(): GeometryStats
}

/** Counts as Blender's statistics give them in object mode: vertices and triangles. */
export interface GeometryStats {
    verts: number
    tris: number
}

/** A modifier type. The built-ins are registered below; other packages add theirs at runtime. */
export interface ModifierType<S extends ModifierSpec = ModifierSpec> {
    type: string
    /** One line for the `modifier` command's description. */
    summary?: string
    /** JSON Schema of the spec's fields besides `type`, merged into the `modifier` command's `add` schema. */
    properties?: Record<string, unknown>
    /** Normalise a loose parameter bag (defaults, inferred fields). Defaults to the bag as is. */
    read?(raw: Record<string, unknown>): S
    /** Throw with a useful message when the spec cannot be evaluated. */
    check(spec: S): void
    /** One line, for `inspect`, the `modifier` listing and UI lists. */
    describe(spec: S): string
    evaluate(mesh: MeshData, spec: S, ctx: ModifierContext): MeshData | ModifierResult
    /**
     * The modifier's editable fields for a UI. Defaults to {@link properties} and the spec's own values; a type
     * whose fields are not its spec's keys (a geometry-nodes group's inputs) supplies its own.
     */
    fields?(spec: S, doc: ModellingDocument | undefined): ModifierFields | undefined
}

/** Editable fields of one modifier: a JSON schema, the current values, and the `modifier` command's `update` for new values. */
export interface ModifierFields {
    schema: {type: 'object', properties: Record<string, unknown>}
    values: Record<string, unknown>
    update(values: Record<string, unknown>): Record<string, unknown>
}

/** {@link ModifierType.fields} of a spec, or the default from the type's `properties`. */
export function modifierFields(spec: ModifierSpec, doc?: ModellingDocument): ModifierFields | undefined {
    const def = modifierTypes.get(spec.type)
    if (!def) return undefined
    if (def.fields) return def.fields(spec, doc)
    if (!def.properties) return undefined
    const {type: _type, ...values} = spec as Record<string, unknown>
    void _type
    return {
        schema: {type: 'object', properties: def.properties},
        values,
        // Keys set to undefined are dropped from the spec (JSON), so a cleared field returns to its default.
        update: next => Object.fromEntries(Object.keys({...values, ...next}).map(k => [k, next[k]])),
    }
}

const modifierTypes = new Map<string, ModifierType>()

/**
 * Add a modifier type. Throws when the type exists, unless `replace` is set (for tests and hot reload).
 * `plugin-modelling` does not depend on the packages that call this.
 */
export function registerModifierType<S extends ModifierSpec>(def: ModifierType<S>, replace = false): void {
    if (modifierTypes.has(def.type) && !replace) throw new Error(`modifier type "${def.type}" is already registered`)
    modifierTypes.set(def.type, def as unknown as ModifierType)
}

export function unregisterModifierType(type: string): void {
    modifierTypes.delete(type)
}

export function getModifierType(type: string): ModifierType | undefined {
    return modifierTypes.get(type)
}

/** Every registered type, built-ins first. */
export function getModifierTypes(): ModifierType[] {
    return [...modifierTypes.values()]
}

function requireModifierType(type: unknown): ModifierType {
    const def = typeof type === 'string' ? modifierTypes.get(type) : undefined
    if (!def) {
        throw new Error(`unknown modifier type "${String(type)}"`
            + ` - registered: ${[...modifierTypes.keys()].join(', ')}`)
    }
    return def
}

/** Read a loose parameter bag into a spec of its registered type. */
export function readModifier(raw: Record<string, unknown>): ModifierSpec {
    const def = requireModifierType(raw.type)
    return def.read ? def.read(raw) : {...raw} as ModifierSpec
}

/**
 * Run a master mesh through its stack, keeping the last modifier's extra geometry.
 *
 * Each modifier is applied to the output of the one before it, in order, exactly as Blender
 * evaluates a stack - so an array of a mirror is two symmetric halves repeated, and a mirror of an
 * array is the repetition reflected. The order is visible and reorderable for that reason.
 */
export function evaluateModifierStack(mesh: MeshData, modifiers: ModifierSpec[], ctx?: Omit<ModifierContext, 'index'>): ModifierResult {
    let current: ModifierResult = {mesh}
    const base = ctx ?? {state: new Map<string, unknown>()}
    modifiers.forEach((modifier, index) => {
        const previous = current.geometry !== undefined || current.realize ? current : undefined
        const out = requireModifierType(modifier.type).evaluate(current.mesh, modifier, {...base, index, previous})
        current = out instanceof MeshData ? {mesh: out, geometry: current.geometry, realize: current.realize, stats: current.stats} : out
    })
    return current
}

/** {@link evaluateModifierStack}'s mesh: what the renderer draws for an object. */
export function evaluateModifiers(mesh: MeshData, modifiers: ModifierSpec[], ctx?: Omit<ModifierContext, 'index'>): MeshData {
    return evaluateModifierStack(mesh, modifiers, ctx).mesh
}

/** Validate a modifier before it goes on a stack, so a bad one fails at the command, not at bake. */
export function checkModifier(spec: ModifierSpec): void {
    requireModifierType(spec.type).check(spec)
}

/** A one-line description, for `inspect` and for a UI list. */
export function describeModifier(spec: ModifierSpec): string {
    const def = modifierTypes.get(spec.type)
    return def ? def.describe(spec) : `${spec.type} (not registered)`
}

// region built-in types

/** The kernel's ops work on BMesh; each built-in converts in and out. */
function viaBMesh(mesh: MeshData, run: (bm: ReturnType<typeof bmFromMesh>, input: {verts: any[], edges: any[], faces: any[]}) => void): MeshData {
    const bm = bmFromMesh(mesh, BM_FROM_MESH_NORMALS)
    const input = {verts: [...bm.verts], edges: [...bm.edges], faces: [...bm.faces]}
    run(bm, input)
    return bmToMesh(bm)
}

registerModifierType<ArrayModifierSpec>({
    type: 'array',
    summary: '`{type: "array", mode, count, ...}`',
    properties: {
        mode: {type: 'string', enum: ['linear', 'radial', 'curve']},
        count: {type: 'integer', minimum: 1},
        step: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3},
        angle: {type: 'number'},
        axis: {},
        pivot: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3},
        path: {type: 'array', items: {type: 'array', items: {type: 'number'}}},
        closed: {type: 'boolean'},
        merge: {type: 'boolean'},
        mergeThreshold: {type: 'number'},
    },
    // `mode` is inferred from which parameters are present when it is left out, by the same rule the
    // `array` command uses - so `{type: 'array', count: 6, step: [...]}` means the same thing to both.
    read(raw) {
        const mode = (raw.mode as 'linear' | 'radial' | 'curve' | undefined)
            ?? (raw.path ? 'curve' : raw.angle !== undefined || raw.pivot !== undefined ? 'radial' : 'linear')
        return {
            type: 'array',
            mode,
            count: raw.count as number,
            step: raw.step as Vec3 | undefined,
            angle: raw.angle as number | undefined,
            axis: raw.axis as Vec3 | undefined,
            pivot: raw.pivot as Vec3 | undefined,
            path: raw.path as Vec3[] | undefined,
            closed: raw.closed as boolean | undefined,
            merge: raw.merge as boolean | undefined,
            mergeThreshold: raw.mergeThreshold as number | undefined,
        }
    },
    check(spec) {
        if (!Number.isInteger(spec.count) || spec.count < 1) {
            throw new Error('an array modifier needs a whole `count` of at least 1')
        }
        if (spec.mode === 'linear' && !spec.step) {
            throw new Error('a linear array modifier needs a `step` offset')
        }
        if (spec.mode === 'curve' && (!spec.path || spec.path.length < 2)) {
            throw new Error('a curve array modifier needs a `path` of at least 2 points')
        }
    },
    describe(spec) {
        const detail = spec.mode === 'radial'
            ? `${((spec.angle ?? Math.PI * 2) * 180 / Math.PI).toFixed(0)}° about [${(spec.axis ?? [0, 1, 0]).join(', ')}]`
                + (spec.step ? `, step [${spec.step.join(', ')}]` : '')
            : spec.mode === 'curve'
                ? `along ${spec.path?.length ?? 0} path points`
                : `step [${(spec.step ?? [0, 0, 0]).join(', ')}]`
        return `array ${spec.mode} ×${spec.count}, ${detail}`
    },
    evaluate(mesh, spec) {
        return viaBMesh(mesh, (bm, input) => {
            const merge = spec.merge !== false
            if (spec.mode === 'radial') {
                arrayRadial(bm, input, {
                    count: spec.count,
                    angle: spec.angle ?? Math.PI * 2,
                    axis: spec.axis ?? [0, 1, 0],
                    pivot: spec.pivot ?? [0, 0, 0],
                    step: spec.step,
                    merge,
                })
            } else if (spec.mode === 'curve') {
                arrayCurve(bm, input, {path: spec.path ?? [], count: spec.count, closed: spec.closed})
            } else {
                arrayLinear(bm, input, {count: spec.count, step: spec.step ?? [0, 0, 0], merge, mergeThreshold: spec.mergeThreshold})
            }
        })
    },
})

registerModifierType<MirrorModifierSpec>({
    type: 'mirror',
    summary: '`{type: "mirror", axis}`',
    properties: {
        axis: {},
        mergeDistance: {type: 'number'},
        center: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3},
    },
    read(raw) {
        return {
            type: 'mirror',
            axis: (raw.axis as 'x' | 'y' | 'z') ?? 'x',
            mergeDistance: raw.mergeDistance as number | undefined,
            center: raw.center as Vec3 | undefined,
        }
    },
    check(spec) {
        if (!['x', 'y', 'z'].includes(spec.axis)) {
            throw new Error('a mirror modifier needs an `axis` of x, y or z')
        }
    },
    describe: spec => `mirror ${spec.axis}`,
    evaluate(mesh, spec) {
        return viaBMesh(mesh, (bm, input) => {
            mirrorGeometry(bm, input, {
                axis: spec.axis,
                mergeDistance: spec.mergeDistance ?? 0.001,
                matrix: spec.center ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...spec.center, 1] : undefined,
            })
        })
    },
})

registerModifierType<WireframeModifierSpec>({
    type: 'wireframe',
    summary: '`{type: "wireframe", thickness, ...}` (a field left out takes the Wireframe modifier\'s default: '
        + 'thickness 0.02, offset 0, replace and evenOffset on, boundary off - not the `wireframe` command\'s)',
    properties: {
        thickness: {type: 'number', minimum: 0},
        offset: {type: 'number'},
        replace: {type: 'boolean'},
        boundary: {type: 'boolean'},
        evenOffset: {type: 'boolean'},
        relativeOffset: {type: 'boolean'},
        crease: {type: 'boolean'},
        creaseWeight: {type: 'number'},
        materialOffset: {type: 'integer'},
    },
    read(raw) {
        return {
            type: 'wireframe',
            thickness: raw.thickness as number | undefined,
            offset: raw.offset as number | undefined,
            replace: raw.replace as boolean | undefined,
            boundary: raw.boundary as boolean | undefined,
            evenOffset: raw.evenOffset as boolean | undefined,
            relativeOffset: raw.relativeOffset as boolean | undefined,
            crease: raw.crease as boolean | undefined,
            creaseWeight: raw.creaseWeight as number | undefined,
            materialOffset: raw.materialOffset as number | undefined,
        }
    },
    check(spec) {
        if (spec.thickness !== undefined && (!Number.isFinite(spec.thickness) || spec.thickness < 0)) {
            throw new Error('a wireframe modifier `thickness` must be a number of 0 or more')
        }
        if (spec.offset !== undefined && !Number.isFinite(spec.offset)) {
            throw new Error('a wireframe modifier `offset` must be a number')
        }
    },
    describe: spec => `wireframe ${spec.thickness ?? 0.02}`,
    // The modifier's call: every face, no tags (`MOD_wireframe.cc`, `use_tag = false`). Defaults are
    // `WireframeModifierData`'s, not the operator's - see the spec.
    evaluate(mesh, spec) {
        return viaBMesh(mesh, bm => {
            wireframe(bm, null, {
                thickness: spec.thickness ?? 0.02,
                offset: spec.offset ?? 0,
                useReplace: spec.replace ?? true,
                useBoundary: spec.boundary ?? false,
                useEvenOffset: spec.evenOffset ?? true,
                useRelativeOffset: spec.relativeOffset ?? false,
                useCrease: spec.crease ?? false,
                creaseWeight: spec.creaseWeight ?? 1,
                materialOffset: spec.materialOffset ?? 0,
            })
        })
    },
})

registerModifierType<SubsurfModifierSpec>({
    type: 'subsurf',
    summary: '`{type: "subsurf", levels, ...}` (Blender\'s Subdivision Surface: levels 1, limit surface, creases from `crease`)',
    properties: {
        levels: {type: 'integer', minimum: 0, maximum: 6},
        quality: {type: 'integer', minimum: 1, maximum: 10},
        useLimitSurface: {type: 'boolean'},
        useCreases: {type: 'boolean'},
        boundarySmooth: {type: 'string', enum: ['ALL', 'PRESERVE_CORNERS']},
        uvSmooth: {type: 'string', enum: ['NONE', 'PRESERVE_CORNERS', 'PRESERVE_CORNERS_AND_JUNCTIONS', 'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE', 'PRESERVE_BOUNDARIES', 'SMOOTH_ALL']},
        subdivisionType: {type: 'string', enum: ['CATMULL_CLARK', 'SIMPLE']},
    },
    read(raw) {
        return {
            type: 'subsurf',
            levels: raw.levels as number | undefined,
            quality: raw.quality as number | undefined,
            useLimitSurface: raw.useLimitSurface as boolean | undefined,
            useCreases: raw.useCreases as boolean | undefined,
            boundarySmooth: raw.boundarySmooth as SubsurfModifierSpec['boundarySmooth'],
            uvSmooth: raw.uvSmooth as SubsurfModifierSpec['uvSmooth'],
            subdivisionType: raw.subdivisionType as SubsurfModifierSpec['subdivisionType'],
        }
    },
    check(spec) {
        const levels = spec.levels ?? 1
        if (!Number.isInteger(levels) || levels < 0 || levels > 6) throw new Error('a subsurf modifier needs whole `levels` from 0 to 6')
        const quality = spec.quality ?? 3
        if (!Number.isInteger(quality) || quality < 1 || quality > 10) throw new Error('a subsurf modifier `quality` must be a whole number from 1 to 10')
    },
    describe: spec => `subsurf ${spec.subdivisionType === 'SIMPLE' ? 'simple ' : ''}level ${spec.levels ?? 1}${spec.useLimitSurface === false ? ', no limit surface' : ''}`,
    // MeshData in, MeshData out: no BMesh round trip.
    evaluate(mesh, spec) {
        return subdivisionSurface(mesh, {
            levels: spec.levels ?? 1,
            quality: spec.quality ?? 3,
            useLimitSurface: spec.useLimitSurface ?? true,
            useCreases: spec.useCreases ?? true,
            boundarySmooth: spec.boundarySmooth ?? 'ALL',
            uvSmooth: spec.uvSmooth ?? 'PRESERVE_BOUNDARIES',
            scheme: spec.subdivisionType ?? 'CATMULL_CLARK',
        })
    },
})

registerModifierType<WeightedNormalModifierSpec>({
    type: 'weightedNormal',
    summary: '`{type: "weightedNormal", mode, weight, keepSharp}` (Blender\'s Weighted Normal: custom normals so big '
        + 'faces shade flat and bevels take the bend; weight 50 treats faces equally, 100 lets the largest dominate)',
    properties: {
        mode: {type: 'string', enum: ['FACE_AREA', 'CORNER_ANGLE', 'FACE_AREA_WITH_ANGLE']},
        weight: {type: 'integer', minimum: 1, maximum: 100},
        threshold: {type: 'number', minimum: 0},
        keepSharp: {type: 'boolean'},
        useFaceInfluence: {type: 'boolean'},
    },
    read(raw) {
        return {
            type: 'weightedNormal',
            mode: raw.mode as WeightedNormalModifierSpec['mode'],
            weight: raw.weight as number | undefined,
            threshold: raw.threshold as number | undefined,
            keepSharp: raw.keepSharp as boolean | undefined,
            useFaceInfluence: raw.useFaceInfluence as boolean | undefined,
        }
    },
    check(spec) {
        const w = spec.weight ?? 50
        if (!Number.isInteger(w) || w < 1 || w > 100) throw new Error('a weightedNormal modifier `weight` must be a whole number from 1 to 100')
        if (spec.mode && !['FACE_AREA', 'CORNER_ANGLE', 'FACE_AREA_WITH_ANGLE'].includes(spec.mode)) {
            throw new Error('a weightedNormal modifier `mode` is FACE_AREA, CORNER_ANGLE or FACE_AREA_WITH_ANGLE')
        }
        if (spec.threshold !== undefined && (!Number.isFinite(spec.threshold) || spec.threshold < 0)) {
            throw new Error('a weightedNormal modifier `threshold` must be a number of 0 or more')
        }
    },
    describe: spec => `weighted normal ${(spec.mode ?? 'FACE_AREA').toLowerCase().replace(/_/g, ' ')}, weight ${spec.weight ?? 50}${spec.keepSharp ? ', keep sharp' : ''}`,
    evaluate(mesh, spec) {
        return weightedNormal(mesh, {
            mode: spec.mode ?? 'FACE_AREA',
            weight: spec.weight ?? 50,
            threshold: spec.threshold ?? 0.01,
            keepSharp: spec.keepSharp ?? false,
            useFaceInfluence: spec.useFaceInfluence ?? false,
        })
    },
})

// endregion
