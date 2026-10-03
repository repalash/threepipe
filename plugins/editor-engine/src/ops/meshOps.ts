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

import {Matrix4, Vector3} from 'threepipe'
import {collectTransformVerts, ModalTransform} from '@threepipe/plugin-mesh-edit'
import {
    BMEdge,
    BMFace,
    BMVert,
    dissolveFaces,
    dissolveEdges,
    dissolveVerts,
    edgeSelectSet,
    ElemFlag,
    faceSelectSet,
    fillSelection,
    selectHistoryActive,
    walkEdgeLoop,
    walkEdgeRing,
    walkFaceLoop,
} from '@threepipe/mesh-kernel'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, OperatorDescriptor, OperatorResult, PropSchema} from '../registry'
import {visibleSchema} from './modellingOps'

type Vec3 = [number, number, number]

/** Blender's `mesh.delete` types (`editmesh_tools.cc`, `MESH_OT_delete`), as the X menu lists them. */
const DELETE_MENU: {type: string, label: string}[] = [
    {type: 'VERT', label: 'Vertices'},
    {type: 'EDGE', label: 'Edges'},
    {type: 'FACE', label: 'Faces'},
    {type: 'EDGE_FACE', label: 'Only Edges & Faces'},
    {type: 'ONLY_FACE', label: 'Only Faces'},
]

