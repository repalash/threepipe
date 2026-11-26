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
    ThreeViewer,
} from 'threepipe'
import {bakeGeometry, geometryDataToBufferGeometry, MeshData} from '@threepipe/mesh-kernel'
import {evaluateModifiers, ModifierSpec} from './modifiers'

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
    /** Bumped on every topology or position change, so callers can tell what is stale. */
    revision: number
}

/** A restorable snapshot of one object. `null` `mesh` means the object did not exist. */
export interface EntrySnapshot {
    id: string
    name: string
    mesh: MeshData | null
    modifiers: ModifierSpec[]
    position: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
    visible: boolean
    parentId: string | null
    materialColor: string | null
}

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
    private _recorder: Map<string, EntrySnapshot> | null = null

    constructor(readonly viewer: ThreeViewer, documentId?: string) {
        this.documentId = documentId ?? `doc-${++documentCounter}-${Math.random().toString(36).slice(2, 8)}`
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
        const material = new PhysicalMaterial({
            color: new Color(options.color ?? '#b7bcc4'),
            roughness: 0.55,
            metalness: 0.1,
        })
        const object = new Mesh2(new BufferGeometry2(), material) as unknown as IObject3D
        object.name = name

        const entry: ModellingEntry = {
            id: `o${this._nextId++}`,
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
        entry.evaluated = evaluateModifiers(entry.mesh, entry.modifiers)
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

    /** Start collecting before-states. One recording spans one command. */
    beginRecording(): void {
        this._recorder = new Map()
    }

    /** Stop collecting and hand back what changed. */
    endRecording(): EntrySnapshot[] {
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
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            visible: true,
            parentId: null,
            materialColor: null,
        } : this.snapshot(entry))
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
            rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
            scale: o.scale.toArray() as [number, number, number],
            visible: o.visible,
            parentId: null,
            materialColor: mat?.color ? '#' + mat.color.getHexString() : null,
        }
    }

    /** Put one object back the way a snapshot found it. A `null` mesh means: it should not exist. */
    restore(snap: EntrySnapshot): void {
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
            // The command deleted it; rebuild under the same id so later snapshots still match.
            const material = new PhysicalMaterial({
                color: new Color(snap.materialColor ?? '#b7bcc4'),
                roughness: 0.55,
                metalness: 0.1,
            })
            const object = new Mesh2(new BufferGeometry2(), material) as unknown as IObject3D
            object.name = snap.name
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
        this.rebake(entry)
        this._applyTransform(entry, snap)
    }

    private _applyTransform(entry: ModellingEntry, snap: EntrySnapshot): void {
        const o = entry.object
        o.position.fromArray(snap.position)
        o.rotation.set(snap.rotation[0], snap.rotation[1], snap.rotation[2])
        o.scale.fromArray(snap.scale)
        o.visible = snap.visible
        const mat = o.material as PhysicalMaterial | undefined
        if (snap.materialColor && mat?.color) mat.color.set(snap.materialColor)
        o.setDirty?.()
    }

    // endregion

    /** Everything in the document, cleared. */
    clear(): void {
        for (const entry of this.entries) this.remove(entry)
    }
}
