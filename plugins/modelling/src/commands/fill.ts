/**
 * Fill and connect commands: the agent/script side of Blender's edit-mode Fill (F), Bridge Edge
 * Loops, Grid Fill, Connect Vertex Path (J), the dissolve family and Merge by Distance.
 *
 * Each command is a thin wrapper over the kernel's port of the edit-mode operator (`edbm_*_exec`):
 * it selects exactly the listed elements, in the given select mode, runs the same selection-level
 * function the editor's operator runs, and reports what is selected afterwards - so a script gets
 * the same result, and the same follow-on selection, as a person pressing the key.
 */

import {
    BMesh,
    bmFromMesh,
    bmToMesh,
    ElemFlag,
    edgeSelectSet,
    faceSelectSet,
    gridFillSelection,
    mergeByDistanceSelection,
    MERGE_BY_DISTANCE_DEFAULTS,
    MeshData,
    selectHistoryStore,
    selectModeFlush,
    SelectMode,
    selectNone,
    vertSelectSet,
} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {readTarget} from './params'

export type SelectModeName = 'vertex' | 'edge' | 'face'

export interface ElementSelection {
    verts?: number[]
    edges?: number[]
    faces?: number[]
    /** Defaults to the smallest domain given (vertex, then edge, then face). */
    selectMode?: SelectModeName
}

export interface SelectionResult {
    verts: number[]
    edges: number[]
    faces: number[]
}

const MODE_MASK = {vertex: SelectMode.Vertex, edge: SelectMode.Edge, face: SelectMode.Face} as const

/**
 * Build a BMesh from `mesh`, select exactly `sel` (vertices in list order, which becomes the select
 * history - what Connect Vertex Path follows), run `fn`, and hand back the new mesh, `fn`'s result
 * and the selection afterwards as indices into the new mesh. Throws on out-of-range indices.
 */
export function runOnSelection<R>(mesh: MeshData, sel: ElementSelection, fn: (bm: BMesh) => R): {mesh: MeshData, result: R, selected: SelectionResult} {
    const bm = bmFromMesh(mesh)
    const verts = [...bm.verts]
    const edges = [...bm.edges]
    const faces = [...bm.faces]
    const pick = <T>(pool: T[], list: number[] | undefined, what: string): T[] => (list ?? []).map(i => {
        if (!Number.isInteger(i) || i < 0 || i >= pool.length) throw new Error(`${what} ${i} is out of range - the mesh has ${pool.length}`)
        return pool[i]
    })
    const v = pick(verts, sel.verts, 'vertex')
    const e = pick(edges, sel.edges, 'edge')
    const f = pick(faces, sel.faces, 'face')
    const mode: SelectModeName = sel.selectMode ?? (sel.verts?.length ? 'vertex' : sel.edges?.length ? 'edge' : sel.faces?.length ? 'face' : 'vertex')
    bm.selectMode = MODE_MASK[mode]
    selectNone(bm)
    bm.selectHistory = []
    for (const x of v) {
        vertSelectSet(bm, x, true)
        selectHistoryStore(bm, x)
    }
    for (const x of e) {
        edgeSelectSet(bm, x, true)
        selectHistoryStore(bm, x)
    }
    for (const x of f) {
        faceSelectSet(bm, x, true)
        selectHistoryStore(bm, x)
    }
    // What entering edit mode with this selection gives (`EDBM_selectmode_flush`).
    selectModeFlush(bm)
    const result = fn(bm)
    const out = bmToMesh(bm)
    const indices = <T extends {hflag: number}>(pool: Iterable<T>) => {
        const r: number[] = []
        let i = 0
        for (const x of pool) {
            if (x.hflag & ElemFlag.Select) r.push(i)
            i++
        }
        return r
    }
    return {mesh: out, result, selected: {verts: indices(bm.verts), edges: indices(bm.edges), faces: indices(bm.faces)}}
}

const selectionSchema = {
    object: S.objectRef('The object to edit.'),
    objects: S.objectRef('Alias for `object`.'),
    verts: S.array('Vertex indices to select, in selection order.', {type: 'integer'}),
    edges: S.array('Edge indices to select.', {type: 'integer'}),
    faces: S.array('Face indices to select.', {type: 'integer'}),
    selectMode: S.enum('Edit-mode select mode the operator sees. Default: the smallest domain given.', ['vertex', 'edge', 'face']),
}

