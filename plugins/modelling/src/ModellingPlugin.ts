/**
 * `ModellingPlugin` - the scriptable modelling surface.
 *
 * One entry point, `run(command)`, taking a plain JSON object and returning a plain JSON result. A
 * script calls it directly, a UI button calls it, a replay log is a list of them, and an agent gets
 * the command table as tool definitions from {@link describeCommands}. There is no second API that
 * can drift from this one, and nothing an agent can do here that a person could not type.
 *
 * Deliberately independent of `@threepipe/plugin-mesh-edit`: that package is the human interaction
 * layer - overlays, picking, the modal transform - and this one is the document layer. Keeping them
 * apart means a build script needs no edit-mode UI, and means the editor UI can drive exactly the
 * same commands a script does.
 *
 * It does still need a viewer: the commands run against a live scene, and a `ThreeViewer` wants a DOM
 * and a WebGL context. Generating geometry with no browser at all means calling
 * `@threepipe/mesh-kernel` directly, which has neither dependency. `tests/headless.test.ts` pins
 * where that line falls.
 *
 * ```js
 * const m = viewer.addPluginSync(ModellingPlugin)
 * await m.run({op: 'primitive', type: 'cube', name: 'hull', width: 2.45, height: 0.95, depth: 6.5})
 * await m.run({op: 'lathe', name: 'wheel', profile: [[0, 0], [0.3, 0], [0.3, 0.1], [0, 0.1]]})
 * await m.run({op: 'array', object: 'wheel', count: 6, step: [0, 0, 0.84]})
 * ```
 */

import {AViewerPluginEventMap, AViewerPluginSync, IObject3D, ThreeViewer} from 'threepipe'
import type {MeshData} from '@threepipe/mesh-kernel'
import {ModellingDocument} from './document'
import {ModellingHistory} from './history'
import {CommandRegistry} from './commands/registry'
import {Command, CommandContext, CommandDefinition, CommandResult, validateParams} from './commands/types'
import {createCommands} from './commands/create'
import {editCommands} from './commands/edit'
import {sceneCommands} from './commands/scene'
import {sessionCommands} from './commands/session'
import {referenceCommands, ReferencePlaneState} from './commands/reference'
import {GLTFMeshTopologyExtension} from './gltf/GLTFMeshTopologyExtension'
import {modifierCommands} from './commands/modifiers'
import {shapeCommands} from './commands/shape'

export interface CaptureResult {
    dataUrl: string
    width: number
    height: number
    label: string | null
    path: string | null
}

export interface ModellingPluginEventMap extends AViewerPluginEventMap {
    /** One command finished, successfully or not. */
    commandRun: {command: Command, result: CommandResult}
    /** The document's object set or any object's topology changed. */
    documentChanged: {document: ModellingDocument}
}

export class ModellingPlugin extends AViewerPluginSync<ModellingPluginEventMap> {
    public static readonly PluginType = 'ModellingPlugin'

    enabled = true
    dependencies = []

    /** Not serialised: the document is the scene, and the scene serialises itself. */
    toJSON: any = undefined

    document!: ModellingDocument
    history!: ModellingHistory
    readonly commands = new CommandRegistry()

    /** Calibrated reference planes, keyed by name. See `commands/reference.ts`. */
    readonly references = new Map<string, ReferencePlaneState>()

    /** Current viewport shading, as set by the `display` command. */
    displayMode: 'material' | 'solid' | 'wireframe' = 'material'

    /** Every result this session has produced, in order. A session log, and a replayable one. */
    readonly results: CommandResult[] = []

    /** Keep the last N results. Captures are large; the log should not grow without bound. */
    resultLimit = 500

    /**
     * Where `capture {path}` and `export {path}` write.
     *
     * Set this when driving from Node or from a test harness. Left unset, the plugin writes through
     * `node:fs` if it is running under Node, and reports a warning in a browser where it cannot.
     */
    fileSink: ((path: string, data: Uint8Array) => Promise<void>) | null = null