export function registerMeshOperators(engine: EditorEnginePlugin): void {
    const me = engine.meshEdit
    const modelling = engine.modelling
    const editing = () => me.isEditing || 'Only in edit mode'
    const notModal = () => !me.activeTransform && !engine.propDrag || 'Finish the current operation first'
    const hasSelection = (_ctx: EditorContext) => {
        if (!me.state) return 'Only in edit mode'
        return me.state.bm.totvertsel > 0 || 'Select some vertices, edges or faces first'
    }
    const hasFaces = () => me.state ? me.state.bm.totfacesel > 0 || 'Select some faces first' : 'Only in edit mode'
    const ready = (poll: (ctx: EditorContext) => boolean | string) => (ctx: EditorContext) => {
        const p = poll(ctx)
        return p === true ? notModal() : p
    }
    const commandSchema = (op: string): PropSchema | undefined => {
        const def = modelling?.describeCommands().find(c => c.name === op)
        if (!def) return undefined
        const schema = visibleSchema(def.inputSchema as PropSchema)
        for (const k of ['faces', 'edges', 'verts', 'type', 'mode', 'name']) delete schema.properties[k]
        schema.required = []
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

    /** The redo-panel props for a transform, from the modal's final state (Blender's `saveTransform`). */
    const transformProps = (t: ModalTransform): Record<string, unknown> => {
        const v = [...t.valuesFinal] as Vec3
        switch (t.mode) {
        case 'translate': return {value: v, orientation: t.constraint.customAxis ? 'normal' : t.constraint.orientation}
        case 'rotate': return {angle: Math.round(v[0] * 180 / Math.PI * 1000) / 1000, axis: [...t.axisFinal] as Vec3}
        case 'resize': return {value: v}
        }
    }

    const transformOp = (id: string, mode: 'translate' | 'rotate' | 'resize', label: string, icon: string, description: string, props: PropSchema): OperatorDescriptor => ({
        id, label, icon, description, category: 'Mesh', modes: ['edit'], contextMenu: ['vertex', 'edge', 'face'],
        flags: {undo: true, register: true},
        props,
        poll: ready(hasSelection),
        exec: (_ctx, p) => {
            // No props: the interactive modal (G/R/S). With props: the exact re-run the redo panel asks for.
            if (!p) return me.startTransform(mode) ? {ok: true, modal: true} : {ok: false, error: 'Nothing to transform'}
            const before = me.snapshot()
            if (!before || !me.state) return {ok: false, error: 'Only in edit mode'}
            const verts = collectTransformVerts(me.state.bm)
            if (!verts.length) return {ok: false, error: 'Nothing to transform'}
            const pivot = median(verts)
            const m = new Matrix4()
            if (mode === 'translate') {
                const d = vec3(p.value, [0, 0, 0])
                m.makeTranslation(d[0], d[1], d[2])
            } else if (mode === 'rotate') {
                const axis = new Vector3(...vec3(p.axis, [0, 0, 1])).normalize()
                const angle = Number(p.angle ?? 0) * Math.PI / 180
                m.makeRotationAxis(axis, angle)
                m.premultiply(new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
            } else {
                const s = vec3(p.value, [1, 1, 1])
                m.makeScale(s[0], s[1], s[2])
                m.premultiply(new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
            }
            const v = new Vector3()
            for (const vert of verts) {
                v.set(vert.x, vert.y, vert.z).applyMatrix4(m)
                vert.setCo(v.x, v.y, v.z)
            }
            me.commit(before, label)
            return {ok: true, props: p}
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
            poll: ctx => ctx.mode === 'edit' || ctx.selectedObjects.some(o => !!o.geometry) || 'Select a mesh first',
            exec: ctx => {
                if (ctx.mode === 'object' && !engine.setMode('edit')) return {ok: false, error: 'Select a mesh first'}
                engine.setSelectMode(m)
                return {ok: true}
            },
        })),
        {
            id: 'mesh.select_all', label: 'Select All', icon: 'select', category: 'Select', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Select every element.',
            poll: editing,
            exec: () => { me.selectAllElements(); return {ok: true} },
        },
        {
            id: 'mesh.select_none', label: 'Select None', icon: 'disable', category: 'Select', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
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
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Grow the selection to everything connected to it.',
            poll: hasSelection,
            exec: () => { me.selectLinked(); return {ok: true} },
        },
        {
            id: 'mesh.select_loop', label: 'Select Edge Loop', icon: 'ring', category: 'Select', modes: ['edit'],
            contextMenu: ['edge', 'face'],
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
            contextMenu: ['edge'],
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
                value: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'Offset in the object\'s space.'},
                orientation: {type: 'string', enum: ['global', 'local', 'normal'], description: 'Axis set the constraint used.'},
            }}),
        transformOp('mesh.rotate', 'rotate', 'Rotate', 'refresh',
            'Rotate the selection with the mouse; X/Y/Z locks an axis, type degrees for an exact angle.',
            {type: 'object', properties: {
                angle: {type: 'number', description: 'Angle in degrees.'},
                axis: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'Axis in the object\'s space.'},
            }}),
        transformOp('mesh.scale', 'resize', 'Scale', 'maximize',
            'Scale the selection with the mouse; X/Y/Z locks an axis, type a factor for an exact scale.',
            {type: 'object', properties: {
                value: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'Scale factor per axis.'},
            }}),
        // --- topology: session operators ------------------------------------------------------
        {
            id: 'mesh.extrude', label: 'Extrude', icon: 'arrow-up', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Extrude the selection and start moving it along its normal. Click or Enter to confirm, Esc to cancel the move.',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                offset: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'How far the new geometry was moved, in the object\'s space.'},
            }},
            poll: ready(hasSelection),
            exec: (_ctx, p) => {
                if (!p) return me.extrude() ? {ok: true, modal: true} : {ok: false, error: 'Nothing to extrude'}
                return me.extrudeBy(vec3(p.offset, [0, 0, 0])) ? {ok: true, props: p} : {ok: false, error: 'Nothing to extrude'}
            },
        },
        {
            id: 'mesh.duplicate', label: 'Duplicate', icon: 'duplicate', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Copy the selected elements and start moving the copy.',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                offset: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3, description: 'How far the copy was moved.'},
            }},
            poll: ready(hasSelection),
            exec: (_ctx, p) => {
                if (!p) return me.duplicate() ? {ok: true, modal: true} : {ok: false, error: 'Nothing to duplicate'}
                return me.duplicateBy(vec3(p.offset, [0, 0, 0])) ? {ok: true, props: p} : {ok: false, error: 'Nothing to duplicate'}
            },
        },
        {
            id: 'mesh.split', label: 'Split', icon: 'fork', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Detach the selection from the rest of the mesh, keeping it in place.',
            flags: {undo: true, register: true},
            poll: ready(hasSelection),
            exec: () => me.split() ? {ok: true} : {ok: false, error: 'Nothing to split'},
        },
        {
            id: 'mesh.merge', label: 'Merge', icon: 'group-objects', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Collapse the selected vertices into one: at their centre, or at the first or last selected.',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                mode: {type: 'string', enum: ['center', 'first', 'last'], description: 'Where the merged vertex ends up.', default: 'center'},
            }},
            poll: ready(ctx => { const p = hasSelection(ctx); return p === true ? me.state!.bm.totvertsel > 1 || 'Select two or more vertices to merge' : p }),
            exec: (_ctx, p) => {
                if (!p) {
                    engine.requestMenu('Merge', [
                        {id: 'mesh.merge', label: 'At Center', props: {mode: 'center'}},
                        {id: 'mesh.merge', label: 'At First', props: {mode: 'first'}},
                        {id: 'mesh.merge', label: 'At Last', props: {mode: 'last'}},
                    ])
                    return {ok: true}
                }
                const mode = (p.mode as 'center' | 'first' | 'last') ?? 'center'
                return me.merge(mode) ? {ok: true, props: {mode}} : {ok: false, error: 'Select at least two vertices to merge'}
            },
        },
        {
            id: 'mesh.dissolve', label: 'Dissolve', icon: 'eraser', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Remove the selected vertices, edges or faces, merging the faces around them into one (Blender\'s Ctrl+X).',
            flags: {undo: true, register: true},
            poll: ready(hasSelection),
            exec: ctx => {
                const before = me.snapshot()
                if (!before || !me.state) return {ok: false, error: 'Only in edit mode'}
                const bm = me.state.bm
                let n = 0
                if (ctx.selectMode === 'face') {
                    const faces = [...bm.faces].filter(f => f.hflag & ElemFlag.Select)
                    n = dissolveFaces(bm, faces).length ? faces.length : 0
                } else if (ctx.selectMode === 'edge') {
                    n = dissolveEdges(bm, [...bm.edges].filter(e => e.hflag & ElemFlag.Select))
                } else {
                    n = dissolveVerts(bm, [...bm.verts].filter(v => v.hflag & ElemFlag.Select))
                }
                if (!n) return {ok: false, error: 'Nothing could be dissolved: the selection has no faces around it to merge'}
                me.commit(before, `Dissolve ${ctx.selectMode === 'face' ? 'Faces' : ctx.selectMode === 'edge' ? 'Edges' : 'Vertices'}`)
                return {ok: true}
            },
        },
        {
            id: 'mesh.fill', label: 'Fill', icon: 'full-circle', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge'],
            description: 'Make a face from the selected vertices or edges, or an edge from two vertices (Blender\'s F).',
            flags: {undo: true, register: true},
            poll: ready(ctx => { const p = hasSelection(ctx); return p === true ? me.state!.bm.totvertsel > 1 || 'Select two or more vertices' : p }),
            exec: () => {
                const before = me.snapshot()
                if (!before || !me.state) return {ok: false, error: 'Only in edit mode'}
                const made = fillSelection(me.state.bm)
                if (!made) return {ok: false, error: 'Could not make a face from this selection: a face there already exists, or the vertices do not form a loop'}
                me.commit(before, made.face ? 'Make Face' : 'Make Edge')
                return {ok: true}
            },
        },
        {
            id: 'mesh.subdivide', label: 'Subdivide', icon: 'grid', category: 'Mesh', modes: ['edit'],
            description: 'Cut each selected edge and the faces between them.',
            flags: {undo: true, register: true},
            poll: () => 'Not available yet: the kernel has Blender\'s `bmo_subdivide_edges` only for the icosphere (`tri_3edge`); the quad patterns are in the P3 backlog',
            exec: () => ({ok: false, error: 'Subdivide is not implemented yet'}),
        },
        // --- topology: document commands ------------------------------------------------------
        {
            id: 'mesh.inset', label: 'Inset Faces', icon: 'inner-join', category: 'Mesh', modes: ['edit'],
            contextMenu: ['face'],
            description: 'Inset the selected faces: a smaller copy of each, ringed by new side faces. Adjust the thickness in the panel.',
            flags: {undo: true, register: true},
            props: commandSchema('inset'),
            poll: ready(() => { const p = hasFaces(); return p === true ? needsDocument() : p }),
            exec: (_ctx, p) => runCommand('inset', {faces: selectedIndices('face'), thickness: 0.05, ...p},
                data => ({kind: 'face', indices: data?.insetFaces ?? []})),
        },
        {
            id: 'mesh.bevel', label: 'Bevel', icon: 'polygon-filter', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge'],
            description: 'Round or chamfer the selected edges (or vertex corners, in vertex mode). Adjust width and segments in the panel.',
            flags: {undo: true, register: true},
            props: commandSchema('bevel'),
            poll: ready(ctx => { const p = hasSelection(ctx); return p === true ? needsDocument() : p }),
            exec: (ctx, p) => {
                const byVerts = ctx.selectMode === 'vertex'
                return runCommand('bevel', {[byVerts ? 'verts' : 'edges']: selectedIndices(byVerts ? 'vertex' : 'edge'), offset: 0.1, segments: 1, ...p},
                    data => ({kind: 'face', indices: data?.newFaces ?? []}))
            },
        },
        {
            id: 'mesh.delete', label: 'Delete', icon: 'trash', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Delete the selected vertices, edges or faces; the menu picks what goes (Blender\'s X).',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                type: {type: 'string', enum: DELETE_MENU.map(d => d.type), description: 'What to delete, as Blender\'s mesh.delete.'},
            }},
            poll: ready(ctx => { const p = hasSelection(ctx); return p === true ? needsDocument() : p }),
            exec: (ctx, p) => {
                let type = p?.type as string | undefined
                if (!type) {
                    engine.requestMenu('Delete', DELETE_MENU.map(d => ({id: 'mesh.delete', label: d.label, props: {type: d.type}})))
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
            id: 'mesh.separate', label: 'Separate Selection', icon: 'split-columns', category: 'Mesh', modes: ['edit'],
            contextMenu: ['face'],
            description: 'Move the selected faces into a new object (Blender\'s P).',
            flags: {undo: true, register: true},
            poll: ready(() => { const p = hasFaces(); return p === true ? needsDocument() : p }),
            exec: async() => {
                const faces = selectedIndices('face')
                if (me.state && faces.length === me.state.bm.totface) return {ok: false, error: 'That would separate every face, leaving nothing'}
                return runCommand('separate', {mode: 'faces', faces})
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
    const onCommitted = (e: {transform: ModalTransform, chained: 'extrude' | 'duplicate' | null}) => {
        const t = e.transform
        if (e.chained) engine.completeModal(`mesh.${e.chained}`, {offset: [...t.valuesFinal] as Vec3})
        else engine.completeModal(t.mode === 'translate' ? 'mesh.move' : t.mode === 'rotate' ? 'mesh.rotate' : 'mesh.scale', transformProps(t))
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

function median(verts: BMVert[]): Vector3 {
    const c = new Vector3()
    for (const v of verts) c.add(new Vector3(v.x, v.y, v.z))
    return c.multiplyScalar(1 / Math.max(1, verts.length))
}

function vec3(v: unknown, fallback: Vec3): Vec3 {
    if (Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && isFinite(x))) return [v[0], v[1], v[2]]
    return fallback
}
