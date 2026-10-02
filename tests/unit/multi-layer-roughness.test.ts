/**
 * Unit tests for MultiLayerRoughnessPlugin (Node) - layer weights resolved from the blend mode, and the glTF extension.
 */
import {beforeAll, describe, expect, it} from 'vitest'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

describe('MultiLayerRoughnessPlugin', () => {
    const layer = (weight: number, roughness = 0.5, baseInfluence = 0) => ({weight, roughness, baseInfluence})

    // runs the extension for a material and returns the uniforms and define it sets
    function render(state: any) {
        const plugin = new tp.MultiLayerRoughnessPlugin()
        const material: any = {userData: {_multiLayerRoughness: state}, defines: {}, isPhysicalMaterial: true}
        plugin.materialExtension.onObjectRender!({} as any, material, {} as any)
        const uniforms = plugin.materialExtension.extraUniforms as any
        const count = material.defines.MLR_LAYER_COUNT
        return {
            count,
            base: uniforms.mlrBaseWeight.value as number,
            weights: uniforms.mlrLayers.value.slice(0, count).map((v: any) => v.x) as number[],
            layers: uniforms.mlrLayers.value.slice(0, count).map((v: any) => [v.y, v.z]) as number[][],
        }
    }
    const sum = (r: {base: number, weights: number[]}) => r.base + r.weights.reduce((a, b) => a + b, 0)

    it('mix is energy conserving', () => {
        const r = render({enabled: true, blendMode: 'mix', layers: [layer(0.3, 0.45, 1), layer(0.2)]})
        expect(r.count).toBe(2)
        expect(r.weights).toEqual([0.3, 0.2])
        expect(r.layers[0]).toEqual([0.45, 1])
        expect(r.base).toBeCloseTo(0.5)
        // renormalized when the weights exceed 1
        const r2 = render({enabled: true, layers: [layer(0.8), layer(0.8)]})
        expect(r2.weights).toEqual([0.5, 0.5])
        expect(r2.base).toBe(0)
    })

    it('additive keeps the base lobe', () => {
        const r = render({enabled: true, blendMode: 'additive', layers: [layer(0.3), layer(0.2)]})
        expect(r.weights).toEqual([0.3, 0.2])
        expect(r.base).toBe(1)
    })

    it('chain mixes each layer over the ones below', () => {
        const r = render({enabled: true, blendMode: 'chain', layers: [layer(0.5), layer(0.5)]})
        expect(r.weights).toEqual([0.25, 0.5])
        expect(r.base).toBeCloseTo(0.25)
        expect(sum(r)).toBeCloseTo(1)
    })

    it('ignores layers over the limit when resolving the weights', () => {
        const r = render({enabled: true, blendMode: 'mix', layers: [layer(0.1), layer(0.1), layer(0.1), layer(0.1), layer(0.5)]})
        expect(r.count).toBe(tp.MultiLayerRoughnessPlugin.MAX_LAYERS)
        expect(r.weights).toEqual([0.1, 0.1, 0.1, 0.1])
        expect(r.base).toBeCloseTo(0.6)
        expect(sum(r)).toBeCloseTo(1)
    })

    it('is off when disabled or without layers', () => {
        expect(render({enabled: false, layers: [layer(0.3)]}).count).toBe(0)
        expect(render({enabled: true, layers: []}).count).toBe(0)
        expect(render(undefined).count).toBe(0)
    })

    it('round-trips through the glTF extension', async() => {
        const ext = tp.multiLayerRoughnessGLTFExtension
        const state = {enabled: true, blendMode: 'chain', layers: [layer(0.4, 0.3, 1), layer(0.2, 0.8, 0)]}

        const writer: any = {extensionsUsed: {}}
        const materialDef: any = {}
        ext.export(writer).writeMaterial({isMeshStandardMaterial: true, userData: {_multiLayerRoughness: state}}, materialDef)
        expect(writer.extensionsUsed[ext.name]).toBe(true)
        const json = JSON.parse(JSON.stringify(materialDef))
        expect(json.extensions[ext.name]).toEqual(state)

        const params: any = {}
        await ext.import({json: {materials: [json]}} as any).extendMaterialParams!(0, params)
        expect(params.userData._multiLayerRoughness).toEqual(state)

        // nothing is written when not enabled
        const materialDef2: any = {}
        ext.export(writer).writeMaterial({isMeshStandardMaterial: true, userData: {_multiLayerRoughness: {enabled: false, layers: state.layers}}}, materialDef2)
        expect(materialDef2.extensions).toBeUndefined()
    })
})
