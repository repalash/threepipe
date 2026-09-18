/**
 * `THREEPIPE_mesh_topology` - carry editable n-gon topology through a glTF round trip.
 *
 * Without this, everything built through the command API is lossy the moment it is saved: the
 * exporter writes the baked triangles, and reloading gives you a triangle soup with renumbered
 * vertices, so the indices `vertices` and `transform` address stop meaning anything. That is the same
 * failure the blend importer has historically had, one file format along.
 *
 * The extension is additive. The mesh primitive stays an ordinary triangulated glTF mesh, so any
 * other viewer sees exactly what it saw before; this adds accessors alongside it holding the
 * `MeshData` the triangles were baked *from*, plus the live modifier stack as JSON. A reader that
 * does not know the extension ignores it, as glTF intends.
 *
 * ## What is stored, and what is not
 *
 * - **The master mesh, not the evaluated one.** An object with a live array modifier keeps a small
 *   editable master and a large evaluated copy; storing the evaluated copy would bake the stack and
 *   throw away the thing you actually edit. The modifier list travels with it and is re-evaluated on
 *   load, so the render result is identical either way.
 * - **Positions, edges, corners and face offsets**, plus every attribute layer that is not derivable.
 * - **Not `.corner_edge`.** It is exactly recoverable from the corner vertices and the edge set by
 *   `calculateCornerEdges()`, and storing it would mean writing a `-1` sentinel that glTF's unsigned
 *   accessor types cannot hold. Derived on load instead.
 *
 * Index arrays are written as `UNSIGNED_INT`: every one of them is non-negative, and three's exporter
 * would otherwise emit component type 5124, which is not in core glTF 2.0 and which the Khronos
 * validator rejects.
 */

