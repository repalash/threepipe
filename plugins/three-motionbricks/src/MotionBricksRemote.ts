import type {GenerateOptions, GeneratedMotion, MotionGenerator, ProgressCallback} from './MotionBricksG1'
import type {WorkerLoadOptions, WorkerRequest} from './MotionBricksWorker'

interface Pending {
    resolve: (v: any) => void
    reject: (e: Error) => void
    progress?: ProgressCallback
}

/** A WorkerRequest without its id, which _call adds. */
type Request = WorkerRequest extends infer R ? R extends WorkerRequest ? Omit<R, 'id'> : never : never

/**
 * MotionBricksG1 in a Web Worker (MotionBricksWorker.ts), behind the same generate() call.
 * Loading, dequantizing the weights and every inference happen off the main thread.
 */
export class MotionBricksRemote implements MotionGenerator {
    readonly worker: Worker
    backend = ''
    private _id = 0
    private _pending = new Map<number, Pending>()

    constructor(worker: Worker) {
        this.worker = worker
        worker.onmessage = (e: MessageEvent) => {
            const m = e.data
            const p = this._pending.get(m.id)
            if (!p) return
            if (m.type === 'progress') return p.progress?.(m.loaded, m.total)
            this._pending.delete(m.id)
            if (m.type === 'done') p.resolve(m.result)
            else p.reject(new Error(m.message))
        }
        worker.onerror = (e: ErrorEvent) => {
            const error = new Error(e.message || 'The MotionBricks worker failed to start')
            for (const p of this._pending.values()) p.reject(error)
            this._pending.clear()
        }
    }

    private async _call<T>(request: Request, progress?: ProgressCallback): Promise<T> {
        const id = ++this._id
        return new Promise<T>((resolve, reject) => {
            this._pending.set(id, {resolve, reject, progress})
            this.worker.postMessage({...request, id})
        })
    }

    /**
     * Start the worker and load the model in it. URLs are resolved against the page.
     * @param worker a worker running MotionBricksWorker; the default is the one bundled with this package
     */
    static async Load(options: WorkerLoadOptions, onProgress?: ProgressCallback, worker?: Worker) {
        const remote = new MotionBricksRemote(worker ?? new Worker(new URL('./MotionBricksWorker.ts', import.meta.url), {type: 'module'}))
        const abs = (u: string) => new URL(u, location.href).href
        try {
            const result = await remote._call<{backend: string}>({type: 'load', options: {
                ...options, ort: abs(options.ort), model: abs(options.model), wasm: options.wasm?.map(abs),
            }}, onProgress)
            remote.backend = result.backend
            return remote
        } catch (e) {
            remote.worker.terminate()
            throw e
        }
    }

    async generate(context: ArrayLike<number>[], target: ArrayLike<number>[], options?: GenerateOptions): Promise<GeneratedMotion> {
        return this._call<GeneratedMotion>({
            type: 'generate',
            context: context.map(p => Float32Array.from(p)),
            target: target.map(p => Float32Array.from(p)),
            options,
        })
    }
}
