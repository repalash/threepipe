/**
 * Cutting operators: the knife (`MESH_OT_knife_tool`) and bisect (`MESH_OT_bisect`).
 *
 * - `mesh.knife` (K, Shift+K) starts `MeshEditPlugin`'s knife modal on the live session; the cut is
 *   one undo step when it is confirmed. Like Blender's, it has no redo panel: the operator has no
 *   `exec`, only `invoke`/`modal` (`editmesh_knife.cc:4649`).
 * - `mesh.bisect` without a plane starts Blender's straight-line gesture: drag a line across the mesh,
 *   the cut previews while dragging (`gesture_straightline_apply` re-executing `mesh_bisect_exec` from
 *   a backup), and the release runs the modelling document's `bisect` command once - one undo step, and
 *   the redo panel edits the plane, Fill, Clear Inner/Outer and the threshold. With a plane it is that
 *   command directly, for the panel, the palette and the agent.
 */

import {bisectFillDefault, bisectPlaneFromScreenLine, bisectPlaneToLocal, bisectSelection, BMEdge, BMFace, BMVert, ElemFlag, KnifeView} from '@threepipe/mesh-kernel'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, OperatorDescriptor, OperatorResult, PropSchema} from '../registry'
import {visibleSchema} from './modellingOps'

type Vec3 = [number, number, number]

/** The props Blender remembers between bisects (`plane_co`/`plane_no` are `PROP_SKIP_SAVE`). */
const remembered = {fill: false, clearInner: false, clearOuter: false, threshold: 0.0001}

/** What the cut tools need from the operators. */
export interface CutActions {
    /** Start bisect's line gesture; `press` is the tool's press that already began it. */
    startBisectGesture(press?: {x: number, y: number, shift: boolean}): boolean
}

