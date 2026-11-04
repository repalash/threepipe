import {describe, expect, test} from 'vitest'
import {MeshBasicMaterial, Vector4} from 'three'
import {TonemapPlugin} from 'threepipe'

// the tonemap bit is bit 1 of the w channel of the GBuffer flags
const tonemapBit = (material: any) => {
    const data = new Vector4(0, 0, 0, 0)
    new TonemapPlugin().updateGBufferFlags(data, {material} as any)
    return (data.w >> 1) & 1
}

describe('TonemapPlugin GBuffer flags', () => {
    test('a material is tone mapped by default', () => {
        expect(tonemapBit(new MeshBasicMaterial())).toBe(1)
    })
    test('toneMapped false on the material turns tone mapping off for its pixels', () => {
        expect(tonemapBit(new MeshBasicMaterial({toneMapped: false}))).toBe(0)
    })
    test('userData.gBufferData.tonemapEnabled, then the legacy userData.postTonemap, win over toneMapped', () => {
        const a = new MeshBasicMaterial({toneMapped: false})
        a.userData.gBufferData = {tonemapEnabled: true}
        expect(tonemapBit(a)).toBe(1)
        const b = new MeshBasicMaterial({toneMapped: true})
        b.userData.postTonemap = false
        expect(tonemapBit(b)).toBe(0)
    })
})
