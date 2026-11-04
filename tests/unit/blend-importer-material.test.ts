import {describe, expect, it} from 'vitest'
import {PhysicalMaterial, Texture} from '../../src'
import {createMaterial} from '../../plugins/blend-importer/src/loader/material'
import {Ctx} from '../../plugins/blend-importer/src/loader/ctx'

// Minimal Blender node tree: ListBase chains, sockets with default_value, external Image Texture nodes.
function listBase(items: any[]) {
    items.forEach((it, i) => { it.next = items[i + 1] || null })
    return {first: items[0] || null}
}
const socket = (name: string, value?: any) => ({name, default_value: value === undefined ? undefined : {value}})
const node = (idname: string, inputs: any[] = [], extra: any = {}) => ({idname, inputs: listBase(inputs), ...extra})
const imageNode = (path: string) => node('ShaderNodeTexImage', [], {id: {name: path, source: 1}})

function blenderMaterial(nodes: any[], links: any[]) {
    return {nodetree: {nodes: listBase(nodes), links: listBase(links)}}
}
function ctx(): Ctx {
    return {
        MeshPhysicalMaterial: PhysicalMaterial,
        loadExternalTexture: (path: string) => {
            const t = new Texture()
            t.name = path
            return t
        },
    } as unknown as Ctx
}
function principledTree(input: string, path: string, emissionColor?: number[]) {
    const inputs = [socket('Base Color', [0.8, 0.8, 0.8, 1]), socket('Metallic', 0), socket('Roughness', 0.5),
        socket('Emission Color', emissionColor ?? [0, 0, 0, 1]), socket('Emission Strength', 1)]
    const principled = node('ShaderNodeBsdfPrincipled', inputs)
    const surface = socket('Surface')
    const output = node('ShaderNodeOutputMaterial', [surface], {is_active_output: 1})
    const tex = imageNode(path)
    const target = inputs.find(s => s.name === input)
    return blenderMaterial([output, principled, tex], [
        {fromnode: principled, tosock: surface},
        {fromnode: tex, tosock: target},
    ])
}

describe('blend-importer createMaterial', () => {
    it('sets metalness to 1 when a texture drives Metallic', () => {
        const material = createMaterial(principledTree('Metallic', '//metal.png'), ctx())
        expect(material.metalnessMap?.name).toBe('//metal.png')
        expect(material.metalness).toBe(1)
    })

    it('keeps the constant Metallic value when no texture is linked', () => {
        const material = createMaterial(principledTree('Roughness', '//rough.png'), ctx())
        expect(material.metalnessMap).toBeNull()
        expect(material.metalness).toBe(0)
    })

    it('assigns the emission texture to emissiveMap', () => {
        const material = createMaterial(principledTree('Emission Color', '//glow.png'), ctx())
        expect(material.emissiveMap?.name).toBe('//glow.png')
        expect(material.emissive.toArray()).toEqual([1, 1, 1])
    })

    it('leaves emissiveMap empty for a constant emission color', () => {
        const material = createMaterial(principledTree('Roughness', '//rough.png', [0.5, 0.2, 0.1, 1]), ctx())
        expect(material.emissiveMap).toBeNull()
        expect(material.emissive.r).toBeCloseTo(0.5)
    })
})
