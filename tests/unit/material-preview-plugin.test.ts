import {beforeAll, describe, expect, it, vi} from 'vitest'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

function setup(opts: {dragInterval?: number, maxPerFrame?: number} = {}) {
    const listeners: (() => void)[] = []
    const scene = {environment: null, environmentIntensity: 1, environmentRotation: new tp.Euler()}
    const viewer = {
        renderEnabled: true,
        scene,
        getPlugin: () => undefined,
        renderManager: {renderer: {isFakeRenderer: true}, screenPass: {outputColorSpace: tp.SRGBColorSpace}},
        addEventListener: vi.fn((type: string, l: () => void) => { if (type === 'preFrame') listeners.push(l) }),
        removeEventListener: vi.fn((type: string, l: () => void) => { if (type === 'preFrame') listeners.splice(listeners.indexOf(l), 1) }),
        setDirty: vi.fn(),
    }
    let canvases = 0
    const generator = {
        renderToCanvas: vi.fn((_m: any, _r: any, _o: any, canvas?: any) => canvas ?? {id: canvases++, toDataURL: () => 'data:' + canvases}),
        dispose: vi.fn(),
    }
    let time = 1000
    const queue = new tp.MaterialPreviewPlugin(generator as any)
    queue.onAdded(viewer as any)
    queue.now = () => time
    if (opts.dragInterval !== undefined) queue.dragInterval = opts.dragInterval
    if (opts.maxPerFrame !== undefined) queue.maxPerFrame = opts.maxPerFrame
    const frame = (dt = 16) => {
        time += dt
        listeners.forEach(l => l())
    }
    return {viewer, generator, queue, frame, listeners, scene, advance: (dt: number) => { time += dt }}
}

