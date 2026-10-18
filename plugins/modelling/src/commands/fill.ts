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
    bridgeEdgeLoopsSelection,
    bmFromMesh,
    bmToMesh,
    DissolveDelimit,
    dissolveLimitedSelection,
    dissolveModeSelection,
    edgeFaceAddSelection,
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
    vertConnectPathSelection,
    vertConnectSelection,
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

export const makeEdgeFaceCommand: CommandDefinition = {
    op: 'makeEdgeFace',
    summary: 'Make an edge or a face from the listed vertices/edges - Blender\'s F in edit mode.',
    description:
        'Blender\'s `mesh.edge_face_add` (contextual create): two vertices make an edge; a closed loop of '
        + 'edges makes a face; an edge net fills every hole it closes; listed faces dissolve into one; '
        + 'a single vertex or edge on a border is extended round its corner first. The new geometry is '
        + 'selected (`selected` in the result). Fails, changing nothing, when there is nothing to make.',
    mutates: true,
    schema: schema({...selectionSchema}),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const {mesh, result, selected} = runOnSelection(entry.mesh, readSelection(p), bm => edgeFaceAddSelection(bm))
        if (!result.ok) throw new Error(result.error)
        ctx.doc.setMesh(entry, mesh)
        return {objects: [entry.name], data: {newFaces: result.faces.length, newEdges: result.edges.length, selected, verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum}}
    },
}

