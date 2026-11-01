import {beforeAll, describe, expect, it, vi} from 'vitest'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

// A disabled viewer (viewer.enabled = false, also after a lost WebGL context) sends no postFrame: a screenshot that
// waited for one never settled.
function fakeViewer(o: {enabled: boolean, renderEnabled: boolean, plugin?: unknown}) {
    return {
        ...o,
        _canvas: {
            toDataURL: vi.fn(() => 'data:image/jpeg;base64,AA'),
            toBlob: vi.fn((cb: (b: Blob) => void) => cb(new Blob(['x']))),
        },
        doOnce: vi.fn(() => new Promise(() => undefined)), // no frame ever comes
        getPlugin: () => o.plugin,
        console: {warn: vi.fn()},
    }
}

describe('screenshot of a viewer that renders no frame', () => {
    it('getScreenshotDataUrl reads the canvas instead of waiting for a frame', async() => {
        const v = fakeViewer({enabled: false, renderEnabled: true})
        await expect(tp.ThreeViewer.prototype.getScreenshotDataUrl.call(v as any)).resolves.toBe('data:image/jpeg;base64,AA')
        expect(v.doOnce).not.toHaveBeenCalled()
    })

    it('getScreenshotBlob reads the canvas, also with CanvasSnapshotPlugin added', async() => {
        const getFile = vi.fn()
        const v = fakeViewer({enabled: false, renderEnabled: true, plugin: {getFile}})
        await expect(tp.ThreeViewer.prototype.getScreenshotBlob.call(v as any)).resolves.toBeInstanceOf(Blob)
        expect(v.doOnce).not.toHaveBeenCalled()
        expect(getFile).not.toHaveBeenCalled()
    })

    it('CanvasSnapshotPlugin returns nothing instead of waiting', async() => {
        const v = fakeViewer({enabled: false, renderEnabled: true})
        const plugin = new tp.CanvasSnapshotPlugin() as any
        plugin._viewer = v
        await expect(plugin.getFile('a.png')).resolves.toBeUndefined()
        expect(v.doOnce).not.toHaveBeenCalled()
        expect(v.console.warn).toHaveBeenCalled()
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
        expect(v.doOnce).not.toHaveBeenCalled()
    })

    it('CanvasSnapshotPlugin stops waiting when rendering stops during the snapshot (a render error) and restores its changes', async() => {
        const progressive = {maxFrameCount: 8, isConverged: () => false}
        const setInteractions = vi.fn()
        let frames = 0
        const v: any = {
            enabled: true, renderEnabled: true,
            canvas: {},
            console: {warn: vi.fn()},
            setDirty: vi.fn(),
            scene: {mainCamera: {setInteractions}},
            renderManager: {renderScale: 1},
            getPlugin: () => progressive,
            // the second frame fails: the viewer sets renderEnabled false (as _animationLoop does on a render error)
            doOnce: vi.fn(async() => { if (++frames === 2) v.renderEnabled = false }),
        }
        const plugin = new tp.CanvasSnapshotPlugin() as any
        plugin._viewer = v
        await expect(plugin.getFile('a.png', {waitForProgressive: true})).resolves.toBeUndefined()
        expect(frames).toBe(2)
        expect(progressive.maxFrameCount).toBe(8)
        expect(setInteractions).toHaveBeenLastCalledWith(true, tp.CanvasSnapshotPlugin.PluginType, false)
    })

    it('an enabled viewer still waits for the next frame', () => {
        const v = fakeViewer({enabled: true, renderEnabled: true})
        void tp.ThreeViewer.prototype.getScreenshotDataUrl.call(v as any)
        expect(v.doOnce).toHaveBeenCalledWith('postFrame', expect.any(Function))
    })
})
