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

// three.js FileLoader reports download progress with ProgressEvent
if (typeof globalThis.ProgressEvent === 'undefined') {
    (globalThis as any).ProgressEvent = class ProgressEvent extends Event {
        lengthComputable: boolean
        loaded: number
        total: number
        constructor(type: string, init: {lengthComputable?: boolean, loaded?: number, total?: number} = {}) {
            super(type)
            this.lengthComputable = init.lengthComputable ?? false
            this.loaded = init.loaded ?? 0
            this.total = init.total ?? 0
        }
    }
}

// three.js GLTFExporter reads the exported blobs with FileReader (readAsArrayBuffer, readAsDataURL, onloadend)
if (typeof globalThis.FileReader === 'undefined') {
    (globalThis as any).FileReader = class FileReader {
        result: ArrayBuffer | string | null = null
        error: unknown = null
        onload: ((e: any) => void) | null = null
        onloadend: ((e: any) => void) | null = null
        onerror: ((e: any) => void) | null = null
        private _read(blob: Blob, convert: (buffer: ArrayBuffer) => ArrayBuffer | string) {
            blob.arrayBuffer().then((buffer) => {
                this.result = convert(buffer)
                this.onload?.({target: this})
                this.onloadend?.({target: this})
            }, (error) => {
                this.error = error
                this.onerror?.({target: this})
                this.onloadend?.({target: this})
            })
        }
        readAsArrayBuffer(blob: Blob) {
            this._read(blob, b => b)
        }
        readAsText(blob: Blob) {
            this._read(blob, b => new TextDecoder().decode(b))
        }
        readAsDataURL(blob: Blob) {
            this._read(blob, b => `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`)
        }
    }
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
