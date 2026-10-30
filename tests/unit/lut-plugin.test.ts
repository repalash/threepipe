/**
 * Unit tests for LUTPlugin (Node) - shader defines and the gbuffer flags.
 */
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {Data3DTexture, Vector4} from 'three'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

afterEach(() => {
    vi.restoreAllMocks()
})

const makeLut = (size = 2) => new tp.LUTCubeTextureWrapper({
    texture3D: new Data3DTexture(new Uint8Array(size * size * size * 4), size, size, size),
    size, title: 'test',
} as any)

describe('LUTPlugin', () => {
    it('sets the defines only for slots with a texture', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const lut = new tp.LUTPlugin(true)
        expect(lut.extraDefines).toMatchObject({USE_LUT: 0, USE_LUT1: 0, USE_LUT2: 0})

        lut.lutMap1 = makeLut(4)
        expect(lut.extraDefines).toMatchObject({USE_LUT: 0, USE_LUT1: 1, USE_LUT2: 0})
        expect(lut.extraUniforms.lut3d1.value).toBe(lut.lutMap1.texture3D)
        expect(lut.extraUniforms.lutSize1.value).toBe(4)

        // not a lut wrapper, the shader must not sample a null texture
        lut.lutMap = {} as any
        expect(lut.extraDefines.USE_LUT).toBe(0)
        expect(lut.extraUniforms.lut3d.value).toBe(null)
        expect(warn).toHaveBeenCalled()

        lut.lutMap1 = undefined
        expect(lut.extraDefines.USE_LUT1).toBe(0)
        expect(lut.extraUniforms.lut3d1.value).toBe(null)
    })

    it('packs the material slot and enable in the gbuffer flags', () => {
        const lut = new tp.LUTPlugin(true)
        const flags = (userData: any) => {
            const data = new Vector4(0, 0, 0, 0)
            lut.updateGBufferFlags(data, {material: {userData}} as any)
            return {slot: data.y & 7, enabled: data.w & 1}
        }
        expect(flags({})).toEqual({slot: 0, enabled: 1})
        expect(flags({[tp.LUTPlugin.PluginType]: {index: 2}})).toEqual({slot: 2, enabled: 1})
        expect(flags({[tp.LUTPlugin.PluginType]: {index: 1, enable: false}})).toEqual({slot: 0, enabled: 0})

        const material: any = {userData: {}}
        lut.setMaterialLUT(material, {slot: 1})
        expect(flags(material.userData)).toEqual({slot: 1, enabled: 1})
        lut.setMaterialLUT(material, {enable: false})
        expect(material.userData[tp.LUTPlugin.PluginType]).toEqual({enable: false, index: 1})
    })
})
