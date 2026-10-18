/**
 * Parity cases for geometry operations (Separate/Delete Geometry, Transform, Set Position, primitives),
 * written with the DSL.
 */

import {geometryNodes, n, Socket} from '../../../src/dsl/builder'
import type {NodeGroupLibrary} from '../../../src/runtime/types'
import {ParityCase} from './types'

function single(id: string, description: string, build: () => Socket<'GEOMETRY'>): ParityCase {
    const group = geometryNodes(id, g => {
        g.output.geometry('Geometry', build())
    })
    return {id, description, library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty'}
}

const mod = (a: Socket<'FLOAT' | 'INT'>, b: number) => n.Math({operation: 'MODULO', value: a, value1: b}).value

/** A 4x5 grid with an attribute on every domain, so gathers of each domain are checked. */
function attributedGrid(): Socket<'GEOMETRY'> {
    let g: Socket<'GEOMETRY'> = n.MeshGrid({sizeX: 3, sizeY: 2, verticesX: 4, verticesY: 5}).mesh
    for (const [domain, name] of [['POINT', 'pa'], ['EDGE', 'ea'], ['FACE', 'fa'], ['CORNER', 'ca']] as const) {
        g = n.StoreNamedAttribute({geometry: g, domain, name, value: n.Index().index.mul(1.5).add(0.25)}).geometry
    }
    return g
}

export function geometryCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const domain of ['POINT', 'EDGE', 'FACE'] as const) {
        for (const mode of ['ALL', 'EDGE_FACE', 'ONLY_FACE'] as const) {
            cases.push(single(`delete-${domain.toLowerCase()}-${mode.toLowerCase()}`, `Delete Geometry ${domain} ${mode}`, () =>
                n.DeleteGeometry({geometry: attributedGrid(), domain, mode, selection: mod(n.Index().index, 3).eq(1)}).geometry))
        }
        cases.push(single(`separate-${domain.toLowerCase()}-inverted`, `Separate Geometry ${domain}, inverted output`, () =>
            n.SeparateGeometry({geometry: attributedGrid(), domain, selection: mod(n.Index().index, 4).lt(2)}).inverted))
    }
    cases.push(single('delete-all-selected', 'Delete everything (single true selection)', () =>
        n.DeleteGeometry({geometry: attributedGrid(), selection: true}).geometry))
    cases.push(single('separate-points-cloud', 'Separate a point cloud and keep instances', () =>
        n.SeparateGeometry({
            geometry: n.JoinGeometry({geometry: [
                n.Points({count: 9, position: n.Index().index.mul(0.5)}).geometry,
                n.InstanceOnPoints({points: n.MeshLine({count: 3}).mesh, instance: n.MeshCube().mesh}).instances,
            ]}).geometry,
            selection: mod(n.Index().index, 2).eq(0),
        }).selection))
    cases.push(single('delete-instances', 'Delete Geometry on the instance domain', () =>
        n.DeleteGeometry({
            geometry: n.InstanceOnPoints({points: n.MeshLine({count: 6}).mesh, instance: n.MeshCube().mesh, scale: n.Index().index.add(1)}).instances,
            domain: 'INSTANCE', selection: mod(n.Index().index, 3).eq(0),
        }).geometry))
    cases.push(single('cube-variants', 'Cube primitives: 3D, planes and a line, joined', () =>
        n.JoinGeometry({geometry: [
            n.MeshCube({size: [1.3, 0.7, 2.1], verticesX: 4, verticesY: 3, verticesZ: 5}).mesh,
            n.MeshCube({size: [1, 2, 3], verticesX: 3, verticesY: 1, verticesZ: 4}).mesh,
            n.MeshCube({size: [1, 2, 3], verticesX: 1, verticesY: 3, verticesZ: 2}).mesh,
            n.MeshCube({size: [1, 2, 3], verticesX: 1, verticesY: 1, verticesZ: 6}).mesh,
        ]}).geometry))
    cases.push(single('mesh-line-modes', 'Mesh Line: end points by count and by resolution', () =>
        n.JoinGeometry({geometry: [
            n.MeshLine({mode: 'END_POINTS', count: 7, startLocation: [-1, 0.5, 0.2], offset: [2.3, -1.1, 0.7]}).mesh,
            n.MeshLine({mode: 'END_POINTS', countMode: 'RESOLUTION', resolution: 0.37, startLocation: [0.1, 0.2, 0.3], offset: [1.9, 2.2, -0.4]}).mesh,
        ]}).geometry))
    cases.push(single('transform-set-position', 'Transform (components and matrix) then Set Position with an offset field', () =>
        n.SetPosition({
            geometry: n.TransformGeometry({geometry: attributedGrid(), translation: [0.3, -0.2, 1.1], rotation: [0.4, -0.7, 1.3], scale: [1.2, 0.8, 1.7]}).geometry,
            offset: n.Position().position.scale(0.1), selection: mod(n.Index().index, 2).eq(0),
        }).geometry))
    for (const mode of ['VERTICES', 'EDGES', 'FACES', 'CORNERS'] as const) {
        cases.push(single(`mesh-to-points-${mode.toLowerCase()}`, `Mesh to Points ${mode} with attributes, radius field`, () =>
            n.MeshToPoints({mesh: attributedGrid(), mode, selection: mod(n.Index().index, 3).lt(2), radius: n.Index().index.mul(0.01).sub(0.05)}).points))
    }
    cases.push(single('points-to-vertices', 'Points to Vertices with a selection and a point attribute', () =>
        n.PointsToVertices({
            points: n.StoreNamedAttribute({geometry: n.Points({count: 7, position: n.Index().index.mul(0.3)}).geometry, name: 'w', value: n.Index().index.mul(2)}).geometry,
            selection: n.Index().index.gt(2),
        }).mesh))
    cases.push(single('shade-smooth', 'Set Shade Smooth on faces (field) and edges (constant), read back', () => {
        const g = n.SetShadeSmooth({
            geometry: n.SetShadeSmooth({geometry: attributedGrid(), shadeSmooth: mod(n.Index().index, 2).eq(0)}).geometry,
            domain: 'EDGE', selection: n.Index().index.lt(5), shadeSmooth: false,
        }).geometry
        return n.StoreNamedAttribute({
            geometry: n.StoreNamedAttribute({geometry: g, dataType: 'BOOLEAN', domain: 'FACE', name: 'fs', value: n.IsFaceSmooth().smooth}).geometry,
            dataType: 'BOOLEAN', domain: 'EDGE', name: 'es', value: n.IsEdgeSmooth().smooth,
        }).geometry
    }))
    cases.push(single('geometry-to-instance', 'Geometry to Instance of three inputs, two equal cubes from separate nodes', () => {
        // Two Cube nodes: one output can feed a multi-input only once.
        return n.GeometryToInstance({geometry: [n.MeshCube().mesh, n.MeshLine({count: 3}).mesh, n.MeshCube().mesh]}).instances
    }))
    return cases
}
