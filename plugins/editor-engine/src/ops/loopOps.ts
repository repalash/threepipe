/**
 * The loop tools' operators: Subdivide, Loop Cut and Slide, Edge Slide, Vertex Slide.
 *
 * Session operators, like dissolve and fill in `meshOps.ts`: they change `MeshEditPlugin`'s live BMesh
 * through the kernel ports and record one labelled undo step with `snapshot()` / `commit()`. Every one
 * is registered, so the redo-last panel re-runs it with edited props (Blender's F9 panel).
 */

import {editMeshSubdivide, meshNormalsUpdate} from '@threepipe/mesh-kernel'
import type {SubdQuadCornerType} from '@threepipe/mesh-kernel'
import type {ModalTransform, SlideSavedProps, TransformSavedProps} from '@threepipe/plugin-mesh-edit'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {OperatorDescriptor, PropSchema} from '../registry'

/** `prop_mesh_cornervert_types` (`editmesh_tools.cc:139`), in Blender's menu order. */
const QUAD_CORNERS: SubdQuadCornerType[] = ['innerVert', 'path', 'straightCut', 'fan']

type SlideMode = 'edgeSlide' | 'vertSlide'

/**
 * The slide operators' redo-panel props (`TRANSFORM_OT_edge_slide`, `TRANSFORM_OT_vert_slide`,
 * `transform_ops.cc:1215`, `:1253`): Factor, Even, Flipped, Clamp. The first run's cursor and the
 * vertex slide direction travel unseen in `_saved`, like Blender's hidden `direction`; keeping the
 * cursor is a deliberate deviation, see `SlideSavedProps` in `@threepipe/plugin-mesh-edit`.
 */
function slideSchema(mode: SlideMode): PropSchema {
    return {type: 'object', properties: {
        value: {type: 'number', minimum: -10, maximum: 10, default: 0, description: mode === 'edgeSlide'
            ? 'How far along: 1 reaches the neighbouring loop on one side, -1 the other.'
            : 'How far along the edge: 1 reaches the vertex at its other end.'},
        even: {type: 'boolean', default: false, description: 'Make the loop match the shape of the neighbouring loop instead of sliding each vertex the same fraction.'},
        flipped: {type: 'boolean', default: false, description: 'With Even, follow the neighbouring loop on the other side.'},
        clamp: {type: 'boolean', default: true, description: 'Stay within the neighbouring edges.'},
    }}
}

function slideToProps(saved: TransformSavedProps): Record<string, unknown> {
    const s = saved.slide!
    return {
        value: Math.round(saved.value[0] * 1e6) / 1e6,
        even: s.useEven,
        flipped: s.flipped,
        clamp: s.useClamp,
        _saved: {mval: s.mval, direction: s.direction},
    }
}

function propsToSlide(mode: SlideMode, p: Record<string, unknown>): TransformSavedProps {
    const hidden = (p._saved ?? {}) as Partial<{mval: [number, number], direction: [number, number, number] | null}>
    const slide: SlideSavedProps = {
        useEven: !!p.even,
        flipped: !!p.flipped,
        useClamp: p.clamp === undefined ? true : !!p.clamp,
        mval: Array.isArray(hidden.mval) ? [Number(hidden.mval[0]) || 0, Number(hidden.mval[1]) || 0] : [0, 0],
        direction: Array.isArray(hidden.direction) ? [Number(hidden.direction[0]), Number(hidden.direction[1]), Number(hidden.direction[2])] : null,
    }
    return {
        mode,
        value: [Number(p.value ?? 0) || 0],
        // The slides have no orientation, constraint or proportional properties.
        orientType: 'global', orientMatrixType: 'global', orientMatrix: null, constraintAxis: null, orientAxis: 2,
        proportional: {enabled: false, connected: false, projected: false, falloff: 'smooth', size: 1},
        snap: false,
        slide,
    }
}

