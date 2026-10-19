import {beforeAll, describe, expect, it, vi} from 'vitest'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

describe('depth target clear value', () => {
    it('clears to the far plane for every packing, including changes to an existing pass', () => {
        const plugin = new tp.DepthBufferPlugin() as any
        plugin._viewer = {
            setDirty: vi.fn(),
            renderManager: {createTarget: () => new tp.WebGLRenderTarget(1, 1), disposeTarget: vi.fn()},
        }
        const pass = plugin._pass = plugin._createPass()
        expect(pass.clearColor.toArray()).toEqual([1, 1, 1])
        expect(pass.clearAlpha).toBe(1)
        for (const packing of [tp.BasicDepthPacking, tp.RGBDepthPacking, tp.RGDepthPacking, tp.RGBADepthPacking]) {
            plugin.depthPacking = packing
            expect(plugin._pass).toBe(pass)
            expect(pass.clearColor.toArray()).toEqual(packing === tp.BasicDepthPacking ? [0, 0, 0] : [1, 1, 1])
            expect(plugin.material.depthPacking).toBe(packing)
            expect(plugin.unpackExtension.extraDefines.DEPTH_PACKING).toBe(packing)
        }
        plugin.target.dispose()
        plugin.material.dispose()
    })
})

describe('snapshot clear state', () => {
    function renderer() {
        const color = new tp.Color(0.2, 0.4, 0.6)
        let alpha = 0.75
        const renderer = {
            getClearColor: (target: InstanceType<typeof tp.Color>) => target.copy(color),
            getClearAlpha: () => alpha,
            setClearColor: (value: number | InstanceType<typeof tp.Color>, opacity: number) => { color.set(value); alpha = opacity },
            setRenderTarget: vi.fn(),
            clear: vi.fn(() => { expect(alpha).toBe(0); expect(color.getHex()).toBe(0) }),
            render: vi.fn(),
            renderWithModes: vi.fn((_modes, render: () => void) => render()),
            domElement: {toDataURL: vi.fn(() => 'data:image/png;base64,snapshot')},
        }
        return renderer
    }

    it('captures a transparent background and restores the preceding clear color and alpha', () => {
        const r = renderer()
        expect(tp.snapObject(r as any, new tp.Object3D())).toBe('data:image/png;base64,snapshot')
        expect(r.clear).toHaveBeenCalledTimes(2)
        expect(r.renderWithModes).toHaveBeenCalledWith({backgroundRender: false}, expect.any(Function))
        expect(r.getClearColor(new tp.Color()).toArray()).toEqual([0.2, 0.4, 0.6])
        expect(r.getClearAlpha()).toBe(0.75)
    })

})
