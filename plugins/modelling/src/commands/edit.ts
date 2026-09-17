/**
 * Commands that change existing geometry: `vertices`, `transform`, `array`, `duplicate`, `mirror`,
 * `delete`.
 *
 * The distinction that matters here is object transform versus mesh edit. `transform` with no
 * element list moves the object - its position, rotation and scale - and leaves vertex ids alone.
 * `transform` with a `verts` or `faces` list edits the topology in place. Both are what a modeller
 * means by "move it", and conflating them is how vertex ids stop meaning anything halfway through a
 * session.
 */

import {Matrix4, Vector3} from 'threepipe'
import {
    arrayCurve,
    arrayLinear,
    arrayRadial,
    averageFaceNormal,
    bmFromMesh,
    bmToMesh,
    extrudeFaceRegion,
    Mat4,
    mirrorGeometry,
    translateVerts,
    Vec3,
} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {checkModifier} from '../modifiers'
import {
    meshBounds,
    readPoints,
    readTarget,
    readTargets,
    readVec3,
    readVertSelection,
    transformMatrix,
    transformMeshVerts,
    transformObject,
    Vec3Tuple,
} from './params'

const AXES = ['x', 'y', 'z'] as const

/** Every element of a BMesh, which is what an array or mirror over a whole object operates on. */
const allOf = (bm: ReturnType<typeof bmFromMesh>) =>
    ({verts: [...bm.verts], edges: [...bm.edges], faces: [...bm.faces]})

export const verticesCommand: CommandDefinition = {
    op: 'vertices',
    summary: 'Move individual vertices of one object by index.',
    description:
        'Vertex indices are stable for the lifetime of an object unless a command changes its '
        + 'topology (`array`, `mirror`). `inspect` with `detail` lists them. This is the command '
        + 'that turns a box into a sloped armour plate or a tapered hull.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to edit.'),
        objects: S.objectRef('Alias for `object`.'),
        verts: S.array(
            'Entries of `[index, x, y, z]`, or `{id, position}`. Positions are in object space.',
            {}, {minItems: 1}),
        relative: S.boolean('Treat the positions as offsets from where the vertices are now.'),
    }, ['verts']),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const mesh = entry.mesh.clone()
        const pos = mesh.positions
        const relative = p.relative === true
        const list = p.verts as unknown[]

        let touched = 0
        for (const raw of list) {
            let id: number
            let xyz: Vec3Tuple
            if (Array.isArray(raw)) {
                if (raw.length !== 4) throw new Error('each vertex entry must be [index, x, y, z]')
                id = raw[0] as number
                xyz = [raw[1] as number, raw[2] as number, raw[3] as number]
            } else if (raw && typeof raw === 'object') {
                const o = raw as Record<string, unknown>
                id = (o.id ?? o.index) as number
                xyz = readVec3(o.position ?? o.offset, [0, 0, 0], 'position')
            } else {
                throw new Error('each vertex entry must be [index, x, y, z] or {id, position}')
            }
            if (!Number.isInteger(id) || id < 0 || id >= mesh.vertsNum) {
                throw new Error(`vertex ${id} is out of range - "${entry.name}" has ${mesh.vertsNum}`)
            }
            for (let k = 0; k < 3; k++) {
                pos[id * 3 + k] = relative ? pos[id * 3 + k] + xyz[k] : xyz[k]
            }
            touched++
        }

        ctx.doc.setMesh(entry, mesh)
        return {objects: [entry.name], data: {moved: touched, bounds: meshBounds(mesh)}}
    },
}