describe('MaterialPreviewPlugin', () => {
    it('renders in preFrame, at most maxPerFrame previews per frame, in request order', () => {
        const {generator, queue, frame} = setup()
        const a = new tp.PhysicalMaterial(), b = new tp.PhysicalMaterial(), c = new tp.PhysicalMaterial()
        const got: string[] = []
        queue.request(a, {}, p => got.push('a:' + p.shape + ':' + p.size))
        queue.request(b, {shape: 'cube', size: 128}, p => got.push('b:' + p.shape + ':' + p.size))
        queue.request(c, {}, () => got.push('c'))
        expect(generator.renderToCanvas).not.toHaveBeenCalled() // nothing before the frame
        frame()
        expect(got).toEqual(['a:sphere:256'])
        frame()
        expect(got).toEqual(['a:sphere:256', 'b:cube:128'])
        frame()
        expect(got).toEqual(['a:sphere:256', 'b:cube:128', 'c'])
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(3)
        expect(generator.renderToCanvas.mock.calls[1][2]).toMatchObject({shape: 'cube', size: 128, toneMapping: null, outputColorSpace: tp.SRGBColorSpace, environmentIntensity: 1})
        expect(queue.pending).toBe(0)
    })

    it('renders more per frame with a larger maxPerFrame', () => {
        const {generator, queue, frame} = setup({maxPerFrame: 2})
        for (let i = 0; i < 3; i++) queue.request(new tp.PhysicalMaterial(), {}, () => {})
        frame()
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(2)
        frame()
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(3)
    })

    it('renders a changed material in the next frame', () => {
        const {queue, frame} = setup({dragInterval: 100})
        const m = new tp.PhysicalMaterial()
        const cb = vi.fn()
        queue.request(m, {}, cb)
        m.setDirty() // a change from code, or the end of a drag: no last: false
        frame()
        expect(cb).toHaveBeenCalledTimes(1)
        expect(cb.mock.calls[0][0].version).toBe(1)
    })

    it('during a drag (last: false) renders at most every dragInterval ms, and the change that ends it (last: true) in the next frame', () => {
        const {generator, queue, frame} = setup({dragInterval: 100})
        const m = new tp.PhysicalMaterial()
        const got: number[] = []
        const ask = () => queue.request(m, {}, p => got.push(p.version))
        ask()
        m.setDirty({last: false})
        frame(16)
        expect(got).toEqual([1]) // the first change of a drag renders at once
        ask()
        m.setDirty({last: false})
        frame(16)
        frame(50)
        expect(got).toEqual([1]) // 66 ms after the last render
        frame(40)
        expect(got).toEqual([1, 2]) // 106 ms
        ask()
        m.setDirty({uiChangeEvent: {last: false}} as any) // a uiconfig change event during a drag counts too
        frame(16)
        expect(got).toEqual([1, 2])
        m.setDirty({uiChangeEvent: {last: true}} as any) // the release of the slider
        frame(16)
        expect(got).toEqual([1, 2, 4])
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(3)
    })

    it('during an animation (a change in every frame, without last) renders at most every dragInterval ms, and the last change', () => {
        const {queue, frame} = setup({dragInterval: 100})
        const m = new tp.PhysicalMaterial()
        const got: number[] = []
        let handle: {cancel(): void} | undefined
        const refresh = () => {
            handle?.cancel()
            handle = queue.request(m, {}, p => got.push(p.version))
        }
        m.addEventListener('materialUpdate', refresh)
        refresh() // the inspector opens
        for (let i = 0; i < 20; i++) { // as AnimationObject or a material transition sends, one change per frame
            m.setDirty({frameFade: false, source: 'AnimationObject'} as any)
            frame(16)
        }
        expect(got).toEqual([1, 8, 15]) // the first change at once, then every 100 ms (7 frames)
        frame(16)
        frame(16)
        expect(got).toEqual([1, 8, 15, 20]) // the last change, 112 ms after the previous render
        frame(200)
        m.setDirty() // a change after a pause renders in the next frame
        frame(16)
        expect(got).toEqual([1, 8, 15, 20, 21])
        m.removeEventListener('materialUpdate', refresh)
    })

    it('keeps the drag state when a materialUpdate listener cancels and requests again', () => {
        const {queue, frame} = setup({dragInterval: 100})
        const m = new tp.PhysicalMaterial()
        const got: number[] = []
        let handle: {cancel(): void} | undefined
        const refresh = () => {
            handle?.cancel()
            handle = queue.request(m, {}, p => got.push(p.version))
        }
        m.addEventListener('materialUpdate', refresh) // added before the queue's listener, like an inspector
        refresh()
        frame(16)
        expect(got).toEqual([0])
        m.setDirty({last: false})
        frame(16)
        expect(got).toEqual([0]) // the new request waits for the interval of the last render
        frame(90)
        expect(got).toEqual([0, 1])
        m.removeEventListener('materialUpdate', refresh)
    })

    it('a request that waits during a drag does not block the next request of another material', () => {
        const {queue, frame} = setup({dragInterval: 100})
        const dragged = new tp.PhysicalMaterial(), other = new tp.PhysicalMaterial()
        const got: string[] = []
        queue.request(dragged, {}, () => got.push('dragged'))
        dragged.setDirty({last: false})
        frame()
        queue.request(dragged, {}, () => got.push('dragged'))
        dragged.setDirty({last: false})
        queue.request(other, {}, () => got.push('other'))
        frame()
        expect(got).toEqual(['dragged', 'other'])
    })

    it('shares one render between requests for the same material, shape and size', () => {
        const {generator, queue, frame} = setup()
        const m = new tp.PhysicalMaterial()
        const cb1 = vi.fn(), cb2 = vi.fn(), cb3 = vi.fn()
        queue.request(m, {shape: 'sphere'}, cb1)
        queue.request(m, {}, cb2)
        queue.request(m, {shape: 'cube'}, cb3)
        frame()
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(1)
        expect(cb1).toHaveBeenCalledTimes(1)
        expect(cb2.mock.calls[0][0]).toBe(cb1.mock.calls[0][0])
        expect(cb3).not.toHaveBeenCalled()
        frame()
        expect(cb3).toHaveBeenCalledTimes(1)
    })

    it('mesh previews are keyed by the geometry', () => {
        const {generator, queue, frame} = setup({maxPerFrame: 5})
        const m = new tp.PhysicalMaterial()
        const g1 = new tp.BoxGeometry(), g2 = new tp.BoxGeometry()
        queue.request(m, {shape: 'mesh', geometry: g1}, () => {})
        queue.request(m, {shape: 'mesh', geometry: g2}, () => {})
        frame()
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(2)
        expect(generator.renderToCanvas.mock.calls.map(c => c[2].geometry)).toEqual([g1, g2])
    })

    it('returns a cached preview of an unchanged material in the next frame without a render, and renders again after a materialUpdate', () => {
        const {generator, queue, frame} = setup()
        const m = new tp.PhysicalMaterial()
        const first = vi.fn()
        queue.request(m, {}, first)
        frame()
        const preview = first.mock.calls[0][0]
        expect(preview.version).toBe(0)

        const cached = vi.fn()
        queue.request(m, {}, cached)
        expect(cached).not.toHaveBeenCalled() // not synchronous
        frame()
        expect(cached).toHaveBeenCalledWith(preview)
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(1)

        m.setDirty()
        const changed = vi.fn()
        queue.request(m, {}, changed)
        frame() // the cached preview is stale: rendered again
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(2)
        const next = changed.mock.calls[0][0]
        expect(next.version).toBe(1)
        expect(next.canvas).toBe(preview.canvas) // drawn into the same canvas
        expect(generator.renderToCanvas.mock.calls[1][3]).toBe(preview.canvas)
    })

    it('renders again when the environment or the tone mapping of the viewer changes', () => {
        const {generator, queue, frame, scene} = setup()
        const m = new tp.PhysicalMaterial()
        queue.request(m, {}, () => {})
        frame()
        scene.environmentIntensity = 2
        queue.request(m, {}, () => {})
        frame()
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(2)
        expect(generator.renderToCanvas.mock.calls[1][2].environmentIntensity).toBe(2)
        queue.request(m, {}, () => {})
        frame()
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(2)
    })

    it('invalidate removes cached previews', () => {
        const {generator, queue, frame} = setup()
        const m = new tp.PhysicalMaterial()
        queue.request(m, {}, () => {})
        frame()
        queue.invalidate(m)
        queue.request(m, {}, () => {})
        frame()
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(2)
    })

    it('cancel stops the callback, and the render when no other request waits for it', () => {
        const {generator, queue, frame} = setup()
        const m = new tp.PhysicalMaterial()
        const cancelled = vi.fn(), kept = vi.fn()
        const h1 = queue.request(m, {}, cancelled)
        h1.cancel()
        frame()
        expect(generator.renderToCanvas).not.toHaveBeenCalled()
        expect(queue.pending).toBe(0)

        const h2 = queue.request(m, {}, cancelled)
        queue.request(m, {}, kept)
        h2.cancel()
        h2.cancel()
        frame()
        expect(cancelled).not.toHaveBeenCalled()
        expect(kept).toHaveBeenCalledTimes(1)
    })

    it('a callback can request again', () => {
        const {generator, queue, frame} = setup()
        const m = new tp.PhysicalMaterial()
        const again = vi.fn()
        queue.request(m, {}, () => queue.request(m, {}, again))
        frame()
        frame()
        expect(again).toHaveBeenCalledTimes(1)
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(1)
    })

    it('does not call setDirty or render when the viewer does not render', () => {
        const {viewer, generator, queue, frame} = setup()
        viewer.renderEnabled = false
        queue.request(new tp.PhysicalMaterial(), {}, () => {})
        frame()
        expect(generator.renderToCanvas).not.toHaveBeenCalled()
        viewer.renderEnabled = true
        frame()
        expect(generator.renderToCanvas).toHaveBeenCalledTimes(1)
        expect(viewer.setDirty).not.toHaveBeenCalled()
    })

    it('a failed render is logged and dropped', () => {
        const {generator, queue, frame} = setup()
        generator.renderToCanvas.mockImplementationOnce(() => { throw new Error('no context') })
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const cb = vi.fn()
        queue.request(new tp.PhysicalMaterial(), {}, cb)
        frame()
        frame()
        expect(cb).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalled()
        expect(queue.pending).toBe(0)
        error.mockRestore()
    })

    it('stops listening to a material when no request or cached preview uses it, and on dispose', () => {
        const {queue, frame, listeners, generator} = setup()
        queue.maxCacheSize = 1
        const a = new tp.PhysicalMaterial(), b = new tp.PhysicalMaterial()
        const count = (m: any) => m._listeners?.materialUpdate?.length ?? 0
        const before = count(a)
        queue.request(a, {}, () => {})
        expect(count(a)).toBe(before + 1)
        frame()
        expect(count(a)).toBe(before + 1) // cached
        queue.request(b, {}, () => {})
        frame()
        expect(count(a)).toBe(before) // evicted
        expect(count(b)).toBe(before + 1)
        queue.dispose()
        expect(count(b)).toBe(before)
        expect(listeners.length).toBe(0)
        expect(generator.dispose).not.toHaveBeenCalled() // not owned
        expect(() => queue.request(a, {}, () => {})).toThrow('not added to a viewer')
    })

    it('a disabled plugin renders nothing, and its requests render when it is enabled again', () => {
        const {generator, queue, frame} = setup()
        const cb = vi.fn()
        queue.enabled = false
        queue.request(new tp.PhysicalMaterial(), {}, cb)
        frame()
        expect(generator.renderToCanvas).not.toHaveBeenCalled()
        queue.enabled = true
        frame()
        expect(cb).toHaveBeenCalledTimes(1)
    })

    it('removed from the viewer: it stops rendering and drops its requests; settings are in its UI and not saved', () => {
        const {viewer, queue, listeners} = setup()
        queue.request(new tp.PhysicalMaterial(), {}, () => {})
        queue.onRemove(viewer as any)
        expect(listeners.length).toBe(0)
        expect(queue.pending).toBe(0)
        const labels = (queue.uiConfig?.children as any[] ?? []).map(c => (typeof c === 'function' ? c() : c)?.label)
        expect(labels).toEqual(expect.arrayContaining(['Enabled', 'Size (px)', 'Max per frame', 'Drag interval (ms)', 'Cache size']))
        expect(queue.serializeWithViewer).toBe(false)
    })
})

