/**
 * `blendAsset` - bring an object of a Blender file into the modelling document with its geometry-nodes stack, from a
 * runtime bundle (`porting/blender/bundle_dump.py`): the mesh that enters the first nodes modifier becomes the object,
 * the bundle's node groups join the document's, each nodes modifier becomes a `geometryNodes` modifier with the file's
 * input values, and the objects / collections / images the graphs refer to are linked (`linkScene`), as Blender links
 * library data. Nothing Blender evaluated is read: the stack runs here and its inputs stay editable.
 */

import type {CommandDefinition, ModellingDocument} from '@threepipe/plugin-modelling'
import {
    binResolver, DumpV2, dumpTime, geometryFromDump, GeometryNodesEvaluator, importBlenderDump, JSONValue, NodeGroupLibrary,
    sceneFromDump, SceneProvider,
} from '@threepipe/plugin-procedural'
import {documentNodeGroups, linkScene, ModifierInputValue, NODE_GROUPS_KEY} from './geometryNodesModifier'
import type {MaterialDisplay} from './GeometrySetRenderer'

export interface BlendBundle {
    json: DumpV2
    bin: ArrayBuffer | Uint8Array
}

/** Material display colours of every linked bundle, by name (for the instance renderer). */
export const linkedMaterials: Record<string, MaterialDisplay> = {}

/** One linked scene per bundle, so loading several objects of a file links its data once. */
const linkedByBundle = new WeakMap<DumpV2, SceneProvider>()

/** Fetch `bundle.json` and `bundle.bin` from a bundle directory URL. */
export async function fetchBlendBundle(url: string): Promise<BlendBundle> {
    const base = url.endsWith('/') ? url : `${url}/`
    const get = async(name: string) => {
        const r = await fetch(new URL(name, new URL(base, globalThis.location?.href ?? 'http://localhost/')))
        if (!r.ok) throw new Error(`${r.status} loading ${base}${name} (make bundles with porting/blender/bundle_dump.py)`)
        return r
    }
    const [json, bin] = await Promise.all([get('bundle.json').then(r => r.json()), get('bundle.bin').then(r => r.arrayBuffer())])
    return {json, bin}
}

/** threepipe's Y-up world from Blender's Z-up world (`RotX(-90deg)`, as the modelling commands convert), column-major. */
const Z_TO_Y = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]

function mul4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
    const out = new Array<number>(16)
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
    return out
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/**
 * Add `objectName` (default: the first object with an enabled nodes modifier) of a bundle to the document: returns
 * the new object's name.
 */
