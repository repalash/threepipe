/**
 * `inset` and `solidify` - the two shaping operations after extrude.
 *
 * Both are on the SU-152 report's seventh request ("bevel, inset, extrusion, shell, robust boolean
 * tools"). Inset is what makes a panel line, a hatch rim or a recessed grille; solidify is what turns
 * a surface into a plate with thickness, so a mudguard or an armour panel is modelled once rather
 * than as two sheets and an edge.
 */

import {
    bevelEdges,
    bevelVerts,
    bmFromMesh,
    bmToMesh,
    insetIndividual,
    insetRegion,
    solidify,
} from '@threepipe/mesh-kernel'
import type {BMEdge, BMFace, BMVert} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {readTarget} from './params'

/** Resolve an index list against an element array, with a message worth reading when it is wrong. */
function elementsOf<T>(all: T[], indices: unknown, kind: string, name: string): T[] {
    if (indices === undefined) return all
    if (!Array.isArray(indices)) throw new Error(`\`${kind}\` must be a list of indices`)
    return indices.map(i => {
        if (!Number.isInteger(i) || i < 0 || i >= all.length) {
            throw new Error(`${kind.slice(0, -1)} ${i} is out of range - "${name}" has ${all.length}`)
        }
        return all[i as number]
    })
}

/** Resolve a `faces` parameter to BMesh faces, defaulting to the whole mesh. */
function facesOf(bm: ReturnType<typeof bmFromMesh>, indices: unknown, name: string): BMFace[] {
    return elementsOf<BMFace>([...bm.faces], indices, 'faces', name)
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

const OFFSET_TYPES = ['offset', 'width', 'depth', 'percent', 'absolute'] as const

export const bevelCommand: CommandDefinition = {
    op: 'bevel',
    summary: 'Round or chamfer edges, or a vertex corner.',
    description:
        'What stops a model reading as untouched primitives. One segment gives a flat chamfer; more '
        + 'give a rounded profile, and `profile: 0.5` puts those points on a circular arc.\n\n'
        + '`offsetType` decides what the number means, and the five give five different distances: '
        + '`offset` is perpendicular from the edge, `width` is across the new face, `depth` is into '
        + 'the corner, `percent` is a fraction of the adjacent edge, `absolute` is along it.\n\n'
        + '`clampOverlap` stops a bevel wider than its geometry turning the solid inside out - it '
        + 'reduces the offset to the point where the faces would collapse, which means asking for far '
        + 'too much gives zero-area faces at exactly that limit rather than a mess.\n\n'
        + 'Non-manifold and boundary edges are declined rather than corrupted.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to bevel.'),
        objects: S.objectRef('Alias for `object`.'),
        edges: S.array('Edge indices to bevel. Default every edge.', {type: 'integer'}),
        verts: S.array('Vertex indices, for a corner bevel. Use instead of `edges`.',
            {type: 'integer'}),
        offset: S.number('How far to bevel. Default 0.1.'),
        offsetType: S.enum('What `offset` measures.', OFFSET_TYPES),
        segments: S.integer('Segments across the bevel. 1 is a flat chamfer. Default 1.',
            {minimum: 1}),
        profile: S.number('Profile shape, 0 to 1. 0.5 is a circular arc; below it is concave.',
            {minimum: 0, maximum: 1}),
        clampOverlap: S.boolean('Reduce the offset rather than self-intersect. Default true.'),
        loopSlide: S.boolean('Slide along an existing edge where one is available. Default true.'),
        markSeam: S.boolean('Mark the new edges as UV seams.'),
        markSharp: S.boolean('Mark the new edges sharp.'),
        miterOuter: S.enum('How an outer corner is finished.', ['sharp', 'patch', 'arc']),
        miterInner: S.enum('How an inner corner is finished.', ['sharp', 'arc']),
        spread: S.number('Distance between the arms of an arc miter.'),
        materialIndex: S.integer('Material slot for the new faces. -1 keeps the neighbours\'.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const bm = bmFromMesh(entry.mesh)

        const opts = {
            offset: (p.offset as number) ?? 0.1,
            offsetType: p.offsetType as typeof OFFSET_TYPES[number] | undefined,
            segments: (p.segments as number) ?? 1,
            profile: (p.profile as number) ?? 0.5,
            clampOverlap: p.clampOverlap === undefined ? true : p.clampOverlap as boolean,
            loopSlide: p.loopSlide === undefined ? true : p.loopSlide as boolean,
            markSeam: p.markSeam as boolean | undefined,
            markSharp: p.markSharp as boolean | undefined,
            miterOuter: p.miterOuter as 'sharp' | 'patch' | 'arc' | undefined,
            miterInner: p.miterInner as 'sharp' | 'arc' | undefined,
            spread: p.spread as number | undefined,
            materialIndex: p.materialIndex as number | undefined,
        }

        const byVerts = p.verts !== undefined
        if (byVerts && p.edges !== undefined) {
            throw new Error('give `edges` or `verts`, not both - they are different operations')
        }

        const result = byVerts
            ? bevelVerts(bm, elementsOf<BMVert>([...bm.verts], p.verts, 'verts', entry.name), opts)
            : bevelEdges(bm, elementsOf<BMEdge>([...bm.edges], p.edges, 'edges', entry.name), opts)

        if (!result.faces.length) {
            ctx.warn('nothing was beveled - the selection may be boundary or non-manifold edges, '
                + 'which are declined rather than corrupted')
            return {objects: [entry.name], data: {newFaces: 0}}
        }

        const mesh = bmToMesh(bm)
        ctx.doc.setMesh(entry, mesh)

        const all = [...bm.faces]
        return {
            objects: [entry.name],
            data: {
                mode: byVerts ? 'verts' : 'edges',
                newFaces: result.faces.map(f => all.indexOf(f)).filter(i => i >= 0),
                verts: mesh.vertsNum,
                edges: mesh.edgesNum,
                faces: mesh.facesNum,
            },
        }
    },
}

export const shapeCommands = [insetCommand, solidifyCommand, bevelCommand]
