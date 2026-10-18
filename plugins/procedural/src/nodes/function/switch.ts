/**
 * Switch (`GeometryNodeSwitch`, `nodes/geometry/nodes/node_geo_switch.cc`), Index Switch
 * (`GeometryNodeIndexSwitch`, `node_geo_index_switch.cc`) and Menu Switch (`GeometryNodeMenuSwitch`,
 * `node_geo_menu_switch.cc`). Their lazy functions read only the selected input when the selector is a single
 * value (`execute_single`), and build a field operation over all inputs when it is a field of a field type
 * (`execute_field`); `p.get` pulls inputs lazily, so an unselected branch never runs.
 *
 * Blender 5.2.2 also has string and menu fields (`socket_type_supports_fields`, `nodes/intern/node_socket.cc:656`);
 * this runtime carries strings and menus as single values only, so a field selector over STRING / MENU values
 * (and a field Menu input) is reported as missing instead of evaluated.
 */

import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import {FieldOperation, GField, MultiFunction} from '../../fields/field'
import {evaluateConstantField} from '../../fields/evaluate'
import {socketDataType} from '../../runtime/declaration'
import {registerNodeType} from '../../runtime/registry'
import type {ExecParams} from '../../runtime/params'
import type {SocketType} from '../../runtime/types'
import {cached} from '../util'

/** Socket types of `rna_enum_node_socket_data_type_items` valid in geometry node trees (`geometry_node_tree_socket_type_valid`, `nodes/geometry/node_geometry_tree.cc:123`), in RNA order. */
const DATA_TYPE_ITEMS = ['FLOAT', 'INT', 'BOOLEAN', 'VECTOR', 'RGBA', 'ROTATION', 'MATRIX', 'STRING', 'MENU', 'OBJECT', 'IMAGE',
    'GEOMETRY', 'COLLECTION', 'MATERIAL', 'BUNDLE', 'CLOSURE', 'FONT', 'SOUND']

/** Socket types the runtime has sockets for. */
function socketType(dataType: string, node: string): SocketType {
    if (dataType === 'FONT' || dataType === 'SOUND') throw new Error(`procedural: ${node} of ${dataType} needs ${dataType} sockets, which the runtime does not have`)
    return dataType as SocketType
}

/** Field-capable in Blender (`socket_type_supports_fields`) but single-only in this runtime. */
const BLENDER_FIELD_ONLY = new Set(['STRING', 'MENU'])

/** The value of a selector input that is a single value; `get<T>()` of a context-dependent field is the type default (`evaluate_constant_field`, `functions/intern/field_evaluation.cc:503`). */
function singleValue(v: GField): number {
    return v.dependsOnInput ? 0 : evaluateConstantField(v)[0]
}

// region Switch

/** `SI3_SO<bool, T, T, T>("Switch")` (`node_geo_switch.cc:216`). */
const switchFunction = cached((type: string): MultiFunction => {
    const t = type as DataType
    const c = DATA_TYPES[t].components
    return {
        name: 'Switch', inputs: ['bool', t, t], outputs: [t],
        call(size, [cond, a, b], [out]) {
            for (let i = 0; i < size; i++) {
                const src = cond.get(i) ? b : a
                for (let k = 0; k < c; k++) out[i * c + k] = src.get(i, k)
            }
        },
    }
})

registerNodeType({
    idname: 'GeometryNodeSwitch',
    label: 'Switch',
    // `node_init` (:72): SOCK_FLOAT; `node_rna` (:287) filters the socket types to the tree type.
    properties: {input_type: 'FLOAT'},
    enums: {input_type: DATA_TYPE_ITEMS},
    // :26-64.
    declare(b, node) {
        const type = socketType(node.prop<string>('input_type'), 'Switch')
        b.input('BOOLEAN', 'Switch')
        b.input(type, 'False')
        b.input(type, 'True')
        b.output(type, 'Output')
    },
    // `LazyFunctionForSwitchNode::execute_impl` (:131).
    execute(p) {
        const type = p.node.prop<string>('input_type')
        const condition = p.get('Switch') as GField
        if (!condition.dependsOnInput) {
            p.set('Output', p.get(singleValue(condition) ? 'True' : 'False'))
            return
        }
        const dt = socketDataType(type as SocketType)
        if (dt) {
            // `execute_field` (:167): both inputs, one field operation.
            const op = new FieldOperation(switchFunction(dt), [condition, p.get('False') as GField, p.get('True') as GField])
            p.set('Output', op.output(0))
            return
        }
        if (BLENDER_FIELD_ONLY.has(type)) {
            throw new Error(`procedural: Switch of ${type} with a field condition needs ${type.toLowerCase()} fields, which the runtime does not have`)
        }
        // :145-152: an error on the node, then `execute_single(get<bool>())` - false for a field.
        p.warn('Type cannot be switched by a field')
        p.set('Output', p.get('False'))
    },
    // `node_internally_linked_input` (:279): the False input.
    internallyLinkedInput: () => 'False',
})

// endregion

// region Index Switch

/** `IndexSwitchItemsAccessor::socket_identifier_for_item` (`NOD_geo_index_switch.hh:52`). */
const itemIdentifier = (item: Record<string, unknown>, i: number) => `Item_${typeof item.identifier === 'number' ? item.identifier : i}`

