/**
 * Points (`node_geo_points.cc`) and Join Geometry (`node_geo_join_geometry.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext} from '../../fields/context'
import {FieldEvaluation, evaluateConstantField} from '../../fields/evaluate'
import {GeometrySet} from '../../geometry/GeometrySet'
import {PointCloud} from '../../geometry/components'
import {joinGeometries} from '../../geometry/joinGeometries'
import {registerNodeType} from '../../runtime/registry'
import {SocketValue} from '../../runtime/values'

registerNodeType({
    idname: 'GeometryNodePoints',
    label: 'Points',
    declare(b) {
        b.input('INT', 'Count').default(1).min(0)
        b.input('VECTOR', 'Position').default([0, 0, 0]).subtype('TRANSLATION').field()
        b.input('FLOAT', 'Radius').default(0.1).min(0).subtype('DISTANCE').field()
        b.output('GEOMETRY', 'Points', 'Geometry')
    },
    // `node_geo_exec` (:37).
    execute(p) {
        const count = p.int('Count')
        if (count <= 0) return
        const position = p.field('Position')
        const radius = p.field('Radius')
        const pc = new PointCloud(count)
        const ev = new FieldEvaluation(FieldContext.forSize(count), count)
        pc.positions.set(ev.evaluate(position).materialize())
        const r = pc.attributes.add({name: 'radius', domain: AttrDomain.Point, type: 'float'})
        if (radius.dependsOnInput) r.data.set(ev.evaluate(radius).materialize())
        else r.data.fill(evaluateConstantField(radius)[0])
        p.set('Geometry', GeometrySet.fromPointCloud(pc))
    },
})

registerNodeType({
    idname: 'GeometryNodeJoinGeometry',
    label: 'Join Geometry',
    declare(b) {
        b.input('GEOMETRY', 'Geometry').multiInput()
        b.output('GEOMETRY', 'Geometry')
    },
    // `node_geo_exec` (:22): `join_geometries` of all inputs in link order.
    execute(p) {
        const geometries = p.getMulti('Geometry').filter((g: SocketValue): g is GeometrySet => g instanceof GeometrySet)
        p.set('Geometry', joinGeometries(geometries, {scene: p.options.scene}))
    },
})
