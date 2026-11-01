import {beforeAll, describe, expect, it, vi} from 'vitest'
import {EventDispatcher} from 'three'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

// A disabled viewer (viewer.enabled = false, also after a lost WebGL context) sends no postFrame: a screenshot that
// waited for one never settled. The fake viewer sends frames only when the test calls frame().
function fakeViewer(o: {enabled: boolean, renderEnabled: boolean, plugin?: unknown, progressive?: unknown}) {
    const setInteractions = vi.fn()
    const v = Object.assign(new EventDispatcher<any>(), {
        ...o,
        _canvas: {
            toDataURL: vi.fn(() => 'data:image/jpeg;base64,AA'),
            toBlob: vi.fn((cb: (b: Blob) => void) => cb(new Blob(['x']))),
        },
        canvas: {},
        _onNextFrame: (tp.ThreeViewer.prototype as any)._onNextFrame,
        getPlugin: (t: any) => (t === 'ProgressivePlugin' || t?.PluginType === 'ProgressivePlugin') ? o.progressive : o.plugin,
        console: {warn: vi.fn()},
        setDirty: vi.fn(),
        scene: {mainCamera: {setInteractions}},
        renderManager: {renderScale: 1},
        frame: () => v.dispatchEvent({type: 'postFrame'}),
        /** As ThreeViewer.enabled: a change dispatches viewerEnabled or viewerDisabled */
        setEnabled: (e: boolean) => {
            v.enabled = e
            v.dispatchEvent({type: e ? 'viewerEnabled' : 'viewerDisabled'})
        },
        listeners: () => ['postFrame', 'viewerDisabled', 'dispose'].reduce((n, t) => n + ((v as any)._listeners?.[t]?.length ?? 0), 0),
    })
    return Object.assign(v, {setInteractions})
}
const tick = async(n = 5) => {
    for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('screenshot of a viewer that renders no frame', () => {
    it('getScreenshotDataUrl reads the canvas instead of waiting for a frame', async() => {
        const v = fakeViewer({enabled: false, renderEnabled: true})
        await expect(tp.ThreeViewer.prototype.getScreenshotDataUrl.call(v as any)).resolves.toBe('data:image/jpeg;base64,AA')
        expect(v.listeners()).toBe(0)
    })

    it('getScreenshotBlob reads the canvas, also with CanvasSnapshotPlugin added', async() => {
        const getFile = vi.fn()
        const v = fakeViewer({enabled: false, renderEnabled: true, plugin: {getFile}})
        await expect(tp.ThreeViewer.prototype.getScreenshotBlob.call(v as any)).resolves.toBeInstanceOf(Blob)
        expect(getFile).not.toHaveBeenCalled()
    })

    it('CanvasSnapshotPlugin returns nothing instead of waiting', async() => {
        const v = fakeViewer({enabled: false, renderEnabled: true})
        const plugin = new tp.CanvasSnapshotPlugin() as any
        plugin._viewer = v
        await expect(plugin.getFile('a.png')).resolves.toBeUndefined()
        expect(v.console.warn).toHaveBeenCalled()
        expect(v.listeners()).toBe(0)
    })

    it('getScreenshotBlob with paused rendering (renderEnabled false) skips CanvasSnapshotPlugin and reads the canvas', async() => {
        const getFile = vi.fn()
        const v = fakeViewer({enabled: true, renderEnabled: false, plugin: {getFile}})
        await expect(tp.ThreeViewer.prototype.getScreenshotBlob.call(v as any)).resolves.toBeInstanceOf(Blob)
        expect(getFile).not.toHaveBeenCalled()
    })

    it('CanvasSnapshotPlugin with paused rendering returns nothing instead of waiting for progressive frames', async() => {
        const v = fakeViewer({enabled: true, renderEnabled: false})
        const plugin = new tp.CanvasSnapshotPlugin() as any
        plugin._viewer = v
        await expect(plugin.getFile('a.png')).resolves.toBeUndefined()
        expect(v.listeners()).toBe(0)
    })

    it('CanvasSnapshotPlugin stops waiting when rendering stops during the snapshot (a render error) and restores its changes', async() => {
        const progressive = {maxFrameCount: 8, isConverged: () => false}
        const v = fakeViewer({enabled: true, renderEnabled: true, progressive})
        const plugin = new tp.CanvasSnapshotPlugin() as any
        plugin._viewer = v
        const file = plugin.getFile('a.png', {waitForProgressive: true})
        v.frame()
        await tick()
        v.frame()
        await tick()
        expect(progressive.maxFrameCount).toBe(64)
        // a render error: the viewer sets renderEnabled false (as _animationLoop does) and still sends postFrame
        v.renderEnabled = false
        v.frame()
        await expect(file).resolves.toBeUndefined()
        expect(progressive.maxFrameCount).toBe(8)
        expect(v.setInteractions).toHaveBeenLastCalledWith(true, tp.CanvasSnapshotPlugin.PluginType, false)
        expect(v.listeners()).toBe(0)
    })

    it('CanvasSnapshotPlugin stops waiting when the viewer is disabled during the snapshot (a lost WebGL context)', async() => {
        const progressive = {maxFrameCount: 8, isConverged: () => false}
        const v = fakeViewer({enabled: true, renderEnabled: true, progressive})
        const plugin = new tp.CanvasSnapshotPlugin() as any
        plugin._viewer = v
        const file = plugin.getFile('a.png', {waitForProgressive: true})
        v.frame()
        await tick()
        v.frame()
        await tick()
        // no postFrame comes after this
        v.setEnabled(false)
        await expect(file).resolves.toBeUndefined()
        expect(progressive.maxFrameCount).toBe(8)
        expect(v.setInteractions).toHaveBeenLastCalledWith(true, tp.CanvasSnapshotPlugin.PluginType, false)
        expect(v.listeners()).toBe(0)
    })

    it('CanvasSnapshotPlugin returns when the viewer is disabled during options.timeout', async() => {
        const v = fakeViewer({enabled: true, renderEnabled: true})
        const plugin = new tp.CanvasSnapshotPlugin() as any
        plugin._viewer = v
        const file = plugin.getFile('a.png', {waitForProgressive: false, timeout: 20})
        v.frame()
        await tick()
        v.setEnabled(false)
        await expect(file).resolves.toBeUndefined()
        expect(v.setInteractions).toHaveBeenLastCalledWith(true, tp.CanvasSnapshotPlugin.PluginType, false)
        expect(v.listeners()).toBe(0)
    })

    it('an enabled viewer still waits for the next frame', async() => {
        const v = fakeViewer({enabled: true, renderEnabled: true})
        let url: string | null | undefined
        void tp.ThreeViewer.prototype.getScreenshotDataUrl.call(v as any).then(u => url = u)
        await tick()
        expect(url).toBeUndefined()
        v.frame()
        await tick()
        expect(url).toBe('data:image/jpeg;base64,AA')
        expect(v.listeners()).toBe(0)
    })

    it('getScreenshotDataUrl and getScreenshotBlob read the canvas when the viewer is disabled while they wait', async() => {
        const v = fakeViewer({enabled: true, renderEnabled: true})
        const url = tp.ThreeViewer.prototype.getScreenshotDataUrl.call(v as any)
        const blob = tp.ThreeViewer.prototype.getScreenshotBlob.call(v as any)
        await tick()
        v.setEnabled(false)
        await expect(url).resolves.toBe('data:image/jpeg;base64,AA')
        await expect(blob).resolves.toBeInstanceOf(Blob)
        // renderEnabled is not toggled when no frame came
        expect(v.renderEnabled).toBe(true)
        expect(v.listeners()).toBe(0)
    })
})

describe('ThreeViewer.enabled', () => {
    it('a change dispatches viewerEnabled or viewerDisabled', () => {
        const types: string[] = []
        // the onChange accessor of the prototype, without constructing a viewer (no WebGL in Node.js)
        const v = Object.create(tp.ThreeViewer.prototype)
        v.dispatchEvent = (e: {type: string}) => types.push(e.type)
        v.enabled = false
        expect(v.enabled).toBe(false)
        v.enabled = true
        expect(types).toEqual(['viewerDisabled', 'viewerEnabled'])
    })
})
