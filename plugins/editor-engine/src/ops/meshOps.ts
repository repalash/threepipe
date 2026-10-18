/**
 * Edit-mode operators.
 *
 * Two kinds. *Session* operators act on the live BMesh through `MeshEditPlugin` and record their
 * undo step there (selection, modal transforms, extrude, duplicate, split, merge, dissolve, fill, loop
 * and ring select). *Command* operators run a `ModellingPlugin` command on the edit object's document
 * entry with the selected element indices (inset, bevel, the delete menu, separate): one
 * implementation for the UI and the agent, one labelled undo step, and the session reloads from the
 * document afterwards (the engine's `documentChanged` listener), re-selecting what the command reports.
 *
 * Every registered operator is parametric, so the redo-last panel can re-run it: a modal transform
 * reports its final value through `transformCommitted` (Blender's `saveTransform`), extrude stores
 * its offset, the commands use their own schemas.
 */

import {ModalTransform} from '@threepipe/plugin-mesh-edit'
import type {ExtrudeMacro, TransformSavedProps} from '@threepipe/plugin-mesh-edit'
import {
    BMEdge,
    BMFace,
    BMVert,
    edgeSelectSet,
    ElemFlag,
    faceSelectSet,
    mergeSelection,
    MergeType,
    selectHistoryActive,
    walkEdgeLoop,
    walkEdgeRing,
    walkFaceLoop,
} from '@threepipe/mesh-kernel'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, OperatorDescriptor, OperatorResult, PropSchema} from '../registry'
import {visibleSchema} from './modellingOps'
import {sessionOps} from './session'
import {onlyInEditMessage, notModalMessage} from './messages'

type Vec3 = [number, number, number]

/** Blender's `mesh.delete` types, `prop_mesh_delete_types` (`editmesh_tools.cc:532`). */
const DELETE_TYPES = ['VERT', 'EDGE', 'FACE', 'EDGE_FACE', 'ONLY_FACE']

