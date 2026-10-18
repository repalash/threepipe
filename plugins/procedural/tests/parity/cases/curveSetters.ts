/**
 * Parity cases for Set Curve Radius / Tilt, Set Spline Resolution / Cyclic: fields with selections on bezier, poly and
 * circle curves, read back through Curve to Mesh (radius and tilt shape the sweep, resolution and cyclic the
 * evaluated points) and on instanced curves (`foreach_real_geometry`).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {meshCase} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

function curves(): Socket<'GEOMETRY'> {
    const circle = n.CurveCircle({resolution: 7, radius: 1.5})
    const bezier = n.BezierSegment({resolution: 5, start: [-2, 0, 0], startHandle: [-1, 2, 0.5], endHandle: [1, -2, 0], end: [2, 0, 1]})
    const line = n.CurveLine({start: [0, -3, 0], end: [1, -2, 2]})
    return n.JoinGeometry({geometry: [circle.curve, bezier.curve, line.curve]}).geometry
}

export function curveSetterCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, {}, build))
    const odd = () => n.Math({operation: 'MODULO', value: index(), value1: 2}).value.eq(1)

    add('set-radius-tilt', 'Radius and tilt fields with selections, on the curves themselves', () => {
        const r = n.SetCurveRadius({curve: curves(), radius: index().mul(0.1).add(0.05), selection: odd()})
        return n.SetCurveTilt({curve: r.curve, tilt: index().mul(0.3)}).curve
    })
    add('set-radius-tilt-sweep', 'Radius and tilt shape Curve to Mesh with a profile', () => {
        const r = n.SetCurveRadius({curve: curves(), radius: index().mul(0.1).add(0.2)})
        const t = n.SetCurveTilt({curve: r.curve, tilt: index().mul(0.4), selection: odd()})
        return n.CurveToMesh({curve: t.curve, profileCurve: n.CurveCircle({resolution: 4, radius: 0.2}).curve}).mesh
    })
    add('set-resolution-cyclic', 'Resolution and cyclic per curve, read back by Curve to Mesh', () => {
        const res = n.SetSplineResolution({geometry: curves(), resolution: index().mul(3).add(1), selection: index().lt(2)})
        const cyc = n.SetSplineCyclic({geometry: res.geometry, cyclic: index().gt(0)})
        return n.CurveToMesh({curve: cyc.geometry}).mesh
    })
    add('set-on-instances', 'Setters reach curves inside instances; realized afterwards', () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 2, offset: [5, 0, 0]}).mesh, instance: curves()})
        const r = n.SetCurveRadius({curve: inst.instances, radius: 0.3})
        const res = n.SetSplineResolution({geometry: r.curve, resolution: 3})
        return n.RealizeInstances({geometry: res.geometry}).geometry
    })
    return cases
}
