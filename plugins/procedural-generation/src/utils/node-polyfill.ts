class ImageData {
    width: number
    height: number
    data: Uint8ClampedArray
    constructor(width: number, height: number, data?: Uint8ClampedArray) {
        this.width = width
        this.height = height
        this.data = data || new Uint8ClampedArray(width * height * 4)
    }

}
class HTMLElement {
    id: string | undefined
    classList: Set<string> = new Set()
    style: {[key: string]: string} = {}
    constructor(public tagName: string) {
    }
    children: HTMLElement[] = []
    appendChild(child: HTMLElement) {
        this.children.push(child)
        child.parentElement = this
    }
    parentElement: HTMLElement | null = null
    removeChild(child: HTMLElement) {
        const index = this.children.indexOf(child)
        if (index !== -1) {
            this.children.splice(index, 1)
            child.parentElement = null
        }
    }
    _listenerMap: {[type: string]: ((event: any) => void)[]} = {}
    addEventListener(type: string, listener: (event: any) => void) {
        if (!this._listenerMap[type]) {
            this._listenerMap[type] = []
        }
        this._listenerMap[type].push(listener)
    }
    removeEventListener(type: string, listener: (event: any) => void) {
        if (!this._listenerMap[type]) return
        const index = this._listenerMap[type].indexOf(listener)
        if (index !== -1) {
            this._listenerMap[type].splice(index, 1)
        }
    }
    dispatchEvent(event: {type: string, [key: string]: any}) {
        if (!this._listenerMap[event.type]) return
        for (const listener of this._listenerMap[event.type]) {
            listener(event)
        }
    }
    get ownerDocument() {
        return document
    }
    getRootNode() { return document }
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
class HTMLDocument extends HTMLElement {
    _allElements = [] as HTMLElement[]
    body = new HTMLElement('body')
    createElement(tagName: string) {
        const elem =
			tagName.toLowerCase() === 'canvas' ? new HTMLCanvasElement() :
			    tagName.toLowerCase() === 'img' ? new HTMLImageElement() :
			        new HTMLElement(tagName)
        document._allElements.push(elem)
        return elem
    }
    createElementNS(namespace: string, tagName: string) {
        return this.createElement(tagName)
    }
    getElementById(id: string) {
        return document._allElements.find(el => el.id === id) || null
    }
    querySelector(selector: string) {
        return selector.startsWith('#') ?
            document._allElements.find(el => el.id === selector.slice(1)) || null :
            selector.startsWith('.') ?
                document._allElements.find(el => el.classList.has(selector.slice(1))) || null :
                document._allElements.find(el => el.tagName.toLowerCase() === selector.toLowerCase()) || null
    }
}
class HTMLCanvasElement extends HTMLElement {
    constructor() {
        super('canvas')
    }
    getContext(contextId: string) {
        if (contextId === '2d') {
            return {
                fillRect: () => {},
                clearRect: () => {},
                drawImage: () => {},
                createImageData: (width: number, height: number) => new ImageData(width, height),
                putImageData: () => {},
            }
        }
        if (contextId === 'webgl2' || contextId === 'webgl') {
            // Auto-stub WebGL context: any missing method returns a no-op or sensible default
            const glConstants: Record<string, number> = {VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, HIGH_FLOAT: 36338, MEDIUM_FLOAT: 36337, LOW_FLOAT: 36336, FLOAT: 5126, UNSIGNED_BYTE: 5121, RGBA: 6408, MAX_TEXTURE_SIZE: 3379, MAX_CUBE_MAP_TEXTURE_SIZE: 34076, MAX_RENDERBUFFER_SIZE: 34024, MAX_TEXTURE_IMAGE_UNITS: 34930, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660, MAX_VERTEX_ATTRIBS: 34921, MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_VARYING_VECTORS: 36348, MAX_FRAGMENT_UNIFORM_VECTORS: 36349, MAX_VIEWPORT_DIMS: 3386, MAX_SAMPLES: 36183, ALIASED_POINT_SIZE_RANGE: 33901, ALIASED_LINE_WIDTH_RANGE: 33902, VERSION: 7938, SHADING_LANGUAGE_VERSION: 35724, RENDERER: 7937, VENDOR: 7936}
            const target: any = {
                ...glConstants,
                canvas: this,
                drawingBufferWidth: 800,
                drawingBufferHeight: 600,
                drawingBufferColorSpace: 'srgb',
                getShaderPrecisionFormat: () => ({rangeMin: 127, rangeMax: 127, precision: 23}),
                getParameter: (p: number) => { if (p === 7938 || p === 35724) return 'WebGL 2.0'; if (p === 7937 || p === 7936) return 'Node.js Stub'; if (p === 3386) return new Int32Array([16384, 16384]); if (p === 33901 || p === 33902) return new Float32Array([1, 1]); return 4096 },
                getExtension: () => null,
                getSupportedExtensions: () => [],
                createShader: () => ({}),
                shaderSource: () => {},
                compileShader: () => {},
                getShaderParameter: () => true,
                getShaderInfoLog: () => '',
                createProgram: () => ({}),
                attachShader: () => {},
                linkProgram: () => {},
                getProgramParameter: () => true,
                getProgramInfoLog: () => '',
                useProgram: () => {},
                getAttribLocation: () => 0,
                getUniformLocation: () => ({}),
                createBuffer: () => ({}),
                createTexture: () => ({}),
                createFramebuffer: () => ({}),
                createRenderbuffer: () => ({}),
                bindBuffer: () => {},
                bindTexture: () => {},
                bindFramebuffer: () => {},
                bindRenderbuffer: () => {},
                bufferData: () => {},
                framebufferTexture2D: () => {},
                framebufferRenderbuffer: () => {},
                renderbufferStorage: () => {},
                renderbufferStorageMultisample: () => {},
                checkFramebufferStatus: () => 36053,
                texImage2D: () => {},
                texSubImage2D: () => {},
                texParameteri: () => {},
                texParameterf: () => {},
                pixelStorei: () => {},
                generateMipmap: () => {},
                deleteTexture: () => {},
                deleteBuffer: () => {},
                deleteFramebuffer: () => {},
                deleteRenderbuffer: () => {},
                deleteProgram: () => {},
                deleteShader: () => {},
                enable: () => {},
                disable: () => {},
                blendFunc: () => {},
                blendFuncSeparate: () => {},
                blendEquation: () => {},
                blendEquationSeparate: () => {},
                depthFunc: () => {},
                depthMask: () => {},
                colorMask: () => {},
                stencilFunc: () => {},
                stencilOp: () => {},
                stencilMask: () => {},
                clearColor: () => {},
                clearDepth: () => {},
                clearStencil: () => {},
                clear: () => {},
                viewport: () => {},
                scissor: () => {},
                enableVertexAttribArray: () => {},
                disableVertexAttribArray: () => {},
                vertexAttribPointer: () => {},
                drawArrays: () => {},
                drawElements: () => {},
                drawArraysInstanced: () => {},
                drawElementsInstanced: () => {},
                activeTexture: () => {},
                uniform1i: () => {},
                uniform1f: () => {},
                uniform2fv: () => {},
                uniform3fv: () => {},
                uniform4fv: () => {},
                uniformMatrix3fv: () => {},
                uniformMatrix4fv: () => {},
                vertexAttribDivisor: () => {},
                createVertexArray: () => ({}),
                bindVertexArray: () => {},
                deleteVertexArray: () => {},
                isContextLost: () => false,
                getContextAttributes: () => ({alpha: true, antialias: true, depth: true, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false}),
                drawBuffers: () => {},
                readBuffer: () => {},
                blitFramebuffer: () => {},
            }
            return new Proxy(target, {
                get: (obj, prop) => {
                    if (prop in obj) return obj[prop]
                    return () => {} // auto-stub any missing method
                },
            })
        }
        throw new Error(`Context ${contextId} not supported`)
    }
}
class HTMLImageElement extends HTMLElement {
    constructor() {
        super('img')
    }
    complete = false
    onload: ((this: HTMLImageElement, ev?: any) => any) | null = null
    onerror: ((this: HTMLImageElement, ev?: any) => any) | null = null
    _src = ''
    set src(value: string) {
        this._src = value
        setTimeout(()=>{
            this.complete = true
            const ev = new Event('load')
            if (this.onload) {
                this.onload(ev)
            }
            this.dispatchEvent(ev)
        }, 1)
    }
    get src() {
        return this._src
    }
}

const registeredBlobs = new Map<string, any>()
URL.createObjectURL = (obj)=>{
    const key = Math.random().toString(36).substring(2)
    registeredBlobs.set(key, obj)
    return `blob:http://localhost/${key}`
}
URL.revokeObjectURL = (url: string)=>{
    const key = url.split('/').pop()
    if (key) {
        registeredBlobs.delete(key)
    }
}

const fetch1 = fetch
const fetch2 = async(urlOrReq: string|Request, options?: RequestInit) => {
    const url = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url
    if (url.startsWith('blob:')) {
        const url2 = new URL(url)
        const key = url2.pathname.split('/').pop()
        if (key && registeredBlobs.has(key)) {
            return new Response(registeredBlobs.get(key))
        }
        throw new Error(`Blob not found for URL: ${url}`)
    }
    return fetch1(url, options)
}


class FileReader {
    result: string | ArrayBuffer | null = null
    onload: ((this: FileReader, ev?: any) => any) | null = null
    onloadend: ((this: FileReader, ev?: any) => any) | null = null
    _read(data: string | ArrayBuffer) {
        setTimeout(()=>{
            this.result = data
            if (this.onload) {
                // this.onload(new CustomEvent('load', { detail: { target: this, result: data } }))
                this.onload()
            }
            if (this.onloadend) {
                // this.onloadend(new CustomEvent('loadend', { detail: { target: this, result: data } }))
                this.onloadend()
            }
        }, 1)
    }
    readAsArrayBuffer(file: File | Blob) {
        file.arrayBuffer().then((buffer) => {
            this._read(buffer)
        })
    }
    readAsDataURL(file: File | Blob) {
        file.arrayBuffer().then((buffer) => {
            const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
            this._read(`data:${file.type};base64,${base64}`)
        })
    }
    readAsText(file: File | Blob, encoding?: string) {
        file.text().then((text) => {
            this._read(text)
        })
    }
}

const document = new HTMLDocument('document')
globalThis.document = document
globalThis.ImageData = ImageData
globalThis.window = globalThis
globalThis.addEventListener = (() => {}) as any
globalThis.ProgressEvent = class ProgressEvent { constructor(public type: string, public init?: any) {} } as any
globalThis.removeEventListener = (() => {}) as any
globalThis.devicePixelRatio = 1
globalThis.location = {
    href: 'http://localhost/',
    origin: 'http://localhost',
    protocol: 'http:',
    host: 'localhost',
    hostname: 'localhost',
    port: '80',
    pathname: '/',
    search: '',
    hash: '',
    assign: (url: string) => {
        globalThis.location.href = url
    },
    reload: () => {
        // no-op
    },
    replace: (url: string) => {
        globalThis.location.href = url
    },
}
globalThis.HTMLElement = HTMLElement
globalThis.FileReader = FileReader
globalThis.fetch = fetch2 as any
// globalThis.ReadableStream = undefined // disabled — breaks Response() in Node 20+
globalThis.getComputedStyle = (() => ({getPropertyValue: () => ''})) as any
globalThis.requestAnimationFrame = ((cb: any) => setTimeout(cb, 16)) as any
globalThis.cancelAnimationFrame = ((id: any) => clearTimeout(id)) as any

/**
 * DummyRenderManager — replaces ViewerRenderManager when running without WebGL.
 * Pass as `rmClass` option to ThreeViewer to skip WebGL renderer creation.
 * Pattern from experiments/tp-cf-test.
 */
class DummyEventDispatcher {
    _listeners: Record<string, Function[]> = {}
    addEventListener(type: string, listener: Function) {
        if (!this._listeners[type]) this._listeners[type] = []
        this._listeners[type].push(listener)
    }
    removeEventListener(type: string, listener: Function) {
        if (!this._listeners[type]) return
        const idx = this._listeners[type].indexOf(listener)
        if (idx !== -1) this._listeners[type].splice(idx, 1)
    }
    dispatchEvent(event: any) {
        for (const fn of this._listeners[event.type] || []) fn(event)
    }
    hasEventListener(type: string) { return !!this._listeners[type]?.length }
}
export class DummyRenderManager extends DummyEventDispatcher {
    constructor(_args: any) { super() }
    resetShadows() {}
    reset() {}
    dispose() {}
    setSize() {}
    get webglRenderer(): any { return null }
}
