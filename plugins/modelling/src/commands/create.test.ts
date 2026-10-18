import {describe, expect, it} from 'vitest'
import {Euler, Vector3} from 'threepipe'
import {AttrDomain, MeshData, PRIMITIVE_UV_LAYER, primitiveCube} from '@threepipe/mesh-kernel'
import {primitiveCommand} from './create'
import {CommandContext, validateParams} from './types'

/**
 * `primitive {uvs}` - Blender's "Generate UVs" (`calc_uvs`) through the command.
 *
 * Found by the edit-chain harness (`demos/edit-chain`): without it no command could create a UV layer,
 * so the per-step check that UVs outside an edit are preserved had nothing to check. The kernel has
 * had the UV passes (`BM_mesh_calc_uvs_*`) all along; the command just never asked for them.
 */

/** The smallest context `primitive` runs against: a document that records what it was handed. */
function stubContext(): {ctx: CommandContext, meshes: MeshData[]} {
    const meshes: MeshData[] = []
    const doc = {
        add(mesh: MeshData, options: {name?: string}) {
            meshes.push(mesh)
            return {
                name: options.name ?? 'object',
                object: {position: new Vector3(), rotation: new Euler(), scale: new Vector3(1, 1, 1)},
            }
        },
    }
    return {ctx: {doc, warn: () => undefined} as unknown as CommandContext, meshes}
}

function run(params: Record<string, unknown>): MeshData {
    expect(validateParams(primitiveCommand, params)).toEqual([])
    const {ctx, meshes} = stubContext()
    primitiveCommand.run(params, ctx)
    return meshes[0]
}

describe('primitive {uvs}', () => {
    it('leaves UVs off by default, as before', () => {
        expect(run({type: 'cube'}).attributes.get(PRIMITIVE_UV_LAYER)).toBeUndefined()
    })

    it('writes the kernel\'s Blender UV layout when asked', () => {
        const mesh = run({type: 'cube', uvs: true})
        const layer = mesh.attributes.get(PRIMITIVE_UV_LAYER)!
        expect(layer.domain).toBe(AttrDomain.Corner)
        expect(layer.type).toBe('float2')
        // The command scales a unit cube to the requested size; the layout is the kernel's, unchanged.
        const reference = primitiveCube({size: 1, calcUVs: true}).attributes.get(PRIMITIVE_UV_LAYER)!
        expect(Array.from(layer.data)).toEqual(Array.from(reference.data))
        expect(mesh.validate()).toEqual([])
    })

    it.each(['cube', 'plane', 'grid', 'circle', 'cylinder', 'cone', 'sphere', 'icosphere'])(
        'gives %s a full corner UV layer', type => {
            const mesh = run({type, uvs: true})
            const layer = mesh.attributes.get(PRIMITIVE_UV_LAYER)
            expect(layer).toBeDefined()
            expect(layer!.data.length).toBe(mesh.cornersNum * 2)
            expect(Array.from(layer!.data).every(Number.isFinite)).toBe(true)
        })

    it('refuses a torus, whose UV layout is not ported, rather than silently skipping it', () => {
        const {ctx} = stubContext()
        expect(() => primitiveCommand.run({type: 'torus', uvs: true}, ctx)).toThrow(/not available for a torus/)
    })
})
