/**
 * Session commands: `camera`, `capture`, `inspect`, `measure`, `undo`, `redo`, `checkpoint`,
 * `selftest`, `export`, `help`.
 *
 * These are the ones that make a session *steerable*. The SU-152 report's own conclusion was that
 * its limitations "were not computational but methodological" - no reference calibration, no
 * repeatable views, no clearance checks. Those are commands, not algorithms, and they live here.
 */

import {Box3, Box3B, getFittingDistance, ThreeViewer, Vector3} from 'threepipe'
import {bakeGeometry} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {meshBounds, readTargets, readVec3, Vec3Tuple} from './params'
import {ModellingEntry} from '../document'

/**
 * Point the camera and bring everything that depends on its orientation up to date.
 *
 * Setting `position` and `target` alone is not enough: the camera's quaternion still points the old
 * way until something calls `lookAt`, and `RootScene.refreshActiveCameraNearFar` derives the near
 * and far planes from `getWorldDirection()`. Skip this and the first frame after a camera move is
 * rendered with clipping planes computed for where the camera used to be looking - which, for a big
 * move, clips the whole model away and returns a blank capture.
 */
export function applyCamera(
    viewer: ThreeViewer, position: Vector3 | null, target: Vector3,
): void {
    const camera = viewer.scene.mainCamera
    if (position) camera.position.copy(position)
    camera.target.copy(target)
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    camera.setDirty?.()
    viewer.scene.refreshActiveCameraNearFar()
    viewer.setDirty()
}

/** Named orientations, as unit directions from the target towards the camera. */
const STANDARD_VIEWS: Record<string, Vec3Tuple> = {
    front: [0, 0, 1],
    back: [0, 0, -1],
    right: [1, 0, 0],
    left: [-1, 0, 0],
    top: [0, 1, 0],
    bottom: [0, -1, 0],
    iso: [1, 0.7, 1],
}

/**
 * World-space bounds of a set of objects.
 *
 * `Box3B` rather than `Box3`: its `expandByObject` takes threepipe's precise-bounds flags, which is
 * what `camera.fitObject` uses, so framing computed here matches framing computed there.
 */
function worldBounds(objects: ModellingEntry[]): Box3B {
    const box = new Box3B()
    for (const e of objects) {
        e.object.updateWorldMatrix(true, true)
        box.expandByObject(e.object as never, false, true)
    }
    return box
}

