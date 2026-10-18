/**
 * `boolean`: Blender's Boolean (Manifold solver) between document objects, applied to the target.
 *
 * The cutters are placed by their world transforms relative to the target (as the Boolean modifier places its
 * operand objects), their evaluated meshes are used (modifiers included), and the result replaces the target's
 * master mesh, through the kernel's port of `mesh_boolean_manifold.cc`. Material indices are kept as they are
 * (the modifier's default "Index Based" material mode).
 */

import {Matrix4} from 'threepipe'
import {meshBooleanManifold, Mat4} from '@threepipe/mesh-kernel'
import type {BooleanOperation} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {readTarget} from './params'
import {loadManifold} from '../manifold'

const OPERATIONS = ['DIFFERENCE', 'UNION', 'INTERSECT']

export const booleanCommand: CommandDefinition = {
    op: 'boolean',
    summary: 'Cut, merge or intersect objects (Blender\'s Boolean, Manifold solver).',
    description:
        'Cuts holes, recesses, ports and slots into a part, or merges parts into one solid, with the same Manifold '
        + 'solver Blender uses. `object` is the target, `with` the cutter objects (placed where they are in the scene). '
        + '`DIFFERENCE` removes the cutters\' volume, `UNION` merges, `INTERSECT` keeps the overlap. Both sides must be '
        + 'closed and manifold (a single quad cutter is allowed for DIFFERENCE: it trims along its plane). '
        + 'Cut faces keep their source faces\' attributes; new corners interpolate UVs within their source face. '
        + '`cutters` decides what happens to the cutter objects afterwards: `delete` (default), `hide`, or `keep`.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The target object, whose mesh is replaced by the result.'),
        with: S.objectRef('The cutter object(s). `prefix*` works.'),
        operation: S.enum('DIFFERENCE (default), UNION or INTERSECT.', OPERATIONS),
        cutters: S.enum('What to do with the cutters afterwards: delete (default), hide or keep.', ['delete', 'hide', 'keep']),
    }, ['object', 'with']),

    async run(p: Record<string, unknown>, ctx) {
        const target = readTarget(p, ctx.doc)
        const cutters = ctx.doc.resolve(p.with as string | string[]).filter(e => e !== target)
        if (!cutters.length) throw new Error('`with` matched no other object')
        const operation = ((p.operation as string | undefined) ?? 'DIFFERENCE') as BooleanOperation
        if (!OPERATIONS.includes(operation)) throw new Error(`unknown operation "${operation}" - use ${OPERATIONS.join(', ')}`)
        const api = await loadManifold()

        target.object.updateMatrixWorld(true)
        const toLocal = new Matrix4().copy(target.object.matrixWorld as Matrix4).invert()
        const transforms: Mat4[] = [new Matrix4().identity().toArray()]
        for (const c of cutters) {
            c.object.updateMatrixWorld(true)
            transforms.push(new Matrix4().multiplyMatrices(toLocal, c.object.matrixWorld as Matrix4).toArray())
        }
        const result = meshBooleanManifold(api, [target.mesh, ...cutters.map(c => c.evaluated)], operation, transforms)
        if (result.error !== 'NONE' || !result.mesh) {
            const which = result.nonManifoldMeshIndices.map(i => i === 0 ? target.name : cutters[i - 1].name)
            throw new Error(result.error === 'NON_MANIFOLD'
                ? `boolean needs closed, manifold meshes; not manifold: ${which.join(', ')} (check with validate)`
                : result.error === 'RESULT_TOO_BIG' ? 'the boolean result is too large' : 'the boolean failed')
        }
        ctx.doc.setMesh(target, result.mesh)
        const mode = (p.cutters as string | undefined) ?? 'delete'
        for (const c of cutters) {
            if (mode === 'delete') ctx.doc.remove(c)
            else if (mode === 'hide') { ctx.doc.record(c); c.object.visible = false }
        }
        return {
            objects: [target.name, ...cutters.map(c => c.name)],
            data: {operation, verts: result.mesh.vertsNum, faces: result.mesh.facesNum, intersectingEdges: result.intersectingEdges.length, cutters: mode},
        }
    },
}

export const booleanCommands = [booleanCommand]
