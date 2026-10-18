/**
 * The modelling document: the objects a script or an agent has built, and the kernel mesh behind
 * each one.
 *
 * threepipe's scene graph is the source of truth for *placement* - transforms, parenting, materials,
 * visibility - and this document is the source of truth for *topology*. Every object here keeps its
 * `MeshData`, so a later command can edit vertex 37 or array the thing without having to reverse a
 * triangle buffer back into n-gons.
 *
 * It also records changes. Any mutation goes through {@link record} first, which is what lets the
 * history stack undo a command without every command having to implement its own undo.
 */

import {
    BufferAttribute,
    BufferGeometry2,
    Color,
    IObject3D,
    Mesh2,
    PhysicalMaterial,
    safeSetProperty,
    ThreeViewer,
} from 'threepipe'
import {bakeGeometry, geometryDataToBufferGeometry, MeshData, meshDataFromTriangles} from '@threepipe/mesh-kernel'
import {evaluateModifierStack, ModifierSpec} from './modifiers'

/** A mesh object under the document's management. */
export interface ModellingEntry {
    /** Stable within the document, handed back in every result. Blender-ish: unique, not reused. */
    id: string
    /** The user-facing name. Unique within the document; collisions get a `.001` suffix. */
    name: string
    /** The scene object. Its geometry is baked from {@link mesh}. */
    object: IObject3D
    /**
     * Canonical n-gon topology - the *master*. This is what commands edit and what vertex indices
     * refer to, whether or not a modifier stack sits on top of it.
     */
    mesh: MeshData
    /** Live modifiers applied on top of {@link mesh}. See `modifiers.ts`. */
    modifiers: ModifierSpec[]
    /** What the renderer draws: the master run through the stack. Equals `mesh` when it is empty. */
    evaluated: MeshData
    /**
     * Richer output of the last modifier, when its type produces one (instances, points, curves of a
     * `geometryNodes` modifier). Opaque here; the registering package draws it.
     */
    evaluatedGeometry?: unknown
    /** {@link ModifierResult.realize} of the stack: what applying it bakes from {@link evaluated}. */
    evaluatedRealize?: (mesh: MeshData) => MeshData
    /** Per-entry state modifier types keep between evaluations (see `ModifierContext.state`). */
    modifierState?: Map<string, unknown>
    /** Bumped on every topology or position change, so callers can tell what is stale. */
    revision: number
}

/**
 * The material properties the `material` command sets - all of them, so an undo gives back every one.
 * `color` is the linear RGB the material holds, not a hex string, so restoring it is exact.
 */
export interface MaterialSnapshot {
    color: [number, number, number]
    metalness: number
    roughness: number
    opacity: number
    transparent: boolean
    flatShading: boolean
    wireframe: boolean
}

/**
 * A restorable snapshot of one object. `null` `mesh` means the object did not exist.
 *
 * Every field holds the value the object holds, not one derived from it - the rotation is the
 * quaternion, not Euler angles re-derived from it - so restoring a snapshot reproduces the object
 * exactly, and a redo is a replay rather than an approximation.
 */
export interface EntrySnapshot {
    kind?: 'entry'
    id: string
    name: string
    mesh: MeshData | null
    modifiers: ModifierSpec[]
    position: [number, number, number]
    /** `object.quaternion`, `[x, y, z, w]`. */
    quaternion: [number, number, number, number]
    scale: [number, number, number]
    visible: boolean
    parentId: string | null
    material: MaterialSnapshot | null
    /** The object's and material's UUIDs, so an object revived by undo is the same object to a file. */
    uuid?: string
    materialUuid?: string
}

/** The `material` command's properties of a material, or null when it has none of them. */
export function snapshotMaterial(mat: PhysicalMaterial | undefined): MaterialSnapshot | null {
    if (!mat?.color) return null
    return {
        color: mat.color.toArray() as [number, number, number],
        metalness: mat.metalness,
        roughness: mat.roughness,
        opacity: mat.opacity,
        transparent: mat.transparent,
        flatShading: mat.flatShading,
        wireframe: mat.wireframe,
    }
}

/** Write a {@link MaterialSnapshot} back. */
export function applyMaterial(mat: PhysicalMaterial | undefined, snap: MaterialSnapshot | null): void {
    if (!mat?.color || !snap) return
    mat.color.fromArray(snap.color)
    mat.metalness = snap.metalness
    mat.roughness = snap.roughness
    mat.opacity = snap.opacity
    mat.transparent = snap.transparent
    // `needsUpdate` through threepipe's setDirty: flat shading and wireframe change the program.
    if (mat.flatShading !== snap.flatShading || mat.wireframe !== snap.wireframe) mat.needsUpdate = true
    mat.flatShading = snap.flatShading
    mat.wireframe = snap.wireframe
    mat.setDirty?.()
}

