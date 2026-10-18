/**
 * Component conversion nodes: Mesh to Points (`node_geo_mesh_to_points.cc`), Points to Vertices
 * (`node_geo_points_to_vertices.cc`), Geometry to Instance (`node_geo_geometry_to_instance.cc`).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {elementwise, FieldContext, FieldEvaluation, FieldOperation, GField} from '../../fields'
import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import {GeometrySet} from '../../geometry/GeometrySet'
import {Instances, PointCloud} from '../../geometry/components'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {GVArray} from '../../geometry/varray'
import {AttributeAccessor} from '../../geometry/attributeAccessor'
import {registerNodeType} from '../../runtime/registry'
import {newMeshData} from '../../geometry/components'

/** "max(float, float)" (`multi_function_common.cc:288`): `std::max(a, b)`. */
const maxFloat = elementwise('max(float, float)', ['float', 'float'], ['float'], ([a, b], [o]) => { o[0] = a[0] < b[0] ? b[0] : a[0] })

/** Copy every allowed source attribute (read on `domain`) to the destination, gathering `selection`. */
function copyAttributes(src: AttributeAccessor, dst: AttributeAccessor, domain: AttrDomain | undefined, selection: number[],
    skip: readonly string[], rename: Record<string, string>): void {
    for (const name of src.names()) {
        if (src.isBuiltin(name) && !dst.isBuiltin(name)) continue
        if (skip.includes(name)) continue
        const meta = src.lookupMeta(name)!
        const varray = src.lookup(name, domain)
        if (!varray) continue
        const dstName = rename[name] ?? name
        const type = meta.type as DataType
        if (varray.isSingle) {
            dst.add(dstName, AttrDomain.Point, type, varray.single)
            continue
        }
        const c = DATA_TYPES[type].components
        const data = new DATA_TYPES[type].array(selection.length * c)
        selection.forEach((s, d) => { for (let k = 0; k < c; k++) data[d * c + k] = varray.get(s, k) })
        if (dst.contains(dstName)) dst.layerForWrite(dstName)!.data.set(data)
        else dst.add(dstName, AttrDomain.Point, type, data)
    }
}

function selected(sel: GVArray, size: number): number[] {
    const out: number[] = []
    for (let i = 0; i < size; i++) if (sel.get(i, 0)) out.push(i)
    return out
}

const MODE_DOMAINS: Record<string, AttrDomain> = {VERTICES: AttrDomain.Point, EDGES: AttrDomain.Edge, FACES: AttrDomain.Face, CORNERS: AttrDomain.Corner}

/** `geometry_set_mesh_to_points` (:46). */
function meshToPoints(g: GeometrySet, position: GField, radius: GField, selection: GField, domain: AttrDomain): void {
    const mesh = g.mesh
    const clear = () => { for (const t of ['mesh', 'pointcloud', 'curves', 'instances'] as const) g.remove(t) }
    if (!mesh) return clear()
    const size = mesh.attributes.domainSizes[domain]
    if (size === 0) return clear()
    const e = new FieldEvaluation(new FieldContext('mesh', mesh, domain), size)
    const sel = selected(e.evaluate(selection), size)
    const positions = e.evaluate(position)
    const radii = e.evaluate(radius)
    const pc = new PointCloud(sel.length)
    const pos = pc.positions
    sel.forEach((s, d) => { for (let k = 0; k < 3; k++) pos[d * 3 + k] = positions.get(s, k) })
    const dst = pc.accessor()
    if (radii.isSingle) dst.add('radius', AttrDomain.Point, 'float', radii.single)
    else {
        const r = new Float32Array(sel.length)
        sel.forEach((s, d) => { r[d] = radii.get(s, 0) })
        dst.add('radius', AttrDomain.Point, 'float', r)
    }
    copyAttributes(g.attributes('mesh')!, dst, domain, sel, ['position', 'radius', '.select_edge', '.select_poly'], {'.select_vert': '.selection'})
    clear()
    g.setPointCloud(pc)
}

registerNodeType({
    idname: 'GeometryNodeMeshToPoints',
    label: 'Mesh to Points',
    properties: {mode: 'VERTICES'},
    enums: {mode: ['VERTICES', 'EDGES', 'FACES', 'CORNERS']},
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('VECTOR', 'Position').implicit('POSITION').field()
        b.input('FLOAT', 'Radius').default(0.05).min(0).subtype('DISTANCE').field()
        b.output('GEOMETRY', 'Points')
    },
    // `node_geo_exec` (:138).
    execute(p) {
        const position = p.field('Position')
        const radius = new FieldOperation(maxFloat, [p.field('Radius'), GField.constant('float', [0])]).output(0)
        const selection = p.field('Selection')
        const domain = MODE_DOMAINS[p.node.prop<string>('mode')]
        p.set('Points', foreachRealGeometry(p.geometry('Mesh'), g => meshToPoints(g, position, radius, selection, domain), p.options.scene))
    },
})

registerNodeType({
    idname: 'GeometryNodePointsToVertices',
    label: 'Points to Vertices',
    declare(b) {
        b.input('GEOMETRY', 'Points')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.output('GEOMETRY', 'Mesh')
    },
    // `geometry_set_points_to_vertices` (:28).
    execute(p) {
        const selection = p.field('Selection')
        p.set('Mesh', foreachRealGeometry(p.geometry('Points'), g => {
            const points = g.pointCloud
            const clear = () => { for (const t of ['mesh', 'pointcloud', 'curves', 'instances'] as const) g.remove(t) }
            if (!points || points.pointsNum === 0) return clear()
            const sel = selected(new FieldEvaluation(new FieldContext('pointcloud', points, AttrDomain.Point), points.pointsNum).evaluate(selection), points.pointsNum)
            // `mesh_new_no_attributes(selection.size(), 0, 0, 0)`.
            const mesh = newMeshData()
            for (const l of mesh.attributes.layers()) if (l.domain === AttrDomain.Point) mesh.attributes.remove(l.name)
            mesh.resize({verts: sel.length})
            copyAttributes(g.attributes('pointcloud')!, g.attributes('mesh') ?? meshAccessorOf(mesh), undefined, sel, [], {'.selection': '.select_vert'})
            clear()
            g.setMesh(mesh)
        }, p.options.scene))
    },
})

function meshAccessorOf(mesh: MeshData): AttributeAccessor {
    return GeometrySet.fromMesh(mesh).attributes('mesh')!
}

registerNodeType({
    idname: 'GeometryNodeGeometryToInstance',
    label: 'Geometry to Instance',
    declare(b) {
        b.input('GEOMETRY', 'Geometry').multiInput()
        b.output('GEOMETRY', 'Instances')
    },
    // `node_geo_exec` (:20).
    execute(p) {
        const geometries = p.getMulti('Geometry') as GeometrySet[]
        const inst = new Instances(geometries.length)
        geometries.forEach((g, i) => { inst.referenceHandles[i] = inst.addReference({type: 'geometry', geometry: g}) })
        const t = inst.transforms
        for (let i = 0; i < geometries.length; i++) {
            t.fill(0, i * 16, i * 16 + 16)
            t[i * 16] = t[i * 16 + 5] = t[i * 16 + 10] = t[i * 16 + 15] = 1
        }
        p.set('Instances', GeometrySet.fromInstances(inst))
    },
})