export const transformCommand: CommandDefinition = {
    op: 'transform',
    summary: 'Move, rotate or scale objects, or a selected subset of their vertices.',
    description:
        'With no `verts` or `faces`, this changes the object transform and vertex ids are '
        + 'untouched. With either, it edits the mesh in place - which is what you want for tapering '
        + 'a roof or flaring a bracket, and what you do not want for placing a part.\n\n'
        + '`pivot` is the point everything happens about; it defaults to the object origin, and '
        + '`pivot: "center"` uses the bounding-box centre.',
    mutates: true,
    schema: schema({
        object: S.objectRef('Objects to transform. A name, a list, `prefix*` or `*`.'),
        objects: S.objectRef('Alias for `object`.'),
        move: S.vec3('Translation.'),
        rotate: S.vec3('Euler XYZ rotation in radians.'),
        angle: S.number('Rotation about `axis`, in radians. An alternative to `rotate`.'),
        axis: S.enum('Axis for `angle`.', AXES),
        scale: S.vec3('Scale factor. A single number scales uniformly.'),
        pivot: {
            description: 'Point to transform about: `[x, y, z]`, or `"center"` for the bounds centre.',
            oneOf: [{type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3},
                {type: 'string', enum: ['center', 'origin']}],
        },
        verts: S.array('Vertex indices to move instead of the whole object.', {type: 'integer'}),
        faces: S.array('Face indices; their vertices are moved.', {type: 'integer'}),
    }),

    run(p: Record<string, unknown>, ctx) {
        const targets = readTargets(p, ctx.doc)
        const rotate = p.angle !== undefined
            ? axisAngleToEuler((p.axis as 'x' | 'y' | 'z') ?? 'y', p.angle as number)
            : readVec3(p.rotate, [0, 0, 0], 'rotate')
        const move = readVec3(p.move, [0, 0, 0], 'move')
        const scale = readVec3(p.scale, [1, 1, 1], 'scale')
        const elementEdit = p.verts !== undefined || p.faces !== undefined

        const changed: string[] = []
        for (const entry of targets) {
            const pivot = resolvePivot(p.pivot, entry)
            const matrix = transformMatrix({move, rotate, scale, pivot})

            if (elementEdit) {
                const mesh = entry.mesh.clone()
                const selection = readVertSelection(p, mesh)
                transformMeshVerts(mesh, matrix, selection)
                ctx.doc.setMesh(entry, mesh)
            } else {
                ctx.doc.record(entry)
                transformObject(entry, matrix)
            }
            changed.push(entry.name)
        }
        if (!changed.length) ctx.warn('the command matched no objects')
        return {objects: changed, data: {mode: elementEdit ? 'mesh' : 'object', count: changed.length}}
    },
}

function axisAngleToEuler(axis: 'x' | 'y' | 'z', angle: number): Vec3Tuple {
    return axis === 'x' ? [angle, 0, 0] : axis === 'z' ? [0, 0, angle] : [0, angle, 0]
}

function resolvePivot(value: unknown, entry: {mesh: import('@threepipe/mesh-kernel').MeshData}): Vec3Tuple {
    if (value === 'center') return meshBounds(entry.mesh).center
    if (value === 'origin' || value === undefined) return [0, 0, 0]
    return readVec3(value, [0, 0, 0], 'pivot')
}

