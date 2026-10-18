/**
 * Attribute nodes: Set ID (`node_geo_set_id.cc`), Remove Named Attribute (`node_geo_remove_attribute.cc` with
 * `nodes/intern/string_pattern.cc`) and Attribute Statistic (`node_geo_attribute_statistic.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {captureFieldsOnGeometry, FieldContext, FieldEvaluation, GField} from '../../fields'
import {isAnonymousAttributeName} from '../../geometry/attributeAccessor'
import {COMPONENT_ORDER, ComponentType, GeometrySet} from '../../geometry/GeometrySet'
import {ensureGeometryInstances} from '../../geometry/realizeInstances'
import {registerNodeType} from '../../runtime/registry'
import type {SceneProvider} from '../../runtime/context'
import {allowProceduralAttributeAccess, domainFromRNA} from '../attributeTypes'

// region Set ID

registerNodeType({
    idname: 'GeometryNodeSetID',
    label: 'Set ID',
    // `node_declare` (:9).
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('INT', 'ID').implicit('INDEX').field()
    },
    // `node_geo_exec` (:42) and `set_id_in_component` (:24): the top-level components only, not instanced geometry.
    execute(p) {
        const geometry = p.geometry('Geometry')
        const selection = p.field('Selection')
        const id = p.field('ID')
        for (const type of ['instances', 'mesh', 'pointcloud', 'curves'] as ComponentType[]) {
            if (!geometry.has(type)) continue
            const domain = type === 'instances' ? AttrDomain.Instance : AttrDomain.Point
            if (geometry.domainSize(type, domain) === 0) continue
            captureFieldsOnGeometry(geometry, type, ['id'], domain, selection, [id])
        }
        p.set('Geometry', geometry)
    },
})

// endregion

// region Remove Named Attribute

/** `StringPattern::from_str` / `match` (`nodes/intern/string_pattern.cc`); menu values are the item names. */
export type Pattern = {exact: string} | {prefix: string, suffix: string}

export function patternFromString(mode: string, pattern: string): Pattern | string {
    if (mode === 'Exact') return {exact: pattern}
    if (mode !== 'Wildcard') return 'Invalid pattern'
    const count = pattern.split('*').length - 1
    if (count === 0) return {exact: pattern}
    if (count >= 2) return 'Only one * is supported in the pattern'
    const i = pattern.indexOf('*')
    return {prefix: pattern.slice(0, i), suffix: pattern.slice(i + 1)}
}

export function patternMatch(p: Pattern, query: string): boolean {
    if ('exact' in p) return p.exact === query
    return query.startsWith(p.prefix) && query.endsWith(p.suffix)
}

interface RemoveState {
    pattern: Pattern
    removed: Set<string>
    failed: Set<string>
}

/** `remove_attributes_recursive` (:36). */
function removeAttributesRecursive(geometry: GeometrySet, state: RemoveState, scene: SceneProvider | undefined): void {
    for (const type of ['mesh', 'pointcloud', 'curves', 'instances'] as ComponentType[]) {
        const read = geometry.attributes(type)
        if (!read) continue
        const toRemove: string[] = []
        if ('exact' in state.pattern) {
            if (read.contains(state.pattern.exact)) toRemove.push(state.pattern.exact)
        } else {
            for (const name of read.names()) {
                if (isAnonymousAttributeName(name)) continue
                if (patternMatch(state.pattern, name)) toRemove.push(name)
            }
        }
        if (!toRemove.length) continue
        const write = geometry.attributesForWrite(type)!
        for (const name of toRemove) {
            if (!allowProceduralAttributeAccess(name)) continue
            if (write.remove(name)) state.removed.add(name)
            else state.failed.add(name)
        }
    }
    // :86: `get_instances_for_write` + `ensure_geometry_instances`, then every geometry reference.
    const instances = geometry.instancesForWrite()
    if (instances) {
        ensureGeometryInstances(instances, scene)
        instances.references.forEach((ref, i) => {
            if (ref.type !== 'geometry') return
            const sub = ref.geometry.copy()
            instances.references[i] = {type: 'geometry', geometry: sub}
            removeAttributesRecursive(sub, state, scene)
        })
    }
}

registerNodeType({
    idname: 'GeometryNodeRemoveAttribute',
    label: 'Remove Named Attribute',
    // `node_declare` (:16).
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        // Menu values are item names (`string_pattern_mode_items`: Exact, Wildcard).
        b.input('MENU', 'Pattern Mode').default('Exact')
        b.input('STRING', 'Name')
    },
    // `node_geo_exec` (:96).
    execute(p) {
        const geometry = p.geometry('Geometry')
        const name = p.string('Name')
        if (!name) return p.set('Geometry', geometry)
        const pattern = patternFromString(p.string('Pattern Mode'), name)
        if (typeof pattern === 'string') {
            p.warn(pattern)
            return p.set('Geometry', geometry)
        }
        const state: RemoveState = {pattern, removed: new Set(), failed: new Set()}
        removeAttributesRecursive(geometry, state, p.options.scene)
        if (state.failed.size) {
            p.warn(`Cannot remove built-in attributes: ${[...state.failed].map(n => `"${n}"`).join(', ')}`)
        } else if (!state.removed.size && 'exact' in pattern) {
            p.warn(`Attribute does not exist: "${pattern.exact}"`)
        }
        p.set('Geometry', geometry)
    },
})

// endregion

// region Attribute Statistic

/** `array_utils::compute_sum` (`BLI_array_utils.hh:109`): per 1024-element chunk from zero, then the chunk sums. */
function computeSum(data: Float32Array): number {
    const chunk = 1024
    let total = 0
    for (let start = 0; start < data.length; start += chunk) {
        let partial = 0
        const end = Math.min(start + chunk, data.length)
        for (let i = start; i < end; i++) partial = f32(partial + data[i])
        total = f32(total + partial)
    }
    return total
}

