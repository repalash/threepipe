/** Split Edges (`node_geo_edge_split.cc`) on `geometry::split_edges` (`src/geometry/meshSplitEdges.ts`). */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation} from '../../fields'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {splitEdges} from '../../geometry/meshSplitEdges'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeSplitEdges',
    label: 'Split Edges',
    // `node_declare`.
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.output('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
    },
    // `node_geo_exec`: the selection on the edges of every real mesh, nothing to do when it is empty.
    execute(p) {
        const selection = p.field('Selection')
        const out = foreachRealGeometry(p.geometry('Mesh'), g => {
            const mesh = g.mesh
            if (!mesh) return
            const sel = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Edge), mesh.edgesNum).evaluate(selection)
            const mask: number[] = []
            for (let e = 0; e < mesh.edgesNum; e++) if (sel.get(e)) mask.push(e)
            if (!mask.length) return
            splitEdges(g.meshForWrite()!, mask)
        }, p.options.scene)
        p.set('Mesh', out)
    },
})