export const arrayCommand: CommandDefinition = {
    op: 'array',
    summary: 'Repeat an object\'s geometry - in a line, around a pivot, or along a path.',
    description:
        'Three modes, chosen by which parameters are present: `step` gives a linear array, `angle` a '
        + 'radial one, `path` a curve array whose copies follow the local tangent.\n\n'
        + 'Copies land in the same mesh by default and are welded where they meet, so a chain of '
        + 'track shoes is one continuous surface rather than a pile of loose boxes. Set '
        + '`into: "objects"` to get separate objects instead.',
    mutates: true,
    schema: schema({
        object: S.objectRef('Objects to array.'),
        objects: S.objectRef('Alias for `object`.'),
        count: S.integer('How many copies in total, including the original.', {minimum: 1}),
        step: S.vec3('Offset between copies, for a linear array.'),
        angle: S.number('Total sweep in radians for a radial array. Defaults to a full turn.'),
        axis: S.enum('Rotation axis for a radial array. Default `y`.', AXES),
        pivot: S.vec3('Centre of a radial array.'),
        path: S.array('Path for a curve array.', S.vec3('A point.')),
        closed: S.boolean('Treat the path as a closed loop.'),
        merge: S.boolean('Weld vertices where neighbouring copies meet. Default true.'),
        mergeThreshold: S.number('Weld distance. Default 0.001.'),
        into: S.enum('`mesh` bakes copies into the object; `objects` makes separate objects.',
            ['mesh', 'objects']),
        live: S.boolean('Add this as a live modifier instead of baking it, so the master stays '
            + 'editable and every copy follows it. See the `modifier` command.'),
        name: S.string('Base name when `into` is `objects`.'),
    }, ['count']),

    run(p: Record<string, unknown>, ctx) {
        const targets = readTargets(p, ctx.doc)
        const count = p.count as number
        if (count < 1) throw new Error('count must be at least 1')
        const merge = p.merge === undefined ? true : p.merge as boolean
        const mergeThreshold = (p.mergeThreshold as number) ?? 0.001
        const into = (p.into as string) ?? 'mesh'

        const mode = p.path ? 'curve' : p.angle !== undefined || p.pivot !== undefined ? 'radial' : 'linear'
        if (mode === 'linear' && p.step === undefined) {
            throw new Error('a linear array needs a `step` offset; use `angle` for a radial array '
                + 'or `path` for a curve array')
        }

        const changed: string[] = []
        for (const entry of targets) {
            if (p.live) {
                ctx.doc.record(entry)
                const spec = {
                    type: 'array' as const,
                    mode: mode as 'linear' | 'radial' | 'curve',
                    count,
                    step: p.step !== undefined ? readVec3(p.step, [0, 0, 0], 'step') as Vec3 : undefined,
                    angle: p.angle as number | undefined,
                    axis: axisVector((p.axis as 'x' | 'y' | 'z') ?? 'y'),
                    pivot: p.pivot !== undefined ? readVec3(p.pivot, [0, 0, 0], 'pivot') as Vec3 : undefined,
                    path: p.path ? readPoints(p.path, 'path') as Vec3[] : undefined,
                    closed: p.closed as boolean | undefined,
                    merge,
                    mergeThreshold,
                }
                checkModifier(spec)
                entry.modifiers.push(spec)
                ctx.doc.rebake(entry)
                changed.push(entry.name)
                continue
            }
            if (into === 'objects') {
                changed.push(...arrayAsObjects(ctx, entry, p, mode, count))
                continue
            }
            const bm = bmFromMesh(entry.mesh)
            const input = allOf(bm)
            if (mode === 'linear') {
                arrayLinear(bm, input, {
                    count, step: readVec3(p.step, [0, 0, 0], 'step') as Vec3, merge, mergeThreshold,
                })
            } else if (mode === 'radial') {
                arrayRadial(bm, input, {
                    count,
                    angle: (p.angle as number) ?? Math.PI * 2,
                    axis: axisVector((p.axis as 'x' | 'y' | 'z') ?? 'y'),
                    pivot: readVec3(p.pivot, [0, 0, 0], 'pivot') as Vec3,
                    merge,
                })
            } else {
                arrayCurve(bm, input, {
                    path: readPoints(p.path, 'path') as Vec3[],
                    count,
                    closed: p.closed as boolean | undefined,
                })
            }
            ctx.doc.setMesh(entry, bmToMesh(bm))
            changed.push(entry.name)
        }
        const data = targets.length === 1 && into === 'mesh' ? {
            mode, count,
            verts: ctx.doc.require(changed[0]).mesh.vertsNum,
            faces: ctx.doc.require(changed[0]).mesh.facesNum,
        } : {mode, count, objects: changed.length}
        return {objects: changed, data}
    },
}

function axisVector(axis: 'x' | 'y' | 'z'): Vec3 {
    return axis === 'x' ? [1, 0, 0] : axis === 'z' ? [0, 0, 1] : [0, 1, 0]
}

/** The `into: "objects"` path: real scene objects rather than one welded mesh. */
function arrayAsObjects(
    ctx: {doc: import('../document').ModellingDocument, warn(m: string): void},
    entry: import('../document').ModellingEntry,
    p: Record<string, unknown>, mode: string, count: number,
): string[] {
    const made: string[] = []
    const base = (p.name as string) ?? entry.name
    const step = readVec3(p.step, [0, 0, 0], 'step')
    const pivot = readVec3(p.pivot, [0, 0, 0], 'pivot')
    const angle = (p.angle as number) ?? Math.PI * 2
    const axis = axisVector((p.axis as 'x' | 'y' | 'z') ?? 'y')

    for (let i = 1; i < count; i++) {
        const copy = ctx.doc.add(entry.mesh.clone(), {name: ctx.doc.uniqueName(base)})
        if (entry.modifiers.length) {
            copy.modifiers = entry.modifiers.map(m => ({...m}))
            ctx.doc.rebake(copy)
        }
        copy.object.position.copy(entry.object.position)
        copy.object.quaternion.copy(entry.object.quaternion)
        copy.object.scale.copy(entry.object.scale)

        const m = new Matrix4()
        if (mode === 'radial') {
            const a = angle * (i / count)
            m.makeTranslation(pivot[0], pivot[1], pivot[2])
                .multiply(new Matrix4().makeRotationAxis(new Vector3(...axis), a))
                .multiply(new Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]))
        } else {
            m.makeTranslation(step[0] * i, step[1] * i, step[2] * i)
        }
        transformObject(copy, m)
        made.push(copy.name)
    }
    return made
}

