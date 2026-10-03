/**
 * Edit-mode operators for filling, bridging, connecting, dissolving and merging (track F of
 * `issues/open/modelling-tools/12-p3-p4-next-wave.md`).
 *
 * Each one is a *session* operator over the kernel's port of the matching Blender edit-mode exec
 * (`editors/mesh/editmesh_tools.cc` `edbm_*_exec`): the kernel function reads the BMesh selection,
 * runs the ported `bmo_*` operator with the RNA props, and leaves the selection as Blender leaves it.
 * Here we only snapshot, call it, and commit one labelled undo step - so the redo-last panel re-runs
 * it exactly (pop the step, `exec(newProps)`, push), as Blender's `ED_undo_operator_repeat` does.
 *
 * Props carry Blender's RNA identifiers in camelCase, Blender's defaults and descriptions. Every exec
 * reports back the full prop set it ran with, so the panel shows the values, not blanks.
 *
 * The menus here are Blender's edit-mode menus (`space_view3d.py`, `VIEW3D_MT_edit_mesh_*`), listing
 * the operators that exist in the engine, in Blender's order.
 */

import {
    bridgeEdgeLoopsSelection,
    DissolveDelimit,
    dissolveEdgesSelection,
    dissolveFacesSelection,
    dissolveLimitedSelection,
    dissolveModeSelection,
    dissolveVertsSelection,
    edgeFaceAddSelection,
    gridFillSelection,
    mergeByDistanceSelection,
    MERGE_BY_DISTANCE_DEFAULTS,
    subdivideEdgeringSelection,
    vertConnectPathSelection,
    vertConnectSelection,
} from '@threepipe/mesh-kernel'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, MenuRequestItem, OperatorDescriptor, OperatorResult, PropSchema} from '../registry'
import {onlyInEditMessage} from './messages'

/** A session operator's kernel call: change `bm` in place, say what happened. */
type KernelRun = (props: Record<string, unknown>, ctx: EditorContext) =>
    {ok: true, label?: string, message?: string, props?: Record<string, unknown>} | {ok: false, error: string}

