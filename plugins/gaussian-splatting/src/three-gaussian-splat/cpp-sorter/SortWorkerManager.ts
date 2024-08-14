import {Remote, transfer, wrap} from 'comlink'
// @ts-expect-error query param
import WasmSorterWorker from './worker?worker&inline'
import type {WasmSorter} from './worker'

export const SPLAT_ROW_LENGTH = 3 * 4 + 3 * 4 + 4 + 4

function trimBuffer(_buffer: Uint8Array, _maxSplats: number, _vertexCount: number): {buffer: Uint8Array; vertexCount: number} {
    const actualVertexCount = Math.min(_vertexCount, _maxSplats)
    const actualBufferSize = SPLAT_ROW_LENGTH * actualVertexCount
    const buffer = _buffer.slice(0, actualBufferSize)
    return {buffer, vertexCount: actualVertexCount}
}

export class SortWorkerManager {
    private _workers: Remote<WasmSorter>[] = []
    private _maxWorkers = 8

    private _workerCtor: new (vertexCount: number, globalBuffer: Uint8Array) => Remote<WasmSorter>

    onError = (e: any) => {
        console.error(e)
        console.error(
            'ERROR: Line ', e.lineno, ' in ', e.filename, ': ', e.message
        )
    }

    constructor() {
        const worker = new WasmSorterWorker()
        worker.addEventListener('error', this.onError, false)
        this._workerCtor = wrap(worker) as any
    }

    async createWorker(data: Uint8Array, maxSplats = 1000000) {
        if (this._workers.length < this._maxWorkers) {
            const vertexCount = Math.floor(data.length / SPLAT_ROW_LENGTH)
            const bufferInfo = trimBuffer(data, maxSplats, vertexCount)
            const globalBuffer = transfer(bufferInfo.buffer, [bufferInfo.buffer.buffer])
            const worker = await new this._workerCtor(vertexCount, globalBuffer)
            await worker.load()
            this._workers.push(worker)
            return worker
        }
        console.error('Max workers reached')
        throw new Error('Max workers reached')
    }

    async disposeWorker(worker: Remote<WasmSorter>) {
        const index = this._workers.indexOf(worker)
        if (index !== -1) {
            this._workers.splice(index, 1)
            await worker.dispose()
        }
    }
}
