/**
 * Vitest setup file — minimal polyfills so three.js modules can be imported in Node.js.
 * Three.js Texture class references ImageData at module scope, and some modules
 * reference document/window. This provides just enough for imports to succeed.
 */

if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as any).ImageData = class ImageData {
        width: number
        height: number
        data: Uint8ClampedArray
        constructor(width: number, height: number, data?: Uint8ClampedArray) {
            this.width = width
            this.height = height
            this.data = data || new Uint8ClampedArray(width * height * 4)
        }
    }
}

if (typeof globalThis.document === 'undefined') {
    (globalThis as any).document = {
        createElement: () => ({
            getContext: () => null,
            style: {},
            addEventListener: () => {},
            removeEventListener: () => {},
        }),
        createElementNS: () => ({
            style: {},
            addEventListener: () => {},
            removeEventListener: () => {},
        }),
        body: {
            appendChild: () => {},
            removeChild: () => {},
            classList: {add: () => {}, remove: () => {}},
        },
    }
}

if (typeof globalThis.window === 'undefined') {
    (globalThis as any).window = globalThis
}

if (typeof globalThis.HTMLElement === 'undefined') {
    (globalThis as any).HTMLElement = class HTMLElement {}
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
    (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16)
    ;(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id)
}

if (typeof globalThis.devicePixelRatio === 'undefined') {
    (globalThis as any).devicePixelRatio = 1
}

if (typeof globalThis.location === 'undefined') {
    (globalThis as any).location = {
        href: 'http://localhost/',
        origin: 'http://localhost',
        protocol: 'http:',
        host: 'localhost',
        hostname: 'localhost',
        pathname: '/',
        search: '',
        hash: '',
    }
}

// FileReader: three's GLTFExporter reads its buffers (and the glb) through it; Node has Blob but no FileReader
if (typeof globalThis.FileReader === 'undefined') {
    (globalThis as any).FileReader = class FileReader {
        result: string | ArrayBuffer | null = null
        onload: (() => void) | null = null
        onloadend: (() => void) | null = null
        private _done(result: string | ArrayBuffer) {
            this.result = result
            this.onload?.()
            this.onloadend?.()
        }
        readAsArrayBuffer(blob: Blob) {
            void blob.arrayBuffer().then(b => this._done(b))
        }
        readAsDataURL(blob: Blob) {
            void blob.arrayBuffer().then(b => this._done(`data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`))
        }
    }
}