const readSelection = (p: Record<string, unknown>): ElementSelection => ({
    verts: p.verts as number[] | undefined,
    edges: p.edges as number[] | undefined,
    faces: p.faces as number[] | undefined,
    selectMode: p.selectMode as SelectModeName | undefined,
})

export const mergeByDistanceCommand: CommandDefinition = {
    op: 'mergeByDistance',
    summary: 'Merge the listed vertices that lie within a distance of each other - Blender\'s edit-mode M > By Distance.',
    description:
        'The edit-mode operator (`mesh.remove_doubles`): only the listed (selected) vertices are '
        + 'candidates, unless `useUnselected` merges them into nearby unlisted vertices instead. '
        + '`useCentroid` (default) puts each merged vertex at its cluster\'s centroid. For a whole-object '
        + 'weld after a join or import use `weld`. Indices are renumbered afterwards; the result lists '
        + 'what is selected.',
    mutates: true,
    schema: schema({
        ...selectionSchema,
        threshold: S.number('Merge Distance: maximum distance between elements to merge. Default 0.0001.', {minimum: 1e-6, maximum: 50}),
        useCentroid: S.boolean('Centroid Merge: move vertices to the centroid of the duplicate cluster. Default true.'),
        useUnselected: S.boolean('Merge listed vertices into other, unlisted vertices. Default false.'),
        useSharpEdgeFromNormals: S.boolean('Sharp Edges from custom normals (no effect: the kernel has no custom normals). Default false.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const {mesh, result, selected} = runOnSelection(entry.mesh, readSelection(p), bm => mergeByDistanceSelection(bm, {
            threshold: (p.threshold as number) ?? MERGE_BY_DISTANCE_DEFAULTS.threshold,
            useCentroid: (p.useCentroid as boolean) ?? MERGE_BY_DISTANCE_DEFAULTS.useCentroid,
            useUnselected: (p.useUnselected as boolean) ?? MERGE_BY_DISTANCE_DEFAULTS.useUnselected,
            useSharpEdgeFromNormals: p.useSharpEdgeFromNormals as boolean | undefined,
        }))
        if (!result.removed) ctx.warn('nothing was close enough to merge')
        else ctx.doc.setMesh(entry, mesh)
        return {objects: [entry.name], data: {removed: result.removed, selected, verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum}}
    },
}

export const gridFillCommand: CommandDefinition = {
    op: 'gridFill',
    summary: 'Fill a closed edge loop, or the gap between two edge loops, with a grid of quads - Blender\'s Grid Fill.',
    description:
        'List the loop\'s `edges` (one closed loop with an even number of edges, or two open loops with '
        + 'matching ends). For a single loop, `span` edges at each end become the rails; leave it out and it '
        + 'is calculated from the loop\'s corners, as Blender does - the result reports the span used. '
        + '`offset` moves the grid\'s corner round the loop. Listing `faces` fills over those faces instead, '
        + 'taking their UVs. The new faces are selected (`selected` in the result).',
    mutates: true,
    schema: schema({
        ...selectionSchema,
        span: S.integer('Number of grid columns. Default: calculated from the selection.', {minimum: 1, maximum: 1000}),
        offset: S.integer('Vertex that is the corner of the grid. Default 0.', {minimum: -1000, maximum: 1000}),
        useInterpSimple: S.boolean('Simple Blending: use simple interpolation of grid vertices. Default false.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const {mesh, result, selected} = runOnSelection(entry.mesh, readSelection(p), bm => gridFillSelection(bm, {
            span: p.span as number | undefined,
            offset: (p.offset as number) ?? 0,
            useInterpSimple: (p.useInterpSimple as boolean) ?? false,
        }))
        if (!result.ok) throw new Error(result.error)
        ctx.doc.setMesh(entry, mesh)
        return {objects: [entry.name], data: {span: result.span, newFaces: result.faces.length, selected, verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum}}
    },
}

export const fillCommands: CommandDefinition[] = [
    mergeByDistanceCommand,
    gridFillCommand,
]
