import {beforeAll, describe, expect, it, vi} from 'vitest'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

// RenderManager needs a WebGL context; these call its budget and error checks on a stand-in with the fields they use
function standIn(maxTextures: number, maxShadowMaps: number | 'auto' = 'auto') {
    return {maxShadowMaps, _renderer: {capabilities: {maxTextures}, info: {programs: [] as any[]}}, _shadowBudgetOff: [], _shadowBudgetLimit: -1,
        _shadowBudgetDirty: true, _reportedPrograms: new WeakSet(), dispatchEvent: vi.fn()} as any
}

function sceneWithLights(n: number) {
    const scene = new tp.Object3D2()
    const sun = new tp.DirectionalLight2(0xffffff, 0.5)
    sun.castShadow = true
    sun.name = 'sun'
    scene.add(sun)
    const points: any[] = []
    for (let i = 0; i < n; i++) {
        const l = new tp.PointLight2(0xffffff, (i + 1) * 100) // brightest last
        l.castShadow = true
        l.name = 'point' + i
        scene.add(l)
        points.push(l)
    }
    const noShadow = new tp.PointLight2(0xffffff, 1e6) // castShadow false: not counted
    scene.add(noShadow)
    return {scene, sun, points}
}

describe('RenderManager.maxShadowMaps', () => {
    const refresh = (rm: any, scene: any) => (tp.RenderManager.prototype as any)._refreshShadowBudget.call(rm, scene)

    it('auto: keeps maxTextures - SHADOW_TEXTURE_RESERVE shadows, the directional light and then the brightest', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const {scene, sun, points} = sceneWithLights(16)
        const rm = standIn(16)
        refresh(rm, scene)
        const budget = 16 - tp.RenderManager.SHADOW_TEXTURE_RESERVE // 6
        expect(rm._shadowBudgetLimit).toBe(budget)
        expect(rm._shadowBudgetOff).toHaveLength(17 - budget)
        expect(rm._shadowBudgetOff).not.toContain(sun)
        // the budget - 1 brightest point lights keep their shadows
        const kept = points.filter(p => !rm._shadowBudgetOff.includes(p))
        expect(kept.map(p => p.name)).toEqual(points.slice(16 - (budget - 1)).map(p => p.name))
        // castShadow itself isn't changed
        expect(points.every(p => p.castShadow)).toBe(true)
        expect(warn).toHaveBeenCalledOnce()
        refresh(rm, scene) // same result: no second warning
        expect(warn).toHaveBeenCalledOnce()
        warn.mockRestore()
    })

    it('changing maxShadowMaps recomputes the budget before the next render', () => {
        const rm = standIn(16)
        rm._shadowBudgetDirty = false
        rm._maxShadowMaps = 'auto'
        let proto: any = tp.RenderManager.prototype, desc: PropertyDescriptor | undefined
        while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, 'maxShadowMaps'))) proto = Object.getPrototypeOf(proto) // the class decorator wraps the class
        if (!desc) throw new Error('maxShadowMaps accessor not found')
        desc.set!.call(rm, 2)
        expect(rm._shadowBudgetDirty).toBe(true)
        expect(desc.get!.call(rm)).toBe(2)
    })

    it('fits on a GPU with 32 textures, and a number or Infinity overrides', () => {
        const {scene} = sceneWithLights(16)
        const rm = standIn(32)
        refresh(rm, scene)
        expect(rm._shadowBudgetOff).toHaveLength(0)
        const off = standIn(16, Infinity)
        refresh(off, scene)
        expect(off._shadowBudgetOff).toHaveLength(0)
        const two = standIn(32, 2)
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        refresh(two, scene)
        expect(two._shadowBudgetOff).toHaveLength(15)
        vi.restoreAllMocks()
    })
})

describe('RenderManager shaderError', () => {
    it('reports a program that failed, once, with tooManyTextures', () => {
        const rm = standIn(16)
        const failed = {name: 'poker', diagnostics: {runnable: false, programLog: 'FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)', fragmentShader: {log: ''}, vertexShader: {log: ''}}}
        const fine = {name: 'ok', diagnostics: {runnable: true, programLog: ''}}
        rm._renderer.info.programs.push(fine, failed)
        const check = () => (tp.RenderManager.prototype as any)._checkShaderErrors.call(rm)
        check()
        expect(rm.dispatchEvent).toHaveBeenCalledOnce()
        expect(rm.dispatchEvent.mock.calls[0][0]).toMatchObject({type: 'shaderError', materialName: 'poker', tooManyTextures: true})
        rm._renderer.info.programs.push({name: 'x'})
        check()
        expect(rm.dispatchEvent).toHaveBeenCalledOnce()
        // a failing program that replaces another, with the same count
        rm._renderer.info.programs.splice(0, 1, {name: 'second', diagnostics: {runnable: false, programLog: 'link error'}})
        check()
        expect(rm.dispatchEvent).toHaveBeenCalledTimes(2)
        expect(rm.dispatchEvent.mock.calls[1][0]).toMatchObject({materialName: 'second', tooManyTextures: false})
    })

    it('toggles castShadow on threepipe lights without setDirty', () => {
        const l = new tp.PointLight2(0xffffff, 10)
        l.castShadow = true
        const dirty = vi.fn()
        l.addEventListener('objectUpdate', dirty)
        expect('_oc_castShadow' in l).toBe(true)
        ;(l as any)._oc_castShadow = false
        expect(l.castShadow).toBe(false)
        ;(l as any)._oc_castShadow = true
        expect(dirty).not.toHaveBeenCalled()
        l.castShadow = false // the public setter still notifies
        expect(dirty).toHaveBeenCalled()
    })
})