export const dissolveElementsCommand: CommandDefinition = {
    op: 'dissolveElements',
    summary: 'Dissolve vertices, edges or faces, merging the faces around them - Blender\'s Ctrl+X in edit mode.',
    description:
        'Blender\'s `mesh.dissolve_mode`: what dissolves follows the select mode (`selectMode`, or the '
        + 'domain of the list given). Vertices: each vertex goes and its faces merge (`useFaceSplit` keeps '
        + 'the surrounding corners, `useBoundaryTear` splits instead of merging at a border). Edges: the '
        + 'faces on both sides merge, and with `useVerts` (default in vertex and edge mode) vertices left '
        + 'with two edges go too, unless their angle exceeds `angleThreshold`. Faces: each connected group '
        + 'becomes one face. Unlike deleting, no hole is left. The result lists what is selected.',
    mutates: true,
    schema: schema({
        ...selectionSchema,
        useVerts: S.boolean('Dissolve remaining vertices which connect to only two edges. Default: on unless dissolving faces.'),
        angleThreshold: S.number('Edges: keep vertices whose edge angle exceeds this many degrees. Default 180.', {minimum: 0, maximum: 180}),
        usePreserveQuads: S.boolean('Edges: when dissolving the edge between two triangles, keep its vertices. Default true.'),
        useFaceSplit: S.boolean('Split off face corners to maintain surrounding geometry. Default false.'),
        useBoundaryTear: S.boolean('Vertices: split off face corners instead of merging faces. Default false.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const sel = readSelection(p)
        const {mesh, result, selected} = runOnSelection(entry.mesh, sel, bm => dissolveModeSelection(bm, bm.selectMode, {
            useVerts: p.useVerts as boolean | undefined,
            angleThreshold: ((p.angleThreshold as number) ?? 180) * Math.PI / 180,
            usePreserveQuads: (p.usePreserveQuads as boolean) ?? true,
            useFaceSplit: (p.useFaceSplit as boolean) ?? false,
            useBoundaryTear: (p.useBoundaryTear as boolean) ?? false,
        }))
        if (!result.ok) throw new Error(result.error)
        ctx.doc.setMesh(entry, mesh)
        return {objects: [entry.name], data: {selected, verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum}}
    },
}

const DELIMIT_NAMES = {NORMAL: DissolveDelimit.Normal, MATERIAL: DissolveDelimit.Material, SEAM: DissolveDelimit.Seam, SHARP: DissolveDelimit.Sharp, UV: DissolveDelimit.UV}

export const dissolveLimitedCommand: CommandDefinition = {
    op: 'dissolveLimited',
    summary: 'Limited Dissolve: remove the listed vertices and edges that lie flatter than an angle.',
    description:
        'Blender\'s `mesh.dissolve_limited`: cleans needless detail out of flat areas and straight runs. '
        + 'Edges between faces meeting at less than `angleLimit` degrees dissolve, and vertices between '
        + 'edges that run straighter than it; `delimit` keeps boundaries of the listed kinds. List faces '
        + '(face mode) to dissolve only inside that region.',
    mutates: true,
    schema: schema({
        ...selectionSchema,
        angleLimit: S.number('Max Angle in degrees. Default 5.', {minimum: 0, maximum: 180}),
        useDissolveBoundaries: S.boolean('Dissolve all vertices in between face boundaries. Default false.'),
        delimit: S.array('Keep these boundaries: NORMAL, MATERIAL, SEAM, SHARP, UV. Default [NORMAL].', {type: 'string', enum: Object.keys(DELIMIT_NAMES)}),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        let delimit = DissolveDelimit.Normal as number
        if (Array.isArray(p.delimit)) {
            delimit = 0
            for (const d of p.delimit as string[]) {
                const f = DELIMIT_NAMES[d as keyof typeof DELIMIT_NAMES]
                if (f === undefined) throw new Error(`unknown delimit "${d}" - use NORMAL, MATERIAL, SEAM, SHARP or UV`)
                delimit |= f
            }
        }
        const {mesh, result, selected} = runOnSelection(entry.mesh, readSelection(p), bm => dissolveLimitedSelection(bm, {
            angleLimit: ((p.angleLimit as number) ?? 5) * Math.PI / 180,
            useDissolveBoundaries: (p.useDissolveBoundaries as boolean) ?? false,
            delimit,
        }))
        if (!result.ok) throw new Error(result.error)
        ctx.doc.setMesh(entry, mesh)
        return {objects: [entry.name], data: {selected, verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum}}
    },
}

export const connectVerticesCommand: CommandDefinition = {
    op: 'connectVertices',
    summary: 'Cut faces between vertices - Blender\'s J (Connect Vertex Path), or Connect Vertex Pairs with `pairs`.',
    description:
        'List `verts` in the order to connect them: each consecutive pair is joined by cutting across '
        + 'the faces between them (with exactly two, the shortest such cut), or by a new edge where a '
        + 'vertex is loose. With `pairs: true` (Connect Vertex Pairs), every two listed vertices that '
        + 'share a face are joined by splitting that face, order ignored. The new edges are selected.',
    mutates: true,
    schema: schema({
        ...selectionSchema,
        pairs: S.boolean('Connect Vertex Pairs (`mesh.vert_connect`) instead of the path. Default false.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const {mesh, result, selected} = runOnSelection(entry.mesh, readSelection(p),
            bm => p.pairs ? vertConnectSelection(bm) : vertConnectPathSelection(bm))
        if (!result.ok) throw new Error(result.error)
        ctx.doc.setMesh(entry, mesh)
        return {objects: [entry.name], data: {newEdges: result.edges.length, selected, verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum}}
    },
}

export const bridgeEdgeLoopsCommand: CommandDefinition = {
    op: 'bridgeEdgeLoops',
    summary: 'Join edge loops with a band of faces - Blender\'s Bridge Edge Loops.',
    description:
        'List the `edges` of two or more loops (or `faces`: their selection is removed and its rims are '
        + 'bridged, which is how you make a hole through a box or join two tubes). `type` CLOSED joins the '
        + 'last loop back to the first, PAIRS bridges loops two by two. `twistOffset` rotates closed loops '
        + 'against each other; `useMerge` welds the loops instead of making faces. `numberCuts` adds edge '
        + 'loops along the bridge, shaped by `interpolation`, `smoothness` and the profile. The new faces are '
        + 'selected (`selected` in the result).',
    mutates: true,
    schema: schema({
        ...selectionSchema,
        type: S.enum('Connect Loops: SINGLE (open), CLOSED or PAIRS. Default SINGLE.', ['SINGLE', 'CLOSED', 'PAIRS']),
        useMerge: S.boolean('Merge rather than creating faces. Default false.'),
        mergeFactor: S.number('Merge Factor, 0..1. Default 0.5.', {minimum: 0, maximum: 1}),
        twistOffset: S.integer('Twist offset for closed loops. Default 0.', {minimum: -1000, maximum: 1000}),
        numberCuts: S.integer('Number of Cuts. Default 0.', {minimum: 0, maximum: 1000}),
        interpolation: S.enum('Interpolation of the cuts. Default PATH.', ['LINEAR', 'PATH', 'SURFACE']),
        smoothness: S.number('Smoothness factor. Default 1.', {minimum: 0, maximum: 1000}),
        profileShapeFactor: S.number('How much intermediary new edges are shrunk/expanded. Default 0.', {minimum: -1000, maximum: 1000}),
        profileShape: S.enum('Shape of the profile. Default SMOOTH.', ['SMOOTH', 'SPHERE', 'ROOT', 'INVERSE_SQUARE', 'SHARP', 'LINEAR']),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const {mesh, result, selected} = runOnSelection(entry.mesh, readSelection(p), bm => bridgeEdgeLoopsSelection(bm, {
            type: p.type as never, useMerge: p.useMerge as boolean | undefined, mergeFactor: p.mergeFactor as number | undefined,
            twistOffset: p.twistOffset as number | undefined, numberCuts: p.numberCuts as number | undefined,
            interpolation: p.interpolation as never, smoothness: p.smoothness as number | undefined,
            profileShapeFactor: p.profileShapeFactor as number | undefined, profileShape: p.profileShape as never,
        }))
        if (!result.ok) throw new Error(result.error)
        ctx.doc.setMesh(entry, mesh)
        return {objects: [entry.name], data: {newFaces: result.faces.length + result.cutFaces.length, selected, verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum}}
    },
}

export const fillCommands: CommandDefinition[] = [
    bridgeEdgeLoopsCommand,
    dissolveElementsCommand,
    dissolveLimitedCommand,
    connectVerticesCommand,
    mergeByDistanceCommand,
    makeEdgeFaceCommand,
    gridFillCommand,
]