import type {GLTF, GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type {GLTFExporterPlugin, GLTFWriter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {BufferAttribute, IObject3D, Object3D} from 'threepipe'
import {
    ATTR_TYPE_INFO,
    AttrDomain,
    AttrName,
    AttrType,
    MeshData,
} from '@threepipe/mesh-kernel'
import type {ModifierSpec} from '../modifiers'

/** What the extension writes into the glTF mesh definition. */
export interface MeshTopologyExtensionDef {
    /** Accessor index: flat xyz, one per vertex. */
    positions: number
    /** Accessor index: vertex-index pairs, one per edge. */
    edgeVerts: number
    /** Accessor index: vertex index per corner. */
    cornerVerts: number
    /** Accessor index: `facesNum + 1` corner offsets. */
    faceOffsets: number
    /** Every other attribute layer, by name. */
    attributes?: Record<string, {accessor: number, domain: AttrDomain, type: AttrType}>
    /** Material slot names, so `material_index` still means something. */
    materials?: string[]
    /** The live modifier stack, small enough to sit in the JSON. */
    modifiers?: ModifierSpec[]
}

/** Callbacks the host plugin supplies, so this file knows nothing about the document. */
export interface MeshTopologyHooks {
    /** The editable master mesh for an object, or null if it has none. */
    read(object: Object3D): {mesh: MeshData, modifiers: ModifierSpec[]} | null
    /** Called on import for every object that carried topology. */
    write(object: IObject3D, mesh: MeshData, modifiers: ModifierSpec[]): void
}

export const MESH_TOPOLOGY_EXTENSION = 'THREEPIPE_mesh_topology'

/**
 * Where restored topology is left when no host claims it.
 *
 * A `.glb` written by the modelling plugin should still be loadable by an app that does not have the
 * plugin, without silently dropping what it carried - so the mesh lands here and can be picked up
 * later.
 */
export const MESH_TOPOLOGY_USERDATA = '__meshTopology'

export class GLTFMeshTopologyExtension {
    static readonly Name = MESH_TOPOLOGY_EXTENSION

    constructor(private _hooks: MeshTopologyHooks) {}

    /** The `{name, import, export}` triple `assetManager.registerGltfExtension` wants. */
    get extension() {
        // `unregisterGltfExtension` removes the exporter hook by matching the *factory function's*
        // `.name` against the extension name, so a factory not named after its extension can never
        // be removed. None of the built-ins satisfy that; filed as
        // issues/open/unregister-gltf-extension-matches-function-name.md. Naming it explicitly here
        // means this one at least comes off cleanly when the plugin is removed.
        Object.defineProperty(this._export, 'name', {value: MESH_TOPOLOGY_EXTENSION, configurable: true})
        return {
            name: MESH_TOPOLOGY_EXTENSION,
            import: this._import,
            export: this._export,
            textures: undefined,
        }
    }

    // region export

    private _export = (writer: GLTFWriter): GLTFExporterPlugin => ({
        writeMesh: (object: Object3D, meshDef: any) => {
            const source = this._hooks.read(object)
            if (!source) return
            const def = writeTopology(writer, source.mesh, source.modifiers)
            if (!def) return
            if (!meshDef.extensions) meshDef.extensions = {}
            meshDef.extensions[MESH_TOPOLOGY_EXTENSION] = def
            writer.extensionsUsed[MESH_TOPOLOGY_EXTENSION] = true
        },
    })

    // endregion

    // region import

    private _import = (parser: GLTFParser): GLTFLoaderPlugin => ({
        // The `__` prefix keeps the raw extension JSON in userData so it can be read in afterRoot,
        // which is the only point at which the objects exist. Same trick as GLTFObject3DExtras.
        name: '__' + MESH_TOPOLOGY_EXTENSION,
        afterRoot: async(result: GLTF) => {
            const scenes = result.scenes || (result.scene ? [result.scene] : [])
            const pending: Promise<void>[] = []
            for (const scene of scenes) {
                scene.traverse((object: Object3D) => {
                    const def = readExtensionDef(parser, object)
                    if (def) pending.push(this._restore(parser, object as IObject3D, def))
                })
            }
            await Promise.all(pending)
        },
    })

    private async _restore(parser: GLTFParser, object: IObject3D, def: MeshTopologyExtensionDef) {
        try {
            const mesh = await readTopology(parser, def)
            this._hooks.write(object, mesh, def.modifiers ?? [])
        } catch (e) {
            // A malformed extension must not take the whole load down with it: the triangles are
            // still there and still correct, only the editable form is lost.
            console.error(`${MESH_TOPOLOGY_EXTENSION}: could not restore topology for `
                + `"${object.name}"`, e)
            object.userData[MESH_TOPOLOGY_USERDATA] = {error: (e as Error).message}
        }
    }

    // endregion
}

// region serialisation

/** glTF accessors cannot hold a signed 32-bit integer, and every index here is non-negative. */
function toUnsigned(data: ArrayLike<number>, what: string): Uint32Array {
    const out = new Uint32Array(data.length)
    for (let i = 0; i < data.length; i++) {
        const v = data[i]
        if (v < 0) throw new Error(`${MESH_TOPOLOGY_EXTENSION}: ${what} has a negative value (${v})`)
        out[i] = v
    }
    return out
}

function accessorFor(writer: GLTFWriter, array: ArrayLike<number> & ArrayBufferView, itemSize: number): number {
    const attribute = new BufferAttribute(array as never, itemSize)
    // `processAccessor` is part of the writer's plugin contract but is missing from three's types.
    const index = (writer as unknown as {
        processAccessor(a: unknown): number | null
    }).processAccessor(attribute)
    if (index === null || index === undefined) {
        throw new Error(`${MESH_TOPOLOGY_EXTENSION}: the exporter refused an accessor`)
    }
    return index
}

export function writeTopology(
    writer: GLTFWriter, mesh: MeshData, modifiers: ModifierSpec[],
): MeshTopologyExtensionDef | null {
    if (mesh.isEmpty) return null

    const def: MeshTopologyExtensionDef = {
        positions: accessorFor(writer, mesh.positions, 3),
        edgeVerts: accessorFor(writer, toUnsigned(mesh.edgeVerts, '.edge_verts'), 2),
        cornerVerts: accessorFor(writer, toUnsigned(mesh.cornerVerts, '.corner_vert'), 1),
        faceOffsets: accessorFor(writer, toUnsigned(mesh.faceOffsets, 'faceOffsets'), 1),
    }

    const attributes: MeshTopologyExtensionDef['attributes'] = {}
    for (const layer of mesh.attributes.layers()) {
        // The four required layers are already written above, and `.corner_edge` is derived on load.
        if (layer.name === AttrName.position || layer.name === AttrName.edgeVerts
            || layer.name === AttrName.cornerVert || layer.name === AttrName.cornerEdge) continue

        const {components} = ATTR_TYPE_INFO[layer.type]
        const array = layer.data instanceof Int32Array
            ? toUnsigned(layer.data, layer.name)
            : layer.data
        attributes[layer.name] = {
            accessor: accessorFor(writer, array as never, components),
            domain: layer.domain,
            type: layer.type,
        }
    }
    if (Object.keys(attributes).length) def.attributes = attributes
    if (mesh.materials.length) def.materials = [...mesh.materials]
    if (modifiers.length) def.modifiers = modifiers.map(m => ({...m}))

    return def
}

function readExtensionDef(parser: GLTFParser, object: Object3D): MeshTopologyExtensionDef | null {
    const extensions = (object.userData as any)?.gltfExtensions
    const def = extensions?.[MESH_TOPOLOGY_EXTENSION]
    if (!def) return null
    delete extensions[MESH_TOPOLOGY_EXTENSION]
    void parser
    return def as MeshTopologyExtensionDef
}

export async function readTopology(
    parser: GLTFParser, def: MeshTopologyExtensionDef,
): Promise<MeshData> {
    const get = async(index: number) => {
        const attribute = await parser.getDependency('accessor', index) as {array: ArrayLike<number>}
        if (!attribute?.array) throw new Error(`accessor ${index} is missing`)
        return attribute.array
    }

    const [positions, edgeVerts, cornerVerts, faceOffsets] = await Promise.all([
        get(def.positions), get(def.edgeVerts), get(def.cornerVerts), get(def.faceOffsets),
    ])

    const mesh = new MeshData()
    const facesNum = Math.max(0, faceOffsets.length - 1)
    mesh.resize({
        verts: Math.floor(positions.length / 3),
        edges: Math.floor(edgeVerts.length / 2),
        faces: facesNum,
        corners: cornerVerts.length,
    })

    mesh.positions.set(positions as never)
    mesh.edgeVerts.set(edgeVerts as never)
    mesh.cornerVerts.set(cornerVerts as never)
    for (let i = 0; i <= facesNum; i++) mesh.faceOffsets[i] = faceOffsets[i]

    for (const [name, spec] of Object.entries(def.attributes ?? {})) {
        const data = await get(spec.accessor)
        const layer = mesh.attributes.ensure(name, spec.domain, spec.type)
        layer.data.set(data as never)
    }

    if (def.materials) mesh.materials = [...def.materials]

    // `.corner_edge` was deliberately not stored: it is exactly recoverable from the corner vertices
    // and the edge set, and deriving it here cannot disagree with what was written.
    mesh.calculateCornerEdges()

    const problems = mesh.validate()
    if (problems.length) {
        throw new Error(`restored topology is invalid: ${problems[0]}`
            + (problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''))
    }
    return mesh
}

// endregion
