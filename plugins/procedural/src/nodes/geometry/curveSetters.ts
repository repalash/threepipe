/**
 * The curve attribute setters: Set Curve Radius (`node_geo_set_curve_radius.cc`), Set Curve Tilt
 * (`node_geo_set_curve_tilt.cc`), Set Spline Resolution (`node_geo_set_spline_resolution.cc`) and Set Spline Cyclic
 * (`node_geo_set_spline_cyclic.cc`). Each captures its field into a built-in curves attribute with the selection
 * (`try_capture_field_on_geometry`) on every real geometry (`foreach_real_geometry`), instanced ones included.
 * Grease pencil is not a component here.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {captureFieldsOnGeometry} from '../../fields'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {registerNodeType} from '../../runtime/registry'
import type {SocketType} from '../../runtime/types'

interface Setter {
    idname: string
    label: string
    /** The geometry socket's name and identifier (`"Curve"`, or `"Curve"` / `"Geometry"`). */
    geometry: [string, string]
    value: {name: string, type: SocketType, default?: number | boolean, min?: number, subtype?: string}
    attribute: string
    domain: AttrDomain
}

const SETTERS: Setter[] = [
    // :14-31: Radius min 0, default 0.005, DISTANCE.
    {idname: 'GeometryNodeSetCurveRadius', label: 'Set Curve Radius', geometry: ['Curve', 'Curve'],
        value: {name: 'Radius', type: 'FLOAT', default: 0.005, min: 0, subtype: 'DISTANCE'}, attribute: 'radius', domain: AttrDomain.Point},
    // :18-26: Tilt, ANGLE.
    {idname: 'GeometryNodeSetCurveTilt', label: 'Set Curve Tilt', geometry: ['Curve', 'Curve'],
        value: {name: 'Tilt', type: 'FLOAT', subtype: 'ANGLE'}, attribute: 'tilt', domain: AttrDomain.Point},
    // :18-28: Resolution min 1, default 12.
    {idname: 'GeometryNodeSetSplineResolution', label: 'Set Spline Resolution', geometry: ['Curve', 'Geometry'],
        value: {name: 'Resolution', type: 'INT', default: 12, min: 1}, attribute: 'resolution', domain: AttrDomain.Curve},
    // :18-28.
    {idname: 'GeometryNodeSetSplineCyclic', label: 'Set Spline Cyclic', geometry: ['Curve', 'Geometry'],
        value: {name: 'Cyclic', type: 'BOOLEAN'}, attribute: 'cyclic', domain: AttrDomain.Curve},
]

for (const s of SETTERS) {
    registerNodeType({
        idname: s.idname,
        label: s.label,
        declare(b) {
            b.input('GEOMETRY', s.geometry[0], s.geometry[1])
            b.output('GEOMETRY', s.geometry[0], s.geometry[1])
            b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
            const v = b.input(s.value.type, s.value.name).field()
            if (s.value.default !== undefined) v.default(s.value.default)
            if (s.value.min !== undefined) v.min(s.value.min)
            if (s.value.subtype) v.subtype(s.value.subtype)
        },
        execute(p) {
            const geometry = p.geometry(s.geometry[1])
            const selection = p.field('Selection')
            const value = p.field(s.value.name)
            const out = foreachRealGeometry(geometry, g => {
                if (g.curves) captureFieldsOnGeometry(g, 'curves', [s.attribute], s.domain, selection, [value])
            }, p.options.scene)
            p.set(s.geometry[1], out)
        },
    })
}
