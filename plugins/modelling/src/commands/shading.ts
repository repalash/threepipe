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

import {AttrDomain, AttrName, shadeFlat, shadeSmooth, shadeSmoothByAngle, uvCubeProject} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {readTarget, readTargets} from './params'

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

/**
 * `crease`: Blender's edge crease (Shift E) and vertex crease, written as the `crease_edge` / `crease_vert`
 * attributes the Subdivision Surface modifier reads (`subdiv_converter_mesh.cc`: sharpness = 10 * crease^2, so
 * 1 is a fully sharp edge and 0.5 a softened one that relaxes after a few levels).
 */
export const creaseCommand: CommandDefinition = {
    op: 'crease',
    summary: 'Set edge and vertex creases for subdivision (Blender\'s Edge Crease / Vertex Crease).',
    description:
        'Creases control how a `subsurf` modifier treats edges: 1 keeps the edge sharp, values between soften it '
        + '(sharpness = 10 * crease^2 in OpenSubdiv). Use them on cage edges that must stay crisp - a panel line, '
        + 'the rim of a dial - instead of adding support loops. `edges` and `verts` are indices from '
        + '`inspect {detail: true}`; `edges: "all"` creases every edge.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to crease.'),
        objects: S.objectRef('Alias for `object`.'),
        edges: {description: 'Edge indices, or "all".', oneOf: [{type: 'array', items: {type: 'integer'}}, {type: 'string', enum: ['all']}]},
        verts: S.array('Vertex indices for a vertex crease.', {type: 'integer'}),
        value: S.number('Crease 0..1 for the edges. Default 1.', {minimum: 0, maximum: 1}),
        vertexValue: S.number('Crease 0..1 for the vertices. Default 1.', {minimum: 0, maximum: 1}),
    }),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const mesh = entry.mesh.clone()
        let edges = 0, verts = 0
        if (p.edges !== undefined) {
            const layer = mesh.attributes.ensure(AttrName.creaseEdge, AttrDomain.Edge, 'float').data as Float32Array
            const value = (p.value as number | undefined) ?? 1
            const list = p.edges === 'all' ? Array.from({length: mesh.edgesNum}, (_, i) => i) : p.edges as number[]
            for (const e of list) {
                if (!Number.isInteger(e) || e < 0 || e >= mesh.edgesNum) throw new Error(`edge ${e} does not exist (the mesh has ${mesh.edgesNum})`)
                layer[e] = value
                edges++
            }
        }
        if (p.verts !== undefined) {
            const layer = mesh.attributes.ensure(AttrName.creaseVert, AttrDomain.Point, 'float').data as Float32Array
            const value = (p.vertexValue as number | undefined) ?? 1
            for (const v of p.verts as number[]) {
                if (!Number.isInteger(v) || v < 0 || v >= mesh.vertsNum) throw new Error(`vertex ${v} does not exist (the mesh has ${mesh.vertsNum})`)
                layer[v] = value
                verts++
            }
        }
        if (!edges && !verts) throw new Error('crease needs `edges` or `verts`')
        ctx.doc.setMesh(entry, mesh)
        return {objects: [entry.name], data: {edges, verts}}
    },
}

/**
 * `uv`: Blender's UV > Cube Projection (`uvedit_unwrap_cube_project`, ported in the kernel's `uv/cubeProject.ts`),
 * which is what a tiling surface texture (leather, plastic grain) needs on a hard-surface part.
 */
export const uvCommand: CommandDefinition = {
    op: 'uv',
    summary: 'Generate UVs by cube projection (Blender\'s UV > Cube Projection), for tiling surface textures.',
    description: 'Each face is projected along the axis its normal is closest to: `uv = 0.5 + (position - center) / size` '
        + 'on the other two axes, in object space. `size` is the world size of one UV unit, so a relief texture '
        + '(`material {relief}` or a preset with one) repeats every `size` units on every face. Writes the `uv` corner '
        + 'layer, which subdivision, booleans and the bake carry along.',
    mutates: true,
    schema: schema({
        object: S.objectRef('Objects to unwrap. `prefix*` and `*` work.'),
        objects: S.objectRef('Alias for `object`.'),
        mode: S.enum('Projection. Only `cube` for now.', ['cube']),
        size: S.number('World size of one UV unit (Blender\'s Cube Size). Default 1.', {minimum: 0}),
        center: S.vec3('Projection centre, object space. Default the origin.'),
        faces: S.array('Only these faces. Default all.', {type: 'integer'}),
    }),

    run(p: Record<string, unknown>, ctx) {
        const names: string[] = []
        for (const entry of readTargets(p, ctx.doc)) {
            const mesh = entry.mesh.clone()
            uvCubeProject(mesh, {cubeSize: p.size as number | undefined, center: p.center as number[] | undefined, faces: p.faces as number[] | undefined})
            ctx.doc.setMesh(entry, mesh)
            names.push(entry.name)
        }
        return {objects: names, data: {count: names.length, mode: 'cube'}}
    },
}

export const shadingCommands = [shadeCommand, creaseCommand, uvCommand]