    private _index = 0
    private _queue: Promise<unknown> = Promise.resolve()
    private _gltfExtension: GLTFMeshTopologyExtension | null = null

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        this.document = new ModellingDocument(viewer)
        this.history = new ModellingHistory(this.document)
        this._connectMeshEdit(viewer)
        this._registerGltfExtension(viewer)
        this.commands.registerAll([
            ...createCommands,
            ...editCommands,
            ...sceneCommands,
            ...sessionCommands,
            ...referenceCommands,
            ...modifierCommands,
            ...shapeCommands,
        ])
    }

    /**
     * Hand exact topology to `MeshEditPlugin` when it is present, and take committed edits back.
     *
     * Without this, opening a lathed wheel in edit mode would weld its triangles back into topology -
     * n-gons guessed at, vertex indices renumbered, so the indices `vertices` and `transform` use
     * would silently stop meaning what they meant. And a hand edit would be discarded the next time
     * a command re-baked the object.
     *
     * Registered by plugin-type string through `forPlugin` rather than by importing the plugin, so
     * this package keeps its one-way dependency and still runs headless with no edit-mode UI at all.
     */
    private _connectMeshEdit(viewer: ThreeViewer): void {
        const provider = (object: IObject3D) => this.document.find(object.uuid)?.mesh ?? null
        const sink = (object: IObject3D, mesh: MeshData) => {
            const entry = this.document.find(object.uuid)
            if (!entry) return
            this.document.beginRecording()
            this.document.setMesh(entry, mesh.clone())
            const before = this.document.endRecording()
            this.history.push('editMode', `edit ${entry.name}`, before, ++this._index)
            this.dispatchEvent({type: 'documentChanged', document: this.document})
        }
        viewer.forPlugin('MeshEditPlugin', (plugin: any) => {
            plugin.meshProviders?.push(provider)
            plugin.meshSinks?.push(sink)
        }, (plugin: any) => {
            remove(plugin.meshProviders, provider)
            remove(plugin.meshSinks, sink)
        }, this)
    }

    /**
     * Register `THREEPIPE_mesh_topology`, so editable topology survives a glTF round trip.
     *
     * Without it, exporting and reloading turns everything built here back into a triangle soup with
     * renumbered vertices - the indices `vertices` and `transform` address would silently stop
     * meaning what they meant. The mesh primitive itself is unchanged, so other viewers are
     * unaffected; see `gltf/GLTFMeshTopologyExtension.ts`.
     */
    private _registerGltfExtension(viewer: ThreeViewer): void {
        this._gltfExtension = new GLTFMeshTopologyExtension({
            read: (object) => {
                const entry = this.document.find((object as IObject3D).uuid)
                return entry ? {mesh: entry.mesh, modifiers: entry.modifiers} : null
            },
            write: (object, mesh, modifiers) => {
                this.document.beginRecording()
                this.document.adopt(object, mesh, modifiers)
                this.document.endRecording()
                this.dispatchEvent({type: 'documentChanged', document: this.document})
            },
        })
        viewer.assetManager.registerGltfExtension(this._gltfExtension.extension as never)
    }

    onRemove(viewer: ThreeViewer): void {
        if (this._gltfExtension) {
            viewer.assetManager.unregisterGltfExtension(GLTFMeshTopologyExtension.Name)
            this._gltfExtension = null
        }
        for (const state of this.references.values()) {
            state.object.removeFromParent()
            state.object.dispose?.(true)
        }
        this.references.clear()
        this.document?.clear()
        this.history?.clear()
        super.onRemove(viewer)
    }

    // region running

    /**
     * Run one command.
     *
     * Commands are serialised through a queue, so two callers cannot interleave and leave the undo
     * stack describing a state that never existed.
     */
    async run(command: Command): Promise<CommandResult> {
        const next = this._queue.then(() => this._run(command), () => this._run(command))
        this._queue = next.catch(() => undefined)
        return next
    }

    /**
     * Run a list of commands in order, stopping at the first failure unless `continueOnError`.
     *
     * This is what a build script is: a list of JSON objects. Its results are a transcript of the
     * build, which can be diffed against a later run.
     */
    async runAll(commands: Command[], {continueOnError = false} = {}): Promise<CommandResult[]> {
        const out: CommandResult[] = []
        for (const command of commands) {
            const result = await this.run(command)
            out.push(result)
            if (!result.ok && !continueOnError) break
        }
        return out
    }

    private async _run(command: Command): Promise<CommandResult> {
        const started = now()
        const index = ++this._index
        const op = command?.op

        const fail = (error: string): CommandResult => {
            const result: CommandResult = {
                ok: false, op: op ?? '(none)', index, documentId: this.document.documentId,
                error, ms: round(now() - started),
            }
            this._finish(command, result)
            return result
        }

        if (!op || typeof op !== 'string') return fail('a command needs an "op" naming what to do')
        const def = this.commands.get(op)
        if (!def) {
            const near = this.commands.suggest(op)
            return fail(`unknown op "${op}"`
                + (near ? ` - did you mean "${near}"?` : `. Run {op: "help"} for the list.`))
        }

        const params = {...command} as Record<string, unknown>
        delete params.op
        const errors = validateParams(def, params)
        if (errors.length) return fail(errors.join('; '))

        const warnings: string[] = []
        const ctx: CommandContext = {
            viewer: this._viewer!,
            doc: this.document,
            plugin: this,
            warn: (m: string) => warnings.push(m),
        }

        if (def.mutates) this.document.beginRecording()
        try {
            const output = await def.run(params, ctx) || {}
            const before = def.mutates ? this.document.endRecording() : []
            if (def.mutates) {
                this.history.push(op, describeCommand(command), before, index)
                this.dispatchEvent({type: 'documentChanged', document: this.document})
            }
            const result: CommandResult = {
                ok: true,
                op,
                index,
                documentId: this.document.documentId,
                objects: output.objects,
                data: output.data,
                warnings: warnings.length ? warnings : undefined,
                ms: round(now() - started),
            }
            this._viewer?.setDirty()
            this._finish(command, result)
            return result
        } catch (e) {
            // A failed command must not leave half its changes behind: roll back what it recorded.
            if (def.mutates) {
                const before = this.document.endRecording()
                for (const snap of before) this.document.restore(snap)
            }
            return fail((e as Error).message ?? String(e))
        }
    }

    private _finish(command: Command, result: CommandResult): void {
        this.results.push(result)
        if (this.results.length > this.resultLimit) this.results.shift()
        this.dispatchEvent({type: 'commandRun', command, result})
    }

    // endregion

    // region agent surface

    /**
     * The command table as `{name, description, inputSchema}` - the shape an LLM tool list takes.
     *
     * Generated from the same definitions the dispatcher runs, so a command cannot exist without
     * being described, and a description cannot describe a command that is not there.
     */
    describeCommands(): {name: string, description: string, inputSchema: unknown}[] {
        return this.commands.describe()
    }

    /** Add a command of your own. It gains validation, undo and the tool list for free. */
    addCommand(def: CommandDefinition): void {
        this.commands.register(def)
    }

    // endregion

    // region rendering and files

    /**
     * Render one frame immediately and return it as a data URL.
     *
     * The render loop is driven explicitly rather than by awaiting `requestAnimationFrame`. The
     * SU-152 session lost 118 seconds to a single capture waiting on a background tab's animation
     * frame, with the edit behind it stuck in the same acknowledgement - so this path never waits on
     * the browser to schedule anything, and a capture cannot hold up an edit.
     */
    renderFrame({mimeType = 'image/png', quality = 0.92} = {}): string {
        const viewer = this._viewer
        if (!viewer) throw new Error('the plugin is not attached to a viewer')
        viewer.setDirty()
        viewer.renderManager.animationLoop(now())
        return viewer.canvas.toDataURL(mimeType, quality)
    }

    /** Write a capture to its `path`, through {@link fileSink} or `node:fs`. */
    async writeCapture(capture: CaptureResult): Promise<void> {
        if (!capture.path) return
        const comma = capture.dataUrl.indexOf(',')
        const base64 = capture.dataUrl.slice(comma + 1)
        await this.writeFile(capture.path, base64ToBytes(base64))
    }

    /** Write bytes to a path, through {@link fileSink} or `node:fs`. */
    async writeFile(path: string, data: Uint8Array): Promise<void> {
        if (this.fileSink) return this.fileSink(path, data)
        const isNode = typeof process !== 'undefined' && !!(process as {versions?: {node?: string}}).versions?.node
        if (!isNode) {
            throw new Error(`cannot write "${path}" from a browser - set ModellingPlugin.fileSink, `
                + 'or use the returned data instead')
        }
        // Indirected through a variable so a browser bundler does not try to resolve it at all.
        const nodeFs = 'node:fs/promises'
        const fs = await import(/* @vite-ignore */ nodeFs)
        await fs.writeFile(path, data)
    }

    // endregion
}

function describeCommand(command: Command): string {
    const parts: string[] = [command.op]
    for (const key of ['type', 'object', 'name', 'count', 'view']) {
        const v = (command as Record<string, unknown>)[key]
        if (typeof v === 'string' || typeof v === 'number') parts.push(`${key}=${v}`)
    }
    return parts.join(' ')
}

function remove<T>(list: T[] | undefined, item: T): void {
    const index = list?.indexOf(item) ?? -1
    if (index >= 0) list!.splice(index, 1)
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const round = (n: number) => Math.round(n * 1000) / 1000

function base64ToBytes(base64: string): Uint8Array {
    if (typeof atob === 'function') {
        const binary = atob(base64)
        const out = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
        return out
    }
    // Node without a DOM polyfill.
    return new Uint8Array(Buffer.from(base64, 'base64'))
}
