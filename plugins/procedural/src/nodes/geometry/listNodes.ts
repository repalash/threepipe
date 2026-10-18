/**
 * List nodes: Field to List (`node_geo_field_to_list.cc`), Get List Item (`node_geo_list_get_item.cc`), List Length
 * (`node_geo_list_length.cc`), Sort List (`node_geo_sort_list.cc`), Filter List (`node_geo_filter_list.cc`), Split
 * String (`node_fn_split_string.cc`) and Get Attribute Names (`node_geo_get_attribute_names.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, GField, IndexFieldInput} from '../../fields'
import {FieldOperation} from '../../fields/field'
import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import {GeometrySet} from '../../geometry/GeometrySet'
import {sortIndicesByWeights} from '../../geometry/reorder'
import {GVArray} from '../../geometry/varray'
import {strcasecmpNatural} from '../../blender/string'
import {evaluateFieldToList, executeMultiFunctionOnLists, GList, sampleIndexFunction} from '../../runtime/list'
import {registerNodeType} from '../../runtime/registry'
import type {SocketType} from '../../runtime/types'
import type {SocketValue} from '../../runtime/values'

/** `rna_enum_node_socket_data_type_items`, the types lists of this runtime can hold. */
const LIST_TYPES = ['FLOAT', 'INT', 'BOOLEAN', 'VECTOR', 'RGBA', 'ROTATION', 'MATRIX', 'STRING', 'MENU', 'OBJECT', 'IMAGE', 'GEOMETRY', 'COLLECTION', 'MATERIAL']

/** `FieldToListItemsAccessor`: `Field_<id>` inputs, `List_<id>` outputs. */
function fieldToListItems(items: Record<string, unknown>[]) {
    return items.map((item, i) => {
        const id = typeof item.identifier === 'number' ? item.identifier : i
        return {name: String(item.name ?? ''), type: String(item.socket_type ?? 'FLOAT') as SocketType, input: `Field_${id}`, output: `List_${id}`}
    })
}

registerNodeType({
    idname: 'GeometryNodeFieldToList',
    label: 'Field to List',
    properties: {active_index: 0},
    declare(b, node) {
        b.input('INT', 'Count').default(1).min(1)
        for (const item of fieldToListItems(node.items('list_items'))) {
            b.input(item.type, item.name, item.input).field()
            b.output(item.type, item.name, item.output).list()
        }
        b.input('CUSTOM', '', '__extend__')
        b.output('CUSTOM', '', '__extend__')
    },
    // `node_geo_exec` (:189): each required field evaluated on `count` list elements (`ListFieldContext`).
    execute(p) {
        const count = p.int('Count')
        if (count < 0) {
            p.warn('Count must not be negative')
            return
        }
        for (const item of fieldToListItems(p.node.items('list_items'))) {
            if (!p.outputUsed(item.output)) continue
            p.set(item.output, evaluateFieldToList(p.field(item.input), count))
        }
    },
})

const listOf = (v: SocketValue): GList | undefined => (v instanceof GList ? v : undefined)

registerNodeType({
    idname: 'GeometryNodeListGetItem',
    label: 'Get List Item',
    properties: {socket_type: 'FLOAT', structure_type: 'AUTO'},
    enums: {socket_type: LIST_TYPES, structure_type: ['AUTO', 'DYNAMIC', 'FIELD', 'GRID', 'LIST', 'SINGLE']},
    declare(b, node) {
        const type = node.prop<string>('socket_type') as SocketType
        b.input(type, 'List').hideValue().list()
        b.input('INT', 'Index').min(0)
        b.output(type, 'Value')
    },
    // `node_geo_exec` (:177): non-field types take a single index; field types go through `SampleIndexFunction`.
    execute(p) {
        const list = listOf(p.get('List'))
        if (!list) return
        const index = p.get('Index')
        if (!list.isData) {
            if (!(index instanceof GField) || index.dependsOnInput) {
                p.warn('Index must be a single value')
                return
            }
            const i = p.int('Index')
            if (i < 0 || i >= list.size) {
                p.warn('Index out of range')
                return
            }
            p.set('Value', list.item(i) as SocketValue)
            return
        }
        const fn = sampleIndexFunction(list)
        if (index instanceof GList) {
            p.set('Value', executeMultiFunctionOnLists(fn, [index])[0])
        } else if (index instanceof GField && index.dependsOnInput) {
            p.set('Value', new FieldOperation(fn, [index]).output(0))
        } else {
            const out = new DATA_TYPES[list.dataType].array(DATA_TYPES[list.dataType].components)
            fn.call(1, [GVArray.fromSingle('int32', 1, [p.int('Index')])], [out])
            p.set('Value', GField.constant(list.dataType, Array.from(out)))
        }
    },
})

registerNodeType({
    idname: 'GeometryNodeListLength',
    label: 'List Length',
    properties: {data_type: 'FLOAT'},
    enums: {data_type: LIST_TYPES},
    declare(b, node) {
        b.input(node.prop<string>('data_type') as SocketType, 'List').hideValue().list()
        b.output('INT', 'Length')
    },
    execute(p) {
        const list = listOf(p.get('List'))
        if (list) p.set('Length', GField.constant('int32', [list.size]))
    },
})

