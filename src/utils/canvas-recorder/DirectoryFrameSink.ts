import {writeFile} from 'ts-browser-helpers'
import type {CanvasRecorderFrame, ICanvasFrameSink} from './ACanvasRecorder'

/**
 * Writes each frame of an image sequence to a new folder (`i-<time>`) inside a folder the user picks. The default sink of
 * {@link ImageSequenceRecorder}. Needs the File System Access API (`showDirectoryPicker`: Chromium browsers, not Safari or
 * Firefox), and the start has to come from a user gesture, like a click.
 */
export class DirectoryFrameSink implements ICanvasFrameSink {
    /** This browser can pick a folder */
    static get supported(): boolean {
        return typeof window !== 'undefined' && !!(window as any).showDirectoryPicker
    }

    private _directory?: FileSystemDirectoryHandle

    start(): Promise<void> {
        this._directory = undefined
        // no folder to write to: the start fails at once
        if (!DirectoryFrameSink.supported) throw new Error('this browser can\'t save to a folder (no showDirectoryPicker). Save the frames to a zip (ZipFrameSink) instead')
        return (async() => {
            const parent: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker()
            this._directory = await parent.getDirectoryHandle('i-' + Math.floor(Date.now()), {create: true})
        })()
    }

    async write(frame: CanvasRecorderFrame): Promise<void> {
        if (!this._directory) throw new Error('DirectoryFrameSink: no folder, start() did not finish')
        await writeFile(await this._directory.getFileHandle(frame.name, {create: true}), frame.blob)
    }

    dispose(): void {
        this._directory = undefined
    }
}
