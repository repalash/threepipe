/**
 * `nodeGroup` - add, replace, list, describe and remove the document's geometry-node groups.
 *
 * Groups are JSON (`NodeTreeJSON`); the DSL's `geometryNodes(...).toJSON()` gives a whole library (a
 * group and every group it uses). Every group is compiled against the ported node types before it is
 * stored, so an unported node or a bad link fails at the command, not at the next bake.
 */

import type {CommandDefinition} from '@threepipe/plugin-modelling'
import {GeometryNodesEvaluator, isInterfaceSocket, NodeGroupLibrary, NodeTreeJSON, toCode} from '@threepipe/plugin-procedural'
import {documentNodeGroups, NODE_GROUPS_KEY} from './geometryNodesModifier'

function describeGroup(library: NodeGroupLibrary, name: string) {
    const t = library[name]
    const sockets = t.interface.filter(isInterfaceSocket)
    return {
        name,
        description: t.description,
        nodes: t.nodes.length,
        inputs: sockets.filter(s => s.inOut === 'INPUT').map(s => ({
            name: s.name, identifier: s.identifier, type: s.socketType, default: s.default,
            min: s.min_value, max: s.max_value, subtype: s.subtype,
        })),
        outputs: sockets.filter(s => s.inOut === 'OUTPUT').map(s => ({name: s.name, identifier: s.identifier, type: s.socketType})),
        uses: t.nodes.filter(n => n.type === 'GeometryNodeGroup').map(n => n.group),
    }
}

export const nodeGroupCommand: CommandDefinition = {
    op: 'nodeGroup',
    summary: 'Manage the document\'s geometry-node groups (Blender Geometry Nodes, ported): add or replace, list, describe, remove.',
    description:
        'Pass `library` (what `geometryNodes(name, g => ...).toJSON()` returns: a group and the groups it uses) or '
        + '`name` with one `tree`. Without either, lists the groups. `describe` returns a group\'s interface (the inputs a '
        + '`geometryNodes` modifier sets) and, with `code: true`, the group as DSL code. Objects whose `geometryNodes` '
        + 'modifiers use a changed group are re-evaluated.',
    mutates: true,
    schema: {
        type: 'object',
        properties: {
            name: {type: 'string', description: 'Group name, for `tree`, `describe` and `remove`.'},
            tree: {type: 'object', description: 'One NodeTreeJSON, stored under `name`.'},
            library: {type: 'object', description: 'Groups by name (NodeGroupLibrary), added or replaced together.'},
            describe: {type: 'boolean', description: 'Return the interface of `name` (or of every group).'},
            code: {type: 'boolean', description: 'With `describe`: include the group as DSL code (`toCode`).'},
            remove: {type: 'boolean', description: 'Remove the group `name`.'},
        },
        required: [],
        additionalProperties: false,
    },
    run(p: {name?: string, tree?: NodeTreeJSON, library?: NodeGroupLibrary, describe?: boolean, code?: boolean, remove?: boolean}, ctx) {
        const current = documentNodeGroups(ctx.doc)
        if (p.library || p.tree) {
            const incoming: NodeGroupLibrary = {...(p.library ?? {})}
            if (p.tree) {
                if (!p.name) throw new Error('`tree` needs a `name`')
                incoming[p.name] = {...p.tree, name: p.name}
            }
            const next = {...current, ...incoming}
            // Compile each new group (and through it the groups it uses) before storing anything.
            for (const name of Object.keys(incoming)) new GeometryNodesEvaluator(next, name)
            ctx.doc.setData(NODE_GROUPS_KEY, next)
            return {data: {groups: Object.keys(next), added: Object.keys(incoming)}}
        }
        if (p.remove) {
            if (!p.name || !current[p.name]) throw new Error(`no node group "${p.name}" (have: ${Object.keys(current).join(', ') || 'none'})`)
            const users = Object.values(current).filter(t => t.nodes.some(n => n.type === 'GeometryNodeGroup' && n.group === p.name))
            if (users.length) throw new Error(`node group "${p.name}" is used by ${users.map(u => u.name).join(', ')}`)
            const next = {...current}
            delete next[p.name]
            ctx.doc.setData(NODE_GROUPS_KEY, next)
            return {data: {groups: Object.keys(next), removed: p.name}}
        }
        const names = p.name ? [p.name] : Object.keys(current)
        for (const n of names) if (!current[n]) throw new Error(`no node group "${n}" (have: ${Object.keys(current).join(', ') || 'none'})`)
        if (p.describe) {
            return {data: names.map(n => ({...describeGroup(current, n), ...(p.code ? {code: toCode(current, n)} : {})}))}
        }
        return {data: {groups: names}}
    },
}