export const cameraCommand: CommandDefinition = {
    op: 'camera',
    summary: 'Move the camera: a named view, a fit to some objects, or an explicit position.',
    description:
        'Named views (`front`, `back`, `left`, `right`, `top`, `bottom`, `iso`) are computed from '
        + 'the bounds of whatever they frame, so the same command gives the same framing as a model '
        + 'grows - which is what makes two screenshots comparable. `save` stores the current camera '
        + 'under a name via threepipe\'s CameraViews plugin, and `view` will replay a saved name '
        + 'before it falls back to a standard one.',
    mutates: false,
    schema: schema({
        view: S.string('A saved view name, or one of front/back/left/right/top/bottom/iso.'),
        fit: {
            description: 'What to frame: an object name, a list, `*` for everything, or `selected`.',
            oneOf: [{type: 'string'}, {type: 'array', items: {type: 'string'}}],
        },
        padding: S.number('Framing margin as a multiple of the bounds radius. Default 1.4.'),
        position: S.vec3('Explicit camera position.'),
        target: S.vec3('Explicit look-at point.'),
        duration: S.number('Animate over this many milliseconds. 0, the default, jumps.'),
        save: S.string('Save the resulting camera under this name for later replay.'),
    }),

    async run(p: Record<string, unknown>, ctx) {
        const viewer = ctx.viewer
        const camera = viewer.scene.mainCamera
        const views = viewer.getPlugin<any>('CameraViews')
        const duration = (p.duration as number) ?? 0

        // A saved view wins over a standard name, so a session can define its own "detail" view.
        if (p.view !== undefined && views) {
            const saved = views.camViews?.find((v: any) => v.name === p.view)
            if (saved) {
                if (duration > 0) await views.animateToView(saved, duration)
                else views.setView(saved)
                applyCamera(viewer, null, camera.target.clone())
                return {
                    data: {
                        position: camera.position.toArray(),
                        target: camera.target.toArray(),
                        view: p.view,
                        // How the framing was arrived at. `saved` names where it was stored, if the
                        // command was also asked to store one - never overloaded with this.
                        source: 'saved',
                        saved: null,
                    },
                }
            }
        }

        let target = new Vector3()
        let position: Vector3 | null = null

        const fitRef = p.fit
        const framing = fitRef !== undefined || p.view !== undefined
        if (framing) {
            const entries = fitRef === 'selected'
                ? selectedEntries(ctx)
                : fitRef === undefined || fitRef === '*' || fitRef === 'all'
                    ? ctx.doc.entries
                    : ctx.doc.resolve(fitRef as string | string[])
            const box = worldBounds(entries)
            if (box.isEmpty()) {
                ctx.warn('nothing to frame - the document is empty')
                target.set(0, 0, 0)
            } else {
                box.getCenter(target)
            }
            const padding = (p.padding as number) ?? 1.4
            // threepipe's own fitting distance, so `camera {fit}` and `viewer.fitToView` agree. It
            // accounts for aspect ratio, which matters when the subject is much wider than it is tall.
            const distance = Math.max(0.05, getFittingDistance(camera, box) * padding)

            const dirName = (p.view as string) ?? 'iso'
            const dir = STANDARD_VIEWS[dirName]
            if (!dir) {
                throw new Error(`unknown view "${dirName}" - use one of `
                    + `${Object.keys(STANDARD_VIEWS).join(', ')}, or save a view first`)
            }
            const d = new Vector3(...dir).normalize()
            position = target.clone().addScaledVector(d, distance)
        }

        if (p.position !== undefined) position = new Vector3(...readVec3(p.position, [0, 0, 0], 'position'))
        if (p.target !== undefined) target = new Vector3(...readVec3(p.target, [0, 0, 0], 'target'))

        if (position || p.target !== undefined || framing) {
            applyCamera(viewer, position, target)
        }

        let savedView: string | null = null
        if (p.save !== undefined) {
            if (!views) ctx.warn('CameraViewPlugin is not loaded, so the view was not saved')
            else {
                const view = views.getView()
                view.name = p.save as string
                const existing = views.camViews?.find((v: any) => v.name === view.name)
                if (existing) views.deleteView(existing, true)
                views.addView(view, true)
                savedView = view.name
            }
        }

        return {
            data: {
                position: camera.position.toArray(),
                target: camera.target.toArray(),
                view: p.view ?? null,
                source: 'computed',
                saved: savedView,
            },
        }
    },
}

function selectedEntries(ctx: {viewer: any, doc: any}): ModellingEntry[] {
    const picking = ctx.viewer.getPlugin('Picking')
    const obj = picking?.getSelectedObject?.()
    if (!obj) return ctx.doc.entries
    const found = ctx.doc.find(obj.uuid)
    return found ? [found] : ctx.doc.entries
}

export const captureCommand: CommandDefinition = {
    op: 'capture',
    summary: 'Render a frame and return it as an image, so the caller can see what it built.',
    description:
        'The render is driven explicitly rather than by waiting for the browser to schedule an '
        + 'animation frame. That matters: in a background tab `requestAnimationFrame` can stall for '
        + 'minutes, and a capture that waits on one blocks every edit queued behind it. This '
        + 'command cannot stall that way.',
    mutates: false,
    schema: schema({
        mimeType: S.enum('Image format.', ['image/png', 'image/jpeg', 'image/webp']),
        quality: S.number('JPEG/WebP quality, 0 to 1.', {minimum: 0, maximum: 1}),
        path: S.string('Write the image to this file. Node only, or when a capture sink is set.'),
        label: S.string('A note stored with the capture, to caption it in a log.'),
    }),

    async run(p: Record<string, unknown>, ctx) {
        const dataUrl = ctx.plugin.renderFrame({
            mimeType: (p.mimeType as string) ?? 'image/png',
            quality: (p.quality as number) ?? 0.92,
        })
        const result = {
            dataUrl,
            width: ctx.viewer.canvas.width,
            height: ctx.viewer.canvas.height,
            label: (p.label as string) ?? null,
            path: (p.path as string) ?? null,
        }
        if (p.path) await ctx.plugin.writeCapture(result)
        return {data: result}
    },
}

