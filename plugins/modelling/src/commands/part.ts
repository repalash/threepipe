/**
 * `part`: build a parametric part from `@threepipe/modelling-parts` (16-realism.md §4.2) as an ordinary editable
 * object. The object remembers `{type, params}`, so `part {name, params}` regenerates it with new parameters until
 * its topology is edited by another command; after that it is plain topology, like an applied modifier in Blender.
 */

import {shadeSmoothByAngle} from '@threepipe/mesh-kernel'
import {PARTS} from '@threepipe/modelling-parts'
import {CommandDefinition, S, schema} from './types'
import {readVec3} from './params'

interface PartState {type: string, params: Record<string, unknown>, revision: number}

const summary = () => [...PARTS.values()].map(p => `\`${p.id}\` (${Object.keys(p.params.properties).join(', ')})`).join('; ')

export const partCommand: CommandDefinition = {
    op: 'part',
    summary: 'Add a parametric part - knurled ring, dial, button, rocker, eyecup, strap lug, lens barrel - as an editable object.',
    description: 'Builds the part in part space (its axis +y, base at the origin) and places it with `position` and '
        + '`rotation`. Ribs and knurls are real geometry; faces are smoothed by angle as the part is designed. '
        + 'Give `name` of an existing part and new `params` to regenerate it in place (only while no other command '
        + 'has edited it). `list: true` returns every part with its parameter schema. Parts: ' + summary() + '.',
    mutates: true,
    schema: schema({
        type: S.enum('Part id.', [...PARTS.keys()]),
        name: S.string('Object name. Required to regenerate an existing part.'),
        params: {type: 'object', description: 'The part\'s parameters (see `list`).'},
        position: S.vec3('World position.'),
        rotation: S.vec3('Euler XYZ rotation in radians.'),
        list: S.boolean('Return the parts and their parameter schemas instead of building one.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        if (p.list) return {data: {parts: [...PARTS.values()].map(d => ({id: d.id, title: d.title, tags: d.tags, params: d.params}))}}
        let existing: ReturnType<typeof ctx.doc.resolve>[number] | undefined
        if (p.name) try { existing = ctx.doc.resolve(p.name as string)[0] } catch { existing = undefined }
        const state = existing?.object.userData.part as PartState | undefined
        if (existing && !state) throw new Error(`"${existing.name}" is not a part; pick another name`)
        if (existing && state && existing.revision !== state.revision) {
            throw new Error(`"${existing.name}" was edited after it was built, so it is plain topology now; build a new part instead`)
        }
        const type = (p.type as string | undefined) ?? state?.type
        if (!type) throw new Error('`type` is required for a new part')
        const def = PARTS.get(type)
        if (!def) throw new Error(`unknown part "${type}"`)
        const params = {...(state && state.type === type ? state.params : {}), ...(p.params as Record<string, unknown> ?? {})}
        for (const k of def.params.required ?? []) if (params[k] === undefined) throw new Error(`${type} needs \`${k}\``)
        for (const k of Object.keys(params)) if (!def.params.properties[k]) throw new Error(`${type} has no parameter \`${k}\` (it has ${Object.keys(def.params.properties).join(', ')})`)
        const built = def.build(params)
        shadeSmoothByAngle(built.mesh, (built.smoothAngle ?? 30) * Math.PI / 180, false)

        const entry = existing ?? ctx.doc.add(built.mesh, {name: (p.name as string | undefined) ?? type.split('/').pop()})
        if (existing) ctx.doc.setMesh(existing, built.mesh)
        const o = entry.object
        if (p.position !== undefined) o.position.set(...readVec3(p.position, [0, 0, 0], 'position'))
        if (p.rotation !== undefined) o.rotation.set(...readVec3(p.rotation, [0, 0, 0], 'rotation'))
        o.setDirty?.()
        o.userData.part = {type, params, revision: entry.revision} satisfies PartState
        return {
            objects: [entry.name],
            data: {
                name: entry.name, type, params, verts: built.mesh.vertsNum, faces: built.mesh.facesNum,
                groups: Object.fromEntries(Object.entries(built.groups).map(([k, g]) => [k, {faces: g.faces?.length ?? 0, edges: g.edges?.length ?? 0}])),
                anchors: built.anchors,
            },
        }
    },
}

export const partCommands = [partCommand]
