/**
 * The `geometryNodes` modifier type for `@threepipe/plugin-modelling`: Blender's Geometry Nodes modifier
 * (`MOD_nodes.cc`) on the document's node groups.
 *
 * `{type: 'geometryNodes', group: 'Terrain', inputs: {Size: 20, Seed: 3}}` evaluates the group with the
 * previous stack output as its geometry input. Inputs are keyed by interface socket name or identifier.
 * The modifier's mesh is the realized mesh component of the result (what the next modifier and the
 * renderer get); the whole geometry set is kept as `entry.evaluatedGeometry` for instance/point/curve
 * drawing.
 */

import {MeshData} from '@threepipe/mesh-kernel'
import type {ModifierContext, ModifierType, ModellingDocument} from '@threepipe/plugin-modelling'
import {
    GeometryNodesEvaluator, GeometrySet, isInterfaceSocket, JSONValue, NodeGroupLibrary, realizeInstances,
    SceneProvider,
} from '@threepipe/plugin-procedural'

export const NODE_GROUPS_KEY = 'nodeGroups'

export interface GeometryNodesModifierSpec {
    type: 'geometryNodes'
    /** Name of a node group in the document's `nodeGroups`. */
    group: string
    /** Modifier input values by interface socket name or identifier; missing ones take the socket default. */
    inputs?: Record<string, JSONValue>
    [key: string]: unknown
}

/** The document's node group library (`doc.getData('nodeGroups')`). */
export function documentNodeGroups(doc: ModellingDocument): NodeGroupLibrary {
    return doc.getData<NodeGroupLibrary>(NODE_GROUPS_KEY) ?? {}
}

/** Objects of the document, for Object Info: world matrix and evaluated mesh. */
export function documentScene(doc: ModellingDocument): SceneProvider {
    return {
        object(name) {
            const entry = doc.find(name)
            if (!entry) return undefined
            entry.object.updateMatrixWorld?.()
            return {
                transform: Float32Array.from(entry.object.matrixWorld.elements),
                geometry: GeometrySet.fromMesh(entry.evaluated),
                version: entry.revision,
            }
        },
    }
}

interface CachedEvaluator {
    library: NodeGroupLibrary
    group: string
    evaluator: GeometryNodesEvaluator
}

export const geometryNodesModifierType: ModifierType<GeometryNodesModifierSpec> = {
    type: 'geometryNodes',
    summary: '`{type: "geometryNodes", group, inputs}` (a node group from the `nodeGroup` command; inputs by socket name)',
    properties: {
        group: {type: 'string', description: 'Node group name (see `nodeGroup`).'},
        inputs: {type: 'object', description: 'Input values by interface socket name or identifier.'},
    },
    read(raw) {
        return {type: 'geometryNodes', group: raw.group as string, inputs: {...(raw.inputs as Record<string, JSONValue> ?? {})}}
    },
    check(spec) {
        if (typeof spec.group !== 'string' || !spec.group) throw new Error('a geometryNodes modifier needs a `group` name')
        if (spec.inputs !== undefined && (typeof spec.inputs !== 'object' || Array.isArray(spec.inputs))) {
            throw new Error('a geometryNodes modifier `inputs` must be an object of values by socket name')
        }
    },
    describe(spec) {
        const inputs = Object.entries(spec.inputs ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
        return `geometry nodes "${spec.group}"${inputs ? ` (${inputs})` : ''}`
    },
    evaluate(mesh: MeshData, spec, ctx: ModifierContext) {
        if (!ctx.doc) throw new Error('a geometryNodes modifier is evaluated on a modelling document (it reads its node groups)')
        const library = documentNodeGroups(ctx.doc)
        if (!library[spec.group]) {
            throw new Error(`node group "${spec.group}" does not exist - add it with {op: "nodeGroup", ...}`
                + ` (have: ${Object.keys(library).join(', ') || 'none'})`)
        }
        // One evaluator per stack slot, rebuilt when the library or group changes, so an input change
        // re-runs only what depends on it (red-green caching inside the evaluator).
        const key = `geometryNodes:${ctx.index}`
        let cached = ctx.state.get(key) as CachedEvaluator | undefined
        if (!cached || cached.library !== library || cached.group !== spec.group) {
            cached = {library, group: spec.group, evaluator: new GeometryNodesEvaluator(library, spec.group, {scene: documentScene(ctx.doc), selfObject: ctx.entry?.name})}
            ctx.state.set(key, cached)
        }
        const ev = cached.evaluator
        // Inputs not given return to their defaults, so removing a key from `inputs` is undone too.
        const given = spec.inputs ?? {}
        for (const s of ev.interfaceInputs.filter(isInterfaceSocket)) {
            if (s.socketType.startsWith('NodeSocketGeometry')) continue
            const v = given[s.identifier] ?? given[s.name]
            ev.setInput(s.identifier, (v ?? s.default ?? null) as JSONValue)
        }
        for (const k of Object.keys(given)) {
            if (!ev.interfaceInputs.some(s => s.identifier === k || s.name === k)) {
                throw new Error(`node group "${spec.group}" has no input "${k}" (inputs: ${ev.interfaceInputs.map(s => s.name).join(', ')})`)
            }
        }
        // The master can be edited in place between evaluations, so the input geometry is always new.
        ev.setInputGeometry(GeometrySet.fromMesh(mesh.clone()))
        const result = ev.evaluate()
        const geometry = result.geometry ?? new GeometrySet()
        const realized = realizeInstances(geometry, {scene: documentScene(ctx.doc)})
        return {mesh: realized.mesh ?? new MeshData(), geometry}
    },
}