export function registerLoopOperators(engine: EditorEnginePlugin): void {
    const me = engine.meshEdit
    const notModal = () => !me.activeTransform && !engine.propDrag || 'Finish the current operation first'
    /** `edbm_subdivide_exec` skips an object with neither a selected edge nor a selected face. */
    const hasEdges = () => {
        if (!me.state) return 'Only in edit mode'
        const bm = me.state.bm
        if (!(bm.totedgesel || bm.totfacesel)) return 'Select some edges or faces first'
        return notModal()
    }

    const ops: OperatorDescriptor[] = [
        {
            // `MESH_OT_subdivide` (`editmesh_tools.cc:150`).
            id: 'mesh.subdivide', label: 'Subdivide', icon: 'grid', category: 'Mesh', modes: ['edit'],
            contextMenu: ['edge', 'face'],
            description: 'Cut each selected edge into equal parts and split the faces between them. Set the number of cuts and the smoothness in the panel.',
            flags: {undo: true, register: true},
            props: {type: 'object', properties: {
                cuts: {type: 'integer', minimum: 1, maximum: 100, default: 1, description: 'How many new vertices each selected edge gets.'},
                smoothness: {type: 'number', minimum: 0, maximum: 1000, default: 0, description: 'Bulge the new vertices out along the surface\'s curvature; 0 keeps them on the straight edges.'},
                ngon: {type: 'boolean', default: true, description: 'Allow faces with more than four sides. Off limits the new faces to triangles and quads.'},
                quadCorner: {type: 'string', enum: QUAD_CORNERS, default: 'straightCut', description: 'How a quad with two adjacent cut edges is filled. Anything but straight cut avoids n-gons.'},
            }},
            poll: hasEdges,
            exec: (_ctx, p) => {
                const state = me.state
                const before = me.snapshot()
                if (!state || !before) return {ok: false, error: 'Only in edit mode'}
                const cuts = Math.max(1, Math.min(100, Math.trunc(Number(p?.cuts ?? 1)) || 1))
                const smoothness = Math.max(0, Number(p?.smoothness ?? 0) || 0)
                const ngon = p?.ngon === undefined ? true : !!p.ngon
                let quadCorner = (QUAD_CORNERS.includes(p?.quadCorner as SubdQuadCornerType) ? p!.quadCorner : 'straightCut') as SubdQuadCornerType
                // Blender writes the substitution back to the operator's property (`editmesh_tools.cc:97`),
                // so the panel shows what ran.
                if (!ngon && quadCorner === 'straightCut') quadCorner = 'innerVert'

                // Edit mode keeps vertex normals current (`EDBM_update`); the smoothing reads them.
                meshNormalsUpdate(state.bm)
                const done = editMeshSubdivide(state.bm, {numberCuts: cuts, smoothness, ngon, quadcorner: quadCorner})
                if (!done) return {ok: false, error: 'Select some edges or faces first'}
                me.commit(before, 'Subdivide')
                return {ok: true, props: {cuts, smoothness, ngon, quadCorner}}
            },
        },
        ...([
            ['edgeSlide', 'mesh.edge_slide', 'Edge Slide', 'Slide the selected edge loops along the faces beside them. E: even, F: flip, C or Alt: unclamped.', ['edge']],
            ['vertSlide', 'mesh.vert_slide', 'Vertex Slide', 'Slide the selected vertices along one of their edges, picked by the direction the mouse moves. E: even, F: flip, C or Alt: unclamped.', ['vertex']],
        ] as const).map(([mode, id, label, description, menu]): OperatorDescriptor => ({
            // `TRANSFORM_OT_edge_slide` / `TRANSFORM_OT_vert_slide` (`transform_ops.cc:1215`, `:1253`).
            id, label, description, icon: 'swap-horizontal', category: 'Mesh', modes: ['edit'], contextMenu: [...menu],
            flags: {undo: true, register: true},
            props: slideSchema(mode),
            poll: () => {
                if (!me.state) return 'Only in edit mode'
                if (!me.state.bm.totvertsel) return mode === 'edgeSlide' ? 'Select an edge loop first' : 'Select some vertices first'
                return notModal()
            },
            exec: (_ctx, p) => {
                // No props: the interactive modal. With props: the redo panel's exact re-run.
                if (!p) return me.startTransform(mode) ? {ok: true, modal: true} : {ok: false, error: `Nothing to slide: ${label} needs ${mode === 'edgeSlide' ? 'edge loops' : 'vertices'} selected`}
                if (!me.state) return {ok: false, error: 'Only in edit mode'}
                return me.applyTransformValues(propsToSlide(mode, p)) ? {ok: true, props: p} : {ok: false, error: `${label} cannot run on this selection`}
            },
        })),
    ]
    for (const op of ops) engine.operators.register(op)

    // A slide that just ended - started directly or switched to with G G from Move - is the redo
    // panel's operation; Blender switches the operator's type the same way (`transform_ops.cc:480`).
    const onCommitted = (e: {transform: ModalTransform, chained: string | null, saved: TransformSavedProps}) => {
        if (e.chained || !e.saved.slide) return
        engine.completeModal(e.saved.mode === 'edgeSlide' ? 'mesh.edge_slide' : 'mesh.vert_slide', slideToProps(e.saved))
    }
    me.addEventListener('transformCommitted', onCommitted as never)
    engine.addEventListener('dispose' as never, () => me.removeEventListener('transformCommitted', onCommitted as never))
}
