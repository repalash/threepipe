/**
 * Subdivision Surface (`nodes/geometry/nodes/node_geo_subdivision_surface.cc`, Blender 5.2.2): `bke::subdiv` with
 * Catmull-Clark, adaptive (limit surface) to Quality or uniform to Level, meshed at resolution `(1 << level) + 1`
 * (`@threepipe/mesh-kernel` `src/subdiv/bke/`). The limit surface is evaluated by `Subdiv.limitEvaluator` until the
 * float adaptive port (subplan 15e phase 2).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, GField} from '../../fields'
import {GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {fvarInterpolationFromUvSmooth, subdivNewFromMesh, SubdivSettings, subdivToMesh, vtxBoundaryInterpolationFromSubsurf} from '@threepipe/mesh-kernel'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

/** `rna_enum_subdivision_uv_smooth_items` (`rna_modifier.cc`): menu item names to `SUBSURF_UV_SMOOTH_*`. */
const UV_SMOOTH: Record<string, number> = {
    'None': 0, 'Keep Corners': 1, 'Keep Corners, Junctions': 2, 'Keep Corners, Junctions, Concave': 3, 'Keep Boundaries': 4, 'All': 5,
}
/** `rna_enum_subdivision_boundary_smooth_items`: `SUBSURF_BOUNDARY_SMOOTH_*`. */
const BOUNDARY_SMOOTH: Record<string, number> = {'All': 0, 'Keep Corners': 1}

/** `clamp_crease` (:84) over an evaluated field: a single value stays single. */
function clampedCreases(values: GVArray): {single: boolean, data: Float32Array} {
    const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
    const data = new Float32Array(values.size)
    for (let i = 0; i < values.size; i++) data[i] = clamp(values.get(i))
    return {single: values.isSingle, data}
}

/** `mesh_subsurf_calc` (:94): null when no `Subdiv` could be made. */
function meshSubsurfCalc(mesh: MeshData, level: number, quality: number, vertCrease: GField, edgeCrease: GField,
    boundarySmooth: number, uvSmooth: number, useLimitSurface: boolean): MeshData | null {
    const verts = clampedCreases(new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Point), mesh.vertsNum).evaluate(vertCrease))
    const edges = clampedCreases(new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Edge), mesh.edgesNum).evaluate(edgeCrease))
    // `varray_is_single_zero`.
    const singleZero = (c: {single: boolean, data: Float32Array}) => c.single && (c.data.length === 0 || c.data[0] === 0)
    const useCreases = !singleZero(verts) || !singleZero(edges)
    let input = mesh
    if (useCreases) {
        // The crease layers go on a copy of the input, as the `BKE_subdiv` API reads them from the mesh.
        input = mesh.clone()
        input.attributes.remove('crease_vert')
        input.attributes.add({name: 'crease_vert', domain: AttrDomain.Point, type: 'float', data: verts.data})
        input.attributes.remove('crease_edge')
        input.attributes.add({name: 'crease_edge', domain: AttrDomain.Edge, type: 'float', data: edges.data})
    }
    const settings: SubdivSettings = {
        isSimple: false,
        isAdaptive: useLimitSurface,
        useCreases,
        level: useLimitSurface ? quality : level,
        vtxBoundaryInterpolation: vtxBoundaryInterpolationFromSubsurf(boundarySmooth),
        fvarLinearInterpolation: fvarInterpolationFromUvSmooth(uvSmooth),
    }
    const subdiv = subdivNewFromMesh(settings, input)
    if (!subdiv) return null
    const result = subdivToMesh(subdiv, {resolution: (1 << level) + 1, useOptimalDisplay: false}, input)
    if (useCreases && result) {
        result.attributes.remove('crease_vert')
        result.attributes.remove('crease_edge')
    }
    // `geometry::debug_randomize_mesh_order` is off unless the debug option is set.
    return result ?? null
}

registerNodeType({
    idname: 'GeometryNodeSubdivisionSurface',
    label: 'Subdivision Surface',
    // `node_declare` (:16).
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.output('GEOMETRY', 'Mesh')
        b.input('INT', 'Level').default(1).min(0).max(6)
        b.input('FLOAT', 'Edge Crease').default(0).min(0).max(1).subtype('FACTOR').field()
        b.input('FLOAT', 'Vertex Crease').default(0).min(0).max(1).subtype('FACTOR').field()
        b.input('BOOLEAN', 'Limit Surface').default(true)
        b.input('INT', 'Quality').default(3).min(1).max(10)
        b.input('MENU', 'UV Smooth').default('Keep Boundaries')
        b.input('MENU', 'Boundary Smooth').default('All')
    },
    // `node_geo_exec` (:177).
    execute(p) {
        const geometry = p.geometry('Mesh')
        const vertCrease = p.field('Vertex Crease'), edgeCrease = p.field('Edge Crease')
        const uvName = p.string('UV Smooth'), boundaryName = p.string('Boundary Smooth')
        const uvSmooth = UV_SMOOTH[uvName], boundarySmooth = BOUNDARY_SMOOTH[boundaryName]
        if (uvSmooth === undefined) throw new Error(`Subdivision Surface: UV Smooth '${uvName}' is not a menu item`)
        if (boundarySmooth === undefined) throw new Error(`Subdivision Surface: Boundary Smooth '${boundaryName}' is not a menu item`)
        const level = Math.max(p.int('Level'), 0)
        const quality = Math.min(Math.max(p.int('Quality'), 1), 10)
        const useLimitSurface = p.bool('Limit Surface')
        if (level === 0) {
            p.set('Mesh', geometry)
            return
        }
        // `set_default_remaining_outputs()`: an empty geometry, with an error.
        if (level >= 16) {
            p.warn('The subdivision level is too large')
            p.set('Mesh', new GeometrySet())
            return
        }
        if (!useLimitSurface && level >= 11) {
            p.warn('Subdivision result mesh is too large for uniform subdivision')
            p.set('Mesh', new GeometrySet())
            return
        }
        let failed = false
        const out = foreachRealGeometry(geometry, g => {
            const mesh = g.mesh
            if (!mesh) return
            const result = meshSubsurfCalc(mesh, level, quality, vertCrease, edgeCrease, boundarySmooth, uvSmooth, useLimitSurface)
            if (result) g.setMesh(result)
            else failed = true
        }, p.options.scene)
        if (failed) p.warn('Subdivision failed for some geometry. Original mesh returned.')
        p.set('Mesh', out)
    },
})
