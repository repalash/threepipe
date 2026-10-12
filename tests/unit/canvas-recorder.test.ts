import {describe, expect, test} from 'vitest'
import {
    evenSize,
    getAvcLevel,
    getCodecFromString,
    getDefaultBitrate,
    getFrameTiming,
    getVideoCodecString,
} from '../../plugins/canvas-recorder/src/codecs'

describe('canvas-recorder codecs', () => {
    test('H.264 codec string picks the smallest level for the size and frame rate', () => {
        expect(getVideoCodecString('avc', 1920, 1080, 60, 15e6)).toBe('avc1.64002A') // level 4.2
        expect(getVideoCodecString('avc', 1920, 1080, 30, 15e6)).toBe('avc1.640028') // level 4.0
        expect(getVideoCodecString('avc', 1280, 720, 60, 8e6)).toBe('avc1.640020') // level 3.2
        expect(getVideoCodecString('avc', 3840, 2160, 30, 40e6)).toBe('avc1.640033') // level 5.1
        expect(getVideoCodecString('avc', 3840, 2160, 60, 60e6)).toBe('avc1.640034') // level 5.2
    })

    test('H.264 level accounts for the bitrate', () => {
        expect(getAvcLevel(1920, 1080, 30, 20e6)).toBe(40) // High profile level 4.0: 25 Mbit/s
        expect(getAvcLevel(1920, 1080, 30, 30e6)).toBe(41) // High profile level 4.1: 62.5 Mbit/s
    })

    test('VP9 and AV1 codec strings', () => {
        expect(getVideoCodecString('vp9', 1920, 1080, 60)).toBe('vp09.00.41.08')
        expect(getVideoCodecString('vp9', 1280, 720, 60)).toBe('vp09.00.40.08')
        expect(getVideoCodecString('vp9', 1280, 720, 30)).toBe('vp09.00.31.08')
        expect(getVideoCodecString('av1', 1920, 1080, 60)).toBe('av01.0.09M.08')
        expect(getVideoCodecString('av1', 1280, 720, 30)).toBe('av01.0.05M.08')
        expect(getVideoCodecString('hevc', 1920, 1080, 60)).toBe('')
    })

    test('codec family from a codec string', () => {
        expect(getCodecFromString('avc1.64002A')).toBe('avc')
        expect(getCodecFromString('avc3.42001f')).toBe('avc')
        expect(getCodecFromString('hvc1.1.6.L123.B0')).toBe('hevc')
        expect(getCodecFromString('vp09.00.41.08')).toBe('vp9')
        expect(getCodecFromString('av01.0.09M.08')).toBe('av1')
        expect(getCodecFromString('vp8')).toBeUndefined()
    })

    test('frame timestamps come from the frame index and do not drift', () => {
        const fps = 60
        let total = 0
        for (let i = 0; i < 600; i++) {
            const {timestamp, duration} = getFrameTiming(i, fps)
            expect(timestamp).toBe(total)
            total += duration
        }
        expect(total).toBe(10_000_000) // 600 frames at 60 fps = 10 s
        expect(getFrameTiming(3, 60)).toEqual({timestamp: 50000, duration: 16667})
        expect(getFrameTiming(1, 30)).toEqual({timestamp: 33333, duration: 33334})
    })

    test('even sizes and default bitrate', () => {
        expect(evenSize(1081)).toBe(1080)
        expect(evenSize(1080)).toBe(1080)
        expect(evenSize(1)).toBe(2)
        expect(getDefaultBitrate(1920, 1080, 60)).toBe(14929920)
        expect(getDefaultBitrate(64, 64, 1)).toBe(1e6)
    })
})

describe('canvas-recorder ImageSequenceRecorder', () => {
    test('writes the frames into a zip in order, when the encoding finishes out of order', async() => {
        const {ImageSequenceRecorder} = await import('../../plugins/canvas-recorder/src/recorders/ImageSequenceRecorder')
        const {unzipSync, strFromU8} = await import('three/examples/jsm/libs/fflate.module.js')
        let content = ''
        // canvas stand-in: toBlob snapshots the current content and finishes after a random delay
        const canvas = {
            width: 4, height: 2,
            toBlob(cb: (b: Blob | null) => void, type: string) {
                const data = content + ' ' + type
                setTimeout(() => cb(new Blob([data])), Math.random() * 20)
            },
        } as unknown as HTMLCanvasElement
        const recorder = new ImageSequenceRecorder({format: 'image/jpeg'})
        await recorder.start({width: 4, height: 2, fps: 30})
        for (let i = 0; i < 12; i++) {
            content = 'frame ' + i
            recorder.addFrame(canvas, i)
        }
        expect(recorder.pendingFrames).toBe(12)
        await recorder.waitForPending(4)
        expect(recorder.pendingFrames).toBeLessThanOrEqual(4)
        const blob = await recorder.finish()
        expect(blob?.type).toBe('application/zip')
        const files = unzipSync(new Uint8Array(await blob!.arrayBuffer()))
        const names = Object.keys(files)
        expect(names).toEqual(Array.from({length: 12}, (_, i) => 'frame_' + String(i).padStart(6, '0') + '.jpg'))
        names.forEach((name, i) => expect(strFromU8(files[name])).toBe('frame ' + i + ' image/jpeg'))
    })
})
