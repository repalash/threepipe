/**
 * The browser globals a `ThreeViewer` touches while it is built and while it imports and exports assets,
 * for running one in Node with no WebGL.
 *
 * This is threepipe's Node path as it exists today: `plugins/procedural-generation/src/utils/node-polyfill.ts`
 * on the `proc` branch (pattern from `experiments/tp-cf-test`), documented in
 * `issues/open/threepipe-nodejs-support.md`. It is copied here rather than imported because that package is
 * unpublished; the issue's own recommendation - move `DummyRenderManager` and these stubs into threepipe core
 * behind a `ThreeViewer.createHeadless()` - is filed again as `issues/open/modelling-node-session-polyfill.md`,
 * and this file should be deleted when it lands.
 *
 * What works on top of it: the scene graph, the asset manager, glTF import and export, every modelling
 * command that does not draw. What does not: anything that needs pixels (`capture`, `look`) - those
 * commands say so and the CLI routes them to a headless browser.
 *
 * Import this module before `threepipe`. It only fills in globals that are missing, so under a DOM test
 * environment it changes nothing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const g = globalThis as any

class ImageDataStub {
    width: number
    height: number
    data: Uint8ClampedArray
    constructor(width: number, height: number, data?: Uint8ClampedArray) {
        this.width = width
        this.height = height
        this.data = data || new Uint8ClampedArray(width * height * 4)
    }
}

class ElementStub {
    id: string | undefined
    classList = {
        _set: new Set<string>(),
        add(...c: string[]) { for (const x of c) this._set.add(x) },
        remove(...c: string[]) { for (const x of c) this._set.delete(x) },
        contains(c: string) { return this._set.has(c) },
        toggle(c: string) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c) },
    }
    style: Record<string, string> = {}
    dataset: Record<string, string> = {}
    children: ElementStub[] = []
    parentElement: ElementStub | null = null
    private _listeners: Record<string, ((event: any) => void)[]> = {}
    constructor(public tagName: string) {}
    appendChild(child: ElementStub) {
        this.children.push(child)
        child.parentElement = this
        return child
    }
    removeChild(child: ElementStub) {
        const i = this.children.indexOf(child)
        if (i >= 0) this.children.splice(i, 1)
        child.parentElement = null
        return child
    }
    remove() { this.parentElement?.removeChild(this) }
    addEventListener(type: string, listener: (event: any) => void) {
        (this._listeners[type] ??= []).push(listener)
    }
    removeEventListener(type: string, listener: (event: any) => void) {
        const list = this._listeners[type]
        if (!list) return
        const i = list.indexOf(listener)
        if (i >= 0) list.splice(i, 1)
    }
    dispatchEvent(event: {type: string}) {
        for (const l of this._listeners[event.type] ?? []) l(event)
        return true
    }
    setAttribute() {}
    getAttribute() { return null }
    get ownerDocument() { return g.document }
    getRootNode() { return g.document }
    getBoundingClientRect() { return {x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600} }
    get clientWidth() { return 800 }
    get clientHeight() { return 600 }
    get offsetWidth() { return 800 }
    get offsetHeight() { return 600 }
    setPointerCapture() {}
    releasePointerCapture() {}
    focus() {}
    blur() {}
}

class CanvasStub extends ElementStub {
    width = 800
    height = 600
    constructor() {
        super('canvas')
    }
    getContext(contextId: string) {
        if (contextId === '2d') {
            return {
                canvas: this,
                fillRect() {}, clearRect() {}, drawImage() {}, putImageData() {},
                createImageData: (w: number, h: number) => new ImageDataStub(w, h),
                getImageData: (_x: number, _y: number, w: number, h: number) => new ImageDataStub(w, h),
            }
        }
        // No WebGL: a viewer built on `DummyRenderManager` never asks for one.
        return null
    }
    toDataURL(): string {
        throw new Error('this canvas cannot render - it is a Node stub with no WebGL context')
    }
}

class ImageStub extends ElementStub {
    complete = false
    onload: ((ev?: any) => void) | null = null
    onerror: ((ev?: any) => void) | null = null
    private _src = ''
    constructor() {
        super('img')
    }
    set src(value: string) {
        this._src = value
        setTimeout(() => {
            this.complete = true
            const ev = {type: 'load'}
            this.onload?.(ev)
            this.dispatchEvent(ev)
        }, 1)
    }
    get src() {
        return this._src
    }
}

class DocumentStub extends ElementStub {
    private _all: ElementStub[] = []
    body = new ElementStub('body')
    head = new ElementStub('head')
    documentElement = new ElementStub('html')
    constructor() {
        super('document')
    }
    createElement(tagName: string) {
        const t = tagName.toLowerCase()
        const el = t === 'canvas' ? new CanvasStub() : t === 'img' ? new ImageStub() : new ElementStub(t)
        this._all.push(el)
        return el
    }
    createElementNS(_ns: string, tagName: string) {
        return this.createElement(tagName)
    }
    getElementById(id: string) {
        return this._all.find(el => el.id === id) ?? null
    }
    querySelector(selector: string) {
        if (selector.startsWith('#')) return this.getElementById(selector.slice(1))
        if (selector.startsWith('.')) return this._all.find(el => el.classList.contains(selector.slice(1))) ?? null
        return this._all.find(el => el.tagName === selector.toLowerCase()) ?? null
    }
    querySelectorAll() {
        return []
    }
}

/** `FileReader` over `Blob`'s promise API, which Node has. */
class FileReaderStub {
    result: string | ArrayBuffer | null = null
    onload: ((ev?: any) => void) | null = null
    onloadend: ((ev?: any) => void) | null = null
    onerror: ((ev?: any) => void) | null = null
    private _done(data: string | ArrayBuffer) {
        setTimeout(() => {
            this.result = data
            const ev = {target: this}
            this.onload?.(ev)
            this.onloadend?.(ev)
        }, 0)
    }
    readAsArrayBuffer(blob: Blob) {
        blob.arrayBuffer().then(b => this._done(b), e => this.onerror?.(e))
    }
    readAsDataURL(blob: Blob) {
        blob.arrayBuffer().then(b => this._done(`data:${blob.type};base64,${Buffer.from(b).toString('base64')}`),
            e => this.onerror?.(e))
    }
    readAsText(blob: Blob) {
        blob.text().then(t => this._done(t), e => this.onerror?.(e))
    }
}