/** Exact equality of two meshes: face offsets, material slots, selection state and every attribute layer. */
export function meshDataEqual(a: MeshData, b: MeshData): boolean {
    if (a === b) return true
    if (a.faceOffsets.length !== b.faceOffsets.length || a.faceOffsets.some((x, i) => x !== b.faceOffsets[i])) return false
    if (a.materials.length !== b.materials.length || a.materials.some((x, i) => x !== b.materials[i])) return false
    if (JSON.stringify(a.select) !== JSON.stringify(b.select)) return false
    const la = a.attributes.layers(), lb = b.attributes.layers()
    if (la.length !== lb.length) return false
    for (const x of la) {
        const y = b.attributes.get(x.name)
        if (!y || y.domain !== x.domain || y.type !== x.type || y.data.length !== x.data.length) return false
        // Object.is, so -0 and 0 count as different, as they are different bits in the file.
        for (let i = 0; i < x.data.length; i++) if (!Object.is(x.data[i], y.data[i])) return false
    }
    return true
}

/** Whether two snapshots of the same object describe the same state - i.e. a command changed nothing. */
export function snapshotsEqual(a: EntrySnapshot, b: EntrySnapshot): boolean {
    if (a.id !== b.id || a.name !== b.name || a.visible !== b.visible || a.parentId !== b.parentId) return false
    if (!a.mesh || !b.mesh) {
        if (a.mesh !== b.mesh) return false
    } else if (!meshDataEqual(a.mesh, b.mesh)) return false
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
    return same(a.modifiers, b.modifiers) && same(a.position, b.position) && same(a.quaternion, b.quaternion)
        && same(a.scale, b.scale) && same(a.material, b.material)
}

/** What {@link ModellingDocument.importObject} did with one mesh. */
export interface ImportedObject {
    name: string
    /** `topology`: already editable (kernel-made, or a glTF with `THREEPIPE_mesh_topology`); `welded`: recovered from triangles. */
    source: 'topology' | 'welded'
    /** Vertices the weld merged away. */
    welded: number
    verts: number
    edges: number
    faces: number
}

/** A buffer attribute's values as a flat array, de-interleaving when needed. */
function attributeArray(attr: {array: ArrayLike<number>, count: number, itemSize: number, isInterleavedBufferAttribute?: boolean, getComponent?: (i: number, k: number) => number, getX(i: number): number, getY(i: number): number, getZ(i: number): number}, size: 2 | 3): ArrayLike<number> {
    if (!attr.isInterleavedBufferAttribute && attr.itemSize === size) return attr.array
    const out = new Float32Array(attr.count * size)
    for (let i = 0; i < attr.count; i++) {
        out[i * size] = attr.getX(i)
        out[i * size + 1] = attr.getY(i)
        if (size === 3) out[i * size + 2] = attr.getZ(i)
    }
    return out
}

/**
 * A restorable copy of one document data slot (see {@link ModellingDocument.setData}). `value`
 * undefined means the slot did not exist.
 */
export interface DataSnapshot {
    kind: 'data'
    /** `data:<key>`, so data and entry snapshots share one recorder keyed by id. */
    id: string
    key: string
    value: unknown
}

/** What undo records: objects and document data. */
export type DocumentSnapshot = EntrySnapshot | DataSnapshot

const cloneData = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

let documentCounter = 0

/**
 * The set of meshes a modelling session has built.
 *
 * Objects are added to `viewer.scene.modelRoot`, so everything else in threepipe - picking,
 * transform gizmos, export, the outliner - sees them as ordinary objects.
 */
export class ModellingDocument {
    /** Identity, so an agent talking to two editor windows can tell them apart. Their weakness #3. */
    readonly documentId: string

    private _entries = new Map<string, ModellingEntry>()
    private _nextId = 1
    private _recorder: Map<string, DocumentSnapshot> | null = null
    private _data = new Map<string, unknown>()

    constructor(readonly viewer: ThreeViewer, documentId?: string) {
        this.documentId = documentId ?? `doc-${++documentCounter}-${Math.random().toString(36).slice(2, 8)}`
    }

