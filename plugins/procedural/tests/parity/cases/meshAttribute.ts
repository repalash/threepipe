/**
 * Parity cases for Capture Attribute, Set ID, Remove Named Attribute, Attribute Statistic, Material Index /
 * Set Material Index / Set Material (empty material), Instances to Points and Rotate Instances.
 *
 * Capture Attribute's items are dynamic (`capture_items`), which the DSL has no argument for: the node is built
 * with its fixed sockets, then its items, the links into `Value_<n>` and the sockets out of `Attribute_<n>` are
 * added to the tree by hand (`capture` below).
 */

import {AnySocket, n, Socket} from '../../../src/dsl/builder'
import type {NodeJSON, SocketType} from '../../../src/runtime/types'
import {attributed, Domain, Extra, meshCase, mod, SHAPE_SCENE, shape, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

/** Socket type → capture item (`socket_type` for `capture_items.new`, `data_type` as dumps record it). */
const ITEM_TYPES: Partial<Record<SocketType, [string, string]>> = {
    FLOAT: ['FLOAT', 'FLOAT'], INT: ['INT', 'INT'], BOOLEAN: ['BOOLEAN', 'BOOLEAN'], VECTOR: ['VECTOR', 'FLOAT_VECTOR'],
    RGBA: ['RGBA', 'FLOAT_COLOR'], ROTATION: ['ROTATION', 'QUATERNION'], MATRIX: ['MATRIX', 'FLOAT4X4'],
}

interface Captured {
    geometry: Socket<'GEOMETRY'>
    selection: Socket<'BOOLEAN'>
    values: AnySocket[]
}

/** A Capture Attribute node with one item per value (identifiers 0, 1, ...). */
function capture(geometry: Socket<'GEOMETRY'>, domain: Domain, values: AnySocket[], selection?: Socket<'BOOLEAN'>): Captured {
    const node = n.CaptureAttribute({geometry, domain, selection})
    const b = geometry.builder
    const json = b.tree.nodes.find(x => x.name === node.name) as NodeJSON
    json.items = {capture_items: values.map((v, i) => {
        const type: SocketType = v.type
        const [socket_type, data_type] = ITEM_TYPES[type]!
        return {name: `Item ${i}`, socket_type, data_type, identifier: i}
    })}
    const id = (base: string, i: number) => (i === 0 ? base : `${base}_${i}`)
    values.forEach((v, i) => b.tree.links.push({from: [v.node, v.identifier], to: [node.name, id('Value', i)]}))
    return {
        geometry: node.geometry,
        selection: node.selection,
        values: values.map((v, i) => new Socket(b, node.name, id('Attribute', i), v.type)),
    }
}

const STAT_KEYS = ['mean', 'median', 'sum', 'min', 'max', 'range', 'standardDeviation', 'variance'] as const

const index = () => n.Index().index
const idx = (k: number) => index().mul(k)

/** One value of every capture type, varying per element. */
function everyType(): AnySocket[] {
    const i = index()
    return [
        i.mul(0.5).add(0.25),
        mod(i, 5),
        mod(i, 3).eq(1),
        n.CombineXYZ({x: i, y: i.mul(-0.25), z: mod(i, 4)}).vector,
        n.CombineColor({red: i.mul(0.1), green: 0.5, blue: mod(i, 2), alpha: 1}).color,
        n.EulerToRotation({euler: n.CombineXYZ({x: i.mul(0.1), y: 0.2, z: i.mul(-0.05)}).vector}).rotation,
        n.CombineTransform({translation: n.CombineXYZ({x: i, y: 1, z: 2}).vector, scale: n.CombineXYZ({x: 1, y: i.add(1), z: 1}).vector}).transform,
    ]
}

function storeAll(g: Socket<'GEOMETRY'>, domain: Domain, prefix: string, values: AnySocket[]): Socket<'GEOMETRY'> {
    values.forEach((v, i) => { g = store(g, domain, `${prefix}${i}`, v) })
    return g
}

/** Instances with an instance attribute, id, rotation and non-uniform scale (shear after Scale Instances). */
function instances(): Socket<'GEOMETRY'> {
    const points = n.MeshLine({count: 5, offset: [1.5, 0.25, -0.5]}).mesh
    let inst = n.InstanceOnPoints({
        points, instance: n.MeshCube({size: 0.5}).mesh,
        rotation: n.EulerToRotation({euler: n.CombineXYZ({x: idx(0.3), y: 0.4, z: idx(-0.7)}).vector}).rotation,
        scale: n.CombineXYZ({x: index().add(1), y: 0.5, z: 1.25}).vector,
    }).instances
    inst = n.ScaleInstances({instances: inst, scale: [1, 2, 0.5], localSpace: false}).instances
    return store(inst, 'INSTANCE', 'iw', idx(2).sub(1))
}

export function meshAttributeCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))

    // region Capture Attribute
    for (const domain of ['POINT', 'EDGE', 'FACE', 'CORNER'] as const) {
        add(`capture-${domain.toLowerCase()}-every-type`, `Capture Attribute on ${domain}: one item of every type, read on every domain after Set Position`, SHAPE_SCENE, () => {
            const c = capture(testMeshes(), domain, everyType())
            let g: Socket<'GEOMETRY'> = n.SetPosition({geometry: c.geometry, offset: n.CombineXYZ({z: idx(0.1)}).vector}).geometry
            for (const d of ['POINT', 'EDGE', 'FACE', 'CORNER'] as const) {
                // A matrix read from points on edges is `mix2` = `math::interpolate(float4x4)`: see capture-point-matrix-on-edge.
                const values = domain === 'POINT' && d === 'EDGE' ? c.values.slice(0, 6) : c.values
                g = storeAll(g, d, `${d[0].toLowerCase()}`, values)
            }
            return g
        })
    }
    add('capture-point-matrix-on-edge', 'A matrix captured on points read on edges (mix2 of float4x4 = polar decomposition, math_matrix.cc:336)', {}, () => {
        const c = capture(n.MeshGrid({verticesX: 3, verticesY: 2}).mesh, 'POINT', [everyType()[6]])
        return storeAll(c.geometry, 'EDGE', 'm', c.values)
    })
    add('capture-selection', 'Capture Attribute with a selection field and the Selection output, then faces deleted', SHAPE_SCENE, () => {
        const sel = mod(index(), 3).eq(0).not()
        const c = capture(attributed(testMeshes()), 'FACE', [index().mul(1.5), n.Position().position], sel)
        const kept = n.DeleteGeometry({geometry: c.geometry, domain: 'FACE', selection: mod(index(), 4).eq(1)}).geometry
        let g = storeAll(kept, 'FACE', 'f', [...c.values, c.selection])
        g = storeAll(g, 'POINT', 'p', [c.values[0], c.selection])
        return g
    })
    add('capture-position-before-move', 'Capture Position on points, move the points, store the captured position', {}, () => {
        const c = capture(n.MeshGrid({sizeX: 2, sizeY: 1, verticesX: 4, verticesY: 3}).mesh, 'POINT', [n.Position().position])
        const moved = n.SetPosition({geometry: c.geometry, offset: n.CombineXYZ({x: 0.3, z: idx(0.2)}).vector}).geometry
        return store(moved, 'POINT', 'before', c.values[0])
    })
    add('capture-instances', 'Capture Attribute on the instance domain (top level only), then realized', {}, () => {
        const c = capture(instances(), 'INSTANCE', [index().mul(3), n.Position().position])
        const g = storeAll(c.geometry, 'INSTANCE', 'i', c.values)
        return n.RealizeInstances({geometry: g}).geometry
    })
    add('capture-points-nested', 'Capture Attribute on points of a point cloud and of instanced meshes (foreach_real_geometry)', {}, () => {
        const pts = n.Points({count: 6, position: n.CombineXYZ({x: index(), y: 0.5, z: 0}).vector}).geometry
        const joined = n.JoinGeometry({geometry: [pts, instances()]}).geometry
        const c = capture(joined, 'POINT', [index().mul(2).add(1)])
        const g = store(c.geometry, 'POINT', 'cap', c.values[0])
        return n.RealizeInstances({geometry: g}).geometry
    })
    add('capture-no-items-unused', 'Capture Attribute whose outputs are unused passes the geometry through', {}, () => {
        const c = capture(n.MeshCube().mesh, 'POINT', [index()])
        return c.geometry
    })
    // endregion

    // region Set ID
    add('set-id', 'Set ID on mesh, point cloud and instances (top level only) with a selection, then realized (id-based hashing)', {}, () => {
        const pts = n.Points({count: 7, position: n.CombineXYZ({x: index(), y: 0, z: 1}).vector}).geometry
        const joined = n.JoinGeometry({geometry: [n.MeshGrid({verticesX: 3, verticesY: 3}).mesh, pts, instances()]}).geometry
        const withId = n.SetID({geometry: joined, iD: mod(index().mul(7), 5).add(100), selection: mod(index(), 4).eq(2).not()}).geometry
        const g = store(withId, 'POINT', 'readId', n.ID().iD)
        return n.RealizeInstances({geometry: g}).geometry
    })
    add('set-id-default', 'Set ID with the implicit index on a mesh', {}, () => n.SetID({geometry: n.MeshCube({verticesX: 3}).mesh}).geometry)
    // endregion

    // region Remove Named Attribute
    for (const [mode, name] of [['Exact', 'pf'], ['Wildcard', 'c*'], ['Wildcard', '*i'], ['Wildcard', 'e*b'], ['Exact', 'position'], ['Wildcard', 'a**'], ['Exact', 'missing']] as const) {
        const id = `remove-attribute-${mode.toLowerCase()}-${name.replace(/\*/g, 'x')}`
        add(id, `Remove Named Attribute ${mode} '${name}' on a mesh and on instanced geometry`, SHAPE_SCENE, () => {
            const mesh = attributed(shape())
            const inst = n.InstanceOnPoints({points: n.MeshLine({count: 2}).mesh, instance: mesh}).instances
            const joined = n.JoinGeometry({geometry: [mesh, store(inst, 'INSTANCE', 'ix', index())]}).geometry
            return n.RemoveNamedAttribute({geometry: joined, patternMode: mode, name}).geometry
        })
    }
    add('remove-attribute-object-instance', 'Remove Named Attribute turns an object instance reference into geometry (ensure_geometry_instances)', SHAPE_SCENE, () =>
        n.RemoveNamedAttribute({geometry: n.ObjectInfo({object: {_ref: 'OBJECT', name: 'Shape'}, asInstance: true}).geometry, name: 'nothing'}).geometry)
    // endregion

    // region Attribute Statistic
    const big = () => n.MeshGrid({sizeX: 4, sizeY: 3, verticesX: 41, verticesY: 31}).mesh
    const wiggle = (k: number) => n.Math({operation: 'MODULO', value: idx(0.731).add(k), value1: 1.37}).value.sub(0.5)
    for (const [dataType, domain] of [['FLOAT', 'POINT'], ['FLOAT', 'FACE'], ['FLOAT', 'EDGE'], ['FLOAT', 'CORNER'],
        ['FLOAT_VECTOR', 'POINT'], ['FLOAT_VECTOR', 'FACE'], ['FLOAT', 'INSTANCE'], ['FLOAT_VECTOR', 'INSTANCE']] as const) {
        add(`statistic-${dataType.toLowerCase()}-${domain.toLowerCase()}`, `Attribute Statistic ${dataType} on ${domain} (more than 1024 values, a selection)`, {}, () => {
            const value: AnySocket = dataType === 'FLOAT' ? wiggle(0) : n.CombineXYZ({x: wiggle(0), y: wiggle(0.3), z: index().mul(-0.01)}).vector
            const geometry: Socket<'GEOMETRY'> = domain === 'INSTANCE'
                ? n.InstanceOnPoints({points: big(), instance: n.MeshCube().mesh}).instances
                : n.JoinGeometry({geometry: [big(), n.Points({count: 9, position: n.CombineXYZ({x: index()}).vector}).geometry]}).geometry
            const st = n.AttributeStatistic({geometry, dataType, domain, attribute: value, selection: mod(index(), 7).eq(3).not()})
            let pt: Socket<'GEOMETRY'> = n.Points({count: 1}).geometry
            for (const out of STAT_KEYS) pt = store(pt, 'POINT', out, st[out])
            return pt
        })
    }
    add('statistic-small', 'Attribute Statistic of 1, 2, 3 and 0 selected values (median of even counts, variance of one value)', {}, () => {
        let pt: Socket<'GEOMETRY'> = n.Points({count: 1}).geometry
        for (const k of [1, 2, 3, 0]) {
            const st = n.AttributeStatistic({geometry: n.Points({count: 3, position: n.CombineXYZ({x: idx(0.37).add(0.1)}).vector}).geometry,
                attribute: n.Position().position.x, selection: index().lt(k)})
            for (const out of STAT_KEYS) pt = store(pt, 'POINT', `${out}${k}`, st[out])
        }
        return pt
    })
    // endregion

    // region Material Index
    add('material-index', 'Set Material Index with a field and a selection, read with Material Index on every domain', SHAPE_SCENE, () => {
        const g = n.SetMaterialIndex({geometry: testMeshes(), materialIndex: mod(index(), 4).sub(1), selection: mod(index(), 3).eq(1).not()}).geometry
        let out = g
        for (const d of ['POINT', 'EDGE', 'FACE', 'CORNER'] as const) out = store(out, d, `mi_${d.toLowerCase()}`, n.MaterialIndex().materialIndex)
        return out
    })
    add('set-material-empty', 'Set Material with no material: all faces, a selection, and a mesh without faces', SHAPE_SCENE, () => {
        const a = n.SetMaterial({geometry: n.MeshCube().mesh}).geometry
        const b = n.SetMaterial({geometry: n.MeshGrid({verticesX: 4, verticesY: 3}).mesh, selection: mod(index(), 2).eq(0)}).geometry
        const c = n.SetMaterial({geometry: n.MeshLine({count: 3}).mesh}).geometry
        return n.JoinGeometry({geometry: [a, b, c]}).geometry
    })
    // endregion

    // region Instances to Points / Rotate Instances
    add('instances-to-points', 'Instances to Points with a selection, radius field and instance attributes (id, float)', {}, () => {
        const inst = n.SetID({geometry: instances(), iD: idx(10)}).geometry
        return n.InstancesToPoints({instances: inst, selection: mod(index(), 3).eq(1).not(), radius: idx(0.1)}).points
    })
    add('instances-to-points-keep', 'Instances to Points: an existing point cloud is replaced; mesh dropped; position field', {}, () => {
        const joined = n.JoinGeometry({geometry: [n.Points({count: 2}).geometry, n.MeshCube().mesh, instances()]}).geometry
        return n.InstancesToPoints({instances: joined, position: n.Position().position.scale(2), radius: 0.2}).points
    })
    add('instances-to-points-empty-selection', 'Instances to Points with nothing selected keeps the input point cloud', {}, () => {
        const joined = n.JoinGeometry({geometry: [n.Points({count: 2, position: [1, 2, 3]}).geometry, instances()]}).geometry
        return n.InstancesToPoints({instances: joined, selection: false}).points
    })
    for (const local of [true, false] as const) {
        add(`rotate-instances-${local ? 'local' : 'global'}`, `Rotate Instances (${local ? 'local' : 'global'} space) with rotation and pivot fields`, {}, () =>
            n.RotateInstances({
                instances: instances(),
                rotation: n.EulerToRotation({euler: n.CombineXYZ({x: idx(0.25), y: -0.6, z: 1.1}).vector}).rotation,
                pivotPoint: n.CombineXYZ({x: 0.5, y: idx(-0.3), z: 0.2}).vector,
                localSpace: local, selection: mod(index(), 5).eq(3).not(),
            }).instances)
    }
    add('rotate-instances-local-field', 'Rotate Instances with a per-instance Local Space field', {}, () =>
        n.RotateInstances({instances: instances(), rotation: n.EulerToRotation({euler: [0.3, 0.2, -0.4]}).rotation, localSpace: mod(index(), 2).eq(0)}).instances)
    // endregion
    return cases
}