export function addBlendObject(doc: ModellingDocument, bundle: BlendBundle, objectName?: string): {name: string, modifiers: number, warnings: string[]} {
    const warnings: string[] = []
    const json = bundle.json
    const object = objectName === undefined
        ? json.objects.find(o => o.modifiers.some(m => m.type === 'NODES' && m.enabled))
        : json.objects.find(o => o.name === objectName)
    if (!object) throw new Error(objectName ? `the bundle has no object "${objectName}" (objects: ${json.objects.map(o => o.name).join(', ')})`
        : 'the bundle has no object with a geometry-nodes modifier')
    const enabled = object.modifiers.filter(m => m.enabled)
    const first = enabled.findIndex(m => m.type === 'NODES')
    if (first < 0) throw new Error(`"${object.name}" has no enabled geometry-nodes modifier`)
    const stack = enabled.slice(first)
    const other = stack.filter(m => m.type !== 'NODES')
    if (other.length) throw new Error(`"${object.name}": modifiers after the first geometry-nodes one are not ported (${other.map(m => m.type).join(', ')})`)
    const time = dumpTime(json)
    if (time && (time.ctime !== 1 || time.frameRate !== 24)) {
        // Scene Time in the document is Blender's new-scene time (frame 1, 24 fps): said, not silently different.
        warnings.push(`"${json.blend_file}" was saved at frame ${time.ctime} (${time.frameRate} fps); Scene Time reads frame 1 at 24 fps here`)
    }

    const resolve = binResolver({'bundle.bin': bundle.bin})
    let scene = linkedByBundle.get(json)
    if (!scene) {
        scene = sceneFromDump(json.referenced!, resolve)
        linkedByBundle.set(json, scene)
        linkScene(scene)
        Object.assign(linkedMaterials, (json.referenced as {materials?: Record<string, MaterialDisplay>}).materials ?? {})
    }

    // Node groups: the bundle's join the document's (compiled first, like the nodeGroup command).
    const {library} = importBlenderDump(json)
    const next: NodeGroupLibrary = {...documentNodeGroups(doc), ...library}
    for (const m of stack) new GeometryNodesEvaluator(next, m.nodeGroup!)
    doc.setData(NODE_GROUPS_KEY, next)

    // The object: the geometry entering the first nodes modifier, at its world transform turned into Y-up.
    const mesh = geometryFromDump(object.input_geometry!, resolve).mesh
    if (!mesh) throw new Error(`"${object.name}": the geometry entering the modifier has no mesh`)
    const entry = doc.add(mesh, {name: doc.uniqueName(object.name)})
    const o = entry.object
    o.matrix.fromArray(mul4(Z_TO_Y, object.matrix_world ?? IDENTITY)).decompose(o.position, o.quaternion, o.scale)
    o.updateMatrixWorld?.()

    // The stack: each nodes modifier with the file's input values (attribute inputs as `{attribute}`).
    entry.modifiers = stack.map(m => {
        const inputs: Record<string, ModifierInputValue> = {}
        for (const [identifier, input] of Object.entries(m.inputs ?? {})) {
            if (input.socketType?.startsWith('NodeSocketGeometry')) continue
            if (input.type === 'ATTRIBUTE' && input.attribute_name) inputs[identifier] = {attribute: input.attribute_name}
            else if (input.value !== undefined) inputs[identifier] = input.value as JSONValue
        }
        const outputs = Object.fromEntries(Object.entries(m.outputs ?? {}).map(([identifier, o]) => [identifier, o.attribute_name]))
        return Object.keys(outputs).length ? {type: 'geometryNodes', group: m.nodeGroup!, inputs, outputs} : {type: 'geometryNodes', group: m.nodeGroup!, inputs}
    })
    doc.rebake(entry)
    return {name: entry.name, modifiers: entry.modifiers.length, warnings}
}

export const blendAssetCommand: CommandDefinition = {
    op: 'blendAsset',
    summary: 'Add an object of a Blender file with its geometry-nodes modifiers, from a runtime bundle (`url` of its directory).',
    description:
        'The bundle (`porting/blender/bundle_dump.py`) holds the mesh entering the first geometry-nodes modifier, the node '
        + 'groups, the modifier input values and the objects, collections and images the graphs read. The object is added '
        + 'with a `geometryNodes` modifier per Blender nodes modifier (inputs editable with `modifier update`), the groups '
        + 'join `nodeGroup`, and the referenced data is linked for Object Info, Collection Info and Image Texture. Instances '
        + 'are drawn as instances; `modifier apply` realizes them.',
    mutates: true,
    schema: {
        type: 'object',
        properties: {
            url: {type: 'string', description: 'URL of the bundle directory (bundle.json + bundle.bin).'},
            object: {type: 'string', description: 'The Blender object to add. Default: the first one with a geometry-nodes modifier.'},
        },
        required: ['url'],
        additionalProperties: false,
    },
    async run(p: {url: string, object?: string}, ctx) {
        const bundle = await fetchBlendBundle(p.url)
        const added = addBlendObject(ctx.doc, bundle, p.object)
        added.warnings.forEach(w => ctx.warn(w))
        return {objects: [added.name], data: {name: added.name, modifiers: added.modifiers}}
    },
}