export const inspectCommand: CommandDefinition = {
    op: 'inspect',
    summary: 'Report an object\'s counts, bounds, transform and - with `detail` - its vertices.',
    description:
        'The reply is what a later `vertices` or `transform` command needs in order to address '
        + 'anything: indices are the ones those commands take. With no object, it summarises the '
        + 'whole document.',
    mutates: false,
    schema: schema({
        object: S.objectRef('Objects to inspect. Omit to summarise the document.'),
        objects: S.objectRef('Alias for `object`.'),
        detail: S.boolean('Include per-vertex positions and per-face vertex lists.'),
        limit: S.integer('Cap on detailed vertices per object. Default 400.', {minimum: 1}),
    }),

    run(p: Record<string, unknown>, ctx) {
        const targets = readTargets(p, ctx.doc, false)
        if (!targets.length) {
            const entries = ctx.doc.entries
            const box = worldBounds(entries)
            return {
                data: {
                    documentId: ctx.doc.documentId,
                    objects: entries.length,
                    totals: entries.reduce((a, e) => ({
                        verts: a.verts + e.mesh.vertsNum,
                        edges: a.edges + e.mesh.edgesNum,
                        faces: a.faces + e.mesh.facesNum,
                    }), {verts: 0, edges: 0, faces: 0}),
                    bounds: box.isEmpty() ? null : {
                        min: box.min.toArray(), max: box.max.toArray(),
                        size: box.getSize(new Vector3()).toArray(),
                    },
                    names: entries.map(e => e.name),
                },
            }
        }

        const limit = (p.limit as number) ?? 400
        const data = targets.map(entry => {
            const o = entry.object
            const base: Record<string, unknown> = {
                name: entry.name,
                id: entry.id,
                uuid: o.uuid,
                revision: entry.revision,
                verts: entry.mesh.vertsNum,
                edges: entry.mesh.edgesNum,
                faces: entry.mesh.facesNum,
                position: o.position.toArray(),
                rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
                scale: o.scale.toArray(),
                bounds: meshBounds(entry.mesh),
            }
            if (p.detail) {
                const mesh = entry.mesh
                const pos = mesh.positions
                const n = Math.min(mesh.vertsNum, limit)
                base.vertices = Array.from({length: n},
                    (_, i) => [round(pos[i * 3]), round(pos[i * 3 + 1]), round(pos[i * 3 + 2])])
                if (n < mesh.vertsNum) {
                    base.verticesTruncated = mesh.vertsNum - n
                    ctx.warn(`"${entry.name}" has ${mesh.vertsNum} vertices; listed the first ${n}`)
                }
                const fn = Math.min(mesh.facesNum, limit)
                base.faceVerts = Array.from({length: fn}, (_, i) => mesh.faceVerts(i))
                if (fn < mesh.facesNum) base.facesTruncated = mesh.facesNum - fn
            }
            return base
        })
        return {objects: targets.map(t => t.name), data: data.length === 1 ? data[0] : data}
    },
}

const round = (n: number) => Math.round(n * 1e5) / 1e5

/** Base64 without blowing the call stack on a multi-megabyte GLB. */
function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64')
}

