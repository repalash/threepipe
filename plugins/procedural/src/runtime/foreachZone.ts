/**
 * The For Each Geometry Element zone (`nodes/intern/geometry_nodes_foreach_geometry_element_zone.cc`, Blender 5.2.2):
 * the zone body runs once per selected element of the iteration domain, on every component of the input geometry
 * that has the domain. Each run sees the element's index, its own small geometry (Element) and the input items'
 * values at the element. The main items become attributes of the input geometry on the iteration domain; each
 * generation group (a geometry and the fields after it) joins the geometries of all runs, with the input geometry's
 * attributes at each element propagated onto them and the fields captured.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {AttributeFieldInput, FieldContext, FieldEvaluation, GField} from '../fields'
import {captureFieldsOnGeometry} from '../fields/capture'
import {evaluateConstantField} from '../fields/evaluate'
import {DATA_TYPES, DataType} from '../geometry/dataTypes'
import {
    extractCurves, extractCurvesPoints, extractInstances, extractMeshEdges, extractMeshFaces, extractMeshVertices, extractPointcloudPoints,
} from '../geometry/extractElements'
import {ComponentType, GeometrySet} from '../geometry/GeometrySet'
import {foreachRealGeometry, joinGeometries} from '../geometry/joinGeometries'
import {domainFromRNA} from '../nodes/attributeTypes'
import type {EvalOptions} from './context'
import {socketDataType} from './declaration'
import type {CNode, Dep, NodeCache, Zone, ZoneItem} from './evaluator'
import type {SocketValue} from './values'

export interface ForeachHost {
    options: EvalOptions
    /** An input of the zone's input node, read outside the zone (recorded on the zone output's cache). */
    readOutside(zone: Zone, identifier: string, deps: Dep[]): SocketValue
    /** An input of the zone output node, read inside the running body. */
    readBody(n: CNode, identifier: string): SocketValue
    /** A new pass: every node re-checks its inputs against the current body's values. */
    nextPass(): void
    anonymousName(n: CNode, identifier: string, deps: Dep[]): string
    warn(n: CNode, message: string): void
}

/** `GeometrySet::get_components()` order (`GeometryComponent::Type`: Mesh, PointCloud, Instance, Volume, Curve, ...). */
const COMPONENT_ORDER: ComponentType[] = ['mesh', 'pointcloud', 'instances', 'curves']

/** `get_foreach_attribute_propagation_target_domain` (:827). */
const PROPAGATION_DOMAIN: Record<ComponentType, AttrDomain> = {
    mesh: AttrDomain.Point, pointcloud: AttrDomain.Point, curves: AttrDomain.Curve, instances: AttrDomain.Instance,
}

interface ComponentRun {
    type: ComponentType
    /** Selected element indices (`get_evaluated_selection_as_mask`). */
    mask: number[]
    /** Index of the first body of this component. */
    firstBody: number
    /** Input item values per item, per selected element. */
    items: GVArrayLike[]
    elements?: GeometrySet[]
}

interface GVArrayLike {
    get(i: number, k?: number): number
}

/** `CPPType::value_initialize`: zeros (also for quaternions and matrices, whose defaulted constructors value-initialise). */
const zeros = (type: DataType) => new Array<number>(DATA_TYPES[type].components).fill(0)

/** `SocketValueVariant::convert_to_single` (`node_socket_value.cc:469`): a field's constant value, zeros when it depends on context. */
function toSingle(v: SocketValue, type: DataType): readonly number[] {
    if (!(v instanceof GField)) return zeros(type)
    if (v.dependsOnInput) return zeros(type)
    return evaluateConstantField(v)
}

/** `try_extract_element_geometries` (:521). */
function extractElements(g: GeometrySet, type: ComponentType, domain: AttrDomain, mask: number[]): GeometrySet[] | undefined {
    const wrap = <T>(list: T[], set: (out: GeometrySet, v: T) => void) => list.map(v => {
        const out = new GeometrySet()
        set(out, v)
        return out
    })
    if (type === 'mesh') {
        const mesh = g.mesh!, src = g.attributes('mesh')!
        const meshes = domain === AttrDomain.Point ? extractMeshVertices(mesh, src, mask)
            : domain === AttrDomain.Edge ? extractMeshEdges(mesh, src, mask)
                : domain === AttrDomain.Face ? extractMeshFaces(mesh, src, mask) : undefined
        return meshes && wrap(meshes, (o, m) => o.setMesh(m))
    }
    if (type === 'pointcloud') return domain === AttrDomain.Point ? wrap(extractPointcloudPoints(g.pointCloud!, mask), (o, p) => o.setPointCloud(p)) : undefined
    if (type === 'curves') {
        const curves = domain === AttrDomain.Point ? extractCurvesPoints(g.curves!, mask) : domain === AttrDomain.Curve ? extractCurves(g.curves!, mask) : undefined
        return curves && wrap(curves, (o, c) => o.setCurves(c))
    }
    return domain === AttrDomain.Instance ? wrap(extractInstances(g.instances!, mask), (o, i) => o.setInstances(i)) : undefined
}

