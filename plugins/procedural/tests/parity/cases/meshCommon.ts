/**
 * Shared builders for the mesh-node parity cases (`mesh*.ts`). Test meshes come from primitives that are
 * already bit-exact against Blender and from an object `Shape` that `run_cases.py` creates with
 * `from_pydata` (read with Object Info, so both sides evaluate the exact mesh Blender built): triangles,
 * a non-planar quad, a pentagon, an edge with three faces, a loose edge and a loose vertex.
 */

import {AnySocket, geometryNodes, GroupBuilder, n, Socket} from '../../../src/dsl/builder'
import type {StoreNamedAttributeArgs} from '../../../src/dsl/nodes.generated'
import type {NodeGroupLibrary, SocketType} from '../../../src/runtime/types'
import {CaseObject, ParityCase} from './types'
import {ATTRIBUTE_TYPE} from './functionCommon'

export type Extra = Omit<ParityCase, 'id' | 'description' | 'library' | 'group' | 'input'>

/**
 * Islands: {0..6} quads 0-1-2-3 and 1-4-5-2 (non-planar) with the triangle 1-2-6 on their shared edge 1-2;
 * {7..11} a slightly non-planar pentagon and a triangle; {12, 13} a loose edge; {14} a loose vertex.
 */
export const SHAPE: CaseObject = {
    name: 'Shape',
    mesh: {
        positions: [
            0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0.3, 2, 1, -0.2, 0.5, 0.5, 1,
            3, 0, 0, 4, 0.2, 0, 4.5, 1, 0.05, 3.5, 1.6, 0, 2.8, 0.9, 0.02,
            6, 0, 0, 7, 0.5, 0, 8, 8, 8,
        ],
        faces: [[0, 1, 2, 3], [1, 4, 5, 2], [1, 2, 6], [7, 8, 9, 10, 11], [7, 11, 10]],
        edges: [[12, 13]],
    },
}

export const SHAPE_SCENE: Extra = {objects: [SHAPE]}

export function shape(): Socket<'GEOMETRY'> {
    return n.ObjectInfo({object: {_ref: 'OBJECT', name: 'Shape'}}).geometry
}

const mod = (a: Socket<'FLOAT' | 'INT'>, b: number) => n.Math({operation: 'MODULO', value: a, value1: b}).value

/** Index-derived float, int and vector attributes on every mesh domain (`p*`, `e*`, `f*`, `c*`). */
export function attributed(geometry: Socket<'GEOMETRY'>): Socket<'GEOMETRY'> {
    let g = geometry
    for (const [domain, p] of [['POINT', 'p'], ['EDGE', 'e'], ['FACE', 'f'], ['CORNER', 'c']] as const) {
        const i = n.Index().index
        g = n.StoreNamedAttribute({geometry: g, domain, name: `${p}f`, value: i.mul(1.5).add(0.25)}).geometry
        g = n.StoreNamedAttribute({geometry: g, domain, dataType: 'INT', name: `${p}i`, value: mod(i, 7)}).geometry
        g = n.StoreNamedAttribute({geometry: g, domain, dataType: 'FLOAT_VECTOR', name: `${p}v`,
            value: n.CombineXYZ({x: i, y: i.mul(-0.5), z: mod(i, 3)}).vector}).geometry
        g = n.StoreNamedAttribute({geometry: g, domain, dataType: 'BOOLEAN', name: `${p}b`, value: mod(i, 3).eq(1)}).geometry
    }
    return g
}

/** The shape, a 3x2x2 cube, a 5x4 grid with every third face deleted (ONLY_FACE) and a 4-point line, joined. */
export function testMeshes(): Socket<'GEOMETRY'> {
    const grid = n.DeleteGeometry({
        geometry: n.MeshGrid({sizeX: 2, sizeY: 1.5, verticesX: 5, verticesY: 4}).mesh, domain: 'FACE', mode: 'ONLY_FACE',
        selection: mod(n.Index().index, 3).eq(0),
    }).geometry
    const cube = n.TransformGeometry({geometry: n.MeshCube({size: [1, 0.8, 1.2], verticesX: 3, verticesY: 2, verticesZ: 2}).mesh, translation: [0, 4, 0]}).geometry
    const line = n.MeshLine({count: 4, startLocation: [0, -3, 0], offset: [0.7, 0.1, 0.2]}).mesh
    return n.JoinGeometry({geometry: [shape(), cube, grid, line]}).geometry
}

export type Domain = NonNullable<StoreNamedAttributeArgs['domain']>

/** Store a field on `domain` under `name`, with an attribute type matching the socket type. */
export function store(geometry: Socket<'GEOMETRY'>, domain: Domain, name: string, value: AnySocket): Socket<'GEOMETRY'> {
    const type: SocketType = value.type
    const dataType = ATTRIBUTE_TYPE[type] as StoreNamedAttributeArgs['dataType']
    if (!dataType) throw new Error(`store ${name}: no attribute type for ${value.type}`)
    return n.StoreNamedAttribute({geometry, domain, dataType, name, value}).geometry
}

/** A case whose output geometry is what `build` returns. */
export function meshCase(id: string, description: string, extra: Extra, build: (g: GroupBuilder) => Socket<'GEOMETRY'>): ParityCase {
    const group = geometryNodes(id, g => {
        g.output.geometry('Geometry', build(g))
    })
    return {id, description, library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty', ...extra}
}

export {mod}
