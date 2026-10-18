/**
 * Small geometry operations: Flip Faces (`node_geo_flip_faces.cc`, `bke::mesh_flip_faces`, `mesh_flip_faces.cc`),
 * Separate Components (`node_geo_separate_components.cc`), Set Point Radius (`node_geo_set_point_radius.cc`) and Set
 * Instance Transform (`node_geo_set_instance_transform.cc`).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {captureFieldsOnGeometry, FieldContext, FieldEvaluation} from '../../fields'
import {DATA_TYPES} from '../../geometry/dataTypes'
import {GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {meshTagFaceWindingChanged} from '../../geometry/meshRuntime'
import {registerNodeType} from '../../runtime/registry'

/**
 * `bke::mesh_flip_faces` (`mesh_flip_faces.cc`): each selected face keeps its first corner and reverses the rest;
 * corner edges shift so each still follows its corner; every other non-string corner attribute is reversed the same
 * way (`flip_corner_data`: the face's range without its first corner).
 */
export function meshFlipFaces(mesh: MeshData, selection: ArrayLike<number>): void {
    if (mesh.facesNum === 0 || selection.length === 0) return
    const fo = mesh.faceOffsets, cv = mesh.cornerVerts, ce = mesh.cornerEdges
    for (const f of Array.from(selection)) {
        const start = fo[f], size = fo[f + 1] - start
        for (let j = 0; j < (size >> 1); j++) {
            const a = start + j + 1, b = start + size - 1 - j
            ;[cv[a], cv[b]] = [cv[b], cv[a]]
            ;[ce[a - 1], ce[b]] = [ce[b], ce[a - 1]]
        }
    }
    for (const layer of mesh.attributes.layers()) {
        if (layer.domain !== AttrDomain.Corner || layer.name === '.corner_vert' || layer.name === '.corner_edge') continue
        const c = DATA_TYPES[layer.type as keyof typeof DATA_TYPES]?.components ?? 1
        const data = layer.data
        for (const f of Array.from(selection)) {
            // `data.slice(faces[i].drop_front(1)).reverse()`.
            let lo = fo[f] + 1, hi = fo[f + 1] - 1
            while (lo < hi) {
                for (let k = 0; k < c; k++) {
                    const t = data[lo * c + k]
                    data[lo * c + k] = data[hi * c + k]
                    data[hi * c + k] = t
                }
                lo++
                hi--
            }
        }
    }
    meshTagFaceWindingChanged(mesh)
}

registerNodeType({
    idname: 'GeometryNodeFlipFaces',
    label: 'Flip Faces',
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.output('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
    },
    execute(p) {
        const selection = p.field('Selection')
        const out = foreachRealGeometry(p.geometry('Mesh'), g => {
            const mesh = g.meshForWrite()
            if (!mesh) return
            const values = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Face), mesh.facesNum).evaluate(selection)
            const faces: number[] = []
            for (let f = 0; f < mesh.facesNum; f++) if (values.get(f)) faces.push(f)
            meshFlipFaces(mesh, faces)
        }, p.options.scene)
        p.set('Mesh', out)
    },
})

registerNodeType({
    idname: 'GeometryNodeSeparateComponents',
    label: 'Separate Components',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Mesh')
        b.output('GEOMETRY', 'Curve')
        b.output('GEOMETRY', 'Grease Pencil')
        b.output('GEOMETRY', 'Point Cloud')
        b.output('GEOMETRY', 'Volume')
        b.output('GEOMETRY', 'Instances')
    },
    // Each output: the one component, the geometry's name (no grease pencil or volume components here).
    execute(p) {
        const g = p.get('Geometry') as GeometrySet
        const part = (type?: 'mesh' | 'curves' | 'pointcloud' | 'instances') => {
            const out = new GeometrySet()
            out.name = g.name
            if (type && g.has(type)) out.setShared(type, g)
            return out
        }
        p.set('Mesh', part('mesh'))
        p.set('Curve', part('curves'))
        p.set('Grease Pencil', part())
        p.set('Point Cloud', part('pointcloud'))
        p.set('Volume', part())
        p.set('Instances', part('instances'))
    },
})

registerNodeType({
    idname: 'GeometryNodeSetPointRadius',
    label: 'Set Point Radius',
    declare(b) {
        b.input('GEOMETRY', 'Points')
        b.output('GEOMETRY', 'Points')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('FLOAT', 'Radius').default(0.05).min(0).subtype('DISTANCE').field()
    },
    execute(p) {
        const selection = p.field('Selection'), radius = p.field('Radius')
        const out = foreachRealGeometry(p.geometry('Points'), g => {
            if (g.pointCloud) captureFieldsOnGeometry(g, 'pointcloud', ['radius'], AttrDomain.Point, selection, [radius])
        }, p.options.scene)
        p.set('Points', out)
    },
})

registerNodeType({
    idname: 'GeometryNodeSetInstanceTransform',
    label: 'Set Instance Transform',
    declare(b) {
        b.input('GEOMETRY', 'Instances')
        b.output('GEOMETRY', 'Instances')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('MATRIX', 'Transform').implicit('INSTANCE_TRANSFORM').field()
    },
    // The top-level instances only.
    execute(p) {
        const g = p.geometry('Instances')
        if (g.instances) captureFieldsOnGeometry(g, 'instances', ['instance_transform'], AttrDomain.Instance, p.field('Selection'), [p.field('Transform')])
        p.set('Instances', g)
    },
})