export function registerFillOperators(engine: EditorEnginePlugin): void {
    const me = engine.meshEdit
    const notModal = () => !me.activeTransform && !engine.propDrag || 'Finish the current operation first'
    const editing = () => me.isEditing || onlyInEditMessage(engine)
    const ready = (poll: (ctx: EditorContext) => boolean | string) => (ctx: EditorContext) => {
        const p = poll(ctx)
        return p === true ? notModal() : p
    }
    const hasVerts = (n: number, what: string) => () => {
        if (!me.state) return onlyInEditMessage(engine)
        return me.state.bm.totvertsel >= n || what
    }

    /** Fill `props` from the schema defaults, so redo-last shows (and re-runs with) every value. */
    const withDefaults = (schema: PropSchema | undefined, props: Record<string, unknown> | undefined) => {
        const out: Record<string, unknown> = {}
        for (const [k, def] of Object.entries(schema?.properties ?? {})) if (def.default !== undefined) out[k] = def.default
        return {...out, ...props}
    }

    /**
     * Snapshot, run, commit one undo step. A refused run changes nothing (the kernel functions return
     * before touching the mesh where Blender does); a run that failed after changing the mesh is
     * rolled back from the snapshot, as Blender's `EDBM_op_finish(.., false)` / redo-state restore do.
     */
    const runSession = (label: string, schema: PropSchema | undefined, run: KernelRun) =>
        (ctx: EditorContext, p?: Record<string, unknown>): OperatorResult => {
            const before = me.snapshot()
            if (!before || !me.state) return {ok: false, error: onlyInEditMessage(engine)}
            const props = withDefaults(schema, p)
            const r = run(props, ctx)
            if (!r.ok) {
                me.revert(before)
                return {ok: false, error: r.error}
            }
            me.commit(before, r.label ?? label)
            if (r.message) engine.message('info', r.message)
            // Props the operator worked out itself (Grid Fill's span) are what the panel shows and redo reuses.
            return {ok: true, props: {...props, ...r.props}}
        }

    const menu = (title: string, items: (MenuRequestItem | false)[]) => {
        engine.requestMenu(title, items.filter((x): x is MenuRequestItem => !!x && !!engine.operators.get(x.id)))
        return {ok: true}
    }

    // --- Merge by Distance (`MESH_OT_remove_doubles`, editmesh_tools.cc:3746) ----------------------
    const mergeByDistanceProps: PropSchema = {type: 'object', properties: {
        threshold: {type: 'number', minimum: 1e-6, maximum: 50, default: MERGE_BY_DISTANCE_DEFAULTS.threshold,
            description: 'Merge Distance: maximum distance between elements to merge.'},
        useCentroid: {type: 'boolean', default: MERGE_BY_DISTANCE_DEFAULTS.useCentroid,
            description: 'Centroid Merge: move vertices to the centroid of the duplicate cluster, otherwise the vertex closest to the centroid is used.'},
        useUnselected: {type: 'boolean', default: MERGE_BY_DISTANCE_DEFAULTS.useUnselected,
            description: 'Unselected: merge selected to other unselected vertices.'},
        useSharpEdgeFromNormals: {type: 'boolean', default: MERGE_BY_DISTANCE_DEFAULTS.useSharpEdgeFromNormals,
            description: 'Sharp Edges: calculate sharp edges using custom normal data (when available).'},
    }}

    // --- Grid Fill (`MESH_OT_fill_grid`, editmesh_tools.cc:5162) ----------------------------------
    // `span` has no default: unset, `edbm_fill_grid_prepare` calculates it from the selection, and the
    // calculated value is stored back into the props (`RNA_property_int_set`, :5124) for the panel.
    const gridFillProps: PropSchema = {type: 'object', properties: {
        span: {type: 'integer', minimum: 1, maximum: 1000, description: 'Span: number of grid columns.'},
        offset: {type: 'integer', minimum: -1000, maximum: 1000, default: 0, description: 'Offset: vertex that is the corner of the grid.'},
        useInterpSimple: {type: 'boolean', default: false, description: 'Simple Blending: use simple interpolation of grid vertices.'},
    }}

    // --- Dissolve (`editmesh_tools.cc:5970`-`:6450`) -------------------------------------------
    // Blender shows angles in degrees and stores radians; the panel does the same conversion.
    const DEG = Math.PI / 180
    const P = {
        useVerts: (def: boolean | undefined) => ({type: 'boolean' as const, ...def === undefined ? {} : {default: def},
            description: 'Dissolve Vertices: dissolve remaining vertices which connect to only two edges.'}),
        useFaceSplit: {type: 'boolean' as const, default: false, description: 'Face Split: split off face corners to maintain surrounding geometry.'},
        useBoundaryTear: {type: 'boolean' as const, default: false, description: 'Tear Boundary: split off face corners instead of merging faces.'},
        angleThreshold: {type: 'number' as const, minimum: 0, maximum: 180, default: 180,
            description: 'Angle Threshold (degrees): remaining vertices which separate edge pairs are preserved if their edge angle exceeds this threshold.'},
        usePreserveQuads: {type: 'boolean' as const, default: true, description: 'Preserve Quads: when dissolving the edge between two triangles, don\'t dissolve vertices.'},
    }
    const dissolveModeProps: PropSchema = {type: 'object', properties: {
        // No default: unset, it is on unless face select mode is (`edbm_dissolve_mode_exec`, :6256).
        useVerts: P.useVerts(undefined), angleThreshold: P.angleThreshold, usePreserveQuads: P.usePreserveQuads,
        useFaceSplit: P.useFaceSplit, useBoundaryTear: P.useBoundaryTear,
    }}
    const dissolveVertsProps: PropSchema = {type: 'object', properties: {useFaceSplit: P.useFaceSplit, useBoundaryTear: P.useBoundaryTear}}
    const dissolveEdgesProps: PropSchema = {type: 'object', properties: {
        useVerts: P.useVerts(true), angleThreshold: P.angleThreshold, useFaceSplit: P.useFaceSplit, usePreserveQuads: P.usePreserveQuads,
    }}
    const dissolveFacesProps: PropSchema = {type: 'object', properties: {useVerts: P.useVerts(false)}}
    // `delimit` is an enum-flag set in Blender ({'NORMAL'} by default); here one toggle per flag.
    const DELIMITS = [['delimitNormal', 'Normal', 'Normal: delimit by face directions.', true], ['delimitMaterial', 'Material', 'Material: delimit by face material.', false],
        ['delimitSeam', 'Seam', 'Seam: delimit by edge seams.', false], ['delimitSharp', 'Sharp', 'Sharp: delimit by sharp edges.', false],
        ['delimitUv', 'UV', 'UVs: delimit by UV coordinates.', false]] as const
    const dissolveLimitedProps: PropSchema = {type: 'object', properties: {
        angleLimit: {type: 'number', minimum: 0, maximum: 180, default: 5, description: 'Max Angle (degrees): angle limit.'},
        useDissolveBoundaries: {type: 'boolean', default: false, description: 'All Boundaries: dissolve all vertices in between face boundaries.'},
        ...Object.fromEntries(DELIMITS.map(([k, , d, def]) => [k, {type: 'boolean' as const, default: def, description: `Delimit ${d}`}])),
    }}
    const deg = (v: unknown, fallback: number) => (v === undefined ? fallback : Number(v)) * DEG
    const dissolved = (r: {ok: true} | {ok: false, error: string}) => r.ok ? {ok: true as const} : {ok: false as const, error: r.error}
    const anySelected = () => !me.state ? onlyInEditMessage(engine)
        : me.state.bm.totvertsel + me.state.bm.totedgesel + me.state.bm.totfacesel > 0 || 'Select some vertices, edges or faces first'

    // --- Bridge Edge Loops (`MESH_OT_bridge_edge_loops`, editmesh_tools.cc:7572) and the edge-ring
    // props it shares with Subdivide Edge-Ring (`mesh_operator_edgering_props`, :237) ---------------
    const PROFILE_SHAPES = ['SMOOTH', 'SPHERE', 'ROOT', 'INVERSE_SQUARE', 'SHARP', 'LINEAR']
    const edgeringProps = (cutsDefault: number) => ({
        numberCuts: {type: 'integer' as const, minimum: 0, maximum: 1000, default: cutsDefault, description: 'Number of Cuts.'},
        interpolation: {type: 'string' as const, enum: ['LINEAR', 'PATH', 'SURFACE'], default: 'PATH', description: 'Interpolation method: Linear, Blend Path or Blend Surface.'},
        smoothness: {type: 'number' as const, minimum: 0, maximum: 1000, default: 1, description: 'Smoothness factor.'},
        profileShapeFactor: {type: 'number' as const, minimum: -1000, maximum: 1000, default: 0, description: 'Profile Factor: how much intermediary new edges are shrunk/expanded.'},
        profileShape: {type: 'string' as const, enum: PROFILE_SHAPES, default: 'SMOOTH', description: 'Profile Shape: shape of the profile.'},
    })
    const bridgeProps: PropSchema = {type: 'object', properties: {
        type: {type: 'string', enum: ['SINGLE', 'CLOSED', 'PAIRS'], default: 'SINGLE', description: 'Connect Loops: method of bridging multiple loops - Open Loop, Closed Loop or Loop Pairs.'},
        useMerge: {type: 'boolean', default: false, description: 'Merge: merge rather than creating faces.'},
        mergeFactor: {type: 'number', minimum: 0, maximum: 1, default: 0.5, description: 'Merge Factor.'},
        twistOffset: {type: 'integer', minimum: -1000, maximum: 1000, default: 0, description: 'Twist: twist offset for closed loops.'},
        ...edgeringProps(0),
    }}
    const subdivideEdgeringProps: PropSchema = {type: 'object', properties: edgeringProps(10)}
    const ringOptions = (p: Record<string, unknown>) => ({
        numberCuts: Number(p.numberCuts), interpolation: p.interpolation as never, smoothness: Number(p.smoothness),
        profileShapeFactor: Number(p.profileShapeFactor), profileShape: p.profileShape as never,
    })

    const ops: OperatorDescriptor[] = [
        {
            id: 'mesh.bridge_edge_loops', label: 'Bridge Edge Loops', icon: 'link', category: 'Mesh', modes: ['edit'],
            contextMenu: ['edge', 'face'],
            description: 'Join two or more selected edge loops (or the rims of selected faces) with a band of faces - tubes, handles, holes through a box. Twist, cuts and merge in the panel.',
            flags: {undo: true, register: true},
            props: bridgeProps,
            poll: ready(() => !me.state ? onlyInEditMessage(engine) : me.state.bm.totedgesel > 1 || 'Select two edge loops (or two faces) to bridge'),
            exec: runSession('Bridge Edge Loops', bridgeProps, p => {
                const r = bridgeEdgeLoopsSelection(me.state!.bm, {
                    type: p.type as never, useMerge: !!p.useMerge, mergeFactor: Number(p.mergeFactor), twistOffset: Number(p.twistOffset),
                    ...ringOptions(p),
                })
                return r.ok ? {ok: true} : {ok: false, error: r.error}
            }),
        },
        {
            id: 'mesh.subdivide_edgering', label: 'Subdivide Edge-Ring', icon: 'layout-linear', category: 'Mesh', modes: ['edit'],
            description: 'Cut the faces between selected edge rings, with a smooth or shaped profile (Blender\'s Edge > Subdivide Edge-Ring).',
            flags: {undo: true, register: true},
            props: subdivideEdgeringProps,
            poll: ready(() => !me.state ? onlyInEditMessage(engine) : me.state.bm.totedgesel > 1 || 'Select an edge ring (two or more edges across faces) first'),
            exec: runSession('Subdivide Edge-Ring', subdivideEdgeringProps, p => {
                const r = subdivideEdgeringSelection(me.state!.bm, ringOptions(p))
                return r.ok ? {ok: true} : {ok: false, error: r.error}
            }),
        },
        {
            id: 'mesh.dissolve', label: 'Dissolve Selection', icon: 'eraser', category: 'Mesh', modes: ['edit'],
            description: 'Remove the selected vertices, edges or faces (by select mode), merging the faces around them into one (Blender\'s Ctrl+X).',
            flags: {undo: true, register: true},
            props: dissolveModeProps,
            poll: ready(anySelected),
            exec: runSession('Dissolve', dissolveModeProps, (p, ctx) => {
                const bm = me.state!.bm
                const useVerts = p.useVerts === undefined ? ctx.selectMode !== 'face' : !!p.useVerts
                const r = dissolveModeSelection(bm, bm.selectMode, {
                    useVerts, angleThreshold: deg(p.angleThreshold, 180), usePreserveQuads: !!p.usePreserveQuads,
                    useFaceSplit: !!p.useFaceSplit, useBoundaryTear: !!p.useBoundaryTear,
                })
                if (!r.ok) return {ok: false, error: r.error}
                const what = ctx.selectMode === 'face' ? 'Faces' : ctx.selectMode === 'edge' ? 'Edges' : 'Vertices'
                return {ok: true, label: `Dissolve ${what}`, props: {useVerts}}
            }),
        },
        {
            id: 'mesh.dissolve_verts', label: 'Dissolve Vertices', icon: 'eraser', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex'],
            description: 'Dissolve the selected vertices, merging the faces around each into one.',
            flags: {undo: true, register: true},
            props: dissolveVertsProps,
            poll: ready(hasVerts(1, 'Select the vertices to dissolve first')),
            exec: runSession('Dissolve Vertices', dissolveVertsProps, p => dissolved(dissolveVertsSelection(me.state!.bm, {
                useFaceSplit: !!p.useFaceSplit, useBoundaryTear: !!p.useBoundaryTear,
            }))),
        },
        {
            id: 'mesh.dissolve_edges', label: 'Dissolve Edges', icon: 'eraser', category: 'Mesh', modes: ['edit'],
            contextMenu: ['edge'],
            description: 'Dissolve the selected edges, merging the faces on either side, and the vertices left with two edges.',
            flags: {undo: true, register: true},
            props: dissolveEdgesProps,
            poll: ready(() => !me.state ? onlyInEditMessage(engine) : me.state.bm.totedgesel > 0 || 'Select the edges to dissolve first'),
            exec: runSession('Dissolve Edges', dissolveEdgesProps, p => dissolved(dissolveEdgesSelection(me.state!.bm, {
                useVerts: !!p.useVerts, angleThreshold: deg(p.angleThreshold, 180), useFaceSplit: !!p.useFaceSplit, usePreserveQuads: !!p.usePreserveQuads,
            }))),
        },
        {
            id: 'mesh.dissolve_faces', label: 'Dissolve Faces', icon: 'eraser', category: 'Mesh', modes: ['edit'],
            contextMenu: ['face'],
            description: 'Merge each connected group of selected faces into one face.',
            flags: {undo: true, register: true},
            props: dissolveFacesProps,
            poll: ready(() => !me.state ? onlyInEditMessage(engine) : me.state.bm.totfacesel > 0 || 'Select the faces to dissolve first'),
            exec: runSession('Dissolve Faces', dissolveFacesProps, p => dissolved(dissolveFacesSelection(me.state!.bm, {useVerts: !!p.useVerts}))),
        },
        {
            id: 'mesh.dissolve_limited', label: 'Limited Dissolve', icon: 'clean', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Dissolve selected edges and vertices that lie flatter than the Max Angle - removes needless detail from flat areas and straight runs.',
            flags: {undo: true, register: true},
            props: dissolveLimitedProps,
            poll: ready(anySelected),
            exec: runSession('Limited Dissolve', dissolveLimitedProps, p => {
                let delimit = 0
                const flags = [DissolveDelimit.Normal, DissolveDelimit.Material, DissolveDelimit.Seam, DissolveDelimit.Sharp, DissolveDelimit.UV]
                DELIMITS.forEach(([k], i) => { if (p[k]) delimit |= flags[i] })
                return dissolved(dissolveLimitedSelection(me.state!.bm, {
                    angleLimit: deg(p.angleLimit, 5), useDissolveBoundaries: !!p.useDissolveBoundaries, delimit,
                }))
            }),
        },
        // --- Connect (`MESH_OT_vert_connect_path` :1695, `MESH_OT_vert_connect` :1321; no props) ----
        {
            id: 'mesh.vert_connect_path', label: 'Connect Vertex Path', icon: 'git-commit', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex'],
            description: 'Cut through the faces between the selected vertices, in the order they were clicked, making new edges (Blender\'s J). With exactly two vertices, the shortest cut across faces.',
            flags: {undo: true, register: true},
            poll: ready(hasVerts(2, 'Click two or more vertices, in the order to connect them')),
            exec: runSession('Connect Vertex Path', undefined, () => {
                const r = vertConnectPathSelection(me.state!.bm)
                return r.ok ? {ok: true} : {ok: false, error: r.error}
            }),
        },
        {
            id: 'mesh.vert_connect', label: 'Connect Vertex Pairs', icon: 'git-merge', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex'],
            description: 'Split the faces between selected vertices that share a face, joining each such pair with an edge.',
            flags: {undo: true, register: true},
            poll: ready(hasVerts(2, 'Select two or more vertices on the same face')),
            exec: runSession('Connect Vertices', undefined, () => {
                const r = vertConnectSelection(me.state!.bm)
                return r.ok ? {ok: true} : {ok: false, error: r.error}
            }),
        },
        {
            // `MESH_OT_edge_face_add` (editmesh_tools.cc:1016): no props, so nothing to adjust afterwards.
            id: 'mesh.fill', label: 'Make Edge/Face', icon: 'full-circle', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge'],
            description: 'Make an edge between two vertices, or a face from the selected vertices or edges - closed loops and edge nets fill, a lone vertex or edge on a border extends round the corner (Blender\'s F; press again to keep going).',
            flags: {undo: true, register: true},
            poll: ready(() => !me.state ? onlyInEditMessage(engine) : (me.state.bm.totvertsel > 0) || 'Select vertices or edges to make an edge or face from'),
            exec: runSession('Make Edge/Face', undefined, () => {
                const bm = me.state!.bm
                const faces = bm.totface
                const r = edgeFaceAddSelection(bm)
                if (!r.ok) return {ok: false, error: r.error}
                return {ok: true, label: bm.totface !== faces ? 'Make Face' : 'Make Edge'}
            }),
        },
        {
            id: 'mesh.fill_grid', label: 'Grid Fill', icon: 'grid-view', category: 'Mesh', modes: ['edit'],
            contextMenu: ['edge'],
            description: 'Fill a closed loop of edges, or the gap between two edge loops, with a grid of quads (Blender\'s Face > Grid Fill). Adjust span and offset in the panel.',
            flags: {undo: true, register: true},
            props: gridFillProps,
            poll: ready(() => !me.state ? onlyInEditMessage(engine) : me.state.bm.totedgesel > 0 || 'Select a closed edge loop, or two edge loops, first'),
            exec: runSession('Grid Fill', gridFillProps, p => {
                const r = gridFillSelection(me.state!.bm, {
                    span: p.span === undefined ? undefined : Number(p.span),
                    offset: Number(p.offset ?? 0),
                    useInterpSimple: !!p.useInterpSimple,
                })
                return r.ok ? {ok: true, props: {span: r.span}} : {ok: false, error: r.error}
            }),
        },
        {
            id: 'mesh.remove_doubles', label: 'Merge by Distance', icon: 'group-objects', category: 'Mesh', modes: ['edit'],
            description: 'Merge selected vertices that are closer together than the merge distance (Blender\'s M > By Distance). Adjust the distance in the panel.',
            flags: {undo: true, register: true},
            props: mergeByDistanceProps,
            poll: ready(hasVerts(1, 'Select the vertices to merge first (A selects everything)')),
            exec: runSession('Merge by Distance', mergeByDistanceProps, p => {
                const r = mergeByDistanceSelection(me.state!.bm, {
                    threshold: Number(p.threshold),
                    useCentroid: !!p.useCentroid,
                    useUnselected: !!p.useUnselected,
                    useSharpEdgeFromNormals: !!p.useSharpEdgeFromNormals,
                })
                // `BKE_reportf(.., count == 1 ? "Removed %d vertex" : "Removed %d vertices")` (:3730).
                return {ok: true, message: r.removed === 1 ? 'Removed 1 vertex' : `Removed ${r.removed} vertices`}
            }),
        },
        // --- menus (`space_view3d.py`) -----------------------------------------------------------
        {
            id: 'mesh.vertices_menu', label: 'Vertex', icon: 'dot', category: 'Mesh', modes: ['edit'], hidden: true,
            description: 'The Vertex menu (Blender\'s Ctrl+V, VIEW3D_MT_edit_mesh_vertices).',
            poll: editing,
            exec: () => menu('Vertex', [
                {id: 'mesh.extrude', label: 'Extrude Vertices'},
                {id: 'mesh.bevel', label: 'Bevel Vertices'},
                {id: 'mesh.fill', label: 'New Edge/Face from Vertices'},
                {id: 'mesh.vert_connect_path', label: 'Connect Vertex Path'},
                {id: 'mesh.vert_connect', label: 'Connect Vertex Pairs'},
            ]),
        },
        {
            id: 'mesh.edges_menu', label: 'Edge', icon: 'minus', category: 'Mesh', modes: ['edit'], hidden: true,
            description: 'The Edge menu (Blender\'s Ctrl+E, VIEW3D_MT_edit_mesh_edges).',
            poll: editing,
            exec: () => menu('Edge', [
                {id: 'mesh.extrude', label: 'Extrude Edges'},
                {id: 'mesh.bevel', label: 'Bevel Edges'},
                {id: 'mesh.bridge_edge_loops'},
                {id: 'mesh.subdivide'},
                {id: 'mesh.subdivide_edgering'},
            ]),
        },
        {
            id: 'mesh.faces_menu', label: 'Face', icon: 'square', category: 'Mesh', modes: ['edit'], hidden: true,
            description: 'The Face menu (Blender\'s Ctrl+F, VIEW3D_MT_edit_mesh_faces).',
            poll: editing,
            exec: () => menu('Face', [
                {id: 'mesh.extrude', label: 'Extrude Faces'},
                {id: 'mesh.inset'},
                {id: 'mesh.fill_grid'},
            ]),
        },
    ]
    for (const op of ops) engine.operators.register(op)
}
