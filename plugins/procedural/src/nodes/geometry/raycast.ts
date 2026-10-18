/**
 * Raycast (`GeometryNodeRaycast`) - `nodes/geometry/nodes/node_geo_raycast.cc` (declaration :43-108, init :115,
 * `raycast_to_mesh` :137, `RaycastFunction` :203, exec :250-375, RNA :377).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {BVHTreeRayHit} from '../../blender/kdopbvh'
import {DATA_TYPES} from '../../geometry/dataTypes'
import {lookupMultiFunction, MultiFunction} from '../../fields'
import {meshBVHCornerTris, meshCornerTris, trisRayCastCallback} from '../../geometry/meshBVH'
import {registerNodeType} from '../../runtime/registry'
import {applyFunction} from '../util'
import {socketTypeFromRNA} from '../attributeTypes'
import {baryWeightFromPositionFn, baryWeightSampleFn, lazyComponentValues, SOCKET_ATTRIBUTE_TYPES, valueInitialize} from './sample'

/** `RaycastFunction` (:203) over `raycast_to_mesh` (:137): `Mesh::bvh_corner_tris()`, rays from 0 to `Ray Length`. */
function raycastFunction(mesh: MeshData): MultiFunction {
    return {
        name: 'Raycast', inputs: ['float3', 'float3', 'float'], outputs: ['bool', 'float3', 'float3', 'float', 'int32'],
        call(n, [origins, directions, lengths], [isHit, hitPos, hitNormal, hitDist, triIndex]) {
            const data = meshBVHCornerTris(mesh)
            // :149: no tree (no triangles), outputs stay as initialised.
            if (!data.tree) return
            const callback = trisRayCastCallback(mesh)
            for (let i = 0; i < n; i++) {
                const length = lengths.get(i)
                const origin = [origins.get(i, 0), origins.get(i, 1), origins.get(i, 2)]
                const dir = [directions.get(i, 0), directions.get(i, 1), directions.get(i, 2)]
                const hit: BVHTreeRayHit = {index: -1, co: [0, 0, 0], no: [0, 0, 0], dist: length}
                if (data.tree.rayCast(origin, dir, 0, hit, callback) !== -1) {
                    isHit[i] = hit.index >= 0 ? 1 : 0
                    triIndex[i] = hit.index
                    hitPos.set(hit.co, i * 3)
                    hitNormal.set(hit.no, i * 3)
                    hitDist[i] = hit.dist
                } else {
                    isHit[i] = 0
                    triIndex[i] = -1
                    hitPos.set([0, 0, 0], i * 3)
                    hitNormal.set([0, 0, 0], i * 3)
                    hitDist[i] = length
                }
            }
        },
    }
}

/** `NearestCornerFromPositionFn::call` (`mesh_sample.cc:454`), `sample_nearest_corner<true>` (:193). */
function nearestCornerFromPositionFn(mesh: MeshData): MultiFunction {
    return {
        name: 'Nearest Corner from Position', inputs: ['float3', 'int32'], outputs: ['int32'],
        call(n, [positions, tris], [out]) {
            const ct = meshCornerTris(mesh), cv = mesh.cornerVerts, p = mesh.positions
            for (let i = 0; i < n; i++) {
                const t = tris.get(i)
                if (t === -1) {
                    out[i] = -1
                    continue
                }
                const x = positions.get(i, 0), y = positions.get(i, 1), z = positions.get(i, 2)
                // `math::distance_squared` in float, then `std::min_element` (the first smallest).
                let best = 0, bestDist = Infinity
                for (let k = 0; k < 3; k++) {
                    const v = cv[ct[t * 3 + k]] * 3
                    const dx = Math.fround(x - p[v]), dy = Math.fround(y - p[v + 1]), dz = Math.fround(z - p[v + 2])
                    const d = Math.fround(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy)) + Math.fround(dz * dz))
                    if (k === 0 || d < bestDist) {
                        best = k
                        bestDist = d
                    }
                }
                out[i] = ct[t * 3 + best]
            }
        },
    }
}

registerNodeType({
    idname: 'GeometryNodeRaycast',
    label: 'Raycast',
    // `node_init` (:115): CD_PROP_FLOAT.
    properties: {data_type: 'FLOAT'},
    enums: {data_type: SOCKET_ATTRIBUTE_TYPES},
    declare(b, node) {
        const type = socketTypeFromRNA(node.prop<string>('data_type'))
        b.input('GEOMETRY', 'Target Geometry')
        b.input(type, 'Attribute').hideValue().field()
        b.input('MENU', 'Interpolation').default('Interpolated')
        b.input('VECTOR', 'Source Position').implicit('POSITION')
        b.input('VECTOR', 'Ray Direction').default([0, 0, -1])
        b.input('FLOAT', 'Ray Length').default(100).min(0).subtype('DISTANCE')
        b.output('BOOLEAN', 'Is Hit')
        b.output('VECTOR', 'Hit Position')
        b.output('VECTOR', 'Hit Normal')
        b.output('FLOAT', 'Hit Distance')
        b.output(type, 'Attribute')
    },
    execute(p) {
        const target = p.geometry('Target Geometry')
        const mapping = p.string('Interpolation')
        // :255-269: no target mesh gives the defaults; a mesh without faces is an error.
        const mesh = target.mesh
        if (!mesh) return
        if (mesh.facesNum === 0) {
            p.warn('The target mesh must have faces')
            return
        }
        const [direction] = applyFunction(lookupMultiFunction('normalize(float3)'), [p.field('Ray Direction')])
        const [isHit, hitPosition, hitNormal, hitDistance, triangle] = applyFunction(raycastFunction(mesh),
            [p.field('Source Position'), direction, p.field('Ray Length')])
        p.set('Is Hit', isHit)
        p.set('Hit Position', hitPosition)
        p.set('Hit Normal', hitNormal)
        p.set('Hit Distance', hitDistance)
        if (!p.outputUsed('Attribute')) return
        const field = p.field('Attribute')
        if (mapping === 'Nearest') {
            // :349: the nearest corner of the hit triangle, then `SampleIndexFunction` on corners (value-initialised
            // out of range, `geometry_fields.cc:713`).
            const [corner] = applyFunction(nearestCornerFromPositionFn(mesh), [hitPosition, triangle])
            const dt = field.type, c = DATA_TYPES[dt].components
            const values = lazyComponentValues(target, 'mesh', AttrDomain.Corner, field)
            const sampleFn: MultiFunction = {
                name: 'Sample Index', inputs: ['int32'], outputs: [dt],
                call(n, [index], [out]) {
                    const src = values()
                    for (let e = 0; e < n; e++) {
                        const i = index.get(e)
                        if (i >= 0 && i < src.size) for (let k = 0; k < c; k++) out[e * c + k] = src.get(i, k)
                        else valueInitialize(out, e, c)
                    }
                },
            }
            p.set('Attribute', applyFunction(sampleFn, [corner])[0])
            return
        }
        const [bary] = applyFunction(baryWeightFromPositionFn(mesh), [hitPosition, triangle])
        p.set('Attribute', applyFunction(baryWeightSampleFn(mesh, field), [triangle, bary])[0])
    },
})