if (typeof g.document === 'undefined') {
    g.document = new DocumentStub()
    g.window = g
    g.ImageData ??= ImageDataStub
    g.HTMLElement ??= ElementStub
    g.HTMLCanvasElement ??= CanvasStub
    g.HTMLImageElement ??= ImageStub
    g.Image ??= ImageStub
    g.FileReader ??= FileReaderStub
    g.addEventListener ??= () => undefined
    g.removeEventListener ??= () => undefined
    g.ProgressEvent ??= class ProgressEvent {
        constructor(public type: string, public init?: unknown) {}
    }
    g.devicePixelRatio ??= 1
    g.getComputedStyle ??= () => ({getPropertyValue: () => '', maxWidth: 'none', maxHeight: 'none'})
    g.requestAnimationFrame ??= (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16)
    g.cancelAnimationFrame ??= (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
    g.navigator ??= {userAgent: 'node', platform: 'node'}
    g.location ??= {
        href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost',
        hostname: 'localhost', port: '', pathname: '/', search: '', hash: '',
    }

    // Blob URLs, so the asset importer's `URL.createObjectURL(file)` -> `fetch(url)` round trip works.
    const blobs = new Map<string, Blob>()
    let blobCounter = 0
    URL.createObjectURL = (obj: Blob | MediaSource) => {
        const key = `node-${++blobCounter}`
        blobs.set(key, obj as Blob)
        return `blob:http://localhost/${key}`
    }
    URL.revokeObjectURL = (url: string) => {
        blobs.delete(url.split('/').pop() ?? '')
    }
    const nodeFetch = g.fetch as typeof fetch
    g.fetch = async(input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith('blob:')) {
            const blob = blobs.get(url.split('/').pop() ?? '')
            if (!blob) throw new Error(`no blob for ${url}`)
            return new Response(blob)
        }
        return nodeFetch(input as never, init)
    }
}

/**
 * Stands in for `ViewerRenderManager` when there is no WebGL: pass it as the viewer's `rmClass`.
 * From the same source as the stubs above.
 */
export class DummyRenderManager {
    private _listeners: Record<string, ((e: any) => void)[]> = {}
    constructor(_options: unknown) {}
    addEventListener(type: string, listener: (e: any) => void) {
        (this._listeners[type] ??= []).push(listener)
    }
    removeEventListener(type: string, listener: (e: any) => void) {
        const list = this._listeners[type]
        if (!list) return
        const i = list.indexOf(listener)
        if (i >= 0) list.splice(i, 1)
    }
    dispatchEvent(event: {type: string}) {
        for (const fn of this._listeners[event.type] ?? []) fn(event)
    }
    hasEventListener(type: string) {
        return !!this._listeners[type]?.length
    }
    resetShadows() {}
    reset() {}
    dispose() {}
    setSize() {}
    get webglRenderer(): null {
        return null
    }
    get needsRender() {
        return false
    }
}
