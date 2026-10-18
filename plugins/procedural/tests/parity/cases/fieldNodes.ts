/**
 * Parity cases for the field utility nodes: Evaluate on Domain / at Index (every value type, out-of-range indices),
 * Domain Size (every component), Accumulate Field (every type and output, grouped or not, across domains) and the field
 * statistics (Field Average, Min & Max, Variance; odd and even group sizes for the median).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, Domain, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const DOMAINS = ['POINT', 'EDGE', 'FACE', 'CORNER'] as const

/** A value of each type, varying per element. */
function values() {
    const i = index()
    // FRACT (floorf) rather than a libm function, so differences are the nodes' own.
    const x = n.Math({operation: 'FRACT', value: i.mul(1.37)}).value
    return {
        FLOAT: x,
        INT: n.IntegerMath({operation: 'MULTIPLY', value: i, value1: 3}).value,
        BOOLEAN: mod(i, 3).eq(1),
        FLOAT_VECTOR: n.CombineXYZ({x, y: i.mul(0.25), z: n.Position().position.z}).vector,
        FLOAT_COLOR: n.CombineColor({red: x, green: 0.5, blue: i.mul(0.1)}).color,
        QUATERNION: n.EulerToRotation({euler: n.CombineXYZ({x, y: 0.3, z: i.mul(0.2)}).vector}).rotation,
        FLOAT4X4: n.CombineTransform({translation: n.Position().position, scale: [1, 2, 0.5]}).transform,
    }
}

export function fieldNodeCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))

    for (const domain of DOMAINS) {
        add(`evaluate-on-${domain.toLowerCase()}`, `Evaluate on Domain ${domain}, read on every domain, every type`, () => {
            let g = attributed(testMeshes())
            const vs = values()
            for (const [type, value] of Object.entries(vs)) {
                const e = n.EvaluateOnDomain({domain, dataType: type as never, value} as never).outputs.value
                // Matrices are read on their own domain only: adapting them mixes with math::interpolate(float4x4)
                // (Eigen SVD, not ported - see capture-point-matrix-on-edge).
                for (const d of type === 'FLOAT4X4' ? [domain] : DOMAINS) g = store(g, d as Domain, `${type.toLowerCase()}_${d.toLowerCase()}`, e)
            }
            return g
        })
        add(`evaluate-at-index-${domain.toLowerCase()}`, `Evaluate at Index from ${domain}: shifted indices, out of range at the ends`, () => {
            let g = attributed(testMeshes())
            const vs = values()
            for (const [type, value] of Object.entries(vs)) {
                const e = n.EvaluateAtIndex({domain, dataType: type as never, value, index: n.IntegerMath({operation: 'SUBTRACT', value: index().mul(2), value1: 3}).value} as never).outputs.value
                g = store(g, 'POINT', `${type.toLowerCase()}_p`, e)
                g = store(g, 'FACE', `${type.toLowerCase()}_f`, e)
            }
            return g
        })
    }
    add('domain-size', 'Domain Size of every component (mesh, point cloud, curve, instances)', () => {
        const mesh = testMeshes()
        const cloud = n.MeshToPoints({mesh: n.MeshGrid({verticesX: 3, verticesY: 4}).mesh}).points
        const curve = n.CurveCircle({resolution: 6}).curve
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 5}).mesh, instance: curve}).instances
        const all = n.JoinGeometry({geometry: [mesh, cloud, curve, inst]}).geometry
        const m = n.DomainSize({component: 'MESH', geometry: all})
        const p = n.DomainSize({component: 'POINTCLOUD', geometry: all})
        const c = n.DomainSize({component: 'CURVE', geometry: all})
        const i = n.DomainSize({component: 'INSTANCES', geometry: all})
        const empty = n.DomainSize({component: 'CURVE', geometry: n.MeshLine().mesh})
        let g = n.MeshLine({count: 1}).mesh
        const counts = [m.pointCount, m.edgeCount, m.faceCount, m.faceCornerCount, p.pointCount, c.pointCount, c.splineCount, i.instanceCount, empty.pointCount]
        counts.forEach((s, k) => { g = store(g, 'POINT', `c${k}`, s) })
        return g
    })
    for (const dataType of ['FLOAT', 'INT', 'FLOAT_VECTOR', 'TRANSFORM'] as const) {
        for (const grouped of [false, true]) {
            add(`accumulate-${dataType.toLowerCase()}${grouped ? '-grouped' : ''}`, `Accumulate Field ${dataType} on faces, read on points${grouped ? ', grouped by index % 3' : ''}`, () => {
                const vs = values()
                const value = dataType === 'TRANSFORM' ? vs.FLOAT4X4 : vs[dataType]
                const a = n.AccumulateField({dataType, domain: 'FACE', value, ...(grouped ? {groupIndex: mod(index(), 3)} : {})} as never) as any
                let g = attributed(testMeshes())
                for (const [k, s] of [['lead', a.leading], ['trail', a.trailing], ['total', a.total]] as const) {
                    g = store(g, 'POINT', `${k}_p`, s)
                    g = store(g, 'FACE', `${k}_f`, s)
                }
                return g
            })
        }
    }
    for (const [node, types, outs] of [['FieldAverage', ['FLOAT', 'FLOAT_VECTOR'], ['mean', 'median']], ['FieldMinMax', ['FLOAT', 'INT', 'FLOAT_VECTOR'], ['min', 'max']],
        ['FieldVariance', ['FLOAT', 'FLOAT_VECTOR'], ['standardDeviation', 'variance']]] as const) {
        for (const dataType of types) {
            for (const grouped of [false, true]) {
                add(`${node.toLowerCase()}-${dataType.toLowerCase()}${grouped ? '-grouped' : ''}`, `${node} ${dataType} on points${grouped ? ', two groups (index % 5 < 2)' : ''}`, () => {
                    const vs = values()
                    const s = (n as any)[node]({dataType, domain: 'POINT', value: vs[dataType as 'FLOAT'], ...(grouped ? {groupIndex: mod(index(), 5).lt(2)} : {})})
                    let g = attributed(testMeshes())
                    for (const o of outs) {
                        g = store(g, 'POINT', `${o}_p`, s[o])
                        g = store(g, 'EDGE', `${o}_e`, s[o])
                    }
                    return g
                })
            }
        }
    }
    return cases
}
