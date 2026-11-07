import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {FFMPEGRecorder} from '../../src/utils/canvas-recorder/FFMPEGRecorder'

class FakeWorker {
    onmessage?: (e: {data: any}) => void
    onerror?: (e: {message: string}) => void
    postMessage() { /* the encoder */ }
    terminate() { /* the encoder */ }
}

describe('FFMPEGRecorder', () => {
    beforeEach(() => {
        vi.stubGlobal('Worker', FakeWorker)
        vi.stubGlobal('Blob', class {})
        vi.stubGlobal('URL', Object.assign(URL, {createObjectURL: () => 'blob:worker'}))
    })
    afterEach(() => vi.unstubAllGlobals())

    const started = () => {
        const recorder = new FFMPEGRecorder({width: 4, height: 4} as HTMLCanvasElement)
        recorder.start()
        return {recorder, worker: recorder.worker as unknown as FakeWorker}
    }

    test('the reply of the worker to each frame does not end the recording', () => {
        const {recorder, worker} = started()
        worker.onmessage!({data: {type: 'error', data: 'unknown command'}})
        expect(recorder.state).toBe('recording')
    })

    test('a real error of the worker ends the recording', () => {
        const {recorder, worker} = started()
        worker.onmessage!({data: {type: 'error', data: 'already running'}})
        expect(recorder.state).toBe('error')
    })

    test('an abort of the worker ends the recording', () => {
        const {recorder, worker} = started()
        worker.onmessage!({data: {type: 'abort', data: 'out of memory'}})
        expect(recorder.state).toBe('error')
    })
})
