/**
 * Parity cases for the topology nodes: Corners of Face / Vertex / Edge, Edges of Vertex (unsorted, sorted by weights
 * with ties, negative and large sort indices, out-of-range element indices), Edges / Face / Vertex of Corner, Offset
 * Corner in Face, and Points of Curve, Curve of Point, Offset Point in Curve on cyclic and open curves.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {Domain, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const int = (v: Socket<'INT'> | Socket<'FLOAT'>, k: number) => n.IntegerMath({operation: 'ADD', value: v as Socket<'INT'>, value1: k}).value

export function topologyCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))
    // Weights with ties (x rounded to 0.5) so the stable sort's order matters.
    const weights = () => n.Math({operation: 'ROUND', value: n.Position().position.x.mul(2)}).value

    for (const [node, key, domain] of [['CornersOfFace', 'faceIndex', 'FACE'], ['CornersOfVertex', 'vertexIndex', 'POINT'],
        ['CornersOfEdge', 'edgeIndex', 'EDGE'], ['EdgesOfVertex', 'vertexIndex', 'POINT']] as const) {
        add(`topology-${node.toLowerCase()}`, `${node}: default order, sorted by tied weights, sort indices -1 / 2 / 7, shifted element indices`, () => {
            let g = testMeshes()
            const N = (n as any)[node]
            const out = node === 'EdgesOfVertex' ? 'edgeIndex' : 'cornerIndex'
            const plain = N({})
            const sorted = N({weights: weights(), sortIndex: -1})
            const sorted2 = N({weights: weights(), sortIndex: 2})
            const shifted = N({[key]: int(index(), -2), sortIndex: 7})
            for (const [k, s] of [['plain', plain[out]], ['total', plain.total], ['sorted', sorted[out]], ['sorted2', sorted2[out]],
                ['shifted', shifted[out]], ['shifted_total', shifted.total]] as const) {
                g = store(g, domain as Domain, k, s)
                if (domain !== 'POINT') g = store(g, 'POINT', `${k}_p`, s)
            }
            return g
        })
    }
    add('topology-corner-maps', 'Edges / Face / Vertex of Corner and Offset Corner in Face, read on corners and faces', () => {
        let g = testMeshes()
        const e = n.EdgesOfCorner({})
        const f = n.FaceOfCorner({})
        const v = n.VertexOfCorner({cornerIndex: int(index(), 3)})
        const o = n.OffsetCornerInFace({offset: n.IntegerMath({operation: 'SUBTRACT', value: mod(index(), 5), value1: 2}).value})
        const far = n.OffsetCornerInFace({cornerIndex: int(index(), 1000), offset: 1})
        for (const [k, s] of [['next', e.nextEdgeIndex], ['prev', e.previousEdgeIndex], ['face', f.faceIndex], ['in_face', f.indexInFace],
            ['vert', v.vertexIndex], ['offset', o.cornerIndex], ['far', far.cornerIndex]] as const) {
            g = store(g, 'CORNER', k, s)
            g = store(g, 'FACE', `${k}_f`, s)
        }
        return g
    })
    add('topology-curves', 'Points of Curve, Curve of Point, Offset Point in Curve on cyclic and open curves', () => {
        const circle = n.CurveCircle({resolution: 6})
        const bezier = n.BezierSegment({resolution: 4, start: [-2, 0, 0], end: [2, 0, 1]})
        const line = n.CurveLine({start: [0, -3, 0], end: [1, -2, 2]})
        let g: Socket<'GEOMETRY'> = n.JoinGeometry({geometry: [circle.curve, bezier.curve, line.curve]}).geometry
        const pts = n.PointsOfCurve({})
        const sorted = n.PointsOfCurve({weights: n.Position().position.y, sortIndex: -2})
        const cop = n.CurveOfPoint({})
        const off = n.OffsetPointInCurve({offset: n.IntegerMath({operation: 'SUBTRACT', value: mod(index(), 4), value1: 2}).value})
        const far = n.OffsetPointInCurve({pointIndex: int(index(), 50), offset: -3})
        for (const [k, s, d] of [['first', pts.pointIndex, 'CURVE'], ['total', pts.total, 'CURVE'], ['sorted', sorted.pointIndex, 'CURVE'],
            ['first_p', pts.pointIndex, 'POINT'], ['curve', cop.curveIndex, 'POINT'], ['in_curve', cop.indexInCurve, 'POINT'],
            ['off', off.pointIndex, 'POINT'], ['valid', off.isValidOffset, 'POINT'], ['far', far.pointIndex, 'POINT'], ['far_valid', far.isValidOffset, 'POINT']] as const) {
            g = n.StoreNamedAttribute({geometry: g, domain: d, dataType: s.type === 'BOOLEAN' ? 'BOOLEAN' : 'INT', name: k, value: s}).geometry
        }
        return g
    })
    return cases
}
