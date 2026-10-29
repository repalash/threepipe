// Runs MotionBricksG1 in a module worker, so ONNX Runtime never blocks the page's frames.
// ONNX Runtime's WebAssembly backend computes synchronously, and its WebGPU backend runs some
// nodes on the CPU, so on the main thread every generation would freeze the robot mid-stride.
// The package build bundles this file with the engine into one worker script.

import {GenerateOptions, MotionBricksG1, setupOrtWeb} from './MotionBricksG1'

export interface WorkerLoadOptions {
    /** Absolute URL of the onnxruntime-web module. */
    ort: string
    /** Absolute URLs of the parts of the ORT .wasm file, for hosts that limit file size. */
    wasm?: string[]
    /** Absolute URL: a folder with pack.json (ending in /) or a .onnx file. */
    model: string
    sessionOptions: any
}

export type WorkerRequest =
    | {id: number, type: 'load', options: WorkerLoadOptions}
    | {id: number, type: 'generate', context: ArrayLike<number>[], target: ArrayLike<number>[], options?: GenerateOptions}

const scope = self as any
let engine: MotionBricksG1 | null = null

async function load(id: number, o: WorkerLoadOptions) {
    const ort = await import(/* @vite-ignore */ o.ort)
    await setupOrtWeb(ort, o.wasm)
    let last = 0
    const progress = (loaded: number, total: number) => {
        const now = performance.now()
        if (now - last < 100 && loaded < total) return
        last = now
        scope.postMessage({id, type: 'progress', loaded, total})
    }
    engine = await MotionBricksG1.Load(ort, o.model, o.sessionOptions, progress)
    return {backend: engine.backend}
}

scope.onmessage = async(e: MessageEvent<WorkerRequest>) => {
    const r = e.data
    try {
        if (r.type === 'load') {
            scope.postMessage({id: r.id, type: 'done', result: await load(r.id, r.options)})
        } else {
            if (!engine) throw new Error('The model is not loaded')
            const motion = await engine.generate(r.context, r.target, r.options)
            const transfer = [...motion.poses, ...motion.footContacts].map(a => a.buffer)
            scope.postMessage({id: r.id, type: 'done', result: motion}, transfer)
        }
    } catch (err) {
        scope.postMessage({id: r.id, type: 'error', message: err instanceof Error ? err.message : String(err)})
    }
}