export const measureCommand: CommandDefinition = {
    op: 'measure',
    summary: 'Distances, gaps and overlaps between objects.',
    description:
        'Their weakness #6: a handle intersecting a periscope housing is not something topology '
        + 'validation can find, and only turned up by eye. `mode: "overlaps"` lists every pair of '
        + 'objects whose world bounds intersect, with the overlap size, so it can be found without '
        + 'looking.',
    mutates: false,
    schema: schema({
        object: S.objectRef('Objects to measure. Default everything.'),
        objects: S.objectRef('Alias for `object`.'),
        mode: S.enum('`bounds` reports each object\'s world box; `overlaps` reports intersecting pairs.',
            ['bounds', 'overlaps']),
        tolerance: S.number('Ignore overlaps smaller than this on every axis. Default 0.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const targets = readTargets(p, ctx.doc, false)
        const entries = targets.length ? targets : ctx.doc.entries
        const mode = (p.mode as string) ?? 'overlaps'
        const boxes = entries.map(e => {
            e.object.updateWorldMatrix(true, true)
            return {entry: e, box: new Box3().expandByObject(e.object as never)}
        })

        if (mode === 'bounds') {
            return {
                objects: entries.map(e => e.name),
                data: boxes.map(b => ({
                    name: b.entry.name,
                    min: b.box.min.toArray().map(round),
                    max: b.box.max.toArray().map(round),
                    size: b.box.getSize(new Vector3()).toArray().map(round),
                })),
            }
        }

        const tolerance = (p.tolerance as number) ?? 0
        const overlaps: unknown[] = []
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i].box
                const b = boxes[j].box
                if (!a.intersectsBox(b)) continue
                const size = new Vector3(
                    Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
                    Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y),
                    Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z))
                if (size.x <= tolerance || size.y <= tolerance || size.z <= tolerance) continue
                overlaps.push({
                    a: boxes[i].entry.name,
                    b: boxes[j].entry.name,
                    overlap: size.toArray().map(round),
                    volume: round(size.x * size.y * size.z),
                })
            }
        }
        return {data: {mode, pairs: overlaps.length, overlaps}}
    },
}

