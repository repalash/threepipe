/**
 * Parity cases for the For Each Geometry Element zone: every iteration domain, several components at once (body
 * order), selections, input items evaluated on the domain, main items stored on the input geometry (unselected
 * elements value-initialised), generated geometries joined with fields captured on them and the input geometry's
 * attributes propagated, the Element geometry of each domain, and anonymous attributes made inside the body.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

export function zonesForeachCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: Parameters<typeof meshCase>[3]) => cases.push(meshCase(id, description, SHAPE_SCENE, build))

    add('foreach-points-main', 'Points of a mesh and a point cloud: main items from input items, every third point unselected', g => {
        const mesh = n.MeshGrid({verticesX: 4, verticesY: 3}).mesh
        const pts = n.MeshToPoints({mesh: n.MeshLine({count: 5, offset: [0, 0, 0.5]}).mesh}).points
        const zone = g.forEachElement({geometry: n.JoinGeometry({geometry: [pts, mesh]}).geometry, selection: mod(index(), 3).eq(2).not(),
            inputs: {pos: n.Position().position, id: index().mul(2)}})
        const out = zone.output({main: {
            len: zone.input.pos.length().mul(zone.index),
            vec: n.VectorMath({operation: 'SCALE', vector: zone.input.pos, scale: zone.input.id}).vector,
            flag: zone.index.gt(4),
        }})
        let geo = store(out.geometry, 'POINT', 'len', out.main.len)
        geo = store(geo, 'POINT', 'vec', out.main.vec)
        return store(geo, 'POINT', 'flag', out.main.flag)
    })
    add('foreach-faces-generate', 'A cube per selected face at its center, sized by index; fields captured; face attributes propagated', g => {
        const grid = attributed(n.MeshGrid({sizeX: 3, sizeY: 2, verticesX: 4, verticesY: 3}).mesh)
        const zone = g.forEachElement({geometry: grid, domain: 'FACE', selection: mod(index(), 2).eq(0), inputs: {center: n.Position().position}})
        const cube = n.TransformGeometry({geometry: n.MeshCube({size: [0.2, 0.2, 0.2]}).mesh, translation: zone.input.center,
            scale: n.CombineXYZ({x: 1, y: 1, z: zone.index.add(1)}).vector}).geometry
        const out = zone.output({generated: [{geometry: cube, fields: {twice: zone.index.mul(2), local: {value: index(), domain: 'FACE'}}}]})
        const geo = store(out.generated[0].geometry, 'POINT', 'twice', out.generated[0].fields.twice)
        return store(geo, 'FACE', 'local', out.generated[0].fields.local)
    })
    add('foreach-element-mesh', 'Element geometry of points, edges and faces of attributed meshes, moved per index and joined', g => {
        const parts: Socket<'GEOMETRY'>[] = []
        for (const domain of ['POINT', 'EDGE', 'FACE']) {
            const zone = g.forEachElement({geometry: attributed(testMeshes()), domain, selection: mod(index(), 4).eq(1)})
            const moved = n.SetPosition({geometry: zone.element, offset: n.CombineXYZ({z: zone.index.mul(0.1)}).vector}).geometry
            parts.push(zone.output({generated: [{geometry: moved}]}).generated[0].geometry)
        }
        return n.JoinGeometry({geometry: parts}).geometry
    })
    add('foreach-curves-instances', 'Element curves (curve and point domains) and instances; corner domain with main items only', g => {
        const curves = n.JoinGeometry({geometry: [n.CurveCircle({resolution: 5}).curve, n.CurveLine().curve]}).geometry
        const c = store(curves, 'POINT', 'pi', index())
        const byCurve = g.forEachElement({geometry: c, domain: 'CURVE'})
        const a = byCurve.output({generated: [{geometry: n.ResampleCurve({curve: byCurve.element, count: byCurve.index.add(3)}).curve}]}).generated[0].geometry
        const byPoint = g.forEachElement({geometry: c, domain: 'POINT', selection: mod(index(), 2).eq(0)})
        const b = byPoint.output({generated: [{geometry: byPoint.element}]}).generated[0].geometry
        const inst = store(n.InstanceOnPoints({points: n.MeshLine({count: 3}).mesh, instance: n.MeshCube({size: [0.1, 0.1, 0.1]}).mesh}).instances, 'INSTANCE', 'ii', index())
        const byInst = g.forEachElement({geometry: inst, domain: 'INSTANCE'})
        const d = byInst.output({generated: [{geometry: n.TranslateInstances({instances: byInst.element, translation: [0, 0, 1]}).instances,
            fields: {k: {value: byInst.index, domain: 'INSTANCE'}}}]}).generated[0]
        const dd = store(d.geometry, 'INSTANCE', 'k', d.fields.k)
        const corners = g.forEachElement({geometry: testMeshes(), domain: 'CORNER', inputs: {v: index()}})
        const cc = corners.output({main: {v: corners.input.v.mul(3)}})
        const ccc = store(cc.geometry, 'CORNER', 'v3', cc.main.v)
        return n.JoinGeometry({geometry: [a, b, dd, ccc]}).geometry
    })
    add('foreach-anonymous', 'Captures inside the body (anonymous attributes per element), empty generated geometry, no elements', g => {
        const zone = g.forEachElement({geometry: n.MeshGrid({verticesX: 3, verticesY: 2}).mesh, domain: 'FACE'})
        const line = n.MeshLine({count: zone.index.add(2), offset: [0.1, 0, 0]}).mesh
        const withIdx = store(line, 'POINT', 'body', zone.index)
        const out = zone.output({generated: [{geometry: withIdx}, {name: 'Empty'}]})
        const none = g.forEachElement({geometry: n.MeshLine({count: 0}).mesh})
        const noneOut = none.output({main: {x: none.index}, generated: [{geometry: n.MeshCube().mesh}]})
        return n.JoinGeometry({geometry: [out.generated[0].geometry, out.generated[1].geometry, noneOut.geometry, noneOut.generated[0].geometry]}).geometry
    })
    return cases
}