/** The list as a varray of its own type (field data), or its items. */
function gatherList(list: GList, indices: ArrayLike<number>): GList {
    if (!list.isData) return GList.fromItems(list.type as SocketType, Array.from(indices, i => list.item(i)))
    if (list.single) return GList.fromSingle(list.dataType, Array.from({length: DATA_TYPES[list.dataType].components}, (_, k) => list.get(0, k)), indices.length)
    const c = DATA_TYPES[list.dataType].components
    const out = new DATA_TYPES[list.dataType].array(indices.length * c)
    for (let i = 0; i < indices.length; i++) for (let k = 0; k < c; k++) out[i * c + k] = list.get(indices[i], k)
    return GList.fromArray(list.dataType, out)
}

/**
 * `get_varray_or_evaluate` (`node_geo_sort_list.cc:72`): a field evaluated on the list, a list of the right size, or a
 * single value; other lists give the default.
 */
function listValues(v: SocketValue, size: number, type: DataType, def: number): GVArray {
    if (v instanceof GList) return v.size === size && v.isData ? v.varray(size) : GVArray.fromSingle(type, size, [def])
    if (v instanceof GField && v.dependsOnInput) return new FieldEvaluation(FieldContext.forList(size), size).evaluate(v)
    if (v instanceof GField) return GVArray.fromSingle(type, size, [new FieldEvaluation(undefined, 1).evaluate(v).get(0)])
    return GVArray.fromSingle(type, size, [def])
}

/** A selection as `Field<bool>` over the list: lists through `SampleIndexFunction` of the index (:118). */
function listSelection(v: SocketValue, size: number): number[] {
    let sel: GVArray
    if (v instanceof GList) {
        const index = GField.fromInput(new IndexFieldInput())
        sel = new FieldEvaluation(FieldContext.forList(size), size).evaluate(new FieldOperation(sampleIndexFunction(v), [index]).output(0))
    } else {
        sel = listValues(v, size, 'bool', 1)
    }
    const mask: number[] = []
    for (let i = 0; i < size; i++) if (sel.get(i)) mask.push(i)
    return mask
}

registerNodeType({
    idname: 'GeometryNodeSortList',
    label: 'Sort List',
    properties: {socket_type: 'FLOAT'},
    enums: {socket_type: LIST_TYPES},
    declare(b, node) {
        const type = node.prop<string>('socket_type') as SocketType
        b.input(type, 'List').hideValue().list()
        b.output(type, 'List').list()
        b.input('BOOLEAN', 'Selection').default(true).hideValue()
        b.input('INT', 'Group ID').default(0).hideValue()
        b.input('FLOAT', 'Sort Weight').default(0).hideValue()
    },
    // `node_geo_exec` (:94).
    execute(p) {
        const list = listOf(p.get('List'))
        if (!list) return
        const size = list.size
        if (size <= 1) return p.set('List', list)
        const mask = listSelection(p.get('Selection'), size)
        const group = listValues(p.get('Group ID'), size, 'int32', 0)
        const weights = listValues(p.get('Sort Weight'), size, 'float', 0)
        const sorted = sortIndicesByWeights(size, mask, group, weights)
        if (!sorted || list.single) return p.set('List', list)
        p.set('List', gatherList(list, sorted))
    },
})

registerNodeType({
    idname: 'GeometryNodeFilterList',
    label: 'Filter List',
    properties: {socket_type: 'FLOAT'},
    enums: {socket_type: LIST_TYPES},
    declare(b, node) {
        const type = node.prop<string>('socket_type') as SocketType
        b.input(type, 'List').hideValue().list()
        b.input('BOOLEAN', 'Selection').default(true).hideValue()
        b.output(type, 'Selection').list()
        b.output(type, 'Inverted').list()
    },
    // `node_geo_exec` (:94) with `output_lists` (:79).
    execute(p) {
        const list = listOf(p.get('List'))
        if (!list) return
        const v = p.get('Selection')
        let mask: number[]
        if (v instanceof GList) {
            if (v.size < list.size) {
                p.warn('"Selection" list is too small')
                return
            }
            mask = []
            for (let i = 0; i < list.size; i++) if (v.get(i)) mask.push(i)
        } else {
            mask = listSelection(v, list.size)
        }
        const keep = new Set(mask)
        const inverted: number[] = []
        for (let i = 0; i < list.size; i++) if (!keep.has(i)) inverted.push(i)
        const filter = (indices: number[]) => (indices.length === list.size ? list : gatherList(list, indices))
        if (p.outputUsed('Selection')) p.set('Selection', filter(mask))
        if (p.outputUsed('Inverted')) p.set('Inverted', filter(inverted))
    },
})

