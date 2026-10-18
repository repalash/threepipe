/** Fill Curve (`GeometryNodeFillCurve`) - `nodes/geometry/nodes/node_geo_curve_fill.cc` (Blender 5.2.2) on `delaunay2d.ts`. */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {CDTOutputType, CDTResult, delaunay2dCalc} from '../../blender/delaunay2d'
import {FieldContext, FieldEvaluation, GField} from '../../fields'
import {CurvesGeometry} from '../../geometry/components'
import {CurvesEvaluator} from '../../geometry/curvesEval'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {meshCalcEdges} from '../../geometry/meshCalcEdges'
import {meshSmoothSet, newMesh} from '../../geometry/meshPrimitives'
import {registerNodeType} from '../../runtime/registry'

/** `do_cdt` (:72) / `do_cdt_with_mask` (:92): the evaluated points of `curves` (all, or a group), one face per curve. */
function doCdt(ev: CurvesEvaluator, outputType: CDTOutputType, mask: number[]): CDTResult {
    const positions = ev.positions
    const vert: [number, number][] = []
    const face: number[][] = []
    for (const c of mask) {
        const [s, e] = ev.evaluatedRange(c)
        const f: number[] = []
        for (let i = s; i < e; i++) {
            f.push(vert.length)
            // `double2(positions[i].x, positions[i].y)`.
            vert.push([positions[i * 3], positions[i * 3 + 1]])
        }
        face.push(f)
    }
    return delaunay2dCalc({vert, edge: [], face, epsilon: 0, needIds: false}, outputType)
}

/** `do_group_aware_cdt` (:120): groups in order of first appearance (`IndexMask::from_group_ids`). */
function doGroupAwareCdt(curves: CurvesGeometry, outputType: CDTOutputType, groupField: GField): CDTResult[] {
    const ev = new CurvesEvaluator(curves)
    const ids = new FieldEvaluation(new FieldContext('curves', curves, AttrDomain.Curve), curves.curvesNum).evaluate(groupField)
    const all = Array.from({length: curves.curvesNum}, (_, i) => i)
    if (ids.isSingle) return [doCdt(ev, outputType, all)]
    const groups = new Map<number, number[]>()
    for (let i = 0; i < curves.curvesNum; i++) {
        const id = ids.get(i)
        let g = groups.get(id)
        if (!g) groups.set(id, g = [])
        g.push(i)
    }
    return [...groups.values()].map(mask => doCdt(ev, outputType, mask))
}

/** `cdts_to_mesh` (:150). */
function cdtsToMesh(results: CDTResult[]): MeshData {
    let verts = 0, edges = 0, faces = 0, loops = 0
    for (const r of results) {
        verts += r.vert.length
        edges += r.edge.length
        faces += r.face.length
        for (const f of r.face) loops += f.length
    }
    const mesh = newMesh(verts, edges, faces, loops)
    const positions = mesh.positions, edgeVerts = mesh.edgeVerts, faceOffsets = mesh.faceOffsets, cornerVerts = mesh.cornerVerts
    let vo = 0, eo = 0, fo = 0, lo = 0
    for (const r of results) {
        r.vert.forEach((v, i) => positions.set([Math.fround(v[0]), Math.fround(v[1]), 0], (vo + i) * 3))
        r.edge.forEach((e, i) => {
            edgeVerts[(eo + i) * 2] = e[0] + vo
            edgeVerts[(eo + i) * 2 + 1] = e[1] + vo
        })
        for (const f of r.face) {
            faceOffsets[fo++] = lo
            for (const v of f) cornerVerts[lo++] = v + vo
        }
        vo += r.vert.length
        eo += r.edge.length
    }
    faceOffsets[faces] = loops
    // "The delaunay triangulation doesn't seem to return all of the necessary all_edges, even in triangulation mode."
    meshCalcEdges(mesh, true, false)
    meshSmoothSet(mesh, false)
    return mesh
}

registerNodeType({
    idname: 'GeometryNodeFillCurve',
    label: 'Fill Curve',
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.input('INT', 'Group ID').hideValue().field()
        b.input('MENU', 'Mode').default('Triangles')
        b.input('MENU', 'Fill Rule').default('Even-Odd')
        b.output('GEOMETRY', 'Mesh')
    },
    // `node_geo_exec` (:343) with `curve_fill_calculate` (:245).
    execute(p) {
        const mode = p.string('Mode'), rule = p.string('Fill Rule')
        if (mode !== 'Triangles' && mode !== 'N-gons') throw new Error(`Fill Curve: mode '${mode}' is not a menu item`)
        if (rule !== 'Even-Odd' && rule !== 'Non-Zero') throw new Error(`Fill Curve: fill rule '${rule}' is not a menu item`)
        const nonZero = rule === 'Non-Zero'
        const outputType = mode === 'N-gons'
            ? (nonZero ? CDTOutputType.CONSTRAINTS_VALID_BMESH_WITH_HOLES_NONZERO : CDTOutputType.CONSTRAINTS_VALID_BMESH_WITH_HOLES)
            : (nonZero ? CDTOutputType.INSIDE_WITH_HOLES_NONZERO : CDTOutputType.INSIDE_WITH_HOLES)
        const group = p.field('Group ID')
        p.set('Mesh', foreachRealGeometry(p.geometry('Curve'), g => {
            const curves = g.curves
            if (!curves) return
            if (curves.curvesNum > 0) g.setMesh(cdtsToMesh(doGroupAwareCdt(curves, outputType, group)))
            g.remove('curves')
        }, p.options.scene))
    },
})
