/**
 * Mesh / curve conversion nodes: Mesh to Curve (`node_geo_mesh_to_curve.cc`) and Curve to Mesh
 * (`node_geo_curve_to_mesh.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation} from '../../fields'
import {GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {curveToMeshSweep, curveToWireMesh} from '../../geometry/curveToMesh'
import {meshEdgesToCurvesConvert, meshFacesToCurvesConvert} from '../../geometry/meshToCurve'
import {registerNodeType} from '../../runtime/registry'

/** `geometry_set.keep_only({Edit})`: the real components go. */
function clearReal(g: GeometrySet): void {
    for (const t of ['mesh', 'pointcloud', 'curves', 'instances'] as const) g.remove(t)
}

registerNodeType({
    idname: 'GeometryNodeMeshToCurve',
    label: 'Mesh to Curve',
    properties: {mode: 'EDGES'},
    enums: {mode: ['EDGES', 'FACES']},
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.output('GEOMETRY', 'Curve')
    },
    // `node_geo_exec` (:43).
    execute(p) {
        const faces = p.node.prop<string>('mode') === 'FACES'
        const selection = p.field('Selection')
        p.set('Curve', foreachRealGeometry(p.geometry('Mesh'), g => {
            const mesh = g.mesh
            if (!mesh) return clearReal(g)
            const domain = faces ? AttrDomain.Face : AttrDomain.Edge
            const size = faces ? mesh.facesNum : mesh.edgesNum
            const sel = new FieldEvaluation(new FieldContext('mesh', mesh, domain), size).evaluate(selection)
            const indices: number[] = []
            for (let i = 0; i < size; i++) if (sel.get(i, 0)) indices.push(i)
            if (indices.length === 0) return clearReal(g)
            const src = g.attributes('mesh')!
            const curves = faces ? meshFacesToCurvesConvert(mesh, src, indices, () => false) : meshEdgesToCurvesConvert(mesh, src, indices, () => false)
            // `replace_curves`, then `keep_only({Curve, Edit})`.
            clearReal(g)
            g.setCurves(curves)
        }, p.options.scene))
    },
})

registerNodeType({
    idname: 'GeometryNodeCurveToMesh',
    label: 'Curve to Mesh',
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.input('GEOMETRY', 'Profile Curve')
        b.input('FLOAT', 'Scale').default(1).min(0).field()
        b.input('BOOLEAN', 'Fill Caps').default(false)
        b.output('GEOMETRY', 'Mesh')
    },
    // `node_geo_exec` (:130).
    execute(p) {
        const profileSet = p.geometry('Profile Curve')
        const scale = p.field('Scale')
        const fillCaps = p.bool('Fill Caps')
        p.set('Mesh', foreachRealGeometry(p.geometry('Curve'), g => {
            const curves = g.curves
            if (curves) {
                // `curve_to_mesh` (:43): the sweep with a profile, else the wire mesh.
                const profile = profileSet.curves
                let mesh
                if (profile) {
                    const scales = new FieldEvaluation(new FieldContext('curves', curves, AttrDomain.Point), curves.pointsNum).evaluate(scale)
                    mesh = curveToMeshSweep(curves, profile, scales, fillCaps)
                } else {
                    mesh = curveToWireMesh(curves)
                }
                // `mesh->mat = MEM_dupalloc(curves.mat)`.
                if (mesh) mesh.materials = curves.materials.slice()
                g.setMesh(mesh)
            }
            // `keep_only({Mesh, Instance, Edit})`.
            g.remove('pointcloud')
            g.remove('curves')
        }, p.options.scene))
    },
})