export const duplicateCommand: CommandDefinition = {
    op: 'duplicate',
    summary: 'Copy objects, optionally offset, rotated, or repeated.',
    description:
        'The copies are independent objects with their own topology, which is what you want for '
        + 'kit-bashing - mirror a whole road-wheel assembly to the other side of a hull and then '
        + 'edit one of them without touching the other.',
    mutates: true,
    schema: schema({
        object: S.objectRef('Objects to copy.'),
        objects: S.objectRef('Alias for `object`.'),
        move: S.vec3('Offset applied to each copy.'),
        rotate: S.vec3('Euler XYZ rotation applied to each copy.'),
        angle: S.number('Rotation about `axis`, an alternative to `rotate`.'),
        axis: S.enum('Axis for `angle`.', AXES),
        scale: S.vec3('Scale applied to each copy. Use -1 on an axis to mirror.'),
        pivot: S.vec3('Point the rotation and scale happen about.'),
        count: S.integer('How many copies to make. Each is offset one step further. Default 1.',
            {minimum: 1}),
        name: S.string('Base name for the copies. Defaults to the source name.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const targets = readTargets(p, ctx.doc)
        const count = (p.count as number) ?? 1
        const move = readVec3(p.move, [0, 0, 0], 'move')
        const rotate = p.angle !== undefined
            ? axisAngleToEuler((p.axis as 'x' | 'y' | 'z') ?? 'y', p.angle as number)
            : readVec3(p.rotate, [0, 0, 0], 'rotate')
        const scale = readVec3(p.scale, [1, 1, 1], 'scale')
        const pivot = readVec3(p.pivot, [0, 0, 0], 'pivot')

        const made: string[] = []
        for (const entry of targets) {
            for (let i = 1; i <= count; i++) {
                const copy = ctx.doc.add(entry.mesh.clone(), {
                    name: ctx.doc.uniqueName((p.name as string) ?? entry.name),
                })
                // Carry the modifier stack across, the way Blender's duplicate does. Without this a
                // mirrored road-wheel assembly comes back as one bare wheel, which is exactly the
                // sort of silent wrongness that only shows up three captures later.
                if (entry.modifiers.length) {
                    copy.modifiers = entry.modifiers.map(m => ({...m}))
                    ctx.doc.rebake(copy)
                }
                copy.object.position.copy(entry.object.position)
                copy.object.quaternion.copy(entry.object.quaternion)
                copy.object.scale.copy(entry.object.scale)
                const mat = entry.object.material as {color?: {getHexString(): string}} | undefined
                const copyMat = copy.object.material as {color?: {set(v: string): void}} | undefined
                if (mat?.color && copyMat?.color) copyMat.color.set('#' + mat.color.getHexString())

                transformObject(copy, transformMatrix({
                    move: [move[0] * i, move[1] * i, move[2] * i],
                    rotate: [rotate[0] * i, rotate[1] * i, rotate[2] * i],
                    scale: i === 1 ? scale : [scale[0] ** i, scale[1] ** i, scale[2] ** i],
                    pivot,
                }))
                made.push(copy.name)
            }
        }
        return {objects: made, data: {created: made.length}}
    },
}

export const mirrorCommand: CommandDefinition = {
    op: 'mirror',
    summary: 'Mirror an object\'s geometry across a plane, welding vertices that sit on it.',
    description:
        'Unlike `duplicate` with a negative scale, this produces one mesh with correct winding on '
        + 'both halves and no seam - the usual way to build a symmetric hull from one side of it.',
    mutates: true,
    schema: schema({
        object: S.objectRef('Objects to mirror.'),
        objects: S.objectRef('Alias for `object`.'),
        axis: S.enum('Mirror axis. Default `x`.', AXES),
        mergeDistance: S.number('Weld vertices within this distance of the plane. Default 0.001.'),
        center: S.vec3('A point on the mirror plane. Default the object origin.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const targets = readTargets(p, ctx.doc)
        const axis = (p.axis as 'x' | 'y' | 'z') ?? 'x'
        const center = readVec3(p.center, [0, 0, 0], 'center')
        const matrix = new Matrix4().makeTranslation(center[0], center[1], center[2]).toArray() as Mat4

        const changed: string[] = []
        for (const entry of targets) {
            const bm = bmFromMesh(entry.mesh)
            mirrorGeometry(bm, allOf(bm), {
                axis,
                matrix,
                mergeDistance: (p.mergeDistance as number) ?? 0.001,
            })
            ctx.doc.setMesh(entry, bmToMesh(bm))
            changed.push(entry.name)
        }
        return {objects: changed, data: {count: changed.length}}
    },
}

export const extrudeCommand: CommandDefinition = {
    op: 'extrude',
    summary: 'Extrude faces of an object outward, optionally scaling the new cap.',
    description:
        'The default direction is the region\'s averaged face normal, which is what makes extrude '
        + 'useful on a face that is not axis-aligned - a sloped glacis plate grows perpendicular to '
        + 'itself, not along Y. Give `direction` to override it.\n\n'
        + 'Face indices come from `inspect` with `detail`. The new cap faces are reported back, '
        + 'because their indices are what a follow-up extrude or transform addresses.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to extrude.'),
        objects: S.objectRef('Alias for `object`.'),
        faces: S.array('Face indices to extrude, as a region.', {type: 'integer'}, {minItems: 1}),
        distance: S.number('How far to move the new cap. Default 0.1.'),
        direction: S.vec3('Direction to move the cap. Default the averaged face normal.'),
        scale: S.vec3('Scale the cap about its own centre after moving - taper or flare.'),
    }, ['faces']),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const bm = bmFromMesh(entry.mesh)
        const all = [...bm.faces]
        const indices = p.faces as number[]
        const region = indices.map(i => {
            if (!Number.isInteger(i) || i < 0 || i >= all.length) {
                throw new Error(`face ${i} is out of range - "${entry.name}" has ${all.length}`)
            }
            return all[i]
        })

        // Measure the normal before the topology changes; afterwards the originals are gone.
        const normal = averageFaceNormal(region)
        const result = extrudeFaceRegion(bm, region)
        if (!result) throw new Error('nothing was extruded - check the face indices')

        const distance = (p.distance as number) ?? 0.1
        const dir = p.direction !== undefined
            ? readVec3(p.direction, [0, 1, 0], 'direction')
            : normal ?? [0, 1, 0]
        translateVerts(result.verts, dir[0] * distance, dir[1] * distance, dir[2] * distance)

        if (p.scale !== undefined) {
            const scale = readVec3(p.scale, [1, 1, 1], 'scale')
            let cx = 0, cy = 0, cz = 0
            for (const v of result.verts) {
                cx += v.x
                cy += v.y
                cz += v.z
            }
            const n = result.verts.length || 1
            cx /= n
            cy /= n
            cz /= n
            for (const v of result.verts) {
                v.setCo(cx + (v.x - cx) * scale[0], cy + (v.y - cy) * scale[1], cz + (v.z - cz) * scale[2])
            }
        }

        const mesh = bmToMesh(bm)
        ctx.doc.setMesh(entry, mesh)

        // Report where the new cap faces ended up, so the next command can address them.
        const faces = [...bm.faces]
        return {
            objects: [entry.name],
            data: {
                capFaces: result.faces.map(f => faces.indexOf(f)).filter(i => i >= 0),
                sideFaces: result.sideFaces.length,
                normal,
                verts: mesh.vertsNum,
                faces: mesh.facesNum,
            },
        }
    },
}

export const deleteCommand: CommandDefinition = {
    op: 'delete',
    summary: 'Remove objects from the document and the scene.',
    mutates: true,
    schema: schema({
        object: S.objectRef('Objects to remove. `prefix*` and `*` work.'),
        objects: S.objectRef('Alias for `object`.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const targets = readTargets(p, ctx.doc)
        const names = targets.map(t => t.name)
        for (const entry of targets) ctx.doc.remove(entry)
        return {objects: names, data: {removed: names.length}}
    },
}

export const editCommands = [
    verticesCommand, transformCommand, extrudeCommand, arrayCommand, duplicateCommand,
    mirrorCommand, deleteCommand,
]