registerNodeType({
    idname: 'FunctionNodeSplitString',
    label: 'Split String',
    declare(b) {
        b.input('STRING', 'String')
        b.input('STRING', 'Separator')
        b.output('STRING', 'List').list()
    },
    // `split_string` (:24): at least one element; an empty separator keeps the string whole.
    execute(p) {
        const s = p.string('String'), sep = p.string('Separator')
        p.set('List', GList.fromItems('STRING', sep ? s.split(sep) : [s]))
    },
})

/** `rna_enum_attrtype_items` names (the Data Type menu) to data types; String and 4D Vector have none here. */
const ATTR_TYPE_NAMES: Record<string, DataType | null> = {
    'Float': 'float', 'Integer': 'int32', 'Boolean': 'bool', 'Vector': 'float3', 'Color': 'float4', 'Quaternion': 'quaternion',
    '4x4 Matrix': 'float4x4', 'String': null, '8-Bit Integer': 'int8', '2D 16-Bit Integer Vector': 'int16x2',
    '2D Integer Vector': 'int32x2', '2D Vector': 'float2', '4D Vector': null, 'Byte Color': 'byteColor',
}
const DOMAIN_NAMES: Record<string, AttrDomain | null> = {
    'Point': AttrDomain.Point, 'Edge': AttrDomain.Edge, 'Face': AttrDomain.Face, 'Face Corner': AttrDomain.Corner,
    'Spline': AttrDomain.Curve, 'Instance': AttrDomain.Instance, 'Layer': null,
}

registerNodeType({
    idname: 'GeometryNodeGetAttributeNames',
    label: 'Get Attribute Names',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Filter Data Type').default(false)
        b.input('MENU', 'Data Type').default('Float')
        b.input('BOOLEAN', 'Filter Domain').default(false)
        b.input('MENU', 'Domain').default('Point')
        b.output('STRING', 'Names').list()
    },
    // `node_geo_exec` (:44): names of every component (in component order), without `.`-names, sorted bytewise.
    execute(p) {
        const g = p.get('Geometry') as GeometrySet
        const filterType = p.bool('Filter Data Type'), filterDomain = p.bool('Filter Domain')
        const typeName = p.string('Data Type'), domainName = p.string('Domain')
        if (!(typeName in ATTR_TYPE_NAMES) || !(domainName in DOMAIN_NAMES)) throw new Error('Get Attribute Names: unknown menu item')
        const type = ATTR_TYPE_NAMES[typeName], domain = DOMAIN_NAMES[domainName]
        const names = new Set<string>()
        for (const t of ['mesh', 'pointcloud', 'instances', 'curves'] as const) {
            const attrs = g.attributes(t)
            if (!attrs) continue
            for (const name of attrs.names()) {
                const meta = attrs.lookupMeta(name)!
                if (filterType && meta.type !== type) continue
                if (filterDomain && meta.domain !== domain) continue
                if (name.startsWith('.')) continue
                names.add(name)
            }
        }
        // `StringRef < StringRef`: bytewise.
        const enc = new TextEncoder()
        const sorted = [...names].sort((a, b) => {
            const x = enc.encode(a), y = enc.encode(b)
            for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]
            return x.length - y.length
        })
        p.set('Names', GList.fromItems('STRING', sorted))
    },
})


registerNodeType({
    idname: 'GeometryNodeCollectionChildren',
    label: 'Collection Children',
    declare(b) {
        b.input('COLLECTION', 'Collection')
        b.input('BOOLEAN', 'Recursive').default(false)
        b.output('COLLECTION', 'Collections').list()
        b.output('OBJECT', 'Objects').list()
    },
    // `node_geo_exec` (:49): child collections (depth first, each once when recursive), sorted by
    // `BLI_strcasecmp_natural` of the names; objects of the collection (and the children when recursive), each once.
    execute(p) {
        const ref = p.idRef('Collection')
        const scene = p.options.scene
        const col = ref ? scene?.collection?.(ref.name) : undefined
        if (!ref || !col) return
        const children: string[] = []
        if (p.bool('Recursive')) {
            const visited = new Set<string>()
            const walk = (name: string) => {
                for (const c of scene?.collection?.(name)?.children ?? []) {
                    if (visited.has(c)) continue
                    visited.add(c)
                    children.push(c)
                    walk(c)
                }
            }
            walk(ref.name)
        } else {
            children.push(...col.children)
        }
        const natural = (a: string, b: string) => strcasecmpNatural(a, b)
        // `std::ranges::sort` with `< 0`: names are unique, so the order is the comparison's.
        const sortedChildren = [...children].sort(natural)
        p.set('Collections', GList.fromItems('COLLECTION', sortedChildren.map(name => ({_ref: 'COLLECTION', name}))))
        if (!p.outputUsed('Objects')) return
        const objects: string[] = []
        const seen = new Set<string>()
        for (const c of p.bool('Recursive') ? [ref.name, ...sortedChildren] : [ref.name]) {
            for (const o of scene?.collection?.(c)?.objects ?? []) {
                if (seen.has(o)) continue
                seen.add(o)
                objects.push(o)
            }
        }
        p.set('Objects', GList.fromItems('OBJECT', objects.sort(natural).map(name => ({_ref: 'OBJECT', name}))))
    },
})
