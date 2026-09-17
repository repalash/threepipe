/**
 * `inset` and `solidify` - the two shaping operations after extrude.
 *
 * Both are on the SU-152 report's seventh request ("bevel, inset, extrusion, shell, robust boolean
 * tools"). Inset is what makes a panel line, a hatch rim or a recessed grille; solidify is what turns
 * a surface into a plate with thickness, so a mudguard or an armour panel is modelled once rather
 * than as two sheets and an edge.
 */

import {
    bmFromMesh,
    bmToMesh,
    insetIndividual,
    insetRegion,
    solidify,
} from '@threepipe/mesh-kernel'
import type {BMFace} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {readTarget} from './params'

/** Resolve a `faces` parameter to BMesh faces, defaulting to the whole mesh. */
function facesOf(bm: ReturnType<typeof bmFromMesh>, indices: unknown, name: string): BMFace[] {
    const all = [...bm.faces]
    if (indices === undefined) return all
    if (!Array.isArray(indices)) throw new Error('`faces` must be a list of face indices')
    return indices.map(i => {
        if (!Number.isInteger(i) || i < 0 || i >= all.length) {
            throw new Error(`face ${i} is out of range - "${name}" has ${all.length}`)
        }
        return all[i as number]
    })
}

export const insetCommand: CommandDefinition = {
    op: 'inset',
    summary: 'Inset faces - a smaller copy of each face, ringed by new side faces.',
    description:
        'Two forms, as in Blender. The default treats the listed faces as one region and insets its '
        + 'outline; `individual` insets each face separately.\n\n'
        + '`evenOffset` is worth knowing about: without it a vertex moves along the bisector of its '
        + 'two edges, which at a sharp corner leaves the inset much closer to one edge than the '
        + 'requested thickness. With it, the distance is right on every edge at once. It costs '
        + 'nothing and it is what Blender defaults to.\n\n'
        + '`depth` pushes the new face along the normal afterwards, so one command makes a recess or '
        + 'a raised boss.\n\n'
        + 'The result reports two face lists. `insetFaces` are the faces you passed in - still the '
        + 'same faces, just smaller - and those are what a second `inset` or an `extrude` should '
        + 'address. `rimFaces` are the new ring between the old outline and the new one.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to inset.'),
        objects: S.objectRef('Alias for `object`.'),
        faces: S.array('Face indices. Default every face.', {type: 'integer'}),
        thickness: S.number('How far in to inset. Default 0.05.'),
        depth: S.number('Push the new face along its normal. Negative recesses it.'),
        individual: S.boolean('Inset each face separately instead of as one region.'),
        evenOffset: S.boolean('Keep the inset distance true at sharp corners. Default true.'),
        relativeOffset: S.boolean('Scale the thickness by local edge length.'),
        boundary: S.boolean('Inset the region\'s open boundary too. Default true.'),
        edgeRail: S.boolean('Slide new vertices along existing edges where one is available.'),
        outset: S.boolean('Inset outward instead of inward.'),
        interpolate: S.boolean('Interpolate per-corner attributes onto the new corners.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const bm = bmFromMesh(entry.mesh)
        const faces = facesOf(bm, p.faces, entry.name)
        if (!faces.length) throw new Error(`"${entry.name}" has no faces to inset`)

        const opts = {
            thickness: (p.thickness as number) ?? 0.05,
            depth: (p.depth as number) ?? 0,
            useEvenOffset: p.evenOffset === undefined ? true : p.evenOffset as boolean,
            useRelativeOffset: p.relativeOffset as boolean | undefined,
            useBoundary: p.boundary === undefined ? true : p.boundary as boolean,
            useEdgeRail: p.edgeRail as boolean | undefined,
            useOutset: p.outset as boolean | undefined,
            useInterpolate: p.interpolate as boolean | undefined,
        }
        const result = p.individual
            ? insetIndividual(bm, faces, opts)
            : insetRegion(bm, faces, opts)

        const mesh = bmToMesh(bm)
        ctx.doc.setMesh(entry, mesh)

        // Two different sets, and confusing them is the obvious mistake to make: the faces that were
        // passed in keep their identity and are simply smaller now - those are what you inset again
        // or extrude - while `result.faces` is the *rim* between the old outline and the new one.
        // Face indices are renumbered by the rebuild, so both are re-resolved here.
        const all = [...bm.faces]
        const indexOf = (list: BMFace[]) => list.map(f => all.indexOf(f)).filter(i => i >= 0)
        return {
            objects: [entry.name],
            data: {
                mode: p.individual ? 'individual' : 'region',
                insetFaces: indexOf(faces),
                rimFaces: indexOf(result.faces),
                verts: mesh.vertsNum,
                faces: mesh.facesNum,
            },
        }
    },
}

export const solidifyCommand: CommandDefinition = {
    op: 'solidify',
    summary: 'Give a surface thickness: a second surface offset from it, plus a rim joining the two.',
    description:
        '`offset` is a placement, not a distance - at -1 the input surface is the outer one and the '
        + 'shell grows inward, at +1 it is the inner one, at 0 the shell straddles it. The thickness '
        + 'is `thickness` in every case.\n\n'
        + '`evenOffset` keeps the thickness true where the surface folds; without it a 90 degree '
        + 'fold comes out about 29% thin.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to solidify.'),
        objects: S.objectRef('Alias for `object`.'),
        faces: S.array('Face indices. Default every face.', {type: 'integer'}),
        thickness: S.number('Shell thickness. Default 0.05. Negative flips which side it grows.'),
        offset: S.number('Placement in -1..1. Default -1, which grows inward.',
            {minimum: -1, maximum: 1}),
        offsetClamp: S.number('Shrink the offset near small geometry. 0, the default, is off.'),
        evenOffset: S.boolean('Keep the thickness true at folds. Default true.'),
        highQualityNormals: S.boolean('Offset along angle-weighted edge normals.'),
        rim: S.boolean('Bridge the two surfaces along open boundaries. Default true.'),
        rimOnly: S.boolean('Make only the rim, not the second surface.'),
        flipNormals: S.boolean('Flip the result inside out.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const bm = bmFromMesh(entry.mesh)
        const faces = facesOf(bm, p.faces, entry.name)
        if (!faces.length) throw new Error(`"${entry.name}" has no faces to solidify`)

        const result = solidify(bm, faces, {
            thickness: (p.thickness as number) ?? 0.05,
            offset: (p.offset as number) ?? -1,
            offsetClamp: (p.offsetClamp as number) ?? 0,
            useEvenOffset: p.evenOffset === undefined ? true : p.evenOffset as boolean,
            useHighQualityNormals: p.highQualityNormals as boolean | undefined,
            useRim: p.rim === undefined ? true : p.rim as boolean,
            useRimOnly: p.rimOnly as boolean | undefined,
            flipNormals: p.flipNormals as boolean | undefined,
        })

        const mesh = bmToMesh(bm)
        ctx.doc.setMesh(entry, mesh)
        return {
            objects: [entry.name],
            data: {
                innerFaces: result.innerFaces.length,
                rimFaces: result.rimFaces.length,
                verts: mesh.vertsNum,
                faces: mesh.facesNum,
            },
        }
    },
}

export const shapeCommands = [insetCommand, solidifyCommand]