export const undoCommand: CommandDefinition = {
    op: 'undo',
    summary: 'Undo commands, or rewind to a named checkpoint.',
    mutates: false, // it manages history itself; wrapping it in history would be circular
    schema: schema({
        steps: S.integer('How many commands to undo. Default 1.', {minimum: 1}),
        to: S.string('Rewind until this checkpoint is the most recent applied command.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const done = p.to !== undefined
            ? ctx.plugin.history.undoTo(p.to as string)
            : ctx.plugin.history.undo((p.steps as number) ?? 1)
        if (!done) ctx.warn('nothing left to undo')
        ctx.viewer.setDirty()
        return {data: {undone: done, canUndo: ctx.plugin.history.canUndo}}
    },
}

export const redoCommand: CommandDefinition = {
    op: 'redo',
    summary: 'Redo commands that were undone.',
    mutates: false,
    schema: schema({steps: S.integer('How many to redo. Default 1.', {minimum: 1})}),

    run(p: Record<string, unknown>, ctx) {
        const done = ctx.plugin.history.redo((p.steps as number) ?? 1)
        if (!done) ctx.warn('nothing to redo')
        ctx.viewer.setDirty()
        return {data: {redone: done, canRedo: ctx.plugin.history.canRedo}}
    },
}

export const checkpointCommand: CommandDefinition = {
    op: 'checkpoint',
    summary: 'Name the current point in history, so `undo {to}` can come back to it.',
    mutates: false,
    schema: schema({name: S.string('The checkpoint name.')}, ['name']),

    run(p: Record<string, unknown>, ctx) {
        const entry = ctx.plugin.history.checkpoint(p.name as string)
        if (!entry) ctx.warn('nothing has happened yet, so the checkpoint marks an empty history')
        return {data: {name: p.name, at: entry?.index ?? 0}}
    },
}

export const selftestCommand: CommandDefinition = {
    op: 'selftest',
    summary: 'Check every object in the document for topology and render-bake problems.',
    description:
        'Runs the kernel validator over each mesh, re-bakes it, and checks that the document and '
        + 'the scene graph still agree. Cheap enough to run after a risky command and far better '
        + 'than finding out at export time.',
    mutates: false,
    schema: schema({verbose: S.boolean('List every object, not only the failures.')}),

    run(p: Record<string, unknown>, ctx) {
        const results: {name: string, ok: boolean, problems: string[]}[] = []
        for (const entry of ctx.doc.entries) {
            const problems = [...entry.mesh.validate()]
            try {
                bakeGeometry(entry.mesh, {includeNormals: true})
            } catch (e) {
                problems.push(`bake failed: ${(e as Error).message}`)
            }
            if (!entry.object.parent) problems.push('object is not in the scene graph')
            if (entry.object.name !== entry.name) {
                problems.push(`scene name "${entry.object.name}" does not match document name`)
            }
            results.push({name: entry.name, ok: !problems.length, problems})
        }
        const names = new Set<string>()
        const duplicates: string[] = []
        for (const e of ctx.doc.entries) {
            if (names.has(e.name)) duplicates.push(e.name)
            names.add(e.name)
        }
        const failures = results.filter(r => !r.ok)
        return {
            data: {
                objects: results.length,
                failed: failures.length,
                duplicateNames: duplicates,
                results: p.verbose ? results : failures,
            },
        }
    },
}

export const exportCommand: CommandDefinition = {
    op: 'export',
    summary: 'Export the scene as a GLB or glTF.',
    mutates: false,
    schema: schema({
        format: S.enum('Output format. Default `glb`.', ['glb', 'gltf']),
        path: S.string('Write to this file. Node only, or when a capture sink is set.'),
        objects: S.objectRef('Export only these objects. Default the whole scene.'),
        includeData: S.boolean('Return the file as base64 in the result, for a caller that will '
            + 'write it itself. Off by default - it is large.'),
    }),

    async run(p: Record<string, unknown>, ctx) {
        const binary = ((p.format as string) ?? 'glb') === 'glb'
        const blob = await ctx.viewer.exportScene({exportExt: binary ? 'glb' : 'gltf'})
        if (!blob) throw new Error('the exporter returned nothing')
        const buffer = new Uint8Array(await blob.arrayBuffer())
        if (p.path) await ctx.plugin.writeFile(p.path as string, buffer)
        return {
            data: {
                bytes: buffer.byteLength,
                format: binary ? 'glb' : 'gltf',
                path: (p.path as string) ?? null,
                base64: p.includeData ? bytesToBase64(buffer) : undefined,
            },
        }
    },
}

export const helpCommand: CommandDefinition = {
    op: 'help',
    summary: 'List the available commands, or describe one in full.',
    description: 'The same table `describeCommands()` returns. Useful from a console, and useful '
        + 'to an agent that wants to check a parameter name before spending a command on it.\n\n'
        + 'The parameter is `command`, not `op`: a command object already has an `op` key, so '
        + '`{op: "help", op: "lathe"}` is not expressible in JSON.',
    mutates: false,
    schema: schema({command: S.string('A command name. Omit for the list.')}),

    run(p: Record<string, unknown>, ctx) {
        if (p.command === undefined) {
            return {
                data: ctx.plugin.commands.all()
                    .sort((a, b) => a.op.localeCompare(b.op))
                    .map(d => ({op: d.op, summary: d.summary, mutates: d.mutates})),
            }
        }
        const def = ctx.plugin.commands.get(p.command as string)
        if (!def) {
            const near = ctx.plugin.commands.suggest(p.command as string)
            throw new Error(`no command "${p.command}"` + (near ? ` - did you mean "${near}"?` : ''))
        }
        return {
            data: {
                op: def.op,
                summary: def.summary,
                description: def.description ?? null,
                mutates: def.mutates,
                inputSchema: def.schema,
            },
        }
    },
}

export const historyCommand: CommandDefinition = {
    op: 'history',
    summary: 'The command history: what has been done, what has been undone, and the checkpoints.',
    description:
        'One entry per mutating command, oldest first, with `undone` marking everything above the '
        + 'current position. An agent that has lost track of where it is asks this; a UI draws a '
        + 'timeline from it.',
    mutates: false,
    schema: schema({
        limit: S.integer('Return only the most recent N entries.', {minimum: 1}),
        results: S.boolean('Include the full result log as well, not only the undo stack.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const log = ctx.plugin.history.log
        const limit = p.limit as number | undefined
        return {
            data: {
                entries: limit ? log.slice(-limit) : log,
                canUndo: ctx.plugin.history.canUndo,
                canRedo: ctx.plugin.history.canRedo,
                checkpoints: log.filter(e => e.checkpoint).map(e => e.checkpoint),
                results: p.results
                    ? ctx.plugin.results.map(r => ({
                        index: r.index, op: r.op, ok: r.ok, ms: r.ms,
                        objects: r.objects, error: r.error, warnings: r.warnings,
                    }))
                    : undefined,
            },
        }
    },
}

export const sessionCommands = [
    cameraCommand, captureCommand, inspectCommand, measureCommand,
    undoCommand, redoCommand, checkpointCommand, historyCommand, selftestCommand, exportCommand,
    helpCommand,
]
