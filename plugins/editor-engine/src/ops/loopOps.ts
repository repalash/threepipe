/**
 * The loop tools' operators: Subdivide, Loop Cut and Slide, Edge Slide, Vertex Slide.
 *
 * Session operators, like dissolve and fill in `meshOps.ts`: they change `MeshEditPlugin`'s live BMesh
 * through the kernel ports and record one labelled undo step with `snapshot()` / `commit()`. Every one
 * is registered, so the redo-last panel re-runs it with edited props (Blender's F9 panel).
 */

import {editMeshSubdivide, meshNormalsUpdate} from '@threepipe/mesh-kernel'
import type {SubdQuadCornerType} from '@threepipe/mesh-kernel'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {OperatorDescriptor} from '../registry'

/** `prop_mesh_cornervert_types` (`editmesh_tools.cc:139`), in Blender's menu order. */
const QUAD_CORNERS: SubdQuadCornerType[] = ['innerVert', 'path', 'straightCut', 'fan']

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
    ]
    for (const op of ops) engine.operators.register(op)
}
