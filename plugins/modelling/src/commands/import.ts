/**
 * `import` - bring a model in as editable document objects.
 *
 * Most generated 3D arrives as triangles: an img2threejs-style `createXModel()` factory's `Group`, a GLB
 * from a text-to-3D service, a scan. This welds each mesh back into shared-vertex topology and adopts it,
 * so every other command can then address it - "generate anywhere, edit here". A GLB this package wrote
 * comes back exact instead, through its `THREEPIPE_mesh_topology` extension.
 */

import {IObject3D} from 'threepipe'
import {CommandDefinition, S, schema} from './types'

function base64ToBytes(base64: string): Uint8Array {
    if (typeof atob === 'function') {
        const binary = atob(base64)
        const out = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
        return out
    }
    return new Uint8Array(Buffer.from(base64, 'base64'))
}

export const importCommand: CommandDefinition = {
    op: 'import',
    summary: 'Bring a model in as editable objects: a GLB/glTF/OBJ/STL (`data` as base64, or `url`), or scene objects outside the document.',
    description:
        'Each mesh is welded back into shared-vertex topology - triangles, or n-gons with `mergeCoplanar` (`weld` is the distance, default '
        + '1e-4, as edit mode uses) and adopted, keeping its name, transform, hierarchy and material. A GLB '
        + 'exported from here comes back with its exact topology and modifier stack instead - `source: '
        + '"topology"` in the result. `object` adopts meshes already in the scene (added by a script) '
        + 'that the document does not manage yet.\n\n'
        + 'Welding is lossy where coincident vertices were meant to be separate (hard UV seams): the '
        + 'result reports `welded`, how many vertices merged. Run `validate` after importing - generated '
        + 'meshes are often non-manifold.',
    mutates: true,
    schema: schema({
        data: S.string('The file, base64-encoded. The CLI fills this in from a path.'),
        url: S.string('A URL to load instead.'),
        format: S.enum('Format of `data`. Default `glb`.', ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply']),
        object: S.objectRef('Scene objects (by name or uuid) to adopt instead of loading a file.'),
        name: S.string('Rename the imported object, when there is exactly one.'),
        weld: S.number('Weld distance. Default 1e-4.', {minimum: 0}),
        mergeCoplanar: S.boolean('Merge coplanar triangles back into n-gons. Off by default: it guesses at intent.'),
    }),

    async run(p: Record<string, unknown>, ctx) {
        const roots: IObject3D[] = []
        const sources = [p.data, p.url, p.object].filter(x => x !== undefined).length
        if (sources !== 1) throw new Error('give exactly one of `data`, `url` or `object`')
        if (p.object !== undefined) {
            const refs = Array.isArray(p.object) ? p.object as string[] : [p.object as string]
            for (const ref of refs) {
                let found: IObject3D | undefined
                ctx.viewer.scene.modelRoot.traverse((o: IObject3D) => {
                    if (!found && (o.uuid === ref || o.name === ref)) found = o
                })
                if (!found) throw new Error(`no object "${ref}" in the scene`)
                roots.push(found)
            }
        } else {
            const format = (p.format as string | undefined) ?? 'glb'
            const asset = p.data !== undefined
                ? new File([base64ToBytes(p.data as string) as BlobPart], `import.${format}`)
                : p.url as string
            const loaded = await ctx.viewer.load(asset as never, {autoScale: false, autoCenter: false} as never)
            if (!loaded) throw new Error('nothing could be loaded - check the format and the data')
            roots.push(loaded as unknown as IObject3D)
        }
        const imported = roots.flatMap(root => ctx.doc.importObject(root, {
            tolerance: p.weld as number | undefined, mergeCoplanar: p.mergeCoplanar as boolean | undefined,
        }))
        if (!imported.length) ctx.warn('no meshes found to import')
        if (p.name !== undefined) {
            if (imported.length !== 1) ctx.warn(`\`name\` applies to a single object; ${imported.length} were imported`)
            else if (imported[0].name !== p.name) {
                imported[0].name = ctx.doc.rename(ctx.doc.require(imported[0].name), ctx.doc.uniqueName(p.name as string))
            }
        }
        for (const i of imported) {
            if (i.source === 'welded' && i.welded) ctx.warn(`"${i.name}": welded ${i.welded} coincident vertices`)
        }
        return {objects: imported.map(i => i.name), data: {imported}}
    },
}
