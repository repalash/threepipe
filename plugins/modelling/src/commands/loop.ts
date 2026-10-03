/**
 * `subdivide` - the loop tools' document command.
 *
 * The same kernel port as the edit-mode Subdivide (`bmo_subdivide.cc`, with `MESH_OT_subdivide`'s
 * option mapping from `edbm_subdivide_exec`), addressed by edge index so an agent or a script can cut
 * edges without an edit session.
 */

import {bmFromMesh, bmToMesh, editMeshSubdivideOptions, meshNormalsUpdate, subdivideEdges} from '@threepipe/mesh-kernel'
import type {BMEdge, SubdQuadCornerType} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {readTarget} from './params'

const QUAD_CORNERS = ['innerVert', 'path', 'straightCut', 'fan'] as const

export const subdivideCommand: CommandDefinition = {
    op: 'subdivide',
    summary: 'Subdivide edges - cut each into equal parts and split the faces between them.',
    description:
        'Blender\'s Subdivide. Each listed edge gets `cuts` new vertices; a face whose cut edges match '
        + 'one of Blender\'s fill patterns is split by it (all four sides cut makes a grid, two '
        + 'opposite sides a set of parallel cuts), and a face with no matching pattern keeps the new '
        + 'vertices on its boundary.\n\n'
        + '`smoothness` bulges the new vertices out along the surface\'s curvature, as if the edges '
        + 'were arcs; 0 keeps them on the straight edges. `ngon: false` limits the new faces to '
        + 'triangles and quads.\n\n'
        + 'The result lists the new vertices, edges and faces made inside the cut faces (`inner*`), '
        + 'by index into the rebuilt mesh.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to subdivide.'),
        objects: S.objectRef('Alias for `object`.'),
        edges: S.array('Edge indices to cut. Default every edge.', {type: 'integer'}),
        cuts: S.integer('New vertices per edge, 1..100. Default 1.', {minimum: 1, maximum: 100}),
        smoothness: S.number('Bulge along the curvature. Default 0 (flat).', {minimum: 0, maximum: 1000}),
        ngon: S.boolean('Allow faces with more than four sides. Default true.'),
        quadCorner: S.enum('How a quad with two adjacent cut edges is filled. Default straightCut.', QUAD_CORNERS),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const bm = bmFromMesh(entry.mesh)
        const all = [...bm.edges]
        let edges: BMEdge[] = all
        if (p.edges !== undefined) {
            if (!Array.isArray(p.edges)) throw new Error('`edges` must be a list of indices')
            edges = p.edges.map(i => {
                if (!Number.isInteger(i) || i < 0 || i >= all.length) {
                    throw new Error(`edge ${i} is out of range - "${entry.name}" has ${all.length}`)
                }
                return all[i as number]
            })
        }
        if (!edges.length) throw new Error(`"${entry.name}" has no edges to subdivide`)

        // The smoothing reads vertex normals, which edit mode keeps current.
        meshNormalsUpdate(bm)
        const result = subdivideEdges(bm, edges, editMeshSubdivideOptions({
            numberCuts: (p.cuts as number) ?? 1,
            smoothness: (p.smoothness as number) ?? 0,
            ngon: p.ngon === undefined ? true : p.ngon as boolean,
            quadcorner: (p.quadCorner as SubdQuadCornerType) ?? 'straightCut',
        }))

        const mesh = bmToMesh(bm)
        ctx.doc.setMesh(entry, mesh)

        // `bmToMesh` numbers elements in set order.
        const indexOf = <T>(set: Iterable<T>, list: T[]) => {
            const index = new Map<T, number>()
            let i = 0
            for (const e of set) index.set(e, i++)
            return list.map(e => index.get(e)!).filter(x => x !== undefined)
        }
        return {
            objects: [entry.name],
            data: {
                innerVerts: indexOf(bm.verts, result.inner.verts),
                innerEdges: indexOf(bm.edges, result.inner.edges),
                innerFaces: indexOf(bm.faces, result.inner.faces),
                verts: mesh.vertsNum,
                edges: mesh.edgesNum,
                faces: mesh.facesNum,
            },
        }
    },
}

export const loopCommands = [subdivideCommand]
