/**
 * `shade`: Blender's Object > Shade Flat / Shade Smooth / Shade Smooth by Angle on whole objects.
 *
 * A thin wrapper over the kernel's port (`@threepipe/mesh-kernel` `shading.ts`: `mesh_smooth_set`,
 * `mesh_sharp_edges_set_from_angle`). It writes `sharp_face` / `sharp_edge` into the mesh, which is what the
 * bake splits normals on, so the result is saved with the topology and survives every later operator.
 *
 * Why it matters: primitives, lathes and bevels come out flat-shaded (as Blender's do), so a filleted part
 * renders as a row of facets. Smooth by angle keeps the real corners sharp and lets the fillets read as curves.
 */

import {shadeFlat, shadeSmooth, shadeSmoothByAngle} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {readTargets} from './params'

export const shadeCommand: CommandDefinition = {
    op: 'shade',
    summary: 'Shade objects flat, smooth, or smooth by angle (Blender\'s Object > Shade).',
    description:
        'Blender\'s `object.shade_flat` / `shade_smooth` / `shade_smooth_by_angle`. `byAngle` (the usual choice for '
        + 'hard-surface parts) smooths everything, then marks edges sharp where faces meet at more than `angle` '
        + 'degrees, so chamfers and fillets read as curves while real corners stay crisp. `keepSharpEdges` keeps '
        + 'edges already marked sharp (Blender\'s default); false clears them first.',
    mutates: true,
    schema: schema({
        object: S.objectRef('Objects to shade. `prefix*` and `*` work.'),
        objects: S.objectRef('Alias for `object`.'),
        mode: S.enum('flat, smooth, or byAngle. Default byAngle.', ['flat', 'smooth', 'byAngle']),
        angle: S.number('byAngle: the largest angle between face normals that stays smooth, in degrees. Default 30.', {minimum: 0, maximum: 180}),
        keepSharpEdges: S.boolean('Keep edges already marked sharp. Default true.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const mode = (p.mode as string | undefined) ?? 'byAngle'
        const angle = ((p.angle as number | undefined) ?? 30) * Math.PI / 180
        const keep = (p.keepSharpEdges as boolean | undefined) ?? true
        const names: string[] = []
        let sharpEdges = 0
        for (const entry of readTargets(p, ctx.doc)) {
            const mesh = entry.mesh.clone()
            if (mode === 'flat') shadeFlat(mesh, keep)
            else if (mode === 'smooth') shadeSmooth(mesh, keep)
            else if (mode === 'byAngle') shadeSmoothByAngle(mesh, angle, keep)
            else throw new Error(`unknown mode "${mode}" - use flat, smooth or byAngle`)
            const layer = mesh.attributes.get('sharp_edge')
            if (layer) for (const v of layer.data as Uint8Array) sharpEdges += v
            ctx.doc.setMesh(entry, mesh)
            names.push(entry.name)
        }
        return {objects: names, data: {count: names.length, mode, sharpEdges}}
    },
}

export const shadingCommands = [shadeCommand]
