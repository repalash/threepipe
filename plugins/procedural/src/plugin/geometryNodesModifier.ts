/**
 * The `geometryNodes` modifier type for `@threepipe/plugin-modelling`: Blender's Geometry Nodes modifier
 * (`MOD_nodes.cc`) on the document's node groups.
 *
 * `{type: 'geometryNodes', group: 'Terrain', inputs: {Size: 20, Seed: 3}}` evaluates the group with the
 * previous stack output as its geometry input. Inputs are keyed by interface socket name or identifier.
 * An input can read a mesh attribute instead: `{attribute: 'UVMap'}`. The modifier's mesh is the result's mesh
 * component (what the next modifier and the renderer get); instances, points and curves are kept as
 * `entry.evaluatedGeometry` (ProceduralPlugin draws them) and realized when the stack is applied.
 */

import {MeshData} from '@threepipe/mesh-kernel'
import type {ModifierContext, ModifierType, ModellingDocument} from '@threepipe/plugin-modelling'
import {
    AttributeFieldInput, copyMesh, GeometryNodesEvaluator, GeometrySet, GField, isInterfaceSocket, JSONValue, NodeGroupLibrary,
    realizeInstances, newMeshData, SceneProvider, socketDataType, socketTypeFromIdname,
} from '@threepipe/plugin-procedural'

export const NODE_GROUPS_KEY = 'nodeGroups'

export type ModifierInputValue = JSONValue | {attribute: string}

export interface GeometryNodesModifierSpec {
    type: 'geometryNodes'
    /** Name of a node group in the document's `nodeGroups`. */
    group: string
    /**
     * Modifier input values by interface socket name or identifier; missing ones take the socket default. A field input
     * can read a mesh attribute instead: `{attribute: 'UVMap'}`.
     */
    inputs?: Record<string, ModifierInputValue>
    [key: string]: unknown
}

/** The document's node group library (`doc.getData('nodeGroups')`). */
export function documentNodeGroups(doc: ModellingDocument): NodeGroupLibrary {
    return doc.getData<NodeGroupLibrary>(NODE_GROUPS_KEY) ?? {}
}

/**
 * Scenes linked into every document's geometry nodes besides the document's own objects: the objects, collections
 * and images of loaded Blender bundles (`blendAsset`), like Blender's linked library data. Their transforms are in
 * Blender's (Z-up) world.
 */
const linkedScenes: SceneProvider[] = []

export function linkScene(scene: SceneProvider): void {
    if (!linkedScenes.includes(scene)) linkedScenes.push(scene)
}

export function unlinkScene(scene: SceneProvider): void {
    const i = linkedScenes.indexOf(scene)
    if (i >= 0) linkedScenes.splice(i, 1)
}

/**
 * threepipe's Y-up world from Blender's Z-up one (`RotX(-90deg)`, the conversion the modelling commands make), so
 * graphs see document objects in Blender's world like linked ones: `blender = Y_TO_Z * three`.
 */
const Y_TO_Z = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]

function mul4(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
    const out = new Float32Array(16)
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
    return out
}

/**
 * Objects of the document (world matrix in Blender's Z-up world, evaluated geometry), then the linked scenes, for
 * Object Info, Collection Info and Image Texture.
 */
export function documentScene(doc: ModellingDocument): SceneProvider {
    return {
        object(name) {
            const entry = doc.find(name)
            if (!entry) {
                for (const s of linkedScenes) {
                    const o = s.object?.(name)
                    if (o) return o
                }
                return undefined
            }
            entry.object.updateMatrixWorld?.()
            const extra = entry.evaluatedGeometry
            const geometry = extra instanceof GeometrySet ? extra.copy() : new GeometrySet()
            geometry.setMesh(entry.evaluated, true)
            return {
                transform: mul4(Y_TO_Z, entry.object.matrixWorld.elements),
                geometry,
                version: entry.revision,
            }
        },
        collection(name) {
            for (const s of linkedScenes) {
                const c = s.collection?.(name)
                if (c) return c
            }
            return undefined
        },
        image(name) {
            for (const s of linkedScenes) {
                const i = s.image?.(name)
                if (i) return i
            }
            return undefined
        },
    }
}

/** A modifier input reading a mesh attribute (Blender's "use attribute" toggle on a field input): `{attribute: name}`. */
function isAttributeInput(v: unknown): v is {attribute: string} {
    return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as {attribute?: unknown}).attribute === 'string'
}

interface CachedEvaluator {
    library: NodeGroupLibrary
    group: string
    evaluator: GeometryNodesEvaluator
    attributeFields: Map<string, GField>
}