/** The items of an Index Switch: `node_init` (:120) creates two, identifiers 0 and 1. */
function indexSwitchItems(node: {items(name: string): Record<string, unknown>[]}): Record<string, unknown>[] {
    const items = node.items('index_switch_items')
    return items.length ? items : [{identifier: 0}, {identifier: 1}]
}

/** `IndexSwitchFunction` (`node_geo_index_switch.cc:155`): out-of-range indices give the type's default (`CPPType::default_value`). */
const indexSwitchFunction = cached((key: string): MultiFunction => {
    const [type, count] = key.split(':')
    const t = type as DataType
    const n = Number(count)
    const c = DATA_TYPES[t].components
    const def = DATA_TYPES[t].defaultValue
    return {
        name: 'Index Switch', inputs: ['int32', ...new Array<DataType>(n).fill(t)], outputs: [t],
        call(size, [index, ...values], [out]) {
            for (let i = 0; i < size; i++) {
                const k0 = index.get(i)
                if (k0 >= 0 && k0 < n) for (let k = 0; k < c; k++) out[i * c + k] = values[k0].get(i, k)
                else for (let k = 0; k < c; k++) out[i * c + k] = def[k]
            }
        },
    }
})

registerNodeType({
    idname: 'GeometryNodeIndexSwitch',
    label: 'Index Switch',
    // `node_init` (:120): SOCK_FLOAT in geometry trees; `node_rna` (:412).
    properties: {data_type: 'FLOAT'},
    enums: {data_type: DATA_TYPE_ITEMS},
    // :78-117.
    declare(b, node) {
        const type = socketType(node.prop<string>('data_type'), 'Index Switch')
        const items = indexSwitchItems(node)
        b.input('INT', 'Index').min(0).max(Math.max(0, items.length - 1))
        items.forEach((item, i) => b.input(type, String(i), itemIdentifier(item, i)))
        b.output(type, 'Output')
        b.input('CUSTOM', '', '__extend__')
    },
    // `LazyFunctionForIndexSwitchNode::execute_impl` (:317).
    execute(p) {
        const type = p.node.prop<string>('data_type')
        const items = indexSwitchItems(p.node)
        const ids = items.map(itemIdentifier)
        const index = p.get('Index') as GField
        const dt = socketDataType(type as SocketType)
        if (index.dependsOnInput && dt) {
            // `execute_field` (:350).
            const fn = indexSwitchFunction(`${dt}:${ids.length}`)
            p.set('Output', new FieldOperation(fn, [index, ...ids.map(id => p.get(id) as GField)]).output(0))
            return
        }
        if (index.dependsOnInput && BLENDER_FIELD_ONLY.has(type)) {
            throw new Error(`procedural: Index Switch of ${type} with a field index needs ${type.toLowerCase()} fields, which the runtime does not have`)
        }
        // `execute_single` (:331): only the selected input; the socket default when out of range.
        const i = singleValue(index)
        if (i >= 0 && i < ids.length) p.set('Output', p.get(ids[i]))
    },
    // `node_internally_linked_input` (:451): the first item.
    internallyLinkedInput: node => itemIdentifier(indexSwitchItems(node)[0] ?? {}, 0),
})

// endregion

// region Menu Switch

/** `MenuSwitchItemsAccessor::socket_identifier_for_item` (`NOD_geo_menu_switch.hh:74`). */
const enumItemIdentifier = itemIdentifier

/**
 * The enum items of a Menu Switch: `node_init` (:121) adds "A" and "B" (identifiers 0, 1). Items without an
 * `identifier` (`NodeEnumItem` has no RNA identifier, so dumps cannot record it) take their position.
 */
function menuItems(node: {items(name: string): Record<string, unknown>[]}): {name: string, id: string}[] {
    const items = node.items('enum_items')
    const list = items.length ? items : [{name: 'A', identifier: 0}, {name: 'B', identifier: 1}]
    return list.map((item, i) => ({name: String(item.name ?? ''), id: enumItemIdentifier(item, i)}))
}

registerNodeType({
    idname: 'GeometryNodeMenuSwitch',
    label: 'Menu Switch',
    // `node_init` (:121): SOCK_GEOMETRY in geometry trees, items "A" and "B" (the active index is the last added).
    properties: {data_type: 'GEOMETRY', active_index: 1},
    enums: {data_type: DATA_TYPE_ITEMS},
    // :45-114.
    declare(b, node) {
        const type = socketType(node.prop<string>('data_type'), 'Menu Switch')
        const items = menuItems(node)
        b.output(type, 'Output')
        b.input('MENU', 'Menu').default(items[0]?.name ?? '')
        for (const item of items) {
            b.input(type, item.name, item.id)
            b.output('BOOLEAN', item.name, item.id)
        }
        b.input('CUSTOM', '', '__extend__')
    },
    // `LazyFunctionForMenuSwitchNode::execute_single` (:340) and `LazyFunctionMenuSwitchBooleanOutputs` (:396).
    execute(p: ExecParams) {
        const items = menuItems(p.node)
        const menu = p.get('Menu')
        if (typeof menu !== 'string') throw new Error('procedural: Menu Switch menu fields need menu fields, which the runtime does not have')
        let found = false
        for (const item of items) {
            const selected = item.name === menu
            p.set(item.id, GField.constant('bool', [selected ? 1 : 0]))
            if (selected && !found) {
                // Inputs and outputs share identifiers; `p.get` reads the input.
                p.set('Output', p.get(item.id))
                found = true
            }
        }
        // No match: the output's socket default (`set_default_value_for_output_socket`).
    },
})

// endregion
