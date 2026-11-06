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

    it.each(['render', 'encode'])('restores the clear state when %s throws', (stage) => {
        const r = renderer()
        const error = new Error('snapshot failed')
        const failing = stage === 'render' ? r.render : r.domElement.toDataURL
        failing.mockImplementationOnce(() => { throw error })
        expect(() => tp.snapObject(r as any, new tp.Object3D())).toThrow(error)
        expect(r.getClearColor(new tp.Color()).toArray()).toEqual([0.2, 0.4, 0.6])
        expect(r.getClearAlpha()).toBe(0.75)
    })
})

describe('offscreen snapshot', () => {
    function renderer() {
        const color = new tp.Color(0.2, 0.4, 0.6)
        let alpha = 0.75
        let target: any = 'last-target'
        const calls: string[] = []
        const r = {
            autoClear: true,
            extensions: {has: () => true},
            capabilities: {isWebGL2: true},
            getClearColor: (t: InstanceType<typeof tp.Color>) => t.copy(color),
            getClearAlpha: () => alpha,
            setClearColor: (value: number | InstanceType<typeof tp.Color>, opacity: number) => { color.set(value); alpha = opacity },
            getRenderTarget: () => target,
            getActiveCubeFace: () => 2,
            getActiveMipmapLevel: () => 1,
            setRenderTarget: vi.fn((t: any) => { target = t; calls.push('target:' + (t?.texture?.name ?? t)) }),
            clear: vi.fn(() => {
                calls.push('clear')
                expect(alpha).toBe(0)
                if (target !== null) expect(r.autoClear).toBe(false) // offscreen
            }),
            render: vi.fn((scene: any, camera: any) => { calls.push('render:' + (scene.isMesh ? 'quad' : scene.type)); return camera }),
            renderWithModes: vi.fn((_modes, render: () => void) => render()),
            readRenderTargetPixels: vi.fn((t: any, _x: number, _y: number, w: number, h: number, buffer: Uint8Array) => {
                calls.push('read:' + t.texture.name + ':' + w + 'x' + h)
                buffer.fill(7)
            }),
            domElement: {toDataURL: vi.fn()},
            calls,
        }
        return r
    }

    it('renders into a small target, tone maps it and reads back only that target, then puts back the renderer state', () => {
        const r = renderer()
        const resources = new tp.SnapObjectResources()
        const scene = new tp.Scene()
        const object = new tp.Mesh(new tp.BoxGeometry(2, 1, 1))
        scene.add(object)
        const camera = new tp.PerspectiveCamera()
        const pixels = tp.snapObjectPixels(r as any, object, {
            root: scene, camera, resources, size: {width: 64, height: 32}, samples: 2,
            toneMapping: {toneMapping: tp.ACESFilmicToneMapping, exposure: 1.5, contrast: 1.1, saturation: 0.9},
        })
        expect(pixels.width).toBe(64)
        expect(pixels.height).toBe(32)
        expect(pixels.data.length).toBe(64 * 32 * 4)
        expect(pixels.data[0]).toBe(7)
        expect(r.calls).toEqual([
            'target:SnapObject.hdr', 'clear', 'render:Scene',
            'target:SnapObject.ldr', 'render:quad',
            'read:SnapObject.ldr:64x32',
            'target:last-target',
        ])
        expect(r.setRenderTarget).toHaveBeenLastCalledWith('last-target', 2, 1)
        expect(r.renderWithModes).toHaveBeenCalledWith({backgroundRender: false, screenSpaceRendering: false, shadowMapRender: false}, expect.any(Function))
        expect(r.domElement.toDataURL).not.toHaveBeenCalled()
        expect(r.getClearColor(new tp.Color()).toArray()).toEqual([0.2, 0.4, 0.6])
        expect(r.getClearAlpha()).toBe(0.75)
        expect(r.autoClear).toBe(true)

        expect(resources.hdrTarget!.texture.type).toBe(tp.HalfFloatType)
        expect(resources.hdrTarget!.samples).toBe(2)
        expect(resources.ldrTarget!.texture.type).toBe(tp.UnsignedByteType)
        expect([resources.hdrTarget!.width, resources.hdrTarget!.height]).toEqual([64, 32])
        const m = resources.material
        expect(m.defines.SNAP_TONE_MAPPING).toBe('ACESFilmicToneMapping')
        expect(m.defines.SNAP_SRGB_OUTPUT).toBe('1')
        expect(m.uniforms.toneMappingExposure.value).toBe(1.5)
        expect(m.uniforms.toneMappingContrast.value).toBe(1.1)
        expect(m.uniforms.toneMappingSaturation.value).toBe(0.9)
        expect(m.uniforms.tDiffuse.value).toBe(null)

        expect(camera.aspect).toBe(2)
        expect(camera.near).toBeGreaterThan(0)
        expect(camera.far).toBeGreaterThan(camera.near)
        expect(object.layers.isEnabled(7)).toBe(false)
        resources.dispose()
    })

    it('uses an 8 bit HDR target when the device cannot render to half float', () => {
        const r = renderer()
        r.extensions.has = () => false
        r.capabilities.isWebGL2 = false
        const resources = new tp.SnapObjectResources()
        tp.snapObjectPixels(r as any, new tp.Mesh(new tp.BoxGeometry()), {resources, size: 8})
        expect(resources.hdrTarget!.texture.type).toBe(tp.UnsignedByteType)
        resources.dispose()
    })

    it('uses an 8 bit HDR target in WebGL2 without a colour buffer float extension, half float with one', () => {
        const r = renderer()
        r.capabilities.isWebGL2 = true
        r.extensions.has = () => false // WebGL2 samples float textures, but cannot render to them
        let resources = new tp.SnapObjectResources()
        tp.snapObjectPixels(r as any, new tp.Mesh(new tp.BoxGeometry()), {resources, size: 8})
        expect(resources.hdrTarget!.texture.type).toBe(tp.UnsignedByteType)
        resources.dispose()
        r.extensions.has = (name: string) => name === 'EXT_color_buffer_float'
        resources = new tp.SnapObjectResources()
        tp.snapObjectPixels(r as any, new tp.Mesh(new tp.BoxGeometry()), {resources, size: 8})
        expect(resources.hdrTarget!.texture.type).toBe(tp.HalfFloatType)
        resources.dispose()
    })

    it('without tone mapping and with a linear output, only copies', () => {
        const r = renderer()
        const resources = new tp.SnapObjectResources()
        tp.snapObjectPixels(r as any, new tp.Mesh(new tp.BoxGeometry()), {resources, size: 16, toneMapping: {toneMapping: tp.ACESFilmicToneMapping}})
        const version = resources.material.version
        tp.snapObjectPixels(r as any, new tp.Mesh(new tp.BoxGeometry()), {resources, size: 16, toneMapping: null, outputColorSpace: tp.LinearSRGBColorSpace})
        expect(resources.material.defines.SNAP_TONE_MAPPING).toBeUndefined()
        expect(resources.material.defines.SNAP_SRGB_OUTPUT).toBeUndefined()
        expect(resources.material.version).toBe(version + 1)
        expect(resources.material.uniforms.toneMappingExposure.value).toBe(1)
        resources.dispose()
    })

    it('puts back the renderer state when the render throws, and disposes the targets it created', () => {
        const r = renderer()
        r.render.mockImplementationOnce(() => { throw new Error('render failed') })
        const object = new tp.Mesh(new tp.BoxGeometry())
        const dispose = vi.spyOn(tp.WebGLRenderTarget.prototype, 'dispose')
        expect(() => tp.snapObjectPixels(r as any, object)).toThrow('render failed')
        expect(dispose).toHaveBeenCalledTimes(2)
        dispose.mockRestore()
        expect(r.setRenderTarget).toHaveBeenLastCalledWith('last-target', 2, 1)
        expect(r.getClearAlpha()).toBe(0.75)
        expect(r.autoClear).toBe(true)
        expect(object.layers.isEnabled(7)).toBe(false)
    })

    it('SwitchNodeBasePlugin renders the node previews offscreen in the viewer scene, without setDirty', () => {
        const r = renderer()
        const scene = new tp.Scene()
        const node = new tp.Group()
        const child = new tp.Mesh(new tp.BoxGeometry())
        node.add(child)
        scene.add(node)
        const viewer = {
            scene, renderManager: {renderer: r, screenPass: {outputColorSpace: tp.SRGBColorSpace}},
            getPlugin: () => undefined, setDirty: vi.fn(), removeEventListener: vi.fn(),
        }
        const canvas = {width: 0, height: 0, getContext: () => ({putImageData: vi.fn()}), toDataURL: () => 'data:image/png;base64,node'}
        const create = vi.spyOn(document, 'createElement').mockReturnValue(canvas as any)
        try {
            const plugin = new tp.SwitchNodeBasePlugin()
            ;(plugin as any)._viewer = viewer
            plugin.previewSize = 128
            const image = plugin.getPreview({name: 'node', selected: '', title: 'Node', camView: 'front', camDistance: 1}, child)
            expect(image).toBe('data:image/png;base64,node')
            expect(r.calls).toEqual([
                'target:SnapObject.hdr', 'clear', 'render:Scene',
                'target:SnapObject.ldr', 'render:quad',
                'read:SnapObject.ldr:128x128',
                'target:last-target',
            ])
            expect(r.domElement.toDataURL).not.toHaveBeenCalled()
            expect(viewer.setDirty).not.toHaveBeenCalled()
            expect(child.layers.isEnabled(7)).toBe(false)
            // the render targets are kept for the next preview, and disposed with the plugin
            const resources = (plugin as any)._snapResources
            plugin.getPreview({name: 'node', selected: '', title: 'Node', camView: 'top', camDistance: 1}, child)
            expect((plugin as any)._snapResources).toBe(resources)
            const dispose = vi.spyOn(resources, 'dispose')
            plugin.onRemove(viewer as any)
            expect(dispose).toHaveBeenCalled()
        } finally {
            create.mockRestore()
        }
    })

    it('snapObject with an options object and no size renders to the canvas like the positional form', () => {
        const r = renderer()
        r.domElement.toDataURL.mockReturnValue('data:image/png;base64,canvas')
        const object = new tp.Mesh(new tp.BoxGeometry())
        expect(tp.snapObject(r as any, object, {channel: 5})).toBe('data:image/png;base64,canvas')
        expect(r.setRenderTarget).toHaveBeenCalledWith(null)
        expect(r.readRenderTargetPixels).not.toHaveBeenCalled()
        expect(r.renderWithModes).toHaveBeenCalledWith({backgroundRender: false}, expect.any(Function))
        expect(object.layers.isEnabled(5)).toBe(false)
    })
})

describe('renderer mode flags', () => {
    it('renderWithModes puts back the flags when the render throws', () => {
        const r = tp.upgradeWebGLRenderer.call({userData: {screenSpaceRendering: undefined, backgroundRender: true}} as any, {} as any)
        expect(() => r.renderWithModes({screenSpaceRendering: false, backgroundRender: false, shadowMapRender: false}, () => {
            expect(r.userData.screenSpaceRendering).toBe(false)
            throw new Error('material hook failed')
        })).toThrow('material hook failed')
        expect(r.userData.screenSpaceRendering).toBeUndefined()
        expect(r.userData.backgroundRender).toBe(true)
        expect(r.userData.shadowMapRender).toBeUndefined()
    })
})
