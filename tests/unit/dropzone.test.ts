/**
 * Dropzone reads a drop through `dataTransfer.items` (folders too). In a document without an origin (a sandboxed page,
 * like a page on files.threepipe.org) the browser refuses `FileSystemFileEntry.file()`: the drop then takes the same
 * file from `dataTransfer.files`, and the other files still load.
 */
import {describe, expect, test, vi} from 'vitest'
import {Dropzone, DropFile} from '../../src/utils/Dropzone'

/** A file (node has File; filePath is set by the Dropzone) */
const file = (name: string) => new File(['x'], name) as DropFile

/** A file entry whose file() gives the file, or (refused) calls the error callback as Chrome does in a sandboxed page */
function fileEntry(f: File, fullPath: string, refused = false) {
    return {
        isFile: true, isDirectory: false, name: fullPath.split('/').pop(), fullPath,
        file: (ok: (f: File) => void, fail: (e: Error) => void) => setTimeout(() => refused ? fail(new Error('EncodingError')) : ok(f)),
    }
}

/** A folder entry with these entries, or one whose reader is refused */
function folderEntry(fullPath: string, entries: any[], refused = false) {
    return {
        isFile: false, isDirectory: true, name: fullPath.split('/').pop(), fullPath,
        createReader: () => {
            let done = false
            return {readEntries: (ok: (e: any[]) => void, fail: (e: Error) => void) => setTimeout(() => {
                if (refused) return fail(new Error('EncodingError'))
                ok(done ? [] : entries)
                done = true
            })}
        },
    }
}

/** Drops these files and entries on a Dropzone and resolves with the emitted file map (or the error message) */
async function drop(files: File[], entries: any[]) {
    let onDrop: (e: any) => void = () => {}
    const el: any = {addEventListener: (t: string, f: any) => t === 'drop' && (onDrop = f)}
    const zone = new Dropzone(el)
    const result = new Promise<{files?: Map<string, DropFile>, error?: string}>(resolve => {
        zone.on('drop', d => resolve({files: d?.files}))
        zone.on('droperror', d => resolve({error: d?.message}))
    })
    onDrop({
        stopPropagation: () => {}, preventDefault: () => {},
        dataTransfer: {files, items: entries.map(e => ({webkitGetAsEntry: () => e}))},
    })
    return result
}

describe('Dropzone', () => {
    test('a dropped file is read from its entry, with its path', async() => {
        const ring = file('ring.glb')
        const {files} = await drop([ring], [fileEntry(ring, '/ring.glb')])
        expect([...files!.keys()]).toEqual(['/ring.glb'])
        expect(files!.get('/ring.glb')).toBe(ring)
        expect(files!.get('/ring.glb')!.filePath).toBe('/ring.glb')
    })

    test('a file whose entry cannot be read (sandboxed page) is taken from dataTransfer.files, with the same path', async() => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const tex = file('texture.glb')
            const env = file('env.hdr')
            const {files} = await drop([tex, env], [fileEntry(tex, '/texture.glb', true), fileEntry(env, '/env.hdr', true)])
            expect(new Set(files!.keys())).toEqual(new Set(['/texture.glb', '/env.hdr']))
            expect(files!.get('/texture.glb')).toBe(tex)
            expect(files!.get('/texture.glb')!.filePath).toBe('/texture.glb')
            expect(error).not.toHaveBeenCalled()
        } finally {
            error.mockRestore()
        }
    })

    test('a folder that cannot be read does not stop the drop: the other files load, and the folder is logged', async() => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const ring = file('ring.glb')
            const {files} = await drop([ring, file('textures')], [fileEntry(ring, '/ring.glb'), folderEntry('/textures', [], true)])
            expect([...files!.keys()]).toEqual(['/ring.glb'])
            expect(error).toHaveBeenCalledOnce()
        } finally {
            error.mockRestore()
        }
    })

    test('a file in a folder that cannot be read (no file of that path in dataTransfer.files) is skipped and logged', async() => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const gltf = file('scene.gltf')
            const bin = file('scene.bin')
            const {files} = await drop([file('helmet')], [folderEntry('/helmet', [fileEntry(gltf, '/helmet/scene.gltf'), fileEntry(bin, '/helmet/scene.bin', true)])])
            expect([...files!.keys()]).toEqual(['/helmet/scene.gltf'])
            expect(error).toHaveBeenCalledOnce()
        } finally {
            error.mockRestore()
        }
    })

    test('a drop where nothing can be read is a drop error', async() => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const {files, error: message} = await drop([file('textures')], [folderEntry('/textures', [], true)])
            expect(files).toBeUndefined()
            expect(message).toMatch(/could not read/i)
        } finally {
            error.mockRestore()
        }
    })
})