    /**
     * A UUID derived from the document id and a key, for everything the document creates.
     *
     * three.js gives every object and material a random UUID and threepipe writes them into the glTF it
     * exports, so two replays of one transcript differed in nothing but those strings. Derived ones make a
     * replay byte-identical when the document id is the same (`new ModellingPlugin({documentId})`), and keep
     * an object's UUID across delete and undo, since a revived object derives the same one. Different
     * documents still get different UUIDs.
     */
    stableUuid(key: string): string {
        const text = `${this.documentId}/${key}`
        // Four FNV-1a passes with different offsets make 128 bits; a UUID only needs to be unique within
        // the scene, which the document id already scopes.
        let hex = ''
        for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
            let h = seed >>> 0
            for (let i = 0; i < text.length; i++) {
                h ^= text.charCodeAt(i)
                h = Math.imul(h, 0x01000193) >>> 0
            }
            hex += h.toString(16).padStart(8, '0')
        }
        // RFC 4122 layout, version 5-style (name-based) and variant bits set.
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(8 | (parseInt(hex[16], 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
    }

    /**
     * A new object and material for `entry`, with UUIDs derived from its id.
     *
     * An object imported from a file keeps the UUID it was saved with, which may be one this document
     * would derive for a later id (a file written by an earlier session with the same document id).
     * Rather than let threepipe replace a clash with a random UUID, the derivation is salted until it is
     * free - still deterministic, since the scene's contents are.
     */
    private _createObject(entryId: string, name: string, color: string): IObject3D {
        let salt = ''
        for (let i = 1; this.viewer.scene.modelRoot.getObjectByProperty('uuid', this.stableUuid(`${entryId}/object${salt}`)); i++) {
            salt = `#${i}`
        }
        return this._createObjectWith(entryId + salt, name, color)
    }

    private _createObjectWith(entryId: string, name: string, color: string): IObject3D {
        const material = new PhysicalMaterial({
            color: new Color(color),
            roughness: 0.55,
            metalness: 0.1,
        })
        // threepipe's own way to set an identity (`MaterialManager.create`, `GLTFLoader2`): `uuid` is
        // read-only in its types. The material mirrors it into `userData.uuid` for serialisation.
        safeSetProperty(material, 'uuid', this.stableUuid(`${entryId}/material`), true, true)
        material.userData.uuid = material.uuid
        const object = new Mesh2(new BufferGeometry2(), material) as unknown as IObject3D
        safeSetProperty(object, 'uuid', this.stableUuid(`${entryId}/object`), true, true)
        object.name = name
        return object
    }

    get entries(): ModellingEntry[] {
        return [...this._entries.values()]
    }

    get size(): number {
        return this._entries.size
    }

    // region lookup

    /** Resolve one reference: an id, a name, or a scene object's uuid. */
    find(ref: string): ModellingEntry | undefined {
        const byId = this._entries.get(ref)
        if (byId) return byId
        for (const e of this._entries.values()) {
            if (e.name === ref || e.object.uuid === ref) return e
        }
        return undefined
    }

    /** Resolve one reference, or throw with a message worth reading. */
    require(ref: string): ModellingEntry {
        const e = this.find(ref)
        if (!e) {
            const names = this.entries.map(x => x.name).slice(0, 12).join(', ')
            throw new Error(`no object "${ref}" in the document`
                + (names ? ` - have: ${names}${this.size > 12 ? ', ...' : ''}` : ' - it is empty'))
        }
        return e
    }

    /**
     * Resolve a reference list. `'*'` means every object; anything else is an id, name or uuid.
     * Names ending in `*` are treated as a prefix match, which is how you address `wheel.001` through
     * `wheel.011` in one command without listing them.
     */
    resolve(refs: string | string[]): ModellingEntry[] {
        const list = Array.isArray(refs) ? refs : [refs]
        const out: ModellingEntry[] = []
        const seen = new Set<string>()
        for (const ref of list) {
            if (ref === '*') {
                for (const e of this._entries.values()) if (!seen.has(e.id)) (seen.add(e.id), out.push(e))
                continue
            }
            if (ref.endsWith('*')) {
                const prefix = ref.slice(0, -1)
                let matched = false
                for (const e of this._entries.values()) {
                    if (!e.name.startsWith(prefix)) continue
                    matched = true
                    if (!seen.has(e.id)) (seen.add(e.id), out.push(e))
                }
                if (!matched) throw new Error(`no object matching "${ref}" in the document`)
                continue
            }
            const e = this.require(ref)
            if (!seen.has(e.id)) (seen.add(e.id), out.push(e))
        }
        return out
    }

    // endregion

    // region names

    /** A unique name, suffixing with `.001` the way Blender does. */
    uniqueName(base: string): string {
        const clean = base.trim() || 'object'
        if (!this.find(clean)) return clean
        for (let i = 1; i < 10000; i++) {
            const candidate = `${clean}.${String(i).padStart(3, '0')}`
            if (!this.find(candidate)) return candidate
        }
        throw new Error(`cannot find a free name based on "${base}"`)
    }

    rename(entry: ModellingEntry, name: string): string {
        this.record(entry)
        const existing = this.find(name)
        if (existing && existing !== entry) throw new Error(`the name "${name}" is already taken`)
        entry.name = name
        entry.object.name = name
        return name
    }

    // endregion

    // region mutation

    /**
     * Add a mesh to the document and the scene.
     *
     * The geometry is baked immediately; `mesh` stays as the editable original.
     */
    add(mesh: MeshData, options: {name?: string, color?: string} = {}): ModellingEntry {
        const name = this.uniqueName(options.name ?? 'object')
        const id = `o${this._nextId++}`
        const object = this._createObject(id, name, options.color ?? '#b7bcc4')

        const entry: ModellingEntry = {
            id,
            name,
            object,
            mesh,
            modifiers: [],
            evaluated: mesh,
            revision: 0,
        }
        this._entries.set(entry.id, entry)
        // Record the creation as "did not exist", so undo removes it.
        this.record(entry, true)
        this.rebake(entry)
        this.viewer.scene.addObject(object, {autoScale: false, autoCenter: false})
        return entry
    }

    /**
     * Take an object that already exists in the scene under management, with topology from elsewhere.
     *
     * This is the import path: a glTF or a `.blend` arrives as an object with baked triangles plus
     * the `MeshData` they were baked from, and the object must keep its identity - its uuid, its
     * place in the hierarchy, its material - while becoming editable. {@link add} cannot do that; it
     * builds a new object.
     */
    adopt(object: IObject3D, mesh: MeshData, modifiers: ModifierSpec[] = []): ModellingEntry {
        const existing = this.find(object.uuid)
        if (existing) {
            this.record(existing)
            existing.mesh = mesh
            existing.modifiers = modifiers.map(m => ({...m}))
            this.rebake(existing)
            return existing
        }

        const name = this.uniqueName(object.name || 'object')
        object.name = name
        const entry: ModellingEntry = {
            id: `o${this._nextId++}`,
            name,
            object,
            mesh,
            modifiers: modifiers.map(m => ({...m})),
            evaluated: mesh,
            revision: 0,
        }
        this._entries.set(entry.id, entry)
        this.record(entry, true)
        this.rebake(entry)
        return entry
    }

    /**
     * Make every mesh under `root` editable: weld its triangles back into shared-vertex topology and adopt
     * it, keeping the object - its UUID, place in the hierarchy, transform and material.
     *
     * The "generate anywhere, edit here" bridge: a three.js `Group` from generated code, or a glTF from
     * any tool, becomes document objects that every command can address. This is the same entry edit
     * mode takes for a plain mesh (`MeshEditPlugin.enter` -> `meshDataFromTriangles`), so the result is
     * the same as opening the object in edit mode once. Welding is lossy where coincident vertices were
     * deliberately separate (hard UV seams, split normals); `welded` reports how many collapsed. Meshes the
     * document already manages - including any a glTF brought in with `THREEPIPE_mesh_topology`, which
     * restores exact topology - are reported, not re-welded.
     */
    importObject(root: IObject3D, options: {tolerance?: number, mergeCoplanar?: boolean} = {}): ImportedObject[] {
        const out: ImportedObject[] = []
        const meshes: IObject3D[] = []
        root.traverse((o: IObject3D) => {
            if ((o as {isMesh?: boolean}).isMesh && o.geometry?.getAttribute?.('position')) meshes.push(o)
        })
        for (const object of meshes) {
            const existing = this.find(object.uuid)
            if (existing) {
                out.push({name: existing.name, source: 'topology', welded: 0,
                    verts: existing.mesh.vertsNum, edges: existing.mesh.edgesNum, faces: existing.mesh.facesNum})
                continue
            }
            const geometry = object.geometry!
            const position = geometry.getAttribute('position')
            const index = geometry.getIndex()
            const uv = geometry.getAttribute('uv')
            const {mesh, weldedCount} = meshDataFromTriangles({
                position: attributeArray(position, 3),
                index: index ? (index.array as ArrayLike<number>) : null,
                uv: uv ? attributeArray(uv, 2) : null,
                groups: geometry.groups,
            }, {tolerance: options.tolerance, mergeCoplanar: options.mergeCoplanar})
            const entry = this.adopt(object, mesh)
            out.push({name: entry.name, source: 'welded', welded: weldedCount,
                verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum})
        }
        return out
    }

    /** Remove an object from the document and the scene. */
    remove(entry: ModellingEntry): void {
        this.record(entry)
        this._entries.delete(entry.id)
        entry.object.removeFromParent()
        entry.object.dispose?.(true)
    }

    /**
     * Replace an object's topology and rebuild its render geometry.
     *
     * Everything that changes a mesh ends here, so there is exactly one place that knows how a
     * `MeshData` becomes something the renderer can draw.
     */
    setMesh(entry: ModellingEntry, mesh: MeshData): void {
        this.record(entry)
        entry.mesh = mesh
        this.rebake(entry)
    }

    /**
     * Evaluate the modifier stack and bake the result into the object's geometry.
     *
     * This is the only place a `MeshData` becomes something the renderer can draw, which is what
     * keeps the master mesh and the drawn mesh from drifting apart.
     */
    rebake(entry: ModellingEntry): void {
        if (!entry.modifierState) entry.modifierState = new Map()
        const result = evaluateModifierStack(entry.mesh, entry.modifiers, {doc: this, entry, state: entry.modifierState})
        entry.evaluated = result.mesh
        entry.evaluatedGeometry = result.geometry
        entry.evaluatedRealize = result.realize
        const {data} = bakeGeometry(entry.evaluated, {includeNormals: true})
        const geometry = geometryDataToBufferGeometry<BufferGeometry2>(data, {
            BufferGeometry: BufferGeometry2,
            BufferAttribute,
        })
        const old = entry.object.geometry
        entry.object.geometry = geometry as never
        if (old && old !== (geometry as never)) old.dispose?.()
        entry.revision++
        entry.object.setDirty?.()
    }

    // endregion

    // region recording, for undo

    /** A command is recording before-states right now. */
    get isRecording(): boolean {
        return this._recorder !== null
    }

    /** Start collecting before-states. One recording spans one command. */
    beginRecording(): void {
        this._recorder = new Map()
    }

    /** Stop collecting and hand back what changed. */
    endRecording(): DocumentSnapshot[] {
        const snaps = this._recorder ? [...this._recorder.values()] : []
        this._recorder = null
        return snaps
    }

    /**
     * Note an object's state before it is changed. Only the first call within a command counts, so a
     * command that touches the same object five times still undoes in one step.
     */
    record(entry: ModellingEntry, asNew = false): void {
        if (!this._recorder || this._recorder.has(entry.id)) return
        this._recorder.set(entry.id, asNew ? {
            id: entry.id,
            name: entry.name,
            mesh: null,
            modifiers: [],
            position: [0, 0, 0],
            quaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
            visible: true,
            parentId: null,
            material: null,
        } : this.snapshot(entry))
    }

    // region document data

    /**
     * Document-level JSON data, by key - for example `nodeGroups`, the geometry-node groups that
     * `geometryNodes` modifiers name. Recorded for undo like objects, and saved in the glTF topology
     * extension. Values are plain JSON; treat what {@link getData} returns as read-only.
     */
    getData<T = unknown>(key: string): T | undefined {
        return this._data.get(key) as T | undefined
    }

    /** Every data key, in insertion order. */
    get dataKeys(): string[] {
        return [...this._data.keys()]
    }

    /**
     * Set (or with `undefined`, remove) a data slot. Recorded for undo within a command. Objects whose
     * modifier stacks may read document data are re-evaluated.
     */
    setData(key: string, value: unknown): void {
        this.recordData(key)
        if (value === undefined) this._data.delete(key)
        else this._data.set(key, cloneData(value))
        this._rebakeModified()
    }

    /** Note a data slot's value before it changes (first call per command counts). */
    recordData(key: string): void {
        const id = `data:${key}`
        if (!this._recorder || this._recorder.has(id)) return
        this._recorder.set(id, {kind: 'data', id, key, value: cloneData(this._data.get(key))})
    }

    /** Objects with a modifier stack, re-evaluated after document data changed. */
    private _rebakeModified(): void {
        for (const entry of this._entries.values()) if (entry.modifiers.length) this.rebake(entry)
    }

    // endregion

    /** The current state of whatever `snap` recorded: an object (`mesh: null` when it is gone) or a data slot. */
    resnapshot(snap: DocumentSnapshot): DocumentSnapshot {
        if (snap.kind === 'data') return {kind: 'data', id: snap.id, key: snap.key, value: cloneData(this._data.get(snap.key))}
        const entry = this._entries.get(snap.id)
        return entry ? this.snapshot(entry) : {...snap, mesh: null}
    }

    /** A full restorable copy of one object's state. */
    snapshot(entry: ModellingEntry): EntrySnapshot {
        const o = entry.object
        const mat = o.material as PhysicalMaterial | undefined
        return {
            id: entry.id,
            name: entry.name,
            mesh: entry.mesh.clone(),
            modifiers: entry.modifiers.map(m => ({...m})),
            position: o.position.toArray() as [number, number, number],
            quaternion: o.quaternion.toArray() as [number, number, number, number],
            scale: o.scale.toArray() as [number, number, number],
            visible: o.visible,
            parentId: null,
            material: snapshotMaterial(mat),
            uuid: o.uuid,
            materialUuid: (mat as {uuid?: string} | undefined)?.uuid,
        }
    }

    /** Whether two snapshots describe the same state. See {@link snapshotsEqual}; data slots compare as JSON. */
    snapshotsEqual(a: DocumentSnapshot, b: DocumentSnapshot): boolean {
        if (a.kind === 'data' || b.kind === 'data') {
            return a.kind === b.kind && a.id === b.id && JSON.stringify((a as DataSnapshot).value) === JSON.stringify((b as DataSnapshot).value)
        }
        return snapshotsEqual(a, b)
    }

    /** Put one object back the way a snapshot found it. A `null` mesh means: it should not exist. */
    restore(snap: DocumentSnapshot): void {
        if (snap.kind === 'data') {
            if (snap.value === undefined) this._data.delete(snap.key)
            else this._data.set(snap.key, cloneData(snap.value))
            this._rebakeModified()
            return
        }
        const entry = this._entries.get(snap.id)
        if (!snap.mesh) {
            if (entry) {
                this._entries.delete(entry.id)
                entry.object.removeFromParent()
                entry.object.dispose?.(true)
            }
            return
        }
        if (!entry) {
            // The command deleted it; rebuild under the same id so later snapshots still match - and
            // under the same UUIDs, which derive from that id.
            // The defaults `add` uses; `_applyTransform` then writes the snapshot's own values over them.
            const object = this._createObject(snap.id, snap.name, '#b7bcc4')
            if (snap.uuid && snap.uuid !== object.uuid) safeSetProperty(object, 'uuid', snap.uuid, true, true)
            const material = object.material as unknown as {uuid: string, userData: Record<string, unknown>} | undefined
            if (material && snap.materialUuid && snap.materialUuid !== material.uuid) {
                safeSetProperty(material, 'uuid', snap.materialUuid, true, true)
                material.userData.uuid = snap.materialUuid
            }
            const revived: ModellingEntry = {
                id: snap.id, name: snap.name, object,
                mesh: snap.mesh.clone(),
                modifiers: snap.modifiers.map(m => ({...m})),
                evaluated: snap.mesh,
                revision: 0,
            }
            this._entries.set(revived.id, revived)
            this.rebake(revived)
            this.viewer.scene.addObject(object, {autoScale: false, autoCenter: false})
            this._applyTransform(revived, snap)
            return
        }
        entry.name = snap.name
        entry.object.name = snap.name
        entry.mesh = snap.mesh.clone()
        entry.modifiers = snap.modifiers.map(m => ({...m}))
        entry.modifierState?.clear()
        this.rebake(entry)
        this._applyTransform(entry, snap)
    }

    private _applyTransform(entry: ModellingEntry, snap: EntrySnapshot): void {
        const o = entry.object
        o.position.fromArray(snap.position)
        o.quaternion.fromArray(snap.quaternion)
        o.scale.fromArray(snap.scale)
        o.visible = snap.visible
        applyMaterial(o.material as PhysicalMaterial | undefined, snap.material)
        o.setDirty?.()
    }

    // endregion

    /** Everything in the document, cleared. */
    clear(): void {
        for (const entry of this.entries) this.remove(entry)
    }
}