export const geometryNodesModifierType: ModifierType<GeometryNodesModifierSpec> = {
    type: 'geometryNodes',
    summary: '`{type: "geometryNodes", group, inputs}` (a node group from the `nodeGroup` command; inputs by socket name)',
    properties: {
        group: {type: 'string', description: 'Node group name (see `nodeGroup`).'},
        inputs: {type: 'object', description: 'Input values by interface socket name or identifier.'},
    },
    read(raw) {
        return {type: 'geometryNodes', group: raw.group as string, inputs: {...(raw.inputs as Record<string, ModifierInputValue> ?? {})}}
    },
    check(spec) {
        if (typeof spec.group !== 'string' || !spec.group) throw new Error('a geometryNodes modifier needs a `group` name')
        if (spec.inputs !== undefined && (typeof spec.inputs !== 'object' || Array.isArray(spec.inputs))) {
            throw new Error('a geometryNodes modifier `inputs` must be an object of values by socket name')
        }
    },
    // The group's interface inputs (not the geometry) as fields; an edit updates `inputs` by socket name.
    fields(spec, doc) {
        const tree = doc ? documentNodeGroups(doc)[spec.group] : undefined
        if (!tree) return undefined
        const properties: Record<string, unknown> = {}
        const values: Record<string, unknown> = {}
        for (const s of tree.interface.filter(isInterfaceSocket).filter(i => i.inOut === 'INPUT')) {
            const type = socketTypeFromIdname(s.socketType)
            // An input reading an attribute is not a value to edit here.
            if (isAttributeInput(spec.inputs?.[s.name] ?? spec.inputs?.[s.identifier])) continue
            const def: Record<string, unknown> = {description: s.description || undefined, default: s.default}
            if (type === 'FLOAT' || type === 'INT') {
                def.type = type === 'INT' ? 'integer' : 'number'
                if (s.min_value !== undefined && Math.abs(s.min_value) < 1e30) def.minimum = s.min_value
                if (s.max_value !== undefined && Math.abs(s.max_value) < 1e30) def.maximum = s.max_value
            } else if (type === 'BOOLEAN') def.type = 'boolean'
            else if (type === 'VECTOR' || type === 'ROTATION') Object.assign(def, {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3})
            else if (type === 'STRING' || type === 'MENU') def.type = 'string'
            else continue
            properties[s.name] = def
            const v = spec.inputs?.[s.name] ?? spec.inputs?.[s.identifier]
            values[s.name] = v ?? s.default
        }
        return {
            schema: {type: 'object', properties},
            values,
            // Only inputs already set or now differing from their default are written, so the spec stays minimal.
            update: next => {
                const inputs: Record<string, ModifierInputValue> = {...(spec.inputs ?? {})}
                for (const [k, v] of Object.entries(next)) {
                    const d = (properties[k] as {default?: unknown}).default
                    if (k in inputs || JSON.stringify(v) !== JSON.stringify(d)) inputs[k] = v as JSONValue
                }
                return {inputs}
            },
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
            cached = {library, group: spec.group, evaluator: new GeometryNodesEvaluator(library, spec.group, {scene: documentScene(ctx.doc), selfObject: ctx.entry?.name}), attributeFields: new Map()}
            ctx.state.set(key, cached)
        }
        const ev = cached.evaluator
        // Inputs not given return to their defaults, so removing a key from `inputs` is undone too.
        const given = spec.inputs ?? {}
        for (const s of ev.interfaceInputs.filter(isInterfaceSocket)) {
            if (s.socketType.startsWith('NodeSocketGeometry')) continue
            const v = given[s.identifier] ?? given[s.name]
            if (isAttributeInput(v)) {
                // The same field object while the name stays, so the evaluator reuses what depends on it.
                const dt = socketDataType(socketTypeFromIdname(s.socketType))
                if (!dt) throw new Error(`modifier input "${s.name}" is not a field input, it cannot read attribute "${v.attribute}"`)
                const fieldKey = `${s.identifier}:${v.attribute}:${dt}`
                let field = cached.attributeFields.get(fieldKey)
                if (!field) cached.attributeFields.set(fieldKey, field = GField.fromInput(new AttributeFieldInput(v.attribute, dt)))
                ev.setInput(s.identifier, field)
                continue
            }
            ev.setInput(s.identifier, (v ?? s.default ?? null) as JSONValue)
        }
        for (const k of Object.keys(given)) {
            if (!ev.interfaceInputs.some(s => s.identifier === k || s.name === k)) {
                throw new Error(`node group "${spec.group}" has no input "${k}" (inputs: ${ev.interfaceInputs.map(s => s.name).join(', ')})`)
            }
        }
        // The stack passes the whole geometry down (Blender's geometry set): what an earlier geometry-nodes modifier
        // made besides the mesh, with the mesh as the modifiers in between left it. The master can be edited in
        // place between evaluations, so the input mesh is always a copy.
        const previous = ctx.previous?.geometry
        const input = previous instanceof GeometrySet ? previous.copy() : new GeometrySet()
        input.setMesh(copyMesh(mesh))
        ev.setInputGeometry(input)
        const result = ev.evaluate()
        const geometry = result.geometry ?? new GeometrySet()
        // The evaluated mesh is the mesh component, as Blender's evaluated mesh; instances, points and curves stay in
        // `geometry` for the renderer (ProceduralPlugin draws them) and are realized only when the stack is applied
        // (Blender's apply realizes instances).
        const rest = geometry.copy()
        rest.remove('mesh')
        const scene = documentScene(ctx.doc)
        const hasRest = !rest.isEmpty
        return {
            mesh: geometry.mesh ?? newMeshData(),
            geometry: hasRest ? rest : undefined,
            realize: hasRest ? (final: MeshData) => {
                const g = rest.copy()
                g.setMesh(copyMesh(final))
                return realizeInstances(g, {scene}).mesh ?? newMeshData()
            } : undefined,
        }
    },
}
