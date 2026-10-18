/**
 * `bisect`: cut an object along a plane - Blender's Bisect (`MESH_OT_bisect`,
 * `editors/mesh/editmesh_bisect.cc`), on the kernel's port of `bmo_bisect_plane`.
 *
 * The plane is given in world space, as Blender's operator takes it, and brought into the object's own
 * space the way `mesh_bisect_exec` does (`:320-327`). Like the edit-mode operator it cuts the selected
 * part of the mesh: pass the element lists the selection holds (`verts`, `edges`, `faces`), or none to
 * cut the whole object.
 */

import {
    bisectFillDefault,
    bisectPlaneToLocal,
    bisectSelection,
    bmFromMesh,
    bmToMesh,
    BMEdge,
    BMFace,
    BMVert,
    edgeSelectSet,
    faceSelectSet,
    selectAll,
    selectNone,
    vertSelectSet,
} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {readTarget, readVec3} from './params'

/** Resolve an index list against an element array, with a message worth reading when it is wrong. */
function elementsAt<T>(all: T[], indices: unknown, kind: string, name: string): T[] {
    if (!Array.isArray(indices)) throw new Error(`\`${kind}\` must be a list of indices`)
    return indices.map(i => {
        if (!Number.isInteger(i) || i < 0 || i >= all.length) {
            throw new Error(`${kind.slice(0, -1)} ${i} is out of range - "${name}" has ${all.length}`)
        }
        return all[i as number]
    })
}

export const bisectCommand: CommandDefinition = {
    op: 'bisect',
    summary: 'Cut an object in two along a plane, optionally removing one side and closing the cut - Blender\'s Bisect.',
    description:
        'The plane is `planeCo` (a point on it) and `planeNo` (its normal), in world space. Every edge '
        + 'the plane crosses gets a vertex where it crosses, and faces are split along the new vertices, so '
        + 'the cut is a loop of edges you can select, extrude or separate.\n\n'
        + '`clearOuter` removes what lies on the side `planeNo` points to; `clearInner` removes the other '
        + 'side; `fill` closes the cut with a face (useful after clearing a side, to keep the mesh '
        + 'closed). `threshold` is how close a vertex must be to the plane to count as on it '
        + '(Blender: 0.0001); such vertices are used instead of new ones.\n\n'
        + 'With `verts`, `edges` or `faces`, only those elements are cut (the edit-mode selection); '
        + 'without, the whole object. The result lists the cut\'s vertices and edges (`cutVerts`, '
        + '`cutEdges`) and the fill faces (`fillFaces`), as indices into the new mesh.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to cut.'),
        objects: S.objectRef('Alias for `object`.'),
        planeCo: S.vec3('A point on the plane, world space. Default [0, 0, 0].'),
        planeNo: S.vec3('The plane normal, world space. Default [0, 0, 1].'),
        fill: S.boolean('Close the cut with a face.'),
        clearInner: S.boolean('Remove the geometry behind the plane.'),
        clearOuter: S.boolean('Remove the geometry in front of the plane (the side the normal points to).'),
        threshold: S.number('Vertices this close to the plane are on it. Default 0.0001.', {minimum: 0}),
        verts: S.array('Vertex indices to cut (the selection). Default: the whole object.', {type: 'integer'}),
        edges: S.array('Edge indices to cut (the selection).', {type: 'integer'}),
        faces: S.array('Face indices to cut (the selection).', {type: 'integer'}),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const planeCo = readVec3(p.planeCo, [0, 0, 0], 'planeCo')
        const planeNo = readVec3(p.planeNo, [0, 0, 1], 'planeNo')
        if (planeNo[0] === 0 && planeNo[1] === 0 && planeNo[2] === 0) throw new Error('planeNo must not be zero')
        const threshold = p.threshold === undefined ? 0.0001 : Number(p.threshold)
        if (!(threshold >= 0)) throw new Error('threshold must be zero or more')

        const bm = bmFromMesh(entry.mesh)
        const listed = p.verts !== undefined || p.edges !== undefined || p.faces !== undefined
        if (listed) {
            selectNone(bm)
            if (p.verts !== undefined) for (const v of elementsAt([...bm.verts], p.verts, 'verts', entry.name)) vertSelectSet(bm, v, true)
            if (p.edges !== undefined) for (const e of elementsAt([...bm.edges], p.edges, 'edges', entry.name)) edgeSelectSet(bm, e, true)
            if (p.faces !== undefined) for (const f of elementsAt([...bm.faces], p.faces, 'faces', entry.name)) faceSelectSet(bm, f, true)
        } else {
            selectAll(bm)
        }
        if (bm.totedgesel === 0) {
            // `mesh_bisect_invoke` (`:135`): "Selected edges/faces required".
            throw new Error('nothing to cut: select edges or faces (a single vertex has nothing to bisect)')
        }

        entry.object.updateWorldMatrix(true, false)
        const local = bisectPlaneToLocal(planeCo, planeNo, Array.from(entry.object.matrixWorld.elements))
        const before = {verts: bm.totvert, faces: bm.totface}
        bisectSelection(bm, {
            planeCo: local.planeCo, planeNo: local.planeNo,
            useFill: !!p.fill, clearInner: !!p.clearInner, clearOuter: !!p.clearOuter, threshold,
        }, bisectFillDefault)

        // After the cut Blender selects the cut (and the fill faces); report them in the new numbering.
        const vIndex = new Map<BMVert, number>([...bm.verts].map((v, i) => [v, i]))
        const eIndex = new Map<BMEdge, number>([...bm.edges].map((e, i) => [e, i]))
        const fIndex = new Map<BMFace, number>([...bm.faces].map((f, i) => [f, i]))
        const cutVerts = [...bm.verts].filter(v => v.selected).map(v => vIndex.get(v)!)
        const cutEdges = [...bm.edges].filter(e => e.selected).map(e => eIndex.get(e)!)
        const fillFaces = [...bm.faces].filter(f => f.selected).map(f => fIndex.get(f)!)

        const mesh = bmToMesh(bm)
        ctx.doc.setMesh(entry, mesh)
        if (!cutEdges.length && !cutVerts.length) ctx.warn('the plane does not cross the selected geometry; nothing was cut')
        return {
            objects: [entry.name],
            data: {
                cutVerts, cutEdges, fillFaces,
                verts: mesh.vertsNum, faces: mesh.facesNum,
                added: {verts: mesh.vertsNum - before.verts, faces: mesh.facesNum - before.faces},
            },
        }
    },
}

export const cutCommands = [bisectCommand]
