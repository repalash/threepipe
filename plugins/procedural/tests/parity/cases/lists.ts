/**
 * Parity cases for lists (`GList`): Field to List (the list field context: Index reads the element index, other inputs
 * their defaults), Get List Item with single, field and list indices (out of range gives the default), List Length,
 * multi-functions on lists (longer lists win, shorter ones repeat, single values broadcast) and implicit conversions,
 * Sort List, Filter List, Split String and Get Attribute Names.
 *
 * Field to List's items are dynamic (`list_items`), which the DSL has no argument for: they are added to the tree by
 * hand, as Capture Attribute's are in `meshAttribute.ts`.
 */

import {AnySocket, geometryNodes, n, Socket} from '../../../src/dsl/builder'
import type {NodeGroupLibrary, NodeJSON, SocketType} from '../../../src/runtime/types'
import {attributed, mod, testMeshes, SHAPE_SCENE} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

/** A Field to List node with one item per field (identifiers 0, 1, ...); returns its list outputs. */
function fieldToList(count: Socket<'INT'> | number, fields: AnySocket[]): AnySocket[] {
    const node = n.FieldToList({count})
    const b = fields[0].builder
    const json = b.tree.nodes.find(x => x.name === node.name) as NodeJSON
    json.items = {list_items: fields.map((f, i) => ({name: `Item ${i}`, socket_type: f.type as SocketType, identifier: i}))}
    fields.forEach((f, i) => b.tree.links.push({from: [f.node, f.identifier], to: [node.name, `Field_${i}`]}))
    return fields.map((f, i) => new Socket(b, node.name, `List_${i}`, f.type))
}

const ATTR: Partial<Record<SocketType, string>> = {FLOAT: 'FLOAT', INT: 'INT', BOOLEAN: 'BOOLEAN', VECTOR: 'FLOAT_VECTOR'}

