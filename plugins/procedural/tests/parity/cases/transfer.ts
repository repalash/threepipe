/**
 * Parity cases for Transfer Attributes: by index (source shorter and longer than the target, existing target
 * attributes of the same and of another domain or type), by ID fields (first source element per ID, unmatched
 * targets keep or default), exclude mode, exact and wildcard patterns, built-ins, and the Transferred Names list.
 */

import {AnySocket, n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const str = (s: string) => n.String({string: s}).string
const names = (spec: string) => n.SplitString({string: str(spec), separator: str(',')}).list

/** The target with the transferred names' count and each name (up to `k`) stored as an attribute named after it. */
function withNames(g: Socket<'GEOMETRY'>, list: AnySocket, k: number): Socket<'GEOMETRY'> {
    let out = store(g, 'POINT', 'transferred', n.ListLength({dataType: 'STRING', list}).length)
    for (let i = 0; i < k; i++) {
        const name = n.GetListItem({socketType: 'STRING', list, index: i}).value as Socket<'STRING'>
        out = n.StoreNamedAttribute({geometry: out, name: n.JoinStrings({delimiter: str(''), strings: [str('n_'), name]}).string, value: i + 1}).geometry
    }
    return out
}

export function transferCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))

    add('transfer-by-index', 'By index from a larger and a smaller source; existing matching and mismatching target attributes', () => {
        let target = n.MeshGrid({verticesX: 4, verticesY: 3}).mesh
        target = store(target, 'POINT', 'pf', index().mul(-1))
        target = store(target, 'FACE', 'pi', mod(index(), 2).mul(9))
        const big = n.TransferAttributes({target, source: attributed(testMeshes()), attributeNames: names('p*,ef,position')})
        const small = n.TransferAttributes({target: big.target, source: store(n.MeshLine({count: 5}).mesh, 'POINT', 'only', index().add(100)),
            attributeNames: names('only')})
        return withNames(small.target, big.transferredNames, 4)
    })
    add('transfer-by-id', 'By ID: point IDs in reverse with duplicates, unmatched target points; face IDs; exact pattern mode', () => {
        const source = store(attributed(n.MeshGrid({verticesX: 4, verticesY: 3}).mesh), 'POINT', 'sid', mod(index().mul(-1).add(20), 7))
        let target = n.MeshGrid({verticesX: 3, verticesY: 3}).mesh
        target = store(target, 'POINT', 'pv', n.CombineXYZ({x: -1}).vector)
        const t = n.TransferAttributes({target, source, patternMode: 'Exact', attributeNames: names('pf,pv,fi'),
            sourcePointID: n.NamedAttribute({dataType: 'INT', name: 'sid'}).attribute as Socket<'INT'>, targetPointID: index(),
            sourceFaceID: index().mul(2), targetFaceID: index()})
        return withNames(t.target, t.transferredNames, 3)
    })
    add('transfer-exclude', 'Exclude mode: everything but the matching names, onto a point cloud and instances', () => {
        const pts = n.MeshToPoints({mesh: n.MeshGrid({verticesX: 3, verticesY: 2}).mesh}).points
        const srcPts = store(store(n.MeshToPoints({mesh: n.MeshLine({count: 8}).mesh}).points, 'POINT', 'a', index()), 'POINT', 'b', index().mul(0.5))
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 3}).mesh, instance: n.MeshCube().mesh}).instances
        const srcInst = store(n.InstanceOnPoints({points: n.MeshLine({count: 2}).mesh, instance: n.MeshCone().mesh}).instances, 'INSTANCE', 'k', index().add(7))
        const t = n.TransferAttributes({target: n.JoinGeometry({geometry: [pts, inst]}).geometry, source: n.JoinGeometry({geometry: [srcPts, srcInst]}).geometry,
            attributeNames: names('b'), excludeNames: true})
        return withNames(t.target, t.transferredNames, 5)
    })
    add('transfer-instance-attribute-order', 'Instance attribute order from creators writing transforms first (Split to Instances, its Delete Geometry gather, partial Realize Instances)', () => {
        const target = n.JoinGeometry({geometry: [n.MeshToPoints({mesh: n.MeshLine({count: 2}).mesh}).points,
            n.InstanceOnPoints({points: n.MeshLine({count: 3}).mesh, instance: n.MeshCube().mesh}).instances]}).geometry
        const split = n.SplitToInstances({geometry: n.MeshGrid({verticesX: 4, verticesY: 3}).mesh, domain: 'FACE', groupID: mod(index(), 3)}).instances
        const deleted = n.DeleteGeometry({geometry: split, domain: 'INSTANCE', selection: n.Compare({dataType: 'INT', operation: 'EQUAL', a: index(), b: 0}).result}).geometry
        const nested = n.GeometryToInstance({geometry: [n.InstanceOnPoints({points: n.MeshLine({count: 2}).mesh, instance: n.MeshCone().mesh}).instances]}).instances
        const partial = n.RealizeInstances({geometry: nested, realizeAll: false, depth: 0}).geometry
        let out = target
        const lists: AnySocket[] = []
        for (const src of [split, deleted, partial]) {
            const t = n.TransferAttributes({target: out, source: store(src, 'INSTANCE', 'k', index().add(3)), attributeNames: names('zzz'), excludeNames: true})
            out = t.target
            lists.push(t.transferredNames)
        }
        lists.forEach((list, j) => {
            for (let i = 0; i < 3; i++) {
                const name = n.GetListItem({socketType: 'STRING', list, index: i}).value as Socket<'STRING'>
                out = n.StoreNamedAttribute({geometry: out, name: n.JoinStrings({delimiter: str(''), strings: [str(`s${j}_`), name]}).string, value: i + 1}).geometry
            }
        })
        return out
    })
    return cases
}