/** `compute_variance` (:114). */
function computeVariance(data: Float32Array, mean: number): number {
    if (data.length <= 1) return 0
    let acc = 0
    for (let i = 0; i < data.length; i++) {
        const d = f32(mean - data[i])
        acc = f32(acc + f32(d * d))
    }
    return f32(acc / data.length)
}

/** `median_of_sorted_span` (:129). */
function medianOfSorted(data: Float32Array): number {
    if (!data.length) return 0
    const median = data[data.length >> 1]
    if (data.length % 2 === 0) return f32(f32(median + data[(data.length >> 1) - 1]) * 0.5)
    return median
}

interface Stats {
    mean: number, median: number, sum: number, min: number, max: number, range: number, sd: number, variance: number
}

/**
 * The float branch of `node_geo_exec` (:178-212) on one axis of the data. Sorting happens in place before the sum
 * and the variance (:197), so with a sorted output required those run over the sorted values. The float3 branch
 * (:256-314) sums the unsorted float3 values (`sum`, one axis of them) and takes the variance of the per-axis copies,
 * which it sorted in place when sorting was required.
 */
function statistics(data: Float32Array, sortRequired: boolean, sumRequired: boolean, varianceRequired: boolean, unsortedSum: boolean): Stats {
    const s: Stats = {mean: 0, median: 0, sum: 0, min: 0, max: 0, range: 0, sd: 0, variance: 0}
    if (!data.length) return s
    const sum = unsortedSum ? computeSum(data) : 0
    if (sortRequired) {
        data.sort()
        s.median = medianOfSorted(data)
        s.min = data[0]
        s.max = data[data.length - 1]
        s.range = f32(s.max - s.min)
    }
    if (sumRequired || varianceRequired) {
        s.sum = unsortedSum ? sum : computeSum(data)
        s.mean = f32(s.sum / data.length)
        if (varianceRequired) {
            s.variance = computeVariance(data, s.mean)
            s.sd = f32(Math.sqrt(s.variance))
        }
    }
    return s
}

const STAT_OUTPUTS: [string, keyof Stats][] = [
    ['Mean', 'mean'], ['Median', 'median'], ['Sum', 'sum'], ['Min', 'min'], ['Max', 'max'], ['Range', 'range'],
    ['Standard Deviation', 'sd'], ['Variance', 'variance'],
]

registerNodeType({
    idname: 'GeometryNodeAttributeStatistic',
    label: 'Attribute Statistic',
    // `node_init` (:55).
    properties: {data_type: 'FLOAT', domain: 'POINT'},
    // `node_rna` (:338): FLOAT and FLOAT_VECTOR only; rna_enum_attribute_domain_items.
    enums: {data_type: ['FLOAT', 'FLOAT_VECTOR'], domain: ['POINT', 'EDGE', 'FACE', 'CORNER', 'CURVE', 'INSTANCE', 'LAYER']},
    // `node_declare` (:23).
    declare(b, node) {
        const type = node.prop<string>('data_type') === 'FLOAT_VECTOR' ? 'VECTOR' : 'FLOAT'
        b.input('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input(type, 'Attribute').hideValue().field()
        for (const [name] of STAT_OUTPUTS) b.output(type, name)
    },
    // `node_geo_exec` (:144).
    execute(p) {
        const geometry = p.geometry('Geometry')
        const vector = p.node.prop<string>('data_type') === 'FLOAT_VECTOR'
        const domainName = p.node.prop<string>('domain')
        if (domainName === 'LAYER') throw new Error('Attribute Statistic: the grease pencil layer domain is not supported (no grease pencil component)')
        const domain = domainFromRNA(domainName)
        const selection = p.field('Selection')
        const field = p.field('Attribute')
        const c = vector ? 3 : 1
        const gathered: number[] = []
        for (const type of COMPONENT_ORDER) {
            const component = geometry.get(type)
            if (!component) continue
            const attributes = geometry.attributes(type)!
            // Float: components with an empty domain are skipped (:159); float3: unsupported domains (:239).
            if (vector ? !attributes.supportsDomain(domain) : attributes.domainSize(domain) === 0) continue
            const size = attributes.domainSize(domain)
            const e = new FieldEvaluation(new FieldContext(type, component, domain), size)
            const values = e.evaluate(field)
            const sel = e.evaluate(selection)
            for (let i = 0; i < size; i++) if (sel.get(i)) for (let k = 0; k < c; k++) gathered.push(values.get(i, k))
        }
        const n = gathered.length / c
        const used = (name: string) => p.outputUsed(name)
        const sortRequired = used('Min') || used('Max') || used('Range') || used('Median')
        const sumRequired = used('Sum') || used('Mean')
        const varianceRequired = used('Standard Deviation') || used('Variance')
        const axes: Stats[] = []
        for (let k = 0; k < c; k++) {
            const data = new Float32Array(n)
            for (let i = 0; i < n; i++) data[i] = gathered[i * c + k]
            // `compute_sum(data.as_span())` over float3 adds per axis in the gathered (unsorted) order.
            axes.push(statistics(data, sortRequired, sumRequired, varianceRequired, vector))
        }
        const set = (name: string, key: keyof Stats) => p.set(name, GField.constant(vector ? 'float3' : 'float', axes.map(a => a[key])))
        if (sumRequired) {
            set('Sum', 'sum')
            set('Mean', 'mean')
        }
        if (sortRequired) {
            set('Min', 'min')
            set('Max', 'max')
            set('Range', 'range')
            set('Median', 'median')
        }
        if (varianceRequired) {
            set('Standard Deviation', 'sd')
            set('Variance', 'variance')
        }
    },
})

// endregion
