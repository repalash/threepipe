import {expose, transfer} from 'comlink'
import type {MainModule} from './ISort'
import workerPromise from './sort'
// import sharedArrayBufferWorkerPromise from './sort'
import {BufferPool} from './BufferPool'

export class WasmSorter {
    public module: EmscriptenModule & MainModule
    private _viewProjPtr: number
    private _globalBufferPtr: number
    private _combinedPtr: number
    private _bufferPool: BufferPool

    constructor(private _vertexCount: number, private _globalBuffer: Uint8Array) {
        const combinedLength = this._calculateCombinedLength()
        // we're double buffering, so 2 is the magic number here
        this._bufferPool = new BufferPool(combinedLength, 2)
    }

    public async load() {
        // const sharedABSupported = typeof SharedArrayBuffer !== 'undefined'
        // this.module = await (sharedABSupported ? sharedArrayBufferWorkerPromise() : workerPromise())
        this.module = await workerPromise()
        this._viewProjPtr = this.module._malloc(16 * Float32Array.BYTES_PER_ELEMENT)
        this._globalBufferPtr = this.module._malloc(this._vertexCount * 32)
        this._combinedPtr = this.module._malloc(this._calculateCombinedLength())
        this.module.HEAPU8.set(this._globalBuffer, this._globalBufferPtr)
    }

    public runSort(viewProj: Float32Array): ArrayBuffer {
        this.module.HEAPF32.set(viewProj, this._viewProjPtr / Float32Array.BYTES_PER_ELEMENT)
        this.module.runSort(this._viewProjPtr, this._globalBufferPtr, this._vertexCount, this._combinedPtr)

        const byteStart = this._combinedPtr
        const byteLength = this._calculateCombinedLength()
        const bufferToTransfer = this._bufferPool.getBuffer()
        new Uint8Array(bufferToTransfer).set(new Uint8Array(this.module.HEAPU8.buffer, byteStart, byteLength))
        return transfer(bufferToTransfer, [bufferToTransfer])
    }

    public returnBuffer(buffer: ArrayBuffer): void {
        this._bufferPool.returnBuffer(buffer)
    }

    private _calculateCombinedLength(): number {
        return 4 * 4 * this._vertexCount + 3 * 4 * this._vertexCount + 3 * 4 * this._vertexCount + 4 * 4 * this._vertexCount * Float32Array.BYTES_PER_ELEMENT
    }

    public dispose(): void {
        if (this.module) {
            this.module._free(this._viewProjPtr)
            this.module._free(this._globalBufferPtr)
            this.module._free(this._combinedPtr)
        }
    }
}

expose(WasmSorter)