describe('MaterialPreviewGenerator offscreen', () => {
    function renderer() {
        const scenes: any[] = []
        return {
            scenes,
            autoClear: true,
            extensions: {has: () => true},
            capabilities: {isWebGL2: true},
            getClearColor: (t: any) => t,
            getClearAlpha: () => 1,
            setClearColor: vi.fn(),
            getRenderTarget: () => null,
            getActiveCubeFace: () => 0,
            getActiveMipmapLevel: () => 0,
            setRenderTarget: vi.fn(),
            clear: vi.fn(),
            render: vi.fn((scene: any) => {
                if (scene.isScene) scenes.push({
                    children: [...scene.children],
                    meshGeometry: scene.children.find((c: any) => c.isMesh)?.geometry,
                    environment: scene.environment,
                    environmentIntensity: scene.environmentIntensity,
                    rotationY: scene.environmentRotation.y,
                    lightVisible: scene.children.find((c: any) => c.isLight)?.visible,
                })
            }),
            readRenderTargetPixels: vi.fn(),
        }
    }

    it('renders the given geometry alone for the mesh shape, with the environment and without the extra light', () => {
        const r = renderer()
        const gen = new tp.MaterialPreviewGenerator()
        const material = new tp.PhysicalMaterial()
        const geometry = new tp.TorusGeometry(10, 2)
        const env = new tp.Texture()
        const pixels = gen.renderPixels(material, r as any, {
            shape: 'mesh', geometry, size: 32, environment: env as any, environmentIntensity: 3, environmentRotation: new tp.Euler(0, 1, 0),
        })
        expect(pixels.width).toBe(32)
        const s = r.scenes[0]
        expect(s.meshGeometry).toBe(geometry)
        expect(s.environment).toBe(env)
        expect(s.environmentIntensity).toBe(3)
        expect(s.rotationY).toBe(1)
        expect(s.lightVisible).toBe(false)
        expect(geometry.attributes.tangent).toBeUndefined() // the given geometry is not changed
        // fitted to the bounds: the bounding sphere of the torus is inside the view cone, and fills most of it
        const sphere = geometry.boundingSphere!
        const distance = gen.camera.position.distanceTo(sphere.center)
        const visibleRadius = distance * Math.sin(gen.camera.fov / 2 * Math.PI / 180)
        expect(visibleRadius).toBeGreaterThanOrEqual(sphere.radius)
        expect(visibleRadius).toBeLessThan(sphere.radius * 1.2)
        expect(gen.camera.far).toBeGreaterThan(distance + sphere.radius)
        expect(gen.camera.near).toBeLessThan(distance - sphere.radius)
        // nothing is kept after the render
        expect((gen as any)._scene.children.filter((c: any) => c.isMesh).length).toBe(0)
        expect((gen as any)._mesh.geometry).not.toBe(geometry)
        expect((gen as any)._mesh.material).toBeUndefined()

        gen.renderPixels(material, r as any, {size: 32})
        expect(r.scenes[1].meshGeometry).toBe(gen.shapes.sphere.geometry)
        expect(r.scenes[1].lightVisible).toBe(true) // no environment: the light is on
        gen.dispose()
    })

    it('generate keeps the full canvas path without a size', () => {
        const r = {...renderer(), renderWithModes: vi.fn((_m: any, f: () => void) => f()), domElement: {toDataURL: () => 'data:canvas'}}
        const gen = new tp.MaterialPreviewGenerator()
        const material = new tp.PhysicalMaterial()
        material.envMapIntensity = 1
        expect(gen.generate(material, r as any, null, 'cube')).toBe('data:canvas')
        expect(r.setRenderTarget).toHaveBeenCalledWith(null)
        expect(r.readRenderTargetPixels).not.toHaveBeenCalled()
        expect(r.scenes[0].meshGeometry).toBe(gen.shapes.cube.geometry)
        expect(material.envMapIntensity).toBe(1)
        gen.dispose()
    })
})