/** `LazyFunctionForForeachGeometryElementZone::execute_impl` (:324) and the reduce function (:845). */
export function executeForeach(host: ForeachHost, n: CNode, cache: NodeCache): void {
    const z = n.ownZone!
    const domain = domainFromRNA(String(n.json.properties?.domain ?? 'POINT'))
    const mainGeometry = host.readOutside(z, 'Geometry', cache.deps)
    const main = mainGeometry instanceof GeometrySet ? mainGeometry : new GeometrySet()
    const selection = host.readOutside(z, 'Selection', cache.deps)
    const itemFields = z.items.map(item => host.readOutside(z, item.identifier, cache.deps))

    // `prepare_components` (:416).
    const createElements = domain !== AttrDomain.Corner && z.input.linkedOutputs.has('Element')
    const runs: ComponentRun[] = []
    let bodies = 0
    for (const type of COMPONENT_ORDER) {
        const component = main.get(type)
        if (!component) continue
        const size = main.attributes(type)!.domainSize(domain)
        if (size <= 0) continue
        const e = new FieldEvaluation(new FieldContext(type, component, domain), size)
        const sel = selection instanceof GField ? e.evaluate(selection) : undefined
        const items = itemFields.map(f => (f instanceof GField ? e.evaluate(f) : undefined))
        const mask: number[] = []
        for (let i = 0; i < size; i++) if (!sel || sel.get(i)) mask.push(i)
        const run: ComponentRun = {type, mask, firstBody: bodies, items: items.map(v => v ?? {get: () => 0})}
        if (createElements) run.elements = extractElements(main, type, domain, mask)
        bodies += mask.length
        runs.push(run)
    }
    if (bodies === 0 && !main.isEmpty) host.warn(z.input, 'Input geometry has no elements in the iteration domain.')

    // The bodies, in component and element order.
    const mainItems = z.mainItems!, generationItems = z.generationItems!
    const groups = generationGroups(generationItems)
    const groupUsed = groups.map(g => [g.geometry, ...g.fields].some(item => n.linkedOutputs.has(item.identifier)))
    const mainValues: (readonly number[])[][] = []
    const generated: {geometry: GeometrySet, fields: GField[]}[][] = groups.map(() => [])
    if (z.running) throw new Error(`procedural: For Each zone '${n.json.name}' re-entered`)
    z.border = []
    z.running = true
    try {
        for (const run of runs) {
            run.mask.forEach((element, pos) => {
                const body = run.firstBody + pos
                host.nextPass()
                z.iteration = body
                z.iterationValue = GField.constant('int32', [element])
                z.state = z.items.map((item, k) => {
                    const type = itemType(item)
                    const c = DATA_TYPES[type].components
                    const v = new Array<number>(c)
                    const src = run.items[k] as {get(i: number, k?: number): number}
                    for (let q = 0; q < c; q++) v[q] = src.get(element, q)
                    return GField.constant(type, v)
                })
                z.element = run.elements?.[pos] ?? new GeometrySet()
                mainValues.push(mainItems.map(item => {
                    const type = fieldType(item)
                    return type ? toSingle(host.readBody(n, item.identifier), type) : []
                }))
                groups.forEach((g, gi) => {
                    if (!groupUsed[gi]) return
                    const geometry = host.readBody(n, g.geometry.identifier)
                    generated[gi].push({
                        geometry: geometry instanceof GeometrySet ? geometry.copy() : new GeometrySet(),
                        fields: g.fields.map(f => {
                            const v = host.readBody(n, f.identifier)
                            return v instanceof GField ? v : GField.constant(itemType(f), zeros(itemType(f)))
                        }),
                    })
                })
            })
        }
    } finally {
        z.running = false
        z.state = []
        z.element = undefined
    }
    cache.deps.push(...z.border)

    // `handle_main_items_and_geometry` (:858).
    const output = main.copy()
    mainItems.forEach((item, k) => {
        // Items without an attribute type (`socket_type_to_geo_nodes_base_cpp_type`) are skipped (:874).
        const type = fieldType(item)
        if (!type) return
        const name = host.anonymousName(n, item.identifier, cache.deps)
        const c = DATA_TYPES[type].components
        for (const run of runs) {
            const attrs = output.attributesForWrite(run.type)!
            const size = attrs.domainSize(domain)
            // Unselected elements are value-initialised. Selected ones read body `pos`, their position in this
            // component's mask (`lf_param_index = pos * body_main_outputs_num + item_i`, :893), not the component's own
            // body (`body_nodes_range[pos]`, as the generation items do): every component after the first takes the
            // values of the first bodies. A Blender bug, reproduced (issue procedural-blender-bug-foreach-main-items.md).
            const data = new DATA_TYPES[type].array(size * c)
            run.mask.forEach((element, pos) => {
                const v = mainValues[pos][k]
                for (let q = 0; q < c; q++) data[element * c + q] = v[q]
            })
            const meta = attrs.lookupMeta(name)
            if (meta) {
                if (meta.domain === domain && meta.type === type) attrs.layerForWrite(name)!.data.set(data)
            } else {
                attrs.add(name, domain, type, data)
            }
        }
        cache.outputs.set(item.identifier, GField.fromInput(new AttributeFieldInput(name, type)))
    })
    cache.outputs.set('Geometry', output)

    // `handle_generation_items` (:927): items before the first geometry are invalid and output their defaults.
    groups.forEach((g, gi) => {
        if (!groupUsed[gi]) return
        const names = g.fields.map(f => host.anonymousName(n, f.identifier, cache.deps))
        const geometries: GeometrySet[] = []
        for (const run of runs) {
            const src = main.attributes(run.type)!
            const adapted = new Map<string, ReturnType<typeof src.lookup>>()
            run.mask.forEach((element, pos) => {
                const body = run.firstBody + pos
                let geometry = generated[gi][body].geometry
                for (const dstType of ['mesh', 'pointcloud', 'curves', 'instances'] as ComponentType[]) {
                    if (!geometry.has(dstType)) continue
                    const dst = geometry.attributesForWrite(dstType)!
                    const target = PROPAGATION_DOMAIN[dstType]
                    for (const name of src.names()) {
                        if (src.isBuiltin(name) && !dst.isBuiltin(name)) continue
                        if (dst.contains(name)) continue
                        let values = adapted.get(name)
                        if (!adapted.has(name)) {
                            const meta = src.lookupMeta(name)!
                            values = src.adaptDomain(src.lookup(name)!, meta.domain, domain)
                            adapted.set(name, values)
                        }
                        if (!values) continue
                        const type = src.lookupMeta(name)!.type
                        const c = DATA_TYPES[type].components
                        const size = dst.domainSize(target)
                        const data = new DATA_TYPES[type].array(size * c)
                        for (let i = 0; i < size; i++) for (let q = 0; q < c; q++) data[i * c + q] = values.get(element, q)
                        dst.add(name, target, type, data)
                    }
                }
                // Capture each field of the group on the body's geometry.
                g.fields.forEach((f, fi) => {
                    const captureDomain = domainFromRNA(f.domain ?? 'POINT')
                    const field = generated[gi][body].fields[fi]
                    if (captureDomain === AttrDomain.Instance) {
                        if (geometry.has('instances')) captureFieldsOnGeometry(geometry, 'instances', [names[fi]], captureDomain, undefined, [field])
                    } else {
                        geometry = foreachRealGeometry(geometry, sub => {
                            for (const t of ['mesh', 'pointcloud', 'curves'] as ComponentType[]) {
                                if (sub.has(t)) captureFieldsOnGeometry(sub, t, [names[fi]], captureDomain, undefined, [field])
                            }
                        }, host.options.scene)
                    }
                })
                geometries[body] = geometry
            })
        }
        // The last geometry carries the main geometry's edit data, which is not modelled here.
        geometries.push(new GeometrySet())
        cache.outputs.set(g.geometry.identifier, joinGeometries(geometries, {scene: host.options.scene}))
        g.fields.forEach((f, fi) => cache.outputs.set(f.identifier, GField.fromInput(new AttributeFieldInput(names[fi], itemType(f)))))
    })
}

function fieldType(item: ZoneItem): DataType | undefined {
    return socketDataType(item.type) as DataType | undefined
}

function itemType(item: ZoneItem): DataType {
    const t = socketDataType(item.type)
    if (!t) throw new Error(`procedural: For Each item '${item.name}' of type ${item.type} is not a field type`)
    return t
}

/** `handle_generation_item_groups` (:948): a geometry item followed by its fields; leading non-geometry items are invalid. */
function generationGroups(items: ZoneItem[]): {geometry: ZoneItem, fields: ZoneItem[]}[] {
    const groups: {geometry: ZoneItem, fields: ZoneItem[]}[] = []
    for (const item of items) {
        if (item.type === 'GEOMETRY') groups.push({geometry: item, fields: []})
        else if (groups.length) groups[groups.length - 1].fields.push(item)
    }
    return groups
}
