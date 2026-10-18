/** Triangulate (`node_geo_triangulate.cc`): `geometry::mesh_triangulate` on the selected faces of each real mesh. */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation} from '../../fields'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {meshTriangulate, TriangulateNGonMode, TriangulateQuadMode} from '../../geometry/meshTriangulate'
import {registerNodeType} from '../../runtime/registry'

/** Menu item names (`rna_node_geometry_triangulate_quad_method_items`, `..._ngon_method_items`). */
const QUAD_MODES: Record<string, TriangulateQuadMode> = {
    'Beauty': 'BEAUTY', 'Fixed': 'FIXED', 'Fixed Alternate': 'ALTERNATE', 'Shortest Diagonal': 'SHORT_EDGE', 'Longest Diagonal': 'LONG_EDGE',
}
const NGON_MODES: Record<string, TriangulateNGonMode> = {'Beauty': 'BEAUTY', 'Clip': 'EAR_CLIP'}

registerNodeType({
    idname: 'GeometryNodeTriangulate',
    label: 'Triangulate',
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.output('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('MENU', 'Quad Method').default('Shortest Diagonal')
        b.input('MENU', 'N-gon Method').default('Beauty')
    },
    // `node_geo_exec` (:75).
    execute(p) {
        const quadMode = QUAD_MODES[p.string('Quad Method')], ngonMode = NGON_MODES[p.string('N-gon Method')]
        if (!quadMode || !ngonMode) throw new Error(`Triangulate: '${p.string('Quad Method')}' / '${p.string('N-gon Method')}' is not a menu item`)
        const selection = p.field('Selection')
        const out = foreachRealGeometry(p.geometry('Mesh'), g => {
            const mesh = g.mesh
            if (!mesh || mesh.cornersNum === mesh.facesNum * 3) return
            const sel = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Face), mesh.facesNum).evaluate(selection)
            const faces: number[] = []
            for (let f = 0; f < mesh.facesNum; f++) if (sel.get(f)) faces.push(f)
            if (!faces.length) return
            const result = meshTriangulate(mesh, faces, ngonMode, quadMode)
            if (result) g.setMesh(result)
        }, p.options.scene)
        p.set('Mesh', out)
    },
})
