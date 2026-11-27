/**
 * RenderManager.shadowMapType with three.js r182, which deprecates PCFSoftShadowMap (PCFShadowMap is soft) and warns
 * each time a renderer renders shadows with it: a set or saved PCFSoftShadowMap is PCFShadowMap, and a renderer that
 * has PCFSoftShadowMap shows PCFShadowMap. No WebGL: the render manager has only the shadow map it binds to.
 */
import {beforeAll, describe, expect, test, vi} from 'vitest'
import {BasicShadowMap, PCFShadowMap, PCFSoftShadowMap, VSMShadowMap} from 'three'

let tp: typeof import('threepipe')
// a cold import of the package entry can take longer than the default 10 s hook timeout
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

function setup(type = PCFShadowMap) {
    const shadowMap = {type}
    const rm = Object.create(tp.RenderManager.prototype)
    Object.defineProperty(rm, 'shadowMap', {value: shadowMap})
    rm.resetShadows = vi.fn()
    rm.reset = vi.fn()
    return {rm, shadowMap}
}

describe('RenderManager.shadowMapType', () => {
    test('PCFSoftShadowMap is set as PCFShadowMap; the other types as they are', () => {
        const {rm, shadowMap} = setup(BasicShadowMap)
        rm.shadowMapType = PCFSoftShadowMap
        expect(shadowMap.type).toBe(PCFShadowMap)
        expect(rm.resetShadows).toHaveBeenCalledTimes(1)
        for (const type of [BasicShadowMap, VSMShadowMap, PCFShadowMap]) {
            rm.shadowMapType = type
            expect(shadowMap.type).toBe(type)
        }
    })

    test('a renderer with PCFSoftShadowMap shows and saves PCFShadowMap', () => {
        const {rm} = setup(PCFSoftShadowMap)
        expect(rm.shadowMapType).toBe(PCFShadowMap)
    })

    test('a saved PCFSoftShadowMap loads as PCFShadowMap', () => {
        const {rm, shadowMap} = setup(BasicShadowMap)
        tp.ThreeSerialization.Deserialize({shadowMapType: PCFSoftShadowMap}, rm, undefined, true)
        expect(shadowMap.type).toBe(PCFShadowMap)
    })
})
