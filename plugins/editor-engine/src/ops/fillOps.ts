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

import {mergeByDistanceSelection, MERGE_BY_DISTANCE_DEFAULTS} from '@threepipe/mesh-kernel'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, MenuRequestItem, OperatorDescriptor, OperatorResult, PropSchema} from '../registry'

/** A session operator's kernel call: change `bm` in place, say what happened. */
type KernelRun = (props: Record<string, unknown>, ctx: EditorContext) =>
    {ok: true, label?: string, message?: string} | {ok: false, error: string}

export function registerFillOperators(engine: EditorEnginePlugin): void {
    const me = engine.meshEdit
    const notModal = () => !me.activeTransform && !engine.propDrag || 'Finish the current operation first'
    const editing = () => me.isEditing || 'Only in edit mode'
    const ready = (poll: (ctx: EditorContext) => boolean | string) => (ctx: EditorContext) => {
        const p = poll(ctx)
        return p === true ? notModal() : p
    }
    const hasVerts = (n: number, what: string) => () => {
        if (!me.state) return 'Only in edit mode'
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
            if (!before || !me.state) return {ok: false, error: 'Only in edit mode'}
            const props = withDefaults(schema, p)
            const r = run(props, ctx)
            if (!r.ok) {
                me.revert(before)
                return {ok: false, error: r.error}
            }
            me.commit(before, r.label ?? label)
            if (r.message) engine.message('info', r.message)
            return {ok: true, props}
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

    const ops: OperatorDescriptor[] = [
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