export function listCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>, extra = {}) => {
        const group = geometryNodes(id, g => g.output.geometry('Geometry', build()))
        cases.push({id, description, library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty', ...extra})
    }
    /** Ten points; each list item `List[index]` stored, and the list's length. */
    const storeItems = (lists: [string, AnySocket][]) => {
        let g: AnySocket = n.Points({count: 10}).points
        for (const [name, list] of lists) {
            const type = list.type as SocketType
            const item = n.GetListItem({socketType: type as never, list, index: index()}).value as AnySocket
            g = n.StoreNamedAttribute({geometry: g as Socket<'GEOMETRY'>, dataType: ATTR[type] as never, name, value: item}).geometry
            g = n.StoreNamedAttribute({geometry: g as Socket<'GEOMETRY'>, dataType: 'INT', name: `${name}_len`, value: n.ListLength({dataType: type as never, list}).length}).geometry
        }
        return g as Socket<'GEOMETRY'>
    }

    add('field-to-list', 'Field to List: index-based fields, a position (default in lists), a random vector by ID; items read by index', () => {
        const [a, b, c, d] = fieldToList(7, [index().mul(1.5).add(0.25), mod(index(), 3), n.Position().position,
            n.RandomValue({dataType: 'FLOAT_VECTOR', seed: 3}).value as Socket<'VECTOR'>])
        return storeItems([['a', a], ['b', b], ['c', c], ['d', d]])
    })
    add('list-functions', 'Math on lists: list with single, two lists of different lengths (repeat), conversion, single and list indices', () => {
        const [x] = fieldToList(4, [index().mul(2).add(1)])
        const [y] = fieldToList(6, [index().mul(-0.5)])
        const sum = n.Math({operation: 'ADD', value: x, value1: y}).value
        const scaled = n.Math({operation: 'MULTIPLY', value: x, value1: 3}).value
        const asInt = n.IntegerMath({operation: 'MULTIPLY', value: y, value1: 2}).value
        const [ix] = fieldToList(5, [mod(index().mul(3), 7)])
        const picked = n.GetListItem({list: sum, index: ix}).value
        const single = n.GetListItem({list: sum, index: 2}).value as Socket<'FLOAT'>
        let g = storeItems([['sum', sum], ['scaled', scaled], ['as_int', asInt], ['picked', picked]])
        g = n.StoreNamedAttribute({geometry: g, name: 'single', value: single}).geometry
        return g
    })
    add('sort-filter', 'Sort List by weights, groups and a selection (field and list); Filter List with field and list selections', () => {
        const [values, weights, flags] = fieldToList(9, [index().mul(10), n.Math({operation: 'FRACT', value: index().mul(0.37)}).value, mod(index(), 3).eq(0)])
        const byWeight = n.SortList({list: values, sortWeight: weights}).list
        const byGroup = n.SortList({list: values, groupID: mod(index(), 2), sortWeight: index().mul(-1), selection: mod(index(), 4).eq(3).not()}).list
        const byListSel = n.SortList({list: values, sortWeight: weights, selection: flags}).list
        const f = n.FilterList({list: values, selection: mod(index(), 3).eq(1)})
        const g2 = n.FilterList({list: values, selection: flags})
        return storeItems([['w', byWeight], ['g', byGroup], ['s', byListSel], ['f', f.selection], ['fi', f.inverted], ['fl', g2.selection]])
    })
    add('strings', 'Split String and Get Attribute Names: lengths, and items used as attribute names', () => {
        const parts = n.SplitString({string: n.String({string: 'alpha,beta,,gamma,'}).string, separator: n.String({string: ','}).string}).list
        const whole = n.SplitString({string: n.String({string: 'no separator'}).string}).list
        const names = n.GetAttributeNames({geometry: attributed(testMeshes())}).names
        const pointInts = n.GetAttributeNames({geometry: attributed(testMeshes()), filterDataType: true, dataType: 'Integer', filterDomain: true, domain: 'Point'}).names
        let g: Socket<'GEOMETRY'> = n.Points({count: 1}).points
        const len = (name: string, list: AnySocket) => {
            g = n.StoreNamedAttribute({geometry: g, dataType: 'INT', name, value: n.ListLength({dataType: 'STRING', list}).length}).geometry
        }
        len('parts', parts)
        len('whole', whole)
        len('names', names)
        len('point_ints', pointInts)
        for (const [list, k] of [[parts, 0], [parts, 3], [names, 0], [names, 5], [pointInts, 0]] as const) {
            const name = n.GetListItem({socketType: 'STRING', list, index: k}).value as Socket<'STRING'>
            g = n.StoreNamedAttribute({geometry: g, name, value: k + 1}).geometry
        }
        return g
    }, SHAPE_SCENE)
    // Collection Children: objects (cubes / planes moved apart) instanced in the list's order.
    const obj = (name: string, x: number) => ({name, mesh: 'cube' as const, location: [x, 0, 0] as [number, number, number]})
    const scene = [
        {collection: 'Root', objects: [obj('zeta', 0), obj('Alpha', 2)]},
        {collection: 'b10', parent: 'Root', objects: [obj('ten', 4)]},
        {collection: 'b2', parent: 'Root', objects: [obj('two', 6)]},
        {collection: 'c', parent: 'b2', objects: [obj('obj9', 8), obj('obj10', 10)]},
    ]
    for (const recursive of [false, true]) {
        add(`collection-children-${recursive ? 'recursive' : 'direct'}`, `Collection Children (${recursive ? 'recursive' : 'direct'}): natural-sorted collections and objects`, () => {
            const ch = n.CollectionChildren({collection: {_ref: 'COLLECTION', name: 'Root'}, recursive})
            let g: Socket<'GEOMETRY'> = n.Points({count: 1}).points
            g = n.StoreNamedAttribute({geometry: g, dataType: 'INT', name: 'collections', value: n.ListLength({dataType: 'COLLECTION', list: ch.collections}).length}).geometry
            g = n.StoreNamedAttribute({geometry: g, dataType: 'INT', name: 'objects', value: n.ListLength({dataType: 'OBJECT', list: ch.objects}).length}).geometry
            const parts: Socket<'GEOMETRY'>[] = [g]
            for (let i = 0; i < (recursive ? 5 : 2); i++) {
                const o = n.GetListItem({socketType: 'OBJECT', list: ch.objects, index: i}).value as Socket<'OBJECT'>
                const info = n.ObjectInfo({object: o, transformSpace: 'RELATIVE'}).geometry
                parts.push(n.StoreNamedAttribute({geometry: info, dataType: 'INT', name: 'order', value: i}).geometry)
            }
            for (let i = 0; i < (recursive ? 3 : 2); i++) {
                const c = n.GetListItem({socketType: 'COLLECTION', list: ch.collections, index: i}).value as Socket<'COLLECTION'>
                const info = n.CollectionInfo({collection: c, transformSpace: 'RELATIVE'}).instances
                parts.push(n.StoreNamedAttribute({geometry: n.RealizeInstances({geometry: info}).geometry, dataType: 'INT', name: 'corder', value: i}).geometry)
            }
            return n.JoinGeometry({geometry: parts}).geometry
        }, {scene})
    }
    return cases
}