describe('tone mapping opt-out of a material in previews', () => {
    function viewerWith(gbufferFlags: boolean | 'noFlags' | 'none') {
        const tonemap = new tp.TonemapPlugin()
        const viewer: any = {
            scene: {environment: null, environmentIntensity: 1, environmentRotation: new tp.Euler()},
            getPlugin: (t: string) => t === 'Tonemap' ? tonemap : undefined,
            renderManager: {
                screenPass: {outputColorSpace: tp.SRGBColorSpace},
                gbufferUnpackExtension: gbufferFlags === 'none' ? undefined : {extraDefines: {
                    HAS_GBUFFER: () => 1,
                    GBUFFER_HAS_FLAGS: () => gbufferFlags === true ? 1 : undefined,
                }},
            },
        }
        ;(tonemap as any)._viewer = viewer
        return {viewer, tonemap}
    }
    const optedOut = () => {
        const m = new tp.PhysicalMaterial()
        m.userData.gBufferData = {tonemapEnabled: false}
        return m
    }

    it('follows the viewport: no tone mapping for an opted out material when the screen pass reads the GBuffer flags', () => {
        const {viewer} = viewerWith(true)
        expect(tp.materialPreviewOptionsFromViewer(viewer, optedOut()).toneMapping).toBeNull()
        const legacy = new tp.PhysicalMaterial()
        legacy.userData.postTonemap = false
        expect(tp.materialPreviewOptionsFromViewer(viewer, legacy).toneMapping).toBeNull()
        expect(tp.materialPreviewOptionsFromViewer(viewer, new tp.PhysicalMaterial()).toneMapping).toMatchObject({toneMapping: tp.ACESFilmicToneMapping})
        expect(tp.materialPreviewOptionsFromViewer(viewer, optedOut()).outputColorSpace).toBe(tp.SRGBColorSpace) // still converted
    })

    it('tone maps every material when the screen pass has no GBuffer flags, like the viewport', () => {
        for (const flags of ['noFlags', 'none'] as const) {
            const {viewer} = viewerWith(flags)
            expect(tp.materialPreviewOptionsFromViewer(viewer, optedOut()).toneMapping).toMatchObject({toneMapping: tp.ACESFilmicToneMapping})
        }
    })

    it('the plugin renders an opted out material without tone mapping', () => {
        const {viewer} = viewerWith(true)
        const listeners: (() => void)[] = []
        viewer.renderEnabled = true
        viewer.addEventListener = (type: string, l: () => void) => type === 'preFrame' && listeners.push(l)
        viewer.removeEventListener = () => {}
        viewer.renderManager.renderer = {}
        const generator = {renderToCanvas: vi.fn(() => ({})), dispose: vi.fn()}
        const queue = new tp.MaterialPreviewPlugin(generator as any)
        queue.onAdded(viewer)
        queue.maxPerFrame = 2
        queue.request(optedOut(), {}, () => {})
        queue.request(new tp.PhysicalMaterial(), {}, () => {})
        listeners.forEach(l => l())
        expect((generator.renderToCanvas.mock.calls as any[])[0][2].toneMapping).toBeNull()
        expect((generator.renderToCanvas.mock.calls as any[])[1][2].toneMapping).toMatchObject({toneMapping: tp.ACESFilmicToneMapping})
    })
})
