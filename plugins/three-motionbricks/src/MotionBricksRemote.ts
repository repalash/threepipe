import type {GenerateOptions, GeneratedMotion, MotionGenerator, ProgressCallback} from './MotionBricksG1'
import type {WorkerLoadOptions, WorkerRequest} from './MotionBricksWorker'
// @ts-expect-error a Vite import: the URL of the worker bundle, dist/motionbricks.worker.js
import workerUrl from './MotionBricksWorker.ts?worker&url'

interface Pending {
    resolve: (v: any) => void
    reject: (e: Error) => void
    progress?: ProgressCallback
}

/** The worker could not start or crashed, as opposed to an error from the model, which is passed on as it is. */
export class MotionBricksWorkerError extends Error {
    name = 'MotionBricksWorkerError'
}

/**
 * Start the worker bundled with this package. A worker script must be same-origin, so when the package is
 * served from a CDN, a same-origin blob worker imports it instead.
 */
function startWorker() {
    const url = new URL(workerUrl, import.meta.url)
    if (url.origin === location.origin) return new Worker(url, {type: 'module'})
    const blob = new Blob([`import ${JSON.stringify(url.href)}`], {type: 'text/javascript'})
    const blobUrl = URL.createObjectURL(blob)
    const worker = new Worker(blobUrl, {type: 'module'})
    // The worker fetches its import right away; the blob is not needed after that.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
    return worker
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
            const error = new MotionBricksWorkerError(e.message || 'The MotionBricks worker failed to start')
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
     * Start the worker and load the model in it. URLs are resolved against the page. It throws a
     * MotionBricksWorkerError when the worker cannot run, and the model's own error when the model fails to load.
     * @param worker a worker running MotionBricksWorker; the default is the one bundled with this package
     */
    static async Load(options: WorkerLoadOptions, onProgress?: ProgressCallback, worker?: Worker) {
        let w = worker
        try {
            w ??= startWorker()
        } catch (e) {
            throw new MotionBricksWorkerError(e instanceof Error ? e.message : String(e))
        }
        const remote = new MotionBricksRemote(w)
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
