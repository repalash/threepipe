/**
 * `modifier` - add, edit, reorder, remove and apply live modifiers.
 *
 * The difference this makes: `{op: 'array', object: 'shoe', count: 88, path: [...]}` bakes 88 track
 * shoes into one mesh and the master is gone, while
 * `{op: 'array', object: 'shoe', count: 88, path: [...], live: true}` leaves the master editable and
 * the 88 copies following it. Change the shoe's guide tooth afterwards with one `vertices` command
 * and every copy updates. That is the fix for the SU-152 report's "baked repetition" weakness.
 */

import {CommandDefinition, S, schema} from './types'
import {readTarget, readTargets} from './params'
import {checkModifier, describeModifier, ModifierSpec} from '../modifiers'

export const modifierCommand: CommandDefinition = {
    op: 'modifier',
    summary: 'Manage an object\'s live modifier stack: add, update, reorder, remove or apply.',
    description:
        'Modifiers evaluate in order on top of the master mesh, which stays editable - vertex '
        + 'indices always refer to the master, never to the evaluated copies. Call with only an '
        + 'object to list the stack.\n\n'
        + '`apply` bakes the stack into the master and empties it, which is what you do when a part '
        + 'is finished and you want to edit an individual copy.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object whose stack to work on.'),
        objects: S.objectRef('Alias for `object`.'),
        add: {
            type: 'object',
            description: 'A modifier to append. `{type: "array", mode, count, ...}` or '
                + '`{type: "mirror", axis}`.',
            properties: {
                type: {type: 'string', enum: ['array', 'mirror']},
                mode: {type: 'string', enum: ['linear', 'radial', 'curve']},
                count: {type: 'integer', minimum: 1},
                step: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3},
                angle: {type: 'number'},
                axis: {},
                pivot: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3},
                path: {type: 'array', items: {type: 'array', items: {type: 'number'}}},
                closed: {type: 'boolean'},
                merge: {type: 'boolean'},
                mergeThreshold: {type: 'number'},
                mergeDistance: {type: 'number'},
                center: {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3},
            },
            required: ['type'],
        },
        index: S.integer('Which modifier `update`, `remove` or `move` refers to.', {minimum: 0}),
        update: {type: 'object', description: 'Fields to change on the modifier at `index`.'},
        remove: S.boolean('Remove the modifier at `index`.'),
        move: S.integer('Move the modifier at `index` to this position.', {minimum: 0}),
        apply: S.boolean('Bake the whole stack into the master mesh and clear it.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        // Listing is read-only; everything else takes exactly one object.
        const listing = p.add === undefined && p.update === undefined && p.remove === undefined
            && p.move === undefined && p.apply === undefined
        if (listing) {
            const targets = readTargets(p, ctx.doc, false)
            const entries = targets.length ? targets : ctx.doc.entries
            return {
                objects: entries.map(e => e.name),
                data: entries
                    .filter(e => e.modifiers.length)
                    .map(e => ({
                        object: e.name,
                        modifiers: e.modifiers.map((m, i) => ({index: i, ...m, summary: describeModifier(m)})),
                        masterVerts: e.mesh.vertsNum,
                        evaluatedVerts: e.evaluated.vertsNum,
                    })),
            }
        }

        const entry = readTarget(p, ctx.doc)
        ctx.doc.record(entry)

        if (p.apply) {
            if (!entry.modifiers.length) ctx.warn(`"${entry.name}" has no modifiers to apply`)
            entry.mesh = entry.evaluated
            entry.modifiers = []
            ctx.doc.rebake(entry)
            return {objects: [entry.name], data: {applied: true, verts: entry.mesh.vertsNum}}
        }

        if (p.add !== undefined) {
            const spec = readModifier(p.add as Record<string, unknown>)
            checkModifier(spec)
            entry.modifiers.push(spec)
        }

        if (p.index !== undefined) {
            const index = p.index as number
            if (index < 0 || index >= entry.modifiers.length) {
                throw new Error(`"${entry.name}" has ${entry.modifiers.length} modifiers, `
                    + `so index ${index} does not exist`)
            }
            if (p.remove) {
                entry.modifiers.splice(index, 1)
            } else if (p.move !== undefined) {
                const to = Math.min(p.move as number, entry.modifiers.length - 1)
                const [spec] = entry.modifiers.splice(index, 1)
                entry.modifiers.splice(to, 0, spec)
            } else if (p.update !== undefined) {
                const merged = readModifier({
                    ...(entry.modifiers[index] as unknown as Record<string, unknown>),
                    ...(p.update as Record<string, unknown>),
                })
                checkModifier(merged)
                entry.modifiers[index] = merged
            }
        } else if (p.remove || p.move !== undefined || p.update !== undefined) {
            throw new Error('`remove`, `move` and `update` need an `index` saying which modifier')
        }

        ctx.doc.rebake(entry)
        return {
            objects: [entry.name],
            data: {
                modifiers: entry.modifiers.map((m, i) => ({index: i, summary: describeModifier(m)})),
                masterVerts: entry.mesh.vertsNum,
                evaluatedVerts: entry.evaluated.vertsNum,
                evaluatedFaces: entry.evaluated.facesNum,
            },
        }
    },
}

/**
 * Read a loose parameter bag into a typed modifier.
 *
 * `mode` is inferred from which parameters are present when it is left out, by the same rule the
 * `array` command uses - so `{type: 'array', count: 6, step: [...]}` means the same thing to both.
 */
function readModifier(raw: Record<string, unknown>): ModifierSpec {
    const type = raw.type
    if (type === 'mirror') {
        return {
            type: 'mirror',
            axis: (raw.axis as 'x' | 'y' | 'z') ?? 'x',
            mergeDistance: raw.mergeDistance as number | undefined,
            center: raw.center as ModifierSpec extends never ? never : [number, number, number] | undefined,
        }
    }
    if (type !== 'array') throw new Error(`unknown modifier type "${String(type)}"`)
    const mode = (raw.mode as 'linear' | 'radial' | 'curve' | undefined)
        ?? (raw.path ? 'curve' : raw.angle !== undefined || raw.pivot !== undefined ? 'radial' : 'linear')
    return {
        type: 'array',
        mode,
        count: raw.count as number,
        step: raw.step as [number, number, number] | undefined,
        angle: raw.angle as number | undefined,
        axis: raw.axis as [number, number, number] | undefined,
        pivot: raw.pivot as [number, number, number] | undefined,
        path: raw.path as [number, number, number][] | undefined,
        closed: raw.closed as boolean | undefined,
        merge: raw.merge as boolean | undefined,
        mergeThreshold: raw.mergeThreshold as number | undefined,
    }
}

export const modifierCommands = [modifierCommand]