export function registerCutOperators(engine: EditorEnginePlugin): CutActions {
    const me = engine.meshEdit
    const modelling = engine.modelling
    const busy = (): true | string => (me.activeTransform || engine.propDrag || me.activeKnife || me.isLineGesture)
        ? 'Finish the current operation first' : true
    const editing = (): true | string => me.isEditing ? busy() : 'Only in edit mode'
    const docEntry = () => me.editObject && modelling ? modelling.document.find(me.editObject.uuid) : undefined

    /** Indices of the selected elements of a domain, in the numbering the commands use (set order). */
    const selectedIndices = (kind: 'vertex' | 'edge' | 'face'): number[] => {
        const bm = me.state!.bm
        const pool: Iterable<BMVert | BMEdge | BMFace> = kind === 'vertex' ? bm.verts : kind === 'edge' ? bm.edges : bm.faces
        const out: number[] = []
        let i = 0
        for (const el of pool) {
            if (el.hflag & ElemFlag.Select) out.push(i)
            i++
        }
        return out
    }

    /** The camera as Blender's region view, in canvas pixels. */
    const regionView = (): {view: KnifeView, height: number} => {
        const camera = engine.viewer.scene.mainCamera as any
        camera.updateMatrixWorld(true)
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
        const rect = engine.viewer.canvas.getBoundingClientRect()
        return {view: KnifeView.fromCamera(camera, rect.width, rect.height), height: rect.height}
    }

    /** The plane a dragged line means (`mesh_bisect_interactive_calc`), world space. */
    const planeFromLine = (a: {x: number, y: number}, b: {x: number, y: number}): {planeCo: Vec3, planeNo: Vec3} => {
        const {view, height} = regionView()
        // `rv3d->ofs` is the negated orbit centre; it only sets where along the ray `plane_co` sits.
        const target = (engine.viewer.scene.mainCamera as any)?.controls?.target
        const ofs: Vec3 = target ? [-target.x, -target.y, -target.z] : [0, 0, 0]
        const r = bisectPlaneFromScreenLine(view, [a.x, height - a.y], [b.x, height - b.y], ofs)
        const round = (v: Vec3): Vec3 => v.map(x => Math.round(x * 1e6) / 1e6 + 0) as Vec3
        return {planeCo: round(r.planeCo), planeNo: round(r.planeNo)}
    }

    /** Start the line gesture; `press` is the tool's press that already began it. */
    const startBisectGesture = (press?: {x: number, y: number, shift: boolean}): boolean => {
        const object = me.editObject
        if (!object || !me.state) return false
        if (me.state.bm.totedgesel === 0) {
            engine.message('info', 'Bisect needs selected edges or faces: select the part to cut first (A selects all).')
            return false
        }
        return me.startLineGesture({
            mouse: press ? {x: press.x, y: press.y} : undefined,
            active: !!press,
            onChange: (a, b) => {
                const {planeCo, planeNo} = planeFromLine(a, b)
                object.updateWorldMatrix(true, false)
                const local = bisectPlaneToLocal(planeCo, planeNo, Array.from(object.matrixWorld.elements))
                me.previewEdit(bm => {
                    bisectSelection(bm, {
                        planeCo: local.planeCo, planeNo: local.planeNo, useFill: remembered.fill,
                        clearInner: remembered.clearInner, clearOuter: remembered.clearOuter, threshold: remembered.threshold,
                    }, bisectFillDefault)
                })
                engine.dispatchEvent({type: 'statusChanged', hints: engine.status})
            },
            onEnd: (a, b) => {
                me.endPreview()
                void engine.run('mesh.bisect', {...remembered, ...planeFromLine(a, b)})
            },
            onCancel: () => {
                me.endPreview()
                // A click with the tool, not a drag: it selects, as the tool's fallthrough to the select keymap does.
                if (press) me.selectElement(me.pickAt(press.x, press.y, true), press.shift)
                engine.dispatchEvent({type: 'statusChanged', hints: engine.status})
            },
        })
    }

    const bisectSchema = (): PropSchema | undefined => {
        const def = modelling?.describeCommands().find(c => c.name === 'bisect')
        if (!def) return undefined
        const schema = visibleSchema(def.inputSchema as PropSchema)
        for (const k of ['object', 'objects', 'verts', 'edges', 'faces']) delete schema.properties[k]
        schema.required = []
        return schema
    }

    const ops: OperatorDescriptor[] = [
        {
            id: 'mesh.knife', label: 'Knife', icon: 'cut', category: 'Mesh', modes: ['edit'],
            contextMenu: ['vertex', 'edge', 'face'],
            description: 'Cut new edges by clicking points on the surface; Enter applies, Esc cancels. Shift+K cuts through to the back, selected faces only.',
            flags: {undo: true},
            props: {type: 'object', properties: {
                onlySelected: {type: 'boolean', description: 'Only cut selected faces.'},
                cutThrough: {type: 'boolean', description: 'Cut through to the faces behind (C toggles it while cutting).'},
            }},
            poll: (_ctx: EditorContext) => editing(),
            exec: (_ctx, p): OperatorResult => me.startKnife({onlySelected: !!p?.onlySelected, cutThrough: !!p?.cutThrough})
                ? {ok: true}
                : {ok: false, error: p?.onlySelected ? 'Selected faces required' : 'The knife could not start'},
        },
        {
            id: 'mesh.bisect', label: 'Bisect', icon: 'slash', category: 'Mesh', modes: ['edit'],
            contextMenu: ['edge', 'face'],
            description: 'Cut the selection along a plane: drag a line across the mesh. Adjust the plane, Fill and Clear in the panel.',
            flags: {undo: true, register: true},
            props: bisectSchema(),
            poll: (_ctx: EditorContext) => {
                const e = editing()
                if (e !== true) return e
                if (!docEntry()) return 'This object is not in the modelling document (ModellingPlugin is not loaded)'
                return me.state!.bm.totedgesel > 0 || 'Select edges or faces to cut first'
            },
            exec: async(_ctx, p): Promise<OperatorResult> => {
                if (!p || !Array.isArray(p.planeCo) || !Array.isArray(p.planeNo)) {
                    // `mesh_bisect_invoke`: no plane given, so draw one.
                    return startBisectGesture() ? {ok: true, modal: true} : {ok: false, error: 'Bisect could not start'}
                }
                const entry = docEntry()
                if (!entry || !modelling) return {ok: false, error: 'ModellingPlugin is not loaded'}
                remembered.fill = !!p.fill
                remembered.clearInner = !!p.clearInner
                remembered.clearOuter = !!p.clearOuter
                if (typeof p.threshold === 'number') remembered.threshold = p.threshold
                // The document must hold exactly what the session shows before the command reads it.
                me.applyToObject()
                const result = await modelling.run({
                    op: 'bisect', object: entry.name,
                    verts: selectedIndices('vertex'), edges: selectedIndices('edge'), faces: selectedIndices('face'),
                    planeCo: p.planeCo, planeNo: p.planeNo, fill: !!p.fill,
                    clearInner: !!p.clearInner, clearOuter: !!p.clearOuter, threshold: remembered.threshold,
                })
                if (!result.ok) return {ok: false, error: result.error}
                // Blender selects the cut, and the fill faces (`mesh_bisect_exec`, `:383`).
                const data = result.data as {cutVerts: number[], cutEdges: number[], fillFaces: number[]}
                if (me.state) {
                    me.selectElements('vertex', data.cutVerts)
                    me.selectElements('edge', data.cutEdges, true)
                    if (data.fillFaces.length) me.selectElements('face', data.fillFaces, true)
                }
                return {ok: true, data, warnings: result.warnings, props: {
                    planeCo: p.planeCo, planeNo: p.planeNo, fill: !!p.fill, clearInner: !!p.clearInner,
                    clearOuter: !!p.clearOuter, threshold: remembered.threshold,
                }}
            },
        },
    ]
    for (const op of ops) engine.operators.register(op)

    return {startBisectGesture}
}