export function registerMeshOperators(engine: EditorEnginePlugin): void {
    const me = engine.meshEdit
    const modelling = engine.modelling
    // Reasons say what to do next, with the live key from the active preset.
    const onlyInEdit = () => onlyInEditMessage(engine)
    const editing = () => me.isEditing || onlyInEdit()
    const notModal = () => notModalMessage(engine)
    const hasSelection = (_ctx: EditorContext) => {
        if (!me.state) return onlyInEdit()
        return me.state.bm.totvertsel > 0 || `Select some vertices, edges or faces first: click one, drag a box around some, or press ${engine.keymap.shortcutFor('mesh.select_all', 'edit') ?? 'Select > All'} for everything`
    }
    const hasFaces = () => me.state ? me.state.bm.totfacesel > 0 || `Select some faces first: press ${engine.keymap.shortcutFor('mesh.select_mode_face', 'edit') ?? 'the face button'} for face mode, then click a face` : onlyInEdit()
    const ready = (poll: (ctx: EditorContext) => boolean | string) => (ctx: EditorContext) => {
        const p = poll(ctx)
        return p === true ? notModal() : p
    }
    // `MESH_OT_merge` props (editmesh_tools.cc:3639): `type`, and `uvs` ("Move UVs according to merge").
    const mergeProps: PropSchema = {type: 'object', properties: {
        type: {type: 'string', enum: ['CENTER', 'CURSOR', 'COLLAPSE', 'FIRST', 'LAST'], default: 'CENTER',
            description: 'Type: merge method to use - At Center, At Cursor, Collapse, At First, At Last.'},
        uvs: {type: 'boolean', default: false, description: 'UVs: move UVs according to merge.'},
    }}
    const mergeSession = sessionOps(engine).runSession('Merge', mergeProps, p => {
        const type = p.type as MergeType
        return mergeSelection(me.state!.bm, type, !!p.uvs, type === 'CURSOR' ? me.cursorLocal() : null)
    })
    const commandSchema = (op: string): PropSchema | undefined => {
        const def = modelling?.describeCommands().find(c => c.name === op)
        if (!def) return undefined
        const schema = visibleSchema(def.inputSchema as PropSchema)
        for (const k of ['faces', 'edges', 'verts', 'type', 'mode', 'name']) delete schema.properties[k]
        schema.required = []
        return schema
    }
    const bevelSchema = (): PropSchema | undefined => {
        const schema = commandSchema('bevel')
        if (!schema) return undefined
        schema.properties = {
            affect: {type: 'string', enum: ['VERTICES', 'EDGES'], description: 'Affect: bevel the selected vertices, or the selected edges. Unset, the select mode decides.'},
            ...schema.properties,
        }
        return schema
    }
    const docEntry = () => me.editObject && modelling ? modelling.document.find(me.editObject.uuid) : undefined
    const needsDocument = () => !!docEntry() || 'This object is not in the modelling document (ModellingPlugin is not loaded)'

    /** Indices of the selected elements of a domain, in the numbering the commands use (set order). */
    const selectedIndices = (kind: 'vertex' | 'edge' | 'face'): number[] => {
        const bm = me.state!.bm
        const out: number[] = []
        let i = 0
        const pool: Iterable<BMVert | BMEdge | BMFace> = kind === 'vertex' ? bm.verts : kind === 'edge' ? bm.edges : bm.faces
        for (const el of pool) {
            if (el.hflag & ElemFlag.Select) out.push(i)
            i++
        }
        return out
    }

    /** Run a document command on the edit object; the session reloads through `documentChanged`. */
    const runCommand = async(
        op: string, params: Record<string, unknown>,
        reselect?: (data: any) => {kind: 'vertex' | 'edge' | 'face', indices: number[]} | null,
    ): Promise<OperatorResult> => {
        const entry = docEntry()
        if (!entry || !modelling) return {ok: false, error: 'ModellingPlugin is not loaded'}
        // The document must hold exactly what the session shows before the command reads it.
        me.applyToObject()
        const result = await modelling.run({op, object: entry.name, ...params})
        if (!result.ok) return {ok: false, error: result.error}
        const sel = reselect?.(result.data)
        if (sel && me.state) me.selectElements(sel.kind, sel.indices)
        return {ok: true, data: result.data, warnings: result.warnings}
    }

    /**
     * The redo-panel props for a transform, from its saved state (Blender's `saveTransform`). The user
     * sees what Blender's Move / Rotate / Resize panels show - the values, orientation, constraint axes
     * and proportional settings; the orientation matrix and rotation axis travel with them unseen, as
     * Blender's `orient_matrix` does, so a redo reuses the orientation of the first run.
     */
    const savedToProps = (saved: TransformSavedProps): Record<string, unknown> => ({
        ...(saved.mode === 'rotate'
            ? {angle: Math.round(saved.value[0] * 180 / Math.PI * 1e4) / 1e4}
            : saved.mode === 'shrinkFatten'
                // `TRANSFORM_OT_shrink_fatten`: `value` is one offset, and `use_even_offset` (`transform_ops.cc:1136`).
                ? {value: Math.round(saved.value[0] * 1e6) / 1e6, useEvenOffset: !!saved.shrinkFatten?.useEvenOffset}
                : {value: saved.value.map(x => Math.round(x * 1e6) / 1e6)}),
        orientation: saved.orientType,
        constraintAxis: saved.constraintAxis ?? [false, false, false],
        proportional: saved.proportional.enabled,
        proportionalFalloff: saved.proportional.falloff,
        proportionalSize: saved.proportional.size,
        // Not shown: replayed as they were.
        _saved: {orientMatrix: saved.orientMatrix, orientMatrixType: saved.orientMatrixType, orientAxis: saved.orientAxis,
            connected: saved.proportional.connected, projected: saved.proportional.projected, snap: saved.snap},
    })

    const propsToSaved = (mode: 'translate' | 'rotate' | 'resize' | 'shrinkFatten', p: Record<string, unknown>): TransformSavedProps => {
        const hidden = (p._saved ?? {}) as Partial<{orientMatrix: TransformSavedProps['orientMatrix'], orientMatrixType: TransformSavedProps['orientMatrixType'],
            orientAxis: number, connected: boolean, projected: boolean, snap: boolean}>
        const axis = Array.isArray(p.constraintAxis) ? (p.constraintAxis as unknown[]).map(Boolean) : [false, false, false]
        const orientation = (p.orientation as TransformSavedProps['orientType']) ?? 'global'
        return {
            mode,
            value: mode === 'rotate' ? [Number(p.angle ?? 0) * Math.PI / 180]
                : mode === 'shrinkFatten' ? [Number(p.value ?? 0)]
                    : vec3(p.value, mode === 'resize' ? [1, 1, 1] : [0, 0, 0]),
            ...mode === 'shrinkFatten' ? {shrinkFatten: {useEvenOffset: !!p.useEvenOffset}} : {},
            orientType: orientation,
            // A changed orientation in the panel means the stored matrix no longer applies.
            orientMatrixType: hidden.orientMatrixType === orientation ? hidden.orientMatrixType : orientation,
            orientMatrix: hidden.orientMatrixType === orientation && hidden.orientMatrix ? hidden.orientMatrix : null,
            constraintAxis: axis.some(Boolean) ? [axis[0], axis[1], axis[2]] as [boolean, boolean, boolean] : null,
            orientAxis: hidden.orientAxis ?? 2,
            proportional: {
                enabled: !!p.proportional,
                connected: !!hidden.connected,
                projected: !!hidden.projected,
                falloff: (p.proportionalFalloff as TransformSavedProps['proportional']['falloff']) ?? 'smooth',
                size: Number(p.proportionalSize ?? 1),
            },
            snap: !!hidden.snap,
        }
    }

    const ORIENTATIONS = ['global', 'local', 'normal', 'view', 'cursor', 'custom']
    // `TRANSFORM_OT_shrink_fatten` (transform_ops.cc:1136): `value`, `use_even_offset`, proportional.
    const shrinkFattenProps: PropSchema = {type: 'object', properties: {
        value: {type: 'number', description: 'Offset: distance along the normals.'},
        useEvenOffset: {type: 'boolean', default: false, description: 'Offset Even: scale the offset to give more even thickness.'},
        proportional: {type: 'boolean', description: 'Proportional editing: move nearby unselected elements too, falling off with distance.'},
        proportionalFalloff: {type: 'string', enum: ['smooth', 'sphere', 'root', 'inverseSquare', 'sharp', 'linear', 'constant', 'random'], description: 'Proportional falloff shape.'},
        proportionalSize: {type: 'number', minimum: 0, description: 'Proportional radius.'},
    }}
    const FALLOFFS = ['smooth', 'sphere', 'root', 'inverseSquare', 'sharp', 'linear', 'constant', 'random']
    const commonTransformProps = {
        orientation: {type: 'string' as const, enum: ORIENTATIONS, description: 'The axes the values and constraint are in.'},
        constraintAxis: {type: 'array' as const, items: {type: 'boolean' as const}, minItems: 3, maxItems: 3, description: 'Which axes the transform was locked to.'},
        proportional: {type: 'boolean' as const, description: 'Proportional editing: move nearby unselected elements too, falling off with distance.'},
        proportionalFalloff: {type: 'string' as const, enum: FALLOFFS, description: 'Proportional falloff shape.'},
        proportionalSize: {type: 'number' as const, minimum: 0, description: 'Proportional radius.'},
    }

    const transformOp = (id: string, mode: 'translate' | 'rotate' | 'resize', label: string, icon: string, description: string, props: PropSchema): OperatorDescriptor => ({
        id, label, icon, description, category: 'Mesh', modes: ['edit'],
        flags: {undo: true, register: true},
        props,
        poll: ready(hasSelection),
        exec: (_ctx, p) => {
            // No props: the interactive modal (G/R/S). With props: the exact re-run the redo panel asks for.
            if (!p) return me.startTransform(mode) ? {ok: true, modal: true} : {ok: false, error: 'Nothing to transform. Select some vertices, edges or faces first'}
            if (!me.state) return {ok: false, error: onlyInEdit()}
            return me.applyTransformValues(propsToSaved(mode, p)) ? {ok: true, props: p} : {ok: false, error: 'Nothing to transform. Select some vertices, edges or faces first'}
        },
    })

    const ops: OperatorDescriptor[] = [
        {
            id: 'mesh.exit_edit', label: 'Object Mode', icon: 'cube', category: 'Mesh', modes: ['edit'],
            description: 'Leave edit mode and bake the changes into the object.',
            poll: editing,
            exec: () => ({ok: engine.setMode('object')}),
        },
        {
            id: 'mesh.exit_discard', label: 'Discard Edits', icon: 'cross', category: 'Mesh', modes: ['edit'],
            description: 'Leave edit mode without keeping the changes made in this session.',
            poll: editing,
            exec: () => { engine.propDrag?.cancel(); if (me.activeTransform) me.cancelTransform(); me.exit(false); return {ok: true} },
        },
        {
            id: 'mesh.apply', label: 'Apply to Object', icon: 'tick', category: 'Mesh', modes: ['edit'],
            description: 'Bake the current topology into the object without leaving edit mode.',
            poll: editing,
            exec: () => { me.applyToObject(); return {ok: true} },
        },
        // --- select modes (enter edit mode first when needed, as the Industry Compatible keymap does) ---
        ...(['vertex', 'edge', 'face'] as const).map((m, i): OperatorDescriptor => ({
            id: `mesh.select_mode_${m}`, label: `${m.charAt(0).toUpperCase() + m.slice(1)} Select`, icon: ['dot', 'minus', 'square'][i], category: 'Select',
            description: `Select ${m === 'vertex' ? 'vertices' : m + 's'}. In object mode, enters edit mode on the selected mesh first.`,
            poll: ctx => ctx.mode === 'edit' || ctx.selectedObjects.some(o => !!o.geometry) || 'Click a mesh to select it first',
            exec: ctx => {
                if (ctx.mode === 'object' && !engine.setMode('edit')) return {ok: false, error: 'Click a mesh to select it first'}
                engine.setSelectMode(m)
                return {ok: true}
            },
        })),
        {
            id: 'mesh.select_all', label: 'Select All', icon: 'select', category: 'Select', modes: ['edit'],
            description: 'Select every element.',
            poll: editing,
            exec: () => { me.selectAllElements(); return {ok: true} },
        },
        {
            id: 'mesh.select_none', label: 'Select None', icon: 'disable', category: 'Select', modes: ['edit'],
            description: 'Deselect every element.',
            poll: editing,
            exec: () => { me.deselectAllElements(); return {ok: true} },
        },
        {
            id: 'mesh.select_invert', label: 'Invert Selection', icon: 'exchange', category: 'Select', modes: ['edit'],
            description: 'Swap selected and unselected elements.',
            poll: editing,
            exec: () => { me.invertSelection(); return {ok: true} },
        },
        {
            id: 'mesh.select_linked', label: 'Select Linked', icon: 'graph', category: 'Select', modes: ['edit'],
            description: 'Grow the selection to everything connected to it.',
            poll: hasSelection,
            exec: () => { me.selectLinked(); return {ok: true} },
        },
        {
            id: 'mesh.select_loop', label: 'Select Edge Loop', icon: 'ring', category: 'Select', modes: ['edit'],
            description: 'Select the loop of edges (or faces, in face mode) running through the active edge.',
            poll: () => !!activeEdge(me) || 'Select an edge first (click one; the last selected is the active edge)',
            exec: ctx => {
                const e = activeEdge(me)!
                const bm = me.state!.bm
                if (ctx.selectMode === 'face') for (const f of walkFaceLoop(e)) faceSelectSet(bm, f, true)
                else for (const edge of walkEdgeLoop(e)) edgeSelectSet(bm, edge, true)
                me.selectElements('edge', [], true) // refresh overlays and counts through the plugin
                return {ok: true}
            },
        },
        {
            id: 'mesh.select_ring', label: 'Select Edge Ring', icon: 'ring', category: 'Select', modes: ['edit'],
            description: 'Select the ring of edges parallel to the active edge, across the quads.',
            poll: () => !!activeEdge(me) || 'Select an edge first (click one; the last selected is the active edge)',
            exec: () => {
                const e = activeEdge(me)!
                const bm = me.state!.bm
                for (const edge of walkEdgeRing(e)) edgeSelectSet(bm, edge, true)
                me.selectElements('edge', [], true)
                return {ok: true}
            },
        },
        // --- transforms -----------------------------------------------------------------------
        transformOp('mesh.move', 'translate', 'Move', 'move',
            'Move the selection with the mouse; X/Y/Z locks an axis, type a number for an exact distance.',
            {type: 'object', properties: {
                value: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'Move X, Y, Z, in the orientation\'s axes.'},
                ...commonTransformProps,
            }}),
        transformOp('mesh.rotate', 'rotate', 'Rotate', 'refresh',
            'Rotate the selection with the mouse; X/Y/Z locks an axis, type degrees for an exact angle.',
            {type: 'object', properties: {
                angle: {type: 'number', description: 'Angle in degrees.'},
                ...commonTransformProps,
            }}),
        transformOp('mesh.scale', 'resize', 'Scale', 'maximize',
            'Scale the selection with the mouse; X/Y/Z locks an axis, type a factor for an exact scale.',
            {type: 'object', properties: {
                value: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'Scale X, Y, Z, in the orientation\'s axes.'},
                ...commonTransformProps,
            }}),
        // --- topology: session operators ------------------------------------------------------
        {
            id: 'mesh.extrude', label: 'Extrude', icon: 'arrow-up', category: 'Mesh', modes: ['edit'],
            description: 'Extrude the selection and start moving it along its normal. Click or Enter to confirm, Esc to cancel the move.',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                value: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'Move X, Y, Z of the new geometry, in the orientation\'s axes.'},
                ...commonTransformProps,
            }},
            poll: ready(hasSelection),
            exec: (_ctx, p) => {
                if (!p) return me.extrude() ? {ok: true, modal: true} : {ok: false, error: 'Nothing to extrude. Select some vertices, edges or faces first'}
                return me.extrudeBy(propsToSaved('translate', p)) ? {ok: true, props: p} : {ok: false, error: 'Nothing to extrude. Select some vertices, edges or faces first'}
            },
        },
        // --- Shrink/Fatten (`TRANSFORM_OT_shrink_fatten`, transform_ops.cc:1120) and the extrude macros
        // that chain into it or into Move (`mesh_ops.cc:293-327`) ---------------------------------------
        {
            id: 'transform.shrink_fatten', label: 'Shrink/Fatten', icon: 'arrows-vertical', category: 'Mesh', modes: ['edit'],
            description: 'Move the selected vertices along their normals; drag up to fatten, down to shrink. S or Alt: keep the thickness even.',
            flags: {undo: true, register: true},
            props: shrinkFattenProps,
            poll: ready(hasSelection),
            exec: (_ctx, p) => {
                if (!p) return me.startTransform('shrinkFatten', {shrinkFatten: {useEvenOffset: false}}) ? {ok: true, modal: true} : {ok: false, error: 'Nothing to shrink or fatten. Select some vertices, edges or faces first'}
                return me.applyTransformValues(propsToSaved('shrinkFatten', p)) ? {ok: true, props: p} : {ok: false, error: 'Nothing to shrink or fatten. Select some vertices, edges or faces first'}
            },
        },
        ...([
            ['mesh.extrude_vertices_move', 'Extrude Vertices', 'Extrude Only Vertices and Move: each selected vertex gets a new one joined by an edge, which then moves.', 'vert', 'Select the vertices to extrude first'],
            ['mesh.extrude_edges_move', 'Extrude Edges', 'Extrude Only Edges and Move: the selected edges extrude on their own into a strip of faces, whose new edges then move.', 'edge', 'Select the edges to extrude first'],
            ['mesh.extrude_faces_move', 'Extrude Individual Faces', 'Extrude Individual Faces and Move: each selected face extrudes on its own and moves out along its normal (Shrink/Fatten).', 'face', 'Select the faces to extrude first'],
            ['mesh.extrude_region_shrink_fatten', 'Extrude Region and Shrink/Fatten', 'Extrude the selected faces as one region and move them out along their vertex normals (Shrink/Fatten).', 'face', 'Select the faces to extrude first'],
        ] as const).map(([id, label, description, need, what]): OperatorDescriptor => {
            const kind = id.slice('mesh.'.length) as ExtrudeMacro
            const shrink = kind === 'extrude_faces_move' || kind === 'extrude_region_shrink_fatten'
            const props: PropSchema = shrink ? shrinkFattenProps : {type: 'object', properties: {
                // `MESH_OT_extrude_edges_indiv.use_normal_flip` (editmesh_extrude.cc:633).
                ...kind === 'extrude_edges_move' ? {useNormalFlip: {type: 'boolean' as const, default: false, description: 'Flip Normals.'}} : {},
                value: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'Move X, Y, Z of the new geometry, in the orientation\'s axes.'},
                ...commonTransformProps,
            }}
            return {
                id, label, icon: 'arrow-up', category: 'Mesh', modes: ['edit'], description,
                flags: {undo: true, register: true},
                props,
                poll: ready(() => !me.state ? onlyInEdit()
                    : (need === 'vert' ? me.state.bm.totvertsel : need === 'edge' ? me.state.bm.totedgesel : me.state.bm.totfacesel) > 0 || what),
                exec: (_ctx, p) => {
                    const useNormalFlip = !!p?.useNormalFlip
                    if (!p || p.value === undefined) {
                        return me.extrudeMacro(kind, {useNormalFlip}) ? {ok: true, modal: true} : {ok: false, error: what}
                    }
                    return me.extrudeMacroBy(kind, propsToSaved(shrink ? 'shrinkFatten' : 'translate', p), {useNormalFlip})
                        ? {ok: true, props: p} : {ok: false, error: what}
                },
            }
        }),
        {
            // `VIEW3D_OT_edit_mesh_extrude_shrink_fatten` (scripts/startup/bl_operators/view3d.py:173): with
            // faces selected Extrude Region and Shrink/Fatten, otherwise Extrude Region and Move.
            id: 'view3d.edit_mesh_extrude_move_shrink_fatten', label: 'Extrude Faces Along Normals', icon: 'arrow-up', category: 'Mesh', modes: ['edit'],
            description: 'Extrude the selected faces as one region and move them out along their vertex normals.',
            poll: ready(hasSelection),
            exec: () => engine.run(me.state && me.state.bm.totfacesel >= 1 ? 'mesh.extrude_region_shrink_fatten' : 'mesh.extrude'),
        },
        {
            id: 'mesh.duplicate', label: 'Duplicate', icon: 'duplicate', category: 'Mesh', modes: ['edit'],
            description: 'Copy the selected elements and start moving the copy.',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                value: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'Move X, Y, Z of the new geometry, in the orientation\'s axes.'},
                ...commonTransformProps,
            }},
            poll: ready(hasSelection),
            exec: (_ctx, p) => {
                if (!p) return me.duplicate() ? {ok: true, modal: true} : {ok: false, error: 'Nothing to duplicate. Select some vertices, edges or faces first'}
                return me.duplicateBy(propsToSaved('translate', p)) ? {ok: true, props: p} : {ok: false, error: 'Nothing to duplicate. Select some vertices, edges or faces first'}
            },
        },
        {
            id: 'mesh.split', label: 'Split', icon: 'fork', category: 'Mesh', modes: ['edit'],
            description: 'Detach the selection from the rest of the mesh, keeping it in place.',
            flags: {undo: true, register: true},
            poll: ready(hasSelection),
            exec: () => me.split() ? {ok: true} : {ok: false, error: 'Nothing to split. Select some vertices, edges or faces first'},
        },
        {
            // `MESH_OT_merge` (editmesh_tools.cc:3620): `type` (`merge_type_items`, :3565), `uvs`.
            id: 'mesh.merge', label: 'Merge', icon: 'group-objects', category: 'Mesh', modes: ['edit'],
            description: 'Merge the selected vertices: at their centre, at the 3D cursor, at the first or last selected, or each connected group into one (Collapse).',
            flags: {undo: true, register: true},
            props: mergeProps,
            poll: ready(ctx => { const p = hasSelection(ctx); return p === true ? me.state!.bm.totvertsel > 0 || 'Select the vertices to merge first' : p }),
            exec: (ctx, p) => {
                // No props: M, `op_menu("VIEW3D_MT_edit_mesh_merge")` (blender_default.py:5618).
                if (!p) {
                    engine.callMenu('VIEW3D_MT_edit_mesh_merge')
                    return {ok: true}
                }
                return mergeSession(ctx, p)
            },
        },
        // `mesh.dissolve` (Ctrl+X, `mesh.dissolve_mode`) and the dissolve family are registered by fillOps.ts.
        // `mesh.edge_face_add` (F) is registered by fillOps.ts, over the kernel's `edbm_add_edge_face_exec` port.
        // `mesh.subdivide` (`bmo_subdivide_edges`, all patterns) is registered by loopOps.ts.
        // --- topology: document commands ------------------------------------------------------
        {
            id: 'mesh.inset', label: 'Inset Faces', icon: 'inner-join', category: 'Mesh', modes: ['edit'],
            description: 'Inset the selected faces: a smaller copy of each, ringed by new side faces. Adjust the thickness in the panel.',
            flags: {undo: true, register: true},
            props: commandSchema('inset'),
            poll: ready(() => { const p = hasFaces(); return p === true ? needsDocument() : p }),
            exec: (_ctx, p) => runCommand('inset', {faces: selectedIndices('face'), thickness: 0.05, ...p},
                data => ({kind: 'face', indices: data?.insetFaces ?? []})),
        },
        {
            id: 'mesh.bevel', label: 'Bevel', icon: 'polygon-filter', category: 'Mesh', modes: ['edit'],
            description: 'Round or chamfer the selected edges (or vertex corners, in vertex mode). Adjust width and segments in the panel.',
            flags: {undo: true, register: true},
            props: bevelSchema(),
            poll: ready(ctx => { const p = hasSelection(ctx); return p === true ? needsDocument() : p }),
            exec: (ctx, p) => {
                // `affect` is MESH_OT_bevel's (editmesh_bevel.cc): Ctrl+B is EDGES, Ctrl+Shift+B VERTICES
                // (blender_default.py:5550, :5556). Unset, it follows the select mode.
                const {affect, ...rest} = p ?? {}
                const byVerts = affect === undefined ? ctx.selectMode === 'vertex' : affect === 'VERTICES'
                return runCommand('bevel', {[byVerts ? 'verts' : 'edges']: selectedIndices(byVerts ? 'vertex' : 'edge'), offset: 0.1, segments: 1, ...rest},
                    // A bevel that changed nothing (width 0, or declined edges) keeps the selection.
                    data => data?.newFaces?.length ? {kind: 'face', indices: data.newFaces} : null)
                    .then(r => r.ok && affect !== undefined ? {...r, props: {...p}} : r)
            },
        },
        {
            id: 'mesh.delete', label: 'Delete', icon: 'trash', category: 'Mesh', modes: ['edit'],
            description: 'Delete the selected vertices, edges or faces; the menu picks what goes (Blender\'s X).',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                type: {type: 'string', enum: DELETE_TYPES, description: 'What to delete, as Blender\'s mesh.delete.'},
            }},
            poll: ready(ctx => { const p = hasSelection(ctx); return p === true ? needsDocument() : p }),
            exec: (ctx, p) => {
                let type = p?.type as string | undefined
                // No type: X, `op_menu("VIEW3D_MT_edit_mesh_delete")` (blender_default.py:5634).
                if (!type) {
                    engine.callMenu('VIEW3D_MT_edit_mesh_delete')
                    return {ok: true}
                }
                // `auto` is the Design preset's Delete key: by select mode, no menu.
                if (type === 'auto') type = ctx.selectMode === 'face' ? 'FACE' : ctx.selectMode === 'edge' ? 'EDGE' : 'VERT'
                const domain = type === 'VERT' ? 'verts' : type === 'EDGE' || type === 'EDGE_FACE' ? 'edges' : 'faces'
                const kind = domain === 'verts' ? 'vertex' : domain === 'edges' ? 'edge' : 'face'
                const indices = selectedIndices(kind)
                if (!indices.length) return {ok: false, error: `Nothing selected to delete: ${type} deletes ${domain}`}
                return runCommand('deleteElements', {type, [domain]: indices}).then(r => r.ok ? {...r, props: {type}} : r)
            },
        },
        {
            // `MESH_OT_separate` (editmesh_tools.cc:4645): `type` from `prop_separate_types` - Selection and
            // By Loose Parts (plugin-modelling's `separate` command, `faces` / `loose`); By Material is not
            // there yet. No props: P, `WM_menu_invoke` - the type as a menu.
            id: 'mesh.separate', label: 'Separate', icon: 'split-columns', category: 'Mesh', modes: ['edit'],
            description: 'Move the selection, or each loose part, into new objects (Blender\'s P).',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                type: {type: 'string', enum: ['SELECTED', 'LOOSE'], default: 'SELECTED', description: 'Type: Selection, or By Loose Parts.'},
            }},
            poll: ready(() => !me.state ? onlyInEdit() : needsDocument()),
            exec: async(_ctx, p) => {
                if (!p) {
                    engine.callMenu('MESH_OT_separate.type')
                    return {ok: true}
                }
                if (p.type === 'LOOSE') {
                    const r = await runCommand('separate', {mode: 'loose'})
                    return r.ok ? {...r, props: {type: 'LOOSE'}} : r
                }
                const f = hasFaces()
                if (f !== true) return {ok: false, error: f}
                const faces = selectedIndices('face')
                if (me.state && faces.length === me.state.bm.totface) return {ok: false, error: 'That would separate every face and leave nothing behind: select fewer faces'}
                const r = await runCommand('separate', {mode: 'faces', faces})
                return r.ok ? {...r, props: {type: 'SELECTED'}} : r
            },
        },
        {
            // `MESH_OT_hide` (editmesh_tools.cc:2596, exec :2531): H hides the selection, Shift+H everything else
            // (`_template_items_hide_reveal_actions`, blender_default.py:461).
            id: 'mesh.hide', label: 'Hide Selected', icon: 'eye-off', category: 'Mesh', modes: ['edit'],
            description: 'Hide the selected vertices, edges and faces (or, Unselected, everything else) so you can work behind them; Reveal Hidden brings them back.',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                unselected: {type: 'boolean', default: false, description: 'Unselected: hide unselected rather than selected.'},
            }},
            poll: ready(editing),
            exec: (_ctx, p) => {
                const unselected = !!p?.unselected
                // Nothing hidden cancels (`edbm_hide_exec` :2585); `hideSelected` has already said why.
                return me.hideSelected(unselected) ? {ok: true, props: {unselected}} : {ok: false}
            },
        },
        {
            // `MESH_OT_reveal` (editmesh_tools.cc:2645), Alt+H.
            id: 'mesh.reveal', label: 'Reveal Hidden', icon: 'eye-open', category: 'Mesh', modes: ['edit'],
            description: 'Show every hidden vertex, edge and face, and select what comes back.',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                select: {type: 'boolean', default: true, description: 'Select: select the revealed elements.'},
            }},
            poll: ready(editing),
            exec: (_ctx, p) => {
                const select = p?.select === undefined ? true : !!p.select
                // Nothing hidden is not a failure: Blender's reveal finishes either way.
                me.revealHidden(select)
                return {ok: true, props: {select}}
            },
        },
        {
            id: 'mesh.toggle_xray', label: 'Toggle X-Ray', icon: 'eye-open', category: 'View', modes: ['edit'],
            description: 'See and select through the mesh.',
            exec: () => { me.xray = !me.xray; me.refreshOverlays(); engine.dispatchEvent({type: 'statusChanged', hints: engine.status}); return {ok: true} },
        },
    ]
    for (const op of ops) engine.operators.register(op)

    // A modal transform that just ended tells the redo panel what it did (Blender's `saveTransform`).
    const onCommitted = (e: {transform: ModalTransform, chained: string | null, saved: TransformSavedProps}) => {
        // Edge and vertex slide (`G G`) and Loop Cut and Slide are reported by `loopOps.ts`.
        if (!e.chained && e.saved.slide || (e.chained as string) === 'loopcut') return
        const props = savedToProps(e.saved)
        if (e.chained) engine.completeModal(`mesh.${e.chained}`, props)
        else engine.completeModal(e.saved.mode === 'translate' ? 'mesh.move' : e.saved.mode === 'rotate' ? 'mesh.rotate'
            : e.saved.mode === 'shrinkFatten' ? 'transform.shrink_fatten' : 'mesh.scale', props)
    }
    me.addEventListener('transformCommitted', onCommitted as never)
    engine.addEventListener('dispose' as never, () => me.removeEventListener('transformCommitted', onCommitted as never))
}

function activeEdge(me: EditorEnginePlugin['meshEdit']): BMEdge | null {
    const bm = me.state?.bm
    if (!bm) return null
    const active = selectHistoryActive(bm)
    if (active instanceof BMEdge) return active
    if (active instanceof BMFace) {
        for (const l of active.eachLoop()) if (l.e && l.e.hflag & ElemFlag.Select) return l.e
    }
    // Vertex mode: the last selected edge, if any edge is fully selected.
    for (const e of bm.edges) if (e.hflag & ElemFlag.Select) return e
    return null
}


function vec3(v: unknown, fallback: Vec3): Vec3 {
    if (Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && isFinite(x))) return [v[0], v[1], v[2]]
    return fallback
}
