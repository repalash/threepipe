/**
 * Subdivide Mesh (`nodes/geometry/nodes/node_geo_mesh_subdivide.cc`, Blender 5.2.2): `bke::subdiv` with the simple
 * scheme at OpenSubdiv level 1, meshed at resolution `(1 << level) + 1` (`src/geometry/subdiv*.ts`,
 * `src/blender/opensubdiv/`).
 */

import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {GeometrySet} from '../../geometry/GeometrySet'
import {fvarInterpolationFromUvSmooth, subdivNewFromMesh, SubdivSettings, vtxBoundaryInterpolationFromSubsurf} from '../../geometry/subdiv'
import {subdivToMesh} from '../../geometry/subdivMesh'
import {registerNodeType} from '../../runtime/registry'
import type {MeshData} from '@threepipe/mesh-kernel'

/** `simple_subdivide_mesh` (`node_geo_mesh_subdivide.cc:27`): undefined when no `Subdiv` could be made. */
function simpleSubdivideMesh(mesh: MeshData, level: number): MeshData | null | undefined {
    const settings: SubdivSettings = {
        isSimple: true,
        isAdaptive: false,
        useCreases: false,
        level: 1,
        vtxBoundaryInterpolation: vtxBoundaryInterpolationFromSubsurf(0),
        fvarLinearInterpolation: fvarInterpolationFromUvSmooth(0),
    }
    const subdiv = subdivNewFromMesh(settings, mesh)
    if (!subdiv) return undefined
    // `geometry::debug_randomize_mesh_order` is off unless the debug option is set.
    return subdivToMesh(subdiv, {resolution: (1 << level) + 1, useOptimalDisplay: false}, mesh)
}

registerNodeType({
    idname: 'GeometryNodeSubdivideMesh',
    label: 'Subdivide Mesh',
    // `node_declare` (:15).
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.output('GEOMETRY', 'Mesh')
        b.input('INT', 'Level').default(1).min(0).max(6)
    },
    // `node_geo_exec` (:59).
    execute(p) {
        const geometry = p.geometry('Mesh')
        const level = Math.max(p.int('Level'), 0)
        if (level === 0) {
            p.set('Mesh', geometry)
            return
        }
        if (level >= 16) {
            p.warn('The subdivision level is too large')
            p.set('Mesh', new GeometrySet())
            return
        }
        const out = foreachRealGeometry(geometry, g => {
            const mesh = g.mesh
            if (!mesh) return
            // `replace_mesh(simple_subdivide_mesh(...))`: a null result removes the mesh.
            g.setMesh(simpleSubdivideMesh(mesh, level) ?? undefined)
        }, p.options.scene)
        p.set('Mesh', out)
    },
})
